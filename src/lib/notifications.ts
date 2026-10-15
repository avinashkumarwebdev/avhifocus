import { getBackend } from '../services/backend'
import type { Identity } from '../types'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    notificationsSupported()
  )
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/**
 * Web Push subscription. Requires a VAPID public key (env) and, in
 * production, the paired private key inside the Edge Function — never here.
 * Permission is only requested in response to an explicit user toggle.
 */
export async function subscribeWebPush(identity: Identity): Promise<{ ok: boolean; reason?: string }> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  const permission = await requestNotificationPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied' }
  const backend = getBackend()
  if (backend.mode !== 'supabase') {
    // Demo mode: local "native" notifications via BroadcastChannel still work.
    return { ok: true }
  }
  if (!vapidKey) return { ok: false, reason: 'no-vapid-key' }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource
    })
    await backend.savePushSubscription(sub.toJSON(), identity)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'subscribe-failed' }
  }
}

/** Foreground/native notification for study events, best-effort everywhere. */
export async function showNativeNotification(title: string, body: string, url?: string): Promise<void> {
  // Installed Android app: post through the OS notification channel immediately.
  const { notifyNativeLocal } = await import('./nativePush')
  if (await notifyNativeLocal(title, body, url)) return
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  try {
    const reg =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => undefined) : undefined
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: url ?? '/' }
      })
    } else {
      const n = new Notification(title, { body, icon: '/icons/icon-192.png' })
      if (url) n.onclick = () => window.focus()
    }
  } catch {
    /* native notification failed — in-app toast already covers it */
  }
}
