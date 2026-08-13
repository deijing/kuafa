import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


def check_subtitles_filter(ffmpeg_path: str) -> bool:
    """检查给定的 ffmpeg 可执行文件是否支持 subtitles / ass (libass) 滤镜。"""
    if not ffmpeg_path or not os.path.isfile(ffmpeg_path):
        return False
    try:
        res = subprocess.run(
            [ffmpeg_path, "-filters"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        output = (res.stdout or "") + (res.stderr or "")
        return "subtitles" in output or "ass" in output
    except Exception:
        return False


def resolve_ffmpeg_bins() -> tuple[str, str, bool]:
    """
    自动查找最优质的 ffmpeg / ffprobe 可执行文件及其字幕滤镜 (libass) 支持情况。
    支持自动探测 /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg 等路径。
    返回 (ffmpeg_bin, ffprobe_bin, has_subtitles_filter)
    """
    env_ffmpeg = os.environ.get("KUAFA_FFMPEG_BIN")
    env_ffprobe = os.environ.get("KUAFA_FFPROBE_BIN")

    candidates = [
        env_ffmpeg,
        "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
        "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        shutil.which("ffmpeg"),
    ]
    existing_candidates = [c for c in candidates if c and os.path.isfile(c)]

    best_ffmpeg = None
    has_subtitles = False

    # 1. 优先寻找内置 libass (subtitles 滤镜) 的 FFmpeg
    for c in existing_candidates:
        if check_subtitles_filter(c):
            best_ffmpeg = c
            has_subtitles = True
            break

    # 2. 回退到第一个可用的 ffmpeg
    if not best_ffmpeg and existing_candidates:
        best_ffmpeg = existing_candidates[0]

    if not best_ffmpeg:
        best_ffmpeg = "ffmpeg"

    # 对应查找 ffprobe
    best_ffprobe = env_ffprobe
    if not best_ffprobe and best_ffmpeg != "ffmpeg":
        probe_sibling = str(Path(best_ffmpeg).parent / "ffprobe")
        if os.path.isfile(probe_sibling):
            best_ffprobe = probe_sibling

    if not best_ffprobe:
        candidates_probe = [
            "/opt/homebrew/opt/ffmpeg-full/bin/ffprobe",
            "/usr/local/opt/ffmpeg-full/bin/ffprobe",
            "/opt/homebrew/bin/ffprobe",
            "/usr/local/bin/ffprobe",
            shutil.which("ffprobe"),
        ]
        for p in candidates_probe:
            if p and os.path.isfile(p):
                best_ffprobe = p
                break

    if not best_ffprobe:
        best_ffprobe = "ffprobe"

    return best_ffmpeg, best_ffprobe, has_subtitles


def resolve_subtitle_font() -> str:
    """
    解析可供 libass 读取的中文字体名称。
    解决 macOS 苹方 (PingFang SC) 位于私有字库 PingFangUI.ttc 无法被 libass 解析的问题。
    """
    env_font = os.environ.get("KUAFA_SUBTITLE_FONT") or getattr(settings, "subtitle_font", None)
    if env_font and env_font.strip():
        return env_font.strip()

    system = sys.platform
    if system == "darwin":
        # macOS 首选 Hiragino Sans GB (冬青黑体)，避免 PingFangUI.ttc 报 Error opening font
        return "Hiragino Sans GB"
    elif system == "win32":
        return "Microsoft YaHei"
    else:
        return "Noto Sans CJK SC"


_FFMPEG_STATUS_CHECKED = False
_HAS_SUBTITLES_FILTER = True


def ensure_ffmpeg_configured() -> tuple[str, str, bool]:
    global _FFMPEG_STATUS_CHECKED, _HAS_SUBTITLES_FILTER
    ffmpeg_bin, ffprobe_bin, has_sub = resolve_ffmpeg_bins()
    settings.ffmpeg_bin = ffmpeg_bin
    settings.ffprobe_bin = ffprobe_bin
    _HAS_SUBTITLES_FILTER = has_sub

    if not _FFMPEG_STATUS_CHECKED:
        _FFMPEG_STATUS_CHECKED = True
        logger.info("已检测配置 FFmpeg: %s, FFprobe: %s (字幕滤镜支持: %s)", ffmpeg_bin, ffprobe_bin, has_sub)
        if not has_sub:
            logger.warning(
                "⚠️ 警告: 当前 FFmpeg (%s) 未编译 libass (缺少 subtitles 滤镜)！"
                "烧录字幕时将报错。推荐安装 ffmpeg-full: brew install ffmpeg-full 并配置 KUAFA_FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
                ffmpeg_bin,
            )

    return ffmpeg_bin, ffprobe_bin, has_sub


def get_ffmpeg_status() -> dict[str, object]:
    ffmpeg_bin, ffprobe_bin, has_sub = ensure_ffmpeg_configured()
    font_name = resolve_subtitle_font()
    return {
        "ffmpeg_bin": ffmpeg_bin,
        "ffprobe_bin": ffprobe_bin,
        "has_subtitles_filter": has_sub,
        "subtitle_font": font_name,
    }


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
_probe_cache_lock = threading.Lock()


def probe_cached(path: Path) -> MediaInfo:
    """Reuse ffprobe results until the file mtime changes."""
    resolved = path.resolve()
    key = str(resolved)
    mtime_ns = resolved.stat().st_mtime_ns
    with _probe_cache_lock:
        hit = _probe_cache.get(key)
        if hit and hit[0] == mtime_ns:
            return hit[1]
    info = probe(resolved)
    with _probe_cache_lock:
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
            .replace(",", "\\,")
            .replace(";", "\\;")
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
