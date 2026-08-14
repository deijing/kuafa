from __future__ import annotations

import base64
import concurrent.futures
import html
import json
import random
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.models import CoverJobOut, CoverRequest, CoverResult, JobStatus
from app.services import catsapi
from app.services import db as store
from app.services.ffmpeg_pipeline import probe, run_cmd
from app.services.openai_client import chat_completions, has_openai_key
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


def extract_video_frame(video_path: Path, timestamp_sec: float, out_jpeg: Path) -> bool:
    """精准从视频特定时间点截取单帧高清 JPEG 图片。"""
    try:
        out_jpeg.parent.mkdir(parents=True, exist_ok=True)
        run_cmd([
            settings.ffmpeg_bin,
            "-y",
            "-ss", f"{max(0.0, timestamp_sec):.2f}",
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "2",
            str(out_jpeg),
        ], timeout=15)
        return out_jpeg.exists() and out_jpeg.stat().st_size > 0
    except Exception:
        return False


def _image_to_base64(target_path: Path) -> str | None:
    try:
        if target_path and target_path.exists():
            raw = target_path.read_bytes()
            mime = "image/png" if target_path.suffix.lower() == ".png" else "image/jpeg"
            return f"data:{mime};base64,{base64.b64encode(raw).decode('utf-8')}"
    except Exception:
        pass
    return None


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

    def delete(self, job_id: str) -> CoverJobOut:
        with self._lock:
            job = store.get_cover_job(job_id)
            if not job:
                raise KeyError(f"封面任务 {job_id} 不存在")
            store.delete_cover_job(job_id)
            out_dir = settings.covers_dir / job_id
            if out_dir.exists():
                shutil.rmtree(out_dir, ignore_errors=True)
            return job

    def delete_result(self, job_id: str, result_id: str) -> CoverJobOut | None:
        with self._lock:
            job = store.get_cover_job(job_id)
            if not job:
                raise KeyError(f"封面任务 {job_id} 不存在")

            # 删除对应单张图片文件
            target = next((r for r in job.results if r.id == result_id), None)
            if target:
                filename = target.url.split("/")[-1]
                file_path = settings.covers_dir / job_id / filename
                if file_path.exists():
                    try:
                        file_path.unlink()
                    except Exception:
                        pass

            new_results = [r for r in job.results if r.id != result_id]
            if not new_results:
                store.delete_cover_job(job_id)
                out_dir = settings.covers_dir / job_id
                if out_dir.exists():
                    shutil.rmtree(out_dir, ignore_errors=True)
                return None
            else:
                updated = job.model_copy(update={"results": new_results})
                store.upsert_cover_job(updated)
                return updated

    def clear_all(self) -> int:
        with self._lock:
            jobs = store.list_cover_jobs()
            for job in jobs:
                out_dir = settings.covers_dir / job.id
                if out_dir.exists():
                    shutil.rmtree(out_dir, ignore_errors=True)
            return store.delete_all_cover_jobs()

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
        text = req.headline.strip()
        if req.mode == "img2img":
            return (
                f"小红书抖音电商爆款大字报封面海报，严格保真参考图中主播人物形象与手里拿持展示的商品款式细节，"
                f"在画面黄金分割区域醒目排版大字报标题：「{text}」，{style}，构图：{angle}，超高清商业广告摄影质感，3:4竖版。"
            )
        return (
            f"小红书抖音爆款电商大字报精美海报，画面黄金分割位醒目排版大字报标题：「{text}」，"
            f"{style}，构图：{angle}，超高清商业摄影质感、光影通透、无乱码，3:4竖版。"
        )

    def _resolve_image_base64(self, image_url: str | None) -> str | None:
        if not image_url:
            return None
        try:
            target_path: Path | None = None
            if image_url.startswith("/api/media/covers/references/"):
                fname = image_url.split("/")[-1]
                target_path = settings.covers_dir / "references" / fname
            elif image_url.startswith("/api/thumbs/"):
                fname = image_url.split("/")[-1]
                target_path = settings.thumbs_dir / fname
            elif image_url.startswith("/api/media/covers/"):
                parts = image_url.replace("/api/media/covers/", "").split("/")
                target_path = settings.covers_dir / Path(*parts)
            elif image_url.startswith("/api/outputs/"):
                fname = image_url.split("/")[-1]
                target_path = settings.outputs_dir / fname
            elif image_url.startswith("/api/materials/"):
                parts = image_url.split("/")
                if len(parts) >= 4 and parts[3] == "video":
                    mat_id = parts[2]
                    mat = store.get_material(mat_id)
                    if mat and mat.path:
                        target_path = Path(mat.path)
            elif Path(image_url).exists():
                target_path = Path(image_url)

            if target_path and target_path.exists():
                # 若提供的是视频文件，自动抽取一帧高光随机帧
                if target_path.suffix.lower() in (".mp4", ".mov", ".mkv", ".avi", ".flv", ".webm", ".ts"):
                    ref_dir = settings.covers_dir / "references"
                    ref_dir.mkdir(parents=True, exist_ok=True)
                    frame_dest = ref_dir / f"extracted_{uuid.uuid4().hex[:8]}.jpg"
                    try:
                        dur = probe(target_path).duration
                    except Exception:
                        dur = 5.0
                    ts = round(random.uniform(min(0.5, dur * 0.1), max(0.5, dur * 0.9)), 2) if dur > 1.5 else 0.5
                    if extract_video_frame(target_path, ts, frame_dest):
                        target_path = frame_dest
                    else:
                        return None

                return _image_to_base64(target_path)
        except Exception:
            pass
        return None

    def _run(self, job_id: str, req: CoverRequest) -> None:
        try:
            mode_desc = "AI 图生图" if req.mode == "img2img" else "AI 文生图"
            self._update(
                job_id,
                status=JobStatus.running,
                progress=5,
                message=f"正在调用 GPT Image 2 进行 {mode_desc}…",
            )
            results: list[CoverResult] = []
            total = max(1, min(req.count, 6))
            out_dir = settings.covers_dir / job_id
            out_dir.mkdir(parents=True, exist_ok=True)

            img_b64 = self._resolve_image_base64(req.image_url) if req.mode == "img2img" else None

            def _generate_item(i: int) -> CoverResult:
                try:
                    prompt = self._build_prompt(req, i)
                    task_id = catsapi.create_image_task(
                        prompt,
                        image_url=req.image_url if (req.mode == "img2img" and req.image_url and req.image_url.startswith("http")) else None,
                        image_base64=img_b64,
                        size=req.size,
                        quality=req.quality,
                        rewrite_prompt=req.rewrite_prompt,
                    )
                    urls = catsapi.wait_for_images(task_id, timeout_seconds=90)
                    url = urls[0]
                    ext = catsapi.guess_ext(url)
                    filename = f"cover_{i + 1:02d}{ext}"
                    dest = out_dir / filename
                    catsapi.download_image(url, dest)
                    return CoverResult(
                        id=f"{job_id}-{i + 1}",
                        url=f"/api/media/covers/{job_id}/{filename}",
                        remote_url=url,
                        headline=req.headline.strip(),
                    )
                except Exception:
                    # 单张失败兜底生成 SVG 保证用户批量完整交付
                    svg_name = f"cover_{i + 1:02d}.svg"
                    svg_dest = out_dir / svg_name
                    svg_content = _build_svg_cover(
                        req.headline.strip(),
                        index=i,
                        style=req.style,
                    )
                    svg_dest.write_text(svg_content, encoding="utf-8")
                    return CoverResult(
                        id=f"{job_id}-{i + 1}",
                        url=f"/api/media/covers/{job_id}/{svg_name}",
                        remote_url=None,
                        headline=req.headline.strip(),
                    )

            with concurrent.futures.ThreadPoolExecutor(max_workers=total) as pool:
                futures = [pool.submit(_generate_item, i) for i in range(total)]
                for idx, fut in enumerate(futures):
                    res = fut.result()
                    results.append(res)
                    pct = 10 + int(80 * (idx + 1) / total)
                    self._update(
                        job_id,
                        progress=pct,
                        message=f"{mode_desc}生成中 {idx + 1}/{total}…",
                        results=list(results),
                    )

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


