import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Eye } from 'lucide-react'
import { Donut, Kpi, LineChart, Panel, RankBars } from '../components/charts'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface Ex {
  asOf: string; daysIn: number
  kpis: { billedPaise: number; billedChangePct: number | null; collectedPaise: number; collectedChangePct: number | null; collectionEfficiencyPct: number | null; visits: number; visitsChangePct: number | null; newPatients: number; newPatientsChangePct: number | null; refundedPaise: number; discountPct: number; noShowPct: number }
  inpatient: { beds: number; occupied: number; occupancyNowPct: number | null; occupancy30dPct: number | null; avgLengthOfStayDays: number | null; discharges30d: number; admissionsMtd: number; dischargesMtd: number; pastExpectedDischarge: number; outcomes: Record<string, number> }
  revenueBySource: { source: string; paise: number }[]; doctors: { id: string; name: string; billedPaise: number; visits: number }[]; branches: { code: string; name: string; billedPaise: number; bills: number }[]
  trend: { day: string; paise: number }[]
  control: { cashMismatches: { date: string; branch: string; variancePaise: number }[]; voidedBills: number; aging: { under7Paise: number; under30Paise: number; over30Paise: number } }
  insurance: { openClaims: number; receivablePaise: number; overduePaise: number; rejectedMtd: number }
  ot: { theatres: number; completed30d: number; cancelled30d: number; utilisationPct: number | null }
  er: { visits30d: number; medianDoorToDoctorMinutes: number | null; lwbsPct: number; waitingNow: number }
  feedback: { responses90d: number; nps: number | null }
  workforce: { rosteredToday: number; absentToday: number }
  insights: { level: 'good' | 'watch' | 'act'; title: string; detail: string }[]
}
const SOURCE: Record<string, string> = { CONSULTATION: 'Consultations', PHARMACY: 'Pharmacy', LAB: 'Laboratory', HEALTH_CARD: 'Health cards', IPD: 'Inpatient stays', MANUAL: 'Other bills' }
const OUTCOME: Record<string, string> = { RECOVERED: 'Recovered', REFERRED: 'Referred', LAMA: 'Against advice', ABSCONDED: 'Absconded', DEATH: 'Death' }
const delta = (v: number | null) => (v === null ? undefined : { value: v })
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const ICON = { act: <AlertTriangle size={18} className="text-red-600" />, watch: <Eye size={18} className="text-amber-600" />, good: <CheckCircle2 size={18} className="text-brand-700" /> }

