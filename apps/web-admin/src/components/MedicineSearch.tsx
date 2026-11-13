import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Pill } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../lib/api'
import { rupees } from '../lib/format'
import type { Medicine } from '../lib/types'
import Floating from './Floating'

/** Medicine picker over the pharmacy catalogue, showing stock and price. `allowFreeText` lets a doctor type a drug that is not stocked. */
export default function MedicineSearch({ onPick, onFreeText, placeholder = 'Search medicine', autoFocus }: {
  onPick: (m: Medicine) => void
  onFreeText?: (text: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 150); return () => clearTimeout(t) }, [q])
  const { data = [] } = useQuery({ queryKey: ['medicines', debounced], queryFn: () => api<Medicine[]>(`/medicines?q=${encodeURIComponent(debounced)}`), enabled: open, staleTime: 5000 })
  const list = data.slice(0, 8)
  const close = useCallback(() => setOpen(false), [])
  const pick = (m: Medicine) => { onPick(m); setQ(''); setOpen(false) }
  const free = () => { if (onFreeText && debounced) { onFreeText(debounced); setQ(''); setOpen(false) } }
  const total = list.length + (onFreeText && debounced ? 1 : 0)

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(total - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (list[active]) pick(list[active]); else free() }
    else if (e.key === 'Escape') setOpen(false)
  }
  return (
    <>
      <div ref={box} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
        <Pill size={18} className="shrink-0 text-muted" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKey} placeholder={placeholder} role="combobox" aria-expanded={open} className="w-full bg-transparent text-sm outline-none" />
      </div>
      <Floating anchor={box} open={open} onClose={close} minWidth={340}>
        <ul role="listbox">
          {list.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(m) }}
              className={clsx('flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5', i === active && 'bg-brand-50')}>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{m.name}{m.strength ? ` ${m.strength}` : ''}</span><span className="block text-xs text-muted">{rupees(m.pricePaise)} per {m.unitLabel}</span></span>
              <span className={clsx('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', m.onHand === 0 ? 'bg-red-100 text-red-600' : m.onHand <= m.reorderLevel ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')}>{m.onHand === 0 ? 'Out of stock' : `${m.onHand} in stock`}</span>
            </li>
          ))}
        </ul>
        {list.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">{debounced ? 'No stocked medicine matches' : 'Start typing a medicine name'}</p>}
        {onFreeText && debounced && (
          <button type="button" onMouseDown={(e) => { e.preventDefault(); free() }} onMouseEnter={() => setActive(list.length)}
            className={clsx('mt-1 w-full rounded-xl border-t border-line px-3 py-3 text-left text-sm font-semibold text-brand-700', active === list.length && 'bg-brand-50')}>
            Prescribe "{debounced}" (not in stock list)
          </button>
        )}
      </Floating>
    </>
  )
}
