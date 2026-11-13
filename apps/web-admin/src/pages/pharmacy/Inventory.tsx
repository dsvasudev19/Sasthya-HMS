import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Download, Pencil, Plus, Search, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'
import type { Batch, Medicine } from '../../lib/types'
import MedicineImport from './MedicineImport'
import { csv, medName, PageHead, stockText, Table, Tabs } from './shared'

const FORMS = ['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'OINTMENT', 'DROPS', 'OTHER'].map((f) => ({ value: f, label: f.charAt(0) + f.slice(1).toLowerCase() }))
const GST = ['0', '5', '12', '18', '28'].map((g) => ({ value: g, label: `${g}%` }))
const stockBadge = (m: Medicine) => (m.onHand === 0 ? 'bg-red-100 text-red-600' : m.onHand <= m.reorderLevel ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')

function MedicineModal({ med, onClose }: { med: Medicine | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    name: med?.name ?? '', genericName: med?.genericName ?? '', strength: med?.strength ?? '', form: med?.form ?? 'TABLET', unitLabel: med?.unitLabel ?? 'tablet',
    price: med ? String(med.pricePaise / 100) : '', reorder: String(med?.reorderLevel ?? 20), gst: String(med?.gstPercent ?? 12),
    packSize: String(med?.packSize ?? 1), packLabel: med?.packLabel ?? 'strip', barcode: med?.barcode ?? '', manufacturer: med?.manufacturer ?? '', hsn: med?.hsnCode ?? '', rack: med?.rack ?? '', schedule: med?.scheduleDrug ?? false, active: med?.active ?? true,
  })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name, genericName: f.genericName || undefined, strength: f.strength || undefined, form: f.form, unitLabel: f.unitLabel, packSize: Math.max(1, Number(f.packSize) || 1), packLabel: f.packLabel || 'strip', pricePaise: Math.round(Number(f.price) * 100),
        reorderLevel: Number(f.reorder), gstPercent: Number(f.gst), barcode: f.barcode || undefined, manufacturer: f.manufacturer || undefined, hsnCode: f.hsn || undefined, rack: f.rack || undefined, scheduleDrug: f.schedule,
      }
      return med ? api(`/medicines/${med.id}`, { method: 'PATCH', body: JSON.stringify({ ...body, active: f.active }) }) : api('/medicines', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['medicines'] }); onClose() },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  return (
    <Modal title={med ? `Edit ${med.name}` : 'Add medicine'} onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Name"><input className={inputCls} required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field></div>
          <Field label="Strength"><input className={inputCls} placeholder="500 mg" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} /></Field>
          <Field label="Generic name"><input className={inputCls} value={f.genericName} onChange={(e) => setF({ ...f, genericName: e.target.value })} /></Field>
          <Field label="Form"><Select value={f.form} onChange={(v) => setF({ ...f, form: v })} options={FORMS} /></Field>
          <Field label="Sold per"><input className={inputCls} value={f.unitLabel} onChange={(e) => setF({ ...f, unitLabel: e.target.value })} /></Field>
          <Field label="Units in one pack"><input className={inputCls} inputMode="numeric" value={f.packSize} onChange={(e) => setF({ ...f, packSize: e.target.value.replace(/\D/g, '') })} placeholder="10 tablets to a strip" /></Field>
          <Field label="Pack is called"><input className={inputCls} value={f.packLabel} onChange={(e) => setF({ ...f, packLabel: e.target.value })} placeholder="strip" /></Field>
          <Field label="Price per unit (₹)"><input className={inputCls} inputMode="decimal" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="GST included"><Select value={f.gst} onChange={(v) => setF({ ...f, gst: v })} options={GST} /></Field>
          <Field label="Reorder at"><input className={inputCls} inputMode="numeric" value={f.reorder} onChange={(e) => setF({ ...f, reorder: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Barcode"><input className={inputCls} value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value.trim() })} placeholder="Scan or type" /></Field>
          <Field label="Manufacturer"><input className={inputCls} value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} /></Field>
          <Field label="HSN code"><input className={inputCls} value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} /></Field>
          <Field label="Rack / shelf"><input className={inputCls} value={f.rack} onChange={(e) => setF({ ...f, rack: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.checked })} /> Schedule H drug (the counter must record the prescriber)</label>
        {med && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (sellable)</label>}
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button type="submit" className="w-full" disabled={!f.name || !f.price || save.isPending}>{med ? 'Save changes' : 'Add medicine'}</Button>
      </form>
    </Modal>
  )
}

