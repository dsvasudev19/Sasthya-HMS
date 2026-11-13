import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRightLeft, BarChart3, ClipboardList, HandCoins, LayoutDashboard, LogOut, Package, Settings as SettingsIcon, Pill, RotateCcw, ShoppingCart, Truck, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../auth'
import { BranchSwitcher } from '../../components/Layout'
import ThemeToggle from '../../components/ThemeToggle'
import { Avatar, navLinkCls, SidebarBrand, sidebarCls } from '../../components/ui'
import { api } from '../../lib/api'
import { rupees } from '../../lib/format'
import Credit from './Credit'
import Dashboard from './Dashboard'
import Inventory from './Inventory'
import Pos, { ShiftModal, type ShiftState } from './Pos'
import Purchases from './Purchases'
import Reports from './Reports'
import Returns from './Returns'
import Suppliers from './Suppliers'
import Transfers from './Transfers'

const NAV: { to: string; label: string; icon: ReactNode; perm: string }[] = [
  { to: '', label: 'Dashboard', icon: <LayoutDashboard size={18} />, perm: 'pharmacy:read' },
  { to: 'pos', label: 'Point of sale', icon: <ShoppingCart size={18} />, perm: 'pharmacy:pos' },
  { to: 'credit', label: 'Credit', icon: <HandCoins size={18} />, perm: 'pharmacy:pos' },
  { to: 'inventory', label: 'Inventory', icon: <Package size={18} />, perm: 'pharmacy:read' },
  { to: 'purchases', label: 'Purchases', icon: <ClipboardList size={18} />, perm: 'pharmacy:purchase' },
  { to: 'suppliers', label: 'Suppliers', icon: <Truck size={18} />, perm: 'pharmacy:purchase' },
  { to: 'returns', label: 'Returns', icon: <RotateCcw size={18} />, perm: 'pharmacy:returns' },
  { to: 'transfers', label: 'Transfers', icon: <ArrowRightLeft size={18} />, perm: 'pharmacy:transfer' },
  { to: 'reports', label: 'Reports', icon: <BarChart3 size={18} />, perm: 'pharmacy:reports' },
]

/** The pharmacy has its own full-screen workspace: counter, stock, buying, returns and reports in one place. */
export default function PharmacyApp() {
  const { me, can, logout, hasFeature } = useAuth()
  const [closing, setClosing] = useState(false)
  const shift = useQuery({ queryKey: ['pos-shift'], queryFn: () => api<ShiftState>('/pos/shift'), enabled: can('pharmacy:pos') })
  const items = NAV.filter((n) => can(n.perm))
  if (!hasFeature('pharmacy')) return <Navigate to="/settings?tab=subscription" replace />
  if (items.length === 0) return <Navigate to="/" replace />

  return (
    <div className="h-screen overflow-hidden bg-white">
      <div className="flex h-full overflow-hidden">
        <aside className={sidebarCls}>
          <SidebarBrand icon={<Pill size={19} strokeWidth={2.5} />} sub="Pharmacy" />
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
            {items.map((n) => (
              <NavLink key={n.to} to={n.to === '' ? '/pharmacy' : `/pharmacy/${n.to}`} end={n.to === ''} className={({ isActive }) => navLinkCls(isActive)}>
                {n.icon}<span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          {me?.tenant.kind === 'PHARMACY'
            ? can('team:manage', 'settings:write') && <NavLink to="/settings" className={() => navLinkCls(false)}><SettingsIcon size={18} /> Settings and team</NavLink>
            : <NavLink to="/" className={() => navLinkCls(false)}><ArrowLeft size={18} /> Back to hospital</NavLink>}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-white px-4 pb-0 pt-3 sm:px-5">
          <header className="mb-4 flex shrink-0 flex-wrap items-center gap-3 border-b border-line pb-3">
            <NavLink to="/" className="rounded-full p-2 text-muted hover:bg-surface lg:hidden" aria-label="Back to hospital"><ArrowLeft size={18} /></NavLink>
            <div className="mr-auto min-w-0"><p className="truncate text-sm font-semibold">{me?.tenant.name}</p><p className="text-xs text-muted">Pharmacy workspace</p></div>
            <BranchSwitcher />
            <ThemeToggle />
            {can('pharmacy:pos') && shift.data && (
              shift.data.shift
                ? <button onClick={() => setClosing(true)} className="flex items-center gap-2 rounded-full bg-brand-100 px-4 py-2 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-200"><Wallet size={14} />Shift open · {shift.data.sales} sales · cash {rupees(shift.data.expectedCashPaise)} · Close</button>
                : <span className="rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-800">No shift open</span>
            )}
            <div className="flex items-center gap-2"><Avatar name={me?.user.name} className="size-9 text-xs" /><span className="hidden text-sm font-semibold sm:block">{me?.user.name}</span>
              <button onClick={() => void logout()} className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Sign out"><LogOut size={17} /></button></div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pr-1">
            <Routes>
              <Route index element={can('pharmacy:read') ? <Dashboard /> : <Navigate to="pos" replace />} />
              <Route path="pos" element={<Pos />} />
              <Route path="credit" element={<Credit />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="purchases" element={<Purchases />} />
              <Route path="suppliers" element={<Suppliers />} />
              <Route path="returns" element={<Returns />} />
              <Route path="transfers" element={<Transfers />} />
              <Route path="reports" element={<Reports />} />
              <Route path="*" element={<Navigate to="/pharmacy" replace />} />
            </Routes>
          </div>
        </main>
      </div>
      {closing && shift.data?.shift && <ShiftModal mode="close" state={shift.data} onClose={() => setClosing(false)} />}
    </div>
  )
}
