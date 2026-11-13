import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Camera, FileDown, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import MedicineSearch from '../components/MedicineSearch'
import PatientRecord from '../components/PatientRecord'
import ScanModal from '../components/ScanModal'
import TeleCall from '../components/TeleCall'
import Select from '../components/Select'
import { Avatar, Button, Field, inputCls, StatusBadge } from '../components/ui'
import { api, openFile } from '../lib/api'
import { ageOf, fmtDate, rupees } from '../lib/format'
import type { ConsultationBundle, LabTest, RxItem, Vitals } from '../lib/types'

const FREQ = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', 'SOS'].map((f) => ({ value: f, label: f === 'SOS' ? 'SOS (when needed)' : `${f} (morning-noon-night)` }))
const doses = (f: string | null | undefined) => (f && f !== 'SOS' ? f.split('-').reduce((a, b) => a + Number(b || 0), 0) : 0)
const num = (v: string) => (v === '' ? undefined : Number(v))
const VITAL_FIELDS: { key: keyof Vitals; label: string; unit: string }[] = [
  { key: 'bpSystolic', label: 'BP high', unit: 'mmHg' }, { key: 'bpDiastolic', label: 'BP low', unit: 'mmHg' }, { key: 'pulse', label: 'Pulse', unit: '/min' },
  { key: 'tempC', label: 'Temp', unit: '°C' }, { key: 'spo2', label: 'SpO₂', unit: '%' }, { key: 'weightKg', label: 'Weight', unit: 'kg' }, { key: 'heightCm', label: 'Height', unit: 'cm' },
]
const FLAG = { NORMAL: 'text-brand-700', LOW: 'text-amber-700', HIGH: 'text-amber-700', CRITICAL_LOW: 'font-bold text-red-600', CRITICAL_HIGH: 'font-bold text-red-600' } as const

