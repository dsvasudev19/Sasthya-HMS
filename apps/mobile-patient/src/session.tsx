import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, tokenStore } from './api'
import type { Me } from './types'

interface Session {
  ready: boolean
  me: Me | null
  signIn: (token: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    setMe(await api<Me>('/patient/me'))
  }, [])

  useEffect(() => {
    tokenStore.get().then(async (t) => {
      if (t) await refresh().catch(() => tokenStore.clear())
      setReady(true)
    })
  }, [refresh])

  const signIn = useCallback(async (token: string) => {
    await tokenStore.set(token)
    await refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    await tokenStore.clear()
    setMe(null)
  }, [])

  return <Ctx.Provider value={{ ready, me, signIn, signOut, refresh }}>{children}</Ctx.Provider>
}

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
