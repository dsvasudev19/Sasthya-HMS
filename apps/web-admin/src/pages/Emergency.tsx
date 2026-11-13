import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Siren } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { Kpi } from '../components/charts'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import type { PatientRow } from '../lib/types'

interface Visit { id: string; arrivalNo: string; patientLabel: string; patientId: string | null; complaint: string; triage: number; arrivalMode: string; status: string; vitals: Record<string, number> | null; arrivedAt: string; doctorName: string | null; waitMinutes: number; breached: boolean; notes: string | null; patient: { allergies: string[] } | null }
interface Board { visits: Visit[]; stats: { waiting: number; inTreatment: number; observation: number; breaches: number; arrivalsToday: number; medianDoorToDoctorMinutes: number | null; lwbsToday: number }; targets: Record<number, number> }
const LEVEL = { 1: ['Resuscitation', 'bg-red-600 text-white'], 2: ['Emergent', 'bg-orange-500 text-white'], 3: ['Urgent', 'bg-amber-400 text-amber-950'], 4: ['Less urgent', 'bg-sky-500 text-white'], 5: ['Non-urgent', 'bg-slate-400 text-white'] } as Record<number, [string, string]>
const VITALS = [['pulse', 'Pulse'], ['systolic', 'BP sys'], ['diastolic', 'BP dia'], ['spo2', 'SpO₂'], ['respRate', 'Resp'], ['temperatureC', 'Temp'], ['gcs', 'GCS']] as const

