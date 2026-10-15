/**
 * Authoritative shared-clock mathematics.
 *
 * The classroom clock is NEVER stored as a decrementing value and NEVER
 * reset by clients. A cycle is fully described by:
 *   cycleAnchorMs + focusSeconds + breakSeconds
 * Every client derives the current phase locally from trusted server time.
 */
import type { Phase } from '../../types'

export interface CycleConfig {
  anchorMs: number
  focusSeconds: number
  breakSeconds: number
}

export interface CycleState {
  phase: Phase
  /** Seconds since this cycle iteration began. */
  positionSeconds: number
  /** Seconds until the current phase ends. */
  remainingSeconds: number
  /** Whole cycle iterations elapsed since the anchor. */
  cycleIndex: number
}

export const DEFAULT_FOCUS_SECONDS = 50 * 60
export const DEFAULT_BREAK_SECONDS = 10 * 60

export const cycleSeconds = (c: CycleConfig) => c.focusSeconds + c.breakSeconds

const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

export function getCycleState(c: CycleConfig, nowMs: number): CycleState {
  const cyc = cycleSeconds(c)
  const elapsed = Math.max(0, (nowMs - c.anchorMs) / 1000)
  const pos = ((elapsed % cyc) + cyc) % cyc
  const phase: Phase = pos < c.focusSeconds ? 'focus' : 'break'
  const remainingSeconds = phase === 'focus' ? c.focusSeconds - pos : cyc - pos
  return {
    phase,
    positionSeconds: pos,
    remainingSeconds: Math.ceil(remainingSeconds),
    cycleIndex: Math.floor(elapsed / cyc)
  }
}

/**
 * Eligible focus seconds inside [startMs, endMs): only wall-clock time that
 * falls inside focus phases of the shared cycle. Break time never counts.
 * This is the exact same rule enforced by the SQL function avhi_focus_segments.
 */
export function focusSecondsBetween(c: CycleConfig, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0
  const cycMs = cycleSeconds(c) * 1000
  const focusMs = c.focusSeconds * 1000
  const kMin = Math.floor((startMs - c.anchorMs) / cycMs)
  const kMax = Math.floor((endMs - c.anchorMs) / cycMs)
  let total = 0
  for (let k = kMin; k <= kMax; k++) {
    const fs = c.anchorMs + k * cycMs
    total += overlap(startMs, endMs, fs, fs + focusMs)
  }
  return total / 1000
}

/** Concrete focus intervals inside [startMs, endMs) — for per-segment storage. */
export function focusSegmentsBetween(
  c: CycleConfig,
  startMs: number,
  endMs: number
): Array<{ startMs: number; endMs: number }> {
  const segs: Array<{ startMs: number; endMs: number }> = []
  if (endMs <= startMs) return segs
  const cycMs = cycleSeconds(c) * 1000
  const focusMs = c.focusSeconds * 1000
  const kMin = Math.floor((startMs - c.anchorMs) / cycMs)
  const kMax = Math.floor((endMs - c.anchorMs) / cycMs)
  for (let k = kMin; k <= kMax; k++) {
    const fs = c.anchorMs + k * cycMs
    const fe = fs + focusMs
    const s = Math.max(startMs, fs)
    const e = Math.min(endMs, fe)
    if (e > s) segs.push({ startMs: s, endMs: e })
  }
  return segs
}

export function classroomCycle(room: {
  cycleAnchorMs: number
  focusSeconds: number
  breakSeconds: number
}): CycleConfig {
  return { anchorMs: room.cycleAnchorMs, focusSeconds: room.focusSeconds, breakSeconds: room.breakSeconds }
}

/** mm:ss for countdown display. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** "2h 05m" / "12m" / "48s" duration display. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}
