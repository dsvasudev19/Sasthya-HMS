import clsx from 'clsx'
import {
  BarChart3, BedDouble, Download, Gauge, Landmark, Scissors, Siren, Star, UserCog, CalendarCheck, CheckSquare, ClipboardList, Clock, FileText, FlaskConical, HeartPulse, LayoutGrid,
  MessageCircle, Building2, ScanLine, Search, Shield, Pill, Receipt, Settings as SettingsIcon, Users, Video, LogOut, Lock,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import Announcements from './Announcements'
import CommandPalette from './CommandPalette'
import NewAppointmentModal from './NewAppointmentModal'
import NewInvoiceModal from './NewInvoiceModal'
import NewPatientModal from './NewPatientModal'
import NotificationBell from './NotificationBell'
import { ScanButton } from '../lib/scan'
import ThemeToggle from './ThemeToggle'
import Select from './Select'
import { Avatar, navGroupCls, navLinkCls, SidebarBrand, sidebarCls } from './ui'

const groups: { title: string; items: { to: string; label: string; icon: ReactNode; soon?: boolean; perm?: string[]; feature?: string }[] }[] = [
  {
    title: 'General',
    items: [
      { to: '/', label: 'Workspace', icon: <LayoutGrid size={18} />, perm: ['patients:read'] },
      { to: '/patients', label: 'Patients', icon: <Users size={18} />, perm: ['patients:read'] },
      { to: '/checkin', label: 'Front desk', icon: <ScanLine size={18} />, perm: ['appointments:write'], feature: 'scan' },
      { to: '/appointments', label: 'Appointments', icon: <CalendarCheck size={18} />, perm: ['appointments:read'] },
      { to: '/billing', label: 'Billing', icon: <Receipt size={18} />, perm: ['billing:read'] },
      { to: '/insurance', label: 'Insurance', icon: <Landmark size={18} />, perm: ['insurance:read'], feature: 'insurance' },
      { to: '/executive', label: 'Executive', icon: <Gauge size={18} />, perm: ['executive:read'], feature: 'reports' },
      { to: '/reports', label: 'Reports', icon: <BarChart3 size={18} />, perm: ['reports:read'], feature: 'reports' },
      { to: '/organization', label: 'Organization', icon: <Building2 size={18} />, perm: ['team:manage'] },
      { to: '/tasks', label: 'Tasks', icon: <CheckSquare size={18} />, perm: ['patients:read'], feature: 'tasks' },
    ],
  },
  {
    title: 'Clinical data',
    items: [
      { to: '/emergency', label: 'Emergency', icon: <Siren size={18} />, perm: ['er:read'], feature: 'emergency' },
      { to: '/ipd', label: 'Inpatients', icon: <BedDouble size={18} />, perm: ['ipd:read'], feature: 'ipd' },
      { to: '/theatre', label: 'Operation theatre', icon: <Scissors size={18} />, perm: ['ot:read'], feature: 'ot' },
      { to: '/lab', label: 'Laboratory', icon: <FlaskConical size={18} />, perm: ['lab:read'], feature: 'lab' },
      { to: '/pharmacy', label: 'Pharmacy', icon: <Pill size={18} />, perm: ['pharmacy:read'], feature: 'pharmacy' },
      { to: '/documents', label: 'Documents', icon: <FileText size={18} />, perm: ['documents:read'], feature: 'documents' },
    ],
  },
  {
    title: 'Communication',
    items: [
      { to: '/staff', label: 'Staff', icon: <UserCog size={18} />, perm: ['patients:read'], feature: 'workforce' },
      { to: '/feedback', label: 'Feedback', icon: <Star size={18} />, perm: ['feedback:read'], feature: 'feedback' },
      { to: '/exports', label: 'Exports', icon: <Download size={18} />, perm: ['exports:read'], feature: 'reports' },
      { to: '/security', label: 'Security', icon: <Lock size={18} />, perm: ['patients:read'] },
      { to: '/audit', label: 'Audit trail', icon: <Shield size={18} />, perm: ['audit:read'] },
      { to: '/settings', label: 'Settings', icon: <SettingsIcon size={18} />, perm: ['team:manage', 'policies:manage', 'branches:manage', 'doctors:manage', 'settings:write'] },
      { to: '/messages', label: 'Messages', icon: <MessageCircle size={18} />, perm: ['messages:read'], feature: 'messaging' },
      { to: '/consultations', label: 'Tele-consultations', icon: <Video size={18} />, perm: ['appointments:read'], feature: 'tele' },
      { to: '/cards', label: 'Health cards', icon: <ClipboardList size={18} />, perm: ['cards:read'] },
    ],
  },
]

function Sidebar() {
  const { can, hasFeature, me } = useAuth()
  const pharmacyOnly = me?.tenant.kind === 'PHARMACY'
  return (
    <aside className={sidebarCls}>
      <SidebarBrand icon={<HeartPulse size={19} strokeWidth={2.5} />} sub={pharmacyOnly ? 'Pharmacy' : me?.tenant.name} />
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto pb-4 [scrollbar-width:thin]">
        {groups.map((g) => {
          const items = g.items.filter((i) => (!pharmacyOnly || i.to === '/settings') && (!i.perm || can(...i.perm)))
          if (items.length === 0) return null
          return (
          <div key={g.title}>
            <p className={navGroupCls}>{g.title}</p>
            <ul className="space-y-0.5">
              {items.map((i) => {
                const locked = !!i.feature && !hasFeature(i.feature)
                return (
                  <li key={i.to}>
                    <NavLink to={locked ? '/settings?tab=subscription' : i.to} end={i.to === '/'} className={({ isActive }) => navLinkCls(isActive && !locked)}>
                      {i.icon}
                      <span className="flex-1">{i.label}</span>
                      {i.soon && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">Soon</span>}
                      {locked && <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"><Lock size={9} />Upgrade</span>}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
          )
        })}
      </nav>
    </aside>
  )
}

/** Only appears when the person can work in more than one branch. "All branches" is a combined, read-friendly view. */
export function BranchSwitcher({ className }: { className?: string }) {
  const { me, branchId, setBranchId, can } = useAuth()
  const qc = useQueryClient()
  const list = me?.branches ?? []
  if (list.length < 2) return null
  const options = [...list.map((b) => ({ value: b.id, label: b.name, hint: b.code })), ...(can('branches:all') && list.length > 1 ? [{ value: 'all', label: 'All branches', hint: 'Combined view' }] : [])]
  return (
    <div className={clsx('flex items-center gap-2 rounded-full bg-surface px-3 ring-1 ring-line', className)}>
      <Building2 size={16} className="shrink-0 text-brand-700" />
      <div className="w-44"><Select value={branchId} onChange={(id) => { setBranchId(id); void qc.invalidateQueries() }} options={options} ariaLabel="Branch" className="!border-0 !bg-transparent !px-1 !py-2.5 font-semibold" /></div>
    </div>
  )
}

function Topbar({ onSearch }: { onSearch: () => void }) {
  const { me, logout } = useAuth()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line pb-3">
      <button onClick={onSearch} className="flex min-w-64 flex-1 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-left text-sm text-muted transition hover:border-brand-300 hover:bg-white" aria-label="Search or scan (Ctrl K)">
        <Search size={16} /><span className="flex-1 truncate">Search patients, bills, lab… or scan a code</span><kbd className="hidden rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-line sm:block">Ctrl K</kbd>
      </button>
      <BranchSwitcher />
      <div className="hidden items-center gap-2 text-sm text-muted xl:flex">
        <Clock size={15} />
        <span className="font-medium text-ink">{now.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <ScanButton />
      <ThemeToggle />
      <NotificationBell />
      <div className="flex items-center gap-3">
        <Avatar name={me?.user.name} />
        <div className="text-sm leading-tight">
          <p className="font-semibold">{me?.user.name}</p>
          <p className="text-xs capitalize text-muted">{me?.user.roles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ')}</p>
        </div>
        <button onClick={() => void logout()} className="rounded-xl p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}

function AccountBanner() {
  const { me, can } = useAuth()
  const t = me?.tenant
  if (!t) return null
  const trialEnded = t.status === 'TRIAL' && t.trialEndsAt && new Date(t.trialEndsAt) < new Date()
  const days = t.trialEndsAt ? Math.max(0, Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86_400_000)) : 0
  const link = can('subscription:manage') ? <a href="/settings?tab=subscription" className="underline">Open subscription</a> : null
  if (t.status === 'SUSPENDED' || t.status === 'CLOSED' || trialEnded) {
    return <div className="mb-3 shrink-0 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">{t.status === 'SUSPENDED' ? (t.suspendedReason === 'unpaid_invoice' ? 'This hospital is read-only because a Swasthya invoice is overdue.' : 'This hospital account is suspended.') : t.status === 'CLOSED' ? 'This hospital account is closed.' : 'Your free trial has ended.'} {link}</div>
  }
  if (t.status === 'TRIAL') return <div className="mb-3 shrink-0 rounded-2xl bg-brand-50 px-4 py-2.5 text-sm text-brand-800 ring-1 ring-brand-200">Free trial: <b>{days} day{days === 1 ? '' : 's'} left</b> with every feature unlocked. {link}</div>
  return null
}

export default function Layout() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const [palette, setPalette] = useState(false)
  const [creating, setCreating] = useState<null | 'appointment' | 'patient' | 'bill'>(null)

  // Ctrl or Cmd+K, or "/" outside a text field, opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setPalette(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A standalone pharmacy lives in the pharmacy workspace; only settings are reached from here.
  if (me?.tenant.kind === 'PHARMACY' && !pathname.startsWith('/settings')) return <Navigate to="/pharmacy" replace />
  return (
    <div className="h-screen overflow-hidden bg-white">
      <a href="#main" className="sr-only z-[90] rounded-xl bg-brand-700 px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <div className="flex h-full overflow-hidden bg-white">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-white px-4 pb-0 pt-3 sm:px-6">
          <AccountBanner />
          <Announcements />
          <Topbar onSearch={() => setPalette(true)} />
          <div id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pr-1 pt-6 outline-none">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onNew={setCreating} />
      {creating === 'appointment' && <NewAppointmentModal onClose={() => setCreating(null)} />}
      {creating === 'patient' && <NewPatientModal onClose={() => setCreating(null)} />}
      {creating === 'bill' && <NewInvoiceModal onClose={() => setCreating(null)} onCreated={() => setCreating(null)} />}
    </div>
  )
}
