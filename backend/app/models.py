from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class DurationPreference(str, Enum):
    short = "short"
    mid = "mid"
    long = "long"


class MaterialOut(BaseModel):
    id: str
    group_id: str
    group_name: str
    filename: str
    title: str
    path: str
    duration: float
    duration_label: str
    width: int | None = None
    height: int | None = None
    size_bytes: int
    thumb_url: str | None = None
    source: Literal["library"] = "library"


class GroupOut(BaseModel):
    id: str
    name: str
    path: str
    material_count: int
    materials: list[MaterialOut] = Field(default_factory=list)


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RenameGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class LibrarySettingsOut(BaseModel):
    materials_dir: str
    default_materials_dir: str
    is_custom: bool


class UpdateLibrarySettingsRequest(BaseModel):
    materials_dir: str = Field(min_length=1)


class GenerateRequest(BaseModel):
    material_ids: list[str] = Field(default_factory=list)
    group_id: str | None = None
    duration_preference: DurationPreference = DurationPreference.mid
    add_captions: bool = True  # 口播字幕
    add_sfx: bool = True  # 背景音乐
    add_subtitles: bool | None = None
    add_bgm: bool | None = None
    bgm_volume: int = Field(default=25, ge=0, le=100)  # 音量 0-100%
    bgm_file: str | None = None  # 上传或选中的背景音乐文件名
    title: str = "限时特惠 · 直播高光合集"
    mode: Literal["sell", "highlight"] = "sell"
    # bargain / detail / silence — 混剪规则勾选
    extract_rules: dict[str, bool] | None = None
    # 批量成片：同素材池生成差异化版本（0=默认，1/2…换句序与侧重）
    variant_index: int = Field(default=0, ge=0, le=9)


class BatchGenerateRequest(BaseModel):
    """一次从同一素材文件夹生成多条差异化带货成片。"""

    group_id: str
    count: int = Field(default=1, ge=1, le=3)
    material_ids: list[str] = Field(default_factory=list)
    duration_preference: DurationPreference = DurationPreference.mid
    add_captions: bool = True
    add_sfx: bool = True
    add_subtitles: bool | None = None
    add_bgm: bool | None = None
    bgm_volume: int = Field(default=25, ge=0, le=100)
    bgm_file: str | None = None
    title: str | None = None
    mode: Literal["sell", "highlight"] = "sell"
    extract_rules: dict[str, bool] | None = None


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class CoverStyle(str, Enum):
    yellow_red = "yellow-red"
    black_yellow = "black-yellow"
    red_white = "red-white"
    neon_cyber = "neon-cyber"
    clean_minimal = "clean-minimal"
    festive_gold = "festive-gold"


class CoverRequest(BaseModel):
    headline: str = Field(min_length=1, max_length=120)
    style: CoverStyle = CoverStyle.yellow_red
    count: int = Field(default=4, ge=1, le=6)
    mode: Literal["ai", "template"] = "ai"


class CoverResult(BaseModel):
    id: str
    url: str
    remote_url: str | None = None


class CoverJobOut(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    message: str = ""
    created_at: str
    finished_at: str | None = None
    headline: str = ""
    style: str = "yellow-red"
    count: int = 4
    results: list[CoverResult] = Field(default_factory=list)
    error: str | None = None


class ApiSecretsOut(BaseModel):
    catsapi_key_set: bool
    catsapi_key_masked: str | None = None
    catsapi_base: str
    openai_api_key_set: bool
    openai_api_key_masked: str | None = None
    openai_base_url: str
    openai_model: str
    # OpenAI GPT：none | low | medium | high | xhigh | max
    openai_reasoning_effort: str = "medium"


class UpdateApiSecretsRequest(BaseModel):
    # None = unchanged; "" = clear runtime override
    catsapi_key: str | None = None
    catsapi_base: str | None = None
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str | None = None
    openai_reasoning_effort: str | None = None


class OpenAIProbeRequest(BaseModel):
    """获取模型 / 测试连接：可用表单临时值，未填则用已保存配置。"""

    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    reasoning_effort: str | None = None


class OpenAIModelsOut(BaseModel):
    models: list[str] = Field(default_factory=list)


class OpenAITestOut(BaseModel):
    ok: bool
    message: str
    model: str | None = None
    latency_ms: int | None = None
    reply_preview: str | None = None
    reasoning_effort: str | None = None


class CatsAPIProbeRequest(BaseModel):
    api_key: str | None = None
    base_url: str | None = None


class CatsAPITestOut(BaseModel):
    ok: bool
    message: str
    latency_ms: int | None = None


class EnvCheckItem(BaseModel):
    id: str
    name: str
    status: Literal["pass", "warn", "fail"]
    message: str
    detail: str | None = None
    fix_suggestion: str | None = None


class EnvCheckResult(BaseModel):
    passed: bool
    critical_errors: int
    warnings: int
    items: list[EnvCheckItem]


class JobOut(BaseModel):
    id: str
    status: JobStatus
    progress: int = 0
    message: str = ""
    created_at: str
    finished_at: str | None = None
    output_url: str | None = None
    output_path: str | None = None
    duration: float | None = None
    material_ids: list[str] = Field(default_factory=list)
    group_id: str | None = None
    error: str | None = None
    headline: str | None = None
    covers: list[CoverResult] = Field(default_factory=list)


class BatchGenerateOut(BaseModel):
    jobs: list[JobOut] = Field(default_factory=list)
