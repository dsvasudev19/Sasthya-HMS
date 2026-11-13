import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Kpi, LineChart, Panel, RankBars } from '../components/charts'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'

interface F { days: number; sent: number; responses: number; responseRatePct: number; nps: number | null; average: number | null; promoters: number; passives: number; detractors: number; weeks: { weekEnding: string; responses: number; nps: number | null }[]; byDoctor: { doctorId: string; doctor: string | null; responses: number; nps: number | null; average: number }[]; comments: { id: string; score: number; comment: string; patient: string | null; at: string; context: string }[] }

export default function Feedback() {
  const { data: f } = useQuery({ queryKey: ['feedback'], queryFn: () => api<F>('/feedback') })
  if (!f) return <p className="py-16 text-center text-sm text-muted">Loading…</p>
  const tone = f.nps === null ? 'plain' : f.nps >= 50 ? 'good' : f.nps < 30 ? 'alert' : 'warn'
  return (
    <div className="space-y-5 pb-6">
      <div><h1 className="text-2xl font-bold tracking-tight">Patient feedback</h1><p className="text-sm text-muted">Last {f.days} days. Patients are sent a link after a visit or discharge.</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Net promoter score" value={f.nps ?? '-'} tone={tone} sub="promoters minus detractors, in %" /><Kpi label="Average score" value={f.average !== null ? `${f.average} / 10` : '-'} /><Kpi label="Responses" value={f.responses} sub={`${f.responseRatePct}% of ${f.sent} asked`} /><Kpi label="Happy · neutral · unhappy" value={`${f.promoters} · ${f.passives} · ${f.detractors}`} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="NPS by week"><LineChart labels={f.weeks.map((w) => fmtDate(w.weekEnding))} series={[{ name: 'NPS', values: f.weeks.map((w) => w.nps ?? 0) }]} height={180} /></Panel>
        <Panel title="By doctor"><RankBars items={f.byDoctor.filter((d) => d.nps !== null).map((d) => ({ label: d.doctor ?? 'Doctor', value: Math.max(0, (d.nps ?? 0) + 100), sub: `${d.responses} responses · average ${d.average}` }))} format={(n) => `NPS ${n - 100}`} empty="Not enough doctor-linked feedback yet." /></Panel>
      </div>
      <Panel title="What patients said, unhappiest first">
        {f.comments.length === 0 ? <p className="py-6 text-center text-sm text-muted">No comments yet.</p> : <ul className="divide-y divide-line">{f.comments.map((c) => <li key={c.id} className="flex gap-3 py-3 text-sm"><span className={clsx('grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold', c.score <= 6 ? 'bg-red-100 text-red-700' : c.score <= 8 ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')}>{c.score}</span><div><p>{c.comment}</p><p className="text-xs text-muted">{c.patient ?? 'Anonymous'} · {c.context.toLowerCase()} · {fmtDate(c.at)}</p></div></li>)}</ul>}
      </Panel>
    </div>
  )
}
