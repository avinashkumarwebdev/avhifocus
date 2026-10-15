import type {
  AvatarSpec,
  Classroom,
  HallPeek,
  Identity,
  IntegrityMode,
  Leaderboard,
  LeaderboardRow,
  MemberView,
  RoomEvent,
  RoomState
} from '../../types'
import { BackendError } from '../../types'
import { isQuickMessage, MESSAGE_RATE_LIMIT_MS } from '../../lib/quickMessages'
import { focusSegmentsBetween, classroomCycle, type CycleConfig } from '../../lib/time/cycle'
import { PERIOD_MS, getPeriodInfo, periodAt } from '../../lib/time/periods'
import {
  classroomNameSchema,
  classLabelSchema,
  displayNameSchema,
  generateJoinCode,
  joinCodeSchema
} from '../../lib/validation'
import { AVATAR_PRESETS } from '../../lib/avatars'
import type { Backend } from './types'
import type { ChannelLike, StorageLike } from './localStore'

/**
 * LocalBackend — a transparent, in-browser DEMO backend (used when Supabase
 * env vars are absent). It mirrors the production rules the SQL migrations
 * enforce: capacity, seats, derived clock, focus-only scoring, per-period
 * segments — plus the integrity engine: randomized presence pulses, accrual
 * halts on missed pulses, 2h session caps, nudges, and a daily accrual cap.
 */

const DB_KEY = 'avhifocus.demo.db.v1'
const ONLINE_WITHIN_MS = 60_000
/** Disconnect policy: any open session is closed and capped at 6 hours. */
export const MAX_SESSION_SECONDS = 6 * 3600
/**
 * Ghost-presence caps (every mode, server-side): accrual holds for 90s after
 * the last heartbeat, freezes (banks minutes) once offline 5 minutes, and the
 * session is closed entirely after 15 minutes away.
 */
export const STALE_BANK_GRACE_MS = 90_000
export const STALE_BANK_MS = 5 * 60_000
export const STALE_CLOSE_MS = 15 * 60_000
/** Integrity: 2-hour continuous-session cap in balanced/strict rooms. */
export const SESSION_CAP_MS = 2 * 3600 * 1000
/** Time allowed to acknowledge a pulse before accrual halts. */
export const PULSE_GRACE_MS = 120_000
/** Balanced/strict pulse spacing: 10–18 minutes, randomized server-side. */
const PULSE_MIN_MS = 10 * 60_000
const PULSE_SPREAD_MS = 8 * 60_000
/** A sender may nudge the same classmate at most once per 10 minutes. */
const NUDGE_RATE_LIMIT_MS = 10 * 60_000
/** Anti-farming: at most 10 hours per UTC day counts toward the leaderboard. */
export const DAILY_ACCRUAL_CAP_SECONDS = 10 * 3600

type MemberStatus = 'active' | 'left'
type PulseKind = 'scheduled' | 'nudge'

interface ClassroomRow {
  id: string
  name: string
  joinCode: string
  capacity: number
  cycleAnchorMs: number
  focusSeconds: number
  breakSeconds: number
  createdAtMs: number
  isActive: boolean
  integrityMode: IntegrityMode
}

interface MemberRow {
  id: string
  classroomId: string
  studentId: string
  displayName: string
  classLabel: string
  avatar: AvatarSpec
  seatNumber: number
  status: MemberStatus
  isBot: boolean
  joinedAtMs: number
  lastSeenAtMs: number
  leftAtMs: number | null
}

interface SessionRow {
  id: string
  classroomId: string
  studentId: string
  /** Start of the CURRENT accrual window (advances on resume after a halt). */
  startedAtMs: number
  /** Original session start (for global caps / auditing). */
  origStartedAtMs: number
  endedAtMs: number | null
  /** Focus seconds already banked by previous accrual windows of this session. */
  eligibleSeconds: number | null
  /** Integrity state. */
  pulseDueAtMs: number | null
  capUntilMs: number | null
  pulsePaused: boolean
  /** Set when the freeze came from a disconnection (not a pulse miss). */
  staleCapped?: boolean
  isBot: boolean
}

interface PulseRow {
  id: string
  sessionId: string
  classroomId: string
  studentId: string // recipient
  kind: PulseKind
  dueAtMs: number
  ackedAtMs: number | null
  createdByStudentId: string | null
}