function StockModal({ med, onClose }: { med: Medicine; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const { data } = useQuery({ queryKey: ['batches', med.id], queryFn: () => api<{ batches: (Batch & { branch: { code: string } })[]; movements: { id: string; type: string; qty: number; createdAt: string; note: string | null; batch: { batchNo: string } | null }[] }>(`/medicines/${med.id}/batches`) })
  const [f, setF] = useState({ batchNo: '', expiry: '', qty: '', cost: '' })
  const refresh = () => { for (const k of ['batches', 'medicines', 'pharmacy-alerts', 'pharmacy-dashboard']) qc.invalidateQueries({ queryKey: [k] }) }
  const receive = useMutation({
    mutationFn: () => api('/pharmacy/receipts', { method: 'POST', body: JSON.stringify({ medicineId: med.id, batchNo: f.batchNo, expiryDate: f.expiry, qty: Number(f.qty), costPaise: f.cost ? Math.round(Number(f.cost) * 100) : undefined }) }),
    onSuccess: () => { setF({ batchNo: '', expiry: '', qty: '', cost: '' }); refresh() },
  })
  const adjust = useMutation({ mutationFn: (v: { batchId: string; qtyDelta: number; reason: string }) => api('/pharmacy/adjustments', { method: 'POST', body: JSON.stringify(v) }), onSuccess: refresh })
  const today = new Date().toISOString().slice(0, 10)
  return (
    <Modal title={medName(med)} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <table className="w-full text-left"><thead className="bg-surface text-xs font-semibold"><tr><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Branch</th><th className="px-3 py-2">Expiry</th><th className="px-3 py-2">Cost</th><th className="px-3 py-2">In stock</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {data?.batches.map((b) => {
                const expired = b.expiryDate.slice(0, 10) <= today
                return (
                  <tr key={b.id}><td className="px-3 py-2 font-medium">{b.batchNo}</td><td className="px-3 py-2 text-muted">{b.branch.code}</td><td className={clsx('px-3 py-2', expired ? 'font-semibold text-red-600' : 'text-muted')}>{fmtDate(b.expiryDate)}{expired && ' (expired)'}</td><td className="px-3 py-2 text-muted">{b.costPaise === null ? '-' : rupees(b.costPaise)}</td><td className="px-3 py-2">{b.qtyOnHand}/{b.qtyReceived}</td>
                    <td className="px-3 py-2 text-right">{can('pharmacy:write') && b.qtyOnHand > 0 && <button className="text-xs font-semibold text-red-600" onClick={() => { if (confirm(`Write off ${b.qtyOnHand} from batch ${b.batchNo}?`)) adjust.mutate({ batchId: b.id, qtyDelta: -b.qtyOnHand, reason: expired ? 'EXPIRED' : 'DAMAGE' }) }}>Write off</button>}</td></tr>
                )
              })}
              {data && data.batches.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted">No stock received yet.</td></tr>}
            </tbody></table>
        </div>
        {can('pharmacy:write') && (
          <form onSubmit={(e) => { e.preventDefault(); receive.mutate() }} className="space-y-3 rounded-xl bg-surface p-4">
            <p className="font-semibold">Receive stock without a supplier bill</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <input className={inputCls} placeholder="Batch number" required value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
              <input type="date" className={inputCls} required min={today} value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />
              <input className={inputCls} placeholder="Quantity" inputMode="numeric" required value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} />
              <input className={inputCls} placeholder="Cost ₹ (optional)" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
            {(receive.error || adjust.error) && <p className="text-sm text-red-600">{((receive.error || adjust.error) as Error).message}</p>}
            <Button type="submit" disabled={receive.isPending || !f.batchNo || !f.expiry || !f.qty}>Add to stock</Button>
          </form>
        )}
        <div><p className="mb-2 font-semibold">Recent movements</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted">{data?.movements.map((m) => <li key={m.id} className="flex justify-between gap-3"><span>{new Date(m.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {m.type.replace('_', ' ').toLowerCase()}{m.batch ? ` · ${m.batch.batchNo}` : ''}{m.note ? ` · ${m.note}` : ''}</span><b className={m.qty < 0 ? 'text-red-600' : 'text-brand-700'}>{m.qty > 0 ? `+${m.qty}` : m.qty}</b></li>)}</ul></div>
      </div>
    </Modal>
  )
}

interface Alerts {
  lowStock: { id: string; name: string; strength: string | null; onHand: number; reorderLevel: number }[]
  expiringSoon: { id: string; batchNo: string; expiryDate: string; qtyOnHand: number; branch: { code: string }; medicine: { name: string; strength: string | null } }[]
  expired: Alerts['expiringSoon']
}

function AlertsView() {
  const { data } = useQuery({ queryKey: ['pharmacy-alerts'], queryFn: () => api<Alerts>('/pharmacy/alerts') })
  if (!data) return null
  const block = (title: string, tone: string, rows: React.ReactNode[], empty: string) => (
    <section className={`rounded-2xl p-5 ring-1 ${tone}`}><h3 className="mb-3 text-sm font-semibold">{title} ({rows.length})</h3>{rows.length ? <ul className="space-y-2 text-sm">{rows}</ul> : <p className="text-sm text-muted">{empty}</p>}</section>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {block('Expired, remove from shelf', 'bg-red-50 ring-red-200', data.expired.map((b) => <li key={b.id} className="flex justify-between gap-2"><span>{medName(b.medicine)} · {b.batchNo} · {b.branch.code}</span><b>{b.qtyOnHand}</b></li>), 'Nothing expired.')}
      {block('Expiring within 60 days', 'bg-amber-50 ring-amber-200', data.expiringSoon.map((b) => <li key={b.id} className="flex justify-between gap-2"><span>{medName(b.medicine)} · {b.batchNo}</span><span className="shrink-0 text-xs">{fmtDate(b.expiryDate)} · {b.qtyOnHand}</span></li>), 'Nothing expiring soon.')}
      {block('Low stock, reorder', 'bg-surface ring-line', data.lowStock.map((m) => <li key={m.id} className="flex justify-between gap-2"><span>{medName(m)}</span><span className="shrink-0 text-xs">{m.onHand} left (reorder at {m.reorderLevel})</span></li>), 'All stocked up.')}
    </div>
  )
}

export default function Inventory() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') ?? 'all') as 'all' | 'low' | 'alerts'
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Medicine | 'new' | null>(null)
  const [stock, setStock] = useState<Medicine | null>(null)
  const [importing, setImporting] = useState(false)
  const { data = [] } = useQuery({ queryKey: ['medicines', 'inventory', q, view], queryFn: () => api<Medicine[]>(`/medicines?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}${view === 'low' ? '&low=1' : ''}`), enabled: view !== 'alerts' })
  return (
    <div>
      <PageHead title="Inventory" sub="Medicines, batches and expiry for the branch you are viewing">
        <Tabs value={view} onChange={(v) => setParams(v === 'all' ? {} : { view: v })} tabs={[{ k: 'all', label: 'All medicines' }, { k: 'low', label: 'Low stock' }, { k: 'alerts', label: 'Expiry and alerts' }]} />
        {can('pharmacy:write') && <Button variant="ghost" onClick={() => setImporting(true)}><Upload size={16} /> Import</Button>}
        {can('pharmacy:write') && <Button onClick={() => setEditing('new')}><Plus size={18} /> Add medicine</Button>}
      </PageHead>
      {view === 'alerts' ? <AlertsView /> : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex flex-1 items-center gap-3 rounded-full border border-line bg-white px-5 py-3 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100"><Search size={17} className="text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, generic name or barcode" className="w-full bg-transparent text-sm outline-none" /></div>
            <Button variant="ghost" onClick={() => csv('stock.csv', [['Medicine', 'Form', 'Price', 'GST %', 'On hand', 'Next expiry', 'Barcode', 'Rack'], ...data.map((m) => [medName(m), m.form, m.pricePaise / 100, m.gstPercent, m.onHand, m.nextExpiry?.slice(0, 10) ?? '', m.barcode ?? '', m.rack ?? ''])])}><Download size={16} /> CSV</Button>
          </div>
          <Table head={['Medicine', 'Price', 'GST', 'Rack', 'Next expiry', 'In stock', '']} empty={data.length ? undefined : 'No medicines found.'}>
            {data.map((m) => (
              <tr key={m.id} className={clsx('hover:bg-surface/60', !m.active && 'opacity-50')}>
                <td className="px-4 py-3"><button className="text-left" onClick={() => setStock(m)}><span className="font-semibold">{medName(m)}</span>{m.scheduleDrug && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Sch. H</span>}<span className="block text-xs text-muted">{[m.genericName, m.manufacturer, m.barcode].filter(Boolean).join(' · ') || m.form.toLowerCase()}</span></button></td>
                <td className="px-4 py-3">{rupees(m.pricePaise)}{m.packSize > 1 && <span className="block text-xs text-muted">{rupees(m.pricePaise * m.packSize)} / {m.packLabel}</span>}</td><td className="px-4 py-3 text-muted">{m.gstPercent}%</td><td className="px-4 py-3 text-muted">{m.rack ?? '-'}</td><td className="px-4 py-3 text-muted">{m.nextExpiry ? fmtDate(m.nextExpiry) : '-'}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${stockBadge(m)}`}>{stockText(m)}</span></td>
                <td className="px-3 py-3 text-right"><span className="inline-flex gap-1"><Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setStock(m)}>Batches</Button>{can('pharmacy:write') && <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Edit medicine" onClick={() => setEditing(m)}><Pencil size={15} /></button>}</span></td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {editing && <MedicineModal med={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <MedicineImport onClose={() => setImporting(false)} />}
      {stock && <StockModal med={stock} onClose={() => setStock(null)} />}
    </div>
  )
}
