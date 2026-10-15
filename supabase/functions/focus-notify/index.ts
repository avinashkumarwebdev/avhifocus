// ═══════════════════════════════════════════════════════════════════════════
// AVHIFocus Edge Function — focus-notify (v2)
//
// Two call shapes, both gated by the shared webhook secret:
//   A) Database webhook on study_sessions INSERT  → "classmate started" push
//   B) { type:'direct', kind:'nudge'|'message' }  → one-target push, called
//      from avhi_nudge / avhi_send_message via pg_net (see migration 0007)
//
// Flow per call: resolve room + recipients → respect notification prefs →
// fan out Web Push (VAPID) and FCM (native APK) → prune dead subscriptions.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import * as jose from 'npm:jose@5.9.6'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('AVHI_WEBHOOK_SECRET') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('AVHI_VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('AVHI_VAPID_PRIVATE_KEY') ?? ''
const VAPID_CONTACT = Deno.env.get('AVHI_VAPID_CONTACT') ?? 'mailto:avhifocus@example.com'
const APP_ORIGIN = Deno.env.get('AVHI_APP_ORIGIN') ?? 'http://localhost:5173'
// Native (Android APK) delivery: service account JSON for FCM HTTP v1.
const FCM_SERVICE_ACCOUNT = Deno.env.get('AVHI_FCM_SERVICE_ACCOUNT') ?? ''

const ANDROID_CHANNEL: Record<string, string> = {
  start: 'avhi_study_buddies',
  nudge: 'avhi_pulses',
  message: 'avhi_messages'
}

interface FcmServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

let fcmAcct: FcmServiceAccount | null = null
let fcmAccessToken: { token: string; expiresAt: number } | null = null

async function getFcmAccessToken(): Promise<string> {
  if (!fcmAcct) fcmAcct = JSON.parse(FCM_SERVICE_ACCOUNT) as FcmServiceAccount
  if (fcmAccessToken && Date.now() < fcmAccessToken.expiresAt - 60_000) return fcmAccessToken.token
  const key = await jose.importPKCS8(fcmAcct.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const jwt = await new jose.SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(fcmAcct.client_email)
    .setSubject(fcmAcct.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  })
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !data.access_token) throw new Error(`FCM auth failed: ${data.error ?? res.status}`)
  fcmAccessToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  return data.access_token
}

interface NotifyPayload {
  kind: 'start' | 'nudge' | 'message'
  title: string
  body: string
  url: string
  tag: string
}

/** Returns false when the token is dead (prune it). */
async function sendFcmPush(fcmToken: string, p: NotifyPayload): Promise<boolean> {
  const access = await getFcmAccessToken()
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${(fcmAcct as FcmServiceAccount).project_id}/messages:send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title: p.title, body: p.body },
        data: { url: p.url, kind: p.kind },
        android: {
          priority: 'HIGH',
          ttl: '120s',
          collapse_key: p.tag,
          notification: {
            channel_id: ANDROID_CHANNEL[p.kind] ?? 'avhi_study_buddies',
            color: '#2F5941',
            sound: 'default',
            default_vibrate_timings: true,
            tag: p.tag
          }
        }
      }
    })
  })
  if (res.status === 404) return false
  if (!res.ok) {
    const detail = await res.text()
    if (detail.includes('UNREGISTERED')) return false
    throw new Error(`FCM send failed: ${res.status}`)
  }
  return true
}