interface SegmentRow {
  id: string
  sessionId: string
  classroomId: string
  studentId: string
  periodIndex: number
  startMs: number
  endMs: number
}

interface DB {
  classrooms: Record<string, ClassroomRow>
  members: Record<string, MemberRow>
  sessions: Record<string, SessionRow>
  segments: Record<string, SegmentRow>
  pulses: Record<string, PulseRow>
}

const emptyDB = (): DB => ({ classrooms: {}, members: {}, sessions: {}, segments: {}, pulses: {} })

type Listener = (payload: { roomId: string; event: RoomEvent }) => void

export interface LocalBackendOptions {
  storage: StorageLike
  channel?: ChannelLike | null
  now?: () => number
  random?: () => number
}

/** Migrate old DB shapes (v1 had no pulses table / integrity fields). */
function migrate(raw: Partial<DB>): DB {
  const db = { ...emptyDB(), ...raw } as DB
  if (!db.pulses) db.pulses = {}
  for (const c of Object.values(db.classrooms)) {
    if (!c.integrityMode) c.integrityMode = 'relaxed'
  }
  for (const s of Object.values(db.sessions)) {
    if (s.origStartedAtMs === undefined) s.origStartedAtMs = s.startedAtMs
    if (s.pulseDueAtMs === undefined) s.pulseDueAtMs = null
    if (s.capUntilMs === undefined) s.capUntilMs = null
    if (s.pulsePaused === undefined) s.pulsePaused = false
    if (s.isBot === undefined) s.isBot = false
  }
  return db
}

export class LocalBackend implements Backend {
  readonly mode = 'demo' as const

  private storage: StorageLike
  private channel: ChannelLike | null
  private nowFn: () => number
  private random: () => number
  private listeners = new Set<Listener>()

  constructor(opts: LocalBackendOptions) {
    this.storage = opts.storage
    this.channel = opts.channel ?? null
    this.nowFn = opts.now ?? (() => Date.now())
    this.random = opts.random ?? Math.random
    this.channel?.onMessage((raw) => {
      const msg = raw as { t?: string; roomId?: string; event?: RoomEvent }
      if (msg?.t === 'avhi-demo' && msg.roomId && msg.event) {
        this.emitLocal(msg.roomId, msg.event)
      }
    })
  }

  // ── storage ────────────────────────────────────────────────────────────
  private load(): DB {
    try {
      const raw = this.storage.getItem(DB_KEY)
      if (!raw) return emptyDB()
      return migrate(JSON.parse(raw) as Partial<DB>)
    } catch {
      return emptyDB()
    }
  }

  private save(db: DB) {
    try {
      this.storage.setItem(DB_KEY, JSON.stringify(db))
    } catch {
      /* storage blocked — demo degrades gracefully */
    }
  }

  private emit(roomId: string, event: RoomEvent) {
    this.channel?.post({ t: 'avhi-demo', roomId, event })
    this.emitLocal(roomId, event)
  }

  private emitLocal(roomId: string, event: RoomEvent) {
    this.listeners.forEach((l) => {
      try {
        l({ roomId, event })
      } catch {
        /* listeners must not break the store */
      }
    })
  }

  subscribeRoom(classroomId: string, cb: (e: RoomEvent) => void): () => void {
    const listener: Listener = ({ roomId, event }) => {
      if (roomId === classroomId) cb(event)
    }
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ── helpers ────────────────────────────────────────────────────────────
  private now() {
    return this.nowFn()
  }

  private cycle(room: ClassroomRow): CycleConfig {
    return classroomCycle(room)
  }

  private pulseIntervalMs(): number {
    // 10:00–18:00, randomized (unknown to the student until it appears)
    return PULSE_MIN_MS + Math.floor(this.random() * PULSE_SPREAD_MS)
  }

  private activeMembers(db: DB, classroomId: string): MemberRow[] {
    return Object.values(db.members).filter((m) => m.classroomId === classroomId && m.status === 'active')
  }

  private openSession(db: DB, classroomId: string, studentId: string): SessionRow | undefined {
    return Object.values(db.sessions).find(
      (s) => s.classroomId === classroomId && s.studentId === studentId && s.endedAtMs === null
    )
  }

  /** Write per-period focus segments for [startMs, endMs); returns eligible seconds. */
  private writeSegments(db: DB, room: ClassroomRow, session: SessionRow, startMs: number, endMs: number): number {
    const segments = focusSegmentsBetween(this.cycle(room), startMs, endMs)
    let eligible = 0
    for (const seg of segments) {
      eligible += (seg.endMs - seg.startMs) / 1000
      let cursor = seg.startMs
      while (cursor < seg.endMs) {
        const p = periodAt(room.createdAtMs, cursor)
        const pieceEnd = Math.min(seg.endMs, room.createdAtMs + (p + 1) * PERIOD_MS)
        const row: SegmentRow = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          classroomId: room.id,
          studentId: session.studentId,
          periodIndex: p,
          startMs: cursor,
          endMs: pieceEnd
        }
        db.segments[row.id] = row
        cursor = pieceEnd
      }
    }
    return eligible
  }

