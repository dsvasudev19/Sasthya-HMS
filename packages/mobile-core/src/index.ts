import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

// iOS simulator and web reach the dev machine at localhost; the Android emulator uses 10.0.2.2.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000')

export class ApiError extends Error {
  status: number
  body?: Record<string, unknown>
  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.body = body
  }
}

function store(key: string) {
  return {
    async get(): Promise<string | null> {
      return Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) ?? null : SecureStore.getItemAsync(key)
    },
    async set(v: string) {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, v)
      else await SecureStore.setItemAsync(key, v)
    },
    async clear() {
      if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key)
      else await SecureStore.deleteItemAsync(key)
    },
  }
}

/**
 * One client per app so patient and staff sessions never share a token. Tokens live in the secure store (localStorage on web).
 * Pass `refreshPath` for apps with short-lived access tokens: on a 401 the client trades the stored refresh token for a new
 * pair (one attempt at a time) and retries the request once.
 */
export function createApiClient(tokenKey: string, opts: { refreshPath?: string; onSessionLost?: () => void } = {}) {
  const tokenStore = store(tokenKey)
  const refreshStore = store(`${tokenKey}.refresh`)
  let refreshing: Promise<boolean> | null = null

  async function raw(path: string, init: RequestInit, token: string | null): Promise<Response> {
    try {
      return await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
      })
    } catch {
      throw new ApiError(0, 'Cannot reach the server. Check your internet connection.')
    }
  }

  const refresh = (): Promise<boolean> => {
    refreshing ??= (async () => {
      const rt = await refreshStore.get()
      if (!rt || !opts.refreshPath) return false
      const res = await raw(opts.refreshPath, { method: 'POST', body: JSON.stringify({ refreshToken: rt }) }, null)
      if (!res.ok) return false
      const b = await res.json()
      await tokenStore.set(b.token)
      if (b.refreshToken) await refreshStore.set(b.refreshToken)
      return true
    })().finally(() => { refreshing = null })
    return refreshing
  }

  async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const res = await raw(path, init, await tokenStore.get())
    if (res.status === 401 && retry && opts.refreshPath && !path.startsWith('/auth/')) {
      if (await refresh()) return api<T>(path, init, false)
      await Promise.all([tokenStore.clear(), refreshStore.clear()])
      opts.onSessionLost?.()
    }
    const text = await res.text()
    const body = text ? JSON.parse(text) : undefined
    if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body)
    return body as T
  }

  return { api, tokenStore, refreshStore }
}
