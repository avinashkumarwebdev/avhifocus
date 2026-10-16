import { useCallback, useEffect, useRef, useState } from 'react'
import type { Classroom, ConnectionState, IntegrityMode, MemberView } from '../types'
import { getBackend, syncServerClock, type Backend } from '../services/backend'
import { useIdentityStore } from '../stores/identity'
import { isQuietHoursNow, useAppStore } from '../stores/app'
import { showNativeNotification } from '../lib/notifications'
import { setActiveRoomForActions, syncStudyNotifications } from '../lib/nativePush'

function focusedLabel(startMs: number | null): string {
  if (startMs === null) return 'Your timer'
  const s = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
  if (s < 60) return 'Under a minute'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
}

export type RoomSyncStatus = 'loading' | 'ready' | 'error' | 'not-member'

export interface UseRoomSync {
  status: RoomSyncStatus
  error: string | null
  room: Classroom | null
  members: MemberView[]
  me: MemberView | null
  connection: ConnectionState
  busy: boolean
  refresh: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  leave: () => Promise<void>
  ackPulse: () => Promise<void>
  resumeSession: () => Promise<void>
  selfPause: () => Promise<void>
  nudge: (targetStudentId: string) => Promise<void>
  sendMessage: (targetStudentId: string, text: string) => Promise<void>
  setIntegrityMode: (mode: IntegrityMode) => Promise<void>
}

/**
 * Lifecycle owner for a classroom session:
 *  1. fetch authoritative state
 *  2. subscribe to realtime events (debounced refetch — no duplicated state)
 *  3. heartbeat presence
 *  4. re-sync on reconnect/visibility restore; re-sync server clock offset
 *  5. clean teardown — no leaked subscriptions or intervals
 */
