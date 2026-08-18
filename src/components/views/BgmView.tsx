import { useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  Dices,
  Download,
  FileAudio,
  Headphones,
  Layers,
  Loader2,
  Music,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
  Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  deleteBgmFile,
  fetchBgmFiles,
  renameBgmFile,
  uploadBgm,
  type BgmItem,
} from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { cn } from "@/lib/utils"

interface BgmViewProps {
  onGoBatch?: () => void
  onGoGenerator?: () => void
}

export function BgmView({ onGoBatch, onGoGenerator }: BgmViewProps) {
  const { notify } = useNotifications()

  const [bgmList, setBgmList] = useState<BgmItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null)

  // Audio player state
  const [playingTrack, setPlayingTrack] = useState<BgmItem | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [isMuted, setIsMuted] = useState(false)

  // Renaming state
  const [editingFilename, setEditingFilename] = useState<string | null>(null)
  const [editTitleInput, setEditTitleInput] = useState("")

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadBgm = useCallback(async () => {
    try {
      setLoading(true)
      const list = await fetchBgmFiles()
      setBgmList(list)
    } catch (err) {
      notify({
        title: "加载音乐库失败",
        message: err instanceof Error ? err.message : "无法获取背景音乐列表",
        type: "error",
      })
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void loadBgm()
  }, [loadBgm])

  // Audio element event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => setDuration(audio.duration || 0)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("play", handlePlay)
    audio.addEventListener("pause", handlePause)

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("play", handlePlay)
      audio.removeEventListener("pause", handlePause)
    }
  }, [])

  // Update volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume
    }
  }, [volume, isMuted])

  const handleTogglePlay = (track: BgmItem) => {
    if (playingTrack?.filename === track.filename) {
      if (isPlaying) {
        audioRef.current?.pause()
      } else {
        void audioRef.current?.play()
      }
    } else {
      setPlayingTrack(track)
      if (audioRef.current) {
        audioRef.current.src = track.url
        audioRef.current.load()
        void audioRef.current.play()
      }
    }
  }

  const handleSeek = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds
      setCurrentTime(seconds)
    }
  }

  const handleFilesUpload = async (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter((f) => {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase()
      return [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mp4"].includes(ext)
    })

    if (audioFiles.length === 0) {
      notify({
        title: "格式不符",
        message: "仅支持上传 mp3, wav, m4a, aac, flac, ogg 等音频格式",
        type: "error",
      })
      return
    }

    setUploadingCount(audioFiles.length)
    let successCount = 0

    for (const file of audioFiles) {
      try {
        await uploadBgm(file)
        successCount++
      } catch (err) {
        notify({
          title: `上传失败: ${file.name}`,
          message: err instanceof Error ? err.message : "无法保存音频",
          type: "error",
        })
      }
    }

    setUploadingCount(0)
    if (successCount > 0) {
      notify({
        title: "上传完成",
        message: `成功添加 ${successCount} 首音乐到背景音乐库！智能成片时将自动加载使用。`,
        type: "success",
      })
      void loadBgm()
    }
  }

  const handleDelete = async (track: BgmItem) => {
    if (!window.confirm(`确定从背景音乐库中删除「${track.title || track.filename}」吗？`)) {
      return
    }

    if (playingTrack?.filename === track.filename) {
      audioRef.current?.pause()
      setPlayingTrack(null)
      setIsPlaying(false)
    }

    setDeletingFilename(track.filename)
    try {
      await deleteBgmFile(track.filename)
      setBgmList((prev) => prev.filter((item) => item.filename !== track.filename))
      notify({
        title: "删除成功",
        message: `已移除「${track.title || track.filename}」`,
        type: "info",
      })
    } catch (err) {
      notify({
        title: "删除失败",
        message: err instanceof Error ? err.message : "无法删除该音频",
        type: "error",
      })
    } finally {
      setDeletingFilename(null)
    }
  }

  const handleStartRename = (track: BgmItem) => {
    setEditingFilename(track.filename)
    setEditTitleInput(track.title || track.filename.replace(/\.[^/.]+$/, ""))
  }

  const handleSaveRename = async (filename: string) => {
    if (!editTitleInput.trim()) {
      setEditingFilename(null)
      return
    }
    try {
      const updated = await renameBgmFile(filename, editTitleInput.trim())
      setBgmList((prev) =>
        prev.map((item) => (item.filename === filename ? updated : item))
      )
      if (playingTrack?.filename === filename) {
        setPlayingTrack(updated)
      }
      notify({
        title: "重命名成功",
        message: `已更名为「${updated.title}」`,
        type: "success",
      })
    } catch (err) {
      notify({
        title: "重命名失败",
        message: err instanceof Error ? err.message : "无法重命名",
        type: "error",
      })
    } finally {
      setEditingFilename(null)
    }
  }

  const filteredList = bgmList.filter((track) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      track.title.toLowerCase().includes(q) ||
      track.filename.toLowerCase().includes(q)
    )
  })

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return "00:00"
    const mins = Math.floor(secs / 60)
    const rem = Math.floor(secs % 60)
    return `${mins.toString().padStart(2, "0")}:${rem.toString().padStart(2, "0")}`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pr-2 pb-16">
      {/* Hidden Global Audio Element */}
      <audio ref={audioRef} />

      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60 shadow-xs">
            <Music className="size-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                背景音乐库 (BGM Library)
              </h2>
              <span className="rounded-full bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 text-xs font-mono font-bold text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-900/60">
                共 {bgmList.length} 首音乐
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-2xl">
              支持上传或直接拖入各类带货 BGM、卡点配乐与环境白噪音。在<strong>「批量制作」</strong>与<strong>「智能混剪」</strong>中，系统将自动加载并智能匹配音乐库曲目。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadBgm}
            disabled={loading}
            className="h-9 px-3 text-xs font-medium border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer gap-1.5"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>

          {onGoGenerator && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onGoGenerator}
              className="h-9 px-3 text-xs font-semibold border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer gap-1.5"
            >
              <WandSparkles className="size-3.5 text-blue-600" />
              智能混剪
            </Button>
          )}

          {onGoBatch && (
            <Button
              type="button"
              size="sm"
              onClick={onGoBatch}
              className="h-9 px-3.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl cursor-pointer gap-1.5 shadow-xs border-none"
            >
              <Layers className="size-3.5" />
              前往批量制作
            </Button>
          )}
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (e.dataTransfer.files) {
            void handleFilesUpload(e.dataTransfer.files)
          }
        }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer",
          isDragging
            ? "border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 ring-4 ring-blue-500/20 scale-[0.99]"
            : "border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-slate-800/40 shadow-xs"
        )}
      >
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.mp4"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              void handleFilesUpload(e.target.files)
            }
            e.target.value = ""
          }}
        />

        <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 mb-3 group-hover:scale-110 transition-transform shadow-xs">
          {uploadingCount > 0 ? (
            <Loader2 className="size-7 animate-spin text-blue-600" />
          ) : (
            <Upload className="size-7 text-blue-600" />
          )}
        </div>

        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
          {uploadingCount > 0
            ? `正在上传 ${uploadingCount} 首音乐…`
            : "点击或将音频文件拖拽至此上传"}
        </h3>
        <p className="mt-1 text-xs text-slate-400 max-w-md">
          支持 MP3、WAV、M4A、AAC、FLAC、OGG 及带音频的 MP4 格式，支持批量拖放多首音乐
        </p>

        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/90 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
            <Zap className="size-3 text-amber-500" />
            自动时长侦测
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/90 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
            <Repeat className="size-3 text-blue-500" />
            出片自动循环淡入淡出
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/90 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
            <Dices className="size-3 text-indigo-500" />
            批量防重轮播分配
          </span>
        </div>
      </div>

      {/* Floating / Active Audio Player Bar */}
      {playingTrack && (
        <div className="sticky top-0 z-30 flex items-center justify-between gap-4 rounded-2xl border border-blue-200/80 dark:border-blue-900/80 bg-slate-900 text-white p-4 shadow-xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => handleTogglePlay(playingTrack)}
              className="flex size-10 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-all cursor-pointer shrink-0 shadow-md"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
            </button>

            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate max-w-[200px] md:max-w-md">
                  {playingTrack.title || playingTrack.filename}
                </span>
                <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-mono text-blue-300">
                  正在试听
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 mt-0.5">
                {formatTime(currentTime)} / {formatTime(duration || playingTrack.duration || 0)}
              </span>
            </div>
          </div>

          {/* Scrubber Slider */}
          <div className="hidden sm:flex flex-1 items-center gap-3 max-w-md mx-2">
            <input
              type="range"
              min={0}
              max={duration || playingTrack.duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => handleSeek(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer rounded-lg bg-slate-700 accent-blue-500"
            />
          </div>

          {/* Volume and Close */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                className="text-slate-400 hover:text-white cursor-pointer"
                title={isMuted ? "取消静音" : "静音"}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="size-4 text-rose-400" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value))
                  setIsMuted(false)
                }}
                className="w-18 h-1.5 bg-slate-700 rounded-lg accent-blue-500 cursor-pointer"
              />
            </div>

            <a
              href={playingTrack.url}
              download={playingTrack.filename}
              className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:text-white hover:bg-white/20 transition-colors cursor-pointer"
              title="下载原音频"
            >
              <Download className="size-3.5" />
            </a>

            <button
              type="button"
              onClick={() => {
                audioRef.current?.pause()
                setPlayingTrack(null)
                setIsPlaying(false)
              }}
              className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:text-white hover:bg-white/20 transition-colors cursor-pointer"
              title="关闭试听"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Music Library List */}
      <div className="flex flex-col gap-4">
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <Input
              type="text"
              placeholder="搜索音乐名称或文件名…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              已展示 <strong>{filteredList.length}</strong> / {bgmList.length} 首歌曲
            </span>
          </div>
        </div>

        {/* Music Tracks Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <Loader2 className="size-8 animate-spin text-blue-600" />
            <span className="text-xs">加载背景音乐库中…</span>
          </div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 p-8">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 mb-3 shadow-xs">
              <FileAudio className="size-7" />
            </div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              {searchQuery ? "未找到符合搜索条件的音乐" : "背景音乐库暂无音乐（默认无内置音乐）"}
            </h4>
            <p className="mt-1 text-xs text-slate-400 max-w-sm">
              {searchQuery
                ? "请尝试更换搜索关键词"
                : "系统默认不包含内置音乐。拖拽或上传您的带货 BGM、卡点配乐后，成片时将自动加载使用！"}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl cursor-pointer gap-1.5"
            >
              <Upload className="size-3.5" />
              立即上传第一首音乐
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredList.map((track) => {
              const isThisPlaying = playingTrack?.filename === track.filename && isPlaying
              const isThisSelected = playingTrack?.filename === track.filename
              const isDeleting = deletingFilename === track.filename
              const isEditing = editingFilename === track.filename

              return (
                <div
                  key={track.filename}
                  className={cn(
                    "group relative flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200",
                    isThisSelected
                      ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 shadow-md ring-1 ring-blue-500/20"
                      : "border-black/[0.06] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div>
                    {/* Top Row: Icon + Track Title + Play/Pause */}
                    <div className="flex items-start justify-between gap-2.5 mb-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePlay(track)}
                          className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all cursor-pointer shadow-xs",
                            isThisPlaying
                              ? "bg-blue-600 text-white shadow-blue-500/30 scale-105"
                              : "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white"
                          )}
                          title={isThisPlaying ? "暂停试听" : "播放试听"}
                        >
                          {isThisPlaying ? (
                            <Pause className="size-4.5" />
                          ) : (
                            <Play className="size-4.5 ml-0.5" />
                          )}
                        </button>

                        <div className="flex flex-col min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editTitleInput}
                                onChange={(e) => setEditTitleInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(track.filename)
                                  if (e.key === "Escape") setEditingFilename(null)
                                }}
                                autoFocus
                                className="h-6 w-full rounded border border-blue-500 bg-white dark:bg-slate-800 px-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveRename(track.filename)}
                                className="p-1 text-emerald-600 hover:text-emerald-700 cursor-pointer"
                              >
                                <Check className="size-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span
                                className="truncate text-xs font-bold text-slate-900 dark:text-slate-100"
                                title={track.title || track.filename}
                              >
                                {track.title || track.filename}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleStartRename(track)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-blue-600 transition-opacity cursor-pointer"
                                title="重命名曲目"
                              >
                                <Pencil className="size-3" />
                              </button>
                            </div>
                          )}

                          <span className="truncate font-mono text-[10px] text-slate-400 mt-0.5">
                            {track.filename}
                          </span>
                        </div>
                      </div>

                      <span className="shrink-0 rounded-md bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-blue-600 dark:text-blue-400 border border-blue-200/60 uppercase">
                        {track.filename.split(".").pop() || "audio"}
                      </span>
                    </div>

                    {/* Metadata Strip: Duration, File Size, Created Date */}
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 py-1.5 border-t border-slate-100 dark:border-slate-800">
                      <span className="flex items-center gap-1 font-mono font-medium text-slate-600 dark:text-slate-300">
                        <Headphones className="size-3 text-slate-400" />
                        {track.duration_label || "--:--"}
                      </span>
                      <span>·</span>
                      <span className="font-mono">{formatFileSize(track.size_bytes)}</span>
                      {track.created_at && (
                        <>
                          <span>·</span>
                          <span className="text-[10px]">{track.created_at}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Bottom Action Footer */}
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800 mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTogglePlay(track)}
                      className="h-7 text-xs px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-lg cursor-pointer gap-1"
                    >
                      {isThisPlaying ? (
                        <>
                          <Pause className="size-3" /> 暂停
                        </>
                      ) : (
                        <>
                          <Play className="size-3" /> 试听
                        </>
                      )}
                    </Button>

                    <div className="flex items-center gap-1">
                      <a
                        href={track.url}
                        download={track.filename}
                        className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 transition-colors cursor-pointer"
                        title="下载原音频"
                      >
                        <Download className="size-3.5" />
                      </a>

                      {!track.is_default && (
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => handleDelete(track)}
                          className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 hover:text-rose-600 transition-colors cursor-pointer"
                          title="删除此背景音乐"
                        >
                          {isDeleting ? (
                            <Loader2 className="size-3.5 animate-spin text-rose-500" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
