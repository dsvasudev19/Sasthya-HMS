import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Button, Select } from '@hms/ui-web'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface Row { id: string; name: string; kind: string; status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'; planCode: string; trialEndsAt: string | null; createdAt: string; staff: number; patients: number; suspendedReason: string | null; lastInvoice: { status: string; totalPaise: number; dueDate: string } | null }
const TONE = { TRIAL: 'bg-sky-100 text-sky-700', ACTIVE: 'bg-brand-100 text-brand-700', SUSPENDED: 'bg-red-100 text-red-600', CLOSED: 'bg-stone-200 text-stone-600' } as const
const PLAN = { PAY_PER_PATIENT: 'Pay per patient', STARTER: 'Starter', UNLIMITED: 'Unlimited' } as Record<string, string>

export default function Hospitals() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | Row['status']>('')
  const nav = useNavigate()
  const { data = [] } = useQuery({ queryKey: ['hospitals', q, status], queryFn: () => api<Row[]>(`/platform/tenants?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) })}`) })
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Organizations</h1>
        <Button className="ml-auto" onClick={() => nav('/hospitals/new')}><Plus size={16} /> Onboard organization</Button>
        <div className="w-44"><Select value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, { value: 'TRIAL', label: 'Trial' }, { value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'CLOSED', label: 'Closed' }]} /></div>
        <div className="flex min-w-60 items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-line"><Search size={16} className="text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organizations" className="w-full bg-transparent text-sm outline-none" /></div>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Hospital', 'Plan', 'Status', 'Staff', 'Patients', 'Last invoice', 'Joined'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-surface/60" onClick={() => nav(`/hospitals/${t.id}`)}>
                <td className="px-4 py-3.5 font-semibold">{t.name}<div className="text-xs font-normal capitalize text-muted">{t.kind.toLowerCase()}</div></td>
                <td className="px-4 py-3.5 text-muted">{PLAN[t.planCode]}</td>
                <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${TONE[t.status]}`}>{t.status}</span></td>
                <td className="px-4 py-3.5">{t.staff}</td><td className="px-4 py-3.5">{t.patients}</td>
                <td className="px-4 py-3.5 text-muted">{t.lastInvoice ? `${rupees(t.lastInvoice.totalPaise)} · ${t.lastInvoice.status}` : '-'}</td>
                <td className="px-4 py-3.5 text-muted">{fmtDate(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <p className="py-10 text-center text-sm text-muted">No organizations found.</p>}
      </div>
          </div>
  )
}
