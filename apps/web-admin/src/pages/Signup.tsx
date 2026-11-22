import { HeartPulse } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth, type Me } from '../auth'
import Select from '../components/Select'
import { Button, Field, inputCls } from '../components/ui'
import { api } from '../lib/api'

const PLANS = [
  { value: 'PAY_PER_PATIENT', label: 'Pay per patient', hint: '₹200 for each new patient, once. Up to 3 staff.' },
  { value: 'STARTER', label: 'Starter', hint: '₹10,000 a month. Pharmacy, lab, messages. 10 staff.' },
  { value: 'UNLIMITED', label: 'Unlimited', hint: '₹20,000 a month. Everything, unlimited staff.' },
] as const

export default function Signup() {
  const { me, apply } = useAuth()
  const [f, setF] = useState({ hospitalName: '', kind: 'HOSPITAL' as 'HOSPITAL' | 'CLINIC' | 'PHARMACY', ownerName: '', email: '', phone: '', planCode: 'STARTER' as (typeof PLANS)[number]['value'], code: '', password: '' })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (me) return <Navigate to="/" replace />

  const sendCode = async () => {
    setBusy(true); setError('')
    try {
      const r = await api<{ devCode?: string }>('/patient/otp/request', { method: 'POST', body: JSON.stringify({ phone: f.phone }) })
      setSent(true)
      if (r.devCode) setF((x) => ({ ...x, code: r.devCode! })) // development only
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!sent) return sendCode()
    setBusy(true); setError('')
    try { apply(await api<Me & { token: string }>('/signup', { method: 'POST', body: JSON.stringify(f) })) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const ready = f.hospitalName.length >= 3 && f.ownerName.length >= 2 && f.email.includes('@') && f.phone.length === 10

  return (
    <div className="min-h-screen overflow-auto bg-gradient-to-br from-[#0b1a33] via-[#10294f] to-[#0d4a4b] p-4">
      <form onSubmit={submit} className="mx-auto my-6 w-full max-w-md space-y-4 rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-2 text-2xl"><HeartPulse className="text-brand-800" size={28} strokeWidth={2.5} /><span className="font-bold tracking-tight text-ink">Swasthya</span></div>
        <div><h1 className="text-xl font-semibold">Start your free 30-day trial</h1><p className="mt-1 text-sm text-muted">Every feature unlocked. No card needed.</p></div>
        <Field label="Hospital or clinic name"><input className={inputCls} value={f.hospitalName} onChange={(e) => setF({ ...f, hospitalName: e.target.value })} disabled={sent} autoFocus /></Field>
        <Field label="We are a"><Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} disabled={sent} options={[{ value: 'HOSPITAL', label: 'Hospital (several staff)' }, { value: 'CLINIC', label: 'Clinic (a doctor on their own)' }, { value: 'PHARMACY', label: 'Medical store / pharmacy only' }]} /></Field>
        <Field label="Your name"><input className={inputCls} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} disabled={sent} /></Field>
        <Field label="Your official email (used to sign in)"><input className={inputCls} type="email" placeholder="admin@hospital.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} disabled={sent} required /></Field>
        <Field label="Your mobile number"><input className={inputCls} inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} disabled={sent} /></Field>
        <Field label="Plan after the trial"><Select value={f.planCode} onChange={(v) => setF({ ...f, planCode: v })} disabled={sent} options={PLANS.map((p) => ({ value: p.value, label: p.label, hint: p.hint }))} /></Field>
        {sent && (
          <>
            <Field label="Code sent to your phone"><input className={inputCls} inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Choose a password"><input className={inputCls} type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <p className="text-xs text-muted">At least 8 characters, with letters and numbers.</p>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={!ready || busy || (sent && (f.code.length !== 6 || f.password.length < 8))}>{busy ? 'Please wait…' : sent ? 'Create my hospital' : 'Send verification code'}</Button>
        <p className="text-center text-sm text-muted">Already registered? <Link to="/login" className="font-semibold text-brand-700 hover:underline">Sign in</Link></p>
      </form>
    </div>
  )
}
