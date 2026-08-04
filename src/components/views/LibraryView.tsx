import { useMemo, useRef, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Film,
  FolderPlus,
  Loader2,
  Pencil,
  Play,
  Settings2,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useMaterials } from "@/hooks/use-materials"
import { getMaterialVideoUrl, type Material } from "@/lib/api"
import { cn } from "@/lib/utils"

type LibraryViewProps = {
  onGoGenerator?: () => void
}

function formatMiddleTruncate(filename: string, startChars = 6, endChars = 5) {
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

export function LibraryView({ onGoGenerator }: LibraryViewProps) {
  const {
    groups,
    selectedIds,
    activeGroupId,
    settings,
    loading,
    error,
    setActiveGroupId,
    toggleSelect,
    selectGroup,
    selectAll,
    clearSelection,
    createGroup,
    renameGroup,
    upload,
    saveMaterialsDir,
    resetMaterialsDir,
  } = useMaterials()

  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [dirDraft, setDirDraft] = useState("")
  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [previewItem, setPreviewItem] = useState<Material | null>(null)

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  )

  const previewIndex = useMemo(() => {
    if (!previewItem || !activeGroup) return -1
    return activeGroup.materials.findIndex((m) => m.id === previewItem.id)
  }, [previewItem, activeGroup])

  const handlePrevMaterial = () => {
    if (!activeGroup || previewIndex <= 0) return
    setPreviewItem(activeGroup.materials[previewIndex - 1])
  }

  const handleNextMaterial = () => {
    if (
      !activeGroup ||
      previewIndex < 0 ||
      previewIndex >= activeGroup.materials.length - 1
    )
      return
    setPreviewItem(activeGroup.materials[previewIndex + 1])
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    if (!activeGroupId) {
      alert("请先创建或选择一个素材组")
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await upload(file, activeGroupId)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(false)
    }
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim()
    if (!name) return
    setBusy(true)
    try {
      await createGroup(name)
      setNewGroupName("")
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败")
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(groupId: string) {
    const name = renameValue.trim()
    if (!name) return
    setBusy(true)
    try {
      await renameGroup(groupId, name)
      setRenamingId(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : "重命名失败")
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveDir() {
    const dir = dirDraft.trim() || settings?.materials_dir || ""
    if (!dir) return
    setBusy(true)
    try {
      await saveMaterialsDir(dir)
      setShowSettings(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存目录失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-6">
      {/* 1. Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs md:text-[13px] text-slate-500 dark:text-slate-400 font-normal leading-relaxed">
            素材按「组」管理：一级目录是组名（如某主播今日场次），组内放视频切片。
          </p>
          {settings ? (
            <p className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500" title={settings.materials_dir}>
              当前输入目录：{settings.materials_dir}
              {settings.is_custom ? "（自定义）" : "（默认）"}
            </p>
          ) : null}
        </div>
        
        {/* Right Controls Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
            onClick={() => {
              setDirDraft(settings?.materials_dir ?? "")
              setShowSettings((v) => !v)
            }}
          >
            <Settings2 className="size-3.5 mr-1 text-slate-500" />
            输入目录
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
            onClick={selectAll}
            disabled={!activeGroup}
          >
            全选本组
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
            onClick={clearSelection}
          >
            清空勾选
          </Button>
          {onGoGenerator ? (
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm hover:shadow active:scale-[0.98] transition-all border-none rounded-md px-4 py-1.5 text-xs cursor-pointer"
              onClick={onGoGenerator}
              disabled={!selectedIds.length}
            >
              去混剪 ({selectedIds.length})
            </Button>
          ) : null}
        </div>
      </div>

      {showSettings ? (
        <Card className="glass-panel border-border/50 relative z-10">
          <CardHeader className="py-3 px-4 border-b border-border/40">
            <CardTitle className="text-sm font-semibold text-[#111827] dark:text-slate-100">素材库输入目录</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              默认：
              <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {settings?.default_materials_dir}
              </code>
              。目录下每个子文件夹 = 一个组，子文件夹内的视频 = 该组素材。
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={dirDraft}
                onChange={(e) => setDirDraft(e.target.value)}
                placeholder="绝对路径，例如 /Users/…/kuafa/backend/data/input"
                className="min-w-[280px] flex-1 text-xs"
              />
              <Button size="sm" disabled={busy} onClick={() => void handleSaveDir()}>
                保存
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void resetMaterialsDir()}
              >
                恢复默认
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Joined Input Group for New Group Creation */}
      <div className="flex items-center -space-x-px max-w-sm w-full shadow-2xs rounded-lg overflow-hidden">
        <Input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="新建组名，例如：主播小美-今日专场"
          className="rounded-l-lg rounded-r-none border-slate-200 dark:border-slate-800 focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-blue-500 text-xs h-9 bg-white dark:bg-slate-900"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreateGroup()
          }}
        />
        <Button
          size="sm"
          disabled={busy || !newGroupName.trim()}
          onClick={() => void handleCreateGroup()}
          className="rounded-l-none rounded-r-lg h-9 bg-blue-600 hover:bg-blue-700 border-blue-600 hover:border-blue-700 text-white shrink-0 px-4 text-xs font-medium cursor-pointer shadow-2xs disabled:opacity-50 transition-colors"
        >
          <FolderPlus className="size-3.5 mr-1" />
          新建
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">加载失败：{error}</p> : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-slate-400 text-sm">
          <Loader2 className="mr-2 size-5 animate-spin text-slate-500" />
          正在读取素材组…
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[280px_1fr]">
          {/* 2. Group List */}
          <Card className="h-fit max-h-full overflow-y-auto border-slate-200/80 dark:border-slate-800 shadow-xs bg-card">
            <CardHeader className="py-3 px-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">素材组</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 p-2">
              {!groups.length ? (
                <p className="p-3 text-xs text-slate-400 text-center">
                  暂无组。可新建组，或在输入目录下创建子文件夹并放入视频。
                </p>
              ) : (
                groups.map((group) => {
                  const active = group.id === activeGroupId
                  return (
                    <div
                      key={group.id}
                      className={cn(
                        "group/group relative flex items-center justify-between rounded-lg p-2.5 transition-all duration-150 border border-transparent",
                        active
                          ? "bg-blue-50/80 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium shadow-2xs border-blue-100/80 dark:border-blue-900/40"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      {renamingId === group.id ? (
                        <div className="flex w-full flex-col gap-2 p-1">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            autoFocus
                            className="h-8 text-xs"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs px-2.5"
                              onClick={() => void handleRename(group.id)}
                            >
                              保存
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2.5"
                              onClick={() => setRenamingId(null)}
                            >
                              取消
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="w-full text-left min-w-0 pr-6 cursor-pointer"
                          onClick={() => {
                            setActiveGroupId(group.id)
                            selectGroup(group.id)
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={cn("truncate text-xs", active ? "font-semibold text-blue-900 dark:text-blue-200" : "text-slate-700 dark:text-slate-300 group-hover/group:text-slate-900 dark:group-hover/group:text-slate-100")}>
                              {group.name}
                            </span>
                            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors", active ? "bg-blue-100/90 text-blue-700 dark:bg-blue-900/80 dark:text-blue-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover/group:bg-slate-200/80 dark:group-hover/group:bg-slate-700")}>
                              {group.material_count}
                            </span>
                          </div>
                          <p className={cn("mt-0.5 truncate text-[11px]", active ? "text-blue-600/70 dark:text-blue-400/70" : "text-slate-400 dark:text-slate-500")} title={group.path}>
                            {group.path}
                          </p>
                        </button>
                      )}
                      {renamingId !== group.id ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-2 top-2.5 size-6 opacity-0 group-hover/group:opacity-100 transition-opacity hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                          title="重命名组"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenamingId(group.id)
                            setRenameValue(group.name)
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <div className="flex min-h-0 flex-col gap-4">
            {/* 3. Upload Drop Zone */}
            <div
              className={cn(
                "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-6 text-center transition-all duration-200 group bg-white dark:bg-slate-900 shadow-xs",
                isDragOver
                  ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 ring-2 ring-blue-500/20 scale-[0.99]"
                  : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm"
              )}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragOver(true)
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                void onFiles(e.dataTransfer.files)
              }}
            >
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                multiple
                accept="video/mp4,video/quicktime,video/*"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-blue-50/80 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 border border-blue-100/80 dark:border-blue-900/50 transition-transform group-hover:scale-110 shadow-2xs">
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-blue-600" />
                ) : (
                  <CloudUpload className="size-5 stroke-[1.75]" />
                )}
              </div>
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                {activeGroup
                  ? `点击或拖拽上传素材到「${activeGroup.name}」`
                  : "请先选择或新建素材组"}
              </h3>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                支持 MP4 / MOV 等常见切片格式；或直接拷贝至对应本地目录
              </p>
            </div>

            {/* 4. Video Grid Cards */}
            <div className="flex-1 overflow-y-auto pb-4">
              {!activeGroup ? (
                <p className="py-10 text-center text-sm text-slate-400">
                  左侧选择一个组以查看素材
                </p>
              ) : !activeGroup.materials.length ? (
                <p className="py-10 text-center text-sm text-slate-400">
                  本组暂无素材
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {activeGroup.materials.map((item, idx) => {
                    const selected = selectedIds.includes(item.id)
                    const pieceName = `片段 ${String(idx + 1).padStart(2, "0")}`
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "group relative flex flex-col cursor-pointer rounded-2xl border bg-white dark:bg-slate-900 p-2.5 transition-all duration-200 ease-out select-none",
                          selected
                            ? "border-blue-500 dark:border-blue-500/80 shadow-[0_4px_20px_-2px_rgba(37,99,235,0.16)] dark:shadow-[0_4px_20px_-2px_rgba(59,130,246,0.25)] ring-1 ring-blue-500/20"
                            : "border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md"
                        )}
                        onClick={() => toggleSelect(item.id)}
                      >
                        {/* Video Thumbnail Canvas - Clean Framed Style */}
                        <div className="relative h-32 w-full overflow-hidden rounded-xl bg-slate-950 flex items-center justify-center group/thumb">
                          {item.thumb_url ? (
                            <img
                              src={item.thumb_url}
                              alt=""
                              className={cn(
                                "size-full object-cover transition-all duration-300 group-hover/thumb:scale-105",
                                selected ? "opacity-95" : "opacity-90 group-hover/thumb:opacity-100"
                              )}
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center text-xs text-slate-400">
                              无预览
                            </div>
                          )}

                          {/* Selected Overlay - Super Light 5% Theme Tint */}
                          {selected ? (
                            <div className="absolute inset-0 bg-blue-600/5 pointer-events-none" />
                          ) : null}

                          {/* Hover Overlay & Play Icon */}
                          <div
                            className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-200 cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreviewItem(item)
                            }}
                          >
                            <div className="flex size-9 items-center justify-center rounded-full bg-white/20 backdrop-blur-md border border-white/40 text-white shadow-lg transform scale-90 group-hover/thumb:scale-105 transition-all duration-200 hover:bg-white/40 hover:scale-110">
                              <Play className="size-4 fill-white ml-0.5" />
                            </div>
                          </div>

                          {/* Refined Duration Badge with Soft Backdrop Blur */}
                          <span className="absolute right-2.5 bottom-2.5 rounded-md bg-black/60 backdrop-blur-md border border-white/15 px-2 py-0.5 text-[10px] font-mono font-medium text-white/95 tracking-tight shadow-xs pointer-events-none">
                            {item.duration_label}
                          </span>

                          {/* Floating Checkbox Icon */}
                          <div
                            className={cn(
                              "absolute top-2.5 left-2.5 flex size-4.5 items-center justify-center rounded-full transition-all duration-200 ease-out shadow-sm",
                              selected
                                ? "bg-blue-600 text-white opacity-100 scale-100 ring-2 ring-white dark:ring-slate-900"
                                : "border-1.5 border-white/80 bg-black/25 backdrop-blur-xs text-white opacity-0 group-hover:opacity-100 hover:scale-110 hover:border-white hover:bg-black/45"
                            )}
                          >
                            {selected ? (
                              <Check className="size-3 stroke-[2] stroke-white" />
                            ) : null}
                          </div>
                        </div>

                        {/* Card Info Content */}
                        <div className="pt-2 px-0.5 pb-0.5 flex flex-col justify-between">
                          <h4
                            className="truncate text-xs font-bold text-slate-800 dark:text-slate-100"
                            title={item.filename}
                          >
                            {pieceName}
                          </h4>
                          <div className="mt-1 flex items-center justify-between text-[11px]">
                            <span
                              className="truncate max-w-[115px] font-medium text-slate-500 dark:text-slate-400"
                              title={item.filename}
                            >
                              {formatMiddleTruncate(item.filename)}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-1.5 py-0.5 rounded">
                              {(item.size_bytes / 1024 / 1024).toFixed(1)} MB
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
        </div>
      )}

      {/* Full-Featured Video Player Modal - Light Theme */}
      {previewItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 md:p-8 animate-in fade-in duration-200"
          onClick={() => setPreviewItem(null)}
        >
          {/* Modal Box Container */}
          <div
            className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Bar */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 px-6 py-4 bg-white/90 dark:bg-slate-900/90">
              <div className="flex items-center gap-3.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50/90 text-blue-600 border border-blue-100 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-900/50 shadow-2xs">
                  <Film className="size-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    {`片段 ${String(previewIndex + 1).padStart(2, "0")}`}
                    <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                      ({previewItem.filename})
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                    <span>{previewItem.duration_label}</span>
                    <span>•</span>
                    <span>{(previewItem.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                    {previewItem.width && previewItem.height ? (
                      <>
                        <span>•</span>
                        <span>
                          {previewItem.width}×{previewItem.height}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {/* Select Toggle in Modal */}
                <Button
                  size="sm"
                  className={cn(
                    "h-8.5 px-3 text-xs font-semibold rounded-xl transition-all shadow-2xs cursor-pointer",
                    selectedIds.includes(previewItem.id)
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  )}
                  onClick={() => toggleSelect(previewItem.id)}
                >
                  <Check className="mr-1.5 size-3.5" />
                  {selectedIds.includes(previewItem.id) ? "已选中素材" : "勾选素材"}
                </Button>

                {/* Close Button */}
                <button
                  type="button"
                  className="flex size-8.5 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  onClick={() => setPreviewItem(null)}
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Video Theater Screen - Pure Light White Background */}
            <div className="relative flex flex-1 items-center justify-center bg-slate-50/60 dark:bg-slate-950 p-4 md:p-6 min-h-[320px] max-h-[68vh] overflow-hidden group my-1 mx-3 rounded-2xl border border-slate-100 dark:border-slate-800/80">
              <video
                key={previewItem.id}
                src={getMaterialVideoUrl(previewItem.id)}
                controls
                autoPlay
                playsInline
                className="max-h-[62vh] w-auto max-w-full rounded-xl shadow-lg object-contain bg-white dark:bg-black"
              />

              {/* Prev Video Arrow Button */}
              {previewIndex > 0 ? (
                <button
                  type="button"
                  className="absolute left-6 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:scale-110 transition-all cursor-pointer z-10"
                  onClick={handlePrevMaterial}
                  title="上一个片段"
                >
                  <ChevronLeft className="size-6" />
                </button>
              ) : null}

              {/* Next Video Arrow Button */}
              {activeGroup && previewIndex < activeGroup.materials.length - 1 ? (
                <button
                  type="button"
                  className="absolute right-6 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:scale-110 transition-all cursor-pointer z-10"
                  onClick={handleNextMaterial}
                  title="下一个片段"
                >
                  <ChevronRight className="size-6" />
                </button>
              ) : null}
            </div>

            {/* Footer Control Info Bar */}
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 px-6 py-3 bg-slate-50/80 dark:bg-slate-900/80 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-4">
                <span>提示：原生播放控制器支持点击播放/暂停、拖拉进度条、放大全屏。</span>
              </div>
              <span className="font-mono font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-2 py-0.5 rounded-md shadow-2xs">
                {previewIndex + 1} / {activeGroup?.materials.length || 0}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
