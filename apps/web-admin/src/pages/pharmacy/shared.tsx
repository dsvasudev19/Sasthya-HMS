import clsx from 'clsx'
import type { ReactNode } from 'react'

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="mr-auto"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{sub && <p className="text-sm text-muted">{sub}</p>}</div>
      {children}
    </div>
  )
}

export function Stat({ label, value, tone = 'plain', sub, onClick }: { label: string; value: ReactNode; tone?: 'plain' | 'green' | 'amber' | 'red'; sub?: string; onClick?: () => void }) {
  const cls = { plain: 'bg-surface ring-line', green: 'bg-brand-100 ring-brand-200', amber: 'bg-amber-50 ring-amber-200', red: 'bg-red-50 ring-red-200' }[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={clsx('rounded-2xl p-4 text-left ring-1', cls, onClick && 'transition hover:shadow-md')}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Tag>
  )
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface text-xs font-semibold"><tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-3">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="py-10 text-center text-sm text-muted">{empty}</p>}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { k: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap rounded-full bg-surface p-1 ring-1 ring-line">
      {tabs.map((t) => <button key={t.k} onClick={() => onChange(t.k)} className={clsx('rounded-full px-4 py-2 text-sm font-medium', value === t.k ? 'bg-white text-brand-700 shadow-sm' : 'text-muted')}>{t.label}</button>)}
    </div>
  )
}

export const medName = (m: { name: string; strength: string | null }) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`

export function csv(name: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** "12 strips + 3" for a medicine sold in packs; the plain number otherwise. Stock is always counted in single units. */
export function stockText(m: { onHand: number; packSize: number; packLabel: string; unitLabel?: string }) {
  if (m.packSize <= 1) return String(m.onHand)
  const packs = Math.floor(m.onHand / m.packSize), loose = m.onHand % m.packSize
  return packs > 0 ? `${packs} ${m.packLabel}${packs === 1 ? '' : 's'}${loose ? ` + ${loose}` : ''}` : `${loose} loose`
}
