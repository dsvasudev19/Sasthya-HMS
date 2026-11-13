import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import DocThumb from '../components/DocThumb'
import DocumentViewer, { KIND_LABEL, type DocRow } from '../components/DocumentViewer'
import PatientSearch from '../components/PatientSearch'
import ScanModal from '../components/ScanModal'
import { Button, Modal } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate } from '../lib/format'
import type { PatientRow } from '../lib/types'

type Row = DocRow & { patient: { id: string; fullName: string; patientNo: string } }

export default function Documents() {
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [viewing, setViewing] = useState<Row | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['documents', q, kind], queryFn: () => api<Row[]>(`/documents?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}) })}`) })
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h1 className="text-3xl font-semibold tracking-tight">Documents</h1><p className="text-sm text-muted">Scanned prescriptions, outside reports and every other file in your patients' records.</p></div>
        {can('documents:write') && <Button onClick={() => setChoosing(true)}><Camera size={18} /> Scan or upload</Button>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex min-w-64 flex-1 items-center gap-3 rounded-full border border-line bg-white px-5 py-3 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100"><Search size={17} className="text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient, title or file name" className="w-full bg-transparent text-sm outline-none" /></div>
        <div className="flex flex-wrap gap-1.5">
          {[['', 'All'], ...Object.entries(KIND_LABEL)].map(([k, label]) => <button key={k} onClick={() => setKind(k)} className={clsx('rounded-full border px-3.5 py-2 text-xs font-semibold', kind === k ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-white hover:border-brand-300')}>{label}</button>)}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.map((d) => (
          <button key={d.id} onClick={() => setViewing(d)} className="flex items-center gap-3 rounded-2xl p-4 text-left ring-1 ring-line transition hover:bg-brand-50 hover:ring-brand-300">
            <DocThumb id={d.id} mimeType={d.mimeType} className="size-14" />
            <span className="min-w-0 flex-1"><b className="block truncate text-sm">{d.title}</b><span className="block truncate text-xs text-muted">{d.patient.fullName} · {d.patient.patientNo}</span><span className="text-xs text-muted">{KIND_LABEL[d.kind]} · {fmtDate(d.createdAt)}{d.uploadedByName ? ` · ${d.uploadedByName}` : ''}</span></span>
          </button>
        ))}
        {!isLoading && data.length === 0 && <p className="rounded-2xl bg-surface py-14 text-center text-sm text-muted md:col-span-2 xl:col-span-3">{q || kind ? 'No documents match.' : 'No documents yet. Scan a prescription or upload a report to start the record.'}</p>}
      </div>
      {choosing && !patient && (
        <Modal title="Whose record is it for?" onClose={() => setChoosing(false)}>
          <PatientSearch value={null} onChange={(p) => p && setPatient(p)} autoFocus placeholder="Search patient by name, phone or number" />
          <p className="mt-3 text-xs text-muted">Link <Link className="underline" to="/patients">new patients</Link> from the Patients page first.</p>
        </Modal>
      )}
      {choosing && patient && <ScanModal patientId={patient.id} onClose={() => { setChoosing(false); setPatient(null) }} />}
      {viewing && (
        <>
          <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />
          <Link to={`/patients/${viewing.patient.id}`} className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow-lg ring-1 ring-brand-200">Open {viewing.patient.fullName}'s record</Link>
        </>
      )}
    </div>
  )
}
