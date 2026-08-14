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
    "yellow-red": "红黄黑高对比爆款配色，粗犷手绘油漆刷痕边缘，米白暖色纸张质感底色",
    "black-yellow": "黑金高对比高级配色，粗犷手绘油漆刷痕边缘，质感暗纹底色",
    "red-white": "红白高对比爆款配色，粗犷手绘油漆刷痕边缘，清新通透底色",
    "neon-cyber": "赛博霓虹高对比配色，立体质感发光边缘，暗黑潮流底色",
    "clean-minimal": "轻奢莫兰迪质感配色，柔光写实质感，米白温暖底色",
    "festive-gold": "国潮金红高对比配色，粗犷手绘金边刷痕，喜庆热销底色",
}

VARIANT_ANGLES = [
    "左上油漆刷痕引流短句，中上部超大红色价格醒目排版，中央倾斜黄色手刷核心卖点",
    "中上部超大主标题立体排版，黄色手刷色块突出爆款卖点，下方排列圆角标签",
    "醒目大字价格置顶，结合商品核心卖点色块，层次分明通透，视觉冲击力强",
    "极简爆款大字报构图，红黄高对比吸睛卖点，干净利落且强转化吸引力",
]

# 全局生图并发闸：避免批量成片时多个任务同时打爆 CatsAPI
_IMAGE_GEN_SEMAPHORE = threading.Semaphore(6)


def resolve_media_path(root: Path, *parts: str) -> Path | None:
    """在 root 目录内安全解析相对路径，越界（目录穿越）则返回 None。"""
    try:
        root_resolved = root.resolve()
        candidate = root.joinpath(*parts).resolve()
    except (OSError, ValueError):
        return None
    if candidate == root_resolved or candidate.is_relative_to(root_resolved):
        return candidate
    return None


def extract_video_frame(video_path: Path, timestamp_sec: float, out_jpeg: Path) -> bool:
    """精准从视频特定时间点截取单帧高清 JPEG 图片。支持快速定位与精确定位双重保障。"""
    try:
        out_jpeg.parent.mkdir(parents=True, exist_ok=True)
        ts = max(0.0, timestamp_sec)

        # 1. 尝试快速 seek 模式抽帧
        try:
            run_cmd([
                settings.ffmpeg_bin,
                "-y",
                "-ss", f"{ts:.2f}",
                "-i", str(video_path),
                "-vframes", "1",
                "-q:v", "2",
                str(out_jpeg),
            ], timeout=15)
            if out_jpeg.exists() and out_jpeg.stat().st_size > 1024:
                return True
        except Exception:
            pass

        # 2. 回退精确逐帧 seek 模式（防止首部关键帧异常或 pts 偏移）
        try:
            run_cmd([
                settings.ffmpeg_bin,
                "-y",
                "-i", str(video_path),
                "-ss", f"{ts:.2f}",
                "-vframes", "1",
                "-q:v", "2",
                str(out_jpeg),
            ], timeout=20)
            if out_jpeg.exists() and out_jpeg.stat().st_size > 1024:
                return True
        except Exception:
            pass

        return False
    except Exception:
        return False


def extract_multiple_video_frames(
    video_path: Path,
    count: int = 3,
    out_dir: Path | None = None,
) -> list[Path]:
    """从视频黄金区间（15%~85%）均匀截取多张不同时间点的高清代表帧，支持图生图多帧独立生成。"""
    if not video_path or not video_path.exists():
        return []
    try:
        dur = probe(video_path).duration
    except Exception:
        dur = 6.0

    target_count = max(1, count)
    target_dir = out_dir or (settings.covers_dir / "references")
    target_dir.mkdir(parents=True, exist_ok=True)

    timestamps: list[float] = []
    if dur > 2.0:
        start_sec = max(0.6, dur * 0.15)
        end_sec = max(start_sec + 0.5, dur * 0.85)
        span = end_sec - start_sec
        step = span / target_count
        for i in range(target_count):
            seg_start = start_sec + i * step
            seg_end = start_sec + (i + 1) * step
            ts = round(random.uniform(seg_start, seg_end), 2)
            timestamps.append(ts)
    else:
        timestamps = [round(dur * (i + 1) / (target_count + 1), 2) for i in range(target_count)]

    frames: list[Path] = []
    uid = uuid.uuid4().hex[:8]
    for idx, ts in enumerate(timestamps):
        frame_dest = target_dir / f"extracted_{uid}_{idx + 1}.jpg"
        if extract_video_frame(video_path, ts, frame_dest):
            frames.append(frame_dest)
        else:
            mid_ts = round(dur * 0.5, 2)
            if extract_video_frame(video_path, mid_ts, frame_dest):
                frames.append(frame_dest)
    return frames


