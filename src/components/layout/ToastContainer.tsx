import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"

import { useNotifications } from "@/hooks/use-notifications"

export function ToastContainer() {
  const { toasts, dismissToast } = useNotifications()

  if (!toasts.length) return null

  return (
    <div className="fixed top-20 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === "success"
        const isError = toast.type === "error"

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-md transition-all animate-in slide-in-from-top-3 fade-in duration-300 ${
              isSuccess
                ? "bg-emerald-950/90 text-emerald-100 border-emerald-800/80 dark:bg-emerald-950/90"
                : isError
                  ? "bg-rose-950/90 text-rose-100 border-rose-800/80 dark:bg-rose-950/90"
                  : "bg-slate-900/90 text-slate-100 border-slate-700/80"
            }`}
          >
            {isSuccess && (
              <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
            )}
            {isError && (
              <AlertCircle className="size-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            {!isSuccess && !isError && (
              <Info className="size-5 text-blue-400 shrink-0 mt-0.5" />
            )}

            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold leading-tight">{toast.title}</h4>
              <p className="text-xs opacity-90 mt-1 line-clamp-2">{toast.message}</p>
            </div>

            <button
              onClick={() => dismissToast(toast.id)}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0 text-current opacity-70 hover:opacity-100"
              aria-label="关闭"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
