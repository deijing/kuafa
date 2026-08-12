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


def create_image_task(
    prompt: str,
    *,
    size: str | None = None,
    quality: str | None = None,
    num_images: int = 1,
    rewrite_prompt: bool = False,
) -> str:
    payload = {
        "model": settings.catsapi_model,
        "prompt": prompt,
        "task_type": "image",
        "num_images": num_images,
        "params": {
            "rewritePrompt": rewrite_prompt,
            "quality": quality or settings.cover_quality,
            "size": size or settings.cover_size,
        },
    }
    resp = requests.post(
        f"{_base()}/tasks",
        headers=_headers(),
        json=payload,
        timeout=60,
    )
    if resp.status_code >= 400:
        raise CatsApiError(f"创建任务失败 ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    task_id = data.get("id")
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
        status = info.get("status")
        if status == "completed":
            images = info.get("result_images") or []
            if not images:
                raise CatsApiError("任务完成但没有返回图片")
            return [str(u) for u in images]
        if status == "failed":
            raise CatsApiError(info.get("error_message") or "生成失败")
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
            f"{base}/tasks/ping_test",
            headers=headers,
            timeout=10,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code in (401, 403):
            return {"ok": False, "message": f"密钥验证失败 ({resp.status_code}): 密钥无效或已过期"}
        if resp.status_code >= 500:
            return {"ok": False, "message": f"CatsAPI 服务端响应异常 ({resp.status_code})"}
        return {
            "ok": True,
            "message": "CatsAPI 接口通信正常",
            "latency_ms": latency_ms,
        }
    except Exception as e:
        return {"ok": False, "message": f"网络连接失败: {str(e)}"}
