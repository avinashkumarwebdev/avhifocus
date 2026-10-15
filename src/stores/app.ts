import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Prefs {
  notificationsEnabled: boolean
  phaseAlerts: boolean
  quietHours: boolean
  reducedMotion: boolean
  ambientSound: boolean
}

export interface Toast {
  id: number
  title: string
  body?: string
  tone?: 'info' | 'success' | 'warn'
}

interface BeforeInstallPromptEventLike {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface AppState {
  prefs: Prefs
  setPrefs: (patch: Partial<Prefs>) => void
  cameraView: string
  setCameraView: (id: string) => void
  installPrompt: BeforeInstallPromptEventLike | null
  setInstallPrompt: (e: BeforeInstallPromptEventLike | null) => void
  toasts: Toast[]
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
}

let toastSeq = 1

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      prefs: {
        notificationsEnabled: false,
        phaseAlerts: true,
        quietHours: true,
        reducedMotion: false,
        ambientSound: false
      },
      setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),
      cameraView: 'overview',
      setCameraView: (id) => set({ cameraView: id }),
      installPrompt: null,
      setInstallPrompt: (e) => set({ installPrompt: e }),
      toasts: [],
      pushToast: (t) =>
        set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id: toastSeq++ }] })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }),
    {
      name: 'avhifocus.app.v1',
      partialize: (s) => ({ prefs: s.prefs, cameraView: s.cameraView }) as AppState
    }
  )
)

/** 22:00–07:00 local quiet hours — suppresses non-critical notifications. */
export function isQuietHoursNow(enabled: boolean): boolean {
  if (!enabled) return false
  const h = new Date().getHours()
  return h >= 22 || h < 7
}

export function prefersReducedMotion(setting: boolean): boolean {
  if (setting) return true
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
