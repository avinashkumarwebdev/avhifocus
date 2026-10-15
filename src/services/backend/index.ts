import { LocalBackend } from './local'
import { SupabaseBackend } from './supabaseBackend'
import { browserStorage, BroadcastChannelAdapter } from './localStore'
import type { Backend } from './types'

export type { Backend } from './types'
export { LocalBackend } from './local'
export { memoryStorage, TestChannelHub } from './localStore'

let cached: Backend | null = null

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const backendConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export function getBackend(): Backend {
  if (cached) return cached
  if (backendConfigured) {
    cached = new SupabaseBackend(supabaseUrl as string, supabaseAnonKey as string)
  } else {
    cached = new LocalBackend({
      storage: browserStorage(),
      channel: BroadcastChannelAdapter.create()
    })
  }
  return cached
}

/** Server-time offset (serverNowMs - performance clock). Local/demo: 0. */
let serverOffsetMs = 0
let lastSyncAt = 0

export async function syncServerClock(): Promise<void> {
  if (Date.now() - lastSyncAt < 15_000) return
  lastSyncAt = Date.now()
  try {
    serverOffsetMs = await getBackend().syncServerTime()
  } catch {
    /* keep last known offset — countdown stays coherent locally */
  }
}

export function serverNowMs(): number {
  return Date.now() + serverOffsetMs
}
