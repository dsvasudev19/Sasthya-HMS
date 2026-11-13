import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarClock, Check, Lightbulb, Plus, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Panel } from '../components/charts'
import PatientSearch from '../components/PatientSearch'
import Select from '../components/Select'
import { Button, Field, inputCls, Modal } from '../components/ui'
import { api } from '../lib/api'
import type { PatientRow } from '../lib/types'

interface Task { id: string; title: string; details: string | null; status: 'OPEN' | 'DONE' | 'CANCELLED'; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; dueAt: string | null; overdue: boolean; assignedTo: string | null; assigneeName: string | null; creatorName: string | null; patient: { id: string; fullName: string; patientNo: string } | null; completedAt: string | null }
interface Suggestion { key: string; kind: string; title: string; detail: string; href: string; patientId?: string; priority: 'NORMAL' | 'HIGH' | 'URGENT' }
interface Person { id: string; name: string | null; roles: string[] }

const PRIO = { LOW: 'bg-slate-100 text-slate-600', NORMAL: 'bg-sky-50 text-sky-700', HIGH: 'bg-amber-100 text-amber-800', URGENT: 'bg-red-100 text-red-700' } as const
const localDT = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const dueLabel = (iso: string) => {
  const d = new Date(iso), now = new Date()
  const same = d.toDateString() === now.toDateString()
  return `${same ? 'Today' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
}

function TaskModal({ initial, onClose }: { initial?: { title?: string; details?: string; patient?: PatientRow | null; priority?: Task['priority'] }; onClose: () => void }) {
  const qc = useQueryClient()
  const { me, can } = useAuth()
  const people = useQuery({ queryKey: ['staff-directory'], queryFn: () => api<Person[]>('/staff-directory') })
  const [f, setF] = useState({ title: initial?.title ?? '', details: initial?.details ?? '', priority: initial?.priority ?? ('NORMAL' as Task['priority']), due: '', assignee: me?.user.id ?? '' })
  const [patient, setPatient] = useState<PatientRow | null>(initial?.patient ?? null)
  const save = useMutation({
    mutationFn: () => api('/tasks', { method: 'POST', body: JSON.stringify({ title: f.title, details: f.details || undefined, priority: f.priority, dueAt: f.due ? new Date(f.due).toISOString() : null, assignedTo: f.assignee || null, patientId: patient?.id ?? null }) }),
    onSuccess: () => { for (const k of ['tasks', 'overview', 'inbox']) qc.invalidateQueries({ queryKey: [k] }); onClose() },
  })
  return (
    <Modal title="New task" onClose={onClose}>
      <div className="space-y-4">
        <Field label="What needs doing?"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus placeholder="Call Mrs Devi about her sugar test" /></Field>
        <Field label="Details (optional)"><textarea className={`${inputCls} min-h-16`} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assign to"><Select value={f.assignee} onChange={(assignee) => setF({ ...f, assignee })} disabled={!can('tasks:manage')} options={(people.data ?? []).filter((p) => can('tasks:manage') || p.id === me?.user.id).map((p) => ({ value: p.id, label: p.id === me?.user.id ? `${p.name ?? 'Me'} (me)` : p.name ?? 'Staff', hint: p.roles.join(', ').toLowerCase().replace(/_/g, ' ') }))} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(priority) => setF({ ...f, priority })} options={(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} /></Field>
        </div>
        <Field label="Due (optional)"><input type="datetime-local" className={inputCls} value={f.due} min={localDT(new Date())} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="About a patient (optional)"><PatientSearch value={patient} onChange={setPatient} placeholder="Search patient" /></Field>
        {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <Button className="w-full" disabled={f.title.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>Create task</Button>
      </div>
    </Modal>
  )
}

export default function Tasks() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const manager = can('tasks:manage')
  const [scope, setScope] = useState<'mine' | 'created' | 'all'>('mine')
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN')
  const [creating, setCreating] = useState<null | object>(null)
  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['tasks', scope, status], queryFn: () => api<Task[]>(`/tasks?scope=${scope}&status=${status}`) })
  const sugg = useQuery({ queryKey: ['task-suggestions'], queryFn: () => api<Suggestion[]>('/tasks/suggestions'), enabled: manager })
  const refresh = () => { for (const k of ['tasks', 'task-suggestions', 'overview', 'inbox']) qc.invalidateQueries({ queryKey: [k] }) }
  const patch = useMutation({ mutationFn: (v: { id: string; status: Task['status'] }) => api(`/tasks/${v.id}`, { method: 'PATCH', body: JSON.stringify({ status: v.status }) }), onSuccess: refresh })
  const open = tasks.filter((t) => t.status === 'OPEN')
  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><h1 className="text-2xl font-bold tracking-tight">Tasks</h1><p className="text-sm text-muted">Follow-ups and chores for you and your team.{status === 'OPEN' && open.length > 0 && ` ${open.length} open${open.some((t) => t.overdue) ? `, ${open.filter((t) => t.overdue).length} overdue` : ''}.`}</p></div>
        <div className="flex rounded-xl bg-surface p-1 ring-1 ring-line">{([['OPEN', 'Open'], ['DONE', 'Done']] as const).map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={clsx('rounded-lg px-4 py-1.5 text-sm font-medium', status === k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{l}</button>)}</div>
        <Button onClick={() => setCreating({})}><Plus size={16} /> New task</Button>
      </div>
      <div className="flex gap-1 border-b border-line">
        {([['mine', 'Assigned to me'], ['created', 'Created by me'], ...(manager ? [['all', 'Everyone']] : [])] as [typeof scope, string][]).map(([k, l]) => <button key={k} onClick={() => setScope(k)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm font-medium', scope === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}
      </div>

      <div className={clsx('grid gap-6', manager && 'xl:grid-cols-[minmax(0,1fr)_360px]')}>
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className={clsx('flex items-start gap-3 rounded-xl border bg-white p-4 shadow-sm', t.overdue ? 'border-red-200' : 'border-line', t.status !== 'OPEN' && 'opacity-70')}>
              <button onClick={() => patch.mutate({ id: t.id, status: t.status === 'DONE' ? 'OPEN' : 'DONE' })} className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition', t.status === 'DONE' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 hover:border-brand-600 hover:bg-brand-50')} aria-label={t.status === 'DONE' ? 'Reopen' : 'Mark done'}>{t.status === 'DONE' ? <Check size={13} /> : null}</button>
              <div className="min-w-0 flex-1">
                <p className={clsx('font-medium', t.status === 'DONE' && 'line-through')}>{t.title}</p>
                {t.details && <p className="mt-0.5 text-sm text-muted">{t.details}</p>}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {t.patient && <Link to={`/patients/${t.patient.id}`} className="font-medium text-brand-700 hover:underline">{t.patient.fullName}</Link>}
                  {t.dueAt && <span className={clsx('inline-flex items-center gap-1', t.overdue && 'font-semibold text-red-600')}><CalendarClock size={12} />{t.overdue ? 'Overdue · ' : ''}{dueLabel(t.dueAt)}</span>}
                  {scope !== 'mine' && t.assigneeName && <span>For {t.assigneeName}</span>}
                  {scope === 'mine' && t.creatorName && t.assigneeName !== t.creatorName && <span>From {t.creatorName}</span>}
                </p>
              </div>
              <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-semibold', PRIO[t.priority])}>{t.priority.charAt(0) + t.priority.slice(1).toLowerCase()}</span>
              {t.status === 'OPEN' ? <button onClick={() => { if (confirm('Cancel this task?')) patch.mutate({ id: t.id, status: 'CANCELLED' }) }} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Cancel task"><X size={15} /></button> : <button onClick={() => patch.mutate({ id: t.id, status: 'OPEN' })} className="rounded-md p-1 text-slate-400 hover:bg-surface hover:text-ink" aria-label="Reopen"><RotateCcw size={14} /></button>}
            </div>
          ))}
          {!isLoading && tasks.length === 0 && <div className="rounded-2xl border border-dashed border-line py-16 text-center text-sm text-muted">{status === 'OPEN' ? 'Nothing to do. Enjoy the quiet, or create a task.' : 'No finished tasks yet.'}</div>}
          {patch.error && <p className="text-sm text-red-600">{(patch.error as Error).message}</p>}
        </div>

        {manager && (
          <Panel title="Suggested work" action={<Lightbulb size={16} className="text-amber-500" />}>
            <p className="mb-3 text-xs text-muted">Found in your data: overdue follow-ups, unpaid bills, slow lab results, expiring cards and missed visits.</p>
            <ul className="space-y-2.5">
              {sugg.data?.map((s) => (
                <li key={s.key} className="rounded-xl bg-surface p-3">
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{s.detail}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => setCreating({ title: s.title, details: s.detail, priority: s.priority, patient: s.patientId ? ({ id: s.patientId, fullName: s.title.split(': ')[1] ?? 'Patient', patientNo: '' } as PatientRow) : null })} className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800">Make a task</button>
                    <Link to={s.href} className="text-xs font-semibold text-brand-700 hover:underline">Open</Link>
                  </div>
                </li>
              ))}
              {sugg.data?.length === 0 && <li className="py-6 text-center text-sm text-muted">Nothing found. You are on top of it.</li>}
            </ul>
          </Panel>
        )}
      </div>
      {creating && <TaskModal initial={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}
