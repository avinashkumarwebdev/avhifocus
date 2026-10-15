import { useEffect, useRef } from 'react'

/**
 * Strict-mode client signals (best-effort hardening, documented as such):
 *  - no input activity for 18 minutes while studying → self-pause
 *  - tab hidden for more than 90 seconds → self-pause
 * Resuming is always one tap; the paused gap simply never counts.
 */
export function useStrictGuard(enabled: boolean, selfPause: () => Promise<void>) {
  const pauseRef = useRef(selfPause)
  pauseRef.current = selfPause

  useEffect(() => {
    if (!enabled) return
    const IDLE_MS = 18 * 60_000
    const HIDDEN_GRACE_MS = 90_000
    let idleTimer = 0
    let hiddenTimer = 0

    const pause = () => {
      void pauseRef.current()
    }
    const armIdle = () => {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(pause, IDLE_MS)
    }
    const onVisibility = () => {
      window.clearTimeout(hiddenTimer)
      if (document.hidden) {
        hiddenTimer = window.setTimeout(() => {
          if (document.hidden) pause()
        }, HIDDEN_GRACE_MS)
      }
    }

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, armIdle, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    armIdle()

    return () => {
      window.clearTimeout(idleTimer)
      window.clearTimeout(hiddenTimer)
      events.forEach((e) => window.removeEventListener(e, armIdle))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])
}
