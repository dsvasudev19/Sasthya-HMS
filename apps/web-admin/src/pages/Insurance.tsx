import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { Kpi, Panel } from '../components/charts'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import { rupees } from '../lib/format'
import type { PatientRow } from '../lib/types'

interface Payer { id: string; name: string; kind: string; creditDays: number; active: boolean }
interface Claim { id: string; claimNo: string; kind: string; status: string; diagnosis: string | null; preauthRequestedPaise: number; preauthApprovedPaise: number; billedPaise: number; approvedPaise: number; settledPaise: number; disallowedPaise: number; outstandingPaise: number; ageDays: number; patient: { id: string; fullName: string; patientNo: string }; payer: { id: string; name: string } }
interface Detail extends Claim { events: { id: string; status: string; amountPaise: number | null; note: string | null; at: string; by: string | null }[]; next: string[]; invoiceId: string | null }
interface Summary { openClaims: number; receivablePaise: number; overduePaise: number; settledPaise: number; disallowedPaise: number; payers: { id: string; name: string; creditDays: number; claims: number; receivablePaise: number; overduePaise: number; rejectionPct: number; avgDaysToSettle: number | null }[] }
interface Inv { id: string; invoiceNo: string; totalPaise: number; paidPaise: number; status: string }

const TONE: Record<string, string> = { DRAFT: 'bg-slate-100 text-slate-600', PREAUTH_PENDING: 'bg-sky-100 text-sky-700', PREAUTH_APPROVED: 'bg-brand-100 text-brand-700', PREAUTH_REJECTED: 'bg-red-100 text-red-600', SUBMITTED: 'bg-sky-100 text-sky-700', QUERY: 'bg-amber-100 text-amber-700', APPROVED: 'bg-brand-100 text-brand-700', SETTLED: 'bg-emerald-100 text-emerald-800', REJECTED: 'bg-red-100 text-red-600', CLOSED: 'bg-stone-200 text-stone-600' }
const ACTION: Record<string, { label: string; ask?: string }> = { approve_preauth: { label: 'Pre-auth approved', ask: 'Amount approved (₹)' }, reject_preauth: { label: 'Pre-auth rejected' }, submit: { label: 'Submit final bill' }, query: { label: 'Insurer raised a query' }, respond: { label: 'Query answered' }, approve: { label: 'Claim approved', ask: 'Amount approved (₹)' }, reject: { label: 'Claim rejected' }, settle: { label: 'Money received', ask: 'Amount received (₹)' }, close: { label: 'Close claim' } }
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ')

function NewClaim({ payers, onClose }: { payers: Payer[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [f, setF] = useState({ payerId: '', kind: 'CASHLESS', policyId: '', invoiceId: '', preauth: '', diagnosis: '' })
  const { data: policies = [] } = useQuery({ queryKey: ['policies', patient?.id], queryFn: () => api<{ id: string; policyNo: string; payer: { id: string; name: string } }[]>(`/patients/${patient!.id}/policies`), enabled: !!patient })
  const { data: invoices = [] } = useQuery({ queryKey: ['claim-invoices', patient?.id], queryFn: () => api<Inv[]>(`/invoices?patientId=${patient!.id}`), enabled: !!patient })
  const [pol, setPol] = useState({ policyNo: '', add: false })
  const create = useMutation({
    mutationFn: async () => {
      let policyId = f.policyId || undefined
      if (pol.add && pol.policyNo) policyId = (await api<{ id: string }>(`/patients/${patient!.id}/policies`, { method: 'POST', body: JSON.stringify({ payerId: f.payerId, policyNo: pol.policyNo }) })).id
      return api('/insurance/claims', { method: 'POST', body: JSON.stringify({ patientId: patient!.id, payerId: f.payerId, kind: f.kind, policyId, invoiceId: f.invoiceId || undefined, diagnosis: f.diagnosis || undefined, preauthRequestedPaise: Math.round(Number(f.preauth || 0) * 100) }) })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['claims'] }); qc.invalidateQueries({ queryKey: ['ins-summary'] }); onClose() },
  })
  const mine = policies.filter((p) => p.payer.id === f.payerId)
  const ok = patient && f.payerId && (f.kind === 'REIMBURSEMENT' || Number(f.preauth) > 0)
  return (
    <Modal title="New claim" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Insurer or TPA"><Select value={f.payerId} onChange={(payerId) => setF({ ...f, payerId, policyId: '' })} placeholder="Choose" options={payers.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} /></Field>
          <Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'CASHLESS', label: 'Cashless (pre-auth first)' }, { value: 'REIMBURSEMENT', label: 'Reimbursement' }]} /></Field>
        </div>
        {f.payerId && patient && (mine.length > 0 && !pol.add ? <Field label="Policy"><Select value={f.policyId} onChange={(policyId) => setF({ ...f, policyId })} placeholder="Choose a policy" options={[...mine.map((p) => ({ value: p.id, label: p.policyNo })), { value: '', label: 'No policy recorded' }]} /></Field> : <Field label="Policy number"><input className={inputCls} value={pol.policyNo} onChange={(e) => setPol({ policyNo: e.target.value, add: true })} placeholder="Recorded for next time too" /></Field>)}
        {f.kind === 'CASHLESS' && <Field label="Pre-authorisation requested (₹)"><input className={inputCls} inputMode="decimal" value={f.preauth} onChange={(e) => setF({ ...f, preauth: e.target.value.replace(/[^\d.]/g, '') })} /></Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Diagnosis"><input className={inputCls} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
          <Field label="Attach a bill (optional now)"><Select value={f.invoiceId} onChange={(invoiceId) => setF({ ...f, invoiceId })} placeholder="Choose" options={[{ value: '', label: 'Attach later' }, ...invoices.filter((i) => i.status !== 'VOID').map((i) => ({ value: i.id, label: `${i.invoiceNo} · ${rupees(i.totalPaise)}` }))]} /></Field>
        </div>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button className="w-full" disabled={!ok || create.isPending} onClick={() => create.mutate()}>Open claim</Button>
      </div>
    </Modal>
  )
}

function ClaimModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const { data: c } = useQuery({ queryKey: ['claim', id], queryFn: () => api<Detail>(`/insurance/claims/${id}`) })
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const act = useMutation({
    mutationFn: (action: string) => api(`/insurance/claims/${id}/act`, { method: 'POST', body: JSON.stringify({ action, note: note || undefined, ...(amount ? { amountPaise: Math.round(Number(amount) * 100) } : {}) }) }),
    onSuccess: () => { setAmount(''); setNote(''); setPick(null); for (const k of ['claim', 'claims', 'ins-summary', 'invoices']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  if (!c) return null
  const a = pick ? ACTION[pick] : null
  return (
    <Modal title={`${c.claimNo} · ${c.patient.fullName}`} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3"><span className={clsx('rounded-full px-3 py-1 text-xs font-bold uppercase', TONE[c.status])}>{label(c.status)}</span><span className="text-muted">{c.payer.name} · {c.kind.toLowerCase()}{c.diagnosis ? ` · ${c.diagnosis}` : ''}</span></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{[['Pre-auth asked', c.preauthRequestedPaise], ['Pre-auth given', c.preauthApprovedPaise], ['Billed', c.billedPaise], ['Approved', c.approvedPaise], ['Received', c.settledPaise]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-surface p-3"><p className="text-[11px] text-muted">{l}</p><p className="font-bold">{rupees(v as number)}</p></div>)}</div>
        {c.disallowedPaise > 0 && <p className="text-amber-700">The insurer disallowed {rupees(c.disallowedPaise)}. That part stays on the patient's bill.</p>}
        {can('insurance:write') && c.next.length > 0 && (
          <div className="space-y-3 rounded-2xl p-4 ring-1 ring-line">
            {!pick ? <div className="flex flex-wrap gap-2">{c.next.map((n) => <Button key={n} variant={n === 'close' || n.startsWith('reject') ? 'ghost' : 'primary'} onClick={() => setPick(n)}>{ACTION[n]?.label ?? n}</Button>)}</div> : (
              <>
                <p className="font-semibold">{a?.label}</p>
                {a?.ask && <Field label={a.ask}><input className={`${inputCls} !w-48`} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>}
                <Field label="Note (kept on the trail)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                {act.error && <p className="text-red-600">{(act.error as Error).message}</p>}
                <div className="flex gap-2"><Button disabled={act.isPending || (!!a?.ask && !Number(amount))} onClick={() => act.mutate(pick)}>Confirm</Button><Button variant="ghost" onClick={() => { setPick(null); act.reset() }}>Back</Button></div>
              </>)}
          </div>)}
        <ol className="space-y-2 border-l-2 border-line pl-4">{c.events.map((e) => <li key={e.id}><p className="font-medium capitalize">{label(e.status)}{e.amountPaise ? ` · ${rupees(e.amountPaise)}` : ''}</p><p className="text-xs text-muted">{e.note ? `${e.note} · ` : ''}{e.by} · {new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p></li>)}</ol>
      </div>
    </Modal>
  )
}

function PayerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', kind: 'INSURER', creditDays: '30' })
  const save = useMutation({ mutationFn: () => api('/insurance/payers', { method: 'POST', body: JSON.stringify({ name: f.name, kind: f.kind, creditDays: Number(f.creditDays) || 30 }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['payers'] }); onClose() } })
  return (
    <Modal title="Add an insurer or TPA" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name"><input className={inputCls} autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Star Health, Medi Assist, Ayushman Bharat" /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><Select value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'INSURER', label: 'Insurer' }, { value: 'TPA', label: 'TPA' }, { value: 'GOVERNMENT', label: 'Government scheme' }, { value: 'CORPORATE', label: 'Corporate' }]} /></Field>
          <Field label="Pays within (days)"><input className={inputCls} inputMode="numeric" value={f.creditDays} onChange={(e) => setF({ ...f, creditDays: e.target.value.replace(/\D/g, '') })} /></Field></div>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>Add</Button>
      </div>
    </Modal>
  )
}

