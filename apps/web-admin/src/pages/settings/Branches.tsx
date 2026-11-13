import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Pencil, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../../lib/api'
import { Button, Field, inputCls, Modal } from '../../components/ui'

interface BranchRow { id: string; code: string; name: string; address: string | null; phone: string | null; isMain: boolean; active: boolean }

export default function Branches() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['branches-manage'], queryFn: () => api<BranchRow[]>('/branches/manage') })
  const [edit, setEdit] = useState<BranchRow | 'new' | null>(null)
  const [f, setF] = useState({ code: '', name: '', address: '', phone: '' })
  const open = (b: BranchRow | 'new') => { setEdit(b); setF(b === 'new' ? { code: '', name: '', address: '', phone: '' } : { code: b.code, name: b.name, address: b.address ?? '', phone: b.phone ?? '' }) }
  const done = () => { qc.invalidateQueries({ queryKey: ['branches-manage'] }); setEdit(null); window.dispatchEvent(new Event('hms:refresh-me')) }
  const save = useMutation({
    mutationFn: () => edit === 'new'
      ? api('/branches', { method: 'POST', body: JSON.stringify({ ...f, address: f.address || undefined, phone: f.phone || undefined }) })
      : api(`/branches/${(edit as BranchRow).id}`, { method: 'PATCH', body: JSON.stringify({ name: f.name, address: f.address, phone: f.phone }) }),
    onSuccess: done,
  })
  const toggle = useMutation({ mutationFn: (b: BranchRow) => api(`/branches/${b.id}`, { method: 'PATCH', body: JSON.stringify({ active: !b.active }) }), onSuccess: done })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  const upgrade = save.error instanceof ApiError && save.error.code === 'UPGRADE'
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="max-w-xl text-sm text-muted">Each branch keeps its own appointments, bills, stock and daily closing. Staff work in the branches you give them; owners and admins can see all of them together.</p>
        <Button className="ml-auto" onClick={() => open('new')}><Plus size={18} /> Add branch</Button>
      </div>
      {toggle.error && <p className="mb-3 text-sm text-red-600">{(toggle.error as Error).message}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((b) => (
          <div key={b.id} className="rounded-2xl p-5 ring-1 ring-line">
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-100 text-brand-800"><Building2 size={20} /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{b.name}</p><p className="font-mono text-[11px] text-muted">{b.code}</p></div>
              {b.isMain && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">Main</span>}
              {!b.active && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-semibold text-stone-600">Closed</span>}
            </div>
            <p className="mt-3 text-sm text-muted">{b.address || 'No address'}{b.phone ? ` · ${b.phone}` : ''}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" className="flex-1 !py-2" onClick={() => open(b)}><Pencil size={14} /> Edit</Button>
              {!b.isMain && <Button variant="ghost" className="!py-2" onClick={() => toggle.mutate(b)}>{b.active ? 'Close' : 'Reopen'}</Button>}
            </div>
          </div>
        ))}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Add branch' : `Edit ${edit.name}`} onClose={() => setEdit(null)}>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code"><input className={`${inputCls} font-mono uppercase`} required disabled={edit !== 'new'} maxLength={8} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="NORTH" /></Field>
              <div className="col-span-2"><Field label="Name"><input className={inputCls} required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field></div>
            </div>
            <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}{upgrade && <> <a className="underline" href="/settings?tab=subscription">See plans</a></>}</p>}
            <Button type="submit" className="w-full" disabled={save.isPending}>{edit === 'new' ? 'Create branch' : 'Save'}</Button>
          </form>
        </Modal>
      )}
    </div>
  )
}
