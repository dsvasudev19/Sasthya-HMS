import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import Select from '../../components/Select'
import { Button, Field, inputCls } from '../../components/ui'
import { api } from '../../lib/api'
import { useRoles } from './Roles'

interface Cond { attr: string; op: string; value: number | string | (string | number)[] }
interface PolicyRow { id: string; name: string; description?: string | null; enabled: boolean; permission: string; appliesToRoles: string[]; exceptRoles: string[]; match: 'ALL' | 'ANY'; conditions: Cond[]; validFrom: string | null; validUntil: string | null; message: string }
interface Catalog { permissions: { key: string; group: string; label: string }[]; attributes: { attr: string; label: string; type: 'number' | 'list' | 'text'; hint: string }[] }

const OPS: Record<string, string> = { gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', eq: 'is', ne: 'is not', in: 'is one of', notIn: 'is none of', containsAny: 'includes any of', notContainsAny: 'includes none of' }
const opsFor = (type: string) => type === 'number' ? ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'] : type === 'list' ? ['containsAny', 'notContainsAny'] : ['eq', 'ne', 'in', 'notIn']

function describe(p: PolicyRow, cat: Catalog) {
  const perm = cat.permissions.find((x) => x.key === p.permission)?.label ?? p.permission
  const who = p.appliesToRoles.length ? p.appliesToRoles.join(', ') : 'anyone'
  const when = p.conditions.map((c) => `${cat.attributes.find((a) => a.attr === c.attr)?.label ?? c.attr} ${OPS[c.op] ?? c.op} ${Array.isArray(c.value) ? c.value.join(', ') : c.value}`).join(p.match === 'ANY' ? ' or ' : ' and ')
  const window = p.validFrom || p.validUntil ? ` ${p.validFrom ? `from ${new Date(p.validFrom).toLocaleDateString('en-IN')}` : ''}${p.validUntil ? ` until ${new Date(p.validUntil).toLocaleDateString('en-IN')}` : ''}` : ''
  return `Blocks "${perm}" for ${who}${p.exceptRoles.length ? ` (except ${p.exceptRoles.join(', ')})` : ''}${when ? ` when ${when}` : ''}${window ? `,${window}` : ''}.`
}

function Builder({ cat, policy, onClose }: { cat: Catalog; policy: PolicyRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: roles } = useRoles()
  const [f, setF] = useState<Omit<PolicyRow, 'id'>>(policy ?? { name: '', description: '', enabled: true, permission: 'billing:write', appliesToRoles: [], exceptRoles: [], match: 'ALL', conditions: [{ attr: 'discountPercent', op: 'gt', value: 10 }], validFrom: null, validUntil: null, message: '' })
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
  const [raw, setRaw] = useState<string[]>(() => f.conditions.map((c) => (Array.isArray(c.value) ? c.value.join(', ') : String(c.value))))
  const toValue = (attr: string, text: string): Cond['value'] => {
    const type = cat.attributes.find((a) => a.attr === attr)?.type
    if (type === 'number') return Number(text)
    return text.includes(',') || type === 'list' ? text.split(',').map((x) => x.trim()).filter(Boolean) : text.trim()
  }
  const body = { ...f, description: f.description || undefined, validFrom: f.validFrom ? new Date(f.validFrom).toISOString() : null, validUntil: f.validUntil ? new Date(f.validUntil).toISOString() : null, conditions: f.conditions.map((c, i) => ({ ...c, value: toValue(c.attr, raw[i] ?? '') })) }
  const save = useMutation({
    mutationFn: () => policy ? api(`/policies/${policy.id}`, { method: 'PUT', body: JSON.stringify(body) }) : api('/policies', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); onClose() },
  })
  const setCond = (i: number, c: Partial<Cond>) => setF({ ...f, conditions: f.conditions.map((x, j) => (j === i ? { ...x, ...c } : x)) })
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-card bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4"><h2 className="text-lg font-semibold">{policy ? 'Edit policy' : 'New policy'}</h2><button onClick={onClose} className="px-2 text-2xl leading-none text-muted hover:text-ink" aria-label="Close">×</button></div>
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Reception discount limit" autoFocus /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Block this action"><Select value={f.permission} onChange={(permission) => setF({ ...f, permission })} options={cat.permissions.map((p) => ({ value: p.key, label: p.label, hint: p.group }))} /></Field>
            <Field label="For these roles (none = everyone)">
              <div className="flex flex-wrap gap-1.5">
                {roles?.map((r) => { const on = f.appliesToRoles.includes(r.key); return <button key={r.key} type="button" onClick={() => setF({ ...f, appliesToRoles: on ? f.appliesToRoles.filter((x) => x !== r.key) : [...f.appliesToRoles, r.key] })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white'}`}>{r.name}</button> })}
              </div>
            </Field>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">…when
              <div className="inline-flex rounded-lg bg-surface p-0.5 ring-1 ring-line">{(['ALL', 'ANY'] as const).map((m) => <button key={m} type="button" onClick={() => setF({ ...f, match: m })} className={`rounded-md px-3 py-1 text-xs font-semibold ${f.match === m ? 'bg-white text-brand-700 shadow-sm' : 'text-muted'}`}>{m === 'ALL' ? 'all of these' : 'any of these'}</button>)}</div>
              are true</div>
            <div className="space-y-2">
              {f.conditions.map((c, i) => {
                const type = cat.attributes.find((a) => a.attr === c.attr)?.type ?? 'number'
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                    <Select value={c.attr} onChange={(attr) => { const t = cat.attributes.find((a) => a.attr === attr)!.type; setCond(i, { attr, op: opsFor(t)[0]! }); setRaw(raw.map((r, j) => (j === i ? '' : r))) }} options={cat.attributes.map((a) => ({ value: a.attr, label: a.label, hint: a.hint }))} />
                    <Select value={c.op} onChange={(op) => setCond(i, { op })} options={opsFor(type).map((o) => ({ value: o, label: OPS[o]! }))} />
                    <input className={inputCls} value={raw[i] ?? ''} onChange={(e) => setRaw(raw.map((r, j) => (j === i ? e.target.value : r)))} placeholder={type === 'list' ? 'OWNER, ADMIN' : type === 'text' ? 'MAIN' : '10'} inputMode={type === 'number' ? 'numeric' : undefined} />
                    <button type="button" className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-600" aria-label="Remove condition" onClick={() => { setF({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }); setRaw(raw.filter((_, j) => j !== i)) }}><Trash2 size={16} /></button>
                  </div>
                )
              })}
            </div>
            <Button variant="ghost" className="mt-2 !py-2" disabled={f.conditions.length >= 8} onClick={() => { setF({ ...f, conditions: [...f.conditions, { attr: 'amountPaise', op: 'gt', value: 0 }] }); setRaw([...raw, '']) }}><Plus size={14} /> Add condition</Button>
          </div>
          <Field label="Except for these roles (they are never blocked)">
            <div className="flex flex-wrap gap-1.5">{roles?.map((r) => { const on = f.exceptRoles.includes(r.key); return <button key={r.key} type="button" onClick={() => setF({ ...f, exceptRoles: on ? f.exceptRoles.filter((x) => x !== r.key) : [...f.exceptRoles, r.key] })} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-line bg-white'}`}>{r.name}</button> })}</div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts on (optional)"><input type="date" className={inputCls} value={day(f.validFrom)} onChange={(e) => setF({ ...f, validFrom: e.target.value || null })} /></Field>
            <Field label="Ends before (optional)"><input type="date" className={inputCls} value={day(f.validUntil)} min={day(f.validFrom)} onChange={(e) => setF({ ...f, validUntil: e.target.value || null })} /></Field>
          </div>
          <Field label="Message shown when it blocks"><input className={inputCls} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Discounts above 10% need a manager" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Policy is switched on</label>
          {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || f.name.trim().length < 3 || f.message.trim().length < 3} onClick={() => save.mutate()}>Save policy</Button></div>
      </div>
    </div>
  )
}

function Simulator({ cat }: { cat: Catalog }) {
  const { data: roles } = useRoles()
  const [permission, setPermission] = useState('billing:write')
  const [role, setRole] = useState('RECEPTIONIST')
  const [attrs, setAttrs] = useState({ discountPercent: '', amountPaise: '', quantity: '' })
  const [at, setAt] = useState('')
  const run = useMutation({
    mutationFn: () => api<{ allowed: boolean; policy?: string; message?: string }>('/policies/simulate', {
      method: 'POST',
      body: JSON.stringify({ permission, roles: [role], at: at ? new Date(at).toISOString() : undefined, attrs: Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) }),
    }),
  })
  return (
    <div className="mt-8 rounded-2xl bg-surface p-5 ring-1 ring-line">
      <p className="mb-1 flex items-center gap-2 font-semibold"><FlaskConical size={16} /> Try it out</p>
      <p className="mb-4 text-sm text-muted">Pretend someone does something and see whether your policies would allow it. Nothing is changed.</p>
      <div className="grid gap-3 md:grid-cols-5">
        <Select value={permission} onChange={setPermission} options={cat.permissions.map((p) => ({ value: p.key, label: p.label, hint: p.group }))} />
        <Select value={role} onChange={setRole} options={(roles ?? []).map((r) => ({ value: r.key, label: r.name }))} />
        <input className={inputCls} placeholder="Discount %" inputMode="numeric" value={attrs.discountPercent} onChange={(e) => setAttrs({ ...attrs, discountPercent: e.target.value.replace(/\D/g, '') })} />
        <input className={inputCls} placeholder="Amount (paise)" inputMode="numeric" value={attrs.amountPaise} onChange={(e) => setAttrs({ ...attrs, amountPaise: e.target.value.replace(/\D/g, '') })} />
        <Button onClick={() => run.mutate()} disabled={run.isPending}>Check</Button>
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-xs text-muted">Pretend it is <input type="datetime-local" className={`${inputCls} !w-52 !py-1.5`} value={at} onChange={(e) => setAt(e.target.value)} /> <span>(blank = now)</span></label>
      {run.data && <p className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${run.data.allowed ? 'bg-brand-100 text-brand-800' : 'bg-red-50 text-red-700'}`}>{run.data.allowed ? 'Allowed. No policy blocks this.' : `Blocked by "${run.data.policy}": ${run.data.message}`}</p>}
      {run.error && <p className="mt-3 text-sm text-red-600">{(run.error as Error).message}</p>}
    </div>
  )
}

export default function Policies() {
  const qc = useQueryClient()
  const { data: list } = useQuery({ queryKey: ['policies'], queryFn: () => api<PolicyRow[]>('/policies') })
  const { data: cat } = useQuery({ queryKey: ['permissions'], queryFn: () => api<Catalog>('/permissions') })
  const [editing, setEditing] = useState<PolicyRow | 'new' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['policies'] })
  const remove = useMutation({ mutationFn: (id: string) => api(`/policies/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const toggle = useMutation({ mutationFn: (p: PolicyRow) => api(`/policies/${p.id}`, { method: 'PUT', body: JSON.stringify({ ...p, enabled: !p.enabled }) }), onSuccess: refresh })
  if (!cat) return null
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="max-w-xl text-sm text-muted">Roles say what someone may do. Policies add limits on top, such as a cap on discounts, refunds above an amount, or no stock write-offs at night. A policy only ever blocks; it never grants.</p>
        <Button className="ml-auto" onClick={() => setEditing('new')}><Plus size={18} /> New policy</Button>
      </div>
      <div className="space-y-3">
        {list?.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-4 rounded-2xl p-5 ring-1 ring-line">
            <div className="min-w-0 flex-1"><p className="font-semibold">{p.name}</p><p className="mt-1 text-sm text-muted">{describe(p, cat)}</p><p className="mt-1 text-xs italic text-muted">"{p.message}"</p></div>
            <button onClick={() => toggle.mutate(p)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${p.enabled ? 'bg-brand-100 text-brand-700' : 'bg-stone-200 text-stone-600'}`}>{p.enabled ? 'On' : 'Off'}</button>
            <button className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Edit policy" onClick={() => setEditing(p)}><Pencil size={16} /></button>
            <button className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-red-600" aria-label="Delete policy" onClick={() => { if (confirm(`Delete "${p.name}"?`)) remove.mutate(p.id) }}><Trash2 size={16} /></button>
          </div>
        ))}
        {list?.length === 0 && <p className="rounded-2xl bg-surface py-10 text-center text-sm text-muted">No policies yet. Everything your roles allow is allowed.</p>}
      </div>
      <Simulator cat={cat} />
      {editing && <Builder cat={cat} policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
