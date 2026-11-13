import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, inputCls, Select } from '@hms/ui-web'
import { api } from '../lib/api'

interface Ann { id: string; title: string; body: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; allTenants: boolean; tenantIds: string[]; startsAt: string; endsAt: string | null }
const TONE = { INFO: 'bg-sky-100 text-sky-700', WARNING: 'bg-amber-100 text-amber-700', CRITICAL: 'bg-red-100 text-red-600' } as const

export default function Announcements() {
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['announcements'], queryFn: () => api<Ann[]>('/platform/announcements') })
  const { data: hospitals = [] } = useQuery({ queryKey: ['hospitals', '', ''], queryFn: () => api<{ id: string; name: string }[]>('/platform/tenants') })
  const [f, setF] = useState({ title: '', body: '', severity: 'INFO' as Ann['severity'], all: true, ids: [] as string[], endsAt: '' })
  const create = useMutation({
    mutationFn: () => api('/platform/announcements', { method: 'POST', body: JSON.stringify({ title: f.title, body: f.body, severity: f.severity, allTenants: f.all, tenantIds: f.all ? [] : f.ids, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null }) }),
    onSuccess: () => { setF({ ...f, title: '', body: '', endsAt: '' }); qc.invalidateQueries({ queryKey: ['announcements'] }) },
  })
  const del = useMutation({ mutationFn: (id: string) => api(`/platform/announcements/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }) })
  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_3fr]">
      <div className="space-y-4 text-sm">
        <h1 className="text-3xl font-semibold tracking-tight">Announcements</h1>
        <p className="text-muted">A banner shown to hospital staff at the top of their dashboard.</p>
        <Field label="Title"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message"><textarea className={inputCls} rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Importance"><Select value={f.severity} onChange={(severity) => setF({ ...f, severity })} options={[{ value: 'INFO', label: 'Information' }, { value: 'WARNING', label: 'Warning' }, { value: 'CRITICAL', label: 'Critical' }]} /></Field>
          <Field label="Hide after (optional)"><input type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} /> Show to every hospital</label>
        {!f.all && <ul className="max-h-44 space-y-1 overflow-y-auto rounded-xl p-3 ring-1 ring-line">{hospitals.map((h) => <li key={h.id}><label className="flex items-center gap-2"><input type="checkbox" checked={f.ids.includes(h.id)} onChange={(e) => setF({ ...f, ids: e.target.checked ? [...f.ids, h.id] : f.ids.filter((x) => x !== h.id) })} /> {h.name}</label></li>)}</ul>}
        {create.error && <p className="text-red-600">{(create.error as Error).message}</p>}
        <Button disabled={f.title.trim().length < 3 || f.body.trim().length < 3 || create.isPending} onClick={() => create.mutate()}>Publish</Button>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold">Published</h2>
        <ul className="space-y-3">
          {data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-2xl p-4 ring-1 ring-line">
              <div className="min-w-0 flex-1 text-sm"><p className="font-semibold"><span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${TONE[a.severity]}`}>{a.severity}</span>{a.title}</p><p className="mt-1 text-muted">{a.body}</p>
                <p className="mt-2 text-xs text-muted">{a.allTenants ? 'All hospitals' : `${a.tenantIds.length} hospital(s)`} · from {new Date(a.startsAt).toLocaleDateString('en-IN')}{a.endsAt ? ` until ${new Date(a.endsAt).toLocaleDateString('en-IN')}` : ''}</p></div>
              <button aria-label="Remove" onClick={() => confirm('Remove this announcement?') && del.mutate(a.id)} className="text-muted hover:text-red-600"><Trash2 size={16} /></button>
            </li>
          ))}
          {data.length === 0 && <p className="text-sm text-muted">Nothing published.</p>}
        </ul>
      </div>
    </div>
  )
}
