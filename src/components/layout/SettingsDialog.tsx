import { useEffect, useState } from "react"
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Cpu,
  ExternalLink,
  HardDrive,
  History,
  ImageIcon,
  Mic,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react"

import { ChangelogDialog } from "@/components/layout/ChangelogDialog"
import { APP_VERSION } from "@/data/changelog"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  fetchApiSecrets,
  fetchOpenAIModels,
  testCatsAPIConnection,
  testOpenAIConnection,
  testTranscriptionConnection,
  updateApiSecrets,
  type ApiSecrets,
  type CatsAPITestResult,
  type OpenAITestResult,
  type ReasoningEffort,
  type TranscriptionEngine,
  type TranscriptionTestResult,
} from "@/lib/api"

const REASONING_EFFORTS: {
  value: ReasoningEffort
  label: string
}[] = [
    { value: "none", label: "none" },
    { value: "low", label: "low" },
    { value: "medium", label: "medium" },
    { value: "high", label: "high" },
    { value: "xhigh", label: "xhigh" },
    { value: "max", label: "max" },
  ]

const LOCAL_WHISPER_MODELS: {
  value: string
  label: string
  desc: string
}[] = [
    { value: "tiny", label: "tiny · 极速轻量 (~75MB)", desc: "极速秒转 · 适合快速初剪与低配设备" },
    { value: "base", label: "base · 均衡推荐 (~140MB)", desc: "速度与精度兼顾 · 默认推荐" },
    { value: "small", label: "small · 高精增强 (~460MB)", desc: "复杂口音与嘈杂背景识别更准" },
    { value: "medium", label: "medium · 专业进阶 (~1.5GB)", desc: "专业高精度输出" },
    { value: "large-v3", label: "large-v3 · 旗舰顶配 (~3GB)", desc: "最高准确率与完整语义" },
  ]

