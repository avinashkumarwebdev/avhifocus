import type { MemberView } from '../../types'
import { AvatarChip } from '../AvatarChip'
import { StatusDot } from '../ui'
import { Users, Sparkles } from 'lucide-react'

function statusText(m: MemberView, nowMs: number): string {
  if (!m.online) return m.status === 'studying' ? 'away — session held' : 'away'
  if (m.status === 'studying' && m.pulsePaused) return 'paused 💤 — nothing accruing'
  if (m.status === 'studying' && m.sessionStartedAtMs) {
    const mins = Math.max(0, Math.floor((nowMs - m.sessionStartedAtMs) / 60000))
    if (mins < 1) return 'focusing · just started'
    if (mins < 60) return `focusing · ${mins}m`
    return `focusing · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
  }
  return 'resting'
}

export function ParticipantsPanel({
  members,
  myStudentId,
  capacity,
  nowMs,
  onSelect
}: {
  members: MemberView[]
  myStudentId: string | undefined
  capacity: number
  nowMs: number
  onSelect: (seat: number) => void
}) {
  const studying = members.filter((m) => m.status === 'studying').length
  return (
    <div className="flex flex-col gap-2 rounded-3xl border border-wood/15 bg-cream/92 p-3 shadow-card backdrop-blur-sm">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-inksoft">
          <Users size={13} /> Classmates
        </span>
        <span className="text-[11px] font-semibold text-inksoft">
          {members.length}/{capacity} · {studying} focusing
        </span>
      </div>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-0.5">
        {members.map((m) => (
          <li key={m.memberId}>
            <button
              onClick={() => onSelect(m.seatNumber)}
              className="flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition hover:bg-forest/6"
            >
              <AvatarChip avatar={m.avatar} size={34} dimmed={!m.online} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-ink">
                  {m.studentId === myStudentId ? `You · ${m.displayName}` : m.displayName}
                  {m.isBot && (
                    <span className="ml-1.5 rounded-full bg-[#7D8DA1]/15 px-1.5 py-0.5 align-middle text-[9px] font-bold text-[#506086]">
                      demo
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] font-medium text-inksoft">
                  {m.classLabel} · seat {m.seatNumber} · {statusText(m, nowMs)}
                </span>
              </span>
              <StatusDot studying={m.status === 'studying'} online={m.online} />
            </button>
          </li>
        ))}
      </ul>
      {members.length <= 1 && (
        <p className="flex items-start gap-1.5 rounded-xl bg-sage/20 px-2.5 py-2 text-[11px] leading-snug text-forestdeep">
          <Sparkles size={12} className="mt-0.5 shrink-0" />
          It's quiet in here. Share your classroom code so friends can take a seat.
        </p>
      )}
    </div>
  )
}
