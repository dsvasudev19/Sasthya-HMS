import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAuth, type Me } from '../auth'
import { Button, Field, inputCls } from '../components/ui'
import { api } from '../lib/api'

/** Shown instead of the app when a password was set by someone else (a new account or a reset). */
export default function ChangePassword({ forced = true, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { apply, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== again) return setError('The new passwords do not match')
    setBusy(true); setError('')
    try {
      apply(await api<Me & { token: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) }))
      onDone?.()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className={forced ? 'grid min-h-screen place-items-center bg-gradient-to-br from-[#0b1a33] via-[#10294f] to-[#0d4a4b] p-4' : ''}>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-2xl ring-1 ring-white/10">
        <KeyRound className="text-brand-800" size={28} />
        <div><h1 className="text-xl font-semibold">{forced ? 'Set your own password' : 'Change password'}</h1>{forced && <p className="mt-1 text-sm text-muted">Your password was set by someone else. Choose one only you know.</p>}</div>
        <Field label="Current password"><input className={inputCls} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus={forced} /></Field>
        <Field label="New password"><input className={inputCls} type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field>
        <Field label="New password again"><input className={inputCls} type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} /></Field>
        <p className="text-xs text-muted">At least 8 characters, with letters and numbers.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
        {forced && <Button type="button" variant="ghost" className="w-full" onClick={() => void logout()}>Sign out</Button>}
      </form>
    </div>
  )
}
