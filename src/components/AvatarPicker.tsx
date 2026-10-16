import type { AvatarSpec, HairStyle } from '../types'
import { AVATAR_PRESETS, HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, SKIN_TONES } from '../lib/avatars'
import { GEAR, sanitizeGear } from '../lib/cosmetics'
import { AvatarChip } from './AvatarChip'

const STYLE_LABEL: Record<HairStyle, string> = { short: 'Short', bun: 'Bun', side: 'Side sweep', long: 'Long' }

function SwatchRow({
  label,
  colors,
  active,
  onPick
}: {
  label: string
  colors: string[]
  active: string
  onPick: (c: string) => void
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-inksoft">{label}</p>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            onClick={() => onPick(c)}
            className={`h-8 w-8 rounded-full border-2 transition ${
              active === c ? 'scale-110 border-forest ring-2 ring-forest/30' : 'border-white/80 hover:scale-105'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Gear row — wearables earned with lifetime focus hours. Locked tiles are
 * greyed with 🔒 and their requirement; earned ones toggle on/off.
 */
function GearRow({ value, onChange, lifetimeSeconds }: { value: AvatarSpec; onChange: (n: AvatarSpec) => void; lifetimeSeconds?: number }) {
  const worn = sanitizeGear(value.gear)
  const earned = (h: number) => lifetimeSeconds !== undefined && lifetimeSeconds >= h * 3600
  const toggle = (id: string) => {
    const next = worn.includes(id) ? worn.filter((g) => g !== id) : [...worn, id]
    onChange({ ...value, gear: next })
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-inksoft">Earned gear</p>
      <div className="flex flex-wrap gap-2">
        {GEAR.map((g) => {
          const open = earned(g.unlockHours)
          const active = worn.includes(g.id)
          return (
            <button
              key={g.id}
              type="button"
              disabled={!open}
              onClick={() => toggle(g.id)}
              aria-label={`${g.label} — ${open ? (active ? 'remove' : 'wear') : `locked, ${g.blurb}`}`}
              title={open ? g.label : `🔒 ${g.blurb}`}
              className={`flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 text-lg transition ${
                !open
                  ? 'cursor-not-allowed border-wood/10 bg-creamdark/40 opacity-50'
                  : active
                    ? 'border-forest bg-forest/10 ring-2 ring-forest/30'
                    : 'border-wood/20 bg-cream hover:scale-105'
              }`}
            >
              <span aria-hidden>{open ? g.icon : '🔒'}</span>
              <span className="text-[8.5px] font-bold leading-none text-inksoft">{g.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AvatarPicker({
  value,
  onChange,
  lifetimeSeconds
}: {
  value: AvatarSpec
  onChange: (next: AvatarSpec) => void
  /** Lifetime focus seconds — gates the gear row. Unknown ⇒ everything locked. */
  lifetimeSeconds?: number
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <AvatarChip avatar={value} size={64} />
        <div className="flex flex-wrap gap-1.5">
          {AVATAR_PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange(p)}
              aria-label={`Preset ${i + 1}`}
              className={`rounded-full transition ${JSON.stringify(p) === JSON.stringify(value) ? 'ring-2 ring-forest ring-offset-2 ring-offset-cream' : 'hover:scale-105'}`}
            >
              <AvatarChip avatar={p} size={34} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-inksoft">Hair style</p>
        <div className="flex flex-wrap gap-1.5">
          {HAIR_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...value, hairStyle: s })}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                value.hairStyle === s ? 'bg-forest text-cream' : 'bg-creamdark/70 text-ink hover:bg-creamdark'
              }`}
            >
              {STYLE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <SwatchRow label="Skin" colors={SKIN_TONES} active={value.skin} onPick={(c) => onChange({ ...value, skin: c })} />
      <SwatchRow label="Hair" colors={HAIR_COLORS} active={value.hair} onPick={(c) => onChange({ ...value, hair: c })} />
      <SwatchRow label="Top" colors={SHIRT_COLORS} active={value.shirt} onPick={(c) => onChange({ ...value, shirt: c })} />
      <GearRow value={value} onChange={onChange} lifetimeSeconds={lifetimeSeconds} />
    </div>
  )
}
