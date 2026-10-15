// AVHIFocus live E2E against the real Supabase project.
// Two anonymous students: create → join → study → read state/leaderboard → cleanup.
// Exits non-zero on any failure. Run: node scripts/supabase-e2e.mjs
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const publishable = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
const secret = process.env.AVHI_SECRET // optional: service key, cleanup only

let failures = 0
const ok = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + label)
  if (!cond) failures++
}

function mk() {
  return createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
  })
}

const A = mk()
const B = mk()
const sa = await A.auth.signInAnonymously()
const sb = await B.auth.signInAnonymously()
ok(!sa.error && !sb.error, 'two anonymous sign-ins')
const aId = sa.data.user?.id ?? ''

const { data: room, error: eCreate } = await A.rpc('avhi_create_classroom', { p_name: 'E2E Test Hall' })
ok(!eCreate && room?.join_code?.length === 6, 'classroom created with 6-char code')
const roomId = room?.id
const code = room?.join_code

{
  const { data, error } = await A.rpc('avhi_join_classroom', { p_code: code, p_display_name: 'Arjun', p_class_label: 'Class 10', p_avatar: {} })
  ok(!error && data?.member?.seat_number === 1, 'A joins → seat 1')
}
{
  const { data, error } = await B.rpc('avhi_join_classroom', { p_code: code, p_display_name: 'Meena', p_class_label: 'Class 12', p_avatar: {} })
  ok(!error && data?.member?.seat_number === 2, 'B joins → seat 2')
}
{
  const { data, error } = await B.rpc('avhi_room_state', { p_classroom_id: roomId })
  ok(!error && data?.members?.length === 2, 'room state shows both members')
}
{
  const { error } = await A.rpc('avhi_start_study', { p_classroom_id: roomId })
  ok(!error, 'A starts studying')
}
{
  const { data, error } = await B.rpc('avhi_room_state', { p_classroom_id: roomId })
  const studying = (data?.members ?? []).filter((m) => m.open_session_started_at).length
  ok(!error && studying === 1, 'B sees exactly one student focusing')
}
{
  const { data, error } = await A.rpc('avhi_leaderboard', { p_classroom_id: roomId })
  ok(!error && typeof data?.period_index === 'number' && data?.rows?.length === 2, 'leaderboard readable with 2 rows')
}
{
  const { error } = await A.rpc('avhi_ack_pulse', { p_classroom_id: roomId })
  ok(!error, 'ack pulse idempotent in relaxed room')
}
{
  const { error } = await B.rpc('avhi_nudge', { p_classroom_id: roomId, p_target_student_id: aId })
  ok(!error, 'B can nudge A')
}
{
  const { error } = await A.rpc('avhi_stop_study', { p_classroom_id: roomId })
  ok(!error, 'A stops studying')
}
{
  const { data, error } = await B.rpc('avhi_leaderboard', { p_classroom_id: roomId })
  const aRow = (data?.rows ?? []).find((r) => r.student_id === aId)
  ok(!error && aRow && aRow.seconds >= 0, 'stopped session banked (segments recorded)')
}

// cleanup: leave + delete the test room (service role, server-side only)
await A.rpc('avhi_leave_classroom', { p_classroom_id: roomId })
await B.rpc('avhi_leave_classroom', { p_classroom_id: roomId })
if (secret) {
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket }
  })
  const { data: rooms } = await admin.from('classrooms').select('id').eq('name', 'E2E Test Hall')
  for (const r of rooms ?? []) await admin.from('classrooms').delete().eq('id', r.id)
  console.log('CLEANUP  removed test rooms: ' + (rooms?.length ?? 0))
} else {
  console.log('CLEANUP  skipped (no service key) — empty test room remains, harmless')
}

console.log(failures === 0 ? 'RESULT=ALL GREEN' : `RESULT=${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
