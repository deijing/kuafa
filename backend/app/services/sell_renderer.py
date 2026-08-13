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


def ensure_default_bgm() -> Path:
    """Create a simple looping bed if no user BGM exists."""
    bgm_dir = settings.bgm_dir
    bgm_dir.mkdir(parents=True, exist_ok=True)
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

    out = bgm_dir / "default_bed.mp3"
    if out.exists():
        return out
    # lightweight synthetic bed (not a song, just energy under voice)
    run_cmd(
        [
            settings.ffmpeg_bin,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=196:duration=90",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=247:duration=90",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=294:duration=90",
            "-filter_complex",
            "[0:a][1:a][2:a]amix=inputs=3:duration=longest:dropout_transition=0,volume=0.18",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "6",
            str(out),
        ],
        timeout=120,
    )
    return out


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
    优先在标点断开，再按字数硬切。
    """
    text = _ass_escape(re.sub(r"\s+", "", text.strip()))
    if not text:
        return []

    parts = re.split(r"(?<=[，。！？；、,.!?;:])", text)
    chunks: list[str] = []
    soft = set("的了呢啊嘛吧呀哦")

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
    # WrapStyle:2 = 不自动换行；字幕内容本身也不含 \N
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
            # 最短可读时长，末段吃掉余量避免时间缝隙
            if i == len(chunks) - 1:
                end = clip_end
            else:
                end = min(clip_end, t + max(0.28 / speed, share))
            if end <= t:
                end = min(clip_end, t + 0.28 / speed)
            # 轻微淡入，单行展示
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
        # 缩放弹入 + 淡入淡出（神奇大字动效）
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
    on_progress,
) -> float:
    if not clips:
        raise ValueError("没有可拼接的口播句子片段")

    output.parent.mkdir(parents=True, exist_ok=True)
    work = settings.work_dir / output.stem
    work.mkdir(parents=True, exist_ok=True)

    w, h, fps = settings.target_width, settings.target_height, settings.target_fps
    segment_files: list[Path] = []
    n = len(clips)

    for i, clip in enumerate(clips):
        # 进度接在 ASR(~32%) 之后，保持单调：35→75
        on_progress(35 + int(40 * i / max(n, 1)), f"按句切割片段 {i + 1}/{n}…")
        seg = work / f"seg_{i:03d}.mp4"
        raw_dur = max(0.2, clip.end - clip.start)
        info = probe(clip.path)
        
        vf_filter = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,"
        )
        if abs(speech_speed - 1.0) > 0.01:
            vf_filter += f"setpts=PTS/{speech_speed:.4f},"
        vf_filter += f"fps={fps},format=yuv420p"

        # -ss 放在 -i 之后：按 ASR 时间戳精确切，避免关键帧近似切到半个字
        cmd = [
            settings.ffmpeg_bin,
            "-y",
            "-i",
            str(clip.path),
            "-ss",
            f"{clip.start:.3f}",
            "-t",
            f"{raw_dur:.3f}",
            "-vf",
            vf_filter,
        ]
        if info.has_audio:
            af_filter = ""
            if abs(speech_speed - 1.0) > 0.01:
                af_filter += f"atempo={speech_speed:.4f},"
            af_filter += "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo"
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
            "veryfast",
            "-crf",
            "22",
            "-profile:v",
            "high",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(seg),
        ]
        run_cmd(cmd, timeout=300)
        segment_files.append(seg)

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
            clips if add_subtitles else [],
            work / "subs.ass",
            magic_cues=magic_cues,
            speech_speed=speech_speed,
            subtitle_position=subtitle_position,
        )
        # 在 work 目录内用相对文件名跑 ffmpeg，规避 subtitles 滤镜对
        # 绝对路径里的特殊字符（空格/单引号/中文/盘符）转义出错的问题。
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
                "veryfast",
                "-crf",
                "22",
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
        on_progress(88, "混入背景音乐…")
        bgm_path = None
        if bgm_file:
            target_bgm = settings.bgm_dir / bgm_file
            if target_bgm.exists():
                bgm_path = target_bgm
        if not bgm_path:
            bgm_path = ensure_default_bgm()

        volume_val = max(0.0, min(1.0, bgm_volume / 100.0))
        mixed = work / "mixed.mp4"
        # Loop BGM, apply user-specified volume, keep voice dominant
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