export default function Consultation() {
  const { appointmentId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { can } = useAuth()
  const isDoctor = can('clinical:write')
  const canVitals = can('vitals:write')
  const { data, isLoading } = useQuery({ queryKey: ['consult', appointmentId], queryFn: () => api<ConsultationBundle>(`/appointments/${appointmentId}/consultation`) })
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: () => api<LabTest[]>('/lab/tests'), enabled: isDoctor })

  const [vitals, setVitals] = useState<Record<string, string>>({})
  const [complaints, setComplaints] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [advice, setAdvice] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [items, setItems] = useState<RxItem[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (!data || loaded) return
    const c = data.consultation
    setVitals(Object.fromEntries(Object.entries(c?.vitals ?? {}).map(([k, v]) => [k, String(v)])))
    setComplaints(c?.complaints ?? data.appointment.reason ?? '')
    setDiagnosis(c?.diagnosis ?? '')
    setAdvice(c?.advice ?? '')
    setFollowUp(c?.followUpOn?.slice(0, 10) ?? '')
    setItems(c?.items ?? [])
    setLoaded(true)
  }, [data, loaded])

  const locked = !!data?.consultation?.completedAt || !['CHECKED_IN', 'IN_PROGRESS'].includes(data?.appointment.status ?? '')
  const vitalsPayload = useMemo(() => Object.fromEntries(Object.entries(vitals).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])), [vitals])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['consult', appointmentId] }); qc.invalidateQueries({ queryKey: ['today'] }); qc.invalidateQueries({ queryKey: ['appointments'] }) }

  const save = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/consultation`, {
      method: 'PUT',
      body: JSON.stringify({
        complaints, vitals: vitalsPayload, diagnosis, advice, followUpOn: followUp || null,
        items: items.map((i) => ({ medicineId: i.medicineId ?? undefined, name: i.name, dose: i.dose || undefined, frequency: i.frequency || undefined, durationDays: i.durationDays || undefined, instructions: i.instructions || undefined, quantity: i.quantity })),
      }),
    }),
    onSuccess: refresh,
  })
  const saveVitals = useMutation({ mutationFn: () => api(`/appointments/${appointmentId}/vitals`, { method: 'PUT', body: JSON.stringify(vitalsPayload) }), onSuccess: refresh })
  const complete = useMutation({
    mutationFn: async () => { await save.mutateAsync(); return api(`/appointments/${appointmentId}/consultation/complete`, { method: 'POST' }) },
    onSuccess: refresh,
  })
  const printRx = useMutation({
    mutationFn: async () => { const c = await save.mutateAsync() as { id: string }; await openFile(`/consultations/${c.id}/prescription.pdf`) },
  })
  const order = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/lab-orders`, { method: 'POST', body: JSON.stringify({ testIds: picked }) }),
    onSuccess: () => { setPicked([]); refresh() },
  })

  if (isLoading || !data) return <p className="py-10 text-sm text-muted">Loading…</p>
  const { appointment: a, consultation: c } = data
  const p = a.patient
  const age = ageOf(p.dateOfBirth)
  const err = (save.error || complete.error || saveVitals.error || order.error || printRx.error) as Error | null
  const setItem = (i: number, patch: Partial<RxItem>) => setItems((xs) => xs.map((x, j) => {
    if (j !== i) return x
    const next = { ...x, ...patch }
    if ('frequency' in patch || 'durationDays' in patch) { const d = doses(next.frequency) * (next.durationDays ?? 0); if (d > 0) next.quantity = d }
    return next
  }))
  const total = picked.reduce((s, id) => s + (tests.data?.find((t) => t.id === id)?.pricePaise ?? 0), 0)

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink print:hidden"><ArrowLeft size={16} /> Back to workspace</Link>

      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <Avatar name={p.fullName} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight"><Link to={`/patients/${p.id}`} className="hover:underline">{p.fullName}</Link></h1>
          <p className="text-sm text-muted">{p.patientNo}{age !== null ? ` · ${age} y` : ''}{p.gender ? ` · ${p.gender.toLowerCase()}` : ''} · Token #{a.tokenNo} · {a.channel === 'TELE' ? 'Tele-consultation' : 'In person'}</p>
        </div>
        {can('documents:write') && <Button variant="ghost" className="print:hidden" onClick={() => setScanning(true)}><Camera size={16} /> Scan prescription</Button>}
        <StatusBadge status={a.status} />
        {a.feeWaived && <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">Card covered</span>}
      </div>

      {a.channel === 'TELE' && <TeleCall appointmentId={a.id} locked={!!c?.completedAt} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="grid gap-6 lg:grid-cols-2 xl:items-start">
        <div className="space-y-5">
          <section className="rounded-2xl p-5 ring-1 ring-line">
            <h2 className="mb-3 text-sm font-semibold">Vitals</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VITAL_FIELDS.map((f) => (
                <label key={f.key} className="text-xs text-muted">{f.label} <span className="opacity-60">({f.unit})</span>
                  <input className={`${inputCls} mt-1 !py-2`} inputMode="decimal" disabled={locked || !canVitals} value={vitals[f.key] ?? ''} onChange={(e) => setVitals((v) => ({ ...v, [f.key]: e.target.value.replace(/[^\d.]/g, '') }))} />
                </label>
              ))}
            </div>
            {!isDoctor && canVitals && !locked && <Button className="mt-3" variant="ghost" disabled={saveVitals.isPending} onClick={() => saveVitals.mutate()}>Save vitals</Button>}
          </section>

          <section className="space-y-4 rounded-2xl p-5 ring-1 ring-line">
            <Field label="Complaints"><textarea className={`${inputCls} min-h-20`} disabled={locked || !isDoctor} value={complaints} onChange={(e) => setComplaints(e.target.value)} /></Field>
            <Field label="Diagnosis"><textarea className={`${inputCls} min-h-16`} disabled={locked || !isDoctor} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></Field>
            <Field label="Advice"><textarea className={`${inputCls} min-h-16`} disabled={locked || !isDoctor} value={advice} onChange={(e) => setAdvice(e.target.value)} /></Field>
            <Field label="Follow-up on"><input type="date" className={inputCls} disabled={locked || !isDoctor} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>
          </section>

        </div>

        <div className="space-y-5">
          <section id="receipt" className="rounded-2xl p-5 ring-1 ring-line">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Prescription</h2>{(c?.completedAt || (isDoctor && items.length > 0)) && <button disabled={printRx.isPending} onClick={() => (c?.completedAt ? void openFile(`/consultations/${c.id}/prescription.pdf`) : printRx.mutate())} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 print:hidden"><FileDown size={14} /> {c?.completedAt ? `Print Rx ${c.rxNo ?? ''}` : 'Save and preview Rx'}</button>}</div>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className="rounded-xl bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{it.name}</p>{it.medicineId ? <p className="text-xs text-muted">In pharmacy stock</p> : <p className="text-xs text-amber-700">Not in stock list</p>}</div>
                    {!locked && isDoctor && <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="rounded-full p-1 text-muted hover:text-red-600 print:hidden" aria-label="Remove"><Trash2 size={15} /></button>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input className={`${inputCls} !py-2`} placeholder="Dose (1 tab)" disabled={locked} value={it.dose ?? ''} onChange={(e) => setItem(i, { dose: e.target.value })} />
                    <Select value={it.frequency ?? ''} onChange={(v) => setItem(i, { frequency: v })} placeholder="Frequency" options={FREQ} disabled={locked} className="!py-2" />
                    <input className={`${inputCls} !py-2`} placeholder="Days" inputMode="numeric" disabled={locked} value={it.durationDays ?? ''} onChange={(e) => setItem(i, { durationDays: num(e.target.value.replace(/\D/g, '')) })} />
                    <input className={`${inputCls} !py-2`} placeholder="Qty" inputMode="numeric" disabled={locked} value={it.quantity} onChange={(e) => setItem(i, { quantity: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
                  </div>
                  <input className={`${inputCls} mt-2 !py-2`} placeholder="Instructions (after food…)" disabled={locked} value={it.instructions ?? ''} onChange={(e) => setItem(i, { instructions: e.target.value })} />
                </div>
              ))}
              {items.length === 0 && <p className="text-sm text-muted">No medicines yet.</p>}
            </div>
            {!locked && isDoctor && (
              <div className="mt-3 print:hidden">
                <MedicineSearch placeholder="Add medicine" onPick={(m) => setItems((xs) => [...xs, { medicineId: m.id, name: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, quantity: 1 }])} onFreeText={(t) => setItems((xs) => [...xs, { name: t, quantity: 1 }])} />
              </div>
            )}
          </section>

          {isDoctor && (
            <section className="rounded-2xl p-5 ring-1 ring-line print:hidden">
              <h2 className="mb-3 text-sm font-semibold">Lab tests</h2>
              {(c?.labOrders ?? []).map((o) => (
                <div key={o.id} className="mb-3 rounded-xl bg-surface p-3 text-sm">
                  <div className="flex items-center justify-between"><b>{o.orderNo}</b><span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold ring-1 ring-line">{o.status}</span></div>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {o.items.map((i) => <li key={i.id} className="flex justify-between"><span>{i.testName}</span><span className={i.flag ? FLAG[i.flag] : 'text-muted'}>{o.status === 'RELEASED' || i.resultedAt ? `${i.resultValue ?? i.resultText} ${i.unit ?? ''}` : 'pending'}</span></li>)}
                  </ul>
                </div>
              ))}
              {!locked && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {tests.data?.map((t) => {
                      const on = picked.includes(t.id)
                      return <button key={t.id} type="button" onClick={() => setPicked((x) => (on ? x.filter((y) => y !== t.id) : [...x, t.id]))} className={clsx('rounded-full border px-3 py-1.5 text-xs font-semibold transition', on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300')}>{t.name}</button>
                    })}
                  </div>
                  {picked.length > 0 && <Button className="mt-3" variant="ghost" disabled={order.isPending} onClick={() => order.mutate()}><Plus size={16} /> Order {picked.length} test{picked.length > 1 ? 's' : ''} · {rupees(total)}</Button>}
                </>
              )}
            </section>
          )}
        </div>
      </div>

      <aside className="space-y-3 xl:sticky xl:top-0 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto xl:pr-1 print:hidden">
        <h2 className="text-sm font-semibold">Patient record</h2>
        <PatientRecord patientId={p.id} excludeAppointmentId={a.id} />
      </aside>
      </div>

      {scanning && <ScanModal patientId={p.id} appointmentId={a.id} onClose={() => setScanning(false)} />}
      {err && <p className="text-sm text-red-600">{err.message}</p>}
      {isDoctor && !locked && (
        <div className="sticky bottom-0 -mx-1 flex justify-end gap-3 bg-white/90 py-3 backdrop-blur print:hidden">
          <Button variant="ghost" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
          <Button disabled={complete.isPending} onClick={async () => { await complete.mutateAsync(); nav('/') }}>Complete visit</Button>
        </div>
      )}
      {c?.completedAt && <p className="text-sm text-brand-700 print:hidden">Visit completed on {fmtDate(c.completedAt)}. Notes are locked.{c.items.length > 0 && ' The prescription is waiting at the pharmacy counter.'}</p>}
    </div>
  )
}
