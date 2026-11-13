import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth'
import MedicineSearch from '../../components/MedicineSearch'
import Select from '../../components/Select'
import { Button, Field, inputCls } from '../../components/ui'
import { api } from '../../lib/api'
import { fmtDate } from '../../lib/format'
import type { Batch, Medicine } from '../../lib/types'
import { medName, PageHead } from './shared'

interface Item { batch: Batch; med: string; qty: string }

export default function Transfers() {
  const qc = useQueryClient()
  const { me, branch } = useAuth()
  const targets = (me?.branches ?? []).filter((b) => b.id !== branch?.id)
  const [to, setTo] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [note, setNote] = useState('')
  const [pick, setPick] = useState<Medicine | null>(null)
  const batches = useQuery({ queryKey: ['batches', pick?.id], queryFn: () => api<{ batches: Batch[] }>(`/medicines/${pick!.id}/batches`), enabled: !!pick })
  const today = new Date().toISOString().slice(0, 10)
  const send = useMutation({
    mutationFn: () => api('/pharmacy/transfers', { method: 'POST', body: JSON.stringify({ toBranchId: to, note: note || undefined, items: items.map((i) => ({ batchId: i.batch.id, qty: Number(i.qty) })) }) }),
    onSuccess: () => { setItems([]); setNote(''); for (const k of ['medicines', 'batches', 'pharmacy-alerts']) qc.invalidateQueries({ queryKey: [k] }) },
  })
  if (targets.length === 0) return <div><PageHead title="Transfers" /><p className="rounded-2xl bg-surface py-12 text-center text-sm text-muted">Transfers need a second branch you can work in.</p></div>
  return (
    <div className="max-w-3xl">
      <PageHead title="Transfer stock" sub={`From ${branch?.name ?? 'this branch'} to another branch. Batch and expiry travel with the stock.`} />
      <div className="space-y-4">
        <Field label="Send to"><Select value={to} onChange={setTo} placeholder="Choose branch" options={targets.map((b) => ({ value: b.id, label: b.name, hint: b.code }))} /></Field>
        <div className="space-y-2">
          {items.map((i, k) => <div key={i.batch.id} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-2.5 text-sm"><span className="flex-1"><b>{i.med}</b> · batch {i.batch.batchNo} · exp {fmtDate(i.batch.expiryDate)} · {i.batch.qtyOnHand} here</span><input className={`${inputCls} !w-24 !py-2 text-center`} inputMode="numeric" value={i.qty} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, qty: String(Math.min(i.batch.qtyOnHand, Number(e.target.value.replace(/\D/g, '') || 0)) || '') } : x)))} aria-label="Quantity" /><button className="text-muted hover:text-red-600" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== k))}><Trash2 size={15} /></button></div>)}
        </div>
        <MedicineSearch placeholder="Find a medicine to send" onPick={setPick} />
        {pick && (
          <div className="rounded-2xl p-4 ring-1 ring-line"><p className="mb-2 text-sm font-semibold">{medName(pick)}: choose a batch</p>
            <div className="flex flex-wrap gap-2">{batches.data?.batches.filter((b) => b.qtyOnHand > 0 && b.expiryDate.slice(0, 10) > today && !items.some((i) => i.batch.id === b.id)).map((b) => <button key={b.id} className="rounded-full bg-surface px-3 py-2 text-xs font-semibold ring-1 ring-line hover:bg-brand-50" onClick={() => { setItems([...items, { batch: b, med: medName(pick), qty: '' }]); setPick(null) }}>{b.batchNo} · exp {fmtDate(b.expiryDate)} · {b.qtyOnHand}</button>)}</div></div>
        )}
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {send.error && <p className="text-sm text-red-600">{(send.error as Error).message}</p>}
        {send.isSuccess && <p className="rounded-xl bg-brand-100 px-4 py-2.5 text-sm font-semibold text-brand-800">Stock sent.</p>}
        <Button disabled={!to || items.length === 0 || items.some((i) => !Number(i.qty)) || send.isPending} onClick={() => send.mutate()}><Send size={16} /> Send stock</Button>
      </div>
    </div>
  )
}
