/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// ── App shell: precache, offline navigation, auto-update ──────────────────
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//]
  })
)

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ── Web Push (delivered by the Edge Function in production) ───────────────
interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  kind?: 'start' | 'nudge' | 'message'
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    payload = { title: 'AVHIFocus', body: event.data?.text() ?? '' }
  }
  const title = payload.title ?? 'AVHIFocus'
  const tag = payload.tag ?? 'avhifocus'
  const options = {
    body: payload.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    renotify: payload.kind === 'nudge', // presence checks must be felt
    data: { url: payload.url ?? '/' },
    ...(payload.kind === 'nudge'
      ? {
          // one-tap "I'm here" directly from the notification (supported
          // browsers); the app auto-verifies on open via ?ack=1
          actions: [{ action: 'im_here', title: '✋ I’m here — keep counting' }]
        }
      : {})
  } as NotificationOptions
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const base = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  // action taps hit the same deep-link; ?ack=1 makes the app verify instantly
  const url = event.action === 'im_here' ? base : base
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
