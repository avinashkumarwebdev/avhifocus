import { useEffect } from 'react'
import { AnimatePresence, motion } from './motion'
import { useAppStore } from '../stores/app'

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-5" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto w-full max-w-sm"
          >
            <ToastCard id={t.id} title={t.title} body={t.body} tone={t.tone} onClose={() => dismiss(t.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastCard({
  id: _id,
  title,
  body,
  tone = 'info',
  onClose
}: {
  id: number
  title: string
  body?: string
  tone?: 'info' | 'success' | 'warn'
  onClose: () => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5200)
    return () => window.clearTimeout(timer)
  }, [onClose])

  const bar = tone === 'success' ? 'bg-sage' : tone === 'warn' ? 'bg-[#D9B44A]' : 'bg-terra'
  return (
    <div className="flex items-stretch gap-3 overflow-hidden rounded-2xl border border-wood/20 bg-forest text-cream shadow-pop">
      <div className={`w-1.5 ${bar}`} />
      <div className="flex-1 py-3 pr-1">
        <p className="text-sm font-bold">{title}</p>
        {body && <p className="mt-0.5 text-xs text-cream/75">{body}</p>}
      </div>
      <button onClick={onClose} className="px-3 text-cream/60 transition hover:text-cream" aria-label="Dismiss notification">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
    </div>
  )
}
