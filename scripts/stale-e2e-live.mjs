import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const pub = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
const admin = createClient(url, process.env.AVHI_SECRET, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
const A = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
await A.auth.signInAnonymously()
const aId = (await A.auth.getUser()).data.user.id

const { data: room } = await A.rpc('avhi_create_classroom', { p_name: 'Ghost Watch' })
await A.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'LiveGhost', p_class_label: 'Class 10', p_avatar: {} })
await A.rpc('avhi_start_study', { p_classroom_id: room.id })

const t0 = Date.now()
const S = () => Math.round((Date.now() - t0) / 1000)
// student present for 80s: heartbeat every 20s, then vanishes
for (let i = 0; i < 5; i++) {
  await A.rpc('avhi_heartbeat', { p_classroom_id: room.id })
  if (i < 4) await new Promise((r) => setTimeout(r, 20_000))
}
console.log(`[t=${S()}s] student disappeared`)
await new Promise((r) => setTimeout(r, 320_000)) // 5m20s of silence
const { data: lb } = await A.rpc('avhi_leaderboard', { p_classroom_id: room.id })
const row = (lb?.rows ?? []).find((r) => r.student_id === aId)
const sec = row?.seconds ?? -1
console.log(`[t=${S()}s] banked seconds = ${sec}`)
const { data: state } = await A.rpc('avhi_room_state', { p_classroom_id: room.id })
const me = state.members.find((m) => m.student_id === aId)
console.log(me?.pulse_paused ? 'PASS  session frozen (pulse_paused)' : 'FAIL  not frozen')
console.log(sec > 0 && sec <= 200 ? `PASS  accrual stopped around the +90s cap (${sec}s, not ~${S()}s)` : `FAIL  seconds=${sec}`)
await admin.from('classrooms').delete().eq('id', room.id)
console.log('cleanup done')
