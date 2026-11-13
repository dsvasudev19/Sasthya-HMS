import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarX2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import type { PatientRow } from '../lib/types'
import PatientSearch from './PatientSearch'
import Select from './Select'
import { Button, Field, inputCls, Modal } from './ui'

interface DoctorOpt { id: string; name: string | null; hasProfile: boolean; specialty: string | null }
interface Slot { time: string; available: boolean }

const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const dateOf = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/**
 * Books an appointment. A doctor who keeps a schedule is booked into one of their free slots (taken, past and on-leave times
 * simply do not appear); anyone else, or staff allowed to override, can type any time.
 */
export default function NewAppointmentModal({ onClose, initialPatient = null, initialChannel = 'IN_PERSON', initialDoctorId = '', initialWhen }: { onClose: () => void; initialPatient?: PatientRow | null; initialChannel?: 'IN_PERSON' | 'TELE'; initialDoctorId?: string; initialWhen?: Date }) {
  const qc = useQueryClient()
  const { can, branchId } = useAuth()
  const [patient, setPatient] = useState<PatientRow | null>(initialPatient)
  const [doctorId, setDoctorId] = useState(initialDoctorId)
  const [date, setDate] = useState(initialWhen ? dateOf(initialWhen) : dateOf(new Date()))
  const [slot, setSlot] = useState<string | null>(initialWhen ? initialWhen.toISOString() : null)
  const [free, setFree] = useState(initialWhen ? `${dateOf(initialWhen)}T${initialWhen.toTimeString().slice(0, 5)}` : localNow())
  const [outside, setOutside] = useState(false)
  const [channel, setChannel] = useState<'IN_PERSON' | 'TELE'>(initialChannel)
  const [reason, setReason] = useState('')

  const doctors = useQuery({ queryKey: ['doctors', branchId], queryFn: () => api<DoctorOpt[]>('/doctors') })
  const doc = doctors.data?.find((d) => d.id === doctorId)
  const scheduled = !!doc?.hasProfile && !outside
  const slots = useQuery({ queryKey: ['slots', doctorId, date, branchId], queryFn: () => api<Slot[]>(`/doctors/${doctorId}/slots?date=${date}`), enabled: scheduled })
  useEffect(() => { if (slot && slots.data && !slots.data.some((s) => s.time === slot && s.available)) setSlot(null) }, [slots.data, slot])

  const when = scheduled ? slot : free ? new Date(free).toISOString() : null
  const create = useMutation({
    mutationFn: () => api('/appointments', { method: 'POST', body: JSON.stringify({ patientId: patient!.id, doctorId: doctorId || undefined, scheduledAt: when, channel, reason: reason || undefined }) }),
    onSuccess: () => { for (const k of ['appointments', 'today', 'patient', 'tele-schedule', 'overview', 'slots']) qc.invalidateQueries({ queryKey: [k] }); onClose() },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); if (patient && when) create.mutate() }
  const groups = (list: Slot[]) => ([['Morning', (h: number) => h < 12], ['Afternoon', (h: number) => h >= 12 && h < 17], ['Evening', (h: number) => h >= 17]] as const).map(([label, f]) => ({ label, items: list.filter((s) => f(new Date(s.time).getHours())) })).filter((g) => g.items.length)

  return (
    <Modal title="Add appointment" onClose={onClose} size={scheduled ? 'lg' : 'md'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus={!initialPatient} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Doctor">
            <Select value={doctorId} onChange={(v) => { setDoctorId(v); setSlot(null) }} placeholder="Any available doctor" options={[{ value: '', label: 'Any available doctor' }, ...(doctors.data ?? []).map((d) => ({ value: d.id, label: d.name ?? 'Doctor', hint: d.specialty ?? (d.hasProfile ? undefined : 'No fixed schedule') }))]} />
          </Field>
          <Field label="Visit type"><Select value={channel} onChange={setChannel} options={[{ value: 'IN_PERSON', label: 'In person' }, { value: 'TELE', label: 'Tele-consultation' }]} /></Field>
        </div>

        {scheduled ? (
          <div className="space-y-3">
            <Field label="Day"><input type="date" className={inputCls} value={date} min={dateOf(new Date())} onChange={(e) => { setDate(e.target.value); setSlot(null) }} /></Field>
            <div>
              <p className="mb-2 text-sm font-medium">Free times {slots.data && <span className="font-normal text-muted">· {slots.data.filter((s) => s.available).length} left</span>}</p>
              {slots.isLoading && <p className="text-sm text-muted">Looking…</p>}
              {slots.data && slots.data.length === 0 && <p className="flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm text-muted"><CalendarX2 size={16} /> Dr {doc?.name?.replace(/^Dr\.?\s+/i, '')} does not see patients on this day (day off, leave, or no hours set here).</p>}
              {slots.data && slots.data.length > 0 && slots.data.every((s) => !s.available) && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Fully booked. Try another day.</p>}
              <div className="space-y-3">
                {groups(slots.data ?? []).map((g) => (
                  <div key={g.label}><p className="mb-1.5 text-xs font-semibold text-muted">{g.label}</p>
                    <div className="flex flex-wrap gap-1.5">{g.items.map((s) => <button type="button" key={s.time} disabled={!s.available} onClick={() => setSlot(s.time)} className={clsx('rounded-lg border px-3 py-1.5 text-sm font-medium transition', slot === s.time ? 'border-brand-700 bg-brand-700 text-white' : s.available ? 'border-line bg-white hover:border-brand-400 hover:bg-brand-50' : 'cursor-not-allowed border-line bg-surface text-slate-300 line-through')}>{hm(s.time)}</button>)}</div></div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Field label="Date and time"><input type="datetime-local" required className={inputCls} value={free} onChange={(e) => setFree(e.target.value)} /></Field>
        )}
        {doc?.hasProfile && can('appointments:override_slot') && <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> Book outside this doctor's schedule</label>}
        <Field label="Reason for visit"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button type="submit" className="w-full" disabled={!patient || !when || create.isPending}>{create.isPending ? 'Saving…' : slot && scheduled ? `Book ${hm(slot)}` : 'Add appointment'}</Button>
      </form>
    </Modal>
  )
}
