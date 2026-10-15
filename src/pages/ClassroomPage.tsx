import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useRoomSync } from '../hooks/useRoomSync'
import { useServerNow } from '../hooks/useNow'
import { useIdentityStore } from '../stores/identity'
import { isQuietHoursNow, prefersReducedMotion, useAppStore } from '../stores/app'
import { Wordmark } from '../components/Logo'
import { Button, Chip, Sheet, Spinner } from '../components/ui'
import { TimerDisplay } from '../components/room/TimerDisplay'
import { ConnectionBadge } from '../components/room/ConnectionBadge'
import { ParticipantsPanel } from '../components/room/ParticipantsPanel'
import { SeatPanel } from '../components/room/SeatPanel'
import { PulseGate } from '../components/room/PulseGate'
import { ViewPicker } from '../components/room/ViewPicker'
import { useStrictGuard } from '../hooks/useStrictGuard'
import { ClassroomScene, detectWebGL, seatFocusView } from '../three/ClassroomScene'
import { cameraViewById } from '../three/cameraViews'
import { Fallback2D } from '../three/Fallback2D'
import { classroomCycle, focusSecondsBetween, formatDuration, getCycleState } from '../lib/time/cycle'
import { showNativeNotification } from '../lib/notifications'
import { backendConfigured, getBackend } from '../services/backend'
import { Check, Copy, LogOut, Play, RotateCcw, Settings, Share2, Square, Trophy, Users } from 'lucide-react'

