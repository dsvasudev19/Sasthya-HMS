import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { Kpi } from '../components/charts'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import type { PatientRow } from '../lib/types'

interface Theatre { id: string; name: string }
interface Surgery { id: string; theatreId: string; procedure: string; status: string; scheduledStart: string; scheduledEnd: string; startedAt: string | null; endedAt: string | null; anaesthesia: string | null; outcome: string | null; notes: string | null; patient: { id: string; fullName: string; patientNo: string }; surgeon: string | null; anaesthetist: string | null }
interface Day { theatres: Theatre[]; surgeries: Surgery[] }
interface Util { completed: number; cancelled: number; postponed: number; avgDurationHours: number | null; avgStartDelayMinutes: number | null; onTimeStartPct: number | null; byTheatre: { id: string; name: string; surgeries: number; hoursUsed: number; utilisationPct: number }[] }
const TONE: Record<string, string> = { SCHEDULED: 'border-sky-300 bg-sky-50', IN_PROGRESS: 'border-amber-400 bg-amber-50', COMPLETED: 'border-emerald-300 bg-emerald-50', CANCELLED: 'border-slate-300 bg-slate-100 text-slate-500 line-through', POSTPONED: 'border-slate-300 bg-slate-100' }
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
const ymd = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const addD = (s: string, n: number) => ymd(new Date(new Date(`${s}T00:00:00`).getTime() + n * 86_400_000))

