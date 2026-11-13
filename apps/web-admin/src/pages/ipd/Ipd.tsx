import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { BedDouble, Plus, Settings2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { Kpi } from '../../components/charts'
import PatientSearch from '../../components/PatientSearch'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'
import type { PatientRow } from '../../lib/types'

interface Bed { id: string; code: string; status: 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'MAINTENANCE'; active: boolean; admission: { id: string; admissionNo: string; patientName: string; patientNo: string; admittedAt: string; expectedDischargeOn: string | null; doctorName: string | null } | null }
interface Ward { id: string; name: string; kind: string; dailyRatePaise: number; active: boolean; beds: Bed[] }
interface Overview { wards: Ward[]; totals: { beds: number; occupied: number; available: number; cleaning: number; maintenance: number; occupancyPct: number }; today: { admissions: number; discharges: number } }
interface Row { id: string; admissionNo: string; status: string; admittedAt: string; dischargedAt: string | null; reason: string; expectedDischargeOn: string | null; patient: { id: string; fullName: string; patientNo: string }; doctorName: string | null; ward: string | null; bedCode: string | null }
interface Doctor { id: string; name: string | null }
const KINDS = [['GENERAL', 'General'], ['SEMI_PRIVATE', 'Semi-private'], ['PRIVATE', 'Private'], ['ICU', 'ICU'], ['NICU', 'NICU'], ['MATERNITY', 'Maternity'], ['EMERGENCY', 'Emergency'], ['DAY_CARE', 'Day care']] as const
const TONE = { AVAILABLE: 'border-brand-300 bg-brand-50', OCCUPIED: 'border-sky-300 bg-sky-50', CLEANING: 'border-amber-300 bg-amber-50', MAINTENANCE: 'border-slate-300 bg-slate-100 text-slate-500' } as const
const days = (iso: string) => Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86_400_000))

function AdmitModal({ bed, wards, onClose }: { bed?: Bed; wards: Ward[]; onClose: () => void }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [bedId, setBedId] = useState(bed?.id ?? '')
  const [doctorId, setDoctorId] = useState('')
  const [reason, setReason] = useState('')
  const [dx, setDx] = useState('')
  const [expected, setExpected] = useState('')
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => api<Doctor[]>('/doctors') })
  const free = wards.filter((w) => w.active).flatMap((w) => w.beds.filter((b) => b.active && b.status === 'AVAILABLE').map((b) => ({ value: b.id, label: `${w.name} · ${b.code} (${rupees(w.dailyRatePaise)}/day)` })))
  const admit = useMutation({
    mutationFn: () => api<{ id: string }>('/ipd/admissions', { method: 'POST', body: JSON.stringify({ patientId: patient!.id, bedId, doctorId, reason, provisionalDiagnosis: dx || undefined, expectedDischargeOn: expected || undefined }) }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['ipd'] }); nav(`/ipd/${a.id}`) },
  })
  const ok = patient && bedId && doctorId && reason.trim().length >= 3
  return (
    <Modal title="Admit a patient" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (ok) admit.mutate() }}>
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bed"><Select value={bedId} onChange={setBedId} placeholder="Choose a free bed" options={free} /></Field>
          <Field label="Consultant"><Select value={doctorId} onChange={setDoctorId} placeholder="Choose a doctor" options={doctors.map((d) => ({ value: d.id, label: d.name ?? 'Doctor' }))} /></Field>
        </div>
        <Field label="Reason for admission"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fever and dehydration" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provisional diagnosis"><input className={inputCls} value={dx} onChange={(e) => setDx(e.target.value)} /></Field>
          <Field label="Expected discharge"><input type="date" className={inputCls} value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        </div>
        {admit.error && <p className="text-sm text-red-600">{(admit.error as Error).message}</p>}
        <Button className="w-full" disabled={!ok || admit.isPending}>Admit</Button>
      </form>
    </Modal>
  )
}

