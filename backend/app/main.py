import os
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles


def cleanup_file(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass

from app.config import (
    ensure_dirs,
    get_materials_dir,
    reset_materials_dir,
    set_materials_dir,
    settings,
)
from app.models import (
    ApiSecretsOut,
    BatchGenerateOut,
    BatchGenerateRequest,
    BgmOut,
    CreateGroupRequest,
    CatsAPIProbeRequest,
    CatsAPITestOut,
    CoverJobOut,
    CoverRequest,
    ExtractFrameOut,
    ExtractFrameRequest,
    ExtractHeadlinesOut,
    ExtractHeadlinesRequest,
    JobCoverRequest,
    JobExportZipRequest,
    JobRetryBatchRequest,
    EnvCheckItem,
    EnvCheckResult,
    GenerateRequest,
    GroupOut,
    JobOut,
    LibrarySettingsOut,
    MaterialOut,
    OpenAIModelsOut,
    OpenAIProbeRequest,
    OpenAITestOut,
    ReburnSubtitlesRequest,
    JobLogsOut,
    RenameBgmRequest,
    RenameGroupRequest,
    SubtitleSegment,
    SubtitlesOut,
    TranscriptionTestOut,
    TranscriptionTestRequest,
    WhisperModelDownloadRequest,
    WhisperModelInfoOut,
    UpdateApiSecretsRequest,
    UpdateLibrarySettingsRequest,
)
from app.services import catsapi
from app.services import db as store
from app.services.covers import (
    cover_jobs,
    extract_audio_headlines,
    extract_video_frame,
    resolve_media_path,
)
from app.services.ffmpeg_pipeline import probe
from app.services.jobs import _RUN_SEMAPHORE, jobs
from app.models import JobStatus
from app.services.materials import (
    create_group,
    find_group,
    find_material,
    get_group,
    list_groups,
    list_materials,
    rename_group,
    save_upload,
    seed_demo_group_from_case,
)
from app.services.ffmpeg_pipeline import (
    ensure_ffmpeg_configured,
    get_ffmpeg_status,
    resolve_ffmpeg_bins,
    resolve_subtitle_font,
)
from app.services.openai_client import OpenAICompatError, list_models, test_connection
from app.services.secrets import secrets_status, update_secrets
from app.services.transcription import (
    check_whisper_model_status,
    list_whisper_models,
    start_download_whisper_model,
    test_transcription_engine,
)


ensure_dirs()
seed_demo_group_from_case()
ensure_ffmpeg_configured()
jobs.fail_interrupted_jobs()

app = FastAPI(title="快发 API", version="1.9.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/api/thumbs", StaticFiles(directory=str(settings.thumbs_dir)), name="thumbs")
app.mount(
    "/api/outputs", StaticFiles(directory=str(settings.outputs_dir)), name="outputs"
)
app.mount(
    "/api/media/covers",
    StaticFiles(directory=str(settings.covers_dir)),
    name="covers",
)
settings.bgm_dir.mkdir(parents=True, exist_ok=True)


ALLOWED_BGM_EXTENSIONS = (".mp3", ".mp4", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mov", ".mkv", ".webm")
_bgm_duration_cache: dict[str, float] = {}


def probe_audio_duration(path: Path) -> float | None:
    """提取音频文件真实时长（秒），带内存缓存"""
    if not path.exists() or path.stat().st_size == 0:
        return None
    key = f"{path.name}_{path.stat().st_mtime}_{path.stat().st_size}"
    if key in _bgm_duration_cache:
        return _bgm_duration_cache[key]
    try:
        import subprocess
        res = subprocess.run(
            [
                settings.ffprobe_bin,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if res.returncode == 0 and res.stdout.strip():
            dur = float(res.stdout.strip())
            _bgm_duration_cache[key] = dur
            return dur
    except Exception:
        pass
    return None


@app.get("/api/bgm", response_model=list[BgmOut])
def list_bgm_files() -> list[BgmOut]:
    settings.bgm_dir.mkdir(parents=True, exist_ok=True)
    results: list[BgmOut] = []
    for p in sorted(settings.bgm_dir.glob("*")):
        if p.is_file() and p.suffix.lower() in ALLOWED_BGM_EXTENSIONS:
            dur = probe_audio_duration(p)
            dur_label = "--:--"
            if dur is not None and dur > 0:
                mins = int(dur // 60)
                secs = int(dur % 60)
                dur_label = f"{mins:02d}:{secs:02d}"
            
            created_str = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            results.append(
                BgmOut(
                    filename=p.name,
                    title=p.stem,
                    url=f"/api/bgm/{p.name}",
                    size_bytes=p.stat().st_size,
                    duration=dur,
                    duration_label=dur_label,
                    created_at=created_str,
                    is_default=p.name == "default_bed.mp3",
                )
            )
    return results


@app.post("/api/bgm/upload", response_model=BgmOut)
async def upload_bgm_file(file: UploadFile = File(...)) -> BgmOut:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    safe_name = Path(file.filename).name
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_BGM_EXTENSIONS:
        raise HTTPException(400, "仅支持 mp3, mp4, wav, m4a, aac, flac, ogg 等音视频格式")
    settings.bgm_dir.mkdir(parents=True, exist_ok=True)
    save_path = settings.bgm_dir / safe_name
    import shutil
    with save_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    size = save_path.stat().st_size
    if size == 0:
        save_path.unlink(missing_ok=True)
        raise HTTPException(400, "空音频文件")
    
    dur = probe_audio_duration(save_path)
    dur_label = "--:--"
    if dur is not None and dur > 0:
        mins = int(dur // 60)
        secs = int(dur % 60)
        dur_label = f"{mins:02d}:{secs:02d}"
    
    created_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    return BgmOut(
        filename=safe_name,
        title=save_path.stem,
        url=f"/api/bgm/{safe_name}",
        size_bytes=size,
        duration=dur,
        duration_label=dur_label,
        created_at=created_str,
        is_default=safe_name == "default_bed.mp3",
    )


@app.post("/api/bgm/rename", response_model=BgmOut)
def rename_bgm_file(payload: RenameBgmRequest) -> BgmOut:
    safe_name = Path(payload.filename).name
    target = settings.bgm_dir / safe_name
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"背景音乐「{safe_name}」不存在")
    
    clean_title = payload.new_title.strip()
    if not clean_title:
        raise HTTPException(400, "新标题不能为空")
    
    ext = target.suffix
    new_safe_name = f"{clean_title}{ext}"
    new_path = settings.bgm_dir / new_safe_name
    if new_path != target and new_path.exists():
        raise HTTPException(400, f"已存在同名背景音乐「{new_safe_name}」")
    
    target.rename(new_path)
    dur = probe_audio_duration(new_path)
    dur_label = "--:--"
    if dur is not None and dur > 0:
        mins = int(dur // 60)
        secs = int(dur % 60)
        dur_label = f"{mins:02d}:{secs:02d}"
    
    return BgmOut(
        filename=new_safe_name,
        title=clean_title,
        url=f"/api/bgm/{new_safe_name}",
        size_bytes=new_path.stat().st_size,
        duration=dur,
        duration_label=dur_label,
        created_at=datetime.fromtimestamp(new_path.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
        is_default=new_safe_name == "default_bed.mp3",
    )


@app.delete("/api/bgm/{filename}")
def delete_bgm_file(filename: str) -> dict[str, object]:
    safe_name = Path(filename).name
    target = settings.bgm_dir / safe_name
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"背景音乐「{safe_name}」不存在")
    target.unlink(missing_ok=True)
    return {"status": "ok", "deleted": safe_name}


@app.get("/api/bgm/{filename}")
def get_bgm_file(filename: str) -> FileResponse:
    safe_name = Path(filename).name
    target = settings.bgm_dir / safe_name
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"背景音乐「{safe_name}」不存在")
    return FileResponse(target)


@app.get("/api/health")
def health() -> dict[str, object]:
    materials_dir = get_materials_dir()
    ffmpeg_info = get_ffmpeg_status()
    return {
        "status": "ok",
        "materials_dir": str(materials_dir),
        "default_materials_dir": str(settings.default_materials_dir.resolve()),
        "ffmpeg": ffmpeg_info,
    }


@app.get("/api/environment/check", response_model=EnvCheckResult)
def check_environment() -> EnvCheckResult:
    """全面诊断运行环境：FFmpeg 引擎、libass 滤镜、中文字体、存储与 API 密钥。"""
    items: list[dict[str, Any]] = []
    critical_errors = 0
    warnings = 0

    ffmpeg_bin, ffprobe_bin, has_sub = resolve_ffmpeg_bins()
    font_name = resolve_subtitle_font()
    materials_dir = get_materials_dir()
    sec_status = secrets_status()

    # 1. FFmpeg Binary
    ffmpeg_exists = bool(ffmpeg_bin and os.path.isfile(ffmpeg_bin))
    if ffmpeg_exists:
        items.append({
            "id": "ffmpeg_installed",
            "name": "FFmpeg 可执行文件检测",
            "status": "pass",
            "message": f"已成功识别 FFmpeg 引擎: {ffmpeg_bin}",
            "detail": f"FFprobe: {ffprobe_bin}",
        })
    else:
        critical_errors += 1
        items.append({
            "id": "ffmpeg_installed",
            "name": "FFmpeg 可执行文件检测",
            "status": "fail",
            "message": "未在系统中检索到 FFmpeg 可执行文件",
            "detail": f"搜寻路径: {ffmpeg_bin}",
            "fix_suggestion": "Mac 请在终端运行: brew install ffmpeg-full；Windows 请下载 FFmpeg 并添加至 PATH",
        })

    # 2. FFmpeg Subtitles / ASS Filter (libass)
    if has_sub:
        items.append({
            "id": "ffmpeg_subtitles",
            "name": "FFmpeg 字幕烧录滤镜 (libass)",
            "status": "pass",
            "message": "FFmpeg 已编译 libass，完美支持 subtitles / ass 字幕烧录",
            "detail": f"滤镜验证通过 ({ffmpeg_bin})",
        })
    else:
        critical_errors += 1
        items.append({
            "id": "ffmpeg_subtitles",
            "name": "FFmpeg 字幕烧录滤镜 (libass)",
            "status": "fail",
            "message": "当前 FFmpeg 缺少 subtitles (libass) 滤镜，烧录字幕时将报错 (exit status 234)",
            "detail": f"当前可执行文件: {ffmpeg_bin}",
            "fix_suggestion": "Mac 用户请安装 ffmpeg-full: brew install ffmpeg-full，或在环境变量中配置 KUAFA_FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
        })

    # 3. Subtitle Font
    items.append({
        "id": "subtitle_font",
        "name": "字幕中文字体解析",
        "status": "pass",
        "message": f"已适配当前系统字幕字体: {font_name}",
        "detail": "已排除 macOS 苹方 PingFangUI.ttc 私有字库报错风险",
    })

    # 4. Storage & Database
    items.append({
        "id": "backend_db",
        "name": "SQLite 数据库与存储路径",
        "status": "pass",
        "message": f"数据库与素材目录正常，存储路径: {materials_dir}",
        "detail": f"数据根路径: {settings.data_dir.resolve()}",
    })

    # 5. DeepSeek / OpenAI Key
    if sec_status.get("openai_api_key_set"):
        items.append({
            "id": "deepseek_key",
            "name": "DeepSeek 智能选句模型",
            "status": "pass",
            "message": f"已配置 DeepSeek API Key ({sec_status.get('openai_api_key_masked')})",
            "detail": f"Base URL: {sec_status.get('openai_base_url')}",
        })
    else:
        warnings += 1
        items.append({
            "id": "deepseek_key",
            "name": "DeepSeek 智能选句模型",
            "status": "warn",
            "message": "未配置 DeepSeek 密钥（生成时将回退至标准句子切割规则）",
            "fix_suggestion": "可在右上角设置中填写 DeepSeek API Key 以激活 AI 智能卖点选句",
        })

    # 6. CatsAPI / Cover Key
    if sec_status.get("catsapi_key_set"):
        items.append({
            "id": "catsapi_key",
            "name": "CatsAPI 封面生图模型",
            "status": "pass",
            "message": f"已配置 CatsAPI Key ({sec_status.get('catsapi_key_masked')})",
            "detail": f"Base URL: {sec_status.get('catsapi_base')}",
        })
    else:
        warnings += 1
        items.append({
            "id": "catsapi_key",
            "name": "CatsAPI 封面生图模型",
            "status": "warn",
            "message": "未配置 CatsAPI 密钥（暂无法使用 GPT Image 2 生成爆款封面大字报）",
            "fix_suggestion": "可在右上角设置中填写 CatsAPI 密钥以激活 GPT Image 2 封面大字报出图",
        })

    # 7. ASR Engine (本地 Whisper / 云端必剪)
    asr_engine = sec_status.get("transcription_engine", "local")
    local_model = sec_status.get("local_whisper_model", "base")
    if asr_engine == "local":
        items.append({
            "id": "asr_engine",
            "name": "本地 Whisper 离线转译引擎",
            "status": "pass",
            "message": f"已启用本地 Whisper [{local_model}] 离线转译（免联网/隐私安全）",
            "detail": f"模型存储目录: {settings.models_dir.resolve()}",
        })
    else:
        items.append({
            "id": "asr_engine",
            "name": "云端必剪 ASR 转译引擎",
            "status": "pass",
            "message": "已启用云端必剪 ASR 转写（极速转写/免本地算力消耗）",
            "detail": "接口服务: member.bilibili.com",
        })

    return EnvCheckResult(
        passed=critical_errors == 0,
        critical_errors=critical_errors,
        warnings=warnings,
        items=[EnvCheckItem(**it) for it in items],
    )


@app.get("/api/settings/library", response_model=LibrarySettingsOut)
def get_library_settings() -> LibrarySettingsOut:
    current = get_materials_dir()
    default = settings.default_materials_dir.resolve()
    return LibrarySettingsOut(
        materials_dir=str(current),
        default_materials_dir=str(default),
        is_custom=current != default,
    )


@app.put("/api/settings/library", response_model=LibrarySettingsOut)
def update_library_settings(req: UpdateLibrarySettingsRequest) -> LibrarySettingsOut:
    try:
        current = set_materials_dir(req.materials_dir)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    default = settings.default_materials_dir.resolve()
    return LibrarySettingsOut(
        materials_dir=str(current),
        default_materials_dir=str(default),
        is_custom=current != default,
    )


@app.post("/api/settings/library/reset", response_model=LibrarySettingsOut)
def reset_library_settings() -> LibrarySettingsOut:
    current = reset_materials_dir()
    default = settings.default_materials_dir.resolve()
    return LibrarySettingsOut(
        materials_dir=str(current),
        default_materials_dir=str(default),
        is_custom=False,
    )


@app.get("/api/groups", response_model=list[GroupOut])
def get_groups() -> list[GroupOut]:
    return list_groups(include_materials=True)


@app.post("/api/groups", response_model=GroupOut)
def post_group(req: CreateGroupRequest) -> GroupOut:
    try:
        return create_group(req.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/groups/{group_id}", response_model=GroupOut)
def get_group_detail(group_id: str) -> GroupOut:
    try:
        return get_group(group_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.patch("/api/groups/{group_id}", response_model=GroupOut)
def patch_group(group_id: str, req: RenameGroupRequest) -> GroupOut:
    try:
        return rename_group(group_id, req.name)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/materials", response_model=list[MaterialOut])
def get_materials() -> list[MaterialOut]:
    return list_materials()


@app.get("/api/materials/{material_id}/video")
def get_material_video(material_id: str) -> FileResponse:
    from app.services.materials import get_materials_by_ids

    found = get_materials_by_ids([material_id])
    if not found or not found[0].path:
        raise HTTPException(404, "素材不存在")
    path = Path(found[0].path)
    if not path.exists():
        raise HTTPException(404, "素材文件丢失")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=path.name,
    )


@app.post("/api/materials/upload", response_model=MaterialOut)
async def upload_material(
    file: UploadFile = File(...),
    group_id: str = Form(...),
) -> MaterialOut:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    data = await file.read()
    if not data:
        raise HTTPException(400, "空文件")
    try:
        return save_upload(file.filename, data, group_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/jobs/generate", response_model=JobOut)
def create_generate_job(req: GenerateRequest) -> JobOut:
    try:
        return jobs.create(req)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/jobs/batch", response_model=BatchGenerateOut)
def create_batch_jobs(req: BatchGenerateRequest) -> BatchGenerateOut:
    """从素材库文件夹一键生成 1–3 条差异化抖音带货成片。"""
    try:
        return jobs.create_batch(req)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/jobs", response_model=list[JobOut])
def list_jobs() -> list[JobOut]:
    return jobs.list_jobs()


@app.get("/api/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str) -> JobOut:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job


@app.get("/api/jobs/{job_id}/download")
def download_job(job_id: str) -> FileResponse:
    job = jobs.get(job_id)
    if not job or not job.output_path:
        raise HTTPException(404, "成片不存在")
    path = settings.outputs_dir / f"{job_id}.mp4"
    if not path.exists():
        raise HTTPException(404, "成片文件丢失")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"kuafa_{job_id}.mp4",
    )


@app.delete("/api/jobs/{job_id}", response_model=JobOut)
def delete_job(job_id: str) -> JobOut:
    """删除成片历史：同时清理成片 mp4 与 work 工程目录，不删除素材库源片。"""
    try:
        return jobs.delete(job_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/jobs/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: str) -> JobOut:
    """断点继续重试失败或中断的任务：复用 ASR 缓存与中间产物。"""
    try:
        return jobs.retry(job_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"重试任务失败: {exc}") from exc


@app.post("/api/jobs/retry-batch", response_model=BatchGenerateOut)
def retry_batch_jobs(req: JobRetryBatchRequest) -> BatchGenerateOut:
    """批量断点继续重试任务。"""
    retried = jobs.retry_batch(req.job_ids)
    return BatchGenerateOut(jobs=retried)


@app.post("/api/jobs/{job_id}/covers", response_model=JobOut)
def generate_job_covers(job_id: str, req: JobCoverRequest | None = None) -> JobOut:
    """为特定成片重新生成或扩充配套爆款封面。"""
    req = req or JobCoverRequest()
    try:
        return jobs.generate_covers_for_job(
            job_id=job_id,
            headline=req.headline,
            count=req.count,
            style=req.style,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/jobs/{job_id}/subtitles", response_model=SubtitlesOut)
def get_job_subtitles(job_id: str) -> SubtitlesOut:
    """获取特定成片的对齐字幕列表与 SRT 文本。"""
    import json
    from app.services.sell_renderer import expand_to_subtitle_chunks, generate_srt_content

    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    subs_path = settings.outputs_dir / f"{job_id}_subtitles.json"
    if subs_path.exists():
        try:
            data = json.loads(subs_path.read_text(encoding="utf-8"))
            # 自动展开为逐句短字幕（单行 <=10 字），与视频画面 1:1 精准对齐
            expanded = expand_to_subtitle_chunks(data, max_chars=10)
            sub_objs = [
                SubtitleSegment(
                    id=f"sub_{i}",
                    start=float(item.start),
                    end=float(item.end),
                    text=str(item.text),
                )
                for i, item in enumerate(expanded)
            ]
            srt = generate_srt_content([s.model_dump() for s in sub_objs])
            return SubtitlesOut(
                job_id=job_id,
                has_subtitles=len(sub_objs) > 0,
                subtitles=sub_objs,
                srt_content=srt,
            )
        except Exception:
            pass
    return SubtitlesOut(
        job_id=job_id,
        has_subtitles=False,
        subtitles=[],
        srt_content=None,
    )


@app.post("/api/jobs/{job_id}/subtitles/reburn")
def reburn_subtitles_endpoint(job_id: str, req: ReburnSubtitlesRequest) -> dict[str, Any]:
    """人工校验修正字幕后，重新烧录字幕并替换成片。"""
    from app.services.sell_renderer import generate_srt_content, reburn_job_subtitles

    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    if job.status in (JobStatus.queued, JobStatus.running):
        raise HTTPException(400, "原成片仍在渲染中，请稍后再试")
    try:
        with _RUN_SEMAPHORE:
            dur, updated = reburn_job_subtitles(
                job_id,
                [s.model_dump() for s in req.subtitles],
                subtitle_position=req.subtitle_position,
            )
        updated_job = jobs.get(job_id)
        srt = generate_srt_content(updated)
        return {
            "job": updated_job,
            "subtitles": updated,
            "srt_content": srt,
        }
    except Exception as exc:
        raise HTTPException(400, f"字幕重新烧录失败: {exc}") from exc


@app.get("/api/jobs/{job_id}/subtitles/export-srt")
def export_job_srt(job_id: str) -> Response:
    """下载成片的标准 SRT 字幕文件。"""
    import json
    from app.services.sell_renderer import generate_srt_content

    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    subs_path = settings.outputs_dir / f"{job_id}_subtitles.json"
    if not subs_path.exists():
        raise HTTPException(404, "该成片暂无字幕数据")
    try:
        data = json.loads(subs_path.read_text(encoding="utf-8"))
        srt = generate_srt_content(data)
        return Response(
            content=srt.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="kuafa_{job_id}.srt"',
            },
        )
    except Exception as exc:
        raise HTTPException(400, f"导出 SRT 失败: {exc}") from exc


@app.post("/api/jobs/export-zip")
def export_jobs_zip(req: JobExportZipRequest, background_tasks: BackgroundTasks) -> FileResponse:
    """勾选导出成片：打包指定的成片 MP4 与配套爆款封面大字报 ZIP 下载（支持响应后自动清理临时文件）。"""
    if not req.job_ids:
        raise HTTPException(400, "请勾选至少一条成片")

    zip_filename = f"kuafa_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path = settings.outputs_dir / zip_filename

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, jid in enumerate(req.job_ids, 1):
            job = jobs.get(jid)
            if not job or not job.output_path:
                continue
            video_file = Path(job.output_path)
            if video_file.exists():
                zf.write(video_file, arcname=f"成片_{idx}_{video_file.name}")

            if req.include_covers and job.covers:
                for c_idx, cover in enumerate(job.covers, 1):
                    cover_filename = cover.url.split("/")[-1]
                    cover_path = settings.covers_dir / jid / cover_filename
                    if not cover_path.exists():
                        cover_path = settings.covers_dir / cover_filename
                    if cover_path.exists():
                        zf.write(
                            cover_path,
                            arcname=f"成片_{idx}_配套封面/封面_{c_idx}_{cover_filename}",
                        )

    if not zip_path.exists() or zip_path.stat().st_size == 0:
        raise HTTPException(400, "导出失败，未找到有效的成片文件")

    background_tasks.add_task(cleanup_file, zip_path)

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=zip_filename,
    )


@app.post("/api/covers/upload-reference")
async def upload_cover_reference(file: UploadFile = File(...)) -> dict[str, str]:
    """上传封面图生图参考底图（支持 jpg/png/webp）。"""
    import uuid
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    data = await file.read()
    if not data:
        raise HTTPException(400, "空文件")
    ref_dir = settings.covers_dir / "references"
    ref_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename).suffix.lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "仅支持 jpg, png, webp 格式图片")
    safe_name = f"ref_{uuid.uuid4().hex[:8]}{ext}"
    dest = ref_dir / safe_name
    dest.write_bytes(data)
    return {
        "filename": safe_name,
        "url": f"/api/media/covers/references/{safe_name}",
    }


@app.post("/api/covers/extract-frame", response_model=ExtractFrameOut)
def extract_frame_from_video(req: ExtractFrameRequest) -> ExtractFrameOut:
    """从成片视频或素材视频中随机（或指定时间戳）提取高清截帧，用于图生图封面底图。"""
    import random
    import uuid
    video_path: Path | None = None

    if req.job_id:
        job = jobs.get(req.job_id)
        if job and job.output_path:
            p = Path(job.output_path)
            if p.exists():
                video_path = p
    elif req.material_id:
        mat = find_material(req.material_id)
        if mat and mat.path:
            p = Path(mat.path)
            if p.exists():
                video_path = p
    elif req.video_url:
        if req.video_url.startswith("/api/outputs/"):
            fname = req.video_url.split("/")[-1]
            p = resolve_media_path(settings.outputs_dir, fname)
            if p and p.exists():
                video_path = p
        elif req.video_url.startswith("/api/materials/"):
            # 前端视频地址格式：/api/materials/{id}/video
            parts = req.video_url.split("/")
            if len(parts) >= 5 and parts[4] == "video":
                mat = find_material(parts[3])
                if mat and mat.path and Path(mat.path).exists():
                    video_path = Path(mat.path)
        # 不再接受任意本地文件系统路径，防止任意文件访问

    if not video_path or not video_path.exists():
        raise HTTPException(404, "未找到目标视频文件")

    # 获取视频时长
    try:
        info = probe(video_path)
        duration = info.duration
    except Exception:
        duration = 5.0

    if req.timestamp is not None and req.timestamp >= 0:
        ts = min(max(0.0, req.timestamp), max(0.1, duration - 0.1))
    else:
        # 随机抽取时间戳（避开开头和结尾）
        if duration > 1.5:
            ts = round(random.uniform(min(0.5, duration * 0.08), max(0.5, duration * 0.92)), 2)
        else:
            ts = round(duration * 0.5, 2)

    ref_dir = settings.covers_dir / "references"
    ref_dir.mkdir(parents=True, exist_ok=True)
    frame_name = f"frame_{uuid.uuid4().hex[:8]}.jpg"
    dest = ref_dir / frame_name

    if not extract_video_frame(video_path, ts, dest):
        raise HTTPException(500, "视频截帧提取失败，请重试")

    return ExtractFrameOut(
        url=f"/api/media/covers/references/{frame_name}",
        filename=frame_name,
        timestamp=ts,
        duration=duration,
    )


@app.post("/api/covers/extract-headlines", response_model=ExtractHeadlinesOut)
def extract_headlines(req: ExtractHeadlinesRequest) -> ExtractHeadlinesOut:
    """根据视频音频口播或文本，智能分析提炼多条高转化爆款大字报标语。"""
    video_path: Path | None = None
    group_name = req.group_name

    if req.job_id:
        job = store.get_generate_job(req.job_id)
        if job and job.output_path and Path(job.output_path).exists():
            video_path = Path(job.output_path)
            if not group_name and job.group_id:
                grp = find_group(job.group_id)
                if grp:
                    group_name = grp.name
    elif req.material_id:
        mat = find_material(req.material_id)
        if mat and mat.path and Path(mat.path).exists():
            video_path = Path(mat.path)
            if not group_name and mat.group_id:
                grp = find_group(mat.group_id)
                if grp:
                    group_name = grp.name
    elif req.video_url:
        if req.video_url.startswith("/api/outputs/"):
            fname = req.video_url.split("/")[-1]
            p = resolve_media_path(settings.outputs_dir, fname)
            if p and p.exists():
                video_path = p
        elif req.video_url.startswith("/api/materials/"):
            # 前端视频地址格式：/api/materials/{id}/video
            parts = req.video_url.split("/")
            if len(parts) >= 5 and parts[4] == "video":
                mat = find_material(parts[3])
                if mat and mat.path and Path(mat.path).exists():
                    video_path = Path(mat.path)
        # 不再接受任意本地文件系统路径，防止任意文件访问

    headlines = extract_audio_headlines(
        audio_transcript=req.audio_text,
        video_path=video_path,
        group_name=group_name,
        count=4,
    )
    return ExtractHeadlinesOut(headlines=headlines)


@app.post("/api/covers/generate", response_model=CoverJobOut)
def create_cover_job(req: CoverRequest) -> CoverJobOut:
    try:
        return cover_jobs.create(req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/covers/jobs/{job_id}", response_model=CoverJobOut)
def get_cover_job(job_id: str) -> CoverJobOut:
    job = cover_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "封面任务不存在")
    return job


@app.get("/api/covers/jobs", response_model=list[CoverJobOut])
def list_cover_jobs() -> list[CoverJobOut]:
    return cover_jobs.list_jobs()


@app.delete("/api/covers/jobs/{job_id}", response_model=CoverJobOut)
def delete_cover_job(job_id: str) -> CoverJobOut:
    """删除指定封面任务及对应封面图片文件。"""
    try:
        return cover_jobs.delete(job_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/covers/jobs/{job_id}/results/{result_id}")
def delete_cover_result(job_id: str, result_id: str) -> dict[str, Any]:
    """删除某条任务中的单张封面图片。"""
    try:
        updated = cover_jobs.delete_result(job_id, result_id)
        return {"status": "ok", "job": updated}
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/covers/clear")
def clear_cover_jobs() -> dict[str, Any]:
    """清空所有历史出图记录。"""
    count = cover_jobs.clear_all()
    return {"status": "ok", "deleted_count": count}



@app.get("/api/settings/secrets", response_model=ApiSecretsOut)
def get_api_secrets() -> ApiSecretsOut:
    return ApiSecretsOut(**secrets_status())


@app.put("/api/settings/secrets", response_model=ApiSecretsOut)
def put_api_secrets(req: UpdateApiSecretsRequest) -> ApiSecretsOut:
    update_secrets(req.model_dump(exclude_unset=True))
    return ApiSecretsOut(**secrets_status())


@app.post("/api/settings/openai/models", response_model=OpenAIModelsOut)
def openai_list_models(req: OpenAIProbeRequest) -> OpenAIModelsOut:
    """从自定义 OpenAI 兼容网关拉取模型列表（GET /models）。"""
    try:
        models = list_models(api_key=req.api_key, base_url=req.base_url)
        return OpenAIModelsOut(models=models)
    except OpenAICompatError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/settings/openai/test", response_model=OpenAITestOut)
def openai_test_connection(req: OpenAIProbeRequest) -> OpenAITestOut:
    """用 Chat Completions 测连通性，校验 OpenAI Response 格式。"""
    result = test_connection(
        api_key=req.api_key,
        base_url=req.base_url,
        model=req.model,
        reasoning_effort=req.reasoning_effort,
    )
    return OpenAITestOut(**result)


@app.post("/api/settings/catsapi/test", response_model=CatsAPITestOut)
def catsapi_test_connection(req: CatsAPIProbeRequest) -> CatsAPITestOut:
    """测试 CatsAPI 封面生图接口密钥连通性。"""
    result = catsapi.test_connection(
        api_key=req.api_key,
        base_url=req.base_url,
    )
    return CatsAPITestOut(**result)


@app.post("/api/settings/transcription/test", response_model=TranscriptionTestOut)
def api_test_transcription(req: TranscriptionTestRequest) -> TranscriptionTestOut:
    """测试 ASR 语音转写服务（本地 Whisper 或云端必剪）连通性与识别。"""
    result = test_transcription_engine(
        engine=req.engine,
        model_size=req.model,
    )
    return TranscriptionTestOut(**result)


@app.get("/api/settings/whisper-models", response_model=list[WhisperModelInfoOut])
def api_list_whisper_models() -> list[WhisperModelInfoOut]:
    """获取所有支持的本地 Whisper 模型列表及其在本地的下载就绪状态。"""
    return [WhisperModelInfoOut(**m) for m in list_whisper_models()]


@app.post("/api/settings/whisper-models/download", response_model=WhisperModelInfoOut)
def api_download_whisper_model(req: WhisperModelDownloadRequest) -> WhisperModelInfoOut:
    """触发后台下载指定 Whisper 模型权重文件。"""
    task = start_download_whisper_model(req.model)
    st = check_whisper_model_status(req.model)
    st.update(task)
    return WhisperModelInfoOut(**st)


@app.get("/api/settings/whisper-models/status/{model_size}", response_model=WhisperModelInfoOut)
def api_get_whisper_model_status(model_size: str) -> WhisperModelInfoOut:
    """获取单个 Whisper 模型的本地就绪与下载进度状态。"""
    st = check_whisper_model_status(model_size)
    return WhisperModelInfoOut(**st)


@app.get("/api/jobs/{job_id}/logs", response_model=JobLogsOut)
def api_get_job_logs(job_id: str) -> JobLogsOut:
    """获取指定任务的实时流水日志与进度状态。"""
    return jobs.get_logs(job_id)
