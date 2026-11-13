import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import { parseCsv } from '../../lib/csv'
import { csv } from './shared'

type Row = Record<string, unknown>
interface Outcome { created: number; updated: number; stockAdded: number; errors: { row: number; name?: string; message: string }[] }

const TEMPLATE = [
  ['name', 'strength', 'generic name', 'form', 'pack size', 'price per unit (Rs)', 'gst %', 'barcode', 'manufacturer', 'hsn', 'rack', 'reorder level', 'schedule h', 'batch no', 'expiry', 'quantity', 'cost per unit (Rs)'],
  ['Paracetamol', '500 mg', 'Paracetamol', 'TABLET', 10, 1.5, 12, '8901001000011', 'GSK', '30049099', 'R2', 50, 'no', 'PC24', '2027-08-31', 200, 0.9],
]

const ALIASES: Record<string, string> = {
  name: 'name', medicine: 'name', 'medicine name': 'name', item: 'name', strength: 'strength', generic: 'genericName', 'generic name': 'genericName', salt: 'genericName', form: 'form',
  'pack size': 'packSize', pack: 'packSize', 'units per pack': 'packSize', price: 'price', mrp: 'price', 'price per unit': 'price', 'price per unit (rs)': 'price', 'unit price': 'price',
  gst: 'gst', 'gst %': 'gst', barcode: 'barcode', manufacturer: 'manufacturer', company: 'manufacturer', hsn: 'hsnCode', 'hsn code': 'hsnCode', rack: 'rack', shelf: 'rack',
  'reorder level': 'reorderLevel', reorder: 'reorderLevel', 'schedule h': 'scheduleDrug', schedule: 'scheduleDrug', 'batch no': 'batchNo', batch: 'batchNo', 'batch number': 'batchNo',
  expiry: 'expiryDate', 'expiry date': 'expiryDate', exp: 'expiryDate', quantity: 'qty', qty: 'qty', stock: 'qty', cost: 'cost', 'cost per unit': 'cost', 'cost per unit (rs)': 'cost', 'purchase price': 'cost',
}
const num = (v: string) => { const n = Number(v.replace(/[^\d.]/g, '')); return v.trim() === '' || Number.isNaN(n) ? undefined : n }
function expiry(v: string): string | undefined {
  const t = v.trim(); if (!t) return undefined
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t); if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t); if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  m = /^(\d{1,2})[/-](\d{2,4})$/.exec(t) // MM/YY: the last day of that month
  if (m) { const y = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]); const last = new Date(Date.UTC(y, Number(m[1]), 0)).getUTCDate(); return `${y}-${m[1]!.padStart(2, '0')}-${last}` }
  return t
}

function toRows(table: string[][]): Row[] {
  const head = table[0]!.map((h) => ALIASES[h.trim().toLowerCase()] ?? '')
  return table.slice(1).map((r) => {
    const o: Row = {}
    head.forEach((k, i) => {
      const v = (r[i] ?? '').trim(); if (!k || v === '') return
      if (k === 'price') o['pricePaise'] = Math.round((num(v) ?? 0) * 100)
      else if (k === 'cost') o['costPaise'] = Math.round((num(v) ?? 0) * 100)
      else if (k === 'packSize' || k === 'gst' || k === 'reorderLevel' || k === 'qty') o[k === 'gst' ? 'gstPercent' : k] = num(v)
      else if (k === 'scheduleDrug') o[k] = /^(y|yes|true|1|h1?)$/i.test(v)
      else if (k === 'form') o[k] = v.toUpperCase()
      else if (k === 'expiryDate') o[k] = expiry(v)
      else o[k] = v
    })
    return o
  })
}

