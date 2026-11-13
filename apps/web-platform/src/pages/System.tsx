import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Button, inputCls } from '@hms/ui-web'
import { api } from '../lib/api'

interface Health { ok: boolean; checkedAt: string; database: { latencyMs: number }; messages: { queued: number; failedLast24h: number; oldestQueuedSeconds: number }; errors: { lastHour: number; last24h: number }; securityEvents24h: number; hospitals: Record<string, number>; maintenance: boolean; uptimeSeconds: number }
interface Flag { key: string; enabled: boolean; value: { message?: string; days?: number } | null }

export default function System() {
  const qc = useQueryClient()
  const { data: h } = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/platform/health'), refetchInterval: 15000 })
  const { data: flags = [] } = useQuery({ queryKey: ['flags'], queryFn: () => api<Flag[]>('/platform/flags') })
  const get = (k: string) => flags.find((f) => f.key === k)
  const put = useMutation({ mutationFn: ({ key, enabled, value }: { key: string; enabled: boolean; value?: unknown }) => api(`/platform/flags/${key}`, { method: 'PUT', body: JSON.stringify({ enabled, value }) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['flags'] }); qc.invalidateQueries({ queryKey: ['health'] }) } })
  const [msg, setMsg] = useState<string | null>(null)
  const [days, setDays] = useState<Record<string, string>>({})
  const m = get('maintenance_mode')
  const stat = (l: string, v: string | number, bad = false) => <div className={clsx('rounded-xl p-4 ring-1', bad ? 'bg-red-50 ring-red-200' : 'ring-line')}><p className="text-2xl font-bold">{v}</p><p className="text-xs text-muted">{l}</p></div>
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">System</h1>{h && <span className={clsx('rounded-full px-3 py-1 text-xs font-bold', h.ok ? 'bg-brand-100 text-brand-700' : 'bg-red-100 text-red-600')}>{h.ok ? 'Healthy' : 'Needs attention'}</span>}</div>
      {h && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat('Database response', `${h.database.latencyMs} ms`, h.database.latencyMs > 1000)}
        {stat('Errors, last hour', h.errors.lastHour, h.errors.lastHour >= 20)}
        {stat('Errors, last 24h', h.errors.last24h)}
        {stat('Security events, 24h', h.securityEvents24h)}
        {stat('Messages waiting', h.messages.queued, h.messages.oldestQueuedSeconds > 900)}
        {stat('Messages failed, 24h', h.messages.failedLast24h, h.messages.failedLast24h > 0)}
        {stat('Hospitals live', (h.hospitals['ACTIVE'] ?? 0) + (h.hospitals['TRIAL'] ?? 0))}
        {stat('Server uptime', `${Math.floor(h.uptimeSeconds / 3600)}h ${Math.floor((h.uptimeSeconds % 3600) / 60)}m`)}
      </div>}
      <section className={clsx('max-w-2xl space-y-3 rounded-2xl p-5 text-sm ring-1', m?.enabled ? 'bg-amber-50 ring-amber-300' : 'ring-line')}>
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Maintenance mode</h2><p className="text-muted">Hospitals can still sign in and read; anything that saves is paused with your message.</p></div>
          <Button variant={m?.enabled ? 'primary' : 'ghost'} onClick={() => confirm(m?.enabled ? 'Resume normal service?' : 'Pause all saving for every hospital?') && put.mutate({ key: 'maintenance_mode', enabled: !m?.enabled, value: { message: msg ?? m?.value?.message ?? 'We are doing scheduled maintenance. Please try again shortly.' } })}>{m?.enabled ? 'Turn off' : 'Turn on'}</Button></div>
        <input className={inputCls} value={msg ?? m?.value?.message ?? ''} onChange={(e) => setMsg(e.target.value)} placeholder="Message hospitals will see" />
        {msg !== null && m?.enabled && <Button variant="ghost" onClick={() => put.mutate({ key: 'maintenance_mode', enabled: true, value: { message: msg } })}>Update message</Button>}
      </section>
      <section className="max-w-2xl space-y-4 text-sm">
        <div className="flex items-center justify-between rounded-2xl p-5 ring-1 ring-line"><div><h2 className="font-semibold">Open sign-ups</h2><p className="text-muted">Lets anyone create a hospital account from the public sign-up page. Off means onboarding is only by you.</p></div>
          <Button variant={get('signup_open')?.enabled ? 'primary' : 'ghost'} onClick={() => put.mutate({ key: 'signup_open', enabled: !get('signup_open')?.enabled })}>{get('signup_open')?.enabled ? 'Open' : 'Closed'}</Button></div>
        {([['trial_days', 'Free trial length (days)', 30], ['log_retention_days', 'Keep system logs for (days)', 30]] as const).map(([key, label, def]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-2xl p-5 ring-1 ring-line"><label htmlFor={key} className="font-semibold">{label}</label>
            <div className="flex gap-2"><input id={key} className={`${inputCls} !w-24`} inputMode="numeric" value={days[key] ?? String(get(key)?.value?.days ?? def)} onChange={(e) => setDays({ ...days, [key]: e.target.value.replace(/\D/g, '') })} /><Button variant="ghost" disabled={days[key] === undefined} onClick={() => put.mutate({ key, enabled: true, value: { days: Number(days[key]) } }, { onSuccess: () => setDays(({ [key]: _, ...r }) => r) })}>Save</Button></div></div>
        ))}
        {put.error && <p className="text-red-600">{(put.error as Error).message}</p>}
      </section>
    </div>
  )
}
