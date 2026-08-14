import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  playNotificationSound,
  requestNotificationPermission,
  sendDesktopNotification,
} from "@/lib/notify"
import {
  NotificationContext,
  type NotificationItem,
  type ToastItem,
} from "@/hooks/use-notifications"

const STORAGE_KEY = "kuafa_notifications_v1"

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? (JSON.parse(saved) as NotificationItem[]) : []
    } catch {
      return []
    }
  })

  const [toasts, setToasts] = useState<ToastItem[]>([])

  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission
    }
    return "denied"
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)))
    } catch {
      /* ignore storage errors */
    }
  }, [notifications])

  const requestPerm = useCallback(async () => {
    const res = await requestNotificationPermission()
    setPermission(res)
    return res
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const notify = useCallback(
    ({
      title,
      message,
      type = "success",
      playSound = true,
      sendDesktop = true,
      actionUrl,
    }: {
      title: string
      message: string
      type?: "success" | "error" | "info"
      playSound?: boolean
      sendDesktop?: boolean
      actionUrl?: string
    }) => {
      const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
      const newItem: NotificationItem = {
        id,
        title,
        message,
        type,
        timestamp: Date.now(),
        read: false,
        actionUrl,
      }

      // 1. Append to notification list
      setNotifications((prev) => [newItem, ...prev])

      // 2. Add floating UI Toast with smart deduplication
      const toastId = `toast_${id}`
      setToasts((prev) => {
        const existingIdx = prev.findIndex(
          (t) => t.title === title && t.message === message && t.type === type
        )
        if (existingIdx !== -1) {
          const updated = [...prev]
          const existing = updated[existingIdx]
          const count = (existing.count || 1) + 1
          updated[existingIdx] = { ...existing, id: toastId, count }
          return updated
        }
        // Keep at most 3 simultaneous toasts
        const trimmed = prev.length >= 3 ? prev.slice(prev.length - 2) : prev
        return [...trimmed, { id: toastId, title, message, type, count: 1 }]
      })

      // Auto dismiss toast after 3.8 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId))
      }, 3800)

      // 3. Audio Chime
      if (playSound) {
        playNotificationSound(type === "error" ? "error" : "success")
      }

      // 4. Desktop Notification (especially if tab is hidden/minimized)
      if (sendDesktop) {
        sendDesktopNotification(title, {
          body: message,
        })
      }
    },
    []
  )

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
  }, [])

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  )

  const value = useMemo(
    () => ({
      notifications,
      toasts,
      unreadCount,
      permission,
      requestPermission: requestPerm,
      notify,
      dismissToast,
      markAllAsRead,
      clearAll,
    }),
    [
      notifications,
      toasts,
      unreadCount,
      permission,
      requestPerm,
      notify,
      dismissToast,
      markAllAsRead,
      clearAll,
    ]
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
