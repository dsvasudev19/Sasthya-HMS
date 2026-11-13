import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Pause, Play, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, inputCls, Select } from '@hms/ui-web'
import { api } from '../lib/api'

interface Log { id: string; createdAt: string; level: 'INFO' | 'WARN' | 'ERROR' | 'SECURITY'; source: string; message: string; route: string | null; method: string | null; status: number | null; durationMs: number | null; requestId: string | null; tenantId: string | null; tenantName: string | null; meta: unknown }
interface Stats { hours: number; totals: Record<string, number>; series: { hour: string; level: string; n: number }[]; failingRoutes: { route: string; method: string; n: number; avgMs: number | null }[]; slowRoutes: { route: string; method: string; n: number; avgMs: number | null }[]; noisyHospitals: { tenantId: string; name: string | null; n: number }[] }
const TONE = { INFO: 'bg-slate-100 text-slate-600', WARN: 'bg-amber-100 text-amber-700', ERROR: 'bg-red-100 text-red-600', SECURITY: 'bg-violet-100 text-violet-700' } as const
const BAR = { INFO: 'bg-slate-300', WARN: 'bg-amber-400', ERROR: 'bg-red-500', SECURITY: 'bg-violet-500' } as const

function Activity({ s }: { s: Stats }) {
  const hours = [...new Set(s.series.map((x) => x.hour))]
  const max = Math.max(1, ...hours.map((h) => s.series.filter((x) => x.hour === h).reduce((a, b) => a + b.n, 0)))
  return (
    <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Log volume per hour">
      {hours.map((h) => <div key={h} title={new Date(h).toLocaleString('en-IN')} className="flex flex-1 flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(s.series.filter((x) => x.hour === h).reduce((a, b) => a + b.n, 0) / max) * 100}%` }}>
        {(['INFO', 'WARN', 'ERROR', 'SECURITY'] as const).map((l) => { const n = s.series.find((x) => x.hour === h && x.level === l)?.n ?? 0; return n ? <div key={l} className={BAR[l]} style={{ flex: n }} /> : null })}</div>)}
    </div>
  )
}

