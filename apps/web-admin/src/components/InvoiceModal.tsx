import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileDown, Link2, Printer, Wallet } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { api, openFile } from '../lib/api'
import { rupees } from '../lib/format'
import type { InvoiceDetail, PatientAdvance } from '../lib/types'
import Select from './Select'
import { Button, inputCls, Modal } from './ui'

const STATUS_CLS = { PAID: 'bg-brand-100 text-brand-700', PARTIAL: 'bg-amber-100 text-amber-700', UNPAID: 'bg-red-100 text-red-600', REFUNDED: 'bg-stone-200 text-stone-600', VOID: 'bg-stone-200 text-stone-600' } as const
const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ADVANCE', label: 'Adjust Advance' },
] as const

type PayMethod = (typeof METHODS)[number]['value']

const upiUri = (vpa: string, name: string, paise: number, note: string) => `upi://pay?${new URLSearchParams({ pa: vpa, pn: name, am: (paise / 100).toFixed(2), cu: 'INR', tn: note })}`

export default function InvoiceModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const { data: inv } = useQuery({ queryKey: ['invoice', invoiceId], queryFn: () => api<InvoiceDetail>(`/invoices/${invoiceId}`) })
  const { data: advData } = useQuery({
    queryKey: ['patient-advances', inv?.patient?.id],
    queryFn: () => api<{ advances: PatientAdvance[]; totalPaise: number; balancePaise: number }>(`/patients/${inv!.patient!.id}/advances`),
    enabled: !!inv?.patient?.id,
  })
  const advanceBalance = advData?.balancePaise ?? 0

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PayMethod>('CASH')
  const [reference, setReference] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [link, setLink] = useState<{ url: string; smsQueued: boolean } | null>(null)

  const refresh = (d: InvoiceDetail) => {
    qc.setQueryData(['invoice', invoiceId], { ...inv, ...d })
    qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
    for (const k of ['invoices', 'today', 'appointments', 'collections', 'advances']) qc.invalidateQueries({ queryKey: [k] })
    if (inv?.patient?.id) qc.invalidateQueries({ queryKey: ['patient-advances', inv.patient.id] })
    setAmount(''); setReference(''); setRefunding(false); setRefundAmount(''); setRefundReason('')
  }
  const pay = useMutation({
    mutationFn: (paise: number) => api<InvoiceDetail>(`/invoices/${invoiceId}/payments`, { method: 'POST', body: JSON.stringify({ amountPaise: paise, method, reference: reference || undefined }) }),
    onSuccess: refresh,
  })
  const voidIt = useMutation({ mutationFn: () => api<InvoiceDetail>(`/invoices/${invoiceId}/void`, { method: 'POST' }), onSuccess: refresh })
  const refund = useMutation({
    mutationFn: () => api<InvoiceDetail>(`/invoices/${invoiceId}/refunds`, { method: 'POST', body: JSON.stringify({ amountPaise: Math.round(Number(refundAmount) * 100), method, reason: refundReason }) }),
    onSuccess: refresh,
  })
  const payLink = useMutation({ mutationFn: (sendSms: boolean) => api<{ url: string; smsQueued: boolean }>(`/invoices/${invoiceId}/payment-link`, { method: 'POST', body: JSON.stringify({ sendSms }) }), onSuccess: setLink })

  if (!inv) return null
  const balance = inv.totalPaise - inv.paidPaise
  const open = balance > 0 && inv.status !== 'VOID' && inv.status !== 'REFUNDED'
  const canVoid = can('billing:close') && inv.paidPaise === 0 && inv.status !== 'VOID'
  const refundable = inv.paidPaise - inv.refundedPaise
  const canRefund = can('billing:refund') && refundable > 0 && inv.status !== 'VOID'
  const entered = Math.round(Number(amount) * 100)
  const taxInvoice = !!inv.hospital.gstin && inv.taxBreakup.length > 0
  const h = inv.hospital
  const err = (pay.error || voidIt.error || refund.error || payLink.error) as Error | null

  return (
    <Modal title={`${taxInvoice ? 'Tax invoice' : 'Invoice'} ${inv.invoiceNo}`} onClose={onClose}>
      <div id="receipt" className="space-y-4 text-sm">
        {h.legalName && (
          <div className="border-b border-line pb-3"><p className="font-bold">{h.legalName}</p>{h.address && <p className="text-xs text-muted">{h.address}</p>}<p className="text-xs text-muted">{[h.phone, h.gstin && `GSTIN ${h.gstin}`].filter(Boolean).join(' · ')}</p></div>
        )}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold">{inv.patient?.fullName ?? inv.customerName ?? 'Walk-in customer'}</p>
            <p className="text-xs text-muted">{inv.patient ? `${inv.patient.patientNo}${inv.patient.phone ? ` · ${inv.patient.phone}` : ''}` : inv.customerPhone ?? ''}</p>
            <p className="text-xs text-muted">{new Date(inv.createdAt).toLocaleString('en-IN')}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLS[inv.status]}`}>{inv.status}</span>
        </div>
        <table className="w-full">
          <tbody className="divide-y divide-line">
            {inv.lines.map((l) => (
              <tr key={l.id}><td className="py-2">{l.description}{l.quantity > 1 && <span className="text-muted"> × {l.quantity}</span>}</td><td className="py-2 text-right">{rupees(l.amountPaise)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 border-t border-line pt-3">
          {inv.discountPaise > 0 && <div className="flex justify-between text-muted"><span>{inv.note ?? 'Discount'}</span><span>-{rupees(inv.discountPaise)}</span></div>}
          <div className="flex justify-between text-base font-bold"><span>Total</span><span>{rupees(inv.totalPaise)}</span></div>
          {taxInvoice && (
            <div className="rounded-xl bg-surface p-3 text-xs text-muted">
              <p className="mb-1 font-semibold text-ink">GST included in the total</p>
              {inv.taxBreakup.map((t) => <p key={t.gstPercent} className="flex justify-between"><span>{t.gstPercent}% on {rupees(t.taxablePaise)}</span><span>CGST {rupees(t.cgstPaise)} + SGST {rupees(t.sgstPaise)}</span></p>)}
            </div>
          )}
          <div className="flex justify-between text-muted"><span>Paid</span><span>{rupees(inv.paidPaise)}</span></div>
          {inv.refundedPaise > 0 && <div className="flex justify-between text-muted"><span>Refunded</span><span>-{rupees(inv.refundedPaise)}</span></div>}
          {open && <div className="flex justify-between font-semibold text-red-600"><span>Balance due</span><span>{rupees(balance)}</span></div>}
        </div>
        {inv.payments.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Payments</p>
            {inv.payments.map((p) => <p key={p.id} className="flex justify-between text-xs"><span>{new Date(p.receivedAt).toLocaleString('en-IN')} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span><span>{rupees(p.amountPaise)}</span></p>)}
            {inv.refunds.map((r) => <p key={r.id} className="flex justify-between text-xs text-red-600"><span>{new Date(r.createdAt).toLocaleString('en-IN')} · refund {r.method} · {r.reason}</span><span>-{rupees(r.amountPaise)}</span></p>)}
          </div>
        )}
        {open && h.upiVpa && <div className="flex items-center gap-3 rounded-xl bg-surface p-3 print:hidden"><QRCodeSVG value={upiUri(h.upiVpa, h.legalName || 'Hospital', balance, inv.invoiceNo)} size={84} /><p className="text-xs text-muted">Scan with any UPI app to pay <b className="text-ink">{rupees(balance)}</b> to {h.upiVpa}. Then record the payment below with the UPI reference.</p></div>}
      </div>

      {open && (
        <div className="mt-5 space-y-3 print:hidden">
          {advanceBalance > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
              <div className="flex items-center gap-2">
                <Wallet className="shrink-0 text-amber-600" size={18} />
                <div>
                  <p className="font-semibold">Patient advance available: {rupees(advanceBalance)}</p>
                  <p className="text-amber-700">Adjust from deposited advance balance</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="!bg-amber-100 !py-1 text-xs font-semibold !text-amber-900 hover:!bg-amber-200"
                disabled={pay.isPending}
                onClick={() => {
                  setMethod('ADVANCE')
                  const canPay = Math.min(balance, advanceBalance)
                  setAmount(String(canPay / 100))
                  setReference('Adjusted from patient advance')
                  pay.mutate(canPay)
                }}
              >
                Pay {rupees(Math.min(balance, advanceBalance))} from advance
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <input className={inputCls} inputMode="decimal" placeholder={`Amount (₹, up to ${balance / 100})`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            <div className="w-40 shrink-0"><Select value={method} onChange={setMethod} options={[...METHODS]} /></div>
          </div>
          {method !== 'CASH' && (
            <input
              className={inputCls}
              placeholder={method === 'ADVANCE' ? 'Adjustment reference / notes (optional)' : method === 'CHEQUE' ? 'Cheque number & bank' : method === 'BANK_TRANSFER' ? 'NEFT / RTGS reference' : 'Reference (UPI id / last 4 digits)'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={pay.isPending || !(entered > 0 && entered <= balance)} onClick={() => pay.mutate(entered)}>Record {amount ? rupees(entered) : 'payment'}</Button>
            <Button variant="ghost" disabled={pay.isPending} onClick={() => pay.mutate(balance)}>Full {rupees(balance)}</Button>
          </div>
          {inv.gatewayEnabled && (
            <div className="flex gap-2"><Button variant="ghost" className="flex-1" disabled={payLink.isPending} onClick={() => payLink.mutate(false)}><Link2 size={16} /> Online payment link</Button><Button variant="ghost" disabled={payLink.isPending} onClick={() => payLink.mutate(true)}>Link by SMS</Button></div>
          )}
          {link && <p className="break-all rounded-xl bg-brand-50 p-3 text-xs"><b>Payment link:</b> {link.url}{link.smsQueued && ' (SMS queued to the patient)'}<br /><span className="text-muted">The bill updates by itself when the patient pays.</span></p>}
        </div>
      )}

      {canRefund && (
        <div className="mt-4 print:hidden">
          {!refunding ? <button className="text-sm font-semibold text-red-600" onClick={() => { setRefunding(true); setRefundAmount(String(refundable / 100)) }}>Refund money to the patient</button> : (
            <div className="space-y-3 rounded-2xl bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">Refund (up to {rupees(refundable)})</p>
              <div className="flex gap-2"><input className={inputCls} inputMode="decimal" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ''))} /><div className="w-32 shrink-0"><Select value={method} onChange={setMethod} options={[...METHODS]} /></div></div>
              <input className={inputCls} placeholder="Reason (required)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
              <div className="flex gap-2"><Button className="flex-1" disabled={refund.isPending || refundReason.trim().length < 3 || !(Number(refundAmount) > 0)} onClick={() => refund.mutate()}>Refund {refundAmount ? rupees(Math.round(Number(refundAmount) * 100)) : ''}</Button><Button variant="ghost" onClick={() => setRefunding(false)}>Cancel</Button></div>
            </div>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err.message}</p>}
      <div className="mt-4 flex gap-2 print:hidden">
        <Button variant="ghost" className="flex-1" onClick={() => window.print()}><Printer size={16} /> Print receipt</Button>
        <Button variant="ghost" onClick={() => void openFile(`/invoices/${invoiceId}/pdf`)}><FileDown size={16} /> PDF</Button>
        {canVoid && <Button variant="ghost" onClick={() => voidIt.mutate()}>Void</Button>}
      </div>
    </Modal>
  )
}
