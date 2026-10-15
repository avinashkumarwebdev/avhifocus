import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wordmark } from '../components/Logo'
import { Button, Card, Chip } from '../components/ui'
import { useIdentityStore } from '../stores/identity'
import { useAppStore } from '../stores/app'
import { backendConfigured } from '../services/backend'
import { ArrowRight, Clock3, Download, Users, Trophy, FlaskConical, DoorOpen } from 'lucide-react'

export default function WelcomePage() {
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const installPrompt = useAppStore((s) => s.installPrompt)
  const setInstallPrompt = useAppStore((s) => s.setInstallPrompt)
  const pushToast = useAppStore((s) => s.pushToast)

  useEffect(() => {
    document.title = 'AVHIFocus — study together, quietly'
  }, [])

  const enter = () => {
    navigate(identity ? '/hall' : '/details?next=enter')
  }

  const install = async () => {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') pushToast({ title: 'Installing AVHIFocus…', tone: 'success' })
    } finally {
      setInstallPrompt(null)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      {/* soft backdrop shapes */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-sage/25 to-transparent" />
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <Wordmark compact />
        {installPrompt && (
          <Button variant="ghost" onClick={() => void install()} className="!rounded-full !px-4 !py-2 text-xs">
            <Download size={14} /> Install app
          </Button>
        )}
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-5 pb-16 pt-6 text-center sm:pt-12">
        <Chip tone="sage" className="mb-5">no accounts · just find a bench and focus</Chip>
        <h1 className="font-rounded text-4xl font-extrabold leading-[1.08] tracking-tight text-forest sm:text-5xl">
          One shared classroom,<br />
          <span className="text-terra">open to everyone.</span>
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-inksoft sm:text-lg">
          AVHIFocus seats up to 10 classmates at one shared table. A 50-minute focus / 10-minute break clock keeps
          everyone in rhythm — you just bring your books.
        </p>

        {!backendConfigured && (
          <p className="mt-5 flex max-w-md items-center justify-center gap-2 rounded-2xl border border-[#7D8DA1]/30 bg-[#7D8DA1]/10 px-4 py-2.5 text-xs font-medium text-[#44536E]">
            <FlaskConical size={14} className="shrink-0" />
            Demo mode (no Supabase configured) — invite via a second browser tab to see realtime. Leaderboards and
            notifications are simulated locally.
          </p>
        )}

        <Card className="mt-8 w-full max-w-md !rounded-3xl p-6 text-left">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-sage/25 p-3">
              <DoorOpen size={22} className="text-forest" />
            </span>
            <div>
              <h2 className="font-rounded text-lg font-bold text-forest">The classroom</h2>
              <p className="text-sm text-inksoft">Ten benches, one shared clock. Peek in, then take a seat.</p>
            </div>
          </div>
          <Button onClick={enter} full className="mt-5 !py-3.5 !text-base">
            Enter the classroom <ArrowRight size={16} />
          </Button>
          {!identity && (
            <p className="mt-3 text-center text-[11px] leading-relaxed text-inksoft/80">
              First time? We’ll ask your name and class on the way in — nothing else.
            </p>
          )}
        </Card>

        <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
          {[
            { icon: Clock3, title: 'A clock that never stops', body: 'The 50/10 cycle runs from the server — even while you sleep.' },
            { icon: Users, title: 'Ten benches, real presence', body: 'See who’s focusing right now and spot a friendly face mid-session.' },
            { icon: Trophy, title: 'A fresh race every 48h', body: 'Only real focus minutes count. Breaks never score points.' }
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-wood/10 bg-white/55 p-4">
              <f.icon size={18} className="text-terra" />
              <p className="mt-2 text-sm font-bold text-forest">{f.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-inksoft">{f.body}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 px-5 pb-6 text-center text-[11px] text-inksoft/70">
        Your name and class are visible to classmates. No email, no password — ever.
      </footer>
    </div>
  )
}
