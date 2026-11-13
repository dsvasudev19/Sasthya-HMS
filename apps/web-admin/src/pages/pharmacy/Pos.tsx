import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Banknote, CreditCard, History, LayoutGrid, List, Minus, PauseCircle, Percent, Pill, Plus, Search, ShoppingCart, Smartphone, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth'
import SaleReceipt from '../../components/SaleReceipt'
import PatientSearch from '../../components/PatientSearch'
import Select from '../../components/Select'
import { Button, Field, inputCls, Modal } from '../../components/ui'
import { api, printPdf } from '../../lib/api'
import { useScanner } from '../../lib/scan'
import { fmtDate, rupees } from '../../lib/format'
import type { Medicine, PatientRow, PendingRx } from '../../lib/types'
import { medName, stockText } from './shared'

export interface Shift { id: string; openedAt: string; openingCashPaise: number }
export type ShiftState = { shift: Shift | null; sales: number; expectedCashPaise: number }

export function ShiftModal({ mode, state, onClose }: { mode: 'open' | 'close'; state?: ShiftState; onClose: () => void }) {
  const qc = useQueryClient()
  const [cash, setCash] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ expectedCashPaise: number; differencePaise: number } | null>(null)
  const done = () => { qc.invalidateQueries({ queryKey: ['pos-shift'] }); qc.invalidateQueries({ queryKey: ['pos-shifts'] }) }
  const open = useMutation({ mutationFn: () => api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingCashPaise: Math.round(Number(cash || 0) * 100) }) }), onSuccess: () => { done(); onClose() } })
  const close = useMutation({
    mutationFn: () => api<{ expectedCashPaise: number; differencePaise: number }>(`/pos/shifts/${state!.shift!.id}/close`, { method: 'POST', body: JSON.stringify({ countedCashPaise: Math.round(Number(cash || 0) * 100), notes: notes || undefined }) }),
    onSuccess: (r) => { done(); setResult(r) },
  })
  if (result) {
    return (
      <Modal title="Shift closed" onClose={onClose}>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Cash expected in the drawer</span><b>{rupees(result.expectedCashPaise)}</b></div>
          <div className="flex justify-between"><span className="text-muted">Cash you counted</span><b>{rupees(Math.round(Number(cash || 0) * 100))}</b></div>
          <p className={clsx('rounded-xl px-4 py-3 font-semibold', result.differencePaise === 0 ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800')}>{result.differencePaise === 0 ? 'The drawer matches exactly.' : result.differencePaise > 0 ? `${rupees(result.differencePaise)} extra in the drawer.` : `${rupees(-result.differencePaise)} short in the drawer.`}</p>
          <Button className="w-full" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    )
  }
  const closing = mode === 'close'
  return (
    <Modal title={closing ? 'Close shift' : 'Open your shift'} onClose={onClose}>
      <div className="space-y-4">
        {closing && state?.shift && <div className="rounded-xl bg-surface p-4 text-sm"><p>Opened {new Date(state.shift.openedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} with {rupees(state.shift.openingCashPaise)}</p><p className="mt-1">{state.sales} sales so far. The drawer should hold <b>{rupees(state.expectedCashPaise)}</b>.</p></div>}
        <form onSubmit={(e) => { e.preventDefault(); if (!(closing && cash === '')) (closing ? close.mutate() : open.mutate()) }} className="contents"><Field label={closing ? 'Cash you counted in the drawer (₹)' : 'Cash in the drawer now (₹)'}><input className={inputCls} inputMode="decimal" autoFocus value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" /></Field>
        {closing && <Field label="Notes (optional)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
        {(open.error || close.error) && <p className="text-sm text-red-600">{((open.error || close.error) as Error).message}</p>}
        <Button className="w-full" disabled={open.isPending || close.isPending || (closing && cash === '')} type="submit">{closing ? 'Close shift' : 'Start selling'}</Button></form>
      </div>
    </Modal>
  )
}

interface Line { m: Medicine; qty: number; /** sold by the whole pack (strip) rather than loose units */ pack?: boolean }
const stepOf = (l: Line) => (l.pack ? l.m.packSize : 1)
interface PayRow { method: 'CASH' | 'UPI' | 'CARD'; amount: string; reference: string }
interface Held { id: string; at: number; lines: Line[]; patient: PatientRow | null; name: string; phone: string; discount: string; discountMode: 'PERCENT' | 'RUPEES' }
const HELD = 'hms.pos.held'
const loadHeld = (): Held[] => { try { return JSON.parse(localStorage.getItem(HELD) ?? '[]') } catch { return [] } }
const saveHeld = (h: Held[]) => { try { localStorage.setItem(HELD, JSON.stringify(h)) } catch { /* private mode */ } }
const METHOD = { CASH: { label: 'Cash', icon: Banknote }, UPI: { label: 'UPI', icon: Smartphone }, CARD: { label: 'Card', icon: CreditCard } } as const

export default function Pos() {
  const qc = useQueryClient()
  const { branch } = useAuth()
  
  const [params, setParams] = useSearchParams()
  const shift = useQuery({ queryKey: ['pos-shift'], queryFn: () => api<ShiftState>('/pos/shift') })
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [patient, setPatient] = useState<PatientRow | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [prescriber, setPrescriber] = useState('')
  const [rxId, setRxId] = useState<string | null>(null)
  const [discount, setDiscount] = useState('')
  const [discountMode, setDiscountMode] = useState<'PERCENT' | 'RUPEES'>('PERCENT')
  const [pays, setPays] = useState<PayRow[]>([{ method: 'CASH', amount: '', reference: '' }])
  const [held, setHeld] = useState<Held[]>(loadHeld)
  const [receipt, setReceipt] = useState<{ id: string; change: number } | null>(null)
  const [autoPrint, setAutoPrint] = useState(() => { try { return localStorage.getItem('hms.pos.autoprint') === '1' } catch { return false } })
  const [tab, setTab] = useState<'items' | 'rx'>('items')
  const [view, setView] = useState<'list' | 'grid'>(() => { try { return localStorage.getItem('hms.pos.view') === 'grid' ? 'grid' : 'list' } catch { return 'list' } })
  const [cursor, setCursor] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [recent, setRecent] = useState(false)
  const [alts, setAlts] = useState<{ for: Medicine; list: Medicine[] } | null>(null)
  const discountRef = useRef<HTMLInputElement>(null)
  const chargeRef = useRef<HTMLButtonElement>(null)
  const [opening, setOpening] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 140); return () => clearTimeout(t) }, [q])
  const { data: meds = [] } = useQuery({ queryKey: ['medicines', 'pos', dq], queryFn: () => api<Medicine[]>(`/medicines?q=${encodeURIComponent(dq)}`), staleTime: 4000 })
  const rxs = useQuery({ queryKey: ['pharmacy-rx'], queryFn: () => api<PendingRx[]>('/pharmacy/prescriptions') })

  // ── cart maths (the server recalculates; this is for the cashier's eye) ──
  const subtotal = lines.reduce((s, l) => s + l.qty * l.m.pricePaise, 0)
  const discountPaise = Math.min(subtotal, discountMode === 'PERCENT' ? Math.round((subtotal * Math.min(100, Number(discount || 0))) / 100) : Math.round(Number(discount || 0) * 100))
  const total = subtotal - discountPaise
  const gst = lines.reduce((s, l) => { const gross = l.qty * l.m.pricePaise; const net = subtotal ? Math.round((gross * total) / subtotal) : 0; return s + (l.m.gstPercent ? net - Math.round((net * 100) / (100 + l.m.gstPercent)) : 0) }, 0)
  const cents = (v: string) => Math.round(Number(v || 0) * 100)
  const entered = pays.reduce((s, p) => s + cents(p.amount), 0)
  const cashRow = pays.find((p) => p.method === 'CASH')
  const othersPaid = entered - (cashRow ? cents(cashRow.amount) : 0)
  // Cash handed over may exceed the bill: the extra is change, not income.
  const change = cashRow ? Math.max(0, cents(cashRow.amount) - Math.max(0, total - othersPaid)) : 0
  const recorded = Math.min(total, entered)
  const walkIn = !patient
  const needsRx = lines.some((l) => l.m.scheduleDrug) && !prescriber.trim() && !rxId
  const overStock = lines.find((l) => l.qty > l.m.onHand)

  const add = useCallback((m: Medicine) => {
    if (m.onHand <= 0) {
      setNotice(`${medName(m)} is out of stock`)
      // Offer the same salt from another brand before the customer walks out.
      const salt = m.genericName?.trim()
      if (salt) void api<Medicine[]>(`/medicines?q=${encodeURIComponent(salt)}`).then((all) => setAlts({ for: m, list: all.filter((x) => x.id !== m.id && x.onHand > 0).slice(0, 5) }))
      return
    }
    setNotice(null); setAlts(null); setFlash(m.id); setTimeout(() => setFlash((f) => (f === m.id ? null : f)), 700)
    setLines((ls) => ls.some((l) => l.m.id === m.id) ? ls.map((l) => (l.m.id === m.id ? { ...l, qty: Math.min(m.onHand, l.qty + stepOf(l)) } : l)) : [...ls, m.packSize > 1 && m.onHand >= m.packSize ? { m, qty: m.packSize, pack: true } : { m, qty: 1 }])
  }, [])
  const setQty = (id: string, qty: number) => setLines((ls) => ls.map((l) => (l.m.id === id ? { ...l, qty: Math.max(stepOf(l), Math.min(l.pack ? Math.floor(l.m.onHand / l.m.packSize) * l.m.packSize : l.m.onHand, qty)) } : l)))
  const setMode = (id: string, pack: boolean) => setLines((ls) => ls.map((l) => { if (l.m.id !== id || !!l.pack === pack) return l; if (!pack) return { ...l, pack: false }; const q = Math.ceil(l.qty / l.m.packSize) * l.m.packSize; return q <= l.m.onHand ? { ...l, pack: true, qty: q } : l }))

  // Barcode scanners type the code and press Enter: an exact barcode wins, otherwise the first match is added.
  const onEnter = async () => {
    const code = q.trim()
    if (!code) return
    // Enter can arrive before the debounced search has caught up (fast typists, scanners): never trust a stale list.
    const fresh = code === dq ? meds : await api<Medicine[]>(`/medicines?q=${encodeURIComponent(code)}`)
    const hit = fresh.find((m) => m.barcode === code) ?? (/^\d{6,}$/.test(code) && !fresh.length ? (await api<Medicine[]>(`/medicines?barcode=${encodeURIComponent(code)}`))[0] : fresh[code === dq ? cursor : 0])
    if (hit) { add(hit); setQ(''); setCursor(0); input.current?.focus() } else setNotice('No medicine found for that code')
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const fk: Record<string, () => void> = {
        F2: () => input.current?.focus(), F4: () => holdRef.current(), F6: () => discountRef.current?.focus(), F7: () => setRecent(true),
        F8: () => document.getElementById('pos-customer')?.querySelector('input')?.focus(), F9: () => chargeRef.current?.click(),
      }
      if (fk[e.key]) { e.preventDefault(); fk[e.key]!() }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); chargeRef.current?.click() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  // A scanner firing while the search box is not focused still sells: a medicine barcode goes straight into the bill.
  useScanner(async (code) => {
    const hit = (await api<Medicine[]>(`/medicines?barcode=${encodeURIComponent(code)}`).catch(() => []))[0]
    if (!hit) return false
    add(hit)
    return true
  }, !!shift.data?.shift)
  useEffect(() => { setCursor(0) }, [dq])
  useEffect(() => { document.getElementById(`med-${cursor}`)?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  const loadRx = useCallback((rx: PendingRx) => {
    const found = rx.items.flatMap((i) => (i.medicineId ? [{ id: i.medicineId, qty: i.quantity }] : []))
    setPatient({ id: rx.patient.id, fullName: rx.patient.fullName, patientNo: rx.patient.patientNo } as PatientRow)
    setRxId(rx.id)
    setLines([])
    void (async () => {
      const all = await api<Medicine[]>('/medicines')
      setLines(found.flatMap((f) => { const m = all.find((x) => x.id === f.id); return m && m.onHand > 0 ? [{ m, qty: Math.min(f.qty, m.onHand) }] : [] }))
      const missing = rx.items.filter((i) => !i.medicineId || !all.find((x) => x.id === i.medicineId && x.onHand > 0))
      setNotice(missing.length ? `Not available to add: ${missing.map((i) => i.name).join(', ')}` : null)
    })()
    setTab('items')
  }, [])
  useEffect(() => {
    const id = params.get('rx')
    if (id && rxs.data) { const rx = rxs.data.find((r) => r.id === id); if (rx) { loadRx(rx); setParams({}, { replace: true }) } }
  }, [params, rxs.data, loadRx, setParams])

  const reset = () => { setLines([]); setPatient(null); setName(''); setPhone(''); setPrescriber(''); setRxId(null); setDiscount(''); setPays([{ method: 'CASH', amount: '', reference: '' }]); setNotice(null) }
  const holdRef = useRef<() => void>(() => undefined)
  const hold = () => {
    if (!lines.length) return
    const next = [{ id: crypto.randomUUID(), at: Date.now(), lines, patient, name, phone, discount, discountMode }, ...held].slice(0, 10)
    setHeld(next); saveHeld(next); reset()
  }
  holdRef.current = hold
  const resume = (h: Held) => {
    const rest = held.filter((x) => x.id !== h.id)
    setHeld(rest); saveHeld(rest)
    setLines(h.lines); setPatient(h.patient); setName(h.name); setPhone(h.phone); setDiscount(h.discount); setDiscountMode(h.discountMode)
  }

  const sale = useMutation({
    mutationFn: () => {
      // Cash handed over can exceed the bill; only what the bill needs is recorded.
      let left = total
      const payments = pays.flatMap((p) => {
        const amt = Math.round(Number(p.amount || 0) * 100)
        if (amt <= 0 || left <= 0) return []
        const put = Math.min(amt, left)
        left -= put
        return [{ method: p.method, amountPaise: put, reference: p.reference || undefined }]
      })
      return api<{ saleId: string; invoice: { id: string } }>('/pos/sales', {
        method: 'POST',
        body: JSON.stringify({
          patientId: patient?.id, customerName: patient ? undefined : name || undefined, customerPhone: patient ? undefined : phone || undefined, consultationId: rxId ?? undefined, prescriber: prescriber || undefined,
          items: lines.map((l) => ({ medicineId: l.m.id, qty: l.qty })),
          ...(discountMode === 'PERCENT' ? { discountPercent: Number(discount || 0) } : { discountPaise: discountPaise }),
          payments,
        }),
      })
    },
    onSuccess: (r) => {
      for (const k of ['medicines', 'pharmacy-rx', 'pharmacy-alerts', 'pharmacy-dashboard', 'pos-shift', 'pos-sales', 'invoices', 'collections']) qc.invalidateQueries({ queryKey: [k] })
      setReceipt({ id: r.saleId, change })
      if (autoPrint) void printPdf(`/pos/sales/${r.saleId}/receipt.pdf?format=thermal`).catch(() => undefined)
      reset()
    },
  })

  const covered = recorded >= total
  const canCharge = lines.length > 0 && !overStock && !needsRx && (walkIn ? covered : entered <= total + change)
  const setPay = (i: number, p: Partial<PayRow>) => setPays((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const fillRest = (i: number) => { const others = pays.reduce((s, p, j) => (j === i ? s : s + Math.round(Number(p.amount || 0) * 100)), 0); setPay(i, { amount: String(Math.max(0, total - others) / 100) }) }

  if (shift.data && !shift.data.shift) {
    return (
      <div className="grid h-full min-h-[420px] place-items-center">
        <div className="max-w-sm rounded-card bg-surface p-8 text-center ring-1 ring-line">
          <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-100 text-brand-800"><ShoppingCart size={26} /></span>
          <h2 className="text-lg font-semibold">Open your shift to start selling</h2>
          <p className="mt-1 text-sm text-muted">Count the cash in the drawer so the day can be reconciled when you close.{branch ? ` You are selling at ${branch.name}.` : ''}</p>
          <Button className="mt-5 w-full" onClick={() => setOpening(true)}>Open shift</Button>
        </div>
        {opening && <ShiftModal mode="open" onClose={() => setOpening(false)} />}
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-[600px] gap-4 xl:grid-cols-[1fr_440px]">
      {/* ── pick items ── */}
      <section className="flex min-h-0 flex-col">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex flex-1 items-center gap-3 rounded-full border border-line bg-white px-5 py-3 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
            <Search size={18} className="text-muted" />
            <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void onEnter() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(meds.length - 1, c + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
              else if (e.key === 'Escape') { setQ(''); setAlts(null); setNotice(null) }
              else if (!q && lines.length && (e.key === '+' || e.key === '-')) { e.preventDefault(); const l = lines[lines.length - 1]!; setQty(l.m.id, l.qty + (e.key === '+' ? stepOf(l) : -stepOf(l))) }
            }} placeholder="Scan barcode or type medicine, ↑↓ then Enter to add" className="w-full bg-transparent text-sm outline-none" />
            {q && <button onClick={() => setQ('')} className="text-muted hover:text-ink" aria-label="Clear"><X size={16} /></button>}
          </div>
          <button onClick={() => setRecent(true)} className="rounded-full p-3 text-muted ring-1 ring-line hover:bg-surface hover:text-ink" title="Recent sales and reprint (F7)" aria-label="Recent sales"><History size={18} /></button>
          <button onClick={() => { const v = view === 'list' ? 'grid' : 'list'; setView(v); try { localStorage.setItem('hms.pos.view', v) } catch { /* private mode */ } }} className="rounded-full p-3 text-muted ring-1 ring-line hover:bg-surface hover:text-ink" title="Switch list and card view" aria-label="Switch view">{view === 'list' ? <LayoutGrid size={18} /> : <List size={18} />}</button>
          <div className="flex rounded-full bg-surface p-1 ring-1 ring-line">
            <button onClick={() => setTab('items')} className={clsx('rounded-full px-4 py-2 text-sm font-medium', tab === 'items' ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>Medicines</button>
            <button onClick={() => setTab('rx')} className={clsx('rounded-full px-4 py-2 text-sm font-medium', tab === 'rx' ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>Prescriptions{rxs.data?.length ? ` (${rxs.data.length})` : ''}</button>
          </div>
        </div>
        {notice && <p className="mb-3 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{notice}</p>}
        {alts && (
          <div className="mb-3 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-200"><p className="mb-2 text-sm font-semibold text-sky-900">Same salt ({alts.for.genericName}) in stock</p>
            <div className="flex flex-wrap gap-2">{alts.list.map((a) => <button key={a.id} onClick={() => add(a)} className="rounded-full bg-white px-3 py-2 text-xs font-semibold ring-1 ring-sky-200 hover:bg-sky-100">{medName(a)} · {rupees(a.pricePaise)} · {a.onHand} left</button>)}{alts.list.length === 0 && <span className="text-sm text-sky-900">No other brand of this salt is in stock.</span>}</div></div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {tab === 'items' && view === 'list' ? (
            <div className="overflow-hidden rounded-2xl ring-1 ring-line">
              <div className="grid grid-cols-[1fr_64px_84px_116px_84px] gap-3 bg-surface px-4 py-2.5 text-xs font-semibold text-muted"><span>Medicine</span><span>Rack</span><span>Expiry</span><span className="text-right">Stock</span><span className="text-right">MRP</span></div>
              <ul role="listbox" className="divide-y divide-line">
                {meds.map((m, i) => {
                  const soon = m.nextExpiry && new Date(m.nextExpiry).getTime() - Date.now() < 90 * 86_400_000
                  return (
                    <li key={m.id} id={`med-${i}`} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => { add(m); input.current?.focus() }}
                      className={clsx('grid cursor-pointer grid-cols-[1fr_64px_84px_116px_84px] items-center gap-3 px-4 py-2.5 text-sm', i === cursor && 'bg-brand-50', m.onHand <= 0 && 'opacity-60')}>
                      <span className="min-w-0"><span className="block truncate font-semibold">{medName(m)}{m.scheduleDrug && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">Sch. H</span>}</span><span className="block truncate text-xs text-muted">{[m.genericName, m.manufacturer].filter(Boolean).join(' · ') || m.form.toLowerCase()}</span></span>
                      <span className="text-xs text-muted">{m.rack ?? '-'}</span>
                      <span className={clsx('text-xs', soon ? 'font-semibold text-amber-700' : 'text-muted')}>{m.nextExpiry ? new Date(m.nextExpiry).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : '-'}</span>
                      <span className="text-right"><span className={clsx('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', m.onHand === 0 ? 'bg-red-100 text-red-600' : m.onHand <= m.reorderLevel ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')}>{stockText(m)}</span></span>
                      <span className="text-right font-bold">{rupees(m.pricePaise)}</span>
                    </li>
                  )
                })}
              </ul>
              {meds.length === 0 && <p className="py-16 text-center text-sm text-muted">No medicine matches “{dq}”.</p>}
            </div>
          ) : tab === 'items' ? (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {meds.map((m) => (
                <button key={m.id} onClick={() => add(m)} disabled={m.onHand <= 0} className="flex flex-col rounded-2xl p-4 text-left ring-1 ring-line transition hover:bg-brand-50 hover:ring-brand-300 disabled:opacity-50 disabled:hover:bg-white">
                  <span className="flex items-start gap-2"><Pill size={16} className="mt-0.5 shrink-0 text-brand-700" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{medName(m)}</span><span className="block truncate text-xs text-muted">{m.genericName ?? m.form.toLowerCase()}{m.rack ? ` · Rack ${m.rack}` : ''}</span></span></span>
                  <span className="mt-3 flex items-end justify-between"><span className="text-base font-bold">{rupees(m.pricePaise)}<span className="text-xs font-medium text-muted"> / {m.unitLabel}</span></span>
                    <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', m.onHand === 0 ? 'bg-red-100 text-red-600' : m.onHand <= m.reorderLevel ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')}>{m.onHand === 0 ? 'Out' : `${m.onHand} left`}</span></span>
                  {(m.scheduleDrug || m.nextExpiry) && <span className="mt-2 flex gap-1.5 text-[10px] font-semibold">{m.scheduleDrug && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600">Sch. H</span>}{m.nextExpiry && <span className="text-muted">Exp {fmtDate(m.nextExpiry)}</span>}</span>}
                </button>
              ))}
              {meds.length === 0 && <p className="col-span-full py-16 text-center text-sm text-muted">No medicine matches “{dq}”.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              {rxs.data?.map((r) => (
                <div key={r.id} className="rounded-2xl p-4 ring-1 ring-line">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{r.patient.fullName} <span className="text-xs font-normal text-muted">{r.patient.patientNo}</span></p><p className="text-xs text-muted">{r.doctor?.fullName ? `Dr ${r.doctor.fullName.replace(/^Dr\.?\s+/i, '')} · ` : ''}{new Date(r.completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p></div><Button className="!py-2" onClick={() => loadRx(r)}>Load into cart</Button></div>
                  <ul className="mt-2 space-y-0.5 text-sm text-muted">{r.items.map((i) => <li key={i.id ?? i.name}>{i.name} × {i.quantity}</li>)}</ul>
                </div>
              ))}
              {rxs.data?.length === 0 && <p className="py-16 text-center text-sm text-muted">No prescriptions are waiting.</p>}
            </div>
          )}
        </div>
      </section>

      {/* ── the bill ── */}
      <section className="flex min-h-0 flex-col rounded-card bg-surface p-4 ring-1 ring-line">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 font-semibold"><ShoppingCart size={18} /> Current bill</h2>
          {held.length > 0 && <Select value="" onChange={(id) => { const h = held.find((x) => x.id === id); if (h) resume(h) }} placeholder={`Held bills (${held.length})`} options={held.map((h) => ({ value: h.id, label: h.patient?.fullName ?? (h.name || 'Walk-in'), hint: `${h.lines.length} items · ${new Date(h.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` }))} className="!w-44 !rounded-full !py-2" />}
          <button onClick={hold} disabled={!lines.length} className="rounded-full p-2 text-muted hover:bg-white hover:text-ink disabled:opacity-40" title="Hold this bill" aria-label="Hold this bill"><PauseCircle size={18} /></button>
          <button onClick={reset} disabled={!lines.length && !patient} className="rounded-full p-2 text-muted hover:bg-white hover:text-red-600 disabled:opacity-40" title="Clear" aria-label="Clear bill"><Trash2 size={17} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {patient ? (
            <div className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm ring-1 ring-line"><span><b>{patient.fullName}</b> <span className="text-xs text-muted">{patient.patientNo}{rxId ? ' · prescription' : ''}</span></span><button onClick={() => { setPatient(null); setRxId(null) }} className="text-muted hover:text-ink" aria-label="Remove patient"><X size={16} /></button></div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Customer name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={inputCls} placeholder="Phone" inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} />
              <div id="pos-customer" className="col-span-2"><PatientSearch value={null} onChange={(p) => { if (p) setPatient(p) }} placeholder="Or link a registered patient" /></div>
            </div>
          )}

          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.m.id} className={clsx('flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 transition-colors duration-500', flash === l.m.id ? 'bg-brand-100 ring-brand-300' : 'bg-white ring-line')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{medName(l.m)}</p>
                  <p className={clsx('text-xs', l.qty >= l.m.onHand ? 'font-semibold text-amber-700' : 'text-muted')}>{l.pack ? `${rupees(l.m.pricePaise * l.m.packSize)} per ${l.m.packLabel} of ${l.m.packSize}` : `${rupees(l.m.pricePaise)} each`}{l.qty >= l.m.onHand ? ' · all stock' : ''}{l.m.nextExpiry && new Date(l.m.nextExpiry).getTime() - Date.now() < 90 * 86_400_000 ? ` · exp ${new Date(l.m.nextExpiry).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}` : ''}</p>
                  {l.m.packSize > 1 && <div className="mt-1 inline-flex rounded-md bg-surface p-0.5 ring-1 ring-line">{([[true, l.m.packLabel], [false, 'Loose']] as const).map(([p, label]) => <button key={label} onClick={() => setMode(l.m.id, p)} className={clsx('rounded px-2 py-0.5 text-[10px] font-semibold capitalize', !!l.pack === p ? 'bg-brand-700 text-white' : 'text-muted')}>{label}</button>)}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => (l.qty <= stepOf(l) ? setLines(lines.filter((x) => x !== l)) : setQty(l.m.id, l.qty - stepOf(l)))} className="rounded-full bg-surface p-1.5 ring-1 ring-line" aria-label="Less"><Minus size={13} /></button>
                  <input className="w-10 rounded-lg bg-transparent text-center text-sm font-semibold outline-none" inputMode="numeric" value={l.pack ? l.qty / l.m.packSize : l.qty} onChange={(e) => setQty(l.m.id, Number(e.target.value.replace(/\D/g, '') || 1) * stepOf(l))} aria-label="Quantity" />
                  <button onClick={() => setQty(l.m.id, l.qty + stepOf(l))} className="rounded-full bg-surface p-1.5 ring-1 ring-line" aria-label="More"><Plus size={13} /></button>
                </div>
                <span className="w-16 text-right text-sm font-semibold">{rupees(l.qty * l.m.pricePaise)}</span>
                <button onClick={() => setLines(lines.filter((x) => x !== l))} className="text-muted hover:text-red-600" aria-label="Remove"><X size={15} /></button>
              </li>
            ))}
            {lines.length === 0 && <li className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-muted">Scan or tap a medicine to start the bill</li>}
          </ul>

          {lines.some((l) => l.m.scheduleDrug) && !rxId && <input className={clsx(inputCls, needsRx && 'border-red-300')} placeholder="Prescriber's name (required for Schedule H drugs)" value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />}

          {lines.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <Percent size={15} className="shrink-0 text-muted" />
                <input ref={discountRef} className={clsx(inputCls, '!py-2')} placeholder="Discount (F6)" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} />
                <div className="flex shrink-0 rounded-full bg-white p-0.5 ring-1 ring-line">{(['PERCENT', 'RUPEES'] as const).map((m) => <button key={m} onClick={() => setDiscountMode(m)} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold', discountMode === m ? 'bg-brand-800 text-white' : 'text-muted')}>{m === 'PERCENT' ? '%' : '₹'}</button>)}</div>
              </div>

              <div className="space-y-1.5 rounded-xl bg-white p-4 text-sm ring-1 ring-line">
                <div className="flex justify-between text-muted"><span>Subtotal</span><span>{rupees(subtotal)}</span></div>
                {discountPaise > 0 && <div className="flex justify-between text-muted"><span>Discount</span><span>− {rupees(discountPaise)}</span></div>}
                {gst > 0 && <div className="flex justify-between text-muted"><span>GST included</span><span>{rupees(gst)}</span></div>}
                <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><span>Total</span><span>{rupees(total)}</span></div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Payment</p>
                {pays.map((p, i) => {
                  const M = METHOD[p.method]
                  return (
                    <div key={i} className="space-y-1.5 rounded-xl bg-white p-2.5 ring-1 ring-line">
                      <div className="flex items-center gap-2">
                        <div className="flex shrink-0 rounded-full bg-surface p-0.5">{(Object.keys(METHOD) as (keyof typeof METHOD)[]).map((m) => { const I = METHOD[m].icon; return <button key={m} onClick={() => setPay(i, { method: m })} className={clsx('flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold', p.method === m ? 'bg-brand-800 text-white' : 'text-muted')} aria-label={METHOD[m].label}><I size={13} />{METHOD[m].label}</button> })}</div>
                        <input className={clsx(inputCls, '!py-2 text-right font-semibold')} inputMode="decimal" placeholder={p.method === 'CASH' ? '₹ received' : '₹ amount'} value={p.amount} onChange={(e) => setPay(i, { amount: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`${M.label} amount`} />
                        <button onClick={() => fillRest(i)} className="shrink-0 rounded-full bg-brand-100 px-3 py-2 text-xs font-semibold text-brand-800 hover:bg-brand-200">Rest</button>
                        {pays.length > 1 && <button onClick={() => setPays(pays.filter((_, j) => j !== i))} className="text-muted hover:text-red-600" aria-label="Remove payment"><X size={15} /></button>}
                      </div>
                      {p.method !== 'CASH' && <input className={clsx(inputCls, '!py-2')} placeholder={p.method === 'UPI' ? 'UPI reference' : 'Last 4 digits'} value={p.reference} onChange={(e) => setPay(i, { reference: e.target.value })} />}
                    </div>
                  )
                })}
                {cashRow && total > 0 && (
                  <div className="flex flex-wrap gap-1.5">{[total - othersPaid, ...[100, 200, 500, 2000].filter((n) => n * 100 > total - othersPaid)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 5).map((v, i) => { const amt = i === 0 ? v : v * 100; return <button key={amt} onClick={() => setPay(pays.indexOf(cashRow), { amount: String(amt / 100) })} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold ring-1 ring-line hover:bg-brand-50">{i === 0 ? 'Exact' : rupees(amt)}</button> })}</div>
                )}
                {pays.length < 3 && <button onClick={() => setPays([...pays, { method: 'UPI', amount: '', reference: '' }])} className="text-xs font-semibold text-brand-700">+ Split payment</button>}
                {change > 0 && <p className="rounded-xl bg-brand-100 px-4 py-2.5 text-sm font-semibold text-brand-800">Give back {rupees(change)} in change</p>}
                {!walkIn && recorded < total && <p className="text-xs text-amber-700">{rupees(total - recorded)} will stay on the patient's bill to pay later.</p>}
                {walkIn && !covered && <p className="text-xs text-muted">Walk-in customers pay the full amount. Link a patient to leave a balance.</p>}
              </div>
            </>
          )}
        </div>

        {sale.error && <p className="mt-2 text-sm text-red-600">{(sale.error as Error).message}</p>}
        {overStock && <p className="mt-2 text-sm text-red-600">Only {overStock.m.onHand} of {medName(overStock.m)} in stock.</p>}
        <Button ref={chargeRef} className="mt-3 w-full !py-4 text-base" disabled={!canCharge || sale.isPending} onClick={() => sale.mutate()}>
          {sale.isPending ? 'Saving…' : lines.length === 0 ? 'Add items to charge' : needsRx ? 'Enter the prescriber' : `Charge ${rupees(total)}`}
        </Button>
      </section>
      <div className="hidden gap-4 text-[11px] text-muted xl:col-span-2 xl:flex">{[['F2', 'Search'], ['↑↓ Enter', 'Add item'], ['+ −', 'Last item qty'], ['F4', 'Hold'], ['F6', 'Discount'], ['F7', 'Recent sales'], ['F8', 'Customer'], ['F9', 'Charge']].map(([k, t]) => <span key={k}><kbd className="rounded bg-surface px-1.5 py-0.5 font-sans font-semibold ring-1 ring-line">{k}</kbd> {t}</span>)}</div>
      <label className="flex items-center gap-2 text-[11px] text-muted xl:col-span-2 xl:justify-end"><input type="checkbox" checked={autoPrint} onChange={(e) => { setAutoPrint(e.target.checked); try { localStorage.setItem('hms.pos.autoprint', e.target.checked ? '1' : '0') } catch { /* private mode */ } }} /> Print the receipt automatically after each sale</label>
      {recent && <RecentSales onClose={() => setRecent(false)} onOpen={(id) => { setRecent(false); setReceipt({ id, change: 0 }) }} />}
      {receipt && <SaleReceipt saleId={receipt.id} changePaise={receipt.change} onClose={() => { setReceipt(null); input.current?.focus() }} />}
    </div>
  )
}

interface SaleRow { id: string; createdAt: string; invoice: { id: string; invoiceNo: string; totalPaise: number; status: string; customerName: string | null; patient: { fullName: string } | null } | null }

/** Today's bills for reprinting or looking up, searchable by bill number, name or phone. */
function RecentSales({ onClose, onOpen }: { onClose: () => void; onOpen: (saleId: string) => void }) {
  const [q, setQ] = useState('')
  const { data } = useQuery({ queryKey: ['pos-sales', q], queryFn: () => api<SaleRow[]>(`/pos/sales${q ? `?q=${encodeURIComponent(q)}` : ''}`) })
  return (
    <Modal title="Recent sales" onClose={onClose} size="lg">
      <input autoFocus className={inputCls} placeholder="Bill number, name or phone (blank shows today)" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto">
        {data?.map((s) => <li key={s.id}><button className="flex w-full items-center gap-3 px-2 py-3 text-left text-sm hover:bg-brand-50" onClick={() => s.invoice && onOpen(s.id)}><span className="min-w-0 flex-1"><b>{s.invoice?.invoiceNo}</b><span className="block truncate text-xs text-muted">{s.invoice?.patient?.fullName ?? s.invoice?.customerName ?? 'Walk-in'} · {new Date(s.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span></span><b>{rupees(s.invoice?.totalPaise ?? 0)}</b></button></li>)}
        {data?.length === 0 && <li className="py-8 text-center text-sm text-muted">No sales found.</li>}
      </ul>
    </Modal>
  )
}
