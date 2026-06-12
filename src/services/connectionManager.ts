// Connection Manager with Network Mode Detection and Testing
import { App as CapacitorApp } from '@capacitor/app'

// Read endpoints from environment variables (set in .env / .env.production)
const _LOCAL_URL = import.meta.env.VITE_LOCAL_BASE || 'http://10.40.20.184:8082'
const _CLOUD_URL = import.meta.env.VITE_CLOUD_BASE || 'https://api.werci.my.id'
export interface ConnectionStatus {
  isOnline: boolean
  currentMode: 'cloud' | 'local' | 'offline'
  cloudAvailable: boolean
  localAvailable: boolean
  lastChecked: number
  responseTime?: number
}

export interface NetworkEndpoint {
  name: string
  url: string
  type: 'cloud' | 'local'
  priority: number
}

class ConnectionManager {
  private status: ConnectionStatus = {
    isOnline: false,
    currentMode: 'offline',
    cloudAvailable: false,
    localAvailable: false,
    lastChecked: 0
  }

  // Track which exact endpoint is currently active (not just the type)
  private activeEndpoint: NetworkEndpoint | null = null

  private endpoints: NetworkEndpoint[] = [
    {
      name: 'IWIP NETWORK',
      url: _LOCAL_URL,
      type: 'local',
      priority: 2 // Local company network
    },
    {
      name: 'REMOTE SERVER',
      url: _CLOUD_URL,
      type: 'cloud',
      priority: 1 // Cloud server (correct port)
    }
  ]

  private listeners: Array<(status: ConnectionStatus) => void> = []
  private checkInterval: NodeJS.Timeout | null = null

  constructor() {
    // Do NOT auto-start network checks in constructor.
    // This runs at module import time and blocks the app startup
    // if endpoints are unreachable (5s timeout × 2 endpoints).
    // Call init() explicitly after the UI has rendered.
  }

  /** Call once after UI is visible to start connectivity monitoring */
  init() {
    this.setupNetworkListener()
    // Run first check quickly (500ms) so API calls don't fail due to null endpoint
    setTimeout(() => this.checkConnectivity(), 500)
    // Periodic checks every 30s after that
    this.checkInterval = setInterval(() => {
      this.checkConnectivity()
    }, 30000)
  }

  // Add status change listener
  addStatusListener(callback: (status: ConnectionStatus) => void) {
    this.listeners.push(callback)
  }

  // Remove status change listener
  removeStatusListener(callback: (status: ConnectionStatus) => void) {
    this.listeners = this.listeners.filter(cb => cb !== callback)
  }

