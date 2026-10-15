// One-off connectivity probe for the AVHIFocus Supabase project.
// Usage: node scripts/supabase-probe.mjs
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const url = 'https://opwiziyjutvjiyajbkjo.supabase.co'
const key = 'sb_publishable_a45_Yyi6o1m4iFh8VaqWdg_yls47w9F'

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket }
})

const { data, error } = await sb.auth.signInAnonymously()
if (error) {
  console.log('ANON_SIGNIN=FAIL')
  console.log(error.message)
  process.exit(1)
}
console.log('ANON_SIGNIN=OK')
console.log('USER_ID=' + data.user.id)

// Probe whether the schema exists yet (expected to fail before migrations).
const { error: probeErr } = await sb.from('classrooms').select('id').limit(1)
if (probeErr) console.log('SCHEMA=MISSING:', probeErr.message)
else console.log('SCHEMA=OK')
