import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Bars, Donut, Kpi, LineChart, Panel, RankBars } from '../components/charts'
import { Button, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { rupees } from '../lib/format'
import { csv } from './pharmacy/shared'

interface Report {
  from: string; to: string; days: number; branches: string[]
  visits: { total: number; byStatus: Record<string, number>; byChannel: Record<string, number>; noShowRate: number; perDay: { day: string; booked: number; completed: number }[]; byHour: { hour: number; n: number }[]; byWeekday: { weekday: number; n: number }[]; byDoctor: { doctorId: string | null; name: string; total: number; completed: number; tele: number }[] }
  patients: { total: number; newInRange: number; newPerDay: { day: string; n: number }[]; seen: number; returning: number; returningRate: number; ageBands: { band: string; n: number }[]; gender: { gender: string; n: number }[] }
  clinical: { topDiagnoses: { name: string; n: number }[]; topMedicines: { name: string; n: number }[] }
  lab: { orders: number; byStatus: Record<string, number>; turnaroundHours: number | null; topTests: { name: string; n: number; abnormal: number }[] }
  money?: { billedPaise: number; collectedPaise: number; refundedPaise: number; series: { day: string; billed: number; collected: number }[]; bySource: { source: string; totalPaise: number; bills: number }[]; byMethod: { method: string; totalPaise: number }[]; byBranch: { code: string; billedPaise: number; bills: number }[]; outstanding: { under7Paise: number; under30Paise: number; over30Paise: number } }
}

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const back = (n: number) => iso(new Date(Date.now() - n * 86_400_000))
const PRESETS = [{ k: '7', label: '7 days', from: () => back(6) }, { k: '30', label: '30 days', from: () => back(29) }, { k: '90', label: '90 days', from: () => back(89) }, { k: 'month', label: 'This month', from: () => iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }, { k: 'year', label: 'This year', from: () => iso(new Date(new Date().getFullYear(), 0, 1)) }] as const
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SOURCE: Record<string, string> = { CONSULTATION: 'Consultations', IPD: 'Inpatient stays', PHARMACY: 'Pharmacy', LAB: 'Laboratory', HEALTH_CARD: 'Health cards', MANUAL: 'Other bills' }
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const money = (n: number) => (n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(1)}Cr` : n >= 100_000 ? `₹${(n / 100_000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`)

/** Collapses a daily series into weeks or months so long ranges stay readable. */
function bucket<T extends { day: string }>(rows: T[], sum: (r: T) => number[], size: 'day' | 'week' | 'month') {
  if (size === 'day') return rows.map((r) => ({ label: day(r.day), v: sum(r) }))
  const m = new Map<string, number[]>()
  for (const r of rows) {
    const d = new Date(`${r.day}T00:00:00`)
    const key = size === 'month' ? r.day.slice(0, 7) : iso(new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000))
    const cur = m.get(key) ?? sum(r).map(() => 0)
    sum(r).forEach((x, i) => { cur[i] = (cur[i] ?? 0) + x })
    m.set(key, cur)
  }
  return [...m.entries()].map(([k, v]) => ({ label: size === 'month' ? new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : day(k), v }))
}

export default function Reports() {
  const { can, branchId, branch } = useAuth()
  const [preset, setPreset] = useState<string>('30')
  const [from, setFrom] = useState(back(29))
  const [to, setTo] = useState(back(0))
  const [tab, setTab] = useState<'overview' | 'revenue' | 'visits' | 'clinical' | 'lab'>('overview')
  const { data: r, isFetching, error } = useQuery({ queryKey: ['report', from, to, branchId], queryFn: () => api<Report>(`/analytics/report?from=${from}&to=${to}`) })
  const size = !r ? 'day' : r.days > 150 ? 'month' : r.days > 45 ? 'week' : 'day'
  const tabs = [{ k: 'overview', label: 'Overview' }, ...(r?.money ? [{ k: 'revenue', label: 'Revenue' }] : []), { k: 'visits', label: 'Visits and patients' }, ...(can('clinical:read') ? [{ k: 'clinical', label: 'Clinical' }] : []), ...(can('lab:read') ? [{ k: 'lab', label: 'Laboratory' }] : [])] as { k: typeof tab; label: string }[]

  const revenue = useMemo(() => (r?.money ? bucket(r.money.series, (x) => [x.billed / 100, x.collected / 100], size) : []), [r, size])
  const visits = useMemo(() => (r ? bucket(r.visits.perDay, (x) => [x.booked, x.completed], size) : []), [r, size])
  const newPats = useMemo(() => (r ? bucket(r.patients.newPerDay, (x) => [x.n], size) : []), [r, size])

  const exportCsv = () => {
    if (!r) return
    const rows: (string | number)[][] = [['Day', 'Visits booked', 'Visits completed', ...(r.money ? ['Billed (₹)', 'Collected (₹)'] : [])]]
    r.visits.perDay.forEach((d, i) => rows.push([d.day, d.booked, d.completed, ...(r.money ? [r.money.series[i]!.billed / 100, r.money.series[i]!.collected / 100] : [])]))
    csv(`report-${r.from}-to-${r.to}.csv`, rows)
  }

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Reports and analytics</h1><p className="text-sm text-muted">{branchId === 'all' ? 'All branches' : branch?.name} · {day(from)} to {day(to)}{isFetching && ' · updating…'}</p></div>
        <div className="flex flex-wrap rounded-xl bg-surface p-1 ring-1 ring-line">
          {PRESETS.map((p) => <button key={p.k} onClick={() => { setPreset(p.k); setFrom(p.from()); setTo(back(0)) }} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', preset === p.k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted hover:text-ink')}>{p.label}</button>)}
        </div>
        <div className="flex items-center gap-1.5 text-sm"><input type="date" aria-label="From" className={`${inputCls} !w-36 !py-2`} value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value) }} /><span className="text-muted">to</span><input type="date" aria-label="To" className={`${inputCls} !w-36 !py-2`} value={to} min={from} max={back(0)} onChange={(e) => { setPreset('custom'); setTo(e.target.value) }} /></div>
        <Button variant="ghost" onClick={exportCsv} disabled={!r}><Download size={15} /> CSV</Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => <button key={t.k} onClick={() => setTab(t.k)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', tab === t.k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>{t.label}</button>)}
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{(error as Error).message}</p>}
      {!r ? <p className="py-16 text-center text-sm text-muted">Crunching the numbers…</p> : (
        <>
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {r.money && <Kpi label="Billed" value={rupees(r.money.billedPaise)} sub={`${rupees(r.money.collectedPaise)} collected`} tone="good" />}
                {r.money && <Kpi label="Collection rate" value={`${r.money.billedPaise ? Math.round((r.money.collectedPaise / r.money.billedPaise) * 100) : 0}%`} sub={`${rupees(r.money.refundedPaise)} refunded`} />}
                <Kpi label="Visits" value={r.visits.total} sub={`${r.visits.byStatus['COMPLETED'] ?? 0} completed · ${r.visits.noShowRate}% no-show`} />
                <Kpi label="New patients" value={r.patients.newInRange} sub={`${r.patients.returningRate}% of those seen were returning`} />
              </div>
              {r.money && <Panel title={`Billed and collected, by ${size}`}><LineChart labels={revenue.map((x) => x.label)} series={[{ name: 'Billed', values: revenue.map((x) => x.v[0]!) }, { name: 'Collected', values: revenue.map((x) => x.v[1]!), color: '#3b82f6' }]} format={money} height={230} /></Panel>}
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title={`Visits, by ${size}`}><LineChart labels={visits.map((x) => x.label)} series={[{ name: 'Booked', values: visits.map((x) => x.v[0]!) }, { name: 'Completed', values: visits.map((x) => x.v[1]!), color: '#3b82f6' }]} height={200} /></Panel>
                {r.money && <Panel title="Where the money comes from"><Donut items={r.money.bySource.map((s) => ({ label: SOURCE[s.source] ?? s.source, value: s.totalPaise / 100 }))} format={money} centre={money(r.money.billedPaise / 100)} /></Panel>}
              </div>
            </div>
          )}

          {tab === 'revenue' && r.money && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3"><Kpi label="Billed" value={rupees(r.money.billedPaise)} /><Kpi label="Collected" value={rupees(r.money.collectedPaise)} tone="good" /><Kpi label="Refunded" value={rupees(r.money.refundedPaise)} tone={r.money.refundedPaise ? 'warn' : 'plain'} /></div>
              <Panel title={`Daily takings, by ${size}`}><LineChart labels={revenue.map((x) => x.label)} series={[{ name: 'Billed', values: revenue.map((x) => x.v[0]!) }, { name: 'Collected', values: revenue.map((x) => x.v[1]!), color: '#3b82f6' }]} format={money} height={240} /></Panel>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="By source"><RankBars items={r.money.bySource.map((s) => ({ label: SOURCE[s.source] ?? s.source, value: s.totalPaise / 100, sub: `${s.bills} bills` }))} format={money} /></Panel>
                <Panel title="How patients paid"><Donut items={r.money.byMethod.map((m) => ({ label: m.method === 'CASH' ? 'Cash' : m.method === 'UPI' ? 'UPI' : 'Card', value: m.totalPaise / 100 }))} format={money} /></Panel>
                <Panel title="Money still owed to you"><RankBars color="bg-amber-500" items={[{ label: 'Up to a week old', value: r.money.outstanding.under7Paise / 100 }, { label: '1 to 4 weeks old', value: r.money.outstanding.under30Paise / 100 }, { label: 'Over a month old', value: r.money.outstanding.over30Paise / 100 }]} format={money} /></Panel>
                {r.money.byBranch.length > 1 && <Panel title="By branch"><RankBars items={r.money.byBranch.map((b) => ({ label: b.code, value: b.billedPaise / 100, sub: `${b.bills} bills` }))} format={money} /></Panel>}
              </div>
            </div>
          )}

          {tab === 'visits' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="Visits booked" value={r.visits.total} /><Kpi label="Video share" value={`${r.visits.total ? Math.round(((r.visits.byChannel['TELE'] ?? 0) / Math.max(1, (r.visits.byChannel['TELE'] ?? 0) + (r.visits.byChannel['IN_PERSON'] ?? 0))) * 100) : 0}%`} sub={`${r.visits.byChannel['TELE'] ?? 0} video visits`} /><Kpi label="Cancelled" value={r.visits.byStatus['CANCELLED'] ?? 0} tone={(r.visits.byStatus['CANCELLED'] ?? 0) > 0 ? 'warn' : 'plain'} /><Kpi label="Returning patients" value={`${r.patients.returningRate}%`} sub={`${r.patients.returning} of ${r.patients.seen} seen`} /></div>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="When patients come (hour of day)"><Bars items={r.visits.byHour.filter((h) => h.hour >= 7 && h.hour <= 21).map((h) => ({ label: String(h.hour), value: h.n }))} highlight={r.visits.byHour.filter((h) => h.hour >= 7 && h.hour <= 21).reduce((b, h, i, a) => (h.n > a[b]!.n ? i : b), 0)} /></Panel>
                <Panel title="Busiest days of the week"><Bars items={r.visits.byWeekday.map((w) => ({ label: WD[w.weekday]!, value: w.n }))} highlight={r.visits.byWeekday.reduce((b, w, i, a) => (w.n > a[b]!.n ? i : b), 0)} /></Panel>
                <Panel title={`New patients, by ${size}`}><LineChart labels={newPats.map((x) => x.label)} series={[{ name: 'New patients', values: newPats.map((x) => x.v[0]!) }]} height={190} /></Panel>
                <Panel title="Who the patients are"><div className="grid gap-5 sm:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-muted">By age</p><Bars items={r.patients.ageBands.map((a) => ({ label: a.band, value: a.n }))} height={120} /></div><div><p className="mb-2 text-xs font-semibold text-muted">By gender</p><Donut items={r.patients.gender.map((g) => ({ label: g.gender === 'FEMALE' ? 'Female' : g.gender === 'MALE' ? 'Male' : g.gender === 'OTHER' ? 'Other' : g.gender, value: g.n }))} /></div></div></Panel>
              </div>
              <Panel title="Doctors, by visits"><div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="text-xs text-muted"><tr><th className="py-2">Doctor</th><th>Booked</th><th>Completed</th><th>Video</th><th>Completion</th></tr></thead><tbody className="divide-y divide-line">{r.visits.byDoctor.map((d) => <tr key={d.doctorId ?? 'none'}><td className="py-2.5 font-medium">{d.name}</td><td>{d.total}</td><td>{d.completed}</td><td>{d.tele}</td><td><span className="inline-flex w-28 items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${d.total ? (d.completed / d.total) * 100 : 0}%` }} /></span><span className="text-xs text-muted">{d.total ? Math.round((d.completed / d.total) * 100) : 0}%</span></span></td></tr>)}</tbody></table></div></Panel>
            </div>
          )}

          {tab === 'clinical' && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Most common diagnoses"><RankBars items={r.clinical.topDiagnoses.map((d) => ({ label: d.name, value: d.n }))} /></Panel>
              <Panel title="Most prescribed medicines"><RankBars color="bg-sky-500" items={r.clinical.topMedicines.map((d) => ({ label: d.name, value: d.n }))} /></Panel>
            </div>
          )}

          {tab === 'lab' && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3"><Kpi label="Lab orders" value={r.lab.orders} /><Kpi label="Released" value={r.lab.byStatus['RELEASED'] ?? 0} tone="good" /><Kpi label="Average turnaround" value={r.lab.turnaroundHours === null ? '-' : `${r.lab.turnaroundHours} h`} sub="from order to released report" /></div>
              <Panel title="Most ordered tests"><RankBars items={r.lab.topTests.map((t) => ({ label: t.name, value: t.n, sub: t.abnormal ? `${t.abnormal} abnormal` : undefined }))} /></Panel>
            </div>
          )}
        </>
      )}
    </div>
  )
}
