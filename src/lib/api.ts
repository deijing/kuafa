export type DurationPreference = "short" | "mid" | "long"

export type Material = {
  id: string
  group_id: string
  group_name: string
  filename: string
  title: string
  path: string
  duration: number
  duration_label: string
  width: number | null
  height: number | null
  size_bytes: number
  thumb_url: string | null
  source: "library"
}

export type MaterialGroup = {
  id: string
  name: string
  path: string
  material_count: number
  materials: Material[]
}

export type LibrarySettings = {
  materials_dir: string
  default_materials_dir: string
  is_custom: boolean
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed"

export type Job = {
  id: string
  batch_id?: string | null
  status: JobStatus
  progress: number
  message: string
  created_at: string
  finished_at: string | null
  output_url: string | null
  output_path: string | null
  duration: number | null
  material_ids: string[]
  group_id: string | null
  error: string | null
  headline?: string | null
  covers?: CoverResult[]
}

export type BgmItem = {
  filename: string
  title: string
  url: string
  size_bytes: number
  duration: number | null
  duration_label?: string
  created_at?: string
  is_default?: boolean
}

export type VideoQuality = "4k" | "2k" | "1080p" | "720p"

export type GeneratePayload = {
  material_ids: string[]
  group_id?: string | null
  batch_id?: string | null
  duration_preference: DurationPreference
  target_seconds?: number
  speech_speed?: number
  video_quality?: VideoQuality
  randomize_intro?: boolean
  subtitle_position?: "high" | "mid" | "low"
  add_captions: boolean
  add_sfx: boolean
  add_subtitles?: boolean
  add_bgm?: boolean
  bgm_volume?: number
  bgm_file?: string | null
  title?: string
  mode?: "sell" | "highlight"
  extract_rules?: Record<string, boolean>
  negative_words?: string[]
  filter_live_pitch?: boolean
  filter_price?: boolean
  variant_index?: number
  clips_per_video?: number | null
  shuffle_clips?: boolean
  deep_dedup?: boolean
}

export type BatchGeneratePayload = {
  group_id: string
  count: number
  batch_id?: string | null
  material_ids?: string[]
  duration_preference: DurationPreference
  target_seconds?: number
  speech_speed?: number
  video_quality?: VideoQuality
  randomize_intro?: boolean
  subtitle_position?: "high" | "mid" | "low"
  add_captions: boolean
  add_sfx: boolean
  add_subtitles?: boolean
  add_bgm?: boolean
  bgm_volume?: number
  bgm_file?: string | null
  title?: string | null
  mode?: "sell" | "highlight"
  extract_rules?: Record<string, boolean>
  negative_words?: string[]
  filter_live_pitch?: boolean
  filter_price?: boolean
  clips_per_video?: number | null
  shuffle_clips?: boolean
  deep_dedup?: boolean
}

export type BatchGenerateResult = {
  jobs: Job[]
}

export type CoverStyle =
  | "yellow-red"
  | "black-yellow"
  | "red-white"
  | "neon-cyber"
  | "clean-minimal"
  | "festive-gold"

export type CoverResult = {
  id: string
  url: string
  remote_url: string | null
  headline?: string | null
}

export type CoverJob = {
  id: string
  status: JobStatus
  progress: number
  message: string
  created_at: string
  finished_at: string | null
  headline: string
  style: string
  count: number
  results: CoverResult[]
  error: string | null
}

export type CoverMode = "text2img" | "img2img"
export type CoverSize = "1792x1024" | "1024x1536" | "1024x1024" | "1536x1024" | "1920x1080"
export type CoverQuality = "auto" | "high" | "medium" | "low"

export type CoverPayload = {
  headline: string
  style: CoverStyle
  count?: number
  mode?: CoverMode
  image_url?: string | null
  image_urls?: string[] | null
  material_id?: string | null
  size?: CoverSize
  quality?: CoverQuality
  rewrite_prompt?: boolean
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let detail: unknown = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? JSON.stringify(body)
    } catch {
      /* ignore */
    }
    const message = typeof detail === "string" ? detail : JSON.stringify(detail)
    throw new Error(message || "请求失败")
  }
  return res.json() as Promise<T>
}

