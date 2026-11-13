import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, ArrowRight, CalendarPlus, CheckCircle2, ClipboardList, Clock, FlaskConical, IndianRupee, Receipt, Stethoscope, UserPlus, Users, Video, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Kpi, LineChart, Panel } from '../components/charts'
import NewAppointmentModal from '../components/NewAppointmentModal'
import NewInvoiceModal from '../components/NewInvoiceModal'
import NewPatientModal from '../components/NewPatientModal'
import SetupCard from '../components/SetupCard'
import { Avatar, Button } from '../components/ui'
import { api } from '../lib/api'
import { ageOf, fmtTime, rupees } from '../lib/format'

interface Q { id: string; scheduledAt: string; status: 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS'; channel: 'IN_PERSON' | 'TELE'; tokenNo: number | null; reason: string | null; patient: { id: string; fullName: string; patientNo: string; dateOfBirth: string | null }; doctor: { fullName: string | null } | null; tele: { status: string; patientJoinedAt: string | null } | null }
interface Overview {
  date: string
  visits?: { total: number; cancelled: number; completed: number; waiting: number; inConsultation: number; scheduled: number; tele: number; yesterday: number; teleWaiting: number }
  queue?: Q[]
  visitsWeek?: { day: string; n: number }[]
  newPatientsToday?: number
  totalPatients?: number
  money?: { collectedPaise: number; collectedYesterdayPaise: number; billedPaise: number; bills: number; outstandingPaise: number; unpaidBills: number }
  collectionsWeek?: { day: string; paise: number }[]
  attention: Record<string, number>
}
interface Inbox { alerts: { key: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; href: string }[] }
interface TaskRow { id: string; title: string; priority: string; dueAt: string | null; overdue: boolean; patient: { fullName: string } | null }

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round(((a - b) / b) * 100))
const short = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })
const SEV = { critical: 'border-red-200 bg-red-50 text-red-700', warning: 'border-amber-200 bg-amber-50 text-amber-800', info: 'border-line bg-surface text-ink' } as const

