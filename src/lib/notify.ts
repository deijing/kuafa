// Notification Sound and Desktop Notification Utility

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) {
      audioCtx = new AudioContextClass()
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    void audioCtx.resume()
  }
  return audioCtx
}

/**
 * Play a pleasant double-chime sound via Web Audio API
 */
export function playNotificationSound(type: "success" | "error" = "success") {
  try {
    const ctx = getAudioContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()

    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    if (type === "success") {
      // Pleasant double chime C5 (523.25Hz) -> E5 (659.25Hz)
      osc1.frequency.setValueAtTime(523.25, now)
      osc1.frequency.setValueAtTime(659.25, now + 0.12)
      osc2.frequency.setValueAtTime(1046.5, now + 0.12)

      gain.gain.setValueAtTime(0.15, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)

      osc1.start(now)
      osc2.start(now + 0.12)
      osc1.stop(now + 0.45)
      osc2.stop(now + 0.45)
    } else {
      // Low double beep for error
      osc1.type = "sawtooth"
      osc1.frequency.setValueAtTime(330, now)
      osc1.frequency.setValueAtTime(261.63, now + 0.15)

      gain.gain.setValueAtTime(0.15, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)

      osc1.start(now)
      osc1.stop(now + 0.4)
    }
  } catch (err) {
    console.warn("Failed to play notification audio tone:", err)
  }
}

/**
 * Request HTML5 Desktop Notification permission
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied"
  }
  if (Notification.permission === "granted") {
    return "granted"
  }
  try {
    const res = await Notification.requestPermission()
    return res
  } catch (err) {
    console.warn("Failed to request notification permission:", err)
    return "denied"
  }
}

/**
 * Send System Desktop Notification if permitted
 */
export function sendDesktopNotification(title: string, options?: NotificationOptions) {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission === "granted") {
    try {
      const n = new Notification(title, {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag: "kuafa-task",
        ...options,
      })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch (err) {
      console.warn("Failed to show desktop notification:", err)
    }
  }
}