export default function ClassroomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const setLastRoom = useIdentityStore((s) => s.setLastRoom)
  const pushToast = useAppStore((s) => s.pushToast)
  const prefs = useAppStore((s) => s.prefs)
  const cameraView = useAppStore((s) => s.cameraView)
  const setCameraView = useAppStore((s) => s.setCameraView)

  const sync = useRoomSync(roomId)
  const nowMs = useServerNow(500)
  const reducedMotion = prefersReducedMotion(prefs.reducedMotion)

  const [selectedSeat, setSelectedSeat] = useState<number | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const webglOK = useMemo(detectWebGL, [])

  const { room, members, me } = sync

  // Strict rooms: idle/tab-hidden signals freeze accrual (one-tap resume).
  useStrictGuard(
    room?.integrityMode === 'strict' && me?.status === 'studying' && !me?.pulsePaused,
    sync.selfPause
  )

  // Keep "rejoin" shortcut fresh.
  useEffect(() => {
    if (room) setLastRoom({ id: room.id, name: room.name })
  }, [room, setLastRoom])

  // Phase transition feedback + living tab title.
  const phase = room ? getCycleState(classroomCycle(room), nowMs).phase : 'focus'
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (!room) return
    if (prevPhase.current !== phase) {
      const entering = phase === 'break'
      pushToast({
        title: entering ? 'Break time' : 'Back to focus',
        body: entering ? 'Ten minutes — stretch, sip, breathe.' : 'Fifty steady minutes. You’ve got this.',
        tone: entering ? 'info' : 'success'
      })
      if (prefs.phaseAlerts && document.hidden && !isQuietHoursNow(prefs.quietHours)) {
        void showNativeNotification(
          entering ? 'Break time 🌿' : 'Focus time 📚',
          entering ? 'AVHIFocus classroom is on a 10-minute break.' : 'A fresh 50-minute focus block just started.',
          `/room/${room.id}`
        )
      }
      prevPhase.current = phase
    }
    const state = getCycleState(classroomCycle(room), nowMs)
    const mm = String(Math.floor(state.remainingSeconds / 60)).padStart(2, '0')
    const ss = String(Math.floor(state.remainingSeconds % 60)).padStart(2, '0')
    document.title = `(${mm}:${ss}) ${phase === 'focus' ? 'Focus' : 'Break'} · ${room.name} — AVHIFocus`
    return () => {
      document.title = 'AVHIFocus — study together, quietly'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, Math.floor(nowMs / 5000), room?.id])

  const membersBySeat = useMemo(() => {
    const map = new Map<number, (typeof members)[number]>()
    for (const m of members) map.set(m.seatNumber, m)
    return map
  }, [members])

  const myLiveFocusSeconds = useMemo(() => {
    if (!room || !me?.sessionStartedAtMs || me.status !== 'studying' || me.pulsePaused) return 0
    return focusSecondsBetween(classroomCycle(room), me.sessionStartedAtMs, nowMs)
  }, [room, me, nowMs])

  // Resolved camera: a tapped seat always wins over the chosen preset.
  const resolvedView = useMemo(
    () => (selectedSeat != null ? seatFocusView(selectedSeat) : cameraViewById(cameraView)),
    [selectedSeat, cameraView]
  )

  if (!identity) {
    navigate(`/details?next=enter`, { replace: true })
    return null
  }

  if (sync.status === 'not-member') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center">
        <p className="font-rounded text-2xl font-extrabold text-forest">You’re not seated here</p>
        <p className="max-w-sm text-sm text-inksoft">
          You may have left, or the room was reset. Head back to the doorway to peek in and take a bench.
        </p>
        <Button onClick={() => navigate('/hall')}>Back to the classroom door</Button>
      </div>
    )
  }

  if (sync.status === 'loading' || !room || !me) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream">
        <Spinner label="Taking your seat…" />
      </div>
    )
  }

  const studying = me.status === 'studying'
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.joinCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      pushToast({ title: 'Code', body: room.joinCode })
    }
  }

  const share = async () => {
    const text = `Study with me in “${room.name}” on AVHIFocus — classroom code ${room.joinCode}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'AVHIFocus classroom', text, url: window.location.origin })
        return
      } catch { /* dismissed */ }
    }
    void copyCode()
  }

  const confirmLeave = async () => {
    setLeaveOpen(false)
    await sync.leave()
    setLastRoom(null)
    navigate('/')
  }

  const selectedMember = selectedSeat != null ? (membersBySeat.get(selectedSeat) ?? null) : null
  const studyingCount = members.filter((m) => m.status === 'studying').length

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-cream">
      {/* header */}
      <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-wood/10 bg-cream/95 px-3 backdrop-blur-sm sm:px-4">
        <Link to="/" aria-label="AVHIFocus home">
          <Wordmark compact />
        </Link>
        <div className="mx-1 hidden h-6 w-px bg-wood/20 sm:block" />
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <p className="max-w-44 truncate text-sm font-bold text-forest">{room.name}</p>
          <button
            onClick={() => void copyCode()}
            className="flex items-center gap-1 rounded-full bg-forest/8 px-2.5 py-1 text-[11px] font-extrabold tracking-widest text-forest transition hover:bg-forest/15"
            title="Copy classroom code"
          >
            {room.joinCode} {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
        <div className="flex-1" />
        <ConnectionBadge state={sync.connection} />
        <span className="hidden items-center gap-1 rounded-full bg-forest/8 px-2.5 py-1 text-[11px] font-bold text-forest sm:flex">
          <Users size={12} /> {members.length}/10
        </span>
        <button
          onClick={() => void share()}
          className="rounded-full p-2 text-inksoft transition hover:bg-forest/8 hover:text-forest"
          aria-label="Share classroom"
        >
          <Share2 size={17} />
        </button>
        <button
          onClick={() => navigate(`/room/${room.id}/board`)}
          className="rounded-full p-2 text-inksoft transition hover:bg-forest/8 hover:text-forest"
          aria-label="Leaderboard"
        >
          <Trophy size={17} />
        </button>
        <button
          onClick={() => navigate(`/room/${room.id}/settings`)}
          className="rounded-full p-2 text-inksoft transition hover:bg-forest/8 hover:text-forest"
          aria-label="Settings"
        >
          <Settings size={17} />
        </button>
        <button
          onClick={() => setLeaveOpen(true)}
          className="rounded-full p-2 text-inksoft transition hover:bg-[#B8473D]/10 hover:text-[#B8473D]"
          aria-label="Leave classroom"
        >
          <LogOut size={17} />
        </button>
      </header>

      {/* classroom */}
      <div className="relative min-h-0 flex-1">
        {webglOK ? (
          <ClassroomScene
            roomName={room.name}
            members={members}
            mySeat={me.seatNumber}
            selectedSeat={selectedSeat}
            onSelectSeat={setSelectedSeat}
            nowMs={nowMs}
            reducedMotion={reducedMotion}
            phase={phase}
            view={resolvedView}
          />
        ) : (
          <Fallback2D
            members={members}
            mySeat={me.seatNumber}
            selectedSeat={selectedSeat}
            onSelectSeat={setSelectedSeat}
            phase={phase}
          />
        )}

        {/* floating timer */}
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
          <TimerDisplay room={room} nowMs={nowMs} compact={!webglOK} />
        </div>

        {/* camera view switcher */}
        {webglOK && (
          <div className="absolute left-3 top-16 z-10 lg:top-3">
            <ViewPicker
              active={cameraView}
              seatFocused={selectedSeat != null}
              onPick={(id) => {
                setCameraView(id)
                setSelectedSeat(null)
              }}
              onMySeat={() => setSelectedSeat(me.seatNumber)}
            />
          </div>
        )}

        {/* desktop participants rail */}
        <div className="absolute right-3 top-3 z-10 hidden w-64 lg:block">
          <ParticipantsPanel
            members={members}
            myStudentId={identity.id}
            capacity={room.capacity}
            nowMs={nowMs}
            onSelect={(s) => setSelectedSeat(s)}
          />
          {!backendConfigured && <DemoTools roomId={room.id} hasBots={members.some((m) => m.isBot)} />}
        </div>

        {/* integrity pulse / paused-resume gate */}
        {me.status === 'studying' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[7.2rem] z-20 flex justify-center px-3 sm:bottom-[8.5rem]">
            <div className="w-full max-w-md">
              <PulseGate
                me={me}
                room={room}
                nowMs={nowMs}
                busy={sync.busy}
                onAck={() => void sync.ackPulse()}
                onResume={() => void sync.resumeSession()}
              />
            </div>
          </div>
        )}

        {/* control bar */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex w-full max-w-lg flex-col gap-2 rounded-3xl border border-wood/15 bg-cream/95 p-3 shadow-pop backdrop-blur-sm sm:max-w-xl sm:flex-row sm:items-center">
            {studying && me.pulsePaused ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void sync.resumeSession()}
                  loading={sync.busy}
                  className="flex-1 !rounded-2xl !py-3.5 !text-base"
                >
                  <Play size={16} /> Resume timer
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => void sync.stop()}
                  loading={sync.busy}
                  className="!rounded-2xl !py-3.5 !text-sm"
                >
                  <Square size={14} /> Stop
                </Button>
              </>
            ) : (
              <Button
                variant={studying ? 'ghost' : 'primary'}
                onClick={() => void (studying ? sync.stop() : sync.start())}
                loading={sync.busy}
                className="flex-1 !rounded-2xl !py-3.5 !text-base"
              >
                {studying ? (
                  <>
                    <Square size={16} /> Stop studying
                  </>
                ) : (
                  <>
                    <Play size={16} /> Start studying
                  </>
                )}
              </Button>
            )}
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <Chip tone={studying ? 'terra' : 'sage'} className="shrink-0">
                {studying
                  ? me.pulsePaused
                    ? 'paused — back soon?'
                    : `this session · ${formatDuration(myLiveFocusSeconds)} focus`
                  : 'you’re resting'}
              </Chip>
              <span className="text-[11px] font-medium text-inksoft lg:hidden">
                {studyingCount}/{members.length} focusing
              </span>
              {selectedSeat != null && (
                <button
                  onClick={() => setSelectedSeat(null)}
                  className="flex items-center gap-1 rounded-full bg-forest/8 px-2.5 py-1 text-[11px] font-bold text-forest lg:hidden"
                >
                  <RotateCcw size={11} /> overview
                </button>
              )}
            </div>
          </div>
        </div>

        {/* mobile: seat reselect hint */}
        {selectedSeat != null && webglOK && (
          <div className="absolute left-1/2 top-20 z-10 hidden -translate-x-1/2 lg:block">
            <button
              onClick={() => setSelectedSeat(null)}
              className="flex items-center gap-1.5 rounded-full border border-wood/15 bg-cream/90 px-3 py-1.5 text-xs font-bold text-forest shadow-card"
            >
              <RotateCcw size={12} /> Back to classroom overview
            </button>
          </div>
        )}
      </div>

      <SeatPanel
        open={selectedSeat != null}
        seat={selectedSeat}
        member={selectedMember}
        isMe={selectedMember?.studentId === identity.id}
        room={room}
        nowMs={nowMs}
        onClose={() => setSelectedSeat(null)}
        onNudge={(id) => void sync.nudge(id)}
        onSendMessage={(id, text) => void sync.sendMessage(id, text)}
      />

      <Sheet open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Leave this classroom?">
        <p className="text-sm leading-relaxed text-inksoft">
          Your bench frees up for someone else, any open study session is closed and scored, and the shared clock keeps
          running without you. You can rejoin anytime with the code.
        </p>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" full onClick={() => setLeaveOpen(false)}>Stay</Button>
          <Button variant="danger" full loading={sync.busy} onClick={() => void confirmLeave()}>
            Leave classroom
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

/** Demo-mode helper: populate the room with clearly-labelled simulated classmates. */
function DemoTools({ roomId, hasBots }: { roomId: string; hasBots: boolean }) {
  const identity = useIdentityStore((s) => s.identity)
  const pushToast = useAppStore((s) => s.pushToast)
  const backend = getBackend()
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try {
      await fn()
      pushToast({ title: done, tone: 'info' })
    } catch {
      /* panel refreshes via subscription anyway */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-3xl border border-dashed border-[#7D8DA1]/40 bg-[#7D8DA1]/8 p-3">
      <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-[#506086]">Demo mode</p>
      <p className="px-1 pb-2 pt-1 text-[11px] leading-snug text-[#44536E]">
        Backend is simulated on this device. Open a second tab with the room code for real realtime.
      </p>
      <Button
        variant="ghost"
        full
        disabled={busy}
        className="!py-2 !text-xs"
        onClick={() =>
          identity &&
          (hasBots
            ? void run(() => backend.removeDemoBuddies!(roomId, identity), 'Demo classmates removed')
            : void run(() => backend.addDemoBuddies!(roomId, identity), 'Demo classmates added'))
        }
      >
        {hasBots ? 'Remove demo classmates' : 'Add 3 demo classmates'}
      </Button>
    </div>
  )
}