/** Fan a notification out to every opted-in subscription of the given students. */
async function deliver(
  supabase: SupabaseClient,
  studentIds: string[],
  p: NotifyPayload
): Promise<{ sent: number; pruned: number }> {
  if (!studentIds.length) return { sent: 0, pruned: 0 }

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('student_id, focus_start_notifications')
    .in('student_id', studentIds)
  const optedOut = new Set((prefs ?? []).filter((x) => x.focus_start_notifications === false).map((x) => x.student_id))
  const eligible = studentIds.filter((id) => !optedOut.has(id))
  if (!eligible.length) return { sent: 0, pruned: 0 }

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, public_key, auth_secret, notifications_enabled')
    .in('student_id', eligible)
    .eq('notifications_enabled', true)
  if (!subs?.length) return { sent: 0, pruned: 0 }

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  }

  const dead: string[] = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        if (sub.endpoint.startsWith('fcm:')) {
          if (!FCM_SERVICE_ACCOUNT) return
          const alive = await sendFcmPush(sub.endpoint.slice(4), p)
          if (!alive) dead.push(sub.id)
          return
        }
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.public_key, auth: sub.auth_secret } },
          JSON.stringify({ ...p, url: `${APP_ORIGIN}${p.url}` }),
          { TTL: 60 * 30 }
        )
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(sub.id)
        console.error('push failed', status, (err as Error).message)
      }
    })
  )

  if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead)
  return { sent: subs.length - dead.length, pruned: dead.length }
}

// ── payload shapes ───────────────────────────────────────────────────────────
interface WebhookPayload {
  type: 'INSERT' | 'direct'
  table?: string
  record?: {
    id: string
    classroom_id: string
    student_id: string
    started_at: string
    ended_at: string | null
    status: string
  }
  // direct mode:
  kind?: 'nudge' | 'message'
  student_id?: string
  classroom_id?: string
  from_name?: string
  text?: string
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  if (WEBHOOK_SECRET && req.headers.get('x-avhi-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('bad payload', { status: 400 })
  }

  if ((!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) && !FCM_SERVICE_ACCOUNT) {
    console.warn('No push credentials configured — skipping push delivery')
    return new Response('push not configured', { status: 200 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // ── mode B: direct nudge / quick-note push to ONE student ─────────────────
  if (payload.type === 'direct') {
    const { kind, student_id, classroom_id, from_name, text } = payload
    if (!kind || !student_id || !classroom_id || (kind !== 'nudge' && kind !== 'message')) {
      return new Response('bad direct payload', { status: 400 })
    }
    const { data: room } = await supabase.from('classrooms').select('name').eq('id', classroom_id).single()
    const roomName = room?.name ?? 'your classroom'
    const from = (from_name ?? 'A classmate').split(' ')[0]

    const p: NotifyPayload =
      kind === 'nudge'
        ? {
            kind,
            title: `👀 ${from} is checking on you`,
            body: `Still studying in ${roomName}? Tap to confirm — your timer pauses if we can't reach you.`,
            url: `/room/${classroom_id}?ack=1&back=1`,
            tag: `avhi-nudge-${classroom_id}`
          }
        : {
            kind,
            title: `💬 ${from} sent you a note`,
            body: `${text ?? ''} · ${roomName}`,
            url: `/room/${classroom_id}`,
            tag: `avhi-msg-${classroom_id}`
          }

    const result = await deliver(supabase, [student_id], p)
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
  }

  // ── mode A: database webhook — a classmate started a focus session ────────
  const session = payload.record
  if (!session || payload.table !== 'study_sessions' || session.ended_at !== null) {
    return new Response('ignored', { status: 200 })
  }

  const [{ data: room }, { data: starter }, { data: members }] = await Promise.all([
    supabase.from('classrooms').select('name').eq('id', session.classroom_id).single(),
    supabase
      .from('classroom_members')
      .select('display_name, class_label')
      .eq('classroom_id', session.classroom_id)
      .eq('student_id', session.student_id)
      .eq('membership_status', 'active')
      .single(),
    supabase
      .from('classroom_members')
      .select('student_id')
      .eq('classroom_id', session.classroom_id)
      .eq('membership_status', 'active')
      .eq('is_bot', false)
      .neq('student_id', session.student_id)
  ])

  if (!room || !starter || !members?.length) {
    return new Response('no recipients', { status: 200 })
  }

  const p: NotifyPayload = {
    kind: 'start',
    title: `🔥 ${starter.display_name.split(' ')[0]} just started focusing`,
    body: `${starter.display_name} from ${starter.class_label} is studying in ${room.name}. Join them — momentum loves company.`,
    url: `/room/${session.classroom_id}`,
    tag: `avhi-start-${session.classroom_id}`
  }

  const result = await deliver(supabase, members.map((m) => m.student_id), p)
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
})
