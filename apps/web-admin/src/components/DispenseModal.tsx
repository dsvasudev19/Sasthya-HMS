import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { rupees } from '../lib/format'
import type { InvoiceDetail, Medicine, PatientRow, PendingRx } from '../lib/types'
import MedicineSearch from './MedicineSearch'
import PatientSearch from './PatientSearch'
import Select from './Select'
import { Button, Field, Modal } from './ui'

interface Line { medicine: Medicine; qty: number }

export default function DispenseModal({ rx, medicines = [], onClose, onDone }: { rx?: PendingRx; medicines?: Medicine[]; onClose: () => void; onDone: (inv: InvoiceDetail) => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(rx ? ({ id: rx.patient.id, fullName: rx.patient.fullName, patientNo: rx.patient.patientNo } as PatientRow) : null)
  // Prescribed items that are linked to a catalogue medicine start in the cart.
  const [lines, setLines] = useState<Line[]>(() => (rx?.items ?? []).flatMap((i) => { const m = medicines.find((x) => x.id === i.medicineId); return m ? [{ medicine: m, qty: i.quantity }] : [] }))
  const unlinked = (rx?.items ?? []).filter((i) => !i.medicineId)
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'NONE'>('CASH')

  const total = lines.reduce((s, l) => s + l.qty * l.medicine.pricePaise, 0)
  const short = lines.filter((l) => l.qty > l.medicine.onHand)
  const dispense = useMutation({
    mutationFn: () => api<{ invoice: InvoiceDetail }>('/pharmacy/dispense', {
      method: 'POST',
      body: JSON.stringify({ patientId: patient!.id, consultationId: rx?.id, items: lines.map((l) => ({ medicineId: l.medicine.id, qty: l.qty })), payment: method !== 'NONE' ? { method } : undefined }),
    }),
    onSuccess: (r) => { for (const k of ['medicines', 'pharmacy-rx', 'pharmacy-alerts', 'invoices', 'collections']) qc.invalidateQueries({ queryKey: [k] }); onDone(r.invoice) },
  })
  const add = (m: Medicine) => setLines((ls) => (ls.some((l) => l.medicine.id === m.id) ? ls : [...ls, { medicine: m, qty: 1 }]))
  const setQty = (id: string, qty: number) => setLines((ls) => ls.map((l) => (l.medicine.id === id ? { ...l, qty: Math.max(1, qty) } : l)))

  return (
    <Modal title={rx ? 'Dispense prescription' : 'Counter sale'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient">{rx ? <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold">{rx.patient.fullName} <span className="font-normal text-muted">{rx.patient.patientNo}</span></p> : <PatientSearch value={patient} onChange={setPatient} autoFocus />}</Field>
        {unlinked.length > 0 && (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Not in the stock list, add manually if available: {unlinked.map((i) => i.name).join(', ')}</p>
        )}
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.medicine.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{l.medicine.name}{l.medicine.strength ? ` ${l.medicine.strength}` : ''}</p><p className={`text-xs ${l.qty > l.medicine.onHand ? 'font-semibold text-red-600' : 'text-muted'}`}>{rupees(l.medicine.pricePaise)} each · {l.medicine.onHand} in stock</p></div>
              <div className="flex items-center gap-1"><button type="button" onClick={() => setQty(l.medicine.id, l.qty - 1)} className="rounded-full bg-white p-1.5 ring-1 ring-line" aria-label="Less"><Minus size={14} /></button><span className="w-8 text-center text-sm font-semibold">{l.qty}</span><button type="button" onClick={() => setQty(l.medicine.id, l.qty + 1)} className="rounded-full bg-white p-1.5 ring-1 ring-line" aria-label="More"><Plus size={14} /></button></div>
              <span className="w-16 text-right text-sm font-semibold">{rupees(l.qty * l.medicine.pricePaise)}</span>
              <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x !== l))} className="text-muted hover:text-red-600" aria-label="Remove"><Trash2 size={15} /></button>
            </div>
          ))}
          <MedicineSearch onPick={add} placeholder="Add medicine to the bill" />
        </div>
        <Field label="Payment"><Select value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }, { value: 'NONE', label: 'Bill only, pay later' }]} /></Field>
        {dispense.error && <p className="text-sm text-red-600">{(dispense.error as Error).message}</p>}
        <Button className="w-full" disabled={!patient || lines.length === 0 || short.length > 0 || dispense.isPending} onClick={() => dispense.mutate()}>
          {short.length > 0 ? `Not enough stock for ${short[0]!.medicine.name}` : method === 'NONE' ? `Create bill ${rupees(total)}` : `Collect ${rupees(total)} and dispense`}
        </Button>
      </div>
    </Modal>
  )
}
