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


_SENTENCE_END = re.compile(r"[。！？!?；;\n]")
_CLAUSE_END = re.compile(r"[，,、]")

# 中文口播常见完整句末语气词/收尾词（结合停顿可作为自然断句依据）
_PARTICLE_ENDINGS = re.compile(
    r"(啦|吧|呢|啊|哦|嘛|哈|呀|么|了|的|看下|看一下|带回家|带走|拍下|显瘦|好看|合适|舒服|百搭|闭眼入|划算|优惠|福利|安排|到位|解决|可以|行|对|没错)$"
)

# 明显属于句首/连接词/未表达完的话头，绝不能在此处切断
_DANGLING_CONNECTIVES = re.compile(
    r"(因为|所以|而且|并且|不仅|但是|虽然|然后|如果|比如|关于|这款|采用|含有|具有|主要|就是|这个|那个|大家|想要|喜欢|需要|包含|包括|带一个|给你|给您|支持|非常|特别|十分|格外|极其|正在|准备|建议|推荐|为了|通过|由|随着|只要|如果说|甚至|同时|另外|第一|第二|第三|首先|其次)$"
)


def merge_to_sentences(
    segments: list[TranscriptSegment],
    *,
    max_len: float = 12.0,
    min_len: float = 0.8,
) -> list[TranscriptSegment]:
    """
    智能合并 ASR 细碎片段为完整自然的表达句子：
    1. 依据标点符号（。！？!?；;）硬断句
    2. 依据说话自然停顿（pause gap >= 0.55s）且语义非残缺时自然断句
    3. 依据句末收尾词 + 中等停顿断句
    4. 严格避开「而且/因为/采用/这款」等句中连接词断句，防止话只说一半被切掉
    """
    if not segments:
        return []

    sorted_segs = sorted(segments, key=lambda s: s.start)
    sentences: list[TranscriptSegment] = []

    buf_text = ""
    buf_start = sorted_segs[0].start
    buf_end = sorted_segs[0].end

    def flush() -> None:
        nonlocal buf_text, buf_start, buf_end
        text = buf_text.strip()
        if text and (buf_end - buf_start) >= min_len:
            sentences.append(
                TranscriptSegment(start=buf_start, end=buf_end, text=text)
            )
        buf_text = ""

    for seg in sorted_segs:
        seg_text = seg.text.strip()
        if not seg_text:
            continue

        if not buf_text:
            buf_start = seg.start
            buf_text = seg_text
            buf_end = seg.end
            continue

        gap = seg.start - buf_end
        dur = buf_end - buf_start

        should_split = False

        # 1. 缓冲区末尾已有明确结束标点
        if _SENTENCE_END.search(buf_text):
            should_split = True
        # 2. 明显停顿（>=0.55s）+ 时长足够 + 末尾不是未说完的连接词
        elif gap >= 0.55 and dur >= 2.0 and not _DANGLING_CONNECTIVES.search(buf_text):
            should_split = True
        # 3. 中等停顿（>=0.35s）+ 句末语气词 + 时长足够
        elif gap >= 0.35 and dur >= 2.8 and _PARTICLE_ENDINGS.search(buf_text):
            should_split = True
        # 4. 超出软上限且当前句子可收尾
        elif dur >= max_len and not _DANGLING_CONNECTIVES.search(buf_text):
            should_split = True
        # 5. 绝对硬上限（防止异常长段）
        elif dur >= max_len + 4.0:
            should_split = True

        if should_split:
            flush()
            buf_start = seg.start
            buf_text = seg_text
            buf_end = seg.end
        else:
            # 连续语流：合并到当前句子
            buf_text = f"{buf_text}{seg_text}".strip()
            buf_end = max(buf_end, seg.end)

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

    # 按自然停顿和完整语义合并，避免碎句和断句截半
    return merge_to_sentences(segments, max_len=10.0, min_len=0.8)


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
