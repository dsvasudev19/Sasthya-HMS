import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bars, Kpi, Panel, RankBars } from '../components/charts'
import { api } from '../lib/api'
import { fmtDate, rupees } from '../lib/format'

interface Org {
  seats: { used: number; limit: number }
  people: { total: number; activeLast7d: number; neverSignedIn: number; idle30d: number; idleList: { id: string; name: string | null; phone: string; lastSignIn: string | null; roles: string[] }[] }
  access: { roles: { key: string; name: string; system: boolean; permissions: number | 'all'; people: number }[]; customRoles: number; policies: number; policiesOn: number }
  security: { eventsLast7d: number }
  recentAccessChanges: { id: string; action: string; by: string | null; at: string }[]
  branches: { code: string; name: string; visits30d: number; billed30dPaise: number }[]
  modules: string[]
}
const ACTION: Record<string, string> = { 'access.role.create': 'Created a role', 'access.role.update': 'Changed a role', 'access.role.delete': 'Deleted a role', 'access.policy.create': 'Added a policy', 'access.policy.update': 'Changed a policy', 'access.policy.delete': 'Removed a policy', 'access.override.create': 'Gave or took away a permission', 'access.override.remove': 'Cleared a personal permission', 'access.team.roles': "Changed someone's roles", 'access.team.branches': "Changed someone's branches" }

/** The organization admin's own overview: who has access, how it is set up, and how each branch is doing. */
export default function Organization() {
  const { data: o } = useQuery({ queryKey: ['organization'], queryFn: () => api<Org>('/analytics/organization') })
  if (!o) return <p className="py-16 text-center text-sm text-muted">Loading…</p>
  const seatPct = Math.round((o.seats.used / Math.max(1, o.seats.limit)) * 100)
  return (
    <div className="space-y-5 pb-6">
      <div><h1 className="text-2xl font-bold tracking-tight">Organization</h1><p className="text-sm text-muted">People, access and branches. Change roles, policies and branches in <Link className="font-semibold text-brand-700 hover:underline" to="/settings">Settings</Link>.</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Staff accounts" value={`${o.seats.used} of ${o.seats.limit > 9999 ? 'unlimited' : o.seats.limit}`} sub={`${seatPct}% of plan used`} tone={seatPct >= 90 ? 'warn' : 'plain'} />
        <Kpi label="Active this week" value={o.people.activeLast7d} sub={`of ${o.people.total} people`} />
        <Kpi label="Not signed in for 30 days" value={o.people.idle30d} sub={`${o.people.neverSignedIn} never signed in`} tone={o.people.idle30d ? 'warn' : 'plain'} />
        <Kpi label="Security events, 7 days" value={o.security.eventsLast7d} sub="failed or blocked sign-ins" tone={o.security.eventsLast7d > 10 ? 'alert' : 'plain'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Roles" action={<span className="text-xs text-muted">{o.access.customRoles} custom · {o.access.policiesOn} of {o.access.policies} policies on</span>}>
          <ul className="divide-y divide-line text-sm">{o.access.roles.map((r) => <li key={r.key} className="flex items-center justify-between py-2.5"><span><span className="font-semibold">{r.name}</span>{!r.system && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">CUSTOM</span>}<span className="block text-xs text-muted">{r.permissions === 'all' ? 'Every permission' : `${r.permissions} permissions`}</span></span><span className="text-muted">{r.people} {r.people === 1 ? 'person' : 'people'}</span></li>)}</ul>
        </Panel>
        <Panel title="Branches, last 30 days">
          <RankBars items={o.branches.map((b) => ({ label: b.name, value: b.billed30dPaise, sub: `${b.visits30d} visits` }))} format={rupees} />
          {o.branches.length > 1 && <div className="mt-4"><Bars items={o.branches.map((b) => ({ label: b.code, value: b.visits30d }))} height={90} /></div>}
        </Panel>
        <Panel title="Needs attention">
          {o.people.idleList.length === 0 ? <p className="py-6 text-center text-sm text-muted">Everyone has signed in recently.</p> : (
            <ul className="divide-y divide-line text-sm">{o.people.idleList.map((p) => <li key={p.id} className="flex justify-between py-2.5"><span><span className="font-semibold">{p.name ?? p.phone}</span><span className="block text-xs text-muted">{p.roles.join(', ')} · {p.phone}</span></span><span className="text-xs text-muted">{p.lastSignIn ? `last ${fmtDate(p.lastSignIn)}` : 'never signed in'}</span></li>)}</ul>)}
          <p className="mt-3 text-xs text-muted">Consider deactivating accounts nobody uses. It frees a staff seat and removes a way in.</p>
        </Panel>
        <Panel title="Recent access changes">
          {o.recentAccessChanges.length === 0 ? <p className="py-6 text-center text-sm text-muted">No changes in the last 30 days.</p> : <ul className="divide-y divide-line text-sm">{o.recentAccessChanges.map((c) => <li key={c.id} className="flex justify-between gap-3 py-2.5"><span>{ACTION[c.action] ?? c.action}<span className="text-muted"> · {c.by ?? 'system'}</span></span><span className="shrink-0 text-xs text-muted">{fmtDate(c.at)}</span></li>)}</ul>}
        </Panel>
      </div>
    </div>
  )
}
