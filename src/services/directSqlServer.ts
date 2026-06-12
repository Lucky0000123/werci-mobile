import { getStoredToken } from './api'

// All PRISM data endpoints now require auth; attach the persisted session token.
function authHeader(): Record<string, string> {
  const token = getStoredToken()
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

// Direct SQL Server connection for PRISM mobile app
// Connects directly to the backend API server that can reach SQL Server.

const DEV_BASE = import.meta.env.VITE_DEV_BASE || 'http://10.0.2.2:8082'
const LOCAL_BASE = import.meta.env.VITE_LOCAL_BASE || 'http://10.40.20.184:8082'

interface SQLServerConfig {
  server: string
  database: string
  username: string
  password: string
  port: number
  trustServerCertificate: boolean
}

interface VehicleData {
  id: number  // Added for QR code lookup by vehicle_id
  equip_no: string
  description?: string
  company?: string
  manufacturer?: string
  unit_model?: string
  commissioning_date?: string
  year?: number
  commissioning_status: string
  expired_date?: string
}

interface KimperData {
  id: number  // Added for QR code lookup by kimper_id
  name: string
  id_number?: string
  company?: string
  department?: string
  kimper_expired_date?: string
  status?: string
}

class DirectSQLServerService {
  private config: SQLServerConfig
  private isConnected = false
  private baseUrl: string | null = null

  private getCandidateBaseUrls(): string[] {
    return Array.from(new Set([
      LOCAL_BASE,
      DEV_BASE,
      'http://localhost:8082',
      `http://${this.config.server}:8082`
    ]))
  }

  private async probeBaseUrl(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs)
      })
      return response.ok
    } catch {
      return false
    }
  }

  constructor() {
    // NOTE: Credentials are NOT stored in the mobile app.
    // The mobile app communicates with the backend API server which handles DB connections.
    // This config is only used for server address resolution.
    this.config = {
      server: '10.40.20.184',
      database: 'Safety',
      username: '',  // Handled by backend API server
      password: '',  // Handled by backend API server
      port: 1434,
      trustServerCertificate: true
    }
  }

  // Get the correct base URL (localhost for development, company server for production)
  private async getBaseUrl(): Promise<string> {
    if (this.baseUrl) return this.baseUrl

    for (const candidate of this.getCandidateBaseUrls()) {
      if (await this.probeBaseUrl(candidate, 2000)) {
        this.baseUrl = candidate
        return this.baseUrl
      }
    }

    throw new Error('No available server connection')
  }

  // Check if we're on company network (can reach SQL Server directly)
  async isOnCompanyNetwork(): Promise<boolean> {
    try {
      for (const candidate of this.getCandidateBaseUrls()) {
        if (await this.probeBaseUrl(candidate, 2000)) {
          this.baseUrl = candidate
          console.log(`🏠 Using backend API server (${candidate})`)
          return true
        }
      }

      return false
    } catch {
      console.log('📡 Not on company network, SQL Server not directly accessible')
      return false
    }
  }

  // Get vehicles directly from SQL Server
  async getVehiclesEssential(): Promise<VehicleData[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network - cannot connect directly to SQL Server')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`🚛 Fetching vehicles from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/vehicles/essential`, {
        method: 'GET',
        headers: { ...authHeader(),
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Vehicle data fetch failed:', error)
      throw error
    }
  }

  // Get KIMPER data directly from SQL Server
  async getKimperEssential(): Promise<KimperData[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network - cannot connect directly to SQL Server')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`👥 Fetching KIMPER data from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/kimper/essential`, {
        method: 'GET',
        headers: { ...authHeader(),
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ KIMPER data fetch failed:', error)
      throw error
    }
  }

  // Get recent inspections directly from SQL Server
  async getInspectionsRecent(): Promise<any[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network - cannot connect directly to SQL Server')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`📋 Fetching inspections from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/inspections/recent`, {
        method: 'GET',
        headers: { ...authHeader(),
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Inspections data fetch failed:', error)
      throw error
    }
  }

  // ============================================
  // COMPLETE DATA FETCH METHODS (Version 1.1.0)
  // ============================================
  
  // Get COMPLETE vehicle data for offline storage
  async getVehiclesComplete(): Promise<any[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`🚛 Fetching COMPLETE vehicle data from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/vehicles/all`, {
        method: 'GET',
        headers: { ...authHeader(), 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' },
        signal: AbortSignal.timeout(300000) // 5 min — sync-grade timeout for growing datasets
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Complete vehicle data fetch failed:', error)
      throw error
    }
  }

  // Get COMPLETE KIMPER data for offline storage
  async getKimperComplete(): Promise<any[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`👷 Fetching COMPLETE KIMPER data from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/kimper/all`, {
        method: 'GET',
        headers: { ...authHeader(), 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' },
        signal: AbortSignal.timeout(300000) // 5 min — sync-grade timeout for growing datasets
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Complete KIMPER data fetch failed:', error)
      throw error
    }
  }

  // Get COMPLETE employee data for offline storage
  async getEmployeesComplete(): Promise<any[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`👤 Fetching COMPLETE employee data from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/employees/master/all`, {
        method: 'GET',
        headers: { ...authHeader(), 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' },
        signal: AbortSignal.timeout(300000) // 5 min — sync-grade timeout for growing datasets
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Complete employee data fetch failed:', error)
      throw error
    }
  }

  async getEmployeeCardsComplete(): Promise<any[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`🪪 Fetching COMPLETE employee card data from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/employees/cards/all`, {
        method: 'GET',
        headers: { ...authHeader(), 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' },
        signal: AbortSignal.timeout(300000) // 5 min — sync-grade timeout for growing datasets
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Complete employee card data fetch failed:', error)
      throw error
    }
  }

  // Unified deduplicated people dataset (replaces employees+kimper+cards).
  // Thumbnailed photos and gzip compression make this endpoint several orders
  // of magnitude lighter than the three legacy endpoints combined.
  async getPeopleComplete(): Promise<any[]> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`👥 Fetching UNIFIED people data from: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/people/all?photo_size=200`, {
        method: 'GET',
        headers: { ...authHeader(), 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' },
        signal: AbortSignal.timeout(300000)
      })

      if (!response.ok) {
        throw new Error(`Server API error: ${response.status}`)
      }

      const result = await response.json()
      return result.data || []
    } catch (error) {
      console.error('❌ Complete people data fetch failed:', error)
      throw error
    }
  }

  // Submit inspection directly to SQL Server
  async submitInspection(inspectionData: any): Promise<boolean> {
    if (!(await this.isOnCompanyNetwork())) {
      throw new Error('Not on company network - cannot submit directly to SQL Server')
    }

    try {
      const baseUrl = await this.getBaseUrl()
      console.log(`📤 Submitting inspection to: ${baseUrl}`)

      const response = await fetch(`${baseUrl}/api/mobile/inspections`, {
        method: 'POST',
        headers: { ...authHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(inspectionData),
        signal: AbortSignal.timeout(15000)
      })

      if (!response.ok) {
        throw new Error(`Server submission error: ${response.status}`)
      }

      const result = await response.json()
      return result.success || false
    } catch (error) {
      console.error('❌ Inspection submission failed:', error)
      throw error
    }
  }

  // Get connection status
  getConnectionInfo() {
    return {
      server: this.config.server,
      database: this.config.database,
      port: this.config.port,
      isConnected: this.isConnected,
      connectionType: 'Direct SQL Server'
    }
  }
}

// Export singleton instance
export const directSQLServerService = new DirectSQLServerService()
export default directSQLServerService
