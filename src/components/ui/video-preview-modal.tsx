import { useState, useEffect, useCallback, useMemo } from "react"
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Sparkles,
  ZoomIn,
  Loader2,
  Film,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Job, CoverResult } from "@/lib/api"
import { cn, formatProcessingDuration } from "@/lib/utils"

export type VideoPreviewModalProps = {
  isOpen: boolean
  onClose: () => void
  jobs: Job[]
  initialJobId?: string | null
  groupNameMap?: Record<string, string> | Map<string, string>
  onGenerateCovers?: (jobId: string) => Promise<void> | void
  isGeneratingCovers?: boolean
  generatingJobId?: string | null
  onOpenImagePreview?: (images: string[], index?: number) => void
}

export function VideoPreviewModal({
  isOpen,
  onClose,
  jobs,
  initialJobId,
  groupNameMap,
  onGenerateCovers,
  isGeneratingCovers = false,
  generatingJobId = null,
  onOpenImagePreview,
}: VideoPreviewModalProps) {
  // Filter jobs that are succeeded and have output_url
  const playableJobs = useMemo(
    () => jobs.filter((j) => j.status === "succeeded" && !!j.output_url),
    [jobs]
  )

  const [currentJobId, setCurrentJobId] = useState<string | null>(initialJobId || null)
  const [copied, setCopied] = useState(false)

  // Sync currentJobId when modal opens or initialJobId changes
  useEffect(() => {
    if (isOpen) {
      if (initialJobId && playableJobs.some((j) => j.id === initialJobId)) {
        setCurrentJobId(initialJobId)
      } else if (playableJobs.length > 0) {
        setCurrentJobId(playableJobs[0].id)
      }
    }
  }, [isOpen, initialJobId, playableJobs])

  const currentIndex = useMemo(() => {
    const idx = playableJobs.findIndex((j) => j.id === currentJobId)
    return idx >= 0 ? idx : 0
  }, [playableJobs, currentJobId])

  const currentJob = playableJobs[currentIndex] || null

  const getGroupName = useCallback(
    (groupId?: string | null) => {
      if (!groupId) return "成片"
      if (groupNameMap instanceof Map) {
        return groupNameMap.get(groupId) || "成片"
      }
      if (groupNameMap && typeof groupNameMap === "object") {
        return groupNameMap[groupId] || "成片"
      }
      return "成片"
    },
    [groupNameMap]
  )

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentJobId(playableJobs[currentIndex - 1].id)
    }
  }, [currentIndex, playableJobs])

  const handleNext = useCallback(() => {
    if (currentIndex < playableJobs.length - 1) {
      setCurrentJobId(playableJobs[currentIndex + 1].id)
    }
  }, [currentIndex, playableJobs])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      } else if (e.key === "ArrowLeft" && !(e.target instanceof HTMLInputElement)) {
        handlePrev()
      } else if (e.key === "ArrowRight" && !(e.target instanceof HTMLInputElement)) {
        handleNext()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose, handlePrev, handleNext])

  if (!isOpen || !currentJob) return null

  const coversList: CoverResult[] = currentJob.covers || []
  const isCoverLoading = isGeneratingCovers && generatingJobId === currentJob.id

  const handleCopyLink = () => {
    if (currentJob.output_url) {
      navigator.clipboard.writeText(window.location.origin + currentJob.output_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleCoverClick = (idx: number) => {
    if (onOpenImagePreview && coversList.length > 0) {
      onOpenImagePreview(
        coversList.map((c) => c.url),
        idx
      )
    }
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 backdrop-blur-md animate-in fade-in-0 duration-200 select-none overflow-hidden"
    >
      {/* Top Header Bar */}
      <div className="flex w-full items-center justify-between px-6 py-4 text-white z-10 bg-gradient-to-b from-black/90 via-black/70 to-transparent border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-blue-600/30 border border-blue-500/40 text-blue-400 px-3 py-1 text-xs font-mono font-bold tracking-wide">
            {currentIndex + 1} / {playableJobs.length}
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight">
                {getGroupName(currentJob.group_id)}
                <span className="ml-1.5 font-mono text-xs text-blue-400">
                  #{currentIndex + 1}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="size-3" />
                {currentJob.duration ? `${Math.round(currentJob.duration)} 秒` : "已就绪"}
              </span>
              {currentJob.processing_seconds != null ? (
                <span className="inline-flex items-center text-[11px] font-medium text-slate-300 bg-white/10 border border-white/10 px-2 py-0.5 rounded-full tabular-nums">
                  处理 {formatProcessingDuration(currentJob.processing_seconds)}
                </span>
              ) : null}
            </div>
            {currentJob.headline ? (
              <span className="text-xs text-slate-400 truncate max-w-md mt-0.5">
                口播提炼：「{currentJob.headline}」
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyLink}
            className="text-slate-300 hover:text-white hover:bg-white/10 rounded-xl text-xs gap-1.5 h-9 cursor-pointer"
          >
            {copied ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "已复制链接" : "复制视频链接"}
          </Button>

          <Button
            asChild
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs gap-1.5 h-9 font-semibold shadow-md cursor-pointer border-none"
          >
            <a href={`/api/jobs/${currentJob.id}/download`} download>
              <Download className="size-4" />
              下载此成片
            </a>
          </Button>

          <div className="w-px h-5 bg-white/20 mx-1" />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-white/15 rounded-full size-9 cursor-pointer"
            title="关闭预览 (Esc)"
          >
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {/* Main Content Area: Video Center + Right Companion Covers Gallery */}
      <div className="relative flex flex-1 w-full items-center justify-center overflow-hidden p-4 md:p-6 gap-6 min-h-0">
        {/* Left Arrow Button */}
        {playableJobs.length > 1 && currentIndex > 0 ? (
          <button
            type="button"
            onClick={handlePrev}
            className="absolute left-6 z-30 flex size-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all hover:bg-blue-600 hover:scale-105 active:scale-95 cursor-pointer shadow-2xl border border-white/20"
            title="上一个成片 (←)"
          >
            <ChevronLeft className="size-7" />
          </button>
        ) : null}

        {/* Video Theater Screen */}
        <div className="relative flex flex-1 h-full items-center justify-center min-w-0 max-w-4xl">
          <div className="relative flex h-full max-h-[72vh] aspect-[9/16] items-center justify-center rounded-2xl overflow-hidden bg-black/90 shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/10">
            <video
              key={currentJob.output_url}
              src={currentJob.output_url || undefined}
              controls
              autoPlay
              playsInline
              className="size-full object-contain"
            />
          </div>
        </div>

        {/* Right Companion Covers Sidebar Gallery */}
        <div className="hidden lg:flex w-[280px] xl:w-[320px] shrink-0 h-full max-h-[72vh] flex-col rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-xl p-4 overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-4 text-amber-400" />
              <span className="text-xs font-bold text-slate-100">
                配套 9:16 封面 ({coversList.length}张)
              </span>
            </div>
            {onGenerateCovers ? (
              <button
                type="button"
                disabled={isCoverLoading}
                onClick={() => void onGenerateCovers(currentJob.id)}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all border border-amber-500/30"
                title="为此视频重新生成 3 张 AI 爆款封面"
              >
                {isCoverLoading ? (
                  <Loader2 className="size-3 animate-spin text-amber-300" />
                ) : (
                  <Sparkles className="size-3 text-amber-400" />
                )}
                {coversList.length > 0 ? "重新生成" : "一键生成"}
              </button>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 py-3 pr-1">
            {coversList.length > 0 ? (
              coversList.map((cover, idx) => (
                <div
                  key={cover.id || idx}
                  className="group relative flex flex-col rounded-xl border border-white/10 bg-slate-950/80 p-2 transition-all hover:border-blue-500/60 shadow-md"
                >
                  <div
                    onClick={() => handleCoverClick(idx)}
                    className="relative aspect-[9/16] w-full max-h-[220px] mx-auto overflow-hidden rounded-lg bg-black cursor-pointer shadow-inner"
                    title="点击放大预览封面"
                  >
                    <img
                      src={cover.url}
                      alt={`封面 #${idx + 1}`}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-1 backdrop-blur-xs">
                      <ZoomIn className="size-4" />
                      <span className="text-xs font-semibold">放大预览</span>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-1">
                    <span className="text-[10px] font-medium text-slate-400">
                      封面 #{idx + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCoverClick(idx)}
                        className="px-2 py-0.5 text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <ZoomIn className="size-3" />
                        放大
                      </button>
                      <a
                        href={cover.url}
                        download={`cover_${idx + 1}`}
                        className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <Download className="size-2.5" />
                        下载
                      </a>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 gap-2">
                <div className="size-10 rounded-full bg-white/5 flex items-center justify-center text-slate-400">
                  <Film className="size-5" />
                </div>
                <p className="text-xs font-medium">暂无专属配套封面</p>
                <p className="text-[11px] text-slate-500 max-w-[200px]">
                  点击上方「一键生成」，自动提取本片高光帧生成竖版大字报海报
                </p>
                {onGenerateCovers && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isCoverLoading}
                    onClick={() => void onGenerateCovers(currentJob.id)}
                    className="mt-2 text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded-xl cursor-pointer"
                  >
                    {isCoverLoading ? (
                      <Loader2 className="size-3.5 animate-spin mr-1 text-amber-300" />
                    ) : (
                      <Sparkles className="size-3.5 mr-1 text-amber-400" />
                    )}
                    立即生成封面
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Arrow Button */}
        {playableJobs.length > 1 && currentIndex < playableJobs.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="absolute right-6 z-30 flex size-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all hover:bg-blue-600 hover:scale-105 active:scale-95 cursor-pointer shadow-2xl border border-white/20"
            title="下一个成片 (→)"
          >
            <ChevronRight className="size-7" />
          </button>
        ) : null}
      </div>

      {/* Bottom Thumbnail Strip / Quick Switch Bar */}
      {playableJobs.length > 1 && (
        <div className="w-full px-6 py-3 bg-black/80 backdrop-blur-lg border-t border-white/10 flex items-center justify-center gap-2 overflow-x-auto shrink-0">
          <span className="text-[11px] font-medium text-slate-400 mr-2 shrink-0">
            快捷切换视频 ({playableJobs.length}条):
          </span>
          <div className="flex items-center gap-2 max-w-4xl overflow-x-auto py-1">
            {playableJobs.map((job, idx) => {
              const isActive = job.id === currentJob.id
              const gName = getGroupName(job.group_id)
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setCurrentJobId(job.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer border",
                    isActive
                      ? "bg-blue-600 text-white border-blue-400 shadow-lg scale-105 font-bold"
                      : "bg-white/10 hover:bg-white/20 text-slate-300 border-transparent"
                  )}
                >
                  <Film className="size-3.5 shrink-0" />
                  <span className="truncate max-w-[100px]">{gName}</span>
                  <span className="font-mono text-[10px] opacity-80">#{idx + 1}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
