import { useMemo, useState } from "react"
import {
  Check,
  CheckCircle2,
  Copy,
  History,
  Search,
  Sparkles,
  Tag,
  Zap,
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
import {
  APP_BUILD_DATE,
  APP_VERSION,
  CHANGELOG_DATA,
  type ChangelogCategory,
} from "@/data/changelog"
import { cn } from "@/lib/utils"

type ChangelogDialogProps = {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function getCategoryBadge(type: ChangelogCategory) {
  switch (type) {
    case "feature":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900/60">
          ✨ 新增
        </span>
      )
    case "perf":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900/60">
          ⚡ 优化
        </span>
      )
    case "style":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200/60 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-900/60">
          🎨 视觉
        </span>
      )
    case "fix":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/60 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/60">
          🛠️ 修复
        </span>
      )
  }
}

export function ChangelogDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: ChangelogDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedVersion, setSelectedVersion] = useState<string>(APP_VERSION)
  const [copied, setCopied] = useState(false)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? setControlledOpen! : setInternalOpen

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return CHANGELOG_DATA
    const q = searchQuery.toLowerCase().trim()
    return CHANGELOG_DATA.filter(
      (item) =>
        item.version.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q) ||
        item.highlights.some((h) => h.toLowerCase().includes(q)) ||
        item.details.some((d) => d.text.toLowerCase().includes(q))
    )
  }, [searchQuery])

  const activeItem = useMemo(() => {
    return (
      filteredLogs.find((item) => item.version === selectedVersion) ||
      filteredLogs[0] ||
      CHANGELOG_DATA[0]
    )
  }, [filteredLogs, selectedVersion])

  const handleCopyVersion = () => {
    void navigator.clipboard.writeText(`快发剪辑系统 ${APP_VERSION} (${APP_BUILD_DATE})`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer rounded-xl"
            title="查看版本更新记录"
          >
            <History className="size-3.5 text-blue-600 dark:text-blue-400" />
            <span className="font-mono font-semibold">{APP_VERSION}</span>
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="flex max-h-[90vh] w-[min(920px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-2xl bg-white dark:bg-slate-950 sm:max-w-none">
        {/* Modal Header */}
        <DialogHeader className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
                <Zap className="size-5 fill-current" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                    版本更新与迭代日志
                  </DialogTitle>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                    {APP_VERSION}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    (Build: {APP_BUILD_DATE})
                  </span>
                </div>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  记录每一次产品功能发布、算法调优、画质升级与体验打磨
                </DialogDescription>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyVersion}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 transition-all cursor-pointer shadow-2xs"
              title="复制当前版本号信息"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5 text-slate-400" />
              )}
              <span>{copied ? "已复制" : "复制版本信息"}</span>
            </button>
          </div>
        </DialogHeader>

        {/* Modal Body - 2-Column Split View */}
        <div className="flex flex-1 min-h-[480px] max-h-[65vh] overflow-hidden">
          {/* Left Column: Version Navigation Timeline */}
          <div className="w-[280px] shrink-0 border-r border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 p-4 flex flex-col gap-3 overflow-hidden">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索版本或功能…"
                className="w-full h-8 pl-8 pr-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 placeholder:text-slate-400"
              />
            </div>

            {/* Version List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredLogs.map((item) => {
                const isSelected = item.version === activeItem?.version
                return (
                  <button
                    key={item.version}
                    type="button"
                    onClick={() => setSelectedVersion(item.version)}
                    className={cn(
                      "w-full text-left p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-1.5 relative",
                      isSelected
                        ? "bg-white dark:bg-slate-800 border-blue-300 dark:border-blue-700 shadow-sm shadow-blue-500/5 ring-1 ring-blue-500/20"
                        : "bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "font-mono text-sm font-bold",
                            isSelected
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-slate-800 dark:text-slate-200"
                          )}
                        >
                          {item.version}
                        </span>
                        {item.isLatest && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500 text-white leading-tight">
                            最新
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium font-mono">
                        {item.date}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-1 font-medium">
                      {item.title}
                    </p>

                    <div className="flex items-center gap-1 text-[10px] text-slate-400">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 text-[10px]">
                        {item.tag}
                      </span>
                      <span>· {item.details.length} 项改进</span>
                    </div>
                  </button>
                )
              })}

              {filteredLogs.length === 0 && (
                <div className="py-12 text-center text-xs text-slate-400">
                  没有找到匹配的版本记录
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Detailed Release Notes */}
          <div className="flex-1 p-6 overflow-y-auto bg-white dark:bg-slate-950">
            {activeItem && (
              <div className="flex flex-col gap-6">
                {/* Version Title & Meta */}
                <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
                      {activeItem.version}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900">
                      {activeItem.tag}
                    </span>
                    {activeItem.isLatest && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300">
                        当前线上版本
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400 font-mono">
                      发布日期：{activeItem.date}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
                    {activeItem.title}
                  </h3>
                </div>

                {/* Highlights Card */}
                {activeItem.highlights.length > 0 && (
                  <div className="rounded-2xl p-4 bg-gradient-to-r from-blue-50/70 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/20 border border-blue-100 dark:border-blue-900/40">
                    <h4 className="text-xs font-bold text-blue-900 dark:text-blue-300 flex items-center gap-1.5 mb-2.5">
                      <Sparkles className="size-3.5 text-blue-600 dark:text-blue-400" />
                      核心亮点摘要
                    </h4>
                    <ul className="space-y-1.5">
                      {activeItem.highlights.map((h, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed"
                        >
                          <CheckCircle2 className="size-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Detailed Changelog Entries */}
                <div className="flex flex-col gap-3">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Tag className="size-3.5 text-slate-400" />
                    详细更新明细 ({activeItem.details.length})
                  </h4>

                  <div className="space-y-2.5">
                    {activeItem.details.map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-900/30 hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors"
                      >
                        <div className="shrink-0 mt-0.5">
                          {getCategoryBadge(entry.type)}
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          {entry.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span className="flex items-center gap-1">
            <Zap className="size-3.5 text-blue-600" />
            快发 · 专为带货切片打造的 AI 极速混剪平台
          </span>
          <span>© 2026 快发 All rights reserved.</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
