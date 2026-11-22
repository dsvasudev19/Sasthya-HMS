import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, Tv, Video } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import AppointmentsTable from '../components/AppointmentsTable'
import NewAppointmentModal from '../components/NewAppointmentModal'
import { Button, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { fmtTime } from '../lib/format'
import type { AppointmentRow } from '../lib/types'

const dateOf = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const shift = (date: string, n: number) => dateOf(new Date(new Date(`${date}T12:00:00`).getTime() + n * 86_400_000))
interface Doc { id: string; name: string | null; hasProfile: boolean; specialty: string | null }
interface Slot { time: string; available: boolean }

const START = 8, END = 20, HOUR_PX = 76
const TONE: Record<string, string> = {
  SCHEDULED: 'border-sky-300 bg-sky-50 text-sky-900', CHECKED_IN: 'border-amber-300 bg-amber-50 text-amber-900', IN_PROGRESS: 'border-brand-500 bg-brand-100 text-brand-900',
  COMPLETED: 'border-slate-200 bg-slate-50 text-slate-500', CANCELLED: 'border-slate-200 bg-white text-slate-400 line-through', NO_SHOW: 'border-slate-200 bg-white text-slate-400',
}
const topOf = (iso: string) => { const d = new Date(iso); return ((d.getHours() + d.getMinutes() / 60) - START) * HOUR_PX }

/** One day, one column per doctor. Free slots are clickable; booked ones show who and what state they are in. */
function DayCalendar({ date, rows, onBook }: { date: string; rows: AppointmentRow[]; onBook: (doctorId: string, at: Date) => void }) {
  const nav = useNavigate()
  const { can, branchId } = useAuth()
  const { data: docs = [] } = useQuery({ queryKey: ['doctors', branchId], queryFn: () => api<Doc[]>('/doctors') })
  const slots = useQuery({
    queryKey: ['day-slots', date, branchId, docs.map((d) => d.id).join()],
    queryFn: async () => Object.fromEntries(await Promise.all(docs.filter((d) => d.hasProfile).map(async (d) => [d.id, await api<Slot[]>(`/doctors/${d.id}/slots?date=${date}`)] as const))),
    enabled: docs.length > 0,
  })
  const cols = useMemo(() => {
    const withVisits = new Set(rows.map((r) => r.doctor?.id).filter(Boolean) as string[])
    const list = docs.filter((d) => d.hasProfile ? (slots.data?.[d.id]?.length ?? 0) > 0 || withVisits.has(d.id) : withVisits.has(d.id))
    const unassigned = rows.some((r) => !r.doctor)
    return [...list.map((d) => ({ id: d.id, name: d.name ?? 'Doctor', sub: d.specialty })), ...(unassigned ? [{ id: '', name: 'Unassigned', sub: 'No doctor chosen' }] : [])]
  }, [docs, rows, slots.data])
  const isToday = date === dateOf(new Date())
  const now = new Date()
  const hours = Array.from({ length: END - START }, (_, i) => START + i)

  if (docs.length > 0 && cols.length === 0) return <div className="rounded-2xl border border-dashed border-line py-16 text-center text-sm text-muted">No doctor has hours or visits on this day. Set weekly schedules under Settings, Doctors.</div>
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 17rem)' }}>
        <div className="grid min-w-fit" style={{ gridTemplateColumns: `56px repeat(${Math.max(cols.length, 1)}, minmax(190px, 1fr))` }}>
          <div className="sticky top-0 z-20 border-b border-line bg-white" />
          {cols.map((c) => <div key={c.id || 'none'} className="sticky top-0 z-20 border-b border-l border-line bg-white px-3 py-2.5"><p className="truncate text-sm font-semibold">{c.name.startsWith('Dr') || !c.id ? c.name : `Dr ${c.name}`}</p><p className="truncate text-xs text-muted">{c.sub ?? ''}</p></div>)}
          <div className="relative" style={{ height: (END - START) * HOUR_PX }}>{hours.map((h) => <div key={h} className="absolute right-2 -translate-y-2 text-[11px] text-muted" style={{ top: (h - START) * HOUR_PX }}>{h > 12 ? h - 12 : h} {h >= 12 ? 'pm' : 'am'}</div>)}</div>
          {cols.map((c) => {
            const mine = rows.filter((r) => (r.doctor?.id ?? '') === c.id)
            const free = (slots.data?.[c.id] ?? []).filter((s) => s.available)
            return (
              <div key={c.id || 'none'} className="relative border-l border-line" style={{ height: (END - START) * HOUR_PX }}>
                {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (h - START) * HOUR_PX }} />)}
                {can('appointments:write') && free.map((s) => (
                  <button key={s.time} onClick={() => onBook(c.id, new Date(s.time))} title={`Book ${fmtTime(s.time)}`} className="group absolute inset-x-1 rounded-md border border-dashed border-brand-200 bg-brand-50/50 text-[10px] font-semibold text-brand-700 opacity-60 transition hover:opacity-100" style={{ top: topOf(s.time) + 1, height: 18 }}>
                    <span className="hidden group-hover:inline">+ {fmtTime(s.time)}</span>
                  </button>
                ))}
                {mine.map((a) => (
                  <button key={a.id} onClick={() => nav(['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(a.status) && can('clinical:read') ? `/consult/${a.id}` : `/patients/${a.patient.id}`)}
                    className={clsx('absolute inset-x-1 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-left shadow-sm transition hover:shadow-md', TONE[a.status])} style={{ top: topOf(a.scheduledAt), height: Math.max(34, HOUR_PX / 4 - 2) }}>
                    <p className="flex items-center gap-1 truncate text-xs font-semibold">{a.channel === 'TELE' && <Video size={11} />}{a.patient.fullName}</p>
                    <p className="truncate text-[11px] opacity-80">{fmtTime(a.scheduledAt)} · #{a.tokenNo}{a.reason ? ` · ${a.reason}` : ''}</p>
                  </button>
                ))}
                {isToday && now.getHours() >= START && now.getHours() < END && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-400" style={{ top: ((now.getHours() + now.getMinutes() / 60) - START) * HOUR_PX }}><span className="absolute -top-1.5 -left-1 size-2.5 rounded-full bg-red-400" /></div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function Appointments() {
  const [date, setDate] = useState(dateOf(new Date()))
  const [view, setView] = useState<'calendar' | 'list'>(() => { try { return localStorage.getItem('hms.appt.view') === 'list' ? 'list' : 'calendar' } catch { return 'calendar' } })
  const [adding, setAdding] = useState<null | { doctorId?: string; at?: Date }>(null)
  const { branchId } = useAuth()
  const { data = [] } = useQuery({ queryKey: ['appointments', date, branchId], queryFn: () => api<AppointmentRow[]>(`/appointments?date=${date}`) })
  const live = data.filter((a) => !['CANCELLED', 'NO_SHOW'].includes(a.status))
  const setV = (v: 'calendar' | 'list') => { setView(v); try { localStorage.setItem('hms.appt.view', v) } catch { /* private mode */ } }
  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Appointments</h1><p className="text-sm text-muted">{new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {live.length} booked{data.length - live.length ? `, ${data.length - live.length} cancelled` : ''}</p></div>
        <div className="flex items-center gap-1">
          <button onClick={() => setDate(shift(date, -1))} className="rounded-xl p-2.5 text-slate-600 ring-1 ring-line hover:bg-surface" aria-label="Previous day"><ChevronLeft size={16} /></button>
          <button onClick={() => setDate(dateOf(new Date()))} className="rounded-xl px-3.5 py-2.5 text-sm font-semibold ring-1 ring-line hover:bg-surface">Today</button>
          <button onClick={() => setDate(shift(date, 1))} className="rounded-xl p-2.5 text-slate-600 ring-1 ring-line hover:bg-surface" aria-label="Next day"><ChevronRight size={16} /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} !w-40 !py-2`} aria-label="Pick a day" />
        </div>
        <div className="flex rounded-xl bg-surface p-1 ring-1 ring-line">
          <button onClick={() => setV('calendar')} className={clsx('rounded-lg p-2', view === 'calendar' ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')} aria-label="Calendar view" title="Calendar"><CalendarDays size={16} /></button>
          <button onClick={() => setV('list')} className={clsx('rounded-lg p-2', view === 'list' ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')} aria-label="List view" title="List"><List size={16} /></button>
        </div>
        <Link to="/queue-display" target="_blank" className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-surface">
          <Tv size={14} className="text-brand-700" /> TV Board
        </Link>
        <Button onClick={() => setAdding({})}><Plus size={16} /> Add appointment</Button>
      </div>
      {view === 'calendar' ? <DayCalendar date={date} rows={data} onBook={(doctorId, at) => setAdding({ doctorId, at })} /> : <AppointmentsTable rows={data} />}
      {adding && <NewAppointmentModal initialDoctorId={adding.doctorId} initialWhen={adding.at} onClose={() => setAdding(null)} />}
    </div>
  )
}