export default function Insurance() {
  const { can } = useAuth()
  const [tab, setTab] = useState<'claims' | 'payers'>('claims')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<'claim' | 'payer' | null>(null)
  const [status, setStatus] = useState('open')
  const [q, setQ] = useState('')
  const { data: s } = useQuery({ queryKey: ['ins-summary'], queryFn: () => api<Summary>('/insurance/summary') })
  const { data: payers = [] } = useQuery({ queryKey: ['payers'], queryFn: () => api<Payer[]>('/insurance/payers') })
  const { data: claims = [] } = useQuery({ queryKey: ['claims', status, q], queryFn: () => api<Claim[]>(`/insurance/claims?${new URLSearchParams({ ...(status === 'open' ? { open: 'true' } : status ? { status } : {}), ...(q ? { q } : {}) })}`) })
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Insurance and TPA</h1><p className="text-sm text-muted">Pre-authorisations, claims and what insurers owe you.</p></div>
        {can('insurance:manage') && <Button variant="ghost" onClick={() => setAdding('payer')}>Add insurer</Button>}
        {can('insurance:write') && <Button onClick={() => setAdding('claim')} disabled={payers.length === 0}><Plus size={16} /> New claim</Button>}</div>
      {s && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Open claims" value={s.openClaims} /><Kpi label="Insurers owe you" value={rupees(s.receivablePaise)} tone="good" /><Kpi label="Overdue" value={rupees(s.overduePaise)} tone={s.overduePaise ? 'alert' : 'plain'} sub="past their credit period" /><Kpi label="Disallowed so far" value={rupees(s.disallowedPaise)} sub={`${rupees(s.settledPaise)} received`} /></div>}
      <div className="flex gap-1 border-b border-line">{([['claims', 'Claims'], ['payers', 'Insurers']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}</div>
      {tab === 'claims' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2"><div className="w-52"><Select value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open claims' }, { value: '', label: 'Everything' }, { value: 'PREAUTH_PENDING', label: 'Waiting for pre-auth' }, { value: 'SUBMITTED', label: 'Submitted' }, { value: 'QUERY', label: 'Query raised' }, { value: 'APPROVED', label: 'Approved, unpaid' }, { value: 'SETTLED', label: 'Settled' }, { value: 'REJECTED', label: 'Rejected' }]} /></div><input className={`${inputCls} max-w-xs`} placeholder="Claim number or patient" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-surface text-xs font-semibold"><tr>{['Claim', 'Patient', 'Insurer', 'Status', 'Billed', 'Approved', 'Still due', 'Age'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{claims.map((c) => <tr key={c.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(c.id)}><td className="px-4 py-3 font-semibold">{c.claimNo}</td><td className="px-4 py-3">{c.patient.fullName}</td><td className="px-4 py-3 text-muted">{c.payer.name}</td><td className="px-4 py-3"><span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase', TONE[c.status])}>{label(c.status)}</span></td><td className="px-4 py-3">{rupees(c.billedPaise || c.preauthRequestedPaise)}</td><td className="px-4 py-3">{c.approvedPaise ? rupees(c.approvedPaise) : '-'}</td><td className="px-4 py-3 font-semibold">{c.outstandingPaise ? rupees(c.outstandingPaise) : '-'}</td><td className="px-4 py-3 text-muted">{c.ageDays}d</td></tr>)}</tbody></table>
            {claims.length === 0 && <p className="py-10 text-center text-sm text-muted">No claims.</p>}</div>
        </div>
      ) : (
        <Panel title="How each insurer pays"><div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs font-semibold text-muted"><tr>{['Insurer', 'Credit days', 'Claims', 'Owes you', 'Overdue', 'Rejected', 'Avg days to pay'].map((h) => <th key={h} className="pb-2">{h}</th>)}</tr></thead><tbody className="divide-y divide-line">{(s?.payers ?? []).map((p) => <tr key={p.id}><td className="py-2.5 font-semibold">{p.name}</td><td>{p.creditDays}</td><td>{p.claims}</td><td>{rupees(p.receivablePaise)}</td><td className={p.overduePaise ? 'font-semibold text-red-600' : ''}>{rupees(p.overduePaise)}</td><td>{p.rejectionPct}%</td><td>{p.avgDaysToSettle ?? '-'}</td></tr>)}</tbody></table>{payers.length === 0 && <p className="py-6 text-center text-sm text-muted">Add the insurers and TPAs you work with.</p>}</div></Panel>
      )}
      {open && <ClaimModal id={open} onClose={() => setOpen(null)} />}
      {adding === 'claim' && <NewClaim payers={payers} onClose={() => setAdding(null)} />}
      {adding === 'payer' && <PayerModal onClose={() => setAdding(null)} />}
    </div>
  )
}
