from __future__ import annotations

import re
import shutil
from pathlib import Path

from app.config import settings
from app.services.ffmpeg_pipeline import (
    ensure_ffmpeg_configured,
    input_window_args,
    probe,
    probe_cached,
    resolve_subtitle_font,
    run_cmd,
    trim_audio_filter,
    trim_video_filter,
)
from app.services.sell_planner import EditClip, MagicCue
from dataclasses import dataclass

HEAD_PAD: float = 0.08  # 秒：片头提前量（保护首字清辅音/声母，防止吃头音）
TAIL_PAD: float = 0.25  # 秒：片尾延后量（保护尾字/儿化音/语气词/气口，彻底解决句尾吞字）


@dataclass
class VideoSlice:
    path: Path
    cut_start: float
    cut_end: float
    raw_dur: float
    text: str
    role: str


@dataclass
class SubtitleItem:
    text: str
    start: float  # 成片时间轴起点（秒）
    end: float    # 成片时间轴终点（秒）


def find_available_bgm(preferred: str | None = None) -> Path | None:
    """查找用户上传的背景音乐，如果未上传则返回 None（默认无内置音乐）"""
    bgm_dir = settings.bgm_dir
    bgm_dir.mkdir(parents=True, exist_ok=True)
    if preferred and preferred != "auto":
        target = bgm_dir / preferred
        if target.exists() and target.is_file():
            return target

    existing = sorted(
        [
            *bgm_dir.glob("*.mp3"),
            *bgm_dir.glob("*.mp4"),
            *bgm_dir.glob("*.m4a"),
            *bgm_dir.glob("*.wav"),
            *bgm_dir.glob("*.aac"),
            *bgm_dir.glob("*.flac"),
            *bgm_dir.glob("*.ogg"),
        ]
    )
    if existing:
        return existing[0]
    return None


def _ass_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("{", "（")
        .replace("}", "）")
        .replace("\n", "")
    )


