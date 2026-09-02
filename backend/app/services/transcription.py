from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import requests

from app.config import settings
from app.services.ffmpeg_pipeline import run_cmd
from app.services.secrets import get_secret

logger = logging.getLogger(__name__)


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
    r"(因为|所以|而且|并且|不仅|但是|虽然|然后|如果|比如|关于|这款|采用|含有|具有|主要|就是|这个|那个|大家|想要|喜欢|需要|包含|包括|带一个|给你|给您|支持|非常|特别|十分|格外|极其|正在|准备|建议|推荐|为了|通过|由|随着|只要|如果说|甚至|同时|另外|第一|第二|第三|首先|其次|面料是|重量是|克重是|厚度是|尺码是|颜色是|颜色有|价格是|只要|立省)$"
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
    2. 依据物理明显大停顿（pause gap >= 0.65s 且非未表达完的话头）断句，避免把说话过程中的正常换气截断
    3. 依据中等自然停顿（pause gap >= 0.40s 且 dur >= 1.0s 且非悬空连接词）自然断句
    4. 依据句末收尾词 + 停顿断句
    5. 超出时长上限断句
    短于 min_len 但有实际口播的片段会保留，杜绝吞字丢字。
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
        dur = buf_end - buf_start
        # 有口播就保留：短于 min_len 的应答/语气词/数据单位不再直接扔掉
        if text and (dur >= 0.20 or len(text) >= 2):
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
        # 2. 明显物理停顿（>=0.65s），且末尾不是未说完的悬空连接词/话头
        elif gap >= 0.65 and not _DANGLING_CONNECTIVES.search(buf_text):
            should_split = True
        # 3. 中等停顿（>=0.40s）+ 时长足够（>=1.0s）+ 末尾不是未说完的悬空连接词
        elif gap >= 0.40 and dur >= 1.0 and not _DANGLING_CONNECTIVES.search(buf_text):
            should_split = True
        # 4. 句末语气词/收尾词 + 停顿，且当前句已够成句
        elif gap >= 0.25 and dur >= 0.8 and _PARTICLE_ENDINGS.search(buf_text):
            should_split = True
        # 5. 超出软上限且当前句子可收尾
        elif dur >= max_len and not _DANGLING_CONNECTIVES.search(buf_text):
            should_split = True
        # 6. 绝对硬上限（防止异常长段）
        elif dur >= max_len + 3.0:
            should_split = True

        if should_split:
            # 真停顿必须切断，避免把静音缝进句子；短口播由 flush 保留
            if dur >= min_len or gap >= 0.65:
                flush()
                buf_start = seg.start
                buf_text = seg_text
                buf_end = seg.end
            else:
                buf_text = f"{buf_text}{seg_text}".strip()
                buf_end = max(buf_end, seg.end)
        else:
            # 连续语流：合并到当前句子
            buf_text = f"{buf_text}{seg_text}".strip()
            buf_end = max(buf_end, seg.end)

    flush()
    return sentences


WHISPER_MODELS_CATALOG = [
    {
        "name": "tiny",
        "label": "Tiny (极速/39M)",
        "size_label": "~75 MB",
        "description": "内存占用极小，适合低配电脑，识别准确率一般",
        "recommended": False,
    },
    {
        "name": "base",
        "label": "Base (标准/74M)",
        "size_label": "~145 MB",
        "description": "运行极快，适合日常普通话快速离线测试",
        "recommended": False,
    },
    {
        "name": "small",
        "label": "Small (进阶/244M)",
        "size_label": "~480 MB",
        "description": "词汇量大幅提升，中文带货识别准确率显著提高",
        "recommended": True,
    },
    {
        "name": "medium",
        "label": "Medium (高精/769M)",
        "size_label": "~1.5 GB",
        "description": "高保真语义识别，复杂口播与同音字识别极准",
        "recommended": False,
    },
    {
        "name": "large-v3",
        "label": "Large-v3 (旗舰/1550M)",
        "size_label": "~3.1 GB",
        "description": "Whisper 顶配旗舰模型，顶级中文与中英混说精度",
        "recommended": False,
    },
]

