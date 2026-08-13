import { useState, useEffect, useCallback, useMemo } from "react"
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  Copy,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"

export type ImageItem = {
  url: string
  title?: string
}

type ImagePreviewModalProps = {
  isOpen: boolean
  onClose: () => void
  images: (string | ImageItem)[]
  initialIndex?: number
}

export function ImagePreviewModal({
  isOpen,
  onClose,
  images,
  initialIndex = 0,
}: ImagePreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [copied, setCopied] = useState(false)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)

  // Normalize image list
  const normalizedImages: ImageItem[] = useMemo(() => {
    return images.map((img) =>
      typeof img === "string" ? { url: img } : img
    )
  }, [images])

  // 打开时重置视角状态：在渲染期间调整派生状态（React 推荐，替代 effect 同步）
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setCurrentIndex(Math.max(0, Math.min(initialIndex, images.length - 1)))
      setScale(1)
      setRotation(0)
    }
  }

  const currentImage = normalizedImages[currentIndex] || null

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1)
      setScale(1)
      setRotation(0)
    }
  }, [currentIndex])

  const handleNext = useCallback(() => {
    if (currentIndex < normalizedImages.length - 1) {
      setCurrentIndex((prev) => prev + 1)
      setScale(1)
      setRotation(0)
    }
  }, [currentIndex, normalizedImages.length])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") handlePrev()
      else if (e.key === "ArrowRight") handleNext()
      else if (e.key === "+") setScale((s) => Math.min(s + 0.25, 4))
      else if (e.key === "-") setScale((s) => Math.max(s - 0.25, 0.5))
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose, handlePrev, handleNext])

  if (!isOpen || !currentImage) return null

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 4))
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5))
  const handleResetZoom = () => {
    setScale(1)
    setRotation(0)
  }
  const handleRotate = () => setRotation((r) => (r + 90) % 360)

  const handleDownload = async () => {
    try {
      const response = await fetch(currentImage.url)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `cover_${currentIndex + 1}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(currentImage.url, "_blank")
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(currentImage.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 backdrop-blur-md animate-in fade-in-0 duration-200 select-none"
    >
      {/* Top Action Header */}
      <div className="flex w-full items-center justify-between px-6 py-4 text-white z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-mono font-medium tracking-wide">
            {currentIndex + 1} / {normalizedImages.length}
          </span>
          {currentImage.title ? (
            <span className="text-sm font-medium truncate max-w-md text-slate-200">
              {currentImage.title}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopyLink}
            className="text-slate-300 hover:text-white hover:bg-white/10 rounded-xl text-xs gap-1.5 h-9"
          >
            {copied ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "已复制" : "复制链接"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="text-slate-300 hover:text-white hover:bg-white/10 rounded-xl text-xs gap-1.5 h-9"
          >
            <Download className="size-4" />
            下载原图
          </Button>

          <div className="w-px h-5 bg-white/20 mx-1" />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-white/15 rounded-full size-9"
            title="关闭 (Esc)"
          >
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {/* Main Image Display Area */}
      <div className="relative flex flex-1 w-full items-center justify-center overflow-hidden p-6">
        {/* Left Nav Button */}
        {normalizedImages.length > 1 && currentIndex > 0 ? (
          <button
            type="button"
            onClick={handlePrev}
            className="absolute left-6 z-20 flex size-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-all hover:bg-white/25 hover:scale-105 active:scale-95 cursor-pointer shadow-lg border border-white/10"
            title="上一张 (←)"
          >
            <ChevronLeft className="size-7" />
          </button>
        ) : null}

        {/* Center Image */}
        <div
          className="flex items-center justify-center transition-transform duration-200 ease-out"
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
          }}
        >
          <img
            src={currentImage.url}
            alt={currentImage.title || "封面大图预览"}
            className="max-h-[80vh] max-w-[85vw] object-contain rounded-lg shadow-2xl transition-all pointer-events-auto"
            draggable={false}
          />
        </div>

        {/* Right Nav Button */}
        {normalizedImages.length > 1 && currentIndex < normalizedImages.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="absolute right-6 z-20 flex size-12 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-all hover:bg-white/25 hover:scale-105 active:scale-95 cursor-pointer shadow-lg border border-white/10"
            title="下一张 (→)"
          >
            <ChevronRight className="size-7" />
          </button>
        ) : null}
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="flex items-center gap-1.5 rounded-full bg-slate-900/90 border border-slate-700/80 px-4 py-2 text-white shadow-2xl backdrop-blur-md mb-6 z-10">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleZoomOut}
          disabled={scale <= 0.5}
          className="text-slate-300 hover:text-white hover:bg-white/15 rounded-full size-8 disabled:opacity-40"
          title="缩小 (-)"
        >
          <ZoomOut className="size-4" />
        </Button>

        <span className="px-2 text-xs font-mono font-bold min-w-[50px] text-center text-blue-400">
          {Math.round(scale * 100)}%
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleZoomIn}
          disabled={scale >= 4}
          className="text-slate-300 hover:text-white hover:bg-white/15 rounded-full size-8 disabled:opacity-40"
          title="放大 (+)"
        >
          <ZoomIn className="size-4" />
        </Button>

        <div className="w-px h-4 bg-slate-700 mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleResetZoom}
          className="text-slate-300 hover:text-white hover:bg-white/15 rounded-full size-8"
          title="重置缩放 100%"
        >
          <Maximize2 className="size-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleRotate}
          className="text-slate-300 hover:text-white hover:bg-white/15 rounded-full size-8"
          title="顺时针旋转 90°"
        >
          <RotateCw className="size-4" />
        </Button>
      </div>
    </div>
  )
}
