import { CAMERA_VIEWS } from '../../three/cameraViews'
import { Armchair, Eye, GraduationCap, Home, Map, SunMedium } from 'lucide-react'

const ICONS: Record<string, typeof Home> = {
  overview: Home,
  board: GraduationCap,
  window: SunMedium,
  aisle: Eye,
  top: Map
}

/**
 * Floating camera preset switcher for the 3D classroom.
 * Selecting a preset exits seat-focus; "My bench" jumps straight to your seat.
 */
export function ViewPicker({
  active,
  seatFocused,
  onPick,
  onMySeat
}: {
  active: string
  seatFocused: boolean
  onPick: (id: string) => void
  onMySeat: () => void
}) {
  return (
    <div
      role="toolbar"
      aria-label="Camera views"
      className="flex flex-col gap-1 rounded-full border border-wood/15 bg-cream/92 p-1.5 shadow-card backdrop-blur-sm"
    >
      {CAMERA_VIEWS.map((v) => {
        const Icon = ICONS[v.id] ?? Home
        const isActive = !seatFocused && active === v.id
        return (
          <button
            key={v.id}
            onClick={() => onPick(v.id)}
            title={v.label}
            aria-label={`Camera: ${v.label}`}
            aria-pressed={isActive}
            className={`rounded-full p-2 transition ${
              isActive ? 'bg-forest text-cream shadow' : 'text-inksoft hover:bg-forest/10 hover:text-forest'
            }`}
          >
            <Icon size={16} />
          </button>
        )
      })}
      <div className="mx-auto h-px w-6 bg-wood/20" />
      <button
        onClick={onMySeat}
        title="My bench"
        aria-label="Camera: my bench"
        aria-pressed={seatFocused}
        className={`rounded-full p-2 transition ${
          seatFocused ? 'bg-terra text-cream shadow' : 'text-inksoft hover:bg-forest/10 hover:text-forest'
        }`}
      >
        <Armchair size={16} />
      </button>
    </div>
  )
}