_LOCAL_WHISPER_MODELS: dict[str, Any] = {}
_MODEL_LOCK = threading.Lock()
_DOWNLOAD_LOCK = threading.Lock()
_DOWNLOADING_MODELS: dict[str, dict[str, Any]] = {}


def check_whisper_model_status(size: str) -> dict[str, Any]:
    """检测指定 Whisper 模型在本地是否已下载就绪。"""
    clean_size = (size or "base").strip().lower()
    meta = next((m for m in WHISPER_MODELS_CATALOG if m["name"] == clean_size), None)
    if not meta:
        meta = {
            "name": clean_size,
            "label": clean_size,
            "size_label": "未知",
            "description": "",
            "recommended": False,
        }

    candidates = [
        settings.models_dir / f"models--Systran--faster-whisper-{clean_size}",
        Path.home() / f".cache/huggingface/hub/models--Systran--faster-whisper-{clean_size}",
    ]
    is_downloaded = False
    model_path = None
    for c in candidates:
        if c.exists() and any(f.name.startswith("model.") for f in c.rglob("*")):
            is_downloaded = True
            model_path = str(c)
            break

    download_task = _DOWNLOADING_MODELS.get(clean_size)
    is_downloading = bool(download_task and download_task.get("status") == "downloading")

    return {
        "name": clean_size,
        "label": meta["label"],
        "size_label": meta["size_label"],
        "description": meta["description"],
        "recommended": meta.get("recommended", False),
        "is_downloaded": is_downloaded,
        "model_path": model_path,
        "is_downloading": is_downloading,
        "download_status": download_task.get("status") if download_task else ("completed" if is_downloaded else "idle"),
        "download_message": download_task.get("message") if download_task else ("已下载" if is_downloaded else "未下载"),
        "download_error": download_task.get("error") if download_task else None,
    }


def list_whisper_models() -> list[dict[str, Any]]:
    """列出全部可用本地 Whisper 模型及其本地下载状态。"""
    return [check_whisper_model_status(m["name"]) for m in WHISPER_MODELS_CATALOG]


def start_download_whisper_model(model_size: str) -> dict[str, Any]:
    """触发后台下载指定 Whisper 模型权重文件。"""
    clean_size = (model_size or "small").strip().lower()
    if clean_size not in ("tiny", "base", "small", "medium", "large-v3"):
        clean_size = "small"

    with _DOWNLOAD_LOCK:
        current = _DOWNLOADING_MODELS.get(clean_size)
        if current and current.get("status") == "downloading":
            return current

        # 检查是否已下载
        st = check_whisper_model_status(clean_size)
        if st["is_downloaded"]:
            res = {
                "model": clean_size,
                "status": "completed",
                "progress": 100,
                "message": f"模型 {clean_size} 已就绪",
                "error": None,
            }
            _DOWNLOADING_MODELS[clean_size] = res
            return res

        task = {
            "model": clean_size,
            "status": "downloading",
            "progress": 10,
            "message": f"正在下载 {clean_size} 模型权重文件…",
            "error": None,
        }
        _DOWNLOADING_MODELS[clean_size] = task

    def _worker():
        try:
            logger.info("开始下载 Whisper 模型 [%s] 至 %s ...", clean_size, settings.models_dir)
            from faster_whisper import download_model
            settings.models_dir.mkdir(parents=True, exist_ok=True)
            download_model(clean_size, output_dir=str(settings.models_dir))
            
            with _DOWNLOAD_LOCK:
                _DOWNLOADING_MODELS[clean_size] = {
                    "model": clean_size,
                    "status": "completed",
                    "progress": 100,
                    "message": f"模型 {clean_size} 下载完成！",
                    "error": None,
                }
            logger.info("Whisper 模型 [%s] 下载成功", clean_size)
        except Exception as exc:
            logger.exception("下载 Whisper 模型 [%s] 失败: %s", clean_size, exc)
            with _DOWNLOAD_LOCK:
                _DOWNLOADING_MODELS[clean_size] = {
                    "model": clean_size,
                    "status": "failed",
                    "progress": 0,
                    "message": f"下载失败: {exc}",
                    "error": str(exc),
                }

    threading.Thread(target=_worker, daemon=True).start()
    return task


