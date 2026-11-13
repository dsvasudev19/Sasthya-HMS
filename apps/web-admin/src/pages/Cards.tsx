import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import CardDetailModal from '../components/CardDetailModal'
import IssueCardModal from '../components/IssueCardModal'
import { Button } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'
import type { CardDetail, CardListRow } from '../lib/types'

export default function Cards() {
  const [q, setQ] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [open, setOpen] = useState<{ id: string; initial?: CardDetail } | null>(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['cards', q], queryFn: () => api<CardListRow[]>(`/cards?q=${encodeURIComponent(q)}`) })
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Health cards</h1>
        <div className="ml-auto flex min-w-64 items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-line">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Card number, owner or phone" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <Button onClick={() => setIssuing(true)}><Plus size={18} /> Issue card</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Card', 'Owner', 'Plan', 'Members', 'Plan valid till', ''].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((c) => {
              const expired = !c.planEndsAt || new Date(c.planEndsAt) < new Date()
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen({ id: c.id })}>
                  <td className="px-4 py-3.5 font-semibold tracking-wide">{c.cardNo}</td>
                  <td className="px-4 py-3.5">{c.owner.fullName}</td>
                  <td className="px-4 py-3.5 text-muted">{c.plan.type === 'FAMILY' ? 'Family' : 'Individual'}</td>
                  <td className="px-4 py-3.5 text-muted">{c.members.length}/{c.plan.maxMembers}</td>
                  <td className="px-4 py-3.5 text-muted">{fmtDate(c.planEndsAt)}</td>
                  <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${expired ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-700'}`}>{expired ? 'Renew due' : 'Active'}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!isLoading && data.length === 0 && <p className="py-10 text-center text-sm text-muted">No cards yet. Issue the first one.</p>}
      </div>
      {issuing && <IssueCardModal onClose={() => setIssuing(false)} onIssued={(c) => { setIssuing(false); setOpen({ id: c.id, initial: c }) }} />}
      {open && <CardDetailModal cardId={open.id} initial={open.initial} onClose={() => setOpen(null)} />}
    </div>
  )
}
