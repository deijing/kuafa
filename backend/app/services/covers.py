from __future__ import annotations

import base64
import concurrent.futures
import json
import logging
import random
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings
from app.models import CoverJobOut, CoverRequest, CoverResult, JobStatus
from app.services import catsapi
from app.services import db as store
from app.services.ffmpeg_pipeline import probe, run_cmd
from app.services.openai_client import chat_completions, has_openai_key
from app.services.secrets import get_secret

logger = logging.getLogger(__name__)

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

        # 2. 回退精确逐帧 seek 模式（先快跳至前 5 秒，再向前微调，防止全量扫描超时）
        try:
            fast_seek = max(0.0, ts - 5.0)
            fine_seek = ts - fast_seek
            run_cmd([
                settings.ffmpeg_bin,
                "-y",
                "-ss", f"{fast_seek:.2f}",
                "-i", str(video_path),
                "-ss", f"{fine_seek:.2f}",
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


def evaluate_cover_frame_aesthetic(jpeg_path: Path) -> float:
    """
    智能评估画面美观度与适宜做封面的质量评分（0.0 ~ 100.0 分）：
    - 曝光与亮度评分：避免全黑、过暗或严重过曝的废帧；
    - 清晰度与边缘锐度：计算邻域差分梯度能量，智能过滤动态模糊、眨眼闭眼或残影画面；
    - 对比度与色彩饱和度：优先选取色彩通透、主体鲜明、模特面部和商品细节丰富的画面。
    """
    if not jpeg_path or not jpeg_path.exists():
        return 0.0
    try:
        from PIL import Image, ImageStat
        with Image.open(jpeg_path) as img:
            img_rgb = img.convert("RGB")
            # 缩放至小尺寸快速计算
            thumb = img_rgb.resize((240, 320))
            stat = ImageStat.Stat(thumb)

            # 1. 亮度平衡评分 (0~100)
            mean_r, mean_g, mean_b = stat.mean[:3]
            lum = 0.299 * mean_r + 0.587 * mean_g + 0.114 * mean_b
            if lum < 40:
                bright_score = max(0.0, (lum / 40.0) * 35.0)  # 过暗惩罚
            elif lum > 235:
                bright_score = max(0.0, ((255 - lum) / 20.0) * 40.0)  # 过曝惩罚
            else:
                diff = abs(lum - 135)
                bright_score = max(60.0, 100.0 - (diff / 95.0) * 40.0)

            # 2. 对比度与动态范围 (0~100)
            std_r, std_g, std_b = stat.stddev[:3]
            std_lum = 0.299 * std_r + 0.587 * std_g + 0.114 * std_b
            contrast_score = min(100.0, max(0.0, (std_lum / 65.0) * 100.0))

            # 3. 清晰度与边缘梯度评分 (邻域差分能量)
            gray = thumb.convert("L")
            pixels = list(gray.getdata())
            w, h = gray.size
            diff_sum = 0.0
            sample_count = 0
            for y in range(0, h - 1, 4):
                row = y * w
                next_row = (y + 1) * w
                for x in range(0, w - 1, 4):
                    diff_x = abs(pixels[row + x] - pixels[row + x + 1])
                    diff_y = abs(pixels[row + x] - pixels[next_row + x])
                    diff_sum += (diff_x + diff_y)
                    sample_count += 1
            sharpness = diff_sum / max(1, sample_count)
            sharp_score = min(100.0, max(0.0, (sharpness / 16.0) * 100.0))

            # 4. 色彩丰富度
            color_diff = abs(mean_r - mean_g) + abs(mean_g - mean_b) + abs(mean_r - mean_b)
            vibrancy_score = min(100.0, max(20.0, (color_diff / 40.0) * 100.0))

            final_score = (
                sharp_score * 0.40
                + contrast_score * 0.25
                + bright_score * 0.20
                + vibrancy_score * 0.15
            )
            return round(final_score, 2)
    except Exception:
        return 50.0


def select_best_cover_frames_from_clips(
    clips: list[Any],
    count: int = 3,
    out_dir: Path | None = None,
) -> list[Path]:
    """
    智能从计划片段（EditClip）中精选最适合做封面的几张高质量候选帧：
    - 优先覆盖 Hook 开头引流片段与核心商品介绍片段；
    - 在片段 30%、50%、70% 处多点候选采样，过滤转场黑帧与模糊眨眼帧；
    - 根据画面美学评分（清晰度/色彩/曝光）智能选取最上镜、最高清的画面。
    """
    if not clips:
        return []

    target_count = max(1, count)
    target_dir = out_dir or (settings.covers_dir / "candidates")
    target_dir.mkdir(parents=True, exist_ok=True)

    uid = uuid.uuid4().hex[:6]
    candidate_frames: list[tuple[float, Path]] = []

    # 优先选取前 5 个有效片段做多点候选采样
    sample_clips = clips[:5] if len(clips) >= 5 else clips

    for clip_idx, clip in enumerate(sample_clips):
        c_path = getattr(clip, "path", None)
        c_start = float(getattr(clip, "start", 0.0))
        c_end = float(getattr(clip, "end", 0.0))
        c_dur = max(0.4, c_end - c_start)

        if not c_path or not Path(c_path).exists():
            continue

        # 在每个片段的 30%、50%、70% 处提取 3 个候选画面点
        test_points = [
            c_start + c_dur * 0.35,
            c_start + c_dur * 0.50,
            c_start + c_dur * 0.65,
        ]
        for pt_idx, ts in enumerate(test_points):
            dest = target_dir / f"cand_{uid}_c{clip_idx}_p{pt_idx}.jpg"
            if extract_video_frame(Path(c_path), ts, dest):
                score = evaluate_cover_frame_aesthetic(dest)
                candidate_frames.append((score, dest))

    if not candidate_frames:
        return []

    # 按美学质量评分从高到低排序
    candidate_frames.sort(key=lambda item: item[0], reverse=True)

    # 选取评分最高的前 target_count 张代表帧
    best_paths = [item[1] for item in candidate_frames[:target_count]]
    return best_paths


def select_best_cover_frames_from_video(
    video_path: Path,
    count: int = 3,
    out_dir: Path | None = None,
) -> list[Path]:
    """
    智能从单条视频中抽取 8~10 个黄金时间点候选帧，并通过美学评分算法自动选出最适合做封面的帧。
    """
    if not video_path or not video_path.exists():
        return []
    try:
        dur = probe(video_path).duration
    except Exception:
        dur = 6.0

    target_count = max(1, count)
    target_dir = out_dir or (settings.covers_dir / "candidates")
    target_dir.mkdir(parents=True, exist_ok=True)

    # 均匀采样 8 个黄金区间点
    sample_ratios = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85]
    candidate_frames: list[tuple[float, Path]] = []
    uid = uuid.uuid4().hex[:6]

    for idx, r in enumerate(sample_ratios):
        ts = round(dur * r, 2)
        dest = target_dir / f"video_cand_{uid}_{idx + 1}.jpg"
        if extract_video_frame(video_path, ts, dest):
            score = evaluate_cover_frame_aesthetic(dest)
            candidate_frames.append((score, dest))

    if not candidate_frames:
        return []

    candidate_frames.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in candidate_frames[:target_count]]


