import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Download, Loader2, Timeline, Trash2, Wand2, Image as ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ImagePreviewModal } from "@/components/ui/image-preview-modal"
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
import { deleteJob, fetchJobs, type Job } from "@/lib/api"
import { useMaterials } from "@/hooks/use-materials"

function statusBadge(job: Job) {
  if (job.status === "succeeded") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
        已完成
      </span>
    )
  }
  if (job.status === "failed") {
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
  const { groups } = useMaterials()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g.name])),
    [groups]
  )

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
            <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">时长</TableHead>
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
                        ) : null}
                        <Button size="sm" className="h-7 text-xs px-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium" asChild>
                          <a href={`/api/jobs/${job.id}/download`} download>
                            <Download className="mr-1 size-3" />
                            下载
                          </a>
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {job.message}
                      </span>
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
    </div>
  )
}
