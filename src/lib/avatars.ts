import type { AvatarSpec, HairStyle } from '../types'

export const HAIR_STYLES: HairStyle[] = ['short', 'bun', 'side', 'long']

export const AVATAR_PRESETS: AvatarSpec[] = [
  { skin: '#F2C9A4', hair: '#3B2A1E', hairStyle: 'short', shirt: '#D77A4A' },
  { skin: '#E8B58C', hair: '#14100C', hairStyle: 'long', shirt: '#5F7A5E' },
  { skin: '#C98B5E', hair: '#241A12', hairStyle: 'bun', shirt: '#A7B99A' },
  { skin: '#8D5A34', hair: '#120E0A', hairStyle: 'side', shirt: '#D9B44A' },
  { skin: '#F5D7B8', hair: '#7A4A22', hairStyle: 'long', shirt: '#7D8DA1' },
  { skin: '#E0AC7E', hair: '#2E211A', hairStyle: 'bun', shirt: '#B85F33' },
  { skin: '#B97B4C', hair: '#1D1510', hairStyle: 'short', shirt: '#244B38' },
  { skin: '#F0C6A8', hair: '#5C3A20', hairStyle: 'side', shirt: '#8B6345' }
]

export const SKIN_TONES = ['#F5D7B8', '#F2C9A4', '#E8B58C', '#C98B5E', '#B97B4C', '#8D5A34']
export const HAIR_COLORS = ['#14100C', '#241A12', '#3B2A1E', '#5C3A20', '#7A4A22', '#8A8F96']
export const SHIRT_COLORS = ['#D77A4A', '#5F7A5E', '#244B38', '#7D8DA1', '#D9B44A', '#B85F33', '#A7B99A', '#8B6345']

export function randomAvatar(random: () => number = Math.random): AvatarSpec {
  const pick = <T,>(arr: T[]) => arr[Math.floor(random() * arr.length)]
  return {
    skin: pick(SKIN_TONES),
    hair: pick(HAIR_COLORS),
    hairStyle: pick(HAIR_STYLES),
    shirt: pick(SHIRT_COLORS)
  }
}
