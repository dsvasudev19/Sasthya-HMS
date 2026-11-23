import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ExternalLink, FileDown } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { Button, Field, inputCls } from '../components/ui'
import { api, openFile } from '../lib/api'
import Branches from './settings/Branches'
import Doctors from './settings/Doctors'
import Policies from './settings/Policies'
import Roles from './settings/Roles'
import Abdm from './settings/Abdm'
import TeamDirectory from '../components/TeamDirectory'
import { fmtDate, rupees } from '../lib/format'
import ChangePassword from './ChangePassword'

function Team() {
  return <TeamDirectory />
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
