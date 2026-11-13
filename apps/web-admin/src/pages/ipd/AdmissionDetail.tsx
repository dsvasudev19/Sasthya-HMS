import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, FileText, HeartPulse, Printer, Repeat2, LogOut, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth'
import PatientRecord from '../../components/PatientRecord'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api, openFile } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'

interface Note { id: string; kind: 'NOTE' | 'VITALS' | 'ROUND' | 'ORDER'; text: string | null; vitals: Record<string, number> | null; createdAt: string; author: string | null }
interface Stay { id: string; ward: string; bed: string; dailyRatePaise: number; fromAt: string; toAt: string | null; days: number; amountPaise: number }
interface Adm {
  id: string; admissionNo: string; status: 'ADMITTED' | 'DISCHARGED' | 'CANCELLED'; admittedAt: string; dischargedAt: string | null; dischargeType: string | null; reason: string; provisionalDiagnosis: string | null; expectedDischargeOn: string | null
  summary: { diagnosis: string } | null; invoiceId: string | null; doctorName: string | null; bed: { id: string; code: string; ward: string } | null; stays: Stay[]; bedChargesPaise: number; notes: Note[]
  patient: { id: string; fullName: string; patientNo: string; gender: string | null; dateOfBirth: string | null; phone: string | null; allergies: string[] }
}
interface Ward { id: string; name: string; dailyRatePaise: number; active: boolean; beds: { id: string; code: string; status: string; active: boolean }[] }
const TYPES = [['RECOVERED', 'Recovered'], ['REFERRED', 'Referred elsewhere'], ['LAMA', 'Left against medical advice'], ['ABSCONDED', 'Absconded'], ['DEATH', 'Death']] as const
const VITALS = [['temperatureC', 'Temp °C', '37.0'], ['pulse', 'Pulse', '80'], ['systolic', 'BP sys', '120'], ['diastolic', 'BP dia', '80'], ['spo2', 'SpO₂ %', '98'], ['respRate', 'Resp', '18'], ['painScore', 'Pain 0-10', '0']] as const
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function VitalsForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [v, setV] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => api(`/ipd/admissions/${id}/notes`, { method: 'POST', body: JSON.stringify({ kind: 'VITALS', vitals: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, Number(x)])) }) }),
    onSuccess: onDone,
  })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{VITALS.map(([k, l, ph]) => <label key={k} className="text-[11px] font-semibold text-muted">{l}<input className={`${inputCls} mt-1 !px-2 !py-2 text-center`} inputMode="decimal" placeholder={ph} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></label>)}</div>
      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <Button disabled={Object.values(v).every((x) => !x) || save.isPending} onClick={() => save.mutate()}>Record vitals</Button>
    </div>
  )
}

