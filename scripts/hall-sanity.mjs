import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const pub = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
const admin = createClient(url, process.env.AVHI_SECRET, { auth: { persistSession: false }, realtime: { transport: WebSocket } })

// 0. cleanup leftovers from earlier interrupted ghost-cap runs
const { data: strays } = await admin.from('classrooms').select('id,name').in('name', ['Stale HQ Test', 'Ghost Watch'])
for (const s of strays ?? []) await admin.from('classrooms').delete().eq('id', s.id)
console.log(`cleanup: removed ${strays?.length ?? 0} stale test room(s)`)

// 1. peek as a fresh anonymous student
const A = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'hallcheck' }, realtime: { transport: WebSocket } })
await A.auth.signInAnonymously()
const { data: peek, error: peekErr } = await A.rpc('avhi_hall_peek', { p_code: 'STUDY9' })
console.log(peekErr ? 'FAIL peek: ' + peekErr.message : `peek: ${peek.name} · mode=${peek.integrity_mode} · members=${peek.members} · studying=${peek.studying}`)
console.log(peek?.integrity_mode === 'balanced' ? 'PASS  difficulty defaults to moderate' : 'FAIL  mode=' + peek?.integrity_mode)

// 2. take a bench
const { data: join } = await A.rpc('avhi_join_classroom', { p_code: 'STUDY9', p_display_name: 'Sanity', p_class_label: 'Class 10', p_avatar: {} })
console.log('PASS  seated at bench #' + join.member.seat_number + ' in ' + join.classroom.name)

// 3. study briefly, stop, check boarding
await A.rpc('avhi_start_study', { p_classroom_id: join.classroom.id })
await new Promise((r) => setTimeout(r, 3000))
await A.rpc('avhi_stop_study', { p_classroom_id: join.classroom.id })

// 4. leave → hall returns to dormant (0 members)
await A.rpc('avhi_leave_classroom', { p_classroom_id: join.classroom.id })
const { data: peek2 } = await A.rpc('avhi_hall_peek', { p_code: 'STUDY9' })
console.log(peek2.members === 0 ? 'PASS  hall back to 0 members — features dormant' : 'FAIL  members=' + peek2.members)
