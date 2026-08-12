import { Bell, Moon, Plus, Sun } from "lucide-react"

import { SettingsDialog } from "@/components/layout/SettingsDialog"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"

type AppHeaderProps = {
  title: string
}

export function AppHeader({ title }: AppHeaderProps) {
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark"

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
        <Button variant="ghost" size="icon" className="relative text-[#4B5563] hover:text-[#111827] dark:text-slate-400 dark:hover:text-slate-200">
          <Bell className="size-4" />
          <span className="absolute top-2 right-2 size-2 rounded-full bg-rose-500" />
        </Button>
        <SettingsDialog />
        <Button className="rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs hover:shadow-md transition-all active:scale-[0.98] font-medium text-xs md:text-sm px-4 py-2 cursor-pointer border-none">
          <Plus data-icon="inline-start" className="size-4 mr-1" />
          新建项目
        </Button>
      </div>
    </header>
  )
}
