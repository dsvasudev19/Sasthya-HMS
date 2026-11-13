import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { LogIn, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { Kpi } from '../components/charts'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface Roster { from: string; days: number; people: { id: string; name: string | null; roles: string[] }[]; shifts: { id: string; identityId: string; date: string; startTime: string; endTime: string; kind: string }[]; leave: { identityId: string; from: string; to: string; kind: string }[] }
interface Att { date: string; summary: Record<string, number>; rows: { identityId: string; name: string | null; shift: string | null; checkInAt: string | null; checkOutAt: string | null; state: string; lateMinutes: number }[] }
interface Leave { id: string; name: string | null; identityId: string; fromDate: string; toDate: string; kind: string; reason: string | null; status: string }
interface Stmt { period: string; doctors: { doctorId: string; doctor: string | null; grossPaise: number; sharePaise: number; lines: { source: string; bills: number; netPaise: number; percent: number; sharePaise: number }[]; payout: { id: string; status: string; reference: string | null } | null }[] }
interface Share { id: string; doctorId: string; doctor: string | null; source: string; percent: number; effectiveFrom: string }
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const ST: Record<string, string> = { PRESENT: 'bg-brand-100 text-brand-700', LATE: 'bg-amber-100 text-amber-700', ABSENT: 'bg-red-100 text-red-600', EXPECTED: 'bg-slate-100 text-slate-600', LEAVE: 'bg-sky-100 text-sky-700', UNROSTERED: 'bg-violet-100 text-violet-700' }
const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '-')

function Punch() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['att-me'], queryFn: () => api<{ checkedIn: boolean; checkInAt: string | null; checkOutAt: string | null }>('/attendance/me') })
  const punch = useMutation({ mutationFn: () => api('/attendance/punch', { method: 'POST', body: '{}' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['att-me'] }); qc.invalidateQueries({ queryKey: ['att'] }) } })
  if (!data) return null
  const done = !!data.checkOutAt
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line"><div className="mr-auto text-sm"><p className="font-semibold">{done ? 'You have signed out for today' : data.checkedIn ? `On duty since ${t(data.checkInAt)}` : 'You have not signed in today'}</p></div>{!done && <Button onClick={() => punch.mutate()} disabled={punch.isPending}>{data.checkedIn ? <><LogOut size={15} /> Sign out of duty</> : <><LogIn size={15} /> Start duty</>}</Button>}</div>
}

function Today() {
  const { data } = useQuery({ queryKey: ['att'], queryFn: () => api<Att>('/attendance'), refetchInterval: 60_000 })
  if (!data) return null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{(['PRESENT', 'LATE', 'ABSENT', 'EXPECTED', 'LEAVE'] as const).map((k) => <Kpi key={k} label={k.toLowerCase()} value={data.summary[k] ?? 0} tone={k === 'ABSENT' && data.summary[k] ? 'alert' : k === 'LATE' && data.summary[k] ? 'warn' : 'plain'} />)}</div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-surface text-xs font-semibold"><tr>{['Person', 'Shift', 'In', 'Out', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{data.rows.map((r) => <tr key={r.identityId}><td className="px-4 py-3 font-semibold">{r.name}</td><td className="px-4 py-3 text-muted">{r.shift ?? '-'}</td><td className="px-4 py-3">{t(r.checkInAt)}{r.lateMinutes > 15 ? <span className="ml-1 text-xs text-amber-600">({r.lateMinutes} min late)</span> : ''}</td><td className="px-4 py-3">{t(r.checkOutAt)}</td><td className="px-4 py-3"><span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-bold', ST[r.state])}>{r.state.toLowerCase()}</span></td></tr>)}</tbody></table>
        {data.rows.length === 0 && <p className="py-10 text-center text-sm text-muted">Nobody is rostered today.</p>}</div>
    </div>
  )
}

