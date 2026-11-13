import clsx from 'clsx'
import { useId, useState } from 'react'

/** Small, dependency-free charts. Each one is an accessible SVG with a hover read-out. */

const PALETTE = ['#0f706f', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b']
export const chartColor = (i: number) => PALETTE[i % PALETTE.length]!

export interface Series { name: string; color?: string; values: number[]; dashed?: boolean }

const niceMax = (v: number) => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

/** Area/line chart over a shared x axis (labels). Hover shows every series at that point. */
export function LineChart({ labels, series, height = 200, format = (n) => String(n), area = true }: { labels: string[]; series: Series[]; height?: number; format?: (n: number) => string; area?: boolean }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 960, H = height, padL = 48, padR = 12, padT = 12, padB = 26
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)))
  const n = labels.length
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR))
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const step = Math.max(1, Math.ceil(n / 8))
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.name).join(', ')} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (W - padL - padR)) * (n - 1))))) }}>
        <defs>{series.map((s, i) => <linearGradient key={i} id={`${id}-${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.color ?? chartColor(i)} stopOpacity="0.22" /><stop offset="100%" stopColor={s.color ?? chartColor(i)} stopOpacity="0" /></linearGradient>)}</defs>
        {ticks.map((t, i) => <g key={i}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={i === 0 ? undefined : '3 4'} /><text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="11" fill="#64748b">{format(t)}</text></g>)}
        {labels.map((l, i) => (i % step === 0 && (n - 1 - i >= step * 0.6 || i === n - 1)) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#64748b">{l}</text>)}
        {area && series.slice(0, 1).map((s, i) => <path key={i} d={`${path(s.values)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${id}-${i})`} />)}
        {series.map((s, i) => <path key={i} d={path(s.values)} fill="none" stroke={s.color ?? chartColor(i)} strokeWidth="2.25" strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {hover !== null && <><line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#94a3b8" strokeDasharray="3 3" />{series.map((s, i) => <circle key={i} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill="#fff" stroke={s.color ?? chartColor(i)} strokeWidth="2" />)}</>}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg" style={{ left: `${Math.min(78, Math.max(2, (x(hover) / W) * 100 - 8))}%` }}>
          <p className="mb-1 font-semibold">{labels[hover]}</p>
          {series.map((s, i) => <p key={i} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: s.color ?? chartColor(i) }} />{s.name}: <b>{format(s.values[hover] ?? 0)}</b></p>)}
        </div>
      )}
      {series.length > 1 && <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">{series.map((s, i) => <span key={i} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: s.color ?? chartColor(i) }} />{s.name}</span>)}</div>}
    </div>
  )
}

/** Vertical bars with value labels, for short categorical axes (hours, weekdays). */
export function Bars({ items, height = 150, format = (n) => String(n), highlight }: { items: { label: string; value: number }[]; height?: number; format?: (n: number) => string; highlight?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {items.map((it, i) => (
        <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${it.label}: ${format(it.value)}`}>
          <div className={clsx('w-full rounded-t-md transition', i === highlight ? 'bg-brand-600' : 'bg-brand-300 group-hover:bg-brand-500')} style={{ height: `${Math.max(it.value ? 4 : 1, (it.value / max) * 100)}%` }} />
          <span className="mt-1 truncate text-center text-[10px] text-muted">{it.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Horizontal ranked bars: top diagnoses, best sellers, doctors by workload. */
export function RankBars({ items, format = (n) => String(n), color = 'bg-brand-500', empty = 'Nothing to show for this period.' }: { items: { label: string; value: number; sub?: string }[]; format?: (n: number) => string; color?: string; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted">{empty}</p>
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><span className="truncate font-medium">{it.label}</span><span className="shrink-0 text-xs text-muted">{it.sub ? `${it.sub} · ` : ''}<b className="text-ink">{format(it.value)}</b></span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={clsx('h-full rounded-full', color)} style={{ width: `${(it.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

/** Ring chart with a legend, for shares (payment methods, revenue sources, visit types). */
export function Donut({ items, format = (n) => String(n), centre }: { items: { label: string; value: number }[]; format?: (n: number) => string; centre?: string }) {
  const total = items.reduce((a, i) => a + i.value, 0)
  const R = 42, C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="size-32 shrink-0 -rotate-90" role="img" aria-label="Share by category">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#e2e8f0" strokeWidth="13" />
        {total > 0 && items.map((it, i) => { const len = (it.value / total) * C; const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={chartColor(i)} strokeWidth="13" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />; acc += len; return el })}
        {centre && <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill="#0b1b33">{centre}</text>}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {items.map((it, i) => <li key={i} className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} /><span className="truncate">{it.label}</span><span className="ml-auto shrink-0 text-xs text-muted"><b className="text-ink">{format(it.value)}</b> · {total ? Math.round((it.value / total) * 100) : 0}%</span></li>)}
        {items.length === 0 && <li className="text-muted">No data.</li>}
      </ul>
    </div>
  )
}

/** A tiny trend line for KPI cards. */
export function Spark({ values, color = '#0f706f' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`).join(' ')
  return <svg viewBox="0 0 100 32" className="h-8 w-full" preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>
}

/** A headline number with a change indicator. */
export function Kpi({ label, value, sub, delta, tone = 'plain', icon, trend, onClick }: { label: string; value: string | number; sub?: string; delta?: { value: number; good?: 'up' | 'down' }; tone?: 'plain' | 'warn' | 'alert' | 'good'; icon?: React.ReactNode; trend?: number[]; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'
  const up = (delta?.value ?? 0) > 0
  const good = delta ? (delta.good === 'down' ? !up : up) : true
  return (
    <Tag onClick={onClick} className={clsx('rounded-2xl border bg-white p-4 text-left shadow-sm transition', onClick && 'hover:border-brand-300 hover:shadow-md', tone === 'alert' ? 'border-red-200' : tone === 'warn' ? 'border-amber-200' : 'border-line')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && <span className={clsx('grid size-8 place-items-center rounded-lg', tone === 'alert' ? 'bg-red-50 text-red-600' : tone === 'warn' ? 'bg-amber-50 text-amber-600' : 'bg-brand-50 text-brand-700')}>{icon}</span>}
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta && delta.value !== 0 && <span className={clsx('font-semibold', good ? 'text-emerald-600' : 'text-red-600')}>{up ? '▲' : '▼'} {Math.abs(delta.value)}%</span>}
        {sub && <span className="text-muted">{sub}</span>}
      </div>
      {trend && <div className="mt-2"><Spark values={trend} /></div>}
    </Tag>
  )
}

/** A white panel with a title; the building block of every dashboard page. */
export function Panel({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-white p-5 shadow-sm', className)}>
      {(title || action) && <div className="mb-4 flex items-center justify-between gap-3">{title && <h2 className="text-sm font-semibold">{title}</h2>}{action}</div>}
      {children}
    </section>
  )
}
