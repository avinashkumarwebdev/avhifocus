// Live repro: A nudges B → does B's avhi_ack_pulse actually clear the pulse?
import { createClient } from '@supabase/supabase-js'
const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const pub = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
import WebSocket from 'ws'
const opts = { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } }
const A = createClient(url, pub, opts)
const B = createClient(url, pub, opts)
await A.auth.signInAnonymously()
await B.auth.signInAnonymously()
const bId = (await B.auth.getUser()).data.user.id

const { data: room, error: ce } = await A.rpc('avhi_create_classroom', { p_name: 'Nudge Repro ' + Date.now() % 100000 })
if (ce) throw ce
await A.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'LiveA', p_class_label: 'X', p_avatar: {} })
await B.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'LiveB', p_class_label: 'X', p_avatar: {} })
await B.rpc('avhi_start_study', { p_classroom_id: room.id })
console.log('room mode:', room.integrity_mode)

// A nudges B → B's pulse_due_at must become ~now
const { data: nudgeRes, error: ne } = await A.rpc('avhi_nudge', { p_classroom_id: room.id, p_target_student_id: bId })
console.log('nudge →', JSON.stringify(nudgeRes), ne?.message ?? '')

// B fetches own state (what the app shows after refresh)
let { data: st } = await B.rpc('avhi_room_state', { p_classroom_id: room.id })
let me = st.members.find((m) => m.student_id === bId)
console.log('B after nudge: due_at =', me.pulse_due_at, ' paused =', me.pulse_paused, ' session =', !!me.open_session_started_at)
const dueMs = Date.parse(me.pulse_due_at)
console.log('due in ms from fetch time:', Date.parse(new Date().toISOString()) - dueMs >= 0 ? 'DUE NOW ✓ (modal should show)' : 'NOT DUE?!')

// wait 3s, B taps "I'm here"
await new Promise((r) => setTimeout(r, 3000))
const { data: ackRes, error: ae } = await B.rpc('avhi_ack_pulse', { p_classroom_id: room.id })
console.log('ack →', JSON.stringify(ackRes), ae?.message ?? '')

;({ data: st } = await B.rpc('avhi_room_state', { p_classroom_id: room.id }))
me = st.members.find((m) => m.student_id === bId)
const nextDue = me.pulse_due_at ? Math.round((Date.parse(me.pulse_due_at) - Date.now()) / 1000) : null
console.log(
  nextDue !== null && nextDue > 300
    ? `PASS: pulse cleared, next due in ${nextDue}s, paused=${me.pulse_paused}, session still open=${!!me.open_session_started_at}`
    : `FAIL: due_at=${me.pulse_due_at} paused=${me.pulse_paused} session=${me.open_session_started_at}`
)
await B.rpc('avhi_stop_study', { p_classroom_id: room.id })
console.log('done (test room left in DB, name:', room.name + ')')
