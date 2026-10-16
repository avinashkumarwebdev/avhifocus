// Verify migration 0007 is live: direct message RPC, guardian pass gate, wipe.
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const pub = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
const opts = { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } }
const A = createClient(url, pub, opts)
const B = createClient(url, pub, opts)
await A.auth.signInAnonymously()
await B.auth.signInAnonymously()
const bId = (await B.auth.getUser()).data.user.id

const { data: room, error: ce } = await A.rpc('avhi_create_classroom', { p_name: 'Verify0007 ' + Date.now() % 100000 })
if (ce) throw ce
await A.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'VerA', p_class_label: 'X', p_avatar: {} })
await B.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'VerB', p_class_label: 'X', p_avatar: {} })
await B.rpc('avhi_start_study', { p_classroom_id: room.id })

// 1) message RPC exists + works
const m1 = await A.rpc('avhi_send_message', { p_classroom_id: room.id, p_target_student_id: bId, p_text: 'Are you there? 👀' })
console.log('1) avhi_send_message:', m1.error ? 'FAIL ' + m1.error.message : 'OK')

// 2) bad pass rejected
const p1 = await A.rpc('avhi_prune_student', { p_classroom_id: room.id, p_target_student_id: bId, p_pass: 'wrong000' })
console.log('2) wrong pass rejected:', p1.error?.message.includes('GUARDIAN_DENIED') ? 'OK (denied ✓)' : 'FAIL ' + (p1.error?.message ?? 'no error?!'))

// 3) right pass wipes
const p2 = await A.rpc('avhi_prune_student', { p_classroom_id: room.id, p_target_student_id: bId, p_pass: 'Avhi9204' })
console.log('3) right pass wipe:', p2.error ? 'FAIL ' + p2.error.message : 'OK ' + JSON.stringify(p2.data))

// 4) B's session gone; bench freed
const { data: st } = await A.rpc('avhi_room_state', { p_classroom_id: room.id })
const bRow = st.members.find((m) => m.student_id === bId)
console.log('4) B removed from room:', bRow === undefined ? 'OK (bench freed ✓)' : 'FAIL still seated: ' + JSON.stringify(bRow))

console.log('done (test room left in DB, name:', room.name + ')')
process.exit(0)
