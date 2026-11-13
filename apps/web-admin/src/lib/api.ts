// The access token lives in memory only. The refresh token is an httpOnly cookie the page cannot read, so an XSS bug
// cannot steal a long-lived session. A reload gets a new access token from /auth/refresh.
let accessToken: string | null = null
let branchHeader: string | null = null
let logoutHandler: (() => void) | null = null

export const session = {
  setToken: (t: string | null) => { accessToken = t },
  /** A branch id, or 'all' for a combined view. Sent with every request so the server scopes the data. */
  setBranch: (b: string | null) => { branchHeader = b },
  onLogout: (fn: () => void) => { logoutHandler = fn },
}

export class ApiError extends Error {
  status: number
  body?: Record<string, unknown>
  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.body = body
  }
  get code() { return this.body?.code as string | undefined }
}

const BASE = '/api'
const JSON_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'hms' }

let refreshing: Promise<unknown | null> | null = null

/** One refresh at a time, however many requests hit a 401 together. */
export function refreshSession<T = unknown>(): Promise<T | null> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: JSON_HEADERS, credentials: 'same-origin', body: '{}' })
    .then(async (r) => {
      if (!r.ok) return null
      const body = await r.json()
      accessToken = body.token
      return body
    })
    .catch(() => null)
    .finally(() => { refreshing = null })
  return refreshing as Promise<T | null>
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...JSON_HEADERS, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(branchHeader ? { 'x-branch-id': branchHeader } : {}), ...init.headers },
  })
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false)
    logoutHandler?.()
  }
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (res.status === 403 && body?.code === 'MFA_SETUP_REQUIRED' && !window.location.pathname.startsWith('/security')) window.location.assign('/security?required=1')
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body)
  return body as T
}

/** Downloads a protected file (a spreadsheet) with the session token. */
export async function downloadFile(path: string, name: string, retry = true): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', headers: { 'x-requested-with': 'hms', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(branchHeader ? { 'x-branch-id': branchHeader } : {}) } })
  if (res.status === 401 && retry && (await refreshSession())) return downloadFile(path, name, false)
  if (!res.ok) throw new ApiError(res.status, 'Could not download the file')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Fetches a protected file (a PDF) with the session token and opens it in a new tab. */
export async function openFile(path: string, retry = true): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'x-requested-with': 'hms', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(branchHeader ? { 'x-branch-id': branchHeader } : {}) },
  })
  if (res.status === 401 && retry && (await refreshSession())) return openFile(path, false)
  if (!res.ok) throw new ApiError(res.status, 'Could not open the file')
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Sends a file (multipart). The browser sets the content type, so the JSON headers must not. */
export async function uploadFile<T>(path: string, form: FormData, retry = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
    headers: { 'x-requested-with': 'hms', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(branchHeader ? { 'x-branch-id': branchHeader } : {}) },
  })
  if (res.status === 401 && retry && (await refreshSession())) return uploadFile<T>(path, form, false)
  const text = await res.text()
  const body = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body)
  return body as T
}

/** A protected file as an object URL, for showing inside the page. The caller revokes it. */
export async function fetchBlobUrl(path: string, retry = true): Promise<{ url: string; type: string }> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', headers: { 'x-requested-with': 'hms', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(branchHeader ? { 'x-branch-id': branchHeader } : {}) } })
  if (res.status === 401 && retry && (await refreshSession())) return fetchBlobUrl(path, false)
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'This file is no longer available' : 'Could not open the file')
  const blob = await res.blob()
  return { url: URL.createObjectURL(blob), type: blob.type }
}

/** Sends a protected PDF straight to the printer through a hidden frame, so the cashier never sees a download or a new tab. */
export async function printPdf(path: string): Promise<void> {
  const { url } = await fetchBlobUrl(path)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.src = url
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60_000)
  }
  document.body.appendChild(frame)
}
