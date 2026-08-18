from __future__ import annotations

import re
from pathlib import Path

from app.config import settings
from app.services.ffmpeg_pipeline import (
    ensure_ffmpeg_configured,
    probe,
    resolve_subtitle_font,
    run_cmd,
)
from app.services.sell_planner import EditClip, MagicCue


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


def fuse_adjacent_clips(
    clips: list[EditClip],
    max_gap: float = 1.0,
) -> tuple[list[EditClip], list[EditClip]]:
    """
    智能将同素材且时间相连的句子融合成连续的大视频切片，
    同时返回时间轴完全对齐的 subtitle_clips（用于精准单句字幕烧录）。
    彻底避免在同素材内部反复做硬切和拼接导致的微卡顿与音爆。
    """
    if not clips:
        return [], []

    # 1. 调整相邻句子的边界，平滑消除 ASR 细微切分缝隙（<=1.0s），保证音画完全连续且字幕不漂移
    aligned_clips: list[EditClip] = []
    for i, clip in enumerate(clips):
        start = clip.start
        end = clip.end
        if i + 1 < len(clips):
            nxt = clips[i + 1]
            if nxt.path == clip.path and 0.0 <= (nxt.start - end) <= max_gap:
                end = nxt.start
        aligned_clips.append(
            EditClip(
                path=clip.path,
                start=start,
                end=end,
                text=clip.text,
                role=clip.role,
            )
        )

    # 2. 将同一素材中连续相接的句子合并为一个连续切片进行 FFmpeg 截取
    video_segments: list[EditClip] = []
    curr = aligned_clips[0]
    for nxt in aligned_clips[1:]:
        if nxt.path == curr.path and abs(nxt.start - curr.end) < 0.05:
            curr = EditClip(
                path=curr.path,
                start=curr.start,
                end=nxt.end,
                text=f"{curr.text} {nxt.text}".strip(),
                role=curr.role,
            )
        else:
            video_segments.append(curr)
            curr = nxt
    video_segments.append(curr)

    return video_segments, aligned_clips


def write_ass_subtitles(
    clips: list[EditClip],
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
    cursor = 0.0
    speed = max(0.5, min(2.0, speech_speed))
    for clip in clips:
        dur = max(0.2, (clip.end - clip.start) / speed)
        clip_start = cursor
        clip_end = cursor + dur
        chunks = split_subtitle_chunks(clip.text, max_chars=10)
        if not chunks:
            cursor = clip_end
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
            text = "{\\fad(80,60)}" + chunk
            lines.append(
                f"Dialogue: 0,{_ts(t)},{_ts(end)},Default,,0,0,0,,{text}\n"
            )
            t = end
        cursor = clip_end

    for cue in magic_cues or []:
        text = _ass_escape(re.sub(r"\s+", "", cue.text.strip()))[:10]
        if not text:
            continue
        start = max(0.0, cue.at / speed)
        end = start + max(0.8, cue.duration / speed)
        anim = (
            r"{\fad(120,220)\t(0,180,\fscx128\fscy128)"
            r"\t(180,360,\fscx100\fscy100)\bord5\shad0}"
        )
        lines.append(
            f"Dialogue: 1,{_ts(start)},{_ts(end)},Hook,,0,0,0,,{anim}{text}\n"
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

    # 1. 智能相邻片段融合，生成连续的视频切片与对齐的字幕切片
    video_segments, subtitle_clips = fuse_adjacent_clips(clips, max_gap=1.0)

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
    n = len(video_segments)

    for i, seg_clip in enumerate(video_segments):
        on_progress(35 + int(40 * i / max(n, 1)), f"按连贯段落截取片段 {i + 1}/{n}…")
        seg_file = work / f"seg_{i:03d}.mp4"
        raw_dur = max(0.2, seg_clip.end - seg_clip.start)
        info = probe(seg_clip.path)

        vf_filter = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,"
        )
        if abs(speech_speed - 1.0) > 0.01:
            vf_filter += f"setpts=(PTS-STARTPTS)/{speech_speed:.4f},"
        else:
            vf_filter += "setpts=PTS-STARTPTS,"
        vf_filter += f"fps={fps},format=yuv420p"

        # 组合 Seek 算法（精准裁剪 + 毫秒级对齐）：
        pre_roll = min(3.0, seg_clip.start)
        fast_seek = max(0.0, seg_clip.start - pre_roll)
        fine_seek = seg_clip.start - fast_seek
        seg_dur = max(0.2, raw_dur / speech_speed)

        cmd = [
            settings.ffmpeg_bin,
            "-y",
            "-ss",
            f"{fast_seek:.3f}",
            "-i",
            str(seg_clip.path),
            "-ss",
            f"{fine_seek:.3f}",
            "-t",
            f"{seg_dur:.3f}",
            "-vf",
            vf_filter,
        ]

        if info.has_audio:
            af_filter = ""
            if abs(speech_speed - 1.0) > 0.01:
                af_filter += f"atempo={speech_speed:.4f},"
            af_filter += (
                "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                "asetpts=PTS-STARTPTS"
            )
            # 轻微平滑淡入淡出（25ms），消除切点电流音/破音
            if seg_dur >= 1.0:
                fade_out_st = max(0.1, seg_dur - 0.035)
                af_filter += f",afade=t=in:ss=0:d=0.025,afade=t=out:st={fade_out_st:.3f}:d=0.035"
            cmd += ["-af", af_filter]
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
            subtitle_clips if add_subtitles else [],
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
                    f"[1:a]volume={volume_val:.2f},afade=t=in:st=0:d=1[bg];"
                    "[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]",
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
    output.write_bytes(current.read_bytes())
    on_progress(100, "成片完成")
    return probe(output).duration