def split_subtitle_chunks(text: str, *, max_chars: int = 10) -> list[str]:
    """
    口播字幕按「一段一段」切开：每段不超过 max_chars 字，单行不换行。
    优先在标点断开，再按字数软切。
    """
    text = _ass_escape(re.sub(r"\s+", "", text.strip()))
    if not text:
        return []

    parts = re.split(r"(?<=[，。！？；、,.!?;:])", text)
    chunks: list[str] = []
    soft = set("的了呢啊嘛吧呀哦哈")

    for part in parts:
        part = part.strip()
        if not part:
            continue
        while len(part) > max_chars:
            window = part[:max_chars]
            cut = max_chars
            for i in range(len(window) - 1, max(2, max_chars // 2) - 1, -1):
                if window[i] in soft:
                    cut = i + 1
                    break
            piece = part[:cut].strip()
            if piece:
                chunks.append(piece)
            part = part[cut:]
        if part:
            chunks.append(part)
    return chunks


def _ts(seconds: float) -> str:
    cs = int(round(max(0.0, seconds) * 100))
    h = cs // 360000
    cs %= 360000
    m = cs // 6000
    cs %= 6000
    s = cs // 100
    c = cs % 100
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def fuse_and_pad_clips(
    clips: list[EditClip],
    *,
    speech_speed: float = 1.0,
    max_gap: float = 0.80,
    head_pad: float = HEAD_PAD,
    tail_pad: float = TAIL_PAD,
) -> tuple[list[VideoSlice], list[SubtitleItem]]:
    """
    智能将同素材且时间相连的句子融合成连续的大视频切片（允许自然说话换气停顿 <=0.80s），
    为每个独立裁切点施加前后保护边距 (head_pad, tail_pad)，彻底杜绝句尾吞字/首字截断，
    并精确计算与最终成片时间轴毫秒级对齐的字幕条目 (SubtitleItem)。
    """
    if not clips:
        return [], []

    speed = max(0.5, min(2.0, speech_speed))

    # 1. 将同素材且停顿在合理换气范围 (<=max_gap) 内的相邻句子聚类为一个连续视频切片
    groups: list[list[EditClip]] = []
    curr_group: list[EditClip] = []

    for clip in clips:
        if not curr_group:
            curr_group.append(clip)
            continue
        last = curr_group[-1]
        gap = clip.start - last.end
        if clip.path == last.path and 0.0 <= gap <= max_gap:
            curr_group.append(clip)
        else:
            groups.append(curr_group)
            curr_group = [clip]
    if curr_group:
        groups.append(curr_group)

    video_slices: list[VideoSlice] = []
    subtitle_items: list[SubtitleItem] = []
    timeline_cursor = 0.0

    for i, group in enumerate(groups):
        path = group[0].path
        g_start = group[0].start
        g_end = group[-1].end
        info = probe_cached(path)
        src_dur = info.duration

        # 计算片头保护边距 (head_pad)
        actual_head = min(head_pad, g_start)
        if i > 0 and groups[i - 1][0].path == path:
            prev_end = groups[i - 1][-1].end
            if g_start >= prev_end:
                actual_head = min(actual_head, max(0.0, (g_start - prev_end) * 0.45))
        cut_start = max(0.0, g_start - actual_head)

        # 计算片尾保护边距 (tail_pad)，彻底解决句尾吞字
        actual_tail = min(tail_pad, max(0.0, src_dur - g_end))
        if i + 1 < len(groups) and groups[i + 1][0].path == path:
            nxt_start = groups[i + 1][0].start
            if nxt_start >= g_end:
                actual_tail = min(actual_tail, max(0.0, (nxt_start - g_end) * 0.45))
        cut_end = min(src_dur, g_end + actual_tail)

        raw_dur = max(0.2, cut_end - cut_start)
        seg_dur = max(0.2, raw_dur / speed)

        merged_text = " ".join(c.text.strip() for c in group if c.text.strip())
        video_slices.append(
            VideoSlice(
                path=path,
                cut_start=cut_start,
                cut_end=cut_end,
                raw_dur=raw_dur,
                text=merged_text,
                role=group[0].role,
            )
        )

        # 2. 为组内每个句子生成与最终成片音视频绝对对齐的字幕时间
        for j, c in enumerate(group):
            c_text = c.text.strip()
            if not c_text:
                continue
            # 句子在切片内的起始与结束偏移（秒）
            sub_start = timeline_cursor + max(0.0, (c.start - cut_start) / speed)
            sub_end = timeline_cursor + min(seg_dur, (c.end - cut_start) / speed)

            # 若为组内最后一句，字幕可自然延展覆盖少许尾部缓冲
            if j == len(group) - 1:
                sub_end = min(timeline_cursor + seg_dur, sub_end + min(0.18, actual_tail) / speed)

            if sub_end <= sub_start:
                sub_end = sub_start + 0.3

            subtitle_items.append(
                SubtitleItem(
                    text=c_text,
                    start=sub_start,
                    end=sub_end,
                )
            )

        timeline_cursor += seg_dur

    return video_slices, subtitle_items


# 兼容旧名称
def fuse_adjacent_clips(
    clips: list[EditClip],
    max_gap: float = 0.80,
) -> tuple[list[EditClip], list[EditClip]]:
    slices, _ = fuse_and_pad_clips(clips, max_gap=max_gap)
    legacy_segments = [
        EditClip(
            path=s.path,
            start=s.cut_start,
            end=s.cut_end,
            text=s.text,
            role=s.role,
        )
        for s in slices
    ]
    return legacy_segments, clips


def write_ass_subtitles(
    subtitles: list[SubtitleItem] | list[EditClip],
    ass_path: Path,
    *,
    magic_cues: list[MagicCue] | None = None,
    speech_speed: float = 1.0,
    subtitle_position: str = "high",
) -> Path:
    """
    写 ASS：
    - Default：口播字幕，每段 ≤10 字、单行不换行，按时长比例逐段弹出
    - Hook：神奇大字，顶部缩放淡入动效
    """
    font_name = resolve_subtitle_font()
    margin_v = 380 if subtitle_position == "high" else (500 if subtitle_position == "mid" else 260)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},64,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,2,0,1,4,0,2,80,80,{margin_v},1
Style: Hook,{font_name},110,&H0000D7FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,4,0,1,5,0,8,60,60,160,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    speed = max(0.5, min(2.0, speech_speed))

    for item in subtitles:
        if isinstance(item, SubtitleItem):
            clip_start = item.start
            clip_end = item.end
            text = item.text
        else:
            dur = max(0.2, (item.end - item.start) / speed)
            clip_start = 0.0
            clip_end = dur
            text = item.text

        dur = max(0.2, clip_end - clip_start)
        chunks = split_subtitle_chunks(text, max_chars=10)
        if not chunks:
            continue

        weights = [max(1, len(c)) for c in chunks]
        weight_sum = float(sum(weights))
        t = clip_start
        for i, (chunk, w) in enumerate(zip(chunks, weights)):
            share = dur * (w / weight_sum)
            if i == len(chunks) - 1:
                end = clip_end
            else:
                end = min(clip_end, t + max(0.28 / speed, share))
            if end <= t:
                end = min(clip_end, t + 0.28 / speed)
            chunk_escaped = "{\\fad(80,60)}" + chunk
            lines.append(
                f"Dialogue: 0,{_ts(t)},{_ts(end)},Default,,0,0,0,,{chunk_escaped}\n"
            )
            t = end

    for cue in magic_cues or []:
        cue_text = _ass_escape(re.sub(r"\s+", "", cue.text.strip()))[:10]
        if not cue_text:
            continue
        start = max(0.0, cue.at / speed)
        end = start + max(0.8, cue.duration / speed)
        anim = (
            r"{\fad(120,220)\t(0,180,\fscx128\fscy128)"
            r"\t(180,360,\fscx100\fscy100)\bord5\shad0}"
        )
        lines.append(
            f"Dialogue: 1,{_ts(start)},{_ts(end)},Hook,,0,0,0,,{anim}{cue_text}\n"
        )

    ass_path.parent.mkdir(parents=True, exist_ok=True)
    ass_path.write_text("".join(lines), encoding="utf-8")
    return ass_path


def render_sell_video(
    clips: list[EditClip],
    output: Path,
    *,
    add_subtitles: bool,
    add_bgm: bool,
    bgm_volume: int = 25,
    bgm_file: str | None = None,
    magic_cues: list[MagicCue] | None = None,
    speech_speed: float = 1.0,
    subtitle_position: str = "high",
    video_quality: str = "1080p",
    on_progress,
) -> float:
    if not clips:
        raise ValueError("没有可拼接的口播句子片段")

    output.parent.mkdir(parents=True, exist_ok=True)
    work = settings.work_dir / output.stem
    work.mkdir(parents=True, exist_ok=True)

    # 1. 智能相邻片段融合与保护边距施加（前后缓冲防吞字，平滑连续话术）
    video_slices, subtitle_items = fuse_and_pad_clips(
        clips,
        speech_speed=speech_speed,
        max_gap=0.80,
    )

    # 2. 动态根据用户选择的画质设置分辨率与 CRF 压缩质量
    vq = (video_quality or "1080p").lower()
    if vq == "4k":
        w, h, crf_val, preset_val = 2160, 3840, "17", "fast"
    elif vq == "2k":
        w, h, crf_val, preset_val = 1440, 2560, "19", "veryfast"
    elif vq == "720p":
        w, h, crf_val, preset_val = 720, 1280, "26", "veryfast"
    else:  # 1080p 默认
        w, h, crf_val, preset_val = 1080, 1920, "22", "veryfast"

    fps = settings.target_fps
    segment_files: list[Path] = []
    n = len(video_slices)

    for i, slice_item in enumerate(video_slices):
        on_progress(35 + int(40 * i / max(n, 1)), f"按连贯段落截取片段 {i + 1}/{n}…")
        seg_file = work / f"seg_{i:03d}.mp4"
        raw_dur = slice_item.raw_dur
        info = probe_cached(slice_item.path)
        seg_dur = max(0.2, raw_dur / speech_speed)

        # trim/atrim 用同一条原片时间轴裁切，避免双 -ss 画面在说话、声音却是静音
        vf_after = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,"
        )
        if abs(speech_speed - 1.0) > 0.01:
            vf_after += f"setpts=PTS/{speech_speed:.4f},"
        vf_after += f"fps={fps},format=yuv420p"

        cmd = [
            settings.ffmpeg_bin,
            "-y",
            *input_window_args(slice_item.path, slice_item.cut_start),
            "-vf",
            trim_video_filter(slice_item.cut_start, raw_dur, vf_after),
        ]

        if info.has_audio:
            af_after = ""
            if abs(speech_speed - 1.0) > 0.01:
                af_after += f"atempo={speech_speed:.4f},"
            af_after += (
                "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                "dynaudnorm=f=75:g=15:m=10.0:r=0.9,"
                "volume=1.15"
            )
            if seg_dur >= 0.8:
                fade_out_st = max(0.1, seg_dur - 0.025)
                af_after += (
                    f",afade=t=in:st=0:d=0.015,afade=t=out:st={fade_out_st:.3f}:d=0.025"
                )
            cmd += [
                "-af",
                trim_audio_filter(slice_item.cut_start, raw_dur, af_after),
            ]
        else:
            cmd += [
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=44100",
                "-shortest",
            ]

        cmd += [
            "-c:v",
            "libx264",
            "-preset",
            preset_val,
            "-crf",
            crf_val,
            "-profile:v",
            "high",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(seg_file),
        ]
        run_cmd(cmd, timeout=300)
        segment_files.append(seg_file)

    on_progress(76, "拼接 9:16 成片…")
    concat_list = work / "concat.txt"
    concat_list.write_text(
        "".join(f"file '{p.resolve()}'\n" for p in segment_files),
        encoding="utf-8",
    )
    concat_path = work / "concat.mp4"
    run_cmd(
        [
            settings.ffmpeg_bin,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(concat_path),
        ],
        timeout=300,
    )

    current = concat_path

    if add_subtitles or magic_cues:
        ffmpeg_bin, _, has_sub = ensure_ffmpeg_configured()
        if not has_sub:
            raise RuntimeError(
                f"当前 FFmpeg ({ffmpeg_bin}) 未找到 subtitles (libass) 滤镜，无法进行字幕烧录。\n"
                f"推荐安装支持 libass 的 FFmpeg（例如 Mac 终端运行: brew install ffmpeg-full），"
                f"并在环境变量中指定 KUAFA_FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
            )
        on_progress(
            82,
            "烧录字幕与神奇大字动效…" if magic_cues else "烧录口播字幕…",
        )
        write_ass_subtitles(
            subtitle_items if add_subtitles else [],
            work / "subs.ass",
            magic_cues=magic_cues,
            speech_speed=speech_speed,
            subtitle_position=subtitle_position,
        )
        subtitled = work / "subtitled.mp4"
        run_cmd(
            [
                settings.ffmpeg_bin,
                "-y",
                "-i",
                current.name,
                "-vf",
                "subtitles=subs.ass",
                "-c:v",
                "libx264",
                "-preset",
                preset_val,
                "-crf",
                crf_val,
                "-c:a",
                "copy",
                "-movflags",
                "+faststart",
                subtitled.name,
            ],
            timeout=300,
            cwd=work,
        )
        current = subtitled

    if add_bgm:
        bgm_path = find_available_bgm(bgm_file)
        if bgm_path:
            on_progress(88, f"混入背景音乐「{bgm_path.stem}」…")
            volume_val = max(0.0, min(1.0, bgm_volume / 100.0))
            mixed = work / "mixed.mp4"
            run_cmd(
                [
                    settings.ffmpeg_bin,
                    "-y",
                    "-i",
                    str(current),
                    "-stream_loop",
                    "-1",
                    "-i",
                    str(bgm_path),
                    "-filter_complex",
                    f"[0:a]volume=1.0[vocal];"
                    f"[1:a]volume={volume_val:.2f},afade=t=in:st=0:d=1[bg];"
                    "[vocal][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
                    "-map",
                    "0:v",
                    "-map",
                    "[aout]",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    "-movflags",
                    "+faststart",
                    str(mixed),
                ],
                timeout=300,
            )
            current = mixed

    on_progress(96, "写出最终成片…")
    if current.resolve() != output.resolve():
        shutil.copyfile(current, output)
    on_progress(100, "成片完成")
    return probe(output).duration
