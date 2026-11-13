import clsx from 'clsx'
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'

export const initials = (name: string | null | undefined) =>
  (name ?? '?').replace(/^Dr\.?\s+/i, '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' ? 'bg-brand-700 text-white shadow-sm hover:bg-brand-800' : 'bg-white text-ink ring-1 ring-line hover:bg-surface',
        className,
      )}
    />
  )
}

const STATUS: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: 'Completed', cls: 'bg-brand-100 text-brand-700' },
  IN_PROGRESS: { label: 'In consultation', cls: 'bg-brand-800 text-white' },
  CHECKED_IN: { label: 'Waiting', cls: 'bg-amber-100 text-amber-700' },
  SCHEDULED: { label: 'Scheduled', cls: 'bg-sky-100 text-sky-700' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-red-100 text-red-600' },
  NO_SHOW: { label: 'No show', cls: 'bg-stone-200 text-stone-600' },
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-stone-100 text-stone-600' }
  return <span className={clsx('inline-block rounded-full px-3 py-1 text-xs font-semibold', s.cls)}>{s.label}</span>
}

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span className={clsx('grid size-10 place-items-center rounded-xl bg-brand-100 text-sm font-bold text-brand-800', className)}>
      {initials(name)}
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

export const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100'

export function Modal({ title, onClose, children, size = 'md' }: { title: string; onClose: () => void; children: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  // A real dialog: focus moves in, Tab stays inside, Escape closes, and focus returns to what opened it.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const root = box.current
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => el.offsetParent !== null)
    if (root && !root.contains(document.activeElement)) (focusable().find((el) => el.tagName !== 'BUTTON' || el.getAttribute('aria-label') !== 'Close') ?? root).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="listbox"]')) { e.stopPropagation(); close.current(); return }
      if (e.key !== 'Tab') return
      const f = focusable(); if (f.length === 0) return
      const first = f[0]!, last = f[f.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.() }
  }, [])
  // Rendered on the page body so no scrolling, sticky or transformed ancestor can trap it behind other layers.
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-card bg-white p-6 shadow-xl outline-none', size === 'md' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-4xl')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-muted hover:text-ink" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ── navigation chrome shared by every app's sidebar ──

/** The sidebar's logo block. */
export function SidebarBrand({ sub, icon }: { sub?: string; icon: ReactNode }) {
  return (
    <div className="mb-7 px-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">{icon}</span>
        <span className="text-xl font-bold tracking-tight text-white">Swasthya</span>
      </div>
      {sub && <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300">{sub}</p>}
    </div>
  )
}

export const sidebarCls = 'hidden h-full w-64 shrink-0 flex-col bg-sidebar px-3 py-5 lg:flex'
export const navGroupCls = 'mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500'
/** One sidebar link: a quiet row that lights up with a teal edge when it is the current page. */
export const navLinkCls = (active: boolean) =>
  clsx(
    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
    active ? 'bg-white/10 text-white' : 'text-sidebar-text hover:bg-white/5 hover:text-white',
    active && "before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-brand-400 before:content-['']",
  )
