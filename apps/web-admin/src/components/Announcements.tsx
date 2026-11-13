import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, Info, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'

interface Data { announcements: { id: string; title: string; body: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' }[]; maintenance: string | null }
const KEY = 'hms.ann.dismissed'
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const TONE = { INFO: 'border-sky-200 bg-sky-50 text-sky-900', WARNING: 'border-amber-300 bg-amber-50 text-amber-900', CRITICAL: 'border-red-300 bg-red-50 text-red-900' } as const

/** Notices from Swasthya, and the maintenance banner when the platform is read-only. Closing one remembers it on this device. */
export default function Announcements() {
  const [gone, setGone] = useState<string[]>(read)
  const { data } = useQuery({ queryKey: ['announcements'], queryFn: () => api<Data>('/announcements/active'), refetchInterval: 120_000 })
  if (!data) return null
  const shown = data.announcements.filter((a) => !gone.includes(a.id))
  if (!data.maintenance && shown.length === 0) return null
  const dismiss = (id: string) => { const next = [...gone, id].slice(-50); setGone(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ } }
  return (
    <div className="mb-3 shrink-0 space-y-2" role="region" aria-label="Notices">
      {data.maintenance && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900"><Wrench size={17} className="mt-0.5 shrink-0" /><span><b>Maintenance:</b> {data.maintenance}</span></div>}
      {shown.map((a) => (
        <div key={a.id} className={clsx('flex items-start gap-3 rounded-2xl border px-4 py-2.5 text-sm', TONE[a.severity])}>
          {a.severity === 'INFO' ? <Info size={17} className="mt-0.5 shrink-0" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1"><b>{a.title}.</b> {a.body}</span>
          <button onClick={() => dismiss(a.id)} className="rounded-md p-0.5 opacity-60 hover:opacity-100" aria-label="Dismiss notice"><X size={15} /></button>
        </div>
      ))}
    </div>
  )
}