function normalizeEffort(raw: string | null | undefined): ReasoningEffort {
  if (raw === "off" || raw === "disabled") return "none"
  if (
    raw === "none" ||
    raw === "low" ||
    raw === "medium" ||
    raw === "high" ||
    raw === "xhigh" ||
    raw === "max"
  ) {
    return raw
  }
  return "medium"
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [status, setStatus] = useState<ApiSecrets | null>(null)

  // 语音转译 ASR 模式
  const [transcriptionEngine, setTranscriptionEngine] =
    useState<TranscriptionEngine>("local")
  const [localWhisperModel, setLocalWhisperModel] = useState("base")
  const [testingTranscription, setTestingTranscription] = useState(false)
  const [transcriptionTestResult, setTranscriptionTestResult] =
    useState<TranscriptionTestResult | null>(null)

  // 封面与 LLM 密钥
  const [catsapiKey, setCatsapiKey] = useState("")
  const [catsapiBase, setCatsapiBase] = useState("")
  const [openaiKey, setOpenaiKey] = useState("")
  const [openaiBase, setOpenaiBase] = useState("")
  const [openaiModel, setOpenaiModel] = useState("")
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("medium")

  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelsFetched, setModelsFetched] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<OpenAITestResult | null>(null)
  const [testingCatsapi, setTestingCatsapi] = useState(false)
  const [catsapiTestResult, setCatsapiTestResult] = useState<CatsAPITestResult | null>(null)

  useEffect(() => {
    if (!open) return
    // 延迟到宏任务，避免在 effect 内同步触发 setState 造成级联渲染
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      setOk(null)
      setTestResult(null)
      setCatsapiTestResult(null)
      setTranscriptionTestResult(null)
      setModelOptions([])
      setModelsFetched(false)
      setCatsapiKey("")
      setOpenaiKey("")
      void fetchApiSecrets()
        .then((data) => {
          setStatus(data)
          setTranscriptionEngine(data.transcription_engine || "local")
          setLocalWhisperModel(data.local_whisper_model || "base")
          setCatsapiBase(data.catsapi_base)
          setOpenaiBase(data.openai_base_url)
          setOpenaiModel(data.openai_model)
          setReasoningEffort(normalizeEffort(data.openai_reasoning_effort))
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "加载设置失败")
        })
        .finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  function catsapiProbePayload() {
    return {
      api_key: catsapiKey.trim() || null,
      base_url: catsapiBase.trim() || null,
    }
  }

  function openaiProbePayload() {
    return {
      api_key: openaiKey.trim() || null,
      base_url: openaiBase.trim() || null,
      model: openaiModel.trim() || null,
      reasoning_effort: reasoningEffort,
    }
  }

  async function onTestTranscription() {
    setTestingTranscription(true)
    setError(null)
    setOk(null)
    setTranscriptionTestResult(null)
    try {
      const result = await testTranscriptionConnection({
        engine: transcriptionEngine,
        model: localWhisperModel,
      })
      setTranscriptionTestResult(result)
      if (result.ok) {
        setOk(result.message)
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试转译服务失败")
    } finally {
      setTestingTranscription(false)
    }
  }

  async function onFetchModels() {
    setFetchingModels(true)
    setError(null)
    setOk(null)
    setTestResult(null)
    try {
      const result = await fetchOpenAIModels(openaiProbePayload())
      const models = result.models
      if (!models.length) {
        setModelsFetched(false)
        setError("接口返回空模型列表，请检查 Base URL / Key")
        return
      }
      setModelOptions(models)
      setModelsFetched(true)
      if (!openaiModel || !models.includes(openaiModel)) {
        setOpenaiModel(models[0])
      }
      setOk(`已获取 ${models.length} 个模型`)
    } catch (err) {
      setModelsFetched(false)
      setError(err instanceof Error ? err.message : "获取模型失败")
    } finally {
      setFetchingModels(false)
    }
  }

  async function onTestConnection() {
    setTesting(true)
    setError(null)
    setOk(null)
    setTestResult(null)
    try {
      const result = await testOpenAIConnection(openaiProbePayload())
      setTestResult(result)
      if (result.ok) {
        setOk(result.message)
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试连接失败")
    } finally {
      setTesting(false)
    }
  }

  async function onTestCatsapiConnection() {
    setTestingCatsapi(true)
    setError(null)
    setOk(null)
    setCatsapiTestResult(null)
    try {
      const result = await testCatsAPIConnection(catsapiProbePayload())
      setCatsapiTestResult(result)
      if (result.ok) {
        setOk(result.message)
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试 CatsAPI 连接失败")
    } finally {
      setTestingCatsapi(false)
    }
  }

  async function onSave() {
    setSaving(true)
    setError(null)
    setOk(null)
    try {
      const payload: Parameters<typeof updateApiSecrets>[0] = {
        transcription_engine: transcriptionEngine,
        local_whisper_model: localWhisperModel,
        catsapi_base: catsapiBase.trim() || null,
        openai_base_url: openaiBase.trim() || null,
        openai_model: openaiModel.trim() || null,
        openai_reasoning_effort: reasoningEffort,
      }
      if (catsapiKey.trim()) payload.catsapi_key = catsapiKey.trim()
      if (openaiKey.trim()) payload.openai_api_key = openaiKey.trim()

      const next = await updateApiSecrets(payload)
      setStatus(next)
      setTranscriptionEngine(next.transcription_engine || "local")
      setLocalWhisperModel(next.local_whisper_model || "base")
      setCatsapiKey("")
      setOpenaiKey("")
      setCatsapiBase(next.catsapi_base)
      setOpenaiBase(next.openai_base_url)
      setOpenaiModel(next.openai_model)
      setReasoningEffort(normalizeEffort(next.openai_reasoning_effort))
      setOk("设置配置已成功保存")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function clearKey(kind: "catsapi_key" | "openai_api_key") {
    setSaving(true)
    setError(null)
    setOk(null)
    setTestResult(null)
    try {
      const next = await updateApiSecrets({ [kind]: "" })
      setStatus(next)
      setOk(kind === "catsapi_key" ? "已清除封面密钥" : "已清除处理服务密钥")
    } catch (err) {
      setError(err instanceof Error ? err.message : "清除失败")
    } finally {
      setSaving(false)
    }
  }

  const modelSelectOptions =
    openaiModel && !modelOptions.includes(openaiModel)
      ? [openaiModel, ...modelOptions]
      : modelOptions
  const showModelSelect = modelsFetched && modelSelectOptions.length > 0

  const inputStyle =
    "h-8.5 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-slate-50/90 focus:bg-white focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5 dark:bg-slate-800/50 dark:hover:bg-slate-800/80 dark:focus:bg-slate-900 dark:border-slate-700/80 dark:focus:border-slate-500 text-xs transition-all placeholder:text-slate-400"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
          <Settings className="size-4" />
          <span className="sr-only">设置</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[92vh] w-[min(1240px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-950 sm:max-w-none">
        <DialogHeader className="gap-1 px-7 py-4 text-left border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-950">
          <DialogTitle className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            系统与模型设置
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            配置字幕语音转译模式（本地 Whisper 离线 / 云端必剪 ASR）、封面生图与带货话术服务；支持一键快速切换，配置仅保存在本机。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-4 bg-slate-50/70 dark:bg-slate-900/40">
          {loading ? (
            <div className="flex h-56 items-center justify-center gap-2 text-xs text-slate-500">
              <Spinner />
              加载配置中…
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-2">
              <div className="grid grid-cols-1 items-stretch gap-4.5 lg:grid-cols-3">
                {/* 语音转译字幕 Card */}
                <Card className="h-full border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-[0_4px_20px_rgba(0,0,0,0.03)] rounded-2xl transition-all duration-200 flex flex-col p-0 overflow-hidden">
                  <CardHeader className="gap-1 p-4 pb-2.5 border-b border-slate-100/80 dark:border-slate-800/60">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        <div className="flex size-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <Mic className="size-4 shrink-0" />
                        </div>
                        <span className="truncate">语音转译 · ASR 字幕</span>
                      </CardTitle>
                      {transcriptionEngine === "local" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40 shrink-0">
                          <span className="size-1.5 rounded-full bg-blue-500" />
                          本地离线
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-200/60 dark:border-purple-800/40 shrink-0">
                          <span className="size-1.5 rounded-full bg-purple-500" />
                          云端必剪
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400 truncate leading-relaxed">
                      原声口播识别与断句。当前：
                      <span className="font-mono text-slate-700 dark:text-slate-300 ml-1">
                        {transcriptionEngine === "local"
                          ? `本地 Whisper (${localWhisperModel})`
                          : "云端必剪 ASR"}
                      </span>
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <FieldGroup className="gap-3">
                      {/* 模式选择 Toggle */}
                      <Field>
                        <FieldLabel className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5 block">
                          转译引擎模式
                        </FieldLabel>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTranscriptionEngine("local")
                              setTranscriptionTestResult(null)
                            }}
                            className={cn(
                              "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none",
                              transcriptionEngine === "local"
                                ? "border-blue-500/80 bg-blue-50/70 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 shadow-2xs ring-2 ring-blue-500/20"
                                : "border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                            )}
                          >
                            <div className="flex items-center gap-1.5 font-semibold text-xs mb-0.5">
                              <HardDrive className="size-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                              <span>本地转译</span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                              离线 / 免网络 / 零费用
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setTranscriptionEngine("bcut")
                              setTranscriptionTestResult(null)
                            }}
                            className={cn(
                              "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer select-none",
                              transcriptionEngine === "bcut"
                                ? "border-purple-500/80 bg-purple-50/70 dark:bg-purple-950/40 text-purple-950 dark:text-purple-100 shadow-2xs ring-2 ring-purple-500/20"
                                : "border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                            )}
                          >
                            <div className="flex items-center gap-1.5 font-semibold text-xs mb-0.5">
                              <Cloud className="size-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                              <span>必剪云端</span>
                            </div>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                              极速出字 / 免占算力
                            </span>
                          </button>
                        </div>
                      </Field>

                      {/* 本地模型选择或云端提示 */}
                      {transcriptionEngine === "local" ? (
                        <>
                          <Field>
                            <FieldLabel htmlFor="whisper-model" className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                              本地 Whisper 模型
                            </FieldLabel>
                            <Select
                              value={localWhisperModel}
                              onValueChange={(v) => {
                                if (v) {
                                  setLocalWhisperModel(v)
                                  setTranscriptionTestResult(null)
                                }
                              }}
                            >
                              <SelectTrigger id="whisper-model" className={cn(inputStyle, "w-full flex items-center justify-between")}>
                                <SelectValue placeholder="选择模型规格" />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-200 dark:border-slate-800 shadow-lg">
                                <SelectGroup>
                                  {LOCAL_WHISPER_MODELS.map((m) => (
                                    <SelectItem key={m.value} value={m.value} className="text-xs rounded-lg">
                                      <div className="flex flex-col text-left">
                                        <span className="font-medium">{m.label}</span>
                                        <span className="text-[10px] text-slate-400">{m.desc}</span>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </Field>

                          <div className="rounded-xl bg-slate-100/80 dark:bg-slate-800/60 p-2.5 border border-slate-200/60 dark:border-slate-700/60 flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                            <Cpu className="size-3.5 text-slate-500 mt-0.5 shrink-0" />
                            <div className="leading-relaxed">
                              <span className="font-medium text-slate-800 dark:text-slate-200">Faster-Whisper CTranslate2 加速</span>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                int8 量化推理，自动利用 CPU 多核 / Apple Silicon 并行，速度快且低内存占用。
                              </p>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl bg-purple-50/50 dark:bg-purple-950/20 p-2.5 border border-purple-100 dark:border-purple-900/40 flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                          <Cloud className="size-3.5 text-purple-500 mt-0.5 shrink-0" />
                          <div className="leading-relaxed">
                            <span className="font-medium text-purple-900 dark:text-purple-200">必剪云端直连服务</span>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              由必剪 ASR 云端集群识别，无需下载离线模型。若受网络环境或代理阻断可随时切回本地转译。
                            </p>
                          </div>
                        </div>
                      )}

                      {/* 测试按钮 */}
                      <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
                          disabled={saving || testingTranscription}
                          onClick={() => void onTestTranscription()}
                        >
                          {testingTranscription ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <Zap className="size-3.5 text-slate-500 mr-1" />
                          )}
                          测试转译
                        </Button>
                        {transcriptionTestResult ? (
                          transcriptionTestResult.ok ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              正常{transcriptionTestResult.latency_ms != null ? ` · ${transcriptionTestResult.latency_ms}ms` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40">
                              <span className="size-1.5 rounded-full bg-rose-500" />
                              异常
                            </span>
                          )
                        ) : null}
                      </div>
                    </FieldGroup>
                  </CardContent>

                  <CardFooter className="px-4 py-2.5 mt-auto flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/40">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {transcriptionEngine === "local" ? "离线模型就绪" : "云端接口直连"}
                    </span>
                  </CardFooter>
                </Card>

                {/* 封面生成 Card */}
                <Card className="h-full border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-[0_4px_20px_rgba(0,0,0,0.03)] rounded-2xl transition-all duration-200 flex flex-col p-0 overflow-hidden">
                  <CardHeader className="gap-1 p-4 pb-2.5 border-b border-slate-100/80 dark:border-slate-800/60">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        <div className="flex size-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <ImageIcon className="size-4 shrink-0" />
                        </div>
                        <span className="truncate">封面生成 · GPT Image 2</span>
                      </CardTitle>
                      {status?.catsapi_key_set ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40 shrink-0">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          已配置
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60 shrink-0">
                          <span className="size-1.5 rounded-full bg-slate-400" />
                          未配置
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400 truncate leading-relaxed">
                      CatsAPI · GPT Image 2 封面生图。当前：
                      {status?.catsapi_key_set ? (
                        <span className="font-mono text-slate-700 dark:text-slate-300 ml-1">{status.catsapi_key_masked}</span>
                      ) : (
                        <span className="text-slate-400 ml-1">未配置</span>
                      )}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <FieldGroup className="gap-3">
                      <Field>
                        <div className="flex items-center justify-between mb-1">
                          <FieldLabel htmlFor="catsapi-key" className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                            API Key
                          </FieldLabel>
                          <a
                            href="https://catsapi.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline cursor-pointer"
                          >
                            <ExternalLink className="size-3" />
                            获取密钥
                          </a>
                        </div>
                        <Input
                          id="catsapi-key"
                          type="password"
                          autoComplete="off"
                          className={inputStyle}
                          placeholder={
                            status?.catsapi_key_set
                              ? "留空则保持不变"
                              : "cats-xxxxxxxx"
                          }
                          value={catsapiKey}
                          onChange={(e) => setCatsapiKey(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="catsapi-base" className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                          Base URL
                        </FieldLabel>
                        <Input
                          id="catsapi-base"
                          className={inputStyle}
                          value={catsapiBase}
                          onChange={(e) => setCatsapiBase(e.target.value)}
                          placeholder="https://catsapi.com/api"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="catsapi-model" className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                          默认模型
                        </FieldLabel>
                        <Input
                          id="catsapi-model"
                          className={cn(inputStyle, "bg-slate-100/60 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 cursor-not-allowed")}
                          value="gptImage2"
                          readOnly
                          disabled
                        />
                      </Field>

                      <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
                          disabled={saving || testingCatsapi}
                          onClick={() => void onTestCatsapiConnection()}
                        >
                          {testingCatsapi ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <Zap className="size-3.5 text-slate-500 mr-1" />
                          )}
                          测试连接
                        </Button>
                        {catsapiTestResult ? (
                          catsapiTestResult.ok ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              正常{catsapiTestResult.latency_ms != null ? ` · ${catsapiTestResult.latency_ms}ms` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40">
                              <span className="size-1.5 rounded-full bg-rose-500" />
                              异常
                            </span>
                          )
                        ) : null}
                      </div>
                    </FieldGroup>
                  </CardContent>

                  <CardFooter className="px-4 py-2.5 mt-auto flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/40">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs font-normal text-slate-500 hover:text-rose-600 hover:bg-rose-50/70 dark:hover:bg-rose-950/30 transition-colors rounded-lg flex items-center gap-1.5 border-0 shadow-none"
                      disabled={saving || !status?.catsapi_key_set}
                      onClick={() => void clearKey("catsapi_key")}
                    >
                      <Trash2 className="size-3.5" />
                      清除封面密钥
                    </Button>
                  </CardFooter>
                </Card>

                {/* 处理服务 Card */}
                <Card className="h-full border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-[0_4px_20px_rgba(0,0,0,0.03)] rounded-2xl transition-all duration-200 flex flex-col p-0 overflow-hidden">
                  <CardHeader className="gap-1 p-4 pb-2.5 border-b border-slate-100/80 dark:border-slate-800/60">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        <div className="flex size-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <Sparkles className="size-4 shrink-0" />
                        </div>
                        <span className="truncate">处理服务 · OpenAI 兼容</span>
                      </CardTitle>
                      {status?.openai_api_key_set ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40 shrink-0">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          已配置
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60 shrink-0">
                          <span className="size-1.5 rounded-full bg-slate-400" />
                          未配置
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400 truncate leading-relaxed">
                      自定义 Base URL（如 DeepSeek）。接口使用 Chat Completions。当前：
                      {status?.openai_api_key_set ? (
                        <span className="font-mono text-slate-700 dark:text-slate-300 ml-1">{status.openai_api_key_masked}</span>
                      ) : (
                        <span className="text-slate-400 ml-1">未配置</span>
                      )}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 flex-1 space-y-3">
                    <FieldGroup className="gap-3">
                      <Field>
                        <div className="flex items-center justify-between mb-1">
                          <FieldLabel htmlFor="openai-key" className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
                            API Key
                          </FieldLabel>
                          <a
                            href="https://platform.deepseek.com/usage"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium hover:underline cursor-pointer"
                          >
                            <ExternalLink className="size-3" />
                            获取密钥
                          </a>
                        </div>
                        <Input
                          id="openai-key"
                          type="password"
                          autoComplete="off"
                          className={inputStyle}
                          placeholder={
                            status?.openai_api_key_set
                              ? "留空则保持不变"
                              : "sk-xxxxxxxx"
                          }
                          value={openaiKey}
                          onChange={(e) => setOpenaiKey(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="openai-base" className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                          Base URL
                        </FieldLabel>
                        <Input
                          id="openai-base"
                          className={inputStyle}
                          value={openaiBase}
                          onChange={(e) => {
                            setOpenaiBase(e.target.value)
                            setTestResult(null)
                          }}
                          placeholder="https://api.deepseek.com 或 https://xxx/v1"
                        />
                      </Field>
                      <Field>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <FieldLabel htmlFor="openai-model" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            默认模型
                          </FieldLabel>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-xs font-normal text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                            disabled={fetchingModels || saving || testing}
                            onClick={() => void onFetchModels()}
                          >
                            {fetchingModels ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <RefreshCw className="size-3 mr-1" />
                            )}
                            获取模型
                          </Button>
                        </div>
                        {showModelSelect ? (
                          <Select
                            value={openaiModel || undefined}
                            onValueChange={(v) => {
                              if (v) {
                                setOpenaiModel(v)
                                setTestResult(null)
                              }
                            }}
                          >
                            <SelectTrigger
                              id="openai-model"
                              className={cn(inputStyle, "w-full flex items-center justify-between")}
                            >
                              <SelectValue placeholder="选择模型" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-slate-200 dark:border-slate-800 shadow-lg">
                              <SelectGroup>
                                {modelSelectOptions.map((m) => (
                                  <SelectItem key={m} value={m} className="text-xs rounded-lg">
                                    {m}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id="openai-model"
                            className={inputStyle}
                            value={openaiModel}
                            onChange={(e) => {
                              setOpenaiModel(e.target.value)
                              setTestResult(null)
                            }}
                            placeholder="deepseek-v4-pro / gpt-4o-mini"
                          />
                        )}
                      </Field>

                      {/* 思考强度 segmented control */}
                      <Field>
                        <FieldLabel className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                          思考强度 reasoning_effort
                        </FieldLabel>
                        <div className="flex w-full items-center rounded-xl bg-slate-100/90 dark:bg-slate-800/80 p-1 border border-slate-200/60 dark:border-slate-700/60">
                          {REASONING_EFFORTS.map((item) => {
                            const isActive = reasoningEffort === item.value
                            return (
                              <button
                                key={item.value}
                                type="button"
                                disabled={saving || testing}
                                onClick={() => {
                                  setReasoningEffort(item.value)
                                  setTestResult(null)
                                }}
                                className={cn(
                                  "flex-1 py-1 px-0.5 text-center text-xs font-mono rounded-lg transition-all duration-150 cursor-pointer select-none",
                                  isActive
                                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold"
                                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/40 dark:hover:bg-slate-700/40 font-normal"
                                )}
                              >
                                {item.label}
                              </button>
                            )
                          })}
                        </div>
                      </Field>

                      <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shadow-2xs"
                          disabled={fetchingModels || saving || testing}
                          onClick={() => void onTestConnection()}
                        >
                          {testing ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <Zap className="size-3.5 text-slate-500 mr-1" />
                          )}
                          测试连接
                        </Button>
                        {testResult ? (
                          testResult.ok ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              正常{testResult.latency_ms != null ? ` · ${testResult.latency_ms}ms` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono font-medium bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40">
                              <span className="size-1.5 rounded-full bg-rose-500" />
                              异常
                            </span>
                          )
                        ) : null}
                      </div>
                    </FieldGroup>
                  </CardContent>

                  <CardFooter className="px-4 py-2.5 mt-auto flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/40">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs font-normal text-slate-500 hover:text-rose-600 hover:bg-rose-50/70 dark:hover:bg-rose-950/30 transition-colors rounded-lg flex items-center gap-1.5 border-0 shadow-none"
                      disabled={saving || !status?.openai_api_key_set}
                      onClick={() => void clearKey("openai_api_key")}
                    >
                      <Trash2 className="size-3.5" />
                      清除处理服务密钥
                    </Button>
                  </CardFooter>
                </Card>
              </div>

              {error ? (
                <Alert variant="destructive" className="py-2.5 px-3.5 rounded-xl border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                  <CircleAlert className="size-4 text-rose-600 dark:text-rose-400" />
                  <AlertTitle className="text-xs font-semibold">操作失败</AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
                </Alert>
              ) : null}

              {ok ? (
                <Alert className="py-2.5 px-3.5 rounded-xl border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle className="text-xs font-semibold">操作成功</AlertTitle>
                  <AlertDescription className="text-xs leading-relaxed">{ok}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="gap-3 px-7 pt-4 pb-6.5 border-t border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-950 sm:justify-between items-center">
          <ChangelogDialog
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 font-mono transition-colors cursor-pointer"
                title="查看版本更新记录与迭代日志"
              >
                <History className="size-3.5" />
                <span>快发 {APP_VERSION} · 更新日志</span>
              </button>
            }
          />
          <div className="flex items-center gap-3">
            <DialogClose asChild>
              <Button variant="ghost" className="h-9 px-4 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 rounded-xl transition-colors">
                关闭
              </Button>
            </DialogClose>
            <Button
              disabled={loading || saving}
              onClick={() => void onSave()}
              className="h-9 px-5 text-xs font-medium bg-[#0F172A] hover:bg-[#1E293B] active:bg-[#020617] text-white shadow-xs rounded-xl transition-all dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900"
            >
              {saving ? <Spinner data-icon="inline-start" /> : null}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
