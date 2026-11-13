import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, KeyRound, LogOut } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, Field, inputCls, Select } from '@hms/ui-web'
import { api } from '../lib/api'
import OrgAnalytics from '../components/OrgAnalytics'
import { fmtDate, rupees } from '../lib/format'

interface Detail { id: string; name: string; kind: string; status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'; planCode: string; trialEndsAt: string | null; createdAt: string; staff: number; patients: number; suspendedReason: string | null; usage: { patientsAdded: number; messagesSent: number }; platformInvoices: { id: string; invoiceNo: string; totalPaise: number; status: string; dueDate: string }[] }
interface Feat { key: string; label: string; description: string; group: string; plan: boolean; override: boolean | null; effective: boolean; reason: string | null; setBy: string | null; setAt: string | null }
interface Feats { features: Feat[]; limits: { maxSeats: number | null; maxBranches: number | null; notes: string | null; planSeats: number | null } }
interface User { identityId: string; name: string | null; phone: string; roles: string[]; activeSessions: number; lastSignIn: string | null; mustChangePassword: boolean }
interface Act { id: string; action: string; entityType: string | null; createdAt: string; actorName: string | null; ip?: string | null }

const TONE = { TRIAL: 'bg-sky-100 text-sky-700', ACTIVE: 'bg-brand-100 text-brand-700', SUSPENDED: 'bg-red-100 text-red-600', CLOSED: 'bg-stone-200 text-stone-600' } as const
const PLAN = { PAY_PER_PATIENT: 'Pay per patient', STARTER: 'Starter', UNLIMITED: 'Unlimited' } as Record<string, string>
const TABS = ['Overview', 'Analytics', 'Organization', 'Agreements', 'Features', 'Limits', 'Users', 'Activity', 'Billing'] as const

function FeaturesTab({ id }: { id: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['tenant-features', id], queryFn: () => api<Feats>(`/platform/tenants/${id}/features`) })
  const [draft, setDraft] = useState<Record<string, boolean | null>>({})
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: () => api(`/platform/tenants/${id}/features`, { method: 'PUT', body: JSON.stringify({ changes: Object.entries(draft).map(([feature, enabled]) => ({ feature, enabled })), reason }) }),
    onSuccess: () => { setDraft({}); setReason(''); qc.invalidateQueries({ queryKey: ['tenant-features', id] }) },
  })
  if (!data) return null
  const groups = [...new Set(data.features.map((f) => f.group))]
  const current = (f: Feat) => (f.key in draft ? draft[f.key]! : f.override)
  const n = Object.keys(draft).length
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">Each switch decides what this hospital's staff can see and use. “Plan default” follows their plan; On or Off overrides it for this account only. Hidden features also stop working at the server, not just in the menu.</p>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{g}</h3>
          <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
            {data.features.filter((f) => f.group === g).map((f) => { const cur = current(f); const eff = cur ?? f.plan; return (
              <li key={f.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{f.label} <span className={clsx('ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold', eff ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600')}>{eff ? 'ON' : 'OFF'}</span></p>
                  <p className="text-xs text-muted">{f.description}</p>
                  {f.override !== null && !(f.key in draft) && f.reason && <p className="mt-0.5 text-[11px] text-amber-700">Override: {f.reason}{f.setAt ? ` · ${fmtDate(f.setAt)}` : ''}</p>}</div>
                <div role="group" aria-label={f.label} className="flex overflow-hidden rounded-lg text-xs font-semibold ring-1 ring-line">
                  {([['Plan default', null], ['On', true], ['Off', false]] as const).map(([l, v]) => (
                    <button key={l} type="button" aria-pressed={cur === v} onClick={() => setDraft((d) => { const x = { ...d }; if (v === f.override) delete x[f.key]; else x[f.key] = v; return x })} className={clsx('px-3 py-1.5', cur === v ? 'bg-brand-700 text-white' : 'bg-white hover:bg-surface')}>{l}{v === null ? ` (${f.plan ? 'on' : 'off'})` : ''}</button>
                  ))}
                </div>
              </li>
            ) })}
          </ul>
        </section>
      ))}
      {n > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-line">
          <span className="text-sm font-semibold">{n} change{n > 1 ? 's' : ''}</span>
          <input className={`${inputCls} min-w-60 flex-1`} placeholder="Reason (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="ghost" onClick={() => setDraft({})}>Discard</Button>
          <Button disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Save changes</Button>
          {save.error && <p className="w-full text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
      )}
    </div>
  )
}