def _image_to_base64(target_path: Path | None) -> str | None:
    try:
        if target_path and target_path.exists():
            raw = target_path.read_bytes()
            mime = "image/png" if target_path.suffix.lower() == ".png" else "image/jpeg"
            return f"data:{mime};base64,{base64.b64encode(raw).decode('utf-8')}"
    except Exception:
        pass
    return None


def _parse_prompt_tokens(headline: str, group_name: str | None, index: int) -> dict[str, Any]:
    text_clean = headline.strip() or "爆款好物 极速出片"
    lead_tags = ["🔥爆款疯抢", "⚡️直播间专属", "👑掌柜力荐", "💥限时破价"]
    lead_tag = lead_tags[index % len(lead_tags)]

    prod_name = group_name.strip() if group_name and group_name.strip() else "热销好物"

    # 尝试从文案中提取价格
    price_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:元|块|米)|(?:¥|￥)\s*(\d+(?:\.\d+)?)", text_clean)
    if price_match:
        p_val = price_match.group(1) or price_match.group(2)
        price_display = f"¥{p_val}"
    else:
        # 无具体数字时使用强吸引力标语
        price_display = "破价抢购"

    # 核心卖点提炼
    core_point = text_clean
    if len(core_point) > 20:
        core_point = core_point[:18]

    tags_pool = [
        ["正品现货", "顺丰包邮", "品质保障"],
        ["显瘦遮肉", "透气舒适", "闭眼入款"],
        ["专柜同品质", "假一赔十", "破价秒杀"],
        ["大牌平替", "高颜值好物", "现货直发"],
    ]
    tags = tags_pool[index % len(tags_pool)]

    return {
        "lead_tag": lead_tag,
        "prod_name": prod_name,
        "price_display": price_display,
        "core_point": core_point,
        "tags": tags,
    }


