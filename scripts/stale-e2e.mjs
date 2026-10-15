import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const pub = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
const sec = process.env.AVHI_SECRET
const mk = () => createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
const admin = createClient(url, sec, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })

const A = mk()
await A.auth.signInAnonymously()
const aId = (await A.auth.getUser()).data.user.id

const { data: room } = await A.rpc('avhi_create_classroom', { p_name: 'Stale HQ Test' })
await A.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'Ghosty', p_class_label: 'Class 10', p_avatar: {} })
await A.rpc('avhi_start_study', { p_classroom_id: room.id })
// back-date: session began 8 min ago, so the +90s cap lands mid-focus
await admin
  .from('study_sessions')
  .update({
    started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    orig_started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString()
  })
  .eq('classroom_id', room.id)
  .eq('student_id', aId)

// simulate: student vanished 6 minutes ago (heartbeat froze)
await admin
  .from('classroom_members')
  .update({ last_seen_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() })
  .eq('classroom_id', room.id)
  .eq('student_id', aId)

const { data: lb, error } = await A.rpc('avhi_leaderboard', { p_classroom_id: room.id })
const row = (lb?.rows ?? []).find((r) => r.student_id === aId)
console.log('after sweep: seconds =', row?.seconds, '(expected exactly 90)')
console.log(error ? 'ERROR ' + error.message : row?.seconds === 90 ? 'PASS  ghost capped at heartbeat+90s' : 'FAIL  expected 90, got ' + row?.seconds)

const { data: state } = await A.rpc('avhi_room_state', { p_classroom_id: room.id })
const me = state.members.find((m) => m.student_id === aId)
console.log(me?.pulse_paused ? 'PASS  session visibly frozen (pulse_paused)' : 'FAIL  session not frozen')
console.log(!me?.online ? 'PASS  student shows offline/away' : 'NOTE  still online (last_seen just touched by reads)')

// cleanup
await admin.from('classrooms').delete().eq('id', room.id)
console.log('cleanup done')
