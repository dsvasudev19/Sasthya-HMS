import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../lib/api'
import { parseCsv } from '../lib/csv'
import { csv } from '../pages/pharmacy/shared'
import { Button, Modal } from './ui'

type Row = Record<string, unknown>
interface Outcome { created: number; duplicates: number; errors: { row: number; name?: string; message: string }[] }
const ALIASES: Record<string, string> = { name: 'fullName', 'full name': 'fullName', patient: 'fullName', 'patient name': 'fullName', phone: 'phone', mobile: 'phone', 'mobile number': 'phone', contact: 'phone', gender: 'gender', sex: 'gender', dob: 'dateOfBirth', 'date of birth': 'dateOfBirth', birthday: 'dateOfBirth', language: 'language' }

function date(v: string): string | undefined {
  const t = v.trim(); if (!t) return undefined
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t); if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t); if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return t
}
const toRows = (table: string[][]): Row[] => {
  const head = table[0]!.map((h) => ALIASES[h.trim().toLowerCase()] ?? '')
  return table.slice(1).map((r) => {
    const o: Row = {}
    head.forEach((k, i) => {
      const v = (r[i] ?? '').trim(); if (!k || !v) return
      if (k === 'phone') o[k] = v.replace(/\D/g, '').slice(-10)
      else if (k === 'gender') o[k] = /^f/i.test(v) ? 'FEMALE' : /^m/i.test(v) ? 'MALE' : 'OTHER'
      else if (k === 'dateOfBirth') o[k] = date(v)
      else if (k === 'language') o[k] = /^h/i.test(v) ? 'hi' : 'en'
      else o[k] = v
    })
    return o
  })
}

/** Bring an existing patient register across from a spreadsheet: checked first, duplicates skipped, then added with proper numbers. */
export default function PatientImport({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const pick = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<Outcome | null>(null)
  const [done, setDone] = useState<Outcome | null>(null)
  const send = async (dryRun: boolean) => {
    const t: Outcome = { created: 0, duplicates: 0, errors: [] }
    for (let i = 0; i < rows!.length; i += 200) {
      const r = await api<Outcome>('/patients/import', { method: 'POST', body: JSON.stringify({ rows: rows!.slice(i, i + 200), dryRun }) })
      t.created += r.created; t.duplicates += r.duplicates; t.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })))
    }
    return t
  }
  const check = useMutation({ mutationFn: () => send(true), onSuccess: setPreview })
  const run = useMutation({ mutationFn: () => send(false), onSuccess: (r) => { setDone(r); for (const k of ['patients', 'setup', 'overview']) qc.invalidateQueries({ queryKey: [k] }) } })
  const load = async (f?: File) => {
    if (!f) return
    setErr(null); setPreview(null); setName(f.name)
    try {
      const t = parseCsv(await f.text()); if (t.length < 2) throw new Error('The file has no rows under the header.')
      const r = toRows(t); if (!r.some((x) => x['fullName'])) throw new Error('No name column found. Download the template to see the columns.')
      setRows(r); check.mutate()
    } catch (e) { setErr((e as Error).message); setRows(null) }
  }
  if (done) return <Modal title="Import finished" onClose={onClose}><div className="space-y-3 text-sm"><p className="rounded-xl bg-brand-50 px-4 py-3 font-semibold text-brand-800">{done.created} patients added{done.duplicates ? `, ${done.duplicates} already on record` : ''}.</p>{done.errors.length > 0 && <p className="text-amber-700">{done.errors.length} rows were skipped.</p>}<Button className="w-full" onClick={onClose}>Done</Button></div></Modal>
  return (
    <Modal title="Import patients from a spreadsheet" onClose={onClose} size="lg">
      <div className="space-y-4 text-sm">
        <p className="text-muted">One row per patient with a name and, ideally, a 10-digit mobile number. Anyone with the same name and number as someone already registered is skipped.</p>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => csv('patients-template.csv', [['name', 'mobile', 'gender', 'date of birth', 'language'], ['Lakshmi Devi', '9876543210', 'Female', '1968-04-12', 'en']])}><Download size={15} /> Template</Button><Button onClick={() => pick.current?.click()}><FileUp size={15} /> {name ? 'Choose another file' : 'Choose CSV file'}</Button><input ref={pick} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void load(e.target.files?.[0])} /></div>
        {err && <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700">{err}</p>}
        {check.isPending && <p className="text-muted">Checking every row…</p>}
        {preview && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">{[['to add', preview.created], ['duplicates', preview.duplicates], ['problems', preview.errors.length]].map(([l, n]) => <div key={l as string} className="rounded-xl bg-surface p-3 ring-1 ring-line"><p className="text-xl font-bold">{n}</p><p className="text-xs text-muted">{l}</p></div>)}</div>
            {preview.errors.length > 0 && <ul className="max-h-36 space-y-1 overflow-y-auto rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{preview.errors.slice(0, 40).map((e, i) => <li key={i}><b>Row {e.row + 1}{e.name ? ` (${e.name})` : ''}:</b> {e.message}</li>)}</ul>}
            {run.error && <p className="text-red-600">{(run.error as Error).message}</p>}
            <Button className="w-full" disabled={run.isPending || preview.created === 0} onClick={() => run.mutate()}>{run.isPending ? 'Importing…' : `Add ${preview.created} patients`}</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
