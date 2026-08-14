import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import {
  Bookmark,
  Check,
  CheckCircle2,
  Copy,
  Dices,
  Download,
  Film,
  History,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImagePreviewModal, type ImageItem } from "@/components/ui/image-preview-modal"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Textarea } from "@/components/ui/textarea"
import {
  clearCoverJobs,
  createCoverJob,
  deleteCoverResult,
  extractCoverFrame,
  extractCoverHeadlines,
  fetchCoverJob,
  fetchCoverJobs,
  uploadCoverReference,
  type CoverJob,
  type CoverMode,
  type CoverQuality,
  type CoverSize,
  type CoverStyle,
} from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { useMaterials } from "@/hooks/use-materials"
import { cn } from "@/lib/utils"

type RefImage = {
  id: string
  url: string
  title: string
  filename: string
  label?: string
  source: "upload" | "material" | "video_job"
  sourceJobId?: string
  materialId?: string
  videoUrl?: string
  timestamp?: number
}

export function CoverView() {
  const [headline, setHeadline] = useState("")
  const [refImages, setRefImages] = useState<RefImage[]>([])
  const [extractingIndex, setExtractingIndex] = useState<number | null>(null)
  const [isUploadingRef, setIsUploadingRef] = useState(false)
  const [isExtractingFrame, setIsExtractingFrame] = useState(false)
  const [isExtractingHeadlines, setIsExtractingHeadlines] = useState(false)
  const [extractedHeadlines, setExtractedHeadlines] = useState<string[]>([])
  const [showMaterialPicker, setShowMaterialPicker] = useState(false)
  const [sourceVideoTitle, setSourceVideoTitle] = useState<string | null>(null)

  // CatsAPI GPT Image 2 Parameters (默认 9:16 4K 超清画质图生图)
  const [size, setSize] = useState<CoverSize>("1024x1536")
  const [count, setCount] = useState<number>(3)
  const [quality, setQuality] = useState<CoverQuality>("high")

  const [job, setJob] = useState<CoverJob | null>(null)
  const [history, setHistory] = useState<CoverJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingCoverId, setDeletingCoverId] = useState<string | null>(null)
  const [clearingHistory, setClearingHistory] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const { notify } = useNotifications()
  const { materials } = useMaterials()

  // 监听从剪辑成片/历史记录跳转过来的状态
  useEffect(() => {
    const state = location.state as {
      refImageUrl?: string
      headline?: string
      mode?: CoverMode
      title?: string
      sourceJobId?: string
      videoUrl?: string
    } | null

    if (state) {
      if (state.headline) setHeadline(state.headline)
      if (state.title) setSourceVideoTitle(state.title)

      if (state.sourceJobId || state.videoUrl) {
        setIsExtractingFrame(true)
        void extractCoverFrame({
          job_id: state.sourceJobId,
          video_url: state.videoUrl,
        })
          .then((res) => {
            setRefImages([
              {
                id: `ref_init_${Date.now()}`,
                url: res.url,
                title: state.title || "成片画面帧",
                filename: res.filename,
                label: "图 1 · 核心画面",
                source: "video_job",
                sourceJobId: state.sourceJobId,
                videoUrl: state.videoUrl,
                timestamp: res.timestamp,
              },
            ])
          })
          .catch(() => {
            if (state.refImageUrl) {
              setRefImages([
                {
                  id: `ref_init_${Date.now()}`,
                  url: state.refImageUrl,
                  title: state.title || "成片截帧",
                  filename: "video_frame.jpg",
                  label: "图 1 · 核心画面",
                  source: "video_job",
                  sourceJobId: state.sourceJobId,
                  videoUrl: state.videoUrl,
                },
              ])
            }
          })
          .finally(() => {
            setIsExtractingFrame(false)
          })

        // 自动从成片音频口播提炼高转化大字报文案建议
        setIsExtractingHeadlines(true)
        void extractCoverHeadlines({
          job_id: state.sourceJobId,
          video_url: state.videoUrl,
        })
          .then((hRes) => {
            if (hRes.headlines && hRes.headlines.length > 0) {
              setExtractedHeadlines(hRes.headlines)
              if (!state.headline) {
                setHeadline(hRes.headlines[0])
              }
            }
          })
          .catch(() => {
            /* ignore */
          })
          .finally(() => {
            setIsExtractingHeadlines(false)
          })
      } else if (state.refImageUrl) {
        setRefImages([
          {
            id: `ref_init_${Date.now()}`,
            url: state.refImageUrl,
            title: state.title || "参考截帧",
            filename: "video_frame.jpg",
            label: "图 1 · 核心画面",
            source: "material",
          },
        ])
      }

      notify({
        title: "已载入成片画面",
        message: `已自动提取「${state.title || "目标成片"}」的视频画面与卖点，可继续添加实物图或直接图生图！`,
        type: "info",
      })
    }
  }, [location.state, notify])

  const handleResetCover = useCallback(() => {
    setJob(null)
    setHeadline("")
    setRefImages([])
    setSourceVideoTitle(null)
    setExtractedHeadlines([])
    setSize("1024x1536")
    setCount(3)
    setQuality("high")
    setError(null)
    setSelectedId(null)
    setBusy(false)
    notify({
      title: "已新建封面工作台",
      message: "已重置参考图与文案，支持上传实体物品与主播人像多图融合生图 (9:16 4K)",
      type: "info",
    })
  }, [notify])

  useEffect(() => {
    const handleNewProject = () => {
      handleResetCover()
    }
    window.addEventListener("kuafa:new-project", handleNewProject)
    return () => window.removeEventListener("kuafa:new-project", handleNewProject)
  }, [handleResetCover])

  useEffect(() => {
    let alive = true
    void fetchCoverJobs()
      .then((list) => {
        if (alive) setHistory(list)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [job?.status])

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return
    let alive = true
    const timer = window.setInterval(() => {
      void fetchCoverJob(job.id)
        .then((next) => {
          if (!alive) return
          setJob(next)
          if (next.status === "succeeded" || next.status === "failed") {
            setBusy(false)
            if (next.status === "succeeded") {
              notify({
                title: "封面图生图出图完成",
                message: "AI 爆款海报已生成成功，支持预览、单张下载或设为主封面！",
                type: "success",
              })
            } else {
              notify({
                title: "封面生成失败",
                message: next.error || "封面生成失败，请检查 API 配置",
                type: "error",
              })
            }
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 1500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [job, notify])

  const handleExtractAudioHeadlines = async () => {
    const firstRef = refImages[0]
    if (!firstRef && !sourceVideoTitle) {
      notify({
        title: "请先选择视频素材",
        message: "请先从素材库选帧或从成片跳转，以提取视频音频口播文案",
        type: "info",
      })
      return
    }
    setIsExtractingHeadlines(true)
    try {
      const res = await extractCoverHeadlines({
        job_id: firstRef?.sourceJobId,
        material_id: firstRef?.materialId,
        video_url: firstRef?.videoUrl,
      })
      if (res.headlines && res.headlines.length > 0) {
        setExtractedHeadlines(res.headlines)
        setHeadline(res.headlines[0])
        notify({
          title: "已提炼视频音频爆款大字",
          message: `成功提炼出 ${res.headlines.length} 条高转化标语，已填入文案框！`,
          type: "success",
        })
      } else {
        notify({
          title: "未能从音频提炼到有效标语",
          message: "请检查视频是否有清晰口播或直接输入自定义文案",
          type: "info",
        })
      }
    } catch (err) {
      notify({
        title: "提炼失败",
        message: err instanceof Error ? err.message : "音频提炼异常",
        type: "error",
      })
    } finally {
      setIsExtractingHeadlines(false)
    }
  }

  const handleRandomizeFrame = async (idx: number) => {
    const target = refImages[idx]
    if (!target) return
    setExtractingIndex(idx)
    try {
      const res = await extractCoverFrame({
        job_id: target.sourceJobId,
        material_id: target.materialId,
        video_url: target.videoUrl,
      })
      setRefImages((prev) =>
        prev.map((item, i) =>
          i === idx
            ? {
                ...item,
                url: res.url,
                filename: res.filename,
                timestamp: res.timestamp,
              }
            : item
        )
      )
      notify({
        title: "已重新截取视频画面",
        message: `已随机采样视频第 ${res.timestamp}s 画面作为参考图`,
        type: "success",
      })
    } catch (err) {
      notify({
        title: "截帧失败",
        message: err instanceof Error ? err.message : "无法从视频截取画面",
        type: "error",
      })
    } finally {
      setExtractingIndex(null)
    }
  }

  const handleRemoveRefImage = (idx: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleFileUpload(files: FileList | File[]) {
    const fileList = Array.from(files)
    if (fileList.length === 0) return
    setIsUploadingRef(true)
    setError(null)
    try {
      const newItems: RefImage[] = []
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]
        const res = await uploadCoverReference(file)
        const curCount = refImages.length + newItems.length
        const defaultLabel =
          curCount === 0
            ? "图 1 · 实体商品 / 包装"
            : curCount === 1
            ? "图 2 · 主播人物 / 模特"
            : `图 ${curCount + 1} · 补充参考`
        newItems.push({
          id: `ref_upload_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          url: res.url,
          title: file.name,
          filename: res.filename,
          label: defaultLabel,
          source: "upload",
        })
        if (refImages.length + newItems.length >= 4) break
      }
      setRefImages((prev) => [...prev, ...newItems].slice(0, 4))
      notify({
        title: "参考图已上传",
        message: `已成功导入 ${newItems.length} 张参考图，AI 将在图生图中进行多要素保真融合！`,
        type: "success",
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考图上传失败")
      notify({
        title: "上传失败",
        message: err instanceof Error ? err.message : "图片格式不兼容",
        type: "error",
      })
    } finally {
      setIsUploadingRef(false)
    }
  }

  async function handleSelectMaterial(mat: (typeof materials)[0]) {
    setShowMaterialPicker(false)
    setIsExtractingFrame(true)
    try {
      const res = await extractCoverFrame({ material_id: mat.id })
      const curCount = refImages.length
      const defaultLabel =
        curCount === 0
          ? "图 1 · 实体商品 / 包装"
          : curCount === 1
          ? "图 2 · 主播人物 / 模特"
          : `图 ${curCount + 1} · 补充参考`
      const newItem: RefImage = {
        id: `ref_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        url: res.url,
        title: mat.title || mat.filename,
        filename: res.filename,
        label: defaultLabel,
        source: "material",
        materialId: mat.id,
        timestamp: res.timestamp,
      }
      setRefImages((prev) => [...prev, newItem].slice(0, 4))
      notify({
        title: "已从素材视频截帧",
        message: `已随机采样素材「${mat.title || mat.filename}」第 ${res.timestamp}s 作为参考图`,
        type: "success",
      })
      // 异步提炼该素材视频的口播大字
      void extractCoverHeadlines({ material_id: mat.id }).then((hRes) => {
        if (hRes.headlines && hRes.headlines.length > 0) {
          setExtractedHeadlines(hRes.headlines)
          if (!headline) {
            setHeadline(hRes.headlines[0])
          }
        }
      })
    } catch (err) {
      const targetUrl = mat.thumb_url || `/api/materials/${mat.id}/video`
      const curCount = refImages.length
      const defaultLabel =
        curCount === 0
          ? "图 1 · 实体商品 / 包装"
          : curCount === 1
          ? "图 2 · 主播人物 / 模特"
          : `图 ${curCount + 1} · 补充参考`
      setRefImages((prev) => [
        ...prev,
        {
          id: `ref_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          url: targetUrl,
          title: mat.title || mat.filename,
          filename: mat.filename,
          label: defaultLabel,
          source: "material",
          materialId: mat.id,
        },
      ].slice(0, 4))
    } finally {
      setIsExtractingFrame(false)
    }
  }

  async function generate() {
    if (isUploadingRef || isExtractingFrame) {
      setError("参考图正在上传或截帧中，请稍候…")
      return
    }
    const cleanText = headline.trim()
    if (!cleanText) {
      setError("请填写大字报文案或卖点标语")
      return
    }
    setError(null)
    setBusy(true)
    setSelectedId(null)
    setJob(null)
    try {
      const isImg2Img = refImages.length > 0
      const created = await createCoverJob({
        headline: cleanText,
        style: "yellow-red" as CoverStyle,
        count,
        mode: isImg2Img ? "img2img" : "text2img",
        image_urls: isImg2Img ? refImages.map((r) => r.url) : null,
        image_url: isImg2Img ? refImages[0].url : null,
        size,
        quality,
        rewrite_prompt: false,
      })
      setJob(created)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建封面图生图任务失败")
    }
  }

  const showProcessing =
    busy || job?.status === "queued" || job?.status === "running"
  const covers = job?.results ?? []
  const historyCovers = history
    .filter((j) => j.status === "succeeded" && j.results.length > 0)
    .flatMap((j) =>
      j.results.map((r) => ({
        ...r,
        headline: j.headline,
        jobId: j.id,
      }))
    )
    .slice(0, 18)

  const [previewImages, setPreviewImages] = useState<ImageItem[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewDeleteHandler, setPreviewDeleteHandler] = useState<((index: number) => void) | undefined>(undefined)

  const handleOpenPreview = (
    imgs: (string | ImageItem)[],
    index = 0,
    onDelete?: (index: number) => void
  ) => {
    setPreviewImages(imgs.map((it) => (typeof it === "string" ? { url: it } : it)))
    setPreviewIndex(index)
    setPreviewDeleteHandler(() => onDelete)
    setIsPreviewOpen(true)
  }

  const handleDeleteHistoryCover = async (
    e: React.MouseEvent | { stopPropagation: () => void },
    item: { id: string; jobId: string; url: string; headline: string }
  ) => {
    e.stopPropagation()
    setDeletingCoverId(item.id)
    try {
      await deleteCoverResult(item.jobId, item.id)
      setHistory((prev) =>
        prev
          .map((j) => {
            if (j.id !== item.jobId) return j
            return {
              ...j,
              results: j.results.filter((r) => r.id !== item.id),
            }
          })
          .filter((j) => j.results.length > 0)
      )
      notify({
        title: "已删除封面",
        message: `已移除封面「${item.headline}」`,
        type: "success",
      })
    } catch (err) {
      notify({
        title: "删除失败",
        message: err instanceof Error ? err.message : "网络异常，请重试",
        type: "error",
      })
    } finally {
      setDeletingCoverId(null)
    }
  }

  const handleDeleteCurrentCover = async (
    e: React.MouseEvent | { stopPropagation: () => void },
    coverId: string
  ) => {
    e.stopPropagation()
    if (!job) return
    setDeletingCoverId(coverId)
    try {
      await deleteCoverResult(job.id, coverId)
      const newResults = (job.results || []).filter((r) => r.id !== coverId)
      if (newResults.length === 0) {
        setJob(null)
      } else {
        setJob({ ...job, results: newResults })
      }
      setHistory((prev) =>
        prev
          .map((j) => (j.id === job.id ? { ...j, results: newResults } : j))
          .filter((j) => j.results.length > 0)
      )
      notify({
        title: "已删除封面",
        message: "该封面已成功从当前列表中移除",
        type: "success",
      })
    } catch (err) {
      notify({
        title: "删除失败",
        message: err instanceof Error ? err.message : "网络异常，请重试",
        type: "error",
      })
    } finally {
      setDeletingCoverId(null)
    }
  }

  const handleClearAllHistory = async () => {
    const ok = window.confirm("确定清空所有历史出图记录？此操作将删除所有生成的封面图片文件。")
    if (!ok) return
    setClearingHistory(true)
    try {
      await clearCoverJobs()
      setHistory([])
      if (job) setJob(null)
      notify({
        title: "已清空出图记录",
        message: "所有历史出图记录及文件已删除",
        type: "success",
      })
    } catch (err) {
      notify({
        title: "清空失败",
        message: err instanceof Error ? err.message : "网络异常，请重试",
        type: "error",
      })
    } finally {
      setClearingHistory(false)
    }
  }

  const handleModalDelete = (idx: number) => {
    if (previewDeleteHandler) {
      previewDeleteHandler(idx)
    }
    setPreviewImages((prev) => {
      const nextList = prev.filter((_, i) => i !== idx)
      if (nextList.length === 0) {
        setIsPreviewOpen(false)
      }
      return nextList
    })
  }

  const handleDownloadAllCovers = async () => {
    if (!covers.length) return
    notify({
      title: "开始批量下载",
      message: `正在下载当前 ${covers.length} 张高清封面海报…`,
      type: "info",
    })
    for (let i = 0; i < covers.length; i++) {
      const cover = covers[i]
      const a = document.createElement("a")
      a.href = cover.url
      a.download = `cover_${job?.id || "batch"}_${i + 1}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      if (i < covers.length - 1) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
  }

  const handleApplySelectedCover = () => {
    if (!selectedId) return
    const sel = covers.find((c) => c.id === selectedId)
    if (!sel) return
    if (sourceVideoTitle) {
      notify({
        title: "封面已成功绑定",
        message: `已将所选封面应用并绑定至成片「${sourceVideoTitle}」！`,
        type: "success",
      })
    } else {
      notify({
        title: "封面已设定",
        message: "已将该封面设为当前主推大字报封面！",
        type: "success",
      })
    }
  }

  return (
    <div className="flex h-full gap-7 xl:gap-8">
      {/* 极简图生图设置面板 */}
      <Card className="flex w-[420px] xl:w-[460px] shrink-0 flex-col border-slate-200/80 dark:border-slate-800/80 shadow-sm bg-card rounded-3xl overflow-hidden">
        <CardHeader className="py-5 px-7 border-b border-slate-100 dark:border-slate-800/80 flex flex-row items-center justify-between bg-slate-50/40 dark:bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400">
              <ImagePlus className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                AI 封面生成 (图生图)
              </CardTitle>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                {sourceVideoTitle ? `正在为「${sourceVideoTitle}」定制图生图封面` : "基于视频抽帧/实拍图一键生成爆款海报"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetCover}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium px-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="重置文案与底图"
          >
            <RefreshCw className="size-3" />
            <span>重置</span>
          </button>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-5 p-7 overflow-y-auto">
          {/* 1. 参考底图选择与截帧（支持多参考图融合：实体商品 + 主播人像） */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <ImageIcon className="size-3.5 text-purple-500" />
                01 · 参考底图 ({refImages.length}/4)
              </span>
              <div className="flex items-center gap-2">
                {refImages.length < 4 && materials.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowMaterialPicker(true)}
                    className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-semibold cursor-pointer"
                  >
                    <Film className="size-3" />
                    素材库选帧
                  </button>
                )}
                {refImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRefImages([])}
                    className="text-[11px] text-rose-500 hover:text-rose-600 font-medium cursor-pointer"
                  >
                    清空底图
                  </button>
                )}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) void handleFileUpload(e.target.files)
                e.target.value = ""
              }}
            />

            {refImages.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-2">
                  {refImages.map((img, idx) => (
                    <div
                      key={img.id}
                      className="flex items-center gap-3 p-2.5 rounded-2xl bg-purple-50/40 dark:bg-purple-950/20 border border-purple-200/80 dark:border-purple-900/60 shadow-xs group"
                    >
                      <div className="relative size-14 rounded-xl overflow-hidden border border-purple-200 dark:border-purple-800 shrink-0 bg-slate-100">
                        <img
                          src={img.url}
                          alt={img.title}
                          className="size-full object-cover"
                        />
                        {extractingIndex === idx && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white">
                            <Loader2 className="size-4 animate-spin" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold border",
                            idx === 0
                              ? "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-300/80"
                              : idx === 1
                              ? "bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border-purple-300/80"
                              : "bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border-blue-300/80"
                          )}>
                            {idx === 0 ? "图 1 · 实体商品 / 包装" : idx === 1 ? "图 2 · 主播人物 / 模特" : `图 ${idx + 1} · 补充参考`}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {img.source === "video_job"
                              ? `成片截帧${img.timestamp ? ` (${img.timestamp}s)` : ""}`
                              : img.source === "material"
                              ? `素材截帧${img.timestamp ? ` (${img.timestamp}s)` : ""}`
                              : "实拍原图"}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                          {img.title}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {(img.source === "video_job" || img.source === "material" || img.sourceJobId || img.materialId) && (
                          <button
                            type="button"
                            disabled={extractingIndex === idx}
                            onClick={() => void handleRandomizeFrame(idx)}
                            className="p-1.5 rounded-lg text-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/50 cursor-pointer"
                            title="换一帧画面"
                          >
                            <Dices className="size-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveRefImage(idx)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                          title="移除该参考图"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 添加更多参考图按钮 */}
                {refImages.length < 4 && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isUploadingRef}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-purple-300 dark:border-purple-800 hover:border-purple-500 bg-purple-50/20 hover:bg-purple-50/50 text-[11px] font-semibold text-purple-700 dark:text-purple-300 cursor-pointer transition-colors",
                        isUploadingRef && "opacity-60 cursor-wait"
                      )}
                    >
                      {isUploadingRef ? (
                        <><Loader2 className="size-3.5 animate-spin" /> 正在上传…</>
                      ) : (
                        <><Plus className="size-3.5" /> {refImages.length === 1 ? "+ 添加第 2 张参考图 (如补充主播人像或商品)" : "+ 添加更多参考图"}</>
                      )}
                    </button>
                  </div>
                )}

                {/* 多图融合智能提示 */}
                <div className="p-2.5 rounded-xl bg-purple-100/50 dark:bg-purple-950/40 border border-purple-200/60 dark:border-purple-900/60 text-[11px] text-purple-800 dark:text-purple-300 leading-relaxed">
                  {refImages.length >= 2 ? (
                    <span>
                      ✨ <strong>多图融合已激活</strong>：AI 将自动融合图 1 与图 2（主播手持/展示实体商品，9:16 4K 海报，人物五官与商品细节严格保真）。
                    </span>
                  ) : (
                    <span>
                      💡 <strong>提示</strong>：可继续点击上方按钮上传主播人像或商品实物图，开启<strong>多图智能融合</strong>模式。
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (e.dataTransfer.files.length > 0) void handleFileUpload(e.dataTransfer.files)
                }}
                className="group relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-purple-500 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-purple-50/30 transition-all cursor-pointer text-center"
              >
                {isUploadingRef || isExtractingFrame ? (
                  <div className="flex flex-col items-center gap-2 py-2 text-purple-600">
                    <Loader2 className="size-6 animate-spin" />
                    <span className="text-xs font-medium">
                      {isExtractingFrame ? "正在从视频中截取高光帧…" : "正在导入底图…"}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="size-11 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-xs">
                      <UploadCloud className="size-5" />
                    </div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      点击或拖拽上传参考图 (支持多选)
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                      支持同时上传<strong>商品实物图</strong>与<strong>主播人像图</strong> · AI 智能多图融合
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 2. 封面大字文案 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Bookmark className="size-3.5 text-slate-400" />
                02 · 大字报文案 / 核心卖点
              </span>
              {(refImages.some((r) => r.source === "video_job" || r.source === "material" || r.sourceJobId || r.materialId || r.videoUrl)) && (
                <button
                  type="button"
                  disabled={isExtractingHeadlines}
                  onClick={() => void handleExtractAudioHeadlines()}
                  className="group flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-semibold cursor-pointer transition-colors"
                  title="AI 智能分析成片音频口播，提炼出最高点击率的大字报标语"
                >
                  {isExtractingHeadlines ? (
                    <Loader2 className="size-3.5 animate-spin text-purple-500" />
                  ) : (
                    <Sparkles className="size-3.5 text-purple-500 group-hover:scale-110 transition-transform" />
                  )}
                  <span>🎙️ 音频智能提炼</span>
                </button>
              )}
            </div>

            {/* 音频智能提炼候选词条 */}
            {extractedHeadlines.length > 0 && (
              <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200/80 dark:border-purple-900/60">
                <div className="flex items-center justify-between text-[11px] font-bold text-purple-800 dark:text-purple-300">
                  <span className="flex items-center gap-1">
                    <Sparkles className="size-3 text-purple-600" />
                    音频智能提炼标语（点击填入）
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {extractedHeadlines.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setHeadline(h)}
                      className={cn(
                        "flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-all cursor-pointer font-medium",
                        headline === h
                          ? "bg-purple-600 text-white shadow-2xs font-bold"
                          : "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-purple-200/60 dark:border-purple-800/40 hover:border-purple-400"
                      )}
                    >
                      <span className="truncate">{h}</span>
                      {headline === h ? (
                        <Check className="size-3 shrink-0 ml-1.5" />
                      ) : (
                        <span className="text-[10px] text-purple-500 shrink-0 ml-1.5 font-normal">标语 #{i + 1}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 文案输入框 */}
            <div className="relative">
              <Textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="例如：39.9纯棉打底衫 春夏闭眼入（包含价格与核心卖点，大字夺目吸睛）"
                className="h-22 resize-none text-xs rounded-2xl border-slate-200 dark:border-slate-800 p-3.5 pb-6 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 leading-relaxed"
                maxLength={100}
              />
              <span className="absolute bottom-2 right-3 font-mono text-[10px] text-slate-400 pointer-events-none">
                {headline.length}/100
              </span>
            </div>
          </div>

          {/* 3. 极简出图参数 (默认 3 张，竖版 9:16) */}
          <div className="flex flex-col gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-3">
              {/* 生成张数 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Copy className="size-3 text-slate-400" />
                  生成张数
                </span>
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCount(n)}
                      className={cn(
                        "py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        count === n
                          ? "bg-white text-purple-700 shadow-2xs dark:bg-slate-900 dark:text-purple-300"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* 画幅比例 */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <SlidersHorizontal className="size-3 text-slate-400" />
                  画幅比例与画质
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
                  <button
                    type="button"
                    onClick={() => setSize("1024x1536")}
                    className={cn(
                      "py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                      size === "1024x1536"
                        ? "bg-white text-purple-700 shadow-2xs dark:bg-slate-900 dark:text-purple-300"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    )}
                  >
                    9:16 (4K)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSize("1792x1024")}
                    className={cn(
                      "py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                      size === "1792x1024" || size === "1536x1024" || size === "1920x1080"
                        ? "bg-white text-purple-700 shadow-2xs dark:bg-slate-900 dark:text-purple-300"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    )}
                  >
                    16:9 (4K)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSize("1024x1024")}
                    className={cn(
                      "py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                      size === "1024x1024"
                        ? "bg-white text-purple-700 shadow-2xs dark:bg-slate-900 dark:text-purple-300"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    )}
                  >
                    1:1
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error ? <p className="text-xs text-rose-500 font-medium">{error}</p> : null}

          {/* 生成主按钮 */}
          <Button
            className="mt-auto h-12 w-full rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-sm shadow-md shadow-purple-500/20 hover:shadow-lg hover:shadow-purple-500/30 transition-all active:scale-[0.99] cursor-pointer"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-2 size-4.5" />
            )}
            {busy ? `正在图生图 (${count} 张海报)…` : `开始 AI 图生图 (生成 ${count} 张 9:16 4K封面)`}
          </Button>
        </CardContent>
      </Card>

      {/* 右侧：生成画布与画廊 */}
      <Card className="flex flex-1 flex-col overflow-y-auto border-slate-200/80 dark:border-slate-800/80 shadow-sm bg-card rounded-3xl overflow-hidden">
        <CardHeader className="py-5 px-7 border-b border-slate-100 dark:border-slate-800/80 flex flex-row items-center justify-between bg-slate-50/40 dark:bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400">
              <ImageIcon className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                生成画布与画廊
              </CardTitle>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                点击卡片设为主封面，悬浮支持大图预览、下载原图与删除
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {covers.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleDownloadAllCovers()}
                className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-2xs px-3 py-2 cursor-pointer"
              >
                <Download className="size-3.5 text-purple-600" />
                <span>批量下载全部 ({covers.length}张)</span>
              </Button>
            ) : null}
            {selectedId ? (
              <Button
                size="sm"
                onClick={handleApplySelectedCover}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm shadow-purple-500/20 px-3.5 py-2 cursor-pointer"
              >
                <Check className="size-3.5" />
                <span>应用所选封面</span>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-6 p-6">
          {showProcessing ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-purple-600 py-12">
              <Loader2 className="size-8 animate-spin" />
              <p className="font-medium text-sm text-slate-800 dark:text-slate-200">{job?.message || "正在准备图生图任务…"}</p>
              <p className="text-xs text-slate-400">
                出图进度 {job?.progress ?? 0}%
              </p>
              {covers.length ? (
                <div className="mt-6 grid w-full grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {covers.map((cover) => (
                    <div key={cover.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xs">
                      <img
                        src={cover.url}
                        alt=""
                        className={cn(
                          "w-full rounded-lg object-cover",
                          size === "1024x1536" ? "aspect-[9/16]" : size === "1024x1024" ? "aspect-square" : "aspect-video"
                        )}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : covers.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {covers.map((cover, idx) => {
                const isSelected = selectedId === cover.id
                const isDeleting = deletingCoverId === cover.id
                return (
                  <div
                    key={cover.id}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-left transition-all shadow-xs hover:shadow-md",
                      isSelected
                        ? "ring-2 ring-purple-600 ring-offset-2 dark:ring-offset-slate-950"
                        : "hover:border-slate-300"
                    )}
                  >
                    <div
                      onClick={() => setSelectedId(cover.id)}
                      className={cn(
                        "relative w-full overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800 cursor-pointer",
                        size === "1024x1536" ? "aspect-[9/16]" : size === "1024x1024" ? "aspect-square" : "aspect-video"
                      )}
                    >
                      <img
                        src={cover.url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {isSelected ? (
                        <div className="absolute top-2.5 right-2.5 z-10 flex size-6 items-center justify-center rounded-full bg-purple-600 text-white shadow-md">
                          <Check className="size-3.5" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteCurrentCover(e, cover.id)}
                          disabled={isDeleting}
                          className="absolute top-2.5 right-2.5 z-10 flex size-6 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur-xs transition-all hover:bg-rose-600 hover:text-white group-hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer shadow-sm disabled:opacity-50"
                          title="删除此封面"
                        >
                          {isDeleting ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                        </button>
                      )}

                      {/* 悬浮预览与下载操作 */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleOpenPreview(
                              covers.map((c) => ({
                                url: c.url,
                                title: headline || "封面大图",
                              })),
                              idx,
                              (delIdx) => {
                                const targetCover = covers[delIdx]
                                if (targetCover) {
                                  void handleDeleteCurrentCover(
                                    { stopPropagation: () => {} },
                                    targetCover.id
                                  )
                                }
                              }
                            )
                          }}
                          className="flex items-center gap-1 rounded-full bg-white/90 dark:bg-slate-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
                          title="放大查看"
                        >
                          <ZoomIn className="size-3.5 text-purple-600" />
                          预览
                        </button>
                        <a
                          href={cover.url}
                          download={`cover_${idx + 1}.png`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 rounded-full bg-white/90 dark:bg-slate-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
                          title="下载高清原图"
                        >
                          <Download className="size-3.5 text-emerald-600" />
                          下载
                        </a>
                      </div>
                    </div>
                    {cover.headline && (
                      <div className="mt-2 px-1">
                        <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate" title={cover.headline}>
                          {cover.headline}
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty className="my-auto">
              <EmptyMedia>
                <div className="flex size-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
                  <Images className="size-6" />
                </div>
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle className="text-slate-700 dark:text-slate-300">暂无生成的封面</EmptyTitle>
                <EmptyDescription>
                  在左侧上传底图或从素材库截帧，输入大字报文案后点击「开始 AI 图生图」
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {historyCovers.length > 0 && !showProcessing ? (
            <div className="mt-auto border-t border-slate-100 dark:border-slate-800 pt-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                    <History className="size-3.5 text-slate-400" />
                    <span>历史出图记录</span>
                  </h4>
                  <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-500">
                    {historyCovers.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleClearAllHistory()}
                  disabled={clearingHistory}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400 font-medium transition-colors cursor-pointer disabled:opacity-50"
                  title="清空全部历史出图记录"
                >
                  {clearingHistory ? (
                    <Loader2 className="size-3 animate-spin text-rose-500" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                  <span>清空记录</span>
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3 lg:grid-cols-6">
                {historyCovers.map((item, idx) => {
                  const isDeleting = deletingCoverId === item.id
                  return (
                    <div
                      key={item.id}
                      onClick={() =>
                        handleOpenPreview(
                          historyCovers.map((h) => ({
                            url: h.url,
                            title: h.headline,
                          })),
                          idx,
                          (delIdx) => {
                            const targetItem = historyCovers[delIdx]
                            if (targetItem) {
                              void handleDeleteHistoryCover(
                                { stopPropagation: () => {} },
                                targetItem
                              )
                            }
                          }
                        )
                      }
                      className="group relative aspect-video overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 cursor-pointer shadow-2xs hover:shadow-md transition-all"
                      title="点击放大预览"
                    >
                      <img
                        src={item.url}
                        alt={item.headline}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <button
                        type="button"
                        onClick={(e) => void handleDeleteHistoryCover(e, item)}
                        disabled={isDeleting}
                        className="absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur-xs transition-all hover:bg-rose-600 hover:text-white group-hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer shadow-sm disabled:opacity-50"
                        title="删除此封面"
                      >
                        {isDeleting ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </button>
                      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/85 via-black/20 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <p className="line-clamp-2 text-[10px] text-white font-medium leading-tight">
                          {item.headline}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* 大图预览 Modal */}
      <ImagePreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        images={previewImages}
        initialIndex={previewIndex}
        onDelete={previewDeleteHandler ? handleModalDelete : undefined}
      />

      {/* 素材库选帧弹窗 */}
      {showMaterialPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in-0"
          onClick={() => setShowMaterialPicker(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-card p-6 shadow-2xl animate-in zoom-in-95"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  从素材库选取参考视频
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  点击直接截取视频画面作为图生图视觉底图
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMaterialPicker(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              {materials.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  素材库暂无视频切片，请先在「素材库」中导入素材
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {materials.map((mat) => (
                    <div
                      key={mat.id}
                      onClick={() => handleSelectMaterial(mat)}
                      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 text-left transition-all hover:border-purple-500 hover:shadow-md cursor-pointer"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {mat.thumb_url ? (
                          <img
                            src={mat.thumb_url}
                            alt={mat.title}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <Film className="size-5" />
                          </div>
                        )}
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.2 font-mono text-[9px] text-white">
                          {mat.duration_label}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        {mat.title || mat.filename}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