function LimitsTab({ id }: { id: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['tenant-features', id], queryFn: () => api<Feats>(`/platform/tenants/${id}/features`) })
  const [v, setV] = useState<{ maxSeats: string; maxBranches: string; notes: string } | null>(null)
  const form = v ?? { maxSeats: String(data?.limits.maxSeats ?? ''), maxBranches: String(data?.limits.maxBranches ?? ''), notes: data?.limits.notes ?? '' }
  const save = useMutation({
    mutationFn: () => api(`/platform/tenants/${id}/limits`, { method: 'PUT', body: JSON.stringify({ maxSeats: form.maxSeats ? Number(form.maxSeats) : null, maxBranches: form.maxBranches ? Number(form.maxBranches) : null, notes: form.notes || null }) }),
    onSuccess: () => { setV(null); qc.invalidateQueries({ queryKey: ['tenant-features', id] }) },
  })
  if (!data) return null
  return (
    <div className="max-w-md space-y-4 text-sm">
      <Field label={`Staff accounts allowed (plan default: ${data.limits.planSeats ?? 'unlimited'})`}><input className={inputCls} inputMode="numeric" value={form.maxSeats} onChange={(e) => setV({ ...form, maxSeats: e.target.value.replace(/\D/g, '') })} placeholder="Plan default" /></Field>
      <Field label="Branches allowed"><input className={inputCls} inputMode="numeric" value={form.maxBranches} onChange={(e) => setV({ ...form, maxBranches: e.target.value.replace(/\D/g, '') })} placeholder="No limit" /></Field>
      <Field label="Internal notes"><textarea className={inputCls} rows={3} value={form.notes} onChange={(e) => setV({ ...form, notes: e.target.value })} /></Field>
      {save.error && <p className="text-red-600">{(save.error as Error).message}</p>}
      <Button disabled={!v || save.isPending} onClick={() => save.mutate()}>Save limits</Button>
    </div>
  )
}

