import concurrent.futures
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
from app.services.covers import (
    generate_video_covers,
    select_best_cover_frames_from_clips,
    select_best_cover_frames_from_video,
)
from app.services.openai_client import has_openai_key


TARGET_SECONDS = {
    DurationPreference.short: 45.0,  # 默认 45 秒爆款短版
    DurationPreference.mid: 60.0,
    DurationPreference.long: 90.0,
}

_JOB_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")

# 全局成片渲染并发闸：批量成片最多同时跑 2 条，避免多路 FFmpeg + AI 并发打爆机器 CPU
_RUN_SEMAPHORE = threading.Semaphore(2)


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

            def on_progress(pct: int, message: str) -> None:
                self._update(
                    job_id,
                    progress=min(99, max(0, pct)),
                    message=message,
                    status=JobStatus.running,
                )

            if req.mode == "sell":
                engine = get_secret("transcription_engine", settings.transcription_engine or "local")
                local_model = get_secret("local_whisper_model", settings.local_whisper_model or "base")
                engine_label = f"本地 Whisper ({local_model})" if engine == "local" else "云端必剪 ASR"
                on_progress(3, f"{engine_label} 语音转写中（自然停顿断句，保持语意完整）…")
                transcribed = []
                total = len(materials)
                for idx, m in enumerate(materials):
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

                on_progress(32, "智能构建连贯话术段落（开场抓人→卖点种草→破价逼单）…")
                rules = ExtractRules.from_dict(
                    req.extract_rules,
                    negative_words=req.negative_words,
                    filter_live_pitch=req.filter_live_pitch,
                )
                plan = build_sell_plan(
                    transcribed,
                    target_seconds=raw_target,
                    rules=rules,
                    variant=req.variant_index,
                    randomize_intro=req.randomize_intro,
                )
                magic_cues = build_magic_cues(plan, variant=req.variant_index)

                if has_openai_key():
                    on_progress(33, "DeepSeek AI 智能编排连贯话术段落…")
                    candidates = collect_ai_candidates(transcribed, rules=rules)
                    judged = ai_judge_sell_plan(
                        candidates,
                        target_seconds=raw_target,
                        variant=req.variant_index,
                    )
                    if judged:
                        plan, magic_cues = judged
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
            if req.mode == "sell" and plan:
                audio_sentences = [clip.text.strip() for clip in plan if clip.text.strip()]
            elif magic_cues:
                audio_sentences = [cue.text.strip() for cue in magic_cues if cue.text.strip()]

            group = store.get_group(req.group_id) if req.group_id else None
            group_name = group.name if group else None

            # 提前精选高质量代表帧
            on_progress(35, "智能精选上镜高光帧，同步启动 AI 图生图…")
            job_cover_dir = settings.covers_dir / job_id
            if req.mode == "sell" and plan:
                best_frames = select_best_cover_frames_from_clips(plan, count=3, out_dir=job_cover_dir)
            else:
                best_frames = select_best_cover_frames_from_video(Path(materials[0].path), count=3, out_dir=job_cover_dir) if materials else []

            # 2. 启动后台线程并发生成 AI 封面（视频渲染与封面生图 100% 同步并行进行）
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as cover_pool:
                cover_future = cover_pool.submit(
                    generate_video_covers,
                    headline=None if req.mode == "sell" else req.title,
                    job_id=job_id,
                    pre_extracted_frames=best_frames,
                    audio_transcript=audio_sentences,
                    group_name=group_name,
                    count=3,
                    aspect_ratio="9:16",
                    size="1024x1536",
                    quality="high",
                )

                # 3. 主线程同步执行视频切割、字幕烧录与高画质编码渲染
                if req.mode == "sell":
                    duration = render_sell_video(
                        plan,
                        out_path,
                        add_subtitles=bool(add_subs),
                        add_bgm=bool(add_bgm),
                        bgm_volume=req.bgm_volume,
                        bgm_file=req.bgm_file,
                        magic_cues=magic_cues,
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

                # 4. 视频渲染完成，收拢并行生成的 AI 封面结果（此时封面已在后台生成完毕，无需额外等待）
                on_progress(96, "视频合成完成，同步合并高转化 AI 封面…")
                try:
                    covers = cover_future.result(timeout=200)
                except Exception:
                    covers = []

            final_headline = (covers[0].headline if covers and covers[0].headline else None) or req.title or "爆款带货 极速出片"

            self._update(
                job_id,
                status=JobStatus.succeeded,
                progress=100,
                message="成片及封面生成完成",
                headline=final_headline,
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
        finally:
            # 渲染结束（无论成功与否），清理中间剪辑工程目录 data/work/<job_id>
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
                grp = store.get_group(job.group_id)
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