/** The chairman's page: how the whole organisation is doing this month, and what needs a decision. */
export default function Executive() {
  const { data: e, error } = useQuery({ queryKey: ['executive'], queryFn: () => api<Ex>('/analytics/executive'), refetchInterval: 120_000 })
  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{(error as Error).message}</p>
  if (!e) return <p className="py-16 text-center text-sm text-muted">Crunching the numbers…</p>
  const k = e.kpis, ip = e.inpatient
  return (
    <div className="space-y-5 pb-6">
      <div><h1 className="text-2xl font-bold tracking-tight">Executive overview</h1><p className="text-sm text-muted">This month so far ({e.daysIn} days), compared with the same days last month. All branches you can see.</p></div>

      <section aria-label="What needs attention" className="space-y-2">
        {e.insights.map((i, n) => (
          <div key={n} className={clsx('flex gap-3 rounded-2xl p-4 ring-1', i.level === 'act' ? 'bg-red-50 ring-red-200' : i.level === 'watch' ? 'bg-amber-50 ring-amber-200' : 'bg-brand-50 ring-brand-200')}>
            <span className="mt-0.5 shrink-0">{ICON[i.level]}</span><div><p className="text-sm font-semibold">{i.title}</p><p className="text-xs text-muted">{i.detail}</p></div>
          </div>
        ))}
        {e.insights.length === 0 && <p className="rounded-2xl bg-surface p-4 text-sm text-muted">Not enough activity yet to say anything useful.</p>}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Billed" value={rupees(k.billedPaise)} delta={delta(k.billedChangePct)} sub="vs same days last month" trend={e.trend.map((t) => t.paise)} />
        <Kpi label="Collected" value={rupees(k.collectedPaise)} delta={delta(k.collectedChangePct)} sub={k.collectionEfficiencyPct !== null ? `${k.collectionEfficiencyPct}% of billing` : undefined} tone={k.collectionEfficiencyPct !== null && k.collectionEfficiencyPct < 80 ? 'warn' : 'plain'} />
        <Kpi label="Visits" value={k.visits.toLocaleString('en-IN')} delta={delta(k.visitsChangePct)} sub={`${k.noShowPct}% no-shows`} />
        <Kpi label="New patients" value={k.newPatients.toLocaleString('en-IN')} delta={delta(k.newPatientsChangePct)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Billing, last 30 days" className="lg:col-span-2"><LineChart labels={e.trend.map((t) => day(t.day))} series={[{ name: 'Billed', values: e.trend.map((t) => t.paise / 100) }]} format={(n) => rupees(n * 100)} height={200} /></Panel>
        <Panel title="Where the money comes from"><Donut items={e.revenueBySource.map((s) => ({ label: SOURCE[s.source] ?? s.source, value: s.paise / 100 }))} format={(n) => rupees(n * 100)} centre="This month" /></Panel>
      </div>

      {ip.beds > 0 && (
        <Panel title="Inpatient">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Occupied now" value={`${ip.occupancyNowPct ?? 0}%`} sub={`${ip.occupied} of ${ip.beds} beds`} tone={(ip.occupancyNowPct ?? 0) >= 90 ? 'alert' : 'plain'} />
            <Kpi label="30-day occupancy" value={ip.occupancy30dPct !== null ? `${ip.occupancy30dPct}%` : '-'} />
            <Kpi label="Average stay" value={ip.avgLengthOfStayDays !== null ? `${ip.avgLengthOfStayDays} days` : '-'} sub={`${ip.discharges30d} discharges`} />
            <Kpi label="Admitted this month" value={ip.admissionsMtd} sub={`${ip.dischargesMtd} discharged`} />
            <Kpi label="Past expected discharge" value={ip.pastExpectedDischarge} tone={ip.pastExpectedDischarge ? 'warn' : 'plain'} />
          </div>
          {Object.keys(ip.outcomes).length > 0 && <p className="mt-3 text-xs text-muted">Outcomes, 30 days: {Object.entries(ip.outcomes).map(([o, n]) => `${OUTCOME[o] ?? o} ${n}`).join(' · ')}</p>}
        </Panel>
      )}

      {(e.insurance.openClaims > 0 || e.ot.theatres > 0 || e.er.visits30d > 0 || e.feedback.responses90d > 0 || e.workforce.rosteredToday > 0) && (
        <Panel title="Other departments">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {e.insurance.openClaims > 0 && <Kpi label="Insurers owe you" value={rupees(e.insurance.receivablePaise)} sub={`${e.insurance.openClaims} open claims · ${rupees(e.insurance.overduePaise)} overdue`} tone={e.insurance.overduePaise ? 'alert' : 'plain'} />}
            {e.ot.theatres > 0 && <Kpi label="Theatre use" value={e.ot.utilisationPct !== null ? `${e.ot.utilisationPct}%` : '-'} sub={`${e.ot.completed30d} surgeries · ${e.ot.cancelled30d} cancelled`} />}
            {e.er.visits30d > 0 && <Kpi label="Emergency, to doctor" value={e.er.medianDoorToDoctorMinutes !== null ? `${e.er.medianDoorToDoctorMinutes} min` : '-'} sub={`${e.er.visits30d} arrivals · ${e.er.lwbsPct}% left unseen`} tone={(e.er.medianDoorToDoctorMinutes ?? 0) > 30 ? 'warn' : 'plain'} />}
            {e.feedback.responses90d > 0 && <Kpi label="Patient satisfaction (NPS)" value={e.feedback.nps ?? '-'} sub={`${e.feedback.responses90d} responses, 90 days`} tone={(e.feedback.nps ?? 100) < 30 ? 'alert' : 'plain'} />}
            {e.workforce.rosteredToday > 0 && <Kpi label="Staff on duty today" value={e.workforce.rosteredToday - e.workforce.absentToday} sub={`${e.workforce.absentToday} not signed in`} tone={e.workforce.absentToday ? 'warn' : 'plain'} />}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Doctors by billing this month"><RankBars items={e.doctors.map((d) => ({ label: d.name, value: d.billedPaise, sub: `${d.visits} visits` }))} format={rupees} /></Panel>
        {e.branches.length > 1 ? <Panel title="Branches by billing"><RankBars items={e.branches.map((b) => ({ label: b.name, value: b.billedPaise, sub: `${b.bills} bills` }))} format={rupees} /></Panel> : (
          <Panel title="Money owed to you"><RankBars items={[{ label: 'Under 7 days', value: e.control.aging.under7Paise }, { label: '7 to 30 days', value: e.control.aging.under30Paise }, { label: 'Over 30 days', value: e.control.aging.over30Paise }]} format={rupees} color="bg-amber-500" /></Panel>)}
      </div>

      <Panel title="Financial control">
        <div className="grid gap-6 text-sm lg:grid-cols-3">
          <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Discounts given</p><p className="text-2xl font-bold">{k.discountPct}%</p><p className="text-xs text-muted">of gross billing</p></div>
          <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Refunds · voided bills</p><p className="text-2xl font-bold">{rupees(k.refundedPaise)} <span className="text-base font-medium text-muted">· {e.control.voidedBills}</span></p></div>
          <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Cash that did not tally</p>
            {e.control.cashMismatches.length === 0 ? <p className="font-semibold text-brand-700">All closings tallied</p> : <ul className="space-y-1">{e.control.cashMismatches.map((m, i) => <li key={i} className="flex justify-between"><span>{fmtDate(m.date)} · {m.branch}</span><span className={m.variancePaise < 0 ? 'font-semibold text-red-600' : 'font-semibold text-amber-600'}>{m.variancePaise > 0 ? '+' : ''}{rupees(m.variancePaise)}</span></li>)}</ul>}</div>
        </div>
      </Panel>
    </div>
  )
}
