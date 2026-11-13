import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, CalendarCheck, FileText, FlaskConical, IndianRupee, LayoutGrid, Pill, ReceiptText, ScanLine, Search, Settings, Stethoscope, UserPlus, Users, Video, ClipboardList, BarChart3, Shield, CheckSquare, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../lib/api'
import { useScan } from '../lib/scan'
import { ageOf } from '../lib/format'

interface Item { id: string; group: string; label: string; sub?: string; icon: ReactNode; run: () => void }
interface Found {
  patients: { id: string; fullName: string; patientNo: string; phone: string | null; gender: string | null; dateOfBirth: string | null }[]
  appointments: { id: string; tokenNo: number | null; status: string; patient: { fullName: string } }[]
  invoices: { id: string; invoiceNo: string; totalPaise: number; status: string; patient: { fullName: string } | null }[]
  lab: { id: string; orderNo: string; status: string; patient: { fullName: string } }[]
  medicines: { id: string; name: string; strength: string | null }[]
  documents: { id: string; title: string; kind: string; patient: { id: string; fullName: string } }[]
}

/** Looks like something printed on a slip, wristband or label rather than a name. */
const looksLikeCode = (q: string) => !/\s/.test(q) && q.length >= 6 && /\d/.test(q) && /^[A-Za-z0-9:/._-]+$/.test(q)

/**
 * One box for everything. Ctrl or Cmd+K (or "/") opens it from any screen. Type a name, phone, bill or order number to find it,
 * pick a page or action, or scan: a code that is typed or scanned here is looked up and acted on exactly like a scan anywhere else.
 */
