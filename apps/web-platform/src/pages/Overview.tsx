import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface Overview {
  tenants: { total: number; trial: number; active: number; suspended: number; closed: number }
  byPlan: Record<string, number>
  mrrPaise: number
  patients: number
  month: string
  patientsAddedThisMonth: number
  messagesThisMonth: number
  outstanding: { count: number; paise: number; overdue: number }
  trialsEndingSoon: { id: string; name: string; trialEndsAt: string }[]
}

const Stat = ({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'good' | 'bad' }) => (
  <div className={clsx('rounded-2xl p-5 ring-1', tone === 'good' ? 'bg-brand-100 ring-brand-200' : tone === 'bad' ? 'bg-red-50 ring-red-200' : 'bg-surface ring-line')}>
    <p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>{hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
  </div>
)

export default function OverviewPage() {
  const { data } = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/platform/overview') })
  if (!data) return <p className="text-sm text-muted">Loading…</p>
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Monthly subscriptions (MRR)" value={rupees(data.mrrPaise)} hint="Starter and Unlimited, before GST" tone="good" />
        <Stat label="Hospitals" value={data.tenants.total} hint={`${data.tenants.active} active · ${data.tenants.trial} on trial`} />
        <Stat label="Patients on the platform" value={data.patients.toLocaleString('en-IN')} hint={`${data.patientsAddedThisMonth} added in ${data.month}`} />
        <Stat label="Messages this month" value={data.messagesThisMonth.toLocaleString('en-IN')} />
        <Stat label="Outstanding invoices" value={rupees(data.outstanding.paise)} hint={`${data.outstanding.count} due`} tone={data.outstanding.overdue ? 'bad' : undefined} />
        <Stat label="Overdue invoices" value={data.outstanding.overdue} tone={data.outstanding.overdue ? 'bad' : undefined} />
        <Stat label="Suspended" value={data.tenants.suspended} tone={data.tenants.suspended ? 'bad' : undefined} />
        <Stat label="Paying plans" value={`${data.byPlan['PAY_PER_PATIENT'] ?? 0} / ${data.byPlan['STARTER'] ?? 0} / ${data.byPlan['UNLIMITED'] ?? 0}`} hint="Per patient / Starter / Unlimited" />
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Trials ending within 7 days</h2>
        {data.trialsEndingSoon.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="space-y-2 text-sm">{data.trialsEndingSoon.map((t) => <li key={t.id} className="flex justify-between rounded-xl bg-surface px-4 py-3 ring-1 ring-line"><span className="font-semibold">{t.name}</span><span className="text-muted">ends {fmtDate(t.trialEndsAt)}</span></li>)}</ul>
        )}
      </section>
    </div>
  )
}
