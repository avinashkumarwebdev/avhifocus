import { useEffect, useRef } from 'react'
import type { Classroom, MemberView } from '../../types'
import { Button, ProgressRing } from '../ui'
import { playPulseChime } from '../../lib/ambient'
import { Hand, PauseCircle } from 'lucide-react'

const GRACE_MS = 180_000 // matches the server's 3-minute answer window

/**
 * Integrity UI. Two states:
 *  1. A pulse is due  → gentle modal + chime; one tap verifies presence.
 *  2. Session paused  → friendly resume card; the gap visibly did not count.
 */
export function PulseGate({
  me,
  room,
  nowMs,
  busy,
  onAck,
  onResume
}: {
  me: MemberView
  room: Classroom
  nowMs: number
  busy: boolean
  onAck: () => void
  onResume: () => void
}) {
  const integrityOn = room.integrityMode !== 'relaxed'
  const studying = me.status === 'studying'
  const paused = me.pulsePaused && studying
  const dueAt = me.pulseDueAtMs
  const dueNow = integrityOn && !paused && dueAt !== null && nowMs >= dueAt

  // Chime once per new pulse deadline.
  const chimedFor = useRef<number | null>(null)
  useEffect(() => {
    if (dueNow && chimedFor.current !== dueAt) {
      chimedFor.current = dueAt
      playPulseChime()
    }
    if (!dueNow) chimedFor.current = null
  }, [dueNow, dueAt])

  if (!integrityOn || !studying) return null

  if (paused) {
    return (
      <div className="pointer-events-auto flex items-center gap-3 rounded-3xl border border-[#D9B44A]/50 bg-[#FBF3DC]/95 px-4 py-3 shadow-pop backdrop-blur-sm">
        <PauseCircle size={26} className="shrink-0 text-[#A8871A]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-ink">Timer paused</p>
          <p className="text-[11px] leading-snug text-inksoft">The time you were away didn’t count. Resume when you’re back at your desk.</p>
        </div>
        <Button variant="secondary" loading={busy} onClick={onResume} className="!rounded-2xl !px-4 !py-2 !text-xs">
          Resume
        </Button>
      </div>
    )
  }

  if (!dueNow || dueAt === null) return null

  const remainingMs = Math.max(0, dueAt + GRACE_MS - nowMs)
  const progress = remainingMs / GRACE_MS
  const secondsLeft = Math.ceil(remainingMs / 1000)

  return (
    <div className="pointer-events-auto flex items-center gap-4 rounded-3xl border border-terra/40 bg-cream/95 px-4 py-3 shadow-pop backdrop-blur-sm">
      <ProgressRing progress={progress} tone="focus" size={64} stroke={6}>
        <span className="font-rounded text-lg font-extrabold tabular-nums text-terradeep">{secondsLeft}</span>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-ink">Still studying?</p>
        <p className="text-[11px] leading-snug text-inksoft">
          Tap below or your focus timer pauses — only verified minutes reach the leaderboard.
        </p>
      </div>
      <Button loading={busy} onClick={onAck} className="!rounded-2xl !px-4 !py-2.5 !text-sm">
        <Hand size={15} /> I’m here
      </Button>
    </div>
  )
}
