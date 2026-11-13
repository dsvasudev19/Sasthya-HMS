import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, Camera, ClipboardList, FileText, FlaskConical, HeartPulse, Pencil, Pill, Printer, Stethoscope, Trash2, Video } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { api, openFile } from '../lib/api'
import { fmtDate } from '../lib/format'
import DocThumb from './DocThumb'
import DocumentViewer, { KIND_LABEL, type DocRow } from './DocumentViewer'
import ScanModal from './ScanModal'
import { Button, Field, inputCls, Modal } from './ui'

interface Item { name: string; dose?: string | null; frequency?: string | null; durationDays?: number | null; instructions?: string | null; quantity?: number; qty?: number }
type Ev =
  | { type: 'VISIT'; at: string; id: string; completed: boolean; channel: 'IN_PERSON' | 'TELE'; branch: string; doctor: string | null; complaints: string | null; diagnosis: string | null; advice: string | null; vitals: Record<string, number> | null; followUpOn: string | null; rxNo: string | null; items: Item[] }
  | { type: 'LAB'; at: string; id: string; orderNo: string; status: string; items: { testName: string; result: string | null; unit: string | null; refRange: string | null; flag: string | null }[] }
  | { type: 'DISPENSE'; at: string; id: string; items: { name: string; qty: number }[] }
  | ({ type: 'DOCUMENT'; at: string } & DocRow)
interface History {
  patient: { id: string; fullName: string; bloodGroup: string | null; allergies: string[]; chronicConditions: string[]; clinicalNotes: string | null; abhaNumber: string | null; abhaAddress: string | null }
  events: Ev[]
  vitals: ({ at: string } & Record<string, number | string>)[]
  counts: { visits: number; labs: number; documents: number }
}

const FLAG_CLS: Record<string, string> = { LOW: 'text-amber-700', HIGH: 'text-amber-700', CRITICAL_LOW: 'font-bold text-red-600', CRITICAL_HIGH: 'font-bold text-red-600', NORMAL: 'text-brand-700' }
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

function Spark({ label, unit, points, color = '#17915c', second }: { label: string; unit: string; points: { at: string; v: number }[]; color?: string; second?: { at: string; v: number }[] }) {
  if (points.length === 0) return null
  const all = [...points, ...(second ?? [])].map((p) => p.v)
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1
  const W = 240, H = 56
  const x = (i: number, n: number) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - 12) + 6)
  const y = (v: number) => H - 8 - ((v - lo) / span) * (H - 16)
  const path = (pts: { v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i, pts.length).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]!, prev = points[points.length - 2]
  const delta = prev ? last.v - prev.v : 0
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
      <div className="flex items-baseline justify-between"><p className="text-xs font-semibold text-muted">{label}</p>
        <p className="text-sm font-bold">{second ? `${last.v}/${second[second.length - 1]?.v}` : last.v}<span className="ml-1 text-xs font-medium text-muted">{unit}</span>{prev && delta !== 0 && !second && <span className={clsx('ml-2 text-xs font-semibold', delta > 0 ? 'text-amber-700' : 'text-brand-700')}>{delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 10) / 10)}</span>}</p></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-14 w-full" role="img" aria-label={`${label} over time`}>
        <path d={path(points)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {second && <path d={path(second)} fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => <circle key={i} cx={x(i, points.length)} cy={y(p.v)} r="3" fill={color}><title>{`${fmtDate(p.at)}: ${p.v}`}</title></circle>)}
      </svg>
      <p className="text-[10px] text-muted">{fmtDate(points[0]!.at)} to {fmtDate(last.at)}</p>
    </div>
  )
}