  /**
   * INTEGRITY HALT — freezes accrual. Focus time in the CURRENT window up to
   * `capMs` is banked as segments; the window collapses, the session pauses.
   * A later resume starts a fresh window: the gap can never count.
   */
  private haltSession(db: DB, room: ClassroomRow, session: SessionRow, capMs: number) {
    if (session.endedAtMs !== null || session.pulsePaused) return
    const cap = Math.max(session.startedAtMs, capMs)
    const banked = this.writeSegments(db, room, session, session.startedAtMs, cap)
    session.eligibleSeconds = (session.eligibleSeconds ?? 0) + banked
    session.startedAtMs = cap
    session.pulsePaused = true
    session.pulseDueAtMs = null
  }

  /** Final close (stop / leave): bank remaining window and end the session. */
  private closeSession(db: DB, room: ClassroomRow, session: SessionRow, endMs: number) {
    if (session.endedAtMs !== null) return
    const cappedEnd = Math.min(endMs, session.origStartedAtMs + MAX_SESSION_SECONDS * 1000)
    if (!session.pulsePaused) {
      this.haltSession(db, room, session, cappedEnd)
      session.pulsePaused = false // halt semantics are for live pauses only
    }
    session.endedAtMs = cappedEnd
  }

  /** Overdue pulses, session caps, and abandoned sessions — on any read. */
  private sweepStaleSessions(db: DB, room: ClassroomRow) {
    const now = this.now()
    for (const s of Object.values(db.sessions)) {
      if (s.classroomId !== room.id || s.endedAtMs !== null) continue
      // absolute safety for anything ancient (all modes)
      if (now - s.origStartedAtMs > MAX_SESSION_SECONDS * 1000) {
        this.closeSession(db, room, s, now)
        continue
      }
      if (s.isBot) continue // demo buddies don't play by pulse rules
      // ghost-presence: disconnected students stop accruing, whatever the mode
      const member = Object.values(db.members).find(
        (m) => m.classroomId === room.id && m.studentId === s.studentId && m.status === 'active'
      )
      if (member) {
        const staleMs = now - member.lastSeenAtMs
        if (staleMs > STALE_CLOSE_MS) {
          this.closeSession(db, room, s, member.lastSeenAtMs + STALE_BANK_GRACE_MS)
          s.staleCapped = false
          continue
        }
        if (staleMs > STALE_BANK_MS && !s.pulsePaused) {
          this.haltSession(db, room, s, member.lastSeenAtMs + STALE_BANK_GRACE_MS)
          s.staleCapped = true
          continue
        }
      }
      if (s.pulsePaused) continue
      if (s.pulseDueAtMs !== null && now > s.pulseDueAtMs + PULSE_GRACE_MS) {
        this.haltSession(db, room, s, s.pulseDueAtMs + PULSE_GRACE_MS)
        continue
      }
      if (s.capUntilMs !== null && now > s.capUntilMs) {
        this.haltSession(db, room, s, s.capUntilMs)
      }
    }
  }

  private toClassroom(row: ClassroomRow): Classroom {
    return { ...row }
  }

  private toMemberView(db: DB, row: MemberRow, viewerStudentId: string): MemberView {
    const session = this.openSession(db, row.classroomId, row.studentId)
    return {
      memberId: row.id,
      studentId: row.studentId,
      displayName: row.displayName,
      classLabel: row.classLabel,
      avatar: row.avatar,
      seatNumber: row.seatNumber,
      online: row.isBot ? true : this.now() - row.lastSeenAtMs <= ONLINE_WITHIN_MS,
      isBot: row.isBot,
      lastSeenAtMs: row.lastSeenAtMs,
      joinedAtMs: row.joinedAtMs,
      status: session ? 'studying' : 'idle',
      sessionStartedAtMs: session ? session.origStartedAtMs : null,
      pulsePaused: session ? session.pulsePaused : false,
      // pulse timing is private: only the session owner sees their deadline
      pulseDueAtMs: session && row.studentId === viewerStudentId ? session.pulseDueAtMs : null
    }
  }

