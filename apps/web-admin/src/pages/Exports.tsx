import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Trash2 } from 'lucide-react'
import { useState } from 'react'
import Select from '../components/Select'
import { Button, Field, inputCls } from '../components/ui'
import { api, downloadFile } from '../lib/api'
import { fmtDate } from '../lib/format'

interface Rep { key: string; label: string }
interface Sched { id: string; name: string; report: string; frequency: string; active: boolean; lastRunAt: string | null }
interface Run { id: string; report: string; fromDate: string; toDate: string; rows: number; createdAt: string; schedule: { name: string } | null }
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const FREQ = { DAILY: 'Every morning, for yesterday', WEEKLY: 'Every Monday, for last week', MONTHLY: 'On the 1st, for last month' } as Record<string, string>

export default function Exports() {
  const qc = useQueryClient()
  const { data: reports = [] } = useQuery({ queryKey: ['export-reports'], queryFn: () => api<Rep[]>('/exports/reports') })
  const { data: scheds = [] } = useQuery({ queryKey: ['export-scheds'], queryFn: () => api<Sched[]>('/exports/schedules/list') })
  const { data: runs = [] } = useQuery({ queryKey: ['export-runs'], queryFn: () => api<Run[]>('/exports/runs') })
  const [rep, setRep] = useState('GST_REGISTER')
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)))
  const [to, setTo] = useState(iso(new Date()))
  const [err, setErr] = useState('')
  const dl = async (path: string, name: string) => { setErr(''); try { await downloadFile(path, name) } catch (e) { setErr((e as Error).message) } }
  const [ns, setNs] = useState({ name: '', report: 'COLLECTIONS', frequency: 'WEEKLY' })
  const create = useMutation({ mutationFn: () => api('/exports/schedules', { method: 'POST', body: JSON.stringify(ns) }), onSuccess: () => { setNs({ ...ns, name: '' }); qc.invalidateQueries({ queryKey: ['export-scheds'] }) } })
  const run = useMutation({ mutationFn: (id: string) => api(`/exports/schedules/${id}/run`, { method: 'POST', body: '{}' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['export-runs'] }); qc.invalidateQueries({ queryKey: ['export-scheds'] }) } })
  const stop = useMutation({ mutationFn: (id: string) => api(`/exports/schedules/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['export-scheds'] }) })
  const label = (k: string) => reports.find((r) => r.key === k)?.label ?? k
  return (
    <div className="space-y-6 pb-6">
      <div><h1 className="text-2xl font-bold tracking-tight">Exports</h1><p className="text-sm text-muted">Spreadsheets for your accountant, auditor and board. They open in Excel.</p></div>
      <section className="space-y-3 rounded-2xl p-5 ring-1 ring-line"><h2 className="font-semibold">Download now</h2>
        <div className="grid gap-3 sm:grid-cols-4"><Field label="Report"><Select value={rep} onChange={setRep} options={reports.map((r) => ({ value: r.key, label: r.label }))} /></Field><Field label="From"><input type="date" className={inputCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field><div className="flex items-end"><Button className="w-full" onClick={() => dl(`/exports/${rep}?from=${from}&to=${to}`, `${rep.toLowerCase()}-${from}-to-${to}.csv`)}><Download size={15} /> Download</Button></div></div>
        {err && <p className="text-sm text-red-600">{err}</p>}<p className="text-xs text-muted">Every download is recorded in the audit trail. The range can be up to 13 months.</p></section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl p-5 ring-1 ring-line"><h2 className="font-semibold">Scheduled reports</h2>
          <div className="grid gap-2 sm:grid-cols-3"><input className={inputCls} placeholder="Name" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /><Select value={ns.report} onChange={(report) => setNs({ ...ns, report })} options={reports.map((r) => ({ value: r.key, label: r.label }))} /><Select value={ns.frequency} onChange={(frequency) => setNs({ ...ns, frequency })} options={Object.entries(FREQ).map(([value, l]) => ({ value, label: l }))} /></div>
          {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}<Button variant="ghost" disabled={ns.name.trim().length < 2} onClick={() => create.mutate()}>Add schedule</Button>
          <ul className="divide-y divide-line text-sm">{scheds.filter((s) => s.active).map((s) => <li key={s.id} className="flex items-center gap-2 py-2.5"><div className="mr-auto"><p className="font-semibold">{s.name}</p><p className="text-xs text-muted">{label(s.report)} · {FREQ[s.frequency]}{s.lastRunAt ? ` · last ${fmtDate(s.lastRunAt)}` : ''}</p></div><Button variant="ghost" onClick={() => run.mutate(s.id)}>Run now</Button><button aria-label="Stop" className="text-muted hover:text-red-600" onClick={() => confirm('Stop this schedule?') && stop.mutate(s.id)}><Trash2 size={16} /></button></li>)}{scheds.filter((s) => s.active).length === 0 && <li className="py-4 text-center text-muted">Nothing scheduled.</li>}</ul></section>
        <section className="space-y-3 rounded-2xl p-5 ring-1 ring-line"><h2 className="font-semibold">Ready to download</h2>
          <ul className="divide-y divide-line text-sm">{runs.map((r) => <li key={r.id} className="flex items-center gap-3 py-2.5"><FileSpreadsheet size={18} className="text-brand-700" /><div className="mr-auto"><p className="font-semibold">{label(r.report)}</p><p className="text-xs text-muted">{fmtDate(r.fromDate)} to {fmtDate(r.toDate)} · {r.rows} rows{r.schedule ? ` · ${r.schedule.name}` : ''}</p></div><Button variant="ghost" onClick={() => dl(`/exports/runs/${r.id}/download`, `${r.report.toLowerCase()}-${iso(new Date(r.fromDate))}.csv`)}><Download size={14} /></Button></li>)}{runs.length === 0 && <li className="py-4 text-center text-muted">Scheduled reports appear here when they are produced.</li>}</ul></section>
      </div>
    </div>
  )
}