function TransferModal({ a, onClose }: { a: Adm; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['ipd', 'overview-pick'], queryFn: () => api<{ wards: Ward[] }>('/ipd/overview') })
  const [bedId, setBedId] = useState('')
  const [reason, setReason] = useState('')
  const go = useMutation({ mutationFn: () => api(`/ipd/admissions/${a.id}/transfer`, { method: 'POST', body: JSON.stringify({ bedId, reason }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ipd'] }); onClose() } })
  const opts = (data?.wards ?? []).filter((w) => w.active).flatMap((w) => w.beds.filter((b) => b.active && b.status === 'AVAILABLE').map((b) => ({ value: b.id, label: `${w.name} · ${b.code} (${rupees(w.dailyRatePaise)}/day)` })))
  return (
    <Modal title="Move to another bed" onClose={onClose}>
      <div className="space-y-4">
        <Field label="New bed"><Select value={bedId} onChange={setBedId} placeholder="Choose a free bed" options={opts} /></Field>
        <Field label="Reason"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Needs ICU monitoring" /></Field>
        {go.error && <p className="text-sm text-red-600">{(go.error as Error).message}</p>}
        <Button className="w-full" disabled={!bedId || reason.trim().length < 3 || go.isPending} onClick={() => go.mutate()}>Move patient</Button>
      </div>
    </Modal>
  )
}

function DischargeModal({ a, onClose }: { a: Adm; onClose: () => void }) {
  const qc = useQueryClient()
  const [type, setType] = useState<string>('RECOVERED')
  const [f, setF] = useState({ diagnosis: a.provisionalDiagnosis ?? '', course: '', treatment: '', condition: '', medicines: '', advice: '', followUpOn: '' })
  const [extras, setExtras] = useState<{ description: string; amount: string }[]>([])
  const [discount, setDiscount] = useState('')
  const [pay, setPay] = useState({ method: 'CASH', amount: '' })
  const [done, setDone] = useState<{ invoiceNo?: string; outstanding: number } | null>(null)
  const extraPaise = extras.reduce((s, e) => s + Math.round(Number(e.amount || 0) * 100), 0)
  const total = a.bedChargesPaise + extraPaise - Math.round(Number(discount || 0) * 100)
  const go = useMutation({
    mutationFn: () => api<{ invoice: { invoiceNo: string } | null; outstandingPaise: number }>(`/ipd/admissions/${a.id}/discharge`, { method: 'POST', body: JSON.stringify({
      type, summary: Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim())),
      extraCharges: extras.filter((e) => e.description.trim() && Number(e.amount) > 0).map((e) => ({ description: e.description, amountPaise: Math.round(Number(e.amount) * 100) })),
      discountPaise: Math.round(Number(discount || 0) * 100), payment: Number(pay.amount) > 0 ? { method: pay.method, amountPaise: Math.round(Number(pay.amount) * 100) } : undefined }) }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['ipd'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); setDone({ invoiceNo: r.invoice?.invoiceNo, outstanding: r.outstandingPaise }) },
  })
  if (done) return (
    <Modal title="Discharged" onClose={onClose}>
      <div className="space-y-3 text-sm"><p className="rounded-xl bg-brand-50 px-4 py-3 font-semibold text-brand-800">{a.patient.fullName} has been discharged.{done.invoiceNo ? ` Bill ${done.invoiceNo} was raised.` : ''}</p>
        {done.outstanding > 0 && <p className="text-amber-700">Unpaid on this patient's account: {rupees(done.outstanding)}.</p>}
        <div className="flex gap-2"><Button className="flex-1" onClick={() => openFile(`/ipd/admissions/${a.id}/summary.pdf`)}><FileText size={15} /> Discharge summary</Button><Button variant="ghost" onClick={onClose}>Close</Button></div></div>
    </Modal>
  )
  const T = (k: keyof typeof f, label: string, rows = 2) => <Field label={label}><textarea className={inputCls} rows={rows} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  return (
    <Modal title={`Discharge ${a.patient.fullName}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Outcome"><Select value={type} onChange={setType} options={TYPES.map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Follow-up on"><input type="date" className={inputCls} value={f.followUpOn} onChange={(e) => setF({ ...f, followUpOn: e.target.value })} /></Field></div>
        <Field label="Final diagnosis"><input className={inputCls} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
        {T('course', 'Course in hospital', 3)}
        {T('treatment', 'Treatment given')}
        <div className="grid gap-3 sm:grid-cols-2">{T('condition', 'Condition at discharge')}{T('medicines', 'Medicines to take at home')}</div>
        {T('advice', 'Advice to the patient')}
        <section className="rounded-2xl p-4 ring-1 ring-line">
          <h3 className="mb-2 text-sm font-semibold">Bill</h3>
          <ul className="space-y-1 text-sm">{a.stays.map((s) => <li key={s.id} className="flex justify-between"><span>{s.ward}, bed {s.bed}: {s.days} day{s.days > 1 ? 's' : ''} × {rupees(s.dailyRatePaise)}</span><span>{rupees(s.amountPaise)}</span></li>)}</ul>
          {extras.map((e, i) => <div key={i} className="mt-2 flex gap-2"><input className={`${inputCls} flex-1`} placeholder="Procedure, nursing, consumables" value={e.description} onChange={(x) => setExtras(extras.map((y, j) => (j === i ? { ...y, description: x.target.value } : y)))} /><input className={`${inputCls} !w-28`} inputMode="decimal" placeholder="₹" value={e.amount} onChange={(x) => setExtras(extras.map((y, j) => (j === i ? { ...y, amount: x.target.value.replace(/[^\d.]/g, '') } : y)))} /><button aria-label="Remove" onClick={() => setExtras(extras.filter((_, j) => j !== i))}><X size={16} /></button></div>)}
          <button className="mt-2 flex items-center gap-1 text-xs font-semibold text-brand-700" onClick={() => setExtras([...extras, { description: '', amount: '' }])}><Plus size={13} /> Add a charge</button>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Discount (₹)"><input className={inputCls} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            <Field label="Collect now (₹)"><input className={inputCls} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="Paid by"><Select value={pay.method} onChange={(method) => setPay({ ...pay, method })} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} /></Field>
          </div>
          <p className="mt-3 flex justify-between border-t border-line pt-2 text-sm font-bold"><span>Total (₹ incl. GST where applicable)</span><span>{rupees(Math.max(0, total))}</span></p>
        </section>
        {go.error && <p className="text-sm text-red-600">{(go.error as Error).message}</p>}
        <Button className="w-full" disabled={f.diagnosis.trim().length < 3 || total < 0 || go.isPending} onClick={() => confirm(`Discharge ${a.patient.fullName}? The bed will be released and the bill raised.`) && go.mutate()}>Discharge and bill</Button>
      </div>
    </Modal>
  )
}

export default function AdmissionDetail() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const qc = useQueryClient()
  const [mode, setMode] = useState<null | 'transfer' | 'discharge'>(null)
  const [tab, setTab] = useState<'care' | 'record'>('care')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState<'NOTE' | 'ROUND' | 'ORDER'>('NOTE')
  const [showVitals, setShowVitals] = useState(false)
  const { data: a } = useQuery({ queryKey: ['ipd', 'admission', id], queryFn: () => api<Adm>(`/ipd/admissions/${id}`) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ipd'] }); setShowVitals(false) }
  const add = useMutation({ mutationFn: () => api(`/ipd/admissions/${id}/notes`, { method: 'POST', body: JSON.stringify({ kind, text: note }) }), onSuccess: () => { setNote(''); refresh() } })
  if (!a) return <p className="py-16 text-center text-sm text-muted">Loading…</p>
  const open = a.status === 'ADMITTED'
  const day = Math.max(1, Math.ceil(((a.dischargedAt ? new Date(a.dischargedAt) : new Date()).getTime() - new Date(a.admittedAt).getTime()) / 86_400_000))
  const vitals = a.notes.filter((n) => n.kind === 'VITALS').slice(0, 6)
  return (
    <div className="space-y-5 pb-6">
      <Link to="/ipd" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Inpatients</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold tracking-tight">{a.patient.fullName} <span className={clsx('ml-2 rounded-full px-3 py-1 align-middle text-xs font-semibold', open ? 'bg-sky-100 text-sky-700' : 'bg-stone-200 text-stone-600')}>{open ? `Day ${day}` : 'Discharged'}</span></h1>
          <p className="text-sm text-muted">{a.admissionNo} · {a.patient.patientNo} · {a.bed ? `${a.bed.ward}, bed ${a.bed.code}` : 'No bed'} · Dr {a.doctorName ?? '-'} · admitted {when(a.admittedAt)}</p>
          {a.patient.allergies.length > 0 && <p className="mt-1 text-sm font-semibold text-red-700">Allergic to {a.patient.allergies.join(', ')}</p>}
        </div>
        {open && can('ipd:write') && <><Button variant="ghost" onClick={() => setMode('transfer')}><Repeat2 size={15} /> Move bed</Button><Button onClick={() => setMode('discharge')}><LogOut size={15} /> Discharge</Button></>}
        {!open && <><Button variant="ghost" onClick={() => openFile(`/ipd/admissions/${a.id}/summary.pdf`)}><FileText size={15} /> Discharge summary</Button>{a.invoiceId && <Link to="/billing" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-brand-700 ring-1 ring-line"><Printer size={15} /> Bill</Link>}</>}
      </div>
      <div className="flex gap-1 border-b border-line">{([['care', 'Care'], ['record', 'Full medical record']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}</div>
      {tab === 'record' ? <PatientRecord patientId={a.patient.id} /> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-5">
            {open && can('ipd:write') && (
              <section className="space-y-3 rounded-2xl p-4 ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-36"><Select value={kind} onChange={setKind} options={[{ value: 'NOTE', label: 'Nursing note' }, { value: 'ROUND', label: "Doctor's round" }, { value: 'ORDER', label: 'Order' }]} /></div>
                  <Button variant="ghost" className="ml-auto" onClick={() => setShowVitals(!showVitals)}><HeartPulse size={15} /> Vitals</Button>
                </div>
                {showVitals ? <VitalsForm id={id} onDone={refresh} /> : (
                  <div className="flex gap-2"><textarea className={`${inputCls} flex-1`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, what was done" /><Button className="self-end" disabled={!note.trim() || add.isPending} onClick={() => add.mutate()}>Save</Button></div>
                )}
                {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
              </section>
            )}
            <section>
              <h2 className="mb-2 text-sm font-semibold">Chart</h2>
              {a.notes.length === 0 ? <p className="rounded-2xl bg-surface p-8 text-center text-sm text-muted">Nothing recorded yet.</p> : (
                <ol className="space-y-2">{a.notes.map((n) => (
                  <li key={n.id} className="rounded-xl p-3 text-sm ring-1 ring-line">
                    <p className="flex justify-between text-xs text-muted"><span className="font-semibold uppercase">{n.kind === 'ROUND' ? "Doctor's round" : n.kind === 'ORDER' ? 'Order' : n.kind === 'VITALS' ? 'Vitals' : 'Note'}</span><span>{n.author} · {when(n.createdAt)}</span></p>
                    {n.text && <p className="mt-1 whitespace-pre-wrap">{n.text}</p>}
                    {n.vitals && <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-medium">{VITALS.filter(([k]) => n.vitals![k] !== undefined).map(([k, l]) => <span key={k}><span className="text-xs font-normal text-muted">{l} </span>{n.vitals![k]}</span>)}</p>}
                  </li>))}</ol>)}
            </section>
          </div>
          <aside className="space-y-4">
            <section className="rounded-2xl p-4 ring-1 ring-line text-sm">
              <h2 className="mb-2 font-semibold">Why admitted</h2><p>{a.reason}</p>
              {a.provisionalDiagnosis && <p className="mt-1 text-muted">Provisional: {a.provisionalDiagnosis}</p>}
              {a.expectedDischargeOn && <p className="mt-1 text-muted">Expected discharge {fmtDate(a.expectedDischargeOn)}</p>}
              {a.summary && <p className="mt-2 font-semibold">Final diagnosis: {a.summary.diagnosis}</p>}
            </section>
            <section className="rounded-2xl p-4 ring-1 ring-line text-sm">
              <h2 className="mb-2 font-semibold">Bed and charges {open ? 'so far' : ''}</h2>
              <ul className="space-y-2">{a.stays.map((s) => <li key={s.id}><p className="flex justify-between"><span className="font-medium">{s.ward} · {s.bed}</span><span>{rupees(s.amountPaise)}</span></p><p className="text-xs text-muted">{when(s.fromAt)} to {s.toAt ? when(s.toAt) : 'now'} · {s.days} day{s.days > 1 ? 's' : ''} × {rupees(s.dailyRatePaise)}</p></li>)}</ul>
              <p className="mt-3 flex justify-between border-t border-line pt-2 font-bold"><span>Bed charges</span><span>{rupees(a.bedChargesPaise)}</span></p>
            </section>
            {vitals.length > 0 && <section className="rounded-2xl p-4 ring-1 ring-line text-xs"><h2 className="mb-2 text-sm font-semibold">Recent vitals</h2><table className="w-full"><thead className="text-muted"><tr><th className="text-left">Time</th><th>Pulse</th><th>BP</th><th>SpO₂</th><th>Temp</th></tr></thead><tbody>{vitals.map((n) => <tr key={n.id} className="text-center"><td className="text-left text-muted">{when(n.createdAt)}</td><td>{n.vitals?.pulse ?? '-'}</td><td>{n.vitals?.systolic ? `${n.vitals.systolic}/${n.vitals.diastolic ?? '-'}` : '-'}</td><td>{n.vitals?.spo2 ?? '-'}</td><td>{n.vitals?.temperatureC ?? '-'}</td></tr>)}</tbody></table></section>}
          </aside>
        </div>
      )}
      {mode === 'transfer' && <TransferModal a={a} onClose={() => setMode(null)} />}
      {mode === 'discharge' && <DischargeModal a={a} onClose={() => setMode(null)} />}
    </div>
  )
}
