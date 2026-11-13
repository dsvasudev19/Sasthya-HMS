import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, CheckCircle2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import Floating from './Floating'

interface Alert { key: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; href: string }

const DOT = { critical: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-sky-500' } as const

/** The bell: what needs attention right now, most urgent first. The red dot shows only for warnings and worse. */
export default function NotificationBell() {
  const { branchId } = useAuth()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const { data } = useQuery({ queryKey: ['inbox', branchId], queryFn: () => api<{ alerts: Alert[]; count: number }>('/inbox'), refetchInterval: 60_000 })
  return (
    <>
      <button ref={btn} onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2.5 text-slate-600 hover:bg-surface hover:text-ink" aria-label={`Notifications${data?.count ? `, ${data.count} need attention` : ''}`} aria-expanded={open}>
        <Bell size={20} />
        {!!data?.count && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">{data.count}</span>}
      </button>
      <Floating anchor={btn} open={open} onClose={() => setOpen(false)} minWidth={360}>
        <div className="max-h-[70vh] overflow-y-auto">
          <p className="px-3 pb-2 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Needs attention</p>
          {data?.alerts.map((a) => (
            <Link key={a.key} to={a.href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface">
              <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', DOT[a.severity])} />
              <span className="min-w-0"><span className="block text-sm font-semibold">{a.title}</span><span className="block text-xs text-muted">{a.detail}</span></span>
            </Link>
          ))}
          {data?.alerts.length === 0 && <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted"><CheckCircle2 size={16} className="text-emerald-600" />All clear.</p>}
        </div>
      </Floating>
    </>
  )
}
