import { HeartPulse } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth, type HospitalChoice } from '../auth'
import { Button, Field, inputCls } from '../components/ui'

export default function Login() {
  const [params] = useSearchParams()
  const wasInactive = params.get('reason') === 'inactivity'
  const { me, login, completeMfa } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [choices, setChoices] = useState<HospitalChoice[] | null>(null)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (me) return <Navigate to="/" replace />

  const go = async (tenantId?: string) => {
    setBusy(true)
    setError('')
    try { const r = await login(email, password, tenantId); if (r && 'challenge' in r) setChallenge(r.challenge); else setChoices(r) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (challenge) void verify(e); else void go() }
  const verify = async (e: FormEvent) => {
    e.preventDefault(); if (code.length < 6) return
    setBusy(true); setError('')
    try { await completeMfa(challenge!, code) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-screen place-items-center overflow-auto bg-gradient-to-br from-[#0b1a33] via-[#10294f] to-[#0d4a4b] p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-2 text-2xl">
          <HeartPulse className="text-brand-800" size={28} strokeWidth={2.5} />
          <span className="font-bold tracking-tight text-ink">Swasthya</span>
        </div>
        {wasInactive && (
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
            <strong>Session expired due to inactivity.</strong> Signed out automatically to safeguard patient records (HIPAA compliance).
          </div>
        )}
        {challenge ? (
          <>
            <div><h1 className="text-xl font-semibold">Enter your code</h1><p className="mt-1 text-sm text-muted">Open your authenticator app and type the 6-digit code. Lost your phone? Use one of your recovery codes.</p></div>
            <Field label="Code"><input className={`${inputCls} text-center text-xl tracking-widest`} autoFocus autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.trim())} maxLength={13} placeholder="123456" /></Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="button" className="w-full" disabled={busy || code.length < 6} onClick={(e) => void verify(e as unknown as FormEvent)}>{busy ? 'Checking…' : 'Verify'}</Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setChallenge(null); setCode(''); setError('') }}>Back</Button>
          </>
        ) : choices ? (
          <>
            <div><h1 className="text-xl font-semibold">Choose a hospital</h1><p className="mt-1 text-sm text-muted">Your account belongs to more than one hospital.</p></div>
            <div className="space-y-2">
              {choices.map((c) => (
                <button type="button" key={c.tenantId} disabled={busy} onClick={() => void go(c.tenantId)} className="w-full rounded-2xl border-2 border-line p-4 text-left transition hover:border-brand-300">
                  <p className="font-semibold">{c.name}</p><p className="text-xs capitalize text-muted">{c.roles.map((r) => r.toLowerCase().replace('_', ' ')).join(', ')}</p>
                </button>
              ))}
            </div>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setChoices(null)}>Back</Button>
          </>
        ) : (
          <>
            <div><h1 className="text-xl font-semibold">Sign in to your hospital</h1><p className="mt-1 text-sm text-muted">Use the email address registered by your hospital.</p></div>
            <Field label="Email address"><input className={inputCls} type="email" placeholder="staff@hospital.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
            <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            <p className="text-center text-sm text-muted">New hospital or clinic? <Link to="/signup" className="font-semibold text-brand-700 hover:underline">Start a free 30-day trial</Link></p>
          </>
        )}
      </form>
    </div>
  )
}
