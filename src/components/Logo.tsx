export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
      <rect x="16" y="16" width="480" height="480" rx="112" fill="#244B38" />
      <circle cx="256" cy="150" r="54" fill="#D77A4A" />
      <circle cx="256" cy="150" r="34" fill="#F4EBDD" opacity="0.92" />
      <path d="M256 196c-24 0-44 14-52 34h104c-8-20-28-34-52-34z" fill="#A7B99A" />
      <path d="M112 268c40-18 88-18 128 4v118c-40-22-88-22-128-4V268z" fill="#F4EBDD" />
      <path d="M400 268c-40-18-88-18-128 4v118c40-22 88-22 128-4V268z" fill="#EFE3CF" />
      <rect x="104" y="260" width="304" height="134" rx="14" fill="none" stroke="#244B38" strokeWidth="12" opacity="0.35" />
    </svg>
  )
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={compact ? 30 : 38} />
      <span className={`font-rounded font-bold tracking-tight text-forest ${compact ? 'text-lg' : 'text-2xl'}`}>
        AVHI<span className="text-terra">Focus</span>
      </span>
    </div>
  )
}
