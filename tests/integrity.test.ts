import { describe, expect, it, beforeEach } from 'vitest'
import { LocalBackend, PULSE_GRACE_MS, SESSION_CAP_MS } from '../src/services/backend/local'
import { memoryStorage, TestChannelHub, type StorageLike } from '../src/services/backend/localStore'
import { randomAvatar } from '../src/lib/avatars'
import type { Identity, IntegrityMode } from '../src/types'

const S = 1000
const M = 60_000

function makeIdentity(n: number): Identity {
  return { id: `student-${n}`, displayName: `Student ${n}`, classLabel: 'Class 10', avatar: randomAvatar(() => 0.4) }
}

/** Deterministic world: pulse interval = 10m + 0.5×8m = exactly 14 minutes. */
function makeWorld() {
  const storage: StorageLike = memoryStorage()
  const hub = new TestChannelHub()
  let now = 1_000_000_000_000
  const mk = () =>
    new LocalBackend({
      storage,
      channel: hub.makeChannel(),
      now: () => now,
      random: () => 0.5
    })
  return {
    storage,
    a: mk(),
    b: mk(),
    get now() {
      return now
    },
    advance(ms: number) {
      now += ms
    }
  }
}

/** Advance time while a present student keeps heartbeating (≤ 2 minute hops
 *  so the ghost-presence caps never trigger for an ACTIVE student). */
async function tick(w: ReturnType<typeof makeWorld>, roomId: string, identity: Identity, ms: number) {
  let left = ms
  while (left > 0) {
    const hop = Math.min(left, 2 * M)
    w.advance(hop)
    left -= hop
    await w.a.heartbeat(roomId, identity)
  }
}

async function setupRoom(w: ReturnType<typeof makeWorld>, mode: IntegrityMode) {
  const owner = makeIdentity(0)
  const room = await w.a.createClassroom({ name: 'Exam Hall' }, owner)
  await w.a.joinClassroom({ code: room.joinCode }, owner)
  await w.a.setIntegrityMode(room.id, owner, mode)
  return { room, owner }
}

async function lbSeconds(w: ReturnType<typeof makeWorld>, roomId: string, viewer: Identity, studentId: string) {
  const lb = await w.a.getLeaderboard(roomId, viewer)
  return lb.rows.find((r) => r.studentId === studentId)?.seconds ?? 0
}

describe('Integrity engine — presence pulses', () => {
  let w: ReturnType<typeof makeWorld>

  beforeEach(() => {
    w = makeWorld()
  })

  it('balanced rooms schedule a randomized pulse on session start', async () => {
    const { room } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    const state = await w.a.getRoomState(room.id, me)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.pulseDueAtMs).toBe(w.now + 14 * M)
    expect(view?.pulsePaused).toBe(false)
    expect(state.classroom.integrityMode).toBe('balanced')
  })

  it('acknowledging a pulse extends the chain; time keeps counting', async () => {
    const { room, owner } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 14 * M)
    await w.a.ackPulse(room.id, me) // exactly at the deadline — in time
    const state = await w.a.getRoomState(room.id, me)
    expect(state.members.find((m) => m.studentId === me.id)?.pulseDueAtMs).toBe(w.now + 14 * M)
    await tick(w, room.id, me, 14 * M)
    await w.a.ackPulse(room.id, me)
    await tick(w, room.id, me, 10 * M) // 38m total, all verified
    await w.a.stopStudying(room.id, me)
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(38 * 60)
  })

  it('a missed pulse halts accrual at due+grace — the absence never counts', async () => {
    const { room, owner } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    // present (heartbeating) but ignoring the pulse: due at +14m, grace +3m
    await tick(w, room.id, me, 20 * M)
    const state = await w.a.getRoomState(room.id, owner)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.pulsePaused).toBe(true)
    await w.a.stopStudying(room.id, me)
    // scores only focus[0 .. 17m] = 1020s, not the full 20m (1200s)
    expect(PULSE_GRACE_MS).toBe(180_000)
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(1020)
  })

  it('resume opens a new window; the paused gap is excluded from the bank', async () => {
    const { room, owner } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 20 * M) // missed pulse → paused at +17m
    await w.a.getRoomState(room.id, me) // trigger sweep
    w.advance(5 * M)
    await w.a.resumeSession(room.id, me) // new window at +25m
    await tick(w, room.id, me, 16 * M) // due at +39m, grace → paused again at +42m
    await w.a.stopStudying(room.id, me)
    // banked: [0..17m] halted + [25m..41m] at stop = 1020 + 960 = 1980s; gap excluded
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(1980)
  })

  it('a too-late ack is rejected as verification (state flips to paused)', async () => {
    const { room } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 19 * M) // overdue by 2 min (past the 3m window)
    await w.a.ackPulse(room.id, me) // late ack can’t resurrect the window
    const state = await w.a.getRoomState(room.id, me)
    expect(state.members.find((m) => m.studentId === me.id)?.pulsePaused).toBe(true)
  })

  it('the 2-hour cap halts continuous accrual even with acked pulses', async () => {
    const { room, owner } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    // keep answering pulses (~14m cadence) for ~112 minutes
    for (let i = 0; i < 8; i++) {
      await tick(w, room.id, me, 14 * M)
      await w.a.ackPulse(room.id, me)
    }
    await tick(w, room.id, me, 10 * M) // 122m > 2h cap → halted at exactly +2h
    const state = await w.a.getRoomState(room.id, owner)
    expect(state.members.find((m) => m.studentId === me.id)?.pulsePaused).toBe(true)
    await w.a.stopStudying(room.id, me)
    // t0 is the cycle anchor: 2h = 2 full cycles → 2 × 3000s focus
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(6000)
    expect(SESSION_CAP_MS).toBe(2 * 3600 * 1000)
  })

  it('nudges pulse the classmate immediately and are rate-limited', async () => {
    const { room, owner } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    const other = makeIdentity(2)
    await w.a.joinClassroom({ code: room.joinCode }, other)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)

    await w.a.nudge(room.id, other, me.id)
    await expect(w.a.nudge(room.id, other, me.id)).rejects.toThrow(/already nudged/i)
    await expect(w.a.nudge(room.id, me, me.id)).rejects.toThrow(/yourself/i)

    // me ignores the nudge: grace (3m) passes → paused
    await tick(w, room.id, me, 4 * M)
    const state = await w.a.getRoomState(room.id, owner)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.pulsePaused).toBe(true)
    await w.a.stopStudying(room.id, me)
    // nudged at t0 due immediately → halted at +3m → 180s only
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(180)
  })

  it('self-pause freezes accrual immediately (strict-mode client signal)', async () => {
    const { room, owner } = await setupRoom(w, 'strict')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 5 * M)
    await w.a.selfPause(room.id, me)
    w.advance(10 * M)
    await w.a.stopStudying(room.id, me)
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(300)
  })

  it('paused students are visibly flagged to classmates (social transparency)', async () => {
    const { room, owner } = await setupRoom(w, 'balanced')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 20 * M)
    const asSeenByOwner = await w.b.getRoomState(room.id, owner)
    expect(asSeenByOwner.members.find((m) => m.studentId === me.id)?.pulsePaused).toBe(true)
    // but their pulse DEADLINE is not leaked to others
    expect(asSeenByOwner.members.find((m) => m.studentId === me.id)?.pulseDueAtMs).toBeNull()
  })
})

