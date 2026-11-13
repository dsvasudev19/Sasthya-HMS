import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { rupees } from '../lib/format'
import type { CardDetail, CardPlan, PatientRow } from '../lib/types'
import PatientSearch from './PatientSearch'
import Select from './Select'
import { Button, Field, Modal } from './ui'

export default function IssueCardModal({ onClose, onIssued }: { onClose: () => void; onIssued: (c: CardDetail) => void }) {
  const qc = useQueryClient()
  const [planId, setPlanId] = useState('')
  const [owner, setOwner] = useState<PatientRow | null>(null)
  const [others, setOthers] = useState<PatientRow[]>([])
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH')

  const plans = useQuery({ queryKey: ['card-plans'], queryFn: () => api<CardPlan[]>('/card-plans') })
  const plan = plans.data?.find((p) => p.id === planId)

  const issue = useMutation({
    mutationFn: () => api<CardDetail>('/cards', { method: 'POST', body: JSON.stringify({ planId, ownerPatientId: owner!.id, memberPatientIds: others.map((o) => o.id), paymentMethod: method }) }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['cards'] }); qc.invalidateQueries({ queryKey: ['invoices'] }); onIssued(c) },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); issue.mutate() }
  const taken = [owner?.id, ...others.map((o) => o.id)].filter(Boolean) as string[]
  const room = plan ? plan.maxMembers - 1 - others.length : 0

  return (
    <Modal title="Issue health card" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          {plans.data?.map((p) => (
            <button type="button" key={p.id} onClick={() => { setPlanId(p.id); setOthers([]) }}
              className={clsx('w-full rounded-2xl border-2 p-4 text-left transition', planId === p.id ? 'border-brand-500 bg-brand-50' : 'border-line hover:border-brand-200')}>
              <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span><span className="font-bold text-brand-700">{rupees(p.issueFeePaise + p.planPricePaise)}</span></div>
              <p className="mt-1 text-xs text-muted">Card {rupees(p.issueFeePaise)} once + plan {rupees(p.planPricePaise)} for {p.durationMonths} months · {p.inPersonVisits} in-person and {p.teleVisits} tele visits each</p>
            </button>
          ))}
        </div>
        {plan && (
          <>
            <Field label={plan.maxMembers > 1 ? 'Card owner' : 'Patient'}>
              <PatientSearch value={owner} onChange={setOwner} exclude={others.map((o) => o.id)} />
            </Field>
            {plan.maxMembers > 1 && (
              <Field label={`Other members (${others.length}/${plan.maxMembers - 1})`}>
                <div className="space-y-2">
                  {others.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-sm"><span className="font-medium">{o.fullName} <span className="text-xs text-muted">{o.patientNo}</span></span>
                      <button type="button" onClick={() => setOthers((x) => x.filter((y) => y.id !== o.id))} className="rounded-full p-1 text-muted hover:text-red-600" aria-label="Remove"><X size={14} /></button></div>
                  ))}
                  {room > 0 && <PatientSearch value={null} onChange={(p) => p && setOthers((x) => [...x, p])} exclude={taken} placeholder="Add a family member" />}
                </div>
              </Field>
            )}
            <Field label="Payment method">
              <Select value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} />
            </Field>
          </>
        )}
        {issue.error && <p className="text-sm text-red-600">{(issue.error as Error).message}</p>}
        <Button type="submit" className="w-full" disabled={!plan || !owner || issue.isPending}>{plan ? `Collect ${rupees(plan.issueFeePaise + plan.planPricePaise)} and issue card` : 'Choose a plan'}</Button>
      </form>
    </Modal>
  )
}
