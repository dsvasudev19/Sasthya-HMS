import { Activity, BarChart3, Building2, HeartPulse, LayoutGrid, LogOut, Megaphone, Receipt, ScrollText, ShieldCheck } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Avatar, navLinkCls, SidebarBrand, sidebarCls } from '@hms/ui-web'
import { useAuth } from '../auth'

const items = [
  { to: '/', label: 'Overview', icon: <LayoutGrid size={18} /> },
  { to: '/hospitals', label: 'Organizations', icon: <Building2 size={18} /> },
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} /> },
  { to: '/invoices', label: 'Invoices', icon: <Receipt size={18} /> },
  { to: '/logs', label: 'System logs', icon: <ScrollText size={18} /> },
  { to: '/audit', label: 'Operator audit', icon: <ShieldCheck size={18} /> },
  { to: '/announcements', label: 'Announcements', icon: <Megaphone size={18} /> },
  { to: '/system', label: 'System', icon: <Activity size={18} /> },
]

export default function Layout() {
  const { me, logout } = useAuth()
  return (
    <div className="h-screen overflow-hidden bg-white">
      <div className="flex h-full overflow-hidden bg-white">
        <aside className={sidebarCls}>
          <SidebarBrand icon={<HeartPulse size={19} strokeWidth={2.5} />} sub="Platform console" />
          <nav className="space-y-0.5">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => navLinkCls(isActive)}>{i.icon}{i.label}</NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-white px-4 pt-3 sm:px-6">
          <header className="flex shrink-0 items-center justify-end gap-3 border-b border-line pb-4">
            <Avatar name={me?.user.name} />
            <div className="text-sm leading-tight"><p className="font-semibold">{me?.user.name}</p><p className="text-xs text-muted">Platform operator</p></div>
            <button onClick={() => void logout()} className="rounded-full p-2 text-muted hover:bg-surface hover:text-ink" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pr-1 pt-6"><Outlet /></div>
        </main>
      </div>
    </div>
  )
}
