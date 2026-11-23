import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertCircle, FileDown, Plus, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api, openFile, printPdf } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'
import type { LabItem, LabOrder, LabTest, PatientRow } from '../lib/types'

const STATUS = {
  ORDERED: 'bg-sky-100 text-sky-700',
  COLLECTED: 'bg-amber-100 text-amber-700',
  RESULTED: 'bg-brand-100 text-brand-700',
  RELEASED: 'bg-brand-800 text-white',
  CANCELLED: 'bg-stone-200 text-stone-600',
} as const

const FLAG_CLS = {
  NORMAL: 'text-brand-700',
  LOW: 'text-amber-700',
  HIGH: 'text-amber-700',
  CRITICAL_LOW: 'font-bold text-red-600',
  CRITICAL_HIGH: 'font-bold text-red-600',
} as const

const FLAG_LABEL = {
  NORMAL: 'Normal',
  LOW: 'Low',
  HIGH: 'High',
  CRITICAL_LOW: 'CRITICAL LOW',
  CRITICAL_HIGH: 'CRITICAL HIGH',
} as const

const refresh = (qc: ReturnType<typeof useQueryClient>) => {
  for (const k of ['lab-orders', 'lab-stats', 'consult', 'invoices', 'collections']) qc.invalidateQueries({ queryKey: [k] })
}

