import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, Camera, CheckCircle2, Info, UserPlus, X, XCircle } from 'lucide-react'
import jsQR from 'jsqr'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal } from '../components/ui'
import { api, printPdf } from './api'

/** What the server says about a scan. Mirrors apps/api/src/routes/scan.ts. */
export interface ScanOutcome {
  kind: string
  outcome: 'DONE' | 'INFO' | 'CHOOSE' | 'NEEDS_BOOKING' | 'DENIED' | 'NOT_FOUND'
  tone: 'success' | 'info' | 'warning' | 'error'
  title: string
  message: string
  open?: string
  patient?: { id: string; fullName: string; patientNo: string }
  appointmentId?: string
  choices?: { id: string; label: string; sub?: string }[]
  facts?: { label: string; value: string }[]
}
export interface ScanEntry extends ScanOutcome { at: number; code: string }

type Handler = (code: string) => boolean | void | Promise<boolean | void>

interface Ctx {
  /** Runs a code through the hospital-wide resolver and shows the result. */
  scan: (code: string, extra?: { action?: string; appointmentId?: string; patientId?: string }) => Promise<ScanOutcome | null>
  /** Opens the camera scanner. */
  openCamera: (continuous?: boolean) => void
  /** Pages register a handler to take scans themselves (the POS sells, goods receipt adds a line). Return true when handled. */
  register: (h: Handler) => () => void
  history: ScanEntry[]
  busy: boolean
}
const ScanCtx = createContext<Ctx | null>(null)
export const useScan = () => { const v = useContext(ScanCtx); if (!v) throw new Error('useScan outside ScanProvider'); return v }

/** Run a page's own handler for scans while it is on screen. Return true to say "handled, don't do the default". */
export function useScanner(handler: Handler, enabled = true) {
  const { register } = useScan()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => (enabled ? register((c) => ref.current(c)) : undefined), [register, enabled])
}

// ── feedback: a short sound and a buzz, so a cashier looking at the item rather than the screen still knows ──
let audio: AudioContext | null = null
function beep(kind: 'ok' | 'warn' | 'err') {
  try {
    audio ??= new AudioContext()
    const notes = kind === 'ok' ? [[880, 0.07], [1320, 0.09]] : kind === 'warn' ? [[660, 0.12]] : [[220, 0.18], [180, 0.2]]
    let t = audio.currentTime
    for (const [f, d] of notes as [number, number][]) {
      const o = audio.createOscillator(), g = audio.createGain()
      o.frequency.value = f; o.type = kind === 'err' ? 'sawtooth' : 'sine'
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d)
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + d + 0.02); t += d
    }
    navigator.vibrate?.(kind === 'ok' ? 30 : [60, 40, 60])
  } catch { /* no audio on this device */ }
}

const TONE = {
  success: { cls: 'border-emerald-300 bg-emerald-50 text-emerald-900', icon: <CheckCircle2 size={22} className="text-emerald-600" /> },
  info: { cls: 'border-sky-200 bg-sky-50 text-sky-900', icon: <Info size={22} className="text-sky-600" /> },
  warning: { cls: 'border-amber-300 bg-amber-50 text-amber-900', icon: <AlertTriangle size={22} className="text-amber-600" /> },
  error: { cls: 'border-red-300 bg-red-50 text-red-900', icon: <XCircle size={22} className="text-red-600" /> },
} as const

