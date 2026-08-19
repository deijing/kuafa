import { useNavigate, useLocation } from "react-router-dom"
import { Loader2, Sparkles, ArrowRight } from "lucide-react"
import { useJobs } from "@/hooks/use-jobs"
import { TAB_PATHS } from "@/types/nav"

export function ActiveJobBanner() {
  const { activeJobs, overallProgress } = useJobs()
  const navigate = useNavigate()
  const location = useLocation()

  if (activeJobs.length === 0) return null

  const count = activeJobs.length
  const firstJob = activeJobs[0]

  return (
    <div className="relative z-20 bg-blue-600 text-white shadow-md border-b border-blue-500/40 px-6 py-2.5 flex items-center justify-between transition-all animate-in slide-in-from-top duration-200">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-7 items-center justify-center rounded-lg bg-white/20 shrink-0">
          <Loader2 className="size-4 animate-spin text-white" />
        </div>
        <div className="flex items-center gap-2 min-w-0 text-xs md:text-sm">
          <span className="font-bold truncate">
            ⚡ 后台任务处理中（{count} 条成片并发渲染…）
          </span>
          <span className="hidden sm:inline-block text-blue-100/90 text-xs font-mono">
            {firstJob?.message || "进度"} ({overallProgress}%)
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="hidden md:flex w-32 h-2 rounded-full bg-blue-900/40 overflow-hidden border border-blue-400/30">
          <div
            className="h-full bg-white transition-all duration-300 rounded-full"
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            if (location.pathname !== TAB_PATHS.batch && location.pathname !== TAB_PATHS.history) {
              navigate(TAB_PATHS.batch)
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white text-blue-700 hover:bg-blue-50 font-semibold text-xs transition-colors shadow-2xs cursor-pointer"
        >
          <Sparkles className="size-3.5 text-amber-500" />
          <span>查看实时渲染进度</span>
          <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  )
}
