import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { FileDown, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import InvoiceModal from '../components/InvoiceModal'
import NewInvoiceModal from '../components/NewInvoiceModal'
import NewAdvanceModal from '../components/NewAdvanceModal'
import Select from '../components/Select'
import { Button, Field, inputCls } from '../components/ui'
import { api, openFile } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'
import type { Closing, Collections, InvoiceRow, PatientAdvance } from '../lib/types'

const BADGE = { PAID: 'bg-brand-100 text-brand-700', PARTIAL: 'bg-amber-100 text-amber-700', UNPAID: 'bg-red-100 text-red-600', REFUNDED: 'bg-stone-200 text-stone-600', VOID: 'bg-stone-200 text-stone-600' } as const
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

function Invoices() {
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  // A scanned bill barcode arrives as /billing?invoice=<id> and opens straight to payment.
  useEffect(() => { const id = params.get('invoice'); if (id) { setOpen(id); setParams({}, { replace: true }) } }, [params, setParams])
  const { data = [], isLoading } = useQuery({ queryKey: ['invoices', status, q], queryFn: () => api<InvoiceRow[]>(`/invoices?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`) })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-44"><Select value={status} onChange={setStatus} options={[{ value: '', label: 'All bills' }, { value: 'UNPAID', label: 'Unpaid' }, { value: 'PARTIAL', label: 'Part paid' }, { value: 'PAID', label: 'Paid' }, { value: 'REFUNDED', label: 'Refunded' }, { value: 'VOID', label: 'Void' }]} /></div>
        <div className="ml-auto flex min-w-60 items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-line">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice number or patient" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <Button onClick={() => setAdding(true)}><Plus size={18} /> New bill</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Invoice', 'Patient', 'Date', 'Total', 'Paid', 'Status'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(i.id)}>
                <td className="px-4 py-3.5 font-semibold">{i.invoiceNo}</td>
                <td className="px-4 py-3.5">{i.patient?.fullName ?? i.customerName ?? 'Walk-in'}</td>
                <td className="px-4 py-3.5 text-muted">{fmtDate(i.createdAt)}</td>
                <td className="px-4 py-3.5">{rupees(i.totalPaise)}</td>
                <td className="px-4 py-3.5 text-muted">{rupees(i.paidPaise)}</td>
                <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[i.status]}`}>{i.status === 'PARTIAL' ? 'Part paid' : i.status.charAt(0) + i.status.slice(1).toLowerCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && data.length === 0 && <p className="py-10 text-center text-sm text-muted">No bills found.</p>}
      </div>
      {open && <InvoiceModal invoiceId={open} onClose={() => setOpen(null)} />}
      {adding && <NewInvoiceModal onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); setOpen(id) }} />}
    </div>
  )
}

function CollectionsTab() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [date, setDate] = useState(today())
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const canClose = can('billing:close')
  const { data } = useQuery({ queryKey: ['collections', date], queryFn: () => api<Collections>(`/billing/collections?date=${date}`) })
  const history = useQuery({ queryKey: ['closings'], queryFn: () => api<Closing[]>('/billing/closings') })
  const close = useMutation({
    mutationFn: () => api('/billing/closings', { method: 'POST', body: JSON.stringify({ date, countedCashPaise: Math.round(Number(counted) * 100), notes: notes || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['collections'] }); qc.invalidateQueries({ queryKey: ['closings'] }); setCounted(''); setNotes('') },
  })
  const stat = (label: string, paise: number, accent?: boolean) => (
    <div className={clsx('rounded-2xl p-5 ring-1 ring-line', accent ? 'bg-brand-100' : 'bg-surface')}><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{rupees(paise)}</p></div>
  )
  const diff = data?.closing ? data.closing.countedCashPaise - data.closing.expectedCashPaise : 0
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-auto`} /><span className="text-sm text-muted">{data?.paymentCount ?? 0} payments · {data?.invoicesIssued ?? 0} bills</span></div>
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stat('Collected', data.collectedPaise, true)}{stat('Cash', data.byMethod.CASH)}{stat('UPI', data.byMethod.UPI)}{stat('Card', data.byMethod.CARD)}
          {data.refundedPaise > 0 && stat('Refunded today', data.refundedPaise)}{stat('Billed', data.billedPaise)}{stat('Outstanding', data.outstandingPaise)}
        </div>
      )}
      {data && (data.closing ? (
        <div className="rounded-2xl bg-brand-50 p-5 ring-1 ring-brand-200 text-sm">
          <p className="font-semibold text-brand-800">Day closed</p>
          <p className="mt-1">Expected cash {rupees(data.closing.expectedCashPaise)} · counted {rupees(data.closing.countedCashPaise)} · <span className={diff === 0 ? 'text-brand-700' : 'font-semibold text-red-600'}>{diff === 0 ? 'matches' : `${diff > 0 ? 'over' : 'short'} by ${rupees(Math.abs(diff))}`}</span></p>
        </div>
      ) : canClose ? (
        <div className="max-w-md space-y-3 rounded-2xl p-5 ring-1 ring-line">
          <p className="font-semibold">Close the day</p>
          <p className="text-xs text-muted">Count the cash in the drawer. The system expects {rupees(data.byMethod.CASH)}.</p>
          <Field label="Cash counted (₹)"><input className={inputCls} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="Notes (optional)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {close.error && <p className="text-sm text-red-600">{(close.error as Error).message}</p>}
          <Button disabled={counted === '' || close.isPending} onClick={() => close.mutate()}>Close {fmtDate(date)}</Button>
        </div>
      ) : <p className="text-sm text-muted">The owner or an admin closes the day.</p>)}
      {(history.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Recent closings</h3>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold"><tr>{['Date', 'Collected', 'Expected cash', 'Counted', 'Difference'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {history.data!.map((c) => (
                  <tr key={c.id}><td className="px-4 py-3">{fmtDate(c.date)}</td><td className="px-4 py-3">{rupees(c.totalCollectedPaise)}</td><td className="px-4 py-3 text-muted">{rupees(c.expectedCashPaise)}</td><td className="px-4 py-3 text-muted">{rupees(c.countedCashPaise)}</td>
                    <td className={clsx('px-4 py-3 font-semibold', c.differencePaise === 0 ? 'text-brand-700' : 'text-red-600')}>{c.differencePaise === 0 ? 'Matches' : `${c.differencePaise > 0 ? '+' : '-'}${rupees(Math.abs(c.differencePaise))}`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AdvancesTab() {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const { data = [], isLoading } = useQuery({
    queryKey: ['advances'],
    queryFn: () => api<PatientAdvance[]>('/billing/advances'),
  })

  const filtered = data.filter((a) => {
    if (!q.trim()) return true
    const term = q.toLowerCase()
    return (
      a.receiptNo.toLowerCase().includes(term) ||
      a.patient?.fullName.toLowerCase().includes(term) ||
      (a.patient?.patientNo && a.patient.patientNo.toLowerCase().includes(term))
    )
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="ml-auto flex min-w-60 items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-line">
          <Search size={16} className="text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search receipt no or patient"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={18} /> Record advance deposit
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold">
            <tr>
              {['Receipt No', 'Patient', 'Date', 'Deposit Amount', 'Available Balance', 'Method', ''].map((h) => (
                <th key={h} className="px-4 py-3.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((a) => (
              <tr key={a.id} className="hover:bg-surface/60">
                <td className="px-4 py-3.5 font-semibold text-brand-800">{a.receiptNo}</td>
                <td className="px-4 py-3.5">
                  <p className="font-medium">{a.patient?.fullName ?? 'Unknown'}</p>
                  <p className="text-xs text-muted">{a.patient?.patientNo}</p>
                </td>
                <td className="px-4 py-3.5 text-muted">{fmtDate(a.createdAt)}</td>
                <td className="px-4 py-3.5 font-semibold">{rupees(a.amountPaise)}</td>
                <td className="px-4 py-3.5">
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                      a.balancePaise > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-stone-200 text-stone-600'
                    )}
                  >
                    {a.balancePaise > 0 ? rupees(a.balancePaise) + ' available' : 'Fully adjusted'}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-xs font-medium text-muted">
                  {a.method} {a.reference ? `· ${a.reference}` : ''}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <Button
                    variant="ghost"
                    className="!px-3 !py-1 text-xs"
                    onClick={() => void openFile(`/advances/${a.id}/receipt.pdf`)}
                  >
                    <FileDown size={14} /> Receipt
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">No advance deposits recorded yet.</p>
        )}
      </div>

      {adding && <NewAdvanceModal onClose={() => setAdding(false)} />}
    </div>
  )
}

export default function Billing() {
  const [tab, setTab] = useState<'invoices' | 'advances' | 'collections'>('invoices')
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['invoices', 'Bills'], ['advances', 'Patient Advances'], ['collections', 'Collections']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('rounded-full px-5 py-2 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>
          ))}
        </div>
      </div>
      {tab === 'invoices' ? <Invoices /> : tab === 'advances' ? <AdvancesTab /> : <CollectionsTab />}
    </div>
  )
}
