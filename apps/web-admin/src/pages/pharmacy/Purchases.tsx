import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import MedicineSearch from '../../components/MedicineSearch'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { useScanner } from '../../lib/scan'
import { fmtDate, rupees } from '../../lib/format'
import type { Medicine } from '../../lib/types'
import { medName, PageHead, Table, Tabs } from './shared'
import { useSuppliers } from './Suppliers'

interface Suggestion { medicineId: string; name: string; onHand: number; reorderLevel: number; suggestedQty: number; lastCostPaise: number }
interface PO { id: string; poNo: string; status: 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED'; createdAt: string; supplier: { name: string }; supplierId: string; lines: { id: string; medicineId: string; qty: number; costPaise: number }[]; notes: string | null }
interface GRN { id: string; grnNo: string; billNo: string | null; totalPaise: number; paidPaise: number; createdAt: string; supplier: { name: string }; lines: { id: string }[] }
const tone = { DRAFT: 'bg-stone-200 text-stone-600', ORDERED: 'bg-sky-100 text-sky-700', RECEIVED: 'bg-brand-100 text-brand-700', CANCELLED: 'bg-red-100 text-red-600' }

interface OrderLine { medicineId: string; name: string; qty: string; cost: string }

function PoModal({ seed, onClose }: { seed: OrderLine[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: suppliers } = useSuppliers()
  const [supplierId, setSupplierId] = useState('')
  const [lines, setLines] = useState<OrderLine[]>(seed)
  const [notes, setNotes] = useState('')
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Math.round(Number(l.cost || 0) * 100), 0)
  const save = useMutation({
    mutationFn: (placeOrder: boolean) => api('/purchase-orders', { method: 'POST', body: JSON.stringify({ supplierId, notes: notes || undefined, placeOrder, lines: lines.map((l) => ({ medicineId: l.medicineId, qty: Number(l.qty), costPaise: Math.round(Number(l.cost) * 100) })) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); onClose() },
  })
  const ok = supplierId && lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && l.cost !== '')
  return (
    <Modal title="New purchase order" onClose={onClose} size="xl">
      <div className="space-y-4">
        <Field label="Supplier"><Select value={supplierId} onChange={setSupplierId} placeholder="Choose supplier" options={(suppliers ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name, hint: s.phone ?? undefined }))} /></Field>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={l.medicineId} className="grid grid-cols-[1fr_90px_110px_auto] items-center gap-2"><span className="truncate text-sm font-medium">{l.name}</span>
              <input className={`${inputCls} !py-2`} inputMode="numeric" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))} />
              <input className={`${inputCls} !py-2`} inputMode="decimal" placeholder="Cost ₹" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
              <button className="text-muted hover:text-red-600" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>
          ))}
          <MedicineSearch placeholder="Add a medicine" onPick={(m: Medicine) => !lines.some((l) => l.medicineId === m.id) && setLines([...lines, { medicineId: m.id, name: medName(m), qty: '', cost: String(Math.round(m.pricePaise * 0.7) / 100) }])} />
        </div>
        <Field label="Notes (optional)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <div className="flex items-center gap-2"><p className="mr-auto text-sm text-muted">Order value <b className="text-ink">{rupees(total)}</b></p><Button variant="ghost" disabled={!ok || save.isPending} onClick={() => save.mutate(false)}>Save draft</Button><Button disabled={!ok || save.isPending} onClick={() => save.mutate(true)}>Place order</Button></div>
      </div>
    </Modal>
  )
}

interface GrnLine { medicineId: string; name: string; batchNo: string; expiry: string; qty: string; cost: string }

