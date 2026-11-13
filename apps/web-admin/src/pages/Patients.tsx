import { useQuery } from '@tanstack/react-query'
import { Plus, Search, Upload } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import NewPatientModal from '../components/NewPatientModal'
import PatientImport from '../components/PatientImport'
import { useAuth } from '../auth'
import { Button } from '../components/ui'
import { api } from '../lib/api'
import { ageOf } from '../lib/format'
import type { PatientRow } from '../lib/types'

export default function Patients() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const { can } = useAuth()
  const nav = useNavigate()
  const { data = [], isLoading } = useQuery({ queryKey: ['patients', q], queryFn: () => api<PatientRow[]>(`/patients?q=${encodeURIComponent(q)}`) })
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Patients</h1>
        <div className="ml-auto flex min-w-64 items-center gap-2 rounded-full bg-surface px-4 py-2.5 ring-1 ring-line">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {})} placeholder="Name, phone or number" className="w-full bg-transparent text-sm outline-none" />
        </div>
        {can('patients:write') && <Button variant="ghost" onClick={() => setImporting(true)}><Upload size={16} /> Import</Button>}
        <Button onClick={() => setAdding(true)}><Plus size={18} /> Register patient</Button>
      </div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface text-xs font-semibold"><tr>{['Number', 'Name', 'Age', 'Gender', 'Phone'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-surface/60" onClick={() => nav(`/patients/${p.id}`)}>
                <td className="px-4 py-3.5 text-muted">{p.patientNo}</td>
                <td className="px-4 py-3.5 font-medium">{p.fullName}</td>
                <td className="px-4 py-3.5 text-muted">{ageOf(p.dateOfBirth) ?? '-'}</td>
                <td className="px-4 py-3.5 capitalize text-muted">{p.gender?.toLowerCase() ?? '-'}</td>
                <td className="px-4 py-3.5 text-muted">{p.phone ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && data.length === 0 && <p className="py-10 text-center text-sm text-muted">No patients found.</p>}
      </div>
      {importing && <PatientImport onClose={() => setImporting(false)} />}
      {adding && <NewPatientModal onClose={() => setAdding(false)} />}
    </div>
  )
}
