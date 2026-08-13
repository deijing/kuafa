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
    "yellow-red": "小红书爆款海报风格，高明度黄红撞色大字，强吸引力商品美化摄影",
    "black-yellow": "极简黑金高级感海报，精致光影摄影，极致商品质感与高级调性",
    "red-white": "醒目红白吸引力大字，清新清爽通透光感，高颜值高转化封面海报",
    "neon-cyber": "立体质感潮流文字，高级景深光影，强视觉冲击力与现代美学",
    "clean-minimal": "轻奢莫兰迪极简风，柔光写真摄影，大牌杂志质感封面",
    "festive-gold": "国潮奢华金红配色，高级立体光效，精美礼盒爆款视觉吸引",
}

VARIANT_ANGLES = [
    "主标题置顶醒目布局，画面主体为商品/人物高光特写美化，强化柔光与摄影画质",
    "主标题贴纸造型，结合高颜值构图与微景深背景，提升画面吸引力与精致感",
    "主副标题层次分明，画面通透精致，突出商品核心美感与高颜值细节特写",
    "极简杂志封面构图，高级柔光摄影，干净利落的设计感与强吸引力展示",
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
            "基于原图拍摄素材美化增质，生成一张高颜值、高吸引力的小红书/抖音短视频竖版精美封面海报。"
            f"必须醒目展示大字报主题文案：「{req.headline.strip()}」。"
            f"文字样式与视觉要求：{style}。"
            f"构图样式：{angle}。"
            "画面要求：纯净高质感摄影、光影通透、无杂乱直播间视觉、无低质噪声、强视觉吸引力，不要水印，不要英文乱码，竖构图 3:4。"
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


import base64
from pathlib import Path
from app.services.ffmpeg_pipeline import run_cmd


def extract_video_frame(video_path: Path, timestamp_sec: float, out_jpeg: Path) -> bool:
    try:
        run_cmd([
            settings.ffmpeg_bin,
            "-y",
            "-ss", str(timestamp_sec),
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "2",
            str(out_jpeg),
        ], timeout=15)
        return out_jpeg.exists() and out_jpeg.stat().st_size > 0
    except Exception:
        return False


def _build_svg_cover(
    text: str,
    index: int = 0,
    frame_jpeg_path: Path | None = None,
    group_name: str | None = None,
    style: str = "yellow-red",
) -> str:
    text_clean = text.strip() or "爆款热销推荐"
    chunk_size = 7
    lines = [text_clean[i : i + chunk_size] for i in range(0, len(text_clean), chunk_size)]
    if not lines:
        lines = ["爆款热销推荐"]

    img_bg_element = ""
    if frame_jpeg_path and frame_jpeg_path.exists():
        try:
            b64_data = base64.b64encode(frame_jpeg_path.read_bytes()).decode("utf-8")
            img_bg_element = f'<image href="data:image/jpeg;base64,{b64_data}" width="1024" height="1536" preserveAspectRatio="xMidYMid slice"/>'
        except Exception:
            img_bg_element = ""

    if style == "black-yellow":
        bg_fill = "#09090B"
        stroke_color = "#EAB308"
        title_color = "#FACC15"
        badge_bg = "#EAB308"
        badge_text = "#09090B"
    elif style == "red-white":
        bg_fill = "#DC2626"
        stroke_color = "#FFFFFF"
        title_color = "#FFFFFF"
        badge_bg = "#FFFFFF"
        badge_text = "#DC2626"
    elif style == "neon-cyber":
        bg_fill = "#0F172A"
        stroke_color = "#06B6D4"
        title_color = "#38BDF8"
        badge_bg = "#EC4899"
        badge_text = "#FFFFFF"
    else:  # yellow-red default
        bg_fill = "#FACC15"
        stroke_color = "#DC2626"
        title_color = "#DC2626"
        badge_bg = "#DC2626"
        badge_text = "#FFFFFF"

    badge_label = f"🔥 {group_name}" if group_name else "🔥 抖音爆款"

    tspan_list = []
    y_start = 820 - (len(lines[:3]) - 1) * 65
    for idx, line in enumerate(lines[:3]):
        y_pos = y_start + idx * 135
        tspan_list.append(
            f'<text x="512" y="{y_pos}" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="100" font-weight="900" text-anchor="middle" fill="{title_color}">{line}</text>'
        )

    tspan_str = "\n".join(tspan_list)

    overlay_rect = ""
    if img_bg_element:
        overlay_rect = """
        <rect width="1024" height="1536" fill="black" opacity="0.35"/>
        <rect y="500" width="1024" height="1036" fill="url(#bottomGradient)" opacity="0.9"/>
        """

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536" width="1024" height="1536">
  <defs>
    <linearGradient id="bottomGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1536" fill="{bg_fill}"/>
  {img_bg_element}
  {overlay_rect}
  <rect x="96" y="120" width="832" height="160" rx="32" fill="{badge_bg}"/>
  <text x="512" y="225" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="68" font-weight="900" text-anchor="middle" fill="{badge_text}">{badge_label}</text>
  <rect x="64" y="550" width="896" height="620" rx="40" fill="#FFFFFF" fill-opacity="0.94" stroke="{stroke_color}" stroke-width="10"/>
  {tspan_str}
  <rect x="212" y="1270" width="600" height="120" rx="60" fill="{badge_bg}"/>
  <text x="512" y="1345" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="48" font-weight="800" text-anchor="middle" fill="{badge_text}">点击看直播 · 领专属优惠</text>
</svg>"""


def generate_video_covers(
    headline: str,
    job_id: str,
    *,
    video_path: Path | str | None = None,
    group_name: str | None = None,
    count: int = 2,
    style: str = "yellow-red",
) -> list[CoverResult]:
    """
    基于成片真实画面与核心卖点文案，为成片自动化绑定并生成高关联性爆款大字报封面。
    - 如果存在成片视频 MP4 文件：通过 FFmpeg 截取成片高清截图，作为封面的真实底图！
    - 如果配置了 CatsAPI 密钥：带入成片商品名称与场景结合 AI 渲染封面。
    """
    text = (headline or "").strip() or "爆款推荐 独家折扣"
    results: list[CoverResult] = []
    out_dir = settings.covers_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    v_path = Path(video_path) if video_path else None

    # 1. 尝试从成片视频中截取画面首帧/高光帧
    extracted_frames: list[Path] = []
    if v_path and v_path.exists():
        timestamps = [1.5, 3.5, 6.0, 9.0]
        for idx, ts in enumerate(timestamps[:count]):
            frame_path = out_dir / f"frame_src_{idx + 1}.jpg"
            if extract_video_frame(v_path, ts, frame_path):
                extracted_frames.append(frame_path)

    # 2. 如果配置了 AI 接口，带入商品与成片真实卖点 Prompt
    api_key = get_secret("catsapi_key", settings.catsapi_key)
    if api_key:
        try:
            for i in range(min(count, 4)):
                style_prompt = STYLE_HINTS.get(style, STYLE_HINTS["yellow-red"])
                angle = VARIANT_ANGLES[i % len(VARIANT_ANGLES)]
                prod_desc = f"商品类别与主题：「{group_name}」。" if group_name else ""
                prompt = (
                    "基于原图视频画面美化增质，生成一张高颜值、强吸引力的小红书/抖音短视频竖版封面海报。"
                    f"{prod_desc}"
                    f"必须醒目展示海报主题文案：「{text}」。"
                    f"文字样式与画风：{style_prompt}。"
                    f"构图要求：{angle}。"
                    "画面要求：纯净高质感摄影、光影通透、无杂乱直播间痕迹、高吸引力与精致美感，竖构图 3:4。"
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

    # 3. 关联真实成片图底的高清矢量大字报封面
    if len(results) < count:
        start_idx = len(results)
        for i in range(start_idx, count):
            filename = f"cover_{i + 1:02d}.svg"
            dest = out_dir / filename
            frame_img = extracted_frames[i % len(extracted_frames)] if extracted_frames else None
            svg_content = _build_svg_cover(
                text,
                index=i,
                frame_jpeg_path=frame_img,
                group_name=group_name,
                style=style,
            )
            dest.write_text(svg_content, encoding="utf-8")
            results.append(
                CoverResult(
                    id=f"{job_id}-{i + 1}",
                    url=f"/api/media/covers/{job_id}/{filename}",
                    remote_url=None,
                )
            )

    return results
