import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BedDouble, CheckCircle2, ChevronRight, HeartPulse, Siren, UserCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Kpi } from '../components/charts'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import { ER_INTERVENTION_PRESETS } from '../lib/ipdTemplates'
import { rupees } from '../lib/format'
import type { PatientRow } from '../lib/types'

interface Visit {
  id: string
  arrivalNo: string
  patientLabel: string
  patientId: string | null
  complaint: string
  triage: number
  arrivalMode: string
  status: string
  vitals: Record<string, number> | null
  arrivedAt: string
  doctorName: string | null
  waitMinutes: number
  breached: boolean
  notes: string | null
  patient: { id: string; fullName: string; patientNo: string; allergies: string[] } | null
}

interface Board {
  visits: Visit[]
  stats: {
    waiting: number
    inTreatment: number
    observation: number
    breaches: number
    arrivalsToday: number
    medianDoorToDoctorMinutes: number | null
    lwbsToday: number
  }
  targets: Record<number, number>
}

interface Ward {
  id: string
  name: string
  dailyRatePaise: number
  active: boolean
  beds: { id: string; code: string; status: string; active: boolean }[]
}

interface Doctor {
  id: string
  name: string | null
}

const LEVEL = {
  1: ['Resuscitation', 'bg-red-600 text-white border-red-700 animate-pulse'],
  2: ['Emergent', 'bg-orange-500 text-white border-orange-600'],
  3: ['Urgent', 'bg-amber-400 text-amber-950 border-amber-500'],
  4: ['Less urgent', 'bg-sky-500 text-white border-sky-600'],
  5: ['Non-urgent', 'bg-slate-400 text-white border-slate-500'],
} as Record<number, [string, string]>

const VITALS = [
  ['pulse', 'Pulse', '/min'],
  ['systolic', 'BP sys', 'mmHg'],
  ['diastolic', 'BP dia', 'mmHg'],
  ['spo2', 'SpO₂', '%'],
  ['respRate', 'Resp', '/min'],
  ['temperatureC', 'Temp', '°C'],
  ['gcs', 'GCS', '/15'],
] as const

function RegisterModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [f, setF] = useState({ label: '', complaint: '', triage: 3, mode: 'WALK_IN' })
  const [v, setV] = useState<Record<string, string>>({})
  const reg = useMutation({
    mutationFn: () =>
      api('/er/visits', {
        method: 'POST',
        body: JSON.stringify({
          patientId: patient?.id,
          patientLabel: patient ? undefined : f.label,
          complaint: f.complaint,
          triage: f.triage,
          arrivalMode: f.mode,
          vitals: Object.fromEntries(Object.entries(v).filter(([, x]) => x).map(([k, x]) => [k, Number(x)])),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['er'] })
      onClose()
    },
  })

  return (
    <Modal title="Register Emergency Arrival" onClose={onClose} size="lg">
      <div className="space-y-4">
        <Field label="Known Patient (or leave empty for unidentified arrival)">
          <PatientSearch value={patient} onChange={setPatient} />
        </Field>
        {!patient && (
          <Field label="Descriptive Identity / Tag">
            <input className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Unknown male, approx 40 years, blue shirt" />
          </Field>
        )}
        <Field label="Presenting Emergency Complaint">
          <input className={inputCls} autoFocus value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} placeholder="e.g. Acute severe retrosternal chest pain, poly-trauma" />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-semibold">Triage Category (Sickest First)</p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setF({ ...f, triage: l })}
                className={clsx(
                  'rounded-2xl p-3 text-center text-xs font-bold border-2 transition',
                  f.triage === l ? `${LEVEL[l]![1]} ring-2 ring-slate-900 shadow-md` : 'bg-surface border-line text-slate-700 hover:bg-slate-100'
                )}
              >
                <span className="block text-xl font-black">{l}</span>
                {LEVEL[l]![0]}
              </button>
            ))}
          </div>
        </div>
        <Field label="Mode of Arrival">
          <Select
            value={f.mode}
            onChange={(mode) => setF({ ...f, mode })}
            options={[
              { value: 'WALK_IN', label: 'Walk-in' },
              { value: 'AMBULANCE', label: 'Ambulance / EMS' },
              { value: 'POLICE', label: 'Brought by Police' },
              { value: 'REFERRED', label: 'Referred from another hospital' },
            ]}
          />
        </Field>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted uppercase">Initial Triage Vitals</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {VITALS.map(([k, l, u]) => (
              <label key={k} className="text-[11px] font-semibold text-muted">
                {l} <span className="opacity-60">({u})</span>
                <input
                  className={`${inputCls} mt-1 !px-2 !py-2 text-center text-sm font-bold`}
                  inputMode="decimal"
                  value={v[k] ?? ''}
                  onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </label>
            ))}
          </div>
        </div>
        {reg.error && <p className="text-sm text-red-600">{(reg.error as Error).message}</p>}
        <Button className="w-full font-bold" disabled={f.complaint.trim().length < 2 || (!patient && f.label.trim().length < 2) || reg.isPending} onClick={() => reg.mutate()}>
          Register & Place in Triage
        </Button>
      </div>
    </Modal>
  )
}

