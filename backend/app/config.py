from __future__ import annotations

import json
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_DATA_DIR = _BACKEND_DIR / "data"
_DEFAULT_INPUT = _DATA_DIR / "input"
_RUNTIME_CONFIG = _DATA_DIR / "config.json"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KUAFA_",
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    project_root: Path = Path(__file__).resolve().parents[3]
    data_dir: Path = _DATA_DIR
    default_materials_dir: Path = _DEFAULT_INPUT
    uploads_dir: Path = _DATA_DIR / "uploads"
    thumbs_dir: Path = _DATA_DIR / "thumbs"
    outputs_dir: Path = _DATA_DIR / "outputs"
    work_dir: Path = _DATA_DIR / "work"
    covers_dir: Path = _DATA_DIR / "covers"
    bgm_dir: Path = _DATA_DIR / "bgm"
    models_dir: Path = _DATA_DIR / "models"
    db_path: Path = _DATA_DIR / "kuafa.db"
    runtime_config_path: Path = _RUNTIME_CONFIG

    target_width: int = 1080
    target_height: int = 1920
    target_fps: int = 30
    segment_seconds: float = 5.0
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    subtitle_font: str = ""

    # 字幕转写模式：local（本地 Whisper 离线识别）| bcut（云端必剪 ASR）
    transcription_engine: str = "local"
    local_whisper_model: str = "base"  # tiny | base | small | medium | large-v3

    # CatsAPI · GPT Image 2
    catsapi_key: str = ""
    catsapi_base: str = "https://catsapi.com/api"
    catsapi_model: str = "gptImage2"
    cover_size: str = "1024x1536"
    cover_quality: str = "high"

    # OpenAI-compatible（推荐 DeepSeek V4 Pro 做带货选句主观判断）
    openai_api_key: str = ""
    openai_base_url: str = "https://api.deepseek.com"
    openai_model: str = "deepseek-v4-pro"
    # OpenAI GPT reasoning_effort：none | low | medium | high | xhigh | max
    # DeepSeek 兼容映射：low/medium→high，xhigh→max；none=关闭思考
    openai_reasoning_effort: str = "medium"


settings = Settings()


def _read_runtime() -> dict:
    if not settings.runtime_config_path.exists():
        return {}
    try:
        return json.loads(settings.runtime_config_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_runtime(data: dict) -> None:
    settings.runtime_config_path.parent.mkdir(parents=True, exist_ok=True)
    settings.runtime_config_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_materials_dir() -> Path:
    runtime = _read_runtime()
    custom = runtime.get("materials_dir")
    if custom:
        path = Path(custom).expanduser()
        if path.exists() and path.is_dir():
            return path.resolve()
    path = settings.default_materials_dir
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def set_materials_dir(path_str: str) -> Path:
    path = Path(path_str).expanduser().resolve()
    if not path.exists():
        path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise ValueError("路径必须是文件夹")
    runtime = _read_runtime()
    runtime["materials_dir"] = str(path)
    _write_runtime(runtime)
    return path


def reset_materials_dir() -> Path:
    runtime = _read_runtime()
    runtime.pop("materials_dir", None)
    _write_runtime(runtime)
    path = settings.default_materials_dir
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def ensure_dirs() -> None:
    for path in (
        settings.data_dir,
        settings.default_materials_dir,
        settings.uploads_dir,
        settings.thumbs_dir,
        settings.outputs_dir,
        settings.work_dir,
        settings.covers_dir,
        settings.bgm_dir,
        settings.models_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)
