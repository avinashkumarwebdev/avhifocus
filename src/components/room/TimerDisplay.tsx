import type { Classroom } from '../../types'
import { classroomCycle, formatClock, getCycleState } from '../../lib/time/cycle'
import { ProgressRing } from '../ui'

/**
 * Shared classroom countdown. Purely derived from the authoritative cycle
 * anchor + synchronized server time — identical on every device, resilient
 * to refresh/sleep/reconnect.
 */
export function TimerDisplay({ room, nowMs, compact = false }: { room: Classroom; nowMs: number; compact?: boolean }) {
  const state = getCycleState(classroomCycle(room), nowMs)
  const isFocus = state.phase === 'focus'
  const cycle = classroomCycle(room)
  const phaseLength = isFocus ? cycle.focusSeconds : cycle.breakSeconds
  const phaseElapsed = isFocus ? state.positionSeconds : state.positionSeconds - cycle.focusSeconds
  const progress = phaseElapsed / phaseLength

  if (compact) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-wood/15 bg-cream/90 px-3 py-2 shadow-card backdrop-blur-sm">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest ${
            isFocus ? 'bg-terra/15 text-terradeep' : 'bg-sage/40 text-forestdeep'
          }`}
        >
          {isFocus ? 'Focus' : 'Break'}
        </span>
        <span className="font-rounded text-xl font-extrabold tabular-nums tracking-tight text-ink">
          {formatClock(state.remainingSeconds)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3.5 rounded-3xl border border-wood/15 bg-cream/92 py-2 pl-3 pr-5 shadow-card backdrop-blur-sm">
      <ProgressRing progress={progress} tone={isFocus ? 'focus' : 'break'} size={76} stroke={7}>
        <span className={`text-[10px] font-extrabold uppercase tracking-widest ${isFocus ? 'text-terradeep' : 'text-sagedeep'}`}>
          {isFocus ? 'Focus' : 'Break'}
        </span>
      </ProgressRing>
      <div>
        <p className="font-rounded text-3xl font-extrabold tabular-nums leading-none tracking-tight text-ink">
          {formatClock(state.remainingSeconds)}
        </p>
        <p className="mt-1 text-[11px] font-medium text-inksoft">
          {state.remainingSeconds > 60
            ? `${isFocus ? 'until the break' : 'until focus resumes'}`
            : 'about to switch…'}
        </p>
      </div>
    </div>
  )
}
