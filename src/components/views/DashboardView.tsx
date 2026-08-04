import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  Clock,
  Database,
  Flame,
  Loader2,
  TrendingUp,
  Video,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useMaterials } from "@/hooks/use-materials"
import { fetchJobs, type Job } from "@/lib/api"
import { cn } from "@/lib/utils"

type StatTone = "primary" | "violet" | "emerald" | "orange"

type StatItem = {
  id: string
  label: string
  value: string
  unit: string
  hint: string
  tone: StatTone
  trend?: "up"
}

const toneIcon: Record<StatTone, LucideIcon> = {
  primary: Video,
  violet: Database,
  emerald: Clock,
  orange: Flame,
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds)) return "—"
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}h${m % 60}m`
  }
  if (m > 0) return `${m}分${String(s).padStart(2, "0")}秒`
  return `${s}秒`
}

function jobTitle(job: Job, groupName?: string) {
  if (groupName) return `${groupName} · 成片`
  return `成片任务 ${job.id.slice(0, 6)}`
}

function statusLabel(job: Job) {
  if (job.status === "succeeded") return "已完成"
  if (job.status === "failed") return "失败"
  if (job.status === "running") return `处理中 ${job.progress}%`
  if (job.status === "queued") return "排队中"
  return job.status
}

type DashboardViewProps = {
  onGoHistory?: () => void
  onGoLibrary?: () => void
  onGoGenerator?: () => void
}

export function DashboardView({
  onGoHistory,
  onGoLibrary,
  onGoGenerator,
}: DashboardViewProps) {
  const { materials, groups, loading: materialsLoading } = useMaterials()
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g])),
    [groups]
  )
  const materialById = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials]
  )

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const list = await fetchJobs()
        if (alive) {
          setJobs(list)
          setError(null)
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : "加载任务失败")
        }
      } finally {
        if (alive) setJobsLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => {
      void fetchJobs()
        .then((list) => {
          if (alive) setJobs(list)
        })
        .catch(() => {
          /* ignore polling errors */
        })
    }, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const stats = useMemo((): StatItem[] => {
    const today = startOfToday()
    const todayJobs = jobs.filter((j) => new Date(j.created_at) >= today)
    const todayDone = todayJobs.filter((j) => j.status === "succeeded")
    const todayRunning = todayJobs.filter(
      (j) => j.status === "running" || j.status === "queued"
    )
    const succeeded = jobs.filter((j) => j.status === "succeeded")
    const finished = jobs.filter(
      (j) => j.status === "succeeded" || j.status === "failed"
    )
    const successRate =
      finished.length === 0
        ? 0
        : Math.round((succeeded.length / finished.length) * 100)
    const outputSeconds = succeeded.reduce((sum, j) => sum + (j.duration ?? 0), 0)
    // 粗估：每条素材人工剪辑约 6 分钟，减去实际成片时长
    const manualEstimateSec = succeeded.reduce(
      (sum, j) => sum + j.material_ids.length * 6 * 60,
      0
    )
    const savedMinutes = Math.max(
      0,
      Math.round((manualEstimateSec - outputSeconds) / 60)
    )

    return [
      {
        id: "videos",
        label: "今日成片",
        value: String(todayDone.length),
        unit: "个",
        hint:
          todayRunning.length > 0
            ? `另有 ${todayRunning.length} 个进行中`
            : `今日共发起 ${todayJobs.length} 个任务`,
        tone: "primary",
        trend: todayDone.length > 0 ? "up" : undefined,
      },
      {
        id: "library",
        label: "素材库",
        value: String(materials.length),
        unit: "段",
        hint: `${groups.length} 个素材组`,
        tone: "violet",
      },
      {
        id: "time",
        label: "预估节省剪辑",
        value: String(savedMinutes),
        unit: "分钟",
        hint: `已完成成片 ${formatDuration(outputSeconds)}`,
        tone: "emerald",
      },
      {
        id: "hit",
        label: "成片成功率",
        value: String(successRate),
        unit: "%",
        hint:
          finished.length > 0
            ? `${succeeded.length}/${finished.length} 任务成功`
            : "暂无已结束任务",
        tone: "orange",
      },
    ]
  }, [jobs, materials.length, groups.length])

  const recentJobs = useMemo(() => jobs.slice(0, 8), [jobs])
  const loading = materialsLoading || jobsLoading

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        {stats.map((stat) => {
          const Icon = toneIcon[stat.tone]
          return (
            <div
              key={stat.id}
              className="group relative flex flex-col justify-between rounded-[12px] bg-card p-5 transition-all duration-200 hover:-translate-y-0.5"
              style={{
                boxShadow:
                  "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#4B5563] dark:text-slate-400">
                  {stat.label}
                </span>
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800 text-[#4B5563] dark:text-slate-300"
                  )}
                >
                  <Icon className="size-4" />
                </div>
              </div>
              <div className="mt-4 flex items-baseline">
                <span className="font-sans tabular-nums text-4xl font-bold tracking-tight text-[#111827] dark:text-slate-50">
                  {loading && stat.id !== "library" ? "—" : stat.value}
                </span>
                <span className="ml-1.5 text-xs font-normal text-[#6B7280] dark:text-slate-400">
                  {stat.unit}
                </span>
              </div>
              <div className="mt-3 text-xs text-[#6B7280] dark:text-slate-400 flex items-center gap-1">
                {stat.trend === "up" ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <TrendingUp className="size-3" />
                    {stat.hint}
                  </span>
                ) : (
                  <span>{stat.hint}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div
        className="rounded-[12px] bg-card overflow-hidden"
        style={{
          boxShadow:
            "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)",
        }}
      >
        <div className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
          <h3 className="text-base font-bold text-[#111827] dark:text-slate-100">
            最近生成任务
          </h3>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline cursor-pointer"
            onClick={onGoHistory}
          >
            查看全部
          </button>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[#6B7280] dark:text-slate-400 text-sm">
              <Loader2 className="size-5 animate-spin" />
              加载真实任务数据…
            </div>
          ) : !recentJobs.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-slate-100/80 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500">
                <svg
                  className="size-7 stroke-[1.5]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m1.5 2.625h12.75c.621 0 1.125-.504 1.125-1.125v-1.5m0 2.625h1.5a1.125 1.125 0 001.125-1.125V5.625m-19.5 0A1.125 1.125 0 014.5 4.5h15a1.125 1.125 0 011.125 1.125m-17.25 0h17.25m-10.5 4.5v3.75m3.75-3.75v3.75"
                  />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-[#111827] dark:text-slate-100">
                暂无成片任务
              </h4>
              <p className="mt-1 text-xs text-[#6B7280] dark:text-slate-400 max-w-sm">
                导入直播切片素材后，即可开启 AI 智能混剪批量一键生成视频成片
              </p>
              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onGoLibrary}
                  className="inline-flex items-center justify-center rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-[#111827] dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  去素材库
                </button>
                <button
                  type="button"
                  onClick={onGoGenerator}
                  className="inline-flex items-center justify-center rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-[#111827] dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  去智能混剪
                </button>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目名称</TableHead>
                  <TableHead>处理状态</TableHead>
                  <TableHead>消耗素材</TableHead>
                  <TableHead>生成时长</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.map((job) => {
                  const group = job.group_id
                    ? groupById.get(job.group_id)
                    : undefined
                  const thumb =
                    job.material_ids
                      .map((id) => materialById.get(id)?.thumb_url)
                      .find(Boolean) ?? null
                  const done = job.status === "succeeded"
                  const running =
                    job.status === "running" || job.status === "queued"
                  return (
                    <TableRow key={job.id} className="transition-colors hover:bg-foreground/5 border-b border-border/50 group">
                      <TableCell>
                        <div className="flex items-center gap-3 font-medium">
                          <div className="size-10 overflow-hidden rounded bg-muted">
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                                {job.id.slice(0, 4)}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col">
                            <span>{jobTitle(job, group?.name)}</span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {new Date(job.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {done ? (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                          >
                            <CheckCircle2 data-icon="inline-start" />
                            {statusLabel(job)}
                          </Badge>
                        ) : job.status === "failed" ? (
                          <Badge variant="destructive">{statusLabel(job)}</Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-primary/10 text-primary"
                          >
                            {statusLabel(job)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {job.material_ids.length} 个切片
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDuration(job.duration)}
                      </TableCell>
                      <TableCell>
                        {done && job.output_url ? (
                          <a
                            href={job.output_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-primary hover:underline"
                          >
                            预览成片
                          </a>
                        ) : running ? (
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={onGoHistory}
                          >
                            查看进度
                          </button>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {job.error || job.message || "—"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}