export function fetchGroups() {
  return request<MaterialGroup[]>("/api/groups")
}

export function createGroup(name: string) {
  return request<MaterialGroup>("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export function renameGroup(groupId: string, name: string) {
  return request<MaterialGroup>(`/api/groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export function fetchLibrarySettings() {
  return request<LibrarySettings>("/api/settings/library")
}

export function updateLibrarySettings(materialsDir: string) {
  return request<LibrarySettings>("/api/settings/library", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ materials_dir: materialsDir }),
  })
}

export function resetLibrarySettings() {
  return request<LibrarySettings>("/api/settings/library/reset", {
    method: "POST",
  })
}

export function fetchMaterials() {
  return request<Material[]>("/api/materials")
}

export function getMaterialVideoUrl(id: string): string {
  return `/api/materials/${id}/video`
}

export function createGenerateJob(payload: GeneratePayload) {
  return request<Job>("/api/jobs/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function createBatchJobs(payload: BatchGeneratePayload) {
  return request<BatchGenerateResult>("/api/jobs/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function fetchJob(jobId: string) {
  return request<Job>(`/api/jobs/${jobId}`)
}

export function fetchJobs() {
  return request<Job[]>("/api/jobs")
}

export function generateJobCovers(
  jobId: string,
  headline?: string,
  count: number = 4,
  style: CoverStyle = "yellow-red"
) {
  return request<Job>(`/api/jobs/${jobId}/covers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ headline, count, style }),
  })
}

export function deleteJob(jobId: string) {
  return request<Job>(`/api/jobs/${jobId}`, { method: "DELETE" })
}