function ReceiveModal({ po, onClose }: { po: PO | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: suppliers } = useSuppliers()
  const { data: meds } = useQuery({ queryKey: ['medicines', 'all'], queryFn: () => api<Medicine[]>('/medicines?all=1') })
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? '')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState('')
  const [lines, setLines] = useState<GrnLine[]>([])
  const [seeded, setSeeded] = useState(false)
  const [payMethod, setPayMethod] = useState<'NONE' | 'CASH' | 'UPI' | 'CARD'>('NONE')
  const [payAmount, setPayAmount] = useState('')
  if (po && meds && !seeded) { setSeeded(true); setLines(po.lines.map((l) => { const m = meds.find((x) => x.id === l.medicineId); return { medicineId: l.medicineId, name: m ? medName(m) : 'Medicine', batchNo: '', expiry: '', qty: String(l.qty), cost: String(l.costPaise / 100) } })) }
  const total = lines.reduce((a, l) => a + Number(l.qty || 0) * Math.round(Number(l.cost || 0) * 100), 0)
  const today = new Date().toISOString().slice(0, 10)
  // Scan each carton's barcode while booking in goods: a new line appears, or the quantity of the same medicine goes up by one.
  useScanner(async (code) => {
    const m = (await api<Medicine[]>(`/medicines?barcode=${encodeURIComponent(code)}`).catch(() => []))[0]
    if (!m) return false
    setLines((ls) => ls.some((l) => l.medicineId === m.id) ? ls.map((l) => (l.medicineId === m.id ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l)) : [...ls, { medicineId: m.id, name: medName(m), batchNo: '', expiry: '', qty: '1', cost: '' }])
    return true
  })
  const save = useMutation({
    mutationFn: () => api('/goods-receipts', { method: 'POST', body: JSON.stringify({
      supplierId, poId: po?.id, billNo: billNo || undefined, billDate: billDate || undefined,
      lines: lines.map((l) => ({ medicineId: l.medicineId, batchNo: l.batchNo, expiryDate: l.expiry, qty: Number(l.qty), costPaise: Math.round(Number(l.cost) * 100) })),
      payment: payMethod !== 'NONE' && Number(payAmount) > 0 ? { method: payMethod, amountPaise: Math.round(Number(payAmount) * 100) } : undefined,
    }) }),
    onSuccess: () => { for (const k of ['purchase-orders', 'goods-receipts', 'suppliers', 'medicines', 'pharmacy-alerts', 'batches']) qc.invalidateQueries({ queryKey: [k] }); onClose() },
  })
  const set = (i: number, p: Partial<GrnLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const ok = supplierId && lines.length > 0 && lines.every((l) => l.batchNo && l.expiry > today && Number(l.qty) > 0 && l.cost !== '')
  return (
    <Modal title={po ? `Receive goods for ${po.poNo}` : 'Receive goods'} onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier"><Select value={supplierId} onChange={setSupplierId} disabled={!!po} placeholder="Choose supplier" options={(suppliers ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} /></Field>
          <Field label="Supplier bill no."><input className={inputCls} value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
          <Field label="Bill date"><input type="date" className={inputCls} max={today} value={billDate} onChange={(e) => setBillDate(e.target.value)} /></Field>
        </div>
        <div className="overflow-x-auto"><div className="min-w-[640px] space-y-2">
          {lines.length > 0 && <div className="grid grid-cols-[1.4fr_1fr_1fr_80px_90px_auto] gap-2 text-xs font-semibold text-muted"><span>Medicine</span><span>Batch no.</span><span>Expiry</span><span>Qty</span><span>Cost ₹</span><span /></div>}
          {lines.map((l, i) => (
            <div key={l.medicineId} className="grid grid-cols-[1.4fr_1fr_1fr_80px_90px_auto] items-center gap-2"><span className="truncate text-sm font-medium">{l.name}</span>
              <input className={`${inputCls} !py-2`} value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} aria-label="Batch number" />
              <input type="date" className={clsx(inputCls, '!py-2', l.expiry && l.expiry <= today && 'border-red-300')} min={today} value={l.expiry} onChange={(e) => set(i, { expiry: e.target.value })} aria-label="Expiry" />
              <input className={`${inputCls} !py-2`} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value.replace(/\D/g, '') })} aria-label="Quantity" />
              <input className={`${inputCls} !py-2`} inputMode="decimal" value={l.cost} onChange={(e) => set(i, { cost: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Cost" />
              <button className="text-muted hover:text-red-600" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></button></div>
          ))}
        </div></div>
        <MedicineSearch placeholder="Add a medicine received" onPick={(m: Medicine) => !lines.some((l) => l.medicineId === m.id) && setLines([...lines, { medicineId: m.id, name: medName(m), batchNo: '', expiry: '', qty: '', cost: '' }])} />
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <Field label="Pay now (optional)"><Select value={payMethod} onChange={setPayMethod} options={[{ value: 'NONE', label: 'Pay later' }, { value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} /></Field>
          {payMethod !== 'NONE' && <Field label="Amount ₹"><input className={inputCls} inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(total / 100)} /></Field>}
        </div>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <div className="flex items-center gap-3"><p className="mr-auto text-sm text-muted">Bill total <b className="text-ink">{rupees(total)}</b></p><Button disabled={!ok || save.isPending} onClick={() => save.mutate()}><PackagePlus size={16} /> Add to stock</Button></div>
      </div>
    </Modal>
  )
}

