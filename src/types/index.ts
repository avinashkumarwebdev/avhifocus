export type Phase = 'focus' | 'break'
export type StudyStatus = 'idle' | 'studying'
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'demo'
export type HairStyle = 'short' | 'bun' | 'side' | 'long'

/**
 * Room anti-cheat level:
 *  relaxed  — no pulses (trust-based, original behaviour, 6h safety cap)
 *  balanced — presence pulses + 2h session caps + nudges (recommended)
 *  strict   — balanced + client idle/visibility auto-pause (best-effort)
 */
export type IntegrityMode = 'relaxed' | 'balanced' | 'strict'

export interface AvatarSpec {
  skin: string
  hair: string
  hairStyle: HairStyle
  shirt: string
}

export interface Identity {
  id: string
  displayName: string
  classLabel: string
  avatar: AvatarSpec
}

export interface Classroom {
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

export interface MemberView {
  memberId: string
  studentId: string
  displayName: string
  classLabel: string
  avatar: AvatarSpec
  seatNumber: number
  online: boolean
  isBot: boolean
  lastSeenAtMs: number
  joinedAtMs: number
  status: StudyStatus
  /** Authoritative server start timestamp of the open session, if studying. */
  sessionStartedAtMs: number | null
  /** Integrity: session is frozen — accrual stopped until the student resumes. */
  pulsePaused: boolean
  /** Next presence-pulse deadline for THIS viewer's own session (null for others). */
  pulseDueAtMs: number | null
}

export interface RoomState {
  classroom: Classroom
  members: MemberView[]
}

export interface LeaderboardRow {
  studentId: string
  displayName: string
  classLabel: string
  avatar: AvatarSpec
  seconds: number
  rank: number
  isMe: boolean
}

export interface Leaderboard {
  periodIndex: number
  periodStartMs: number
  periodEndMs: number
  /** Minutes here are pulse-verified whenever integrityMode ≠ relaxed. */
  integrityMode: IntegrityMode
  rows: LeaderboardRow[]
}

export type RoomEvent =
  | { kind: 'room-changed' }
  | { kind: 'focus-started'; by: { studentId: string; displayName: string; classLabel: string } }
  | { kind: 'focus-stopped'; by: { studentId: string; displayName: string } }
  | { kind: 'nudged'; by: { studentId: string; displayName: string }; targetStudentId: string }
  | { kind: 'message'; by: { studentId: string; displayName: string }; targetStudentId: string; text: string }

export class BackendError extends Error {
  constructor(
    public code:
      | 'ROOM_NOT_FOUND'
      | 'ROOM_FULL'
      | 'ROOM_INACTIVE'
      | 'NOT_A_MEMBER'
      | 'UNAUTHORIZED'
      | 'VALIDATION'
      | 'TOO_LATE'
      | 'GUARDIAN_DENIED'
      | 'NETWORK',
    message: string
  ) {
    super(message)
    this.name = 'BackendError'
  }
}

/**
 * What a non-member may know about the shared Hall before taking a bench:
 * counts only — no identities leak through the doorway.
 */
export interface HallPeek {
  roomId: string
  name: string
  joinCode: string
  capacity: number
  integrityMode: IntegrityMode
  /** Benches currently taken. 0 ⇒ the room is dormant (features stopped). */
  members: number
  /** Students currently focusing. */
  studying: number
  cycleAnchorMs: number
  focusSeconds: number
  breakSeconds: number
}
