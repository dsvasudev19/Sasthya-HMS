import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, PhoneOff, Video, VideoOff } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import { Button } from './ui'

interface TeleState { channel: string; window: { from: string; to: string }; session: { status: 'WAITING' | 'LIVE' | 'ENDED' | 'MISSED'; patientJoinedAt: string | null; doctorJoinedAt: string | null; startedAt: string | null; endedAt: string | null } | null }

/** The video side of a tele-consultation. The patient joins from their app and waits; the doctor opens the room from here. */
export default function TeleCall({ appointmentId, locked }: { appointmentId: string; locked: boolean }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [url, setUrl] = useState<string | null>(null)
  const { data } = useQuery({ queryKey: ['tele', appointmentId], queryFn: () => api<TeleState>(`/appointments/${appointmentId}/tele`), refetchInterval: 5000 })
  const start = useMutation({ mutationFn: () => api<{ url: string }>(`/appointments/${appointmentId}/tele/start`, { method: 'POST', body: '{}' }), onSuccess: (r) => { setUrl(r.url); for (const k of ['tele', 'consult', 'tele-schedule', 'today']) qc.invalidateQueries({ queryKey: [k] }) } })
  const end = useMutation({ mutationFn: () => api(`/appointments/${appointmentId}/tele/end`, { method: 'POST', body: '{}' }), onSuccess: () => { setUrl(null); qc.invalidateQueries({ queryKey: ['tele', appointmentId] }) } })
  const s = data?.session
  const waiting = !!s?.patientJoinedAt && s.status === 'WAITING'
  const doctor = can('tele:conduct')
  const opensAt = data ? new Date(data.window.from) : null
  const early = !!opensAt && Date.now() < opensAt.getTime()

  return (
    <section className="overflow-hidden rounded-2xl ring-1 ring-sky-200">
      <div className="flex flex-wrap items-center gap-3 bg-sky-50 px-5 py-3">
        <Video size={18} className="text-sky-700" />
        <p className="text-sm font-semibold text-sky-900">Video consultation</p>
        {s?.status === 'LIVE' && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold text-red-600">● Live</span>}
        {waiting && <span className="animate-pulse rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">Patient is waiting</span>}
        {s?.status === 'LIVE' && s.patientJoinedAt && <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-semibold text-brand-800">Patient connected</span>}
        {s?.status === 'ENDED' && <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-[11px] font-semibold text-stone-600">Call ended</span>}
        <span className="ml-auto flex gap-2">
          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"><ExternalLink size={13} />Pop out</a>}
          {doctor && !locked && !url && <Button className="!py-2" disabled={start.isPending || early} onClick={() => start.mutate()}><Video size={16} /> {s?.status === 'LIVE' ? 'Rejoin call' : 'Start video visit'}</Button>}
          {doctor && url && <Button variant="ghost" className="!py-2 !text-red-600" disabled={end.isPending} onClick={() => end.mutate()}><PhoneOff size={16} /> End call</Button>}
        </span>
      </div>
      {early && opensAt && <p className="px-5 py-3 text-sm text-muted">The room opens at {opensAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}, 15 minutes before the appointment.</p>}
      {start.error && <p className="px-5 py-3 text-sm text-red-600">{(start.error as Error).message}</p>}
      {url ? (
        <iframe title="Video consultation" src={url} allow="camera; microphone; display-capture; fullscreen; autoplay" className="aspect-video w-full bg-black" />
      ) : !early && (
        <div className="flex items-center gap-3 px-5 py-4 text-sm text-muted"><VideoOff size={16} />{locked ? 'This visit is closed.' : doctor ? (waiting ? 'The patient is in the waiting room. Start the visit when you are ready.' : 'Start the visit when you are ready. The patient is told by SMS and can join from the app.') : 'Only the doctor can open the call.'}</div>
      )}
    </section>
  )
}
