import concurrent.futures
import logging
import re
import shutil
import threading
import uuid
import json
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.models import (
    BatchGenerateOut,
    BatchGenerateRequest,
    DurationPreference,
    GenerateRequest,
    JobLogEntry,
    JobLogsOut,
    JobOut,
    JobStatus,
)
from app.services import db as store
from app.services.ffmpeg_pipeline import (
    build_segment_plan,
    probe,
    render_highlight_reel,
)
from app.services.materials import get_materials_by_ids
from app.services.sell_planner import (
    ExtractRules,
    build_magic_cues,
    build_material_coverage_plan,
    build_sell_plan,
    claim_variant_opening,
    extract_narrative_blocks,
    splice_opening,
)
from app.services.sell_renderer import render_sell_video
from app.services.transcription import (
    TranscriptionError,
    has_transcription_cache,
    transcribe_video,
)
from app.services.ai_sell_judge import (
    ai_judge_material_coverage_plan,
    ai_judge_sell_plan,
    collect_ai_candidates,
)
from app.services.covers import (
    generate_video_covers,
    select_best_cover_frames_from_clips,
    select_best_cover_frames_from_video,
)
from app.services.openai_client import has_openai_key
from app.services.secrets import get_secret

logger = logging.getLogger(__name__)


TARGET_SECONDS = {
    DurationPreference.short: 45.0,  # 默认 45 秒爆款短版
    DurationPreference.mid: 60.0,
    DurationPreference.long: 90.0,
}

_JOB_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")

# 全局成片渲染并发闸：批量成片最多同时跑 2 条，避免多路 FFmpeg + AI 并发打爆机器 CPU
_RUN_SEMAPHORE = threading.Semaphore(2)


