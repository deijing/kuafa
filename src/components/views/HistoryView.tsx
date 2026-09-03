import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Download, FileText, Loader2, RefreshCw, Sparkles, Square, Terminal, Timeline, Trash2, Wand2, Image as ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ImagePreviewModal } from "@/components/ui/image-preview-modal"
import { SubtitleProofreaderModal } from "@/components/ui/subtitle-proofreader-modal"
import { JobLogsModal } from "@/components/ui/job-logs-modal"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { deleteJob, fetchJobs, generateJobCovers, retryJob, stopJob, type Job } from "@/lib/api"
import { cn, formatProcessingDuration } from "@/lib/utils"
import { useMaterials } from "@/hooks/use-materials"
import { useNotifications } from "@/hooks/use-notifications"

function statusBadge(job: Job) {
  if (job.status === "succeeded") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
        已完成
      </span>
    )
  }
  if (job.status === "failed") {
    if (job.error === "canceled" || job.message?.includes("停止")) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/60 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
          <Square className="size-2.5 fill-current text-amber-500" />
          已停止
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-rose-50 dark:bg-rose-950/60 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/60">
        失败
      </span>
    )
  }
  if (job.status === "running" || job.status === "queued") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
        <Loader2 className="mr-1.5 size-3 animate-spin" />
        进行中 {job.progress}%
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
      {job.status}
    </span>
  )
}

