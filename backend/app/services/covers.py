from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.models import CoverJobOut, CoverRequest, CoverResult, JobStatus
from app.services import catsapi
from app.services import db as store
from app.services.secrets import get_secret

STYLE_HINTS = {
    "yellow-red": "大字报黄底红字，高对比冲击感，电商爆款封面风格",
    "black-yellow": "黑底金黄大字，高端促销感，强视觉锚点",
    "red-white": "红底白字大标题，紧迫清仓感，直播带货封面",
    "neon-cyber": "赛博朋克霓虹发光大字，炫酷科技感，潮流夜店电竞风格",
    "clean-minimal": "极简莫兰迪配色，柔美质感文字，美妆护肤轻奢高级画风",
    "festive-gold": "国潮喜庆金红配色，金色立体烫金大字，新春促销爆款风格",
}

VARIANT_ANGLES = [
    "主标题居上，画面主体为服饰展示特写",
    "主标题斜切贴纸效果，背景为直播间场景感",
    "主标题居中偏上，突出价格冲击与紧迫感",
    "主副标题分层，画面干净但信息密度高",
]


class CoverJobManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        store.ensure_db()
        self._fail_interrupted()

    def _fail_interrupted(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        for job in store.list_cover_jobs():
            if job.status in (JobStatus.queued, JobStatus.running):
                store.upsert_cover_job(
                    job.model_copy(
                        update={
                            "status": JobStatus.failed,
                            "message": "服务重启，任务已中断",
                            "error": "interrupted_by_restart",
                            "finished_at": now,
                        }
                    )
                )

    def list_jobs(self) -> list[CoverJobOut]:
        with self._lock:
            return store.list_cover_jobs()

    def get(self, job_id: str) -> CoverJobOut | None:
        with self._lock:
            return store.get_cover_job(job_id)

    def _update(self, job_id: str, **kwargs) -> None:
        with self._lock:
            job = store.get_cover_job(job_id)
            if not job:
                return
            store.upsert_cover_job(job.model_copy(update=kwargs))

    def create(self, req: CoverRequest) -> CoverJobOut:
        if not get_secret("catsapi_key", settings.catsapi_key):
            raise ValueError("未配置封面生成密钥，请在右上角设置中填写")
        text = req.headline.strip()
        if not text:
            raise ValueError("请填写大字报文案")

        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        job = CoverJobOut(
            id=job_id,
            status=JobStatus.queued,
            progress=0,
            message="封面任务已排队",
            created_at=now,
            headline=text,
            style=req.style,
            count=req.count,
        )
        with self._lock:
            store.upsert_cover_job(job)

        threading.Thread(
            target=self._run,
            args=(job_id, req),
            daemon=True,
        ).start()
        return job

    def _build_prompt(self, req: CoverRequest, index: int) -> str:
        style = STYLE_HINTS.get(req.style, STYLE_HINTS["yellow-red"])
        angle = VARIANT_ANGLES[index % len(VARIANT_ANGLES)]
        return (
            "生成一张中国电商直播短视频竖版封面图，适合抖音/小红书/视频号。"
            f"必须醒目展示大字报文案：「{req.headline.strip()}」。"
            f"文字样式要求：{style}。"
            f"构图：{angle}。"
            "画面要有真实带货直播感，服装/商品展示清晰，信息密度高，"
            "不要水印，不要英文乱码，不要模糊，竖构图 3:4。"
        )

    def _run(self, job_id: str, req: CoverRequest) -> None:
        try:
            self._update(
                job_id,
                status=JobStatus.running,
                progress=5,
                message="正在调用 GPT Image 2…",
            )
            results: list[CoverResult] = []
            total = max(1, min(req.count, 6))
            out_dir = settings.covers_dir / job_id
            out_dir.mkdir(parents=True, exist_ok=True)

            for i in range(total):
                pct = 10 + int(80 * i / total)
                self._update(
                    job_id,
                    progress=pct,
                    message=f"生成封面 {i + 1}/{total}…",
                )
                prompt = self._build_prompt(req, i)
                task_id = catsapi.create_image_task(prompt)
                urls = catsapi.wait_for_images(task_id)
                url = urls[0]
                ext = catsapi.guess_ext(url)
                filename = f"cover_{i + 1:02d}{ext}"
                dest = out_dir / filename
                catsapi.download_image(url, dest)
                results.append(
                    CoverResult(
                        id=f"{job_id}-{i + 1}",
                        url=f"/api/media/covers/{job_id}/{filename}",
                        remote_url=url,
                    )
                )
                self._update(job_id, results=list(results))

            self._update(
                job_id,
                status=JobStatus.succeeded,
                progress=100,
                message="封面生成完成",
                finished_at=datetime.now(timezone.utc).isoformat(),
                results=results,
            )
        except Exception as exc:  # noqa: BLE001
            self._update(
                job_id,
                status=JobStatus.failed,
                message="封面生成失败",
                error=str(exc),
                finished_at=datetime.now(timezone.utc).isoformat(),
            )


cover_jobs = CoverJobManager()


def _build_svg_cover(text: str, index: int = 0) -> str:
    text_clean = text.strip() or "爆款热销推荐"
    chunk_size = 7
    lines = [text_clean[i : i + chunk_size] for i in range(0, len(text_clean), chunk_size)]
    if not lines:
        lines = ["爆款热销推荐"]

    bg_fill = "#FACC15" if index == 0 else "#09090B"
    stroke_color = "#DC2626" if index == 0 else "#FACC15"
    title_color = "#DC2626" if index == 0 else "#FACC15"
    badge_bg = "#DC2626" if index == 0 else "#EAB308"
    badge_text = "#FFFFFF" if index == 0 else "#09090B"
    badge_label = "🔥 爆款推荐" if index == 0 else "⚡ 镇店之宝"

    tspan_list = []
    y_start = 720 - (len(lines[:3]) - 1) * 70
    for idx, line in enumerate(lines[:3]):
        y_pos = y_start + idx * 140
        tspan_list.append(
            f'<text x="512" y="{y_pos}" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="105" font-weight="900" text-anchor="middle" fill="{title_color}">{line}</text>'
        )

    tspan_str = "\n".join(tspan_list)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536" width="1024" height="1536">
  <rect width="1024" height="1536" fill="{bg_fill}"/>
  <rect x="96" y="140" width="832" height="180" rx="36" fill="{badge_bg}"/>
  <text x="512" y="255" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="76" font-weight="900" text-anchor="middle" fill="{badge_text}">{badge_label}</text>
  <rect x="64" y="400" width="896" height="760" rx="48" fill="#FFFFFF" fill-opacity="0.94" stroke="{stroke_color}" stroke-width="12"/>
  {tspan_str}
  <rect x="212" y="1250" width="600" height="130" rx="65" fill="{badge_bg}"/>
  <text x="512" y="1330" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="52" font-weight="800" text-anchor="middle" fill="{badge_text}">点击看直播 · 领专属优惠</text>
</svg>"""


def generate_video_covers(
    headline: str,
    job_id: str,
    *,
    count: int = 2,
    style: str = "yellow-red",
) -> list[CoverResult]:
    """
    基于视频内容与爆款卖点文案，为一键出片视频自动生成配套封面大字报。
    - 如果配置了 CatsAPI 密钥：调用 GPT Image 2 生成多张 AI 艺术封面
    - 如果未配置 / 接口限制：生成高清大字报封面，确保视频 100% 含有封面产出成果！
    """
    text = (headline or "").strip() or "爆款推荐 独家折扣"
    results: list[CoverResult] = []
    out_dir = settings.covers_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    api_key = get_secret("catsapi_key", settings.catsapi_key)
    if api_key:
        try:
            for i in range(min(count, 4)):
                style_prompt = STYLE_HINTS.get(style, STYLE_HINTS["yellow-red"])
                angle = VARIANT_ANGLES[i % len(VARIANT_ANGLES)]
                prompt = (
                    "生成一张中国电商直播短视频竖版封面图，适合抖音/小红书/视频号。"
                    f"必须醒目展示大字报文案：「{text}」。"
                    f"文字样式要求：{style_prompt}。"
                    f"构图：{angle}。"
                    "画面要有真实带货直播感，服装/商品展示清晰，信息密度高，竖构图 3:4。"
                )
                task_id = catsapi.create_image_task(prompt)
                urls = catsapi.wait_for_images(task_id, timeout_seconds=90)
                if urls:
                    url = urls[0]
                    ext = catsapi.guess_ext(url)
                    filename = f"cover_{i + 1:02d}{ext}"
                    dest = out_dir / filename
                    catsapi.download_image(url, dest)
                    results.append(
                        CoverResult(
                            id=f"{job_id}-{i + 1}",
                            url=f"/api/media/covers/{job_id}/{filename}",
                            remote_url=url,
                        )
                    )
        except Exception:
            pass

    # 回退/补全保底矢量大字报封面
    if len(results) < count:
        start_idx = len(results)
        for i in range(start_idx, count):
            filename = f"cover_{i + 1:02d}.svg"
            dest = out_dir / filename
            svg_content = _build_svg_cover(text, index=i)
            dest.write_text(svg_content, encoding="utf-8")
            results.append(
                CoverResult(
                    id=f"{job_id}-{i + 1}",
                    url=f"/api/media/covers/{job_id}/{filename}",
                    remote_url=None,
                )
            )

    return results
