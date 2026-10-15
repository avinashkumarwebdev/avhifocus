import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const pub = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'
const sec = process.env.AVHI_SECRET
const mk = () => createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })
const admin = createClient(url, sec, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } })

const A = mk(), B = mk()
await A.auth.signInAnonymously(); await B.auth.signInAnonymously()
const bId = (await B.auth.getUser()).data.user.id

const { data: room } = await A.rpc('avhi_create_classroom', { p_name: 'Push Smoke Test' })
await A.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'A', p_class_label: 'QA', p_avatar: {} })
await B.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'B', p_class_label: 'QA', p_avatar: {} })

// fake browser subscription for B (test-only endpoint, will fail delivery but exercises VAPID)
await admin.from('push_subscriptions').insert({
  student_id: bId,
  endpoint: 'https://example.com/fake-push-endpoint-for-smoke-test',
  public_key: 'BNtest',
  auth_secret: 'test',
  notifications_enabled: true
})

const { error } = await A.rpc('avhi_start_study', { p_classroom_id: room.id })
console.log('start_study:', error ? error.message : 'OK')

await new Promise((r) => setTimeout(r, 5000))
// cleanup everything we created
await admin.from('push_subscriptions').delete().eq('endpoint', 'https://example.com/fake-push-endpoint-for-smoke-test')
const { data: rooms } = await admin.from('classrooms').select('id').eq('name', 'Push Smoke Test')
for (const r of rooms ?? []) await admin.from('classrooms').delete().eq('id', r.id)
console.log('cleanup done')