export default function Logs() {
  const qc = useQueryClient()
  const [f, setF] = useState({ level: '', source: '', q: '', status: '', tenantId: '' })
  const [live, setLive] = useState(true)
  const [sel, setSel] = useState<Log | null>(null)
  const [older, setOlder] = useState<Log[]>([])
  const [next, setNext] = useState<string | null>(null)
  const params = () => new URLSearchParams({ limit: '80', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) })
  const { data } = useQuery({ queryKey: ['logs', f], queryFn: () => api<{ rows: Log[]; next: string | null }>(`/platform/logs?${params()}`), refetchInterval: live ? 4000 : false })
  const { data: stats } = useQuery({ queryKey: ['log-stats'], queryFn: () => api<Stats>('/platform/logs/stats?hours=24'), refetchInterval: 30000 })
  useEffect(() => { setOlder([]); setNext(null) }, [f])
  const rows = [...(data?.rows ?? []), ...older]
  const more = next ?? (older.length === 0 ? data?.next ?? null : null)
  const loadMore = async () => { const r = await api<{ rows: Log[]; next: string | null }>(`/platform/logs?${params()}&before=${encodeURIComponent(more!)}`); setOlder((o) => [...o, ...r.rows]); setNext(r.next) }
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">System logs</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => setLive(!live)}>{live ? <><Pause size={15} /> Live</> : <><Play size={15} /> Paused</>}</Button>
          <Button variant="ghost" onClick={async () => { if (confirm('Delete logs older than the retention period?')) { await api('/platform/logs', { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['logs'] }) } }}><Trash2 size={15} /> Purge old</Button>
        </div>
      </div>
      {stats && (
        <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="grid grid-cols-2 gap-2">{(['INFO', 'WARN', 'ERROR', 'SECURITY'] as const).map((l) => <button key={l} onClick={() => set('level')(f.level === l ? '' : l)} className={clsx('rounded-xl p-3 text-left ring-1 ring-line', f.level === l && 'ring-2 ring-brand-600')}><p className="text-2xl font-bold">{stats.totals[l] ?? 0}</p><p className={clsx('mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold', TONE[l])}>{l} · 24h</p></button>)}</div>
          <div className="rounded-xl p-4 ring-1 ring-line"><p className="mb-2 text-xs font-semibold text-muted">Last 24 hours</p><Activity s={stats} /></div>
          {(stats.failingRoutes.length > 0 || stats.noisyHospitals.length > 0) && (
            <div className="grid gap-4 text-xs sm:grid-cols-2 lg:col-span-2">
              <div className="rounded-xl p-4 ring-1 ring-line"><p className="mb-2 font-semibold uppercase text-muted">Failing routes</p>{stats.failingRoutes.length === 0 ? <p className="text-muted">None</p> : stats.failingRoutes.map((r) => <button key={r.method + r.route} onClick={() => set('q')(r.route)} className="flex w-full justify-between py-0.5 text-left hover:underline"><span className="truncate font-mono">{r.method} {r.route}</span><b>{r.n}</b></button>)}</div>
              <div className="rounded-xl p-4 ring-1 ring-line"><p className="mb-2 font-semibold uppercase text-muted">Hospitals with the most errors</p>{stats.noisyHospitals.length === 0 ? <p className="text-muted">None</p> : stats.noisyHospitals.map((h) => <button key={h.tenantId} onClick={() => set('tenantId')(h.tenantId)} className="flex w-full justify-between py-0.5 text-left hover:underline"><span className="truncate">{h.name ?? h.tenantId}</span><b>{h.n}</b></button>)}</div>
            </div>
          )}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-36"><Select value={f.level} onChange={set('level')} options={[{ value: '', label: 'All levels' }, { value: 'INFO', label: 'Info' }, { value: 'WARN', label: 'Warning' }, { value: 'ERROR', label: 'Error' }, { value: 'SECURITY', label: 'Security' }]} /></div>
        <input className={`${inputCls} !w-32`} placeholder="Source" value={f.source} onChange={(e) => set('source')(e.target.value)} />
        <input className={`${inputCls} !w-28`} placeholder="Status" inputMode="numeric" value={f.status} onChange={(e) => set('status')(e.target.value.replace(/\D/g, ''))} />
        <input className={`${inputCls} min-w-60 flex-1`} placeholder="Search message, route or request id" value={f.q} onChange={(e) => set('q')(e.target.value)} />
        {(f.tenantId || f.level || f.q || f.source || f.status) && <Button variant="ghost" onClick={() => setF({ level: '', source: '', q: '', status: '', tenantId: '' })}><X size={14} /> Clear</Button>}
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-surface font-semibold"><tr>{['Time', 'Level', 'Source', 'Message', 'Hospital', 'Status', 'ms'].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setSel(r)}>
              <td className="whitespace-nowrap px-3 py-2 text-muted">{new Date(r.createdAt).toLocaleTimeString('en-IN')}</td>
              <td className="px-3 py-2"><span className={clsx('rounded-full px-2 py-0.5 font-bold', TONE[r.level])}>{r.level}</span></td>
              <td className="px-3 py-2 text-muted">{r.source}</td>
              <td className="max-w-[26rem] truncate px-3 py-2">{r.method && <b className="mr-1 font-mono">{r.method}</b>}{r.message}</td>
              <td className="px-3 py-2 text-muted">{r.tenantName ?? '-'}</td><td className="px-3 py-2">{r.status ?? ''}</td><td className="px-3 py-2 text-muted">{r.durationMs ?? ''}</td>
            </tr>))}</tbody>
        </table>
        {rows.length === 0 && <p className="py-10 text-center text-sm text-muted">No log entries match.</p>}
      </div>
      {more && <Button variant="ghost" className="mt-3" onClick={loadMore}>Load older</Button>}
      {sel && (
        <aside role="dialog" aria-label="Log entry" className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl ring-1 ring-line">
          <div className="mb-4 flex items-center justify-between"><span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold', TONE[sel.level])}>{sel.level}</span><button aria-label="Close" onClick={() => setSel(null)}><X size={18} /></button></div>
          <p className="mb-4 text-sm font-semibold">{sel.message}</p>
          <dl className="space-y-2 text-xs">{([['Time', new Date(sel.createdAt).toLocaleString('en-IN')], ['Source', sel.source], ['Route', sel.route ? `${sel.method ?? ''} ${sel.route}` : null], ['Status', sel.status], ['Duration', sel.durationMs != null ? `${sel.durationMs} ms` : null], ['Hospital', sel.tenantName], ['Request id', sel.requestId]] as const).filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="select-all break-all text-right font-mono">{v}</dd></div>)}</dl>
          {sel.meta != null && <pre className="mt-4 overflow-x-auto rounded-xl bg-surface p-3 text-[11px]">{JSON.stringify(sel.meta, null, 2)}</pre>}
          {sel.requestId && <Button variant="ghost" className="mt-4" onClick={() => { set('q')(sel.requestId!); setSel(null) }}>Show everything in this request</Button>}
        </aside>
      )}
    </div>
  )
}
