import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react'
import Floating from './Floating'

export interface Option<T extends string> { value: T; label: string; hint?: string }

/** Custom dropdown (replaces the native select). Keyboard: arrows, Home/End, Enter/Space, Escape, type-ahead on first letter. */
export default function Select<T extends string>({ value, onChange, options, placeholder = 'Select', disabled, className, ariaLabel }: {
  value: T | ''
  onChange: (v: T) => void
  options: Option<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const selected = options.find((o) => o.value === value)
  const close = useCallback(() => setOpen(false), [])

  const show = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true) }
  const pick = (o: Option<T>) => { onChange(o.value); setOpen(false); trigger.current?.focus() }

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) pick(options[active]) }
    else if (e.key === 'Tab') close()
    else if (e.key.length === 1) {
      const i = options.findIndex((o, idx) => idx > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      const j = i >= 0 ? i : options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      if (j >= 0) setActive(j)
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        className={clsx(
          'flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-left text-sm outline-none transition',
          open ? 'border-brand-500 ring-4 ring-brand-100' : 'border-line focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-100',
          disabled && 'opacity-50',
          className,
        )}
      >
        <span className={clsx('truncate', !selected && 'text-muted')}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} className={clsx('shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      <Floating anchor={trigger} open={open} onClose={close}>
        <ul id={id} role="listbox">
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}
              className={clsx('flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm', i === active ? 'bg-brand-50' : '', o.value === value && 'font-semibold text-brand-800')}
            >
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="block truncate text-xs font-normal text-muted">{o.hint}</span>}
              </span>
              {o.value === value && <Check size={16} className="shrink-0 text-brand-700" />}
            </li>
          ))}
        </ul>
      </Floating>
    </>
  )
}
