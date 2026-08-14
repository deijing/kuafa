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
  Flame,
  History,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Layers,
  Loader2,
  Palette,
  PenTool,
  RefreshCw,
  Settings2,
  Shirt,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tag,
  Trash2,
  Type,
  UploadCloud,
  Wand2,
  X,
  Zap,
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import {
  clearCoverJobs,
  createCoverJob,
  deleteCoverResult,
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

const textStyles: {
  id: CoverStyle
  label: string
  desc: string
  colors: string
  previewClass: string
}[] = [
  {
    id: "yellow-red",
    label: "黄红爆款",
    desc: "高明度撞色 · 吸睛转化",
    colors: "from-amber-400 via-orange-500 to-red-600",
    previewClass: "bg-amber-400 text-red-600 border-amber-500/60 font-black",
  },
  {
    id: "black-yellow",
    label: "黑金高端",
    desc: "黑金奢华 · 旗舰质感",
    colors: "from-zinc-900 via-amber-700 to-yellow-400",
    previewClass: "bg-zinc-950 text-amber-300 border-amber-400/40 font-black",
  },
  {
    id: "red-white",
    label: "红白秒杀",
    desc: "大促醒目 · 破价热销",
    colors: "from-red-600 to-rose-400",
    previewClass: "bg-red-600 text-white border-red-700 font-black",
  },
  {
    id: "neon-cyber",
    label: "赛博霓虹",
    desc: "科技潮流 · 光效景深",
    colors: "from-purple-900 via-cyan-600 to-teal-400",
    previewClass: "bg-purple-950 text-cyan-300 border-cyan-500/40 font-black",
  },
  {
    id: "clean-minimal",
    label: "极简素雅",
    desc: "莫兰迪柔光 · 大牌质感",
    colors: "from-stone-300 to-stone-600",
    previewClass: "bg-stone-100 text-stone-800 border-stone-300 dark:bg-stone-800 dark:text-stone-100 font-bold",
  },
  {
    id: "festive-gold",
    label: "国潮烫金",
    desc: "新年礼盒 · 奢华烫金",
    colors: "from-red-800 via-amber-600 to-amber-300",
    previewClass: "bg-red-950 text-amber-300 border-amber-500/60 font-black",
  },
]

type PresetItem = {
  headline: string
  style: CoverStyle
  label: string
}

type CopyCategory = {
  name: string
  icon: typeof Flame
  items: PresetItem[]
}

const BUILTIN_PRESETS: CopyCategory[] = [
  {
    name: "爆款清仓",
    icon: Flame,
    items: [
      { headline: "破价清仓！最后100件，错过再等一年！", style: "yellow-red", label: "破价清仓" },
      { headline: "买一送三！全网爆款热销，错过再等一年！", style: "red-white", label: "买一送三" },
      { headline: "全网最低价！工厂直发，无中间商赚差价！", style: "black-yellow", label: "工厂直发" },
    ],
  },
  {
    name: "时尚穿搭",
    icon: Shirt,
    items: [
      { headline: "显瘦20斤！今夏必备神仙版型连衣裙", style: "clean-minimal", label: "显瘦神仙款" },
      { headline: "高级感爆棚！明星同款大牌平替首发", style: "black-yellow", label: "大牌平替" },
      { headline: "绝美修身版型，拍照超级出片！", style: "clean-minimal", label: "拍照超出片" },
    ],
  },
  {
    name: "美妆护肤",
    icon: Sparkles,
    items: [
      { headline: "以油养肤！通宵熬夜脸瞬间提亮回春", style: "clean-minimal", label: "熬夜提亮" },
      { headline: "黄皮逆袭！洗出冷白皮的秘密神器", style: "neon-cyber", label: "黄皮逆袭" },
      { headline: "防脱育发！头皮清爽蓬松一整天", style: "clean-minimal", label: "清爽蓬松" },
    ],
  },
  {
    name: "美食生鲜",
    icon: ShoppingBag,
    items: [
      { headline: "鲜嫩多汁！现采现发爆汁直达餐桌", style: "yellow-red", label: "现采爆汁" },
      { headline: "皮薄肉厚汁水满！一口咬下超满足", style: "yellow-red", label: "皮薄肉厚" },
      { headline: "低卡低脂！减脂期也能放心大口吃", style: "clean-minimal", label: "低卡低脂" },
    ],
  },
  {
    name: "潮流科技",
    icon: Zap,
    items: [
      { headline: "黑科技爆品！提升居家幸福感神器", style: "neon-cyber", label: "黑科技神器" },
      { headline: "国潮新年限定！豪华礼盒立省百元", style: "festive-gold", label: "国潮限定" },
    ],
  },
]

type RefImage = {
  url: string
  title: string
  filename: string
  source: "upload" | "material"
}

export function CoverView() {
  const [mode, setMode] = useState<CoverMode>("text2img")
  const [headline, setHeadline] = useState("")
  const [style, setStyle] = useState<CoverStyle>("yellow-red")
  const [activeCategory, setActiveCategory] = useState<number>(0)
  const [refImage, setRefImage] = useState<RefImage | null>(null)
  const [isUploadingRef, setIsUploadingRef] = useState(false)
  const [showMaterialPicker, setShowMaterialPicker] = useState(false)
  const [sourceVideoTitle, setSourceVideoTitle] = useState<string | null>(null)

  // CatsAPI GPT Image 2 Parameters
  const [size, setSize] = useState<CoverSize>("1024x1536")
  const [count, setCount] = useState<number>(4)
  const [quality, setQuality] = useState<CoverQuality>("auto")
  const [rewritePrompt, setRewritePrompt] = useState<boolean>(false)

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

  // Listen to navigation state from History / Generator / Batch
  useEffect(() => {
    const state = location.state as {
      refImageUrl?: string
      headline?: string
      mode?: CoverMode
      title?: string
      sourceJobId?: string
    } | null

    if (state) {
      if (state.headline) setHeadline(state.headline)
      if (state.title) setSourceVideoTitle(state.title)
      if (state.refImageUrl) {
        setMode("img2img")
        setRefImage({
          url: state.refImageUrl,
          title: state.title || "成片截帧",
          filename: "video_frame.jpg",
          source: "material",
        })
      } else if (state.mode) {
        setMode(state.mode)
      }
      notify({
        title: "已载入成片信息",
        message: `已自动载入「${state.title || "目标成片"}」的视频画面与卖点文案`,
        type: "info",
      })
    }
  }, [location.state, notify])

  const handleResetCover = useCallback(() => {
    setJob(null)
    setHeadline("")
    setRefImage(null)
    setSourceVideoTitle(null)
    setSize("1024x1536")
    setCount(4)
    setQuality("auto")
    setRewritePrompt(false)
    setError(null)
    setSelectedId(null)
    setBusy(false)
    notify({
      title: "已新建封面页面",
      message: "文案与预览已重置，您可以重新输入爆款文案即时出图！",
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
    const timer = window.setInterval(() => {
      void fetchCoverJob(job.id)
        .then((next) => {
          setJob(next)
          if (next.status === "succeeded" || next.status === "failed") {
            setBusy(false)
            if (next.status === "succeeded") {
              notify({
                title: "封面大字报出图完成",
                message: "GPT 智能封面已生成成功，支持预览与下载！",
                type: "success",
              })
            } else {
              notify({
                title: "封面生成失败",
                message: next.error || "封面大字报出图失败，请检查 API 配置",
                type: "error",
              })
            }
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [job, notify])

  async function handleFileUpload(file: File) {
    if (!file) return
    setIsUploadingRef(true)
    setError(null)
    try {
      const res = await uploadCoverReference(file)
      setRefImage({
        url: res.url,
        title: file.name,
        filename: res.filename,
        source: "upload",
      })
      notify({
        title: "参考底图已上传",
        message: `已导入「${file.name}」，将作为图生图视觉重绘基底`,
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

  function handleSelectMaterial(mat: (typeof materials)[0]) {
    const targetUrl = mat.thumb_url || `/api/materials/${mat.id}/video`
    setRefImage({
      url: targetUrl,
      title: mat.title || mat.filename,
      filename: mat.filename,
      source: "material",
    })
    setShowMaterialPicker(false)
    notify({
      title: "已选择素材底图",
      message: `已将素材「${mat.title || mat.filename}」作为图生图参考底图`,
      type: "success",
    })
  }

  async function generate() {
    if (!headline.trim()) {
      setError("请填写大字报文案")
      return
    }
    if (mode === "img2img" && !refImage) {
      setError("图生图模式需要提供一张参考底图（请点击上方上传本地图片或从素材库选取）")
      return
    }
    setError(null)
    setBusy(true)
    setSelectedId(null)
    setJob(null)
    try {
      const created = await createCoverJob({
        headline: headline.trim(),
        style,
        count,
        mode: mode === "img2img" ? "img2img" : "text2img",
        image_url: mode === "img2img" ? refImage?.url : null,
        size,
        quality,
        rewrite_prompt: rewritePrompt,
      })
      setJob(created)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建封面任务失败")
    }
  }

  function applyPreset(item: PresetItem) {
    setHeadline(item.headline)
    setStyle(item.style)
  }

  function fillRandomPreset() {
    const allPresets = BUILTIN_PRESETS.flatMap((c) => c.items)
    const random = allPresets[Math.floor(Math.random() * allPresets.length)]
    applyPreset(random)
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
      {/* Creator Studio Settings Sidebar */}
      <Card className="flex w-[440px] xl:w-[480px] shrink-0 flex-col border-slate-200/80 dark:border-slate-800/80 shadow-sm bg-card rounded-3xl overflow-hidden">
        <CardHeader className="py-5 px-7 border-b border-slate-100 dark:border-slate-800/80 flex flex-row items-center justify-between bg-slate-50/40 dark:bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400">
              <Wand2 className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                封面生成工作台
              </CardTitle>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                {sourceVideoTitle ? `正在为「${sourceVideoTitle}」定制封面` : "CatsAPI · GPT Image 2 视觉大字报"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetCover}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium px-2.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="重置文案与设置"
          >
            <RefreshCw className="size-3" />
            <span>重置</span>
          </button>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-6 p-7 overflow-y-auto">
          {/* 1. Mode Switcher */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                01 · 生成方式
              </span>
              <span className="text-[11px] text-slate-400">
                {mode === "text2img" ? "文案构图出图" : "底图增质重绘"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100/80 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
              <button
                type="button"
                onClick={() => setMode("text2img")}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all cursor-pointer",
                  mode === "text2img"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100 ring-1 ring-black/5 dark:ring-white/10"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                )}
              >
                <div className={cn(
                  "flex size-7 items-center justify-center rounded-lg shrink-0",
                  mode === "text2img" ? "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400" : "bg-slate-200/60 text-slate-400 dark:bg-slate-800"
                )}>
                  <PenTool className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold leading-tight">文生成 (文生图)</div>
                  <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5">纯文案提示词驱动</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode("img2img")}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all cursor-pointer",
                  mode === "img2img"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100 ring-1 ring-black/5 dark:ring-white/10"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                )}
              >
                <div className={cn(
                  "flex size-7 items-center justify-center rounded-lg shrink-0",
                  mode === "img2img" ? "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400" : "bg-slate-200/60 text-slate-400 dark:bg-slate-800"
                )}>
                  <ImagePlus className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold leading-tight">图生成 (图生图)</div>
                  <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5">参考底图视觉重绘</div>
                </div>
              </button>
            </div>
          </div>

          {/* Reference Image Upload Section (When mode === "img2img") */}
          {mode === "img2img" && (
            <div className="flex flex-col gap-2 p-4 rounded-2xl border border-purple-200/80 dark:border-purple-900/60 bg-purple-50/30 dark:bg-purple-950/20">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ImageIcon className="size-3.5 text-purple-600" />
                  参考底图 (商品/主播实拍)
                </span>
                {materials.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowMaterialPicker(true)}
                    className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-semibold cursor-pointer"
                  >
                    <Film className="size-3" />
                    素材库选帧
                  </button>
                )}
              </div>

              {refImage ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-purple-200/60 dark:border-purple-800/40 shadow-xs">
                  <img
                    src={refImage.url}
                    alt={refImage.title}
                    className="size-14 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {refImage.title}
                    </p>
                    <span className="inline-flex items-center gap-1 mt-1 rounded-md bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300 border border-purple-200/60">
                      <CheckCircle2 className="size-2.5" />
                      {refImage.source === "material" ? "素材库抽帧" : "本地上传原图"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                    >
                      更换
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefImage(null)}
                      className="text-[11px] text-rose-500 hover:text-rose-600 font-semibold cursor-pointer"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const file = e.dataTransfer.files[0]
                    if (file) void handleFileUpload(file)
                  }}
                  className="group relative flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed border-purple-300/80 dark:border-purple-800/80 hover:border-purple-500 bg-white/70 dark:bg-slate-900/60 hover:bg-purple-50/50 transition-all cursor-pointer text-center"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleFileUpload(file)
                    }}
                  />
                  {isUploadingRef ? (
                    <div className="flex flex-col items-center gap-2 py-2 text-purple-600">
                      <Loader2 className="size-6 animate-spin" />
                      <span className="text-xs font-medium">正在导入底图…</span>
                    </div>
                  ) : (
                    <>
                      <div className="size-10 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300 flex items-center justify-center mb-1.5 group-hover:scale-110 transition-transform shadow-xs">
                        <UploadCloud className="size-5" />
                      </div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        点击或拖拽上传商品/人物实拍图
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        支持 JPG, PNG, WebP · AI 将基于此图重绘封面
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2. Copywriting & Inspirations Hub */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Bookmark className="size-3.5 text-slate-400" />
                02 · 爆款大字报文案
              </span>
              <button
                type="button"
                onClick={fillRandomPreset}
                className="group flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-semibold cursor-pointer transition-colors"
              >
                <Dices className="size-3.5 text-blue-500 group-hover:rotate-180 transition-transform duration-300" />
                随机爆款
              </button>
            </div>

            {/* Category Selector Tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {BUILTIN_PRESETS.map((cat, idx) => {
                const Icon = cat.icon
                const isActive = activeCategory === idx
                return (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setActiveCategory(idx)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer",
                      isActive
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs scale-[1.02]"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200/70"
                    )}
                  >
                    <Icon className={cn("size-3.5", isActive ? "text-amber-400 dark:text-amber-500" : "text-slate-400")} />
                    <span>{cat.name}</span>
                  </button>
                )
              })}
            </div>

            {/* Quick Inspiration Chips */}
            <div className="flex flex-wrap gap-1.5">
              {BUILTIN_PRESETS[activeCategory].items.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 dark:bg-slate-800/60 dark:hover:bg-blue-950/40 dark:text-slate-300 dark:hover:text-blue-300 border border-slate-200/80 hover:border-blue-300 dark:border-slate-700 dark:hover:border-blue-800 transition-all cursor-pointer"
                >
                  <Tag className="size-3 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>

            {/* Textarea Input */}
            <div className="relative mt-1">
              <Textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="点击上方热门预设标签，或直接在此输入自定义核心卖点标语…"
                className="h-24 resize-none text-xs rounded-2xl border-slate-200 dark:border-slate-800 p-3.5 pb-7 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 leading-relaxed"
                maxLength={120}
              />
              <span className="absolute bottom-2.5 right-3 font-mono text-[10px] text-slate-400 pointer-events-none">
                {headline.length}/120
              </span>
            </div>
          </div>

          {/* 3. Visual Typography Styles (Clean 3-Column Swatch Cards) */}
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Palette className="size-3.5 text-slate-400" />
              03 · 视觉字体风格
            </span>
            <div className="grid grid-cols-3 gap-2.5">
              {textStyles.map((item) => {
                const isSelected = style === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStyle(item.id)}
                    className={cn(
                      "group relative flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all cursor-pointer",
                      isSelected
                        ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20 shadow-xs scale-[1.02]"
                        : "border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-850/40 hover:border-slate-300 hover:bg-white dark:hover:bg-slate-800"
                    )}
                  >
                    <div className={cn("w-full py-1.5 px-1 rounded-xl text-center text-xs tracking-wider truncate border shadow-2xs mb-2 transition-transform group-hover:scale-[1.03]", item.previewClass)}>
                      爆款特惠
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={cn("size-2 rounded-full bg-gradient-to-br shadow-2xs", item.colors)} />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{item.label}</span>
                    </div>
                    {isSelected && (
                      <div className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                        <Check className="size-2.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 4. Format & Parameters Section */}
          <div className="flex flex-col gap-3.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Settings2 className="size-3.5 text-slate-400" />
                04 · 画幅与生成参数
              </span>
              <span className="rounded-full bg-blue-50 dark:bg-blue-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-blue-600 dark:text-blue-300">
                GPT Image 2
              </span>
            </div>

            {/* Size Selector */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSize("1024x1536")}
                className={cn(
                  "flex flex-col items-center py-2 px-2 rounded-xl text-center transition-all border cursor-pointer",
                  size === "1024x1536"
                    ? "border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold ring-1 ring-blue-500 shadow-2xs"
                    : "border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                )}
              >
                <span className="text-xs font-semibold">📱 竖版 2:3</span>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5">1024×1536</span>
              </button>
              <button
                type="button"
                onClick={() => setSize("1024x1024")}
                className={cn(
                  "flex flex-col items-center py-2 px-2 rounded-xl text-center transition-all border cursor-pointer",
                  size === "1024x1024"
                    ? "border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold ring-1 ring-blue-500 shadow-2xs"
                    : "border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                )}
              >
                <span className="text-xs font-semibold">⬛ 方图 1:1</span>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5">1024×1024</span>
              </button>
              <button
                type="button"
                onClick={() => setSize("1536x1024")}
                className={cn(
                  "flex flex-col items-center py-2 px-2 rounded-xl text-center transition-all border cursor-pointer",
                  size === "1536x1024"
                    ? "border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold ring-1 ring-blue-500 shadow-2xs"
                    : "border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                )}
              >
                <span className="text-xs font-semibold">🖥️ 横版 3:2</span>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5">1536×1024</span>
              </button>
            </div>

            {/* Count & Quality Controls */}
            <div className="grid grid-cols-2 gap-3">
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
                          ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-slate-100"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <SlidersHorizontal className="size-3 text-slate-400" />
                  出图画质
                </span>
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
                  {(
                    [
                      { id: "auto", label: "智能" },
                      { id: "high", label: "超清" },
                      { id: "medium", label: "标准" },
                      { id: "low", label: "极速" },
                    ] as const
                  ).map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setQuality(q.id)}
                      className={cn(
                        "py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer",
                        quality === q.id
                          ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-slate-100"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Prompt Polish Switch */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  <Wand2 className="size-3 text-blue-500" />
                  AI 提示词深度润色
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">由 GPT 自动优化构图与商业光影细节</span>
              </div>
              <button
                type="button"
                onClick={() => setRewritePrompt((prev) => !prev)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden",
                  rewritePrompt ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                    rewritePrompt ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          </div>

          {error ? <p className="text-xs text-rose-500 font-medium">{error}</p> : null}

          {/* Primary Action Button */}
          <Button
            className="mt-auto h-12 w-full rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 transition-all active:scale-[0.99] cursor-pointer"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : mode === "img2img" ? (
              <ImagePlus className="mr-2 size-4.5" />
            ) : (
              <Wand2 className="mr-2 size-4.5" />
            )}
            {busy
              ? mode === "img2img"
                ? `正在图生图 (${count} 张)…`
                : `正在文生图 (${count} 张)…`
              : mode === "img2img"
                ? `批量图生图 (${count} 张海报)`
                : `批量文生图 (${count} 张海报)`}
          </Button>
        </CardContent>
      </Card>

      {/* Results & Showcase Canvas */}
      <Card className="flex flex-1 flex-col overflow-y-auto border-slate-200/80 dark:border-slate-800/80 shadow-sm bg-card rounded-3xl overflow-hidden">
        <CardHeader className="py-5 px-7 border-b border-slate-100 dark:border-slate-800/80 flex flex-row items-center justify-between bg-slate-50/40 dark:bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400">
              <ImageIcon className="size-4.5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                生成画布与画廊
              </CardTitle>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                点击单张卡片设为主封面，悬浮支持大图预览、下载与删除
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
                <Download className="size-3.5 text-blue-600" />
                <span>批量下载全部 ({covers.length}张)</span>
              </Button>
            ) : null}
            {selectedId ? (
              <Button
                size="sm"
                onClick={handleApplySelectedCover}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm shadow-blue-500/20 px-3.5 py-2 cursor-pointer"
              >
                <Check className="size-3.5" />
                <span>应用所选封面</span>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-6 p-6">
          {showProcessing ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-blue-600 py-12">
              <Loader2 className="size-8 animate-spin" />
              <p className="font-medium text-sm text-slate-800 dark:text-slate-200">{job?.message || "准备中…"}</p>
              <p className="text-xs text-slate-400">
                进度 {job?.progress ?? 0}%
              </p>
              {covers.length ? (
                <div className="mt-6 grid w-full grid-cols-2 gap-5 lg:grid-cols-4">
                  {covers.map((cover) => (
                    <div key={cover.id} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xs">
                      <img
                        src={cover.url}
                        alt=""
                        className="aspect-[3/4] w-full rounded-lg object-cover"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : covers.length ? (
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
              {covers.map((cover, idx) => {
                const isSelected = selectedId === cover.id
                const isDeleting = deletingCoverId === cover.id
                return (
                  <div
                    key={cover.id}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-left transition-all shadow-xs hover:shadow-md",
                      isSelected
                        ? "ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-slate-950"
                        : "hover:border-slate-300"
                    )}
                  >
                    <div
                      onClick={() => setSelectedId(cover.id)}
                      className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 cursor-pointer"
                    >
                      <img
                        src={cover.url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {isSelected ? (
                        <div className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full bg-blue-600 text-white shadow-md">
                          <Check className="size-3.5" />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteCurrentCover(e, cover.id)}
                          disabled={isDeleting}
                          className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur-xs transition-all hover:bg-rose-600 hover:text-white group-hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer shadow-sm disabled:opacity-50"
                          title="删除此封面"
                        >
                          {isDeleting ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                        </button>
                      )}

                      {/* Hover Overlay with Zoom and Download Buttons */}
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
                          <ZoomIn className="size-3.5 text-blue-600" />
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
                  在左侧选择内置提示词预设或填写大字报文案，点击「批量生成封面」
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
                      className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 cursor-pointer shadow-2xs hover:shadow-md transition-all"
                      title="点击放大预览"
                    >
                      <img
                        src={item.url}
                        alt={item.headline}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {/* Delete icon button in top right */}
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

      {/* Fullscreen Image Preview Lightbox Modal */}
      <ImagePreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        images={previewImages}
        initialIndex={previewIndex}
        onDelete={previewDeleteHandler ? handleModalDelete : undefined}
      />

      {/* Material Library Reference Picker Modal */}
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
                  从素材库选取参考图
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  点击直接选择对应切片视频的代表帧作为图生图视觉底图
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
                      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 text-left transition-all hover:border-blue-500 hover:shadow-md cursor-pointer"
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
