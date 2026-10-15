/**
 * 48-hour leaderboard periods.
 *
 * Periods are derived from a stable anchor (classroom creation time) using
 * server time — identical on every client, immune to refresh/reconnect.
 * History is never deleted: past periods are simply earlier index values.
 */
import type { CycleConfig } from './cycle'
import { focusSecondsBetween } from './cycle'

export const PERIOD_SECONDS = 48 * 3600
export const PERIOD_MS = PERIOD_SECONDS * 1000

export interface PeriodInfo {
  index: number
  startMs: number
  endMs: number
  remainingSeconds: number
}

export function getPeriodInfo(anchorMs: number, nowMs: number): PeriodInfo {
  const elapsed = Math.max(0, nowMs - anchorMs)
  const index = Math.floor(elapsed / PERIOD_MS)
  const startMs = anchorMs + index * PERIOD_MS
  const endMs = startMs + PERIOD_MS
  return { index, startMs, endMs, remainingSeconds: Math.max(0, Math.ceil((endMs - nowMs) / 1000)) }
}

export function periodAt(anchorMs: number, timestampMs: number): number {
  return Math.floor(Math.max(0, timestampMs - anchorMs) / PERIOD_MS)
}

/**
 * Split a session's eligible focus seconds across leaderboard periods.
 * Returns a map of periodIndex → seconds. Used when a session crosses a
 * period boundary (and mirrored by the SQL close-session routine).
 */
export function focusSecondsByPeriod(
  cycle: CycleConfig,
  periodAnchorMs: number,
  startMs: number,
  endMs: number
): Map<number, number> {
  const out = new Map<number, number>()
  if (endMs <= startMs) return out
  // Split the absolute span at every period boundary inside it, then count
  // focus seconds per chunk — exact, no matter how many boundaries cross.
  const first = periodAt(periodAnchorMs, startMs)
  const last = periodAt(periodAnchorMs, endMs - 1)
  let cursor = startMs
  for (let p = first; p <= last; p++) {
    const boundaryEnd = periodAnchorMs + (p + 1) * PERIOD_MS
    const chunkEnd = Math.min(endMs, boundaryEnd)
    const secs = focusSecondsBetween(cycle, cursor, chunkEnd)
    if (secs > 0) out.set(p, (out.get(p) ?? 0) + secs)
    cursor = chunkEnd
  }
  return out
}
