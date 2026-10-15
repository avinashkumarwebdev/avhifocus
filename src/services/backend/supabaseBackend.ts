import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { AvatarSpec, Classroom, HallPeek, Identity, IntegrityMode, Leaderboard, MemberView, RoomEvent, RoomState } from '../../types'
import { BackendError } from '../../types'
import { classroomNameSchema, classLabelSchema, displayNameSchema, joinCodeSchema } from '../../lib/validation'
import { isQuickMessage, MESSAGE_RATE_LIMIT_MS } from '../../lib/quickMessages'
import type { Backend } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SupabaseBackend — the production multi-device backend.
 *
 * All sensitive operations go through SECURITY DEFINER RPC functions
 * (see supabase/migrations): the browser can never insert/update sessions,
 * seats, or scores directly. Realtime postgres_changes drive room updates.
 */
export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const

  private supabase: SupabaseClient
  private channels = new Map<string, RealtimeChannel>()

  constructor(url: string, anonKey: string) {
    this.supabase = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'avhifocus.auth'
      }
    })
  }

  /**
   * Every public method must run with an anonymous session attached —
   * creating/joining happens BEFORE any room sync, and auth.uid() is the
   * principal every RPC validates. Sign-ins are deduped via a shared promise.
   */
  private authPromise: Promise<void> | null = null

  private ensureSession(): Promise<void> {
    if (!this.authPromise) {
      this.authPromise = (async () => {
        const {
          data: { session }
        } = await this.supabase.auth.getSession()
        if (!session) {
          // Anonymous sign-in: no email/password ever collected. Combined with
          // RLS + membership validation on every privileged call.
          const { error } = await this.supabase.auth.signInAnonymously()
          if (error) throw new BackendError('NETWORK', 'Could not start your anonymous session: ' + error.message)
        }
      })()
      // Only cache success — a failed attempt must retry on the next call.
      this.authPromise.catch(() => {
        this.authPromise = null
      })
    }
    return this.authPromise
  }

  private async uid(): Promise<string> {
    const { data } = await this.supabase.auth.getUser()
    if (!data.user) throw new BackendError('UNAUTHORIZED', 'Your session expired — please re-open the app.')
    return data.user.id
  }

  async ensureIdentity(identity: Identity): Promise<Identity> {
    await this.ensureSession()
    const id = await this.uid()
    return { ...identity, id }
  }

  async syncServerTime(): Promise<number> {
    await this.ensureSession()
    const { data, error } = await this.supabase.rpc('server_now')
    if (error) throw new BackendError('NETWORK', error.message)
    return new Date(data as string).getTime() - Date.now()
  }

  private mapClassroom(r: any): Classroom {
    return {
      id: r.id,
      name: r.name,
      joinCode: r.join_code ?? '',
      capacity: r.capacity,
      cycleAnchorMs: new Date(r.cycle_anchor_at).getTime(),
      focusSeconds: r.focus_duration_seconds,
      breakSeconds: r.break_duration_seconds,
      createdAtMs: new Date(r.created_at).getTime(),
      isActive: r.is_active,
      integrityMode: (r.integrity_mode ?? 'balanced') as IntegrityMode
    }
  }

  async peekClassroom(code: string): Promise<HallPeek> {
    await this.ensureSession()
    const { data, error } = await this.supabase.rpc('avhi_hall_peek', { p_code: code })
    if (error) this.rpcError(error)
    const r = data as any
    return {
      roomId: r.id,
      name: r.name,
      joinCode: r.join_code,
      capacity: r.capacity,
      integrityMode: (r.integrity_mode ?? 'balanced') as IntegrityMode,
      members: r.members,
      studying: r.studying,
      cycleAnchorMs: new Date(r.cycle_anchor_at).getTime(),
      focusSeconds: r.focus_duration_seconds,
      breakSeconds: r.break_duration_seconds
    }
  }

  private mapMember(r: any, nowMs: number, viewerStudentId?: string): MemberView {
    return {
      memberId: r.id,
      studentId: r.student_id,
      displayName: r.display_name,
      classLabel: r.class_label,
      avatar: r.avatar as AvatarSpec,
      seatNumber: r.seat_number,
      online: nowMs - new Date(r.last_seen_at).getTime() <= 60_000,
      isBot: false,
      lastSeenAtMs: new Date(r.last_seen_at).getTime(),
      joinedAtMs: new Date(r.joined_at).getTime(),
      status: r.open_session_started_at ? 'studying' : 'idle',
      sessionStartedAtMs: r.open_session_started_at ? new Date(r.open_session_started_at).getTime() : null,
      pulsePaused: Boolean(r.pulse_paused),
      pulseDueAtMs:
        r.pulse_due_at && (!viewerStudentId || r.student_id === viewerStudentId)
          ? new Date(r.pulse_due_at).getTime()
          : null
    }
  }

  private rpcError(e: { message: string } | null): never {
    const msg = e?.message ?? 'Something went wrong.'
    if (msg.includes('ROOM_FULL')) throw new BackendError('ROOM_FULL', 'This classroom already has 10 students. A seat must free up first.')
    if (msg.includes('ROOM_NOT_FOUND')) throw new BackendError('ROOM_NOT_FOUND', 'No classroom uses that code. Check and try again.')
    if (msg.includes('ROOM_INACTIVE')) throw new BackendError('ROOM_INACTIVE', 'This classroom is no longer active.')
    if (msg.includes('NOT_A_MEMBER')) throw new BackendError('NOT_A_MEMBER', 'You are not a member of this classroom.')
    throw new BackendError('NETWORK', msg)
  }

  async createClassroom(input: { name: string }, identity: Identity): Promise<Classroom> {
    await this.ensureSession()
    const name = classroomNameSchema.parse(input.name)
    const { data, error } = await this.supabase.rpc('avhi_create_classroom', { p_name: name })
    if (error) this.rpcError(error)
    const member = {
      display_name: identity.displayName,
      class_label: identity.classLabel,
      avatar: identity.avatar
    }
    // Creator takes seat 1 through the same atomic join path as everyone.
    await this.supabase.rpc('avhi_join_classroom', {
      p_code: (data as any).join_code,
      p_display_name: member.display_name,
      p_class_label: member.class_label,
      p_avatar: member.avatar
    })
    return this.mapClassroom(data)
  }

  async joinClassroom(
    input: { code: string },
    identity: Identity
  ): Promise<{ classroom: Classroom; member: MemberView }> {
    await this.ensureSession()
    const code = joinCodeSchema.parse(input.code)
    const { data, error } = await this.supabase.rpc('avhi_join_classroom', {
      p_code: code,
      p_display_name: displayNameSchema.parse(identity.displayName),
      p_class_label: classLabelSchema.parse(identity.classLabel),
      p_avatar: identity.avatar as unknown as Record<string, string>
    })
    if (error) this.rpcError(error)
    const payload = data as any
    return {
      classroom: this.mapClassroom(payload.classroom),
      member: this.mapMember(payload.member, Date.now())
    }
  }

  async resumeClassroom(
    classroomId: string,
    identity: Identity
  ): Promise<{ classroom: Classroom; member: MemberView } | null> {
    await this.ensureSession()
    const state = await this.getRoomState(classroomId, identity).catch(() => null)
    if (!state) return null
    const me = state.members.find((m) => m.studentId === identity.id)
    return me ? { classroom: state.classroom, member: me } : null
  }

  async leaveClassroom(classroomId: string, _identity: Identity): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_leave_classroom', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
    this.unsubscribeRoom(classroomId)
  }

  async getRoomState(classroomId: string, identity: Identity): Promise<RoomState> {
    await this.ensureSession()
    const { data, error } = await this.supabase.rpc('avhi_room_state', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
    const payload = data as any
    const now = Date.now()
    return {
      classroom: this.mapClassroom(payload.classroom),
      members: (payload.members as any[]).map((m) => this.mapMember(m, now, identity.id))
    }
  }

  async startStudying(classroomId: string, identity: Identity): Promise<MemberView> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_start_study', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
    // Ephemeral broadcast for instant toasts (state change arrives via postgres_changes).
    this.channels.get(classroomId)?.send({
      type: 'broadcast',
      event: 'focus-started',
      payload: { studentId: identity.id, displayName: identity.displayName, classLabel: identity.classLabel }
    })
    const state = await this.getRoomState(classroomId, identity)
    return state.members.find((m) => m.studentId === identity.id) as MemberView
  }

  async stopStudying(classroomId: string, _identity: Identity): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_stop_study', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
  }

  async setProfile(classroomId: string, identity: Identity): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_update_profile', {
      p_classroom_id: classroomId,
      p_display_name: displayNameSchema.parse(identity.displayName),
      p_class_label: classLabelSchema.parse(identity.classLabel),
      p_avatar: identity.avatar as unknown as Record<string, string>
    })
    if (error) this.rpcError(error)
  }

  async heartbeat(classroomId: string, _identity: Identity): Promise<void> {
    await this.ensureSession()
    await this.supabase.rpc('avhi_heartbeat', { p_classroom_id: classroomId })
  }

  // ── integrity (anti-cheat) ────────────────────────────────────────────────
  async ackPulse(classroomId: string, _identity: Identity): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_ack_pulse', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
  }

  async resumeSession(classroomId: string, _identity: Identity): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_resume_session', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
  }

  async selfPause(classroomId: string, _identity: Identity): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_self_pause', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
  }

  async nudge(classroomId: string, identity: Identity, targetStudentId: string): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_nudge', {
      p_classroom_id: classroomId,
      p_target_student_id: targetStudentId
    })
    if (error) this.rpcError(error)
    // instant ephemeral signal for the nudged student (state also follows via postgres_changes)
    this.channels.get(classroomId)?.send({
      type: 'broadcast',
      event: 'nudged',
      payload: { studentId: identity.id, displayName: identity.displayName, targetStudentId }
    })
  }

  private msgCooldown = new Map<string, number>()

  /**
   * Quick check-in note (ephemeral broadcast — intentionally unmoderated-free
   * because only fixed presets can be sent; client-side cooldown per pair).
   */
  async sendMessage(classroomId: string, identity: Identity, targetStudentId: string, text: string): Promise<void> {
    await this.ensureSession()
    if (targetStudentId === identity.id) throw new BackendError('VALIDATION', "That's you — no note to yourself needed.")
    if (!isQuickMessage(text)) throw new BackendError('VALIDATION', 'Pick one of the preset notes.')
    const key = `${classroomId}:${identity.id}:${targetStudentId}`
    const now = Date.now()
    if (now - (this.msgCooldown.get(key) ?? 0) < MESSAGE_RATE_LIMIT_MS) {
      throw new BackendError('VALIDATION', 'Easy there — give them a moment before sending another note.')
    }
    this.msgCooldown.set(key, now)
    this.channels.get(classroomId)?.send({
      type: 'broadcast',
      event: 'message',
      payload: { studentId: identity.id, displayName: identity.displayName, targetStudentId, text }
    })
  }

  async setIntegrityMode(classroomId: string, _identity: Identity, mode: IntegrityMode): Promise<void> {
    await this.ensureSession()
    const { error } = await this.supabase.rpc('avhi_set_integrity', {
      p_classroom_id: classroomId,
      p_mode: mode
    })
    if (error) this.rpcError(error)
  }

  async getLeaderboard(classroomId: string, identity: Identity): Promise<Leaderboard> {
    await this.ensureSession()
    const { data, error } = await this.supabase.rpc('avhi_leaderboard', { p_classroom_id: classroomId })
    if (error) this.rpcError(error)
    const payload = data as any
    const rows = (payload.rows as any[]).map((r) => ({
      studentId: r.student_id,
      displayName: r.display_name,
      classLabel: r.class_label,
      avatar: r.avatar as AvatarSpec,
      seconds: Number(r.seconds),
      rank: Number(r.rank),
      isMe: r.student_id === identity.id
    }))
    return {
      periodIndex: Number(payload.period_index),
      periodStartMs: new Date(payload.period_start_at).getTime(),
      periodEndMs: new Date(payload.period_end_at).getTime(),
      integrityMode: (payload.integrity_mode ?? 'relaxed') as IntegrityMode,
      rows
    }
  }

  subscribeRoom(classroomId: string, cb: (e: RoomEvent) => void): () => void {
    if (this.channels.has(classroomId)) this.unsubscribeRoom(classroomId)
    const channel = this.supabase
      .channel(`avhi-room:${classroomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'classroom_members', filter: `classroom_id=eq.${classroomId}` },
        () => cb({ kind: 'room-changed' })
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'study_sessions', filter: `classroom_id=eq.${classroomId}` },
        () => cb({ kind: 'room-changed' })
      )
      .on('broadcast', { event: 'focus-started' }, ({ payload }) => {
        const by = payload as { studentId: string; displayName: string; classLabel: string }
        cb({ kind: 'focus-started', by })
      })
      .on('broadcast', { event: 'nudged' }, ({ payload }) => {
        const p = payload as { studentId: string; displayName: string; targetStudentId: string }
        cb({ kind: 'nudged', by: { studentId: p.studentId, displayName: p.displayName }, targetStudentId: p.targetStudentId })
      })
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const p = payload as { studentId: string; displayName: string; targetStudentId: string; text: string }
        if (isQuickMessage(p.text)) {
          cb({ kind: 'message', by: { studentId: p.studentId, displayName: p.displayName }, targetStudentId: p.targetStudentId, text: p.text })
        }
      })
      .subscribe()
    this.channels.set(classroomId, channel)
    return () => this.unsubscribeRoom(classroomId)
  }

  private unsubscribeRoom(classroomId: string) {
    const ch = this.channels.get(classroomId)
    if (ch) {
      this.supabase.removeChannel(ch)
      this.channels.delete(classroomId)
    }
  }

  async savePushSubscription(subscription: PushSubscriptionJSON, identity: Identity): Promise<void> {
    await this.ensureSession()
    const keys = (subscription.keys ?? {}) as Record<string, string>
    const { error } = await this.supabase.from('push_subscriptions').upsert(
      {
        student_id: identity.id, // required (NOT NULL) + satisfies ownership RLS
        endpoint: subscription.endpoint as string,
        public_key: keys.p256dh ?? '',
        auth_secret: keys.auth ?? '',
        notifications_enabled: true,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'endpoint' }
    )
    if (error) throw new BackendError('NETWORK', error.message)
  }
}
