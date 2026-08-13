import { useCallback, useEffect, useState } from "react"
import { Bot, Check, Images, Loader2, Sparkles, Wand2, ZoomIn } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImagePreviewModal } from "@/components/ui/image-preview-modal"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  createCoverJob,
  fetchCoverJob,
  fetchCoverJobs,
  type CoverJob,
  type CoverStyle,
} from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { cn } from "@/lib/utils"

const textStyles: { id: CoverStyle; label: string; className: string }[] = [
  { id: "yellow-red", label: "黄红爆款", className: "bg-yellow-400 text-red-600 border border-yellow-500 font-extrabold" },
  { id: "black-yellow", label: "黑金高端", className: "bg-black text-yellow-400 border border-yellow-400/40 font-extrabold" },
  { id: "red-white", label: "红白秒杀", className: "bg-red-600 text-white border border-red-700 font-extrabold" },
  { id: "neon-cyber", label: "赛博霓虹", className: "bg-purple-950 text-cyan-300 border border-cyan-400 font-extrabold" },
  { id: "clean-minimal", label: "极简素雅", className: "bg-stone-200 text-stone-800 border border-stone-300 dark:bg-stone-800 dark:text-stone-100 font-semibold" },
  { id: "festive-gold", label: "国潮烫金", className: "bg-red-900 text-amber-300 border border-amber-400/60 font-extrabold" },
]

type PresetItem = {
  headline: string
  style: CoverStyle
  label: string
}

type CopyCategory = {
  name: string
  items: PresetItem[]
}

const BUILTIN_PRESETS: CopyCategory[] = [
  {
    name: "🔥 爆款清仓",
    items: [
      { headline: "破价清仓！最后100件，错过再等一年！", style: "yellow-red", label: "破价清仓" },
      { headline: "买一送三！全网爆款热销，错过再等一年！", style: "red-white", label: "买一送三" },
      { headline: "全网最低价！工厂直发，无中间商赚差价！", style: "black-yellow", label: "工厂直发" },
    ],
  },
  {
    name: "👗 时尚穿搭",
    items: [
      { headline: "显瘦20斤！今夏必备神仙版型连衣裙", style: "clean-minimal", label: "显瘦神仙款" },
      { headline: "高级感爆棚！明星同款大牌平替首发", style: "black-yellow", label: "大牌平替" },
      { headline: "绝美修身版型，拍照超级出片！", style: "clean-minimal", label: "拍照超出片" },
    ],
  },
  {
    name: "💄 美妆护肤",
    items: [
      { headline: "以油养肤！通宵熬夜脸瞬间提亮回春", style: "clean-minimal", label: "熬夜提亮" },
      { headline: "黄皮逆袭！洗出冷白皮的秘密神器", style: "neon-cyber", label: "黄皮逆袭" },
      { headline: "防脱育发！头皮清爽蓬松一整天", style: "clean-minimal", label: "清爽蓬松" },
    ],
  },
  {
    name: "🍎 美食生鲜",
    items: [
      { headline: "鲜嫩多汁！现采现发爆汁直达餐桌", style: "yellow-red", label: "现采爆汁" },
      { headline: "皮薄肉厚汁水满！一口咬下超满足", style: "yellow-red", label: "皮薄肉厚" },
      { headline: "低卡低脂！减脂期也能放心大口吃", style: "clean-minimal", label: "低卡低脂" },
    ],
  },
  {
    name: "⚡ 潮流科技",
    items: [
      { headline: "黑科技爆品！提升居家幸福感神器", style: "neon-cyber", label: "黑科技神器" },
      { headline: "国潮新年限定！豪华礼盒立省百元", style: "festive-gold", label: "国潮限定" },
    ],
  },
]

