import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Wallet } from 'lucide-react'
import { useState } from 'react'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'
import { PageHead, Table } from './shared'

export interface Supplier { id: string; name: string; phone: string | null; gstin: string | null; address: string | null; active: boolean; billedPaise: number; duePaise: number }
interface Ledger { supplier: Supplier; grns: { id: string; grnNo: string; billNo: string | null; totalPaise: number; paidPaise: number; createdAt: string }[]; payments: { id: string; amountPaise: number; method: string; reference: string | null; paidAt: string }[]; duePaise: number }

export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') })

function SupplierModal({ s, onClose }: { s: Supplier | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: s?.name ?? '', phone: s?.phone ?? '', gstin: s?.gstin ?? '', address: s?.address ?? '' })
  const save = useMutation({
    mutationFn: () => { const body = { name: f.name, phone: f.phone || undefined, gstin: f.gstin || undefined, address: f.address || undefined }; return s ? api(`/suppliers/${s.id}`, { method: 'PATCH', body: JSON.stringify(body) }) : api('/suppliers', { method: 'POST', body: JSON.stringify(body) }) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose() },
  })
  return (
    <Modal title={s ? 'Edit supplier' : 'Add supplier'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="GSTIN"><input className={inputCls} maxLength={15} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field></div>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>Save supplier</Button>
      </div>
    </Modal>
  )
}

function LedgerModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['supplier-ledger', id], queryFn: () => api<Ledger>(`/suppliers/${id}/ledger`) })
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD'>('UPI')
  const [ref, setRef] = useState('')
  const pay = useMutation({
    mutationFn: () => api(`/suppliers/${id}/payments`, { method: 'POST', body: JSON.stringify({ amountPaise: Math.round(Number(amount) * 100), method, reference: ref || undefined }) }),
    onSuccess: () => { setAmount(''); setRef(''); for (const k of ['supplier-ledger', 'suppliers']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  if (!data) return null
  return (
    <Modal title={data.supplier.name} onClose={onClose} size="lg">
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4"><div><p className="text-xs text-muted">We owe this supplier</p><p className="text-2xl font-bold">{rupees(data.duePaise)}</p></div><p className="text-xs text-muted">{[data.supplier.phone, data.supplier.gstin && `GSTIN ${data.supplier.gstin}`].filter(Boolean).join(' · ')}</p></div>
        {data.duePaise > 0 && (
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]">
            <input className={inputCls} inputMode="decimal" placeholder={`Amount (up to ${data.duePaise / 100})`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            <Select value={method} onChange={setMethod} options={[{ value: 'UPI', label: 'UPI' }, { value: 'CASH', label: 'Cash' }, { value: 'CARD', label: 'Card' }]} />
            <input className={inputCls} placeholder="Reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            <Button disabled={pay.isPending || !(Number(amount) > 0)} onClick={() => pay.mutate()}><Wallet size={16} /> Pay</Button>
          </div>
        )}
        {pay.error && <p className="text-red-600">{(pay.error as Error).message}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="mb-2 font-semibold">Bills received</p><ul className="space-y-1.5">{data.grns.map((g) => <li key={g.id} className="flex justify-between rounded-xl bg-surface px-3 py-2"><span>{g.grnNo}{g.billNo ? ` · bill ${g.billNo}` : ''}<span className="block text-xs text-muted">{fmtDate(g.createdAt)}</span></span><span className="text-right"><b>{rupees(g.totalPaise)}</b><span className="block text-xs text-muted">{g.paidPaise >= g.totalPaise ? 'Paid' : `${rupees(g.totalPaise - g.paidPaise)} due`}</span></span></li>)}{data.grns.length === 0 && <li className="text-muted">None yet.</li>}</ul></div>
          <div><p className="mb-2 font-semibold">Payments made</p><ul className="space-y-1.5">{data.payments.map((p) => <li key={p.id} className="flex justify-between rounded-xl bg-surface px-3 py-2"><span>{p.method}{p.reference ? ` · ${p.reference}` : ''}<span className="block text-xs text-muted">{fmtDate(p.paidAt)}</span></span><b>{rupees(p.amountPaise)}</b></li>)}{data.payments.length === 0 && <li className="text-muted">None yet.</li>}</ul></div>
        </div>
      </div>
    </Modal>
  )
}

export default function Suppliers() {
  const { data } = useSuppliers()
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null)
  const [ledger, setLedger] = useState<string | null>(null)
  const owed = data?.reduce((a, s) => a + s.duePaise, 0) ?? 0
  return (
    <div>
      <PageHead title="Suppliers" sub={`Total payable ${rupees(owed)}`}><Button onClick={() => setEdit('new')}><Plus size={18} /> Add supplier</Button></PageHead>
      <Table head={['Supplier', 'Contact', 'Billed', 'Owed', '']} empty={data?.length === 0 ? 'No suppliers yet. Add the distributors you buy from.' : undefined}>
        {data?.map((s) => (
          <tr key={s.id} className="hover:bg-surface/60"><td className="px-4 py-3 font-semibold">{s.name}{!s.active && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] text-stone-600">Inactive</span>}</td><td className="px-4 py-3 text-muted">{[s.phone, s.gstin].filter(Boolean).join(' · ') || '-'}</td><td className="px-4 py-3">{rupees(s.billedPaise)}</td>
            <td className="px-4 py-3"><b className={s.duePaise > 0 ? 'text-amber-700' : ''}>{rupees(s.duePaise)}</b></td>
            <td className="px-3 py-3 text-right"><span className="inline-flex gap-1"><Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setLedger(s.id)}>Ledger</Button><button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Edit supplier" onClick={() => setEdit(s)}><Pencil size={15} /></button></span></td></tr>
        ))}
      </Table>
      {edit && <SupplierModal s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {ledger && <LedgerModal id={ledger} onClose={() => setLedger(null)} />}
    </div>
  )
}
