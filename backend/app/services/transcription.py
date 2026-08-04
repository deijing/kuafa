from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import requests

from app.config import settings
from app.services.ffmpeg_pipeline import run_cmd
from app.services.secrets import get_secret


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


class TranscriptionError(RuntimeError):
    pass


def extract_audio_wav(video: Path, wav_out: Path) -> Path:
    wav_out.parent.mkdir(parents=True, exist_ok=True)
    run_cmd(
        [
            settings.ffmpeg_bin,
            "-y",
            "-i",
            str(video),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(wav_out),
        ],
        timeout=180,
    )
    return wav_out


_SENTENCE_END = re.compile(r"(?<=[。！？!?；;])")


def merge_to_sentences(
    segments: list[TranscriptSegment],
    *,
    max_len: float = 8.0,
    min_len: float = 0.8,
) -> list[TranscriptSegment]:
    if not segments:
        return []

    sentences: list[TranscriptSegment] = []
    buf_text = ""
    buf_start = segments[0].start
    buf_end = segments[0].end

    def flush() -> None:
        nonlocal buf_text, buf_start, buf_end
        text = buf_text.strip()
        if text and buf_end - buf_start >= min_len:
            sentences.append(
                TranscriptSegment(start=buf_start, end=buf_end, text=text)
            )
        buf_text = ""

    for seg in segments:
        if not buf_text:
            buf_start = seg.start
        buf_text = f"{buf_text}{seg.text}".strip()
        buf_end = seg.end
        if _SENTENCE_END.search(buf_text) or (buf_end - buf_start) >= max_len:
            flush()
            buf_start = seg.end
    flush()
    return sentences


def transcribe_bcut(video: Path) -> list[TranscriptSegment]:
    """主路径：必剪 ASR（社区修复版客户端）。"""
    from app.services.bcut_asr_client import recognize_media

    try:
        data = recognize_media(video, interval=2.0)
    except Exception as exc:  # noqa: BLE001
        raise TranscriptionError(f"必剪 ASR 失败: {exc}") from exc

    segments: list[TranscriptSegment] = []
    for utt in data.utterances:
        text = (utt.transcript or "").strip()
        if not text:
            continue
        # 必剪时间为毫秒
        start = max(0.0, utt.start_time / 1000.0)
        end = max(start + 0.15, utt.end_time / 1000.0)
        segments.append(TranscriptSegment(start=start, end=end, text=text))

    # 必剪有时无标点：按时长再合并，避免碎句
    return merge_to_sentences(segments, max_len=6.0, min_len=0.6)


def _openai_headers() -> dict[str, str]:
    api_key = get_secret("openai_api_key", settings.openai_api_key)
    if not api_key:
        raise TranscriptionError("未配置 OpenAI 兼容密钥")
    return {"Authorization": f"Bearer {api_key}"}


def _openai_base() -> str:
    return get_secret(
        "openai_base_url", settings.openai_base_url or "https://api.openai.com/v1"
    ).rstrip("/")


def transcribe_whisper(wav: Path, *, language: str = "zh") -> list[TranscriptSegment]:
    url = f"{_openai_base()}/audio/transcriptions"
    with wav.open("rb") as f:
        resp = requests.post(
            url,
            headers=_openai_headers(),
            files={"file": (wav.name, f, "audio/wav")},
            data={
                "model": "whisper-1",
                "response_format": "verbose_json",
                "language": language,
            },
            timeout=600,
        )
    if resp.status_code >= 400:
        raise TranscriptionError(
            f"Whisper 转写失败 ({resp.status_code}): {resp.text[:400]}"
        )
    data = resp.json()
    segments: list[TranscriptSegment] = []
    for seg in data.get("segments") or []:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start") or 0)
        end = float(seg.get("end") or start)
        if end - start < 0.15:
            continue
        segments.append(TranscriptSegment(start=start, end=end, text=text))
    if not segments and data.get("text"):
        segments.append(
            TranscriptSegment(start=0.0, end=0.0, text=str(data["text"]).strip())
        )
    return merge_to_sentences(segments)


def transcribe_video(
    video: Path,
    *,
    cache_dir: Path | None = None,
    engine: str = "bcut",
) -> list[TranscriptSegment]:
    """
    转写视频口播。
    默认 engine=bcut（必剪，免费、中文友好）；失败可回退 whisper。
    """
    cache_dir = cache_dir or (settings.data_dir / "transcripts")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_json = cache_dir / f"{video.stem}.{engine}.json"
    mtime_ns = video.stat().st_mtime_ns
    if cache_json.exists():
        try:
            raw = json.loads(cache_json.read_text(encoding="utf-8"))
            if (
                isinstance(raw, dict)
                and raw.get("mtime_ns") == mtime_ns
                and isinstance(raw.get("segments"), list)
            ):
                return [TranscriptSegment(**item) for item in raw["segments"]]
            # 兼容旧缓存（无 mtime）：丢弃，强制重转写
            if isinstance(raw, list):
                pass
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    errors: list[str] = []
    segs: list[TranscriptSegment] = []

    if engine in ("bcut", "auto"):
        try:
            segs = transcribe_bcut(video)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"bcut: {exc}")
            if engine == "bcut":
                # auto 才回退；纯 bcut 也尝试 whisper 以免整条链路挂死
                try:
                    wav = cache_dir / f"{video.stem}.wav"
                    extract_audio_wav(video, wav)
                    segs = transcribe_whisper(wav)
                    errors.append("fallback=whisper")
                except Exception as exc2:  # noqa: BLE001
                    raise TranscriptionError(
                        "；".join(errors + [f"whisper: {exc2}"])
                    ) from exc2

    if engine == "whisper" and not segs:
        wav = cache_dir / f"{video.stem}.wav"
        extract_audio_wav(video, wav)
        segs = transcribe_whisper(wav)

    if not segs:
        raise TranscriptionError("；".join(errors) or "转写结果为空")

    cache_json.write_text(
        json.dumps(
            {
                "mtime_ns": mtime_ns,
                "segments": [asdict(s) for s in segs],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return segs
