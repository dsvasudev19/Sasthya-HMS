import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, Plus, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import DispenseModal from '../components/DispenseModal'
import InvoiceModal from '../components/InvoiceModal'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'
import type { Batch, Medicine, PendingRx } from '../lib/types'

const FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'OINTMENT', 'DROPS', 'OTHER'].map((f) => ({ value: f, label: f.charAt(0) + f.slice(1).toLowerCase() }))
const stockBadge = (m: Medicine) => (m.onHand === 0 ? 'bg-red-100 text-red-600' : m.onHand <= m.reorderLevel ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')

function MedicineModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', strength: '', form: 'TABLET', unitLabel: 'tablet', price: '', reorder: '20', gst: '12' })
  const create = useMutation({
    mutationFn: () => api('/medicines', { method: 'POST', body: JSON.stringify({ name: f.name, strength: f.strength || undefined, form: f.form, unitLabel: f.unitLabel, pricePaise: Math.round(Number(f.price) * 100), reorderLevel: Number(f.reorder), gstPercent: Number(f.gst) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['medicines'] }); onClose() },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate() }
  return (
    <Modal title="Add medicine" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name"><input className={inputCls} required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Strength"><input className={inputCls} placeholder="500 mg" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} /></Field>
          <Field label="Form"><Select value={f.form} onChange={(v) => setF({ ...f, form: v })} options={FORMS} /></Field>
          <Field label="Sold per"><input className={inputCls} value={f.unitLabel} onChange={(e) => setF({ ...f, unitLabel: e.target.value })} /></Field>
          <Field label="Price per unit (₹)"><input className={inputCls} inputMode="decimal" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reorder when stock falls to"><input className={inputCls} inputMode="numeric" value={f.reorder} onChange={(e) => setF({ ...f, reorder: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="GST included in price"><Select value={f.gst} onChange={(v) => setF({ ...f, gst: v })} options={['0', '5', '12', '18', '28'].map((g) => ({ value: g, label: `${g}%` }))} /></Field>
        </div>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button type="submit" className="w-full" disabled={!f.name || !f.price || create.isPending}>Add medicine</Button>
      </form>
    </Modal>
  )
}

function StockModal({ med, onClose }: { med: Medicine; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['batches', med.id], queryFn: () => api<{ batches: Batch[] }>(`/medicines/${med.id}/batches`) })
  const [f, setF] = useState({ batchNo: '', expiry: '', qty: '', cost: '' })
  const receive = useMutation({
    mutationFn: () => api('/pharmacy/receipts', { method: 'POST', body: JSON.stringify({ medicineId: med.id, batchNo: f.batchNo, expiryDate: f.expiry, qty: Number(f.qty), costPaise: f.cost ? Math.round(Number(f.cost) * 100) : undefined }) }),
    onSuccess: () => { setF({ batchNo: '', expiry: '', qty: '', cost: '' }); for (const k of ['batches', 'medicines', 'pharmacy-alerts']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  const adjust = useMutation({
    mutationFn: (v: { batchId: string; qtyDelta: number; reason: string }) => api('/pharmacy/adjustments', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => { for (const k of ['batches', 'medicines', 'pharmacy-alerts']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  const today = new Date().toISOString().slice(0, 10)
  return (
    <Modal title={`${med.name}${med.strength ? ` ${med.strength}` : ''}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <table className="w-full text-left"><thead className="bg-surface text-xs font-semibold"><tr><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Expiry</th><th className="px-3 py-2">In stock</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {data?.batches.map((b) => {
                const expired = b.expiryDate.slice(0, 10) <= today
                return (
                  <tr key={b.id}><td className="px-3 py-2 font-medium">{b.batchNo}</td><td className={clsx('px-3 py-2', expired ? 'font-semibold text-red-600' : 'text-muted')}>{fmtDate(b.expiryDate)}{expired && ' (expired)'}</td><td className="px-3 py-2">{b.qtyOnHand}/{b.qtyReceived}</td>
                    <td className="px-3 py-2 text-right">{b.qtyOnHand > 0 && <button className="text-xs font-semibold text-red-600" onClick={() => adjust.mutate({ batchId: b.id, qtyDelta: -b.qtyOnHand, reason: expired ? 'EXPIRED' : 'DAMAGE' })}>Write off</button>}</td></tr>
                )
              })}
              {data && data.batches.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted">No stock received yet.</td></tr>}
            </tbody></table>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); receive.mutate() }} className="space-y-3 rounded-xl bg-surface p-4">
          <p className="font-semibold">Receive stock</p>
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} placeholder="Batch number" required value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
            <input type="date" className={inputCls} required min={today} value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />
            <input className={inputCls} placeholder="Quantity" inputMode="numeric" required value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} />
            <input className={inputCls} placeholder="Cost per unit ₹ (optional)" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^\d.]/g, '') })} />
          </div>
          {(receive.error || adjust.error) && <p className="text-red-600">{((receive.error || adjust.error) as Error).message}</p>}
          <Button type="submit" className="w-full" disabled={!f.batchNo || !f.expiry || !f.qty || receive.isPending}>Add to stock</Button>
        </form>
      </div>
    </Modal>
  )
}

function Counter() {
  const [dispensing, setDispensing] = useState<PendingRx | 'walkin' | null>(null)
  const [invoice, setInvoice] = useState<string | null>(null)
  const rx = useQuery({ queryKey: ['pharmacy-rx'], queryFn: () => api<PendingRx[]>('/pharmacy/prescriptions'), refetchInterval: 20_000 })
  const meds = useQuery({ queryKey: ['medicines', 'all-for-rx'], queryFn: () => api<Medicine[]>('/medicines') })
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Waiting prescriptions ({rx.data?.length ?? 0})</h2><Button variant="ghost" onClick={() => setDispensing('walkin')}><Plus size={16} /> Counter sale</Button></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rx.data?.map((r) => (
          <div key={r.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
            <p className="font-semibold">{r.patient.fullName}</p>
            <p className="text-xs text-muted">{r.patient.patientNo} · Dr. {r.doctor?.fullName ?? 'unknown'}</p>
            <ul className="my-3 space-y-1 text-sm">
              {r.items.map((i) => <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{i.name} × {i.quantity}</span>{i.available !== null && i.available !== undefined && <span className={clsx('shrink-0 text-xs font-semibold', i.available < i.quantity ? 'text-red-600' : 'text-brand-700')}>{i.available < i.quantity ? `only ${i.available}` : 'in stock'}</span>}</li>)}
            </ul>
            <Button className="w-full" onClick={() => setDispensing(r)}>Dispense</Button>
          </div>
        ))}
      </div>
      {rx.data?.length === 0 && <p className="py-8 text-center text-sm text-muted">No prescriptions waiting. Completed visits with medicines appear here.</p>}
      {dispensing && <DispenseModal rx={dispensing === 'walkin' ? undefined : dispensing} medicines={meds.data} onClose={() => setDispensing(null)} onDone={(inv) => { setDispensing(null); setInvoice(inv.id) }} />}
      {invoice && <InvoiceModal invoiceId={invoice} onClose={() => setInvoice(null)} />}
    </div>
  )
}

function Stock() {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Medicine | null>(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['medicines', 'stock', q], queryFn: () => api<Medicine[]>(`/medicines?all=1&q=${encodeURIComponent(q)}`) })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-line"><Search size={16} className="text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicines" className="w-full bg-transparent text-sm outline-none" /></div>
        <Button onClick={() => setAdding(true)}><Plus size={18} /> Add medicine</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Medicine', 'Form', 'Price', 'In stock', 'Next expiry'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(m)}>
                <td className="px-4 py-3.5 font-semibold">{m.name}{m.strength ? ` ${m.strength}` : ''}</td>
                <td className="px-4 py-3.5 capitalize text-muted">{m.form.toLowerCase()}</td>
                <td className="px-4 py-3.5">{rupees(m.pricePaise)}<span className="text-xs text-muted"> / {m.unitLabel}</span></td>
                <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${stockBadge(m)}`}>{m.onHand}</span></td>
                <td className="px-4 py-3.5 text-muted">{fmtDate(m.nextExpiry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && data.length === 0 && <p className="py-10 text-center text-sm text-muted">No medicines found.</p>}
      </div>
      {adding && <MedicineModal onClose={() => setAdding(false)} />}
      {open && <StockModal med={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

interface Alerts {
  lowStock: { id: string; name: string; strength: string | null; onHand: number; reorderLevel: number }[]
  expiringSoon: { id: string; batchNo: string; expiryDate: string; qtyOnHand: number; medicine: { name: string; strength: string | null } }[]
  expired: Alerts['expiringSoon']
}

function AlertsTab() {
  const { data } = useQuery({ queryKey: ['pharmacy-alerts'], queryFn: () => api<Alerts>('/pharmacy/alerts') })
  const block = (title: string, tone: string, rows: React.ReactNode[], empty: string) => (
    <section className={`rounded-2xl p-5 ring-1 ${tone}`}><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={16} /> {title} ({rows.length})</h3>{rows.length ? <ul className="space-y-2 text-sm">{rows}</ul> : <p className="text-sm text-muted">{empty}</p>}</section>
  )
  if (!data) return null
  const nm = (m: { name: string; strength: string | null }) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {block('Expired, remove from shelf', 'bg-red-50 ring-red-200', data.expired.map((b) => <li key={b.id} className="flex justify-between"><span>{nm(b.medicine)} · {b.batchNo}</span><b>{b.qtyOnHand}</b></li>), 'Nothing expired.')}
      {block('Expiring within 60 days', 'bg-amber-50 ring-amber-200', data.expiringSoon.map((b) => <li key={b.id} className="flex justify-between gap-2"><span>{nm(b.medicine)} · {b.batchNo}</span><span className="shrink-0 text-xs">{fmtDate(b.expiryDate)} · {b.qtyOnHand}</span></li>), 'Nothing expiring soon.')}
      {block('Low stock, reorder', 'bg-surface ring-line', data.lowStock.map((m) => <li key={m.id} className="flex justify-between"><span>{nm(m)}</span><span className="text-xs">{m.onHand} left (reorder at {m.reorderLevel})</span></li>), 'All stocked up.')}
    </div>
  )
}

export default function Pharmacy() {
  const [tab, setTab] = useState<'counter' | 'stock' | 'alerts'>('counter')
  const alerts = useQuery({ queryKey: ['pharmacy-alerts'], queryFn: () => api<Alerts>('/pharmacy/alerts') })
  const count = (alerts.data?.expired.length ?? 0) + (alerts.data?.expiringSoon.length ?? 0) + (alerts.data?.lowStock.length ?? 0)
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Pharmacy</h1>
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['counter', 'Counter'], ['stock', 'Stock'], ['alerts', count ? `Alerts (${count})` : 'Alerts']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('rounded-full px-5 py-2 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'counter' ? <Counter /> : tab === 'stock' ? <Stock /> : <AlertsTab />}
    </div>
  )
}
