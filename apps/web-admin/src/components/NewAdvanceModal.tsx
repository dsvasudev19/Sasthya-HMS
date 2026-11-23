import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api, openFile } from '../lib/api'
import { rupees } from '../lib/format'
import type { PatientAdvance, PatientRow } from '../lib/types'
import PatientSearch from './PatientSearch'
import Select from './Select'
import { Button, Field, inputCls, Modal } from './ui'

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Debit / Credit Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer (NEFT / RTGS / IMPS)' },
  { value: 'CHEQUE', label: 'Cheque' },
]

export default function NewAdvanceModal({
  initialPatient = null,
  onClose,
  onCreated,
}: {
  initialPatient?: PatientRow | null
  onClose: () => void
  onCreated?: (adv: PatientAdvance) => void
}) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(initialPatient)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE'>('CASH')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  const amountPaise = Math.round(Number(amount || 0) * 100)

  const create = useMutation({
    mutationFn: () =>
      api<PatientAdvance>(`/patients/${patient!.id}/advances`, {
        method: 'POST',
        body: JSON.stringify({
          amountPaise,
          method,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      }),
    onSuccess: (adv) => {
      qc.invalidateQueries({ queryKey: ['advances'] })
      qc.invalidateQueries({ queryKey: ['patient-advances', patient?.id] })
      qc.invalidateQueries({ queryKey: ['collections'] })
      if (onCreated) onCreated(adv)
      void openFile(`/advances/${adv.id}/receipt.pdf`)
      onClose()
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (patient && amountPaise > 0) create.mutate()
  }

  return (
    <Modal title="Record patient advance deposit" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <p className="text-xs text-muted">
          Collect advance deposit for inpatient admission, surgeries, or credit wallet. The patient can adjust this balance against future hospital bills.
        </p>

        <Field label="Patient">
          <PatientSearch value={patient} onChange={setPatient} autoFocus={!initialPatient} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Deposit amount (₹)">
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder="e.g. 5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              required
            />
          </Field>

          <Field label="Payment method">
            <Select
              value={method}
              onChange={(v) => setMethod(v as typeof method)}
              options={METHODS}
            />
          </Field>
        </div>

        {method !== 'CASH' && (
          <Field label={method === 'CHEQUE' ? 'Cheque number & bank' : 'Transaction reference / UTR'}>
            <input
              className={inputCls}
              placeholder={method === 'CHEQUE' ? 'Cheque #123456 - HDFC' : 'UPI UTR / Card Auth code'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
        )}

        <Field label="Notes / Purpose (optional)">
          <input
            className={inputCls}
            placeholder="e.g. Advance towards laparoscopic cholecystectomy"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {create.error && (
          <p className="text-xs text-red-600">{(create.error as Error).message}</p>
        )}

        <div className="pt-2">
          <Button
            type="submit"
            className="w-full"
            disabled={!patient || amountPaise < 100 || create.isPending}
          >
            {create.isPending
              ? 'Recording…'
              : amountPaise > 0
                ? `Collect ${rupees(amountPaise)} & Print Receipt`
                : 'Collect deposit'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
