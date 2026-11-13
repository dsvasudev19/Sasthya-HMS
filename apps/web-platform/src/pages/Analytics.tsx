import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bars, Kpi, Panel, Select } from '@hms/ui-web'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

type Eng = 'ACTIVE' | 'LOW' | 'DORMANT' | 'INACTIVE'
interface Row { id: string; name: string; kind: string; status: string; planCode: string; patients: number; visits: number; billedPaise: number; activeStaff7d: number; lastActivityAt: string | null; errors24h: number; engagement: Eng }
interface Fleet { days: number; rows: Row[]; signupsByWeek: { weekEnding: string; signups: number }[]; byKind: Record<string, number>; dormant: number }
const TONE: Record<Eng, string> = { ACTIVE: 'bg-brand-100 text-brand-700', LOW: 'bg-amber-100 text-amber-700', DORMANT: 'bg-red-100 text-red-600', INACTIVE: 'bg-stone-200 text-stone-600' }
const COLS = [['name', 'Organization'], ['engagement', 'Engagement'], ['patients', 'Patients'], ['visits', 'Visits'], ['billedPaise', 'Billed'], ['activeStaff7d', 'Active staff'], ['errors24h', 'Errors 24h']] as const

/** Every organization side by side: who is using the platform, who has gone quiet, who is having trouble. */
export default function Analytics() {
  const nav = useNavigate()
  const [days, setDays] = useState('30')
  const [sort, setSort] = useState<(typeof COLS)[number][0]>('billedPaise')
  const [eng, setEng] = useState<'' | Eng>('')
  const { data } = useQuery({ queryKey: ['fleet', days], queryFn: () => api<Fleet>(`/platform/analytics?days=${days}`) })
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !eng || r.engagement === eng).sort((a, b) => (sort === 'name' || sort === 'engagement' ? String(a[sort]).localeCompare(String(b[sort])) : (b[sort] as number) - (a[sort] as number))), [data, eng, sort])
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  const live = data.rows.filter((r) => r.engagement !== 'INACTIVE')
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <div className="ml-auto flex gap-2"><div className="w-40"><Select value={eng} onChange={setEng} options={[{ value: '', label: 'All engagement' }, { value: 'ACTIVE', label: 'Active' }, { value: 'LOW', label: 'Low' }, { value: 'DORMANT', label: 'Dormant' }, { value: 'INACTIVE', label: 'Suspended or closed' }]} /></div>
          <div className="w-40"><Select value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></div></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Organizations in use" value={live.filter((r) => r.engagement === 'ACTIVE').length} sub={`of ${live.length} live`} tone="good" />
        <Kpi label="Gone quiet (14+ days)" value={data.dormant} tone={data.dormant ? 'warn' : 'plain'} />
        <Kpi label="Visits across all" value={live.reduce((a, r) => a + r.visits, 0).toLocaleString('en-IN')} sub={`last ${data.days} days`} />
        <Kpi label="Billed through the platform" value={rupees(live.reduce((a, r) => a + r.billedPaise, 0))} sub={`last ${data.days} days`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="New organizations per week"><Bars items={data.signupsByWeek.map((w) => ({ label: w.weekEnding, value: w.signups }))} height={120} /></Panel>
        <Panel title="By type"><ul className="space-y-2 text-sm">{Object.entries(data.byKind).map(([k, n]) => <li key={k} className="flex justify-between"><span className="capitalize">{k.toLowerCase()}</span><b>{n}</b></li>)}</ul></Panel>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{COLS.map(([k, l]) => <th key={k} className="px-4 py-3.5"><button className={clsx('font-semibold', sort === k && 'text-brand-700')} onClick={() => setSort(k)}>{l}{sort === k ? ' ↓' : ''}</button></th>)}<th className="px-4 py-3.5">Last activity</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-surface/60" onClick={() => nav(`/hospitals/${r.id}?tab=Analytics`)}>
              <td className="px-4 py-3 font-semibold">{r.name}<div className="text-xs font-normal capitalize text-muted">{r.kind.toLowerCase()} · {r.planCode.replace(/_/g, ' ').toLowerCase()}</div></td>
              <td className="px-4 py-3"><span className={clsx('rounded-full px-3 py-1 text-xs font-semibold', TONE[r.engagement])}>{r.engagement}</span></td>
              <td className="px-4 py-3">{r.patients.toLocaleString('en-IN')}</td><td className="px-4 py-3">{r.visits.toLocaleString('en-IN')}</td><td className="px-4 py-3">{rupees(r.billedPaise)}</td><td className="px-4 py-3">{r.activeStaff7d}</td>
              <td className={clsx('px-4 py-3', r.errors24h > 0 && 'font-semibold text-red-600')}>{r.errors24h}</td><td className="px-4 py-3 text-muted">{r.lastActivityAt ? fmtDate(r.lastActivityAt) : 'Never'}</td>
            </tr>))}</tbody>
        </table>
        {rows.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing matches.</p>}
      </div>
    </div>
  )
}
