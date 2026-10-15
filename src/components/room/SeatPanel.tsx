import type { MemberView } from '../../types'
import { AvatarChip } from '../AvatarChip'
import { Sheet, Chip, Button } from '../ui'
import { Armchair, Flame, HandMetal, MessageCircleHeart } from 'lucide-react'
import { QUICK_MESSAGES } from '../../lib/quickMessages'
import { formatDuration, focusSecondsBetween, classroomCycle } from '../../lib/time/cycle'
import type { Classroom } from '../../types'

export function SeatPanel({
  open,
  seat,
  member,
  isMe,
  room,
  nowMs,
  onClose,
  onNudge,
  onSendMessage
}: {
  open: boolean
  seat: number | null
  member: MemberView | null
  isMe: boolean
  room: Classroom | null
  nowMs: number
  onClose: () => void
  onNudge?: (targetStudentId: string) => void
  onSendMessage?: (targetStudentId: string, text: string) => void
}) {
  if (seat == null) return null

  const liveFocusSeconds =
    member?.status === 'studying' && !member.pulsePaused && member.sessionStartedAtMs && room
      ? focusSecondsBetween(classroomCycle(room), member.sessionStartedAtMs, nowMs)
      : 0

  const canNudge =
    room != null &&
    room.integrityMode !== 'relaxed' &&
    member != null &&
    !isMe &&
    member.online &&
    member.status === 'studying' &&
    !member.pulsePaused &&
    onNudge != null

  return (
    <Sheet open={open} onClose={onClose} title={`Seat ${seat}`}>
      {member ? (
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <AvatarChip avatar={member.avatar} size={88} dimmed={!member.online} />
          <div>
            <p className="font-rounded text-xl font-extrabold text-ink">
              {isMe ? `${member.displayName} (you)` : member.displayName}
            </p>
            <p className="mt-0.5 text-sm font-medium text-inksoft">{member.classLabel}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Chip tone={member.status === 'studying' ? 'terra' : 'sage'}>
              {!member.online
                ? 'Away'
                : member.status === 'studying'
                  ? member.pulsePaused
                    ? 'Paused 💤'
                    : 'Focusing'
                  : 'Resting'}
            </Chip>
            {member.isBot && <Chip tone="grey">demo classmate</Chip>}
            {member.status === 'studying' && member.online && !member.pulsePaused && (
              <Chip tone="forest">
                <Flame size={12} /> {formatDuration(liveFocusSeconds)} focus this session
              </Chip>
            )}
          </div>
          {member.pulsePaused && (
            <p className="max-w-xs text-xs leading-relaxed text-inksoft">
              Their timer is paused — no minutes are accruing until they resume. Fair play is visible here.
            </p>
          )}
          {canNudge && (
            <Button variant="ghost" className="!py-2 !text-xs" onClick={() => onNudge(member.studentId)}>
              <HandMetal size={14} /> Nudge “still studying?”
            </Button>
          )}
          {!isMe && member.online && !member.isBot && onSendMessage && (
            <div className="w-full max-w-xs">
              <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-inksoft">
                <MessageCircleHeart size={13} /> Send a quick note
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {QUICK_MESSAGES.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => onSendMessage(member.studentId, m.text)}
                    className="rounded-full border border-wood/25 bg-white/60 px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-forest/50 hover:bg-forest/10 active:scale-95"
                  >
                    {m.text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!member.online && member.status === 'studying' && (
            <p className="max-w-xs text-xs leading-relaxed text-inksoft">
              This student is disconnected. Their session is kept for a grace window, then closed automatically — it
              never counts beyond the cap.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-sage/25 text-sagedeep">
            <Armchair size={34} />
          </span>
          <p className="font-rounded text-lg font-bold text-ink">This bench is free</p>
          <p className="max-w-xs text-sm leading-relaxed text-inksoft">
            Share the classroom code — the next student to join automatically takes the lowest open seat.
          </p>
        </div>
      )}
    </Sheet>
  )
}
