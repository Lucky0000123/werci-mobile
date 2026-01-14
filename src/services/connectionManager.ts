// Connection Manager with Network Mode Detection and Testing
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
      url: 'http://10.40.20.184:8082',
      type: 'local',
      priority: 2 // Local company network
    },
    {
      name: 'REMOTE SERVER',
      url: 'http://159.65.13.232:5000',
      type: 'cloud',
      priority: 1 // Cloud server (correct port)
    }
  ]

  private listeners: Array<(status: ConnectionStatus) => void> = []
  private checkInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startPeriodicCheck()
    this.setupNetworkListener()
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

  // Test individual endpoint connectivity
  private async testEndpoint(endpoint: NetworkEndpoint, timeoutMs = 5000): Promise<{ available: boolean, responseTime?: number, statusCode?: number, error?: string }> {
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
      const error = err as any
      const message = error?.message || String(error)
      console.warn(`Endpoint ${endpoint.name} test failed:`, message)

      // Fallback: try opaque fetch to detect basic reachability when CORS blocks the request
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
          available: true,
          responseTime,
          statusCode: 0,
          error: 'CORS blocked (opaque), but host reachable'
        }
      } catch (opaqueErr) {
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
  }

  // Start periodic connectivity checks
  private startPeriodicCheck() {
    // Initial check
    this.checkConnectivity()
    
    // Check every 30 seconds
    this.checkInterval = setInterval(() => {
      this.checkConnectivity()
    }, 30000)
  }

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