export function HistoryView() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const { groups } = useMaterials()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [generatingCoverJobId, setGeneratingCoverJobId] = useState<string | null>(null)
  const [proofreadingJob, setProofreadingJob] = useState<Job | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [logJob, setLogJob] = useState<{ id: string; title: string } | null>(null)

  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g.name])),
    [groups]
  )

  const handleRetry = async (jobId: string) => {
    if (!jobId || retryingId) return
    setRetryingId(jobId)
    notify({
      title: "正在恢复任务",
      message: "正在以断点继续模式重试该生成任务（复用 ASR 缓存）…",
      type: "info",
    })
    try {
      const updated = await retryJob(jobId)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
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
      setRetryingId(null)
    }
  }

  const [stoppingId, setStoppingId] = useState<string | null>(null)

  const handleStop = async (jobId: string) => {
    if (!jobId || stoppingId) return
    setStoppingId(jobId)
    try {
      const updated = await stopJob(jobId)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
      notify({
        title: "任务已停止",
        message: `任务 ${jobId.slice(0, 8)} 已手动停止`,
        type: "info",
      })
    } catch (err) {
      notify({
        title: "停止任务失败",
        message: err instanceof Error ? err.message : "未知错误",
        type: "error",
      })
    } finally {
      setStoppingId(null)
    }
  }

  const handleQuickGenerateCovers = async (jobId: string) => {
    if (!jobId || generatingCoverJobId) return
    setGeneratingCoverJobId(jobId)
    notify({
      title: "开始生成 AI 封面",
      message: "正在精选成片画面生成 3 张 9:16 2K 爆款封面…",
      type: "info",
    })
    try {
      const updated = await generateJobCovers(jobId, undefined, 3)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
      notify({
        title: "封面生成完成",
        message: "已成功为该成片生成 3 张 9:16 2K 爆款封面！",
        type: "success",
      })
    } catch (err) {
      notify({
        title: "封面生成失败",
        message: err instanceof Error ? err.message : "无法生成封面",
        type: "error",
      })
    } finally {
      setGeneratingCoverJobId(null)
    }
  }

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const list = await fetchJobs()
        if (alive) setJobs(list)
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "加载失败")
        }
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => {
      void fetchJobs()
        .then((list) => {
          if (alive) setJobs(list)
        })
        .catch(() => {
          /* ignore */
        })
    }, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  async function handleDelete(job: Job) {
    const title =
      job.group_id && groupById.get(job.group_id)
        ? `${groupById.get(job.group_id)} · 成片`
        : `成片 ${job.id.slice(0, 8)}`
    const ok = window.confirm(
      `确定删除「${title}」？\n将同时删除成片视频和工程临时文件，素材库源片不会动。`
    )
    if (!ok) return
    setDeletingId(job.id)
    setError(null)
    try {
      await deleteJob(job.id)
      setJobs((prev) => prev.filter((j) => j.id !== job.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  const handleOpenPreview = (imgs: string[], index = 0) => {
    setPreviewImages(imgs)
    setPreviewIndex(index)
    setIsPreviewOpen(true)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        <Loader2 className="mr-2 size-4 animate-spin text-blue-500" />
        加载成片历史…
      </div>
    )
  }

  if (error && !jobs.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        {error}
      </div>
    )
  }

  if (!jobs.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty className="max-w-sm border-0 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Timeline className="size-8 text-slate-400" />
            </EmptyMedia>
            <EmptyTitle className="text-sm font-semibold text-slate-800 dark:text-slate-200">暂无成片记录</EmptyTitle>
            <EmptyDescription className="text-xs text-slate-400">
              在「智能混剪」中点击一键成片后，记录会出现在这里。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-card p-6 shadow-xs flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">成片历史</h3>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            删除会清掉成片 mp4 与工程目录，不删除素材库里的源视频。
          </p>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Table>
        <TableHeader>
          <TableRow className="border-b border-slate-100 dark:border-slate-800 hover:bg-transparent">
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">项目</TableHead>
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">状态</TableHead>
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">素材数</TableHead>
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">成片时长</TableHead>
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">处理耗时</TableHead>
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">创建时间</TableHead>
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const busy = job.status === "running" || job.status === "queued"
            const deleting = deletingId === job.id
            return (
              <TableRow key={job.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/60 group">
                <TableCell className="py-3.5">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {job.group_id && groupById.get(job.group_id)
                        ? `${groupById.get(job.group_id)} · 成片`
                        : `成片 ${job.id.slice(0, 8)}`}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {job.id}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-3.5">{statusBadge(job)}</TableCell>
                <TableCell className="py-3.5 text-xs text-slate-600 dark:text-slate-300 font-medium">{job.material_ids.length} 个</TableCell>
                <TableCell className="py-3.5 text-xs font-mono text-slate-600 dark:text-slate-300">
                  {job.duration != null ? `${job.duration.toFixed(1)}s` : "—"}
                </TableCell>
                <TableCell className="py-3.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  {job.processing_seconds != null ? (
                    <span className="tabular-nums">
                      {formatProcessingDuration(job.processing_seconds)}
                      {job.status === "running" || job.status === "queued" ? (
                        <span className="ml-1 text-[10px] font-normal text-slate-400">已用</span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="py-3.5 text-xs text-slate-400 dark:text-slate-500">
                  {new Date(job.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {job.status === "succeeded" && job.output_url ? (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs px-2.5 border-slate-200 dark:border-slate-800" asChild>
                          <a
                            href={job.output_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            视频
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const jobTitle = job.group_id && groupById.get(job.group_id)
                              ? `${groupById.get(job.group_id)} · 成片`
                              : `成片 ${job.id.slice(0, 8)}`
                            navigate("/cover", {
                              state: {
                                refImageUrl: job.covers?.[0]?.url || (job.output_url ? `/api/jobs/${job.id}/thumb.jpg` : undefined),
                                headline: job.headline || (job.group_id && groupById.get(job.group_id) ? `${groupById.get(job.group_id)} 爆款特惠！限时抢购` : "爆款特惠！限时抢购，错过再等一年！"),
                                title: jobTitle,
                                sourceJobId: job.id,
                                videoUrl: job.output_url,
                              },
                            })
                          }}
                          className="h-7 text-xs px-2.5 border-purple-200 text-purple-700 bg-purple-50/60 dark:bg-purple-950/40 dark:border-purple-900 dark:text-purple-300 hover:bg-purple-100 cursor-pointer gap-1"
                          title="为此视频制作爆款 AI 大字报封面"
                        >
                          <Wand2 className="size-3 text-purple-600 dark:text-purple-400" />
                          AI封面
                        </Button>
                        {job.covers && job.covers.length > 0 ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenPreview(job.covers!.map((c) => c.url))}
                            className="h-7 text-xs px-2.5 border-amber-200 text-amber-700 bg-amber-50/60 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400 cursor-pointer gap-1"
                          >
                            <ImageIcon className="size-3 text-amber-500" />
                            已存 ({job.covers.length})
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={generatingCoverJobId === job.id}
                            onClick={() => void handleQuickGenerateCovers(job.id)}
                            className="h-7 text-xs px-2.5 border-amber-200 text-amber-700 bg-amber-50/60 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-400 hover:bg-amber-100 cursor-pointer gap-1"
                            title="一键提取本片高光画面生成 3 张 9:16 2K 爆款封面"
                          >
                            {generatingCoverJobId === job.id ? (
                              <Loader2 className="size-3 animate-spin text-amber-600" />
                            ) : (
                              <Sparkles className="size-3 text-amber-500" />
                            )}
                            生成封面
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setProofreadingJob(job)}
                          className="h-7 text-xs px-2.5 border-blue-200 text-blue-700 bg-blue-50/60 dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-300 hover:bg-blue-100 cursor-pointer gap-1"
                          title="人工校验与修正口播字幕"
                        >
                          <FileText className="size-3 text-blue-600 dark:text-blue-400" />
                          校验字幕
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const jobTitle = job.group_id && groupById.get(job.group_id)
                              ? `${groupById.get(job.group_id)} · 成片`
                              : `成片 ${job.id.slice(0, 8)}`
                            setLogJob({ id: job.id, title: jobTitle })
                          }}
                          className="h-7 text-xs px-2 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer gap-1"
                          title="查看此任务实时执行日志"
                        >
                          <Terminal className="size-3 text-slate-500" />
                          <span>日志</span>
                        </Button>
                        <Button size="sm" className="h-7 text-xs px-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium" asChild>
                          <a href={`/api/jobs/${job.id}/download`} download>
                            <Download className="mr-1 size-3" />
                            下载
                          </a>
                        </Button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 max-w-[140px] truncate" title={job.error || job.message}>
                          {job.error || job.message}
                        </span>
                        {(job.status === "running" || job.status === "queued") && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void handleStop(job.id)}
                            disabled={stoppingId === job.id}
                            className="h-7 text-xs px-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border-rose-200 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 font-medium cursor-pointer gap-1 shadow-2xs"
                            title="停止当前正在执行的任务"
                          >
                            {stoppingId === job.id ? (
                              <Loader2 className="size-3 animate-spin text-rose-500" />
                            ) : (
                              <Square className="size-2.5 fill-current text-rose-500" />
                            )}
                            <span>{stoppingId === job.id ? "停止中…" : "停止"}</span>
                          </Button>
                        )}
                        {job.status === "failed" && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleRetry(job.id)}
                            disabled={retryingId === job.id}
                            className="h-7 text-xs px-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer gap-1 shadow-2xs"
                            title="断点继续重试此生成任务"
                          >
                            <RefreshCw className={cn("size-3", retryingId === job.id && "animate-spin")} />
                            <span>{retryingId === job.id ? "恢复中…" : "断点重试"}</span>
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const jobTitle = job.group_id && groupById.get(job.group_id)
                              ? `${groupById.get(job.group_id)} · 成片`
                              : `成片 ${job.id.slice(0, 8)}`
                            setLogJob({ id: job.id, title: jobTitle })
                          }}
                          className="h-7 text-xs px-2 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 cursor-pointer gap-1"
                          title="查看此任务执行日志"
                        >
                          <Terminal className="size-3 text-slate-500" />
                          <span>日志</span>
                        </Button>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs px-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 cursor-pointer"
                      disabled={busy || deleting}
                      title={
                        busy ? "任务进行中，无法删除" : "删除成片与工程文件"
                      }
                      onClick={() => void handleDelete(job)}
                    >
                      {deleting ? (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1 size-3" />
                      )}
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Fullscreen Image Preview Lightbox Modal */}
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
