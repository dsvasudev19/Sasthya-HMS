// Same session model as the hospital dashboard: access token in memory, refresh token in an httpOnly cookie.
let accessToken: string | null = null
let logoutHandler: (() => void) | null = null
export const session = { setToken: (t: string | null) => { accessToken = t }, onLogout: (fn: () => void) => { logoutHandler = fn } }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const H = { 'content-type': 'application/json', 'x-requested-with': 'hms' }
let refreshing: Promise<unknown | null> | null = null

export function refreshSession<T = unknown>(): Promise<T | null> {
  refreshing ??= fetch('/api/auth/platform/refresh', { method: 'POST', headers: H, credentials: 'same-origin', body: '{}' })
    .then(async (r) => { if (!r.ok) return null; const b = await r.json(); accessToken = b.token; return b })
    .catch(() => null)
    .finally(() => { refreshing = null })
  return refreshing as Promise<T | null>
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { ...H, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...init.headers } })
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false)
    logoutHandler?.()
  }
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText)
  return body as T
}
