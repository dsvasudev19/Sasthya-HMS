import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, ExternalLink, FileDown, KeyRound, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api, openFile } from '../lib/api'
import { grants } from '../auth'
import Access from './settings/Access'
import Branches from './settings/Branches'
import Doctors from './settings/Doctors'
import Policies from './settings/Policies'
import Roles, { useRoles } from './settings/Roles'
import Abdm from './settings/Abdm'
import { fmtDate, rupees } from '../lib/format'
import ChangePassword from './ChangePassword'

interface Member { identityId: string; name: string | null; email?: string | null; phone?: string | null; roles: string[]; branchIds: string[]; mustChangePassword: boolean }

/** Roles come from the hospital's own list. Someone can hand out only roles whose permissions they hold themselves. */
function RoleChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { me } = useAuth()
  const { data: roles } = useRoles()
  return (
    <div className="flex flex-wrap gap-2">
      {roles?.filter((r) => value.includes(r.key) || r.permissions.every((p) => grants(me?.permissions ?? [], p))).map((r) => {
        const on = value.includes(r.key)
        return <button key={r.key} type="button" title={r.description ?? ''} onClick={() => onChange(on ? value.filter((x) => x !== r.key) : [...value, r.key])} className={clsx('rounded-full border px-3 py-1.5 text-xs font-semibold transition', on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300')}>{r.name}</button>
      })}
    </div>
  )
}

function Secret({ title, account, password, onClose }: { title: string; account: string; password: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>Share this with the person now. It is shown <b>only once</b>, and they must choose their own password when they first sign in.</p>
        <div className="rounded-2xl bg-surface p-4"><p className="text-xs text-muted">Sign-in account</p><p className="font-semibold">{account}</p><p className="mt-3 text-xs text-muted">Temporary password</p><p className="select-all font-mono text-lg font-bold tracking-wider">{password}</p></div>
        <Button className="w-full" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

function Team() {
  const { me, can } = useAuth()
  const qc = useQueryClient()
  const { data: roleList } = useRoles()
  const roleLabel = (r: string) => roleList?.find((x) => x.key === r)?.name ?? r
  const { data: allBranches } = useQuery({ queryKey: ['branches-manage'], queryFn: () => api<{ id: string; code: string; name: string; active: boolean }[]>('/branches/manage'), enabled: can('branches:manage') })
  const [inspecting, setInspecting] = useState<Member | null>(null)
  const [placing, setPlacing] = useState<Member | null>(null)
  const [placed, setPlaced] = useState<string[]>([])
  const saveBranches = useMutation({ mutationFn: () => api(`/team/${placing!.identityId}/branches`, { method: 'PUT', body: JSON.stringify({ branchIds: placed }) }), onSuccess: () => { done(); setPlacing(null) } })
  const { data } = useQuery({ queryKey: ['team'], queryFn: () => api<{ members: Member[]; seats: { used: number; limit: number } }>('/team') })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [secret, setSecret] = useState<{ title: string; account: string; password: string } | null>(null)
  const [f, setF] = useState({ fullName: '', email: '', phone: '', roles: [] as string[] })
  const [roles, setRoles] = useState<string[]>([])
  const done = () => qc.invalidateQueries({ queryKey: ['team'] })

  const add = useMutation({
    mutationFn: () => api<{ identityId: string; email?: string; phone?: string; temporaryPassword?: string }>('/team', { method: 'POST', body: JSON.stringify(f) }),
    onSuccess: (r) => { done(); setAdding(false); if (r.temporaryPassword) setSecret({ title: 'Account created', account: r.email || r.phone || f.email, password: r.temporaryPassword }); setF({ fullName: '', email: '', phone: '', roles: [] }) },
  })
  const save = useMutation({ mutationFn: () => api(`/team/${editing!.identityId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) }), onSuccess: () => { done(); setEditing(null) } })
  const remove = useMutation({ mutationFn: (id: string) => api(`/team/${id}`, { method: 'DELETE' }), onSuccess: done })
  const reset = useMutation({ mutationFn: (m: Member) => api<{ temporaryPassword: string }>(`/team/${m.identityId}/reset-password`, { method: 'POST', body: '{}' }).then((r) => ({ m, r })), onSuccess: ({ m, r }) => setSecret({ title: 'Password reset', account: m.email || m.phone || '', password: r.temporaryPassword }) })
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate() }
  const err = (add.error || save.error || remove.error || reset.error) as Error | null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">Staff accounts: <b className="text-ink">{data?.seats.used ?? 0}</b> of {data && data.seats.limit >= 1000 ? 'unlimited' : data?.seats.limit}</p>
        <Button className="ml-auto" onClick={() => setAdding(true)}><Plus size={18} /> Add staff</Button>
      </div>
      {err && <p className="mb-3 text-sm text-red-600">{err.message}</p>}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Name', 'Email / Phone', 'Roles', ''].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data?.members.map((m) => {
              const locked = !can('roles:manage') && m.roles.some((r) => r === 'OWNER' || r === 'ADMIN')
              return (
                <tr key={m.identityId}>
                  <td className="px-4 py-3.5 font-medium">{m.name}{m.identityId === me?.user.id && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">You</span>}{m.mustChangePassword && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Not signed in yet</span>}</td>
                  <td className="px-4 py-3.5 text-muted">{m.email || m.phone || '-'}</td>
                  <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1.5">{m.roles.map((r) => <span key={r} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold ring-1 ring-line">{roleLabel(r)}</span>)}</div></td>
                  <td className="px-2 py-3.5 text-right">
                    {!locked && m.identityId !== me?.user.id && (
                      <span className="inline-flex gap-1">
                        <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" title="Change roles" aria-label="Change roles" onClick={() => { setEditing(m); setRoles(m.roles) }}><UserCog size={16} /></button>
                        <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" title="See access" aria-label="See access" onClick={() => setInspecting(m)}><ShieldCheck size={16} /></button>
                        {allBranches && allBranches.length > 1 && <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" title="Branches" aria-label="Branches" onClick={() => { setPlacing(m); setPlaced(m.branchIds) }}><Building2 size={16} /></button>}
                        <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" title="Reset password" aria-label="Reset password" onClick={() => reset.mutate(m)}><KeyRound size={16} /></button>
                        <button className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-600" title="Remove" aria-label="Remove" onClick={() => { if (confirm(`Remove ${m.name}?`)) remove.mutate(m.identityId) }}><Trash2 size={16} /></button>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {secret && <Secret title={secret.title} account={secret.account} password={secret.password} onClose={() => setSecret(null)} />}
      {adding && (
        <Modal title="Add staff" onClose={() => setAdding(false)}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Full name"><input className={inputCls} required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
            <Field label="Email address"><input className={inputCls} type="email" required placeholder="doctor@hospital.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Mobile number (optional)"><input className={inputCls} inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Roles"><RoleChips value={f.roles} onChange={(v) => setF({ ...f, roles: v })} /></Field>
            {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
            <Button type="submit" className="w-full" disabled={f.roles.length === 0 || !f.email || add.isPending}>Create account</Button>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title={`Roles for ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="space-y-4"><RoleChips value={roles} onChange={setRoles} />
            <p className="text-xs text-muted">They are signed out and get the new roles when they sign in again.</p>
            <Button className="w-full" disabled={roles.length === 0 || save.isPending} onClick={() => save.mutate()}>Save roles</Button></div>
        </Modal>
      )}
      {placing && allBranches && (
        <Modal title={`Branches for ${placing.name}`} onClose={() => setPlacing(null)}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">{allBranches.filter((b) => b.active).map((b) => { const on = placed.includes(b.id); return <button key={b.id} type="button" onClick={() => setPlaced(on ? placed.filter((x) => x !== b.id) : [...placed, b.id])} className={clsx('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300')}>{b.name}</button> })}</div>
            <p className="text-xs text-muted">With none selected they work in the main branch. People whose role can work in every branch are not limited by this.</p>
            {saveBranches.error && <p className="text-sm text-red-600">{(saveBranches.error as Error).message}</p>}
            <Button className="w-full" disabled={saveBranches.isPending} onClick={() => saveBranches.mutate()}>Save branches</Button>
          </div>
        </Modal>
      )}
      {inspecting && <Access personId={inspecting.identityId} canEdit={can('roles:manage')} onClose={() => setInspecting(null)} />}
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
    </div>
  )
}

interface Subscription {
  plan: { code: string; label: string; monthlyPaise: number; perPatientPaise: number; seats: number; messageQuota: number }
  status: string
  trialDaysLeft: number | null
  effectivePlan: string
  seats: { used: number; limit: number }
  usage: { month: string; patientsAdded: number; messagesSent: number; estimate: { subtotalPaise: number; gstPaise: number; totalPaise: number } }
  onlinePayments: boolean
  invoices: { id: string; invoiceNo: string; periodStart: string; totalPaise: number; status: 'DUE' | 'PAID' | 'VOID'; dueDate: string }[]
  plans: { code: string; label: string; monthlyPaise: number; perPatientPaise: number; seats: number; messageQuota: number; features: string[] }[]
}

function PlanCards({ s, canChange }: { s: Subscription; canChange: boolean }) {
  const qc = useQueryClient()
  const change = useMutation({ mutationFn: (planCode: string) => api('/subscription/plan', { method: 'POST', body: JSON.stringify({ planCode }) }), onSuccess: () => { for (const k of ['subscription']) qc.invalidateQueries({ queryKey: [k] }) } })
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {s.plans.map((p) => {
          const current = p.code === s.plan.code
          return (
            <div key={p.code} className={clsx('rounded-2xl border p-5', current ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200' : 'border-line bg-white')}>
              <p className="font-semibold">{p.label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight">{p.monthlyPaise ? `${rupees(p.monthlyPaise)}` : rupees(p.perPatientPaise)}<span className="text-sm font-medium text-muted">{p.monthlyPaise ? ' / month' : ' / new patient'}</span></p>
              <ul className="mt-3 space-y-1 text-xs text-muted">
                <li>{p.seats >= 1000 ? 'Unlimited staff' : `Up to ${p.seats} staff`}</li>
                {p.features.filter((f) => f !== 'cards').map((f) => <li key={f}>{({ pharmacy: 'Pharmacy', lab: 'Laboratory', messaging: `SMS and WhatsApp (${p.messageQuota} a month free)`, multi_branch: 'Multiple branches', api: 'API access' } as Record<string, string>)[f]}</li>)}
                <li>Health cards, appointments, billing, patient app</li>
              </ul>
              {current ? <p className="mt-4 text-sm font-semibold text-brand-700">Your plan</p> : <Button className="mt-4 w-full" variant="ghost" disabled={!canChange || change.isPending} onClick={() => change.mutate(p.code)}>Switch to {p.label}</Button>}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Prices are before 18% GST.{!canChange && ' Only the owner can change the plan.'}</p>
      {change.error && <p className="mt-2 text-sm text-red-600">{(change.error as Error).message}</p>}
    </div>
  )
}

function Subscription() {
  const { can } = useAuth()
  const pay = useMutation({ mutationFn: (id: string) => api<{ url: string }>(`/subscription/invoices/${id}/pay-link`, { method: 'POST', body: '{}' }), onSuccess: (r) => { window.open(r.url, '_blank', 'noopener') } })
  const { data: s } = useQuery({ queryKey: ['subscription'], queryFn: () => api<Subscription>('/subscription') })
  if (!s) return null
  const quota = s.plan.messageQuota
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line"><p className="text-xs text-muted">Status</p><p className="mt-1 text-xl font-bold">{s.status === 'TRIAL' ? `Free trial, ${s.trialDaysLeft} days left` : s.status === 'ACTIVE' ? 'Active' : s.status.charAt(0) + s.status.slice(1).toLowerCase()}</p><p className="mt-1 text-xs text-muted">{s.plan.label} plan{s.status === 'TRIAL' ? ' after the trial' : ''}</p></div>
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line"><p className="text-xs text-muted">Staff accounts</p><p className="mt-1 text-xl font-bold">{s.seats.used} <span className="text-sm font-medium text-muted">of {s.seats.limit >= 1000 ? 'unlimited' : s.seats.limit}</span></p></div>
        <div className="rounded-2xl bg-brand-100 p-5 ring-1 ring-brand-200"><p className="text-xs text-brand-800">This month so far ({s.usage.month}), with GST</p><p className="mt-1 text-xl font-bold">{rupees(s.usage.estimate.totalPaise)}</p><p className="mt-1 text-xs text-brand-800">{s.usage.patientsAdded} new patients · {s.usage.messagesSent}{quota ? ` of ${quota}` : ''} messages</p></div>
      </div>
      <PlanCards s={s} canChange={can('subscription:manage')} />
      <div>
        <h3 className="mb-2 text-sm font-semibold">Swasthya invoices</h3>
        <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-surface text-xs font-semibold"><tr>{['Invoice', 'Month', 'Total', 'Due', 'Status', ''].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {s.invoices.map((i) => <tr key={i.id}><td className="px-4 py-3.5 font-semibold">{i.invoiceNo}</td><td className="px-4 py-3.5 text-muted">{i.periodStart.slice(0, 7)}</td><td className="px-4 py-3.5">{rupees(i.totalPaise)}</td><td className="px-4 py-3.5 text-muted">{fmtDate(i.dueDate)}</td>
                <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${i.status === 'PAID' ? 'bg-brand-100 text-brand-700' : i.status === 'DUE' ? 'bg-amber-100 text-amber-700' : 'bg-stone-200 text-stone-600'}`}>{i.status === 'DUE' ? 'Due' : i.status.charAt(0) + i.status.slice(1).toLowerCase()}</span></td>
                <td className="px-4 py-3.5 text-right"><span className="inline-flex items-center gap-1">
                  {i.status === 'DUE' && can('subscription:manage') && s.onlinePayments && <Button className="!px-4 !py-2" disabled={pay.isPending} onClick={() => pay.mutate(i.id)}><ExternalLink size={14} /> Pay online</Button>}
                  <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" title="Download PDF" aria-label="Download PDF" onClick={() => void openFile(`/subscription/invoices/${i.id}/pdf`)}><FileDown size={16} /></button>
                </span></td></tr>)}
            </tbody>
          </table>
          {s.invoices.length === 0 && <p className="py-8 text-center text-sm text-muted">No invoices yet. The first one comes after your trial.</p>}
        </div>
        <p className="mt-2 text-xs text-muted">{s.onlinePayments ? 'Pay online with UPI, card or net banking. Your account is switched back on as soon as the payment arrives.' : 'Pay by UPI or bank transfer and send the reference to Swasthya support. Your account is switched back on as soon as the payment is recorded.'}</p>
      </div>
      {pay.error && <p className="text-sm text-red-600">{(pay.error as Error).message}</p>}
      <div><h3 className="mb-2 text-sm font-semibold">Your password</h3><ChangePassword forced={false} /></div>
    </div>
  )
}

function Profile() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['profile'], queryFn: () => api<{ legalName: string; address: string; phone: string; gstin: string; upiVpa: string; drugLicence?: string }>('/settings/profile') })
  const [f, setF] = useState<typeof data | null>(null)
  const v = f ?? data
  const save = useMutation({ mutationFn: () => api('/settings/profile', { method: 'PUT', body: JSON.stringify(v) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile'] }); setF(null) } })
  if (!v) return null
  const set = (k: keyof typeof v, x: string) => setF({ ...v, [k]: x })
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted">Shown on every bill and receipt. Add your GSTIN to print tax invoices for medicines, and your UPI id to show a payment QR code on bills.</p>
      <Field label="Name on bills"><input className={inputCls} value={v.legalName} onChange={(e) => set('legalName', e.target.value)} /></Field>
      <Field label="Address"><textarea className={`${inputCls} min-h-20`} value={v.address} onChange={(e) => set('address', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><input className={inputCls} value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="GSTIN (optional)"><input className={inputCls} value={v.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} /></Field>
      </div>
      <Field label="Drug licence number (printed on pharmacy bills)"><input className={inputCls} value={v.drugLicence ?? ''} onChange={(e) => set('drugLicence', e.target.value)} maxLength={80} placeholder="KA-MY-20-1123 / 21-1124" /></Field>
      <Field label="UPI id for payment QR (optional)"><input className={inputCls} placeholder="name@bank" value={v.upiVpa} onChange={(e) => set('upiVpa', e.target.value)} /></Field>
      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <Button disabled={!f || save.isPending} onClick={() => save.mutate()}>{save.isSuccess && !f ? 'Saved' : 'Save'}</Button>
    </div>
  )
}

const TABS = [
  { k: 'team', label: 'Team', perm: 'team:manage' },
  { k: 'roles', label: 'Roles', perm: 'team:manage' },
  { k: 'policies', label: 'Policies', perm: 'policies:manage' },
  { k: 'branches', label: 'Branches', perm: 'branches:manage' },
  { k: 'doctors', label: 'Doctors', perm: 'doctors:manage' },
  { k: 'abdm', label: 'ABDM & Compliance', perm: 'settings:write' },
  { k: 'subscription', label: 'Plan and billing', perm: 'team:manage' },
  { k: 'profile', label: 'Hospital profile', perm: 'settings:write' },
] as const

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const { can, me } = useAuth()
  const tabs = TABS.filter((t) => can(t.perm) && !(me?.tenant.kind === 'PHARMACY' && t.k === 'doctors'))
  const asked = params.get('tab')
  const tab = tabs.find((t) => t.k === asked)?.k ?? tabs[0]?.k
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <div className="flex flex-wrap rounded-full bg-surface p-1 ring-1 ring-line">
          {tabs.map((t) => (
            <button key={t.k} onClick={() => setParams({ tab: t.k })} className={clsx('rounded-full px-4 py-2 text-sm font-medium', tab === t.k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'team' ? <Team /> : tab === 'roles' ? <Roles /> : tab === 'policies' ? <Policies /> : tab === 'branches' ? <Branches /> : tab === 'doctors' ? <Doctors /> : tab === 'abdm' ? <Abdm /> : tab === 'subscription' ? <Subscription /> : tab === 'profile' ? <Profile /> : <p className="text-sm text-muted">You do not have access to any settings.</p>}
    </div>
  )
}
