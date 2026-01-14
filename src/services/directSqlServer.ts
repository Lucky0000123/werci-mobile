// Direct SQL Server connection for WERCI mobile app
// Connects directly to SQL Server when on company network (10.40.20.184)

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

  constructor() {
    this.config = {
      server: '10.40.20.184',
      database: 'Safety',
      username: 'Rahul',
      password: 'Radhaswami@4',
      port: 1434,
      trustServerCertificate: true
    }
  }

  // Get the correct base URL (localhost for development, company server for production)
  private async getBaseUrl(): Promise<string> {
    if (this.baseUrl) return this.baseUrl

    try {
      // Try localhost first (development)
      const localResponse = await fetch('http://localhost:8082/health', {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      })
      if (localResponse.ok) {
        this.baseUrl = 'http://localhost:8082'
        return this.baseUrl
      }
    } catch (error) {
      // Localhost not available, try company server
    }

    // Try company server
    try {
      const companyResponse = await fetch(`http://${this.config.server}:8082/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      })
      if (companyResponse.ok) {
        this.baseUrl = `http://${this.config.server}:8082`
        return this.baseUrl
      }
    } catch (error) {
      // Company server not available
    }

    throw new Error('No available server connection')
  }

  // Check if we're on company network (can reach SQL Server directly)
  async isOnCompanyNetwork(): Promise<boolean> {
    try {
      // First try localhost (for development)
      try {
        const localResponse = await fetch('http://localhost:8082/health', {
          method: 'GET',
          signal: AbortSignal.timeout(2000)
        })
        if (localResponse.ok) {
          console.log('🏠 Using local development server (localhost:8082)')
          return true
        }
      } catch (localError) {
        console.log('🏠 Local server not available, trying company network...')
      }

      // Then try company network SQL Server
      const response = await fetch(`http://${this.config.server}:8082/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      })
      if (response.ok) {
        console.log('🏢 Using company network SQL Server')
        return true
      }
      return false
    } catch (error) {
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
        headers: {
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
        headers: {
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
        headers: {
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
        headers: {
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
