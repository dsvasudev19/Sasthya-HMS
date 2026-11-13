import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, refreshSession, session } from './lib/api'

interface Operator { user: { id: string; name: string | null } }
interface AuthState { me: Operator | null; loading: boolean; login: (phone: string, password: string) => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Operator | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    session.onLogout(() => { session.setToken(null); setMe(null) })
    refreshSession<Operator & { token: string }>().then((r) => { if (r) setMe({ user: r.user }) }).finally(() => setLoading(false))
  }, [])

  // Platform Operator compliance: auto-logout after 15 minutes of inactivity
  useEffect(() => {
    if (!me) return
    const TIMEOUT = 15 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        session.setToken(null)
        setMe(null)
        window.location.href = '/login?reason=inactivity'
      }, TIMEOUT)
    }
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach((ev) => window.removeEventListener(ev, reset))
    }
  }, [me])
  const login = useCallback(async (phone: string, password: string) => {
    const r = await api<Operator & { token: string }>('/auth/platform/login', { method: 'POST', body: JSON.stringify({ phone, password }) })
    session.setToken(r.token)
    setMe({ user: r.user })
  }, [])
  const logout = useCallback(async () => { await api('/auth/platform/logout', { method: 'POST', body: '{}' }).catch(() => undefined); session.setToken(null); setMe(null) }, [])
  return <Ctx.Provider value={{ me, loading, login, logout }}>{children}</Ctx.Provider>
}
export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error('useAuth outside AuthProvider'); return v }
