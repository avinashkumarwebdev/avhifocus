import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Card, Button, Field, TextInput } from '../components/ui'
import { AvatarPicker } from '../components/AvatarPicker'
import { Wordmark } from '../components/Logo'
import { chevronLeft } from './shared'
import { useIdentityStore, DEFAULT_AVATAR } from '../stores/identity'
import { classLabelSchema as clsSchema, displayNameSchema as nameSchema, classSuggestions as suggestions } from '../lib/validation'
import { getBackend } from '../services/backend'
import type { AvatarSpec } from '../types'
import { ArrowRight } from 'lucide-react'

export default function DetailsPage() {
  const navigate = useNavigate()
  const identity = useIdentityStore((s) => s.identity)
  const setIdentity = useIdentityStore((s) => s.setIdentity)

  const [name, setName] = useState(identity?.displayName ?? '')
  const [klass, setKlass] = useState(identity?.classLabel ?? '')
  const [avatar, setAvatar] = useState<AvatarSpec>(identity?.avatar ?? DEFAULT_AVATAR)
  const [errors, setErrors] = useState<{ name?: string; klass?: string }>({})
  const [lifetimeSeconds, setLifetimeSeconds] = useState<number | undefined>(undefined)

  // Returning students can wear their earned gear here too.
  useEffect(() => {
    if (!identity) return
    let alive = true
    getBackend()
      .getMyStudyStats(identity)
      .then((s) => alive && setLifetimeSeconds(s.lifetimeSeconds))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [identity?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const listId = useMemo(() => `classes-${Math.random().toString(36).slice(2, 8)}`, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const nameCheck = nameSchema.safeParse(name)
    const classCheck = clsSchema.safeParse(klass)
    setErrors({
      name: nameCheck.success ? undefined : nameCheck.error.issues[0].message,
      klass: classCheck.success ? undefined : classCheck.error.issues[0].message
    })
    if (!nameCheck.success || !classCheck.success) return
    setIdentity({ displayName: nameCheck.data, classLabel: classCheck.data, avatar })
    navigate('/hall')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-8">
        <Link to="/" className="rounded-full bg-forest/8 p-2 text-forest transition hover:bg-forest/15" aria-label="Back">
          {chevronLeft}
        </Link>
        <Wordmark compact />
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-16">
        <Card className="p-6">
          <h1 className="font-rounded text-2xl font-extrabold text-forest">Introduce yourself</h1>
          <p className="mt-1 text-sm leading-relaxed text-inksoft">
            No accounts here. Your name and class are shown to classmates in the room — nothing else is collected.
          </p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" error={errors.name}>
                <TextInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Aditi"
                  maxLength={30}
                  autoFocus
                  invalid={!!errors.name}
                />
              </Field>
              <Field label="Class" hint="Pick or type your own" error={errors.klass}>
                <TextInput
                  value={klass}
                  onChange={(e) => setKlass(e.target.value)}
                  placeholder="e.g. Class 10"
                  list={listId}
                  maxLength={18}
                  invalid={!!errors.klass}
                />
                <datalist id={listId}>
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-inksoft">Pick your look</p>
              <div className="rounded-2xl border border-wood/15 bg-white/50 p-4">
                <AvatarPicker value={avatar} onChange={setAvatar} lifetimeSeconds={lifetimeSeconds} />
              </div>
            </div>

            <Button type="submit" full className="!py-3.5">
              Continue <ArrowRight size={16} />
            </Button>
          </form>
        </Card>
        <p className="mt-4 px-2 text-center text-[11px] leading-relaxed text-inksoft/80">
          This identity lives in this browser. If site data is cleared, the classroom may not recognise you — there’s
          no password to recover, so you’d simply introduce yourself again.
        </p>
      </main>
    </div>
  )
}