function OrderModal({ initial, onClose }: { initial: LabOrder; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const [order, setOrder] = useState(initial)
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(initial.items.map((i) => [i.id, i.resultValue ?? i.resultText ?? ''])))
  const [barcode, setBarcode] = useState(order.sampleBarcode ?? '')
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const done = (o: LabOrder) => {
    setOrder(o)
    refresh(qc)
  }

  const collect = useMutation({
    mutationFn: () =>
      api<LabOrder>(`/lab/orders/${order.id}/collect`, {
        method: 'POST',
        body: JSON.stringify({ sampleBarcode: barcode.trim() || undefined }),
      }),
    onSuccess: done,
  })

  const reject = useMutation({
    mutationFn: () =>
      api<LabOrder>(`/lab/orders/${order.id}/sample-reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() }),
      }),
    onSuccess: (o) => {
      setRejecting(false)
      setRejectReason('')
      done(o)
    },
  })

  const save = useMutation({
    mutationFn: () =>
      api<LabOrder>(`/lab/orders/${order.id}/results`, {
        method: 'PUT',
        body: JSON.stringify({
          results: order.items.filter((i) => vals[i.id]?.trim()).map((i) => (i.refRange ? { itemId: i.id, resultValue: Number(vals[i.id]) } : { itemId: i.id, resultText: vals[i.id]!.trim() })),
        }),
      }),
    onSuccess: done,
  })

  const release = useMutation({
    mutationFn: (force: boolean) => api<LabOrder>(`/lab/orders/${order.id}/release`, { method: 'POST', body: JSON.stringify({ force }) }),
    onSuccess: done,
  })

  const canForce = can('lab:release_override')
  const editable = order.status === 'COLLECTED' || order.status === 'RESULTED'
  const unpaid = order.invoice && order.invoice.status !== 'PAID'
  const err = (collect.error || reject.error || save.error || release.error) as Error | null
  const resultOf = (i: LabItem) => i.resultValue ?? i.resultText ?? ''

  return (
    <Modal title={`${order.orderNo} · ${order.patient.fullName}`} onClose={onClose}>
      <div className="mb-3 flex items-center justify-between print:hidden">
        <span className="text-xs text-muted">UHID: {order.patient.patientNo} · {fmtDate(order.createdAt)}</span>
        <div className="flex gap-2">
          {order.status === 'RELEASED' && (
            <button
              onClick={() => void openFile(`/lab/orders/${order.id}/report.pdf`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
            >
              <FileDown size={14} /> PDF Report
            </button>
          )}
          <button
            onClick={() => void printPdf(`/lab/orders/${order.id}/labels.pdf?copies=${Math.min(4, Math.max(1, order.items.length))}`)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-line hover:bg-surface"
          >
            Print labels
          </button>
        </div>
      </div>

      <div id="receipt" className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">
            {order.sampleBarcode ? `Sample Barcode: ${order.sampleBarcode}` : 'No barcode assigned'}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS[order.status]}`}>{order.status}</span>
        </div>

        {order.rejectionReason && order.status === 'ORDERED' && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-800 ring-1 ring-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
            <div>
              <p className="font-semibold">Sample Previously Rejected</p>
              <p className="text-red-700">{order.rejectionReason}. Please recollect specimen with new barcode.</p>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <table className="w-full text-left">
            <thead className="bg-surface text-xs font-semibold">
              <tr>
                <th className="px-3 py-2">Test</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-2 font-medium">
                    {i.testName}
                    {i.method && <span className="block text-[11px] font-normal text-muted">{i.method}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <input
                          className={`${inputCls} !w-28 !py-1.5`}
                          inputMode={i.refRange ? 'decimal' : 'text'}
                          value={vals[i.id] ?? ''}
                          onChange={(e) => setVals((v) => ({ ...v, [i.id]: i.refRange ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value }))}
                          placeholder={i.refRange ? 'Value' : 'Result'}
                        />
                        <span className="text-xs text-muted">{i.unit}</span>
                        {i.flag && <span className={`text-xs ${FLAG_CLS[i.flag]}`}>{FLAG_LABEL[i.flag]}</span>}
                      </div>
                    ) : (
                      <span className={i.flag ? FLAG_CLS[i.flag] : ''}>
                        {resultOf(i) || '-'} {i.unit}
                        {i.flag && i.flag !== 'NORMAL' ? ` (${FLAG_LABEL[i.flag]})` : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{i.refRange ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {order.invoice && (
          <p className={clsx('text-xs', unpaid ? 'font-semibold text-red-600' : 'text-muted')}>
            Bill {order.invoice.invoiceNo}: {order.invoice.status === 'PAID' ? 'paid' : `${rupees(order.invoice.totalPaise - order.invoice.paidPaise)} due`}
          </p>
        )}
      </div>

      {rejecting && (
        <div className="mt-4 space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200 print:hidden">
          <p className="text-xs font-semibold text-red-800">Sample Rejection Reason</p>
          <input
            className={inputCls}
            placeholder="e.g. Hemolyzed, Clotted, Insufficient Quantity, Wrong Container"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              className="flex-1 !bg-red-600 text-xs hover:!bg-red-700"
              disabled={rejectReason.trim().length < 3 || reject.isPending}
              onClick={() => reject.mutate()}
            >
              Confirm Rejection & Re-order
            </Button>
            <Button variant="ghost" className="text-xs" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {err && <p className="mt-2 text-sm text-red-600">{err.message}</p>}

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {order.status === 'ORDERED' && (
          <div className="w-full space-y-2">
            <input
              className={inputCls}
              placeholder="Sample Barcode / Specimen ID (optional)"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
            <Button className="w-full" disabled={collect.isPending} onClick={() => collect.mutate()}>
              Mark sample collected
            </Button>
          </div>
        )}

        {editable && !rejecting && (
          <>
            <Button className="flex-1" variant={order.status === 'RESULTED' ? 'ghost' : 'primary'} disabled={save.isPending} onClick={() => save.mutate()}>
              Save results
            </Button>
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setRejecting(true)}>
              Reject sample
            </Button>
          </>
        )}

        {order.status === 'RESULTED' && !rejecting && (
          <Button className="flex-1" disabled={release.isPending} onClick={() => release.mutate(false)}>
            Release report
          </Button>
        )}

        {order.status === 'RESULTED' && unpaid && canForce && !rejecting && (
          <Button variant="ghost" onClick={() => release.mutate(true)}>
            Release unpaid
          </Button>
        )}

        {order.status === 'RELEASED' && (
          <>
            <Button className="flex-1" onClick={() => void openFile(`/lab/orders/${order.id}/report.pdf`)}>
              <FileDown size={16} /> Download Report PDF
            </Button>
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer size={16} /> Print View
            </Button>
          </>
        )}
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
    mutationFn: () =>
      api('/lab/orders', {
        method: 'POST',
        body: JSON.stringify({ patientId: patient!.id, testIds: picked, payment: method !== 'NONE' ? { method } : undefined }),
      }),
    onSuccess: () => {
      refresh(qc)
      onClose()
    },
  })

  return (
    <Modal title="New lab order" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} autoFocus /></Field>
        <Field label="Tests">
          <div className="flex flex-wrap gap-2">
            {tests.data?.map((t) => {
              const on = picked.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPicked((x) => (on ? x.filter((y) => y !== t.id) : [...x, t.id]))}
                  className={clsx('rounded-full border px-3 py-1.5 text-xs font-semibold', on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300')}
                >
                  {t.name} · {rupees(t.pricePaise)}
                </button>
              )
            })}
          </div>
        </Field>
        <Field label="Payment">
          <Select
            value={method}
            onChange={setMethod}
            options={[
              { value: 'CASH', label: 'Cash' },
              { value: 'UPI', label: 'UPI' },
              { value: 'CARD', label: 'Card' },
              { value: 'NONE', label: 'Bill only, pay later' },
            ]}
          />
        </Field>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button className="w-full" disabled={!patient || picked.length === 0 || create.isPending} onClick={() => create.mutate()}>
          {method === 'NONE' ? `Create order ${rupees(total)}` : `Collect ${rupees(total)} and order`}
        </Button>
      </div>
    </Modal>
  )
}

function NewTestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [department, setDepartment] = useState('Biochemistry')
  const [sampleType, setSampleType] = useState('Serum')
  const [method, setMethod] = useState('')
  const [price, setPrice] = useState('')
  const [unit, setUnit] = useState('')
  const [refLow, setRefLow] = useState('')
  const [refHigh, setRefHigh] = useState('')
  const [critLow, setCritLow] = useState('')
  const [critHigh, setCritHigh] = useState('')
  const [turnaroundHours, setTurnaroundHours] = useState('4')

  const create = useMutation({
    mutationFn: () =>
      api<LabTest>('/lab/tests', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          department: department.trim() || undefined,
          sampleType: sampleType.trim(),
          method: method.trim() || undefined,
          pricePaise: Math.round(Number(price) * 100),
          unit: unit.trim() || undefined,
          refLow: refLow ? Number(refLow) : undefined,
          refHigh: refHigh ? Number(refHigh) : undefined,
          critLow: critLow ? Number(critLow) : undefined,
          critHigh: critHigh ? Number(critHigh) : undefined,
          turnaroundHours: Number(turnaroundHours) || 4,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-tests'] })
      onClose()
    },
  })

  const valid = !!name.trim() && !!code.trim() && !!sampleType.trim() && Number(price) > 0

  return (
    <Modal title="Add New Lab Test" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Test Name">
            <input className={inputCls} placeholder="e.g. Complete Blood Count" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Test Code">
            <input className={inputCls} placeholder="e.g. CBC" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department">
            <input className={inputCls} placeholder="e.g. Hematology" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </Field>
          <Field label="Sample Type">
            <input className={inputCls} placeholder="e.g. Whole Blood EDTA" value={sampleType} onChange={(e) => setSampleType(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Analytical Method">
            <input className={inputCls} placeholder="e.g. Automated Analyzer" value={method} onChange={(e) => setMethod(e.target.value)} />
          </Field>
          <Field label="Price (₹)">
            <input className={inputCls} inputMode="decimal" placeholder="₹" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit">
            <input className={inputCls} placeholder="e.g. mg/dL" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Ref Low">
            <input className={inputCls} inputMode="decimal" placeholder="Min" value={refLow} onChange={(e) => setRefLow(e.target.value)} />
          </Field>
          <Field label="Ref High">
            <input className={inputCls} inputMode="decimal" placeholder="Max" value={refHigh} onChange={(e) => setRefHigh(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Crit Low">
            <input className={inputCls} inputMode="decimal" placeholder="Emergency Low" value={critLow} onChange={(e) => setCritLow(e.target.value)} />
          </Field>
          <Field label="Crit High">
            <input className={inputCls} inputMode="decimal" placeholder="Emergency High" value={critHigh} onChange={(e) => setCritHigh(e.target.value)} />
          </Field>
          <Field label="TAT (Hours)">
            <input className={inputCls} inputMode="numeric" value={turnaroundHours} onChange={(e) => setTurnaroundHours(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        {create.error && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
        <Button className="mt-2 w-full" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
          Create Test in Catalog
        </Button>
      </div>
    </Modal>
  )
}

function Catalog() {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<LabTest | null>(null)
  const [addingTest, setAddingTest] = useState(false)
  const [price, setPrice] = useState('')
  const { data = [] } = useQuery({ queryKey: ['lab-tests'], queryFn: () => api<LabTest[]>('/lab/tests') })

  const save = useMutation({
    mutationFn: () => api(`/lab/tests/${edit!.id}`, { method: 'PATCH', body: JSON.stringify({ pricePaise: Math.round(Number(price) * 100) }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-tests'] })
      setEdit(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddingTest(true)}>
          <Plus size={16} /> Add Test to Catalog
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold">
            <tr>
              {['Test', 'Department', 'Sample', 'Method', 'Reference Interval', 'Price'].map((h) => (
                <th key={h} className="px-4 py-3.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-surface/60" onClick={() => { setEdit(t); setPrice(String(t.pricePaise / 100)) }}>
                <td className="px-4 py-3.5 font-semibold">
                  {t.name}
                  <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-muted">{t.code}</span>
                </td>
                <td className="px-4 py-3.5 text-muted">{t.department || '-'}</td>
                <td className="px-4 py-3.5 capitalize text-muted">{t.sampleType.toLowerCase()}</td>
                <td className="px-4 py-3.5 text-xs text-muted">{t.method || '-'}</td>
                <td className="px-4 py-3.5 text-muted">
                  {t.refLow !== null || t.refHigh !== null ? `${t.refLow ?? ''} - ${t.refHigh ?? ''} ${t.unit ?? ''}` : 'Qualitative'}
                </td>
                <td className="px-4 py-3.5 font-medium">{rupees(t.pricePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.name} onClose={() => setEdit(null)}>
          <div className="space-y-4">
            <Field label="Price (₹)">
              <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} autoFocus />
            </Field>
            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
            <Button className="w-full" disabled={!price || save.isPending} onClick={() => save.mutate()}>
              Save price
            </Button>
          </div>
        </Modal>
      )}

      {addingTest && <NewTestModal onClose={() => setAddingTest(false)} />}
    </div>
  )
}

export default function Lab() {
  const [tab, setTab] = useState<'orders' | 'catalog'>('orders')
  const [status, setStatus] = useState<'' | LabOrder['status']>('')
  const [open, setOpen] = useState<LabOrder | null>(null)
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    const id = params.get('order')
    if (id) {
      setParams({}, { replace: true })
      api<LabOrder>(`/lab/orders/${id}`).then(setOpen).catch(() => undefined)
    }
  }, [params, setParams])

  const { can } = useAuth()
  const canOrder = can('lab:order')

  const { data = [] } = useQuery({
    queryKey: ['lab-orders', status],
    queryFn: () => api<LabOrder[]>(`/lab/orders${status ? `?status=${status}` : ''}`),
    refetchInterval: 20_000,
  })

  const { data: stats } = useQuery({
    queryKey: ['lab-stats'],
    queryFn: () => api<{ ordered: number; collected: number; resulted: number; released: number; critical: number }>('/lab/stats'),
    refetchInterval: 15_000,
  })

  const chips: { v: '' | LabOrder['status']; label: string }[] = [
    { v: '', label: 'All' },
    { v: 'ORDERED', label: 'To collect' },
    { v: 'COLLECTED', label: 'To result' },
    { v: 'RESULTED', label: 'To release' },
    { v: 'RELEASED', label: 'Released' },
  ]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Laboratory</h1>
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['orders', 'Orders'], ['catalog', 'Tests and prices']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx('rounded-full px-5 py-2 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'orders' && canOrder && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus size={18} /> New order
          </Button>
        )}
      </div>

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-2xl bg-surface p-3.5 ring-1 ring-line">
            <p className="text-xs font-medium text-muted">To Collect</p>
            <p className="text-2xl font-bold text-ink">{stats.ordered}</p>
          </div>
          <div className="rounded-2xl bg-amber-50/70 p-3.5 ring-1 ring-amber-200">
            <p className="text-xs font-medium text-amber-800">To Result</p>
            <p className="text-2xl font-bold text-amber-900">{stats.collected}</p>
          </div>
          <div className="rounded-2xl bg-brand-50/70 p-3.5 ring-1 ring-brand-200">
            <p className="text-xs font-medium text-brand-800">To Release</p>
            <p className="text-2xl font-bold text-brand-900">{stats.resulted}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50/70 p-3.5 ring-1 ring-emerald-200">
            <p className="text-xs font-medium text-emerald-800">Released</p>
            <p className="text-2xl font-bold text-emerald-900">{stats.released}</p>
          </div>
          <div className={clsx('rounded-2xl p-3.5 ring-1', stats.critical > 0 ? 'bg-red-50 ring-red-300' : 'bg-surface ring-line')}>
            <p className={clsx('text-xs font-medium', stats.critical > 0 ? 'text-red-700' : 'text-muted')}>Critical Alerts</p>
            <p className={clsx('text-2xl font-bold', stats.critical > 0 ? 'text-red-600' : 'text-ink')}>{stats.critical}</p>
          </div>
        </div>
      )}

      {tab === 'catalog' ? (
        <Catalog />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.v}
                onClick={() => setStatus(c.v)}
                className={clsx('rounded-full px-4 py-2 text-sm font-medium ring-1', status === c.v ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-muted ring-line')}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold">
                <tr>
                  {['Order', 'Patient', 'Tests', 'Bill', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(o)}>
                    <td className="px-4 py-3.5 font-semibold">
                      {o.orderNo}
                      <div className="text-xs font-normal text-muted">{fmtDate(o.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      {o.patient.fullName}
                      <div className="text-xs text-muted">{o.patient.patientNo}</div>
                    </td>
                    <td className="px-4 py-3.5 text-muted">
                      {o.items.map((i) => i.testName).join(', ')}
                      {o.items.some((i) => i.flag?.startsWith('CRITICAL')) && <span className="ml-2 font-bold text-red-600">CRITICAL</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      {o.invoice ? (
                        <span className={o.invoice.status === 'PAID' ? 'text-brand-700' : 'font-semibold text-red-600'}>
                          {o.invoice.status === 'PAID' ? 'Paid' : `${rupees(o.invoice.totalPaise - o.invoice.paidPaise)} due`}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS[o.status]}`}>{o.status}</span>
                    </td>
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
