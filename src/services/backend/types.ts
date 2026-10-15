import type {
  Classroom,
  HallPeek,
  Identity,
  IntegrityMode,
  Leaderboard,
  MemberView,
  RoomEvent,
  RoomState
} from '../../types'

/**
 * Backend contract. Two implementations exist:
 *  - SupabaseBackend — real multi-device backend (PostgreSQL + RLS + Realtime).
 *  - LocalBackend    — built-in demo backend living in the browser, clearly
 *                      labelled in the UI. Enforces identical rules so the
 *                      whole product can be tried before Supabase is configured.
 */
export interface Backend {
  readonly mode: 'supabase' | 'demo'

  /** Establish/adopt the authenticated principal; may re-map identity.id. */
  ensureIdentity(identity: Identity): Promise<Identity>

  /** Re-sync server clock; returns offset (serverNow - Date.now()) in ms. */
  syncServerTime(): Promise<number>

  createClassroom(input: { name: string }, identity: Identity): Promise<Classroom>
  joinClassroom(input: { code: string }, identity: Identity): Promise<{ classroom: Classroom; member: MemberView }>
  /**
   * Look through the doorway of the shared Hall without taking a bench.
   * Counts only — used for the "0 students ⇒ features stopped" dormancy.
   */
  peekClassroom(code: string): Promise<HallPeek>
  resumeClassroom(classroomId: string, identity: Identity): Promise<{ classroom: Classroom; member: MemberView } | null>
  leaveClassroom(classroomId: string, identity: Identity): Promise<void>

  getRoomState(classroomId: string, identity: Identity): Promise<RoomState>
  startStudying(classroomId: string, identity: Identity): Promise<MemberView>
  stopStudying(classroomId: string, identity: Identity): Promise<void>
  setProfile(classroomId: string, identity: Identity): Promise<void>
  heartbeat(classroomId: string, identity: Identity): Promise<void>

  // ── integrity (anti-cheat) ──────────────────────────────────────────────
  /** Acknowledge the pending presence pulse; schedules the next randomized one. */
  ackPulse(classroomId: string, identity: Identity): Promise<void>
  /** Resume a pulse-paused session (new accrual window — the gap never counts). */
  resumeSession(classroomId: string, identity: Identity): Promise<void>
  /** Strict-mode client signals (idle / tab hidden): freeze accrual at once. */
  selfPause(classroomId: string, identity: Identity): Promise<void>
  /** Ping a classmate who looks AFK: immediate short pulse on their session. */
  nudge(classroomId: string, identity: Identity, targetStudentId: string): Promise<void>

  /** Ephemeral preset check-in note to one classmate (never stored). */
  sendMessage(classroomId: string, identity: Identity, targetStudentId: string, text: string): Promise<void>
  /** Change the room's integrity level. */
  setIntegrityMode(classroomId: string, identity: Identity, mode: IntegrityMode): Promise<void>

  getLeaderboard(classroomId: string, identity: Identity): Promise<Leaderboard>
  subscribeRoom(classroomId: string, cb: (e: RoomEvent) => void): () => void

  savePushSubscription(subscription: PushSubscriptionJSON, identity: Identity): Promise<void>

  /** Demo mode only: clearly-labelled simulated classmates so the room feels alive. */
  addDemoBuddies?(classroomId: string, identity: Identity): Promise<void>
  removeDemoBuddies?(classroomId: string, identity: Identity): Promise<void>
}