def get_local_whisper_model(model_size: str = "base") -> Any:
    """获取本地 Whisper 实例（内存缓存，线程安全；若未下载则自动下载）。"""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise TranscriptionError("未安装 faster-whisper 依赖，请在终端执行 pip install faster-whisper") from exc

    clean_size = (model_size or "base").strip().lower()
    if clean_size not in ("tiny", "base", "small", "medium", "large-v3", "large-v2", "large"):
        clean_size = "base"

    with _MODEL_LOCK:
        if clean_size in _LOCAL_WHISPER_MODELS:
            return _LOCAL_WHISPER_MODELS[clean_size]

        models_dir = settings.models_dir
        models_dir.mkdir(parents=True, exist_ok=True)

        logger.info("加载本地 Whisper 模型 [%s] ...", clean_size)
        model = WhisperModel(
            clean_size,
            device="cpu",
            compute_type="int8",
            download_root=str(models_dir),
        )
        _LOCAL_WHISPER_MODELS[clean_size] = model
        logger.info("本地 Whisper 模型 [%s] 加载完成", clean_size)
        return model


def transcribe_local(
    media: Path,
    *,
    model_size: str = "base",
    language: str = "zh",
) -> list[TranscriptSegment]:
    """本地 Whisper 离线转写（基于 faster-whisper CTranslate2 引擎）。"""
    try:
        model = get_local_whisper_model(model_size)
        raw_segments, info = model.transcribe(
            str(media),
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=450,
                speech_pad_ms=300,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        raise TranscriptionError(f"本地 Whisper 转写失败: {exc}") from exc

    segments: list[TranscriptSegment] = []
    for seg in raw_segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        start = max(0.0, float(seg.start))
        end = max(start + 0.15, float(seg.end))
        segments.append(TranscriptSegment(start=start, end=end, text=text))

    return merge_to_sentences(segments, max_len=12.0, min_len=0.8)


def transcribe_bcut(video: Path) -> list[TranscriptSegment]:
    """云端必剪 ASR（社区修复版客户端）。"""
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


def transcribe_material(video: Path) -> list[TranscriptSegment]:
    """转写素材/成片视频用于提取口播标语或文案。"""
    return transcribe_video(video)


def has_transcription_cache(
    video: Path,
    *,
    engine: str | None = None,
    model_size: str | None = None,
) -> bool:
    """检查指定视频是否已存在有效的 ASR 缓存。"""
    try:
        engine = engine or get_secret("transcription_engine", settings.transcription_engine or "bcut")
        model_size = model_size or get_secret("local_whisper_model", settings.local_whisper_model or "base")
        cache_dir = settings.data_dir / "transcripts"
        cache_suffix = f"{engine}.{model_size}" if engine == "local" else engine
        cache_json = cache_dir / f"{video.stem}.{cache_suffix}.json"
        if cache_json.exists():
            raw = json.loads(cache_json.read_text(encoding="utf-8"))
            return (
                isinstance(raw, dict)
                and raw.get("mtime_ns") == video.stat().st_mtime_ns
                and bool(raw.get("segments"))
            )
    except Exception:
        pass
    return False


def transcribe_video(
    video: Path,
    *,
    cache_dir: Path | None = None,
    engine: str | None = None,
    model_size: str | None = None,
) -> list[TranscriptSegment]:
    """
    转写视频口播。
    支持两种模式：
    - bcut: 云端必剪 ASR（极速高精度、中英文/电商短视频优化，推荐）
    - local: 本地 Whisper 离线模型转写（免联网，隐私安全）
    若未指定 engine 则读取全局设置 (get_secret('transcription_engine'))。
    """
    engine = engine or get_secret("transcription_engine", settings.transcription_engine or "bcut")
    model_size = model_size or get_secret("local_whisper_model", settings.local_whisper_model or "base")

    cache_dir = cache_dir or (settings.data_dir / "transcripts")
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    cache_suffix = f"{engine}.{model_size}" if engine == "local" else engine
    cache_json = cache_dir / f"{video.stem}.{cache_suffix}.json"
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
        except (json.JSONDecodeError, TypeError, KeyError):
            pass

    errors: list[str] = []
    segs: list[TranscriptSegment] = []

    if engine == "local":
        try:
            segs = transcribe_local(video, model_size=model_size)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"local_whisper: {exc}")
            # 尝试回退必剪或远程 whisper
            try:
                segs = transcribe_bcut(video)
                errors.append("fallback=bcut")
            except Exception as exc2:  # noqa: BLE001
                errors.append(f"bcut: {exc2}")

    elif engine == "bcut":
        try:
            segs = transcribe_bcut(video)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"bcut: {exc}")
            # 尝试回退本地 whisper
            try:
                segs = transcribe_local(video, model_size=model_size)
                errors.append("fallback=local_whisper")
            except Exception as exc2:  # noqa: BLE001
                errors.append(f"local_whisper: {exc2}")

    elif engine == "whisper":
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


