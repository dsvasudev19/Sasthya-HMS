import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Clock, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'

interface Perm { key: string; group: string; label: string; allowed: boolean; viaRoles: string[]; viaGrant: boolean; revoked: boolean }
interface Inspect {
  person: { id: string; name: string | null; phone: string }
  roles: { key: string; name: string }[]
  permissions: Perm[]
  overrides: { id: string; permission: string; effect: 'GRANT' | 'REVOKE'; reason: string; expiresAt: string | null; createdAt: string; active: boolean }[]
  policies: { id: string; name: string; permission: string; message: string }[]
  branchIds: string[]
}

/**
 * Everything about one person's access in one place: what each of their roles gives them, any personal exceptions (a grant to cover
 * a colleague, a revoke to keep someone out of billing), the policies that limit them, and why each permission is on or off.
 */
export default function Access({ personId, canEdit, onClose }: { personId: string; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['access', personId], queryFn: () => api<Inspect>(`/team/${personId}/access`) })
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ permission: '', effect: 'GRANT' as 'GRANT' | 'REVOKE', reason: '', days: '' })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['access', personId] }); qc.invalidateQueries({ queryKey: ['team'] }) }
  const add = useMutation({
    mutationFn: () => api(`/team/${personId}/overrides`, { method: 'POST', body: JSON.stringify({ permission: f.permission, effect: f.effect, reason: f.reason, expiresAt: f.days ? new Date(Date.now() + Number(f.days) * 86_400_000).toISOString() : null }) }),
    onSuccess: () => { setAdding(false); setF({ permission: '', effect: 'GRANT', reason: '', days: '' }); refresh() },
  })
  const remove = useMutation({ mutationFn: (id: string) => api(`/team/${personId}/overrides/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const groups = useMemo(() => [...new Set((data?.permissions ?? []).map((p) => p.group))].map((g) => ({ g, items: data!.permissions.filter((p) => p.group === g) })), [data])
  const options = useMemo(() => {
    const perms = data?.permissions ?? []
    return [...[...new Set(perms.map((p) => p.group))].map((g) => ({ value: `${perms.find((p) => p.group === g)!.key.split(':')[0]}:*`, label: `Everything in ${g}`, hint: 'whole group' })), ...perms.map((p) => ({ value: p.key, label: p.label, hint: p.group }))]
  }, [data])
  if (!data) return null
  const allowed = data.permissions.filter((p) => p.allowed).length

  return (
    <Modal title={`Access for ${data.person.name ?? data.person.phone}`} onClose={onClose} size="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {data.roles.map((r) => <span key={r.key} className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-100">{r.name}</span>)}
          <span className="ml-auto text-xs text-muted">{allowed} of {data.permissions.length} permissions</span>
        </div>

        <section>
          <div className="mb-2 flex items-center gap-2"><h3 className="text-sm font-semibold">Personal exceptions</h3>{canEdit && !adding && <button onClick={() => setAdding(true)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"><Plus size={13} /> Add exception</button>}</div>
          {data.overrides.length === 0 && !adding && <p className="rounded-xl bg-surface px-4 py-3 text-sm text-muted">None. This person has exactly what their {data.roles.length === 1 ? 'role gives' : 'roles give'} them.</p>}
          <ul className="space-y-2">
            {data.overrides.map((o) => (
              <li key={o.id} className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', o.active ? (o.effect === 'GRANT' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50') : 'border-line bg-surface opacity-60')}>
                <span className={clsx('mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold', o.effect === 'GRANT' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white')}>{o.effect === 'GRANT' ? 'GRANT' : 'REVOKE'}</span>
                <div className="min-w-0 flex-1"><p className="font-semibold">{options.find((x) => x.value === o.permission)?.label ?? o.permission}</p><p className="text-xs text-muted">{o.reason}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Clock size={11} />{o.expiresAt ? `${o.active ? 'Until' : 'Ended'} ${fmtDate(o.expiresAt)}` : 'No end date'}</p></div>
                {canEdit && <button onClick={() => remove.mutate(o.id)} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-red-600" aria-label="Remove exception"><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
          {adding && (
            <div className="mt-3 space-y-3 rounded-xl border border-line p-4">
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <Field label="Type"><Select value={f.effect} onChange={(effect) => setF({ ...f, effect })} options={[{ value: 'GRANT', label: 'Give' }, { value: 'REVOKE', label: 'Take away' }]} /></Field>
                <Field label="Permission"><Select value={f.permission} onChange={(permission) => setF({ ...f, permission })} placeholder="Choose" options={options} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <Field label="Why (kept in the audit trail)"><input className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Covering the pharmacy this week" /></Field>
                <Field label="Ends after (days, optional)"><input className={inputCls} inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, '') })} placeholder="No end" /></Field>
              </div>
              {add.error && <p className="text-sm text-red-600">{(add.error as Error).message}</p>}
              <div className="flex gap-2"><Button disabled={!f.permission || f.reason.trim().length < 3 || add.isPending} onClick={() => add.mutate()}><Check size={15} /> Save exception</Button><Button variant="ghost" onClick={() => setAdding(false)}><X size={15} /> Cancel</Button></div>
            </div>
          )}
          {remove.error && <p className="mt-2 text-sm text-red-600">{(remove.error as Error).message}</p>}
        </section>

        {data.policies.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck size={15} /> Policies that limit this person</h3>
            <ul className="space-y-1.5 text-sm">{data.policies.map((p) => <li key={p.id} className="rounded-xl bg-amber-50 px-4 py-2.5 ring-1 ring-amber-100"><b>{p.name}</b> <span className="text-muted">· {p.permission}</span><span className="block text-xs italic text-amber-900/80">“{p.message}”</span></li>)}</ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">What they can do, and why</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {groups.map(({ g, items }) => (
              <div key={g} className="rounded-xl bg-surface p-4 ring-1 ring-line">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g}</p>
                <ul className="space-y-1.5">
                  {items.map((p) => (
                    <li key={p.key} className="flex items-start gap-2 text-sm">
                      <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded text-[10px] font-bold', p.revoked ? 'bg-red-600 text-white' : p.allowed ? 'bg-brand-700 text-white' : 'bg-white text-transparent ring-1 ring-line')}>{p.revoked ? '×' : p.allowed ? '✓' : '·'}</span>
                      <span className="min-w-0"><span className={clsx(!p.allowed && 'text-muted', p.revoked && 'line-through')}>{p.label}</span>
                        {(p.viaRoles.length > 0 || p.viaGrant) && <span className="block text-[11px] text-muted">{[p.viaRoles.length ? `via ${p.viaRoles.join(', ')}` : '', p.viaGrant ? 'personal grant' : ''].filter(Boolean).join(' + ')}{p.revoked ? ' · revoked for this person' : ''}</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}
