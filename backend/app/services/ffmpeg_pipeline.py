from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.config import settings


@dataclass
class MediaInfo:
    path: Path
    duration: float
    width: int | None
    height: int | None
    has_audio: bool


def run_cmd(args: list[str], *, timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def probe(path: Path) -> MediaInfo:
    result = run_cmd(
        [
            settings.ffprobe_bin,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    data = json.loads(result.stdout)
    duration = float(data.get("format", {}).get("duration") or 0)
    width = height = None
    has_audio = False
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and width is None:
            width = int(stream.get("width") or 0) or None
            height = int(stream.get("height") or 0) or None
        if stream.get("codec_type") == "audio":
            has_audio = True
    return MediaInfo(
        path=path,
        duration=duration,
        width=width,
        height=height,
        has_audio=has_audio,
    )


_probe_cache: dict[str, tuple[int, MediaInfo]] = {}


def probe_cached(path: Path) -> MediaInfo:
    """Reuse ffprobe results until the file mtime changes."""
    resolved = path.resolve()
    key = str(resolved)
    mtime_ns = resolved.stat().st_mtime_ns
    hit = _probe_cache.get(key)
    if hit and hit[0] == mtime_ns:
        return hit[1]
    info = probe(resolved)
    _probe_cache[key] = (mtime_ns, info)
    return info


def format_duration(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    m, s = divmod(total, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def generate_thumbnail(src: Path, dest: Path, at_seconds: float = 1.0) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    run_cmd(
        [
            settings.ffmpeg_bin,
            "-y",
            "-ss",
            str(max(0.0, at_seconds)),
            "-i",
            str(src),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(dest),
        ],
        timeout=60,
    )


def build_segment_plan(
    materials: list[MediaInfo],
    *,
    target_total: float,
    segment_len: float,
) -> list[tuple[Path, float, float]]:
    """Pick ~segment_len highlights across materials until target_total."""
    if not materials:
        return []

    ratios = (0.18, 0.42, 0.68, 0.85)
    plan: list[tuple[Path, float, float]] = []
    total = 0.0
    round_idx = 0

    while total < target_total and round_idx < len(ratios) * 3:
        ratio = ratios[round_idx % len(ratios)]
        for info in materials:
            if total >= target_total:
                break
            if info.duration < 1.5:
                continue
            length = min(segment_len, info.duration)
            start = max(0.0, min(info.duration - length, info.duration * ratio))
            end = start + length
            # avoid near-duplicate windows on same file
            overlapping = any(
                p == info.path and abs(s - start) < length * 0.6 for p, s, _ in plan
            )
            if overlapping:
                continue
            plan.append((info.path, start, end))
            total += length
        round_idx += 1

    if not plan:
        # fallback: take beginning of each
        for info in materials:
            length = min(segment_len, info.duration)
            plan.append((info.path, 0.0, length))
    return plan


def render_highlight_reel(
    plan: list[tuple[Path, float, float]],
    output: Path,
    *,
    title: str | None,
    on_progress,
) -> float:
    """Normalize + concat highlight windows into vertical 1080x1920 reel."""
    if not plan:
        raise ValueError("没有可拼接的片段")

    output.parent.mkdir(parents=True, exist_ok=True)
    work = settings.work_dir / output.stem
    work.mkdir(parents=True, exist_ok=True)

    w, h, fps = settings.target_width, settings.target_height, settings.target_fps
    segment_files: list[Path] = []
    n = len(plan)

    for i, (src, start, end) in enumerate(plan):
        on_progress(5 + int(70 * i / max(n, 1)), f"提取高光片段 {i + 1}/{n}…")
        seg = work / f"seg_{i:03d}.mp4"
        duration = max(0.2, end - start)
        info = probe(src)
        # -ss after -i for frame-accurate cuts
        cmd = [
            settings.ffmpeg_bin,
            "-y",
            "-i",
            str(src),
            "-ss",
            str(start),
            "-t",
            str(duration),
        ]
        if info.has_audio:
            cmd += [
                "-vf",
                f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps},format=yuv420p",
                "-af",
                "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo",
            ]
        else:
            cmd += [
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=44100",
                "-vf",
                f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps},format=yuv420p",
                "-shortest",
            ]
        cmd += [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
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
        # Prefer simple -ss/-t over complex trim filters for reliability
        run_cmd(cmd, timeout=300)
        segment_files.append(seg)

    on_progress(78, "拼接成片…")
    concat_list = work / "concat.txt"
    concat_list.write_text(
        "".join(f"file '{p.resolve()}'\n" for p in segment_files),
        encoding="utf-8",
    )

    temp_out = work / "concat.mp4"
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
            str(temp_out),
        ],
        timeout=300,
    )

    if title:
        on_progress(88, "叠加标题包装…")
        # Escape for drawtext
        safe_title = (
            title.replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")
            .replace("%", "\\%")
        )
        draw = (
            f"drawbox=x=0:y=80:w=iw:h=90:color=red@0.85:t=fill,"
            f"drawtext=text='{safe_title}':fontsize=48:fontcolor=white:"
            f"x=(w-text_w)/2:y=100:box=0"
        )
        run_cmd(
            [
                settings.ffmpeg_bin,
                "-y",
                "-i",
                str(temp_out),
                "-vf",
                draw,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-profile:v",
                "high",
                "-c:a",
                "copy",
                "-movflags",
                "+faststart",
                str(output),
            ],
            timeout=300,
        )
    else:
        on_progress(90, "写出最终文件…")
        output.write_bytes(temp_out.read_bytes())

    on_progress(98, "探测输出时长…")
    out_info = probe(output)
    on_progress(100, "成片完成")
    return out_info.duration