function ProfileModal({ h, onClose }: { h: History['patient']; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ bloodGroup: h.bloodGroup ?? '', allergies: h.allergies.join(', '), conditions: h.chronicConditions.join(', '), notes: h.clinicalNotes ?? '', abha: h.abhaNumber ?? '', abhaAddress: h.abhaAddress ?? '' })
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const save = useMutation({
    mutationFn: () => api(`/patients/${h.id}/clinical-profile`, { method: 'PUT', body: JSON.stringify({ bloodGroup: f.bloodGroup || null, allergies: list(f.allergies), chronicConditions: list(f.conditions), clinicalNotes: f.notes.trim() || null, abhaNumber: f.abha.trim() || null, abhaAddress: f.abhaAddress.trim() || null }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient-history'] }); onClose() },
  })
  return (
    <Modal title="Allergies and conditions" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Blood group"><div className="flex flex-wrap gap-1.5">{BLOOD.map((b) => <button key={b} type="button" onClick={() => setF({ ...f, bloodGroup: f.bloodGroup === b ? '' : b })} className={clsx('rounded-full border px-3 py-1.5 text-xs font-semibold', f.bloodGroup === b ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white')}>{b}</button>)}</div></Field>
        <Field label="Allergies (comma separated)"><input className={inputCls} value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} placeholder="Penicillin, peanuts" autoFocus /></Field>
        <Field label="Long-term conditions"><input className={inputCls} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} placeholder="Type 2 diabetes, hypertension" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ABHA number (health ID)"><input className={inputCls} inputMode="numeric" value={f.abha} onChange={(e) => setF({ ...f, abha: e.target.value })} placeholder="12-3456-7890-1234" /></Field>
          <Field label="ABHA address"><input className={inputCls} value={f.abhaAddress} onChange={(e) => setF({ ...f, abhaAddress: e.target.value })} placeholder="name@abdm" /></Field>
        </div>
        <Field label="Notes for every doctor"><textarea className={`${inputCls} min-h-20`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Modal>
  )
}

function Medicines({ items }: { items: Item[] }) {
  if (!items.length) return null
  return <ul className="mt-2 space-y-0.5 text-xs">{items.map((i, k) => <li key={k} className="flex gap-2"><Pill size={12} className="mt-0.5 shrink-0 text-brand-700" /><span><b>{i.name}</b>{[i.dose, i.frequency, i.durationDays ? `${i.durationDays} days` : null].filter(Boolean).length > 0 && <span className="text-muted"> · {[i.dose, i.frequency, i.durationDays ? `${i.durationDays} days` : null].filter(Boolean).join(' · ')}</span>}{i.instructions && <span className="text-muted"> ({i.instructions})</span>}</span></li>)}</ul>
}

/**
 * A patient's entire record on one screen: allergies up top, then every visit, prescription, lab result, medicine and scanned
 * paper in order, with vitals charted across visits. Shown beside every consultation so the doctor never starts from nothing.
 */
export default function PatientRecord({ patientId, excludeAppointmentId, className }: { patientId: string; excludeAppointmentId?: string; className?: string }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'timeline' | 'vitals' | 'files'>('timeline')
  const [viewing, setViewing] = useState<DocRow | null>(null)
  const [scanning, setScanning] = useState(false)
  const [editing, setEditing] = useState(false)
  const { data: h, isLoading, error } = useQuery({ queryKey: ['patient-history', patientId, excludeAppointmentId], queryFn: () => api<History>(`/patients/${patientId}/history${excludeAppointmentId ? `?exclude=${excludeAppointmentId}` : ''}`) })
  const remove = useMutation({ mutationFn: (v: { id: string; reason: string }) => api(`/documents/${v.id}`, { method: 'DELETE', body: JSON.stringify({ reason: v.reason }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['patient-history'] }) })
  if (isLoading) return <p className="py-6 text-sm text-muted">Loading the record…</p>
  if (error || !h) return <p className="py-6 text-sm text-red-600">{(error as Error)?.message ?? 'The record could not be loaded.'}</p>
  const docs = h.events.filter((e): e is Extract<Ev, { type: 'DOCUMENT' }> => e.type === 'DOCUMENT')
  const p = h.patient
  const series = (k: string) => h.vitals.filter((v) => typeof v[k] === 'number').map((v) => ({ at: v.at as string, v: v[k] as number }))
  const canDocs = can('documents:write')

  return (
    <div className={clsx('space-y-4', className)}>
      <section className={clsx('rounded-2xl p-4 ring-1', p.allergies.length ? 'bg-red-50 ring-red-200' : 'bg-surface ring-line')}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className={p.allergies.length ? 'mt-0.5 text-red-600' : 'mt-0.5 text-muted'} />
          <div className="min-w-0 flex-1 text-sm">
            <p className={clsx('font-semibold', p.allergies.length && 'text-red-700')}>{p.allergies.length ? `Allergic to ${p.allergies.join(', ')}` : 'No allergies recorded'}</p>
            <p className="mt-0.5 text-xs text-muted">{[p.bloodGroup && `Blood group ${p.bloodGroup}`, p.chronicConditions.length ? p.chronicConditions.join(', ') : 'No long-term conditions recorded'].filter(Boolean).join(' · ')}</p>
            {p.clinicalNotes && <p className="mt-1 text-xs">{p.clinicalNotes}</p>}
            {p.abhaNumber && <p className="mt-1 text-xs text-muted">ABHA {p.abhaNumber.replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4')}{p.abhaAddress ? ` · ${p.abhaAddress}` : ''}</p>}
          </div>
          {can('clinical:write') && <button onClick={() => setEditing(true)} className="rounded-full p-2 text-muted hover:bg-white hover:text-ink" aria-label="Edit allergies and conditions"><Pencil size={15} /></button>}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['timeline', `History (${h.counts.visits})`], ['vitals', 'Vitals'], ['files', `Files (${docs.length})`]] as const).map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={clsx('rounded-full px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>)}
        </div>
        {canDocs && <Button variant="ghost" className="ml-auto !px-4 !py-2" onClick={() => setScanning(true)}><Camera size={15} /> Scan / upload</Button>}
      </div>

      {tab === 'timeline' && (
        <ol className="space-y-3">
          {h.events.map((e) => {
            if (e.type === 'VISIT') return (
              <li key={`v${e.id}`} className="rounded-2xl p-4 ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-2 text-sm"><Stethoscope size={15} className="text-brand-700" /><b>{fmtDate(e.at)}</b>
                  {e.channel === 'TELE' && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700"><Video size={10} />Video</span>}
                  {!e.completed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Not signed</span>}
                  <span className="text-xs text-muted">{e.doctor ? `Dr ${e.doctor.replace(/^Dr\.?\s+/i, '')}` : ''} · {e.branch}</span>
                  <button onClick={() => void openFile(`/consultations/${e.id}/prescription.pdf`)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline" title="Print or save the prescription"><Printer size={13} />Rx {e.rxNo ?? 'draft'}</button></div>
                {e.complaints && <p className="mt-2 text-xs text-muted">Complaints: {e.complaints}</p>}
                {e.diagnosis && <p className="mt-1 text-sm font-semibold">{e.diagnosis}</p>}
                <Medicines items={e.items} />
                {e.advice && <p className="mt-2 text-xs text-muted">Advice: {e.advice}</p>}
                {e.followUpOn && <p className="mt-1 text-xs font-semibold text-brand-700">Follow-up {fmtDate(e.followUpOn)}</p>}
              </li>
            )
            if (e.type === 'LAB') return (
              <li key={`l${e.id}`} className="rounded-2xl p-4 ring-1 ring-line">
                <div className="flex items-center gap-2 text-sm"><FlaskConical size={15} className="text-sky-700" /><b>{fmtDate(e.at)}</b><span className="text-xs text-muted">Lab {e.orderNo}</span><span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold ring-1 ring-line">{e.status.toLowerCase()}</span></div>
                <ul className="mt-2 space-y-0.5 text-xs">{e.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span>{i.testName}</span><span className={i.flag ? FLAG_CLS[i.flag] : 'text-muted'}>{i.result ?? 'pending'} {i.unit ?? ''}</span></li>)}</ul>
              </li>
            )
            if (e.type === 'DISPENSE') return (
              <li key={`d${e.id}`} className="rounded-2xl bg-surface p-4 text-sm ring-1 ring-line"><div className="flex items-center gap-2"><Pill size={15} className="text-brand-700" /><b>{fmtDate(e.at)}</b><span className="text-xs text-muted">Bought at the pharmacy</span></div><p className="mt-1 text-xs text-muted">{e.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}</p></li>
            )
            return (
              <li key={`f${e.id}`}><button onClick={() => setViewing(e)} className="flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-line hover:bg-brand-50"><FileText size={16} className="text-amber-700" /><span className="min-w-0 flex-1"><b className="block truncate text-sm">{e.title}</b><span className="text-xs text-muted">{fmtDate(e.at)} · {KIND_LABEL[e.kind]}{e.uploadedByName ? ` · ${e.uploadedByName}` : ''}</span></span></button></li>
            )
          })}
          {h.events.length === 0 && <li className="rounded-2xl bg-surface py-10 text-center text-sm text-muted"><ClipboardList className="mx-auto mb-2" size={22} />This is the patient's first visit. Nothing on record yet.</li>}
        </ol>
      )}

      {tab === 'vitals' && (
        h.vitals.length === 0 ? <p className="rounded-2xl bg-surface py-10 text-center text-sm text-muted"><HeartPulse className="mx-auto mb-2" size={22} />Vitals will chart here from the second visit.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Spark label="Blood pressure" unit="mmHg" points={series('bpSystolic')} second={series('bpDiastolic')} />
            <Spark label="Pulse" unit="/min" points={series('pulse')} color="#e11d48" />
            <Spark label="Weight" unit="kg" points={series('weightKg')} color="#0369a1" />
            <Spark label="SpO₂" unit="%" points={series('spo2')} color="#7c3aed" />
            <Spark label="Temperature" unit="°C" points={series('tempC')} color="#d97706" />
          </div>
        )
      )}

      {tab === 'files' && (
        <ul className="grid gap-3">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-2xl p-3 ring-1 ring-line">
              <button onClick={() => setViewing(d)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><DocThumb id={d.id} mimeType={d.mimeType} className="size-14" /><span className="min-w-0"><b className="block truncate text-sm">{d.title}</b><span className="text-xs text-muted">{KIND_LABEL[d.kind]} · {fmtDate(d.at)}</span></span></button>
              {canDocs && <button className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-600" aria-label="Remove document" onClick={() => { const r = prompt(`Hide "${d.title}" from the record? Say why:`); if (r && r.trim().length >= 3) remove.mutate({ id: d.id, reason: r.trim() }) }}><Trash2 size={15} /></button>}
            </li>
          ))}
          {docs.length === 0 && <li className="rounded-2xl bg-surface py-10 text-center text-sm text-muted sm:col-span-2">No files yet. Scan the paper prescription a patient brings, or upload outside reports.</li>}
        </ul>
      )}
      {remove.error && <p className="text-sm text-red-600">{(remove.error as Error).message}</p>}

      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
      {scanning && <ScanModal patientId={patientId} appointmentId={excludeAppointmentId} onClose={() => setScanning(false)} />}
      {editing && <ProfileModal h={p} onClose={() => setEditing(false)} />}
    </div>
  )
}
