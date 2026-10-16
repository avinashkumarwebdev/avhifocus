/**
 * Native (Capacitor) notification hub. Three pillars:
 *
 *  1. PUSH  — FCM registration + deep-links (server-driven: focus starts,
 *             nudges, quick notes).
 *  2. STICKY— an ongoing, NON-disconnectable "timer is counting" notification
 *             while your session is live (can't be swiped away).
 *  3. ALARMS— locally-scheduled pulse reminders with real action buttons, so
 *             a nudge/"still studying?" check can be answered from the shade
 *             WITHOUT reopening the app: ✋ I'm here / ⏸ Pause timer. If the
 *             app has to flash open to answer, it auto-minimises back out.
 *
 * On the web this module is inert.
 */
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { PushNotifications } from '@capacitor/push-notifications'
import { LocalNotifications } from '@capacitor/local-notifications'
import { getBackend } from '../services/backend'
import { useIdentityStore } from '../stores/identity'
import { useAppStore } from '../stores/app'

// stable notification ids (int32)
const ID_ONGOING = 90_010
const ID_PULSE_DUE = 90_011
const ID_PULSE_MISSED = 90_012

const ACT_PULSE = 'AVHI_PULSE'
const ACT_MISSED = 'AVHI_PULSE_MISSED'

/** Server-side grace (migration 0007): 3 minutes to answer a pulse. */
const GRACE_MS = 180_000

let ready = false
let pendingToken: string | null = null
/** Room the user is currently seated in (needed by background action replies). */
let activeRoomId: string | null = null
/** Last synced study state, so we can self-heal the shade on app resume. */
let lastStudyState: StudyNotifState | null = null

export function setActiveRoomForActions(roomId: string | null): void {
  activeRoomId = roomId
}

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

function toast(title: string, body?: string, tone: 'success' | 'warn' | 'info' = 'success') {
  useAppStore.getState().pushToast({ title, ...(body ? { body } : {}), tone })
}

/** The action answered from the shade: back to YouTube/wherever they were. */
function parkAppAgain() {
  window.setTimeout(() => {
    void App.minimizeApp().catch(() => undefined)
  }, 900)
}

async function cancel(ids: number[]) {
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) })
  } catch {
    /* best effort */
  }
}

/** Handle taps on our local alarm actions — the "reply without reopening" path. */
async function handleAlarmAction(actionId: string): Promise<void> {
  const backend = getBackend()
  const identity = useIdentityStore.getState().identity
  const roomId = activeRoomId ?? useIdentityStore.getState().lastRoom?.id ?? null
  if (!roomId || !identity) return

  try {
    if (actionId === 'IM_HERE') {
      await backend.ackPulse(roomId, identity)
      await cancel([ID_PULSE_DUE, ID_PULSE_MISSED])
      // A late answer silently flips the session to paused (the grace window
      // already closed) — reflect the truth instead of a hollow “verified”.
      const state = await backend.getRoomState(roomId, identity).catch(() => null)
      const meView = state?.members.find((m) => m.studentId === identity.id)
      if (meView?.pulsePaused) {
        toast('⏸ You were a bit late', 'The timer already paused — the gap won’t count. Resume when you’re back.', 'warn')
        openDeeplink(`/room/${roomId}`)
      } else {
        toast('✅ Verified — timer keeps counting', 'Nice. Back to what you were doing!')
        parkAppAgain()
      }
    } else if (actionId === 'PAUSE_TIMER') {
      await backend.selfPause(roomId, identity)
      await cancel([ID_PULSE_DUE, ID_PULSE_MISSED])
      toast('⏸ Timer paused', 'Nothing counts until you resume — take your breath.')
      parkAppAgain()
    } else if (actionId === 'RESUME_NOW') {
      await backend.resumeSession(roomId, identity)
      await cancel([ID_PULSE_MISSED])
      toast('▶ Welcome back — timer counting again')
      openDeeplink(`/room/${roomId}`)
    }
  } catch (e) {
    // Too-late or network issue: open the room so the PulseGate/Resume card can fix it.
    toast('One moment…', e instanceof Error ? e.message : 'Open the app to check your timer.', 'warn')
    openDeeplink(`/room/${roomId}`)
  }
}

