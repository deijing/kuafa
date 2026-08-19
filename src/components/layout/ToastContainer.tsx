import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"

import { useNotifications } from "@/hooks/use-notifications"
import { cn } from "@/lib/utils"

export function ToastContainer() {
  const { toasts, dismissToast } = useNotifications()

  if (!toasts.length) return null

  return (
    <div className="fixed top-20 right-6 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none select-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === "success"
        const isError = toast.type === "error"

        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto group relative flex items-start gap-3 p-3.5 pl-3.5 rounded-2xl border transition-all duration-300",
              "bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl",
              "border-slate-200/90 dark:border-slate-800/90",
              "shadow-[0_10px_30px_-6px_rgba(0,0,0,0.1),0_4px_10px_-2px_rgba(0,0,0,0.04)] dark:shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7)]",
              "animate-in fade-in-0 slide-in-from-top-4 duration-300 ease-out"
            )}
          >
            {/* Status Icon with subtle colored pill badge */}
            {isSuccess && (
              <div className="flex size-7.5 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 shadow-2xs mt-0.5">
                <CheckCircle2 className="size-4 stroke-[2.2]" />
              </div>
            )}
            {isError && (
              <div className="flex size-7.5 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shrink-0 shadow-2xs mt-0.5">
                <AlertCircle className="size-4 stroke-[2.2]" />
              </div>
            )}
            {!isSuccess && !isError && (
              <div className="flex size-7.5 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0 shadow-2xs mt-0.5">
                <Info className="size-4 stroke-[2.2]" />
              </div>
            )}

            {/* Content Area */}
            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-none">
                  {toast.title}
                </h4>
                {toast.count && toast.count > 1 ? (
                  <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 font-mono text-[10px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    ×{toast.count}
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed font-normal">
                {toast.message}
              </p>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="size-6 -mr-1 -mt-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              aria-label="关闭提示"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

