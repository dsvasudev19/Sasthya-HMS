import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { rupees } from '../lib/format'
import type { FeeItem, InvoiceDetail, PatientRow } from '../lib/types'
import PatientSearch from './PatientSearch'
import Select from './Select'
import { Button, Field, inputCls, Modal } from './ui'

interface Line { description: string; quantity: string; price: string }

const PAYMENT_OPTIONS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'NONE', label: 'Bill only, pay later' },
] as const

type PayOption = (typeof PAYMENT_OPTIONS)[number]['value']

export default function NewInvoiceModal({ onClose, onCreated, initialPatient = null }: { onClose: () => void; onCreated: (id: string) => void; initialPatient?: PatientRow | null }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(initialPatient)
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: '1', price: '' }])
  const [discount, setDiscount] = useState('')
  const [method, setMethod] = useState<PayOption>('CASH')

  const { data: feeItems = [] } = useQuery({ queryKey: ['fee-items'], queryFn: () => api<FeeItem[]>('/fee-items') })

  const subtotal = lines.reduce((s, l) => s + Math.round(Number(l.price || 0) * 100) * Math.max(1, Number(l.quantity || 1)), 0)
  const disc = Math.min(subtotal, Math.round(Number(discount || 0) * 100))

  const addFeeItem = (f: FeeItem) => {
    setLines((ls) => {
      const emptyIdx = ls.findIndex((l) => !l.description && !l.price)
      if (emptyIdx >= 0) {
        return ls.map((l, j) => (j === emptyIdx ? { description: f.name, quantity: '1', price: String(f.pricePaise / 100) } : l))
      }
      return [...ls, { description: f.name, quantity: '1', price: String(f.pricePaise / 100) }]
    })
  }

  const create = useMutation({
    mutationFn: () =>
      api<InvoiceDetail>('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          patientId: patient!.id,
          lines: lines.filter((l) => l.description && l.price).map((l) => ({ description: l.description, quantity: Math.max(1, Number(l.quantity || 1)), unitPaise: Math.round(Number(l.price) * 100) })),
          discountPaise: disc,
          payment: method !== 'NONE' ? { method } : undefined,
        }),
      }),
    onSuccess: (inv) => { qc.invalidateQueries({ queryKey: ['invoices'] }); qc.invalidateQueries({ queryKey: ['collections'] }); onCreated(inv.id) },
  })
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate() }
  const valid = !!patient && lines.some((l) => l.description && Number(l.price) > 0)

  return (
    <Modal title="New bill" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus={!initialPatient} /></Field>

        {feeItems.length > 0 && (
          <div className="space-y-1 rounded-xl bg-surface p-3 ring-1 ring-line">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Sparkles size={13} className="text-brand-600" /> Standard Services & Fee Catalog
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {feeItems.slice(0, 8).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => addFeeItem(f)}
                  className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink transition hover:border-brand-500 hover:text-brand-700"
                >
                  {f.name} · {rupees(f.pricePaise)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Items</p>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input className={`${inputCls} flex-1`} placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
              <input className={`${inputCls} w-16`} inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/\D/g, '') })} aria-label="Quantity" />
              <input className={`${inputCls} w-24`} inputMode="decimal" placeholder="₹" value={l.price} onChange={(e) => set(i, { price: e.target.value.replace(/[^\d.]/g, '') })} aria-label="Price" />
              {lines.length > 1 && <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-red-600" aria-label="Remove"><Trash2 size={16} /></button>}
            </div>
          ))}
          <button type="button" onClick={() => setLines((ls) => [...ls, { description: '', quantity: '1', price: '' }])} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><Plus size={14} /> Add item</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount (₹)"><input className={inputCls} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="Collect now">
            <Select value={method} onChange={setMethod} options={[...PAYMENT_OPTIONS]} />
          </Field>
        </div>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button type="submit" className="w-full" disabled={!valid || create.isPending}>{method !== 'NONE' ? `Collect ${rupees(subtotal - disc)}` : `Create bill for ${rupees(subtotal - disc)}`}</Button>
      </form>
    </Modal>
  )
}
