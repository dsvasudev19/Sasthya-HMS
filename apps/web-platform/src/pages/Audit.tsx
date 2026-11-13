import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { inputCls } from '@hms/ui-web'
import { api } from '../lib/api'

interface Row { id: string; action: string; operatorName: string | null; tenantName: string | null; targetType: string | null; createdAt: string; meta: unknown }

export default function Audit() {
  const [action, setAction] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data } = useQuery({ queryKey: ['audit', action], queryFn: () => api<{ rows: Row[] }>(`/platform/audit?${new URLSearchParams({ limit: '150', ...(action ? { action } : {}) })}`) })
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">Operator audit</h1><input className={`${inputCls} ml-auto !w-64`} placeholder="Filter, e.g. tenant. or flag." value={action} onChange={(e) => setAction(e.target.value)} /></div>
      <p className="mb-4 text-sm text-muted">Every change made from this console. It can't be edited or deleted.</p>
      <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
        {data?.rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span><span className="font-mono text-xs font-semibold">{r.action}</span> <span className="text-muted">· {r.operatorName ?? 'operator'}{r.tenantName ? ` · ${r.tenantName}` : ''}</span></span>
              <span className="text-xs text-muted">{new Date(r.createdAt).toLocaleString('en-IN')}</span>
            </button>
            {open === r.id && r.meta != null && <pre className="mt-2 overflow-x-auto rounded-xl bg-surface p-3 text-[11px]">{JSON.stringify(r.meta, null, 2)}</pre>}
          </li>
        ))}
        {data?.rows.length === 0 && <li className="py-10 text-center text-sm text-muted">Nothing yet.</li>}
      </ul>
    </div>
  )
}
