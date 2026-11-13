import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Bars, Kpi, LineChart, Panel, RankBars, Select } from '@hms/ui-web'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface A {
  days: number; lastActivityAt: string | null
  totals: { patients: number; newPatients: number; visitsBooked: number; visitsCompleted: number; billedPaise: number; collectedPaise: number; pharmacyBilledPaise: number; bills: number; labOrders: number; teleSessions: number; documents: number; messagesSent: number; openTasks: number; branches: number }
  staff: { accounts: number; activeLast7d: number; topActors: { id: string; name: string; actions: number; lastAt: string }[] }
  series: { visits: { day: string; n: number }[]; billedPaise: { day: string; v: number }[]; newPatients: { day: string; n: number }[]; activeStaff: { day: string; n: number }[]; signIns: { day: string; n: number }[] }
  topActions: { action: string; n: number }[]; logs: Record<string, number>; overrides: { feature: string; enabled: boolean }[]
}
const dl = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const short = (p: number) => { const r = p / 100; return r >= 10_000_000 ? `₹${(r / 10_000_000).toFixed(1)}Cr` : r >= 100_000 ? `₹${(r / 100_000).toFixed(1)}L` : r >= 1000 ? `₹${Math.round(r / 1000)}k` : `₹${Math.round(r)}` }

/** How one organization is using the platform, for the operator: adoption, activity, money flowing through it, and problems. */
export default function OrgAnalytics({ id }: { id: string }) {
  const [days, setDays] = useState('30')
  const { data: a } = useQuery({ queryKey: ['tenant-analytics', id, days], queryFn: () => api<A>(`/platform/tenants/${id}/analytics?days=${days}`) })
  if (!a) return <p className="text-sm text-muted">Loading…</p>
  const labels = a.series.visits.map((d) => dl(d.day))
  const t = a.totals
  const idle = a.lastActivityAt ? Math.floor((Date.now() - new Date(a.lastActivityAt).getTime()) / 86_400_000) : null
  const modules = [['Appointments', t.visitsBooked], ['Billing', t.bills], ['Laboratory', t.labOrders], ['Tele-consultation', t.teleSessions], ['Documents', t.documents], ['Messages', t.messagesSent]] as const
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted">{idle === null ? 'No activity recorded yet' : idle === 0 ? 'Active today' : `Last activity ${idle} day${idle > 1 ? 's' : ''} ago (${fmtDate(a.lastActivityAt!)})`}</p>
        <div className="ml-auto w-40"><Select value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Patients" value={t.patients.toLocaleString('en-IN')} sub={`${t.newPatients} new`} trend={a.series.newPatients.map((d) => d.n)} />
        <Kpi label="Visits" value={t.visitsBooked.toLocaleString('en-IN')} sub={`${t.visitsCompleted} completed`} trend={a.series.visits.map((d) => d.n)} />
        <Kpi label="Billed" value={short(t.billedPaise)} sub={`${short(t.collectedPaise)} collected`} trend={a.series.billedPaise.map((d) => d.v)} />
        <Kpi label="Staff active this week" value={`${a.staff.activeLast7d} of ${a.staff.accounts}`} sub={`${t.branches} branch${t.branches === 1 ? '' : 'es'}`} tone={a.staff.accounts > 1 && a.staff.activeLast7d === 0 ? 'warn' : 'plain'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Visits per day"><LineChart labels={labels} series={[{ name: 'Visits', values: a.series.visits.map((d) => d.n) }]} height={180} /></Panel>
        <Panel title="Billed per day"><Bars items={a.series.billedPaise.map((d) => ({ label: dl(d.day), value: d.v / 100 }))} format={(n) => rupees(n * 100)} /></Panel>
        <Panel title="Staff signed in and active"><LineChart labels={labels} series={[{ name: 'Active staff', values: a.series.activeStaff.map((d) => d.n) }, { name: 'Sign-ins', values: a.series.signIns.map((d) => d.n), dashed: true }]} height={180} /></Panel>
        <Panel title="Which modules they use"><RankBars items={modules.map(([label, value]) => ({ label, value }))} /><p className="mt-3 text-xs text-muted">A module that is switched on but shows nothing here is a good prompt for a training call.</p></Panel>
        <Panel title="Busiest people"><RankBars items={a.staff.topActors.map((s) => ({ label: s.name, value: s.actions, sub: `last ${fmtDate(s.lastAt)}` }))} format={(n) => `${n} actions`} /></Panel>
        <Panel title="What staff do most"><RankBars items={a.topActions.map((s) => ({ label: s.action, value: s.n }))} /></Panel>
      </div>
      <Panel title="Problems for this organization">
        <div className="flex flex-wrap gap-6 text-sm">{(['ERROR', 'WARN', 'SECURITY'] as const).map((l) => <p key={l}><span className="text-2xl font-bold">{a.logs[l] ?? 0}</span> <span className="text-muted">{l.toLowerCase()} events</span></p>)}<p><span className="text-2xl font-bold">{t.openTasks}</span> <span className="text-muted">open tasks</span></p></div>
        <p className="mt-2 text-xs text-muted">Open System logs and search this organization's id for the detail.</p>
      </Panel>
    </div>
  )
}
