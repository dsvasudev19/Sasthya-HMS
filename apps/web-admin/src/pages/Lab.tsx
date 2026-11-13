import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Plus, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api, printPdf } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'
import type { LabItem, LabOrder, LabTest, PatientRow } from '../lib/types'

const STATUS = { ORDERED: 'bg-sky-100 text-sky-700', COLLECTED: 'bg-amber-100 text-amber-700', RESULTED: 'bg-brand-100 text-brand-700', RELEASED: 'bg-brand-800 text-white', CANCELLED: 'bg-stone-200 text-stone-600' } as const
const FLAG_CLS = { NORMAL: 'text-brand-700', LOW: 'text-amber-700', HIGH: 'text-amber-700', CRITICAL_LOW: 'font-bold text-red-600', CRITICAL_HIGH: 'font-bold text-red-600' } as const
const FLAG_LABEL = { NORMAL: 'Normal', LOW: 'Low', HIGH: 'High', CRITICAL_LOW: 'CRITICAL LOW', CRITICAL_HIGH: 'CRITICAL HIGH' } as const
const refresh = (qc: ReturnType<typeof useQueryClient>) => { for (const k of ['lab-orders', 'consult', 'invoices', 'collections']) qc.invalidateQueries({ queryKey: [k] }) }

function OrderModal({ initial, onClose }: { initial: LabOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [order, setOrder] = useState(initial)
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(initial.items.map((i) => [i.id, i.resultValue ?? i.resultText ?? ''])))
  const done = (o: LabOrder) => { setOrder(o); refresh(qc) }
  const collect = useMutation({ mutationFn: () => api<LabOrder>(`/lab/orders/${order.id}/collect`, { method: 'POST' }), onSuccess: done })
  const save = useMutation({
    mutationFn: () => api<LabOrder>(`/lab/orders/${order.id}/results`, {
      method: 'PUT',
      body: JSON.stringify({ results: order.items.filter((i) => vals[i.id]?.trim()).map((i) => (i.refRange ? { itemId: i.id, resultValue: Number(vals[i.id]) } : { itemId: i.id, resultText: vals[i.id]!.trim() })) }),
    }),
    onSuccess: done,
  })
  const release = useMutation({ mutationFn: (force: boolean) => api<LabOrder>(`/lab/orders/${order.id}/release`, { method: 'POST', body: JSON.stringify({ force }) }), onSuccess: done })
  const canForce = can('lab:release_override')
  const editable = order.status === 'COLLECTED' || order.status === 'RESULTED'
  const unpaid = order.invoice && order.invoice.status !== 'PAID'
  const err = (collect.error || save.error || release.error) as Error | null
  const resultOf = (i: LabItem) => (i.resultValue ?? i.resultText ?? '')

  return (
    <Modal title={`${order.orderNo} · ${order.patient.fullName}`} onClose={onClose}>
      <div className="mb-3 flex justify-end print:hidden"><button onClick={() => void printPdf(`/lab/orders/${order.id}/labels.pdf?copies=${Math.min(4, Math.max(1, order.items.length))}`)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-line hover:bg-surface">Print sample labels</button></div>
      <div id="receipt" className="space-y-4 text-sm">
        <div className="flex items-center justify-between"><span className="text-xs text-muted">{order.patient.patientNo} · {fmtDate(order.createdAt)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS[order.status]}`}>{order.status}</span></div>
        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <table className="w-full text-left"><thead className="bg-surface text-xs font-semibold"><tr><th className="px-3 py-2">Test</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Reference</th></tr></thead>
            <tbody className="divide-y divide-line">
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2 font-medium">{i.testName}</td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <div className="flex items-center gap-2"><input className={`${inputCls} !w-28 !py-1.5`} inputMode={i.refRange ? 'decimal' : 'text'} value={vals[i.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [i.id]: i.refRange ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value }))} placeholder={i.refRange ? 'Value' : 'Result'} /><span className="text-xs text-muted">{i.unit}</span>
                        {i.flag && <span className={`text-xs ${FLAG_CLS[i.flag]}`}>{FLAG_LABEL[i.flag]}</span>}</div>
                    ) : <span className={i.flag ? FLAG_CLS[i.flag] : ''}>{resultOf(i) || '-'} {i.unit}{i.flag && i.flag !== 'NORMAL' ? ` (${FLAG_LABEL[i.flag]})` : ''}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{i.refRange ?? '-'}</td>
                </tr>
              ))}
            </tbody></table>
        </div>
        {order.invoice && <p className={clsx('text-xs', unpaid ? 'font-semibold text-red-600' : 'text-muted')}>Bill {order.invoice.invoiceNo}: {order.invoice.status === 'PAID' ? 'paid' : `${rupees(order.invoice.totalPaise - order.invoice.paidPaise)} due`}</p>}
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err.message}</p>}
      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {order.status === 'ORDERED' && <Button className="flex-1" disabled={collect.isPending} onClick={() => collect.mutate()}>Mark sample collected</Button>}
        {editable && <Button className="flex-1" variant={order.status === 'RESULTED' ? 'ghost' : 'primary'} disabled={save.isPending} onClick={() => save.mutate()}>Save results</Button>}
        {order.status === 'RESULTED' && <Button className="flex-1" disabled={release.isPending} onClick={() => release.mutate(false)}>Release report</Button>}
        {order.status === 'RESULTED' && unpaid && canForce && <Button variant="ghost" onClick={() => release.mutate(true)}>Release unpaid</Button>}
        {order.status === 'RELEASED' && <Button className="flex-1" variant="ghost" onClick={() => window.print()}><Printer size={16} /> Print report</Button>}
      </div>
    </Modal>
  )
}

function NewOrderModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'NONE'>('CASH')
  const tests = useQuery({ queryKey: ['lab-tests'], queryFn: () => api<LabTest[]>('/lab/tests') })
  const total = picked.reduce((s, id) => s + (tests.data?.find((t) => t.id === id)?.pricePaise ?? 0), 0)
  const create = useMutation({
    mutationFn: () => api('/lab/orders', { method: 'POST', body: JSON.stringify({ patientId: patient!.id, testIds: picked, payment: method !== 'NONE' ? { method } : undefined }) }),
    onSuccess: () => { refresh(qc); onClose() },
  })
  return (
    <Modal title="New lab order" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus /></Field>
        <Field label="Tests">
          <div className="flex flex-wrap gap-2">
            {tests.data?.map((t) => { const on = picked.includes(t.id); return <button key={t.id} type="button" onClick={() => setPicked((x) => (on ? x.filter((y) => y !== t.id) : [...x, t.id]))} className={clsx('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300')}>{t.name} · {rupees(t.pricePaise)}</button> })}
          </div>
        </Field>
        <Field label="Payment"><Select value={method} onChange={setMethod} options={[{ value: 'CASH', label: 'Cash' }, { value: 'UPI', label: 'UPI' }, { value: 'CARD', label: 'Card' }, { value: 'NONE', label: 'Bill only, pay later' }]} /></Field>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button className="w-full" disabled={!patient || picked.length === 0 || create.isPending} onClick={() => create.mutate()}>{method === 'NONE' ? `Create order ${rupees(total)}` : `Collect ${rupees(total)} and order`}</Button>
      </div>
    </Modal>
  )
}

function Catalog() {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<LabTest | null>(null)
  const [price, setPrice] = useState('')
  const { data = [] } = useQuery({ queryKey: ['lab-tests'], queryFn: () => api<LabTest[]>('/lab/tests') })
  const save = useMutation({ mutationFn: () => api(`/lab/tests/${edit!.id}`, { method: 'PATCH', body: JSON.stringify({ pricePaise: Math.round(Number(price) * 100) }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['lab-tests'] }); setEdit(null) } })
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-surface text-xs font-semibold"><tr>{['Test', 'Sample', 'Reference', 'Price'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {data.map((t) => (
            <tr key={t.id} className="cursor-pointer hover:bg-surface/60" onClick={() => { setEdit(t); setPrice(String(t.pricePaise / 100)) }}>
              <td className="px-4 py-3.5 font-semibold">{t.name}<span className="ml-2 text-xs font-normal text-muted">{t.code}</span></td>
              <td className="px-4 py-3.5 capitalize text-muted">{t.sampleType.toLowerCase()}</td>
              <td className="px-4 py-3.5 text-muted">{t.refLow !== null || t.refHigh !== null ? `${t.refLow ?? ''} - ${t.refHigh ?? ''} ${t.unit ?? ''}` : 'Text result'}</td>
              <td className="px-4 py-3.5">{rupees(t.pricePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <Modal title={edit.name} onClose={() => setEdit(null)}>
          <div className="space-y-4"><Field label="Price (₹)"><input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} autoFocus /></Field>
            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
            <Button className="w-full" disabled={!price || save.isPending} onClick={() => save.mutate()}>Save price</Button></div>
        </Modal>
      )}
    </div>
  )
}

export default function Lab() {
  const [tab, setTab] = useState<'orders' | 'catalog'>('orders')
  const [status, setStatus] = useState<'' | LabOrder['status']>('')
  const [open, setOpen] = useState<LabOrder | null>(null)
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  // A scanned sample label arrives as /lab?order=<id>.
  useEffect(() => { const id = params.get('order'); if (id) { setParams({}, { replace: true }); api<LabOrder>(`/lab/orders/${id}`).then(setOpen).catch(() => undefined) } }, [params, setParams])
  const { can } = useAuth()
  const canOrder = can('lab:order')
  const { data = [] } = useQuery({ queryKey: ['lab-orders', status], queryFn: () => api<LabOrder[]>(`/lab/orders${status ? `?status=${status}` : ''}`), refetchInterval: 20_000 })
  const chips: { v: '' | LabOrder['status']; label: string }[] = [{ v: '', label: 'All' }, { v: 'ORDERED', label: 'To collect' }, { v: 'COLLECTED', label: 'To result' }, { v: 'RESULTED', label: 'To release' }, { v: 'RELEASED', label: 'Released' }]
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Laboratory</h1>
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['orders', 'Orders'], ['catalog', 'Tests and prices']] as const).map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={clsx('rounded-full px-5 py-2 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>)}
        </div>
        {tab === 'orders' && canOrder && <Button className="ml-auto" onClick={() => setAdding(true)}><Plus size={18} /> New order</Button>}
      </div>
      {tab === 'catalog' ? <Catalog /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">{chips.map((c) => <button key={c.v} onClick={() => setStatus(c.v)} className={clsx('rounded-full px-4 py-2 text-sm font-medium ring-1', status === c.v ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-muted ring-line')}>{c.label}</button>)}</div>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold"><tr>{['Order', 'Patient', 'Tests', 'Bill', 'Status'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(o)}>
                    <td className="px-4 py-3.5 font-semibold">{o.orderNo}<div className="text-xs font-normal text-muted">{fmtDate(o.createdAt)}</div></td>
                    <td className="px-4 py-3.5">{o.patient.fullName}<div className="text-xs text-muted">{o.patient.patientNo}</div></td>
                    <td className="px-4 py-3.5 text-muted">{o.items.map((i) => i.testName).join(', ')}{o.items.some((i) => i.flag?.startsWith('CRITICAL')) && <span className="ml-2 font-bold text-red-600">CRITICAL</span>}</td>
                    <td className="px-4 py-3.5">{o.invoice ? <span className={o.invoice.status === 'PAID' ? 'text-brand-700' : 'font-semibold text-red-600'}>{o.invoice.status === 'PAID' ? 'Paid' : `${rupees(o.invoice.totalPaise - o.invoice.paidPaise)} due`}</span> : '-'}</td>
                    <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS[o.status]}`}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 && <p className="py-10 text-center text-sm text-muted">No lab orders here.</p>}
          </div>
        </>
      )}
      {open && <OrderModal key={open.id} initial={open} onClose={() => setOpen(null)} />}
      {adding && <NewOrderModal onClose={() => setAdding(false)} />}
    </div>
  )
}
