import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'
import { medName, PageHead, Table, Tabs } from './shared'

interface SaleRow { id: string; createdAt: string; invoice: { invoiceNo: string; totalPaise: number; paidPaise: number; refundedPaise: number; customerName: string | null; patient: { fullName: string } | null } | null }
interface SaleDetail { id: string; lines: { id: string; qty: number; unitPaise: number; returnedQty: number; medicine?: { name: string; strength: string | null } }[]; invoice: { invoiceNo: string } | null }
interface ReturnRow { id: string; returnNo: string; amountPaise: number; reason: string; refundMethod: string; createdAt: string; dispense: { invoice: { invoiceNo: string } | null } }

function ReturnModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['pos-sale', saleId], queryFn: () => api<SaleDetail>(`/pos/sales/${saleId}`) })
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH')
  const save = useMutation({
    mutationFn: () => api<{ returnNo: string; refundedPaise: number }>('/pos/returns', { method: 'POST', body: JSON.stringify({ dispenseId: saleId, reason, refundMethod: method, items: Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ dispenseLineId: id, qty: Number(v) })) }) }),
    onSuccess: () => { for (const k of ['pos-returns', 'pos-sales', 'medicines', 'pharmacy-dashboard']) qc.invalidateQueries({ queryKey: [k] }); onClose() },
  })
  if (!data) return null
  const any = Object.values(qty).some((v) => Number(v) > 0)
  return (
    <Modal title={`Return from ${data.invoice?.invoiceNo ?? 'sale'}`} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <ul className="space-y-2">
          {data.lines.map((l) => {
            const left = l.qty - l.returnedQty
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3"><div className="min-w-0 flex-1"><p className="font-semibold">{l.medicine ? medName(l.medicine) : 'Medicine'}</p><p className="text-xs text-muted">Sold {l.qty} at {rupees(l.unitPaise)}{l.returnedQty ? ` · ${l.returnedQty} already returned` : ''}</p></div>
                <input disabled={left === 0} className={`${inputCls} !w-20 !py-2 text-center`} inputMode="numeric" placeholder={`0-${left}`} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: String(Math.min(left, Number(e.target.value.replace(/\D/g, '') || 0)) || '') })} aria-label="Return quantity" /></li>
            )
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Reason"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong item, doctor changed medicine…" /></Field><Field label="Refund by"><Select value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} /></Field></div>
        {save.error && <p className="text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={!any || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Return items and refund</Button>
      </div>
    </Modal>
  )
}

export default function Returns() {
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const sales = useQuery({ queryKey: ['pos-sales', q], queryFn: () => api<SaleRow[]>(`/pos/sales${q ? `?q=${encodeURIComponent(q)}` : ''}`) })
  const rets = useQuery({ queryKey: ['pos-returns'], queryFn: () => api<ReturnRow[]>('/pos/returns'), enabled: tab === 'history' })
  return (
    <div>
      <PageHead title="Returns" sub="Find the original bill, pick what came back, refund. Stock goes back to the exact batch."><Tabs value={tab} onChange={setTab} tabs={[{ k: 'new', label: 'Take a return' }, { k: 'history', label: 'Past returns' }]} /></PageHead>
      {tab === 'new' ? (
        <>
          <div className="mb-3 flex items-center gap-3 rounded-full border border-line bg-white px-5 py-3 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100"><Search size={17} className="text-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bill number, customer name or phone (blank shows today)" className="w-full bg-transparent text-sm outline-none" /></div>
          <Table head={['Bill', 'Customer', 'Date', 'Total', '']} empty={sales.data?.length === 0 ? 'No sales found.' : undefined}>
            {sales.data?.map((s) => <tr key={s.id}><td className="px-4 py-3 font-semibold">{s.invoice?.invoiceNo}</td><td className="px-4 py-3">{s.invoice?.patient?.fullName ?? s.invoice?.customerName ?? 'Walk-in'}</td><td className="px-4 py-3 text-muted">{fmtDate(s.createdAt)}</td><td className="px-4 py-3">{rupees(s.invoice?.totalPaise ?? 0)}{!!s.invoice?.refundedPaise && <span className="ml-2 text-xs text-amber-700">{rupees(s.invoice.refundedPaise)} refunded</span>}</td><td className="px-3 py-3 text-right"><Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setOpen(s.id)}>Return items</Button></td></tr>)}
          </Table>
        </>
      ) : (
        <Table head={['Return', 'Bill', 'Date', 'Reason', 'Refunded']} empty={rets.data?.length === 0 ? 'No returns yet.' : undefined}>
          {rets.data?.map((r) => <tr key={r.id}><td className="px-4 py-3 font-semibold">{r.returnNo}</td><td className="px-4 py-3 text-muted">{r.dispense.invoice?.invoiceNo}</td><td className="px-4 py-3 text-muted">{fmtDate(r.createdAt)}</td><td className="px-4 py-3">{r.reason}</td><td className="px-4 py-3 font-semibold">{rupees(r.amountPaise)} <span className="text-xs font-normal text-muted">{r.refundMethod.toLowerCase()}</span></td></tr>)}
        </Table>
      )}
      {open && <ReturnModal saleId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
