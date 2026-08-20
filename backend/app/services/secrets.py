from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import settings

_SECRETS_PATH = settings.data_dir / "secrets.json"

SECRET_KEYS = (
    "catsapi_key",
    "catsapi_base",
    "openai_api_key",
    "openai_base_url",
    "openai_model",
    "openai_reasoning_effort",
    "transcription_engine",
    "local_whisper_model",
)


def _read_secrets() -> dict[str, Any]:
    if not _SECRETS_PATH.exists():
        return {}
    try:
        data = json.loads(_SECRETS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_secrets(data: dict[str, Any]) -> None:
    _SECRETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _SECRETS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if len(text) <= 8:
        return "*" * len(text)
    return f"{text[:4]}…{text[-4:]}"


def get_secret(key: str, default: str = "") -> str:
    runtime = _read_secrets()
    if key in runtime and runtime[key] not in (None, ""):
        return str(runtime[key]).strip()
    env_map = {
        "catsapi_key": settings.catsapi_key,
        "catsapi_base": settings.catsapi_base,
        "openai_api_key": settings.openai_api_key,
        "openai_base_url": settings.openai_base_url,
        "openai_model": settings.openai_model,
        "openai_reasoning_effort": settings.openai_reasoning_effort,
        "transcription_engine": settings.transcription_engine,
        "local_whisper_model": settings.local_whisper_model,
    }
    return (env_map.get(key) or default or "").strip()


def update_secrets(payload: dict[str, str | None]) -> dict[str, Any]:
    """
    Update secrets. Empty string means clear that key from runtime
    (fall back to .env). None / missing means leave unchanged.
    """
    current = _read_secrets()
    for key in SECRET_KEYS:
        if key not in payload:
            continue
        value = payload[key]
        if value is None:
            continue
        text = str(value).strip()
        if text == "":
            current.pop(key, None)
        else:
            current[key] = text
    _write_secrets(current)
    return current


def secrets_status() -> dict[str, Any]:
    return {
        "catsapi_key_set": bool(get_secret("catsapi_key")),
        "catsapi_key_masked": mask_secret(get_secret("catsapi_key")),
        "catsapi_base": get_secret("catsapi_base", settings.catsapi_base),
        "openai_api_key_set": bool(get_secret("openai_api_key")),
        "openai_api_key_masked": mask_secret(get_secret("openai_api_key")),
        "openai_base_url": get_secret(
            "openai_base_url", settings.openai_base_url or "https://api.deepseek.com"
        ),
        "openai_model": get_secret(
            "openai_model", settings.openai_model or "deepseek-v4-pro"
        ),
        "openai_reasoning_effort": normalize_reasoning_effort(
            get_secret(
                "openai_reasoning_effort",
                settings.openai_reasoning_effort or "medium",
            )
        ),
        "transcription_engine": get_secret(
            "transcription_engine", settings.transcription_engine or "local"
        ),
        "local_whisper_model": get_secret(
            "local_whisper_model", settings.local_whisper_model or "base"
        ),
    }


# OpenAI GPT 官方 reasoning_effort 等级（与 GPT-5.x 一一对应）
OPENAI_REASONING_EFFORTS = ("none", "low", "medium", "high", "xhigh", "max")


def normalize_reasoning_effort(raw: str | None) -> str:
    """
    归一为 OpenAI GPT reasoning_effort：
      none | low | medium | high | xhigh | max

    旧值兼容：off/disabled → none；med → medium
    DeepSeek 网关侧会自行把 low/medium 映射为 high、xhigh 映射为 max。
    文档：
      OpenAI https://developers.openai.com/api/docs/guides/reasoning
      DeepSeek https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
    """
    value = (raw or "medium").strip().lower()
    if value in ("off", "disabled", "false", "0"):
        return "none"
    if value in ("on", "enabled", "true"):
        return "medium"
    if value in ("med",):
        return "medium"
    if value in OPENAI_REASONING_EFFORTS:
        return value
    return "medium"