function Book({ date, theatres, onClose }: { date: string; theatres: Theatre[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [f, setF] = useState({ theatreId: theatres[0]?.id ?? '', procedure: '', surgeonId: '', anaesthetistId: '', start: '09:00', end: '11:00', notes: '' })
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => api<{ id: string; name: string | null }[]>('/doctors') })
  const book = useMutation({
    mutationFn: () => api('/ot/surgeries', { method: 'POST', body: JSON.stringify({ patientId: patient!.id, theatreId: f.theatreId, procedure: f.procedure, surgeonId: f.surgeonId, anaesthetistId: f.anaesthetistId || undefined, start: new Date(`${date}T${f.start}:00`).toISOString(), end: new Date(`${date}T${f.end}:00`).toISOString(), notes: f.notes || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ot'] }); onClose() },
  })
  const opts = doctors.map((d) => ({ value: d.id, label: d.name ?? 'Doctor' }))
  return (
    <Modal title="Book a surgery" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus /></Field>
        <Field label="Procedure"><input className={inputCls} value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })} placeholder="Laparoscopic cholecystectomy" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Theatre"><Select value={f.theatreId} onChange={(theatreId) => setF({ ...f, theatreId })} options={theatres.map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="From"><input type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field><Field label="To"><input type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field></div>
          <Field label="Surgeon"><Select value={f.surgeonId} onChange={(surgeonId) => setF({ ...f, surgeonId })} placeholder="Choose" options={opts} /></Field>
          <Field label="Anaesthetist"><Select value={f.anaesthetistId} onChange={(anaesthetistId) => setF({ ...f, anaesthetistId })} placeholder="Optional" options={[{ value: '', label: 'None yet' }, ...opts]} /></Field>
        </div>
        {book.error && <p className="text-sm text-red-600">{(book.error as Error).message}</p>}
        <Button className="w-full" disabled={!patient || !f.theatreId || !f.surgeonId || f.procedure.trim().length < 3 || book.isPending} onClick={() => book.mutate()}>Book</Button>
      </div>
    </Modal>
  )
}

function SurgeryModal({ s, onClose }: { s: Surgery; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [text, setText] = useState('')
  const [anaesthesia, setAnaesthesia] = useState(s.anaesthesia ?? '')
  const act = useMutation({ mutationFn: (action: string) => api(`/ot/surgeries/${s.id}/act`, { method: 'POST', body: JSON.stringify({ action, anaesthesia: anaesthesia || undefined, ...(action === 'complete' ? { outcome: text } : { notes: text || undefined }) }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ot'] }); onClose() } })
  const open = ['SCHEDULED', 'POSTPONED'].includes(s.status)
  return (
    <Modal title={s.procedure} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p><span className="font-semibold">{s.patient.fullName}</span> · {s.patient.patientNo}<br /><span className="text-muted">{hm(s.scheduledStart)} to {hm(s.scheduledEnd)} · Surgeon {s.surgeon}{s.anaesthetist ? ` · Anaesthetist ${s.anaesthetist}` : ''}</span></p>
        {s.outcome && <p className="rounded-xl bg-surface p-3">{s.outcome}</p>}
        {s.notes && <p className="whitespace-pre-wrap text-xs text-muted">{s.notes}</p>}
        {can('ot:write') && (open || s.status === 'IN_PROGRESS') && (
          <div className="space-y-3 rounded-2xl p-4 ring-1 ring-line">
            <Field label="Anaesthesia"><input className={inputCls} value={anaesthesia} onChange={(e) => setAnaesthesia(e.target.value)} placeholder="General, spinal, local" /></Field>
            <Field label={s.status === 'IN_PROGRESS' ? 'Outcome (needed to complete)' : 'Reason (needed to cancel or postpone)'}><textarea className={inputCls} rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>
            {act.error && <p className="text-red-600">{(act.error as Error).message}</p>}
            <div className="flex flex-wrap gap-2">
              {s.status === 'SCHEDULED' && <Button onClick={() => act.mutate('start')}>Start surgery</Button>}
              {s.status === 'IN_PROGRESS' && <Button disabled={!text.trim()} onClick={() => act.mutate('complete')}>Complete</Button>}
              {open && <><Button variant="ghost" disabled={!text.trim()} onClick={() => act.mutate('postpone')}>Postpone</Button><Button variant="ghost" disabled={!text.trim()} onClick={() => act.mutate('cancel')}>Cancel</Button></>}
            </div>
          </div>)}
      </div>
    </Modal>
  )
}

export default function Theatre() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [date, setDate] = useState(ymd(new Date()))
  const [booking, setBooking] = useState(false)
  const [open, setOpen] = useState<Surgery | null>(null)
  const [name, setName] = useState('')
  const { data: d } = useQuery({ queryKey: ['ot', 'day', date], queryFn: () => api<Day>(`/ot/schedule?date=${date}`), refetchInterval: 30_000 })
  const { data: u } = useQuery({ queryKey: ['ot', 'util'], queryFn: () => api<Util>('/ot/utilisation') })
  const add = useMutation({ mutationFn: () => api('/ot/theatres', { method: 'POST', body: JSON.stringify({ name }) }), onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['ot'] }) } })
  if (!d) return <p className="py-16 text-center text-sm text-muted">Loading…</p>
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Operation theatres</h1><p className="text-sm text-muted">A booking that clashes on theatre, surgeon or anaesthetist is refused.</p></div>
        <div className="flex items-center gap-1"><button aria-label="Previous day" className="rounded-full p-2 hover:bg-surface" onClick={() => setDate(addD(date, -1))}><ChevronLeft size={18} /></button><input type="date" className={`${inputCls} !w-40`} value={date} onChange={(e) => setDate(e.target.value)} /><button aria-label="Next day" className="rounded-full p-2 hover:bg-surface" onClick={() => setDate(addD(date, 1))}><ChevronRight size={18} /></button></div>
        {can('ot:write') && <Button onClick={() => setBooking(true)} disabled={d.theatres.length === 0}><Plus size={16} /> Book surgery</Button>}
      </div>
      {u && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Surgeries, 30 days" value={u.completed} sub={`${u.cancelled} cancelled · ${u.postponed} postponed`} /><Kpi label="Average duration" value={u.avgDurationHours !== null ? `${u.avgDurationHours} h` : '-'} /><Kpi label="Started on time" value={u.onTimeStartPct !== null ? `${u.onTimeStartPct}%` : '-'} sub={u.avgStartDelayMinutes !== null ? `${u.avgStartDelayMinutes} min late on average` : undefined} tone={u.onTimeStartPct !== null && u.onTimeStartPct < 60 ? 'warn' : 'plain'} /><Kpi label="Busiest theatre" value={u.byTheatre.length ? `${Math.max(...u.byTheatre.map((t) => t.utilisationPct))}%` : '-'} sub="of a 10-hour day" /></div>}
      {d.theatres.length === 0 ? (
        <div className="max-w-md space-y-3 rounded-2xl bg-surface p-6 ring-1 ring-line"><p className="font-semibold">No theatres yet</p>{can('ot:manage') ? <div className="flex gap-2"><input className={inputCls} placeholder="OT 1" value={name} onChange={(e) => setName(e.target.value)} /><Button disabled={name.trim().length < 2} onClick={() => add.mutate()}>Add</Button></div> : <p className="text-sm text-muted">Ask an administrator to add the theatres.</p>}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {d.theatres.map((t) => (
            <section key={t.id} className="rounded-2xl p-4 ring-1 ring-line">
              <h2 className="mb-3 font-semibold">{t.name}</h2>
              <ul className="space-y-2">{d.surgeries.filter((s) => s.theatreId === t.id).map((s) => (
                <li key={s.id}><button onClick={() => setOpen(s)} className={clsx('w-full rounded-xl border p-3 text-left text-sm', TONE[s.status])}><span className="flex justify-between font-semibold"><span>{hm(s.scheduledStart)}-{hm(s.scheduledEnd)}</span><span className="text-[10px] uppercase">{s.status.replace('_', ' ').toLowerCase()}</span></span><span className="block truncate">{s.procedure}</span><span className="block text-xs text-muted">{s.patient.fullName} · {s.surgeon}</span></button></li>))}
                {d.surgeries.filter((s) => s.theatreId === t.id).length === 0 && <li className="py-4 text-center text-sm text-muted">Free all day</li>}</ul>
            </section>))}
          {can('ot:manage') && <section className="flex items-center gap-2 rounded-2xl p-4 ring-1 ring-dashed ring-line"><input className={inputCls} placeholder="Add a theatre" value={name} onChange={(e) => setName(e.target.value)} /><Button variant="ghost" disabled={name.trim().length < 2} onClick={() => add.mutate()}>Add</Button></section>}
        </div>)}
      {booking && <Book date={date} theatres={d.theatres} onClose={() => setBooking(false)} />}
      {open && <SurgeryModal s={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
