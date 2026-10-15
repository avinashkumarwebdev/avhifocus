import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Leaderboard } from '../types'
import { getBackend, syncServerClock, serverNowMs } from '../services/backend'
import { useIdentityStore } from '../stores/identity'
import { useServerNow } from '../hooks/useNow'
import { useRoomSync } from '../hooks/useRoomSync'
import { Card, Chip, Spinner } from '../components/ui'
import { AvatarChip } from '../components/AvatarChip'
import { Wordmark } from '../components/Logo'
import { chevronLeft } from './shared'
import { formatDuration } from '../lib/time/cycle'
import { Crown, RefreshCw } from 'lucide-react'

const rankTone = ['border-[#D9B44A] bg-[#D9B44A]/14', 'border-[#A8B0B8] bg-[#A8B0B8]/14', 'border-[#B87B4C] bg-[#B87B4C]/14']

export default function LeaderboardPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const sync = useRoomSync(roomId)
  const nowMs = useServerNow(1000)

  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!roomId || !identity || sync.status !== 'ready') return
    try {
      await syncServerClock()
      const data = await getBackend().getLeaderboard(roomId, identity)
      setBoard(data)
    } catch {
      /* keep last snapshot — room page already surfaces connection state */
    } finally {
      setLoading(false)
    }
  }, [roomId, identity, sync.status])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  if (!identity) {
    navigate('/details?next=enter', { replace: true })
    return null
  }

  const remainingMs = board ? Math.max(0, board.periodEndMs - serverNowMs()) : 0

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-8">
        <Link
          to={`/room/${roomId}`}
          className="rounded-full bg-forest/8 p-2 text-forest transition hover:bg-forest/15"
          aria-label="Back to classroom"
        >
          {chevronLeft}
        </Link>
        <Wordmark compact />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-rounded text-2xl font-extrabold text-forest">48-hour leaderboard</h1>
            <p className="mt-1 text-sm text-inksoft">
              {sync.room?.name ?? 'Classroom'} · only true focus minutes count — breaks never score.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {board && board.integrityMode !== 'relaxed' && (
              <Chip tone="sage" title="Minutes are pulse-verified in this room">
                ✓ verified minutes
              </Chip>
            )}
            {board && (
              <Chip tone="terra">
                <RefreshCw size={12} /> resets in {formatDuration(Math.floor(remainingMs / 1000))}
              </Chip>
            )}
          </div>
        </div>

        <Card className="mt-5 overflow-hidden">
          {loading && !board ? (
            <div className="flex justify-center py-14">
              <Spinner label="Counting focus minutes…" />
            </div>
          ) : !board || board.rows.length === 0 ? (
            <p className="px-6 py-14 text-center text-sm text-inksoft">
              Nobody has banked focus minutes in this 48-hour period yet. Be the first — start a session.
            </p>
          ) : (
            <ul className="divide-y divide-wood/10">
              {board.rows.map((row) => {
                const medal = row.rank <= 3 && row.seconds > 0
                return (
                  <li
                    key={row.studentId}
                    className={`flex items-center gap-3 px-4 py-3 ${row.isMe ? 'bg-forest/6' : ''}`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-rounded text-sm font-extrabold ${
                        medal ? `${rankTone[row.rank - 1]} text-ink` : 'border-wood/15 text-inksoft'
                      }`}
                    >
                      {row.rank === 1 && row.seconds > 0 ? <Crown size={15} className="text-[#A8871A]" /> : row.rank}
                    </span>
                    <AvatarChip avatar={row.avatar} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">
                        {row.displayName} {row.isMe && <span className="text-forest">· you</span>}
                      </span>
                      <span className="block text-xs text-inksoft">{row.classLabel}</span>
                    </span>
                    <span className="font-rounded text-base font-extrabold tabular-nums text-forest">
                      {formatDuration(row.seconds)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <p className="mt-4 px-1 text-center text-[11px] leading-relaxed text-inksoft/80">
          Equal focus time shares a rank. History is never deleted — this view shows the current period; a new race
          starts automatically when it ends.
        </p>
      </main>
    </div>
  )
}
