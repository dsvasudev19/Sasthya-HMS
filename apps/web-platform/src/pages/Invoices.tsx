import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Button, Field, inputCls, Modal } from '@hms/ui-web'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface Inv { id: string; invoiceNo: string; periodStart: string; planCode: string; subtotalPaise: number; gstPaise: number; totalPaise: number; status: 'DUE' | 'PAID' | 'VOID'; dueDate: string; paidAt: string | null; paymentRef: string | null; tenant: { id: string; name: string }; lines: { description: string; quantity: number; amountPaise: number }[] }
const TONE = { DUE: 'bg-amber-100 text-amber-700', PAID: 'bg-brand-100 text-brand-700', VOID: 'bg-stone-200 text-stone-600' } as const
const thisMonth = () => new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 7)

export default function Invoices() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<'' | Inv['status']>('DUE')
  const [open, setOpen] = useState<Inv | null>(null)
  const [ref, setRef] = useState('')
  const [month, setMonth] = useState(thisMonth())
  const { data = [] } = useQuery({ queryKey: ['p-invoices', status], queryFn: () => api<Inv[]>(`/platform/invoices${status ? `?status=${status}` : ''}`) })
  const refresh = () => { for (const k of ['p-invoices', 'overview', 'hospitals']) qc.invalidateQueries({ queryKey: [k] }) }
  const gen = useMutation({ mutationFn: () => api<{ created: number }>('/platform/invoices/generate', { method: 'POST', body: JSON.stringify({ month }) }), onSuccess: refresh })
  const enforce = useMutation({ mutationFn: () => api<{ suspended: number; reactivated: number; trialsEnded: number }>('/platform/enforce', { method: 'POST', body: '{}' }), onSuccess: refresh })
  const pay = useMutation({ mutationFn: () => api(`/platform/invoices/${open!.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentRef: ref }) }), onSuccess: () => { refresh(); setOpen(null); setRef('') } })
  const voidIt = useMutation({ mutationFn: () => api(`/platform/invoices/${open!.id}/void`, { method: 'POST' }), onSuccess: () => { refresh(); setOpen(null) } })
  const overdue = (i: Inv) => i.status === 'DUE' && new Date(i.dueDate) < new Date()

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Invoices</h1>
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['DUE', 'Due'], ['PAID', 'Paid'], ['', 'All']] as const).map(([k, label]) => <button key={k} onClick={() => setStatus(k)} className={clsx('rounded-full px-5 py-2 text-sm font-medium', status === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${inputCls} w-auto`} />
          <Button variant="ghost" disabled={gen.isPending} onClick={() => gen.mutate()}>Generate invoices</Button>
          <Button variant="ghost" disabled={enforce.isPending} onClick={() => enforce.mutate()}>Run dunning</Button>
        </div>
      </div>
      {gen.data && <p className="mb-3 text-sm text-muted">{gen.data.created} invoice{gen.data.created === 1 ? '' : 's'} created.</p>}
      {enforce.data && <p className="mb-3 text-sm text-muted">{enforce.data.suspended} suspended, {enforce.data.reactivated} reactivated, {enforce.data.trialsEnded} trials moved to billing.</p>}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Invoice', 'Hospital', 'Month', 'Total (with GST)', 'Due', 'Status'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(i)}>
                <td className="px-4 py-3.5 font-semibold">{i.invoiceNo}</td><td className="px-4 py-3.5">{i.tenant.name}</td><td className="px-4 py-3.5 text-muted">{i.periodStart.slice(0, 7)}</td>
                <td className="px-4 py-3.5">{rupees(i.totalPaise)}</td><td className={clsx('px-4 py-3.5', overdue(i) ? 'font-semibold text-red-600' : 'text-muted')}>{fmtDate(i.dueDate)}{overdue(i) && ' (overdue)'}</td>
                <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE[i.status]}`}>{i.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <p className="py-10 text-center text-sm text-muted">No invoices here.</p>}
      </div>
      {open && (
        <Modal title={open.invoiceNo} onClose={() => setOpen(null)}>
          <div className="space-y-4 text-sm">
            <p className="font-semibold">{open.tenant.name}</p>
            <table className="w-full"><tbody className="divide-y divide-line">{open.lines.map((l, k) => <tr key={k}><td className="py-2">{l.description}{l.quantity > 1 && <span className="text-muted"> × {l.quantity}</span>}</td><td className="py-2 text-right">{rupees(l.amountPaise)}</td></tr>)}</tbody></table>
            <div className="space-y-1 border-t border-line pt-3"><p className="flex justify-between text-muted"><span>Subtotal</span><span>{rupees(open.subtotalPaise)}</span></p><p className="flex justify-between text-muted"><span>GST 18%</span><span>{rupees(open.gstPaise)}</span></p><p className="flex justify-between text-base font-bold"><span>Total</span><span>{rupees(open.totalPaise)}</span></p></div>
            {open.status === 'DUE' ? (
              <div className="space-y-3">
                <Field label="Payment reference (UPI / bank)"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR or UPI reference" autoFocus /></Field>
                {(pay.error || voidIt.error) && <p className="text-red-600">{((pay.error || voidIt.error) as Error).message}</p>}
                <div className="flex gap-2"><Button className="flex-1" disabled={ref.trim().length < 2 || pay.isPending} onClick={() => pay.mutate()}>Record payment</Button><Button variant="ghost" disabled={voidIt.isPending} onClick={() => voidIt.mutate()}>Void</Button></div>
              </div>
            ) : <p className="text-muted">{open.status === 'PAID' ? `Paid ${fmtDate(open.paidAt)} · ${open.paymentRef}` : 'Void'}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
