from __future__ import annotations

import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.models import (
    BatchGenerateOut,
    BatchGenerateRequest,
    DurationPreference,
    GenerateRequest,
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
from app.services.sell_planner import ExtractRules, build_magic_cues, build_sell_plan
from app.services.sell_renderer import render_sell_video
from app.services.transcription import TranscriptionError, transcribe_video
from app.services.ai_sell_judge import ai_judge_sell_plan, collect_ai_candidates
from app.services.covers import generate_video_covers
from app.services.openai_client import has_openai_key


TARGET_SECONDS = {
    DurationPreference.short: 35.0,
    DurationPreference.mid: 60.0,
    DurationPreference.long: 90.0,
}

_JOB_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        store.ensure_db()
        self._fail_interrupted()

    def _fail_interrupted(self) -> None:
        """进程重启后，把未完成的任务标为失败（个人工具：不自动重跑）。"""
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

    def list_jobs(self) -> list[JobOut]:
        with self._lock:
            return store.list_generate_jobs()

    def get(self, job_id: str) -> JobOut | None:
        with self._lock:
            return store.get_generate_job(job_id)

    def _update(self, job_id: str, **kwargs) -> None:
        with self._lock:
            job = store.get_generate_job(job_id)
            if not job:
                return
            store.upsert_generate_job(job.model_copy(update=kwargs))

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

            output = (settings.outputs_dir / f"{job_id}.mp4").resolve()
            outputs_root = settings.outputs_dir.resolve()
            if output.is_relative_to(outputs_root) and output.is_file():
                output.unlink(missing_ok=True)

            work_dir = (settings.work_dir / job_id).resolve()
            work_root = settings.work_dir.resolve()
            if work_dir.is_relative_to(work_root) and work_dir.is_dir():
                shutil.rmtree(work_dir, ignore_errors=True)

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
            status=JobStatus.queued,
            progress=0,
            message="任务已排队",
            created_at=now,
            material_ids=[m.id for m in materials],
            group_id=req.group_id or (materials[0].group_id if materials else None),
        )
        with self._lock:
            store.upsert_generate_job(job)

        thread = threading.Thread(
            target=self._run,
            args=(job_id, materials, req),
            daemon=True,
        )
        thread.start()
        return job

    def create_batch(self, req: BatchGenerateRequest) -> BatchGenerateOut:
        """从同一文件夹并行创建多条差异化带货成片任务。"""
        from app.services.materials import get_group

        group = get_group(req.group_id)
        material_ids = req.material_ids or [m.id for m in group.materials]
        if not material_ids:
            raise ValueError("该文件夹没有可用素材")

        base_title = req.title or f"{group.name} · 带货成片"
        created: list[JobOut] = []
        for i in range(req.count):
            title = base_title if req.count == 1 else f"{base_title} #{i + 1}"
            job = self.create(
                GenerateRequest(
                    material_ids=material_ids,
                    group_id=req.group_id,
                    duration_preference=req.duration_preference,
                    add_captions=req.add_captions,
                    add_sfx=req.add_sfx,
                    add_subtitles=req.add_subtitles,
                    add_bgm=req.add_bgm,
                    bgm_volume=req.bgm_volume,
                    bgm_file=req.bgm_file,
                    title=title,
                    mode=req.mode,
                    extract_rules=req.extract_rules,
                    variant_index=i,
                )
            )
            created.append(job)
        return BatchGenerateOut(jobs=created)

    def _run(self, job_id: str, materials, req: GenerateRequest) -> None:
        try:
            add_subs = (
                req.add_subtitles
                if req.add_subtitles is not None
                else req.add_captions
            )
            add_bgm = req.add_bgm if req.add_bgm is not None else req.add_sfx
            target = TARGET_SECONDS[req.duration_preference]
            out_path = settings.outputs_dir / f"{job_id}.mp4"

            def on_progress(pct: int, message: str) -> None:
                self._update(
                    job_id,
                    progress=min(99, max(0, pct)),
                    message=message,
                    status=JobStatus.running,
                )

            if req.mode == "sell":
                on_progress(3, "必剪 ASR 转写中（整句切分，避免切半字）…")
                transcribed = []
                total = len(materials)
                for idx, m in enumerate(materials):
                    on_progress(
                        3 + int(25 * idx / max(total, 1)),
                        f"转写素材 {idx + 1}/{total}…",
                    )
                    try:
                        segs = transcribe_video(Path(m.path), engine="bcut")
                    except TranscriptionError as exc:
                        self._update(
                            job_id,
                            message=f"转写跳过 {m.filename}: {exc}",
                        )
                        segs = []
                    transcribed.append((Path(m.path), segs))

                if not any(segs for _, segs in transcribed):
                    raise TranscriptionError(
                        "全部素材转写失败。默认使用必剪 ASR（bcut-asr 修复版）；"
                        "也可在设置中配置 OpenAI 兼容密钥作为 Whisper 回退"
                    )

                on_progress(32, "按带货结构选句（介绍→价格）…")
                rules = ExtractRules.from_dict(req.extract_rules)
                plan = build_sell_plan(
                    transcribed,
                    target_seconds=target,
                    rules=rules,
                    variant=req.variant_index,
                )
                magic_cues = build_magic_cues(plan, variant=req.variant_index)

                if has_openai_key():
                    on_progress(33, "DeepSeek AI 主观判断选句中…")
                    candidates = collect_ai_candidates(transcribed, rules=rules)
                    judged = ai_judge_sell_plan(
                        candidates,
                        target_seconds=target,
                        variant=req.variant_index,
                    )
                    if judged:
                        plan, magic_cues = judged
                        on_progress(34, "AI 已选定高转化句 + 神奇大字方案…")
                    else:
                        on_progress(34, "AI 未返回有效方案，已回退规则选句…")
                elif req.variant_index:
                    on_progress(
                        34,
                        f"差异化剪辑方案 #{req.variant_index + 1} 已生成…",
                    )

                if not plan:
                    raise ValueError("未能从口播中抽出可用句子")

                duration = render_sell_video(
                    plan,
                    out_path,
                    add_subtitles=bool(add_subs),
                    add_bgm=bool(add_bgm),
                    bgm_volume=req.bgm_volume,
                    bgm_file=req.bgm_file,
                    magic_cues=magic_cues,
                    on_progress=on_progress,
                )
            else:
                on_progress(5, "分析素材并抽样高光…")
                infos = [probe(Path(m.path)) for m in materials]
                plan = build_segment_plan(
                    infos,
                    target_total=target,
                    segment_len=settings.segment_seconds,
                )
                title = req.title if add_subs else None
                duration = render_highlight_reel(
                    plan,
                    out_path,
                    title=title,
                    on_progress=on_progress,
                )

            # 自动基于本成片视频提取卖点，生成配套封面大字报
            headline_text = ""
            if req.mode == "sell":
                if magic_cues and len(magic_cues) > 0:
                    headline_text = magic_cues[0].text
                elif plan and len(plan) > 0:
                    headline_text = plan[0].text
            if not headline_text:
                headline_text = req.title or "爆款切片 极速出片"

            on_progress(94, "基于视频核心卖点自动生成配套爆款封面…")
            try:
                covers = generate_video_covers(headline=headline_text, job_id=job_id, count=2)
            except Exception:
                covers = []

            self._update(
                job_id,
                status=JobStatus.succeeded,
                progress=100,
                message="成片及封面生成完成",
                headline=headline_text,
                covers=covers,
                finished_at=datetime.now(timezone.utc).isoformat(),
                output_url=f"/api/outputs/{job_id}.mp4",
                output_path=str(out_path),
                duration=duration,
            )
        except Exception as exc:  # noqa: BLE001
            self._update(
                job_id,
                status=JobStatus.failed,
                message="成片失败",
                error=str(exc),
                finished_at=datetime.now(timezone.utc).isoformat(),
            )


jobs = JobManager()
