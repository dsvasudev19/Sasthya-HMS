import { HeartPulse } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Button, Field, inputCls } from '@hms/ui-web'
import { useAuth } from '../auth'

export default function Login() {
  const [params] = useSearchParams()
  const wasInactive = params.get('reason') === 'inactivity'
  const { me, login } = useAuth()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (me) return <Navigate to="/" replace />
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); setError(''); try { await login(phone, password) } catch (err) { setError((err as Error).message) } finally { setBusy(false) } }
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-[#0b1a33] via-[#10294f] to-[#0d4a4b] p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-2 text-2xl"><HeartPulse className="text-brand-800" size={28} strokeWidth={2.5} /><span className="font-bold tracking-tight text-ink">Swasthya</span></div>
        {wasInactive && (
          <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
            <strong>Session expired due to inactivity.</strong> Signed out automatically to safeguard administrative access.
          </div>
        )}
        <div><h1 className="text-xl font-semibold">Platform sign in</h1><p className="mt-1 text-sm text-muted">For Swasthya operators only.</p></div>
        <Field label="Mobile number"><input className={inputCls} inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} autoFocus required /></Field>
        <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </div>
  )
}