  private requireRoom(db: DB, classroomId: string): ClassroomRow {
    const room = db.classrooms[classroomId]
    if (!room || !room.isActive) throw new BackendError('ROOM_NOT_FOUND', 'That classroom could not be found.')
    return room
  }

  private requireMembership(db: DB, classroomId: string, studentId: string): MemberRow {
    const member = Object.values(db.members).find(
      (m) => m.classroomId === classroomId && m.studentId === studentId && m.status === 'active'
    )
    if (!member) throw new BackendError('NOT_A_MEMBER', 'You are not a member of this classroom.')
    return member
  }

  // ── identity / classrooms ────────────────────────────────────────────────
  async ensureIdentity(identity: Identity): Promise<Identity> {
    return identity
  }

  async syncServerTime(): Promise<number> {
    return 0
  }

  async createClassroom(input: { name: string }, identity: Identity): Promise<Classroom> {
    const name = classroomNameSchema.parse(input.name)
    const db = this.load()
    const now = this.now()
    let code = generateJoinCode(this.random)
    while (Object.values(db.classrooms).some((c) => c.joinCode === code)) {
      code = generateJoinCode(this.random)
    }
    const room: ClassroomRow = {
      id: crypto.randomUUID(),
      name,
      joinCode: code,
      capacity: 10,
      cycleAnchorMs: now,
      focusSeconds: 50 * 60,
      breakSeconds: 10 * 60,
      createdAtMs: now,
      isActive: true,
      integrityMode: 'balanced'
    }
    db.classrooms[room.id] = room
    this.save(db)
    return this.toClassroom(room)
  }

  /**
   * Demo-mode doorway peek. The demo Hall is lazily seeded (0 benches taken)
   * the first time anyone looks in, mirroring the seeded production Hall.
   */
  async peekClassroom(code: string): Promise<HallPeek> {
    const normalized = code.trim().toUpperCase()
    const db = this.load()
    let room = Object.values(db.classrooms).find((c) => c.joinCode === normalized && c.isActive)
    if (!room) {
      const now = this.now()
      room = {
        id: crypto.randomUUID(),
        name: 'AVHIFocus Hall',
        joinCode: normalized,
        capacity: 10,
        cycleAnchorMs: now,
        focusSeconds: 50 * 60,
        breakSeconds: 10 * 60,
        createdAtMs: now,
        isActive: true,
        integrityMode: 'balanced'
      }
      db.classrooms[room.id] = room
      this.save(db)
    }
    this.sweepStaleSessions(db, room)
    const members = this.activeMembers(db, room.id)
    const studying = members.filter((m) => this.openSession(db, room.id, m.studentId)).length
    return {
      roomId: room.id,
      name: room.name,
      joinCode: room.joinCode,
      capacity: room.capacity,
      integrityMode: room.integrityMode,
      members: members.length,
      studying,
      cycleAnchorMs: room.cycleAnchorMs,
      focusSeconds: room.focusSeconds,
      breakSeconds: room.breakSeconds
    }
  }

