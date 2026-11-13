import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarOff, Clock, Plus, Stethoscope, Trash2 } from 'lucide-react'
import { useState } from 'react'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'

interface Sched { id: string; branchId: string; weekday: number; startMinute: number; endMinute: number }
interface Leave { id: string; fromDate: string; toDate: string; reason: string | null }
interface Doc { id: string; name: string | null; hasProfile: boolean; active: boolean; specialty: string | null; qualification: string | null; registrationNo: string | null; feeInPersonPaise: number | null; feeTelePaise: number | null; slotMinutes: number; schedules: Sched[]; leaves: Leave[] }
interface Branch { id: string; code: string; name: string }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

function ProfileModal({ d, onClose }: { d: Doc; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ displayName: d.name ?? '', specialty: d.specialty ?? '', qualification: d.qualification ?? '', registrationNo: d.registrationNo ?? '', inPerson: d.feeInPersonPaise === null ? '' : String(d.feeInPersonPaise / 100), tele: d.feeTelePaise === null ? '' : String(d.feeTelePaise / 100), slotMinutes: String(d.slotMinutes), active: d.active })
  const save = useMutation({
    mutationFn: () => api(`/doctor-profiles/${d.id}`, { method: 'PUT', body: JSON.stringify({
      displayName: f.displayName, specialty: f.specialty || undefined, qualification: f.qualification || undefined, registrationNo: f.registrationNo || undefined,
      feeInPersonPaise: f.inPerson === '' ? null : Math.round(Number(f.inPerson) * 100), feeTelePaise: f.tele === '' ? null : Math.round(Number(f.tele) * 100), slotMinutes: Number(f.slotMinutes), active: f.active,
    }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-profiles'] }); onClose() },
  })
  return (
    <Modal title={d.hasProfile ? `Profile: ${d.name}` : `Set up ${d.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name shown to patients"><input className={inputCls} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Specialty"><input className={inputCls} value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} placeholder="General medicine" /></Field>
          <Field label="Qualification"><input className={inputCls} value={f.qualification} onChange={(e) => setF({ ...f, qualification: e.target.value })} placeholder="MBBS, MD" /></Field>
        </div>
        <Field label="Registration number"><input className={inputCls} value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="In-person fee (₹)"><input className={inputCls} inputMode="decimal" value={f.inPerson} onChange={(e) => setF({ ...f, inPerson: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Hospital default" /></Field>
          <Field label="Tele fee (₹)"><input className={inputCls} inputMode="decimal" value={f.tele} onChange={(e) => setF({ ...f, tele: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Hospital default" /></Field>
          <Field label="Slot length"><Select value={f.slotMinutes} onChange={(slotMinutes) => setF({ ...f, slotMinutes })} options={['10', '15', '20', '30', '45', '60'].map((v) => ({ value: v, label: `${v} min` }))} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Accepting appointments</label>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={save.isPending || f.displayName.trim().length < 2} onClick={() => save.mutate()}>Save profile</Button>
      </div>
    </Modal>
  )
}

function ScheduleModal({ d, branches, onClose }: { d: Doc; branches: Branch[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [rows, setRows] = useState<{ weekday: number; start: string; end: string }[]>(() => d.schedules.filter((s) => s.branchId === (branches[0]?.id ?? '')).map((s) => ({ weekday: s.weekday, start: hhmm(s.startMinute), end: hhmm(s.endMinute) })))
  const pick = (id: string) => { setBranchId(id); setRows(d.schedules.filter((s) => s.branchId === id).map((s) => ({ weekday: s.weekday, start: hhmm(s.startMinute), end: hhmm(s.endMinute) }))) }
  const save = useMutation({
    mutationFn: () => api(`/doctor-profiles/${d.id}/schedule`, { method: 'PUT', body: JSON.stringify({ branchId, slots: rows.map((r) => ({ weekday: r.weekday, startMinute: mins(r.start), endMinute: mins(r.end) })) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-profiles'] }); onClose() },
  })
  const addDay = (weekday: number) => setRows([...rows, { weekday, start: '09:00', end: '13:00' }])
  return (
    <Modal title={`Weekly schedule: ${d.name}`} onClose={onClose}>
      <div className="space-y-4">
        {branches.length > 1 && <Field label="Branch"><Select value={branchId} onChange={pick} options={branches.map((b) => ({ value: b.id, label: b.name, hint: b.code }))} /></Field>}
        <div className="space-y-2">
          {DAYS.map((name, wd) => {
            const mine = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.weekday === wd)
            return (
              <div key={wd} className="flex items-start gap-3">
                <span className="w-10 pt-3 text-sm font-semibold">{name}</span>
                <div className="flex-1 space-y-1.5">
                  {mine.length === 0 && <p className="pt-3 text-sm text-muted">Off</p>}
                  {mine.map(({ r, i }) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="time" className={`${inputCls} !py-2`} value={r.start} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                      <span className="text-muted">to</span>
                      <input type="time" className={`${inputCls} !py-2`} value={r.end} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                      <button className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-600" aria-label="Remove shift" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
                <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" aria-label={`Add a shift on ${name}`} onClick={() => addDay(wd)}><Plus size={16} /></button>
              </div>
            )
          })}
        </div>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={save.isPending || !branchId} onClick={() => save.mutate()}>Save schedule</Button>
      </div>
    </Modal>
  )
}

function LeaveModal({ d, onClose }: { d: Doc; onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ fromDate: today, toDate: today, reason: '' })
  const refresh = () => qc.invalidateQueries({ queryKey: ['doctor-profiles'] })
  const add = useMutation({ mutationFn: () => api(`/doctor-profiles/${d.id}/leaves`, { method: 'POST', body: JSON.stringify({ ...f, reason: f.reason || undefined }) }), onSuccess: refresh })
  const del = useMutation({ mutationFn: (id: string) => api(`/doctor-leaves/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const current = qc.getQueryData<Doc[]>(['doctor-profiles'])?.find((x) => x.id === d.id)?.leaves ?? d.leaves
  return (
    <Modal title={`Leave: ${d.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          {current.map((l) => <div key={l.id} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-2.5 text-sm"><CalendarOff size={15} className="text-muted" /><span className="flex-1">{fmtDate(l.fromDate)}{l.toDate !== l.fromDate && ` to ${fmtDate(l.toDate)}`}{l.reason && <span className="text-muted"> · {l.reason}</span>}</span><button className="text-muted hover:text-red-600" aria-label="Remove leave" onClick={() => del.mutate(l.id)}><Trash2 size={15} /></button></div>)}
          {current.length === 0 && <p className="text-sm text-muted">No upcoming leave.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className={inputCls} value={f.fromDate} min={today} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></Field>
          <Field label="To"><input type="date" className={inputCls} value={f.toDate} min={f.fromDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>
        </div>
        <Field label="Reason (optional)"><input className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
        <Button className="w-full" disabled={add.isPending} onClick={() => add.mutate()}>Mark as on leave</Button>
      </div>
    </Modal>
  )
}

export default function Doctors() {
  const { data } = useQuery({ queryKey: ['doctor-profiles'], queryFn: () => api<Doc[]>('/doctor-profiles') })
  const { data: br } = useQuery({ queryKey: ['branches-manage'], queryFn: () => api<(Branch & { active: boolean })[]>('/branches/manage') })
  const [modal, setModal] = useState<{ kind: 'profile' | 'schedule' | 'leave'; id: string } | null>(null)
  const branches = (br ?? []).filter((b) => b.active)
  const open = data?.find((d) => d.id === modal?.id)
  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-muted">Everyone whose role can write consultations appears here. Give each doctor a profile, a weekly schedule per branch and any leave, and patients can only book the free slots that remain. Doctors without a schedule can be booked at any time.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.map((d) => (
          <div key={d.id} className="rounded-2xl p-5 ring-1 ring-line">
            <div className="flex items-start gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-brand-100 text-brand-800"><Stethoscope size={20} /></span>
              <div className="min-w-0 flex-1"><p className="font-semibold">{d.name}</p><p className="text-sm text-muted">{[d.specialty, d.qualification].filter(Boolean).join(' · ') || (d.hasProfile ? 'No specialty set' : 'No profile yet')}</p></div>
              {!d.active && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-600">Not booking</span>}
            </div>
            {d.hasProfile && <p className="mt-3 text-xs text-muted">Fee {d.feeInPersonPaise === null ? 'hospital default' : rupees(d.feeInPersonPaise)} · {d.slotMinutes}-minute slots · {d.schedules.length} weekly shifts{d.leaves.length ? ` · ${d.leaves.length} leave` : ''}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="ghost" className="!py-2" onClick={() => setModal({ kind: 'profile', id: d.id })}>{d.hasProfile ? 'Edit profile' : 'Set up profile'}</Button>
              {d.hasProfile && <Button variant="ghost" className="!py-2" onClick={() => setModal({ kind: 'schedule', id: d.id })}><Clock size={14} /> Schedule</Button>}
              {d.hasProfile && <Button variant="ghost" className="!py-2" onClick={() => setModal({ kind: 'leave', id: d.id })}><CalendarOff size={14} /> Leave</Button>}
            </div>
          </div>
        ))}
        {data?.length === 0 && <p className="rounded-2xl bg-surface py-10 text-center text-sm text-muted lg:col-span-2">No one has a role that can see patients yet. Add a doctor from the Team tab.</p>}
      </div>
      {open && modal?.kind === 'profile' && <ProfileModal d={open} onClose={() => setModal(null)} />}
      {open && modal?.kind === 'schedule' && <ScheduleModal d={open} branches={branches} onClose={() => setModal(null)} />}
      {open && modal?.kind === 'leave' && <LeaveModal d={open} onClose={() => setModal(null)} />}
    </div>
  )
}
