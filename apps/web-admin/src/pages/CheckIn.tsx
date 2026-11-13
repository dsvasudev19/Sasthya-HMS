import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Clock, ScanLine, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { Kpi } from '../components/charts'
import { Avatar } from '../components/ui'
import { api } from '../lib/api'
import { fmtTime } from '../lib/format'
import { ScanCard, useScan, useScanner, type ScanOutcome } from '../lib/scan'

interface Q { id: string; scheduledAt: string; status: string; tokenNo: number | null; channel: string; patient: { id: string; fullName: string; patientNo: string }; doctor: { fullName: string | null } | null }
interface Overview { visits?: { total: number; waiting: number; inConsultation: number; scheduled: number; completed: number }; queue?: Q[] }
type Entry = ScanOutcome & { at: number; code: string }

/**
 * The front desk, built for speed. The cursor is always in the scan box, so a handheld scanner just works: scan the token slip,
 * the wristband or the health card and the patient is checked in, the bill is raised, and a sound tells you it worked.
 * Typing a phone number, patient number or card number does the same. Nothing else needs to be touched.
 */
export default function CheckIn() {
  const { branchId } = useAuth()
  const qc = useQueryClient()
  const { openCamera } = useScan()
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [current, setCurrent] = useState<Entry | null>(null)
  const [log, setLog] = useState<Entry[]>([])
  const ov = useQuery({ queryKey: ['overview', branchId], queryFn: () => api<Overview>('/analytics/overview'), refetchInterval: 15_000 })

  const run = useMutation({
    mutationFn: (v: { code: string; extra?: object }) => api<ScanOutcome>('/scan', { method: 'POST', body: JSON.stringify({ code: v.code, ...v.extra }) }),
    onSuccess: (r, v) => {
      const e = { ...r, at: Date.now(), code: v.code }
      setCurrent(e); setLog((l) => [e, ...l].slice(0, 12)); setValue('')
      if (r.outcome === 'DONE') for (const k of ['overview', 'today', 'appointments']) qc.invalidateQueries({ queryKey: [k] })
      input.current?.focus()
    },
  })
  const scan = useCallback((code: string, extra?: object) => { if (code.trim()) run.mutate({ code: code.trim(), extra }) }, [run])
  // Take scans from the hardware scanner ourselves, instead of the global pop-up.
  useScanner((c) => { scan(c); return true })
  useEffect(() => { input.current?.focus() }, [])

  const v = ov.data?.visits
  const next = (ov.data?.queue ?? []).filter((q) => q.status === 'SCHEDULED').slice(0, 8)
  const waiting = (ov.data?.queue ?? []).filter((q) => q.status === 'CHECKED_IN')
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-end gap-3"><div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Front desk</h1><p className="text-sm text-muted">Scan to check in. Slip, wristband, health card, phone number: all work.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Expected" value={v?.scheduled ?? 0} icon={<Clock size={16} />} sub="still to arrive" />
        <Kpi label="Waiting" value={v?.waiting ?? 0} icon={<Users size={16} />} tone={(v?.waiting ?? 0) > 6 ? 'warn' : 'plain'} sub={`${v?.inConsultation ?? 0} with the doctor`} />
        <Kpi label="Seen today" value={v?.completed ?? 0} tone="good" sub={`${v?.total ?? 0} booked`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className={clsx('rounded-3xl border-2 border-dashed p-6 transition', run.isPending ? 'border-brand-400 bg-brand-50' : 'border-brand-300 bg-white')}>
            <div className="flex items-center gap-4">
              <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700"><ScanLine size={28} /></span>
              <form className="min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); scan(value) }}>
                <input ref={input} data-scan="on" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setTimeout(() => { if (!document.querySelector('[role="dialog"]') && document.activeElement === document.body) input.current?.focus() }, 150)}
                  placeholder="Scan here, or type a phone, patient or card number and press Enter" className="w-full bg-transparent text-xl font-semibold outline-none placeholder:text-base placeholder:font-normal placeholder:text-slate-400" aria-label="Scan or type a code" autoComplete="off" inputMode="text" />
              </form>
              <button onClick={() => openCamera(true)} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold ring-1 ring-line hover:bg-surface"><Camera size={16} /> Camera</button>
            </div>
          </div>

          {current ? (
            <div className="[&>div]:p-6 [&_p.font-bold]:text-xl">
              <ScanCard r={current}
                onChoice={(id) => scan(current.code, current.kind === 'HEALTH_CARD' ? { patientId: id, action: 'checkin' } : { appointmentId: id })}
                onWalkIn={() => current.patient && scan(current.code, { action: 'walkin', patientId: current.patient.id })} />
            </div>
          ) : <div className="rounded-2xl border border-line bg-surface py-14 text-center text-sm text-muted">Ready. The next scan appears here.</div>}
          {run.error && <p className="text-sm text-red-600">{(run.error as Error).message}</p>}

          {log.length > 1 && (
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Just now</p>
              <ul className="divide-y divide-line rounded-2xl border border-line bg-white">{log.slice(1).map((e) => <li key={e.at} className="flex items-center gap-3 px-4 py-2.5 text-sm"><span className={clsx('size-2 rounded-full', e.tone === 'success' ? 'bg-emerald-500' : e.tone === 'error' ? 'bg-red-500' : 'bg-amber-500')} /><span className="min-w-0 flex-1 truncate font-medium">{e.title}</span><span className="hidden truncate text-xs text-muted sm:block">{e.message}</span><span className="text-xs text-muted">{new Date(e.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></li>)}</ul></div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Expected next</h2>
            <ul className="space-y-1.5">
              {next.map((q) => (
                <li key={q.id}><button onClick={() => scan(q.patient.patientNo, { appointmentId: q.id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface">
                  <Avatar name={q.patient.fullName} className="size-9 text-xs" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{q.patient.fullName}</span><span className="block truncate text-xs text-muted">{fmtTime(q.scheduledAt)} · #{q.tokenNo}{q.doctor?.fullName ? ` · Dr ${q.doctor.fullName.replace(/^Dr\.?\s+/i, '')}` : ''}</span></span>
                  <span className="rounded-lg bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white">Check in</span></button></li>
              ))}
              {next.length === 0 && <li className="py-6 text-center text-sm text-muted">Nobody else is expected.</li>}
            </ul>
          </section>
          <section className="rounded-2xl border border-line bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">Waiting now ({waiting.length})</h2>
            <ul className="space-y-1.5">{waiting.slice(0, 8).map((q) => <li key={q.id} className="flex items-center gap-3 px-2 py-1.5 text-sm"><span className="grid size-7 place-items-center rounded-lg bg-amber-100 text-xs font-bold text-amber-800">#{q.tokenNo}</span><span className="min-w-0 flex-1 truncate font-medium">{q.patient.fullName}</span></li>)}{waiting.length === 0 && <li className="py-3 text-center text-sm text-muted">Nobody is waiting.</li>}</ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
