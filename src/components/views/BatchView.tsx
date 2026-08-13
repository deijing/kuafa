import { useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  CirclePlay,
  Download,
  History,
  Info,
  Layers,
  Loader2,
  Music,
  Plus,
  SlidersHorizontal,
  Upload,
  Volume2,
  WandSparkles,
  X,
  XCircle,
  Sparkles,
  ZoomIn,
  Film,
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
import { extractRules } from "@/data/extract-rules"
import { useMaterials } from "@/hooks/use-materials"
import { useNotifications } from "@/hooks/use-notifications"
import { useJobs } from "@/hooks/use-jobs"
import {
  createBatchJobs,
  exportJobsZip,
  fetchJobs,
  generateJobCovers,
  uploadBgm,
  type BgmItem,
  type CoverStyle,
  type DurationPreference,
  type Job,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type BatchViewProps = {
  onGoLibrary?: () => void
  onGoHistory?: () => void
}

export function BatchView({ onGoLibrary, onGoHistory }: BatchViewProps) {
  const { groups, loading } = useMaterials()
  const { registerJobs } = useJobs()

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [countInput, setCountInput] = useState<string>("3")
  const [durationKey, setDurationKey] = useState<string>("s45")
  const [customSeconds, setCustomSeconds] = useState<number>(45)
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0)
  const [randomizeIntro, setRandomizeIntro] = useState<boolean>(true)
  const [subtitlePosition, setSubtitlePosition] = useState<"high" | "mid" | "low">("high")
  const [addSubtitles, setAddSubtitles] = useState(true)
  const [addBgm, setAddBgm] = useState(true)
  const [bgmVolume, setBgmVolume] = useState(25)
  const [customBgm, setCustomBgm] = useState<BgmItem | null>(null)
  const [uploadingBgm, setUploadingBgm] = useState(false)
  const bgmFileInputRef = useRef<HTMLInputElement>(null)

  const [clipsPerVideo, setClipsPerVideo] = useState<number | null>(5)
  const [shuffleClips, setShuffleClips] = useState<boolean>(true)
  const [deepDedup, setDeepDedup] = useState<boolean>(true)

  const [rules, setRules] = useState<Record<string, boolean>>(
    Object.fromEntries(extractRules.map((r) => [r.id, r.checked]))
  )
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)
  const userClearedRef = useRef(false)

  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const handleOpenPreview = (imgs: string[], index = 0) => {
    setPreviewImages(imgs)
    setPreviewIndex(index)
    setIsPreviewOpen(true)
  }

  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.includes(g.id)),
    [groups, selectedGroupIds]
  )
  const selectedMaterials = useMemo(
    () => selectedGroups.flatMap((g) => g.materials),
    [selectedGroups]
  )
  const totalClips = selectedMaterials.length

  const countNum = useMemo(() => {
    const parsed = parseInt(countInput, 10)
    if (isNaN(parsed) || parsed < 1) return 1
    if (parsed > 50) return 50
    return parsed
  }, [countInput])

  const totalVideos = selectedGroups.length * countNum

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

  // 默认勾选第一个有素材的组；组列表变化时清掉已不存在的选中项
  useEffect(() => {
    if (!groups.length) {
      setSelectedGroupIds([])
      return
    }
    setSelectedGroupIds((prev) => {
      const valid = prev.filter((id) => groups.some((g) => g.id === id))
      if (valid.length) return valid
      const first = groups.find((g) => g.material_count > 0) ?? groups[0]
      return first ? [first.id] : []
    })
  }, [groups])

  function toggleGroup(groupId: string) {
    if (busy) return
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    )
  }

  function selectAllGroups() {
    if (busy) return
    setSelectedGroupIds(
      groups.filter((g) => g.material_count > 0).map((g) => g.id)
    )
  }

  function clearGroupSelection() {
    if (busy) return
    setSelectedGroupIds([])
  }

  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running"
  )
  const allDone =
    jobs.length > 0 &&
    jobs.every((j) => j.status === "succeeded" || j.status === "failed")

  const { notify } = useNotifications()

  const [coverLoadingJobId, setCoverLoadingJobId] = useState<string | null>(null)
  const [selectedExportJobIds, setSelectedExportJobIds] = useState<string[]>([])
  const coverStyle: CoverStyle = "yellow-red"
  const [exportingZip, setExportingZip] = useState(false)

  const handleResetBatch = () => {
    userClearedRef.current = true
    setJobs([])
    setPreviewJobId(null)
    setError(null)
    setSelectedExportJobIds([])
    setBusy(false)
    notify({
      title: "已新建批量生成页面",
      message: "页面已重置！您可以勾选素材组、调整参数并随时开始新一轮实时批量生成。",
      type: "info",
    })
  }

  useEffect(() => {
    const handleNewProject = () => {
      handleResetBatch()
    }
    window.addEventListener("kuafa:new-project", handleNewProject)
    return () => window.removeEventListener("kuafa:new-project", handleNewProject)
  }, [])

  function toggleJobExportSelection(jobId: string) {
    setSelectedExportJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    )
  }

  function toggleSelectAllExportJobs() {
    const succeededIds = jobs.filter((j) => j.status === "succeeded").map((j) => j.id)
    if (selectedExportJobIds.length >= succeededIds.length && succeededIds.length > 0) {
      setSelectedExportJobIds([])
    } else {
      setSelectedExportJobIds(succeededIds)
    }
  }

  async function handleExportSelectedZip() {
    if (!selectedExportJobIds.length) return
    setExportingZip(true)
    try {
      await exportJobsZip(selectedExportJobIds, true)
      notify({
        title: "打包导出成功",
        message: `已为所选的 ${selectedExportJobIds.length} 条成片及配套爆款封面生成 ZIP 文件！`,
        type: "success",
      })
    } catch (err) {
      notify({
        title: "打包导出失败",
        message: err instanceof Error ? err.message : "导出过程遇到异常",
        type: "error",
      })
    } finally {
      setExportingZip(false)
    }
  }

  // 页面加载/从其他标签切回时：自动恢复最近成片记录（如果用户未手动点击新建）
  useEffect(() => {
    let mounted = true
    if (userClearedRef.current) return
    void fetchJobs()
      .then((allJobs) => {
        if (!mounted || jobs.length > 0 || userClearedRef.current) return
        if (!allJobs || !allJobs.length) return
        const recent = allJobs.filter(
          (j) => j.status === "succeeded" || j.status === "running" || j.status === "queued"
        )
        if (recent.length > 0) {
          const groupMatched = selectedGroupIds.length > 0
            ? recent.filter((j) => j.group_id && selectedGroupIds.includes(j.group_id))
            : []
          const toShow = groupMatched.length > 0 ? groupMatched : recent.slice(0, 20)
          if (toShow.length > 0) {
            setJobs(toShow)
            registerJobs(toShow)
            if (toShow.some((j) => j.status === "running" || j.status === "queued")) {
              setBusy(true)
            }
            const succeeded = toShow.filter((j) => j.status === "succeeded")
            setSelectedExportJobIds(succeeded.map((j) => j.id))
            const firstOk = succeeded.find((j) => j.output_url)
            if (firstOk) setPreviewJobId(firstOk.id)
          }
        }
      })
      .catch(() => {/* ignore */})
    return () => {
      mounted = false
    }
  }, [selectedGroupIds, jobs.length, registerJobs])

  async function handleGenerateCoversForJob(jobId: string, headline?: string) {
    setCoverLoadingJobId(jobId)
    try {
      const updated = await generateJobCovers(jobId, headline, 3, coverStyle)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
      notify({
        title: "配套爆款封面生成完成",
        message: "已为该成片重构生成 3 张高颜值爆款封面！",
        type: "success",
      })
    } catch (err) {
      notify({
        title: "封面生成失败",
        message: err instanceof Error ? err.message : "无法生成封面",
        type: "error",
      })
    } finally {
      setCoverLoadingJobId(null)
    }
  }

  async function handleGenerateCoversForAll() {
    const doneJobs = jobs.filter((j) => j.status === "succeeded")
    if (!doneJobs.length) return
    setBusy(true)
    try {
      const updatedList = await Promise.all(
        doneJobs.map((j) => generateJobCovers(j.id, j.headline ?? undefined, 3, coverStyle))
      )
      setJobs((prev) =>
        prev.map((j) => updatedList.find((u) => u.id === j.id) ?? j)
      )
      notify({
        title: "全套爆款封面生成完成",
        message: `已成功为 ${updatedList.length} 条成片生成 3 张配套高颜值封面！`,
        type: "success",
      })
    } catch (err) {
      notify({
        title: "生成封面失败",
        message: err instanceof Error ? err.message : "批量封面生成异常",
        type: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!jobs.length || allDone) {
      if (allDone) setBusy(false)
      return
    }
    const timer = window.setInterval(() => {
      void fetchJobs()
        .then((allJobs) => {
          const activeIds = new Set(jobs.map((j) => j.id))
          const next = allJobs.filter((j) => activeIds.has(j.id))
          if (!next.length) return
          setJobs(next)
          if (
            next.every((j) => j.status === "succeeded" || j.status === "failed")
          ) {
            setBusy(false)
            const succeededCount = next.filter((j) => j.status === "succeeded").length
            const failedCount = next.filter((j) => j.status === "failed").length

            const firstOk = next.find(
              (j) => j.status === "succeeded" && j.output_url
            )
            if (firstOk) setPreviewJobId(firstOk.id)

            if (succeededCount > 0) {
              notify({
                title: "批量混剪任务完成",
                message: `已成功生成 ${succeededCount} 条成片${failedCount ? `，${failedCount} 条失败` : ""}！`,
                type: "success",
              })
            } else {
              notify({
                title: "批量混剪生成失败",
                message: "所选任务渲染失败，请检查素材后重试",
                type: "error",
              })
            }
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 1200)
    return () => window.clearInterval(timer)
  }, [jobs, allDone, notify])

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

  async function startBatch() {
    if (!selectedGroups.length) {
      setError("请先勾选至少一个素材组")
      return
    }
    const usable = selectedGroups.filter((g) => g.materials.length > 0)
    if (!usable.length) {
      setError("所选素材组没有素材，请先到素材库上传")
      return
    }
    userClearedRef.current = false
    setError(null)
    setBusy(true)
    setJobs([])
    setPreviewJobId(null)
    try {
      const n = countNum
      const results = await Promise.all(
        usable.map((group) =>
          createBatchJobs({
            group_id: group.id,
            count: n,
            material_ids: group.materials.map((m) => m.id),
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
            title: `${group.name} · 带货成片`,
            clips_per_video: clipsPerVideo,
            shuffle_clips: shuffleClips,
            deep_dedup: deepDedup,
          })
        )
      )
      const createdList = results.flatMap((r) => r.jobs)
      setJobs(createdList)
      registerJobs(createdList)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建批量任务失败")
    }
  }

  const previewJob =
    jobs.find((j) => j.id === previewJobId) ??
    jobs.find((j) => j.status === "succeeded" && j.output_url) ??
    null

  const overallProgress =
    jobs.length === 0
      ? 0
      : Math.round(jobs.reduce((sum, j) => sum + j.progress, 0) / jobs.length)

    return (
    <div className="flex h-full gap-7 overflow-hidden">
      {/* Left Column: Fixed height card with scrollable settings and sticky CTA footer */}
      <Card className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border border-black/[0.06] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <CardHeader className="py-4 px-6 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between shrink-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <SlidersHorizontal className="size-4 text-blue-600" />
            批量成片设置
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetBatch}
            disabled={busy}
            className="h-7 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer gap-1"
          >
            <Plus className="size-3.5" />
            新建页面
          </Button>
        </CardHeader>

        {/* Scrollable Form Body */}
        <CardContent className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-col">
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200">
                  素材组
                </h4>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    className="font-medium text-blue-600 hover:text-blue-700 cursor-pointer disabled:opacity-40"
                    disabled={busy || !groups.some((g) => g.material_count > 0)}
                    onClick={selectAllGroups}
                  >
                    全选
                  </button>
                  <span className="text-[#D1D5DB]">·</span>
                  <button
                    type="button"
                    className="font-medium text-[#9CA3AF] hover:text-[#4B5563] cursor-pointer disabled:opacity-40"
                    disabled={busy || !selectedGroupIds.length}
                    onClick={clearGroupSelection}
                  >
                    清空
                  </button>
                </div>
              </div>
              <p className="mb-3 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
                可多选素材组；每个组按下方条数各自成片。
              </p>
              <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-1.5">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#9CA3AF]">
                    <Loader2 className="size-3.5 animate-spin" />
                    加载素材组…
                  </div>
                ) : !groups.length ? (
                  <p className="py-6 text-center text-xs text-[#9CA3AF]">
                    暂无素材组，请先到素材库创建
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {groups.map((group) => {
                      const active = selectedGroupIds.includes(group.id)
                      const empty = group.material_count === 0
                      return (
                        <button
                          key={group.id}
                          type="button"
                          disabled={busy || empty}
                          onClick={() => toggleGroup(group.id)}
                          className={cn(
                            "flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors cursor-pointer",
                            active
                              ? "bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900"
                              : "hover:bg-slate-100/60 dark:hover:bg-slate-800/60 border border-transparent",
                            empty && "opacity-40 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Checkbox
                              checked={active}
                              onCheckedChange={() => toggleGroup(group.id)}
                              disabled={busy || empty}
                              className="rounded-[4px] border-slate-300 dark:border-slate-700 data-checked:bg-blue-600 data-checked:border-blue-600"
                            />
                            <span className="truncate text-xs font-semibold text-[#111827] dark:text-slate-200">
                              {group.name}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            {group.material_count}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200">
                  生成条数（自定义）
                </h4>
                <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                  共 {selectedGroups.length * countNum} 条成片
                </span>
              </div>
              <p className="mb-3 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
                每个已选素材组将各自生成此数量的差异化防重成片（1~50条）。
              </p>
              
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      数量：
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={countInput}
                      onChange={(e) => setCountInput(e.target.value)}
                      disabled={busy}
                      className="w-20 text-right text-sm font-bold font-mono text-blue-600 dark:text-blue-400 bg-transparent outline-none"
                      placeholder="1"
                    />
                    <span className="ml-1 text-xs text-slate-400 font-medium">条 / 组</span>
                  </div>
                </div>

                {/* Preset Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 3, 5, 10, 20].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={busy}
                      onClick={() => setCountInput(String(preset))}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer border",
                        countNum === preset
                          ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                      )}
                    >
                      {preset} 条
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-1.5">
                核心内容提取
              </h4>
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
                          setRules((prev) => ({
                            ...prev,
                            [rule.id]: Boolean(v),
                          }))
                        }
                        disabled={busy}
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

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2">
                成片时长偏好
              </h4>
              <Select
                value={durationKey}
                onValueChange={(v) => setDurationKey(v)}
                disabled={busy}
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
                      disabled={busy}
                      className="w-16 text-right text-sm font-bold font-mono text-blue-600 dark:text-blue-400 bg-transparent outline-none"
                    />
                    <span className="text-xs text-slate-500 font-semibold">秒</span>
                  </div>
                </div>
              )}
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                语速倍率 & 开头防重
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      口播语速倍率
                    </span>
                    <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                      加速不改变音调（推荐 1.1x）
                    </span>
                  </div>
                  <Select
                    value={String(speechSpeed)}
                    onValueChange={(v) => setSpeechSpeed(Number(v))}
                    disabled={busy}
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

                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      开头随机防重
                    </span>
                    <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                      多次生成随机换 Hook 开头
                    </span>
                  </div>
                  <Switch
                    checked={randomizeIntro}
                    onCheckedChange={setRandomizeIntro}
                    disabled={busy}
                  />
                </div>
              </div>
            </div>

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

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

            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                字幕与 BGM 音乐
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      口播字幕（烧录）
                    </span>
                  </div>
                  <Switch
                    checked={addSubtitles}
                    onCheckedChange={setAddSubtitles}
                    disabled={busy}
                  />
                </div>

                {addSubtitles ? (
                  <div className="flex items-center justify-between py-1 px-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                        字幕显示位置
                      </span>
                    </div>
                    <Select
                      value={subtitlePosition}
                      onValueChange={(v) => setSubtitlePosition(v as "high" | "mid" | "low")}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-[120px] text-xs h-9 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200">
                        <SelectValue placeholder="位置" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">靠上安全区</SelectItem>
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
                        {customBgm ? `音频: ${customBgm.filename}` : "自动匹配热度 BGM"}
                      </span>
                    </div>
                    <Switch
                      checked={addBgm}
                      onCheckedChange={setAddBgm}
                      disabled={busy}
                    />
                  </div>

                  {addBgm ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 transition-all">
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
                            disabled={uploadingBgm || busy}
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

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-[#4B5563] dark:text-slate-300">
                            <Volume2 className="size-3.5 text-slate-400" />
                            音乐音量
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
                          disabled={busy}
                          onChange={(e) => setBgmVolume(Number(e.target.value))}
                          className="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200 dark:bg-slate-700 accent-blue-600"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </CardContent>

        {/* Sticky Action Footer */}
        <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 backdrop-blur-xs flex flex-col gap-2.5 shrink-0">
          {selectedGroups.length ? (
            <p className="text-center text-xs font-medium text-slate-500 dark:text-slate-400">
              已选 <strong className="text-blue-600 dark:text-blue-400 font-bold">{selectedGroups.length}</strong> 组 · <strong className="text-slate-700 dark:text-slate-300">{totalClips}</strong> 段素材 · 将生成 <strong className="text-blue-600 dark:text-blue-400 font-bold">{totalVideos}</strong> 条成片
            </p>
          ) : (
            <p className="text-center text-xs text-slate-400">请先勾选要制作的素材组</p>
          )}

          {error ? <p className="text-center text-xs text-rose-500 font-medium">{error}</p> : null}

          <Button
            className="h-11 w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm shadow-[0_4px_14px_0_rgba(37,99,235,0.35)] transition-all active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 border-none"
            disabled={busy || !selectedGroups.length || totalClips === 0}
            onClick={() => void startBatch()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <WandSparkles className="size-4" />
            )}
            {busy
              ? `批量处理中… ${overallProgress}%`
              : totalVideos > 0
                ? `一键成片 · ${selectedGroups.length} 组 × ${countNum} 条`
                : "一键成片"}
          </Button>
        </div>
      </Card>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {/* Material Selection Preview Card - Only shown before generation to save vertical space */}
        {jobs.length === 0 ? (
          <Card className="flex flex-col border border-black/[0.04] dark:border-slate-800 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)] bg-white dark:bg-slate-900 rounded-2xl shrink-0">
            <CardHeader className="py-4 px-6 border-b border-[#F3F4F6] dark:border-slate-800 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-[#111827] dark:text-slate-100">
                {selectedGroups.length
                  ? `已选 ${selectedGroups.length} 组 · ${totalClips} 段素材`
                  : "勾选素材组后预览素材"}
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
                  去素材库管理
                </button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3.5 p-5">
              <div className="relative flex items-center overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 p-3">
                <div className="flex h-16 min-w-max items-center gap-2.5">
                  {selectedMaterials.length ? (
                    selectedMaterials.map((clip, index) => (
                      <div
                        key={clip.id}
                        className="group relative size-14 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800 shadow-2xs flex flex-col items-center justify-center"
                        title={`${clip.group_name} · ${clip.filename}`}
                      >
                        {clip.thumb_url ? (
                          <img
                            src={clip.thumb_url}
                            alt=""
                            className="absolute inset-0 size-full object-cover opacity-90"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center p-1 text-slate-400">
                            <Film className="size-4 text-blue-500/70 mb-0.5" />
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 rounded bg-[#111827]/80 px-1 py-0.5 text-[8px] font-bold font-mono text-white">
                          #{index + 1}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 py-3 px-2 text-xs text-[#9CA3AF]">
                      <Layers className="size-4 text-[#9CA3AF]" />
                      <span>请勾选一个或多个素材组，即可一键批量成片。</span>
                    </div>
                  )}
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
                <Info className="size-3.5 text-[#9CA3AF] shrink-0" />
                每个素材组独立成片；多条会自动换句序与结构侧重，避免内容完全重复。
              </p>
            </CardContent>
          </Card>
        ) : null}

        {jobs.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-5 py-3 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  本轮成片记录 ({jobs.length} 条)
                </span>
                {jobs.some((j) => j.status === "succeeded") ? (
                  <button
                    type="button"
                    onClick={toggleSelectAllExportJobs}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40"
                  >
                    {selectedExportJobIds.length === jobs.filter((j) => j.status === "succeeded").length
                      ? "取消全选"
                      : "全选已完成"}
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetBatch}
                  disabled={busy}
                  className="h-8 text-xs font-semibold rounded-xl border-blue-200 bg-blue-50/60 text-blue-600 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400 cursor-pointer gap-1"
                >
                  <Plus className="size-3.5" />
                  新建页面
                </Button>

                {onGoHistory && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onGoHistory}
                    className="h-8 text-xs font-medium rounded-xl border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer gap-1"
                  >
                    <History className="size-3.5 text-slate-500" />
                    成片历史
                  </Button>
                )}

                {jobs.some((j) => j.status === "succeeded") ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleGenerateCoversForAll()}
                    className="h-8 px-3 text-xs font-medium border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 cursor-pointer gap-1.5 rounded-xl"
                  >
                    <Sparkles className="size-3.5 text-amber-500" />
                    一键成片封面
                  </Button>
                ) : null}

                {selectedExportJobIds.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={exportingZip}
                    onClick={() => void handleExportSelectedZip()}
                    className="h-8 px-3.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white cursor-pointer gap-1.5 shadow-2xs rounded-xl border-none"
                  >
                    {exportingZip ? (
                      <Loader2 className="size-3.5 animate-spin text-white" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    打包导出已选 ({selectedExportJobIds.length}条 ZIP)
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((job, index) => {
                const done = job.status === "succeeded"
                const failed = job.status === "failed"
                const active = job.status === "queued" || job.status === "running"
                const selected = previewJobId === job.id
                const isChecked = selectedExportJobIds.includes(job.id)
                const groupName =
                  groups.find((g) => g.id === job.group_id)?.name ?? "成片"
                const isCoverLoading = coverLoadingJobId === job.id
                const coversList = job.covers || []

                return (
                  <div
                    key={job.id}
                    onClick={() => {
                      if (done && job.output_url) setPreviewJobId(job.id)
                    }}
                    className={cn(
                      "flex flex-col rounded-2xl border p-4 text-left transition-all",
                      selected
                        ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30 shadow-xs"
                        : "border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900",
                      done && "cursor-pointer hover:border-blue-400",
                      !done && "cursor-default"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {done ? (
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleJobExportSelection(job.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-[4px] border-slate-300 dark:border-slate-700 data-checked:bg-blue-600 data-checked:border-blue-600"
                          />
                        ) : null}
                        <span className="truncate text-sm font-semibold text-[#111827] dark:text-slate-100">
                          {groupName}
                          <span className="ml-1.5 font-mono text-[11px] font-medium text-[#9CA3AF]">
                            #{index + 1}
                          </span>
                        </span>
                      </div>
                      {done ? (
                        <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                      ) : failed ? (
                        <XCircle className="size-4 text-rose-500 shrink-0" />
                      ) : (
                        <Loader2 className="size-4 animate-spin text-blue-600 shrink-0" />
                      )}
                    </div>
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          failed
                            ? "bg-rose-500"
                            : done
                              ? "bg-emerald-500"
                              : "bg-blue-600"
                        )}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <p className="text-[12px] text-[#9CA3AF] line-clamp-2">
                      {failed
                        ? job.error || "失败"
                        : active
                          ? job.message || "处理中…"
                          : done
                            ? `完成 · ${job.duration ? `${Math.round(job.duration)}秒` : "可预览"}`
                            : job.message}
                    </p>

                    {/* Integrated Companion Cover Section on Each Video */}
                    {done ? (
                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                        {coversList.length > 0 ? (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                <Sparkles className="size-3 text-amber-500" />
                                配套封面 ({coversList.length}张)
                              </span>
                              <button
                                type="button"
                                disabled={isCoverLoading || busy}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleGenerateCoversForJob(job.id)
                                }}
                                className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer flex items-center gap-1"
                              >
                                {isCoverLoading ? (
                                  <Loader2 className="size-3 animate-spin text-blue-600" />
                                ) : null}
                                重新生成 3 张封面
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                              {coversList.map((c, idx) => (
                                <div
                                  key={c.id || idx}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleOpenPreview(coversList.map((item) => item.url), idx)
                                  }}
                                  className="relative group size-11 shrink-0 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 cursor-pointer"
                                  title="点击放大预览封面"
                                >
                                  <img src={c.url} alt="" className="size-full object-cover" />
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                    <ZoomIn className="size-3.5" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isCoverLoading || busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleGenerateCoversForJob(job.id)
                            }}
                            className="w-full py-1.5 px-2.5 rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1.5 hover:bg-amber-100/80 transition-all cursor-pointer"
                          >
                            {isCoverLoading ? (
                              <Loader2 className="size-3 animate-spin text-amber-600" />
                            ) : (
                              <Sparkles className="size-3 text-amber-500" />
                            )}
                            {isCoverLoading ? "生成封面中…" : "为本片生成配套爆款封面"}
                          </button>
                        )}

                        <div className="flex items-center justify-between pt-1">
                          <a
                            href={`/api/jobs/${job.id}/download`}
                            download
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-700"
                          >
                            <Download className="size-3.5" />
                            下载成片视频
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)]">
          {busy && activeJobs.length > 0 && !previewJob?.output_url ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
              <div className="mb-4 text-4xl font-bold font-mono text-[#111827] dark:text-slate-100 tracking-tight">
                {overallProgress}%
              </div>
              <Loader2 className="mb-3 size-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium text-[#111827] dark:text-slate-100">
                正在批量生成 {jobs.length} 条成片…
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                ASR 转写 → AI 选句 → 9:16 剪辑拼接 → 字幕/BGM
              </p>
            </div>
          ) : null}

          {previewJob?.output_url ? (
            <div className="absolute inset-0 z-30 flex flex-col md:flex-row bg-slate-950 rounded-2xl overflow-hidden">
              <div className="relative flex flex-1 items-center justify-center bg-black">
                <video
                  key={previewJob.output_url}
                  src={previewJob.output_url}
                  controls
                  className="size-full max-h-[85vh] object-contain"
                />
                <div className="absolute right-4 bottom-4 z-10">
                  <Button
                    asChild
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg rounded-xl"
                  >
                    <a href={`/api/jobs/${previewJob.id}/download`} download>
                      <Download className="mr-1.5 size-3.5" />
                      下载当前成片
                    </a>
                  </Button>
                </div>
              </div>

              {previewJob?.covers && previewJob.covers.length > 0 && (
                <div className="w-full md:w-[280px] shrink-0 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-900/95 p-4 flex flex-col overflow-y-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="size-4 text-amber-400 shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">
                        基于本切片卖点生成的封面
                      </h4>
                      {previewJob.headline && (
                        <p className="text-[11px] text-slate-400 truncate max-w-[200px]">
                          文案：「{previewJob.headline}」
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-1 gap-3 flex-1 overflow-y-auto">
                    {previewJob.covers.map((cover, idx) => (
                      <div
                        key={cover.id}
                        className="group relative flex flex-col rounded-xl border border-slate-800 bg-slate-950 p-2 transition-all hover:border-blue-500"
                      >
                        <div
                          onClick={() => handleOpenPreview(previewJob.covers!.map((c) => c.url), idx)}
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
                              onClick={() => handleOpenPreview(previewJob.covers!.map((c) => c.url), idx)}
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

          {!busy && !previewJob?.output_url && jobs.every((j) => j.status !== "failed") ? (
            <div className="z-10 flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="relative mb-5 flex size-20 items-center justify-center rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/40 shadow-xs">
                <CirclePlay className="size-10 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[#111827] dark:text-slate-100 tracking-tight">
                批量成片预览区
              </h3>
              <p className="text-[13px] text-[#4B5563] dark:text-slate-400 leading-relaxed max-w-[280px]">
                勾选一个或多个素材组后，点击左侧{" "}
                <span className="text-blue-600 dark:text-blue-400 font-medium">
                  「一键成片」
                </span>
                ，系统将自动产出可发布的抖音带货视频
              </p>
            </div>
          ) : null}

          {!busy &&
          jobs.length > 0 &&
          jobs.every((j) => j.status === "failed") ? (
            <div className="z-10 px-6 text-center">
              <p className="mb-2 text-sm font-semibold text-rose-600">
                全部成片失败
              </p>
              <p className="text-xs text-[#4B5563]">
                {jobs[0]?.error || "请检查素材与 ASR 配置后重试"}
              </p>
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
