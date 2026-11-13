import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, Wallet } from 'lucide-react'
import { useState } from 'react'
import Select from '../../components/Select'
import { Button, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'
import { PageHead, Stat, Table } from './shared'

interface Row { patient: { id: string; fullName: string; phone: string | null; patientNo: string }; duePaise: number; bills: number; oldest: string }
interface Detail { patient: Row['patient']; bills: { id: string; invoiceNo: string; createdAt: string; totalPaise: number; paidPaise: number }[]; duePaise: number; recent: { id: string; amountPaise: number; method: string; receivedAt: string; invoice: { invoiceNo: string } }[] }

function Account({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['receivable', id], queryFn: () => api<Detail>(`/pharmacy/receivables/${id}`) })
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH')
  const [ref, setRef] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const collect = useMutation({
    mutationFn: () => api<{ remainingPaise: number; applied: { invoiceNo: string; amountPaise: number }[] }>(`/pharmacy/receivables/${id}/collect`, { method: 'POST', body: JSON.stringify({ amountPaise: Math.round(Number(amount) * 100), method, reference: ref || undefined }) }),
    onSuccess: (r) => { setDone(`Received. ${r.applied.map((a) => `${a.invoiceNo} ${rupees(a.amountPaise)}`).join(', ')}.`); setAmount(''); setRef(''); for (const k of ['receivable', 'receivables', 'pos-shift']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  if (!data) return null
  const entered = Math.round(Number(amount) * 100)
  return (
    <Modal title={data.patient.fullName} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <div><p className="text-xs text-amber-900/70">Owes the pharmacy</p><p className="text-2xl font-bold text-amber-900">{rupees(data.duePaise)}</p></div>
          {data.patient.phone && <a href={`tel:${data.patient.phone}`} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 font-semibold ring-1 ring-amber-200"><Phone size={14} />{data.patient.phone}</a>}
        </div>
        {data.duePaise > 0 && (
          <div className="space-y-2 rounded-2xl p-4 ring-1 ring-line">
            <div className="grid gap-2 sm:grid-cols-[1fr_130px_1fr_auto]">
              <input className={inputCls} inputMode="decimal" placeholder="Amount received (₹)" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setDone(null) }} />
              <Select value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }]} />
              <input className={inputCls} placeholder="Reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <Button disabled={collect.isPending || !(entered > 0 && entered <= data.duePaise)} onClick={() => collect.mutate()}><Wallet size={15} /> Take</Button>
            </div>
            <button className="text-xs font-semibold text-brand-700" onClick={() => setAmount(String(data.duePaise / 100))}>Settle in full ({rupees(data.duePaise)})</button>
            {collect.error && <p className="text-red-600">{(collect.error as Error).message}</p>}
            {done && <p className="rounded-xl bg-brand-50 px-3 py-2 font-semibold text-brand-800">{done}</p>}
          </div>
        )}
        <Table head={['Bill', 'Date', 'Total', 'Paid', 'Balance']}>
          {data.bills.map((b) => <tr key={b.id}><td className="px-4 py-2.5 font-semibold">{b.invoiceNo}</td><td className="px-4 py-2.5 text-muted">{fmtDate(b.createdAt)}</td><td className="px-4 py-2.5">{rupees(b.totalPaise)}</td><td className="px-4 py-2.5 text-muted">{rupees(b.paidPaise)}</td><td className="px-4 py-2.5 font-semibold text-amber-700">{rupees(b.totalPaise - b.paidPaise)}</td></tr>)}
        </Table>
        {data.recent.length > 0 && <div><p className="mb-1.5 text-xs font-semibold text-muted">Recent payments</p><ul className="space-y-1 text-xs text-muted">{data.recent.map((p) => <li key={p.id} className="flex justify-between"><span>{fmtDate(p.receivedAt)} · {p.invoice.invoiceNo} · {p.method.toLowerCase()}</span><b className="text-ink">{rupees(p.amountPaise)}</b></li>)}</ul></div>}
      </div>
    </Modal>
  )
}

/** Customers who bought on credit: who owes what, for how long, and a place to take their payment. */
export default function Credit() {
  const { data = [], isLoading } = useQuery({ queryKey: ['receivables'], queryFn: () => api<Row[]>('/pharmacy/receivables') })
  const [open, setOpen] = useState<string | null>(null)
  const total = data.reduce((a, r) => a + r.duePaise, 0)
  const old = data.filter((r) => Date.now() - new Date(r.oldest).getTime() > 30 * 86_400_000)
  return (
    <div>
      <PageHead title="Customer credit" sub="People who took medicines now and will pay later. Link a registered customer at the counter to leave a balance." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3"><Stat tone={total ? 'amber' : 'plain'} label="Total owed to you" value={rupees(total)} sub={`${data.length} customers`} /><Stat tone={old.length ? 'red' : 'plain'} label="Over a month old" value={old.length} sub={old.length ? rupees(old.reduce((a, r) => a + r.duePaise, 0)) : 'nothing overdue'} /></div>
      <Table head={['Customer', 'Phone', 'Open bills', 'Since', 'Owes', '']} empty={!isLoading && data.length === 0 ? 'Nobody owes the pharmacy. All sales were paid at the counter.' : undefined}>
        {data.map((r) => <tr key={r.patient.id} className="hover:bg-surface/60"><td className="px-4 py-3"><b>{r.patient.fullName}</b><span className="block text-xs text-muted">{r.patient.patientNo}</span></td><td className="px-4 py-3 text-muted">{r.patient.phone ?? '-'}</td><td className="px-4 py-3">{r.bills}</td><td className="px-4 py-3 text-muted">{fmtDate(r.oldest)}</td><td className="px-4 py-3 font-bold text-amber-700">{rupees(r.duePaise)}</td><td className="px-3 py-3 text-right"><Button className="!px-3 !py-1.5 text-xs" onClick={() => setOpen(r.patient.id)}>Take payment</Button></td></tr>)}
      </Table>
      {open && <Account id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
