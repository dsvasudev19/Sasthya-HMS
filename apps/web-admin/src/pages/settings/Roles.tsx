import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { grants, useAuth } from '../../auth'
import { Button, Field, inputCls } from '../../components/ui'
import { api } from '../../lib/api'

export interface RoleRow { id: string; key: string; name: string; description: string | null; isSystem: boolean; customized: boolean; permissions: string[]; members: number }
interface PermDef { key: string; group: string; label: string }
interface Catalog { permissions: PermDef[] }

export const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') })

/** Tick-box matrix, one card per area. People can only hand out permissions they hold themselves. */
function Matrix({ catalog, value, onChange, disabled }: { catalog: PermDef[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { me } = useAuth()
  const groups = useMemo(() => [...new Set(catalog.map((p) => p.group))].map((g) => ({ g, items: catalog.filter((p) => p.group === g) })), [catalog])
  const all = value.includes('*')
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map(({ g, items }) => (
        <div key={g} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g}</p>
          <ul className="space-y-1.5">
            {items.map((p) => {
              const mine = grants(me?.permissions ?? [], p.key)
              const on = all || value.includes(p.key)
              return (
                <li key={p.key}>
                  <button type="button" disabled={disabled || all || !mine} onClick={() => toggle(p.key)} className="flex w-full items-start gap-2.5 text-left text-sm disabled:cursor-not-allowed" title={mine ? '' : 'You do not have this permission yourself'}>
                    <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded border text-[10px] font-bold', on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white', !mine && 'opacity-40')}>{on ? '✓' : ''}</span>
                    <span className={clsx(!mine && 'text-muted')}>{p.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Editor({ role, catalog, onClose }: { role: RoleRow | null; catalog: PermDef[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ key: role?.key ?? '', name: role?.name ?? '', description: role?.description ?? '', permissions: role?.permissions ?? [] })
  const owner = role?.key === 'OWNER'
  const save = useMutation({
    mutationFn: () => role
      ? api(`/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({ name: f.name, description: f.description, permissions: f.permissions }) })
      : api('/roles', { method: 'POST', body: JSON.stringify({ ...f, description: f.description || undefined }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); onClose() },
  })
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-card bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4"><h2 className="text-lg font-semibold">{role ? `Edit ${role.name}` : 'New role'}</h2><button onClick={onClose} className="px-2 text-2xl leading-none text-muted hover:text-ink" aria-label="Close">×</button></div>
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><input className={inputCls} value={f.name} disabled={owner} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={!role} /></Field>
            <Field label="Key (cannot change later)"><input className={clsx(inputCls, 'font-mono uppercase')} value={f.key} disabled={!!role} placeholder="BILLING_CLERK" onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /></Field>
            <Field label="Description"><input className={inputCls} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          </div>
          {owner ? <p className="rounded-2xl bg-surface p-4 text-sm text-muted">The owner role always has every permission and cannot be changed.</p> : <Matrix catalog={catalog} value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} />}
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {!owner && <Button disabled={save.isPending || f.name.trim().length < 2 || (!role && f.key.length < 2)} onClick={() => save.mutate()}>{role ? 'Save changes' : 'Create role'}</Button>}
        </div>
      </div>
    </div>
  )
}

export default function Roles() {
  const qc = useQueryClient()
  const { data: roles } = useRoles()
  const { data: cat } = useQuery({ queryKey: ['permissions'], queryFn: () => api<Catalog>('/permissions') })
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)
  const remove = useMutation({ mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }) })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="max-w-xl text-sm text-muted">Roles decide what each person can see and do. Start from the built-in roles or create your own, for example a billing clerk or a night nurse.</p>
        <Button className="ml-auto" onClick={() => setEditing('new')}><Plus size={18} /> New role</Button>
      </div>
      {remove.error && <p className="mb-3 text-sm text-red-600">{(remove.error as Error).message}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles?.map((r) => (
          <div key={r.id} className="flex flex-col rounded-2xl p-5 ring-1 ring-line">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-semibold">{r.name}</p><p className="font-mono text-[11px] text-muted">{r.key}</p></div>
              <span className="flex gap-1.5">{r.isSystem && <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted"><Lock size={10} />Built in</span>}{r.customized && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Edited</span>}</span>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{r.description}</p>
            <p className="mt-3 text-xs text-muted">{r.permissions.includes('*') ? 'Every permission' : `${r.permissions.length} permissions`} · {r.members} {r.members === 1 ? 'person' : 'people'}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" className="flex-1 !py-2" onClick={() => setEditing(r)}>{r.key === 'OWNER' ? 'View' : 'Edit'}</Button>
              {!r.isSystem && <button className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-600" aria-label="Delete role" onClick={() => { if (confirm(`Delete the ${r.name} role?`)) remove.mutate(r.id) }}><Trash2 size={16} /></button>}
            </div>
          </div>
        ))}
      </div>
      {editing && cat && <Editor role={editing === 'new' ? null : editing} catalog={cat.permissions} onClose={() => setEditing(null)} />}
    </div>
  )
}
