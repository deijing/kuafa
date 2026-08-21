import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 任务处理耗时：3分12秒 / 48秒 / 1小时05分08秒 */
export function formatProcessingDuration(seconds: number | null | undefined) {
  if (seconds == null || Number.isNaN(seconds)) return "—"
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}小时${m}分${String(s).padStart(2, "0")}秒`
  }
  if (m > 0) {
    return `${m}分${String(s).padStart(2, "0")}秒`
  }
  return `${s}秒`
}