export default function MedicineImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const pick = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Outcome | null>(null)
  const [done, setDone] = useState<Outcome | null>(null)

  const send = async (dryRun: boolean): Promise<Outcome> => {
    const total: Outcome = { created: 0, updated: 0, stockAdded: 0, errors: [] }
    for (let i = 0; i < rows!.length; i += 200) {
      const r = await api<Outcome>('/medicines/import', { method: 'POST', body: JSON.stringify({ rows: rows!.slice(i, i + 200), dryRun }) })
      total.created += r.created; total.updated += r.updated; total.stockAdded += r.stockAdded
      total.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })))
    }
    return total
  }
  const check = useMutation({ mutationFn: () => send(true), onSuccess: setPreview })
  const run = useMutation({ mutationFn: () => send(false), onSuccess: (r) => { setDone(r); for (const k of ['medicines', 'pharmacy-alerts', 'pharmacy-dashboard']) qc.invalidateQueries({ queryKey: [k] }) } })

  const load = async (f: File | undefined) => {
    if (!f) return
    setParseError(null); setPreview(null); setFileName(f.name)
    try {
      const table = parseCsv(await f.text())
      if (table.length < 2) throw new Error('The file has no rows under the header.')
      const r = toRows(table)
      if (!r.some((x) => x['name'])) throw new Error('No "name" column found. Download the template to see the expected columns.')
      setRows(r); check.mutate()
    } catch (e) { setParseError((e as Error).message); setRows(null) }
  }

  if (done) {
    return (
      <Modal title="Import finished" onClose={onClose}>
        <div className="space-y-3 text-sm">
          <p className="rounded-xl bg-brand-50 px-4 py-3 font-semibold text-brand-800">{done.created} added, {done.updated} updated{done.stockAdded ? `, opening stock for ${done.stockAdded}` : ''}.</p>
          {done.errors.length > 0 && <p className="text-amber-700">{done.errors.length} rows were skipped. Fix them in the file and import again; rows already in are simply updated.</p>}
          <Button className="w-full" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="Import medicines from a spreadsheet" onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <p className="text-muted">Export your list from Excel or your old billing software as CSV. Existing medicines (matched by barcode, or name and strength) are updated; new ones are added. Add batch, expiry and quantity columns to load opening stock into the branch you are viewing.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => csv('medicines-template.csv', TEMPLATE)}><Download size={15} /> Download template</Button>
          <Button onClick={() => pick.current?.click()}><FileUp size={15} /> {fileName ? 'Choose another file' : 'Choose CSV file'}</Button>
          <input ref={pick} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void load(e.target.files?.[0])} />
        </div>
        {parseError && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{parseError}</p>}
        {fileName && rows && <p className="text-muted">{fileName}: {rows.length} rows read.</p>}
        {check.isPending && <p className="text-muted">Checking every row…</p>}
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-surface p-3 ring-1 ring-line"><p className="text-xl font-bold">{preview.created}</p><p className="text-xs text-muted">to add</p></div><div className="rounded-xl bg-surface p-3 ring-1 ring-line"><p className="text-xl font-bold">{preview.updated}</p><p className="text-xs text-muted">to update</p></div><div className={`rounded-xl p-3 ring-1 ${preview.errors.length ? 'bg-amber-50 ring-amber-200' : 'bg-surface ring-line'}`}><p className="text-xl font-bold">{preview.errors.length}</p><p className="text-xs text-muted">problems</p></div></div>
            {preview.errors.length > 0 && <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{preview.errors.slice(0, 50).map((e, i) => <li key={i}><b>Row {e.row + 1}{e.name ? ` (${e.name})` : ''}:</b> {e.message}</li>)}</ul>}
            {run.error && <p className="text-red-600">{(run.error as Error).message}</p>}
            <Button className="w-full" disabled={run.isPending || preview.created + preview.updated === 0} onClick={() => run.mutate()}>{run.isPending ? 'Importing…' : `Import ${preview.created + preview.updated} medicines${preview.errors.length ? ' and skip the problem rows' : ''}`}</Button>
          </div>
        )}
        {check.error && <p className="text-red-600">{(check.error as Error).message}</p>}
      </div>
    </Modal>
  )
}