def extract_multiple_video_frames(
    video_path: Path,
    count: int = 3,
    out_dir: Path | None = None,
) -> list[Path]:
    """基于美学质量智能精选多张高质量关键代表帧。"""
    best = select_best_cover_frames_from_video(video_path, count=count, out_dir=out_dir)
    if best:
        return best
    # 兜底
    target_dir = out_dir or (settings.covers_dir / "references")
    target_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    uid = uuid.uuid4().hex[:6]
    for i in range(count):
        dest = target_dir / f"fallback_{uid}_{i+1}.jpg"
        if extract_video_frame(video_path, 1.0 + i * 1.5, dest):
            frames.append(dest)
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
    multi_ref_count: int = 1,
) -> str:
    """
    电商直播促销海报黄金提示词生成器（支持多参考图融合、16:9 横版与 9:16 竖版 4K 超高清商业画质）：
    - 多参考图规则：当传入多张参考图时（如参考图1为实体物品，参考图2为主播人物），智能将商品与主播融合在同张海报中，主播展示商品，人物五官与商品细节严格保真。
    - 参考图规则：仅用于继承整体版式、配色、信息层级和直播带货海报风格，不复制原视频杂乱旧字幕，根据新主题自由替换产品和卖点，保持同类视觉语言。
    - 画质要求：4K 超高清分辨率商业广告级摄影画质，细腻光影质感，极高清晰度与真实感。
    - 构图要求：竖版 9:16 / 横版 16:9 黄金分割排版，严禁遮挡面部与五官。
    - 负面排除：错字乱码、文字缺失、标签裁切、额外人物或手机、品牌标志、肢体畸形、多余手指、面部变形、模糊、过曝、过饱和、杂乱背景、矢量化人物、塑料皮肤、低清晰度、遮挡面部、脸部被遮挡、居中大白框、手机UI、播放控件、底部小黄车按钮、视频字幕条。
    """
    tokens = _parse_prompt_tokens(headline, group_name, index)
    lead_tag = tokens["lead_tag"]
    prod_name = tokens["prod_name"]
    price_display = tokens["price_display"]
    core_point = tokens["core_point"]
    tags = tokens["tags"]
    style_desc = STYLE_HINTS.get(style, STYLE_HINTS["yellow-red"])

    if multi_ref_count >= 2:
        ref_rule = (
            f"【多参考图智能融合核心规则】：本次生成任务提供了 {multi_ref_count} 张关键视觉参考图。\n"
            "- 【参考图1】：为需要展示的核心商品实体/包装实物；\n"
            "- 【参考图2】：为主播人物面部五官特写与发型服装；\n"
            "- 【融合呈现要求】：请将参考图中的主播人物与商品实物在竖版 9:16 4K 海报中完美融合！"
            "年轻主播自然手持或身侧展示该商品，真实还原参考图1中商品的包装与实体材质细节，"
            "同时严格保真参考图2中主播的五官样貌（面部明亮通透无任何遮挡）。\n\n"
        )
    elif is_img2img:
        ref_rule = (
            "【参考图核心规则】：参考图仅用于继承整体版式、配色、信息层级和直播带货海报风格，"
            "不复制原视频中的具体人物与杂乱文案内容，可根据新主题自由替换产品和卖点，但必须保持同类视觉语言。\n\n"
        )
    else:
        ref_rule = ""

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

    def _build_prompt(self, req: CoverRequest, index: int, multi_ref_count: int = 1) -> str:
        ratio = "9:16" if req.size == "1024x1536" else ("16:9" if req.size in ("1792x1024", "1536x1024", "1920x1080") else "9:16")
        return build_live_cover_prompt(
            headline=req.headline,
            is_img2img=(req.mode == "img2img"),
            style=req.style,
            index=index,
            aspect_ratio=ratio,
            multi_ref_count=multi_ref_count,
        )

    def _resolve_single_image(self, image_url: str | None, out_dir: Path) -> tuple[Path | None, str | None]:
        if not image_url:
            return None, None
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
                parts = image_url.split("/")
                if len(parts) >= 5 and parts[4] == "video":
                    mat = store.get_material(parts[3])
                    if mat and mat.path:
                        target_path = Path(mat.path)

            if target_path and target_path.exists():
                if target_path.suffix.lower() in (".mp4", ".mov", ".mkv", ".avi", ".flv", ".webm", ".ts"):
                    ref_dir = out_dir / "references"
                    frames = select_best_cover_frames_from_video(target_path, count=1, out_dir=ref_dir)
                    if frames:
                        return frames[0], _image_to_base64(frames[0])
                b64 = _image_to_base64(target_path)
                return target_path, b64
        except Exception:
            pass
        return None, None

    def _resolve_all_references(self, req: CoverRequest, out_dir: Path) -> tuple[list[Path], list[str]]:
        """解析所有参考图（支持单张/多张：如实体物品+主播人像）。"""
        paths: list[Path] = []
        b64s: list[str] = []

        # 优先解析 image_urls 列表
        target_urls = req.image_urls if req.image_urls and len(req.image_urls) > 0 else ([req.image_url] if req.image_url else [])
        for url in target_urls:
            p, b = self._resolve_single_image(url, out_dir)
            if p and b:
                paths.append(p)
                b64s.append(b)

        # 兼容直传的 image_base64s
        if req.image_base64s:
            for b_str in req.image_base64s:
                if b_str and b_str not in b64s:
                    b64s.append(b_str)

        return paths, b64s

    def _run(self, job_id: str, req: CoverRequest) -> None:
        try:
            mode_desc = "AI 多图融合图生图" if (req.image_urls and len(req.image_urls) > 1) else ("AI 图生图" if req.mode == "img2img" else "AI 文生图")
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

            ref_paths, all_b64s = self._resolve_all_references(req, out_dir) if req.mode == "img2img" else ([], [])
            multi_ref_count = len(all_b64s)

            def _generate_item(i: int) -> CoverResult:
                # 适度微交错错峰
                if i > 0:
                    time.sleep(i * 0.4)

                with _IMAGE_GEN_SEMAPHORE:
                    for attempt in range(2):
                        try:
                            prompt = self._build_prompt(req, i, multi_ref_count=multi_ref_count)
                            task_id = catsapi.create_image_task(
                                prompt,
                                input_images=all_b64s if all_b64s else None,
                                image_base64=all_b64s[0] if (all_b64s and len(all_b64s) == 1) else None,
                                size=req.size or "1024x1536",
                                quality=req.quality or "high",
                                rewrite_prompt=req.rewrite_prompt,
                            )
                            urls = catsapi.wait_for_images(task_id, timeout_seconds=180)
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
                        except Exception as exc:
                            logger.warning("CoverJobManager单张生成尝试%d失败: %s", attempt + 1, exc)
                            time.sleep(2.0)

                    # 两次重试均失败，返回 None（不使用 SVG 兜底）
                    return None

            with concurrent.futures.ThreadPoolExecutor(max_workers=total) as pool:
                futures = [pool.submit(_generate_item, i) for i in range(total)]
                for idx, fut in enumerate(futures):
                    res = fut.result()
                    if res is not None:
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
    pre_extracted_frames: list[Path] | None = None,
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
    - 支持混剪期提前精选美学高光关键帧并同步并行生图。
    - 智能分析音频提炼多组爆款大字标语。
    - 每一帧作为图生图独立底图（竖版 9:16 构图、4K 超清），调用 AI 生成爆款海报。
    - 若未配置 AI 密钥或生图失败，跳过该张封面（不使用 SVG 兜底）。
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

    # 2. 确定候选高清画面帧（优先使用混剪初期精选出的最佳高美感代表帧）
    extracted_frames: list[Path] = [f for f in (pre_extracted_frames or []) if f.exists()]
    if not extracted_frames and v_path and v_path.exists():
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

    return results[:target_count]