export function CoverView() {
  const [mode, setMode] = useState<"ai" | "template">("ai")
  const [headline, setHeadline] = useState("")
  const [style, setStyle] = useState<CoverStyle>("yellow-red")
  const [activeCategory, setActiveCategory] = useState<number>(0)
  const [job, setJob] = useState<CoverJob | null>(null)
  const [history, setHistory] = useState<CoverJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { notify } = useNotifications()

  const handleResetCover = useCallback(() => {
    setJob(null)
    setHeadline("")
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

  async function generate() {
    if (!headline.trim()) {
      setError("请填写大字报文案")
      return
    }
    if (mode === "template") {
      setError("图文模版模式即将支持，请先用 AI 智能截取（GPT Image 2）")
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
        count: 4,
        mode: "ai",
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
    .slice(0, 12)

  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const handleOpenPreview = (imgs: string[], index = 0) => {
    setPreviewImages(imgs)
    setPreviewIndex(index)
    setIsPreviewOpen(true)
  }

  return (
    <div className="flex h-full gap-8">
      {/* Settings Card */}
      <Card className="flex w-[380px] shrink-0 flex-col border-slate-200/80 dark:border-slate-800/80 shadow-xs bg-card rounded-2xl">
        <CardHeader className="py-5 px-6 border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">封面生成设置</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-5 p-6 overflow-y-auto">
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">生成方式</FieldLabel>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => {
                  if (v) setMode(v as "ai" | "template")
                }}
                variant="outline"
                className="w-full rounded-lg border-slate-200 dark:border-slate-800"
              >
                <ToggleGroupItem value="ai" className="flex-1 text-xs py-1.5">
                  AI 智能生成
                </ToggleGroupItem>
                <ToggleGroupItem value="template" className="flex-1 text-xs py-1.5">
                  图文模版
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                AI 模式使用 CatsAPI · GPT Image 2
              </p>
            </Field>

            {/* Built-in Presets Selector */}
            <Field>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  内置爆款提示词预设
                </FieldLabel>
                <button
                  type="button"
                  onClick={fillRandomPreset}
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium cursor-pointer"
                >
                  <Wand2 className="size-3" />
                  随机爆款
                </button>
              </div>

              {/* Category Sub-tabs */}
              <div className="flex gap-1 overflow-x-auto pb-1.5 scrollbar-none">
                {BUILTIN_PRESETS.map((cat, idx) => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => setActiveCategory(idx)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition-all cursor-pointer",
                      activeCategory === idx
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-2xs"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200/60"
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* Preset Chips */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {BUILTIN_PRESETS[activeCategory].items.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="group flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 dark:bg-slate-800/60 dark:hover:bg-blue-950/40 dark:text-slate-300 dark:hover:text-blue-300 border border-slate-200/80 hover:border-blue-300 dark:border-slate-700 dark:hover:border-blue-800 transition-all cursor-pointer"
                  >
                    <Sparkles className="size-3 text-amber-500 shrink-0" />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field>
              <div className="flex items-center justify-between mb-2">
                <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  大字报文案 (吸引眼球)
                </FieldLabel>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium cursor-pointer"
                  onClick={fillRandomPreset}
                >
                  <Bot className="size-3" />
                  AI 换一换
                </button>
              </div>
              <Textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="点击上方内置提示词预设，或直接在此输入自定义爆款大字报文案…"
                className="h-22 resize-none text-xs rounded-xl border-slate-200 dark:border-slate-800 p-3"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">视觉字体风格</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {textStyles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStyle(item.id)}
                    className={cn(
                      "flex h-9 cursor-pointer items-center justify-center rounded-xl text-xs transition-all shadow-2xs px-2 text-center truncate",
                      item.className,
                      style === item.id
                        ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950 scale-[1.02] shadow-sm"
                        : "opacity-80 hover:opacity-100"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </Field>
          </FieldGroup>

          {error ? <p className="text-xs text-rose-500 font-medium">{error}</p> : null}

          <Button
            className="mt-auto h-11 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm shadow-xs hover:shadow transition-all active:scale-[0.99] cursor-pointer"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {busy ? "生成中…" : "批量生成 4 张封面"}
          </Button>
        </CardContent>
      </Card>

      {/* Results Card */}
      <Card className="flex flex-1 flex-col overflow-y-auto border-slate-200/80 dark:border-slate-800/80 shadow-xs bg-card rounded-2xl">
        <CardHeader className="py-5 px-6 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            生成结果{" "}
            <span className="text-xs font-normal text-slate-400 dark:text-slate-500 ml-1">
              (请选择最满意的一张)
            </span>
          </CardTitle>
          {selectedId ? (
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">应用所选封面</Button>
          ) : null}
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
                        <div className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-blue-600 text-white shadow-md">
                          <Check className="size-3.5" />
                        </div>
                      ) : null}

                      {/* Hover Overlay with Zoom Button */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleOpenPreview(covers.map((c) => c.url), idx)
                          }}
                          className="flex items-center gap-1 rounded-full bg-white/90 dark:bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer"
                        >
                          <ZoomIn className="size-3.5 text-blue-600" />
                          放大预览
                        </button>
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
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                历史出图记录
              </h4>
              <div className="grid grid-cols-4 gap-3 lg:grid-cols-6">
                {historyCovers.map((item, idx) => (
                  <div
                    key={item.id}
                    onClick={() => handleOpenPreview(historyCovers.map((h) => h.url), idx)}
                    className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 cursor-pointer"
                    title="点击放大预览"
                  >
                    <img
                      src={item.url}
                      alt={item.headline}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-transparent to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <p className="line-clamp-2 text-[10px] text-white font-medium">
                        {item.headline}
                      </p>
                    </div>
                  </div>
                ))}
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
      />
    </div>
  )
}