function RosterTab() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [from, setFrom] = useState(iso(new Date()))
  const [adding, setAdding] = useState<{ identityId: string; date: string } | null>(null)
  const { data } = useQuery({ queryKey: ['roster', from], queryFn: () => api<Roster>(`/roster?from=${from}&days=7`) })
  const del = useMutation({ mutationFn: (id: string) => api(`/roster/shifts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['roster'] }) })
  const [f, setF] = useState({ startTime: '09:00', endTime: '17:00', kind: 'DAY' })
  const add = useMutation({ mutationFn: () => api('/roster/shifts', { method: 'POST', body: JSON.stringify({ ...adding, ...f }) }), onSuccess: () => { setAdding(null); qc.invalidateQueries({ queryKey: ['roster'] }) } })
  if (!data) return null
  const days = Array.from({ length: 7 }, (_, i) => iso(new Date(new Date(`${from}T00:00:00`).getTime() + i * 86_400_000)))
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><input type="date" className={`${inputCls} !w-44`} value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-xs text-muted">Seven days from this date{can('roster:manage') ? '. Tap a cell to add a shift.' : '.'}</span></div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-surface font-semibold"><tr><th className="px-3 py-3">Person</th>{days.map((d) => <th key={d} className="px-3 py-3">{new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{data.people.map((p) => <tr key={p.id}><td className="px-3 py-2.5 text-sm font-semibold">{p.name}<div className="text-[10px] font-normal capitalize text-muted">{p.roles.join(', ').toLowerCase()}</div></td>
          {days.map((d) => { const sh = data.shifts.filter((s) => s.identityId === p.id && s.date === d); const lv = data.leave.some((l) => l.identityId === p.id && l.from <= d && l.to >= d); return (
            <td key={d} className={clsx('px-2 py-2 align-top', lv && 'bg-sky-50')}>{lv && <span className="text-[10px] font-semibold text-sky-700">LEAVE</span>}{sh.map((s) => <div key={s.id} className="mb-1 flex items-center justify-between gap-1 rounded-lg bg-brand-50 px-2 py-1 text-brand-800"><span>{s.startTime}-{s.endTime}</span>{can('roster:manage') && <button aria-label="Remove shift" onClick={() => del.mutate(s.id)} className="text-brand-700/60 hover:text-red-600">×</button>}</div>)}
              {can('roster:manage') && !lv && <button className="w-full rounded-lg py-1 text-[11px] text-muted hover:bg-surface" onClick={() => setAdding({ identityId: p.id, date: d })}>+</button>}</td>) })}</tr>)}</tbody></table></div>
      {adding && <Modal title="Add a shift" onClose={() => setAdding(null)}><div className="space-y-4"><div className="grid grid-cols-2 gap-3"><Field label="From"><input type="time" className={inputCls} value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field><Field label="To"><input type="time" className={inputCls} value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field></div>
        <Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'DAY', label: 'Day' }, { value: 'EVENING', label: 'Evening' }, { value: 'NIGHT', label: 'Night' }, { value: 'ON_CALL', label: 'On call' }]} /></Field>
        {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}<Button className="w-full" onClick={() => add.mutate()}>Add shift</Button></div></Modal>}
    </div>
  )
}

function LeaveTab() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['leave'], queryFn: () => api<Leave[]>('/leave') })
  const [f, setF] = useState({ fromDate: iso(new Date()), toDate: iso(new Date()), kind: 'CASUAL', reason: '' })
  const ask = useMutation({ mutationFn: () => api('/leave', { method: 'POST', body: JSON.stringify(f) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }) })
  const decide = useMutation({ mutationFn: (v: { id: string; approve: boolean }) => api(`/leave/${v.id}/decide`, { method: 'POST', body: JSON.stringify({ approve: v.approve }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }), onError: (e) => alert((e as Error).message) })
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-3 rounded-2xl p-4 ring-1 ring-line"><h2 className="font-semibold">Ask for leave</h2>
        <div className="grid grid-cols-2 gap-2"><Field label="From"><input type="date" className={inputCls} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field><Field label="To"><input type="date" className={inputCls} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field></div>
        <Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'CASUAL', label: 'Casual' }, { value: 'SICK', label: 'Sick' }, { value: 'EARNED', label: 'Earned' }, { value: 'OTHER', label: 'Other' }]} /></Field>
        <Field label="Reason"><input className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {ask.error && <p className="text-sm text-red-600">{(ask.error as Error).message}</p>}<Button className="w-full" onClick={() => ask.mutate()} disabled={ask.isPending}>Send</Button></div>
      <ul className="space-y-2">{data.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ring-1 ring-line"><div className="mr-auto"><p className="font-semibold">{l.name} · {l.kind.toLowerCase()}</p><p className="text-xs text-muted">{fmtDate(l.fromDate)} to {fmtDate(l.toDate)}{l.reason ? ` · ${l.reason}` : ''}</p></div>
        {l.status === 'PENDING' && can('roster:manage') ? <><Button onClick={() => decide.mutate({ id: l.id, approve: true })}>Approve</Button><Button variant="ghost" onClick={() => decide.mutate({ id: l.id, approve: false })}>Decline</Button></> : <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase', l.status === 'APPROVED' ? 'bg-brand-100 text-brand-700' : l.status === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600')}>{l.status.toLowerCase()}</span>}</li>)}
        {data.length === 0 && <p className="py-8 text-center text-sm text-muted">No leave requests.</p>}</ul>
    </div>
  )
}

function Payouts() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [period, setPeriod] = useState(iso(new Date()).slice(0, 7))
  const { data: s } = useQuery({ queryKey: ['payouts', period], queryFn: () => api<Stmt>(`/payouts/statement?period=${period}`) })
  const { data: shares = [] } = useQuery({ queryKey: ['shares'], queryFn: () => api<Share[]>('/payouts/shares') })
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => api<{ id: string; name: string | null }[]>('/doctors'), enabled: can('payouts:manage') })
  const [f, setF] = useState({ doctorId: '', source: 'CONSULTATION', percent: '30', effectiveFrom: iso(new Date()).slice(0, 8) + '01' })
  const save = useMutation({ mutationFn: () => api('/payouts/shares', { method: 'PUT', body: JSON.stringify({ ...f, percent: Number(f.percent) }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['shares'] }); qc.invalidateQueries({ queryKey: ['payouts'] }) } })
  const approve = useMutation({ mutationFn: (doctorId: string) => api('/payouts/approve', { method: 'POST', body: JSON.stringify({ period, doctorId }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }), onError: (e) => alert((e as Error).message) })
  const pay = useMutation({ mutationFn: (id: string) => { const reference = prompt('Payment reference (UTR, cheque number)'); if (!reference) throw new Error('cancelled'); return api(`/payouts/${id}/pay`, { method: 'POST', body: JSON.stringify({ reference }) }) }, onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }) })
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><input type="month" className={`${inputCls} !w-44`} value={period} onChange={(e) => setPeriod(e.target.value)} /><p className="text-xs text-muted">Share is worked out on money actually received in the month, less refunds, at the rate in force.</p></div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-surface text-xs font-semibold"><tr>{['Doctor', 'Collected for them', 'Share', 'Status', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{s?.doctors.map((d) => <tr key={d.doctorId}><td className="px-4 py-3 font-semibold">{d.doctor}<div className="text-xs font-normal text-muted">{d.lines.map((l) => `${l.source.toLowerCase()} ${l.percent}%`).join(' · ')}</div></td><td className="px-4 py-3">{rupees(d.grossPaise)}</td><td className="px-4 py-3 font-bold">{rupees(d.sharePaise)}</td><td className="px-4 py-3 text-muted">{d.payout ? d.payout.status.toLowerCase() + (d.payout.reference ? ` · ${d.payout.reference}` : '') : 'not approved'}</td>
          <td className="px-4 py-3 text-right">{can('payouts:manage') && (!d.payout ? <Button variant="ghost" onClick={() => confirm(`Approve ${rupees(d.sharePaise)} for ${d.doctor}? This is final for the month.`) && approve.mutate(d.doctorId)}>Approve</Button> : d.payout.status === 'APPROVED' ? <Button variant="ghost" onClick={() => pay.mutate(d.payout!.id)}>Mark paid</Button> : null)}</td></tr>)}</tbody></table>
        {s?.doctors.length === 0 && <p className="py-10 text-center text-sm text-muted">No earnings in this month.</p>}</div>
      {can('payouts:manage') && (
        <section className="space-y-3 rounded-2xl p-4 ring-1 ring-line"><h2 className="font-semibold">Set a doctor's share</h2>
          <div className="grid gap-3 sm:grid-cols-4"><Field label="Doctor"><Select value={f.doctorId} onChange={(doctorId) => setF({ ...f, doctorId })} placeholder="Choose" options={doctors.map((d) => ({ value: d.id, label: d.name ?? 'Doctor' }))} /></Field>
            <Field label="On"><Select value={f.source} onChange={(source) => setF({ ...f, source })} options={[{ value: 'CONSULTATION', label: 'Consultations' }, { value: 'IPD', label: 'Inpatient stays' }]} /></Field>
            <Field label="Share %"><input className={inputCls} inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="From"><input type="date" className={inputCls} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field></div>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}<Button disabled={!f.doctorId || save.isPending} onClick={() => save.mutate()}>Save rate</Button>
          {shares.length > 0 && <ul className="divide-y divide-line text-sm">{shares.map((x) => <li key={x.id} className="flex justify-between py-2"><span>{x.doctor} · {x.source.toLowerCase()}</span><span className="text-muted">{x.percent}% from {fmtDate(x.effectiveFrom)}</span></li>)}</ul>}
        </section>)}
    </div>
  )
}

export default function Workforce() {
  const { can } = useAuth()
  const tabs = [['today', 'Today'], ['roster', 'Roster'], ['leave', 'Leave'], ...(can('payouts:read') ? [['payouts', 'Doctor payouts']] : [])] as [string, string][]
  const [tab, setTab] = useState('today')
  return (
    <div className="space-y-5 pb-6">
      <div><h1 className="text-2xl font-bold tracking-tight">Staff</h1><p className="text-sm text-muted">Duty, rosters, leave and doctor payouts.</p></div>
      <Punch />
      <div className="flex flex-wrap gap-1 border-b border-line">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}</div>
      {tab === 'today' && (can('roster:read') ? <Today /> : <p className="text-sm text-muted">Your own duty status is above.</p>)}
      {tab === 'roster' && (can('roster:read') ? <RosterTab /> : <p className="text-sm text-muted">Ask a manager for the roster.</p>)}
      {tab === 'leave' && <LeaveTab />}
      {tab === 'payouts' && <Payouts />}
    </div>
  )
}
