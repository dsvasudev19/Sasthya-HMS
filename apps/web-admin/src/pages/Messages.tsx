import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Plus, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import PatientSearch from '../components/PatientSearch'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import type { MessageRow, MessagingSettings, PatientRow } from '../lib/types'

const BADGE = { SENT: 'bg-brand-100 text-brand-700', QUEUED: 'bg-sky-100 text-sky-700', FAILED: 'bg-red-100 text-red-600', SKIPPED: 'bg-stone-200 text-stone-600' } as const
const LABEL: Record<string, string> = { APPOINTMENT_CONFIRMED: 'Booking confirmation', APPOINTMENT_REMINDER: 'Appointment reminder', FOLLOWUP_REMINDER: 'Follow-up reminder', CARD_EXPIRY: 'Card expiry', REPORT_READY: 'Report ready', MANUAL: 'Manual message' }
const AUTO: { key: keyof MessagingSettings; title: string; hint: string }[] = [
  { key: 'appointmentConfirmed', title: 'Booking confirmation', hint: 'Sent right after an appointment is booked.' },
  { key: 'appointmentReminder', title: 'Appointment reminder', hint: 'One reminder within 24 hours of the visit. Skipped for same-day bookings.' },
  { key: 'followUpReminder', title: 'Follow-up reminder', hint: 'The day before the follow-up date the doctor set.' },
  { key: 'cardExpiry', title: 'Health card expiry', hint: 'One reminder in the last 7 days of a care plan, unless it was renewed.' },
  { key: 'reportReady', title: 'Lab report ready', hint: 'When a report is released to the patient.' },
]

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className={clsx('relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50', on ? 'bg-brand-700' : 'bg-stone-300')}>
      <span className={clsx('absolute top-1 size-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
    </button>
  )
}

function Settings() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const canEdit = can('messages:write')
  const { data } = useQuery({ queryKey: ['messaging-settings'], queryFn: () => api<MessagingSettings>('/settings/messaging') })
  const save = useMutation({ mutationFn: (s: MessagingSettings) => api<MessagingSettings>('/settings/messaging', { method: 'PUT', body: JSON.stringify(s) }), onSuccess: (s) => qc.setQueryData(['messaging-settings'], s) })
  if (!data) return null
  return (
    <div className="max-w-2xl space-y-3">
      {AUTO.map((a) => (
        <div key={a.key} className="flex items-center justify-between gap-4 rounded-2xl p-4 ring-1 ring-line">
          <div><p className="font-semibold">{a.title}</p><p className="text-sm text-muted">{a.hint}</p></div>
          <Toggle on={data[a.key]} disabled={!canEdit || save.isPending} onChange={(v) => save.mutate({ ...data, [a.key]: v })} />
        </div>
      ))}
      {!canEdit && <p className="text-sm text-muted">Only the owner or an admin can change these.</p>}
      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <p className="text-xs text-muted">Patients can opt out of reminders (booking confirmations and report alerts are always sent). Messages go out in the patient's language, English or Hindi.</p>
    </div>
  )
}

function SendModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [text, setText] = useState('')
  const send = useMutation({ mutationFn: () => api('/messages', { method: 'POST', body: JSON.stringify({ patientId: patient!.id, text }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages'] }); onClose() } })
  return (
    <Modal title="Send a message" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Patient"><PatientSearch value={patient} onChange={setPatient} allowCreate={false} autoFocus /></Field>
        <Field label="Message"><textarea className={`${inputCls} min-h-24`} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        {send.error && <p className="text-sm text-red-600">{(send.error as Error).message}</p>}
        <Button className="w-full" disabled={!patient || text.trim().length < 2 || send.isPending} onClick={() => send.mutate()}>Send SMS</Button>
      </div>
    </Modal>
  )
}

export default function Messages() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'log' | 'auto'>('log')
  const [status, setStatus] = useState('')
  const [sending, setSending] = useState(false)
  const { data = [] } = useQuery({ queryKey: ['messages', status], queryFn: () => api<MessageRow[]>(`/messages${status ? `?status=${status}` : ''}`), refetchInterval: 15_000 })
  const usage = useQuery({ queryKey: ['messages-usage'], queryFn: () => api<{ month: string; sent: number; queued: number; failed: number }>('/messages/usage') })
  const retry = useMutation({ mutationFn: (id: string) => api(`/messages/${id}/retry`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }) })
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Messages</h1>
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
          {([['log', 'Sent messages'], ['auto', 'Automatic messages']] as const).map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={clsx('rounded-full px-5 py-2 text-sm font-medium', tab === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{label}</button>)}
        </div>
        {tab === 'log' && <Button className="ml-auto" onClick={() => setSending(true)}><Plus size={18} /> New message</Button>}
      </div>
      {tab === 'auto' ? <Settings /> : (
        <>
          {usage.data && <p className="mb-4 text-sm text-muted">This month: <b className="text-ink">{usage.data.sent}</b> sent{usage.data.queued > 0 && <>, {usage.data.queued} waiting</>}{usage.data.failed > 0 && <>, <span className="font-semibold text-red-600">{usage.data.failed} failed</span></>}</p>}
          <div className="mb-4 flex flex-wrap gap-2">
            {[['', 'All'], ['QUEUED', 'Waiting'], ['SENT', 'Sent'], ['FAILED', 'Failed']].map(([v, label]) => <button key={v} onClick={() => setStatus(v!)} className={clsx('rounded-full px-4 py-2 text-sm font-medium ring-1', status === v ? 'bg-brand-800 text-white ring-brand-800' : 'bg-white text-muted ring-line')}>{label}</button>)}
          </div>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold"><tr>{['When', 'Patient', 'Type', 'Message', 'Status', ''].map((h) => <th key={h} className="px-4 py-3.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {data.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-4 py-3.5 text-muted">{new Date(m.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="px-4 py-3.5 font-medium">{m.patient?.fullName ?? '-'}<div className="text-xs font-normal text-muted">{m.toPhone}</div></td>
                    <td className="px-4 py-3.5 text-muted">{LABEL[m.template] ?? m.template}</td>
                    <td className="max-w-xs px-4 py-3.5 text-xs text-muted">{m.body}{m.error && <div className="mt-1 font-semibold text-red-600">{m.error}</div>}</td>
                    <td className="px-4 py-3.5"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[m.status]}`}>{m.status === 'QUEUED' && m.attempts > 0 ? `Retrying (${m.attempts})` : m.status.charAt(0) + m.status.slice(1).toLowerCase()}</span></td>
                    <td className="px-2 py-3.5">{m.status === 'FAILED' && <button onClick={() => retry.mutate(m.id)} className="rounded-full p-2 text-brand-700 hover:bg-brand-50" aria-label="Retry" title="Retry"><RotateCw size={16} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages yet. They appear here when appointments are booked.</p>}
          </div>
        </>
      )}
      {sending && <SendModal onClose={() => setSending(false)} />}
    </div>
  )
}
