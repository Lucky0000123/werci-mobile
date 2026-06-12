// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredUserSession } from '../services/db'

const apiFetchMock = vi.fn()
const setCachedTokenMock = vi.fn()

vi.mock('../services/api', () => ({
  apiFetch: apiFetchMock,
  setCachedToken: setCachedTokenMock,
  getStoredToken: vi.fn(() => null)
}))

// Session storage now lives in Capacitor Preferences (mocked in-memory by
// tests/setup.ts) with a localStorage migration fallback for old installs.
describe('AuthService session handling', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.clear()
  })

  it('restores a previously authenticated session from localStorage', async () => {
    const session: StoredUserSession = {
      deviceId: 'device-stored',
      token: 'jwt-token',
      userId: 44,
      username: 'qa.user',
      role: 'inspector'
    }
    localStorage.setItem('prism_device_id', 'device-stored')
    localStorage.setItem('prism_session_v1', JSON.stringify(session))

    const { authService } = await import('../services/auth')

    expect(await authService.isAuthenticated()).toBe(true)
    expect(await authService.getToken()).toBe('jwt-token')
    expect(await authService.getCurrentUser()).toEqual({ id: 44, username: 'qa.user', role: 'inspector', fullName: undefined })
  })

  it('ignores legacy temporary tokens for login-first access control', async () => {
    const session: StoredUserSession = {
      deviceId: 'device-temp',
      token: 'device_token_123',
      isTemporary: true,
      userId: 0,
      username: ''
    }
    localStorage.setItem('prism_device_id', 'device-temp')
    localStorage.setItem('prism_session_v1', JSON.stringify(session))

    const { authService } = await import('../services/auth')

    expect(await authService.isAuthenticated()).toBe(false)
    expect(await authService.getToken()).toBeNull()
    expect(await authService.getCurrentUser()).toBeNull()
  })

  it('logs in with the backend mobile auth endpoint and persists the user session', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('device-login')
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          success: true,
          token: 'jwt-login-token',
          expires_in: 86400,
          user: { id: 12, username: 'mobile.user', role: 'inspector' }
        }
      })
    })

    const { authService } = await import('../services/auth')
    const user = await authService.login('mobile.user', 'secret')

    expect(user).toEqual({ id: 12, username: 'mobile.user', role: 'inspector', fullName: undefined })
    expect(localStorage.getItem('prism_device_id')).toBe('device-login')
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: 'prism_session_v1' })
    const storedSession = JSON.parse(value!)
    expect(storedSession).toMatchObject({
      deviceId: 'device-login',
      token: 'jwt-login-token',
      userId: 12,
      username: 'mobile.user',
      role: 'inspector'
    })
  })

  it('clears the authenticated session without discarding the device identity', async () => {
    const session: StoredUserSession = {
      deviceId: 'device-stable',
      token: 'jwt-token',
      userId: 22,
      username: 'field.user',
      role: 'inspector'
    }
    localStorage.setItem('prism_device_id', 'device-stable')
    localStorage.setItem('prism_session_v1', JSON.stringify(session))

    const { authService } = await import('../services/auth')

    expect(await authService.isAuthenticated()).toBe(true)
    await authService.clearAuth()

    expect(localStorage.getItem('prism_device_id')).toBe('device-stable')
    expect(localStorage.getItem('prism_session_v1')).toBeNull()
    expect(await authService.isAuthenticated()).toBe(false)
  })

  it('validateToken returns true on network errors so offline users stay logged in', async () => {
    const session: StoredUserSession = {
      deviceId: 'device-net',
      token: 'jwt-token',
      userId: 1,
      username: 'net.user',
      role: 'inspector'
    }
    localStorage.setItem('prism_device_id', 'device-net')
    localStorage.setItem('prism_session_v1', JSON.stringify(session))

    apiFetchMock.mockRejectedValue(new Error('Network failure'))

    const { authService } = await import('../services/auth')
    const isValid = await authService.validateToken()

    expect(isValid).toBe(true)
    expect(await authService.isAuthenticated()).toBe(true)
  })

  it('validateToken clears session and returns false on 401', async () => {
    const session: StoredUserSession = {
      deviceId: 'device-401',
      token: 'jwt-token',
      userId: 2,
      username: 'bad.user',
      role: 'inspector'
    }
    localStorage.setItem('prism_device_id', 'device-401')
    localStorage.setItem('prism_session_v1', JSON.stringify(session))

    apiFetchMock.mockResolvedValue({ ok: false, status: 401 })

    const { authService } = await import('../services/auth')
    const isValid = await authService.validateToken()

    expect(isValid).toBe(false)
    expect(await authService.isAuthenticated()).toBe(false)
  })
})