export default function Purchases() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'reorder' | 'orders' | 'receipts'>('reorder')
  const [po, setPo] = useState<OrderLine[] | null>(null)
  const [receive, setReceive] = useState<PO | 'new' | null>(null)
  const sug = useQuery({ queryKey: ['reorder'], queryFn: () => api<Suggestion[]>('/pharmacy/reorder-suggestions') })
  const orders = useQuery({ queryKey: ['purchase-orders'], queryFn: () => api<PO[]>('/purchase-orders'), enabled: tab === 'orders' })
  const grns = useQuery({ queryKey: ['goods-receipts'], queryFn: () => api<GRN[]>('/goods-receipts'), enabled: tab === 'receipts' })
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const act = useMutation({ mutationFn: (v: { id: string; what: 'order' | 'cancel' }) => api(`/purchase-orders/${v.id}/${v.what}`, { method: 'POST', body: '{}' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }) })
  const toLines = (rows: Suggestion[]): OrderLine[] => rows.map((s) => ({ medicineId: s.medicineId, name: s.name, qty: String(s.suggestedQty), cost: String(s.lastCostPaise / 100) }))
  return (
    <div>
      <PageHead title="Purchases" sub="Reorder, place purchase orders and book in supplier deliveries">
        <Tabs value={tab} onChange={setTab} tabs={[{ k: 'reorder', label: `Reorder${sug.data?.length ? ` (${sug.data.length})` : ''}` }, { k: 'orders', label: 'Purchase orders' }, { k: 'receipts', label: 'Goods received' }]} />
        <Button variant="ghost" onClick={() => setPo([])}><Plus size={16} /> New order</Button>
        <Button onClick={() => setReceive('new')}><PackagePlus size={16} /> Receive goods</Button>
      </PageHead>
      {tab === 'reorder' && (
        <>
          <div className="mb-3 flex items-center gap-3"><p className="mr-auto text-sm text-muted">Items at or below their reorder level in this branch. Suggested quantity brings stock to twice the reorder level.</p>
            <Button disabled={picked.size === 0} onClick={() => setPo(toLines((sug.data ?? []).filter((s) => picked.has(s.medicineId))))}>Create order from {picked.size || 'selected'}</Button></div>
          <Table head={['', 'Medicine', 'In stock', 'Reorder at', 'Suggested', 'Last cost']} empty={sug.data?.length === 0 ? 'Nothing needs reordering right now.' : undefined}>
            {sug.data?.map((s) => (
              <tr key={s.medicineId}><td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${s.name}`} checked={picked.has(s.medicineId)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(s.medicineId); else n.delete(s.medicineId); setPicked(n) }} /></td>
                <td className="px-4 py-3 font-medium">{s.name}</td><td className="px-4 py-3"><b className={s.onHand === 0 ? 'text-red-600' : 'text-amber-700'}>{s.onHand}</b></td><td className="px-4 py-3 text-muted">{s.reorderLevel}</td><td className="px-4 py-3">{s.suggestedQty}</td><td className="px-4 py-3 text-muted">{rupees(s.lastCostPaise)}</td></tr>
            ))}
          </Table>
        </>
      )}
      {tab === 'orders' && (
        <Table head={['Order', 'Supplier', 'Date', 'Items', 'Value', 'Status', '']} empty={orders.data?.length === 0 ? 'No purchase orders yet.' : undefined}>
          {orders.data?.map((o) => (
            <tr key={o.id}><td className="px-4 py-3 font-semibold">{o.poNo}</td><td className="px-4 py-3">{o.supplier.name}</td><td className="px-4 py-3 text-muted">{fmtDate(o.createdAt)}</td><td className="px-4 py-3">{o.lines.length}</td><td className="px-4 py-3">{rupees(o.lines.reduce((a, l) => a + l.qty * l.costPaise, 0))}</td>
              <td className="px-4 py-3"><span className={clsx('rounded-full px-3 py-1 text-xs font-semibold', tone[o.status])}>{o.status.charAt(0) + o.status.slice(1).toLowerCase()}</span></td>
              <td className="px-3 py-3 text-right"><span className="inline-flex gap-1">
                {o.status === 'DRAFT' && <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => act.mutate({ id: o.id, what: 'order' })}>Place</Button>}
                {(o.status === 'DRAFT' || o.status === 'ORDERED') && <Button className="!px-3 !py-1.5 text-xs" onClick={() => setReceive(o)}>Receive</Button>}
                {(o.status === 'DRAFT' || o.status === 'ORDERED') && <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => { if (confirm(`Cancel ${o.poNo}?`)) act.mutate({ id: o.id, what: 'cancel' }) }}>Cancel</Button>}
              </span></td></tr>
          ))}
        </Table>
      )}
      {tab === 'receipts' && (
        <Table head={['Receipt', 'Supplier', 'Bill', 'Date', 'Items', 'Total', 'Paid']} empty={grns.data?.length === 0 ? 'No deliveries received yet.' : undefined}>
          {grns.data?.map((g) => <tr key={g.id}><td className="px-4 py-3 font-semibold">{g.grnNo}</td><td className="px-4 py-3">{g.supplier.name}</td><td className="px-4 py-3 text-muted">{g.billNo ?? '-'}</td><td className="px-4 py-3 text-muted">{fmtDate(g.createdAt)}</td><td className="px-4 py-3">{g.lines.length}</td><td className="px-4 py-3">{rupees(g.totalPaise)}</td><td className="px-4 py-3">{g.paidPaise >= g.totalPaise ? <span className="font-semibold text-brand-700">Paid</span> : <span className="text-amber-700">{rupees(g.totalPaise - g.paidPaise)} due</span>}</td></tr>)}
        </Table>
      )}
      {act.error && <p className="mt-3 text-sm text-red-600">{(act.error as Error).message}</p>}
      {po && <PoModal seed={po} onClose={() => { setPo(null); setPicked(new Set()) }} />}
      {receive && <ReceiveModal po={receive === 'new' ? null : receive} onClose={() => setReceive(null)} />}
    </div>
  )
}
