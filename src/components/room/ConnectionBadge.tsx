import type { ConnectionState } from '../../types'
import { CloudOff, RefreshCw, Wifi, FlaskConical } from 'lucide-react'

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === 'live') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-sage/25 px-2.5 py-1 text-[11px] font-semibold text-forestdeep">
        <Wifi size={12} /> Live
      </span>
    )
  }
  if (state === 'demo') {
    return (
      <span
        className="flex items-center gap-1.5 rounded-full bg-[#7D8DA1]/15 px-2.5 py-1 text-[11px] font-semibold text-[#506086]"
        title="Demo backend on this device — open another tab to see realtime"
      >
        <FlaskConical size={12} /> Demo
      </span>
    )
  }
  if (state === 'reconnecting' || state === 'connecting') {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-[#D9B44A]/20 px-2.5 py-1 text-[11px] font-semibold text-[#7A6210]">
        <RefreshCw size={12} className="animate-spin" /> {state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-ink/10 px-2.5 py-1 text-[11px] font-semibold text-inksoft">
      <CloudOff size={12} /> Offline — last sync shown
    </span>
  )
}