export default function CommandPalette({ open, onClose, onNew }: { open: boolean; onClose: () => void; onNew: (what: 'appointment' | 'patient' | 'bill') => void }) {
  const nav = useNavigate()
  const { can } = useAuth()
  const { scan, openCamera } = useScan()
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setQ(''); setDq(''); setActive(0); requestAnimationFrame(() => box.current?.focus()) } }, [open])
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 120); return () => clearTimeout(t) }, [q])
  const found = useQuery({ queryKey: ['palette', dq], queryFn: () => api<Found>(`/search?q=${encodeURIComponent(dq)}`), enabled: open && dq.length >= 2, staleTime: 5000 })

  const go = (path: string) => () => { onClose(); nav(path) }
  const pages = useMemo<Item[]>(() => [
    { perm: 'patients:read', label: 'Dashboard', to: '/', icon: <LayoutGrid size={16} /> }, { perm: 'appointments:write', label: 'Front desk check-in', to: '/checkin', icon: <ScanLine size={16} /> },
    { perm: 'patients:read', label: 'Patients', to: '/patients', icon: <Users size={16} /> }, { perm: 'appointments:read', label: 'Appointments', to: '/appointments', icon: <CalendarCheck size={16} /> },
    { perm: 'appointments:read', label: 'Video visits', to: '/consultations', icon: <Video size={16} /> }, { perm: 'billing:read', label: 'Billing', to: '/billing', icon: <IndianRupee size={16} /> },
    { perm: 'lab:read', label: 'Laboratory', to: '/lab', icon: <FlaskConical size={16} /> }, { perm: 'pharmacy:read', label: 'Pharmacy', to: '/pharmacy', icon: <Pill size={16} /> },
    { perm: 'pharmacy:pos', label: 'Pharmacy counter (POS)', to: '/pharmacy/pos', icon: <ReceiptText size={16} /> }, { perm: 'documents:read', label: 'Documents', to: '/documents', icon: <FileText size={16} /> },
    { perm: 'reports:read', label: 'Reports', to: '/reports', icon: <BarChart3 size={16} /> }, { perm: 'patients:read', label: 'Tasks', to: '/tasks', icon: <CheckSquare size={16} /> },
    { perm: 'audit:read', label: 'Audit trail', to: '/audit', icon: <Shield size={16} /> }, { perm: 'team:manage', label: 'Settings', to: '/settings', icon: <Settings size={16} /> },
  ].filter((p) => can(p.perm)).map((p) => ({ id: `page:${p.to}`, group: 'Go to', label: p.label, icon: p.icon, run: go(p.to) })), [can]) // eslint-disable-line react-hooks/exhaustive-deps
  const actions = useMemo<Item[]>(() => [
    ...(can('appointments:write') ? [{ id: 'a:appt', group: 'Do', label: 'New appointment', icon: <Plus size={16} />, run: () => { onClose(); onNew('appointment') } }] : []),
    ...(can('patients:write') ? [{ id: 'a:pat', group: 'Do', label: 'Register a patient', icon: <UserPlus size={16} />, run: () => { onClose(); onNew('patient') } }] : []),
    ...(can('billing:write') ? [{ id: 'a:bill', group: 'Do', label: 'New bill', icon: <ReceiptText size={16} />, run: () => { onClose(); onNew('bill') } }] : []),
    { id: 'a:scan', group: 'Do', label: 'Scan with the camera', icon: <Camera size={16} />, run: () => { onClose(); openCamera(false) } },
  ], [can, onClose, onNew, openCamera])

  const items = useMemo<Item[]>(() => {
    const query = dq.toLowerCase()
    const out: Item[] = []
    if (query && looksLikeCode(dq)) out.push({ id: 'code', group: 'Scan', label: `Look up code ${dq}`, sub: 'Checks in a patient, marks a sample collected, opens a bill…', icon: <ScanLine size={16} />, run: () => { onClose(); void scan(dq) } })
    const f = found.data
    if (f && dq.length >= 2) {
      out.push(...f.patients.map((p) => ({ id: `p:${p.id}`, group: 'Patients', label: p.fullName, sub: [p.patientNo, p.phone, ageOf(p.dateOfBirth) !== null ? `${ageOf(p.dateOfBirth)} y` : null, p.gender?.toLowerCase()].filter(Boolean).join(' · '), icon: <Users size={16} />, run: go(`/patients/${p.id}`) })))
      out.push(...f.appointments.map((a) => ({ id: `ap:${a.id}`, group: 'Today', label: `${a.patient.fullName}, token #${a.tokenNo}`, sub: a.status.toLowerCase().replace('_', ' '), icon: <Stethoscope size={16} />, run: go(['CHECKED_IN', 'IN_PROGRESS'].includes(a.status) && can('clinical:read') ? `/consult/${a.id}` : '/appointments') })))
      out.push(...f.invoices.map((i) => ({ id: `i:${i.id}`, group: 'Bills', label: i.invoiceNo, sub: `${i.patient?.fullName ?? 'Walk-in'} · ${i.status.toLowerCase()}`, icon: <IndianRupee size={16} />, run: go(`/billing?invoice=${i.id}`) })))
      out.push(...f.lab.map((l) => ({ id: `l:${l.id}`, group: 'Lab', label: l.orderNo, sub: `${l.patient.fullName} · ${l.status.toLowerCase()}`, icon: <FlaskConical size={16} />, run: go(`/lab?order=${l.id}`) })))
      out.push(...f.medicines.map((m) => ({ id: `m:${m.id}`, group: 'Medicines', label: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, icon: <Pill size={16} />, run: go(`/pharmacy/inventory?q=${encodeURIComponent(m.name)}`) })))
      out.push(...f.documents.map((d) => ({ id: `d:${d.id}`, group: 'Documents', label: d.title, sub: d.patient.fullName, icon: <ClipboardList size={16} />, run: go(`/patients/${d.patient.id}`) })))
    }
    const match = (i: Item) => !query || i.label.toLowerCase().includes(query)
    out.push(...actions.filter(match), ...pages.filter(match))
    return out
  }, [dq, found.data, pages, actions, scan, can]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(0), [dq, found.data])

  if (!open) return null
  const groups = [...new Set(items.map((i) => i.group))]
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run() }
    else if (e.key === 'Escape') onClose()
  }
  let n = -1
  return (
    <div className="fixed inset-0 z-[80] grid place-items-start justify-items-center bg-slate-950/50 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-line" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Search size={18} className="text-muted" />
          <input ref={box} data-scan="on" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Search a patient, bill or lab order. Scan a code. Or type a command…" className="w-full bg-transparent text-base outline-none placeholder:text-slate-400" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${active}` : undefined} />
          <kbd className="rounded-md bg-surface px-2 py-1 text-[11px] font-semibold text-muted ring-1 ring-line">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[56vh] overflow-y-auto p-2">
          {groups.map((g) => (
            <li key={g} role="presentation"><p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g}</p>
              <ul role="group">{items.filter((i) => i.group === g).map((i) => { n++; const idx = n; return (
                <li key={i.id} id={`pal-${idx}`} role="option" aria-selected={idx === active} onMouseEnter={() => setActive(idx)} onClick={i.run} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5', idx === active ? 'bg-brand-50 text-brand-900' : '')}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-slate-600">{i.icon}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{i.label}</span>{i.sub && <span className="block truncate text-xs text-muted">{i.sub}</span>}</span>
                  {idx === active && <kbd className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-line">Enter</kbd>}
                </li>) })}</ul>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">{found.isFetching ? 'Searching…' : `Nothing found for “${dq}”.`}</li>}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-surface px-5 py-2.5 text-[11px] text-muted"><span>↑↓ move</span><span>Enter open</span><span>Esc close</span><span className="ml-auto">Press <kbd className="rounded bg-white px-1 ring-1 ring-line">/</kbd> or <kbd className="rounded bg-white px-1 ring-1 ring-line">Ctrl K</kbd> anywhere</span></div>
      </div>
    </div>
  )
}
