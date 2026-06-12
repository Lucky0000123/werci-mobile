// Centralized API access with device-token auth and intelligent failover
import connectionManager from './connectionManager'


// Environment-based configuration with proper fallbacks (used only as last resort)
// Priority: emulator/localhost (highest) → company network → cloud (lowest)
const DEV_BASE = import.meta.env.VITE_DEV_BASE || 'http://10.0.2.2:8082'          // Android emulator host alias
const LOCAL_BASE = import.meta.env.VITE_LOCAL_BASE || 'http://10.40.20.184:8082'   // Production server on port 8082 (LAN)
const CLOUD_BASE = import.meta.env.VITE_CLOUD_BASE || 'https://api.werci.my.id'    // Cloudflare Tunnel — HTTPS, works on 4G/anywhere
const HEALTH_TIMEOUT = parseInt(import.meta.env.VITE_HEALTH_CHECK_TIMEOUT || '8000')
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT || '15000')

export type ApiOptions = { token?: string; timeout?: number }

// Module-level token cache so every API call carries auth without each
// caller passing it. auth.ts keeps this in sync via setCachedToken() whenever
// the session is restored/written/cleared (session now lives in Capacitor
// Preferences). localStorage remains a read-only fallback for sessions
// written by older app versions that haven't bootstrapped yet.
const SESSION_KEY = 'prism_session_v1'
let cachedToken: string | null = null

export function setCachedToken(token: string | null): void {
  cachedToken = token
}

export function getStoredToken(): string | null {
  if (cachedToken) return cachedToken
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as { token?: string }
    return session?.token || null
  } catch {
    return null
  }
}

// Cache for endpoint health to avoid duplicate checks
const endpointCache = new Map<string, { healthy: boolean; lastCheck: number; responseTime: number }>()
const CACHE_DURATION = 60000 // 1 minute cache

async function probe(url: string, timeoutMs = HEALTH_TIMEOUT): Promise<{ healthy: boolean; responseTime: number }> {
  const cacheKey = url
  const cached = endpointCache.get(cacheKey)

  // Return cached result if still valid
  if (cached && (Date.now() - cached.lastCheck) < CACHE_DURATION) {
    return { healthy: cached.healthy, responseTime: cached.responseTime }
  }

  const startTime = Date.now()
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const response = await fetch(url + '/health', {
      signal: ctrl.signal,
      method: 'GET',
      cache: 'no-store'
    })
    const responseTime = Date.now() - startTime
    const healthy = response.ok

    // Cache the result
    endpointCache.set(cacheKey, { healthy, lastCheck: Date.now(), responseTime })

    return { healthy, responseTime }
  } catch {
    const responseTime = Date.now() - startTime
    // Cache the failure
    endpointCache.set(cacheKey, { healthy: false, lastCheck: Date.now(), responseTime })

    return { healthy: false, responseTime }
  } finally {
    clearTimeout(timeout)
  }
}

async function pickBase(): Promise<string> {
  // 1) Prefer the endpoint already chosen by Diagnostics (local > cloud)
  try {
    const active = connectionManager.getActiveEndpoint()
    if (active) return active

    // If not yet evaluated, run a fast check and try again
    await connectionManager.forceCheck()
    const activeAfterCheck = connectionManager.getActiveEndpoint()
    if (activeAfterCheck) return activeAfterCheck
  } catch {
    // ignore and fall back to legacy logic below
  }

  // 2) Legacy fallback: in dev, try emulator/localhost first
  const isDev = import.meta.env.DEV
  if (isDev) {
    const devResult = await probe(DEV_BASE)
    if (devResult.healthy) return DEV_BASE
  }

  // 3) Final fallback: prefer local if available, then cloud
  const [localResult, cloudResult] = await Promise.all([
    probe(LOCAL_BASE),
    probe(CLOUD_BASE)
  ])

  if (localResult.healthy) {
    console.log(`🏢 Using local endpoint: ${LOCAL_BASE} (${localResult.responseTime}ms)`)
    return LOCAL_BASE
  }

  if (cloudResult.healthy) {
    console.log(`📡 Using cloud endpoint: ${CLOUD_BASE} (${cloudResult.responseTime}ms)`)
    return CLOUD_BASE
  }

  console.warn('⚠️ No healthy endpoints found, defaulting to cloud')
  return CLOUD_BASE
}

export async function apiFetch(path: string, init: RequestInit = {}, opts: ApiOptions = {}): Promise<Response> {
  const base = await pickBase()
  const headers = new Headers(init.headers)

  // Add authentication: explicit token wins, otherwise fall back to the
  // persisted session token. Server endpoints now require auth for all
  // fleet/personnel data, so unauthenticated calls would 401.
  const token = opts.token || getStoredToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  // Set content type for JSON requests (do NOT set for FormData)
  const method = (init.method || 'GET').toUpperCase()
  const isFormData = typeof FormData !== 'undefined' && (init as { body?: unknown }).body instanceof FormData
  if (!headers.has('Content-Type') && (method === 'POST' || method === 'PUT' || method === 'PATCH') && !isFormData) {
    headers.set('Content-Type', 'application/json')
  }

  // Create abort controller for timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeout || API_TIMEOUT)

  try {
    const response = await fetch(base + path, {
      ...init,
      headers,
      signal: controller.signal
    })

    return response
  } finally {
    clearTimeout(timeout)
  }
}

// Export endpoint information for debugging
export function getEndpointStatus() {
  return {
    cloud: CLOUD_BASE,
    local: LOCAL_BASE,
    dev: DEV_BASE,
    cache: Array.from(endpointCache.entries()).map(([url, data]) => ({
      url,
      ...data,
      cacheAge: Date.now() - data.lastCheck
    }))
  }
}

