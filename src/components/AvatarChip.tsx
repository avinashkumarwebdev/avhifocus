import type { AvatarSpec } from '../types'

/**
 * Small CSS-authored avatar portrait used in 2D UI (matching the 3D avatar
 * colors). Cheap to render, always crisp.
 */
export function AvatarChip({
  avatar,
  size = 40,
  dimmed = false
}: {
  avatar: AvatarSpec
  size?: number
  dimmed?: boolean
}) {
  const hairTop = avatar.hairStyle === 'bun' ? '18%' : '26%'
  return (
    <div
      className={`relative overflow-hidden rounded-full border-2 border-cream shadow-inner transition-opacity ${
        dimmed ? 'opacity-50 grayscale-[40%]' : ''
      }`}
      style={{ width: size, height: size, backgroundColor: avatar.shirt }}
      aria-hidden="true"
    >
      {/* head */}
      <div
        className="absolute left-1/2 rounded-full"
        style={{
          width: '54%',
          height: '54%',
          top: '18%',
          transform: 'translateX(-50%)',
          backgroundColor: avatar.skin
        }}
      />
      {/* hair */}
      <div
        className="absolute left-1/2"
        style={{
          width: avatar.hairStyle === 'long' ? '66%' : '58%',
          height: avatar.hairStyle === 'long' ? '52%' : '34%',
          top: hairTop === '18%' ? '4%' : '10%',
          transform: 'translateX(-50%)',
          backgroundColor: avatar.hair,
          borderRadius:
            avatar.hairStyle === 'short'
              ? '999px 999px 30% 30%'
              : avatar.hairStyle === 'side'
                ? '70% 999px 40% 60%'
                : avatar.hairStyle === 'long'
                  ? '999px 999px 45% 45%'
                  : '999px'
        }}
      />
      {avatar.hairStyle === 'bun' && (
        <div
          className="absolute left-1/2 rounded-full"
          style={{ width: '26%', height: '26%', top: '0%', transform: 'translateX(-50%)', backgroundColor: avatar.hair }}
        />
      )}
      {/* eyes */}
      <div className="absolute left-1/2 flex gap-[9%]" style={{ top: '40%', transform: 'translateX(-50%)', width: '34%' }}>
        <div className="aspect-square w-[22%] rounded-full bg-ink/80" />
        <div className="aspect-square w-[22%] rounded-full bg-ink/80" />
      </div>
    </div>
  )
}
