import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button, inputCls } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate, rupees } from '../../lib/format'
import { csv, PageHead, Stat, Table, Tabs } from './shared'

interface Sales { bills: number; totalPaise: number; taxPaise: number; returnsPaise: number; returnsCount: number; netPaise: number; byDay: { day: string; totalPaise: number; bills: number }[]; byMethod: { method: string; totalPaise: number }[]; topItems: { medicineId: string; name: string; qty: number; revenuePaise: number; marginPaise: number | null }[]; marginPaise: number; marginPercent: number | null }
interface StockValue { items: { medicineId: string; name: string; qty: number; costValuePaise: number; sellingValuePaise: number }[]; costValuePaise: number; sellingValuePaise: number }
interface Expiry { id: string; medicine: string; branch: string; batchNo: string; expiryDate: string; qtyOnHand: number; expired: boolean; atRiskPaise: number }

export default function Reports() {
  const today = new Date().toISOString().slice(0, 10)
  const [tab, setTab] = useState<'sales' | 'stock' | 'expiry'>('sales')
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const [days, setDays] = useState('90')
  const sales = useQuery({ queryKey: ['rep-sales', from, to], queryFn: () => api<Sales>(`/pharmacy/reports/sales?from=${from}&to=${to}`), enabled: tab === 'sales' })
  const stock = useQuery({ queryKey: ['rep-stock'], queryFn: () => api<StockValue>('/pharmacy/reports/stock-value'), enabled: tab === 'stock' })
  const exp = useQuery({ queryKey: ['rep-exp', days], queryFn: () => api<Expiry[]>(`/pharmacy/reports/expiry?days=${days}`), enabled: tab === 'expiry' })
  const s = sales.data
  const max = Math.max(1, ...(s?.byDay.map((d) => d.totalPaise) ?? [1]))
  return (
    <div>
      <PageHead title="Reports" sub="For the branch you are viewing"><Tabs value={tab} onChange={setTab} tabs={[{ k: 'sales', label: 'Sales' }, { k: 'stock', label: 'Stock value' }, { k: 'expiry', label: 'Expiry' }]} /></PageHead>
      {tab === 'sales' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm"><input type="date" className={`${inputCls} !w-40 !py-2`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /><span className="text-muted">to</span><input type="date" className={`${inputCls} !w-40 !py-2`} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
            {s && <Button variant="ghost" className="ml-auto" onClick={() => csv('sales.csv', [['Day', 'Bills', 'Sales'], ...s.byDay.map((d) => [d.day, d.bills, d.totalPaise / 100])])}><Download size={16} /> CSV</Button>}</div>
          {s && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat tone="green" label="Net sales" value={rupees(s.netPaise)} sub={`${s.bills} bills`} /><Stat label="Returns" value={rupees(s.returnsPaise)} sub={`${s.returnsCount} returns`} /><Stat label="GST collected" value={rupees(s.taxPaise)} /><Stat label="Gross margin" value={rupees(s.marginPaise)} sub={s.marginPercent === null ? 'needs purchase cost' : `${s.marginPercent}% on top sellers`} /></div>
              <div className="rounded-2xl p-5 ring-1 ring-line"><p className="mb-3 text-sm font-semibold">Sales by day</p>
                <div className="flex h-40 items-end gap-1.5">{s.byDay.map((d) => <div key={d.day} className="group relative flex-1" title={`${fmtDate(d.day)}: ${rupees(d.totalPaise)} (${d.bills} bills)`}><div className="rounded-t-md bg-brand-400 transition group-hover:bg-brand-700" style={{ height: `${Math.max(3, (d.totalPaise / max) * 100)}%` }} /></div>)}{s.byDay.length === 0 && <p className="m-auto text-sm text-muted">No sales in this period.</p>}</div></div>
              <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
                <Table head={['Top medicines', 'Sold', 'Revenue', 'Margin']} empty={s.topItems.length ? undefined : 'Nothing sold.'}>{s.topItems.map((t) => <tr key={t.medicineId}><td className="px-4 py-3 font-medium">{t.name}</td><td className="px-4 py-3">{t.qty}</td><td className="px-4 py-3">{rupees(t.revenuePaise)}</td><td className="px-4 py-3 text-muted">{t.marginPaise === null ? '-' : rupees(t.marginPaise)}</td></tr>)}</Table>
                <div className="rounded-2xl p-5 ring-1 ring-line"><p className="mb-3 text-sm font-semibold">Payment mix</p><ul className="space-y-2 text-sm">{s.byMethod.map((m) => <li key={m.method} className="flex justify-between"><span>{m.method}</span><b>{rupees(m.totalPaise)}</b></li>)}</ul></div>
              </div>
            </>
          )}
        </div>
      )}
      {tab === 'stock' && stock.data && (
        <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Stat label="Stock at cost" value={rupees(stock.data.costValuePaise)} /><Stat tone="green" label="Stock at selling price" value={rupees(stock.data.sellingValuePaise)} /></div>
          <Table head={['Medicine', 'Units', 'At cost', 'At price']}>{stock.data.items.map((i) => <tr key={i.medicineId}><td className="px-4 py-3 font-medium">{i.name}</td><td className="px-4 py-3">{i.qty}</td><td className="px-4 py-3 text-muted">{rupees(i.costValuePaise)}</td><td className="px-4 py-3">{rupees(i.sellingValuePaise)}</td></tr>)}</Table></div>
      )}
      {tab === 'expiry' && (
        <div className="space-y-3"><div className="flex gap-2">{['30', '60', '90', '180'].map((d) => <button key={d} onClick={() => setDays(d)} className={`rounded-full px-4 py-2 text-sm font-medium ring-1 ${days === d ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white ring-line'}`}>{d} days</button>)}</div>
          <Table head={['Medicine', 'Branch', 'Batch', 'Expiry', 'Units', 'Cost at risk']} empty={exp.data?.length === 0 ? 'Nothing expires in this window.' : undefined}>{exp.data?.map((b) => <tr key={b.id}><td className="px-4 py-3 font-medium">{b.medicine}</td><td className="px-4 py-3 text-muted">{b.branch}</td><td className="px-4 py-3">{b.batchNo}</td><td className={`px-4 py-3 ${b.expired ? 'font-semibold text-red-600' : ''}`}>{fmtDate(b.expiryDate)}{b.expired && ' (expired)'}</td><td className="px-4 py-3">{b.qtyOnHand}</td><td className="px-4 py-3">{rupees(b.atRiskPaise)}</td></tr>)}</Table></div>
      )}
    </div>
  )
}
