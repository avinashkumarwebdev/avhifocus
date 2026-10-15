import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AvatarSpec, Identity } from '../types'
import { AVATAR_PRESETS } from '../lib/avatars'

/**
 * Account-free identity. A stable installation UUID + public display fields.
 *
 * IMPORTANT: this is NOT an auth credential. Every privileged backend call
 * validates the caller against the authenticated principal (Supabase anonymous
 * auth in production; the demo backend enforces the same interface locally).
 */
interface IdentityState {
  identity: Identity | null
  lastRoom: { id: string; name: string } | null
  setIdentity: (p: { displayName: string; classLabel: string; avatar: AvatarSpec }) => Identity
  applyServerIdentity: (identity: Identity) => void
  setLastRoom: (room: { id: string; name: string } | null) => void
  clear: () => void
}

function newInstallationId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `inst-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  }
}

export const useIdentityStore = create<IdentityState>()(
  persist(
    (set, get) => ({
      identity: null,
      lastRoom: null,
      setIdentity: ({ displayName, classLabel, avatar }) => {
        const existing = get().identity
        const identity: Identity = {
          id: existing?.id ?? newInstallationId(),
          displayName,
          classLabel,
          avatar
        }
        set({ identity })
        return identity
      },
      applyServerIdentity: (identity) => set({ identity }),
      setLastRoom: (room) => set({ lastRoom: room }),
      clear: () => set({ identity: null, lastRoom: null })
    }),
    { name: 'avhifocus.identity.v2' }
  )
)

export const DEFAULT_AVATAR: AvatarSpec = AVATAR_PRESETS[0]
