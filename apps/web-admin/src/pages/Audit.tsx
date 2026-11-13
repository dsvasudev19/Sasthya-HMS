import { useInfiniteQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { FileText, Shield, ShieldAlert, UserCog } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import { inputCls } from '../components/ui'

interface Row { id: string; action: string; entity: string; entityId: string | null; actorName: string | null; meta: Record<string, unknown> | null; createdAt: string }
interface Page { rows: Row[]; next: string | null }

const GROUPS = [{ k: '', label: 'Everything' }, { k: 'access.', label: 'Access changes' }, { k: 'document.', label: 'Documents' }, { k: 'history.', label: 'Record views' }, { k: 'prescription.', label: 'Prescriptions' }, { k: 'plan.', label: 'Plan' }] as const
const WORDS: Record<string, string> = {
  'access.role.create': 'Created a role', 'access.role.update': 'Changed a role', 'access.role.delete': 'Deleted a role', 'access.policy.create': 'Created a policy', 'access.policy.update': 'Changed a policy', 'access.policy.delete': 'Deleted a policy',
  'access.override.create': 'Gave a personal exception', 'access.override.remove': 'Removed a personal exception', 'access.team.roles': 'Changed someone\'s roles', 'access.team.branches': 'Changed someone\'s branches',
  'document.upload': 'Added a document', 'document.view': 'Opened a document', 'document.update': 'Edited a document', 'document.remove': 'Hid a document', 'document.view.patient': 'Patient opened a document',
  'history.view': 'Opened a patient record', 'prescription.print': 'Printed a prescription', 'clinical_profile.update': 'Edited allergies and conditions', 'plan.change': 'Changed the plan', 'fee.update': 'Changed a price', 'payment.unmatched': 'Unmatched online payment',
}
const icon = (a: string) => (a.startsWith('access.') ? <UserCog size={15} /> : a.startsWith('document.') || a.startsWith('prescription.') ? <FileText size={15} /> : a.startsWith('payment.') ? <ShieldAlert size={15} /> : <Shield size={15} />)
const detail = (r: Row) => {
  const m = r.meta ?? {}
  const bits = [m['key'] && `role ${m['key']}`, m['name'] && `“${m['name']}”`, m['permission'] && `${m['effect'] ?? ''} ${m['permission']}`.trim(), m['reason'] && `because: ${m['reason']}`, m['expiresAt'] && `until ${new Date(String(m['expiresAt'])).toLocaleDateString('en-IN')}`, Array.isArray(m['after']) && Array.isArray(m['before']) && `${(m['before'] as unknown[]).join(', ') || 'none'} → ${(m['after'] as unknown[]).join(', ') || 'none'}`].filter(Boolean)
  return bits.join(' · ')
}

/** Who did what, and when: access changes, record views, files, prescriptions. Read-only. */
export default function Audit() {
  const [group, setGroup] = useState<string>('')
  const [from, setFrom] = useState('')
  const q = useInfiniteQuery({
    queryKey: ['audit', group, from],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => api<Page>(`/audit?${new URLSearchParams({ limit: '50', ...(group ? { action: group } : {}), ...(from ? { from } : {}), ...(pageParam ? { before: pageParam } : {}) })}`),
    getNextPageParam: (last) => last.next ?? undefined,
  })
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? []
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Audit trail</h1><p className="text-sm text-muted">A permanent record of sensitive actions. It cannot be edited.</p></div>
        <input type="date" aria-label="From date" className={`${inputCls} !w-40 !py-2`} value={from} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5">{GROUPS.map((g) => <button key={g.k} onClick={() => setGroup(g.k)} className={clsx('rounded-full border px-3.5 py-1.5 text-xs font-semibold', group === g.k ? 'border-brand-700 bg-brand-700 text-white' : 'border-line bg-white hover:border-brand-300')}>{g.label}</button>)}</div>
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-5 py-3.5">
              <span className={clsx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', r.action.startsWith('access.') ? 'bg-violet-50 text-violet-700' : r.action.startsWith('payment.') ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600')}>{icon(r.action)}</span>
              <div className="min-w-0 flex-1"><p className="text-sm"><b>{r.actorName ?? 'System'}</b> · {WORDS[r.action] ?? r.action}</p>{detail(r) && <p className="mt-0.5 truncate text-xs text-muted">{detail(r)}</p>}</div>
              <time className="shrink-0 text-xs text-muted" dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</time>
            </li>
          ))}
          {!q.isLoading && rows.length === 0 && <li className="py-14 text-center text-sm text-muted">No activity matches.</li>}
        </ul>
      </div>
      {q.hasNextPage && <button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mx-auto block rounded-xl bg-white px-5 py-2.5 text-sm font-semibold ring-1 ring-line hover:bg-surface">{q.isFetchingNextPage ? 'Loading…' : 'Show older'}</button>}
    </div>
  )
}
