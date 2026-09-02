import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertCircle,
  Clock,
  Download,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useNotifications } from "@/hooks/use-notifications"
import {
  exportJobSrtUrl,
  fetchJobSubtitles,
  reburnJobSubtitles,
  type Job,
  type SubtitleSegment,
} from "@/lib/api"
import { cn } from "@/lib/utils"

interface SubtitleProofreaderModalProps {
  isOpen: boolean
  onClose: () => void
  job: Job | null
  onJobUpdated?: (updatedJob: Job) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`
}

export function SubtitleProofreaderModal({
  isOpen,
  onClose,
  job,
  onJobUpdated,
}: SubtitleProofreaderModalProps) {
  const { notify } = useNotifications()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [loading, setLoading] = useState(false)
  const [reburning, setReburning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([])
  const [originalSubtitles, setOriginalSubtitles] = useState<SubtitleSegment[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState<number>(1.0)
  const [activeSubIndex, setActiveSubIndex] = useState<number>(-1)

  // 查找替换小工具状态
  const [showReplace, setShowReplace] = useState(false)
  const [findWord, setFindWord] = useState("")
  const [replaceWord, setReplaceWord] = useState("")

  const rowsContainerRef = useRef<HTMLDivElement>(null)

  // 1. 加载字幕数据
  const loadSubtitles = useCallback(async (jobId: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJobSubtitles(jobId)
      setSubtitles(data.subtitles || [])
      setOriginalSubtitles(data.subtitles || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取字幕失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !job) {
      setSubtitles([])
      setOriginalSubtitles([])
      setCurrentTime(0)
      setIsPlaying(false)
      setActiveSubIndex(-1)
      return
    }
    void loadSubtitles(job.id)
  }, [isOpen, job, loadSubtitles])

  // 2. 视频时间跟踪与当前字幕高亮定位
  useEffect(() => {
    if (!subtitles.length) {
      setActiveSubIndex(-1)
      return
    }
    const idx = subtitles.findIndex(
      (s) => currentTime >= s.start - 0.05 && currentTime <= s.end + 0.15
    )
    setActiveSubIndex(idx)
  }, [currentTime, subtitles])

  // 自动平滑滚动当前高亮字幕至视口
  useEffect(() => {
    if (activeSubIndex >= 0 && rowsContainerRef.current) {
      const activeEl = rowsContainerRef.current.querySelector<HTMLElement>(`[data-sub-idx="${activeSubIndex}"]`)
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }
  }, [activeSubIndex])

  // 键盘快捷键 (Space 播放/暂停, Esc 退出)
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault()
        handlePlayPause()
      } else if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  // 3. 播放器控制
  const handlePlayPause = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      void videoRef.current.play()
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleSeekToSegment = (seg: SubtitleSegment) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, seg.start)
    if (videoRef.current.paused) {
      void videoRef.current.play()
      setIsPlaying(true)
    }
  }

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
  }

  const handleStepTime = (delta: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + delta))
  }

  // 4. 编辑字幕文本
  const handleTextChange = (index: number, newText: string) => {
    setSubtitles((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], text: newText }
      return next
    })
  }

  // 删除单行
  const handleDeleteSegment = (index: number) => {
    setSubtitles((prev) => prev.filter((_, i) => i !== index))
  }

  // 新增字幕行
  const handleAddSegment = () => {
    const lastSeg = subtitles[subtitles.length - 1]
    const newStart = lastSeg ? lastSeg.end + 0.1 : Math.round(currentTime * 10) / 10
    const newEnd = newStart + 2.5
    const newSeg: SubtitleSegment = {
      id: `sub_custom_${Date.now()}`,
      start: Number(newStart.toFixed(2)),
      end: Number(newEnd.toFixed(2)),
      text: "",
    }
    setSubtitles((prev) => [...prev, newSeg])
  }

  // 批量工具：去除句尾标点
  const handleRemovePunctuation = () => {
    setSubtitles((prev) =>
      prev.map((s) => ({
        ...s,
        text: s.text.replace(/[，。！？；、,.!?;:]+$/g, ""),
      }))
    )
    notify({
      title: "已优化字幕",
      message: "已自动去除全部字幕行末尾的标点符号！",
      type: "success",
    })
  }

  // 批量工具：查找替换
  const handleExecuteReplace = () => {
    if (!findWord) return
    let matchCount = 0
    setSubtitles((prev) =>
      prev.map((s) => {
        if (s.text.includes(findWord)) {
          matchCount++
          return {
            ...s,
            text: s.text.replaceAll(findWord, replaceWord),
          }
        }
        return s
      })
    )
    notify({
      title: "替换完成",
      message: `已在 ${matchCount} 处字幕中将「${findWord}」替换为「${replaceWord}」！`,
      type: "success",
    })
    setShowReplace(false)
    setFindWord("")
    setReplaceWord("")
  }

  // 重置为初始识别字幕
  const handleResetToOriginal = () => {
    setSubtitles([...originalSubtitles])
    notify({
      title: "已还原字幕",
      message: "已恢复至本次打开时的原始 AI 识别内容。",
      type: "info",
    })
  }

  // 5. 保存并重新烧录成片 (Re-burn)
  const handleReburn = async () => {
    if (!job) return
    setReburning(true)
    setError(null)
    try {
      const res = await reburnJobSubtitles(job.id, subtitles, "high")
      if (onJobUpdated && res.job) {
        onJobUpdated(res.job)
      }
      notify({
        title: "字幕重新烧录完成",
        message: "成片画面已成功以校对后的字幕重新渲染，并已更新为最新版本！",
        type: "success",
      })
      if (videoRef.current) {
        videoRef.current.load()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新烧录字幕失败")
      notify({
        title: "重新烧录失败",
        message: err instanceof Error ? err.message : "渲染异常",
        type: "error",
      })
    } finally {
      setReburning(false)
    }
  }

  if (!isOpen || !job || typeof document === "undefined") return null

  const isModified = JSON.stringify(subtitles) !== JSON.stringify(originalSubtitles)

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-3 sm:p-5 lg:p-7 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex h-[92vh] w-[min(1360px,96vw)] max-w-none flex-col overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-3.5 shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-xs">
              <FileText className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  字幕人工校验与修正
                </h3>
                <span className="rounded-full bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40">
                  {subtitles.length} 条字幕
                </span>
                {isModified && (
                  <span className="rounded-full bg-amber-50 dark:bg-amber-950/60 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-200/60 flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    有未烧录的修改
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                边听边改：AI 识别可能会有同音错别字或专有名词偏差，修正后点击右下角「保存并重新烧录导出」即可生成完美成片。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* 2. Main Body: 2 Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-0 flex-1 overflow-hidden bg-slate-50/60 dark:bg-slate-950/40">
          {/* Left Column: Video Preview & Sync Player (5 cols) */}
          <div className="lg:col-span-5 flex flex-col justify-between border-r border-slate-200/80 dark:border-slate-800 p-5 overflow-y-auto bg-slate-900/95 dark:bg-slate-950 text-white">
            <div className="flex flex-col gap-3.5 max-w-[420px] mx-auto w-full">
              {/* Video Player Canvas (9:16) */}
              <div className="relative aspect-[9/16] max-h-[52vh] w-full mx-auto rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-white/10 shadow-xl group/video">
                {job.output_url ? (
                  <video
                    ref={videoRef}
                    src={job.output_url}
                    playsInline
                    className="size-full object-contain"
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onClick={handlePlayPause}
                  />
                ) : (
                  <div className="text-slate-400 text-xs">无视频流</div>
                )}

                {/* Floating Active Subtitle Banner */}
                {activeSubIndex >= 0 && subtitles[activeSubIndex] && (
                  <div className="absolute bottom-4 inset-x-2 flex justify-center pointer-events-none z-20">
                    <div className="bg-black/90 backdrop-blur-md text-amber-300 font-bold text-xs sm:text-sm px-4 py-2 rounded-xl border border-amber-300/40 shadow-2xl text-center max-w-[96%] break-words whitespace-pre-wrap leading-relaxed animate-in fade-in zoom-in-95">
                      {subtitles[activeSubIndex].text}
                    </div>
                  </div>
                )}
              </div>

              {/* Player Scrubber & Time */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                  <span className="font-semibold text-blue-400">{formatTime(currentTime)}</span>
                  <span className="text-slate-500">{formatTime(duration)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.05}
                  value={currentTime}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    setCurrentTime(val)
                    if (videoRef.current) videoRef.current.currentTime = val
                  }}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Playback Controls Row */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStepTime(-2)}
                    className="h-8.5 w-8.5 p-0 rounded-xl bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
                    title="倒退 2 秒"
                  >
                    -2s
                  </Button>
                  <Button
                    size="sm"
                    onClick={handlePlayPause}
                    className="h-8.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer shadow-sm"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="size-4 mr-1.5 fill-current" />
                        暂停
                      </>
                    ) : (
                      <>
                        <Play className="size-4 mr-1.5 fill-current ml-0.5" />
                        播放
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStepTime(2)}
                    className="h-8.5 w-8.5 p-0 rounded-xl bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
                    title="快进 2 秒"
                  >
                    +2s
                  </Button>
                </div>

                {/* Speed selector */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
                  {[
                    { rate: 0.75, label: "0.75x 慢听" },
                    { rate: 1.0, label: "1.0x" },
                    { rate: 1.25, label: "1.25x" },
                  ].map((item) => (
                    <button
                      key={item.rate}
                      type="button"
                      onClick={() => handleRateChange(item.rate)}
                      className={cn(
                        "px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer",
                        playbackRate === item.rate
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-400 hover:text-slate-200"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Hint Box */}
            <div className="mt-4 rounded-xl bg-slate-800/60 border border-slate-700/60 p-3 text-[11px] text-slate-400 flex items-start gap-2 max-w-[420px] mx-auto w-full">
              <Volume2 className="size-4 text-blue-400 shrink-0 mt-0.5" />
              <span>
                点击右侧任意字幕条目，播放器将<strong>毫秒级跳转</strong>到该句发音处；修改文字后点击右下角重新烧录即可。
              </span>
            </div>
          </div>

          {/* Right Column: Editable Subtitles Timeline (7 cols) */}
          <div className="lg:col-span-7 flex flex-col min-h-0 overflow-hidden p-5">
            {/* Toolbar Row */}
            <div className="flex items-center justify-between pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddSegment}
                  className="h-8 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  <Plus className="size-3.5 mr-1" />
                  添加字幕行
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRemovePunctuation}
                  className="h-8 text-xs font-semibold rounded-xl cursor-pointer"
                  title="去除末尾逗号/句号/问号等"
                >
                  <Sparkles className="size-3.5 mr-1 text-purple-600" />
                  去除末尾标点
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowReplace(!showReplace)}
                  className={cn(
                    "h-8 text-xs font-semibold rounded-xl border transition-colors cursor-pointer",
                    showReplace ? "bg-blue-50 border-blue-400 text-blue-700" : ""
                  )}
                >
                  <Search className="size-3.5 mr-1" />
                  查找与替换
                </Button>
              </div>

              {isModified && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleResetToOriginal}
                  className="h-8 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  <RotateCcw className="size-3 mr-1" />
                  还原初始识别
                </Button>
              )}
            </div>

            {/* Find & Replace Strip */}
            {showReplace && (
              <div className="mb-3 p-3 rounded-2xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                <input
                  type="text"
                  placeholder="查找原词 (如: 连衣裤)"
                  value={findWord}
                  onChange={(e) => setFindWord(e.target.value)}
                  className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">➔</span>
                <input
                  type="text"
                  placeholder="替换为 (如: 连衣裙)"
                  value={replaceWord}
                  onChange={(e) => setReplaceWord(e.target.value)}
                  className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                />
                <Button
                  size="sm"
                  onClick={handleExecuteReplace}
                  disabled={!findWord}
                  className="h-7.5 px-3 text-xs font-semibold bg-blue-600 text-white rounded-lg cursor-pointer"
                >
                  全部替换
                </Button>
              </div>
            )}

            {/* Subtitles Scrollable List */}
            <div
              ref={rowsContainerRef}
              className="flex-1 overflow-y-auto pr-1.5 space-y-2.5 min-h-0"
            >
              {loading ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                  <Loader2 className="size-6 animate-spin text-blue-500" />
                  正在读取口播对齐字幕…
                </div>
              ) : error ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2 text-rose-500 text-xs">
                  <AlertCircle className="size-6" />
                  <span>{error}</span>
                  <Button size="sm" variant="outline" onClick={() => loadSubtitles(job.id)}>
                    重试
                  </Button>
                </div>
              ) : subtitles.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400 text-xs">
                  <FileText className="size-6 text-slate-300" />
                  <span>暂无字幕数据</span>
                  <Button size="sm" variant="outline" onClick={handleAddSegment}>
                    点击添加第一句字幕
                  </Button>
                </div>
              ) : (
                subtitles.map((seg, idx) => {
                  const isActive = idx === activeSubIndex
                  const segDur = (seg.end - seg.start).toFixed(1)

                  return (
                    <div
                      key={seg.id || idx}
                      data-sub-idx={idx}
                      className={cn(
                        "group relative flex items-start gap-3 p-3 rounded-2xl border transition-all duration-200",
                        isActive
                          ? "bg-blue-50/90 dark:bg-blue-950/50 border-blue-500 shadow-sm ring-2 ring-blue-500/20"
                          : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300"
                      )}
                    >
                      {/* Left: Index & Seek Button */}
                      <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleSeekToSegment(seg)}
                          className={cn(
                            "flex size-7 items-center justify-center rounded-xl transition-colors cursor-pointer shadow-2xs",
                            isActive
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:bg-blue-50 group-hover:text-blue-600"
                          )}
                          title="跳转并播放此段"
                        >
                          <Play className="size-3 fill-current ml-0.5" />
                        </button>
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          #{idx + 1}
                        </span>
                      </div>

                      {/* Middle: Timestamp & Editable Text */}
                      <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span className="flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300">
                            <Clock className="size-3 text-slate-400" />
                            {formatTime(seg.start)} ➔ {formatTime(seg.end)}
                          </span>
                          <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded text-[10px]">
                            {segDur}s
                          </span>
                        </div>

                        {/* Text input */}
                        <textarea
                          rows={seg.text.length > 25 ? 2 : 1}
                          value={seg.text}
                          onChange={(e) => handleTextChange(idx, e.target.value)}
                          placeholder="输入或修正口播字幕…"
                          className={cn(
                            "w-full text-xs sm:text-sm font-medium px-2.5 py-1.5 rounded-xl border transition-all outline-none resize-none leading-relaxed",
                            isActive
                              ? "border-blue-400 bg-white dark:bg-slate-950 text-blue-950 dark:text-blue-100 focus:ring-2 focus:ring-blue-500/20"
                              : "border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40 text-slate-800 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-950 focus:border-slate-400"
                          )}
                        />
                      </div>

                      {/* Right: Delete Action */}
                      <button
                        type="button"
                        onClick={() => handleDeleteSegment(idx)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer shrink-0"
                        title="删除该行字幕"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* 3. Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-6 py-3.5 bg-slate-50/70 dark:bg-slate-900/70 shrink-0">
          <div className="flex items-center gap-2">
            <a
              href={exportJobSrtUrl(job.id)}
              download={`kuafa_${job.id}.srt`}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <Download className="size-3.5" />
              导出标准 SRT 字幕文件
            </a>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 px-4 text-xs font-semibold rounded-xl cursor-pointer"
            >
              关闭
            </Button>

            <Button
              onClick={handleReburn}
              disabled={reburning || subtitles.length === 0}
              className="h-9 px-5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all cursor-pointer"
            >
              {reburning ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  正在重新烧录 ASS 字幕…
                </>
              ) : (
                <>
                  <WandSparkles className="size-4 mr-1.5" />
                  保存并重新烧录导出
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