  // Notify all listeners of status change
  private notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.status)
      } catch (error) {
        console.error('Connection status listener error:', error)
      }
    })
  }

  // Test individual endpoint connectivity.
  // 4s timeout: a /health endpoint that can't answer in 4s is effectively down
  // for a mobile user, and a shorter timeout keeps startup/failover snappy
  // (the old 8s made the app feel frozen for up to 8s when off-LAN).
  private async testEndpoint(endpoint: NetworkEndpoint, timeoutMs = 4000): Promise<{ available: boolean, responseTime?: number, statusCode?: number, error?: string }> {
    const startTime = Date.now()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetch(`${endpoint.url}/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store'
      })

      clearTimeout(timeoutId)
      const responseTime = Date.now() - startTime

      return {
        available: response.ok,
        responseTime,
        statusCode: response.status
      }
    } catch (err) {
      let responseTime = Date.now() - startTime
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`Endpoint ${endpoint.name} test failed:`, message)

      // Fallback: try opaque fetch to detect basic reachability when CORS blocks the request.
      // NOTE: an opaque response gives us *zero* information about HTTP status,
      // so we must NOT mark the endpoint as available — doing so causes false
      // positives where the app thinks it's online but every API call fails.
      try {
        const controller2 = new AbortController()
        const timeoutId2 = setTimeout(() => controller2.abort(), Math.max(1000, Math.floor(timeoutMs / 2)))
        await fetch(`${endpoint.url}/health`, {
          method: 'GET',
          signal: controller2.signal,
          cache: 'no-store',
          mode: 'no-cors'
        })
        clearTimeout(timeoutId2)
        responseTime = Date.now() - startTime
        return {
          available: false,
          responseTime,
          statusCode: 0,
          error: 'CORS blocked — host may be reachable but API is unavailable'
        }
      } catch {
        responseTime = Date.now() - startTime
        return {
          available: false,
          responseTime,
          error: message
        }
      }
    }
  }

  // Public diagnostics method to probe all endpoints and return detailed results
  async diagnoseAllEndpoints(timeoutMs = 7000): Promise<Array<{ endpoint: NetworkEndpoint; available: boolean; responseTime?: number; statusCode?: number; error?: string }>> {
    const results = await Promise.all(
      this.endpoints.map(async (endpoint) => {
        const result = await this.testEndpoint(endpoint, timeoutMs)
        return { endpoint, ...result }
      })
    )
    return results
  }

  // Expose list of candidate endpoints (read-only copy)
  getCandidateEndpoints(): NetworkEndpoint[] {
    return this.endpoints.map(e => ({ ...e }))
  }

  // Test all endpoints and update status
  async checkConnectivity(): Promise<ConnectionStatus> {
    console.log('🔍 Testing network connectivity...')
    
    const results = await Promise.all(
      this.endpoints.map(endpoint => 
        this.testEndpoint(endpoint).then(result => ({
          endpoint,
          ...result
        }))
      )
    )

    // Update availability status
    const cloudResult = results.find(r => r.endpoint.type === 'cloud')
    const localResults = results.filter(r => r.endpoint.type === 'local')

    this.status.cloudAvailable = cloudResult?.available || false
    this.status.localAvailable = localResults.some(r => r.available)
    this.status.lastChecked = Date.now()

    // Find the highest priority available endpoint
    const availableResults = results.filter(r => r.available)
    const bestEndpoint = availableResults.sort((a, b) => b.endpoint.priority - a.endpoint.priority)[0]

    if (bestEndpoint) {
      // Use the highest priority available endpoint
      this.activeEndpoint = bestEndpoint.endpoint
      this.status.currentMode = bestEndpoint.endpoint.type
      this.status.responseTime = bestEndpoint.responseTime
      this.status.isOnline = true

      if (bestEndpoint.endpoint.name === 'Local Development') {
        console.log(`🏠 Using localhost (${bestEndpoint.responseTime}ms) - highest priority`)
      } else if (bestEndpoint.endpoint.type === 'local') {
        console.log(`🏢 Using local endpoint "${bestEndpoint.endpoint.name}" (${bestEndpoint.responseTime}ms)`)
      } else {
        console.log(`📡 Using cloud endpoint "${bestEndpoint.endpoint.name}" (${bestEndpoint.responseTime}ms)`)
      }
    } else {
      this.status.currentMode = 'offline'
      this.status.isOnline = false
      this.status.responseTime = undefined
      console.warn('⚠️ No endpoints available - operating offline')
    }

    console.log('📊 Connection Status:', {
      mode: this.status.currentMode,
      local: this.status.localAvailable,
      cloud: this.status.cloudAvailable,
      responseTime: this.status.responseTime
    })

    this.notifyListeners()
    return this.status
  }

  // Get current connection status
  getStatus(): ConnectionStatus {
    return { ...this.status }
  }

  // Get active endpoint URL (exact endpoint chosen during last check)
  getActiveEndpoint(): string | null {
    return this.activeEndpoint?.url || null
  }

  // Make API request with automatic endpoint selection
  async makeRequest(path: string, options: RequestInit = {}): Promise<Response> {
    const activeEndpoint = this.getActiveEndpoint()
    
    if (!activeEndpoint) {
      throw new Error('No network connection available')
    }

    const url = `${activeEndpoint}${path}`
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      })

      return response
    } catch (error) {
      console.error(`Request failed to ${this.status.currentMode} endpoint:`, error)
      
      // Try to switch to backup endpoint if primary fails
      await this.checkConnectivity()
      
      const newEndpoint = this.getActiveEndpoint()
      if (newEndpoint && newEndpoint !== activeEndpoint) {
        console.log(`🔄 Switching to ${this.status.currentMode} endpoint`)
        const retryUrl = `${newEndpoint}${path}`
        return fetch(retryUrl, options)
      }
      
      throw error
    }
  }

  // Setup network change listener
  private setupNetworkListener() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('📶 Network came online')
        this.checkConnectivity()
      })

      window.addEventListener('offline', () => {
        console.log('📵 Network went offline')
        this.status.isOnline = false
        this.status.currentMode = 'offline'
        this.notifyListeners()
      })
    }

    // Re-probe connectivity when app returns to foreground
    try {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          console.log('📱 App returned to foreground — rechecking connectivity')
          this.checkConnectivity()
        }
      })
    } catch (e) {
      console.warn('Could not add appStateChange listener:', e)
    }
  }

  // startPeriodicCheck is now handled by init() — called after UI renders

  // Stop periodic checks
  stopPeriodicCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  // Force immediate connectivity check
  async forceCheck(): Promise<ConnectionStatus> {
    return await this.checkConnectivity()
  }

  // Simulate offline mode for testing
  simulateOffline() {
    console.log('🧪 Simulating offline mode')
    this.status.isOnline = false
    this.status.currentMode = 'offline'
    this.status.cloudAvailable = false
    this.status.localAvailable = false
    this.notifyListeners()
  }

  // Restore normal connectivity checking
  restoreConnectivity() {
    console.log('🔄 Restoring normal connectivity')
    this.checkConnectivity()
  }
}

// Export singleton instance
export const connectionManager = new ConnectionManager()
export default connectionManager
