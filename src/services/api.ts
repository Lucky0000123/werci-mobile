// Centralized API access with device-token auth and failover

const CLOUD_BASE = (import.meta.env.VITE_CLOUD_BASE as string) ?? 'https://159.65.13.232'
const LOCAL_BASE = (import.meta.env.VITE_LOCAL_BASE as string) ?? 'http://10.40.21.184'

export type ApiOptions = { token?: string }

async function probe(url: string, timeoutMs = 2000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    await fetch(url + '/health', { signal: ctrl.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

async function pickBase() {
  // Prefer cloud; if unreachable and LAN detected, fallback
  if (await probe(CLOUD_BASE)) return CLOUD_BASE
  // Try local
  if (await probe(LOCAL_BASE)) return LOCAL_BASE
  return CLOUD_BASE // default
}

export async function apiFetch(path: string, init: RequestInit = {}, opts: ApiOptions = {}) {
  const base = await pickBase()
  const headers = new Headers(init.headers)
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`)
  headers.set('Content-Type', 'application/json')
  return fetch(base + path, { ...init, headers })
}

