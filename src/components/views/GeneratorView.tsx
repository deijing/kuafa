import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CirclePlay,
  Download,
  Film,
  History,
  Info,
  Loader2,
  Music,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
  Upload,
  Volume2,
  Wand2,
  WandSparkles,
  X,
  Sparkles,
  ZoomIn,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImagePreviewModal } from "@/components/ui/image-preview-modal"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useMaterials } from "@/hooks/use-materials"
import { useNotifications } from "@/hooks/use-notifications"
import { useJobs } from "@/hooks/use-jobs"
import {
  createGenerateJob,
  fetchJob,
  fetchJobs,
  uploadBgm,
  type BgmItem,
  type DurationPreference,
  type Job,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { extractRules } from "@/data/extract-rules"

const tones = [
  "bg-blue-400",
  "bg-indigo-400",
  "bg-violet-400",
  "bg-pink-400",
  "bg-rose-400",
] as const

const COMMON_NEGATIVE_PRESETS = [
  "1号链接",
  "小黄车",
  "去拍",
  "下方链接",
  "关注主播",
  "加入粉丝团",
  "公屏扣1",
  "主播身材",
  "私信客服",
  "拍一发三",
] as const

type GeneratorViewProps = {
  onGoLibrary?: () => void
  onGoHistory?: () => void
}

export function GeneratorView({ onGoLibrary, onGoHistory }: GeneratorViewProps) {
  const navigate = useNavigate()
  const { materials, selectedIds, groups, activeGroupId } = useMaterials()
  const { registerJobs } = useJobs()
  const selected = useMemo(
    () => materials.filter((m) => selectedIds.includes(m.id)),
    [materials, selectedIds]
  )
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  )

  const [durationKey, setDurationKey] = useState<string>("s45")
  const [customSeconds, setCustomSeconds] = useState<number>(45)
  const [countInput, setCountInput] = useState<string>("1")
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0)
  const [randomizeIntro, setRandomizeIntro] = useState<boolean>(true)
  const [subtitlePosition, setSubtitlePosition] = useState<"high" | "mid" | "low">("high")
  const [addSubtitles, setAddSubtitles] = useState(true)
  const [addBgm, setAddBgm] = useState(true)
  const [bgmVolume, setBgmVolume] = useState<number>(25)
  const [customBgm, setCustomBgm] = useState<BgmItem | null>(null)
  const [uploadingBgm, setUploadingBgm] = useState(false)
  const bgmFileInputRef = useRef<HTMLInputElement>(null)

  const [clipsPerVideo, setClipsPerVideo] = useState<number | null>(5)
  const [shuffleClips, setShuffleClips] = useState<boolean>(true)
  const [deepDedup, setDeepDedup] = useState<boolean>(true)

  // 口播否词过滤
  const [filterLivePitch, setFilterLivePitch] = useState<boolean>(true)
  const [negativeWords, setNegativeWords] = useState<string[]>([
    "1号链接", "下方小黄车", "小黄车去拍", "关注主播"
  ])
  const [customNegativeInput, setCustomNegativeInput] = useState<string>("")

  const handleAddNegativeWord = (word: string) => {
    const trimmed = word.trim()
    if (!trimmed) return
    if (!negativeWords.includes(trimmed)) {
      setNegativeWords((prev) => [...prev, trimmed])
    }
    setCustomNegativeInput("")
  }

  const handleRemoveNegativeWord = (word: string) => {
    setNegativeWords((prev) => prev.filter((w) => w !== word))
  }

  const [rules, setRules] = useState<Record<string, boolean>>(
    Object.fromEntries(extractRules.map((r) => [r.id, r.checked]))
  )
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userClearedRef = useRef(false)

  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const handleOpenPreview = (imgs: string[], index = 0) => {
    setPreviewImages(imgs)
    setPreviewIndex(index)
    setIsPreviewOpen(true)
  }

  const { notify } = useNotifications()

  const handleResetGenerator = useCallback(() => {
    userClearedRef.current = true
    setJob(null)
    setError(null)
    setBusy(false)
    notify({
      title: "已新建生成页面",
      message: "合成结果已清空，您可以重新勾选素材并实时开始一键混剪！",
      type: "info",
    })
  }, [notify])

  useEffect(() => {
    const handleNewProject = () => {
      handleResetGenerator()
    }
    window.addEventListener("kuafa:new-project", handleNewProject)
    return () => window.removeEventListener("kuafa:new-project", handleNewProject)
  }, [handleResetGenerator])

  const countNum = useMemo(() => {
    const parsed = parseInt(countInput, 10)
    if (isNaN(parsed) || parsed < 1) return 1
    if (parsed > 50) return 50
    return parsed
  }, [countInput])

  const targetSeconds = useMemo(() => {
    if (durationKey === "s40") return 40
    if (durationKey === "s45") return 45
    if (durationKey === "mid") return 60
    if (durationKey === "long") return 90
    if (durationKey === "custom") return Math.max(15, Math.min(180, customSeconds || 45))
    return 45
  }, [durationKey, customSeconds])

  const durationPref = useMemo<DurationPreference>(() => {
    if (durationKey === "s40" || durationKey === "s45") return "short"
    if (durationKey === "long") return "long"
    return "mid"
  }, [durationKey])

  // 页面加载/标签切回时：自动恢复上一次成片状态（若用户未手动点击新建）
  useEffect(() => {
    let mounted = true
    if (!job && !userClearedRef.current) {
      void fetchJobs()
        .then((allJobs) => {
          if (!mounted || userClearedRef.current) return
          const recent = allJobs.find(
            (j) => j.status === "succeeded" || j.status === "running" || j.status === "queued"
          )
          if (recent) {
            setJob(recent)
            registerJobs([recent])
            if (recent.status === "running" || recent.status === "queued") {
              setBusy(true)
            }
          }
        })
        .catch(() => {/* ignore */})
    }
    return () => {
      mounted = false
    }
  }, [job, registerJobs])

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) {
      return
    }
    const timer = window.setInterval(() => {
      void fetchJob(job.id)
        .then((next) => {
          setJob(next)
          if (next.status === "succeeded" || next.status === "failed") {
            setBusy(false)
            if (next.status === "succeeded") {
              notify({
                title: "智能成片完成",
                message: "单切片合成已完成，可以在右侧窗口直接预览及下载！",
                type: "success",
              })
            } else {
              notify({
                title: "智能成片失败",
                message: next.error || "视频渲染遇到异常，请检查配置后重试",
                type: "error",
              })
            }
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 800)
    return () => window.clearInterval(timer)
  }, [job, notify])

  async function handleBgmUpload(file: File) {
    setUploadingBgm(true)
    setError(null)
    try {
      const uploaded = await uploadBgm(file)
      setCustomBgm(uploaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传音频失败")
    } finally {
      setUploadingBgm(false)
    }
  }

  async function startGenerate() {
    if (!selectedIds.length) {
      setError("请先在素材库勾选切片")
      return
    }
    userClearedRef.current = false
    setError(null)
    setBusy(true)
    setJob(null)
    try {
      const baseTitle = activeGroup
        ? `${activeGroup.name} · 带货成片`
        : "限时特惠 · 爆款精选成片"

      if (countNum === 1) {
        const created = await createGenerateJob({
          material_ids: selectedIds,
          group_id: activeGroupId,
          duration_preference: durationPref,
          target_seconds: targetSeconds,
          speech_speed: speechSpeed,
          randomize_intro: randomizeIntro,
          subtitle_position: subtitlePosition,
          add_captions: addSubtitles,
          add_sfx: addBgm,
          add_subtitles: addSubtitles,
          add_bgm: addBgm,
          bgm_volume: bgmVolume,
          bgm_file: customBgm ? customBgm.filename : null,
          mode: "sell",
          extract_rules: rules,
          negative_words: negativeWords,
          filter_live_pitch: filterLivePitch,
          title: baseTitle,
          clips_per_video: clipsPerVideo,
          shuffle_clips: shuffleClips,
          deep_dedup: deepDedup,
        })
        setJob(created)
        registerJobs([created])
      } else {
        const createdJobs = await Promise.all(
          Array.from({ length: countNum }).map((_, i) =>
            createGenerateJob({
              material_ids: selectedIds,
              group_id: activeGroupId,
              duration_preference: durationPref,
              target_seconds: targetSeconds,
              speech_speed: speechSpeed,
              randomize_intro: randomizeIntro,
              subtitle_position: subtitlePosition,
              add_captions: addSubtitles,
              add_sfx: addBgm,
              add_subtitles: addSubtitles,
              add_bgm: addBgm,
              bgm_volume: bgmVolume,
              bgm_file: customBgm ? customBgm.filename : null,
              mode: "sell",
              extract_rules: rules,
              negative_words: negativeWords,
              filter_live_pitch: filterLivePitch,
              title: `${baseTitle} #${i + 1}`,
              variant_index: i,
              clips_per_video: clipsPerVideo,
              shuffle_clips: shuffleClips,
              deep_dedup: deepDedup,
            })
          )
        )
        if (createdJobs.length) {
          setJob(createdJobs[0])
          registerJobs(createdJobs)
        }
      }
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建任务失败")
    }
  }

  const showProcessing =
    busy || job?.status === "queued" || job?.status === "running"
  const showSuccess = job?.status === "succeeded" && job.output_url
  const showFailed = job?.status === "failed"

  return (
    <div className="flex h-full gap-7 overflow-hidden">
      {/* Settings Column */}
      <Card className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border border-black/[0.06] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <CardHeader className="py-4 px-6 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between shrink-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <SlidersHorizontal className="size-4 text-blue-600" />
            混剪规则设置
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetGenerator}
            disabled={busy}
            className="h-7 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer gap-1"
          >
            <Plus className="size-3.5" />
            新建页面
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-col">
            {/* Section 1: 核心内容提取 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-1.5">
                核心内容提取
              </h4>
              <p className="mb-3 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
                默认用必剪 ASR 整句切割（不切半字），结构：前段介绍商品 → 中后段讲价格/促销。
              </p>
              <div className="flex flex-col gap-1">
                {extractRules.map((rule) => (
                  <label
                    key={rule.id}
                    className="flex cursor-pointer items-center justify-between rounded-xl py-2.5 px-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={rules[rule.id]}
                        onCheckedChange={(v) =>
                          setRules((prev) => ({ ...prev, [rule.id]: Boolean(v) }))
                        }
                        className="rounded-[4px] border-slate-300 dark:border-slate-700 data-checked:bg-blue-600 data-checked:border-blue-600"
                      />
                      <span className="text-sm font-medium text-[#4B5563] dark:text-slate-300">
                        {rule.label}
                      </span>
                    </div>
                    {rule.badge ? (
                      <span className="inline-flex items-center rounded-[4px] bg-[rgba(16,185,129,0.1)] dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-[#059669] dark:text-emerald-400 border border-emerald-500/20">
                        {rule.badge}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section: 成片条数 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200">
                  生成条数
                </h4>
                <span className="text-[12px] font-semibold text-blue-600 dark:text-blue-400">
                  {countNum > 1 ? `基于所选素材生成 ${countNum} 条不同成片` : "生成 1 条精剪成片"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 5].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    disabled={busy}
                    onClick={() => setCountInput(String(cnt))}
                    className={cn(
                      "flex-1 rounded-xl py-1.5 text-xs font-semibold transition-all cursor-pointer border text-center",
                      countNum === cnt
                        ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                        : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    )}
                  >
                    {cnt} 条
                  </button>
                ))}
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={countInput}
                    onChange={(e) => setCountInput(e.target.value)}
                    className="w-8 text-center text-xs font-bold font-mono text-blue-600 dark:text-blue-400 bg-transparent outline-none"
                  />
                  <span className="text-[11px] text-slate-400 font-medium">条</span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section 2: 成片时长偏好 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2">
                成片时长偏好
              </h4>
              <Select
                value={durationKey}
                onValueChange={(v) => setDurationKey(v)}
              >
                <SelectTrigger className="w-full text-xs h-10 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 focus:ring-2 focus:ring-blue-500/20 transition-all">
                  <SelectValue placeholder="选择时长" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="s40">精简快节奏 (~40秒)</SelectItem>
                    <SelectItem value="s45">黄金爆款 (~45秒) [推荐]</SelectItem>
                    <SelectItem value="mid">标准带货 (~60秒)</SelectItem>
                    <SelectItem value="long">深度讲解 (~90秒)</SelectItem>
                    <SelectItem value="custom">⚙️ 自定义精确秒数…</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>

              {durationKey === "custom" && (
                <div className="mt-2.5 flex items-center justify-between rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/40 px-3.5 py-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    自定义成片目标时长：
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={15}
                      max={180}
                      value={customSeconds}
                      onChange={(e) => setCustomSeconds(Number(e.target.value))}
                      className="w-16 text-right text-sm font-bold font-mono text-blue-600 dark:text-blue-400 bg-transparent outline-none"
                    />
                    <span className="text-xs text-slate-500 font-semibold">秒</span>
                  </div>
                </div>
              )}

              <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/40 rounded-lg p-2 leading-relaxed">
                💡 <strong>素材建议：</strong>素材较少（3~4个视频）推荐选 <strong>60秒</strong>；素材较多推荐选 <strong>40秒/45秒</strong>。
              </p>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section 2.5: 语速与开头防重 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                语速倍率 & 开头防重
              </h4>
              <div className="flex flex-col gap-3">
                {/* 语速调节 */}
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      口播语速倍率
                    </span>
                    <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                      加速不改变音调（推荐 1.1x 快节奏）
                    </span>
                  </div>
                  <Select
                    value={String(speechSpeed)}
                    onValueChange={(v) => setSpeechSpeed(Number(v))}
                  >
                    <SelectTrigger className="w-[120px] text-xs h-9 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200">
                      <SelectValue placeholder="语速" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1.0x (原速)</SelectItem>
                      <SelectItem value="1.1">1.1x (推荐快节奏)</SelectItem>
                      <SelectItem value="1.15">1.15x (紧凑带货)</SelectItem>
                      <SelectItem value="1.2">1.2x (极速切片)</SelectItem>
                      <SelectItem value="1.25">1.25x (超快节奏)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 开头防重 */}
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      开头随机防重
                    </span>
                    <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                      不同主播/多次生成随机换 Hook 开头
                    </span>
                  </div>
                  <Switch
                    checked={randomizeIntro}
                    onCheckedChange={setRandomizeIntro}
                  />
                </div>
              </div>
            </div>

            {/* Section: 素材分段缝合与降重 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5 flex items-center justify-between">
                <span>素材分段缝合与防重</span>
                <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                  智能降重算法
                </span>
              </h4>

              <div className="flex flex-col gap-3.5">
                {/* 每几段素材缝合一条 */}
                <div className="flex flex-col gap-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      每几段素材合成 1 条长视频
                    </span>
                    <span className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400">
                      {clipsPerVideo ? `每 ${clipsPerVideo} 段 / 条` : "使用全量素材"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    素材较多时自动每 N 段切割生成一条独家长视频（如 20 段素材设「每 5 段」自动生成 4 条）。
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setClipsPerVideo(null)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer border",
                        clipsPerVideo === null
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                      )}
                    >
                      全量素材
                    </button>
                    {[3, 5, 8, 10].map((num) => (
                      <button
                        key={num}
                        type="button"
                        disabled={busy}
                        onClick={() => setClipsPerVideo(num)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer border",
                          clipsPerVideo === num
                            ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                        )}
                      >
                        每 {num} 段
                      </button>
                    ))}
                  </div>
                </div>

                {/* 随机打乱素材顺序 */}
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      随机打乱片段顺序
                    </span>
                    <span className="text-[12px] text-[#9CA3AF] dark:text-slate-400">
                      打乱拼接次序，打破原片结构
                    </span>
                  </div>
                  <Switch
                    checked={shuffleClips}
                    onCheckedChange={setShuffleClips}
                    disabled={busy}
                  />
                </div>

                {/* 深度音视频降重 */}
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      深度音视频降重
                    </span>
                    <span className="text-[12px] text-[#9CA3AF] dark:text-slate-400">
                      微剪采样、语速微扰与 Hook 重组
                    </span>
                  </div>
                  <Switch
                    checked={deepDedup}
                    onCheckedChange={setDeepDedup}
                    disabled={busy}
                  />
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section: 口播否词过滤 (切片脱水 / 违规词过滤) */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-rose-500" />
                  口播否词过滤 (切片脱水)
                </span>
                <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-200/60">
                  防违规 · 纯净带货
                </span>
              </h4>

              <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-3.5">
                {/* 自动过滤直播导流废话 Switch */}
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      过滤直播导流口播 (推荐)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      自动剔除「1号链接、小黄车、左下角去拍、关注主播」等口播
                    </span>
                  </div>
                  <Switch
                    checked={filterLivePitch}
                    onCheckedChange={setFilterLivePitch}
                    disabled={busy}
                  />
                </div>

                {/* 自定义否词输入与标签管理 */}
                <div className="pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      自定义否词关键词 ({negativeWords.length})
                    </span>
                    <span className="text-[10px] text-slate-400">命中任一词的句子将自动舍弃</span>
                  </div>

                  {/* 快捷推荐预设胶囊 */}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] text-slate-400 mr-0.5">快捷添加:</span>
                    {COMMON_NEGATIVE_PRESETS.map((preset) => {
                      const isAdded = negativeWords.includes(preset)
                      return (
                        <button
                          key={preset}
                          type="button"
                          disabled={busy || isAdded}
                          onClick={() => handleAddNegativeWord(preset)}
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[10px] font-medium transition-all cursor-pointer border",
                            isAdded
                              ? "opacity-40 bg-slate-100 dark:bg-slate-800 text-slate-400 border-transparent cursor-default"
                              : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-rose-300 hover:text-rose-600"
                          )}
                        >
                          + {preset}
                        </button>
                      )
                    })}
                  </div>

                  {/* 当前已启用的否词 Tag 列表 */}
                  {negativeWords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 max-h-24 overflow-y-auto">
                      {negativeWords.map((word) => (
                        <span
                          key={word}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-900/60 text-xs font-medium"
                        >
                          <span>{word}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRemoveNegativeWord(word)}
                            className="hover:text-rose-900 dark:hover:text-white cursor-pointer"
                            title="删除此否词"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 输入框添加自定义否词 */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <input
                      type="text"
                      disabled={busy}
                      value={customNegativeInput}
                      onChange={(e) => setCustomNegativeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddNegativeWord(customNegativeInput)
                        }
                      }}
                      placeholder="输入自定义违禁词/废话，回车快速添加…"
                      className="flex-1 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !customNegativeInput.trim()}
                      onClick={() => handleAddNegativeWord(customNegativeInput)}
                      className="h-8 px-3 text-xs bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                    >
                      添加否词
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section 3: 字幕 / 音乐 / 画幅 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                字幕 / 音乐 / 画幅
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      口播字幕（烧录）
                    </span>
                    <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                      逐段弹出，每段不超过 10 字、不换行
                    </span>
                  </div>
                  <Switch
                    checked={addSubtitles}
                    onCheckedChange={setAddSubtitles}
                  />
                </div>

                {addSubtitles ? (
                  <div className="flex items-center justify-between py-1 px-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                        字幕显示位置
                      </span>
                      <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                        靠上安全区避开抖音/小红书底部UI
                      </span>
                    </div>
                    <Select
                      value={subtitlePosition}
                      onValueChange={(v) => setSubtitlePosition(v as "high" | "mid" | "low")}
                    >
                      <SelectTrigger className="w-[120px] text-xs h-9 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200">
                        <SelectValue placeholder="位置" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">靠上安全区 (推荐)</SelectItem>
                        <SelectItem value="mid">居中偏下</SelectItem>
                        <SelectItem value="low">贴近底部</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between py-1 px-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                        背景音乐
                      </span>
                      <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                        {customBgm ? `音频: ${customBgm.filename}` : "自动匹配热度 BGM 或自定义音频"}
                      </span>
                    </div>
                    <Switch checked={addBgm} onCheckedChange={setAddBgm} />
                  </div>

                  {addBgm ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 transition-all">
                      {/* BGM Upload / Custom File Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="file"
                          ref={bgmFileInputRef}
                          accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.aac,.flac,.ogg"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void handleBgmUpload(file)
                            e.target.value = ""
                          }}
                        />

                        {customBgm ? (
                          <div className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-blue-200/80 bg-blue-50/80 px-2.5 py-1.5 dark:border-blue-900/60 dark:bg-blue-950/40">
                            <div className="flex min-w-0 items-center gap-2">
                              <Music className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                              <span className="truncate text-xs font-medium text-blue-700 dark:text-blue-300">
                                {customBgm.filename}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCustomBgm(null)}
                              className="ml-1 rounded p-0.5 text-slate-400 hover:bg-blue-100 hover:text-slate-600 cursor-pointer dark:hover:bg-blue-900"
                              title="移除自定义音乐"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingBgm}
                            onClick={() => bgmFileInputRef.current?.click()}
                            className="w-full h-8 text-xs font-medium border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 cursor-pointer shadow-2xs"
                          >
                            {uploadingBgm ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin text-blue-600" />
                            ) : (
                              <Upload className="mr-1.5 size-3.5 text-blue-600" />
                            )}
                            {uploadingBgm ? "上传中…" : "上传自定义 BGM"}
                          </Button>
                        )}
                      </div>

                      {/* Stepless Volume Control Slider */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-[#4B5563] dark:text-slate-300">
                            <Volume2 className="size-3.5 text-slate-400" />
                            音乐音量 (无极调节)
                          </span>
                  <span className="font-bold font-mono text-blue-600 dark:text-blue-400">
                            {bgmVolume}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={bgmVolume}
                          onChange={(e) => setBgmVolume(Number(e.target.value))}
                          className="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200 dark:bg-slate-700 accent-blue-600"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3.5 text-[13px] text-[#4B5563] dark:text-slate-300 leading-relaxed flex items-start gap-2.5">
                  <Info className="size-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    输出固定 <strong className="text-[#111827] dark:text-slate-100 font-semibold">9:16 · 1080×1920</strong>
                    。配置 DeepSeek 后 AI 主观选句；字幕已默认提升至靠上安全区，避免底部控制栏遮挡。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>

        <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 backdrop-blur-xs flex flex-col gap-2 shrink-0">
            {error ? <p className="text-center text-xs text-rose-500 font-medium">{error}</p> : null}

            <Button
              className="h-11 w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm shadow-[0_4px_14px_0_rgba(37,99,235,0.35)] transition-all active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 border-none"
              disabled={busy || !selectedIds.length}
              onClick={() => void startGenerate()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
              {busy ? "处理中…" : "一键智能成片"}
            </Button>
          </div>
        </Card>

      {/* Workspace Column (Right Column - Light Mode Studio) */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {/* Selected Clips Panel */}
        <Card className="flex flex-col border border-black/[0.04] dark:border-slate-800 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)] bg-white dark:bg-slate-900 rounded-2xl">
          <CardHeader className="py-4 px-6 border-b border-[#F3F4F6] dark:border-slate-800 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-[#111827] dark:text-slate-100">
              已选切片
              {activeGroup ? ` · ${activeGroup.name}` : ""} (
              {selected.length})
            </CardTitle>
            <div className="flex items-center gap-3">
              {onGoHistory && (
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 hover:text-blue-600 dark:text-slate-400 cursor-pointer transition-colors flex items-center gap-1"
                  onClick={onGoHistory}
                >
                  <History className="size-3.5" />
                  查看成片历史
                </button>
              )}
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer transition-colors"
                onClick={onGoLibrary}
              >
                去素材库选择
              </button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 p-5">
            <div className="relative flex items-center overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 p-4">
              <div className="absolute top-0 bottom-0 left-[20%] z-10 w-0.5 bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.5)]" />
              <div className="flex h-20 min-w-max items-center gap-3">
                {selected.length ? (
                  selected.map((clip, index) => (
                    <div
                      key={clip.id}
                      className={cn(
                        "group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/80 shadow-2xs",
                        tones[index % tones.length]
                      )}
                      title={clip.filename}
                    >
                      {clip.thumb_url ? (
                        <img
                          src={clip.thumb_url}
                          alt=""
                          className="absolute inset-0 size-full object-cover opacity-90"
                        />
                      ) : null}
                      <span className="absolute bottom-1 left-1 rounded bg-[#111827]/80 px-1.5 py-0.5 text-[9px] font-bold font-mono text-white">
                        {index + 1}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2 py-4 text-xs text-[#9CA3AF]">
                    <Film className="size-4 text-[#9CA3AF]" />
                    <span>尚未选择素材，请先到素材库勾选案例切片。</span>
                  </div>
                )}
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[13px] text-[#9CA3AF]">
              <Info className="size-3.5 text-[#9CA3AF] shrink-0" />
              必剪转写整句拼接：介绍商品 → 讲价格，输出 9:16 抖音成片。
            </p>
          </CardContent>
        </Card>

        {/* Video Player / Light Studio Preview Area */}
        <div className="relative flex min-h-[380px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)]">
          {showProcessing ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
              <div className="mb-4 text-4xl font-bold font-mono text-[#111827] dark:text-slate-100 tracking-tight">
                {job?.progress ?? 0}%
              </div>
              <Loader2 className="mb-3 size-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium text-[#111827] dark:text-slate-100">
                {job?.message || "准备中…"}
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                转写切句 → 9:16 拼接 → 字幕/BGM
              </p>
            </div>
          ) : null}

          {showFailed ? (
            <div className="z-10 px-6 text-center">
              <p className="mb-2 text-sm font-semibold text-rose-600">成片失败</p>
              <p className="text-xs text-[#4B5563]">{job?.error}</p>
            </div>
          ) : null}

          {showSuccess ? (
            <div className="absolute inset-0 z-30 flex flex-col md:flex-row bg-slate-950 rounded-2xl overflow-hidden">
              {/* Video Player */}
              <div className="relative flex flex-1 items-center justify-center bg-black">
                <video
                  key={job.output_url}
                  src={job.output_url!}
                  controls
                  className="size-full max-h-[85vh] object-contain"
                />
                <div className="absolute left-4 top-4 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 text-white backdrop-blur-md border border-white/10 text-xs">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  成片完成
                </div>
                <div className="absolute right-4 bottom-4 z-10 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const targetTitle = activeGroup ? `${activeGroup.name} · 成片` : `成片 ${job.id.slice(0, 8)}`
                      navigate("/cover", {
                        state: {
                          refImageUrl: job.covers?.[0]?.url || (job.output_url ? `/api/jobs/${job.id}/thumb.jpg` : undefined),
                          headline: job.headline || (activeGroup ? `${activeGroup.name} 爆款特惠！限时抢购` : "爆款特惠！限时抢购，错过再等一年！"),
                          title: targetTitle,
                          sourceJobId: job.id,
                          videoUrl: job.output_url,
                        },
                      })
                    }}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-lg rounded-xl flex items-center gap-1.5 cursor-pointer px-3 py-1.5"
                    title="为此成片制作定制 AI 爆款大字报封面"
                  >
                    <Wand2 className="size-3.5" />
                    <span>定制 AI 封面</span>
                  </Button>
                  <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg rounded-xl text-xs px-3 py-1.5">
                    <a href={`/api/jobs/${job.id}/download`} download>
                      <Download className="mr-1.5 size-3.5" />
                      下载成片
                    </a>
                  </Button>
                </div>
              </div>

              {/* Generated Covers Panel */}
              {job?.covers && job.covers.length > 0 && (
                <div className="w-full md:w-[300px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/95 p-4 flex flex-col overflow-y-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="size-4 text-amber-400 shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">
                        基于本视频卖点生成的封面
                      </h4>
                      {job.headline && (
                        <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
                          文案：「{job.headline}」
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-1 gap-3 flex-1 overflow-y-auto">
                    {job.covers.map((cover, idx) => (
                      <div
                        key={cover.id}
                        className="group relative flex flex-col rounded-xl border border-slate-800 bg-slate-950 p-2 transition-all hover:border-blue-500"
                      >
                        <div
                          onClick={() => handleOpenPreview(job.covers!.map((c) => c.url), idx)}
                          className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-slate-900 cursor-pointer"
                          title="点击放大预览"
                        >
                          <img
                            src={cover.url}
                            alt=""
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-1">
                            <ZoomIn className="size-4" />
                            <span className="text-xs font-semibold">放大预览</span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium text-slate-400">
                            封面 #{idx + 1}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenPreview(job.covers!.map((c) => c.url), idx)}
                              className="p-1 text-slate-400 hover:text-slate-200 text-[10px] flex items-center gap-0.5 cursor-pointer"
                              title="放大预览"
                            >
                              <ZoomIn className="size-3" />
                              预览
                            </button>
                            <a
                              href={cover.url}
                              download={`cover_${idx + 1}`}
                              className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="size-2.5" />
                              下载
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!showProcessing && !showSuccess && !showFailed ? (
            <div className="z-10 flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="relative mb-5 flex size-20 items-center justify-center rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/40 shadow-xs">
                <CirclePlay className="size-10 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[#111827] dark:text-slate-100 tracking-tight">
                实时成片预览区
              </h3>
              <p className="text-[13px] text-[#4B5563] dark:text-slate-400 leading-relaxed max-w-[280px]">
                点击左侧 <span className="text-blue-600 dark:text-blue-400 font-medium">「一键智能成片」</span> 按钮，系统将根据所选规则自动生成抖音 9:16 高转化视频
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-full border border-emerald-200/80 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 px-4 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                智能引擎已就绪 · 等待触发
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Fullscreen Image Preview Lightbox Modal */}
      <ImagePreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        images={previewImages}
        initialIndex={previewIndex}
      />
    </div>
  )
}