async function createChannels(): Promise<void> {
  const channels = [
    { id: 'avhi_ongoing', name: 'Focus session (sticky)', description: 'Shows while your focus timer is counting', importance: 2, visibility: 1, vibration: false },
    { id: 'avhi_pulses', name: 'Still studying? checks', description: 'Presence checks and classmate nudges', importance: 5, visibility: 1, vibration: true, sound: 'default' },
    { id: 'avhi_messages', name: 'Classmate notes', description: 'Quick check-in notes from classmates', importance: 4, visibility: 1, vibration: true, sound: 'default' },
    { id: 'avhi_study_buddies', name: 'Focus starts', description: 'When a classmate begins a focus session', importance: 4, visibility: 1, vibration: true, sound: 'default' }
  ]
  for (const ch of channels) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await LocalNotifications.createChannel(ch as any)
    } catch {
      /* older plugin versions — channels degrade to default */
    }
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

  void createChannels()

  void LocalNotifications.registerActionTypes({
    types: [
      {
        id: ACT_PULSE,
        actions: [
          { id: 'IM_HERE', title: '✋ I’m here — keep counting', foreground: false },
          { id: 'PAUSE_TIMER', title: '⏸ Pause my timer', foreground: false }
        ]
      },
      {
        id: ACT_MISSED,
        actions: [{ id: 'RESUME_NOW', title: '▶ Resume studying', foreground: true }]
      }
    ]
  }).catch(() => undefined)

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
  // Android 14+ lets users swipe away even "ongoing" cards. If ours gets
  // dismissed, it re-materialises the next time the app comes to the front.
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && lastStudyState) {
      void syncStudyNotifications(lastStudyState)
    }
  })

  void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    openDeeplink(action.notification.data?.url as string | undefined)
  })
  void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    if (action.actionId === 'tap') {
      openDeeplink((action.notification.extra as { url?: string } | undefined)?.url)
      return
    }
    void handleAlarmAction(action.actionId)
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
    // Best effort: exact alarms make the pulse checks land on time even in doze.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exact: any = (LocalNotifications as any).checkExactNotificationSetting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const change: any = (LocalNotifications as any).changeExactNotificationSetting
      if (exact && change) {
        const s = await exact.call(LocalNotifications)
        if (s?.exact_alarm !== 'granted') await change.call(LocalNotifications)
      }
    } catch {
      /* optional capability */
    }
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
          iconColor: '#2F5941',
          channelId: 'avhi_study_buddies'
        }
      ]
    })
    return true
  } catch {
    return false
  }
}

// ── study-session notifications (sticky + pulse alarms) ─────────────────────

interface StudyNotifState {
  studying: boolean
  paused: boolean
  /** Server deadline for the current pulse (null in relaxed rooms). */
  dueAtMs: number | null
  roomId: string
  roomName: string
  /** e.g. "38 min" — for the sticky body copy. */
  focusedLabel: string
}

let lastDue: number | null = null
let lastPaused: boolean | null = null
let ongoingPosted = false
let ongoingAt = 0

const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * Mirror the current study state into the notification shade. Safe to call on
 * every room refresh — it only (re)schedules when something actually changed.
 */