/** The result of a scan as a card: what happened, in a sentence, with the facts a counter needs and the one tap left to do. */
export function ScanCard({ r, onChoice, onWalkIn, onClose, compact }: { r: ScanOutcome; onChoice?: (id: string) => void; onWalkIn?: () => void; onClose?: () => void; compact?: boolean }) {
  const t = TONE[r.tone]
  return (
    <div role={r.tone === 'error' ? 'alert' : 'status'} className={clsx('rounded-2xl border p-4 shadow-lg', t.cls)}>
      <div className="flex items-start gap-3">
        {t.icon}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{r.title}</p>
          <p className={clsx('text-sm', compact ? 'opacity-90' : '')}>{r.message}</p>
          {r.facts && r.facts.length > 0 && <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">{r.facts.map((f) => <div key={f.label}><dt className="inline opacity-70">{f.label}: </dt><dd className="inline font-semibold">{f.value}</dd></div>)}</dl>}
          {r.choices && <div className="mt-3 flex flex-wrap gap-2">{r.choices.map((c) => <button key={c.id} onClick={() => onChoice?.(c.id)} className="rounded-xl bg-white px-3.5 py-2 text-left text-sm font-semibold shadow-sm ring-1 ring-black/10 hover:bg-brand-50"><span className="block">{c.label}</span>{c.sub && <span className="block text-xs font-normal text-muted">{c.sub}</span>}</button>)}</div>}
          {r.outcome === 'NEEDS_BOOKING' && onWalkIn && <button onClick={onWalkIn} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"><UserPlus size={15} /> Check in as walk-in</button>}
          {r.appointmentId && r.outcome === 'DONE' && <button onClick={() => void printPdf(`/appointments/${r.appointmentId}/slip.pdf`)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-surface">Print token slip</button>}
        </div>
        {onClose && <button onClick={onClose} className="rounded-md p-1 opacity-60 hover:opacity-100" aria-label="Dismiss"><X size={16} /></button>}
      </div>
    </div>
  )
}

/** Camera scanner. Uses the browser's built-in barcode detector where there is one (Chrome, Edge, Android) and a QR decoder elsewhere. */
function CameraScanner({ continuous, onCode, onClose }: { continuous: boolean; onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, dead = false, lastCode = '', lastAt = 0
    const canvas = document.createElement('canvas')
    type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    const detector = BD ? new BD({ formats: ['code_128', 'qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'data_matrix'] }) : null
    const tick = async () => {
      if (dead) return
      const v = video.current
      if (v && v.readyState >= 2) {
        let value: string | null = null
        try {
          if (detector) value = (await detector.detect(v))[0]?.rawValue ?? null
          else {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            ctx.drawImage(v, 0, 0)
            value = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data ?? null
          }
        } catch { /* a frame that cannot be read is skipped */ }
        // The same code held in view is reported once every few seconds, not forty times a second.
        if (value && (value !== lastCode || Date.now() - lastAt > 3500)) { lastCode = value; lastAt = Date.now(); setLast(value); onCode(value); if (!continuous) return }
      }
      raf = requestAnimationFrame(() => void tick())
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then((s) => { stream = s; if (dead) { s.getTracks().forEach((t) => t.stop()); return } if (video.current) { video.current.srcObject = s; void video.current.play() } void tick() })
      .catch(() => setError('The camera could not be opened. Allow camera access in the browser, or use a handheld scanner.'))
    return () => { dead = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()) }
  }, [continuous, onCode])
  return (
    <Modal title={continuous ? 'Scanning, keep going' : 'Scan a code'} onClose={onClose}>
      <div className="space-y-3">
        {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : (
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/70" />
          </div>
        )}
        <p className="text-center text-xs text-muted">{last ? `Last read: ${last}` : 'Hold a barcode or QR code in the box. It reads on its own.'}</p>
        <Button variant="ghost" className="w-full" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

/**
 * Makes scanning work on every screen. A handheld scanner types the code very fast and presses Enter, so a burst of quick keys
 * outside a text field is a scan. The camera does the same for phones and tablets. Each code goes to the page's own handler if
 * it has one, otherwise to the hospital-wide resolver, which acts (checks the patient in, marks the sample collected) and tells
 * the person what it did.
 */
export function ScanProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate()
  const handlers = useRef<Handler[]>([])
  const [history, setHistory] = useState<ScanEntry[]>([])
  const [toast, setToast] = useState<(ScanEntry & { extra?: { patientId?: string } }) | null>(null)
  const [camera, setCamera] = useState<{ continuous: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const mut = useMutation({ mutationFn: (v: { code: string; extra?: object }) => api<ScanOutcome>('/scan', { method: 'POST', body: JSON.stringify({ code: v.code, ...v.extra }) }) })

  const show = useCallback((e: ScanEntry) => {
    setToast(e); setHistory((h) => [e, ...h].slice(0, 30))
    beep(e.tone === 'success' ? 'ok' : e.tone === 'error' ? 'err' : 'warn')
    window.clearTimeout(timer.current)
    if (!e.choices && e.outcome !== 'NEEDS_BOOKING') timer.current = window.setTimeout(() => setToast(null), e.tone === 'success' ? 5000 : 7000)
  }, [])

  const scan = useCallback<Ctx['scan']>(async (code, extra) => {
    const clean = code.trim()
    if (!clean) return null
    if (!extra) for (const h of [...handlers.current].reverse()) { if (await h(clean)) return null }
    try {
      const r = await mut.mutateAsync({ code: clean, extra })
      show({ ...r, at: Date.now(), code: clean })
      if (r.open && r.outcome !== 'DENIED') setTimeout(() => nav(r.open!), 450)
      return r
    } catch (e) {
      show({ kind: 'UNKNOWN', outcome: 'NOT_FOUND', tone: 'error', title: 'Scan failed', message: (e as Error).message, at: Date.now(), code: clean })
      return null
    }
  }, [mut, nav, show])

  // Hardware scanner detection: 4 or more characters arriving under ~45 ms apart and ending in Enter.
  useEffect(() => {
    let buf = '', last = 0, fast = 0
    const reset = () => { buf = ''; fast = 0 }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) && t.dataset['scan'] !== 'on'
      const now = performance.now()
      if (e.key === 'Enter') {
        if (buf.length >= 4 && fast >= buf.length - 1) { const code = buf; reset(); if (!typing || t?.dataset['scan'] === 'on') { e.preventDefault(); if (t instanceof HTMLInputElement && t.dataset['scan'] === 'on') t.value = ''; void scan(code) } }
        else reset()
        return
      }
      if (e.key.length !== 1) return
      if (now - last > 45) { buf = ''; fast = 0 } else fast++
      last = now
      buf += e.key
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [scan])

  const register = useCallback((h: Handler) => { handlers.current.push(h); return () => { handlers.current = handlers.current.filter((x) => x !== h) } }, [])
  const value = useMemo<Ctx>(() => ({ scan, openCamera: (continuous = false) => setCamera({ continuous }), register, history, busy: mut.isPending }), [scan, register, history, mut.isPending])
  const onCamera = useCallback((c: string) => { void scan(c) }, [scan])

  return (
    <ScanCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[70] w-[26rem] max-w-[calc(100vw-2rem)]">
        {toast && (
          <div className="pointer-events-auto">
            <ScanCard r={toast} compact onClose={() => setToast(null)}
              onChoice={(id) => { setToast(null); void scan(toast.code, toast.kind === 'HEALTH_CARD' ? { patientId: id, action: 'checkin' } : { appointmentId: id }) }}
              onWalkIn={() => { const p = toast.patient; setToast(null); if (p) void scan(toast.code, { action: 'walkin', patientId: p.id }) }} />
          </div>
        )}
      </div>
      {camera && <CameraScanner continuous={camera.continuous} onCode={onCamera} onClose={() => setCamera(null)} />}
    </ScanCtx.Provider>
  )
}

export function ScanButton({ className }: { className?: string }) {
  const { openCamera } = useScan()
  return <button onClick={() => openCamera(false)} className={clsx('rounded-xl p-2.5 text-slate-600 hover:bg-surface hover:text-ink', className)} aria-label="Scan a code with the camera" title="Scan with camera"><Camera size={19} /></button>
}
