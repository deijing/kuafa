import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { fetchJobs, type Job } from "@/lib/api"
import { useNotifications } from "@/hooks/use-notifications"
import { JobsContext } from "@/hooks/use-jobs"

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { notify } = useNotifications()

  const prevActiveIdsRef = useRef<Set<string>>(new Set())

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running"),
    [jobs]
  )

  const hasActiveJobs = activeJobs.length > 0

  const overallProgress = useMemo(() => {
    if (!activeJobs.length) return 0
    return Math.round(
      activeJobs.reduce((sum, j) => sum + j.progress, 0) / activeJobs.length
    )
  }, [activeJobs])

  const refreshJobs = useCallback(async () => {
    try {
      const list = await fetchJobs()
      setJobs(list)
      setError(null)
      return list
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取任务状态失败"
      setError(msg)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  // 手动把刚创的 Job 注册到全局 context
  const registerJobs = useCallback((newJobs: Job[]) => {
    setJobs((prev) => {
      const map = new Map(prev.map((j) => [j.id, j]))
      newJobs.forEach((j) => map.set(j.id, j))
      return Array.from(map.values())
    })
  }, [])

  // 监听 Active 任务转换，在任务完成/失败时发出全局通知（即使切到了其他页面）
  useEffect(() => {
    const currentActiveIds = new Set(activeJobs.map((j) => j.id))
    const prevActiveIds = prevActiveIdsRef.current

    // 找到刚才处于 active，现在变成 finish 的任务
    for (const prevId of prevActiveIds) {
      if (!currentActiveIds.has(prevId)) {
        const found = jobs.find((j) => j.id === prevId)
        if (found) {
          if (found.status === "succeeded") {
            notify({
              title: "🎉 视频生成完成",
              message: `成片「${found.headline || found.id.slice(0, 8)}」已合成完毕！已写入成片历史。`,
              type: "success",
              playSound: true,
              sendDesktop: true,
            })
          } else if (found.status === "failed") {
            notify({
              title: "⚠️ 视频生成失败",
              message: `任务「${found.headline || found.id.slice(0, 8)}」生成失败：${found.error || "遇到未知错误"}`,
              type: "error",
              playSound: true,
              sendDesktop: true,
            })
          }
        }
      }
    }

    prevActiveIdsRef.current = currentActiveIds
  }, [jobs, activeJobs, notify])

  // 后台持续轮询
  useEffect(() => {
    let cancelled = false

    // 首次加载：在异步回调中 setState，避免 effect 内同步 setState
    fetchJobs()
      .then((list) => {
        if (cancelled) return
        setJobs(list)
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "获取任务状态失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // 动态调整轮询间隔：如果有在跑的任务，1.5 秒更新一次；没有则 6 秒巡检一次
    const intervalMs = hasActiveJobs ? 1500 : 6000
    const timer = window.setInterval(() => {
      void refreshJobs()
    }, intervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hasActiveJobs, refreshJobs])

  const value = useMemo(
    () => ({
      jobs,
      activeJobs,
      hasActiveJobs,
      overallProgress,
      loading,
      error,
      refreshJobs,
      registerJobs,
    }),
    [
      jobs,
      activeJobs,
      hasActiveJobs,
      overallProgress,
      loading,
      error,
      refreshJobs,
      registerJobs,
    ]
  )

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}