export async function syncStudyNotifications(s: StudyNotifState): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  lastStudyState = s
  const enabled = useAppStore.getState().prefs.notificationsEnabled

  if (!s.studying || !enabled) {
    if (ongoingPosted || lastDue !== null || lastPaused !== null) {
      await cancel([ID_ONGOING, ID_PULSE_DUE, ID_PULSE_MISSED])
    }
    ongoingPosted = false
    lastDue = null
    lastPaused = null
    return
  }

  activeRoomId = s.roomId

  const pauseChanged = lastPaused !== null && lastPaused !== s.paused
  // Pause state toggled → banish pending pulse alarms and rewrite the sticky
  // card so the shade always reflects reality.
  if (pauseChanged) {
    await cancel([ID_PULSE_DUE, ID_PULSE_MISSED, ID_ONGOING])
    ongoingPosted = false
    lastDue = null
  }
  lastPaused = s.paused

  // 1) sticky card — if the user swiped it away since we posted it, re-post.
  // (Android 14 allows dismissing ongoing cards; we resurrect on every sync.)
  if (ongoingPosted) {
    try {
      const { notifications: delivered } = await LocalNotifications.getDeliveredNotifications()
      if (!delivered.some((n) => n.id === ID_ONGOING)) {
        ongoingPosted = false
      }
    } catch {
      /* can't check — keep the flag */
    }
  }
  // Refresh the elapsed-time copy about once a minute so the shade never
  // contradicts the in-app timer.
  const staleCopy = ongoingPosted && !s.paused && Date.now() - ongoingAt > 55_000
  if (!ongoingPosted || staleCopy) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: ID_ONGOING,
            title: s.paused ? `⏸ Paused · ${s.roomName}` : `🔥 Focusing · ${s.roomName}`,
            body: s.paused
              ? 'Timer paused — the gap didn’t count. Tap to resume when you’re back.'
              : `${s.focusedLabel} of focus counted so far. Pinned while your timer runs — tap to return.`,
            channelId: 'avhi_ongoing',
            ongoing: true,
            autoCancel: false,
            smallIcon: 'ic_stat_notify',
            iconColor: '#2F5941',
            extra: { url: `/room/${s.roomId}` }
          }
        ]
      })
      ongoingPosted = true
      ongoingAt = Date.now()
    } catch {
      /* scheduling failed — the web UI still works */
    }
  }

  // 2) pulse alarms
  if (s.paused) {
    lastDue = null
    return
  }

  if (s.dueAtMs === null) {
    if (lastDue !== null) await cancel([ID_PULSE_DUE, ID_PULSE_MISSED])
    lastDue = null
    return
  }

  if (lastDue === s.dueAtMs) return // already scheduled for this exact deadline
  lastDue = s.dueAtMs
  await cancel([ID_PULSE_DUE, ID_PULSE_MISSED])

  const inMs = s.dueAtMs - Date.now()
  const dueAt = new Date(inMs > 1500 ? s.dueAtMs : Date.now() + 1500) // past-due (nudge!) fires instantly
  const missedAt = new Date(s.dueAtMs + GRACE_MS + 4000)
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: ID_PULSE_DUE,
          title: '✋ Still studying? — AVHIFocus',
          body: `Tap “I’m here” to keep your timer counting. You have until ${fmtClock(s.dueAtMs + GRACE_MS)} — no need to leave your video.`,
          largeBody: `A presence check just came due in ${s.roomName}. Answer right here from the notification — your ${s.focusedLabel} of focus is safe as long as you confirm in time.`,
          summaryText: 'AVHIFocus presence check',
          channelId: 'avhi_pulses',
          actionTypeId: ACT_PULSE,
          smallIcon: 'ic_stat_notify',
          iconColor: '#2F5941',
          schedule: { at: dueAt, allowWhileIdle: true },
          extra: { url: `/room/${s.roomId}?ack=1&back=1` }
        },
        {
          id: ID_PULSE_MISSED,
          title: '⏸ Timer paused — we couldn’t reach you',
          body: 'You didn’t confirm in time, so the gap won’t count. One tap resumes and keeps your streak honest.',
          channelId: 'avhi_pulses',
          actionTypeId: ACT_MISSED,
          smallIcon: 'ic_stat_notify',
          iconColor: '#B8473D',
          schedule: { at: missedAt, allowWhileIdle: true },
          extra: { url: `/room/${s.roomId}` }
        }
      ]
    })
  } catch {
    /* scheduling failed — in-app gate still protects the session */
  }
}