function WardModal({ ward, onClose }: { ward?: Ward; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: ward?.name ?? '', kind: ward?.kind ?? 'GENERAL', rate: ward ? String(ward.dailyRatePaise / 100) : '1500', beds: '6', add: '1' })
  const save = useMutation({
    mutationFn: async () => {
      if (ward) { await api(`/ipd/wards/${ward.id}`, { method: 'PATCH', body: JSON.stringify({ name: f.name, kind: f.kind, dailyRatePaise: Math.round(Number(f.rate) * 100) }) }); if (Number(f.add) > 0 && f.add !== '0') await api(`/ipd/wards/${ward.id}/beds`, { method: 'POST', body: JSON.stringify({ count: Number(f.add) }) }) }
      else await api('/ipd/wards', { method: 'POST', body: JSON.stringify({ name: f.name, kind: f.kind, dailyRatePaise: Math.round(Number(f.rate) * 100), bedCount: Number(f.beds) || 0 }) })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ipd'] }); onClose() },
  })
  return (
    <Modal title={ward ? `Edit ${ward.name}` : 'New ward'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="General ward, ICU, Room 101" autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={KINDS.map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Charge per day (₹)"><input className={inputCls} inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        </div>
        {ward ? <Field label="Add more beds"><input className={`${inputCls} !w-28`} inputMode="numeric" value={f.add} onChange={(e) => setF({ ...f, add: e.target.value.replace(/\D/g, '') })} /></Field>
          : <Field label="Number of beds"><input className={`${inputCls} !w-28`} inputMode="numeric" value={f.beds} onChange={(e) => setF({ ...f, beds: e.target.value.replace(/\D/g, '') })} /></Field>}
        {ward && <p className="text-xs text-muted">A new rate applies to patients admitted or moved from now on. Patients already in a bed keep the rate they were admitted at.</p>}
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{ward ? 'Save' : 'Create ward'}</Button>
      </div>
    </Modal>
  )
}

export default function Ipd() {
  const { can, branchId } = useAuth()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [tab, setTab] = useState<'board' | 'in' | 'out'>('board')
  const [admit, setAdmit] = useState<{ bed?: Bed } | null>(null)
  const [ward, setWard] = useState<{ ward?: Ward } | null>(null)
  const [q, setQ] = useState('')
  const { data: o } = useQuery({ queryKey: ['ipd', 'overview', branchId], queryFn: () => api<Overview>('/ipd/overview'), refetchInterval: 20000 })
  const { data: list = [] } = useQuery({ queryKey: ['ipd', 'list', tab, q, branchId], queryFn: () => api<Row[]>(`/ipd/admissions?${new URLSearchParams({ status: tab === 'out' ? 'DISCHARGED' : 'ADMITTED', ...(q ? { q } : {}) })}`), enabled: tab !== 'board' })
  const free = useMutation({ mutationFn: (id: string) => api(`/ipd/beds/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'AVAILABLE' }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ipd'] }) })
  if (!o) return <p className="py-16 text-center text-sm text-muted">Loading…</p>
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Inpatients</h1><p className="text-sm text-muted">Beds, admissions and discharges.</p></div>
        {can('ipd:manage') && <Button variant="ghost" onClick={() => setWard({})}><Settings2 size={15} /> New ward</Button>}
        {can('ipd:write') && <Button onClick={() => setAdmit({})} disabled={o.totals.available === 0}><Plus size={16} /> Admit patient</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Occupancy" value={`${o.totals.occupancyPct}%`} sub={`${o.totals.occupied} of ${o.totals.beds - o.totals.maintenance} usable beds`} tone={o.totals.occupancyPct >= 90 ? 'alert' : o.totals.occupancyPct >= 75 ? 'warn' : 'plain'} />
        <Kpi label="Free beds" value={o.totals.available} tone="good" />
        <Kpi label="Being cleaned" value={o.totals.cleaning} />
        <Kpi label="Admitted today" value={o.today.admissions} />
        <Kpi label="Discharged today" value={o.today.discharges} />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line">
        {([['board', 'Bed board'], ['in', 'In hospital'], ['out', 'Discharged']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}
      </div>
      {tab === 'board' ? (
        o.wards.length === 0 ? <div className="rounded-2xl bg-surface p-10 text-center ring-1 ring-line"><BedDouble className="mx-auto mb-2 text-muted" /><p className="font-semibold">No wards yet</p><p className="text-sm text-muted">Create a ward and its beds to start admitting patients.</p></div> : (
          <div className="space-y-6">
            <ul className="flex flex-wrap gap-3 text-xs">{([['AVAILABLE', 'Free'], ['OCCUPIED', 'Occupied'], ['CLEANING', 'Cleaning'], ['MAINTENANCE', 'Out of service']] as const).map(([s, l]) => <li key={s} className="flex items-center gap-1.5"><span className={clsx('size-3 rounded border', TONE[s])} />{l}</li>)}</ul>
            {o.wards.filter((w) => w.active).map((w) => (
              <section key={w.id}>
                <div className="mb-2 flex items-center gap-2"><h2 className="font-semibold">{w.name}</h2><span className="text-xs text-muted">{KINDS.find((k) => k[0] === w.kind)?.[1]} · {rupees(w.dailyRatePaise)} a day · {w.beds.filter((b) => b.status === 'OCCUPIED').length}/{w.beds.length} occupied</span>
                  {can('ipd:manage') && <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setWard({ ward: w })}>Edit</button>}</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                  {w.beds.filter((b) => b.active).map((b) => (
                    <button key={b.id} type="button" onClick={() => b.admission ? nav(`/ipd/${b.admission.id}`) : b.status === 'AVAILABLE' ? can('ipd:write') && setAdmit({ bed: b }) : b.status === 'CLEANING' && can('ipd:write') ? free.mutate(b.id) : undefined}
                      title={b.status === 'CLEANING' ? 'Click when the bed is ready' : undefined} className={clsx('min-h-20 rounded-xl border p-3 text-left text-sm transition hover:shadow', TONE[b.status])}>
                      <span className="flex justify-between font-bold">{b.code}{b.status === 'CLEANING' && <span className="text-[10px] font-semibold text-amber-700">tap when ready</span>}</span>
                      {b.admission ? <><span className="block truncate font-medium">{b.admission.patientName}</span><span className="block text-[11px] text-muted">Day {days(b.admission.admittedAt)}{b.admission.expectedDischargeOn && new Date(b.admission.expectedDischargeOn) < new Date(Date.now() - 86_400_000) ? ' · past expected discharge' : ''}</span></> : <span className="text-xs text-muted">{b.status === 'AVAILABLE' ? 'Free' : b.status.toLowerCase()}</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>)
      ) : (
        <div className="space-y-3">
          <input className={`${inputCls} max-w-sm`} placeholder="Search name, patient number or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold"><tr>{['Patient', 'Admission', 'Bed', 'Consultant', tab === 'in' ? 'Day' : 'Discharged', 'Reason'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{list.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface/60" onClick={() => nav(`/ipd/${r.id}`)}>
                  <td className="px-4 py-3 font-semibold">{r.patient.fullName}<div className="text-xs font-normal text-muted">{r.patient.patientNo}</div></td>
                  <td className="px-4 py-3 text-muted">{r.admissionNo}<div className="text-xs">{fmtDate(r.admittedAt)}</div></td>
                  <td className="px-4 py-3">{r.ward ? `${r.ward} · ${r.bedCode}` : '-'}</td><td className="px-4 py-3 text-muted">{r.doctorName ?? '-'}</td>
                  <td className="px-4 py-3">{tab === 'in' ? `Day ${days(r.admittedAt)}` : fmtDate(r.dischargedAt)}</td><td className="max-w-56 truncate px-4 py-3 text-muted">{r.reason}</td>
                </tr>))}</tbody>
            </table>
            {list.length === 0 && <p className="py-10 text-center text-sm text-muted">{tab === 'in' ? 'Nobody is admitted.' : 'No discharges found.'}</p>}
          </div>
        </div>
      )}
      {admit && <AdmitModal bed={admit.bed} wards={o.wards} onClose={() => setAdmit(null)} />}
      {ward && <WardModal ward={ward.ward} onClose={() => setWard(null)} />}
    </div>
  )
}