def _parse_iso(ts: str | None) -> datetime | None:
    text = (ts or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def processing_seconds_between(created_at: str | None, finished_at: str | None) -> float | None:
    start = _parse_iso(created_at)
    end = _parse_iso(finished_at)
    if not start or not end:
        return None
    secs = (end - start).total_seconds()
    if secs < 0:
        return None
    return round(secs, 1)


def hydrate_processing_seconds(job: JobOut) -> JobOut:
    """补全处理耗时：已落库的用原值；进行中的按当前时刻估算；旧记录用起止时间回填。"""
    if job.processing_seconds is not None:
        return job
    end = job.finished_at
    if not end and job.status in (JobStatus.queued, JobStatus.running):
        start = _parse_iso(job.created_at)
        if start:
            secs = max(0.0, (datetime.now(timezone.utc) - start).total_seconds())
            return job.model_copy(update={"processing_seconds": round(secs, 1)})
    if job.created_at and job.finished_at:
        secs = processing_seconds_between(job.created_at, job.finished_at)
        if secs is not None:
            return job.model_copy(update={"processing_seconds": secs})
    return job


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._job_logs: dict[str, list[JobLogEntry]] = {}
        store.ensure_db()

    def fail_interrupted_jobs(self) -> None:
        """应用启动时把上次残留的 running/queued 任务标记为 failed。"""
        with self._lock:
            now = datetime.now(timezone.utc).isoformat()
            for job in store.list_generate_jobs():
                if job.status in (JobStatus.queued, JobStatus.running):
                    store.upsert_generate_job(
                        job.model_copy(
                            update={
                                "status": JobStatus.failed,
                                "message": "服务重启，任务已中断",
                                "error": "interrupted_by_restart",
                                "finished_at": now,
                            }
                        )
                    )
                    self.add_log(job.id, "服务重启，未完成任务自动标记为已中断", level="warn", progress=job.progress)

    def add_log(
        self,
        job_id: str,
        message: str,
        level: str = "info",
        progress: int = 0,
    ) -> JobLogEntry:
        """记录任务实时日志，支持内存缓存与持久化落盘。"""
        now_utc = datetime.now(timezone.utc)
        time_label = datetime.now().strftime("%H:%M:%S")
        entry = JobLogEntry(
            timestamp=now_utc.isoformat(),
            time_label=time_label,
            level=level,
            progress=progress,
            message=message,
        )
        with self._lock:
            if job_id not in self._job_logs:
                self._job_logs[job_id] = []
                log_file = settings.outputs_dir / f"{job_id}_logs.json"
                if log_file.exists():
                    try:
                        raw = json.loads(log_file.read_text(encoding="utf-8"))
                        if isinstance(raw, list):
                            self._job_logs[job_id] = [JobLogEntry(**i) for i in raw]
                    except Exception:
                        pass
            self._job_logs[job_id].append(entry)

            try:
                log_file = settings.outputs_dir / f"{job_id}_logs.json"
                log_file.write_text(
                    json.dumps([e.model_dump() for e in self._job_logs[job_id]], ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            except Exception:
                pass
        return entry

    def get_logs(self, job_id: str) -> JobLogsOut:
        """获取单个成片任务的实时执行日志。"""
        with self._lock:
            entries = list(self._job_logs.get(job_id, []))
            if not entries:
                log_file = settings.outputs_dir / f"{job_id}_logs.json"
                if log_file.exists():
                    try:
                        raw = json.loads(log_file.read_text(encoding="utf-8"))
                        if isinstance(raw, list):
                            entries = [JobLogEntry(**i) for i in raw]
                            self._job_logs[job_id] = entries
                    except Exception:
                        pass

            job = store.get_generate_job(job_id)
            if not entries and job:
                entries = [
                    JobLogEntry(
                        timestamp=job.created_at,
                        time_label=_parse_iso(job.created_at).strftime("%H:%M:%S") if _parse_iso(job.created_at) else "00:00:00",
                        level="info" if job.status != JobStatus.failed else "error",
                        progress=job.progress,
                        message=job.message or ("任务已排队" if job.status == JobStatus.queued else "处理中…"),
                    )
                ]

            return JobLogsOut(
                job_id=job_id,
                status=job.status if job else JobStatus.queued,
                progress=job.progress if job else 0,
                message=job.message if job else "",
                created_at=job.created_at if job else datetime.now(timezone.utc).isoformat(),
                finished_at=job.finished_at if job else None,
                logs=entries,
            )

    def list_jobs(self) -> list[JobOut]:
        with self._lock:
            jobs = store.list_generate_jobs()
        return [hydrate_processing_seconds(job) for job in jobs]

    def get(self, job_id: str) -> JobOut | None:
        with self._lock:
            job = store.get_generate_job(job_id)
        return hydrate_processing_seconds(job) if job else None

    def _update(self, job_id: str, **kwargs) -> None:
        with self._lock:
            job = store.get_generate_job(job_id)
            if not job:
                return
            updated = job.model_copy(update=kwargs)
            if updated.finished_at and updated.processing_seconds is None:
                secs = processing_seconds_between(updated.created_at, updated.finished_at)
                if secs is not None:
                    updated = updated.model_copy(update={"processing_seconds": secs})
            store.upsert_generate_job(updated)

    def delete(self, job_id: str) -> JobOut:
        """删除成片记录，并清理成片 mp4 + work 工程目录（不碰素材库）。"""
        if not _JOB_ID_RE.match(job_id):
            raise ValueError("无效的任务 ID")

        with self._lock:
            job = store.get_generate_job(job_id)
            if not job:
                raise KeyError("任务不存在")
            if job.status in (JobStatus.queued, JobStatus.running):
                raise ValueError("任务进行中，请结束后再删除")

            outputs_root = settings.outputs_dir.resolve()
            for extra in (
                settings.outputs_dir / f"{job_id}.mp4",
                settings.outputs_dir / f"{job_id}_clean.mp4",
                settings.outputs_dir / f"{job_id}_subtitles.json",
                settings.outputs_dir / f"{job_id}_meta.json",
                settings.outputs_dir / f"{job_id}_thumb.jpg",
            ):
                extra_res = extra.resolve()
                if extra_res.is_relative_to(outputs_root) and extra_res.is_file():
                    extra_res.unlink(missing_ok=True)

            work_dir = (settings.work_dir / job_id).resolve()
            work_root = settings.work_dir.resolve()
            if work_dir.is_relative_to(work_root) and work_dir.is_dir():
                shutil.rmtree(work_dir, ignore_errors=True)

            covers_dir = (settings.covers_dir / job_id).resolve()
            covers_root = settings.covers_dir.resolve()
            if covers_dir.is_relative_to(covers_root) and covers_dir.is_dir():
                shutil.rmtree(covers_dir, ignore_errors=True)

            store.delete_generate_job(job_id)
            return job

    def create(self, req: GenerateRequest) -> JobOut:
        if req.material_ids:
            materials = get_materials_by_ids(req.material_ids)
        elif req.group_id:
            from app.services.materials import get_group

            materials = get_group(req.group_id).materials
        else:
            from app.services.materials import list_materials

            materials = list_materials()
        if not materials:
            raise ValueError("素材库为空，请先放入视频")

        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        job = JobOut(
            id=job_id,
            batch_id=req.batch_id,
            status=JobStatus.queued,
            progress=0,
            message="任务已排队",
            created_at=now,
            material_ids=[m.id for m in materials],
            group_id=req.group_id or (materials[0].group_id if materials else None),
            req_params=req.model_dump(),
        )
        with self._lock:
            store.upsert_generate_job(job)

        self.add_log(job_id, f"任务已创建并进入调度队列（共包含 {len(materials)} 个素材视频）", level="info", progress=0)

        thread = threading.Thread(
            target=self._run,
            args=(job_id, materials, req),
            daemon=True,
        )
        thread.start()
        return job

    def retry(self, job_id: str) -> JobOut:
        """断点继续重试任务：复用 ASR 缓存与已有数据，重新执行生成流水线。"""
        if not _JOB_ID_RE.match(job_id):
            raise ValueError("无效的任务 ID")

        with self._lock:
            job = store.get_generate_job(job_id)
            if not job:
                raise KeyError("任务不存在")
            if job.status == JobStatus.running:
                raise ValueError("任务正在运行中，无需重试")

            # 还原请求参数
            req: GenerateRequest | None = None
            if job.req_params:
                try:
                    req = GenerateRequest.model_validate(job.req_params)
                except Exception:
                    pass
            if not req:
                req = GenerateRequest(
                    group_id=job.group_id or "",
                    material_ids=job.material_ids,
                    headline=job.headline,
                    batch_id=job.batch_id,
                )

            if req.material_ids:
                materials = get_materials_by_ids(req.material_ids)
            elif req.group_id:
                from app.services.materials import get_group
                materials = get_group(req.group_id).materials
            else:
                from app.services.materials import list_materials
                materials = list_materials()

            if not materials:
                raise ValueError("相关素材已被移动或删除，无法重试")

            # 智能探测已有中间产物，直接按断点进度起跑
            out_path = settings.outputs_dir / f"{job_id}.mp4"
            work_dir = settings.work_dir / job_id
            clean_out = settings.outputs_dir / f"{job_id}_clean.mp4"

            init_progress = 0
            init_msg = "正在断点继续重试…"

            if out_path.exists() and out_path.stat().st_size > 50000:
                init_progress = 90
                init_msg = "检测到成片已生成，正在快速恢复…"
            elif (work_dir / "concat.mp4").exists() or clean_out.exists():
                init_progress = 75
                init_msg = "检测到拼接底片，断点继续…"
            elif work_dir.exists() and list(work_dir.glob("seg_*.mp4")):
                seg_count = len(list(work_dir.glob("seg_*.mp4")))
                init_progress = min(65, 35 + seg_count * 5)
                init_msg = f"检测到 {seg_count} 个已截取片段，断点继续…"
            elif all(has_transcription_cache(Path(m.path)) for m in materials):
                init_progress = 30
                init_msg = "已命中语音转写缓存，断点继续…"

            now = datetime.now(timezone.utc).isoformat()
            job = job.model_copy(update={
                "status": JobStatus.queued,
                "progress": init_progress,
                "message": init_msg,
                "error": None,
                "finished_at": None,
                "created_at": now,
                "processing_seconds": None,
                "req_params": req.model_dump(),
            })
            store.upsert_generate_job(job)

        self.add_log(job_id, f"触发任务断点继续重试（起始进度 {init_progress}%: {init_msg}）", level="info", progress=init_progress)

        thread = threading.Thread(
            target=self._run,
            args=(job_id, materials, req),
            daemon=True,
        )
        thread.start()
        return job

    def retry_batch(self, job_ids: list[str]) -> list[JobOut]:
        """批量重试失败任务。"""
        results: list[JobOut] = []
        for jid in job_ids:
            try:
                results.append(self.retry(jid))
            except Exception as exc:
                logger.warning("重试任务 %s 失败: %s", jid, exc)
        return results

    def create_batch(self, req: BatchGenerateRequest) -> BatchGenerateOut:
        """从同一文件夹并行创建多条差异化带货成片任务。支持按 N 个素材分组切片缝合与乱序降重。"""
        import math
        import random
        from app.services.materials import get_group

        group = get_group(req.group_id)
        all_materials = req.material_ids or [m.id for m in group.materials]
        if not all_materials:
            raise ValueError("该文件夹没有可用素材")

        total_available = len(all_materials)
        clips_per_video = req.clips_per_video

        # 计算生成的任务条数：若用户设置了按 N 段切片，且素材充足，可自动计算条数
        job_count = req.count
        if clips_per_video and clips_per_video > 0 and total_available > clips_per_video:
            chunk_count = math.ceil(total_available / clips_per_video)
            if req.count == 1:
                job_count = chunk_count

        base_title = req.title or f"{group.name} · 带货成片"
        batch_id = req.batch_id or f"batch_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        created: list[JobOut] = []

        # 自动加载背景音乐库列表，支持全自动轮播匹配
        bgm_candidates: list[str] = []
        if req.add_bgm:
            if req.bgm_file and req.bgm_file != "auto":
                bgm_candidates = [req.bgm_file]
            else:
                settings.bgm_dir.mkdir(parents=True, exist_ok=True)
                exts = (".mp3", ".mp4", ".wav", ".m4a", ".aac", ".flac", ".ogg")
                bgm_candidates = [
                    p.name
                    for p in sorted(settings.bgm_dir.glob("*"))
                    if p.is_file() and p.suffix.lower() in exts and p.name != "default_bed.mp3"
                ]
                if not bgm_candidates:
                    bgm_candidates = [
                        p.name
                        for p in sorted(settings.bgm_dir.glob("*"))
                        if p.is_file() and p.suffix.lower() in exts
                    ]

        for i in range(job_count):
            title = base_title if job_count == 1 else f"{base_title} #{i + 1}"

            # 1. 拆分素材组合 (Sub-chunking)
            if clips_per_video and clips_per_video > 0 and clips_per_video < total_available:
                start_idx = (i * clips_per_video) % total_available
                selected_chunk = all_materials[start_idx : start_idx + clips_per_video]
                if len(selected_chunk) < clips_per_video:
                    needed = clips_per_video - len(selected_chunk)
                    selected_chunk = selected_chunk + all_materials[:needed]
            else:
                selected_chunk = list(all_materials)

            # 2. 随机打乱素材次序 (Randomize sequence for anti-repetition)
            if req.shuffle_clips:
                rng = random.Random(i * 1009 + 42 + (77 if req.deep_dedup else 0))
                rng.shuffle(selected_chunk)

            # 3. 智能分配专属背景音乐 (Auto BGM rotation)
            variant_bgm = req.bgm_file
            if req.add_bgm:
                if req.bgm_file and req.bgm_file != "auto":
                    variant_bgm = req.bgm_file
                elif bgm_candidates:
                    variant_bgm = bgm_candidates[i % len(bgm_candidates)]

            job = self.create(
                GenerateRequest(
                    batch_id=batch_id,
                    material_ids=selected_chunk,
                    group_id=req.group_id,
                    duration_preference=req.duration_preference,
                    target_seconds=req.target_seconds,
                    speech_speed=req.speech_speed,
                    video_quality=req.video_quality,
                    randomize_intro=req.randomize_intro,
                    subtitle_position=req.subtitle_position,
                    add_captions=req.add_captions,
                    add_sfx=req.add_sfx,
                    add_subtitles=req.add_subtitles,
                    add_bgm=req.add_bgm,
                    bgm_volume=req.bgm_volume,
                    bgm_file=variant_bgm,
                    title=title,
                    mode=req.mode,
                    extract_rules=req.extract_rules,
                    negative_words=req.negative_words,
                    filter_live_pitch=req.filter_live_pitch,
                    filter_price=req.filter_price,
                    variant_index=i,
                    clips_per_video=req.clips_per_video,
                    shuffle_clips=req.shuffle_clips,
                    deep_dedup=req.deep_dedup,
                )
            )
            created.append(job)
        return BatchGenerateOut(jobs=created)

    def _run(self, job_id: str, materials, req: GenerateRequest) -> None:
        _RUN_SEMAPHORE.acquire()
        try:
            add_subs = (
                req.add_subtitles
                if req.add_subtitles is not None
                else req.add_captions
            )
            add_bgm = req.add_bgm if req.add_bgm is not None else req.add_sfx
            target = req.target_seconds or TARGET_SECONDS.get(req.duration_preference, 60.0)
            speech_speed = max(0.8, min(1.5, req.speech_speed))
            raw_target = target * speech_speed

            out_path = settings.outputs_dir / f"{job_id}.mp4"

            def on_progress(pct: int, message: str, level: str = "info") -> None:
                p = min(99, max(0, pct))
                self.add_log(job_id, message, level=level, progress=p)
                self._update(
                    job_id,
                    progress=p,
                    message=message,
                    status=JobStatus.running,
                )

            # 🚀 1. 检查成片是否已完整存在（例如之前仅在最后的元数据/大字报或接口返回阶段异常中断）
            if out_path.exists() and out_path.stat().st_size > 50000:
                try:
                    info = probe(out_path)
                    if info.duration > 1.0:
                        on_progress(95, "检测到成片已渲染完成，正在恢复成片与元数据…")
                        final_headline = req.title or "爆款带货 极速出片"
                        self._update(
                            job_id,
                            status=JobStatus.succeeded,
                            progress=100,
                            message="成片已从断点极速恢复完成",
                            headline=final_headline,
                            covers=[],
                            finished_at=datetime.now(timezone.utc).isoformat(),
                            output_url=f"/api/outputs/{job_id}.mp4",
                            output_path=str(out_path),
                            duration=info.duration,
                        )
                        return
                except Exception:
                    pass

            magic_cues = []
            if req.mode in ("sell", "material_stitch"):
                engine = get_secret("transcription_engine", settings.transcription_engine or "bcut")
                local_model = get_secret("local_whisper_model", settings.local_whisper_model or "base")
                engine_label = f"本地 Whisper ({local_model})" if engine == "local" else "云端必剪 ASR"
                
                # 检查是否全部已命中 ASR 缓存
                all_cached = all(has_transcription_cache(Path(m.path), engine=engine, model_size=local_model) for m in materials)
                if all_cached:
                    on_progress(30, "已命中本地语音转写缓存（跳过重复转译），断点继续…")
                else:
                    on_progress(3, f"{engine_label} 语音转写中（自然停顿断句，保持语意完整）…")

                transcribed = []
                total = len(materials)
                for idx, m in enumerate(materials):
                    if not all_cached:
                        on_progress(
                            3 + int(25 * idx / max(total, 1)),
                            f"[{engine_label}] 转写素材 {idx + 1}/{total}…",
                        )
                    try:
                        segs = transcribe_video(
                            Path(m.path),
                            engine=engine,
                            model_size=local_model,
                        )
                    except TranscriptionError as exc:
                        self._update(
                            job_id,
                            message=f"转写跳过 {m.filename}: {exc}",
                        )
                        segs = []
                    transcribed.append((Path(m.path), segs))

                if not any(segs for _, segs in transcribed):
                    raise TranscriptionError(
                        f"全部素材转写失败（当前模式：{engine_label}）。"
                        "请在右上角设置中切换「本地转译」或「云端必剪转译」模式后重试。"
                    )

                rules = ExtractRules.from_dict(
                    req.extract_rules,
                    negative_words=req.negative_words,
                    filter_live_pitch=req.filter_live_pitch,
                    filter_price=req.filter_price,
                )

                # 若包含多个素材（或显式指定 material_stitch 模式），必须确保所选全部 N 个素材 100% 全部出现在成片中
                if total > 1 or req.mode == "material_stitch":
                    on_progress(32, f"全素材多路智能分切（确保所选全部 {total} 个素材 100% 融入成片）…")
                    ai_res = None
                    if has_openai_key():
                        on_progress(33, f"DeepSeek AI 深度分析 {total} 个素材内容并智能规划全素材最佳叙事结构…")
                        ai_res = ai_judge_material_coverage_plan(
                            transcribed,
                            target_seconds=raw_target,
                            rules=rules,
                            variant=req.variant_index,
                        )
                    if ai_res:
                        plan, magic_cues = ai_res
                        on_progress(34, f"AI 已精选全部 {total} 个素材的黄金段落与连贯剧情…")
                    else:
                        plan = build_material_coverage_plan(
                            transcribed,
                            target_seconds=raw_target,
                            rules=rules,
                            variant=req.variant_index,
                            randomize_intro=req.randomize_intro,
                            batch_id=req.batch_id,
                        )
                        magic_cues = build_magic_cues(plan, variant=req.variant_index)
                        if req.variant_index:
                            on_progress(34, f"差异化全素材连贯方案 #{req.variant_index + 1} 已生成…")
                else:
                    on_progress(32, "智能构建单素材连贯话术段落（开场抓人→卖点种草→破价逼单）…")
                    all_blocks = extract_narrative_blocks(transcribed, rules=rules)
                    intro_pool = [b for b in all_blocks if b.role == "intro"] or all_blocks
                    opening = claim_variant_opening(
                        intro_pool,
                        variant=req.variant_index,
                        batch_id=req.batch_id,
                        randomize_intro=req.randomize_intro,
                    )
                    plan = build_sell_plan(
                        transcribed,
                        target_seconds=raw_target,
                        rules=rules,
                        variant=req.variant_index,
                        randomize_intro=req.randomize_intro,
                        forced_opening=opening,
                    )
                    magic_cues = build_magic_cues(plan, variant=req.variant_index)

                    if has_openai_key():
                        on_progress(33, "DeepSeek AI 智能编排连贯话术段落…")
                        candidates = collect_ai_candidates(transcribed, rules=rules)
                        judged = ai_judge_sell_plan(
                            candidates,
                            target_seconds=raw_target,
                            variant=req.variant_index,
                            preferred_opening=opening,
                        )
                        if judged:
                            plan, magic_cues = judged
                            plan = splice_opening(plan, opening)
                            on_progress(34, "AI 已精选完整连贯段落与神奇大字…")
                        else:
                            on_progress(34, "AI 未返回有效方案，已回退规则连贯段落…")
                    elif req.variant_index:
                        on_progress(
                            34,
                            f"差异化连贯剪辑方案 #{req.variant_index + 1} 已生成…",
                        )

                if not plan:
                    raise ValueError("未能从口播中抽出可用句子")
            else:
                on_progress(5, "分析素材并抽样高光…")
                infos = [probe(Path(m.path)) for m in materials]
                plan = build_segment_plan(
                    infos,
                    target_total=target,
                    segment_len=settings.segment_seconds,
                )

            # 1. 自动从口播提炼文案并根据画面美学评分精选 3 张最美观最上镜的高清代表关键帧
            audio_sentences = []
            if req.mode in ("sell", "material_stitch") and plan:
                audio_sentences = [clip.text.strip() for clip in plan if clip.text.strip()]
            elif magic_cues:
                audio_sentences = [cue.text.strip() for cue in magic_cues if cue.text.strip()]

            # 2. 主线程执行视频切割、字幕烧录与高画质编码渲染
            on_progress(35, "开始视频智能混剪与高画质编码渲染…")
            if req.mode in ("sell", "material_stitch"):
                duration = render_sell_video(
                    plan,
                    out_path,
                    add_subtitles=bool(add_subs),
                    add_bgm=bool(add_bgm),
                    bgm_volume=req.bgm_volume,
                    bgm_file=req.bgm_file,
                    magic_cues=magic_cues if add_subs else [],
                    speech_speed=speech_speed,
                    subtitle_position=req.subtitle_position,
                    video_quality=req.video_quality.value if hasattr(req.video_quality, "value") else str(req.video_quality),
                    on_progress=on_progress,
                )
            else:
                title = req.title if add_subs else None
                duration = render_highlight_reel(
                    plan,
                    out_path,
                    title=title,
                    on_progress=on_progress,
                )

            on_progress(98, "成片封装完成…")
            final_headline = req.title or "爆款带货 极速出片"

            self.add_log(job_id, f"成片封装完成！最终视频时长 {duration:.1f} 秒，视频文件已生成就绪", level="success", progress=100)

            self._update(
                job_id,
                status=JobStatus.succeeded,
                progress=100,
                message="成片生成完成",
                headline=final_headline,
                covers=[],
                finished_at=datetime.now(timezone.utc).isoformat(),
                output_url=f"/api/outputs/{job_id}.mp4",
                output_path=str(out_path),
                duration=duration,
            )
        except Exception as exc:  # noqa: BLE001
            self.add_log(job_id, f"成片生成异常中断: {exc}", level="error", progress=0)
            self._update(
                job_id,
                status=JobStatus.failed,
                message="成片失败",
                error=str(exc),
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
        finally:
            # 仅在渲染成功时清理中间剪辑工程目录 data/work/<job_id>
            # 若失败/中断则保留切片缓存，供后续「断点继续重试」秒级恢复已剪切片段
            job = store.get_generate_job(job_id)
            if job and job.status == JobStatus.succeeded:
                work_dir = settings.work_dir / job_id
                if work_dir.exists():
                    try:
                        shutil.rmtree(work_dir)
                    except Exception:
                        pass
            _RUN_SEMAPHORE.release()

    def generate_covers_for_job(
        self,
        job_id: str,
        headline: str | None = None,
        count: int = 3,
        style: str = "yellow-red",
    ) -> JobOut:
        # 1. 仅在获取任务记录时获取锁
        with self._lock:
            job = store.get_generate_job(job_id)
            if not job:
                raise KeyError("任务不存在")
            target_headline = (headline or job.headline or "").strip() or None
            video_path = Path(job.output_path) if job.output_path else None
            group_name = None
            if job.group_id:
                from app.services.materials import find_group
                grp = find_group(job.group_id)
                if grp:
                    group_name = grp.name

        # 2. 将耗时的 HTTP AI 接口生图请求移出锁范围
        new_covers = generate_video_covers(
            headline=target_headline,
            job_id=job_id,
            video_path=video_path,
            group_name=group_name,
            count=count,
            style=style,
            aspect_ratio="9:16",
            size="1024x1536",
            quality="high",
        )

        final_headline = (new_covers[0].headline if new_covers and new_covers[0].headline else None) or target_headline or "爆款带货 极速出片"

        # 3. 更新数据库记录时再次加锁（统一只保留 3 张全新封面）
        with self._lock:
            job = store.get_generate_job(job_id)
            if not job:
                raise KeyError("任务不存在")
            updated_covers = new_covers[:3]
            updated_job = job.model_copy(
                update={
                    "headline": final_headline,
                    "covers": updated_covers,
                }
            )
            store.upsert_generate_job(updated_job)
            return updated_job


jobs = JobManager()