function UsersTab({ id }: { id: string }) {
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['tenant-users', id], queryFn: () => api<User[]>(`/platform/tenants/${id}/users`) })
  const [temp, setTemp] = useState<{ name: string; pw: string } | null>(null)
  const reset = useMutation({ mutationFn: (u: User) => api<{ temporaryPassword: string }>(`/platform/tenants/${id}/users/${u.identityId}/reset-password`, { method: 'POST' }).then((r) => setTemp({ name: u.name ?? u.phone, pw: r.temporaryPassword })), onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-users', id] }) })
  const mfa = useMutation({ mutationFn: (u: User) => api(`/platform/tenants/${id}/users/${u.identityId}/reset-mfa`, { method: 'POST', body: '{}' }), onSuccess: () => alert('Two-step sign-in was reset. They will set it up again.') })
  const out = useMutation({ mutationFn: (u: User) => api(`/platform/tenants/${id}/users/${u.identityId}/sign-out`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-users', id] }) })
  return (
    <div className="space-y-4">
      {temp && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-200">New password for <b>{temp.name}</b> (shown once): <span className="select-all font-mono text-base font-bold">{temp.pw}</span></p>}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Person', 'Roles', 'Sessions', 'Last sign-in', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{data.map((u) => (
            <tr key={u.identityId}>
              <td className="px-4 py-3 font-semibold">{u.name ?? '-'}<div className="text-xs font-normal text-muted">{u.phone}{u.mustChangePassword ? ' · must change password' : ''}</div></td>
              <td className="px-4 py-3 text-muted">{u.roles.join(', ')}</td><td className="px-4 py-3">{u.activeSessions}</td><td className="px-4 py-3 text-muted">{u.lastSignIn ? fmtDate(u.lastSignIn) : '-'}</td>
              <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                <Button variant="ghost" onClick={() => confirm(`Reset the password for ${u.name ?? u.phone}? They will be signed out.`) && reset.mutate(u)}><KeyRound size={14} /> Reset</Button>
                <Button variant="ghost" onClick={() => confirm(`Reset two-step sign-in for ${u.name ?? u.phone}?`) && mfa.mutate(u)}>Reset 2FA</Button>
                <Button variant="ghost" onClick={() => out.mutate(u)}><LogOut size={14} /> Sign out</Button></div></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}

function ActivityTab({ id }: { id: string }) {
  const [action, setAction] = useState('')
  const { data } = useQuery({ queryKey: ['tenant-activity', id, action], queryFn: () => api<{ rows: Act[] }>(`/platform/tenants/${id}/activity?${new URLSearchParams({ limit: '100', ...(action ? { action } : {}) })}`) })
  return (
    <div className="space-y-3">
      <input className={`${inputCls} max-w-xs`} placeholder="Filter by action, e.g. patient." value={action} onChange={(e) => setAction(e.target.value)} />
      <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
        {data?.rows.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm"><span><span className="font-mono text-xs font-semibold">{r.action}</span> <span className="text-muted">by {r.actorName ?? 'system'}</span></span><span className="text-xs text-muted">{new Date(r.createdAt).toLocaleString('en-IN')}</span></li>)}
        {data?.rows.length === 0 && <li className="py-8 text-center text-sm text-muted">Nothing recorded yet.</li>}
      </ul>
    </div>
  )
}

interface Prof { profile: Record<string, string | number | null> | null; admins: { identityId: string; name: string | null; phone: string }[]; agreements: { id: string; kind: string; version: string; signedByName: string; signedByTitle: string; signedByEmail: string; signedAt: string; effectiveFrom: string; termMonths: number; autoRenew: boolean; documentRef: string | null }[] }
const ROWS: [string, string][] = [['legalName', 'Legal name'], ['entityType', 'Entity type'], ['registrationNo', 'Registration no.'], ['drugLicenceNo', 'Drug licence'], ['gstin', 'GSTIN'], ['pan', 'PAN'], ['bedCount', 'Beds'], ['addressLine1', 'Address'], ['addressLine2', ''], ['city', 'City'], ['state', 'State'], ['pincode', 'Pincode'], ['contactEmail', 'Email'], ['contactPhone', 'Phone'], ['website', 'Website'], ['billingContact', 'Billing contact'], ['billingEmail', 'Billing email']]

function OrgTab({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['tenant-profile', id], queryFn: () => api<Prof>(`/platform/tenants/${id}/profile`) })
  if (!data) return null
  return (
    <div className="max-w-2xl space-y-6 text-sm">
      <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Organization admin</h3>
        <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">{data.admins.map((a) => <li key={a.identityId} className="flex justify-between px-4 py-3"><span className="font-semibold">{a.name}</span><span className="text-muted">{a.phone}</span></li>)}</ul>
        <p className="mt-2 text-xs text-muted">Controls this organization's roles, permissions, access policies and staff. Use the Users tab to reset a password.</p></section>
      <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Registered details</h3>
        {data.profile ? <dl className="divide-y divide-line rounded-2xl ring-1 ring-line">{ROWS.filter(([k]) => data.profile![k] != null && data.profile![k] !== '').map(([k, l]) => <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted">{l}</dt><dd className="text-right font-medium">{String(data.profile![k])}</dd></div>)}</dl> : <p className="text-muted">No registered details on file. This account was created before organization records were required.</p>}</section>
    </div>
  )
}

function AgreementsTab({ id }: { id: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['tenant-profile', id], queryFn: () => api<Prof>(`/platform/tenants/${id}/profile`) })
  const [open, setOpen] = useState(false)
  const day = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ kind: 'MSA', version: '', signedByName: '', signedByTitle: '', signedByEmail: '', signedAt: day, effectiveFrom: day, termMonths: '12', documentRef: '' })
  const add = useMutation({
    mutationFn: () => api(`/platform/tenants/${id}/agreements`, { method: 'POST', body: JSON.stringify({ ...f, signedAt: new Date(f.signedAt).toISOString(), termMonths: Number(f.termMonths), autoRenew: true }) }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ['tenant-profile', id] }) },
  })
  if (!data) return null
  const end = (a: Prof['agreements'][number]) => { const d = new Date(a.effectiveFrom); d.setMonth(d.getMonth() + a.termMonths); return d }
  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <div className="flex items-center justify-between"><p className="text-muted">Signed agreements are a permanent record. A renewal or amendment is added as a new entry.</p><Button variant="ghost" onClick={() => setOpen(!open)}>Record agreement</Button></div>
      {open && (
        <div className="grid gap-3 rounded-2xl p-5 ring-1 ring-line sm:grid-cols-2">
          <Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'MSA', label: 'Master Services Agreement' }, { value: 'DPA', label: 'Data Processing Agreement' }, { value: 'ORDER_FORM', label: 'Order Form' }, { value: 'BAA', label: 'Business Associate Agreement' }, { value: 'OTHER', label: 'Other' }]} /></Field>
          <Field label="Version"><input className={inputCls} value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
          <Field label="Signed by"><input className={inputCls} value={f.signedByName} onChange={(e) => setF({ ...f, signedByName: e.target.value })} /></Field>
          <Field label="Designation"><input className={inputCls} value={f.signedByTitle} onChange={(e) => setF({ ...f, signedByTitle: e.target.value })} /></Field>
          <Field label="Signatory email"><input className={inputCls} value={f.signedByEmail} onChange={(e) => setF({ ...f, signedByEmail: e.target.value })} /></Field>
          <Field label="Document reference"><input className={inputCls} value={f.documentRef} onChange={(e) => setF({ ...f, documentRef: e.target.value })} /></Field>
          <Field label="Date signed"><input type="date" className={inputCls} value={f.signedAt} onChange={(e) => setF({ ...f, signedAt: e.target.value })} /></Field>
          <Field label="Effective from"><input type="date" className={inputCls} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
          <Field label="Term (months)"><input className={inputCls} inputMode="numeric" value={f.termMonths} onChange={(e) => setF({ ...f, termMonths: e.target.value.replace(/\D/g, '') })} /></Field>
          {add.error && <p className="text-red-600 sm:col-span-2">{(add.error as Error).message}</p>}
          <div className="sm:col-span-2"><Button disabled={add.isPending || !f.version || !f.signedByName || !f.signedByTitle || !f.signedByEmail} onClick={() => confirm('This record cannot be edited or deleted. Save it?') && add.mutate()}>Save agreement</Button></div>
        </div>
      )}
      <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
        {data.agreements.map((a) => <li key={a.id} className="px-4 py-3"><p className="font-semibold">{a.kind} · v{a.version}</p><p className="text-xs text-muted">Signed {fmtDate(a.signedAt)} by {a.signedByName}, {a.signedByTitle} · {a.termMonths} months, to {fmtDate(end(a).toISOString())}{a.autoRenew ? ' (auto-renews)' : ''}{a.documentRef ? ` · ref ${a.documentRef}` : ''}</p></li>)}
        {data.agreements.length === 0 && <li className="py-8 text-center text-muted">No agreements on file.</li>}
      </ul>
    </div>
  )
}

