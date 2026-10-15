// ═══════════════════════════════════════════════════════════════════════════
// AVHIFocus Edge Function — focus-notify
//
// Trigger: Supabase Database Webhook on study_sessions INSERT (see README §8).
// Flow:
//   1. verify the shared webhook secret (set as Edge Function env secret)
//   2. load the session + classroom + starter (service role, server-side only)
//   3. find eligible classmates: active members, excluding the starter and
//      bots, with push enabled in notification_preferences
//   4. send standards-based Web Push to each subscription (VAPID keys in env)
//   5. prune dead subscriptions (404/410)
//
// The initiating student is NEVER notified. Realtime handles already-open
// apps; this function serves background/closed-app delivery.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
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

/** Returns false when the token is dead (prune it). */
async function sendFcmPush(fcmToken: string, body: { title: string; body: string; url: string }): Promise<boolean> {
  const access = await getFcmAccessToken()
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${(fcmAcct as FcmServiceAccount).project_id}/messages:send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title: body.title, body: body.body },
        data: { url: body.url },
        android: {
          priority: 'HIGH',
          notification: {
            channel_id: 'avhi_study_buddies'
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

interface WebhookPayload {
  type: string
  table: string
  record: {
    id: string
    classroom_id: string
    student_id: string
    started_at: string
    ended_at: string | null
    status: string
  }
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // Shared-secret check — only Supabase (configured with this header) may call.
  if (WEBHOOK_SECRET && req.headers.get('x-avhi-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('bad payload', { status: 400 })
  }

  const session = payload.record
  if (!session || payload.table !== 'study_sessions' || session.ended_at !== null) {
    return new Response('ignored', { status: 200 })
  }

  if ((!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) && !FCM_SERVICE_ACCOUNT) {
    console.warn('No push credentials configured — skipping push delivery')
    return new Response('push not configured', { status: 200 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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

  const studentIds = members.map((m) => m.student_id)

  // Respect per-student notification preferences.
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('student_id, focus_start_notifications')
    .in('student_id', studentIds)
  const optedOut = new Set(
    (prefs ?? []).filter((p) => p.focus_start_notifications === false).map((p) => p.student_id)
  )

  const eligible = studentIds.filter((id) => !optedOut.has(id))
  if (!eligible.length) return new Response('no opted-in recipients', { status: 200 })

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, public_key, auth_secret, notifications_enabled')
    .in('student_id', eligible)
    .eq('notifications_enabled', true)

  if (!subs?.length) return new Response('no subscriptions', { status: 200 })

  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  }

  const body = {
    title: 'Someone started studying!',
    body: `${starter.display_name} from ${starter.class_label} has started a focus session. Join them in ${room.name}.`,
    url: `${APP_ORIGIN}/room/${session.classroom_id}`
  }

  const dead: string[] = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        if (sub.endpoint.startsWith('fcm:')) {
          // native Android token → FCM HTTP v1
          if (!FCM_SERVICE_ACCOUNT) return
          const alive = await sendFcmPush(sub.endpoint.slice(4), {
            ...body,
            url: `/room/${session.classroom_id}` // relative deep-link for the installed app
          })
          if (!alive) dead.push(sub.id)
          return
        }
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.public_key, auth: sub.auth_secret } },
          JSON.stringify(body),
          { TTL: 60 * 30 }
        )
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) dead.push(sub.id)
        console.error('push failed', status, (err as Error).message)
      }
    })
  )

  if (dead.length) {
    await supabase.from('push_subscriptions').delete().in('id', dead)
  }

  return new Response(JSON.stringify({ sent: subs.length - dead.length, pruned: dead.length }), {
    headers: { 'content-type': 'application/json' }
  })
})
