import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Video } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { api, printPdf } from '../lib/api'
import { fmtTime } from '../lib/format'
import type { AppointmentRow, Status } from '../lib/types'
import { rupees } from '../lib/format'
import InvoiceModal from './InvoiceModal'
import { StatusBadge } from './ui'

const NEXT: Partial<Record<Status, { label: string; to: Status }[]>> = {
  SCHEDULED: [{ label: 'Check in', to: 'CHECKED_IN' }, { label: 'Mark no-show', to: 'NO_SHOW' }, { label: 'Cancel', to: 'CANCELLED' }],
  CHECKED_IN: [{ label: 'Start consultation', to: 'IN_PROGRESS' }, { label: 'Cancel', to: 'CANCELLED' }],
  IN_PROGRESS: [{ label: 'Complete', to: 'COMPLETED' }],
}

function RowMenu({ a }: { a: AppointmentRow }) {
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const { can } = useAuth()
  const clinical = can('vitals:write', 'clinical:write')
  const canConsult = clinical && ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (status: Status) => api(`/appointments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['appointments'] }); qc.invalidateQueries({ queryKey: ['today'] }) },
  })
  const actions = clinical ? (NEXT[a.status] ?? []).filter((x) => x.to === 'CANCELLED') : NEXT[a.status]
  if (!actions?.length && !canConsult && !['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'].includes(a.status)) return null
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded-full p-2 text-muted hover:bg-surface" aria-label="Actions">
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <ul className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-2xl bg-white py-1 text-sm shadow-lg ring-1 ring-line" onMouseLeave={() => setOpen(false)}>
          {canConsult && <li><button className="w-full px-4 py-2.5 text-left font-semibold text-brand-700 hover:bg-surface" onClick={() => nav(`/consult/${a.id}`)}>{a.status === 'COMPLETED' ? 'View consultation' : 'Open consultation'}</button></li>}
          <li><button className="w-full px-4 py-2.5 text-left hover:bg-surface" onClick={() => { setOpen(false); void printPdf(`/appointments/${a.id}/slip.pdf`) }}>Print token slip</button></li>
          {actions?.map((x) => (
            <li key={x.to}>
              <button className="w-full px-4 py-2.5 text-left hover:bg-surface" onClick={() => { setOpen(false); m.mutate(x.to) }}>{x.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AppointmentsTable({ rows }: { rows: AppointmentRow[] }) {
  const [bill, setBill] = useState<string | null>(null)
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted">No appointments here.</p>
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-surface text-xs font-semibold text-ink">
          <tr>
            {['Patient', 'Reason', 'Time', 'Token', 'Doctor', 'Status', 'Bill', ''].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-surface/60">
              <td className="px-4 py-3.5 font-medium">{a.patient.fullName}<div className="text-xs font-normal text-muted">{a.patient.patientNo}</div></td>
              <td className="px-4 py-3.5 text-muted">{a.reason ?? '-'}{a.feeWaived && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">Card covered</span>}</td>
              <td className="px-4 py-3.5 text-muted">
                <span className="inline-flex items-center gap-1.5">{a.channel === 'TELE' && <Video size={14} />}{fmtTime(a.scheduledAt)}</span>
              </td>
              <td className="px-4 py-3.5 font-semibold">{a.tokenNo ?? '-'}</td>
              <td className="px-4 py-3.5 text-muted">{a.doctor?.fullName ?? 'Unassigned'}</td>
              <td className="px-4 py-3.5"><StatusBadge status={a.status} /></td>
              <td className="px-4 py-3.5">
                {a.invoice && a.invoice.status !== 'VOID' && (
                  <button onClick={() => setBill(a.invoice!.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${a.invoice.status === 'PAID' ? 'bg-brand-100 text-brand-700' : 'bg-red-100 text-red-600'}`}>
                    {a.invoice.status === 'PAID' ? (a.feeWaived ? 'Covered' : 'Paid') : `Collect ${rupees(a.invoice.totalPaise - a.invoice.paidPaise)}`}
                  </button>
                )}
              </td>
              <td className="px-2 py-3.5 text-right"><RowMenu a={a} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {bill && <InvoiceModal invoiceId={bill} onClose={() => setBill(null)} />}
    </div>
  )
}
