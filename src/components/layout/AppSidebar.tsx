import {
  Clapperboard,
  History,
  Image,
  Layers,
  Music,
  PieChart,
  WandSparkles,
  Zap,
} from "lucide-react"
import { Link, NavLink } from "react-router-dom"

import { ChangelogDialog } from "@/components/layout/ChangelogDialog"
import { APP_VERSION } from "@/data/changelog"
import { useMaterials } from "@/hooks/use-materials"
import { cn } from "@/lib/utils"
import { TAB_PATHS, type TabId } from "@/types/nav"

const navItems: {
  id: TabId
  label: string
  icon: typeof PieChart
  hot?: boolean
}[] = [
  { id: "dashboard", label: "工作台", icon: PieChart },
  { id: "library", label: "素材库", icon: Clapperboard },
  { id: "bgm", label: "背景音乐库", icon: Music },
  { id: "generator", label: "智能混剪", icon: WandSparkles },
  { id: "batch", label: "批量制作", icon: Layers, hot: true },
  { id: "cover", label: "封面生成", icon: Image },
  { id: "history", label: "成片历史", icon: History },
]

export function AppSidebar() {
  const { materials, groups, loading } = useMaterials()

  return (
    <aside className="relative z-10 flex h-full w-60 shrink-0 flex-col bg-[#F7F8FA] dark:bg-slate-900 transition-colors">
      <div className="flex h-16 items-center justify-between px-6">
        <Link to={TAB_PATHS.dashboard} className="flex items-center gap-2.5 text-[#111827] dark:text-slate-100 font-bold">
          <div className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
            <Zap className="size-4 fill-current" />
          </div>
          <span className="text-lg font-bold tracking-tight">快发</span>
        </Link>
        <ChangelogDialog
          trigger={
            <button
              type="button"
              className="rounded-full bg-slate-200/60 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#4B5563] dark:text-slate-300 transition-colors cursor-pointer"
              title="点击查看更新日志与版本历史"
            >
              {APP_VERSION}
            </button>
          }
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.id}>
                <NavLink
                  to={TAB_PATHS[item.id]}
                  end={item.id === "dashboard"}
                  className={({ isActive }) =>
                    cn(
                      "relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:bg-blue-600 before:rounded-r bg-[rgba(37,99,235,0.08)] text-blue-600 font-semibold"
                        : "text-[#4B5563] dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-[#111827] dark:hover:text-slate-200"
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                  {item.hot ? (
                    <span className="ml-auto inline-flex items-center rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 border border-rose-500/20">
                      HOT
                    </span>
                  ) : null}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="p-3 pt-0 flex flex-col gap-2">
        <Link
          to={TAB_PATHS.library}
          className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 bg-white/60 dark:bg-slate-800/40 px-3 py-2.5 shadow-2xs transition-all hover:bg-white dark:hover:bg-slate-800 group"
        >
          <div className="flex size-4 items-center justify-center shrink-0">
            <span className="relative flex size-2 items-center justify-center">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-[#111827] dark:text-slate-300">
              素材库就绪
            </span>
            <span className="truncate text-[11px] text-[#9CA3AF]">
              {loading
                ? "加载中…"
                : `${groups.length}组 · ${materials.length}段`}
            </span>
          </div>
        </Link>

        {/* Version & Changelog Trigger */}
        <ChangelogDialog
          trigger={
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-1.5 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors text-xs cursor-pointer group"
            >
              <div className="flex items-center gap-1.5">
                <History className="size-3.5 text-blue-600 dark:text-blue-400 group-hover:rotate-[-20deg] transition-transform" />
                <span className="font-mono font-bold text-[11px]">{APP_VERSION}</span>
                <span className="text-[10px] text-slate-400">更新日志</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 font-semibold border border-emerald-200/60 dark:border-emerald-900/60">
                最新
              </span>
            </button>
          }
        />
      </div>
    </aside>
  )
}
