import { useEffect, useState } from 'react'
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
import { nextUnlock } from '../lib/cosmetics'
import type { AvatarSpec, StudyStats } from '../types'
import { Bell, CloudOff, Flame, LogOut, BookOpenText, ShieldAlert, ShieldCheck, Target, Trash2, Volume2 } from 'lucide-react'

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
  const [guardianTarget, setGuardianTarget] = useState('')
  const [guardianPass, setGuardianPass] = useState('')
  const [guardianBusy, setGuardianBusy] = useState(false)
  const [stats, setStats] = useState<StudyStats | null>(null)
  const [goalMins, setGoalMins] = useState(120)
  const [goalBusy, setGoalBusy] = useState(false)
  const [subject, setSubject] = useState('')
  const [subjectBusy, setSubjectBusy] = useState(false)

  // Engagement numbers (goal, streak, hours) — refreshed when the page opens.
  useEffect(() => {
    if (!identity) return
    let alive = true
    getBackend()
      .getMyStudyStats(identity)
      .then((s) => {
        if (!alive) return
        setStats(s)
        setGoalMins(s.goalMinutes)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [identity?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Adopt the room's current subject as the editor's starting text.
  useEffect(() => {
    setSubject(sync.room?.subject ?? '')
  }, [sync.room?.subject])

  if (!identity) {
    navigate('/details?next=enter', { replace: true })
    return null
  }

  const permission = Capacitor.isNativePlatform() ? 'native (Android)' : notificationsSupported() ? Notification.permission : 'unsupported'

  const runGuardianWipe = async () => {
    if (!roomId || !guardianTarget || guardianBusy) return
    const target = sync.members.find((m) => m.studentId === guardianTarget)
    setGuardianBusy(true)
    try {
      await getBackend().pruneStudentData(roomId, identity, guardianTarget, guardianPass)
      pushToast({
        title: 'Data wiped',
        body: `${target?.displayName ?? 'That student'}’s sessions, scores and bench were removed.`,
        tone: 'success'
      })
      setGuardianPass('')
      setGuardianTarget('')
      await sync.refresh()
    } catch (err) {
      pushToast({
        title: 'Wipe failed',
        body: err instanceof Error ? err.message : 'Nothing was deleted. Check the pass and try again.',
        tone: 'warn'
      })
    } finally {
      setGuardianBusy(false)
    }
  }

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

  const saveGoal = async () => {
    if (goalBusy) return
    setGoalBusy(true)
    try {
      await getBackend().setDailyGoal(goalMins, identity)
      setStats((s) => (s ? { ...s, goalMinutes: goalMins } : s))
      pushToast({ title: `Daily goal set to ${goalMins} min`, body: 'Keep a 15+ min day alive to grow your streak.', tone: 'success' })
    } catch (err) {
      pushToast({ title: 'Could not save goal', body: err instanceof Error ? err.message : 'Try again', tone: 'warn' })
    } finally {
      setGoalBusy(false)
    }
  }

  const saveSubject = async () => {
    if (!roomId || subjectBusy) return
    setSubjectBusy(true)
    try {
      await getBackend().setSubject(roomId, subject, identity)
      await sync.refresh()
      pushToast({ title: subject.trim() ? 'Subject chalked on the blackboard' : 'Subject cleared', tone: 'success' })
    } catch (err) {
      pushToast({ title: 'Could not set subject', body: err instanceof Error ? err.message : 'Try again', tone: 'warn' })
    } finally {
      setSubjectBusy(false)
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
            <AvatarPicker value={avatar} onChange={setAvatar} lifetimeSeconds={stats?.lifetimeSeconds} />
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

        {/* daily goal + streak */}
        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-rounded text-xl font-extrabold text-forest">
            <Target size={18} /> Daily goal & streak
          </h2>
          {stats ? (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-700">
                  <Flame size={13} /> {stats.streakDays}-day streak
                </span>
                <span className="font-semibold text-ink">
                  Today {Math.floor(stats.todaySeconds / 60)}
                  <span className="text-inksoft">/{stats.goalMinutes} min</span>
                </span>
                <span className="text-xs text-inksoft">
                  This week {(stats.weekSeconds / 3600).toFixed(1)}h · total {(stats.lifetimeSeconds / 3600).toFixed(1)}h
                </span>
              </div>
              {/* today's progress toward the goal */}
              <div className="h-2.5 overflow-hidden rounded-full bg-sage/25" role="progressbar"
                   aria-valuenow={Math.min(100, Math.round((stats.todaySeconds / (stats.goalMinutes * 60)) * 100))}
                   aria-valuemin={0} aria-valuemax={100} aria-label="Today’s progress toward the daily goal">
                <div
                  className="h-full rounded-full bg-forest transition-all"
                  style={{ width: `${Math.min(100, (stats.todaySeconds / Math.max(60, stats.goalMinutes * 60)) * 100).toFixed(1)}%` }}
                />
              </div>
              {(() => {
                const next = nextUnlock(stats.lifetimeSeconds)
                return next ? (
                  <p className="text-xs text-inksoft">
                    🎁 {Math.floor(next.remainingSeconds / 3600)}h {Math.round((next.remainingSeconds % 3600) / 60)}m of focus unlocks <b>{next.label}</b> {next.icon} for your avatar.
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-forest">🎁 Every avatar gear item unlocked — impressive.</p>
                )
              })()}
              <div className="flex flex-wrap items-center gap-2">
                <Field label="Goal (minutes)" hint="15–720">
                  <TextInput
                    type="number" min={15} max={720} step={5}
                    value={goalMins}
                    onChange={(e) => setGoalMins(Math.max(15, Math.min(720, Number(e.target.value) || 15)))}
                    className="w-28"
                  />
                </Field>
                <Button type="button" onClick={() => void saveGoal()} loading={goalBusy} className="mt-5">
                  Save goal
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-inksoft/80">
                A ≥15-minute focus day keeps the flame alive; it’s safe until midnight. Quick presets: 30 · 60 · 120 · 180.
              </p>
              <div className="flex gap-1.5">
                {[30, 60, 120, 180].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGoalMins(m)}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                      goalMins === m ? 'bg-forest text-cream' : 'bg-creamdark/70 text-ink hover:bg-creamdark'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-inksoft">Loading your study numbers…</p>
          )}
        </Card>

        {/* subject of the day */}
        {roomId && (
          <Card className="p-5">
            <h2 className="flex items-center gap-2 font-rounded text-xl font-extrabold text-forest">
              <BookOpenText size={18} /> Subject of the day
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-inksoft">
              Chalked onto the classroom blackboard and shown on the Hall card. Anyone in the room can change it.
            </p>
            <div className="mt-3 flex items-end gap-2">
              <Field label="Today we’re studying" hint={`${subject.trim().length}/40`}>
                <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={40} placeholder="e.g. Trigonometry ch. 8" />
              </Field>
              <Button type="button" onClick={() => void saveSubject()} loading={subjectBusy} className="mb-0.5">
                Save
              </Button>
            </div>
          </Card>
        )}

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

        {/* guardian tools — special-pass data wipe for misuse cases */}
        {roomId && (
          <Card className="border-[#D9B44A]/40 bg-[#FFFBEF] p-5">
            <h2 className="flex items-center gap-2 font-rounded text-xl font-extrabold text-[#8A6D1A]">
              <ShieldAlert size={18} /> Guardian tools
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-inksoft">
              For misuse cases only (e.g. someone joined with a rude name or from a shared device): with the
              special pass you can erase one student’s data from this classroom — focus history, leaderboard
              scores, notifications and their bench.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Student to wipe">
                <select
                  value={guardianTarget}
                  onChange={(e) => setGuardianTarget(e.target.value)}
                  className="w-full rounded-2xl border border-wood/25 bg-cream px-3.5 py-2.5 text-sm font-medium text-ink outline-none focus:border-forest"
                >
                  <option value="">Choose a student…</option>
                  {sync.members
                    .filter((m) => !m.isBot)
                    .map((m) => (
                      <option key={m.studentId} value={m.studentId}>
                        {m.displayName} · {m.classLabel}
                        {m.studentId === identity.id ? ' (you)' : ''}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Special pass" hint="Never stored. 8 characters.">
                <TextInput
                  value={guardianPass}
                  onChange={(e) => setGuardianPass(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  maxLength={16}
                  autoComplete="off"
                />
              </Field>
              <Button
                variant="danger"
                loading={guardianBusy}
                disabled={!guardianTarget || guardianPass.length < 8}
                onClick={() => void runGuardianWipe()}
              >
                <Trash2 size={15} /> Wipe their data
              </Button>
              <p className="text-[11px] leading-relaxed text-inksoft/80">
                This cannot be undone. Their timer stops immediately and the bench frees up.
              </p>
            </div>
          </Card>
        )}

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
