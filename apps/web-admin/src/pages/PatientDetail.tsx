import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, CalendarPlus, IdCard, Receipt } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import AppointmentsTable from '../components/AppointmentsTable'
import InvoiceModal from '../components/InvoiceModal'
import NewAppointmentModal from '../components/NewAppointmentModal'
import Select from '../components/Select'
import NewInvoiceModal from '../components/NewInvoiceModal'
import PatientRecord from '../components/PatientRecord'
import { Avatar, Button } from '../components/ui'
import { api, printPdf } from '../lib/api'
import { ageOf, fmtDate, fmtDob, rupees } from '../lib/format'
import type { AppointmentRow, Coverage, InvoiceRow, PatientRow } from '../lib/types'

interface Detail extends PatientRow {
  language: string
  reminderOptOut: boolean
  coverage: (Coverage & { planName: string }) | null
  appointments: AppointmentRow[]
  invoices: Omit<InvoiceRow, 'patient'>[]
  outstandingPaise: number
}

const BADGE = { PAID: 'bg-brand-100 text-brand-700', PARTIAL: 'bg-amber-100 text-amber-700', UNPAID: 'bg-red-100 text-red-600', REFUNDED: 'bg-stone-200 text-stone-600', VOID: 'bg-stone-200 text-stone-600' } as const

export default function PatientDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const clinical = can('clinical:read')
  const [tab, setTab] = useState<'visits' | 'bills' | 'record'>('visits')
  const [booking, setBooking] = useState(false)
  const [billing, setBilling] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const qc = useQueryClient()
  const prefs = useMutation({ mutationFn: (b: { language?: string; reminderOptOut?: boolean }) => api(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(b) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', id] }) })
  const { data: p, isLoading, error } = useQuery({ queryKey: ['patient', id], queryFn: () => api<Detail>(`/patients/${id}`) })


  if (isLoading) return <p className="py-10 text-sm text-muted">Loading…</p>
  if (error || !p) return <p className="py-10 text-sm text-red-600">Patient not found.</p>
  const age = ageOf(p.dateOfBirth)
  const cov = p.coverage

  return (
    <div className="space-y-6">
      <Link to="/patients" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><ArrowLeft size={16} /> All patients</Link>

      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <Avatar name={p.fullName} className="size-16 text-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{p.fullName}</h1>
          <p className="mt-1 text-sm text-muted">{p.patientNo}{p.phone ? ` · ${p.phone}` : ''}{age !== null ? ` · ${age} y` : ''}{p.gender ? ` · ${p.gender.toLowerCase()}` : ''} · born {fmtDob(p.dateOfBirth)}</p>
          {p.outstandingPaise > 0 && <p className="mt-1 text-sm font-semibold text-red-600">Outstanding {rupees(p.outstandingPaise)}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => void printPdf(`/patients/${p.id}/card.pdf`)}><IdCard size={16} /> Print ID card</Button>
          <Button variant="ghost" onClick={() => setBilling(true)}><Receipt size={16} /> New bill</Button>
          <Button onClick={() => setBooking(true)}><CalendarPlus size={16} /> Book appointment</Button>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Health card</p>
        {cov ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span className="text-lg font-bold tracking-wide">{cov.cardNo}</span>
            <span className="text-muted">{cov.planName}</span>
            {cov.subscriptionId ? (
              <>
                <span>Valid till <b>{fmtDate(cov.endsAt)}</b></span>
                <span><b className="text-brand-700">{cov.remaining.inPerson}</b>/{cov.limits.inPerson} in person left</span>
                <span><b className="text-brand-700">{cov.remaining.tele}</b>/{cov.limits.tele} tele left</span>
              </>
            ) : <span className="font-semibold text-red-600">Plan expired</span>}
          </div>
        ) : <p className="mt-2 text-sm text-muted">No health card. Issue one from the Health cards page.</p>}
      </div>

      {p.phone && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl p-4 text-sm ring-1 ring-line">
          <span className="font-semibold">Messages</span>
          <div className="flex items-center gap-2">Language
            <span className="w-36"><Select value={p.language as 'en' | 'hi'} onChange={(v) => prefs.mutate({ language: v })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} className="!py-1.5" /></span>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!p.reminderOptOut} onChange={(e) => prefs.mutate({ reminderOptOut: !e.target.checked })} /> Send reminders</label>
        </div>
      )}

      <div>
        <div className="mb-4 flex rounded-full bg-surface p-1 ring-1 ring-line sm:w-fit">
          {([['visits', `Visits (${p.appointments.length})`], ['bills', `Bills (${p.invoices.length})`], ...(clinical ? [['record', 'Medical record']] : [])] as [typeof tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('rounded-full px-5 py-2 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>
          ))}
        </div>
        {tab === 'record' ? (
          <PatientRecord patientId={p.id} />
        ) : tab === 'visits' ? <AppointmentsTable rows={p.appointments} /> : (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold"><tr>{['Invoice', 'Date', 'Total', 'Paid', 'Status'].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {p.invoices.map((i) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-surface/60" onClick={() => setOpen(i.id)}>
                    <td className="px-4 py-3.5 font-semibold">{i.invoiceNo}</td><td className="px-4 py-3.5 text-muted">{fmtDate(i.createdAt)}</td>
                    <td className="px-4 py-3.5">{rupees(i.totalPaise)}</td><td className="px-4 py-3.5 text-muted">{rupees(i.paidPaise)}</td>
                    <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[i.status]}`}>{i.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.invoices.length === 0 && <p className="py-10 text-center text-sm text-muted">No bills yet.</p>}
          </div>
        )}
      </div>
      {booking && <NewAppointmentModal initialPatient={p} onClose={() => setBooking(false)} />}
      {billing && <NewInvoiceModal initialPatient={p} onClose={() => setBilling(false)} onCreated={(i) => { setBilling(false); setOpen(i) }} />}
      {open && <InvoiceModal invoiceId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
