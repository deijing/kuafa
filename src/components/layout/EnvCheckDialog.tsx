import { useState, useEffect, useCallback } from "react"
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Terminal,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  fetchEnvironmentCheck,
  type EnvCheckItem,
  type EnvCheckResult,
} from "@/lib/api"

type EnvCheckDialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onPassStateChange?: (passed: boolean) => void
  trigger?: React.ReactNode
}

export function EnvCheckDialog({
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  onPassStateChange,
  trigger,
}: EnvCheckDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = externalOpen !== undefined
  const open = isControlled ? externalOpen : internalOpen

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setInternalOpen(nextOpen)
      externalOnOpenChange?.(nextOpen)
    },
    [isControlled, externalOnOpenChange]
  )

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<EnvCheckResult | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const runCheck = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchEnvironmentCheck()
      setResult(res)
      onPassStateChange?.(res.passed)

      // Auto open modal if critical environment error is detected
      if (!res.passed && !isControlled) {
        setInternalOpen(true)
      }
    } catch {
      onPassStateChange?.(false)
    } finally {
      setLoading(false)
    }
  }, [onPassStateChange, isControlled])

  useEffect(() => {
    // 延迟到下一个宏任务，避免在 effect 内同步触发 setState
    const timer = window.setTimeout(() => {
      void runCheck()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [runCheck])

  function handleCopy(text: string, id: string) {
    void navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const passed = result?.passed ?? false
  const criticalErrors = result?.critical_errors ?? 0
  const warnings = result?.warnings ?? 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-all cursor-pointer shadow-2xs"
          >
            {loading ? (
              <Spinner className="size-3.5" />
            ) : passed ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-3.5" />
                <span className="hidden md:inline">环境检测通过</span>
              </span>
            ) : criticalErrors > 0 ? (
              <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-bold animate-pulse">
                <ShieldAlert className="size-3.5" />
                <span>环境未通过 ({criticalErrors})</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                <span>环境有提示 ({warnings})</span>
              </span>
            )}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        {/* Header */}
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex size-9 items-center justify-center rounded-xl font-bold ${
                passed
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
              }`}
            >
              <Activity className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                程序运行环境前置检测关卡
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                必须通过所有关键环境项后，方可进行一键成片与渲染操作。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Status Summary Banner */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-800/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              总体状态：
              {loading ? (
                <span className="text-slate-500">检测中…</span>
              ) : passed ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="size-3.5" /> 已通过全部关键依赖检测
                </span>
              ) : (
                <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1">
                  <XCircle className="size-3.5" /> 存在 {criticalErrors} 项阻断级错误
                </span>
              )}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void runCheck()}
            disabled={loading}
            className="h-7 text-xs px-2.5 rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <RefreshCw className={`size-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            重新检测
          </Button>
        </div>

        {/* Check Items List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {loading && !result ? (
            <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <Spinner className="size-6" />
              <span>正在检测 FFmpeg、libass 滤镜、系统字体及数据库…</span>
            </div>
          ) : (
            result?.items.map((item: EnvCheckItem) => {
              const isPass = item.status === "pass"
              const isWarn = item.status === "warn"
              const isFail = item.status === "fail"

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isFail
                      ? "bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50"
                      : isWarn
                        ? "bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50"
                        : "bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      {isPass && (
                        <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                      )}
                      {isWarn && (
                        <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      {isFail && (
                        <XCircle className="size-4 text-rose-500 shrink-0 mt-0.5 animate-bounce" />
                      )}
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          {item.name}
                          {isFail && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-600 text-white font-semibold">
                              必须修复
                            </span>
                          )}
                        </h4>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                          {item.message}
                        </p>
                        {item.detail && (
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {item.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Fix Suggestion Box */}
                  {item.fix_suggestion && (
                    <div className="mt-3 p-3 rounded-lg bg-slate-900 text-slate-200 text-xs font-mono border border-slate-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Terminal className="size-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate select-all">{item.fix_suggestion}</span>
                      </div>
                      <button
                        onClick={() => handleCopy(item.fix_suggestion!, item.id)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-sans text-slate-300 flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="size-3 text-emerald-400" />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            复制指引
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {!passed ? (
              <span className="text-rose-600 dark:text-rose-400 font-semibold">
                ⚠️ 请先解决标红错误后再继续
              </span>
            ) : (
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                ✅ 环境已具备完美运行条件
              </span>
            )}
          </p>

          <Button
            onClick={() => setOpen(false)}
            disabled={!passed}
            className={`rounded-xl px-5 text-xs font-semibold shadow-xs transition-all cursor-pointer ${
              passed
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600 cursor-not-allowed"
            }`}
          >
            {passed ? "完成检测 · 进行下一步" : "环境未通过 · 阻断继续"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
