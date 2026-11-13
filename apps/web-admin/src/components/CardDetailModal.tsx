import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'
import type { CardDetail } from '../lib/types'
import Select from './Select'
import { Button, Modal } from './ui'

export default function CardDetailModal({ cardId, initial, onClose }: { cardId: string; initial?: CardDetail; onClose: () => void }) {
  const qc = useQueryClient()
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH')
  const { data } = useQuery({ queryKey: ['card', cardId], queryFn: () => api<CardDetail>(`/cards/${cardId}`), initialData: initial })
  const renew = useMutation({
    mutationFn: () => api<CardDetail>(`/cards/${cardId}/renew`, { method: 'POST', body: JSON.stringify({ paymentMethod: method }) }),
    onSuccess: (d) => { qc.setQueryData(['card', cardId], d); qc.invalidateQueries({ queryKey: ['cards'] }) },
  })
  if (!data) return null
  const active = data.activeSubscription
  return (
    <Modal title="Health card" onClose={onClose}>
      {data.amountDuePaise !== undefined && (
        <div className="mb-4 rounded-2xl bg-brand-100 p-4 text-sm">
          <p className="font-semibold text-brand-800">Collect {rupees(data.amountDuePaise)} from the patient</p>
        </div>
      )}
      <div className="flex items-center gap-5 rounded-2xl bg-surface p-4">
        <div className="rounded-xl bg-white p-2"><QRCodeSVG value={data.cardNo} size={96} /></div>
        <div>
          <p className="text-xs text-muted">{data.plan.name}</p>
          <p className="text-lg font-bold tracking-wide">{data.cardNo}</p>
          <p className="mt-1 text-sm text-muted">Owner: {data.owner.fullName}</p>
          <p className={`mt-1 text-sm font-semibold ${active ? 'text-brand-700' : 'text-red-600'}`}>{active ? `Plan valid till ${fmtDate(active.endsAt)}` : 'Plan expired. Renew to cover visits.'}</p>
        </div>
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold">Covered members</h3>
      <ul className="space-y-2">
        {data.members.map((m) => (
          <li key={m.patient.id} className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5 text-sm">
            <span className="font-medium">{m.patient.fullName}</span>
            <span className="text-xs text-muted">
              {m.coverage?.subscriptionId ? `${m.coverage.remaining.inPerson}/${m.coverage.limits.inPerson} in person · ${m.coverage.remaining.tele}/${m.coverage.limits.tele} tele` : 'No active plan'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center gap-3">
        <div className="w-32 shrink-0"><Select value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} /></div>
        <Button className="flex-1" disabled={renew.isPending} onClick={() => renew.mutate()}>Renew plan · {rupees(data.plan.planPricePaise)}</Button>
      </div>
      <p className="mt-2 text-xs text-muted">Renewing charges only the plan price. The card fee is paid once.</p>
      {renew.error && <p className="mt-2 text-sm text-red-600">{(renew.error as Error).message}</p>}
    </Modal>
  )
}
