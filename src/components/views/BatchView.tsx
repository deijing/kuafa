import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Download,
  Film,
  Info,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  WandSparkles,
  X,
  XCircle,
  ZoomIn,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImagePreviewModal } from "@/components/ui/image-preview-modal"
import { VideoPreviewModal } from "@/components/ui/video-preview-modal"
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
  fetchBgmFiles,
  fetchJobs,
  generateJobCovers,
  uploadBgm,
  type BatchGenerateResult,
  type BgmItem,
  type CoverStyle,
  type DurationPreference,
  type Job,
  type VideoQuality,
} from "@/lib/api"
import { cn } from "@/lib/utils"

const COMMON_NEGATIVE_PRESETS = [
  "1号链接",
  "小黄车",
  "去拍",
  "下方链接",
  "关注主播",
  "赶紧去买",
  "左下角下单",
  "不要价格",
  "到手价",
  "券后价",
]

export interface BatchSession {
  id: string
  title: string
  groupName: string
  timeLabel: string
  dateLabel: string
  createdAt: string
  jobs: Job[]
  isCurrent?: boolean
  completedCount: number
  runningCount: number
  failedCount: number
  totalCount: number
}

interface BatchViewProps {
  onGoLibrary?: () => void
}

export function BatchView({ onGoLibrary }: BatchViewProps) {
  const { groups, loading } = useMaterials()
  const { registerJobs } = useJobs()

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [countInput, setCountInput] = useState<string>("3")
  const [durationKey, setDurationKey] = useState<string>("s45")
  const [customSeconds, setCustomSeconds] = useState<number>(45)
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("1080p")
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0)
  const [randomizeIntro, setRandomizeIntro] = useState<boolean>(true)
  const [subtitlePosition, setSubtitlePosition] = useState<"high" | "mid" | "low">("high")
  const [addSubtitles, setAddSubtitles] = useState(true)
  const [addBgm, setAddBgm] = useState(true)
  const [bgmVolume, setBgmVolume] = useState(25)
  const [customBgm, setCustomBgm] = useState<BgmItem | null>(null)
  const [bgmLibraryList, setBgmLibraryList] = useState<BgmItem[]>([])
  const [selectedBgmMode, setSelectedBgmMode] = useState<string>("auto")
  const [uploadingBgm, setUploadingBgm] = useState(false)
  const bgmFileInputRef = useRef<HTMLInputElement>(null)

  const loadBgmLibrary = useCallback(async () => {
    try {
      const list = await fetchBgmFiles()
      setBgmLibraryList(list)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadBgmLibrary()
  }, [loadBgmLibrary])

  const [clipsPerVideo, setClipsPerVideo] = useState<number | null>(5)
  const [shuffleClips, setShuffleClips] = useState<boolean>(true)
  const [deepDedup, setDeepDedup] = useState<boolean>(true)

  // 口播否词过滤
  const [filterLivePitch, setFilterLivePitch] = useState<boolean>(true)
  const [filterPrice, setFilterPrice] = useState<boolean>(false)
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
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)
  const userClearedRef = useRef(false)

  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)
  const [videoModalJobId, setVideoModalJobId] = useState<string | null>(null)

  const handleOpenPreview = (imgs: string[], index = 0) => {
    setPreviewImages(imgs)
    setPreviewIndex(index)
    setIsPreviewOpen(true)
  }

  const handleOpenVideoPreview = (jobId: string) => {
    setVideoModalJobId(jobId)
    setPreviewJobId(jobId)
    setIsVideoModalOpen(true)
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
    // 延迟到宏任务，避免在 effect 内同步触发 setState
    const timer = window.setTimeout(() => {
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
    }, 0)
    return () => window.clearTimeout(timer)
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

  const [allHistoryJobs, setAllHistoryJobs] = useState<Job[]>([])
  const [currentBatchJobIds, setCurrentBatchJobIds] = useState<string[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>("latest")

  const tabScrollRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const scrollStartRef = useRef(0)
  const hasDraggedRef = useRef(false)
  const lastXRef = useRef(0)
  const lastTimeRef = useRef(0)
  const velocityRef = useRef(0)
  const momentumFrameRef = useRef<number | null>(null)

  const scrollTabs = (direction: "left" | "right") => {
    if (tabScrollRef.current) {
      tabScrollRef.current.scrollBy({
        left: direction === "left" ? -300 : 300,
        behavior: "smooth",
      })
    }
  }

  // 原生横向滚轮平滑转换（无 CSS 动画打架冲突，60fps极速响应）
  useEffect(() => {
    const el = tabScrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY * 0.95
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // 鼠标拖拽平滑滑动 + 惯性滑动 (Inertia Momentum Drag)
  const handleTabMouseDown = (e: React.MouseEvent) => {
    if (!tabScrollRef.current) return
    if (momentumFrameRef.current) cancelAnimationFrame(momentumFrameRef.current)
    isDraggingRef.current = true
    hasDraggedRef.current = false
    startXRef.current = e.pageX
    lastXRef.current = e.pageX
    lastTimeRef.current = performance.now()
    scrollStartRef.current = tabScrollRef.current.scrollLeft
    velocityRef.current = 0
  }

  const handleTabMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !tabScrollRef.current) return
    const dx = e.pageX - startXRef.current
    if (Math.abs(dx) > 3) {
      hasDraggedRef.current = true
    }
    tabScrollRef.current.scrollLeft = scrollStartRef.current - dx

    const now = performance.now()
    const dt = now - lastTimeRef.current
    if (dt > 10) {
      velocityRef.current = (e.pageX - lastXRef.current) / dt
      lastXRef.current = e.pageX
      lastTimeRef.current = now
    }
  }

  const handleTabMouseUpOrLeave = () => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (!tabScrollRef.current) return

    // 惯性物理减速
    let v = velocityRef.current * 15
    const friction = 0.92
    const applyMomentum = () => {
      if (!tabScrollRef.current) return
      if (Math.abs(v) > 0.3) {
        tabScrollRef.current.scrollLeft -= v
        v *= friction
        momentumFrameRef.current = requestAnimationFrame(applyMomentum)
      }
    }
    if (Math.abs(v) > 0.8) {
      momentumFrameRef.current = requestAnimationFrame(applyMomentum)
    }
  }

  const groupNameMap = useMemo(() => {
    return Object.fromEntries(groups.map((g) => [g.id, g.name]))
  }, [groups])

  // 加载全量历史任务
  const loadAllJobs = useCallback(async () => {
    try {
      const data = await fetchJobs()
      if (Array.isArray(data)) {
        setAllHistoryJobs(data)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadAllJobs()
  }, [loadAllJobs])

  // 将全量历史与当前任务智能聚类为不同批次项目（像浏览器标签页一样独立隔离）
  const batchSessions = useMemo<BatchSession[]>(() => {
    const jobMap = new Map<string, Job>()
    allHistoryJobs.forEach((j) => jobMap.set(j.id, j))
    jobs.forEach((j) => jobMap.set(j.id, j))

    const sortedJobs = Array.from(jobMap.values()).sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    if (!sortedJobs.length) return []

    // 1. 优先按显式 batch_id 严格归组；未打标的历史任务按时间窗口 (<=30s) 聚类
    const clusterMap = new Map<string, Job[]>()
    const unbatched: Job[] = []

    for (const job of sortedJobs) {
      if (job.batch_id) {
        const existing = clusterMap.get(job.batch_id) || []
        existing.push(job)
        clusterMap.set(job.batch_id, existing)
      } else {
        unbatched.push(job)
      }
    }

    const clusters: { id: string; jobs: Job[] }[] = []
    clusterMap.forEach((batchJobs, bId) => {
      clusters.push({ id: bId, jobs: batchJobs })
    })

    let currentCluster: Job[] = []
    for (const job of unbatched) {
      if (currentCluster.length === 0) {
        currentCluster.push(job)
      } else {
        const lastJob = currentCluster[currentCluster.length - 1]
        const diffMs = Math.abs(
          new Date(lastJob.created_at).getTime() - new Date(job.created_at).getTime()
        )
        if (diffMs <= 30000) {
          currentCluster.push(job)
        } else {
          clusters.push({ id: `batch_${currentCluster[0].id}`, jobs: currentCluster })
          currentCluster = [job]
        }
      }
    }
    if (currentCluster.length > 0) {
      clusters.push({ id: `batch_${currentCluster[0].id}`, jobs: currentCluster })
    }

    // 按最新成片时间倒序排列批次
    clusters.sort((a, b) => {
      const timeA = a.jobs[0] ? new Date(a.jobs[0].created_at).getTime() : 0
      const timeB = b.jobs[0] ? new Date(b.jobs[0].created_at).getTime() : 0
      return timeB - timeA
    })

    const currentSet = new Set(currentBatchJobIds)

    return clusters.map((cluster, idx) => {
      const clusterJobs = cluster.jobs
      const firstJob = clusterJobs[0]
      const jobDate = new Date(firstJob.created_at)
      const isToday = new Date().toDateString() === jobDate.toDateString()
      const timeStr = isNaN(jobDate.getTime())
        ? firstJob.created_at.slice(11, 16) || ""
        : jobDate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
      const dateStr = isNaN(jobDate.getTime())
        ? firstJob.created_at.slice(5, 10) || ""
        : isToday
        ? "今天"
        : jobDate.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })

      const groupObj = groups.find((g) => g.id === firstJob.group_id)
      const groupName =
        groupObj?.name ||
        (firstJob.headline ? firstJob.headline.slice(0, 10) : "带货成片")
      const isThisCurrent =
        currentSet.size > 0 && clusterJobs.some((j) => currentSet.has(j.id))

      const completedCount = clusterJobs.filter((j) => j.status === "succeeded").length
      const runningCount = clusterJobs.filter(
        (j) => j.status === "running" || j.status === "queued"
      ).length
      const failedCount = clusterJobs.filter((j) => j.status === "failed").length

      const sessionNumber = clusters.length - idx

      return {
        id: cluster.id,
        title: isThisCurrent
          ? "本轮制作"
          : `第 ${sessionNumber} 批次 · ${groupName}`,
        groupName,
        timeLabel: `${dateStr} ${timeStr}`,
        dateLabel: dateStr,
        createdAt: firstJob.created_at,
        jobs: clusterJobs,
        isCurrent: isThisCurrent,
        completedCount,
        runningCount,
        failedCount,
        totalCount: clusterJobs.length,
      }
    })
  }, [allHistoryJobs, jobs, currentBatchJobIds, groups])

  // 当前选中标签页对应的批次项目（严格隔离每个批次，如 6 条 或 8 条）
  const currentSession = useMemo(() => {
    if (!batchSessions.length) return null
    const found = batchSessions.find((s) => s.id === activeSessionId)
    return found || batchSessions[0]
  }, [batchSessions, activeSessionId])

  const displayedJobs = useMemo(() => {
    return currentSession ? currentSession.jobs : jobs
  }, [currentSession, jobs])

  const handleResetBatch = useCallback(() => {
    userClearedRef.current = true
    setJobs([])
    setCurrentBatchJobIds([])
    setPreviewJobId(null)
    setVideoModalJobId(null)
    setIsVideoModalOpen(false)
    setError(null)
    setSelectedExportJobIds([])
    setVideoQuality("1080p")
    setBusy(false)
    notify({
      title: "已新建批量生成页面",
      message: "页面已重置！您可以勾选素材组、调整参数并随时开始新一轮实时批量生成。",
      type: "info",
    })
  }, [notify])

  useEffect(() => {
    const handleNewProject = () => {
      handleResetBatch()
    }
    window.addEventListener("kuafa:new-project", handleNewProject)
    return () => window.removeEventListener("kuafa:new-project", handleNewProject)
  }, [handleResetBatch])

  function toggleJobExportSelection(jobId: string) {
    setSelectedExportJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    )
  }

  function toggleSelectAllExportJobs() {
    const succeededIds = displayedJobs
      .filter((j) => j.status === "succeeded")
      .map((j) => j.id)
    const hasAll =
      succeededIds.length > 0 &&
      succeededIds.every((id) => selectedExportJobIds.includes(id))
    if (hasAll) {
      setSelectedExportJobIds((prev) =>
        prev.filter((id) => !succeededIds.includes(id))
      )
    } else {
      setSelectedExportJobIds((prev) =>
        Array.from(new Set([...prev, ...succeededIds]))
      )
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
        setAllHistoryJobs(allJobs)
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
      setAllHistoryJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
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
    const doneJobs = displayedJobs.filter((j) => j.status === "succeeded")
    if (!doneJobs.length) return
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        doneJobs.map((j) => generateJobCovers(j.id, j.headline ?? undefined, 3, coverStyle))
      )
      const updatedList = results
        .filter((r): r is PromiseFulfilledResult<Job> => r.status === "fulfilled")
        .map((r) => r.value)
      if (updatedList.length > 0) {
        setJobs((prev) =>
          prev.map((j) => updatedList.find((u) => u.id === j.id) ?? j)
        )
        setAllHistoryJobs((prev) =>
          prev.map((j) => updatedList.find((u) => u.id === j.id) ?? j)
        )
        notify({
          title: "全套爆款封面生成完成",
          message: `已成功为 ${updatedList.length} 条成片生成 3 张配套高颜值封面！`,
          type: "success",
        })
      }
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
      if (allDone) {
        const doneTimer = window.setTimeout(() => setBusy(false), 0)
        return () => window.clearTimeout(doneTimer)
      }
      return
    }
    const timer = window.setInterval(() => {
      void fetchJobs()
        .then((allJobs) => {
          setAllHistoryJobs(allJobs)
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
      setSelectedBgmMode(uploaded.filename)
      void loadBgmLibrary()
      notify({
        title: "BGM 上传成功",
        message: `「${uploaded.title || uploaded.filename}」已添加至背景音乐库并选中！`,
        type: "success",
      })
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
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const n = countNum
      const bgmTarget = customBgm ? customBgm.filename : (selectedBgmMode === "auto" ? "auto" : selectedBgmMode)
      const results = await Promise.allSettled(
        usable.map((group) =>
          createBatchJobs({
            batch_id: batchId,
            group_id: group.id,
            count: n,
            material_ids: group.materials.map((m) => m.id),
            duration_preference: durationPref,
            target_seconds: targetSeconds,
            speech_speed: speechSpeed,
            video_quality: videoQuality,
            randomize_intro: randomizeIntro,
            subtitle_position: subtitlePosition,
            add_captions: addSubtitles,
            add_sfx: addBgm,
            add_subtitles: addSubtitles,
            add_bgm: addBgm,
            bgm_volume: bgmVolume,
            bgm_file: bgmTarget,
            mode: "sell",
            extract_rules: rules,
            negative_words: negativeWords,
            filter_live_pitch: filterLivePitch,
            filter_price: filterPrice,
            title: `${group.name} · 带货成片`,
            clips_per_video: clipsPerVideo,
            shuffle_clips: shuffleClips,
            deep_dedup: deepDedup,
          })
        )
      )
      const createdList = results
        .filter((r): r is PromiseFulfilledResult<BatchGenerateResult> => r.status === "fulfilled")
        .flatMap((r) => r.value.jobs)
      if (createdList.length > 0) {
        setJobs(createdList)
        setAllHistoryJobs((prev) => [
          ...createdList,
          ...prev.filter((p) => !createdList.some((c) => c.id === p.id)),
        ])
        setCurrentBatchJobIds(createdList.map((c) => c.id))
        setActiveSessionId(batchId)
        registerJobs(createdList)
      } else {
        setBusy(false)
        setError("创建批量任务失败，请检查素材后重试")
      }
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建批量任务失败")
    }
  }

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

            {/* 成片画质规格 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-blue-600" />
                  <span>成片输出画质</span>
                </h4>
                <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md">
                  {videoQuality === "4k"
                    ? "4K 超清 · 母带级"
                    : videoQuality === "2k"
                    ? "2K 极清 · 蓝光级"
                    : videoQuality === "720p"
                    ? "720P · 极速出片"
                    : "1080P · 推荐默认"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "1080p", label: "1080P 全高清", sub: "1080×1920", badge: "推荐" },
                  { id: "4k", label: "4K 超高清", sub: "2160×3840", badge: "超清" },
                  { id: "2k", label: "2K 极清", sub: "1440×2560", badge: "蓝光" },
                  { id: "720p", label: "720P 高清", sub: "720×1280", badge: "极速" },
                ].map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setVideoQuality(q.id as VideoQuality)}
                    className={cn(
                      "relative flex flex-col items-start p-2.5 rounded-xl text-left border transition-all cursor-pointer",
                      videoQuality === q.id
                        ? "bg-blue-50/80 dark:bg-blue-950/50 border-blue-500 ring-2 ring-blue-500/20 text-blue-950 dark:text-blue-200 font-bold shadow-2xs"
                        : "bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 text-slate-700 dark:text-slate-300"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-bold">{q.label}</span>
                      {q.badge && (
                        <span
                          className={cn(
                            "text-[9px] px-1 py-0.2 rounded font-semibold",
                            q.badge === "推荐"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : q.badge === "超清"
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          )}
                        >
                          {q.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5 leading-tight">{q.sub}</span>
                  </button>
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

                {/* 不报价格 / 纯种草讲解 Switch */}
                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        不报价格 (纯种草/细节讲解)
                      </span>
                      <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-200/60">
                        去价格化
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      自动剔除「xx元、到手价、券后、特价秒杀」等报价口播，适合长期种草
                    </span>
                  </div>
                  <Switch
                    checked={filterPrice}
                    onCheckedChange={setFilterPrice}
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
                        {customBgm
                          ? `已选音频: ${customBgm.title || customBgm.filename}`
                          : selectedBgmMode === "auto"
                          ? bgmLibraryList.length > 0
                            ? `自动匹配 (已载入 ${bgmLibraryList.length} 首音乐)`
                            : "默认无内置音乐 (可点击下方上传)"
                          : `已选: ${selectedBgmMode}`}
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
                      {/* BGM Source Selection Dropdown */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            音乐选择
                          </span>
                          <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400">
                            音乐库: {bgmLibraryList.length} 首
                          </span>
                        </div>
                        <Select
                          value={customBgm ? customBgm.filename : selectedBgmMode}
                          onValueChange={(val) => {
                            if (val === "auto") {
                              setCustomBgm(null)
                              setSelectedBgmMode("auto")
                            } else {
                              const found = bgmLibraryList.find((b) => b.filename === val)
                              if (found) {
                                setCustomBgm(found)
                                setSelectedBgmMode(val)
                              } else {
                                setSelectedBgmMode(val)
                              }
                            }
                          }}
                          disabled={busy}
                        >
                          <SelectTrigger className="w-full text-xs h-9 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                            <SelectValue placeholder="选择背景音乐" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              {bgmLibraryList.length > 0
                                ? `全自动轮播匹配 (从音乐库 ${bgmLibraryList.length} 首歌曲中轮换)`
                                : "全自动匹配 (音乐库暂为空，请点击下方上传)"}
                            </SelectItem>
                            {bgmLibraryList.map((bgm) => (
                              <SelectItem key={bgm.filename} value={bgm.filename}>
                                {bgm.title || bgm.filename} ({bgm.duration_label || "--:--"})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Quick Upload Button */}
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

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={uploadingBgm || busy}
                          onClick={() => bgmFileInputRef.current?.click()}
                          className="w-full h-8 text-xs font-medium border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 cursor-pointer shadow-2xs gap-1.5"
                        >
                          {uploadingBgm ? (
                            <Loader2 className="size-3.5 animate-spin text-blue-600" />
                          ) : (
                            <Upload className="size-3.5 text-blue-600" />
                          )}
                          {uploadingBgm ? "上传中…" : "上传新音乐至音乐库"}
                        </Button>
                      </div>

                      {/* Volume Slider */}
                      <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
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

      {/* Right Column: Independent full-height scrollable container for all batch cards and previews */}
      <div className="flex min-w-0 flex-1 flex-col h-full overflow-y-auto pr-1 pb-16 gap-6">
        {/* Material Selection Preview Card - Only shown before generation */}
        {jobs.length === 0 ? (
          <Card className="flex flex-col border border-black/[0.04] dark:border-slate-800 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)] bg-white dark:bg-slate-900 rounded-2xl shrink-0">
            <CardHeader className="py-4 px-6 border-b border-[#F3F4F6] dark:border-slate-800 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-[#111827] dark:text-slate-100">
                {selectedGroups.length
                  ? `已选 ${selectedGroups.length} 组 · ${totalClips} 段素材`
                  : "勾选素材组后预览素材"}
              </CardTitle>
              <div className="flex items-center gap-3">
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

        {/* Batch Generated Cards Grid Header & List */}
        {batchSessions.length > 0 ? (
          <div className="flex flex-col gap-4 max-w-[1020px]">
            {/* Browser-style Batch Tabs Bar (像浏览器标签页一样的批次导航，支持横向鼠标滚轮、左右翻页按钮与触控滑动) */}
            <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-1.5 shadow-2xs backdrop-blur-md">
              {/* 向左微调滚动按钮 */}
              <button
                type="button"
                onClick={() => scrollTabs("left")}
                className="size-7 flex items-center justify-center rounded-xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-900 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-200/60 dark:border-slate-700/60 shadow-2xs transition-all shrink-0 cursor-pointer"
                title="向左滚动查看更多批次"
              >
                <ChevronLeft className="size-4" />
              </button>

              {/* 批次标签横向滚动视口 */}
              <div
                ref={tabScrollRef}
                onMouseDown={handleTabMouseDown}
                onMouseMove={handleTabMouseMove}
                onMouseUp={handleTabMouseUpOrLeave}
                onMouseLeave={handleTabMouseUpOrLeave}
                className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-0.5 min-w-0 flex-1 select-none cursor-grab active:cursor-grabbing no-scrollbar"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {batchSessions.map((session, sIdx) => {
                  const isActive =
                    activeSessionId === session.id ||
                    (activeSessionId === "latest" && sIdx === 0)
                  return (
                    <button
                      type="button"
                      key={session.id}
                      onClick={(e) => {
                        if (hasDraggedRef.current) return
                        e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
                        setActiveSessionId(session.id)
                        const succeeded = session.jobs.filter((j) => j.status === "succeeded").map((j) => j.id)
                        setSelectedExportJobIds(succeeded)
                        const firstOk = session.jobs.find((j) => j.output_url)
                        if (firstOk) setPreviewJobId(firstOk.id)
                      }}
                      className={cn(
                        "group relative flex items-center gap-2 px-3 py-1.5 text-xs rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0",
                        isActive
                          ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 font-bold shadow-xs border border-slate-200/80 dark:border-slate-700"
                          : "text-slate-600 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-200 font-medium"
                      )}
                    >
                      <span className="flex items-center">
                        {session.isCurrent ? (
                          <Sparkles className="size-3.5 text-blue-500 shrink-0" />
                        ) : (
                          <Layers className="size-3.5 text-slate-400 group-hover:text-blue-500 shrink-0 transition-colors" />
                        )}
                      </span>
                      <span className="truncate max-w-[140px]">{session.title}</span>
                      <span className="font-mono text-[10px] text-slate-400 font-normal">
                        {session.timeLabel}
                      </span>
                      {session.runningCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400 border border-blue-200/60">
                          <Loader2 className="size-2.5 animate-spin" />
                          {session.completedCount}/{session.totalCount}
                        </span>
                      ) : session.completedCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-200/60">
                          <CheckCircle2 className="size-2.5" />
                          {session.completedCount}条
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-200/70 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-500">
                          {session.totalCount}条
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 向右微调滚动按钮 */}
              <button
                type="button"
                onClick={() => scrollTabs("right")}
                className="size-7 flex items-center justify-center rounded-xl bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-900 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-200/60 dark:border-slate-700/60 shadow-2xs transition-all shrink-0 cursor-pointer"
                title="向右滚动查看更多批次"
              >
                <ChevronRight className="size-4" />
              </button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void loadAllJobs()}
                className="h-7 px-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/70 dark:hover:bg-slate-800/70 rounded-xl shrink-0 cursor-pointer"
                title="刷新历史批次"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>

            {/* Top Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-5 py-3 shadow-2xs sticky top-0 z-20 backdrop-blur-md bg-white/95 dark:bg-slate-900/95">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {currentSession ? currentSession.title : "批量成片"}
                  </span>
                  <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    共 {displayedJobs.length} 条
                  </span>
                </div>

                {displayedJobs.some((j) => j.status === "succeeded") ? (
                  <button
                    type="button"
                    onClick={toggleSelectAllExportJobs}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    {selectedExportJobIds.length === displayedJobs.filter((j) => j.status === "succeeded").length
                      ? "取消全选"
                      : `全选已完成 (${selectedExportJobIds.length}/${displayedJobs.filter((j) => j.status === "succeeded").length})`}
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {displayedJobs.some((j) => j.status === "succeeded" && !!j.output_url) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const firstDone = displayedJobs.find((j) => j.status === "succeeded" && j.output_url)
                      if (firstDone) handleOpenVideoPreview(firstDone.id)
                    }}
                    className="h-8 px-3 text-xs font-semibold border-blue-200 bg-blue-50/80 text-blue-600 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400 cursor-pointer gap-1.5 rounded-xl shadow-2xs"
                  >
                    <CirclePlay className="size-3.5 text-blue-600 dark:text-blue-400" />
                    快速大屏连播
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetBatch}
                  disabled={busy}
                  className="h-8 text-xs font-semibold rounded-xl border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer gap-1"
                >
                  <Plus className="size-3.5" />
                  新建批次
                </Button>

                {displayedJobs.some((j) => j.status === "succeeded") ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleGenerateCoversForAll()}
                    className="h-8 px-3 text-xs font-medium border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 cursor-pointer gap-1.5 rounded-xl"
                  >
                    <Sparkles className="size-3.5 text-amber-500" />
                    一键全套封面
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

            {/* Cards Grid: 2-column showcase layout for balanced, breathable viewing */}
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
              {displayedJobs.map((job, index) => {
                const done = job.status === "succeeded"
                const active = job.status === "queued" || job.status === "running"
                const selected = previewJobId === job.id
                const isChecked = selectedExportJobIds.includes(job.id)
                const groupName =
                  groups.find((g) => g.id === job.group_id)?.name ?? "成片"
                const isCoverLoading = coverLoadingJobId === job.id
                const coversList = job.covers || []
                const posterUrl = coversList[0]?.url

                return (
                  <div
                    key={job.id}
                    className={cn(
                      "group flex flex-col justify-between rounded-2xl border bg-white dark:bg-slate-900 overflow-hidden transition-all duration-200 hover:shadow-md",
                      isChecked
                        ? "border-blue-500 ring-2 ring-blue-500/20 shadow-sm"
                        : selected
                          ? "border-blue-400 ring-1 ring-blue-400/20 shadow-xs"
                          : "border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs"
                    )}
                  >
                    <div>
                      {/* 1. Visual Hero Media Container (Aspect 16/10 for clean landscape preview poster or video thumbnail) */}
                      <div
                        onClick={() => {
                          if (done && job.output_url) {
                            handleOpenVideoPreview(job.id)
                          }
                        }}
                        className={cn(
                          "relative aspect-[16/10] w-full overflow-hidden bg-slate-950 select-none",
                          done && job.output_url ? "cursor-pointer" : "cursor-default"
                        )}
                      >
                        {done ? (
                          <>
                            {/* Poster Background */}
                            {posterUrl ? (
                              <img
                                src={posterUrl}
                                alt={groupName}
                                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            ) : (
                              <div className="size-full bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950/40 flex items-center justify-center">
                                <Film className="size-10 text-slate-700 group-hover:text-blue-500 transition-colors" />
                              </div>
                            )}

                            {/* Dark Gradient & Glowing Play Overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40 group-hover:from-black/90 group-hover:via-black/40 group-hover:to-black/50 transition-all duration-200 flex flex-col items-center justify-center">
                              <div className="flex size-11 items-center justify-center rounded-full bg-white/90 text-slate-900 group-hover:bg-blue-600 group-hover:text-white shadow-xl transition-all duration-200 group-hover:scale-110">
                                <Play className="size-5 fill-current ml-0.5" />
                              </div>
                              <span className="mt-1.5 text-[11px] font-semibold text-white/90 drop-shadow opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                点击大屏播放
                              </span>
                            </div>

                            {/* Floating Badges */}
                            {/* Top-Left: Checkbox + Sequence Number */}
                            <div
                              className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleJobExportSelection(job.id)}
                                className="rounded-[4px] border-white/60 bg-black/40 data-checked:bg-blue-600 data-checked:border-blue-600 backdrop-blur-md size-4 shadow-sm"
                              />
                              <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white text-[11px] font-mono font-bold border border-white/10 shadow-sm">
                                #{index + 1}
                              </span>
                            </div>

                            {/* Top-Right: Status Badge */}
                            <div className="absolute top-2.5 right-2.5 z-10">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/90 backdrop-blur-md text-white text-[11px] font-semibold shadow-sm border border-emerald-400/30">
                                <CheckCircle2 className="size-3" />
                                已完成
                              </span>
                            </div>

                            {/* Bottom-Left: Format Badge */}
                            <div className="absolute bottom-2.5 left-2.5 z-10">
                              <span className="px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-slate-200 text-[10px] font-mono font-medium border border-white/10">
                                9:16 FHD
                              </span>
                            </div>

                            {/* Bottom-Right: Duration Badge */}
                            <div className="absolute bottom-2.5 right-2.5 z-10">
                              <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur-md text-white text-[11px] font-mono font-bold border border-white/10">
                                {job.duration ? `${Math.round(job.duration)}s` : "00:45"}
                              </span>
                            </div>
                          </>
                        ) : active ? (
                          /* Running / Queued State */
                          <div className="size-full flex flex-col items-center justify-center p-4 text-center relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-indigo-600/15 to-blue-600/10 animate-pulse" />
                            {/* Top badges */}
                            <div className="absolute top-2.5 left-2.5 z-10">
                              <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white text-[11px] font-mono font-bold border border-white/10">
                                #{index + 1}
                              </span>
                            </div>
                            <div className="absolute top-2.5 right-2.5 z-10">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600/90 backdrop-blur-md text-white text-[11px] font-semibold shadow-sm animate-pulse">
                                <Loader2 className="size-3 animate-spin" />
                                剪辑中
                              </span>
                            </div>

                            <Loader2 className="size-8 animate-spin text-blue-500 mb-2 z-10" />
                            <span className="text-base font-mono font-bold text-white z-10 tracking-tight">
                              {job.progress}%
                            </span>
                            <span className="text-xs text-slate-400 mt-1 z-10 max-w-[85%] truncate">
                              {job.message || "正在智能合成剪辑中…"}
                            </span>
                          </div>
                        ) : (
                          /* Failed State */
                          <div className="size-full flex flex-col items-center justify-center p-4 text-center bg-rose-950/40 relative">
                            <div className="absolute top-2.5 left-2.5 z-10">
                              <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-white text-[11px] font-mono font-bold border border-white/10">
                                #{index + 1}
                              </span>
                            </div>
                            <div className="absolute top-2.5 right-2.5 z-10">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-600 backdrop-blur-md text-white text-[11px] font-semibold shadow-sm">
                                <XCircle className="size-3" />
                                失败
                              </span>
                            </div>
                            <XCircle className="size-8 text-rose-400 mb-2" />
                            <span className="text-xs text-rose-300 max-w-[85%] line-clamp-2">
                              {job.error || "生成失败"}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 2. Card Content Body */}
                      <div className="p-4 flex flex-col gap-3">
                        {/* Title & Headline Hook */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate" title={groupName}>
                              {groupName}
                            </h4>
                            {done && job.duration ? (
                              <span className="text-xs font-mono font-medium text-slate-400 shrink-0">
                                {Math.round(job.duration)} 秒
                              </span>
                            ) : null}
                          </div>
                          {job.headline ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 flex items-center gap-1" title={job.headline}>
                              <Sparkles className="size-3 text-blue-500 shrink-0" />
                              <span className="truncate">「{job.headline}」</span>
                            </p>
                          ) : done ? (
                            <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                              AI 智能分镜剪辑 · 智能字幕 · BGM 自动适配
                            </p>
                          ) : null}
                        </div>

                        {/* Companion Covers Strip */}
                        {done && (
                          <div>
                            {coversList.length > 0 ? (
                              <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-2.5 flex flex-col gap-2">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                    <Sparkles className="size-3 text-amber-500" />
                                    配套封面 ({coversList.length} 张)
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isCoverLoading || busy}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleGenerateCoversForJob(job.id)
                                    }}
                                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50"
                                  >
                                    {isCoverLoading ? (
                                      <Loader2 className="size-3 animate-spin text-blue-600" />
                                    ) : (
                                      <RefreshCw className="size-2.5" />
                                    )}
                                    <span className="whitespace-nowrap">换一组</span>
                                  </button>
                                </div>

                                {/* 3 mini cover cards */}
                                <div className="grid grid-cols-3 gap-2">
                                  {coversList.map((cover, idx) => (
                                    <div
                                      key={cover.id || idx}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleOpenPreview(
                                          coversList.map((item) => item.url),
                                          idx
                                        )
                                      }}
                                      className="group/cov relative aspect-[9/16] w-full rounded-lg overflow-hidden border border-slate-200/80 dark:border-slate-700 bg-black cursor-pointer shadow-2xs hover:ring-2 hover:ring-blue-500 transition-all"
                                      title={cover.headline ? `【${cover.headline}】· 点击放大预览` : "点击放大预览封面"}
                                    >
                                      <img
                                        src={cover.url}
                                        alt={`封面 #${idx + 1}`}
                                        className="size-full object-cover transition-transform duration-300 group-hover/cov:scale-105"
                                      />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/cov:opacity-100 transition-opacity flex items-center justify-center text-white backdrop-blur-2xs">
                                        <ZoomIn className="size-3.5" />
                                      </div>
                                      <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-white text-[8px] font-mono font-medium">
                                        #{idx + 1}
                                      </span>
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
                                className="w-full h-8.5 rounded-xl border border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-amber-100/70 dark:hover:bg-amber-900/30 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                {isCoverLoading ? (
                                  <Loader2 className="size-3.5 animate-spin text-amber-600" />
                                ) : (
                                  <Sparkles className="size-3.5 text-amber-500" />
                                )}
                                <span>{isCoverLoading ? "正在生成封面…" : "✨ 一键生成 3 张配套爆款封面"}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 3. Card Action Footer */}
                    {done && job.output_url ? (
                      <div className="flex items-center gap-2.5 p-4 pt-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleOpenVideoPreview(job.id)
                          }}
                          className="flex-1 h-8.5 rounded-xl bg-blue-50/70 hover:bg-blue-100/80 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-semibold text-xs border border-blue-200/80 dark:border-blue-900/60 cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs whitespace-nowrap"
                        >
                          <CirclePlay className="size-3.5" />
                          <span>大屏预览</span>
                        </Button>

                        <a
                          href={`/api/jobs/${job.id}/download`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 h-8.5 px-3 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
                          title="下载 MP4 视频文件"
                        >
                          <Download className="size-3.5" />
                          <span>下载 MP4</span>
                        </a>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Empty / Prompt Preview Placeholder when no jobs exist */
          <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)]">
            {busy && activeJobs.length > 0 ? (
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
            ) : (
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
            )}
          </div>
        )}
      </div>

      {/* Video Preview Theater Modal */}
      <VideoPreviewModal
        isOpen={isVideoModalOpen}
        onClose={() => setIsVideoModalOpen(false)}
        jobs={displayedJobs}
        initialJobId={videoModalJobId}
        groupNameMap={groupNameMap}
        onGenerateCovers={handleGenerateCoversForJob}
        isGeneratingCovers={busy || coverLoadingJobId !== null}
        generatingJobId={coverLoadingJobId}
        onOpenImagePreview={handleOpenPreview}
      />

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

