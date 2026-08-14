import { useState, useRef, useEffect } from "react"
import { Bell, Moon, Plus, Sun, CheckCircle2, AlertCircle, Info, Trash2, CheckCheck, Volume2 } from "lucide-react"

import { EnvCheckDialog } from "@/components/layout/EnvCheckDialog"
import { SettingsDialog } from "@/components/layout/SettingsDialog"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { useNotifications } from "@/hooks/use-notifications"

type AppHeaderProps = {
  title: string
  onNewProject?: () => void
}

export function AppHeader({ title, onNewProject }: AppHeaderProps) {
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark"

  const {
    notifications,
    unreadCount,
    permission,
    requestPermission,
    markAllAsRead,
    clearAll,
  } = useNotifications()

  const [openNotifications, setOpenNotifications] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenNotifications(false)
      }
    }
    if (openNotifications) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [openNotifications])

  const handleToggleOpen = () => {
    setOpenNotifications((prev) => !prev)
    if (!openNotifications && unreadCount > 0) {
      markAllAsRead()
    }
  }

  const handleNewProjectClick = () => {
    if (onNewProject) {
      onNewProject()
    } else {
      window.dispatchEvent(new CustomEvent("kuafa:new-project"))
    }
  }

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-[#F7F8FA]/90 dark:bg-slate-900/90 px-8 backdrop-blur-md transition-colors">
      <h2 className="text-lg font-bold text-[#111827] dark:text-slate-100">{title}</h2>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="text-[#4B5563] hover:text-[#111827] dark:text-slate-400 dark:hover:text-slate-200"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
          title={isDark ? "切换到浅色模式" : "切换到深色模式"}
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        {/* Notification Bell Dropdown */}
        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggleOpen}
            className="rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="消息提醒"
          >
            <Bell className="size-4.5" />
          </Button>
          {unreadCount > 0 && (
            <span className="pointer-events-none absolute -top-1 -right-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[9px] font-bold text-white ring-2 ring-[#F7F8FA] dark:ring-slate-900 shadow-sm animate-in zoom-in-50 duration-150">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}

          {openNotifications && (
            <div className="absolute right-0 mt-2 w-80 md:w-96 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-4 z-50 text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">消息提醒</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-medium">
                    {notifications.length}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {notifications.length > 0 && (
                    <>
                      <button
                        onClick={markAllAsRead}
                        className="flex items-center gap-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        title="标记已读"
                      >
                        <CheckCheck className="size-3.5" />
                        已读
                      </button>
                      <button
                        onClick={clearAll}
                        className="flex items-center gap-1 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        title="清空"
                      >
                        <Trash2 className="size-3.5" />
                        清空
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Desktop Permission Banner */}
              {permission !== "granted" && (
                <div className="mt-3 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-between text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <Volume2 className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="truncate">开启系统桌面通知，离屏也能提醒</span>
                  </div>
                  <button
                    onClick={() => void requestPermission()}
                    className="ml-2 shrink-0 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-[11px] transition-colors"
                  >
                    开启
                  </button>
                </div>
              )}

              {/* Notification List */}
              <div className="mt-3 max-h-72 overflow-y-auto space-y-2.5 pr-1">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                    暂无消息提醒
                  </div>
                ) : (
                  notifications.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border transition-all flex items-start gap-2.5 ${
                        item.read
                          ? "bg-slate-50/50 dark:bg-slate-800/30 border-slate-100 dark:border-slate-800 opacity-75"
                          : "bg-blue-50/30 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40"
                      }`}
                    >
                      {item.type === "success" ? (
                        <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : item.type === "error" ? (
                        <AlertCircle className="size-4 text-rose-500 shrink-0 mt-0.5" />
                      ) : (
                        <Info className="size-4 text-blue-500 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold truncate text-slate-900 dark:text-slate-100">
                            {item.title}
                          </h4>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {new Date(item.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                          {item.message}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <EnvCheckDialog />
        <SettingsDialog />
        <Button
          onClick={handleNewProjectClick}
          className="rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs hover:shadow-md transition-all active:scale-[0.98] font-medium text-xs md:text-sm px-4 py-2 cursor-pointer border-none"
        >
          <Plus data-icon="inline-start" className="size-4 mr-1" />
          新建项目
        </Button>
      </div>
    </header>
  )
}
