import type { AvatarSpec } from '../types'

/**
 * Earned avatar gear — cosmetics unlocked by LIFETIME focus hours.
 * The gear ids ride inside the avatar JSONB so they sync to classmates
 * with the existing `set_profile` RPC (server stores them opaquely;
 * there is no storage migration for them).
 */

export interface GearItem {
  id: string
  /** Short label shown in the picker. */
  label: string
  icon: string
  /** Lifetime focus hours required to wear this. */
  unlockHours: number
  /** One-line flavour for the locked tile. */
  blurb: string
}

export const GEAR: GearItem[] = [
  { id: 'cap', label: 'Study Cap', icon: '🧢', unlockHours: 10, blurb: '10 lifetime focus hours' },
  { id: 'glasses', label: 'Focus Frames', icon: '👓', unlockHours: 25, blurb: '25 lifetime focus hours' },
  { id: 'headphones', label: 'Deep-Work Cans', icon: '🎧', unlockHours: 50, blurb: '50 lifetime focus hours' }
]

export const gearById = (id: string): GearItem | undefined => GEAR.find((g) => g.id === id)

/** Gear the student may wear right now, from lifetime focus seconds. */
export const unlockedGearIds = (lifetimeSeconds: number): string[] =>
  GEAR.filter((g) => lifetimeSeconds >= g.unlockHours * 3600).map((g) => g.id)

/** Keep only known gear ids (defensive — the string array is trustless). */
export const sanitizeGear = (gear: unknown): string[] =>
  Array.isArray(gear)
    ? (gear as unknown[]).filter((x): x is string => typeof x === 'string' && gearById(x) !== undefined)
    : []

export const withGear = (avatar: AvatarSpec, gear: string[]): AvatarSpec => ({ ...avatar, gear: sanitizeGear(gear) })

/** Next item to unlock, or null when everything is owned. */
export const nextUnlock = (lifetimeSeconds: number): (GearItem & { remainingSeconds: number }) | null => {
  for (const g of [...GEAR].sort((a, b) => a.unlockHours - b.unlockHours)) {
    const remaining = g.unlockHours * 3600 - lifetimeSeconds
    if (remaining > 0) return { ...g, remainingSeconds: remaining }
  }
  return null
}
