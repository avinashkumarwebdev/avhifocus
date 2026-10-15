import { describe, expect, it } from 'vitest'
import { focusSecondsBetween, focusSegmentsBetween, getCycleState, type CycleConfig } from '../src/lib/time/cycle'

// Deterministic classroom: cycle anchored at unix 0, 50m focus + 10m break.
const CYCLE: CycleConfig = { anchorMs: 0, focusSeconds: 3000, breakSeconds: 600 }
const S = 1000

describe('getCycleState — the shared clock', () => {
  it('starts in focus at the anchor', () => {
    const s = getCycleState(CYCLE, 0)
    expect(s.phase).toBe('focus')
    expect(s.positionSeconds).toBe(0)
    expect(s.remainingSeconds).toBe(3000)
  })

  it('is focus right before the boundary, break exactly at it', () => {
    expect(getCycleState(CYCLE, 2999 * S).phase).toBe('focus')
    expect(getCycleState(CYCLE, 3000 * S).phase).toBe('break')
    expect(getCycleState(CYCLE, 3599 * S).phase).toBe('break')
    expect(getCycleState(CYCLE, 3600 * S).phase).toBe('focus')
  })

  it('two participants at the same instant always agree (pure function of anchor+time)', () => {
    const t = 125_600 * S // 34 full cycles (122400s) + 3200s → inside the break window
    expect(getCycleState(CYCLE, t)).toEqual(getCycleState(CYCLE, t))
    expect(getCycleState(CYCLE, t).phase).toBe('break')
    expect(getCycleState(CYCLE, 1056 * S).phase).toBe('focus')
  })

  it('is correct hours later (ever-running clock)', () => {
    // 100 hours later: position = (100*3600) mod 3600 = 0 → fresh focus
    const s = getCycleState(CYCLE, 100 * 3600 * S)
    expect(s.phase).toBe('focus')
    expect(s.cycleIndex).toBe(100)
  })

  it('never reports negative remaining', () => {
    for (const t of [0, 2999.5 * S, 3000 * S, 3599.9 * S, 3600 * S, 10_000_000 * S]) {
      expect(getCycleState(CYCLE, t).remainingSeconds).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('focusSecondsBetween — eligible study time', () => {
  it('counts a full focus block', () => {
    expect(focusSecondsBetween(CYCLE, 0, 3000 * S)).toBe(3000)
  })

  it('excludes break entirely', () => {
    expect(focusSecondsBetween(CYCLE, 3000 * S, 3600 * S)).toBe(0)
  })

  it('splits a session spanning a break (600s before + 100s after)', () => {
    expect(focusSecondsBetween(CYCLE, 2400 * S, 3700 * S)).toBe(700)
  })

  it('a session starting in break earns nothing until next focus', () => {
    expect(focusSecondsBetween(CYCLE, 3300 * S, 3900 * S)).toBe(300)
  })

  it('handles multiple full cycles', () => {
    // 10 full cycles → 10 × 3000s of focus
    expect(focusSecondsBetween(CYCLE, 0, 10 * 3600 * S)).toBe(30_000)
  })

  it('rejects inverted/empty ranges', () => {
    expect(focusSecondsBetween(CYCLE, 500 * S, 500 * S)).toBe(0)
    expect(focusSecondsBetween(CYCLE, 900 * S, 100 * S)).toBe(0)
  })
})

describe('focusSegmentsBetween', () => {
  it('returns exact clipped segments', () => {
    const segs = focusSegmentsBetween(CYCLE, 2400 * S, 4200 * S)
    expect(segs).toEqual([
      { startMs: 2400 * S, endMs: 3000 * S },
      { startMs: 3600 * S, endMs: 4200 * S }
    ])
  })

  it('segments total equals focusSecondsBetween', () => {
    const segs = focusSegmentsBetween(CYCLE, 1234 * S, 9999 * S)
    const total = segs.reduce((acc, s) => acc + (s.endMs - s.startMs), 0) / 1000
    expect(total).toBe(focusSecondsBetween(CYCLE, 1234 * S, 9999 * S))
  })
})