export async function exportJobsZip(jobIds: string[], includeCovers: boolean = true) {
  const res = await fetch("/api/jobs/export-zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_ids: jobIds, include_covers: includeCovers }),
  })
  if (!res.ok) {
    throw new Error("导出 ZIP 失败，请检查勾选的任务")
  }
  const blob = await res.blob()
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `kuafa_export_${new Date().getTime()}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => window.URL.revokeObjectURL(url), 10000)
}

export async function uploadMaterial(file: File, groupId: string) {
  const form = new FormData()
  form.append("file", file)
  form.append("group_id", groupId)
  return request<Material>("/api/materials/upload", {
    method: "POST",
    body: form,
  })
}

export async function uploadCoverReference(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<{ filename: string; url: string }>("/api/covers/upload-reference", {
    method: "POST",
    body: form,
  })
}

export type ExtractFramePayload = {
  video_url?: string | null
  job_id?: string | null
  material_id?: string | null
  timestamp?: number | null
}

export type ExtractFrameResult = {
  url: string
  filename: string
  timestamp: number
  duration: number
}

export function extractCoverFrame(payload: ExtractFramePayload) {
  return request<ExtractFrameResult>("/api/covers/extract-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export type ExtractHeadlinesPayload = {
  video_url?: string | null
  job_id?: string | null
  material_id?: string | null
  audio_text?: string | null
  group_name?: string | null
}

export type ExtractHeadlinesResult = {
  headlines: string[]
}

export function extractCoverHeadlines(payload: ExtractHeadlinesPayload) {
  return request<ExtractHeadlinesResult>("/api/covers/extract-headlines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function createCoverJob(payload: CoverPayload) {
  return request<CoverJob>("/api/covers/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function fetchCoverJob(jobId: string) {
  return request<CoverJob>(`/api/covers/jobs/${jobId}`)
}

export function fetchCoverJobs() {
  return request<CoverJob[]>("/api/covers/jobs")
}

export function deleteCoverJob(jobId: string) {
  return request<CoverJob>(`/api/covers/jobs/${jobId}`, { method: "DELETE" })
}

export function deleteCoverResult(jobId: string, resultId: string) {
  return request<{ status: string; job: CoverJob | null }>(
    `/api/covers/jobs/${jobId}/results/${resultId}`,
    { method: "DELETE" }
  )
}

export function clearCoverJobs() {
  return request<{ status: string; deleted_count: number }>(
    "/api/covers/clear",
    { method: "DELETE" }
  )
}


export type TranscriptionEngine = "local" | "bcut"

export type ApiSecrets = {
  catsapi_key_set: boolean
  catsapi_key_masked: string | null
  catsapi_base: string
  openai_api_key_set: boolean
  openai_api_key_masked: string | null
  openai_base_url: string
  openai_model: string
  openai_reasoning_effort: ReasoningEffort
  transcription_engine: TranscriptionEngine
  local_whisper_model: string
}

export type ReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"

export type UpdateApiSecretsPayload = {
  catsapi_key?: string | null
  catsapi_base?: string | null
  openai_api_key?: string | null
  openai_base_url?: string | null
  openai_model?: string | null
  openai_reasoning_effort?: ReasoningEffort | null
  transcription_engine?: TranscriptionEngine | null
  local_whisper_model?: string | null
}

export type TranscriptionTestPayload = {
  engine?: TranscriptionEngine | null
  model?: string | null
}

export type TranscriptionTestResult = {
  ok: boolean
  engine: string
  message: string
  latency_ms: number | null
  model: string | null
  preview_text: string | null
}

export function fetchApiSecrets() {
  return request<ApiSecrets>("/api/settings/secrets")
}

export function updateApiSecrets(payload: UpdateApiSecretsPayload) {
  return request<ApiSecrets>("/api/settings/secrets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function testTranscriptionConnection(payload: TranscriptionTestPayload) {
  return request<TranscriptionTestResult>("/api/settings/transcription/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export type OpenAIProbePayload = {
  api_key?: string | null
  base_url?: string | null
  model?: string | null
  reasoning_effort?: ReasoningEffort | null
}

export type OpenAIModelsResult = {
  models: string[]
}

export type OpenAITestResult = {
  ok: boolean
  message: string
  model: string | null
  latency_ms: number | null
  reply_preview: string | null
  reasoning_effort?: ReasoningEffort | null
}

export function fetchOpenAIModels(payload: OpenAIProbePayload) {
  return request<OpenAIModelsResult>("/api/settings/openai/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function testOpenAIConnection(payload: OpenAIProbePayload) {
  return request<OpenAITestResult>("/api/settings/openai/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export type CatsAPIProbePayload = {
  api_key?: string | null
  base_url?: string | null
}

export type CatsAPITestResult = {
  ok: boolean
  message: string
  latency_ms: number | null
}

export function testCatsAPIConnection(payload: CatsAPIProbePayload) {
  return request<CatsAPITestResult>("/api/settings/catsapi/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export type EnvCheckItem = {
  id: string
  name: string
  status: "pass" | "warn" | "fail"
  message: string
  detail: string | null
  fix_suggestion: string | null
}

export type EnvCheckResult = {
  passed: boolean
  critical_errors: number
  warnings: number
  items: EnvCheckItem[]
}

export function fetchEnvironmentCheck() {
  return request<EnvCheckResult>("/api/environment/check")
}

export function fetchBgmFiles() {
  return request<BgmItem[]>("/api/bgm")
}

export async function uploadBgm(file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<BgmItem>("/api/bgm/upload", {
    method: "POST",
    body: form,
  })
}

export async function deleteBgmFile(filename: string) {
  return request<{ status: string; deleted: string }>(`/api/bgm/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  })
}

export async function renameBgmFile(filename: string, newTitle: string) {
  return request<BgmItem>("/api/bgm/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, new_title: newTitle }),
  })
}

