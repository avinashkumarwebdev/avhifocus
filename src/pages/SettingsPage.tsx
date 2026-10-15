import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card, Button, Field, TextInput, Chip } from '../components/ui'
import { AvatarPicker } from '../components/AvatarPicker'
import { Wordmark } from '../components/Logo'
import { chevronLeft } from './shared'
import { useIdentityStore } from '../stores/identity'
import { useAppStore } from '../stores/app'
import { useRoomSync } from '../hooks/useRoomSync'
import { getBackend, backendConfigured } from '../services/backend'
import { notificationsSupported, pushSupported, subscribeWebPush } from '../lib/notifications'
import { Capacitor } from '@capacitor/core'
import { enableNativePush } from '../lib/nativePush'
import { startAmbient, stopAmbient } from '../lib/ambient'
import { classLabelSchema, displayNameSchema } from '../lib/validation'
import type { AvatarSpec } from '../types'
import { Bell, CloudOff, LogOut, ShieldCheck, Volume2 } from 'lucide-react'

function Toggle({
  checked,
  onChange,
  disabled = false
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${
        checked ? 'bg-forest' : 'bg-ink/15'
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-cream shadow transition-all ${checked ? 'left-6' : 'left-1'}`}
      />
    </button>
  )
}

function Row({ title, body, trailing }: { title: string; body: string; trailing: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-inksoft">{body}</p>
      </div>
      {trailing}
    </div>
  )
}

export default function SettingsPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const setIdentity = useIdentityStore((s) => s.setIdentity)
  const setLastRoom = useIdentityStore((s) => s.setLastRoom)
  const prefs = useAppStore((s) => s.prefs)
  const setPrefs = useAppStore((s) => s.setPrefs)
  const pushToast = useAppStore((s) => s.pushToast)
  const sync = useRoomSync(roomId)

  const [name, setName] = useState(identity?.displayName ?? '')
  const [klass, setKlass] = useState(identity?.classLabel ?? '')
  const [avatar, setAvatar] = useState<AvatarSpec>(identity?.avatar ?? { skin: '#F2C9A4', hair: '#3B2A1E', hairStyle: 'short', shirt: '#D77A4A' })
  const [saving, setSaving] = useState(false)
  const [notifNote, setNotifNote] = useState<string | null>(null)

  if (!identity) {
    navigate('/details?next=enter', { replace: true })
    return null
  }

  const permission = Capacitor.isNativePlatform() ? 'native (Android)' : notificationsSupported() ? Notification.permission : 'unsupported'

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const nameCheck = displayNameSchema.safeParse(name)
    const classCheck = classLabelSchema.safeParse(klass)
    if (!nameCheck.success || !classCheck.success) {
      pushToast({ title: 'Check your details', body: (nameCheck.success ? classCheck : nameCheck).error?.issues[0]?.message, tone: 'warn' })
      return
    }
    setSaving(true)
    try {
      const next = setIdentity({ displayName: nameCheck.data, classLabel: classCheck.data, avatar })
      if (roomId) await getBackend().setProfile(roomId, next)
      await sync.refresh()
      pushToast({ title: 'Profile updated', tone: 'success' })
    } catch (err) {
      pushToast({ title: 'Could not save', body: err instanceof Error ? err.message : 'Try again', tone: 'warn' })
    } finally {
      setSaving(false)
    }
  }

  const toggleNotifications = async (on: boolean) => {
    setNotifNote(null)
    if (!on) {
      setPrefs({ notificationsEnabled: false })
      return
    }
    // Installed APK: register with FCM (system prompt only after this tap).
    // Browser/PWA: Web Push (VAPID) subscription.
    if (Capacitor.isNativePlatform()) {
      const result = await enableNativePush()
      if (result === 'granted') {
        setPrefs({ notificationsEnabled: true })
        setNotifNote('Notifications on — classmates’ focus starts will nudge you.')
      } else if (result === 'denied') {
        setNotifNote('Notifications are blocked in system settings. You can study on regardless.')
      } else {
        setNotifNote('Push isn’t wired up in this build yet (missing Firebase setup) — the app still works fully.')
      }
      return
    }
    const result = await subscribeWebPush(identity)
    if (result.ok) {
      setPrefs({ notificationsEnabled: true })
      setNotifNote(
        backendConfigured
          ? 'Notifications on — classmates’ focus starts will nudge you.'
          : 'Demo mode: notifications fire between open tabs on this device.'
      )
    } else if (result.reason === 'denied') {
      setNotifNote('Notifications are blocked in your browser settings. You can study on regardless.')
    } else if (result.reason === 'unsupported') {
      setNotifNote('This browser does not support push notifications — the app still works fully.')
    } else if (result.reason === 'no-vapid-key') {
      setNotifNote('Push is not configured on this deployment yet (missing VAPID key).')
    } else {
      setNotifNote('Could not enable notifications right now.')
    }
  }

  const toggleAmbient = (on: boolean) => {
    if (on) {
      const ok = startAmbient()
      setPrefs({ ambientSound: ok })
      if (!ok) pushToast({ title: 'Audio unavailable', body: 'This browser blocked ambient sound.', tone: 'warn' })
    } else {
      stopAmbient()
      setPrefs({ ambientSound: false })
    }
  }

  const leave = async () => {
    if (!roomId) return
    stopAmbient()
    setPrefs({ ambientSound: false })
    await sync.leave()
    setLastRoom(null)
    navigate('/')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-8">
        <Link to={`/room/${roomId}`} className="rounded-full bg-forest/8 p-2 text-forest transition hover:bg-forest/15" aria-label="Back to classroom">
          {chevronLeft}
        </Link>
        <Wordmark compact />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 pb-16">
        {/* profile */}
        <Card className="p-5">
          <h1 className="font-rounded text-xl font-extrabold text-forest">You</h1>
          <form onSubmit={(e) => void saveProfile(e)} className="mt-4 flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" hint="Visible to classmates">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
              </Field>
              <Field label="Class" hint="Visible to classmates">
                <TextInput value={klass} onChange={(e) => setKlass(e.target.value)} maxLength={18} />
              </Field>
            </div>
            <AvatarPicker value={avatar} onChange={setAvatar} />
            <Button type="submit" loading={saving} className="self-start">
              Save changes
            </Button>
          </form>
        </Card>

        {/* notifications */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-rounded text-xl font-extrabold text-forest">
            <Bell size={18} /> Notifications
          </h2>
          <div className="mt-2 divide-y divide-wood/10">
            <Row
              title="Classmate focus alerts"
              body={`Get a nudge when a classmate starts focusing. Browser permission: ${permission}.`}
              trailing={<Toggle checked={prefs.notificationsEnabled} onChange={(v) => void toggleNotifications(v)} />}
            />
            <Row
              title="Phase change alerts"
              body="Notice when the shared clock flips between focus and break."
              trailing={<Toggle checked={prefs.phaseAlerts} onChange={(v) => setPrefs({ phaseAlerts: v })} />}
            />
            <Row
              title="Quiet hours (22:00–07:00)"
              body="Silence non-essential nudges overnight, local time."
              trailing={<Toggle checked={prefs.quietHours} onChange={(v) => setPrefs({ quietHours: v })} />}
            />
          </div>
          {notifNote && <p className="mt-3 rounded-xl bg-sage/20 px-3 py-2 text-xs font-medium text-forestdeep">{notifNote}</p>}
          {!pushSupported() && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-inksoft">
              <CloudOff size={13} /> Background push needs a supported browser + HTTPS; foreground updates always work.
            </p>
          )}
        </Card>

        {/* integrity mode */}
        <Card className="p-5">
          <h2 className="font-rounded text-xl font-extrabold text-forest">Classroom integrity</h2>
          <p className="mt-1 text-xs leading-relaxed text-inksoft">
          Anti-ghost-studying level for this room — it defaults to Moderate and applies to everyone seated here.
          Minutes are pulse-verified in moderate and strict modes: missed checks pause accrual, and the gap never
          reaches the leaderboard.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {(
              [
                {
                  id: 'relaxed',
                  title: 'Relaxed',
                  body: 'Trust-based. Sessions run uninterrupted with only a 6-hour safety cap. Best for calm, low-stakes rooms.'
                },
                {
                  id: 'balanced',
                  title: 'Moderate · default',
                  body: 'Random “still studying?” checks every 10–18 min, 2-hour session caps, classmate nudges. Verified minutes ✓.'
                },
                {
                  id: 'strict',
                  title: 'Strict',
                  body: 'Moderate + auto-pause when idle 18 min or the tab is hidden over 90 seconds. For competitive rooms.'
                }
              ] as const
            ).map((opt) => {
              const active = (sync.room?.integrityMode ?? 'relaxed') === opt.id
              return (
                <button
                  key={opt.id}
                  disabled={sync.busy || !sync.room}
                  onClick={() => {
                    void sync.setIntegrityMode(opt.id).then(() =>
                      pushToast({ title: `Difficulty set to ${opt.id === 'balanced' ? 'moderate' : opt.id}`, body: opt.body, tone: 'success' })
                    )
                  }}
                  className={`rounded-2xl border-2 p-3.5 text-left transition disabled:opacity-50 ${
                    active ? 'border-forest bg-forest/6' : 'border-wood/15 bg-white/50 hover:border-forest/40'
                  }`}
                >
                  <p className="flex items-center gap-2 text-sm font-extrabold text-ink">
                    <span className={`inline-block h-3 w-3 rounded-full border-2 ${active ? 'border-forest bg-forest' : 'border-ink/30'}`} />
                    {opt.title}
                  </p>
                  <p className="mt-1 pl-5 text-xs leading-relaxed text-inksoft">{opt.body}</p>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-inksoft/80">
            Always-on protections: server-side timestamps only, 10h/day leaderboard cap, and one open session per
            student. Pauses never delete earned minutes.
          </p>
        </Card>

        {/* ambience + comfort */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-rounded text-xl font-extrabold text-forest">
            <Volume2 size={18} /> Comfort
          </h2>
          <div className="mt-2 divide-y divide-wood/10">
            <Row
              title="Gentle rain ambience"
              body="Soft generated rain while you study. Starts only when you switch it on."
              trailing={<Toggle checked={prefs.ambientSound} onChange={toggleAmbient} />}
            />
            <Row
              title="Reduced motion"
              body="Calms camera moves and avatar animation."
              trailing={<Toggle checked={prefs.reducedMotion} onChange={(v) => setPrefs({ reducedMotion: v })} />}
            />
          </div>
        </Card>

        {/* privacy */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-rounded text-xl font-extrabold text-forest">
            <ShieldCheck size={18} /> Privacy & data
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-inksoft">
            <li>Only your display name, class, avatar, and study timing are shared — with room members only.</li>
            <li>No email, password, or personal details are collected. Notifications are opt-in.</li>
            <li>Your identity is a secure reference stored in this browser; clearing site data means the room may not recognise you.</li>
            <li>Push subscription details are stored server-side and are never visible to other students.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip tone={backendConfigured ? 'forest' : 'grey'}>
              {backendConfigured ? 'Supabase backend' : 'Demo backend (this device)'}
            </Chip>
            <Chip tone="grey">
              Connection: {sync.connection}
            </Chip>
          </div>
        </Card>

        {/* danger */}
        {roomId && (
          <Card className="border-[#B8473D]/30 p-5">
            <h2 className="font-rounded text-xl font-extrabold text-[#B8473D]">Leave classroom</h2>
            <p className="mt-1 text-sm leading-relaxed text-inksoft">
              Your session closes and the bench frees up. The shared clock and leaderboard history are untouched.
            </p>
            <Button variant="danger" className="mt-4" loading={sync.busy} onClick={() => void leave()}>
              <LogOut size={16} /> Leave {sync.room?.name ?? 'classroom'}
            </Button>
          </Card>
        )}
      </main>
    </div>
  )
}
