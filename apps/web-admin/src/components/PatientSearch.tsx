import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Search, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../lib/api'
import { ageOf } from '../lib/format'
import type { PatientRow } from '../lib/types'
import Floating from './Floating'
import NewPatientModal from './NewPatientModal'
import { Avatar } from './ui'

const meta = (p: PatientRow) => [p.patientNo, p.phone, ageOf(p.dateOfBirth) !== null ? `${ageOf(p.dateOfBirth)} y` : null, p.gender ? p.gender[0] + p.gender.slice(1).toLowerCase() : null].filter(Boolean).join(' · ')

function Row({ p, active, onPick, onHover }: { p: PatientRow; active: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <li role="option" aria-selected={active} onMouseEnter={onHover} onMouseDown={(e) => { e.preventDefault(); onPick() }}
      className={clsx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5', active && 'bg-brand-50')}>
      <Avatar name={p.fullName} className="size-9 text-xs" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{p.fullName}</span>
        <span className="block truncate text-xs text-muted">{meta(p)}</span>
      </span>
    </li>
  )
}

/**
 * Reusable patient picker. Type a name, phone or patient number; results appear in a custom dropdown with keyboard support.
 * `value` shows the chosen patient as a card (clear to change). `allowCreate` adds "Register new patient" inline.
 * Pass `onChange` for a single choice, or leave `value` null and use `onChange` to collect several (see `exclude`).
 */
export default function PatientSearch({ value, onChange, exclude = [], placeholder = 'Search by name, phone or patient number', allowCreate = true, autoFocus, variant = 'field' }: {
  value: PatientRow | null
  onChange: (p: PatientRow | null) => void
  exclude?: string[]
  placeholder?: string
  allowCreate?: boolean
  autoFocus?: boolean
  variant?: 'field' | 'pill'
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t) }, [q])
  const { data = [], isFetching } = useQuery({ queryKey: ['patients', 'search', debounced], queryFn: () => api<PatientRow[]>(`/patients?q=${encodeURIComponent(debounced)}`), enabled: open, staleTime: 5000 })
  const results = data.filter((p) => !exclude.includes(p.id)).slice(0, 8)
  const close = useCallback(() => setOpen(false), [])
  const pick = (p: PatientRow) => { onChange(p); setQ(''); setOpen(false) }
  const total = results.length + (allowCreate && debounced ? 1 : 0)

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(total - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (results[active]) pick(results[active])
      else if (allowCreate && debounced && active === results.length) { setOpen(false); setCreating(true) }
    } else if (e.key === 'Escape') setOpen(false)
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
        <Avatar name={value.fullName} className="size-9 text-xs" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{value.fullName}</span><span className="block truncate text-xs text-muted">{meta(value)}</span></span>
        <button type="button" onClick={() => { onChange(null); setTimeout(() => input.current?.focus(), 0) }} className="rounded-full p-1.5 text-muted hover:bg-white hover:text-ink" aria-label="Change patient"><X size={16} /></button>
      </div>
    )
  }

  return (
    <>
      <div ref={box} className={clsx('flex items-center gap-3 border bg-white transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100', variant === 'pill' ? 'rounded-full bg-surface px-5 py-3' : 'rounded-xl px-4 py-3', 'border-line')}>
        <Search size={18} className="shrink-0 text-muted" />
        <input ref={input} autoFocus={autoFocus} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          placeholder={placeholder} role="combobox" aria-expanded={open} className="w-full bg-transparent text-sm outline-none" />
        {isFetching && open && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-700" />}
      </div>
      <Floating anchor={box} open={open} onClose={close} minWidth={variant === 'pill' ? 380 : undefined}>
        {!debounced && results.length > 0 && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Recent patients</p>}
        <ul role="listbox">
          {results.map((p, i) => <Row key={p.id} p={p} active={i === active} onPick={() => pick(p)} onHover={() => setActive(i)} />)}
        </ul>
        {results.length === 0 && !isFetching && <p className="px-3 py-4 text-center text-sm text-muted">{debounced ? `No patient matches "${debounced}"` : 'No patients yet'}</p>}
        {allowCreate && debounced && (
          <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpen(false); setCreating(true) }} onMouseEnter={() => setActive(results.length)}
            className={clsx('mt-1 flex w-full items-center gap-3 rounded-xl border-t border-line px-3 py-3 text-left text-sm font-semibold text-brand-700', active === results.length && 'bg-brand-50')}>
            <UserPlus size={18} /> Register "{debounced}" as a new patient
          </button>
        )}
      </Floating>
      {creating && <NewPatientModal initialName={debounced} onClose={() => setCreating(false)} onCreated={(p) => pick(p)} />}
    </>
  )
}
