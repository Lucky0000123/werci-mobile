// Centralized API access with device-token auth and intelligent failover
import connectionManager from './connectionManager'


// Environment-based configuration with proper fallbacks (used only as last resort)
// Priority: emulator/localhost (highest) → company network → cloud (lowest)
const DEV_BASE = import.meta.env.VITE_DEV_BASE || 'http://10.0.2.2:8082'          // Android emulator host alias
const LOCAL_BASE = import.meta.env.VITE_LOCAL_BASE || 'http://10.40.20.184:8082'  // Company network (LAN) - FIXED PORT
const CLOUD_BASE = import.meta.env.VITE_CLOUD_BASE || 'http://159.65.13.232:5000' // Cloud fallback - CORRECT PORT 5000
const HEALTH_TIMEOUT = parseInt(import.meta.env.VITE_HEALTH_CHECK_TIMEOUT || '5000')
const API_TIMEOUT = parseInt(import.meta.env.VITE_API_TIMEOUT || '10000')

export type ApiOptions = { token?: string; timeout?: number }

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
  } catch (error) {
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
  } catch (_) {
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

  // Add authentication if token provided
  if (opts.token) {
    headers.set('Authorization', `Bearer ${opts.token}`)
  }

  // Set content type for JSON requests (do NOT set for FormData)
  const method = (init.method || 'GET').toUpperCase()
  const isFormData = typeof FormData !== 'undefined' && (init as any).body instanceof FormData
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