def _build_svg_cover(
    text: str,
    index: int = 0,
    frame_jpeg_path: Path | None = None,
    group_name: str | None = None,
    style: str = "yellow-red",
) -> str:
    text_clean = text.strip() or "爆款热销推荐"
    chunk_size = 6
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
    elif style == "clean-minimal":
        bg_fill = "#F5F5F4"
        stroke_color = "#292524"
        title_color = "#1C1917"
        badge_bg = "#44403C"
        badge_text = "#FAFAF9"
    elif style == "festive-gold":
        bg_fill = "#7F1D1D"
        stroke_color = "#F59E0B"
        title_color = "#FDE68A"
        badge_bg = "#B45309"
        badge_text = "#FEF3C7"
    else:  # yellow-red default
        bg_fill = "#FEF08A"
        stroke_color = "#DC2626"
        title_color = "#DC2626"
        badge_bg = "#DC2626"
        badge_text = "#FFFFFF"

    badge_label = html.escape(f"🔥 {group_name} · 直播间爆款" if group_name else "🔥 直播间爆款")

    tspan_list = []
    y_start = 450 - (len(lines[:3]) - 1) * 55
    for idx, line in enumerate(lines[:3]):
        y_pos = y_start + idx * 115
        safe_line = html.escape(line)
        tspan_list.append(
            f'<text x="512" y="{y_pos}" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="88" font-weight="900" text-anchor="middle" fill="{title_color}" stroke="#000000" stroke-width="4" paint-order="stroke fill">{safe_line}</text>'
        )

    tspan_str = "\n".join(tspan_list)

    overlay_rect = ""
    if img_bg_element:
        overlay_rect = """
        <rect width="1024" height="600" fill="url(#topGradient)" opacity="0.85"/>
        <rect y="1200" width="1024" height="336" fill="url(#bottomGradient)" opacity="0.85"/>
        """

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536" width="1024" height="1536">
  <defs>
    <linearGradient id="topGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.8"/>
      <stop offset="60%" stop-color="#000000" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.0"/>
    </linearGradient>
    <linearGradient id="bottomGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.9"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="1024" height="1536" fill="{bg_fill}"/>
  {img_bg_element}
  {overlay_rect}
  <g filter="url(#shadow)">
    <rect x="112" y="90" width="800" height="130" rx="30" fill="{badge_bg}"/>
    <text x="512" y="175" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="56" font-weight="900" text-anchor="middle" fill="{badge_text}">{badge_label}</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="72" y="270" width="880" height="380" rx="36" fill="#FFFFFF" fill-opacity="0.96" stroke="{stroke_color}" stroke-width="8"/>
    {tspan_str}
  </g>
  <g filter="url(#shadow)">
    <rect x="212" y="1360" width="600" height="110" rx="55" fill="{badge_bg}"/>
    <text x="512" y="1432" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="44" font-weight="800" text-anchor="middle" fill="{badge_text}">✔ 现货速发 · 点击看同款</text>
  </g>
