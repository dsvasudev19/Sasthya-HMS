import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, ClipboardList, PackageX, Receipt, RotateCcw, ShoppingCart, TimerReset } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { Button } from '../../components/ui'
import { api } from '../../lib/api'
import { rupees } from '../../lib/format'
import type { PendingRx } from '../../lib/types'
import { PageHead, Stat, Table } from './shared'

interface Dash {
  salesPaise: number; salesCount: number; returnsPaise: number; returnsCount: number
  lowStock: number; expiringSoon: number; expired: number; waitingPrescriptions: number; shiftOpen: boolean
  topItems: { medicineId: string; name: string; qty: number; amountPaise: number }[]
}

export default function Dashboard() {
  const nav = useNavigate()
  const { can, branch, branchId } = useAuth()
  const { data: d } = useQuery({ queryKey: ['pharmacy-dashboard', branchId], queryFn: () => api<Dash>('/pharmacy/dashboard'), refetchInterval: 60_000 })
  const rx = useQuery({ queryKey: ['pharmacy-rx'], queryFn: () => api<PendingRx[]>('/pharmacy/prescriptions'), enabled: can('pharmacy:pos') })
  if (!d) return null
  return (
    <div>
      <PageHead title="Pharmacy dashboard" sub={`${branchId === 'all' ? 'All branches' : branch?.name ?? ''} · today`}>
        {can('pharmacy:pos') && <Button onClick={() => nav('/pharmacy/pos')}><ShoppingCart size={18} /> {d.shiftOpen ? 'Go to counter' : 'Open counter'}</Button>}
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat tone="green" label="Sales today" value={rupees(d.salesPaise)} sub={`${d.salesCount} ${d.salesCount === 1 ? 'bill' : 'bills'}`} />
        <Stat label="Returns today" value={rupees(d.returnsPaise)} sub={`${d.returnsCount} ${d.returnsCount === 1 ? 'return' : 'returns'}`} onClick={can('pharmacy:returns') ? () => nav('/pharmacy/returns') : undefined} />
        <Stat tone={d.waitingPrescriptions ? 'amber' : 'plain'} label="Prescriptions waiting" value={d.waitingPrescriptions} sub="from doctors, not yet dispensed" onClick={can('pharmacy:pos') ? () => nav('/pharmacy/pos') : undefined} />
        <Stat label="Net today" value={rupees(d.salesPaise - d.returnsPaise)} sub="sales minus returns" />
        <Stat tone={d.lowStock ? 'amber' : 'plain'} label="Low stock" value={d.lowStock} sub="at or below reorder level" onClick={() => nav('/pharmacy/inventory?view=low')} />
        <Stat tone={d.expiringSoon ? 'amber' : 'plain'} label="Expiring in 60 days" value={d.expiringSoon} sub="batches with stock" onClick={() => nav('/pharmacy/inventory?view=alerts')} />
        <Stat tone={d.expired ? 'red' : 'plain'} label="Expired on shelf" value={d.expired} sub={d.expired ? 'remove and write off' : 'nothing to remove'} onClick={() => nav('/pharmacy/inventory?view=alerts')} />
        <Stat tone={d.shiftOpen ? 'green' : 'plain'} label="Your counter" value={d.shiftOpen ? 'Open' : 'Closed'} sub={d.shiftOpen ? 'shift running' : 'open a shift to sell'} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Best sellers today</h2>
          <Table head={['Medicine', 'Sold', 'Revenue']} empty={d.topItems.length ? undefined : 'No sales yet today.'}>
            {d.topItems.map((t) => <tr key={t.medicineId}><td className="px-4 py-3 font-medium">{t.name}</td><td className="px-4 py-3">{t.qty}</td><td className="px-4 py-3">{rupees(t.amountPaise)}</td></tr>)}
          </Table>
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ClipboardList size={15} /> Waiting at the counter</h2>
          <div className="space-y-2">
            {rx.data?.slice(0, 5).map((r) => (
              <button key={r.id} onClick={() => nav(`/pharmacy/pos?rx=${r.id}`)} className="flex w-full items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-line hover:bg-brand-50">
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{r.patient.fullName}</p><p className="truncate text-xs text-muted">{r.items.map((i) => i.name).join(', ')}</p></div><ArrowRight size={16} className="text-muted" />
              </button>
            ))}
            {rx.data?.length === 0 && <p className="rounded-2xl bg-surface py-8 text-center text-sm text-muted">No prescriptions are waiting.</p>}
          </div>
        </section>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: <PackageX size={18} />, text: 'Check what is expiring', to: '/pharmacy/inventory?view=alerts', perm: 'pharmacy:read' },
          { icon: <TimerReset size={18} />, text: 'Reorder low stock', to: '/pharmacy/purchases', perm: 'pharmacy:purchase' },
          { icon: <RotateCcw size={18} />, text: 'Take a return', to: '/pharmacy/returns', perm: 'pharmacy:returns' },
          { icon: <Receipt size={18} />, text: 'See sales reports', to: '/pharmacy/reports', perm: 'pharmacy:reports' },
          { icon: <AlertTriangle size={18} />, text: 'Write off damaged stock', to: '/pharmacy/inventory', perm: 'pharmacy:write' },
        ].filter((x) => can(x.perm)).map((x) => <button key={x.to + x.text} onClick={() => nav(x.to)} className="flex items-center gap-3 rounded-2xl bg-surface p-4 text-left text-sm font-medium ring-1 ring-line hover:bg-brand-50">{x.icon}{x.text}</button>)}
      </div>
    </div>
  )
}