  async joinClassroom(
    input: { code: string },
    identity: Identity
  ): Promise<{ classroom: Classroom; member: MemberView }> {
    const code = joinCodeSchema.parse(input.code)
    const displayName = displayNameSchema.parse(identity.displayName)
    const classLabel = classLabelSchema.parse(identity.classLabel)

    // CRITICAL SECTION — synchronous between load and save (row-lock equivalent).
    const db = this.load()
    const room = Object.values(db.classrooms).find((c) => c.joinCode === code)
    if (!room) throw new BackendError('ROOM_NOT_FOUND', 'No classroom uses that code. Check and try again.')
    if (!room.isActive) throw new BackendError('ROOM_INACTIVE', 'This classroom is no longer active.')

    const now = this.now()
    const existing = Object.values(db.members).find(
      (m) => m.classroomId === room.id && m.studentId === identity.id && m.status === 'active'
    )
    if (existing) {
      existing.displayName = displayName
      existing.classLabel = classLabel
      existing.avatar = identity.avatar
      existing.lastSeenAtMs = now
      this.save(db)
      return { classroom: this.toClassroom(room), member: this.toMemberView(db, existing, identity.id) }
    }

    const taken = this.activeMembers(db, room.id)
    if (taken.length >= room.capacity) {
      throw new BackendError('ROOM_FULL', 'This classroom already has 10 students. A seat must free up first.')
    }
    const usedSeats = new Set(taken.map((m) => m.seatNumber))
    let seat = 1
    while (usedSeats.has(seat)) seat++

    const row: MemberRow = {
      id: crypto.randomUUID(),
      classroomId: room.id,
      studentId: identity.id,
      displayName,
      classLabel,
      avatar: identity.avatar,
      seatNumber: seat,
      status: 'active',
      isBot: false,
      joinedAtMs: now,
      lastSeenAtMs: now,
      leftAtMs: null
    }
    db.members[row.id] = row
    this.save(db)
    this.emit(room.id, { kind: 'room-changed' })
    return { classroom: this.toClassroom(room), member: this.toMemberView(db, row, identity.id) }
  }

  async resumeClassroom(
    classroomId: string,
    identity: Identity
  ): Promise<{ classroom: Classroom; member: MemberView } | null> {
    const db = this.load()
    const room = db.classrooms[classroomId]
    if (!room || !room.isActive) return null
    const member = Object.values(db.members).find(
      (m) => m.classroomId === classroomId && m.studentId === identity.id && m.status === 'active'
    )
    if (!member) return null
    member.lastSeenAtMs = this.now()
    this.save(db)
    return { classroom: this.toClassroom(room), member: this.toMemberView(db, member, identity.id) }
  }

  async leaveClassroom(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    const member = this.requireMembership(db, classroomId, identity.id)
    const open = this.openSession(db, classroomId, identity.id)
    const now = this.now()
    if (open) this.closeSession(db, room, open, now)
    member.status = 'left'
    member.leftAtMs = now
    this.save(db)
    this.emit(room.id, { kind: 'room-changed' })
  }