export function useRoomSync(roomId: string | undefined): UseRoomSync {
  const identity = useIdentityStore((s) => s.identity)
  const applyServerIdentity = useIdentityStore((s) => s.applyServerIdentity)
  const pushToast = useAppStore((s) => s.pushToast)
  const prefs = useAppStore((s) => s.prefs)

  const [status, setStatus] = useState<RoomSyncStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState<Classroom | null>(null)
  const [members, setMembers] = useState<MemberView[]>([])
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [notMember, setNotMember] = useState(false)
  const [busy, setBusy] = useState(false)

  const identityRef = useRef(identity)
  identityRef.current = identity
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const refreshTimer = useRef<number | null>(null)

  const backend = getBackend()

  const refresh = useCallback(async () => {
    const id = identityRef.current
    if (!roomId || !id) return
    try {
      const state = await backend.getRoomState(roomId, id)
      setRoom(state.classroom)
      setMembers(state.members)
      setStatus('ready')
      setError(null)
      setConnection((c) => (c === 'offline' ? 'reconnecting' : backend.mode === 'demo' ? 'demo' : 'live'))
      if (backend.mode !== 'demo') setConnection('live')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection problem'
      if (msg.includes('not a member') || msg.includes('NOT_A_MEMBER')) {
        setStatus('not-member')
      } else if (!navigator.onLine) {
        setConnection('offline')
      } else {
        setConnection('reconnecting')
        setError('Connection hiccup — retrying…')
      }
    }
  }, [backend, roomId])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => void refresh(), 150)
  }, [refresh])

  useEffect(() => {
    const id = identityRef.current
    if (!roomId || !id) return
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let heartbeatId: number | undefined

    const boot = async () => {
      setStatus('loading')
      try {
        await syncServerClock()
        const serverIdentity = await backend.ensureIdentity(id)
        if (serverIdentity.id !== id.id) applyServerIdentity(serverIdentity)
        const resumed = await backend.resumeClassroom(roomId, serverIdentity)
        if (cancelled) return
        if (!resumed) {
          setStatus('not-member')
          setNotMember(true)
          return
        }
        setRoom(resumed.classroom)

        unsubscribe = backend.subscribeRoom(roomId, (event) => {
          if (event.kind === 'room-changed') {
            scheduleRefresh()
            return
          }
          // Ephemeral events: toast + optional native notification. The
          // triggering student never notifies themselves.
          if (event.kind === 'focus-started' && event.by.studentId !== identityRef.current?.id) {
            const p = prefsRef.current
            const text = `${event.by.displayName} (${event.by.classLabel}) started focusing`
            pushToast({ title: 'Someone started studying', body: text, tone: 'success' })
            if (p.notificationsEnabled && !isQuietHoursNow(p.quietHours) && document.hidden) {
              void showNativeNotification('Someone started studying!', `${text} — join them in AVHIFocus.`, `/room/${roomId}`)
            }
          }
          if (event.kind === 'nudged' && event.targetStudentId === identityRef.current?.id) {
            pushToast({
              title: '👀 A classmate is checking on you',
              body: `${event.by.displayName} nudged you — still studying?`,
              tone: 'info'
            })
          }
          if (event.kind === 'message' && event.targetStudentId === identityRef.current?.id) {
            pushToast({
              title: `💬 ${event.by.displayName}`,
              body: event.text,
              tone: 'info'
            })
            try {
              navigator.vibrate?.(60)
            } catch {
              /* unsupported */
            }
          }
        })

        await refresh()
        if (cancelled) return

        heartbeatId = window.setInterval(() => {
          const ident = identityRef.current
          if (ident) void backend.heartbeat(roomId, ident).catch(() => setConnection('reconnecting'))
        }, 20_000)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load the classroom')
          setStatus('error')
          setConnection('reconnecting')
        }
      }
    }

    void boot()

    const onOnline = () => {
      setConnection('reconnecting')
      void syncServerClock().then(refresh)
    }
    const onOffline = () => setConnection('offline')
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void syncServerClock().then(refresh)
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      unsubscribe?.()
      if (heartbeatId) window.clearInterval(heartbeatId)
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const guarded = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return
      setBusy(true)
      try {
        await fn()
        await refresh()
      } catch (e) {
        pushToast({ title: 'That did not work', body: e instanceof Error ? e.message : 'Please try again', tone: 'warn' })
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [busy, refresh, pushToast]
  )

  const start = useCallback(
    () => guarded(async () => backend.startStudying(roomId as string, identityRef.current as never).then(() => undefined)),
    [backend, guarded, roomId]
  )
  const stop = useCallback(
    () => guarded(async () => backend.stopStudying(roomId as string, identityRef.current as never)),
    [backend, guarded, roomId]
  )
  const leave = useCallback(
    () =>
      guarded(async () => {
        const id = identityRef.current
        if (id) await backend.leaveClassroom(roomId as string, id)
      }),
    [backend, guarded, roomId]
  )

  // ── integrity actions ────────────────────────────────────────────────────
  const integrity = useCallback(
    async (fn: (b: Backend, id: NonNullable<typeof identity>, roomId: string) => Promise<void>, silent = false) => {
      const id = identityRef.current
      if (!roomId || !id) return
      try {
        await fn(backend, id, roomId)
        await refresh()
      } catch (e) {
        if (!silent) {
          pushToast({
            title: 'That did not work',
            body: e instanceof Error ? e.message : 'Please try again',
            tone: 'warn'
          })
        }
        await refresh()
      }
    },
    [backend, roomId, refresh, pushToast]
  )

  const ackPulse = useCallback(() => integrity((b, id, r) => b.ackPulse(r, id)), [integrity])
  const resumeSession = useCallback(() => integrity((b, id, r) => b.resumeSession(r, id)), [integrity])
  const selfPause = useCallback(() => integrity((b, id, r) => b.selfPause(r, id), true), [integrity])
  const nudge = useCallback(
    async (targetStudentId: string) => {
      await integrity(async (b, id, r) => {
        await b.nudge(r, id, targetStudentId)
        pushToast({ title: 'Nudge sent', body: 'They’ll get a gentle “still studying?” check 👀', tone: 'info' })
      })
    },
    [integrity, pushToast]
  )
  const setIntegrityMode = useCallback(
    (mode: IntegrityMode) => integrity((b, id, r) => b.setIntegrityMode(r, id, mode)),
    [integrity]
  )
  const sendMessage = useCallback(
    async (targetStudentId: string, text: string) => {
      await integrity(async (b, id, r) => {
        await b.sendMessage(r, id, targetStudentId, text)
        pushToast({ title: 'Note sent', body: text, tone: 'success' })
      })
    },
    [integrity, pushToast]
  )

  const me = members.find((m) => m.studentId === identity?.id) ?? null

  // ── notification shade mirror (native only; no-op on web) ───────────────
  // Sticky session card (with live elapsed-time copy) + locally scheduled
  // pulse alarms with reply actions, answerable without leaving other apps.
  const meStatus = me?.status ?? 'idle'
  const meDue = me?.pulseDueAtMs ?? null
  const mePaused = me?.pulsePaused ?? false
  const meStart = me?.sessionStartedAtMs ?? null
  const liveStateRef = useRef<{ studying: boolean; paused: boolean; dueAtMs: number | null; roomId: string; roomName: string } | null>(null)
  useEffect(() => {
    setActiveRoomForActions(roomId ?? null)
    const base = {
      studying: !!roomId && meStatus === 'studying',
      paused: mePaused,
      dueAtMs: meDue,
      roomId: roomId ?? '',
      roomName: room?.name ?? 'your classroom'
    }
    liveStateRef.current = base.studying ? base : null
    void syncStudyNotifications({ ...base, focusedLabel: focusedLabel(meStart) })
    return () => {
      setActiveRoomForActions(null)
    }
    // room?.name intentionally read at sync time; it's stable per room
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, meStatus, meDue, mePaused, meStart, prefs.notificationsEnabled])

  // Re-tick the sticky card's elapsed-time copy once a minute while studying.
  const meStartRef = useRef(meStart)
  meStartRef.current = meStart
  useEffect(() => {
    if (meStatus !== 'studying' || !roomId) return
    const t = window.setInterval(() => {
      const base = liveStateRef.current
      if (base) void syncStudyNotifications({ ...base, focusedLabel: focusedLabel(meStartRef.current) })
    }, 60_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meStatus, roomId])

  return {
    status,
    error,
    room,
    members,
    me,
    connection,
    busy,
    refresh,
    start,
    stop,
    leave: notMember ? async () => {} : leave,
    ackPulse,
    resumeSession,
    selfPause,
    nudge,
    sendMessage,
    setIntegrityMode
  }
}
