import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
const sb = createClient('https://opwiziyjutvjiyajbkjo.supabase.co', 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F', {
  auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket }
})
await sb.auth.signInAnonymously()
const { data: room } = await sb.rpc('avhi_create_classroom', { p_name: 'Notify Chain Test' })
await sb.rpc('avhi_join_classroom', { p_code: room.join_code, p_display_name: 'Tester', p_class_label: 'QA', p_avatar: {} })
const { error } = await sb.rpc('avhi_start_study', { p_classroom_id: room.id })
console.log('start_study:', error ? error.message : 'OK — session inserted, trigger should fire')
await sb.rpc('avhi_stop_study', { p_classroom_id: room.id })
await sb.rpc('avhi_leave_classroom', { p_classroom_id: room.id })
const admin = createClient('https://opwiziyjutvjiyajbkjo.supabase.co', process.env.AVHI_SECRET, { auth: { persistSession: false }, realtime: { transport: WebSocket } })
const { data: rooms } = await admin.from('classrooms').select('id').eq('name', 'Notify Chain Test')
for (const r of rooms ?? []) await admin.from('classrooms').delete().eq('id', r.id)
console.log('cleanup done')
