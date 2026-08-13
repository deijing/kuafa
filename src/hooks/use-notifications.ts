import { createContext, useContext } from "react"

export type NotificationItem = {
  id: string
  title: string
  message: string
  type: "success" | "error" | "info"
  timestamp: number
  read: boolean
  actionUrl?: string
}

export type ToastItem = {
  id: string
  title: string
  message: string
  type: "success" | "error" | "info"
}

type NotificationContextValue = {
  notifications: NotificationItem[]
  toasts: ToastItem[]
  unreadCount: number
  permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
  notify: (opts: {
    title: string
    message: string
    type?: "success" | "error" | "info"
    playSound?: boolean
    sendDesktop?: boolean
    actionUrl?: string
  }) => void
  dismissToast: (id: string) => void
  markAllAsRead: () => void
  clearAll: () => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider")
  }
  return context
}

export { NotificationContext }