</svg>"""


def extract_audio_headlines(
    audio_transcript: list[str] | str | None = None,
    *,
    video_path: Path | None = None,
    group_name: str | None = None,
    count: int = 3,
    fallback_headline: str | None = None,
) -> list[str]:
    """
    基于视频真实音频口播内容与商品类目，智能提炼多条高转化爆款大字报标语。
    - 若配置了 DeepSeek / OpenAI LLM：由 AI 分析口播音频文本提炼出紧扣商品、价格、面料卖点的爆款大字报。
    - 若未配置或调用异常：基于关键词与价格模式智能生成多套爆款组合。
    """
    speech_text = ""
    if isinstance(audio_transcript, list):
        speech_text = "，".join(str(s).strip() for s in audio_transcript if str(s).strip())
    elif isinstance(audio_transcript, str):
        speech_text = audio_transcript.strip()

    # 若未直接传口播文本但有视频文件，尝试调用转写提取音频内容
    if not speech_text and video_path and Path(video_path).exists():
        try:
            from app.services.transcription import transcribe_material
            segs = transcribe_material(Path(video_path))
            if segs:
                speech_text = "，".join(s.text.strip() for s in segs if s.text.strip())
        except Exception:
            pass

    # 1. 优先调用 LLM（DeepSeek / OpenAI）基于音频进行智能提炼
    if speech_text and has_openai_key():
        try:
            system_prompt = (
                "你是小红书与抖音顶级短视频电商爆款海报文案大师。请分析视频中主播的真实音频口播内容，"
                "为该成片提炼出具有极高点击率（CTR）与带货转化力的封面爆款大字报标题（Headline）。\n"
                "文案要求：\n"
                "1. 必须紧扣音频中主播介绍的核心商品名称、真实价格优惠（如数字/买赠/立减）、面料材质细节与核心卖点。\n"
                "2. 格式结构：【核心主题/价格福利】+【卖点/购买理由】（例如「39.9纯棉打底衫 春夏闭眼入」、「100%精梳纯棉 亲肤透气不闷汗」、「直播间爆款 显瘦遮肉神仙版型」）。\n"
                "3. 字体文案长度严格在 10-18 个字内，短小精炼、字字有网感、无废话、无多余标点。\n"
                f"4. 请输出 {count} 条不同侧重点的差异化封面标语：\n"
                "   - 第 1 条侧重【破价福利 / 促销吸引】（如价格/买赠/立减/闭眼入）\n"
                "   - 第 2 条侧重【核心卖点 / 面料质感 / 解决痛点】（如纯棉/透气/显瘦/舒适）\n"
                "   - 第 3 条侧重【爆款热销 / 季节必备 / 强烈推荐】（如直播间爆款/春夏必备/闭眼入）\n"
                "5. 严格只输出 JSON 字符串数组，例如：[\"39.9纯棉打底衫 春夏闭眼入\", \"100%精梳棉 亲肤透气不闷汗\", \"直播间爆款 显瘦百搭神仙款\"]"
            )
            user_prompt = f"商品主题：{group_name or '热销好物'}\n成片音频口播原文：\n{speech_text[:1000]}"
            raw = chat_completions(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.6,
            )
            # 解析 JSON 数组
            text_cleaned = raw.strip()
            if text_cleaned.startswith("```"):
                text_cleaned = re.sub(r"^```(?:json)?\s*", "", text_cleaned)
                text_cleaned = re.sub(r"\s*```$", "", text_cleaned)
            match = re.search(r"\[[\s\S]*\]", text_cleaned)
            if match:
                parsed = json.loads(match.group(0))
                if isinstance(parsed, list) and len(parsed) > 0:
                    results = [str(item).strip() for item in parsed if str(item).strip()]
                    if results:
                        return results[:count]
        except Exception:
            pass

    # 2. 规则启发式智能提取（无 Key 或 LLM 失败时的兜底）
    prod = group_name or "爆款好物"
    # 从音频中正则寻找价格或优惠数字
    price_prefix = ""
    if speech_text:
        price_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:元|块|米)|(?:只要|价格|到手|券后|立省|单件)\s*(\d+(?:\.\d+)?)", speech_text)
        if price_match:
            p = price_match.group(1) or price_match.group(2)
            if p:
                price_prefix = f"{p}元 "

    # 从音频中提取特色属性词
    feat_words = []
    keywords = ["纯棉", "透气", "显瘦", "遮肉", "亲肤", "舒适", "百搭", "凉感", "防晒", "免烫", "抗皱", "不挑身材", "高级感", "大牌平替"]
    for kw in keywords:
        if kw in speech_text:
            feat_words.append(kw)

    feat_desc = "".join(feat_words[:2]) if feat_words else "高颜值品质"

    base_headlines = [
        f"{price_prefix}{prod} 春夏闭眼入",
        f"超值爆款！{prod} {feat_desc}",
        f"直播间热销！{prod} 显瘦百搭手慢无",
    ]

    if fallback_headline and fallback_headline.strip():
        base_headlines[0] = fallback_headline.strip()

    return base_headlines[:count]


def generate_video_covers(
    headline: str | None,
    job_id: str,
    *,
    video_path: Path | str | None = None,
    audio_transcript: list[str] | str | None = None,
    group_name: str | None = None,
    count: int = 3,
    style: str = "yellow-red",
) -> list[CoverResult]:
    """
    基于成片真实画面与音频口播卖点，为成片自动化提取视频画面帧并进行 AI 图生图生成高关联性爆款大字报封面。
    - 智能分析音频提炼多组爆款大字标语。
    - 随机从剪辑好的视频中采集不同时间点的高清代表帧。
    - 以该视频帧作为图生图底图（严格保真人像与手中展示商品），调用 AI 生成爆款海报。
    - 若未配置 AI 密钥或生图异常，平滑降级为将真实帧作为底图的高清排版海报。
    """
    target_count = max(1, min(count, 4))
    results: list[CoverResult] = []
    out_dir = settings.covers_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    v_path = Path(video_path) if video_path else None

    # 1. 基于音频智能提炼爆款文案列表（每张封面对应不同侧重点）
    headlines = extract_audio_headlines(
        audio_transcript=audio_transcript,
        video_path=v_path,
        group_name=group_name,
        count=target_count,
        fallback_headline=headline,
    )
    while len(headlines) < target_count:
        headlines.append(headlines[0] if headlines else "爆款带货 极速出片")

    # 2. 尝试从成片视频中随机分布截取多张高清画面帧
    extracted_frames: list[Path] = []
    if v_path and v_path.exists():
        try:
            dur = probe(v_path).duration
        except Exception:
            dur = 6.0

        # 分段并在每段内随机取点，确保画面多样性
        timestamps: list[float] = []
        if dur > 1.5:
            margin = min(0.6, dur * 0.08)
            usable_span = max(0.5, dur - 2 * margin)
            step = usable_span / target_count
            for i in range(target_count):
                seg_start = margin + i * step
                seg_end = margin + (i + 1) * step
                ts = round(random.uniform(seg_start, seg_end), 2)
                timestamps.append(ts)
        else:
            timestamps = [round(dur * (i + 1) / (target_count + 1), 2) for i in range(target_count)]

        for idx, ts in enumerate(timestamps):
            frame_path = out_dir / f"frame_src_{idx + 1}.jpg"
            if extract_video_frame(v_path, ts, frame_path):
                extracted_frames.append(frame_path)

    # 3. 如果配置了 AI 接口，使用真实截帧与音频智能提炼大字进行 AI 图生图 (img2img)
    api_key = get_secret("catsapi_key", settings.catsapi_key)
    if api_key:
        def _render_ai_cover(i: int) -> CoverResult | None:
            try:
                cur_text = headlines[i]
                style_prompt = STYLE_HINTS.get(style, STYLE_HINTS["yellow-red"])
                angle = VARIANT_ANGLES[i % len(VARIANT_ANGLES)]
                prod_desc = f"商品类别：「{group_name}」，" if group_name else ""

                frame_file = extracted_frames[i % len(extracted_frames)] if extracted_frames else None
                frame_b64 = _image_to_base64(frame_file) if frame_file else None

                if frame_b64:
                    prompt = (
                        f"小红书抖音电商爆款大字报封面海报，严格保真参考图中主播人物形象与手里拿持展示的商品款式细节，"
                        f"在画面黄金分割区域醒目排版大字报标题：「{cur_text}」，{style_prompt}，构图：{angle}，超高清商业广告摄影质感，3:4竖版。"
                    )
                else:
                    prompt = (
                        f"小红书抖音爆款电商大字报精美海报，{prod_desc}画面黄金分割位醒目排版大字报标题：「{cur_text}」，"
                        f"{style_prompt}，构图：{angle}，超高清商业摄影质感、光影通透、无乱码，3:4竖版。"
                    )

                task_id = catsapi.create_image_task(
                    prompt,
                    image_base64=frame_b64,
                    size=settings.cover_size,
                    quality=settings.cover_quality,
                )
                urls = catsapi.wait_for_images(task_id, timeout_seconds=90)
                if urls:
                    url = urls[0]
                    ext = catsapi.guess_ext(url)
                    filename = f"cover_{i + 1:02d}{ext}"
                    dest = out_dir / filename
                    catsapi.download_image(url, dest)
                    return CoverResult(
                        id=f"{job_id}-{i + 1}",
                        url=f"/api/media/covers/{job_id}/{filename}",
                        remote_url=url,
                        headline=cur_text,
                    )
            except Exception:
                pass
            return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=target_count) as pool:
            futures = [pool.submit(_render_ai_cover, i) for i in range(target_count)]
            for fut in futures:
                res = fut.result()
                if res:
                    results.append(res)

    # 4. 若无 AI 密钥或 AI 接口异常，关联真实成片截帧与音频文案的高清大字报海报
    if len(results) < target_count:
        start_idx = len(results)
        for i in range(start_idx, target_count):
            cur_text = headlines[i]
            filename = f"cover_{i + 1:02d}.svg"
            dest = out_dir / filename
            frame_img = extracted_frames[i % len(extracted_frames)] if extracted_frames else None
            svg_content = _build_svg_cover(
                cur_text,
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
                    headline=cur_text,
                )
            )

    return results[:target_count]