def test_transcription_engine(
    engine: str | None = None,
    model_size: str | None = None,
) -> dict[str, Any]:
    """测试 ASR 转译服务连通性与识别速度。"""
    engine = engine or get_secret("transcription_engine", settings.transcription_engine or "local")
    model_size = model_size or get_secret("local_whisper_model", settings.local_whisper_model or "base")

    t0 = time.time()
    # 准备测试音频
    test_wav = settings.work_dir / "asr_test_sample.wav"
    test_wav.parent.mkdir(parents=True, exist_ok=True)
    if not test_wav.exists():
        # 生成标准测试音频
        import math
        import struct
        import wave

        sample_rate = 16000
        duration = 1.0  # 1 秒轻音
        with wave.open(str(test_wav), "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            for i in range(int(sample_rate * duration)):
                value = int(1000.0 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
                wf.writeframes(struct.pack("<h", value))

    try:
        if engine == "local":
            model = get_local_whisper_model(model_size)
            # 使用本地模型进行推理测试
            segments, info = model.transcribe(str(test_wav), language="zh", vad_filter=False)
            list(segments)  # 执行生成
            latency = int((time.time() - t0) * 1000)
            return {
                "ok": True,
                "engine": "local",
                "model": model_size,
                "message": f"本地 Whisper [{model_size}] 离线模型运行正常",
                "latency_ms": latency,
                "preview_text": "引擎就绪，离线高精度转译可用",
            }
        elif engine == "bcut":
            # 测试必剪接口连通性
            from app.services.bcut_asr_client import BcutASR

            asr = BcutASR()
            asr.set_data(file=test_wav)
            asr.upload()
            task_id = asr.create_task()
            latency = int((time.time() - t0) * 1000)
            return {
                "ok": True,
                "engine": "bcut",
                "model": "cloud-bcut",
                "message": "云端必剪 ASR 服务连接正常",
                "latency_ms": latency,
                "preview_text": f"任务已创建 (TaskID: {task_id[:8]}…)",
            }
        else:
            return {
                "ok": False,
                "engine": engine,
                "message": f"未知转译引擎: {engine}",
            }
    except Exception as exc:  # noqa: BLE001
        latency = int((time.time() - t0) * 1000)
        return {
            "ok": False,
            "engine": engine,
            "model": model_size,
            "message": f"转译测试失败: {exc}",
            "latency_ms": latency,
        }