export default function HospitalDetail() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [qs] = useSearchParams()
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS.find((t) => t === qs.get('tab')) ?? 'Overview')
  const [reason, setReason] = useState('')
  const { data } = useQuery({ queryKey: ['hospital', id], queryFn: () => api<Detail>(`/platform/tenants/${id}`) })
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/platform/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { for (const k of ['hospital', 'hospitals', 'overview']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  return (
    <div>
      <Link to="/hospitals" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Hospitals</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE[data.status]}`}>{data.status}</span>
        <span className="text-sm capitalize text-muted">{data.kind.toLowerCase()} · {PLAN[data.planCode]}</span>
      </div>
      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold', tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-muted hover:text-ink')}>{t}</button>)}
      </div>
      {tab === 'Overview' && (
        <div className="max-w-xl space-y-4 text-sm">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['Patients', data.patients], ['Staff', data.staff], ['New this month', data.usage.patientsAdded], ['Messages', data.usage.messagesSent]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-surface p-3"><p className="text-lg font-bold">{v}</p><p className="text-[11px] text-muted">{l}</p></div>)}
          </div>
          <Field label="Plan"><Select value={data.planCode as 'STARTER'} onChange={(v) => patch.mutate({ planCode: v })} options={Object.entries(PLAN).map(([value, label]) => ({ value: value as 'STARTER', label }))} /></Field>
          {data.trialEndsAt && <p className="text-muted">Trial {new Date(data.trialEndsAt) > new Date() ? 'ends' : 'ended'} {fmtDate(data.trialEndsAt)}</p>}
          {data.suspendedReason && <p className="text-red-600">Suspended: {data.suspendedReason}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => patch.mutate({ extendTrialDays: 14 })}>Extend trial 14 days</Button>
            {data.status === 'SUSPENDED' ? <Button onClick={() => patch.mutate({ status: 'ACTIVE' })}>Reactivate</Button> : <Button variant="ghost" disabled={!reason.trim()} onClick={() => patch.mutate({ status: 'SUSPENDED', suspendedReason: reason })}>Suspend</Button>}
            {data.status !== 'CLOSED' && <Button variant="ghost" onClick={() => confirm('Close this account?') && patch.mutate({ status: 'CLOSED' })}>Close account</Button>}
          </div>
          {data.status !== 'SUSPENDED' && <input className={inputCls} placeholder="Reason for suspending (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          {patch.error && <p className="text-red-600">{(patch.error as Error).message}</p>}
        </div>
      )}
      {tab === 'Analytics' && <OrgAnalytics id={id} />}
      {tab === 'Organization' && <OrgTab id={id} />}
      {tab === 'Agreements' && <AgreementsTab id={id} />}
      {tab === 'Features' && <FeaturesTab id={id} />}
      {tab === 'Limits' && <LimitsTab id={id} />}
      {tab === 'Users' && <UsersTab id={id} />}
      {tab === 'Activity' && <ActivityTab id={id} />}
      {tab === 'Billing' && (data.platformInvoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : <ul className="max-w-xl divide-y divide-line rounded-2xl ring-1 ring-line">{data.platformInvoices.map((i) => <li key={i.id} className="flex justify-between px-4 py-3 text-sm"><span>{i.invoiceNo}</span><span>{rupees(i.totalPaise)} · {i.status}</span></li>)}</ul>)}
    </div>
  )
}
