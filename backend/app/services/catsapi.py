from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlparse

import requests

from app.config import settings
from app.services.secrets import get_secret


class CatsApiError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    api_key = get_secret("catsapi_key", settings.catsapi_key)
    if not api_key:
        raise CatsApiError("未配置封面生成密钥，请在右上角设置中填写 GPT Image 2 密钥")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _base() -> str:
    return get_secret("catsapi_base", settings.catsapi_base).rstrip("/")


def _strip_data_uri(value: str) -> str:
    """剥掉 data:image/...;base64, 前缀，保留纯 base64（兼容旧版 referenceImages 约定）。"""
    if value.startswith("data:") and "," in value:
        return value.split(",", 1)[1]
    return value


def create_image_task(
    prompt: str,
    *,
    image_url: str | None = None,
    input_images: list[str] | None = None,
    image_base64: str | None = None,
    size: str | None = None,
    quality: str | None = None,
    num_images: int = 1,
    rewrite_prompt: bool = False,
) -> str:
    params: dict[str, Any] = {
        "rewritePrompt": rewrite_prompt,
        "quality": quality or settings.cover_quality,
        "size": size or settings.cover_size,
    }

    # 确定参考图：CatsAPI gptImage2 图生图模型支持多参考图（主播人像 + 商品实物融合）
    primary_image: str | None = None
    all_images: list[str] = []

    if image_base64:
        data_uri = image_base64 if image_base64.startswith("data:") else f"data:image/jpeg;base64,{image_base64}"
        primary_image = data_uri
        all_images.append(_strip_data_uri(image_base64))

    if input_images:
        for img in input_images:
            clean = _strip_data_uri(img)
            if clean and clean not in all_images:
                all_images.append(clean)
        if not primary_image and input_images:
            first = input_images[0]
            primary_image = first if first.startswith("data:") else f"data:image/jpeg;base64,{first}"

    elif image_url and image_url.startswith("http"):
        primary_image = image_url
        if image_url not in all_images:
            all_images.append(image_url)

    if primary_image:
        params["imagePrompt"] = primary_image
    if len(all_images) > 1:
        params["referenceImages"] = all_images

    payload: dict[str, Any] = {
        "model": settings.catsapi_model,
        "prompt": prompt,
        "task_type": "image",
        "num_images": num_images,
        "params": params,
    }

    # Reference images support
    if primary_image or all_images:
        payload["input_mode"] = "image_to_image"
        payload["input_images"] = all_images

    resp = requests.post(
        f"{_base()}/tasks",
        headers=_headers(),
        json=payload,
        timeout=60,
    )
    if resp.status_code >= 400:
        raise CatsApiError(f"创建任务失败 ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    task_id = data.get("id") or data.get("task_id") or (data.get("data", {}).get("id") if isinstance(data.get("data"), dict) else None)
    if not task_id:
        raise CatsApiError(f"创建任务无 id: {data}")
    return str(task_id)


def get_task(task_id: str) -> dict[str, Any]:
    resp = requests.get(
        f"{_base()}/tasks/{task_id}",
        headers=_headers(),
        timeout=60,
    )
    if resp.status_code >= 400:
        raise CatsApiError(f"查询任务失败 ({resp.status_code}): {resp.text[:300]}")
    return resp.json()


def wait_for_images(
    task_id: str,
    *,
    poll_seconds: float = 3.0,
    timeout_seconds: float = 180.0,
) -> list[str]:
    started = time.time()
    while True:
        info = get_task(task_id)
        status = str(info.get("status") or "").lower()
        if status in ("completed", "succeeded", "success", "done"):
            images = (
                info.get("result_images")
                or info.get("output")
                or info.get("result")
                or info.get("images")
                or (info.get("data", {}).get("images") if isinstance(info.get("data"), dict) else None)
                or (info.get("data", {}).get("result_images") if isinstance(info.get("data"), dict) else None)
                or []
            )
            if isinstance(images, str):
                images = [images]
            if not images:
                raise CatsApiError("任务完成但没有返回图片")
            return [str(u) for u in images]
        if status in ("failed", "error"):
            raise CatsApiError(info.get("error_message") or info.get("error") or "生成失败")
        if time.time() - started > timeout_seconds:
            raise CatsApiError("生成超时，请稍后重试")
        time.sleep(poll_seconds)


def download_image(url: str, dest) -> None:
    resp = requests.get(url, timeout=120)
    if resp.status_code >= 400:
        raise CatsApiError(f"下载封面失败 ({resp.status_code})")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(resp.content)


def guess_ext(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        if path.endswith(ext):
            return ext
    return ".png"


def test_connection(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
) -> dict[str, Any]:
    """校验 CatsAPI 密钥与网关连通性。"""
    key = api_key if api_key is not None and api_key != "" else get_secret("catsapi_key", settings.catsapi_key)
    base = (base_url if base_url is not None and base_url != "" else get_secret("catsapi_base", settings.catsapi_base)).rstrip("/")
    if not key:
        return {"ok": False, "message": "未配置 CatsAPI 密钥，请先填写 Key"}

    started = time.perf_counter()
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.get(
            f"{base}/models",
            headers=headers,
            timeout=10,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code in (401, 403):
            return {"ok": False, "message": f"密钥验证失败 ({resp.status_code}): 密钥无效或已过期"}
        if resp.status_code >= 400:
            return {"ok": False, "message": f"CatsAPI 服务端响应异常 ({resp.status_code})"}
        return {
            "ok": True,
            "message": "CatsAPI 接口通信正常",
            "latency_ms": latency_ms,
        }
    except Exception as e:
        return {"ok": False, "message": f"网络连接失败: {str(e)}"}
