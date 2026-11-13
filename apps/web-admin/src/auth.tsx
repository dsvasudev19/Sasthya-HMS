import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, refreshSession, session } from './lib/api'

export interface Tenant {
  id: string
  name: string
  kind: 'HOSPITAL' | 'CLINIC' | 'PHARMACY'
  plan: 'PAY_PER_PATIENT' | 'STARTER' | 'UNLIMITED'
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  trialEndsAt: string | null
  suspendedReason: string | null
  features: string[]
}
export interface Branch { id: string; code: string; name: string }
export interface Me {
  user: { id: string; name: string | null; role: string; roles: string[] }
  tenant: Tenant
  permissions: string[]
  branches: Branch[]
  mustChangePassword: boolean
  security?: { mfaEnabled: boolean; mfaRequired: boolean }
}
export interface HospitalChoice { tenantId: string; name: string; roles: string[] }

/** Same matching rule as the server: '*' is everything, 'group:*' is a whole area, otherwise an exact key. */
export const grants = (granted: string[], wanted: string) =>
  granted.some((g) => g === '*' || g === wanted || (g.endsWith(':*') && wanted.startsWith(g.slice(0, -1))))

interface AuthState {
  me: Me | null
  loading: boolean
  /** Returns the hospitals to choose from when the account belongs to several. */
  login: (phone: string, password: string, tenantId?: string) => Promise<HospitalChoice[] | { challenge: string } | null>
  completeMfa: (challenge: string, code: string) => Promise<void>
  apply: (r: Me & { token: string }) => void
  logout: () => Promise<void>
  /** True when the signed-in user holds at least one of these permissions. Hiding a button is a courtesy; the server enforces it. */
  can: (...permissions: string[]) => boolean
  hasFeature: (f: string) => boolean
  branch: Branch | null
  /** 'all' means a combined view across every branch the user may see. */
  branchId: string
  setBranchId: (id: string) => void
}

const Ctx = createContext<AuthState | null>(null)
const KEY = 'hms.branch'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = (v: string) => { try { localStorage.setItem(KEY, v) } catch { /* private mode */ } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [branchId, setBranch] = useState<string>('')

  const choose = useCallback((branches: Branch[], perms: string[], preferred: string | null) => {
    const all = grants(perms, 'branches:all') && branches.length > 1
    const next = preferred === 'all' && all ? 'all' : branches.find((b) => b.id === preferred)?.id ?? branches[0]?.id ?? ''
    session.setBranch(next || null)
    setBranch(next)
  }, [])

  const apply = useCallback((r: Me & { token: string }) => {
    session.setToken(r.token)
    const next: Me = { user: r.user, tenant: r.tenant, permissions: r.permissions ?? [], branches: r.branches ?? [], mustChangePassword: r.mustChangePassword }
    setMe(next)
    choose(next.branches, next.permissions, read())
  }, [choose])

  useEffect(() => {
    session.onLogout(() => { session.setToken(null); session.setBranch(null); setMe(null) })
    refreshSession<Me & { token: string }>().then((r) => { if (r) apply(r) }).finally(() => setLoading(false))
  }, [apply])

  // Settings pages dispatch this after changing branches or roles, so the switcher and menus stay current.
  useEffect(() => {
    const reload = () => { api<Omit<Me, never>>('/me').then((r) => { setMe(r); choose(r.branches, r.permissions, read()) }).catch(() => undefined) }
    window.addEventListener('hms:refresh-me', reload)
    return () => window.removeEventListener('hms:refresh-me', reload)
  }, [choose])

  // Healthcare compliance: Automatic session logout after 15 minutes of inactivity (HIPAA § 164.312(a)(2)(iii))
  useEffect(() => {
    if (!me) return
    const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        session.setToken(null)
        session.setBranch(null)
        setMe(null)
        window.location.href = '/login?reason=inactivity'
      }, INACTIVITY_TIMEOUT_MS)
    }
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach((ev) => window.removeEventListener(ev, reset))
    }
  }, [me])

  const login = useCallback(async (phone: string, password: string, tenantId?: string) => {
    try {
      const r = await api<(Me & { token: string }) | { mfaRequired: true; challenge: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password, tenantId }) })
      if ('mfaRequired' in r) return { challenge: r.challenge }
      apply(r)
      return null
    } catch (e) {
      if (e instanceof ApiError && e.status === 300) return (e.body?.['choose'] as HospitalChoice[]) ?? []
      throw e
    }
  }, [apply])

  const completeMfa = useCallback(async (challenge: string, code: string) => {
    apply(await api<Me & { token: string }>('/auth/login/mfa', { method: 'POST', body: JSON.stringify({ challenge, code }) }))
  }, [apply])

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined)
    session.setToken(null)
    session.setBranch(null)
    setMe(null)
  }, [])

  const value = useMemo<AuthState>(() => ({
    me, loading, login, completeMfa, apply, logout,
    can: (...permissions) => !!me && permissions.some((p) => grants(me.permissions, p)),
    hasFeature: (f) => !!me?.tenant.features.includes(f),
    branch: me?.branches.find((b) => b.id === branchId) ?? null,
    branchId,
    setBranchId: (id) => { write(id); session.setBranch(id); setBranch(id) },
  }), [me, loading, login, completeMfa, apply, logout, branchId])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