describe('Integrity engine — caps & relaxed rooms', () => {
  let w: ReturnType<typeof makeWorld>

  beforeEach(() => {
    w = makeWorld()
  })

  it('relaxed rooms: no pulses, sessions run clean', async () => {
    const { room, owner } = await setupRoom(w, 'relaxed')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 25 * M)
    const state = await w.a.getRoomState(room.id, me)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.pulseDueAtMs).toBeNull()
    expect(view?.pulsePaused).toBe(false)
    await w.a.stopStudying(room.id, me)
    // focus[0..25m]: anchor at t0 → full focus window = 1500s
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(1500)
  })

  it('daily accrual cap: >10h of focus in one UTC day clamps to 36000s', async () => {
    const { room, owner } = await setupRoom(w, 'relaxed')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    // three back-to-back ~5.5h sessions (each below the 6h safety cap),
    // all inside one UTC day: 60000s wall from t0 (cycle anchor)
    for (let i = 0; i < 3; i++) {
      await w.a.startStudying(room.id, me)
      await tick(w, room.id, me, 20_000 * S)
      await w.a.stopStudying(room.id, me)
    }
    // raw focus over those 60,000s: 16×3000 + 2400 = 50,400s → capped at 36,000
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(36_000)
  })
})

describe('Ghost-presence caps — disconnected students stop accruing (every mode)', () => {
  let w: ReturnType<typeof makeWorld>

  beforeEach(() => {
    w = makeWorld()
  })

  it('offline >5 min: session freezes, accrual capped at last heartbeat + 90s', async () => {
    const { room, owner } = await setupRoom(w, 'relaxed')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me) // t0 anchor, heartbeat implied
    w.advance(6 * M) // vanishes; no heartbeat
    const state = await w.a.getRoomState(room.id, owner)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.pulsePaused).toBe(true) // timer visibly frozen for everyone
    await w.a.stopStudying(room.id, me)
    // 250m... only 90 seconds ever counted — the ghost window gains nothing
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(90)
  })

  it('offline >15 min: session is closed, still capped at +90s', async () => {
    const { room, owner } = await setupRoom(w, 'relaxed')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    w.advance(16 * M)
    const state = await w.a.getRoomState(room.id, owner)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.online).toBe(false)
    expect(view?.status).not.toBe('studying')
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(90)
  })

  it('returning after a stale freeze: one-tap resume, gap never counts', async () => {
    const { room, owner } = await setupRoom(w, 'relaxed')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    w.advance(6 * M) // stale at 5m → frozen, capped at +90s
    await w.a.getRoomState(room.id, owner) // trigger sweep
    await w.a.heartbeat(room.id, me) // student is back
    await w.a.resumeSession(room.id, me)
    await tick(w, room.id, me, 5 * M)
    await w.a.stopStudying(room.id, me)
    // 90s from before the vanish + 300s from the resumed window
    expect(await lbSeconds(w, room.id, owner, me.id)).toBe(390)
  })

  it('a present student heartbeating every 20s is never mistakenly frozen', async () => {
    const { room, owner } = await setupRoom(w, 'relaxed')
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 30 * M)
    const state = await w.a.getRoomState(room.id, owner)
    const view = state.members.find((m) => m.studentId === me.id)
    expect(view?.pulsePaused).toBe(false)
    expect(view?.status).toBe('studying')
  })
})
