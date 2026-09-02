import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  CirclePlay,
  Download,
  FileText,
  Film,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Volume2,
  WandSparkles,
  X,
  XCircle,
  ZoomIn,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ImagePreviewModal } from "@/components/ui/image-preview-modal"
import { VideoPreviewModal } from "@/components/ui/video-preview-modal"
import { SubtitleProofreaderModal } from "@/components/ui/subtitle-proofreader-modal"
import { JobLogsModal } from "@/components/ui/job-logs-modal"
import {
  Select,
  SelectContent,
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
  createGenerateJob,
  deleteJob,
  exportJobsZip,
  fetchApiSecrets,
  fetchBgmFiles,
  fetchJobs,
  generateJobCovers,
  getMaterialVideoUrl,
  retryJob,
  retryJobsBatch,
  uploadBgm,
  type BgmItem,
  type CoverStyle,
  type DurationPreference,
  type Job,
  type Material,
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

export interface MaterialCutSession {
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

interface MaterialCutViewProps {
  onGoLibrary?: () => void
}

function formatMiddleTruncate(filename: string, startChars = 8, endChars = 6) {
  if (!filename) return ""
  const dotIdx = filename.lastIndexOf(".")
  let ext = ""
  let baseName = filename
  if (dotIdx > 0 && filename.length - dotIdx <= 6) {
    ext = filename.slice(dotIdx)
    baseName = filename.slice(0, dotIdx)
  }
  if (baseName.length <= startChars + endChars + 3) return filename
  return `${baseName.slice(0, startChars)}...${baseName.slice(-endChars)}${ext}`
}

export function MaterialCutView({ onGoLibrary }: MaterialCutViewProps) {
  const { groups } = useMaterials()
  const { registerJobs, jobs: globalJobs } = useJobs()
  const { notify } = useNotifications()

  // 1. 素材组与切片多选
  const [selectedGroupId, setSelectedGroupId] = useState<string>("")
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([])

  // 2. 拼接模式：
  // "all_in_one"：勾选的这 N 个素材全部合成到 1 条成片中（100% 覆盖）
  // "chunked"：按每 N 个素材合成 1 条成片（例如 10 个素材，每 5 个合成 1 条）
  // "variants"：基于勾选的 N 个素材，生成多条不同句序/不同段落组合的差异化版本
  const [stitchMode, setStitchMode] = useState<"all_in_one" | "chunked" | "variants">("all_in_one")
  const [chunkSize, setChunkSize] = useState<number>(5)
  const [variantCount, setVariantCount] = useState<number>(3)

  // 3. 时长与参数
  const [durationKey, setDurationKey] = useState<string>("auto")
  const [customSeconds, setCustomSeconds] = useState<number>(60)
  const [videoQuality, setVideoQuality] = useState<VideoQuality>("1080p")
  const [speechSpeed] = useState<number>(1.0)
  const [randomizeIntro] = useState<boolean>(true)
  const [subtitlePosition] = useState<"high" | "mid" | "low">("high")
  const [addSubtitles, setAddSubtitles] = useState(true)
  const [addBgm, setAddBgm] = useState(true)
  const [bgmVolume, setBgmVolume] = useState<number>(25)
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

  // 4. 否词过滤
  const [filterLivePitch, setFilterLivePitch] = useState<boolean>(true)
  const filterPrice = false
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

  const [rules] = useState<Record<string, boolean>>(
    Object.fromEntries(extractRules.map((r) => [r.id, r.checked]))
  )

  // 5. 任务与状态
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userClearedRef = useRef(false)

  // 模态与大图/大视频预览
  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)
  const [videoModalJobId, setVideoModalJobId] = useState<string | null>(null)
  const [proofreadingJob, setProofreadingJob] = useState<Job | null>(null)
  const [logJob, setLogJob] = useState<{ id: string; title: string } | null>(null)

  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null)
  const [coverLoadingJobId, setCoverLoadingJobId] = useState<string | null>(null)
  const [selectedExportJobIds, setSelectedExportJobIds] = useState<string[]>([])
  const coverStyle: CoverStyle = "yellow-red"
  const [exportingZip, setExportingZip] = useState(false)

  const [allHistoryJobs, setAllHistoryJobs] = useState<Job[]>([])
  const [currentBatchJobIds, setCurrentBatchJobIds] = useState<string[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>("latest")

  // 同步全局 JobsProvider 状态到当前批次视图与历史
  useEffect(() => {
    if (!globalJobs || !globalJobs.length) return
    setAllHistoryJobs(globalJobs)
    setJobs((prev) => {
      if (!prev.length) return prev
      const map = new Map(globalJobs.map((j) => [j.id, j]))
      let changed = false
      const next = prev.map((j) => {
        const updated = map.get(j.id)
        if (
          updated &&
          (updated.status !== j.status ||
            updated.progress !== j.progress ||
            updated.message !== j.message ||
            updated.output_url !== j.output_url ||
            updated.error !== j.error)
        ) {
          changed = true
          return updated
        }
        return j
      })
      return changed ? next : prev
    })
  }, [globalJobs])

  // 当前选中的素材组
  const currentGroup = useMemo(() => {
    return groups.find((g) => g.id === selectedGroupId) ?? groups[0] ?? null
  }, [groups, selectedGroupId])

  // 默认选中第一个非空素材组
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!groups.length) return
      if (!selectedGroupId || !groups.some((g) => g.id === selectedGroupId)) {
        const firstUsable = groups.find((g) => g.materials.length > 0) ?? groups[0]
        if (firstUsable) {
          setSelectedGroupId(firstUsable.id)
          // 默认勾选前 5 个素材（或全选）
          setSelectedMaterialIds(firstUsable.materials.slice(0, 5).map((m) => m.id))
        }
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [groups, selectedGroupId])

  // 同步全局口播字幕默认开关
  useEffect(() => {
    void fetchApiSecrets()
      .then((secrets) => {
        if (secrets.burn_subtitles_default !== undefined) {
          setAddSubtitles(secrets.burn_subtitles_default !== false)
        }
      })
      .catch(() => {})
  }, [])

  // 切换素材组时，自动重置并预选素材
  const handleSelectGroup = (gid: string) => {
    setSelectedGroupId(gid)
    const grp = groups.find((g) => g.id === gid)
    if (grp && grp.materials.length > 0) {
      setSelectedMaterialIds(grp.materials.slice(0, 5).map((m) => m.id))
    } else {
      setSelectedMaterialIds([])
    }
  }

  // 勾选/取消勾选单个素材
  const handleToggleMaterial = (matId: string) => {
    if (busy) return
    setSelectedMaterialIds((prev) =>
      prev.includes(matId) ? prev.filter((id) => id !== matId) : [...prev, matId]
    )
  }

  const handleSelectAllMaterials = () => {
    if (!currentGroup || busy) return
    setSelectedMaterialIds(currentGroup.materials.map((m) => m.id))
  }

  const handleClearMaterialSelection = () => {
    if (busy) return
    setSelectedMaterialIds([])
  }

  // 计算已勾选的素材列表（保持用户勾选次序）
  const chosenMaterials = useMemo(() => {
    if (!currentGroup) return []
    const matMap = new Map(currentGroup.materials.map((m) => [m.id, m]))
    return selectedMaterialIds.map((id) => matMap.get(id)).filter(Boolean) as Material[]
  }, [currentGroup, selectedMaterialIds])

  const chosenCount = chosenMaterials.length

  // 动态计算目标时长与各素材预算
  const calculatedTargetSeconds = useMemo(() => {
    if (durationKey === "auto") {
      const count = stitchMode === "chunked" ? chunkSize : chosenCount
      return Math.max(20, Math.min(180, (count || 1) * 12))
    }
    if (durationKey === "s30") return 30
    if (durationKey === "s45") return 45
    if (durationKey === "mid") return 60
    if (durationKey === "long") return 90
    if (durationKey === "custom") return Math.max(15, Math.min(180, customSeconds || 60))
    return 60
  }, [durationKey, customSeconds, chosenCount, stitchMode, chunkSize])

  const durationPref = useMemo<DurationPreference>(() => {
    if (calculatedTargetSeconds <= 45) return "short"
    if (calculatedTargetSeconds >= 90) return "long"
    return "mid"
  }, [calculatedTargetSeconds])

  // 预计每个素材分配秒数
  const estSecondsPerMaterial = useMemo(() => {
    const count = stitchMode === "chunked" ? chunkSize : chosenCount
    if (!count) return 0
    return Math.round((calculatedTargetSeconds / count) * 10) / 10
  }, [calculatedTargetSeconds, chosenCount, stitchMode, chunkSize])

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
    const timer = window.setTimeout(() => {
      void loadAllJobs()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAllJobs])

  // 批次标签聚类
  const batchSessions = useMemo<MaterialCutSession[]>(() => {
    const jobMap = new Map<string, Job>()
    allHistoryJobs.forEach((j) => jobMap.set(j.id, j))
    jobs.forEach((j) => jobMap.set(j.id, j))

    const sortedJobs = Array.from(jobMap.values()).sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    if (!sortedJobs.length) return []

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

  const currentSession = useMemo(() => {
    if (!batchSessions.length) return null
    const found = batchSessions.find((s) => s.id === activeSessionId)
    return found || batchSessions[0]
  }, [batchSessions, activeSessionId])

  const displayedJobs = useMemo(() => {
    return currentSession ? currentSession.jobs : jobs
  }, [currentSession, jobs])

  const allDone =
    jobs.length > 0 &&
    jobs.every((j) => j.status === "succeeded" || j.status === "failed")

  // 轮询任务进度
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

            if (succeededCount > 0) {
              notify({
                title: "按素材分切成片完成",
                message: `成功生成 ${succeededCount} 条成片（每个选定素材均已 100% 融入）${failedCount ? `，${failedCount} 条失败` : ""}！`,
                type: "success",
              })
            } else {
              notify({
                title: "按素材分切生成失败",
                message: "所选任务渲染失败，请检查素材后重试",
                type: "error",
              })
            }
          }
        })
        .catch(() => {})
    }, 1200)
    return () => window.clearInterval(timer)
  }, [jobs, allDone, notify])

  // 重置页面
  const handleReset = useCallback(() => {
    userClearedRef.current = true
    setJobs([])
    setCurrentBatchJobIds([])
    setError(null)
    setSelectedExportJobIds([])
    setBusy(false)
    notify({
      title: "已新建按素材分切页面",
      message: "页面已重置，您可以重新勾选素材并立即生成！",
      type: "info",
    })
  }, [notify])

  // 打开视频全屏弹窗
  const handleOpenVideoPreview = (jobId: string) => {
    setVideoModalJobId(jobId)
    setIsVideoModalOpen(true)
  }

  // 打开封面大图
  const handleOpenPreviewImages = (imgs: string[], index = 0) => {
    setPreviewImages(imgs)
    setPreviewIndex(index)
    setIsPreviewOpen(true)
  }

  // 上传自定义 BGM
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

  // 开始按素材分切与全素材覆盖拼接
  async function startGenerate() {
    if (!currentGroup) {
      setError("请先选择素材组")
      return
    }
    if (chosenCount === 0) {
      setError("请至少勾选 1 个素材（推荐勾选 3~8 个素材进行全量拼接）")
      return
    }

    userClearedRef.current = false
    setError(null)
    setBusy(true)
    setJobs([])

    try {
      const batchId = `matcut_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const baseBgmTarget = customBgm
        ? customBgm.filename
        : selectedBgmMode === "auto"
        ? "auto"
        : selectedBgmMode
      const baseTitle = `${currentGroup.name} · 全素材拼接`

      let createdJobsList: Job[] = []

      if (stitchMode === "all_in_one") {
        const job = await createGenerateJob({
          material_ids: selectedMaterialIds,
          group_id: currentGroup.id,
          batch_id: batchId,
          duration_preference: durationPref,
          target_seconds: calculatedTargetSeconds,
          speech_speed: speechSpeed,
          video_quality: videoQuality,
          randomize_intro: randomizeIntro,
          subtitle_position: subtitlePosition,
          add_captions: addSubtitles,
          add_sfx: addBgm,
          add_subtitles: addSubtitles,
          add_bgm: addBgm,
          bgm_volume: bgmVolume,
          bgm_file: baseBgmTarget,
          title: `${baseTitle} (${chosenCount}段素材全覆盖)`,
          mode: "material_stitch",
          extract_rules: rules,
          negative_words: negativeWords,
          filter_live_pitch: filterLivePitch,
          filter_price: filterPrice,
          shuffle_clips: false,
        })
        createdJobsList = [job]
      } else if (stitchMode === "variants") {
        const results = await Promise.all(
          Array.from({ length: variantCount }).map((_, i) => {
            const variantBgm =
              addBgm && bgmLibraryList.length > 0 && selectedBgmMode === "auto"
                ? bgmLibraryList[i % bgmLibraryList.length]?.filename
                : baseBgmTarget

            return createGenerateJob({
              material_ids: selectedMaterialIds,
              group_id: currentGroup.id,
              batch_id: batchId,
              duration_preference: durationPref,
              target_seconds: calculatedTargetSeconds,
              speech_speed: speechSpeed,
              video_quality: videoQuality,
              randomize_intro: randomizeIntro,
              subtitle_position: subtitlePosition,
              add_captions: addSubtitles,
              add_sfx: addBgm,
              add_subtitles: addSubtitles,
              add_bgm: addBgm,
              bgm_volume: bgmVolume,
              bgm_file: variantBgm,
              title: `${baseTitle} #${i + 1}`,
              mode: "material_stitch",
              extract_rules: rules,
              negative_words: negativeWords,
              filter_live_pitch: filterLivePitch,
              filter_price: filterPrice,
              variant_index: i,
            })
          })
        )
        createdJobsList = results
      } else {
        const fullChunkCount = Math.floor(selectedMaterialIds.length / chunkSize)
        if (fullChunkCount === 0) {
          setError(`当前按每 ${chunkSize} 段/条分切，已选 ${chosenCount} 段素材不足 ${chunkSize} 段，无法生成完整视频`)
          setBusy(false)
          return
        }

        const chunks: string[][] = []
        for (let i = 0; i < fullChunkCount * chunkSize; i += chunkSize) {
          chunks.push(selectedMaterialIds.slice(i, i + chunkSize))
        }

        const results = await Promise.all(
          chunks.map((chunkIds, idx) => {
            const chunkBgm =
              addBgm && bgmLibraryList.length > 0 && selectedBgmMode === "auto"
                ? bgmLibraryList[idx % bgmLibraryList.length]?.filename
                : baseBgmTarget

            return createGenerateJob({
              material_ids: chunkIds,
              group_id: currentGroup.id,
              batch_id: batchId,
              duration_preference: durationPref,
              target_seconds: calculatedTargetSeconds,
              speech_speed: speechSpeed,
              video_quality: videoQuality,
              randomize_intro: randomizeIntro,
              subtitle_position: subtitlePosition,
              add_captions: addSubtitles,
              add_sfx: addBgm,
              add_subtitles: addSubtitles,
              add_bgm: addBgm,
              bgm_volume: bgmVolume,
              bgm_file: chunkBgm,
              title: `${baseTitle} · 第 ${idx + 1} 组 (${chunkIds.length}段)`,
              mode: "material_stitch",
              extract_rules: rules,
              negative_words: negativeWords,
              filter_live_pitch: filterLivePitch,
              filter_price: filterPrice,
              variant_index: idx,
            })
          })
        )
        createdJobsList = results
      }

      if (createdJobsList.length > 0) {
        setJobs(createdJobsList)
        setAllHistoryJobs((prev) => [
          ...createdJobsList,
          ...prev.filter((p) => !createdJobsList.some((c) => c.id === p.id)),
        ])
        setCurrentBatchJobIds(createdJobsList.map((c) => c.id))
        setActiveSessionId(batchId)
        registerJobs(createdJobsList)
      } else {
        setBusy(false)
        setError("创建任务失败，请检查素材后重试")
      }
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建任务失败")
    }
  }

  // 封面生成
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

  // 勾选/取消勾选成片导出
  const toggleJobExportSelection = (jobId: string) => {
    setSelectedExportJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    )
  }

  // 导出 ZIP
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

  const [retryingJobId, setRetryingJobId] = useState<string | null>(null)
  const [retryingBatch, setRetryingBatch] = useState(false)

  // 单条断点继续重试
  async function handleRetryJob(jobId: string) {
    if (retryingJobId) return
    setRetryingJobId(jobId)
    notify({
      title: "正在恢复任务",
      message: "正在以断点继续模式重试该生成任务（复用 ASR 缓存）…",
      type: "info",
    })
    try {
      const updated = await retryJob(jobId)
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === jobId)
        return exists ? prev.map((j) => (j.id === jobId ? updated : j)) : [updated, ...prev]
      })
      setAllHistoryJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
      setBusy(true)
      notify({
        title: "任务已重新排队启动",
        message: "正在断点继续渲染中…",
        type: "success",
      })
    } catch (err) {
      notify({
        title: "重试失败",
        message: err instanceof Error ? err.message : "无法恢复该任务",
        type: "error",
      })
    } finally {
      setRetryingJobId(null)
    }
  }

  // 批量断点重试失败任务
  async function handleRetryFailedBatch() {
    const failedIds = displayedJobs.filter((j) => j.status === "failed").map((j) => j.id)
    if (!failedIds.length || retryingBatch) return
    setRetryingBatch(true)
    notify({
      title: "正在批量重试",
      message: `正在批量以断点模式恢复 ${failedIds.length} 条失败任务…`,
      type: "info",
    })
    try {
      const res = await retryJobsBatch(failedIds)
      if (res.jobs && res.jobs.length > 0) {
        const retriedMap = new Map(res.jobs.map((j) => [j.id, j]))
        setJobs((prev) => prev.map((j) => retriedMap.get(j.id) || j))
        setAllHistoryJobs((prev) => prev.map((j) => retriedMap.get(j.id) || j))
        setBusy(true)
      }
      notify({
        title: "批量断点重试已启动",
        message: `已重新排队 ${failedIds.length} 条任务！`,
        type: "success",
      })
    } catch (err) {
      notify({
        title: "批量重试失败",
        message: err instanceof Error ? err.message : "操作异常",
        type: "error",
      })
    } finally {
      setRetryingBatch(false)
    }
  }

  // 删除单条成片记录
  async function handleDeleteJob(jobId: string) {
    try {
      await deleteJob(jobId)
      setJobs((prev) => prev.filter((j) => j.id !== jobId))
      setAllHistoryJobs((prev) => prev.filter((j) => j.id !== jobId))
      notify({
        title: "任务已删除",
        message: "已清理该任务记录及相关工程文件",
        type: "info",
      })
    } catch (err) {
      notify({
        title: "删除失败",
        message: err instanceof Error ? err.message : "无法删除",
        type: "error",
      })
    }
  }

  const overallProgress = useMemo(() => {
    if (!jobs.length) return 0
    const sum = jobs.reduce((acc, cur) => acc + (cur.progress || 0), 0)
    return Math.round(sum / jobs.length)
  }, [jobs])

  const groupNameMap = useMemo(() => {
    return Object.fromEntries(groups.map((g) => [g.id, g.name]))
  }, [groups])

  return (
    <div className="flex h-full gap-7 overflow-hidden">
      {/* Left Column: 与批量制作完全一致的 380px 固定左侧设置卡片 */}
      <Card className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden rounded-2xl border border-black/[0.06] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <CardHeader className="py-4 px-6 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between shrink-0">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <SlidersHorizontal className="size-4 text-blue-600" />
            按素材拼接设置
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={busy}
            className="h-7 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer gap-1"
          >
            <Plus className="size-3.5" />
            新建页面
          </Button>
        </CardHeader>

        {/* Scrollable Form Body */}
        <CardContent className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. 素材组选择 */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200">
                选择素材组
              </h4>
              <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                已勾选 {chosenCount} / {currentGroup?.materials.length || 0} 段
              </span>
            </div>
            <p className="mb-2.5 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
              选定素材组后，在右侧勾选需要拼接的视频切片。
            </p>
            <Select value={selectedGroupId} onValueChange={handleSelectGroup} disabled={busy}>
              <SelectTrigger className="w-full text-xs h-10 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium">
                <SelectValue placeholder="选择素材组" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} ({g.material_count}段切片)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

          {/* 2. 拼接策略 */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2">
              拼接策略
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: "all_in_one",
                  label: "合成 1 条",
                  sub: `全覆盖 ${chosenCount} 段`,
                },
                {
                  id: "variants",
                  label: "多条差异化",
                  sub: "同素材多版本",
                },
                {
                  id: "chunked",
                  label: "每 N 段 / 条",
                  sub: "按组批量分切",
                },
              ].map((modeItem) => (
                <button
                  key={modeItem.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setStitchMode(modeItem.id as "all_in_one" | "chunked" | "variants")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl text-center border transition-all cursor-pointer",
                    stitchMode === modeItem.id
                      ? "bg-blue-50 dark:bg-blue-950/50 border-blue-500 text-blue-900 dark:text-blue-200 font-bold ring-2 ring-blue-500/20"
                      : "bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                  )}
                >
                  <span className="text-xs font-bold">{modeItem.label}</span>
                  <span className="text-[10px] text-slate-400 mt-0.5">{modeItem.sub}</span>
                </button>
              ))}
            </div>

            {/* 如果选了差异化版本 */}
            {stitchMode === "variants" && (
              <div className="mt-2.5 flex items-center justify-between rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/40 px-3.5 py-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  生成版本数量：
                </span>
                <div className="flex items-center gap-1.5">
                  {[2, 3, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setVariantCount(cnt)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer",
                        variantCount === cnt
                          ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                          : "bg-white dark:bg-slate-800 text-slate-600 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      {cnt} 条
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 如果选了 chunked */}
            {stitchMode === "chunked" && (
              <div className="mt-2.5 flex flex-col gap-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    每几段素材生成 1 条：
                  </span>
                  <div className="flex items-center gap-1">
                    {[2, 3, 4, 5, 6, 8].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setChunkSize(cnt)}
                        className={cn(
                          "px-2 py-0.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer",
                          chunkSize === cnt
                            ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                            : "bg-white dark:bg-slate-800 text-slate-600 border-slate-200 hover:bg-slate-100"
                        )}
                      >
                        {cnt}段
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] text-blue-700 dark:text-blue-300 bg-blue-100/60 dark:bg-blue-900/40 rounded-lg p-2 font-medium leading-relaxed">
                  {chosenCount === 0 ? (
                    <span>请在右侧勾选素材（需满足至少 {chunkSize} 段）</span>
                  ) : Math.floor(chosenCount / chunkSize) > 0 ? (
                    <span>
                      已选 <strong>{chosenCount}</strong> 段素材 ➔ 严格按 <strong>{chunkSize}</strong> 的倍数分切，将生成 <strong>{Math.floor(chosenCount / chunkSize)}</strong> 条视频
                      {chosenCount % chunkSize > 0 && (
                        <span className="text-amber-700 dark:text-amber-300 ml-1">
                          (余下 {chosenCount % chunkSize} 段不足 {chunkSize} 段已自动忽略)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">
                      已选 {chosenCount} 段素材不足 {chunkSize} 段，请在右侧至少勾选 {chunkSize} 段素材
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

          {/* 3. 预计成片时长与各素材预算 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200">
                预计成片时长
              </h4>
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400 font-mono">
                {calculatedTargetSeconds} 秒 / 条
              </span>
            </div>

            {/* Quick Preset Buttons */}
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {[
                { key: "s30", label: "30秒" },
                { key: "s45", label: "45秒" },
                { key: "mid", label: "60秒" },
                { key: "long", label: "90秒" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={busy}
                  onClick={() => setDurationKey(item.key)}
                  className={cn(
                    "py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer",
                    durationKey === item.key
                      ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDurationKey("auto")}
                className={cn(
                  "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer",
                  durationKey === "auto"
                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-400 ring-1 ring-blue-400/30"
                    : "bg-white dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-700"
                )}
              >
                ⚡️ 智能自动 (素材数 × 12s)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDurationKey("custom")}
                className={cn(
                  "py-1.5 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer",
                  durationKey === "custom"
                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-400 ring-1 ring-blue-400/30"
                    : "bg-white dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-700"
                )}
              >
                ⚙️ 精确输入
              </button>
            </div>

            {durationKey === "custom" && (
              <div className="mt-2.5 flex items-center justify-between rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 px-3.5 py-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  输入期望成片时长：
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={10}
                    max={300}
                    step={5}
                    value={customSeconds}
                    onChange={(e) => setCustomSeconds(Math.max(10, Math.min(300, Number(e.target.value))))}
                    className="w-16 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 px-2 py-1 text-center text-xs font-bold font-mono text-blue-600 outline-none ring-1 ring-blue-400/30"
                  />
                  <span className="text-xs font-bold text-slate-500">秒</span>
                </div>
              </div>
            )}

            {/* 时长与素材分配指标 */}
            <div className="mt-2.5 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40 p-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <div className="leading-relaxed">
                <strong>100% 全素材覆盖：</strong>选中的 <strong>{chosenCount}</strong> 个素材都将出现，预计每个素材均分 <strong>~{estSecondsPerMaterial} 秒</strong> 的完整连贯段落。
              </div>
            </div>
          </div>

          <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

          {/* 4. AI 智能素材分析与导演编排 */}
          <div className="rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-blue-50/50 dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-blue-950/20 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
                  <Sparkles className="size-3.5" />
                </div>
                <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                  AI 素材深度分析与编排
                </span>
              </div>
              <span className="text-[10px] font-semibold bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 border border-indigo-400/30 px-1.5 py-0.5 rounded">
                DeepSeek 导演引擎
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              AI 会深度理解每一个勾选素材的口播内容，识别「痛点Hook ➔ 面料细节 ➔ 穿搭展示 ➔ 破价逼单」，智能排定出场次序并抽取最黄金连贯段落。
            </p>
          </div>

          <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

          {/* 5. 成片输出画质规格 */}
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

          {/* 6. 口播字幕与背景音乐 */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  口播字幕烧录
                </span>
                <span className="text-[11px] text-slate-400">
                  高位安全区智能弹出字幕
                </span>
              </div>
              <Switch checked={addSubtitles} onCheckedChange={setAddSubtitles} disabled={busy} />
            </div>

            {/* 6. 背景音乐伴奏 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    背景音乐伴奏
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {customBgm
                      ? `已选音频: ${customBgm.title || customBgm.filename}`
                      : selectedBgmMode === "auto"
                      ? bgmLibraryList.length > 0
                        ? `自动轮播匹配 (${bgmLibraryList.length} 首音乐)`
                        : "默认全自动匹配 (可点击下方上传)"
                      : `已选: ${selectedBgmMode}`}
                  </span>
                </div>
                <Switch checked={addBgm} onCheckedChange={setAddBgm} disabled={busy} />
              </div>

              {addBgm && (
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 transition-all animate-in fade-in">
                  {/* BGM Dropdown */}
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
                      <SelectTrigger className="w-full text-xs h-9 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium">
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

                  {/* Upload new BGM button */}
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
                      className="w-full h-8 text-xs font-medium border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 cursor-pointer shadow-2xs gap-1.5 rounded-xl"
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
                      <span className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
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
                      onChange={(e) => setBgmVolume(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      disabled={busy}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 7. 否词与导流口播过滤 */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    过滤直播导流否词
                  </span>
                  <span className="text-[11px] text-slate-400">
                    自动剔除「1号链接、小黄车」等
                  </span>
                </div>
                <Switch
                  checked={filterLivePitch}
                  onCheckedChange={setFilterLivePitch}
                  disabled={busy}
                />
              </div>

              {filterLivePitch && (
                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap gap-1.5">
                    {negativeWords.map((word) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                      >
                        {word}
                        <button
                          type="button"
                          onClick={() => handleRemoveNegativeWord(word)}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="输入自定义否词回车添加…"
                      value={customNegativeInput}
                      onChange={(e) => setCustomNegativeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddNegativeWord(customNegativeInput)
                        }
                      }}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddNegativeWord(customNegativeInput)}
                      className="h-7 text-xs rounded-lg cursor-pointer"
                    >
                      添加
                    </Button>
                  </div>

                  {/* Quick Preset Negative Words */}
                  <div className="pt-1">
                    <span className="text-[10px] text-slate-400">常用快捷添加：</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {COMMON_NEGATIVE_PRESETS.map((preset) => {
                        const isAdded = negativeWords.includes(preset)
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              if (isAdded) {
                                handleRemoveNegativeWord(preset)
                              } else {
                                handleAddNegativeWord(preset)
                              }
                            }}
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer",
                              isAdded
                                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 border-blue-300"
                                : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            {isAdded ? `✓ ${preset}` : `+ ${preset}`}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-xs text-rose-600 font-medium">
              {error}
            </div>
          )}
        </CardContent>

        {/* Sticky CTA Bottom Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 shrink-0">
          <Button
            className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md transition-all cursor-pointer"
            onClick={startGenerate}
            disabled={
              busy ||
              chosenCount === 0 ||
              (stitchMode === "chunked" && Math.floor(chosenCount / chunkSize) === 0)
            }
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                正在分切拼接 ({overallProgress}%)…
              </>
            ) : (
              <>
                <WandSparkles className="mr-2 size-4" />
                {stitchMode === "all_in_one" && `开始按素材拼接 (全量 ${chosenCount} 段合成 1 条)`}
                {stitchMode === "variants" && `开始生成 ${variantCount} 条版本 (每条覆盖 ${chosenCount} 段)`}
                {stitchMode === "chunked" && (
                  Math.floor(chosenCount / chunkSize) > 0
                    ? `开始按每 ${chunkSize} 段生成 ${Math.floor(chosenCount / chunkSize)} 条成片`
                    : `请至少勾选 ${chunkSize} 段素材`
                )}
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Right Column: 主工作台区域（加大垂直呼吸间距，杜绝内部切片上下滚动截断） */}
      <div className="flex min-w-0 flex-1 flex-col gap-7 overflow-y-auto pr-2 pb-16">
        {/* Top Banner: 模式对照说明 */}
        <div className="flex items-center justify-between rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-purple-50/40 dark:from-blue-950/40 dark:via-indigo-950/30 dark:to-purple-950/20 px-5 py-4 shadow-xs shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs shrink-0">
              <Scissors className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                按素材分切 · 全素材覆盖拼接
                <span className="rounded-md bg-blue-600/10 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  100% 出现不遗漏
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                在下方勾选素材，系统会自动把目标时长均分给每个素材，并由 DeepSeek AI 智能提取各段黄金高光段落流畅缝合。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 rounded-xl border border-blue-200/60 dark:border-blue-900/60 shadow-2xs">
              已选 {chosenCount} 个素材
            </span>
          </div>
        </div>

        {/* Middle Section: 素材切片网格与勾选区（纯自适应高度展示，杜绝内部纵向滚动） */}
        <div className="flex flex-col gap-3.5 shrink-0">
          {/* Header Action Bar for Material Selection */}
          <div className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 px-4.5 py-3 rounded-2xl shadow-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                当前素材组：
              </span>
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                {currentGroup ? currentGroup.name : "未选择"} ({currentGroup?.materials.length || 0}段)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium rounded-xl px-3 cursor-pointer"
                onClick={handleSelectAllMaterials}
                disabled={!currentGroup || busy}
              >
                全选本组
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-medium rounded-xl px-3 cursor-pointer"
                onClick={handleClearMaterialSelection}
                disabled={busy}
              >
                清空
              </Button>
            </div>
          </div>

          {/* Video Grid Cards (全高展示，无内部滚动条，完整展现文件名与大小) */}
          <div className="w-full">
            {!currentGroup ? (
              <div className="flex h-48 items-center justify-center text-slate-400 text-sm">
                暂无素材组
              </div>
            ) : !currentGroup.materials.length ? (
              <div className="flex h-48 flex-col items-center justify-center text-slate-400 text-sm gap-2">
                <p>该素材组暂无视频切片</p>
                {onGoLibrary && (
                  <Button size="sm" onClick={onGoLibrary}>
                    去素材库上传
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                {currentGroup.materials.map((mat, idx) => {
                  const isSelected = selectedMaterialIds.includes(mat.id)
                  const orderIndex = selectedMaterialIds.indexOf(mat.id) + 1

                  return (
                    <div
                      key={mat.id}
                      className={cn(
                        "group relative flex flex-col cursor-pointer rounded-2xl border bg-white dark:bg-slate-900 p-3 transition-all duration-200 ease-out select-none shadow-2xs hover:shadow-md",
                        isSelected
                          ? "border-blue-500 ring-2 ring-blue-500/25 bg-blue-50/25 dark:bg-blue-950/25"
                          : "border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      )}
                      onClick={() => handleToggleMaterial(mat.id)}
                    >
                      {/* Video Thumbnail Canvas */}
                      <div className="relative h-32 w-full overflow-hidden rounded-xl bg-slate-950 flex items-center justify-center group/thumb shrink-0">
                        {mat.thumb_url ? (
                          <img
                            src={mat.thumb_url}
                            alt=""
                            className={cn(
                              "size-full object-cover transition-all duration-300 group-hover/thumb:scale-105",
                              isSelected ? "opacity-95" : "opacity-85 group-hover/thumb:opacity-100"
                            )}
                          />
                        ) : (
                          <div className="flex size-full items-center justify-center text-xs text-slate-400">
                            无预览
                          </div>
                        )}

                        {/* Order Indicator Badge */}
                        <div
                          className={cn(
                            "absolute top-2.5 left-2.5 flex size-5.5 items-center justify-center rounded-full text-[11px] font-bold font-mono shadow-sm transition-transform",
                            isSelected
                              ? "bg-blue-600 text-white scale-100 ring-2 ring-white"
                              : "border border-white/80 bg-black/40 text-white/90 scale-90 group-hover:scale-100"
                          )}
                        >
                          {isSelected ? orderIndex : idx + 1}
                        </div>

                        {/* Hover Play Button */}
                        <div
                          className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-200 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPreviewMaterial(mat)
                          }}
                        >
                          <div className="flex size-8.5 items-center justify-center rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-white shadow-lg transform scale-90 group-hover/thumb:scale-105 transition-all duration-200 hover:bg-white/40">
                            <Play className="size-4 fill-white ml-0.5" />
                          </div>
                        </div>

                        {/* Duration Badge */}
                        <span className="absolute right-2.5 bottom-2.5 rounded-md bg-black/65 backdrop-blur-md border border-white/15 px-1.5 py-0.5 text-[10px] font-mono font-medium text-white/95 tracking-tight pointer-events-none">
                          {mat.duration_label}
                        </span>
                      </div>

                      {/* Card Info Content */}
                      <div className="pt-2.5 px-0.5 pb-0.5 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <h4
                            className="truncate text-xs font-bold text-slate-800 dark:text-slate-100"
                            title={mat.filename}
                          >
                            {`片段 ${String(idx + 1).padStart(2, "0")}`}
                          </h4>
                          {isSelected && (
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200/50">
                              包含于成片
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span
                            className="truncate max-w-[120px] font-medium text-slate-400"
                            title={mat.filename}
                          >
                            {formatMiddleTruncate(mat.filename)}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-medium">
                            {(mat.size_bytes / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Section: 批次会话标签与成片输出列表 */}
        {displayedJobs.length > 0 && (
          <div className="flex flex-col gap-5 border-t border-slate-200/80 dark:border-slate-800 pt-6 shrink-0">
            {/* Batch Session Tabs */}
            {batchSessions.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {batchSessions.map((session) => {
                  const isActive = session.id === activeSessionId
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setActiveSessionId(session.id)}
                      className={cn(
                        "flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shrink-0",
                        isActive
                          ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                      )}
                    >
                      <span>{session.title}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.2 rounded-full",
                          isActive ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                        )}
                      >
                        {session.completedCount}/{session.totalCount}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Header Action Row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Film className="size-4.5 text-blue-600" />
                  成片输出列表
                  <span className="text-xs font-semibold text-slate-400 font-mono">
                    ({displayedJobs.length} 条)
                  </span>
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {displayedJobs.some((j) => j.status === "failed") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-semibold rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-100 cursor-pointer"
                    onClick={handleRetryFailedBatch}
                    disabled={retryingBatch}
                  >
                    <RefreshCw className={cn("size-3.5 mr-1 text-rose-500", retryingBatch && "animate-spin")} />
                    <span>
                      {retryingBatch
                        ? "正在恢复…"
                        : `一键重试失败任务 (${displayedJobs.filter((j) => j.status === "failed").length})`}
                    </span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium rounded-xl"
                  onClick={handleExportSelectedZip}
                  disabled={exportingZip || selectedExportJobIds.length === 0}
                >
                  <Download className="size-3.5 mr-1" />
                  打包导出 ZIP ({selectedExportJobIds.length})
                </Button>
              </div>
            </div>

            {/* Job Result Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[360px] overflow-y-auto pr-1">
              {displayedJobs.map((job, idx) => {
                const isSucceeded = job.status === "succeeded" && job.output_url
                const isRunning = job.status === "running" || job.status === "queued"
                const isExportSelected = selectedExportJobIds.includes(job.id)

                return (
                  <Card
                    key={job.id}
                    className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between"
                  >
                    <div className="p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          {isSucceeded && (
                            <Checkbox
                              checked={isExportSelected}
                              onCheckedChange={() => toggleJobExportSelection(job.id)}
                            />
                          )}
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                            {job.headline || `带货成片 #${idx + 1}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setLogJob({
                                id: job.id,
                                title: job.headline || `带货成片 #${idx + 1}`,
                              })
                            }
                            className="px-1.5 py-0.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-200/80 dark:border-slate-700/80 transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-medium"
                            title="查看任务实时执行日志流水"
                          >
                            <Terminal className="size-3 text-blue-500" />
                            <span>日志</span>
                          </button>
                          <span
                            onClick={() =>
                              setLogJob({
                                id: job.id,
                                title: job.headline || `带货成片 #${idx + 1}`,
                              })
                            }
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 cursor-pointer transition-transform active:scale-95",
                              isSucceeded
                                ? "bg-emerald-50 text-emerald-600 border border-emerald-200/60"
                                : isRunning
                                ? "bg-blue-50 text-blue-600 border border-blue-200/60 animate-pulse"
                                : "bg-rose-50 text-rose-600 border border-rose-200/60"
                            )}
                            title="点击查看执行流水"
                          >
                            {isSucceeded
                              ? "生成成功"
                              : isRunning
                              ? `${job.progress}% 处理中`
                              : "失败"}
                          </span>
                        </div>
                      </div>

                      {/* Video Player Canvas */}
                      <div
                        className="relative h-40 w-full rounded-xl bg-slate-950 flex items-center justify-center overflow-hidden cursor-pointer group/vid"
                        onClick={() => {
                          if (isSucceeded) {
                            handleOpenVideoPreview(job.id)
                          } else {
                            setLogJob({
                              id: job.id,
                              title: job.headline || `带货成片 #${idx + 1}`,
                            })
                          }
                        }}
                      >
                        {isSucceeded ? (
                          <>
                            <video
                              src={job.output_url!}
                              playsInline
                              className="size-full object-contain bg-black rounded-xl"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 group-hover/vid:opacity-100 transition-opacity">
                              <div className="flex size-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-white shadow-lg">
                                <CirclePlay className="size-5.5 text-white" />
                              </div>
                            </div>
                          </>
                        ) : isRunning ? (
                          <div
                            className="flex flex-col items-center justify-center gap-2 p-4 text-center group/log"
                            title="点击查看实时执行日志"
                          >
                            <Loader2 className="size-6 animate-spin text-blue-500" />
                            <p className="text-xs text-slate-300 font-medium">{job.message}</p>
                            <span className="text-[10px] text-blue-400 opacity-90 group-hover/log:opacity-100 flex items-center gap-1 mt-0.5 bg-blue-950/70 border border-blue-800/50 px-2 py-0.5 rounded-full">
                              <Terminal className="size-2.5" /> 点击查看实时流水
                            </span>
                          </div>
                        ) : (
                          <div
                            className="flex flex-col items-center justify-center gap-1.5 text-rose-400 p-4 text-center group/log"
                            title="点击查看失败详细日志"
                          >
                            <XCircle className="size-6 text-rose-500" />
                            <p className="text-xs font-medium text-slate-300 max-w-[200px] line-clamp-2">
                              {job.error || "生成失败"}
                            </p>
                            <span className="text-[10px] text-rose-300 flex items-center gap-1 mt-0.5 bg-rose-950/70 border border-rose-800/50 px-2 py-0.5 rounded-full">
                              <Terminal className="size-2.5" /> 点击查看详细日志
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Cover Preview Strip if covers exist */}
                      {job.covers && job.covers.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-1">
                          {job.covers.map((c, cIdx) => (
                            <div
                              key={c.id || cIdx}
                              className="relative size-10 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 cursor-pointer group/cov"
                              onClick={() =>
                                handleOpenPreviewImages(
                                  job.covers!.map((item) => item.url),
                                  cIdx
                                )
                              }
                            >
                              <img src={c.url} alt="" className="size-full object-cover" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover/cov:opacity-100 transition-opacity">
                                <ZoomIn className="size-3 text-white" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {isSucceeded && (
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                          <span>时长: {job.duration ? `${Math.round(job.duration)}s` : "--"}</span>
                          <span>
                            素材数: {job.material_ids ? `${job.material_ids.length}段全覆盖` : "--"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Card Actions */}
                    {isSucceeded && (
                      <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between gap-1.5 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7.5 px-2 text-[11px] font-medium rounded-xl"
                          onClick={() => handleGenerateCoversForJob(job.id, job.headline ?? undefined)}
                          disabled={coverLoadingJobId === job.id}
                        >
                          <Sparkles className="size-3 mr-1 text-purple-600" />
                          {coverLoadingJobId === job.id ? "生成中…" : "AI封面"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7.5 px-2 text-[11px] font-medium rounded-xl bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-900 hover:bg-blue-100/80"
                          onClick={() => setProofreadingJob(job)}
                        >
                          <FileText className="size-3 mr-1 text-blue-600" />
                          校验字幕
                        </Button>
                        <a
                          href={`/api/jobs/${job.id}/download`}
                          download
                          className="inline-flex items-center justify-center h-7.5 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold shadow-xs"
                        >
                          <Download className="size-3 mr-1" />
                          下载
                        </a>
                      </div>
                    )}

                    {/* Failed Card Actions: 断点继续重试与删除 */}
                    {!isSucceeded && !isRunning && (
                      <div className="p-2.5 border-t border-slate-100 dark:border-slate-800 bg-rose-50/40 dark:bg-rose-950/20 flex items-center justify-between gap-2">
                        <Button
                          size="sm"
                          className="h-7.5 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex-1 border-none shadow-xs cursor-pointer gap-1.5"
                          onClick={() => handleRetryJob(job.id)}
                          disabled={retryingJobId === job.id}
                        >
                          <RefreshCw className={cn("size-3.5", retryingJobId === job.id && "animate-spin")} />
                          <span>{retryingJobId === job.id ? "正在恢复…" : "断点继续重试"}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7.5 px-2.5 text-xs text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded-xl cursor-pointer"
                          onClick={() => handleDeleteJob(job.id)}
                          title="删除失败记录"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Video Modal Preview for Individual Clips */}
      {previewMaterial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setPreviewMaterial(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-3xl border border-slate-200 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                预览素材：{previewMaterial.filename}
              </h3>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                onClick={() => setPreviewMaterial(null)}
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-black">
              <video
                src={getMaterialVideoUrl(previewMaterial.id)}
                controls
                autoPlay
                className="max-h-[65vh] w-auto rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {/* Video Preview Modal for Output Jobs */}
      <VideoPreviewModal
        isOpen={isVideoModalOpen}
        onClose={() => setIsVideoModalOpen(false)}
        jobs={displayedJobs}
        initialJobId={videoModalJobId}
        groupNameMap={groupNameMap}
        onGenerateCovers={handleGenerateCoversForJob}
        isGeneratingCovers={coverLoadingJobId !== null}
        generatingJobId={coverLoadingJobId}
        onOpenImagePreview={handleOpenPreviewImages}
        onJobUpdated={(updated) => {
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)))
          setAllHistoryJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)))
        }}
      />

      {/* Image Preview Modal for Covers */}
      <ImagePreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        images={previewImages}
        initialIndex={previewIndex}
      />

      {/* Subtitle Proofreader Modal */}
      <SubtitleProofreaderModal
        isOpen={proofreadingJob !== null}
        onClose={() => setProofreadingJob(null)}
        job={proofreadingJob}
        onJobUpdated={(updated) => {
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)))
          setAllHistoryJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)))
        }}
      />

      {/* Real-time Job Execution Logs Modal */}
      <JobLogsModal
        open={logJob !== null}
        onOpenChange={(open) => !open && setLogJob(null)}
        jobId={logJob?.id ?? null}
        jobTitle={logJob?.title}
      />
    </div>
  )
}
