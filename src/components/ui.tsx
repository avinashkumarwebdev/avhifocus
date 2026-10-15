import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/* ── Buttons ─────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  full?: boolean
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-terra text-cream hover:bg-terradeep active:translate-y-px shadow-[0_6px_16px_-6px_rgba(215,122,74,0.65)]',
  secondary:
    'bg-forest text-cream hover:bg-forestdeep active:translate-y-px shadow-[0_6px_16px_-8px_rgba(36,75,56,0.7)]',
  ghost: 'bg-creamdark/60 text-ink hover:bg-creamdark border border-wood/20',
  danger: 'bg-[#B8473D] text-cream hover:bg-[#9E3B32] active:translate-y-px',
  quiet: 'bg-transparent text-inksoft hover:bg-forest/8'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, full = false, className = '', children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold
        transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest
        ${variants[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

/* ── Card ────────────────────────────────────────────────────────────── */

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-3xl border border-wood/15 bg-white/70 shadow-card backdrop-blur-[2px] ${className}`}>
      {children}
    </div>
  )
}

/* ── Fields ──────────────────────────────────────────────────────────── */

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-inksoft">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-[#B8473D]">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-inksoft/80">{hint}</span>
      ) : null}
    </label>
  )
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid = false, className = '', ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={`w-full rounded-2xl border bg-white/80 px-4 py-3 text-[15px] font-medium text-ink
        placeholder:text-inksoft/50 focus:outline-none focus:ring-2
        ${invalid ? 'border-[#B8473D]/60 focus:ring-[#B8473D]/30' : 'border-wood/25 focus:border-forest/50 focus:ring-forest/20'}
        ${className}`}
      {...rest}
    />
  )
})

/* ── Chips & badges ──────────────────────────────────────────────────── */

const chipTones = {
  forest: 'bg-forest/10 text-forest',
  sage: 'bg-sage/30 text-forestdeep',
  terra: 'bg-terra/15 text-terradeep',
  warn: 'bg-[#D9B44A]/25 text-[#7A6210]',
  grey: 'bg-ink/8 text-inksoft'
} as const

export function Chip({
  tone = 'forest',
  className = '',
  title,
  children
}: {
  tone?: keyof typeof chipTones
  className?: string
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${chipTones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function StatusDot({ studying, online }: { studying: boolean; online: boolean }) {
  const color = !online ? 'bg-ink/30' : studying ? 'bg-terra' : 'bg-sage'
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {studying && online && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`} />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
    </span>
  )
}

/* ── Progress ring ───────────────────────────────────────────────────── */

export function ProgressRing({
  progress,
  size = 92,
  stroke = 7,
  tone,
  children
}: {
  progress: number
  size?: number
  stroke?: number
  tone: 'focus' | 'break'
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(1, Math.max(0, progress))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-wood/15" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className={`transition-[stroke-dashoffset] duration-500 ease-linear ${tone === 'focus' ? 'stroke-terra' : 'stroke-sage'}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

/* ── Modal sheet ─────────────────────────────────────────────────────── */

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative m-0 max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-wood/20 bg-cream p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:m-4 sm:rounded-3xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-rounded text-lg font-bold text-forest">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full bg-forest/8 p-2 text-inksoft transition hover:bg-forest/15"
            aria-label="Close dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ── Spinner ─────────────────────────────────────────────────────────── */

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-inksoft">
      <Loader2 className="h-8 w-8 animate-spin text-forest" aria-hidden />
      {label && <p className="text-sm font-medium">{label}</p>}
    </div>
  )
}
