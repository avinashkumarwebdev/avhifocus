import { useEffect, useReducer } from 'react'
import { serverNowMs } from '../services/backend'

/**
 * Ticking clock anchored to trusted server time.
 * The display re-renders on an interval, but the value itself is always
 * derived from (monotonic-ish) Date.now + server offset — so background
 * tabs, sleep, and drift never corrupt the countdown. The hook periodically
 * re-syncs the offset (see useRoomSync).
 */
export function useServerNow(intervalMs = 500): number {
  const [, tick] = useReducer((c) => c + 1, 0)
  useEffect(() => {
    const id = window.setInterval(tick, intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return serverNowMs()
}
