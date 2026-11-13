import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarPlus, Video } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import NewAppointmentModal from '../components/NewAppointmentModal'
import { Avatar, Button } from '../components/ui'
import { api } from '../lib/api'
import { fmtTime } from '../lib/format'

interface Row {
  id: string; scheduledAt: string; status: string; canJoin: boolean; reason: string | null
  patient: { id: string; fullName: string; patientNo: string }
  doctor: { id: string; fullName: string | null } | null
  tele: { status: 'WAITING' | 'LIVE' | 'ENDED' | 'MISSED'; patientJoinedAt: string | null } | null
}

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date()
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86_400_000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}

/** The video-visit desk: who is booked, who is already waiting in the room, and a one-click way into the consultation. */
export default function Tele() {
  const nav = useNavigate()
  const { can } = useAuth()
  const [booking, setBooking] = useState(false)
  const { data = [] } = useQuery({ queryKey: ['tele-schedule'], queryFn: () => api<Row[]>('/tele/schedule'), refetchInterval: 8000 })
  const groups = [...new Set(data.map((r) => dayLabel(r.scheduledAt)))].map((label) => ({ label, rows: data.filter((r) => dayLabel(r.scheduledAt) === label) }))
  const waiting = data.filter((r) => r.tele?.patientJoinedAt && r.tele.status === 'WAITING').length
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-3xl font-semibold tracking-tight">Tele-consultations</h1><p className="text-sm text-muted">Video visits for the next seven days. Patients join from the Swasthya app and wait here until you open the room.</p></div>
        {waiting > 0 && <span className="animate-pulse rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-800">{waiting} waiting now</span>}
        {can('appointments:write') && <Button onClick={() => setBooking(true)}><CalendarPlus size={18} /> Book video visit</Button>}
      </div>
      {groups.map((g) => (
        <section key={g.label} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">{g.label}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {g.rows.map((r) => {
              const isWaiting = r.tele?.patientJoinedAt && r.tele.status === 'WAITING'
              const live = r.tele?.status === 'LIVE'
              return (
                <div key={r.id} className={clsx('flex items-center gap-4 rounded-2xl p-4 ring-1', isWaiting ? 'bg-amber-50 ring-amber-300' : live ? 'bg-sky-50 ring-sky-300' : 'ring-line')}>
                  <Avatar name={r.patient.fullName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.patient.fullName} <span className="text-xs font-normal text-muted">{r.patient.patientNo}</span></p>
                    <p className="truncate text-xs text-muted">{fmtTime(r.scheduledAt)}{r.doctor?.fullName ? ` · Dr ${r.doctor.fullName.replace(/^Dr\.?\s+/i, '')}` : ''}{r.reason ? ` · ${r.reason}` : ''}</p>
                    <p className="mt-1 text-xs font-semibold">{live ? <span className="text-sky-700">● Live</span> : isWaiting ? <span className="text-amber-800">Patient is waiting</span> : r.canJoin ? <span className="text-brand-700">Room open</span> : <span className="text-muted">Opens 15 minutes before</span>}</p>
                  </div>
                  <Button className="!py-2.5" variant={isWaiting || live ? 'primary' : 'ghost'} onClick={() => nav(`/consult/${r.id}`)}><Video size={16} /> {live ? 'Back to call' : 'Open'}</Button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {data.length === 0 && <div className="rounded-2xl bg-surface py-16 text-center text-sm text-muted"><Video className="mx-auto mb-3" size={26} />No video visits booked. Choose "Tele-consultation" when you add an appointment.</div>}
      {booking && <NewAppointmentModal initialChannel="TELE" onClose={() => setBooking(false)} />}
    </div>
  )
}