function Register({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [f, setF] = useState({ label: '', complaint: '', triage: 3, mode: 'WALK_IN' })
  const [v, setV] = useState<Record<string, string>>({})
  const reg = useMutation({
    mutationFn: () => api('/er/visits', { method: 'POST', body: JSON.stringify({ patientId: patient?.id, patientLabel: patient ? undefined : f.label, complaint: f.complaint, triage: f.triage, arrivalMode: f.mode, vitals: Object.fromEntries(Object.entries(v).filter(([, x]) => x).map(([k, x]) => [k, Number(x)])) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['er'] }); onClose() },
  })
  return (
    <Modal title="Register an emergency arrival" onClose={onClose} size="lg">
      <div className="space-y-4">
        <Field label="Known patient"><PatientSearch value={patient} onChange={setPatient} /></Field>
        {!patient && <Field label="Or describe them"><input className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Unknown male, about 40" /></Field>}
        <Field label="Complaint"><input className={inputCls} autoFocus value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} placeholder="Chest pain, road accident, fever" /></Field>
        <div><p className="mb-1.5 text-sm font-medium">Triage</p><div className="grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((l) => <button key={l} type="button" onClick={() => setF({ ...f, triage: l })} className={clsx('rounded-xl p-2.5 text-center text-xs font-bold ring-2 transition', f.triage === l ? `${LEVEL[l]![1]} ring-ink` : 'bg-surface ring-transparent')}><span className="block text-lg">{l}</span>{LEVEL[l]![0]}</button>)}</div></div>
        <Field label="Arrived"><Select value={f.mode} onChange={(mode) => setF({ ...f, mode })} options={[{ value: 'WALK_IN', label: 'Walked in' }, { value: 'AMBULANCE', label: 'Ambulance' }, { value: 'POLICE', label: 'Brought by police' }, { value: 'REFERRED', label: 'Referred' }]} /></Field>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{VITALS.map(([k, l]) => <label key={k} className="text-[11px] font-semibold text-muted">{l}<input className={`${inputCls} mt-1 !px-2 !py-2 text-center`} inputMode="decimal" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></label>)}</div>
        {reg.error && <p className="text-sm text-red-600">{(reg.error as Error).message}</p>}
        <Button className="w-full" disabled={f.complaint.trim().length < 2 || (!patient && f.label.trim().length < 2) || reg.isPending} onClick={() => reg.mutate()}>Register</Button>
      </div>
    </Modal>
  )
}

export default function Emergency() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [reg, setReg] = useState(false)
  const { data: b } = useQuery({ queryKey: ['er', 'board'], queryFn: () => api<Board>('/er/board'), refetchInterval: 10_000 })
  const act = useMutation({ mutationFn: ({ id, action, notes, admissionId }: { id: string; action: string; notes?: string; admissionId?: string }) => api(`/er/visits/${id}/act`, { method: 'POST', body: JSON.stringify({ action, notes, admissionId }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['er'] }), onError: (e) => alert((e as Error).message) })
  if (!b) return <p className="py-16 text-center text-sm text-muted">Loading…</p>
  const w = can('er:write')
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Emergency</h1><p className="text-sm text-muted">Sickest first. Updates every 10 seconds.</p></div>{w && <Button onClick={() => setReg(true)}><Siren size={16} /> New arrival</Button>}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Kpi label="Waiting" value={b.stats.waiting} tone={b.stats.breaches ? 'alert' : 'plain'} sub={b.stats.breaches ? `${b.stats.breaches} past target` : undefined} /><Kpi label="Being treated" value={b.stats.inTreatment} /><Kpi label="Under observation" value={b.stats.observation} /><Kpi label="Arrived today" value={b.stats.arrivalsToday} sub={`${b.stats.lwbsToday} left unseen`} /><Kpi label="Median to doctor" value={b.stats.medianDoorToDoctorMinutes !== null ? `${b.stats.medianDoorToDoctorMinutes} min` : '-'} /></div>
      {b.visits.length === 0 ? <p className="rounded-2xl bg-surface p-10 text-center text-sm text-muted">Nobody is waiting.</p> : (
        <ul className="space-y-3">{b.visits.map((v) => (
          <li key={v.id} className={clsx('flex flex-wrap items-start gap-4 rounded-2xl p-4 ring-1', v.breached ? 'bg-red-50 ring-red-300' : 'ring-line')}>
            <div className={clsx('grid size-14 shrink-0 place-items-center rounded-2xl text-2xl font-black', LEVEL[v.triage]![1])} title={LEVEL[v.triage]![0]}>{v.triage}</div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-base font-semibold">{v.patientLabel} <span className="text-xs font-normal text-muted">{v.arrivalNo} · {v.arrivalMode.toLowerCase().replace('_', ' ')}</span></p>
              <p>{v.complaint}</p>
              {v.patient && v.patient.allergies.length > 0 && <p className="font-semibold text-red-700">Allergic to {v.patient.allergies.join(', ')}</p>}
              {v.vitals && <p className="text-xs text-muted">{VITALS.filter(([k]) => v.vitals![k] !== undefined).map(([k, l]) => `${l} ${v.vitals![k]}`).join(' · ')}</p>}
              <p className={clsx('mt-1 text-xs font-semibold', v.breached ? 'text-red-600' : 'text-muted')}>{v.status === 'WAITING' ? `Waiting ${v.waitMinutes} min (target ${b.targets[v.triage] === 0 ? 'immediate' : `${b.targets[v.triage]} min`})` : `${v.status.replace('_', ' ').toLowerCase()}${v.doctorName ? ` · Dr ${v.doctorName}` : ''}`}</p>
            </div>
            {w && <div className="flex flex-wrap gap-2">
              {v.status === 'WAITING' && <><Button onClick={() => act.mutate({ id: v.id, action: 'see' })}>Start treatment</Button><Button variant="ghost" onClick={() => confirm('Mark as left without being seen?') && act.mutate({ id: v.id, action: 'lwbs' })}>Left</Button></>}
              {v.status === 'IN_TREATMENT' && <Button variant="ghost" onClick={() => act.mutate({ id: v.id, action: 'observe' })}>Observe</Button>}
              {v.status !== 'WAITING' && <><Button variant="ghost" onClick={async () => { if (!v.patientId) return alert('Register this patient first so they can be admitted'); const a = await api<{ id: string }[]>(`/ipd/admissions?patientId=${v.patientId}`); if (!a[0]) return alert('Admit the patient to a bed under Inpatients first, then come back here'); act.mutate({ id: v.id, action: 'admit', admissionId: a[0].id }) }}>Admitted to ward</Button><Button variant="ghost" onClick={() => act.mutate({ id: v.id, action: 'discharge' })}>Discharge</Button><Button variant="ghost" onClick={() => { const n = prompt('Referred to which hospital?'); if (n) act.mutate({ id: v.id, action: 'refer', notes: n }) }}>Refer</Button></>}
            </div>}
          </li>))}</ul>)}
      {reg && <Register onClose={() => setReg(false)} />}
    </div>
  )
}