def build_live_cover_prompt(
    headline: str,
    *,
    is_img2img: bool = True,
    group_name: str | None = None,
    style: str = "yellow-red",
    index: int = 0,
    aspect_ratio: str = "9:16",
) -> str:
    """
    电商直播促销海报黄金提示词生成器（支持 16:9 横版与 9:16 竖版 4K 超高清商业画质）：
    - 参考图规则：仅用于继承整体版式、配色、信息层级和直播带货海报风格，不复制具体人物与文案内容，可根据新主题自由替换产品和卖点，但必须保持同类视觉语言。
    - 画质要求：4K 超高清分辨率商业广告级摄影画质，细腻光影质感，极高清晰度与真实感。
    - 构图要求：16:9 横版黄金分割排版（左侧密集促销大字报，右侧主播人物与商品实拍特写），严禁遮挡面部与五官。
    - 负面排除：错字乱码、文字缺失、标签裁切、额外人物或手机、品牌标志、肢体畸形、多余手指、面部变形、模糊、过曝、过饱和、杂乱背景、矢量化人物、塑料皮肤、低清晰度、遮挡面部、脸部被遮挡、居中大白框、手机UI、播放控件、底部小黄车按钮、视频字幕条。
    """
    tokens = _parse_prompt_tokens(headline, group_name, index)
    lead_tag = tokens["lead_tag"]
    prod_name = tokens["prod_name"]
    price_display = tokens["price_display"]
    core_point = tokens["core_point"]
    tags = tokens["tags"]
    style_desc = STYLE_HINTS.get(style, STYLE_HINTS["yellow-red"])

    ref_rule = (
        "【参考图核心规则】：参考图仅用于继承整体版式、配色、信息层级和直播带货海报风格，"
        "不复制原视频中的具体人物与杂乱文案内容，可根据新主题自由替换产品和卖点，但必须保持同类视觉语言。\n\n"
        if is_img2img
        else ""
    )

    tags_str = "」「".join(tags)

    if aspect_ratio == "16:9":
        return (
            f"{ref_rule}"
            f"混合媒介电商直播促销海报，横版16:9比例，4K超高清分辨率商业广告摄影画质，米白暖色纸张质感背景，整体采用{style_desc}，粗犷手绘刷痕边缘，具有强烈爆款视觉冲击力。\n\n"
            f"画面构图（横版16:9黄金分割比例）：\n"
            f"1. 【主体写实】：画面右半部为年轻亚洲主播的4K写实抠图展示，半身构图，手持展示「{prod_name}」，"
            f"柔和正面棚拍光，真实肤色，服装纹理超清细腻，自然阴影，人物边缘带白色描边与淡投影，人物五官端正清晰自然，严禁遮挡面部。\n"
            f"2. 【密集促销排版】：画面左半部为吸睛大字报密集排版：\n"
            f"   - 左上方红色粗糙油漆刷痕内放白字「{lead_tag}」；\n"
            f"   - 中上部醒目排版超大红色价格数字或爆款大字「{price_display}」，带黑色描边、白色外轮廓与立体投影；\n"
            f"   - 价格右侧放黑色粗体「{prod_name}」；\n"
            f"   - 中部倾斜黄色手刷色块承载巨型黑字「{core_point}」；\n"
            f"   - 下方排列{len(tags)}枚白底黑框圆角标签，依次写「{tags_str}」；\n"
            f"   - 底角加入不规则白黄刷痕装饰，增强促销氛围。\n\n"
            f"整体要求：4K 超高清商业广告级摄影画质，横版16:9构图，大字与价格最抢眼，卖点明确，人物真实，信息层级清晰，热闹但不杂乱。\n\n"
            f"负面：错字乱码、文字缺失、标签裁切、额外人物或手机、品牌标志、肢体畸形、多余手指、面部变形、模糊、过曝、过饱和、杂乱背景、矢量化人物、塑料皮肤、低清晰度、遮挡面部、脸部被遮挡、居中大白框、手机UI、播放控件、底部小黄车按钮、视频字幕条。"
        )

    # 竖版 9:16 模式
    return (
        f"{ref_rule}"
        f"混合媒介电商直播促销海报，竖版9:16比例，4K超高清分辨率商业广告摄影画质，米白暖色纸张质感背景，整体采用{style_desc}，粗犷手绘刷痕边缘，具有强烈直播带货爆款视觉。\n\n"
        f"画面下半部为年轻亚洲主播的4K写实抠图展示，半身构图，手持展示「{prod_name}」，"
        f"柔和正面棚拍光，真实肤色，服装纹理超清细腻，自然阴影，人物边缘带白色描边与淡投影，人物五官端正清晰自然，严禁遮挡面部。\n\n"
        f"上半部为密集促销排版：\n"
        f"1. 左上红色粗糙油漆刷痕内放白字「{lead_tag}」；\n"
        f"2. 中上部放超大红色价格数字或醒目标题「{price_display}」，带黑色描边、白色外轮廓和灰色投影；\n"
        f"3. 价格右侧放黑色粗体「{prod_name}」；\n"
        f"4. 中央倾斜黄色手刷色块承载巨型黑字「{core_point}」；\n"
        f"5. 下方排列{len(tags)}枚白底黑框圆角标签，依次写「{tags_str}」；\n"
        f"6. 底角加入不规则白黄刷痕装饰，增强促销氛围。\n\n"
        f"整体要求：4K 超高清商业摄影画质，价格最抢眼，卖点明确，人物真实，信息层级清晰，热闹但不杂乱。\n\n"
        f"负面：错字乱码、文字缺失、标签裁切、额外人物或手机、品牌标志、肢体畸形、多余手指、面部变形、模糊、过曝、过饱和、杂乱背景、矢量化人物、塑料皮肤、低清晰度、遮挡面部、脸部被遮挡、居中大白框、手机UI、播放控件、底部小黄车按钮、视频字幕条。"
    )


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
        ratio = "16:9" if req.size in ("1792x1024", "1536x1024", "1920x1080") or not req.size else ("9:16" if req.size == "1024x1536" else "16:9")
        return build_live_cover_prompt(
            headline=req.headline,
            is_img2img=(req.mode == "img2img"),
            style=req.style,
            index=index,
            aspect_ratio=ratio,
        )

    def _resolve_image_targets(self, image_url: str | None, count: int, out_dir: Path) -> tuple[list[Path], list[str | None]]:
        """解析参考图。若为视频，抽取 count 张不同的代表帧；若为单图，返回复制单图。"""
        if not image_url:
            return [], []
        try:
            target_path: Path | None = None
            if image_url.startswith("/api/media/covers/references/"):
                fname = image_url.split("/")[-1]
                target_path = resolve_media_path(settings.covers_dir / "references", fname)
            elif image_url.startswith("/api/thumbs/"):
                fname = image_url.split("/")[-1]
                target_path = resolve_media_path(settings.thumbs_dir, fname)
            elif image_url.startswith("/api/media/covers/"):
                parts = image_url.replace("/api/media/covers/", "").split("/")
                target_path = resolve_media_path(settings.covers_dir, *parts)
            elif image_url.startswith("/api/outputs/"):
                fname = image_url.split("/")[-1]
                target_path = resolve_media_path(settings.outputs_dir, fname)
            elif image_url.startswith("/api/materials/"):
                # 前端视频地址格式：/api/materials/{id}/video
                parts = image_url.split("/")
                if len(parts) >= 5 and parts[4] == "video":
                    mat = store.get_material(parts[3])
                    if mat and mat.path:
                        target_path = Path(mat.path)

            if target_path and target_path.exists():
                # 若提供的是视频文件，自动抽取 count 帧代表帧
                if target_path.suffix.lower() in (".mp4", ".mov", ".mkv", ".avi", ".flv", ".webm", ".ts"):
                    ref_dir = out_dir / "references"
                    frames = extract_multiple_video_frames(target_path, count=count, out_dir=ref_dir)
                    b64_list = [_image_to_base64(f) for f in frames]
                    return frames, b64_list

                # 单张图片文件
                b64 = _image_to_base64(target_path)
                return [target_path] * count, [b64] * count
        except Exception:
            pass
        return [], []

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

            ref_files, img_b64s = self._resolve_image_targets(req.image_url, total, out_dir) if req.mode == "img2img" else ([], [])

            def _generate_item(i: int) -> CoverResult:
                with _IMAGE_GEN_SEMAPHORE:
                    item_ref_file = ref_files[i % len(ref_files)] if ref_files else None
                    item_b64 = img_b64s[i % len(img_b64s)] if img_b64s else None
                    try:
                        prompt = self._build_prompt(req, i)
                        task_id = catsapi.create_image_task(
                            prompt,
                            image_url=req.image_url if (req.mode == "img2img" and req.image_url and req.image_url.startswith("http")) else None,
                            image_base64=item_b64,
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
                        # 单张失败兜底生成优雅大字报 SVG（保证用户批量完整交付且不遮挡人脸）
                        svg_name = f"cover_{i + 1:02d}.svg"
                        svg_dest = out_dir / svg_name
                        svg_content = _build_svg_cover(
                            req.headline.strip(),
                            index=i,
                            frame_jpeg_path=item_ref_file,
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
    aspect_ratio: str = "9:16",
) -> str:
    """
    生成高转化大字报海报（支持 16:9 横版与 9:16 竖版 4K 画质，绝不遮挡人物面部与五官）。
    """
    tokens = _parse_prompt_tokens(text, group_name, index)
    lead_tag = tokens["lead_tag"]
    prod_name = tokens["prod_name"]
    price_display = tokens["price_display"]
    core_point = tokens["core_point"]
    tags = tokens["tags"]

    text_clean = text.strip() or "爆款热销好物"

    if style == "black-yellow":
        bg_fill = "#09090B"
        title_color = "#FACC15"
        chip_bg = "#EAB308"
        chip_text = "#09090B"
    elif style == "red-white":
        bg_fill = "#DC2626"
        title_color = "#FFFFFF"
        chip_bg = "#FEF08A"
        chip_text = "#991B1B"
    elif style == "neon-cyber":
        bg_fill = "#050814"
        title_color = "#22D3EE"
        chip_bg = "#EC4899"
        chip_text = "#FFFFFF"
    elif style == "clean-minimal":
        bg_fill = "#F8FAFC"
        title_color = "#0F172A"
        chip_bg = "#E2E8F0"
        chip_text = "#0F172A"
    elif style == "festive-gold":
        bg_fill = "#991B1B"
        title_color = "#FDE047"
        chip_bg = "#D97706"
        chip_text = "#FFFFFF"
    else:  # yellow-red 爆款
        bg_fill = "#991B1B"
        title_color = "#FACC15"
        chip_bg = "#DC2626"
        chip_text = "#FFFFFF"

    # 16:9 横版排版（1920x1080 4K等比高清布局）
    if aspect_ratio == "16:9":
        chunk_size = 9
        lines = [text_clean[i : i + chunk_size] for i in range(0, min(len(text_clean), 18), chunk_size)]
        if not lines:
            lines = ["爆款热销好物"]

        img_bg_element = ""
        if frame_jpeg_path and frame_jpeg_path.exists():
            try:
                b64_data = base64.b64encode(frame_jpeg_path.read_bytes()).decode("utf-8")
                img_bg_element = f'<image href="data:image/jpeg;base64,{b64_data}" width="1920" height="1080" preserveAspectRatio="xMidYMid slice"/>'
            except Exception:
                img_bg_element = ""

        title_y_start = 280 if len(lines) > 1 else 320
        line_h = 110
        tspan_list = []
        for i, ln in enumerate(lines[:2]):
            escaped_ln = html.escape(ln)
            y = title_y_start + i * line_h
            tspan_list.append(
                f'<text x="80" y="{y}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Impact, sans-serif" font-size="92" font-weight="900" text-anchor="start" fill="{title_color}" stroke="#000000" stroke-width="16" paint-order="stroke fill">{escaped_ln}</text>'
                f'<text x="80" y="{y}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Impact, sans-serif" font-size="92" font-weight="900" text-anchor="start" fill="{title_color}">{escaped_ln}</text>'
            )
        tspan_str = "\n    ".join(tspan_list)

        tag_elements = []
        tag_xs = [80, 360, 640]
        for idx, tg in enumerate(tags[:3]):
            x = tag_xs[idx]
            tag_elements.append(
                f'<g>'
                f'<rect x="{x}" y="570" width="250" height="58" rx="29" fill="#FFFFFF" fill-opacity="0.96" stroke="#1F2937" stroke-width="3"/>'
                f'<text x="{x + 125}" y="608" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="26" font-weight="800" text-anchor="middle" fill="#111827">{html.escape(tg)}</text>'
                f'</g>'
            )
        tags_svg = "\n    ".join(tag_elements)

        return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{bg_fill}" stop-opacity="1"/>
      <stop offset="100%" stop-color="#111827" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="leftVignette" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.92"/>
      <stop offset="45%" stop-color="#000000" stop-opacity="0.75"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.75"/>
    </filter>
  </defs>

  <!-- 1. 底色或视频代表帧画面（铺满 16:9） -->
  <rect width="1920" height="1080" fill="url(#bgGrad)"/>
  {img_bg_element}

  <!-- 2. 左半部暗渐变层：确保大字高对比吸睛，右半部人物与商品完全通透露出 -->
  <rect width="1280" height="1080" fill="url(#leftVignette)"/>

  <!-- 3. 左上方引流短句刷痕徽章 -->
  <g filter="url(#glow)">
    <rect x="80" y="70" width="260" height="66" rx="14" fill="{chip_bg}"/>
    <text x="210" y="114" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="28" font-weight="900" text-anchor="middle" fill="{chip_text}">{html.escape(lead_tag)}</text>
  </g>

  <!-- 4. 商品品类提示 -->
  <g filter="url(#glow)">
    <rect x="370" y="70" width="280" height="66" rx="33" fill="#000000" fill-opacity="0.65" stroke="#FDE047" stroke-width="2"/>
    <text x="510" y="112" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="#FEF08A">✨ {html.escape(prod_name)}</text>
  </g>

  <!-- 5. 左侧大字报文案 -->
  <g filter="url(#glow)">
    {tspan_str}
  </g>

  <!-- 6. 核心卖点手刷色块条 -->
  <g filter="url(#glow)">
    <rect x="80" y="470" width="840" height="68" rx="34" fill="#FEF08A" stroke="#EAB308" stroke-width="3"/>
    <text x="500" y="514" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="32" font-weight="900" text-anchor="middle" fill="#991B1B">💥 {html.escape(core_point)}</text>
  </g>

  <!-- 7. 白底黑框圆角卖点标签 -->
  <g filter="url(#glow)">
    {tags_svg}
  </g>
</svg>"""

    # 9:16 竖版排版
    chunk_size = 7
    lines = [text_clean[i : i + chunk_size] for i in range(0, min(len(text_clean), 14), chunk_size)]
    if not lines:
        lines = ["爆款热销好物"]

    img_bg_element = ""
    if frame_jpeg_path and frame_jpeg_path.exists():
        try:
            b64_data = base64.b64encode(frame_jpeg_path.read_bytes()).decode("utf-8")
            img_bg_element = f'<image href="data:image/jpeg;base64,{b64_data}" width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/>'
        except Exception:
            img_bg_element = ""

    title_y_start = 220 if len(lines) > 1 else 250
    line_h = 100
    tspan_list = []
    for i, ln in enumerate(lines[:2]):
        escaped_ln = html.escape(ln)
        y = title_y_start + i * line_h
        tspan_list.append(
            f'<text x="540" y="{y}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Impact, sans-serif" font-size="82" font-weight="900" text-anchor="middle" fill="{title_color}" stroke="#000000" stroke-width="14" paint-order="stroke fill">{escaped_ln}</text>'
            f'<text x="540" y="{y}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Impact, sans-serif" font-size="82" font-weight="900" text-anchor="middle" fill="{title_color}">{escaped_ln}</text>'
        )

    tspan_str = "\n    ".join(tspan_list)

    tag_elements = []
    tag_xs = [140, 430, 720]
    for idx, tg in enumerate(tags[:3]):
        x = tag_xs[idx]
        tag_elements.append(
            f'<g>'
            f'<rect x="{x}" y="420" width="220" height="54" rx="27" fill="#FFFFFF" fill-opacity="0.95" stroke="#1F2937" stroke-width="3"/>'
            f'<text x="{x + 110}" y="456" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="24" font-weight="800" text-anchor="middle" fill="#111827">{html.escape(tg)}</text>'
            f'</g>'
        )
    tags_svg = "\n    ".join(tag_elements)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="{bg_fill}" stop-opacity="1"/>
      <stop offset="100%" stop-color="#111827" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="topVignette" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.85"/>
      <stop offset="35%" stop-color="#000000" stop-opacity="0.65"/>
      <stop offset="60%" stop-color="#000000" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.75"/>
    </filter>
  </defs>

  <rect width="1080" height="1920" fill="url(#bgGrad)"/>
  {img_bg_element}

  <rect width="1080" height="850" fill="url(#topVignette)"/>

  <g filter="url(#glow)">
    <rect x="54" y="64" width="270" height="66" rx="14" fill="{chip_bg}"/>
    <text x="189" y="108" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="28" font-weight="900" text-anchor="middle" fill="{chip_text}">{html.escape(lead_tag)}</text>
  </g>

  <g filter="url(#glow)">
    <rect x="740" y="64" width="286" height="66" rx="33" fill="#000000" fill-opacity="0.6" stroke="#FDE047" stroke-width="2"/>
    <text x="883" y="106" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="26" font-weight="700" text-anchor="middle" fill="#FEF08A">✨ {html.escape(prod_name)}</text>
  </g>

  <g filter="url(#glow)">
    {tspan_str}
  </g>

  <g filter="url(#glow)">
    <rect x="100" y="340" width="880" height="62" rx="31" fill="#FEF08A" stroke="#EAB308" stroke-width="3"/>
    <text x="540" y="382" font-family="Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="30" font-weight="900" text-anchor="middle" fill="#991B1B">💥 {html.escape(core_point)}</text>
  </g>

  <g filter="url(#glow)">
    {tags_svg}
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
    aspect_ratio: str = "9:16",
    size: str = "1024x1536",
    quality: str = "high",
) -> list[CoverResult]:
    """
    基于成片真实画面与音频口播卖点，为成片自动化提取 3 帧高清画面并进行 AI 图生图（img2img）生成竖版 9:16 4K 高画质爆款封面海报。
    - 智能分析音频提炼多组爆款大字标语。
    - 均匀从剪辑好的视频黄金展示区间（15%~85%）中采集 3 张不同时间点的高清代表帧。
    - 每一帧作为图生图独立底图（竖版 9:16 构图、4K 超清），调用 AI 生成爆款海报。
    - 若未配置 AI 密钥或生图异常，平滑降级为 9:16 4K 等比高清大字报 SVG（绝不遮挡面部，无伪UI按钮）。
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

    # 2. 均匀从成片视频黄金展示区间中抽取多张高清画面帧（默认 3 帧）
    extracted_frames: list[Path] = []
    if v_path and v_path.exists():
        extracted_frames = extract_multiple_video_frames(v_path, count=target_count, out_dir=out_dir)

    # 3. 如果配置了 AI 接口，使用真实截帧与音频智能提炼大字进行竖版 9:16 4K AI 图生图 (img2img)
    api_key = get_secret("catsapi_key", settings.catsapi_key)
    if api_key:
        def _render_ai_cover(i: int) -> CoverResult | None:
            # 适度微交错请求，避免同毫秒并发触发上游网关限频
            if i > 0:
                time.sleep(i * 0.5)

            with _IMAGE_GEN_SEMAPHORE:
                cur_text = headlines[i]
                frame_file = extracted_frames[i % len(extracted_frames)] if extracted_frames else None
                frame_b64 = _image_to_base64(frame_file) if frame_file else None

                prompt = build_live_cover_prompt(
                    headline=cur_text,
                    is_img2img=bool(frame_b64),
                    group_name=group_name,
                    style=style,
                    index=i,
                    aspect_ratio=aspect_ratio,
                )

                # 最多尝试 2 次，保障多图并发时的鲁棒性
                for attempt in range(2):
                    try:
                        task_id = catsapi.create_image_task(
                            prompt,
                            image_base64=frame_b64,
                            size=size or "1024x1536",
                            quality=quality or "high",
                        )
                        urls = catsapi.wait_for_images(task_id, timeout_seconds=180)
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
                    except Exception as exc:
                        logger.warning("AI生图第%d张(尝试%d)异常: %s", i + 1, attempt + 1, exc)
                        time.sleep(2.0)
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=target_count) as pool:
            futures = [pool.submit(_render_ai_cover, i) for i in range(target_count)]
            for fut in futures:
                res = fut.result()
                if res:
                    results.append(res)

    # 4. 若无 AI 密钥或 AI 接口异常，关联真实成片截帧与音频文案的高清 16:9 4K 大字报海报
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
                aspect_ratio=aspect_ratio,
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
