import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, onSessionLost, refreshStore, tokenStore } from './api'
import type { HospitalChoice, Me } from './types'

type Auth = Me & { token: string; refreshToken?: string }

interface Session {
  ready: boolean
  me: Me | null
  /** True when the person holds at least one of these permissions. The server enforces it either way. */
  can: (...permissions: string[]) => boolean
  /** Returns the hospitals to choose from when the account belongs to several. */
  signIn: (phone: string, password: string, tenantId?: string) => Promise<HospitalChoice[] | null>
  changePassword: (current: string, next: string) => Promise<void>
  signOut: () => Promise<void>
}
const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onSessionLost(() => setMe(null))
    tokenStore.get().then(async (t) => {
      if (t) setMe(await api<Me>('/me').catch(() => null))
      setReady(true)
    })
  }, [])

  const keep = useCallback(async (r: Auth) => {
    await tokenStore.set(r.token)
    if (r.refreshToken) await refreshStore.set(r.refreshToken)
    setMe({ user: r.user, tenant: r.tenant, permissions: r.permissions ?? [], mustChangePassword: r.mustChangePassword })
  }, [])

  const signIn = useCallback(async (phone: string, password: string, tenantId?: string) => {
    try {
      await keep(await api<Auth>('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password, tenantId, client: 'mobile' }) }))
      return null
    } catch (e) {
      if (e instanceof ApiError && e.status === 300) return (e.body?.['choose'] as HospitalChoice[]) ?? []
      throw e
    }
  }, [keep])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await keep(await api<Auth>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, client: 'mobile' }) }))
  }, [keep])

  const signOut = useCallback(async () => {
    const refreshToken = await refreshStore.get()
    if (refreshToken) await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }).catch(() => undefined)
    await Promise.all([tokenStore.clear(), refreshStore.clear()])
    setMe(null)
  }, [])

  const can = useCallback((...wanted: string[]) => !!me && wanted.some((w) => me.permissions.some((g) => g === '*' || g === w || (g.endsWith(':*') && w.startsWith(g.slice(0, -1))))), [me])
  return <Ctx.Provider value={{ ready, me, can, signIn, changePassword, signOut }}>{children}</Ctx.Provider>
}

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
