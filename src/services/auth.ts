// Simple device-based authentication for WERCI mobile app
import { getDB } from './db'

export interface DeviceAuth {
  deviceId: string
  token: string
  lastSync?: number
}

export class AuthService {
  private deviceId: string | null = null
  private token: string | null = null

  constructor() {
    this.initializeAuth()
  }

  static getInstance(): AuthService {
    return authService
  }

  private async initializeAuth() {
    // Generate or retrieve device ID
    this.deviceId = localStorage.getItem('werci_device_id')
    if (!this.deviceId) {
      this.deviceId = crypto.randomUUID()
      localStorage.setItem('werci_device_id', this.deviceId)
    }

    // Check if we have a stored token
    const db = await getDB()
    const users = await db.getAll('users')

    if (users.length > 0) {
      const user = users[0]
      this.token = user.token

      // Validate token with server if it exists
      const isValid = await this.validateTokenWithServer(this.token)
      if (!isValid) {
        console.log('🔄 Stored token invalid, requesting new token from server')
        await this.requestNewTokenFromServer()
      }
    } else {
      // Request a new token from server
      await this.requestNewTokenFromServer()
    }
  }

  private async requestNewTokenFromServer(): Promise<void> {
    try {
      // Import API service dynamically to avoid circular dependency
      const { apiFetch } = await import('./api')

      // Request device token from server
      const response = await apiFetch('/api/mobile/auth/device', {
        method: 'POST',
        body: JSON.stringify({
          device_id: this.deviceId,
          device_info: {
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            timestamp: Date.now()
          }
        })
      })

      if (!response.ok) {
        throw new Error(`Auth server error: ${response.status}`)
      }

      const result = await response.json()

      if (result.success && result.token) {
        this.token = result.token

        // Store in IndexedDB
        const db = await getDB()
        await db.clear('users') // Clear old users
        await db.add('users', {
          deviceId: this.deviceId!,
          token: this.token!,
          lastSync: Date.now(),
          validUntil: result.expires_at || (Date.now() + 24 * 60 * 60 * 1000) // 24 hours default
        })

        console.log('✅ New device token obtained from server')
      } else {
        throw new Error(result.message || 'Failed to obtain device token')
      }
    } catch (error) {
      console.error('❌ Failed to get device token from server:', error)

      // Fallback: Generate temporary token for offline operation
      this.token = `device_token_${this.deviceId}_${Date.now()}`

      const db = await getDB()
      await db.add('users', {
        deviceId: this.deviceId!,
        token: this.token!,
        lastSync: undefined,
        isTemporary: true
      })

      console.warn('⚠️ Using temporary token - sync may fail until server connection is restored')
    }
  }

  private async validateTokenWithServer(token: string): Promise<boolean> {
    try {
      const { apiFetch } = await import('./api')

      const response = await apiFetch('/api/mobile/auth/validate', {
        method: 'POST',
        body: JSON.stringify({ token })
      })

      if (response.ok) {
        const result = await response.json()
        return result.valid === true
      }

      return false
    } catch (error) {
      console.warn('⚠️ Could not validate token with server:', error)
      // If we can't reach the server, assume token is valid for offline operation
      return true
    }
  }

  async getDeviceId(): Promise<string> {
    if (!this.deviceId) {
      await this.initializeAuth()
    }
    return this.deviceId!
  }

  async getToken(): Promise<string> {
    if (!this.token) {
      await this.initializeAuth()
    }
    return this.token!
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken()
    return !!token
  }

  // Validate token with server
  async validateToken(): Promise<boolean> {
    const token = await this.getToken()
    if (!token) return false

    return await this.validateTokenWithServer(token)
  }

  // Refresh token if needed
  async refreshToken(): Promise<void> {
    console.log('🔄 Refreshing authentication token')
    await this.requestNewTokenFromServer()
  }

  async clearAuth(): Promise<void> {
    this.deviceId = null
    this.token = null
    localStorage.removeItem('werci_device_id')
    
    const db = await getDB()
    const users = await db.getAll('users')
    for (const user of users) {
      await db.delete('users', user.deviceId)
    }
  }
}

// Export singleton instance
export const authService = new AuthService()
