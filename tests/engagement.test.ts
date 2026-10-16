import { describe, expect, it, beforeEach } from 'vitest'
import { LocalBackend } from '../src/services/backend/local'
import { memoryStorage, TestChannelHub, type StorageLike } from '../src/services/backend/localStore'
import { BackendError, type Identity } from '../src/types'
import { randomAvatar } from '../src/lib/avatars'
import { GEAR, nextUnlock, sanitizeGear, unlockedGearIds } from '../src/lib/cosmetics'

const DAY = 86_400_000

function makeIdentity(n: number): Identity {
  return { id: `student-${n}`, displayName: `Student ${n}`, classLabel: 'Class 10', avatar: randomAvatar(() => 0.4) }
}

function makeWorld() {
  const storage: StorageLike = memoryStorage()
  const hub = new TestChannelHub()
  // Wall-clock aligned so IST midnight is a round number of steps away.
  let now = 1_000_000_000_000
  const mk = () => new LocalBackend({ storage, channel: hub.makeChannel(), now: () => now })
  return {
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

/** Present-student time advance (heartbeats every 2 min beat the ghost caps). */
async function tick(w: ReturnType<typeof makeWorld>, roomId: string, identity: Identity, ms: number) {
  let left = ms
  while (left > 0) {
    const hop = Math.min(left, 2 * 60_000)
    w.advance(hop)
    left -= hop
    await w.a.heartbeat(roomId, identity).catch(() => {})
  }
}

/** Study for `minutes`, then stop — banks focus segments for the elapsed window. */
async function studyFor(w: ReturnType<typeof makeWorld>, roomId: string, identity: Identity, minutes: number) {
  await w.a.startStudying(roomId, identity)
  await tick(w, roomId, identity, minutes * 60_000)
  await w.a.stopStudying(roomId, identity)
}

describe('LocalBackend — engagement (goal / streak / week / subject)', () => {
  let w: ReturnType<typeof makeWorld>
  let owner: Identity
  let room: { id: string; joinCode: string }

  beforeEach(async () => {
    w = makeWorld()
    owner = makeIdentity(1)
    room = await w.a.createClassroom({ name: 'Engagement Lab' }, owner)
    await w.a.joinClassroom({ code: room.joinCode }, owner)
    await w.a.setIntegrityMode(room.id, owner, 'relaxed') // deterministic: no pulses
  })

  it('daily goal persists and rejects out-of-range values', async () => {
    const before = await w.a.getMyStudyStats(owner)
    expect(before.goalMinutes).toBe(120) // default

    await w.a.setDailyGoal(90, owner)
    const after = await w.a.getMyStudyStats(owner)
    expect(after.goalMinutes).toBe(90)

    await expect(w.a.setDailyGoal(10, owner)).rejects.toThrow(BackendError)
    await expect(w.a.setDailyGoal(1000, owner)).rejects.toThrow(BackendError)
    // rejected writes leave the stored value untouched
    expect((await w.a.getMyStudyStats(owner)).goalMinutes).toBe(90)
  })

  it('stats: today/lifetime seconds and a 2-day streak across IST midnights', async () => {
    // Day 1: 16 minutes of focus (≥ 15 ⇒ streak day)
    await studyFor(w, room.id, owner, 16)
    const day1 = await w.a.getMyStudyStats(owner)
    expect(day1.todaySeconds).toBeGreaterThanOrEqual(15 * 60)
    expect(day1.streakDays).toBe(1)
    expect(day1.lifetimeSeconds).toBeGreaterThanOrEqual(15 * 60)

    // Exactly one day later: another 16 minutes ⇒ two-day streak
    await tick(w, room.id, owner, DAY)
    await studyFor(w, room.id, owner, 16)
    const day2 = await w.a.getMyStudyStats(owner)
    expect(day2.streakDays).toBe(2)
    expect(day2.todaySeconds).toBeGreaterThanOrEqual(15 * 60)
    // week (Mon→now) and lifetime accumulate both days
    expect(day2.weekSeconds).toBeGreaterThanOrEqual(day1.todaySeconds)
    expect(day2.lifetimeSeconds).toBeGreaterThanOrEqual(day1.todaySeconds + 15 * 60)
  })

  it('grace: yesterday’s streak holds until today crosses 15 minutes', async () => {
    await studyFor(w, room.id, owner, 16)
    await tick(w, room.id, owner, DAY) // into the next IST day, nothing studied yet
    const grace = await w.a.getMyStudyStats(owner)
    expect(grace.todaySeconds).toBe(0)
    expect(grace.streakDays).toBe(1) // yesterday still counts until midnight

    // A short 5-min dabble does NOT extend the streak…
    await studyFor(w, room.id, owner, 5)
    const dabble = await w.a.getMyStudyStats(owner)
    expect(dabble.streakDays).toBe(1)
  })

  it('week stats rank every member, best first (bots excluded)', async () => {
    const rival = makeIdentity(2)
    await w.b.joinClassroom({ code: room.joinCode }, rival)

    await studyFor(w, room.id, owner, 20) // more focus
    await w.b.startStudying(room.id, rival)
    await tick(w, room.id, rival, 8 * 60_000) // stay present — ghost cap would freeze otherwise
    await w.b.stopStudying(room.id, rival)

    const rows = await w.a.getWeekStats(room.id)
    expect(rows).toHaveLength(2)
    expect(rows[0].studentId).toBe('student-1')
    expect(rows[0].seconds).toBeGreaterThan(rows[1].seconds)
    expect(rows[1].studentId).toBe('student-2')
    expect(rows[1].seconds).toBeGreaterThanOrEqual(7.9 * 60 - 1)
  })

  it('subject set → classroom + hall card; empty clears; >40 chars rejected', async () => {
    await expect(w.a.setSubject(room.id, 'x'.repeat(41))).rejects.toThrow(BackendError)

    await w.a.setSubject(room.id, 'Trigonometry ch. 8')
    const state = await w.a.getRoomState(room.id, owner)
    expect(state.classroom.subject).toBe('Trigonometry ch. 8')

    const peek = await w.a.peekClassroom(room.joinCode)
    expect(peek.subject).toBe('Trigonometry ch. 8')

    await w.a.setSubject(room.id, '   ')
    expect((await w.a.peekClassroom(room.joinCode)).subject).toBeNull()
  })

  it('seat views carry streak + today seconds for classmates', async () => {
    await studyFor(w, room.id, owner, 16)
    const rival = makeIdentity(2)
    await w.b.joinClassroom({ code: room.joinCode }, rival)

    const state = await w.b.getRoomState(room.id, rival)
    const me = state.members.find((m) => m.studentId === owner.id)
    expect(me?.streakDays).toBe(1)
    expect(me?.todayFocusSeconds).toBeGreaterThanOrEqual(15 * 60)
  })
})

describe('cosmetics — earned gear math', () => {
  it('unlocks at exactly 10h / 25h / 50h of lifetime focus', () => {
    expect(unlockedGearIds(0)).toEqual([])
    expect(unlockedGearIds(10 * 3600 - 1)).toEqual([])
    expect(unlockedGearIds(10 * 3600)).toEqual(['cap'])
    expect(unlockedGearIds(25 * 3600)).toEqual(['cap', 'glasses'])
    expect(unlockedGearIds(50 * 3600)).toEqual(['cap', 'glasses', 'headphones'])
  })

  it('sanitizes unknown ids out of the avatar payload', () => {
    expect(sanitizeGear(['cap', '💯', 'glasses', 42, null])).toEqual(['cap', 'glasses'])
    expect(sanitizeGear(undefined)).toEqual([])
    expect(sanitizeGear('cap')).toEqual([])
  })

  it('nextUnlock points at the closest unearned item, then null', () => {
    const next = nextUnlock(11 * 3600)
    expect(next?.id).toBe('glasses')
    expect(next?.remainingSeconds).toBe((25 - 11) * 3600)
    expect(nextUnlock(50 * 3600 + 1)).toBeNull()
    expect(GEAR.map((g) => g.unlockHours)).toEqual([...GEAR.map((g) => g.unlockHours)].sort((x, y) => x - y))
  })
})
