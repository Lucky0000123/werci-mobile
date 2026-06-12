import { Preferences } from '@capacitor/preferences'
import { setCachedToken } from './api'
import type { StoredUserSession } from './db'

export interface AuthenticatedUser {
  id: number
  username: string
  role: string
  fullName?: string
}

interface MobileLoginPayload {
  success?: boolean
  token?: string
  expires_in?: number
  user?: {
    id?: number
    username?: string
    role?: string
    full_name?: string
    fullName?: string
  }
  message?: string
}

// ============================================================
// AUTH STORAGE — Capacitor Preferences (native), localStorage migration
// ============================================================
// The session (incl. the JWT) now lives in Capacitor Preferences, which maps
// to Android SharedPreferences — native storage outside the WebView, not
// readable through WebView inspection of localStorage. Existing installs
// that still have a localStorage session are migrated on first read, then
// the localStorage copy is removed.
const SESSION_KEY = 'prism_session_v1'
const DEVICE_ID_KEY = 'prism_device_id'

async function readPersistedSession(): Promise<StoredUserSession | null> {
  try {
    const { value } = await Preferences.get({ key: SESSION_KEY })
    if (value) {
      const parsed = JSON.parse(value) as StoredUserSession
      return parsed && typeof parsed === 'object' ? parsed : null
    }
  } catch (err) {
    console.warn('[auth] Failed to read session from Preferences', err)
  }

  // Migration path: session written by an older app version into localStorage.
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredUserSession
    if (parsed && typeof parsed === 'object') {
      await writePersistedSession(parsed)
      try { localStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
      console.log('[auth] Migrated session from localStorage to Preferences')
      return parsed
    }
    return null
  } catch (err) {
    console.warn('[auth] Failed to parse persisted session; clearing', err)
    try { localStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
    return null
  }
}

async function writePersistedSession(session: StoredUserSession): Promise<void> {
  try {
    await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) })
  } catch (err) {
    // Preferences is UNIMPLEMENTED in some environments (e.g. unit tests);
    // fall back to localStorage so auth still works there.
    console.warn('[auth] Preferences unavailable, falling back to localStorage', err)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }
  setCachedToken(session.token || null)
}

