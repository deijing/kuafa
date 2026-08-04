from __future__ import annotations

import time
from typing import Any

import requests

from app.config import settings
from app.services.secrets import get_secret, normalize_reasoning_effort


class OpenAICompatError(RuntimeError):
    pass


def has_openai_key() -> bool:
    return bool(get_secret("openai_api_key", settings.openai_api_key))


def _normalize_base(base: str) -> str:
    base = (base or "").strip().rstrip("/")
    if not base:
        base = settings.openai_base_url or "https://api.deepseek.com"
    return base.rstrip("/")


def resolve_credentials(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    reasoning_effort: str | None = None,
) -> tuple[str, str, str, str]:
    """优先用入参（表单未保存值），否则回退已保存密钥。返回 key, base, model, effort。"""
    key = (api_key or "").strip() or get_secret(
        "openai_api_key", settings.openai_api_key
    )
    if not key:
        raise OpenAICompatError("未配置 API Key，请填写后重试")

    base = _normalize_base(
        (base_url or "").strip()
        or get_secret(
            "openai_base_url", settings.openai_base_url or "https://api.deepseek.com"
        )
    )
    use_model = (model or "").strip() or get_secret(
        "openai_model", settings.openai_model or "deepseek-v4-pro"
    )
    effort = normalize_reasoning_effort(
        (reasoning_effort or "").strip()
        or get_secret(
            "openai_reasoning_effort",
            settings.openai_reasoning_effort or "high",
        )
    )
    return key, base, use_model, effort


def _extract_message_content(data: dict[str, Any]) -> str:
    """解析 OpenAI Chat Completions Response 格式。"""
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenAICompatError(f"响应格式异常（非 OpenAI Response）: {data}") from exc

    content = message.get("content")
    if content is None:
        content = message.get("reasoning_content")
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
        content = "".join(parts)
    if content is None:
        raise OpenAICompatError(f"响应缺少 message.content: {data}")
    return str(content).strip()


def _build_chat_body(
    *,
    model: str,
    messages: list[dict[str, str]],
    temperature: float,
    reasoning_effort: str,
) -> dict[str, Any]:
    """
    OpenAI GPT reasoning_effort 与 DeepSeek 思考模式（OpenAI 兼容格式）：

      reasoning_effort: none | low | medium | high | xhigh | max
      thinking: { type: enabled|disabled }  # DeepSeek；none 时 disabled

    OpenAI：https://developers.openai.com/api/docs/guides/reasoning
    DeepSeek：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
      （DeepSeek 会把 low/medium→high、xhigh→max）
    """
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }
    effort = normalize_reasoning_effort(reasoning_effort)
    if effort == "none":
        body["thinking"] = {"type": "disabled"}
        body["reasoning_effort"] = "none"
        body["temperature"] = temperature
    else:
        body["thinking"] = {"type": "enabled"}
        # 原样传 OpenAI 等级，与 GPT 一一对应；DeepSeek 端自动映射
        body["reasoning_effort"] = effort
    return body


def chat_completions(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = 0.7,
    api_key: str | None = None,
    base_url: str | None = None,
    reasoning_effort: str | None = None,
) -> str:
    """OpenAI 兼容 Chat Completions（Response: choices[0].message.content）。"""
    key, base, use_model, effort = resolve_credentials(
        api_key=api_key,
        base_url=base_url,
        model=model,
        reasoning_effort=reasoning_effort,
    )

    resp = requests.post(
        f"{base}/chat/completions",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json=_build_chat_body(
            model=use_model,
            messages=messages,
            temperature=temperature,
            reasoning_effort=effort,
        ),
        timeout=180,
    )
    if resp.status_code >= 400:
        raise OpenAICompatError(f"调用失败 ({resp.status_code}): {resp.text[:300]}")

    try:
        data: dict[str, Any] = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise OpenAICompatError(f"响应不是 JSON: {resp.text[:200]}") from exc

    return _extract_message_content(data)


def list_models(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
) -> list[str]:
    """GET /models — OpenAI Models Response: { data: [{ id }] }。"""
    key, base, _, _ = resolve_credentials(
        api_key=api_key, base_url=base_url, model="x"
    )

    resp = requests.get(
        f"{base}/models",
        headers={"Authorization": f"Bearer {key}"},
        timeout=60,
    )
    if resp.status_code >= 400:
        raise OpenAICompatError(f"获取模型失败 ({resp.status_code}): {resp.text[:300]}")

    try:
        data: dict[str, Any] = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise OpenAICompatError(f"模型列表不是 JSON: {resp.text[:200]}") from exc

    items = data.get("data")
    if not isinstance(items, list):
        raise OpenAICompatError(f"模型列表格式异常（期望 data[]）: {data}")

    ids: list[str] = []
    for item in items:
        if isinstance(item, dict) and item.get("id"):
            ids.append(str(item["id"]))
        elif isinstance(item, str):
            ids.append(item)
    seen: set[str] = set()
    out: list[str] = []
    for mid in ids:
        if mid not in seen:
            seen.add(mid)
            out.append(mid)
    return out


def test_connection(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    """发一条极简 chat/completions，校验 OpenAI Response 是否正常。"""
    key, base, use_model, effort = resolve_credentials(
        api_key=api_key,
        base_url=base_url,
        model=model,
        reasoning_effort=reasoning_effort,
    )
    started = time.perf_counter()
    try:
        content = chat_completions(
            [{"role": "user", "content": "回复两个字：正常"}],
            model=use_model,
            api_key=key,
            base_url=base,
            reasoning_effort=effort,
            temperature=0,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        effort_label = {
            "none": "none（关闭）",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "xhigh",
            "max": "max",
        }.get(effort, effort)
        preview = (content or "")[:80]
        return {
            "ok": True,
            "message": f"连接正常 · {use_model} · effort={effort_label}"
            + (f"：{preview}" if preview else ""),
            "model": use_model,
            "latency_ms": latency_ms,
            "reply_preview": preview or None,
            "reasoning_effort": effort,
        }
    except OpenAICompatError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "message": str(exc),
            "model": use_model,
            "latency_ms": latency_ms,
            "reply_preview": None,
            "reasoning_effort": effort,
        }
