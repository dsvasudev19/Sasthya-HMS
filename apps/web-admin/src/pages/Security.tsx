import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { Button, Field, inputCls } from '../components/ui'
import { api } from '../lib/api'

interface Status { mfaEnabled: boolean; mfaRequired: boolean; recoveryCodesLeft: number }
interface Policy { require2fa: boolean; people: { identityId: string; name: string | null; phone: string; enrolled: boolean }[] }

function MyTwoStep() {
  const qc = useQueryClient()
  const { data: st } = useQuery({ queryKey: ['mfa-status'], queryFn: () => api<Status>('/auth/mfa/status') })
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [pw, setPw] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['mfa-status'] }); window.dispatchEvent(new Event('hms:refresh-me')) }
  const start = useMutation({ mutationFn: () => api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST', body: '{}' }), onSuccess: setSetup })
  const enable = useMutation({ mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) }), onSuccess: (r) => { setCodes(r.recoveryCodes); setSetup(null); setCode(''); refresh() } })
  const disable = useMutation({ mutationFn: () => api('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password: pw, code }) }), onSuccess: () => { setPw(''); setCode(''); refresh() } })
  if (!st) return null
  return (
    <section className="max-w-xl space-y-4 rounded-2xl p-5 ring-1 ring-line">
      <div className="flex items-center gap-2"><ShieldCheck className={st.mfaEnabled ? 'text-brand-700' : 'text-muted'} /><h2 className="text-lg font-semibold">Two-step sign-in</h2><span className={`ml-auto rounded-full px-3 py-1 text-xs font-bold ${st.mfaEnabled ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'}`}>{st.mfaEnabled ? 'ON' : 'OFF'}</span></div>
      <p className="text-sm text-muted">After your password, you type a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy). A stolen password alone is then useless.</p>
      {codes && (
        <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"><p className="text-sm font-semibold">Save these recovery codes now. They are shown once.</p><p className="mb-2 text-xs text-muted">Each works one time if you lose your phone.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c} className="select-all">{c}</li>)}</ul>
          <Button variant="ghost" className="mt-3" onClick={() => { void navigator.clipboard?.writeText(codes.join('\n')) }}>Copy</Button></div>
      )}
      {!st.mfaEnabled && !setup && <Button onClick={() => start.mutate()} disabled={start.isPending}>Set up</Button>}
      {setup && (
        <div className="space-y-3">
          <p className="text-sm">1. Scan this with your authenticator app.</p>
          <div className="inline-block rounded-xl bg-white p-3 ring-1 ring-line"><QRCodeSVG value={setup.otpauthUrl} size={168} /></div>
          <p className="text-xs text-muted">Cannot scan? Enter this key instead: <span className="select-all font-mono">{setup.secret}</span></p>
          <Field label="2. Type the 6-digit code it shows"><input className={`${inputCls} !w-40 text-center text-lg tracking-widest`} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
          {enable.error && <p className="text-sm text-red-600">{(enable.error as Error).message}</p>}
          <Button disabled={code.length !== 6 || enable.isPending} onClick={() => enable.mutate()}>Turn on</Button>
        </div>
      )}
      {st.mfaEnabled && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-sm text-muted">{st.recoveryCodesLeft} recovery code{st.recoveryCodesLeft === 1 ? '' : 's'} left.</p>
          {st.mfaRequired ? <p className="text-sm text-muted">Your organization requires two-step sign-in, so it cannot be turned off.</p> : (
            <div className="grid gap-3 sm:grid-cols-2"><Field label="Password to turn it off"><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} /></Field><Field label="Current code"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value.trim())} maxLength={13} /></Field>
              {disable.error && <p className="text-sm text-red-600 sm:col-span-2">{(disable.error as Error).message}</p>}
              <Button variant="ghost" className="sm:col-span-2" disabled={!pw || code.length < 6 || disable.isPending} onClick={() => confirm('Turn off two-step sign-in?') && disable.mutate()}>Turn off</Button></div>)}
        </div>
      )}
    </section>
  )
}

function OrgPolicy() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['sec-policy'], queryFn: () => api<Policy>('/security/policy') })
  const set = useMutation({ mutationFn: (require2fa: boolean) => api('/security/policy', { method: 'PUT', body: JSON.stringify({ require2fa }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sec-policy'] }) })
  const reset = useMutation({ mutationFn: (id: string) => api(`/security/mfa/${id}/reset`, { method: 'POST', body: '{}' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sec-policy'] }) })
  if (!data) return null
  const missing = data.people.filter((p) => !p.enrolled).length
  return (
    <section className="max-w-xl space-y-4 rounded-2xl p-5 ring-1 ring-line">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Require two-step sign-in for everyone</h2><p className="text-sm text-muted">Staff who have not set it up are stopped at a setup screen until they do. {missing > 0 && `${missing} of ${data.people.length} have not.`}</p></div>
        <Button variant={data.require2fa ? 'primary' : 'ghost'} onClick={() => confirm(data.require2fa ? 'Stop requiring it?' : `Require it for all ${data.people.length} staff?`) && set.mutate(!data.require2fa)}>{data.require2fa ? 'Required' : 'Optional'}</Button></div>
      <ul className="divide-y divide-line text-sm">{data.people.map((p) => (
        <li key={p.identityId} className="flex items-center justify-between py-2.5"><span><span className="font-semibold">{p.name}</span> <span className="text-xs text-muted">{p.phone}</span></span>
          <span className="flex items-center gap-3"><span className={p.enrolled ? 'text-brand-700' : 'text-amber-600'}>{p.enrolled ? 'On' : 'Not set up'}</span>{p.enrolled && <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => confirm(`Reset two-step sign-in for ${p.name}? They will need to set it up again.`) && reset.mutate(p.identityId)}>Reset</button>}</span></li>))}</ul>
    </section>
  )
}

export default function Security() {
  const { can } = useAuth()
  const [q] = useSearchParams()
  return (
    <div className="space-y-5 pb-6">
      <div><h1 className="text-2xl font-bold tracking-tight">Sign-in security</h1><p className="text-sm text-muted">Protect your account and your organization.</p></div>
      {q.get('required') && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">Your organization requires two-step sign-in. Set it up below to continue.</p>}
      <MyTwoStep />
      {can('security:manage') && <OrgPolicy />}
    </div>
  )
}
