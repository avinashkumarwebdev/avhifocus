/**
 * Native (Capacitor) push bootstrap — the reliable-notification path. On the
 * installed Android app we register with FCM, store the token in the same
 * push_subscriptions table (endpoint = "fcm:<token>"), and deep-link taps
 * back into the right classroom. On the web this module is inert.
 */
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { getBackend } from '../services/backend'
import { useIdentityStore } from '../stores/identity'
import { useAppStore } from '../stores/app'

let ready = false
let pendingToken: string | null = null

async function persistToken(token: string): Promise<void> {
  const identity = useIdentityStore.getState().identity
  if (!identity) {
    pendingToken = token // flush once the student profile exists (see subscribe below)
    return
  }
  try {
    await getBackend().savePushSubscription(
      // reuse the push_subscriptions table; fcm: prefix routes the Edge Function
      { endpoint: `fcm:${token}`, keys: { p256dh: '', auth: '' } },
      identity
    )
    console.info('[push] FCM token saved for', identity.id)
  } catch (e) {
    console.warn('[push] token save failed — will retry on next identity update:', e instanceof Error ? e.message : e)
    pendingToken = token
  }
}

function openDeeplink(url: string | undefined) {
  if (!url) return
  try {
    const path = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url
    window.location.assign(path.startsWith('/') ? path : `/${path}`)
  } catch {
    /* malformed deep-link — ignore */
  }
}

/**
 * Boot-time setup: listeners only. Notification permission is NEVER requested
 * here — the system prompt may appear only after an explicit user action
 * (the Settings toggle calls enableNativePush). If permission was already
 * granted in a previous session and alerts are on, we silently re-register
 * (token refresh requires re-registration on every app start).
 */
export function initNativePush(): void {
  if (ready || !Capacitor.isNativePlatform()) return
  ready = true

  void (async () => {
    try {
      const perm = await PushNotifications.checkPermissions()
      if (perm.receive === 'granted' && useAppStore.getState().prefs.notificationsEnabled) {
        await PushNotifications.register()
      }
    } catch {
      /* Firebase not configured yet — the app still runs, pushes are just off */
    }
  })()

  void PushNotifications.addListener('registration', ({ value }) => {
    void persistToken(value)
  })
  void PushNotifications.addListener('registrationError', () => {
    /* google-services.json missing — documented setup step */
  })
  void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    openDeeplink(action.notification.data?.url as string | undefined)
  })
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    openDeeplink((action.notification.extra as { url?: string } | undefined)?.url)
  })

  // flush a stashed token as soon as the student identity becomes available
  useIdentityStore.subscribe((state) => {
    if (state.identity && pendingToken) {
      const t = pendingToken
      pendingToken = null
      void persistToken(t)
    }
  })
}

/**
 * Called from the Settings toggle (an explicit user action): asks for
 * notification permission and registers with FCM. Returns 'granted' |
 * 'denied' | 'unavailable' (web platform or Firebase not wired up yet).
 */
export async function enableNativePush(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!Capacitor.isNativePlatform()) return 'unavailable'
  try {
    await LocalNotifications.requestPermissions()
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return 'denied'
    await PushNotifications.register()
    return 'granted'
  } catch {
    return 'unavailable'
  }
}

/** Post an immediate local notification (native only). Returns true if posted. */
export async function notifyNativeLocal(title: string, body: string, url?: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2_147_483_647),
          title,
          body,
          extra: { url },
          smallIcon: 'ic_stat_notify',
          channelId: 'avhi_study_buddies'
        }
      ]
    })
    return true
  } catch {
    return false
  }
}