function ErAdmitModal({ v, onClose }: { v: Visit; onClose: () => void }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [patient, setPatient] = useState<PatientRow | null>(
    v.patient ? { id: v.patient.id, fullName: v.patient.fullName, patientNo: v.patient.patientNo, phone: null, dateOfBirth: null, gender: null, createdAt: '' } : null
  )
  const [bedId, setBedId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [provisional, setProvisional] = useState(v.complaint)
  const [expected, setExpected] = useState('')
  const [admittedAdmId, setAdmittedAdmId] = useState<string | null>(null)

  const wardsQuery = useQuery({ queryKey: ['ipd', 'overview-admit'], queryFn: () => api<{ wards: Ward[] }>('/ipd/overview') })
  const doctorsQuery = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') })

  const availableBeds = (wardsQuery.data?.wards ?? [])
    .filter((w) => w.active)
    .flatMap((w) =>
      w.beds
        .filter((b) => b.active && b.status === 'AVAILABLE')
        .map((b) => ({ value: b.id, label: `${w.name} · Bed ${b.code} (${rupees(w.dailyRatePaise)}/day)` }))
    )

  const admitToIpd = useMutation({
    mutationFn: async () => {
      const targetPatientId = patient?.id ?? v.patientId
      if (!targetPatientId) throw new Error('Patient record is required before admission to IPD')
      
      // Step 1: Create IPD Admission
      const adm = await api<{ id: string }>('/ipd/admissions', {
        method: 'POST',
        body: JSON.stringify({
          patientId: targetPatientId,
          bedId,
          doctorId,
          reason: `Admitted from Emergency: ${v.complaint}`,
          provisionalDiagnosis: provisional || undefined,
          expectedDischargeOn: expected || undefined,
        }),
      })

      // Step 2: Close ER visit as ADMITTED linking the admission
      await api(`/er/visits/${v.id}/act`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'admit',
          admissionId: adm.id,
          notes: `Transferred and admitted to Inpatient Bed`,
        }),
      })

      return adm
    },
    onSuccess: (adm) => {
      qc.invalidateQueries({ queryKey: ['er'] })
      qc.invalidateQueries({ queryKey: ['ipd'] })
      setAdmittedAdmId(adm.id)
    },
  })

  if (admittedAdmId) {
    return (
      <Modal title="Patient Admitted to Inpatient Ward" onClose={onClose}>
        <div className="space-y-4 text-center py-2">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 size={32} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-ink">{patient?.fullName ?? v.patientLabel}</h3>
            <p className="text-sm text-muted mt-1">Successfully transferred from ER and admitted to the selected bed.</p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1 font-bold" onClick={() => nav(`/ipd/${admittedAdmId}`)}>
              Open Inpatient Care Chart <ChevronRight size={16} />
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Back to ER Board
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  const ok = (patient?.id || v.patientId) && bedId && doctorId && provisional.trim().length >= 3

  return (
    <Modal title={`Admit ${v.patientLabel} to Inpatient Ward`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {!v.patientId && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">⚠️ Link Registered Patient Record</p>
            <p className="text-xs text-amber-800 mt-0.5 mb-2">This emergency arrival was registered without an official patient file. Link or search their patient profile before admitting:</p>
            <PatientSearch value={patient} onChange={setPatient} />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target Bed & Ward">
            <Select value={bedId} onChange={setBedId} placeholder="Select an available bed" options={availableBeds} />
          </Field>
          <Field label="Attending Consultant Doctor">
            <Select value={doctorId} onChange={setDoctorId} placeholder="Select doctor" options={(doctorsQuery.data ?? []).map((d) => ({ value: d.id, label: d.name ?? 'Doctor' }))} />
          </Field>
        </div>

        <Field label="Provisional Inpatient Diagnosis">
          <input className={inputCls} value={provisional} onChange={(e) => setProvisional(e.target.value)} placeholder="e.g. Acute coronary syndrome, Intracranial hemorrhage" />
        </Field>

        <Field label="Expected Discharge Date (Optional)">
          <input type="date" className={inputCls} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>

        {admitToIpd.error && <p className="text-sm text-red-600">{(admitToIpd.error as Error).message}</p>}

        <Button className="w-full font-bold" disabled={!ok || admitToIpd.isPending} onClick={() => admitToIpd.mutate()}>
          {admitToIpd.isPending ? 'Admitting to Bed...' : 'Confirm Admission to Ward'}
        </Button>
      </div>
    </Modal>
  )
}

function ErTreatmentModal({ v, onClose }: { v: Visit; onClose: () => void }) {
  const qc = useQueryClient()
  const [noteText, setNoteText] = useState(v.notes ?? '')
  const [vitals, setVitals] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(v.vitals ?? {}).map(([k, val]) => [k, String(val)]))
  )
  const [triage, setTriage] = useState(v.triage)

  const save = useMutation({
    mutationFn: () =>
      api(`/er/visits/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          triage,
          notes: noteText.trim() || undefined,
          vitals: Object.fromEntries(Object.entries(vitals).filter(([, x]) => x).map(([k, x]) => [k, Number(x)])),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['er'] })
      onClose()
    },
  })

  return (
    <Modal title={`Treatment Log & Vitals: ${v.patientLabel}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-semibold text-muted uppercase">Quick Clinical Interventions</p>
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 border border-line rounded-xl bg-surface">
            {ER_INTERVENTION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setNoteText((cur) => (cur ? `${cur}\n• ${preset}` : `• ${preset}`))}
                className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-left text-slate-700 hover:border-brand-500 hover:bg-brand-50 transition"
              >
                + {preset}
              </button>
            ))}
          </div>
        </div>

        <Field label="Clinical Interventions & Notes">
          <textarea
            className={`${inputCls} min-h-24`}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Record procedures, emergency medications administered, monitoring findings..."
          />
        </Field>

        <div>
          <p className="mb-1 text-xs font-semibold text-muted uppercase">Updated Emergency Vitals</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {VITALS.map(([k, l, u]) => (
              <label key={k} className="text-[11px] font-semibold text-muted">
                {l} <span className="opacity-60">({u})</span>
                <input
                  className={`${inputCls} mt-1 !px-2 !py-2 text-center text-sm font-bold`}
                  inputMode="decimal"
                  value={vitals[k] ?? ''}
                  onChange={(e) => setVitals({ ...vitals, [k]: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-muted uppercase">Triage Category</p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setTriage(l)}
                className={clsx(
                  'rounded-xl p-2 text-center text-xs font-bold border transition',
                  triage === l ? `${LEVEL[l]![1]} ring-2 ring-slate-900 shadow-sm` : 'bg-surface border-line text-slate-700 hover:bg-slate-100'
                )}
              >
                <span className="block text-base font-black">{l}</span>
                {LEVEL[l]![0]}
              </button>
            ))}
          </div>
        </div>

        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}

        <Button className="w-full font-bold" disabled={save.isPending} onClick={() => save.mutate()}>
          Save Treatment Log & Vitals
        </Button>
      </div>
    </Modal>
  )
}

function ErIdentifyModal({ v, onClose }: { v: Visit; onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const link = useMutation({
    mutationFn: () =>
      api(`/er/visits/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ patientId: patient!.id }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['er'] })
      onClose()
    },
  })

  return (
    <Modal title={`Identify Patient: ${v.patientLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-muted">Search for this patient's registered hospital record to link their emergency arrival:</p>
        <Field label="Select Patient Profile">
          <PatientSearch value={patient} onChange={setPatient} autoFocus />
        </Field>
        {link.error && <p className="text-sm text-red-600">{(link.error as Error).message}</p>}
        <Button className="w-full font-bold" disabled={!patient || link.isPending} onClick={() => link.mutate()}>
          Link Patient File
        </Button>
      </div>
    </Modal>
  )
}

export default function Emergency() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [reg, setReg] = useState(false)
  const [admittingVisit, setAdmittingVisit] = useState<Visit | null>(null)
  const [treatingVisit, setTreatingVisit] = useState<Visit | null>(null)
  const [identifyingVisit, setIdentifyingVisit] = useState<Visit | null>(null)

  const { data: b } = useQuery<Board>({
    queryKey: ['er', 'board'],
    queryFn: () => api<Board>('/er/board'),
    refetchInterval: 10_000,
  })

  const act = useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: string; notes?: string }) =>
      api(`/er/visits/${id}/act`, { method: 'POST', body: JSON.stringify({ action, notes }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['er'] }),
    onError: (e) => alert((e as Error).message),
  })

  if (!b) return <p className="py-16 text-center text-sm text-muted">Loading Emergency Department...</p>
  const w = can('er:write')

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight">Emergency Department</h1>
          <p className="text-sm text-muted">Triage priority: sickest first. Auto-updates every 10 seconds.</p>
        </div>
        {w && (
          <Button onClick={() => setReg(true)} className="bg-red-600 hover:bg-red-700 text-white font-bold shadow-sm">
            <Siren size={16} /> New Arrival (Triage)
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Waiting Triage/Dr" value={b.stats.waiting} tone={b.stats.breaches ? 'alert' : 'plain'} sub={b.stats.breaches ? `${b.stats.breaches} breached target` : undefined} />
        <Kpi label="In Treatment" value={b.stats.inTreatment} tone="plain" />
        <Kpi label="Observation" value={b.stats.observation} tone="plain" />
        <Kpi label="Total Arrivals Today" value={b.stats.arrivalsToday} sub={`${b.stats.lwbsToday} left unseen`} />
        <Kpi label="Median Door to Doctor" value={b.stats.medianDoorToDoctorMinutes !== null ? `${b.stats.medianDoorToDoctorMinutes} min` : '-'} tone="good" />
      </div>

      {b.visits.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-surface p-12 text-center">
          <Siren className="size-10 text-muted mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-slate-700">No active emergency cases</p>
          <p className="text-xs text-muted mt-0.5">Emergency department triage bay is currently clear.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {b.visits.map((v) => {
            const isCrit = v.triage === 1
            return (
              <li
                key={v.id}
                className={clsx(
                  'flex flex-wrap items-start gap-4 rounded-3xl p-5 ring-2 transition',
                  isCrit
                    ? 'border-2 border-red-500 bg-red-50/70 ring-red-400 shadow-lg shadow-red-100'
                    : v.breached
                      ? 'bg-amber-50/70 ring-amber-300'
                      : 'bg-white ring-line shadow-xs'
                )}
              >
                <div
                  className={clsx(
                    'grid size-16 shrink-0 place-items-center rounded-2xl text-3xl font-black border-2 shadow-sm',
                    LEVEL[v.triage]![1]
                  )}
                  title={`Level ${v.triage}: ${LEVEL[v.triage]![0]}`}
                >
                  {v.triage}
                </div>

                <div className="min-w-0 flex-1 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-bold text-ink">{v.patientLabel}</p>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono font-semibold text-slate-600">
                      {v.arrivalNo}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-muted">
                      {v.arrivalMode.toLowerCase().replace('_', ' ')}
                    </span>
                    {isCrit && (
                      <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold text-white uppercase tracking-wider animate-pulse">
                        Resuscitation Stat
                      </span>
                    )}
                    {!v.patientId && (
                      <button
                        onClick={() => setIdentifyingVisit(v)}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
                      >
                        <UserCheck size={12} /> Link Patient Record
                      </button>
                    )}
                  </div>

                  <p className="font-medium text-slate-800">{v.complaint}</p>

                  {v.patient && v.patient.allergies.length > 0 && (
                    <p className="font-bold text-red-700 text-xs">
                      ⚠️ ALLERGIC TO: {v.patient.allergies.join(', ')}
                    </p>
                  )}

                  {v.vitals && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-xl bg-surface/80 px-3 py-1.5 text-xs font-medium text-slate-700">
                      {VITALS.filter(([k]) => v.vitals![k] !== undefined).map(([k, l, u]) => (
                        <span key={k}>
                          <span className="text-muted">{l}:</span> <b>{v.vitals![k]}</b> <span className="text-[10px] text-muted">{u}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {v.notes && (
                    <div className="mt-1.5 rounded-xl border border-line bg-surface p-2.5 text-xs whitespace-pre-wrap text-slate-700">
                      <span className="font-semibold text-muted block mb-0.5 uppercase tracking-wide text-[10px]">Treatment & Intervention Notes:</span>
                      {v.notes}
                    </div>
                  )}

                  <p className={clsx('text-xs font-semibold pt-1', v.breached ? 'text-red-600 font-bold' : 'text-muted')}>
                    {v.status === 'WAITING'
                      ? `⏱️ Waiting ${v.waitMinutes} min (Target: ${b.targets[v.triage] === 0 ? 'Immediate' : `${b.targets[v.triage]} min`})`
                      : `Status: ${v.status.replace('_', ' ').toLowerCase()}${v.doctorName ? ` · Doctor: Dr. ${v.doctorName}` : ''}`}
                  </p>
                </div>

                {w && (
                  <div className="flex flex-wrap items-center gap-2 self-start pt-1">
                    {v.status === 'WAITING' && (
                      <>
                        <Button className="bg-brand-700 hover:bg-brand-800 text-white font-bold" onClick={() => act.mutate({ id: v.id, action: 'see' })}>
                          Start Treatment
                        </Button>
                        <Button variant="ghost" onClick={() => confirm('Mark as left without being seen?') && act.mutate({ id: v.id, action: 'lwbs' })}>
                          Left (LWBS)
                        </Button>
                      </>
                    )}

                    {v.status === 'IN_TREATMENT' && (
                      <>
                        <Button variant="ghost" onClick={() => act.mutate({ id: v.id, action: 'observe' })}>
                          Move to Observation
                        </Button>
                      </>
                    )}

                    {/* Quick Treatment / Notes Button for active cases */}
                    {['WAITING', 'IN_TREATMENT', 'OBSERVATION'].includes(v.status) && (
                      <Button variant="ghost" onClick={() => setTreatingVisit(v)}>
                        <HeartPulse size={14} /> Log Vitals/Rx
                      </Button>
                    )}

                    {v.status !== 'WAITING' && (
                      <>
                        {/* 1-Click Direct Inpatient Admission Modal */}
                        <Button className="bg-sky-700 hover:bg-sky-800 text-white font-bold" onClick={() => setAdmittingVisit(v)}>
                          <BedDouble size={14} /> Admit to Ward
                        </Button>
                        <Button variant="ghost" onClick={() => act.mutate({ id: v.id, action: 'discharge' })}>
                          Discharge
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const n = prompt('Referred to which hospital/center?')
                            if (n) act.mutate({ id: v.id, action: 'refer', notes: n })
                          }}
                        >
                          Refer
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {reg && <RegisterModal onClose={() => setReg(false)} />}
      {admittingVisit && <ErAdmitModal v={admittingVisit} onClose={() => setAdmittingVisit(null)} />}
      {treatingVisit && <ErTreatmentModal v={treatingVisit} onClose={() => setTreatingVisit(null)} />}
      {identifyingVisit && <ErIdentifyModal v={identifyingVisit} onClose={() => setIdentifyingVisit(null)} />}
    </div>
  )
}
