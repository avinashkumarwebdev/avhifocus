import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Chip, Spinner } from '../components/ui'
import { Wordmark } from '../components/Logo'
import { HALL_CODE } from '../lib/hall'
import { backendConfigured, getBackend } from '../services/backend'
import { useIdentityStore } from '../stores/identity'
import { useAppStore } from '../stores/app'
import { friendlyJoinError } from './shared'
import { Armchair, ArrowRight, DoorOpen, PencilLine, RefreshCw, Users } from 'lucide-react'
import type { HallPeek } from '../types'

/**
 * The doorway — everyone lands here. Nobody is auto-seated: you look into the
 * shared Hall first, then tap to take a bench. When 0 benches are taken the
 * classroom is dormant: timer, leaderboard and study features stay stopped and
 * the only thing available is your profile. Taking a bench wakes it back up.
 */
export default function HallPage() {
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const applyServerIdentity = useIdentityStore((s) => s.applyServerIdentity)
  const pushToast = useAppStore((s) => s.pushToast)

  const [peek, setPeek] = useState<HallPeek | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const boot = useCallback(async () => {
    if (!identity) return
    setLoading(true)
    setError(null)
    try {
      const backend = getBackend()
      const serverIdentity = await backend.ensureIdentity(identity)
      if (serverIdentity.id !== identity.id) applyServerIdentity(serverIdentity)
      const hall = await backend.peekClassroom(HALL_CODE)
      // Already seated from an earlier visit? Walk straight in.
      const resumed = await backend.resumeClassroom(hall.roomId, serverIdentity)
      if (resumed) {
        navigate(`/room/${hall.roomId}`, { replace: true })
        return
      }
      setPeek(hall)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the classroom.')
    } finally {
      setLoading(false)
    }
  }, [identity, applyServerIdentity, navigate])

  useEffect(() => {
    document.title = 'AVHIFocus — the classroom'
    if (!identity) {
      navigate('/details?next=enter', { replace: true })
      return
    }
    void boot()
  }, [identity, boot, navigate])

  const takeSeat = async () => {
    if (!identity || !peek) return
    setJoining(true)
    setJoinError(null)
    try {
      const backend = getBackend()
      const { classroom, member } = await backend.joinClassroom({ code: HALL_CODE }, identity)
      navigate(`/room/${classroom.id}`, { state: { justJoinedSeat: member.seatNumber } })
    } catch (e) {
      setJoinError(friendlyJoinError(e instanceof Error ? e.message : 'Could not take a seat.'))
      pushToast({ title: 'Seat not taken', tone: 'warn' })
    } finally {
      setJoining(false)
    }
  }

  if (!identity) return null

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-cream">
        <Spinner label="Walking to the classroom…" />
      </div>
    )
  }

  const full = peek ? peek.members >= peek.capacity : false
  const empty = peek ? peek.members === 0 : false

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" aria-label="AVHIFocus home">
          <Wordmark compact />
        </Link>
        <Link
          to="/details"
          className="flex items-center gap-1.5 rounded-full bg-forest/8 px-3 py-1.5 text-xs font-bold text-forest transition hover:bg-forest/15"
        >
          <PencilLine size={13} /> Edit profile
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-stretch px-5 pb-16 pt-4 sm:pt-10">
        <div className="mb-4 flex justify-center" aria-hidden>
          <span className="rounded-full bg-sage/25 p-4">
            <DoorOpen size={36} className="text-forest" />
          </span>
        </div>

        {error && !peek && (
          <Card className="p-6 text-center">
            <p className="font-rounded text-xl font-extrabold text-forest">Can’t see inside just now</p>
            <p className="mt-2 text-sm leading-relaxed text-inksoft">{error}</p>
            <Button full className="mt-5" onClick={() => void boot()}>
              <RefreshCw size={16} /> Try again
            </Button>
          </Card>
        )}

        {peek && (
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-rounded text-2xl font-extrabold text-forest">{peek.name}</h1>
              <Chip tone="sage" className="shrink-0">
                {peek.integrityMode === 'balanced' ? 'moderate' : peek.integrityMode}
              </Chip>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-inksoft">
              One shared classroom · {peek.focusSeconds / 60}-minute focus / {peek.breakSeconds / 60}-minute break
              rhythm · 10 benches.
            </p>

            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-wood/15 bg-white/55 px-4 py-3">
              <Users size={16} className="shrink-0 text-terra" />
              <p className="text-sm font-medium text-ink">
                {empty ? (
                  'Nobody inside right now'
                ) : (
                  <>
                    <span className="font-extrabold">{peek.members}/{peek.capacity}</span> benches taken
                    {peek.studying > 0 && <span className="text-inksoft"> · {peek.studying} focusing now</span>}
                  </>
                )}
              </p>
            </div>

            {empty && (
              <p className="mt-4 rounded-2xl bg-sage/20 px-4 py-3 text-sm leading-relaxed text-forestdeep">
                The classroom is empty right now — the timer, leaderboard and study features are asleep. Nothing runs
                until someone sits down. You can edit your profile, or take a bench and wake the room up.
              </p>
            )}

            {joinError && (
              <p className="mt-4 rounded-2xl bg-[#B8473D]/10 px-4 py-3 text-sm font-medium text-[#8F352D]">
                {joinError}
              </p>
            )}

            <Button full className="mt-5 !py-3.5" loading={joining} disabled={full} onClick={() => void takeSeat()}>
              <Armchair size={17} /> {empty ? 'Take a bench & wake it up' : 'Take a seat'} <ArrowRight size={16} />
            </Button>
            {full && (
              <p className="mt-3 text-center text-xs font-medium text-inksoft">
                All 10 benches are taken — a seat frees up as soon as someone leaves.
              </p>
            )}
            {!backendConfigured && (
              <p className="mt-3 text-center text-[11px] leading-relaxed text-inksoft/80">
                Demo mode — the room starts empty. Sit down, then add demo classmates from the side panel.
              </p>
            )}
          </Card>
        )}
      </main>
    </div>
  )
}
