import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Clock, Maximize2, Minimize2, Stethoscope, Users, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import { fmtTime } from '../lib/format'

interface QItem {
  id: string
  scheduledAt: string
  status: 'SCHEDULED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED'
  channel: 'IN_PERSON' | 'TELE'
  tokenNo: number | null
  reason: string | null
  patient: { id: string; fullName: string; patientNo: string }
  doctor: { id?: string; fullName: string | null } | null
}

interface OverviewData {
  visits?: { total: number; waiting: number; inConsultation: number; completed: number }
  queue?: QItem[]
}

export default function QueueDisplay() {
  const { me, branch, branchId } = useAuth()
  const [time, setTime] = useState(new Date())
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const lastAnnouncedRef = useRef<Set<string>>(new Set())

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Poll queue every 4 seconds
  const { data } = useQuery<OverviewData>({
    queryKey: ['queue-display', branchId],
    queryFn: () => api<OverviewData>('/analytics/overview'),
    refetchInterval: 4000,
  })

  const queue = data?.queue ?? []
  const activeNow = queue.filter((q) => q.status === 'IN_PROGRESS')
  const waitingNext = queue.filter((q) => q.status === 'CHECKED_IN')
  const scheduledLater = queue.filter((q) => q.status === 'SCHEDULED')

  // Voice announcement for new in-progress tokens
  useEffect(() => {
    if (!audioEnabled || typeof window === 'undefined' || !window.speechSynthesis) return

    for (const item of activeNow) {
      if (item.tokenNo && !lastAnnouncedRef.current.has(item.id)) {
        lastAnnouncedRef.current.add(item.id)
        const docName = item.doctor?.fullName ? `Dr. ${item.doctor.fullName.replace(/^Dr\.?\s+/i, '')}` : 'Doctor'
        const text = `Token number ${item.tokenNo}. ${item.patient.fullName}. Please proceed to ${docName}.`
        
        try {
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.rate = 0.9
          utterance.pitch = 1.0
          utterance.lang = 'en-IN'
          window.speechSynthesis.speak(utterance)
        } catch (e) {
          console.warn('Speech synthesis failed:', e)
        }
      }
    }
  }, [activeNow, audioEnabled])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 selection:bg-brand-500 selection:text-white">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-4">
          <Link to="/" className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-400 hover:bg-slate-700 hover:text-white" title="Back to workspace">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="size-3 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-xl font-bold tracking-tight text-white md:text-2xl">{me?.tenant.name ?? 'Hospital OPD'}</h1>
            </div>
            <p className="text-xs text-slate-400">{branch?.name ?? 'Main OPD Clinic'} · Patient Calling & Queue Board</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-xl font-mono font-bold tracking-wider text-emerald-400 md:text-2xl">
              {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-xs text-slate-400">
              {time.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAudioEnabled((v) => !v)}
              className={clsx('flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition',
                audioEnabled ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
              )}
              title={audioEnabled ? 'Voice announcement active' : 'Click to enable voice announcements'}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              <span className="hidden sm:inline">{audioEnabled ? 'Voice On' : 'Voice Off'}</span>
            </button>

            <button
              onClick={toggleFullscreen}
              className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Board Content */}
      <main className="p-6">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          {/* Left Column: Now Serving / In Consultation */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider text-emerald-400">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Stethoscope size={18} />
                </span>
                Now Serving (Consultation in Progress)
              </h2>
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
                {activeNow.length} Active
              </span>
            </div>

            {activeNow.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {activeNow.map((item) => (
                  <div
                    key={item.id}
                    className="relative overflow-hidden rounded-3xl border-2 border-emerald-500/60 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 p-6 shadow-2xl shadow-emerald-950/50"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-bold uppercase tracking-widest text-emerald-400/80">Token Number</span>
                      <span className="rounded-full bg-emerald-500/20 px-3 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30 animate-pulse">
                        IN ROOM
                      </span>
                    </div>

                    <div className="my-3 flex items-baseline gap-2">
                      <span className="font-mono text-6xl font-black tracking-tight text-white md:text-7xl">
                        #{item.tokenNo ?? '—'}
                      </span>
                    </div>

                    <p className="truncate text-xl font-bold text-slate-100">{item.patient.fullName}</p>
                    <p className="mt-1 text-xs text-slate-400">Patient ID: {item.patient.patientNo}</p>

                    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Consulting Doctor</p>
                      <p className="text-base font-bold text-emerald-300">
                        {item.doctor?.fullName ? `Dr. ${item.doctor.fullName.replace(/^Dr\.?\s+/i, '')}` : 'General OPD'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 py-20 text-center">
                <Clock className="size-12 text-slate-600 mb-3" />
                <p className="text-lg font-semibold text-slate-300">No patient in consultation</p>
                <p className="text-sm text-slate-500 mt-1">Doctor will call the next checked-in token shortly.</p>
              </div>
            )}

            {/* Waiting Hall Stats Footer */}
            <div className="grid grid-cols-3 gap-3 pt-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-400 font-medium">Waiting Outside</p>
                <p className="text-2xl font-black text-amber-400 mt-1">{waitingNext.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-400 font-medium">Scheduled Today</p>
                <p className="text-2xl font-black text-sky-400 mt-1">{scheduledLater.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-400 font-medium">Seen & Completed</p>
                <p className="text-2xl font-black text-emerald-400 mt-1">{data?.visits?.completed ?? 0}</p>
              </div>
            </div>
          </section>

          {/* Right Column: Waiting List / Up Next */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h2 className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider text-amber-400">
                <span className="grid size-7 place-items-center rounded-lg bg-amber-500/20 text-amber-400">
                  <Users size={18} />
                </span>
                Waiting Line (Next in Turn)
              </h2>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400 border border-amber-500/20">
                {waitingNext.length} in Queue
              </span>
            </div>

            {waitingNext.length > 0 ? (
              <div className="space-y-2.5 overflow-y-auto max-h-[calc(100vh-17rem)] pr-1">
                {waitingNext.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 transition hover:border-slate-700"
                  >
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-500/20 font-mono text-2xl font-black text-amber-400 border border-amber-500/30">
                      #{item.tokenNo ?? '—'}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-base font-bold text-white">{item.patient.fullName}</p>
                        {idx === 0 && (
                          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-slate-950 uppercase">
                            Up Next
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-400 mt-0.5">
                        {item.doctor?.fullName ? `Dr. ${item.doctor.fullName.replace(/^Dr\.?\s+/i, '')}` : 'General OPD'} · {fmtTime(item.scheduledAt)}
                      </p>
                    </div>

                    <span className="text-xs font-mono text-slate-500">Pos {idx + 1}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-10 text-center text-sm text-slate-500">
                Waiting queue is empty.
              </div>
            )}

            {/* Upcoming Scheduled Arrivals */}
            {scheduledLater.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Upcoming Arrivals</p>
                <div className="space-y-1.5">
                  {scheduledLater.slice(0, 4).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-900/50 px-3 py-2 text-xs">
                      <span className="font-medium text-slate-300">#{s.tokenNo} {s.patient.fullName}</span>
                      <span className="text-slate-500">{fmtTime(s.scheduledAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