  // ── room state / sessions ────────────────────────────────────────────────
  async getRoomState(classroomId: string, identity: Identity): Promise<RoomState> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.sweepStaleSessions(db, room)
    const member = this.requireMembership(db, classroomId, identity.id)
    member.lastSeenAtMs = this.now()
    this.save(db)
    const members = this.activeMembers(db, room.id)
      .map((m) => this.toMemberView(db, m, identity.id))
      .sort((a, b) => a.seatNumber - b.seatNumber)
    return { classroom: this.toClassroom(room), members }
  }

  async startStudying(classroomId: string, identity: Identity): Promise<MemberView> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.sweepStaleSessions(db, room)
    const member = this.requireMembership(db, classroomId, identity.id)
    member.lastSeenAtMs = this.now()

    const open = this.openSession(db, classroomId, identity.id)
    if (open) {
      // already studying — a paused session resumes via start, politely
      this.save(db)
      return this.toMemberView(db, member, identity.id)
    }
    const now = this.now()
    const integrityOn = room.integrityMode !== 'relaxed' && !member.isBot
    const session: SessionRow = {
      id: crypto.randomUUID(),
      classroomId,
      studentId: identity.id,
      startedAtMs: now,
      origStartedAtMs: now,
      endedAtMs: null,
      eligibleSeconds: 0,
      pulseDueAtMs: integrityOn ? now + this.pulseIntervalMs() : null,
      capUntilMs: integrityOn ? now + SESSION_CAP_MS : null,
      pulsePaused: false,
      isBot: member.isBot
    }
    db.sessions[session.id] = session
    if (integrityOn) {
      this.recordPulse(db, session, 'scheduled', session.pulseDueAtMs as number, null)
    }
    this.save(db)
    this.emit(classroomId, { kind: 'room-changed' })
    this.emit(classroomId, {
      kind: 'focus-started',
      by: { studentId: identity.id, displayName: member.displayName, classLabel: member.classLabel }
    })
    return this.toMemberView(db, member, identity.id)
  }

  async stopStudying(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    const member = this.requireMembership(db, classroomId, identity.id)
    member.lastSeenAtMs = this.now()
    this.sweepStaleSessions(db, room)
    const open = this.openSession(db, classroomId, identity.id)
    if (open) {
      this.closeSession(db, room, open, this.now())
    }
    this.save(db)
    this.emit(classroomId, { kind: 'room-changed' })
    this.emit(classroomId, {
      kind: 'focus-stopped',
      by: { studentId: identity.id, displayName: member.displayName }
    })
  }

  async setProfile(classroomId: string, identity: Identity): Promise<void> {
    const displayName = displayNameSchema.parse(identity.displayName)
    const classLabel = classLabelSchema.parse(identity.classLabel)
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    const member = this.requireMembership(db, classroomId, identity.id)
    member.displayName = displayName
    member.classLabel = classLabel
    member.avatar = identity.avatar
    member.lastSeenAtMs = this.now()
    this.save(db)
    this.emit(room.id, { kind: 'room-changed' })
  }

  async heartbeat(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const member = Object.values(db.members).find(
      (m) => m.classroomId === classroomId && m.studentId === identity.id && m.status === 'active'
    )
    if (!member) return
    member.lastSeenAtMs = this.now()
    // a heartbeat clears the stale-cap flag (resume stays explicit if paused)
    const open = this.openSession(db, classroomId, identity.id)
    if (open?.staleCapped) open.staleCapped = false
    this.save(db)
  }

  // ── integrity API ────────────────────────────────────────────────────────
  private recordPulse(
    db: DB,
    session: SessionRow,
    kind: PulseKind,
    dueAtMs: number,
    createdByStudentId: string | null
  ): PulseRow {
    const row: PulseRow = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      classroomId: session.classroomId,
      studentId: session.studentId,
      kind,
      dueAtMs,
      ackedAtMs: null,
      createdByStudentId
    }
    db.pulses[row.id] = row
    return row
  }

  async ackPulse(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    const member = this.requireMembership(db, classroomId, identity.id)
    this.sweepStaleSessions(db, room)
    const session = this.openSession(db, classroomId, identity.id)
    if (!session || session.pulseDueAtMs === null) {
      this.save(db)
      return // nothing pending — idempotent
    }
    const now = this.now()
    if (now > session.pulseDueAtMs + PULSE_GRACE_MS) {
      // too late — the sweep above already halted; state is visible to caller
      this.save(db)
      return
    }
    const pending = Object.values(db.pulses).find(
      (p) => p.sessionId === session.id && p.ackedAtMs === null && p.dueAtMs === session.pulseDueAtMs
    )
    if (pending) pending.ackedAtMs = now
    const nextDue = now + this.pulseIntervalMs()
    session.pulseDueAtMs = nextDue
    this.recordPulse(db, session, 'scheduled', nextDue, null)
    member.lastSeenAtMs = now
    this.save(db)
    this.emit(classroomId, { kind: 'room-changed' })
  }

  async resumeSession(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    const member = this.requireMembership(db, classroomId, identity.id)
    this.sweepStaleSessions(db, room)
    const session = this.openSession(db, classroomId, identity.id)
    if (!session || !session.pulsePaused) {
      this.save(db)
      return
    }
    const now = this.now()
    const integrityOn = room.integrityMode !== 'relaxed'
    session.startedAtMs = now // new accrual window — the paused gap never counts
    session.pulsePaused = false
    session.pulseDueAtMs = integrityOn ? now + this.pulseIntervalMs() : null
    session.capUntilMs = integrityOn ? now + SESSION_CAP_MS : null
    if (integrityOn) this.recordPulse(db, session, 'scheduled', session.pulseDueAtMs as number, null)
    member.lastSeenAtMs = now
    this.save(db)
    this.emit(classroomId, { kind: 'room-changed' })
  }

  async selfPause(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.sweepStaleSessions(db, room)
    const session = this.openSession(db, classroomId, identity.id)
    if (session && !session.pulsePaused) {
      this.haltSession(db, room, session, this.now())
    }
    this.save(db)
    this.emit(classroomId, { kind: 'room-changed' })
  }

  async nudge(classroomId: string, identity: Identity, targetStudentId: string): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.requireMembership(db, classroomId, identity.id)
    const target = this.requireMembership(db, classroomId, targetStudentId)
    if (targetStudentId === identity.id) throw new BackendError('VALIDATION', "That's you — you can't nudge yourself.")
    const now = this.now()

    const recent = Object.values(db.pulses).find(
      (p) =>
        p.classroomId === room.id &&
        p.kind === 'nudge' &&
        p.createdByStudentId === identity.id &&
        p.studentId === targetStudentId &&
        now - p.dueAtMs < NUDGE_RATE_LIMIT_MS
    )
    if (recent) throw new BackendError('VALIDATION', 'You already nudged them recently — give them a moment.')

    const session = this.openSession(db, classroomId, targetStudentId)
    this.sweepStaleSessions(db, room)
    if (session && !session.pulsePaused && room.integrityMode !== 'relaxed') {
      // immediate short pulse: ack within the grace window or accrual halts
      const recheck = this.openSession(db, classroomId, targetStudentId)
      if (recheck && !recheck.pulsePaused) {
        recheck.pulseDueAtMs = now
        this.recordPulse(db, recheck, 'nudge', now, identity.id)
      }
    }
    this.save(db)
    this.emit(classroomId, { kind: 'room-changed' })
    this.emit(classroomId, {
      kind: 'nudged',
      by: { studentId: identity.id, displayName: this.memberName(db, classroomId, identity.id) },
      targetStudentId
    })
  }

  private memberName(db: DB, classroomId: string, studentId: string): string {
    return (
      Object.values(db.members).find((m) => m.classroomId === classroomId && m.studentId === studentId && m.status === 'active')
        ?.displayName ?? 'A classmate'
    )
  }

  private msgSentAt = new Map<string, number>()

  async sendMessage(classroomId: string, identity: Identity, targetStudentId: string, text: string): Promise<void> {
    const db = this.load()
    this.requireRoom(db, classroomId)
    this.requireMembership(db, classroomId, identity.id)
    this.requireMembership(db, classroomId, targetStudentId)
    if (targetStudentId === identity.id) throw new BackendError('VALIDATION', "That's you — no note to yourself needed.")
    if (!isQuickMessage(text)) throw new BackendError('VALIDATION', 'Pick one of the preset notes.')

    const key = `${classroomId}:${identity.id}:${targetStudentId}`
    const now = this.now()
    const last = this.msgSentAt.get(key) ?? 0
    if (now - last < MESSAGE_RATE_LIMIT_MS) {
      throw new BackendError('VALIDATION', 'Easy there — give them a moment before sending another note.')
    }
    this.msgSentAt.set(key, now)

    this.emit(classroomId, {
      kind: 'message',
      by: { studentId: identity.id, displayName: this.memberName(db, classroomId, identity.id) },
      targetStudentId,
      text
    })
  }

  async setIntegrityMode(classroomId: string, identity: Identity, mode: IntegrityMode): Promise<void> {
    if (!['relaxed', 'balanced', 'strict'].includes(mode)) throw new BackendError('VALIDATION', 'Unknown integrity mode.')
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.requireMembership(db, classroomId, identity.id)
    room.integrityMode = mode
    // Open sessions adopt the new rules from now (no retro-active gaps).
    if (mode !== 'relaxed') {
      const now = this.now()
      for (const s of Object.values(db.sessions)) {
        if (s.classroomId === room.id && s.endedAtMs === null && !s.pulsePaused && !s.isBot) {
          if (s.pulseDueAtMs === null) s.pulseDueAtMs = now + this.pulseIntervalMs()
          if (s.capUntilMs === null) s.capUntilMs = now + SESSION_CAP_MS
        }
      }
    }
    this.save(db)
    this.emit(room.id, { kind: 'room-changed' })
  }

  // ── leaderboard (per-period segments + daily cap) ────────────────────────
  async getLeaderboard(classroomId: string, identity: Identity): Promise<Leaderboard> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.sweepStaleSessions(db, room)
    this.requireMembership(db, classroomId, identity.id)
    this.save(db)

    const period = getPeriodInfo(room.createdAtMs, this.now())
    // Anti-farming: subtotal per UTC day, clamp each day at the daily cap.
    const daily = new Map<string, number>() // `${studentId}|${dayIndex}`
    for (const seg of Object.values(db.segments)) {
      if (seg.classroomId !== room.id || seg.periodIndex !== period.index) continue
      const day = Math.floor(seg.startMs / 86_400_000)
      const key = `${seg.studentId}|${day}`
      daily.set(key, (daily.get(key) ?? 0) + (seg.endMs - seg.startMs) / 1000)
    }
    const totals = new Map<string, number>()
    for (const [key, seconds] of daily) {
      const studentId = key.split('|')[0]
      totals.set(studentId, (totals.get(studentId) ?? 0) + Math.min(seconds, DAILY_ACCRUAL_CAP_SECONDS))
    }

    const rows: LeaderboardRow[] = this.activeMembers(db, room.id)
      .map((m) => ({
        studentId: m.studentId,
        displayName: m.displayName,
        classLabel: m.classLabel,
        avatar: m.avatar,
        seconds: Math.round(totals.get(m.studentId) ?? 0),
        rank: 0,
        isMe: m.studentId === identity.id
      }))
      .sort((a, b) => b.seconds - a.seconds || a.displayName.localeCompare(b.displayName))
    // Tie rule: shared ranks (standard competition ranking).
    let lastSeconds = -1
    let lastRank = 0
    rows.forEach((row, i) => {
      if (row.seconds !== lastSeconds) {
        lastRank = i + 1
        lastSeconds = row.seconds
      }
      row.rank = lastRank
    })

    return {
      periodIndex: period.index,
      periodStartMs: period.startMs,
      periodEndMs: period.endMs,
      integrityMode: room.integrityMode,
      rows
    }
  }

  async savePushSubscription(_subscription: PushSubscriptionJSON, _identity: Identity): Promise<void> {
    // demo: no push server — foreground notifications still work in-tab
  }

  // ── demo buddies (clearly labelled; exempt from pulses) ──────────────────
  private static BUDDIES: Array<{ name: string; klass: string; avatar: AvatarSpec }> = [
    { name: 'Anaya', klass: 'Class 10', avatar: AVATAR_PRESETS[1] },
    { name: 'Rohan', klass: 'JEE', avatar: AVATAR_PRESETS[3] },
    { name: 'Meera', klass: 'Class 12', avatar: AVATAR_PRESETS[4] }
  ]

  async addDemoBuddies(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.requireMembership(db, classroomId, identity.id)
    const now = this.now()

    let created = 0
    for (const buddy of LocalBackend.BUDDIES) {
      if (
        Object.values(db.members).some(
          (m) => m.classroomId === room.id && m.displayName === buddy.name && m.isBot && m.status === 'active'
        )
      ) {
        continue
      }
      const taken = this.activeMembers(db, room.id)
      if (taken.length >= room.capacity) break
      const usedSeats = new Set(taken.map((m) => m.seatNumber))
      let seat = 1
      while (usedSeats.has(seat)) seat++
      const botId = `bot-${buddy.name.toLowerCase()}`
      const row: MemberRow = {
        id: crypto.randomUUID(),
        classroomId: room.id,
        studentId: botId,
        displayName: buddy.name,
        classLabel: buddy.klass,
        avatar: buddy.avatar,
        seatNumber: seat,
        status: 'active',
        isBot: true,
        joinedAtMs: now,
        lastSeenAtMs: now,
        leftAtMs: null
      }
      db.members[row.id] = row
      const session: SessionRow = {
        id: crypto.randomUUID(),
        classroomId: room.id,
        studentId: botId,
        startedAtMs: now - (5 + created * 7) * 60_000,
        origStartedAtMs: now - (5 + created * 7) * 60_000,
        endedAtMs: null,
        eligibleSeconds: 0,
        pulseDueAtMs: null,
        capUntilMs: null,
        pulsePaused: false,
        isBot: true
      }
      db.sessions[session.id] = session
      created++
    }
    this.save(db)
    if (created > 0) this.emit(room.id, { kind: 'room-changed' })
  }

  async removeDemoBuddies(classroomId: string, identity: Identity): Promise<void> {
    const db = this.load()
    const room = this.requireRoom(db, classroomId)
    this.requireMembership(db, classroomId, identity.id)
    const now = this.now()
    for (const m of Object.values(db.members)) {
      if (m.classroomId === room.id && m.isBot && m.status === 'active') {
        const open = Object.values(db.sessions).find(
          (s) => s.classroomId === room.id && s.studentId === m.studentId && s.endedAtMs === null
        )
        if (open) this.closeSession(db, room, open, now)
        m.status = 'left'
        m.leftAtMs = now
      }
    }
    this.save(db)
    this.emit(room.id, { kind: 'room-changed' })
  }
}
