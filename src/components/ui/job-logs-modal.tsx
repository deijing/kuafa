import { useCallback, useEffect, useRef, useState } from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  RefreshCw,
  ScrollText,
  Terminal,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fetchJobLogs, type JobLogsResult } from "@/lib/api"
import { cn } from "@/lib/utils"

interface JobLogsModalProps {
  jobId: string | null
  jobTitle?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function JobLogsModal({
  jobId,
  jobTitle,
  open,
  onOpenChange,
}: JobLogsModalProps) {
  const [data, setData] = useState<JobLogsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const pollTimerRef = useRef<number | null>(null)

  const loadLogs = useCallback(
    async (isInitial = false) => {
      if (!jobId) return
      if (isInitial) setLoading(true)
      try {
        const res = await fetchJobLogs(jobId)
        setData(res)
      } catch (err) {
        console.error("加载任务日志失败:", err)
      } finally {
        if (isInitial) setLoading(false)
      }
    },
    [jobId]
  )

  // 轮询机制：当弹窗开启且任务处于运行/排队中时每 1.2 秒刷新一次
  useEffect(() => {
    if (!open || !jobId) {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return
    }

    void loadLogs(true)

    pollTimerRef.current = window.setInterval(() => {
      void loadLogs(false)
    }, 1200)

    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [open, jobId, loadLogs])

  // 任务完成或失败后停止轮询
  useEffect(() => {
    if (
      data &&
      (data.status === "succeeded" || data.status === "failed") &&
      pollTimerRef.current
    ) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [data])

  // 自动滚动至底部
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [data?.logs, autoScroll])

  const handleCopyLogs = () => {
    if (!data?.logs || data.logs.length === 0) return
    const text = data.logs
      .map((l) => `[${l.time_label || l.timestamp}] [${l.level.toUpperCase()}] [${l.progress}%] ${l.message}`)
      .join("\n")
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const logs = data?.logs || []
  const isRunning = data?.status === "running" || data?.status === "queued"

  const getLevelBadge = (level: string, progress: number) => {
    switch (level) {
      case "error":
        return (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
            ERROR
          </span>
        )
      case "warn":
        return (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            WARN
          </span>
        )
      case "success":
        return (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            SUCCESS
          </span>
        )
      case "progress":
        return (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            {progress}%
          </span>
        )
      default:
        return (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
            INFO
          </span>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-900 border-slate-800 text-slate-100 shadow-2xl rounded-2xl">
        {/* Header */}
        <DialogHeader className="p-4 sm:px-6 bg-slate-950/80 border-b border-slate-800/80 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Terminal className="size-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-sm font-semibold text-slate-100 truncate">
                  {jobTitle ? `${jobTitle} · 执行日志` : "任务实时执行流水"}
                </DialogTitle>
                {data && (
                  <span
                    className={cn(
                      "px-2 py-0.5 text-[11px] font-medium rounded-full flex items-center gap-1 border",
                      data.status === "succeeded" &&
                        "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                      data.status === "running" &&
                        "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse",
                      data.status === "queued" &&
                        "bg-amber-500/15 text-amber-400 border-amber-500/30",
                      data.status === "failed" &&
                        "bg-rose-500/15 text-rose-400 border-rose-500/30"
                    )}
                  >
                    {data.status === "running" && (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    {data.status === "succeeded" && (
                      <CheckCircle2 className="size-3" />
                    )}
                    {data.status === "failed" && <XCircle className="size-3" />}
                    {data.status === "queued" && (
                      <Info className="size-3" />
                    )}
                    {data.status === "running"
                      ? `处理中 (${data.progress}%)`
                      : data.status === "succeeded"
                      ? "生成成功"
                      : data.status === "failed"
                      ? "执行中断"
                      : "排队中"}
                  </span>
                )}
              </div>
              <DialogDescription className="text-xs text-slate-400 mt-0.5 truncate font-mono">
                Task ID: {jobId}
              </DialogDescription>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLogs}
              disabled={logs.length === 0}
              className="h-8 px-2.5 text-xs bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-200 cursor-pointer flex items-center gap-1.5 rounded-lg"
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-400" />
                  <span className="text-emerald-400">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>复制日志</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadLogs(false)}
              disabled={loading}
              className="h-8 px-2.5 text-xs bg-slate-800/80 hover:bg-slate-700/80 border-slate-700 text-slate-200 cursor-pointer flex items-center gap-1.5 rounded-lg"
              title="手动刷新日志"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </DialogHeader>

        {/* Console Log Body */}
        <div
          ref={logContainerRef}
          className="flex-1 min-h-[320px] max-h-[500px] overflow-y-auto p-4 sm:p-5 font-mono text-xs space-y-2 bg-[#0d1117] select-text"
        >
          {loading && logs.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-500 gap-2">
              <Loader2 className="size-6 animate-spin text-blue-400" />
              <span>正在连接日志服务…</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-500 gap-2">
              <ScrollText className="size-6 text-slate-600" />
              <span>暂无日志输出</span>
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                className="flex items-start gap-2.5 leading-relaxed group hover:bg-slate-800/30 px-2 py-1 rounded transition-colors"
              >
                <span className="text-slate-500 shrink-0 text-[11px] select-none">
                  [{log.time_label || log.timestamp?.slice(11, 19)}]
                </span>
                {getLevelBadge(log.level, log.progress)}
                <span
                  className={cn(
                    "break-all flex-1 text-slate-300",
                    log.level === "error" && "text-rose-300 font-medium",
                    log.level === "warn" && "text-amber-300",
                    log.level === "success" && "text-emerald-300 font-medium"
                  )}
                >
                  {log.message}
                </span>
              </div>
            ))
          )}

          {isRunning && (
            <div className="flex items-center gap-2 pt-2 text-slate-500 text-[11px] animate-pulse">
              <Loader2 className="size-3 animate-spin text-blue-400" />
              <span>流水线运行中，日志实时推送更新…</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:px-6 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-[11px]">
              <span className="size-2 rounded-full bg-emerald-500 inline-block"></span>
              共 {logs.length} 条记录
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-slate-400 hover:text-slate-200">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-0 focus:ring-offset-0 size-3.5"
              />
              <span>自动滚屏</span>
            </label>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 px-4 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer rounded-lg"
          >
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
