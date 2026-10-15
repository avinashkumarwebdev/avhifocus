import type { MemberView, Phase } from '../types'
import { AvatarChip } from '../components/AvatarChip'
import { CAPACITY } from './Bench'
import { Armchair, GraduationCap } from 'lucide-react'

/**
 * Simplified seat map used when WebGL is unavailable or fails to initialise.
 * Fully interactive — real backend state, same tap-to-inspect behaviour.
 */
export function Fallback2D({
  members,
  mySeat,
  selectedSeat,
  onSelectSeat,
  phase
}: {
  members: MemberView[]
  mySeat: number | null
  selectedSeat: number | null
  onSelectSeat: (seat: number | null) => void
  phase: Phase
}) {
  const bySeat = new Map<number, MemberView>()
  for (const m of members) bySeat.set(m.seatNumber, m)

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-cream p-4">
      <p className="mb-3 rounded-xl bg-creamdark/70 px-3 py-2 text-center text-xs font-medium text-inksoft">
        Simplified classroom view (3D unavailable on this device)
      </p>
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-4 rounded-xl bg-[#2E4A3C] py-2 text-center text-sm font-bold text-cream/90 shadow-inner">
          Blackboard
        </div>
        <div className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-forest/20 bg-white/60 py-2 text-xs font-semibold text-forest">
          <GraduationCap size={15} />
          Teacher on duty · {phase === 'focus' ? 'keeping time' : 'break time'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: CAPACITY }, (_, i) => i + 1).map((seat) => {
            const m = bySeat.get(seat) ?? null
            const selected = seat === selectedSeat
            return (
              <button
                key={seat}
                onClick={() => onSelectSeat(seat)}
                className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition active:scale-[0.98] ${
                  selected
                    ? 'border-terra bg-terra/10'
                    : m
                      ? 'border-wood/20 bg-white/70'
                      : 'border-dashed border-sagedeep/40 bg-white/40'
                }`}
              >
                {m ? (
                  <>
                    <AvatarChip avatar={m.avatar} size={44} dimmed={!m.online} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink">
                        {seat === mySeat ? 'You · ' : ''}
                        {m.displayName}
                      </span>
                      <span className="block text-xs text-inksoft">
                        {m.classLabel} · {!m.online ? 'away' : m.status === 'studying' ? 'focusing' : 'resting'}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage/30 text-sagedeep">
                      <Armchair size={20} />
                    </span>
                    <span className="text-sm font-semibold text-sagedeep">Seat {seat} — open</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
