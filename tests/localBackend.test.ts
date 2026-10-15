import { describe, expect, it, beforeEach } from 'vitest'
import { LocalBackend } from '../src/services/backend/local'
import { memoryStorage, TestChannelHub, type StorageLike } from '../src/services/backend/localStore'
import { BackendError, type Identity } from '../src/types'
import { randomAvatar } from '../src/lib/avatars'

const S = 1000
const H = 3600 * S

function makeIdentity(n: number): Identity {
  return { id: `student-${n}`, displayName: `Student ${n}`, classLabel: 'Class 10', avatar: randomAvatar(() => 0.4) }
}

/**
 * Simulates two browser tabs sharing one profile (one storage) with
 * BroadcastChannel realtime between them. `now` is a controllable clock.
 */
function makeWorld() {
  const storage: StorageLike = memoryStorage()
  const hub = new TestChannelHub()
  let now = 1_000_000_000_000
  const mk = () =>
    new LocalBackend({
      storage,
      channel: hub.makeChannel(),
      now: () => now
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

/** Advance while the student stays present (2-minute heartbeat hops) so the
 *  ghost-presence caps (5 min offline) never fire for an active student. */
async function tick(w: ReturnType<typeof makeWorld>, roomId: string, identity: Identity, ms: number) {
  let left = ms
  while (left > 0) {
    const hop = Math.min(left, 2 * 60_000)
    w.advance(hop)
    left -= hop
    await w.a.heartbeat(roomId, identity)
  }
}

describe('LocalBackend — shared classroom rules', () => {
  let w: ReturnType<typeof makeWorld>

  beforeEach(() => {
    w = makeWorld()
  })

  it('creates a classroom with an unguessable 6-char code + running clock', async () => {
    const room = await w.a.createClassroom({ name: 'Evening Prep' }, makeIdentity(1))
    expect(room.joinCode).toMatch(/^[2-9A-HJKMNP-Z]{6}$/)
    expect(room.capacity).toBe(10)
    expect(room.cycleAnchorMs).toBe(w.now)
  })

  it('assigns seats 1,2,3… and refuses the 11th student', async () => {
    const room = await w.a.createClassroom({ name: 'Full House' }, makeIdentity(0))
    const seats: number[] = []
    for (let i = 1; i <= 10; i++) {
      const { member } = await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(i))
      seats.push(member.seatNumber)
    }
    expect(seats.slice().sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await expect(w.a.joinClassroom({ code: room.joinCode }, makeIdentity(11))).rejects.toThrow(BackendError)
    await expect(w.a.joinClassroom({ code: room.joinCode }, makeIdentity(11))).rejects.toMatchObject({
      code: 'ROOM_FULL'
    })
  })

  it('two students racing for the last seat cannot both get in', async () => {
    const room = await w.a.createClassroom({ name: 'Race' }, makeIdentity(0))
    for (let i = 1; i <= 9; i++) await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(i))
    const results = await Promise.allSettled([
      w.a.joinClassroom({ code: room.joinCode }, makeIdentity(10)),
      w.b.joinClassroom({ code: room.joinCode }, makeIdentity(11))
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    const state = await w.a.getRoomState(room.id, makeIdentity(10))
    expect(state.members).toHaveLength(10)
  })

  it('rejects invalid codes and inactive rooms with specific errors', async () => {
    await expect(w.a.joinClassroom({ code: 'ZZZZZZ' }, makeIdentity(1))).rejects.toMatchObject({
      code: 'ROOM_NOT_FOUND'
    })
    await expect(w.a.joinClassroom({ code: '1!@#$%' }, makeIdentity(1))).rejects.toThrow()
  })

  it('re-joining the same room is idempotent (same seat, no duplicate)', async () => {
    const room = await w.a.createClassroom({ name: 'Again' }, makeIdentity(0))
    const first = await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(1))
    const second = await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(1))
    expect(first.member.seatNumber).toBe(second.member.seatNumber)
    const state = await w.a.getRoomState(room.id, makeIdentity(1))
    expect(state.members.filter((m) => m.studentId === 'student-1')).toHaveLength(1)
  })

  it('leaving frees the exact seat for the next student', async () => {
    const room = await w.a.createClassroom({ name: 'Seats' }, makeIdentity(0))
    const m1 = await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(1))
    const m2 = await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(2))
    expect([m1.member.seatNumber, m2.member.seatNumber].sort()).toEqual([1, 2])
    await w.a.leaveClassroom(room.id, makeIdentity(1))
    const m3 = await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(3))
    expect(m3.member.seatNumber).toBe(1) // freed seat reused, other seat untouched
    const state = await w.a.getRoomState(room.id, makeIdentity(2))
    expect(state.members.find((m) => m.studentId === 'student-2')?.seatNumber).toBe(2)
  })

  it('start/stop is idempotent and study status is visible to the other tab', async () => {
    const room = await w.a.createClassroom({ name: 'Study' }, makeIdentity(0))
    const me = makeIdentity(1)
    const other = makeIdentity(2)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.b.joinClassroom({ code: room.joinCode }, other)

    await w.a.startStudying(room.id, me)
    await w.a.startStudying(room.id, me) // duplicate start → no duplicate session
    let seenByOther = await w.b.getRoomState(room.id, other)
    expect(seenByOther.members.filter((m) => m.studentId === me.id && m.status === 'studying')).toHaveLength(1)

    await w.a.stopStudying(room.id, me)
    await w.a.stopStudying(room.id, me) // duplicate stop → no double count
    seenByOther = await w.b.getRoomState(room.id, other)
    expect(seenByOther.members.find((m) => m.studentId === me.id)?.status).toBe('idle')
  })

  it('scores only focus-phase time (session spanning a break)', async () => {
    const room = await w.a.createClassroom({ name: 'Cycle' }, makeIdentity(0))
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    // Anchor is w.now at creation. Jump to 40m into focus, study 20m
    // (10m focus left + 10m break) => 600s eligible.
    w.advance(2400 * S)
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 1200 * S)
    await w.a.stopStudying(room.id, me)
    const other = makeIdentity(2)
    await w.a.joinClassroom({ code: room.joinCode }, other)
    const lb = await w.a.getLeaderboard(room.id, me)
    expect(lb.rows.find((r) => r.studentId === me.id)?.seconds).toBe(600)
  })

  it('splits a session across a 48h leaderboard boundary', async () => {
    const room = await w.a.createClassroom({ name: 'Long Haul' }, makeIdentity(0))
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.setIntegrityMode(room.id, me, 'relaxed') // no pulses — this test is about periods
    // Anchor at creation = w.now. 47h = exactly 47 cycles (3600s) → focus starts.
    w.advance((47 * 3600 + 1800) * S) // 30 min into a focus block
    await w.a.startStudying(room.id, me)
    await tick(w, room.id, me, 3600 * S) // study 1h → spans the 48h boundary
    await w.a.stopStudying(room.id, me)

    // Still in period 1 (48h..48.5h+): 1800s of focus happened after 48h
    // (20m in period 0 until 47h50m, break till 48h, then 30m focus).
    const lbNow = await w.a.getLeaderboard(room.id, me)
    expect(lbNow.periodIndex).toBe(1)
    expect(lbNow.rows.find((r) => r.studentId === me.id)?.seconds).toBe(1800)

    // A fresh backend whose "now" is back in period 0 must see 1200s —
    // history is derived, per period, not overwritten.
    const backThen = new LocalBackend({ storage: w.storage, channel: null, now: () => w.now - H })
    const lbThen = await backThen.getLeaderboard(room.id, me)
    expect(lbThen.periodIndex).toBe(0)
    expect(lbThen.rows.find((r) => r.studentId === me.id)?.seconds).toBe(1200)
  })

  it('auto-closes abandoned sessions at the cap (never unlimited accrual)', async () => {
    const room = await w.a.createClassroom({ name: 'Crash' }, makeIdentity(0))
    const me = makeIdentity(1)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.a.startStudying(room.id, me)
    // Browser died. 30 hours pass. On next read the session is swept and capped.
    w.advance(30 * H)
    const other = makeIdentity(2)
    await w.a.joinClassroom({ code: room.joinCode }, other)
    await w.a.getRoomState(room.id, other)
    const lb = await w.a.getLeaderboard(room.id, me)
    const secs = lb.rows.find((r) => r.studentId === me.id)?.seconds ?? 0
    // capped at 6h of session; cycles every 3600s → 6 × 3000 = 18000 focus s
    expect(secs).toBeLessThanOrEqual(18_000)
    expect(secs).toBeGreaterThan(0)
  })

  it('non-members cannot read the room', async () => {
    const room = await w.a.createClassroom({ name: 'Private' }, makeIdentity(0))
    await w.a.joinClassroom({ code: room.joinCode }, makeIdentity(1))
    await expect(w.a.getRoomState(room.id, makeIdentity(9))).rejects.toMatchObject({ code: 'NOT_A_MEMBER' })
  })

  it('realtime: focus-started reaches the other tab with correct payload', async () => {
    const room = await w.a.createClassroom({ name: 'Live' }, makeIdentity(0))
    const me = makeIdentity(1)
    const other = makeIdentity(2)
    await w.a.joinClassroom({ code: room.joinCode }, me)
    await w.b.joinClassroom({ code: room.joinCode }, other)

    const received: string[] = []
    const stop = w.b.subscribeRoom(room.id, (e) => {
      if (e.kind === 'focus-started') received.push(e.by.displayName)
    })
    await w.a.startStudying(room.id, me)
    await new Promise((r) => setTimeout(r, 10))
    stop()
    expect(received).toEqual(['Student 1'])
  })
})