function QueueCard({ a, onCheckIn, canCheckIn, clinical }: { a: Q; onCheckIn: (id: string) => void; canCheckIn: boolean; clinical: boolean }) {
  const nav = useNavigate()
  const age = ageOf(a.patient.dateOfBirth)
  const teleWaiting = a.channel === 'TELE' && a.tele?.patientJoinedAt && a.tele.status === 'WAITING'
  return (
    <div className={clsx('rounded-xl border bg-white p-3 shadow-sm', teleWaiting ? 'border-amber-300 ring-2 ring-amber-100' : 'border-line')}>
      <div className="flex items-start gap-2.5">
        <Avatar name={a.patient.fullName} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <Link to={`/patients/${a.patient.id}`} className="block truncate text-sm font-semibold hover:underline">{a.patient.fullName}</Link>
          <p className="truncate text-xs text-muted">{a.patient.patientNo}{age !== null ? ` · ${age} y` : ''} · {fmtTime(a.scheduledAt)}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">#{a.tokenNo}</span>
      </div>
      {a.reason && <p className="mt-2 truncate text-xs text-muted">{a.reason}</p>}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        {a.channel === 'TELE' && <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700"><Video size={10} />Video</span>}
        {teleWaiting && <span className="font-semibold text-amber-700">Waiting in room</span>}
        {a.doctor?.fullName && <span className="truncate">Dr {a.doctor.fullName.replace(/^Dr\.?\s+/i, '')}</span>}
        <span className="ml-auto flex gap-1.5">
          {a.status === 'SCHEDULED' && canCheckIn && a.channel === 'IN_PERSON' && <button onClick={() => onCheckIn(a.id)} className="rounded-md bg-brand-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-800">Check in</button>}
          {clinical && a.status !== 'SCHEDULED' && <button onClick={() => nav(`/consult/${a.id}`)} className="rounded-md bg-brand-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-800">{a.status === 'IN_PROGRESS' ? 'Continue' : 'Open'}</button>}
          {clinical && a.status === 'SCHEDULED' && a.channel === 'TELE' && <button onClick={() => nav(`/consult/${a.id}`)} className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700">Open</button>}
        </span>
      </div>
    </div>
  )
}

export default function Workspace() {
  const { me, can, branch, branchId } = useAuth()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [modal, setModal] = useState<'appt' | 'patient' | 'bill' | null>(null)
  const { data: d, isLoading } = useQuery({ queryKey: ['overview', branchId], queryFn: () => api<Overview>('/analytics/overview'), refetchInterval: 20_000 })
  const inbox = useQuery({ queryKey: ['inbox', branchId], queryFn: () => api<Inbox>('/inbox'), refetchInterval: 60_000 })
  const tasks = useQuery({ queryKey: ['tasks', 'dash'], queryFn: () => api<TaskRow[]>('/tasks?scope=mine&status=OPEN') })
  const checkIn = useMutation({ mutationFn: (id: string) => api(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CHECKED_IN' }) }), onSuccess: () => { for (const k of ['overview', 'today', 'appointments']) qc.invalidateQueries({ queryKey: [k] }) } })
  const finish = useMutation({ mutationFn: (id: string) => api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['overview'] }); qc.invalidateQueries({ queryKey: ['inbox'] }) } })

  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const v = d?.visits, m = d?.money
  const queue = d?.queue ?? []
  const col = (s: Q['status']) => queue.filter((q) => q.status === s)
  const clinical = can('clinical:read')
  const att = d?.attention ?? {}

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight">{hello}, {me?.user.name?.replace(/^Dr\.?\s+/i, '').split(' ')[0]}</h1>
          <p className="text-sm text-muted">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {branchId === 'all' ? 'All branches' : branch?.name ?? me?.tenant.name}</p>
        </div>
        {can('patients:write') && <Button variant="ghost" onClick={() => setModal('patient')}><UserPlus size={16} /> Register patient</Button>}
        {can('billing:write') && <Button variant="ghost" onClick={() => setModal('bill')}><Receipt size={16} /> New bill</Button>}
        {can('appointments:write') && <Button onClick={() => setModal('appt')}><CalendarPlus size={16} /> New appointment</Button>}
      </div>

      <SetupCard />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {v && <Kpi label="Patients today" value={`${v.completed}/${v.total - v.cancelled}`} icon={<Users size={16} />} sub="seen of booked" delta={{ value: pct(v.total - v.cancelled, v.yesterday) }} trend={d?.visitsWeek?.map((x) => x.n)} />}
        {v && <Kpi label="Waiting now" value={v.waiting} icon={<Clock size={16} />} tone={v.waiting > 5 ? 'warn' : 'plain'} sub={`${v.inConsultation} in consultation`} />}
        {m && <Kpi label="Collected today" value={rupees(m.collectedPaise)} icon={<IndianRupee size={16} />} tone="good" delta={{ value: pct(m.collectedPaise, m.collectedYesterdayPaise) }} sub={`${m.bills} bills`} trend={d?.collectionsWeek?.map((x) => x.paise)} />}
        {m && <Kpi label="Outstanding" value={rupees(m.outstandingPaise)} icon={<Wallet size={16} />} tone={m.outstandingPaise > 0 ? 'warn' : 'plain'} sub={`${m.unpaidBills} open bills`} onClick={() => nav('/billing')} />}
        {v && !m && <Kpi label="New patients" value={d?.newPatientsToday ?? 0} icon={<UserPlus size={16} />} sub={`${d?.totalPatients ?? 0} on record`} />}
        {v && v.tele > 0 && <Kpi label="Video visits" value={v.tele} icon={<Video size={16} />} tone={v.teleWaiting ? 'alert' : 'plain'} sub={v.teleWaiting ? `${v.teleWaiting} waiting in the room` : 'booked today'} />}
        {!v && att['lowStock'] !== undefined && <Kpi label="Low stock" value={att['lowStock'] ?? 0} icon={<AlertTriangle size={16} />} tone={att['lowStock'] ? 'warn' : 'plain'} sub="medicines to reorder" />}
        {!v && att['labAwaitingResult'] !== undefined && <Kpi label="Lab awaiting result" value={att['labAwaitingResult'] ?? 0} icon={<FlaskConical size={16} />} sub={`${att['labToRelease'] ?? 0} to release`} />}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {v && (
            <Panel title="Today's queue" action={<Link to="/appointments" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">All appointments <ArrowRight size={12} /></Link>}>
              <div className="grid gap-4 md:grid-cols-3">
                {([['SCHEDULED', 'Scheduled', 'bg-slate-400'], ['CHECKED_IN', 'Waiting', 'bg-amber-400'], ['IN_PROGRESS', 'With the doctor', 'bg-brand-500']] as const).map(([s, label, dot]) => (
                  <div key={s} className="rounded-xl bg-surface p-3">
                    <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted"><span className={clsx('size-2 rounded-full', dot)} />{label}<span className="ml-auto rounded-md bg-white px-1.5 py-0.5 text-[11px] text-ink ring-1 ring-line">{col(s).length}</span></p>
                    <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-0.5">
                      {col(s).map((a) => <QueueCard key={a.id} a={a} canCheckIn={can('appointments:write')} clinical={clinical} onCheckIn={(id) => checkIn.mutate(id)} />)}
                      {col(s).length === 0 && <p className="py-6 text-center text-xs text-muted">{isLoading ? 'Loading…' : 'Nobody here'}</p>}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs text-muted"><CheckCircle2 size={13} className="text-emerald-600" /> {v.completed} seen today{v.cancelled ? ` · ${v.cancelled} cancelled or no-show` : ''}</p>
            </Panel>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            {d?.visitsWeek && <Panel title="Patients, last 7 days"><LineChart labels={d.visitsWeek.map((x) => short(x.day))} series={[{ name: 'Visits', values: d.visitsWeek.map((x) => x.n) }]} height={180} /></Panel>}
            {d?.collectionsWeek && <Panel title="Collections, last 7 days"><LineChart labels={d.collectionsWeek.map((x) => short(x.day))} series={[{ name: 'Collected', values: d.collectionsWeek.map((x) => x.paise / 100), color: '#3b82f6' }]} format={(n) => (n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`)} height={180} /></Panel>}
          </div>
        </div>

        <div className="space-y-6">
          <Panel title="Needs attention" action={inbox.data && <span className="text-xs text-muted">{inbox.data.alerts.length}</span>}>
            <ul className="space-y-2">
              {inbox.data?.alerts.map((a) => (
                <li key={a.key}><Link to={a.href} className={clsx('block rounded-xl border px-3.5 py-2.5 transition hover:shadow-sm', SEV[a.severity])}><p className="text-sm font-semibold">{a.title}</p><p className="text-xs opacity-80">{a.detail}</p></Link></li>
              ))}
              {inbox.data?.alerts.length === 0 && <li className="flex items-center gap-2 py-6 text-sm text-muted"><CheckCircle2 size={16} className="text-emerald-600" />All clear. Nothing needs you right now.</li>}
            </ul>
          </Panel>
          <Panel title="My tasks" action={<Link to="/tasks" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">All <ArrowRight size={12} /></Link>}>
            <ul className="space-y-1.5">
              {tasks.data?.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-surface">
                  <button onClick={() => finish.mutate(t.id)} className="mt-0.5 size-4 shrink-0 rounded border border-slate-300 hover:border-brand-600 hover:bg-brand-50" aria-label={`Mark "${t.title}" done`} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{t.title}</span><span className={clsx('text-xs', t.overdue ? 'font-semibold text-red-600' : 'text-muted')}>{t.patient?.fullName ? `${t.patient.fullName} · ` : ''}{t.dueAt ? (t.overdue ? 'Overdue' : `Due ${new Date(t.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`) : 'No due date'}</span></span>
                  {(t.priority === 'URGENT' || t.priority === 'HIGH') && <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">{t.priority}</span>}
                </li>
              ))}
              {tasks.data?.length === 0 && <li className="py-4 text-center text-sm text-muted"><ClipboardList className="mx-auto mb-1" size={18} />No open tasks.</li>}
            </ul>
          </Panel>
          <Panel title="Quick links">
            <div className="grid grid-cols-2 gap-2">
              {[{ to: '/patients', label: 'Patients', icon: <Users size={15} />, perm: 'patients:read' }, { to: '/consultations', label: 'Video visits', icon: <Video size={15} />, perm: 'appointments:read' }, { to: '/lab', label: 'Laboratory', icon: <FlaskConical size={15} />, perm: 'lab:read' }, { to: '/documents', label: 'Documents', icon: <Stethoscope size={15} />, perm: 'documents:read' }]
                .filter((l) => can(l.perm)).map((l) => <Link key={l.to} to={l.to} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-sm font-medium hover:bg-brand-50">{l.icon}{l.label}</Link>)}
            </div>
          </Panel>
        </div>
      </div>

      {modal === 'appt' && <NewAppointmentModal onClose={() => setModal(null)} />}
      {modal === 'patient' && <NewPatientModal onClose={() => setModal(null)} />}
      {modal === 'bill' && <NewInvoiceModal onClose={() => setModal(null)} onCreated={() => { setModal(null); qc.invalidateQueries({ queryKey: ['overview'] }) }} />}
      {isLoading && <span className="sr-only">Loading</span>}
    </div>
  )
}
