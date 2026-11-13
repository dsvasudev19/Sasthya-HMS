import { useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, Rocket, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

interface Status { steps: { key: string; title: string; detail: string; done: boolean; href: string; optional?: boolean }[]; percent: number; ready: boolean; manage: boolean }
const KEY = 'hms.setup.hidden'

/** Shown on the dashboard until the basics are in place. It reads the hospital's own data, so it can never be out of date. */
export default function SetupCard() {
  const { data } = useQuery({ queryKey: ['setup'], queryFn: () => api<Status>('/setup/status'), staleTime: 30_000 })
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === '1' } catch { return false } })
  if (!data || !data.manage || data.ready || hidden) return null
  const todo = data.steps.filter((s) => !s.done)
  return (
    <section className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-700 text-white"><Rocket size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Get ready to go live <span className="ml-1 text-sm font-medium text-brand-700">{data.percent}%</span></h2>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${data.percent}%` }} /></div>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {data.steps.map((s) => (
              <li key={s.key}><Link to={s.href} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white">
                <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white ${s.done ? 'bg-brand-600' : 'border-2 border-slate-300 bg-white'}`}>{s.done && <Check size={12} />}</span>
                <span className="min-w-0 flex-1"><span className={`block text-sm font-semibold ${s.done ? 'text-muted line-through' : ''}`}>{s.title}{s.optional && <span className="ml-2 text-[10px] font-medium text-muted no-underline">optional</span>}</span>{!s.done && <span className="block text-xs text-muted">{s.detail}</span>}</span>
                {!s.done && <ChevronRight size={15} className="mt-0.5 text-muted" />}
              </Link></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">{todo.length} to go.</p>
        </div>
        <button onClick={() => { setHidden(true); try { localStorage.setItem(KEY, '1') } catch { /* private mode */ } }} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-ink" aria-label="Hide setup checklist"><X size={16} /></button>
      </div>
    </section>
  )
}
