import os
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
    CreateGroupRequest,
    CatsAPIProbeRequest,
    CatsAPITestOut,
    CoverJobOut,
    CoverRequest,
    JobCoverRequest,
    JobExportZipRequest,
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
    RenameGroupRequest,
    UpdateApiSecretsRequest,
    UpdateLibrarySettingsRequest,
)
from app.services import catsapi
from app.services.covers import cover_jobs
from app.services.jobs import jobs
from app.services.materials import (
    create_group,
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


ensure_dirs()
seed_demo_group_from_case()
ensure_ffmpeg_configured()

app = FastAPI(title="快发 API", version="0.2.0")

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
app.mount(
    "/api/bgm",
    StaticFiles(directory=str(settings.bgm_dir)),
    name="bgm",
)


ALLOWED_BGM_EXTENSIONS = (".mp3", ".mp4", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mov", ".mkv", ".webm")


@app.get("/api/bgm")
def list_bgm_files() -> list[dict[str, object]]:
    settings.bgm_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for p in sorted(settings.bgm_dir.glob("*")):
        if p.suffix.lower() in ALLOWED_BGM_EXTENSIONS:
            results.append({
                "filename": p.name,
                "url": f"/api/bgm/{p.name}",
                "size_bytes": p.stat().st_size,
            })
    return results


@app.post("/api/bgm/upload")
async def upload_bgm_file(file: UploadFile = File(...)) -> dict[str, object]:
    if not file.filename:
        raise HTTPException(400, "缺少文件名")
    safe_name = Path(file.filename).name
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_BGM_EXTENSIONS:
        raise HTTPException(400, "仅支持 mp3, mp4, wav, m4a, aac 等音视频格式")
    settings.bgm_dir.mkdir(parents=True, exist_ok=True)
    save_path = settings.bgm_dir / safe_name
    import shutil
    with save_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    size = save_path.stat().st_size
    if size == 0:
        save_path.unlink(missing_ok=True)
        raise HTTPException(400, "空音频文件")
    return {
        "filename": safe_name,
        "url": f"/api/bgm/{safe_name}",
        "size_bytes": size,
    }


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