async function clearPersistedSession(): Promise<void> {
  try { await Preferences.remove({ key: SESSION_KEY }) } catch { /* noop */ }
  try { localStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
  setCachedToken(null)
}

export class AuthService {
  private deviceId: string | null = null
  private token: string | null = null
  private currentUser: AuthenticatedUser | null = null
  private bootstrapPromise: Promise<void> | null = null

  static getInstance(): AuthService {
    return authService
  }

  private async ensureDeviceIdentity(): Promise<void> {
    if (this.deviceId) return

    const storedDeviceId = localStorage.getItem(DEVICE_ID_KEY)
    if (storedDeviceId) {
      this.deviceId = storedDeviceId
      return
    }

    this.deviceId = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, this.deviceId)
  }

  private isAuthenticatedSession(session: StoredUserSession | undefined | null): session is StoredUserSession {
    return !!session?.token && !session.isTemporary && typeof session.userId === 'number' && !!session.username
  }

  private toAuthenticatedUser(session: StoredUserSession): AuthenticatedUser {
    return {
      id: session.userId!,
      username: session.username!,
      role: session.role || 'user',
      fullName: session.fullName
    }
  }

  private async restorePersistedSession(): Promise<void> {
    await this.ensureDeviceIdentity()

    const storedSession = await readPersistedSession()

    if (!storedSession || !this.isAuthenticatedSession(storedSession)) {
      this.token = null
      this.currentUser = null
      setCachedToken(null)
      return
    }

    this.token = storedSession.token!
    setCachedToken(this.token)
    this.currentUser = this.toAuthenticatedUser(storedSession)

    if (storedSession.deviceId && storedSession.deviceId !== this.deviceId) {
      this.deviceId = storedSession.deviceId
      localStorage.setItem(DEVICE_ID_KEY, storedSession.deviceId)
    }
  }

  async bootstrap(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.restorePersistedSession().catch((error) => {
        this.token = null
        this.currentUser = null
        throw error
      })
    }

    await this.bootstrapPromise
  }

  async getDeviceId(): Promise<string> {
    await this.ensureDeviceIdentity()
    return this.deviceId!
  }

  async getToken(): Promise<string | null> {
    if (!this.token) {
      await this.bootstrap()
    }

    return this.token
  }

  async getCurrentUser(): Promise<AuthenticatedUser | null> {
    if (!this.currentUser) {
      await this.bootstrap()
    }

    return this.currentUser ? { ...this.currentUser } : null
  }

  async isAuthenticated(): Promise<boolean> {
    const [token, user] = await Promise.all([this.getToken(), this.getCurrentUser()])
    return !!token && !!user
  }

  private async persistAuthenticatedSession(session: StoredUserSession): Promise<void> {
    await writePersistedSession(session)
    this.token = session.token!
    this.currentUser = this.toAuthenticatedUser(session)
    this.bootstrapPromise = Promise.resolve()
  }

  // Persist a renewed token from /auth/verify (sliding session renewal).
  private async adoptRenewedToken(renewedToken: string | undefined | null): Promise<void> {
    if (!renewedToken || renewedToken === this.token) return
    const session = await readPersistedSession()
    if (!session) return
    session.token = renewedToken
    await writePersistedSession(session)
    this.token = renewedToken
  }

  async login(username: string, password: string): Promise<AuthenticatedUser> {
    await this.ensureDeviceIdentity()

    const existingSession = await readPersistedSession()

    const { apiFetch } = await import('./api')
    const response = await apiFetch('/api/mobile/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    })

    const result = await response.json().catch(() => null) as { success?: boolean; message?: string; data?: MobileLoginPayload } | null
    const payload = result?.data
    const fullName = payload?.user?.full_name ?? payload?.user?.fullName

    if (!response.ok || !result?.success || !payload?.success || !payload.token || typeof payload.user?.id !== 'number' || !payload.user.username) {
      throw new Error(payload?.message || result?.message || 'Unable to sign in right now.')
    }

    const session: StoredUserSession = {
      deviceId: this.deviceId!,
      token: payload.token,
      lastSync: existingSession?.lastSync,
      // Tokens are now long-lived (10 years) on the backend.
      // We still record validUntil for diagnostics but never enforce it client-side.
      validUntil: payload.expires_in ? Date.now() + (payload.expires_in * 1000) : undefined,
      isTemporary: false,
      userId: payload.user.id,
      username: payload.user.username,
      role: payload.user.role || 'user',
      fullName,
      authenticatedAt: Date.now()
    }

    await this.persistAuthenticatedSession(session)
    return { ...this.currentUser! }
  }

  /**
   * Validate the current token with the backend.
   *
   * Returns `true` if the token is valid.
   * Returns `false` if the backend rejected it (401) — auth is cleared.
   * Returns `true` on network errors so offline users stay logged in.
   */
  async validateToken(): Promise<boolean> {
    const token = await this.getToken()
    if (!token) return false

    try {
      const { apiFetch } = await import('./api')
      const response = await apiFetch('/api/mobile/auth/verify', { method: 'GET' }, { token })

      if (response.ok) {
        try {
          const body = await response.json() as { data?: { renewed_token?: string } }
          await this.adoptRenewedToken(body?.data?.renewed_token)
        } catch { /* renewal is best-effort */ }
        return true
      }
      if (response.status === 401) {
        await this.clearAuth()
        return false
      }

      // Other HTTP errors (5xx, etc.) — treat as transient, keep session
      return true
    } catch {
      // Network/offline — keep session so the user stays logged in
      return true
    }
  }

  /**
   * Ensure the current session is still valid.
   *
   * On 401 the session is cleared and `LOGIN_REQUIRED` is thrown.
   * On network errors the session is kept alive (offline-friendly).
   */
  async refreshToken(): Promise<void> {
    const token = await this.getToken()

    if (!token) {
      await this.bootstrap()
      if (!this.token) {
        throw new Error('LOGIN_REQUIRED')
      }
      return
    }

    try {
      const { apiFetch } = await import('./api')
      const response = await apiFetch('/api/mobile/auth/verify', { method: 'GET' }, { token })

      if (response.ok) {
        try {
          const body = await response.json() as { data?: { renewed_token?: string } }
          await this.adoptRenewedToken(body?.data?.renewed_token)
        } catch { /* renewal is best-effort */ }
        return
      }

      if (response.status === 401) {
        await this.clearAuth()
        throw new Error('LOGIN_REQUIRED')
      }

      // Other errors (5xx) — treat as transient, keep session
    } catch (error) {
      if (error instanceof Error && error.message === 'LOGIN_REQUIRED') {
        throw error
      }
      // Keep cached session during transient network failures so offline flows stay usable.
    }
  }

  async clearAuth(): Promise<void> {
    await this.ensureDeviceIdentity()
    this.bootstrapPromise = null
    this.token = null
    this.currentUser = null

    await clearPersistedSession()
    // Clear dashboard KPI cache so the next user doesn't see stale data
    try { localStorage.removeItem('prism_dashboard_kpi_v1') } catch { /* noop */ }
  }
}

export const authService = new AuthService()
