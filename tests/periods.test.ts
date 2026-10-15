import { describe, expect, it } from 'vitest'
import { getPeriodInfo, focusSecondsByPeriod, periodAt, PERIOD_MS } from '../src/lib/time/periods'
import type { CycleConfig } from '../src/lib/time/cycle'

const CYCLE: CycleConfig = { anchorMs: 0, focusSeconds: 3000, breakSeconds: 600 }
const S = 1000
const ANCHOR = 0 // periods anchored at classroom creation = unix 0

describe('getPeriodInfo — 48h rotation', () => {
  it('derives period index from the stable anchor', () => {
    expect(getPeriodInfo(ANCHOR, 0).index).toBe(0)
    expect(getPeriodInfo(ANCHOR, PERIOD_MS - 1).index).toBe(0)
    expect(getPeriodInfo(ANCHOR, PERIOD_MS).index).toBe(1)
    expect(getPeriodInfo(ANCHOR, 3 * PERIOD_MS + 5000).index).toBe(3)
  })

  it('periods are consecutive, exactly 48h, with sane remaining', () => {
    const p = getPeriodInfo(ANCHOR, 1.5 * PERIOD_MS)
    expect(p.endMs - p.startMs).toBe(PERIOD_MS)
    expect(p.remainingSeconds).toBeCloseTo(PERIOD_MS / 2 / 1000, 0)
  })

  it('periodAt matches getPeriodInfo index', () => {
    expect(periodAt(ANCHOR, PERIOD_MS + 42_000)).toBe(1)
  })
})

describe('focusSecondsByPeriod — boundary splitting', () => {
  it('attributes seconds to a single period when inside one', () => {
    const map = focusSecondsByPeriod(CYCLE, ANCHOR, 100 * S, 1600 * S)
    expect(map.get(0)).toBe(1500)
    expect(map.size).toBe(1)
  })

  it('splits a session crossing the 48h boundary', () => {
    // Focus cycle: 47h exactly = cycle boundary → focus [47h, 47h50m).
    // Study from 47h30m to 48h30m: focus in period 0 = 20m (until 47h50m),
    // then break 47h50m–48h, then period 1 starts with more break till 48h10m(? no—)
    // cycle at 48h: position (48*3600 - 47.8333*3600)... simpler: compute:
    // cycles: hour 48 → 48.0*3600/3600 = 48 → cycle start at 48h focus [48h,48h50m)
    // period 0 focus: 47h30m..47h50m = 1200s; break until 48h (cycle 47 ends 48h)
    const start = (47 * 3600 + 1800) * S
    const end = (48 * 3600 + 1800) * S
    const map = focusSecondsByPeriod(CYCLE, ANCHOR, start, end)
    expect(map.get(0)).toBe(1200)
    expect(map.get(1)).toBe(1800)
  })

  it('never counts break time even at boundaries', () => {
    // Entire 10-minute break that straddles the boundary (48h is a cycle edge):
    const map = focusSecondsByPeriod(CYCLE, ANCHOR, (48 * 3600 - 300) * S, (48 * 3600 + 300) * S)
    const total = [...map.values()].reduce((a, b) => a + b, 0)
    expect(total).toBe(300) // focus begins again at 48h → only the last 5 min
  })
})
