// Direct SQL Server connection for WERCI mobile app
// This replaces the IndexedDB + API sync approach with direct database access

import { apiFetch } from './api'

/*
interface SQLServerConfig {
  server: string
  database: string
  username: string
  password: string
  port: number
  trustServerCertificate: boolean
}
*/

interface Inspection {
  id?: number
  vehicle_id?: number
  vehicle_equip_no?: string
  inspection_date: string
  inspector_name: string
  inspection_type: string
  status: string
  notes?: string
  odometer_reading?: number
  tire_condition: string
  brake_condition: string
  lights_working: boolean
  engine_condition: string
  body_condition: string
  interior_condition: string
  photos?: string
  star_rating: number
  gps_latitude?: number
  gps_longitude?: number
  created_by?: number
}

class SQLServerService {
  // private config: SQLServerConfig
  private isConnected = false

  constructor() {
    // Use same SQL Server as web app
    /*
    this.config = {
      server: '10.40.20.184', // Your SQL Server IP
      database: 'Safety', // Your database name
      username: 'Rahul', // Your username
      password: 'Radhaswami@4', // Your password
      port: 1434,
      trustServerCertificate: true
    }
    */
  }

  async connect(): Promise<boolean> {
    try {
      // Use centralized API service with endpoint failover
      const { apiFetch } = await import('./api')
      const response = await apiFetch('/api/mobile/health', { method: 'GET' })
      this.isConnected = response.ok
      return this.isConnected
    } catch (error) {
      console.error('Failed to connect to SQL Server:', error)
      this.isConnected = false
      return false
    }
  }

  async createInspection(inspection: Inspection): Promise<number | null> {
    try {
      if (!this.isConnected) {
        await this.connect()
      }

      // Import the centralized API service
      const { apiFetch } = await import('./api')
      const { AuthService } = await import('./auth')

      // Get authentication token
      const authService = AuthService.getInstance()
      const token = await authService.getToken()

      // Map mobile app fields to database fields with proper vehicle identification
      const inspectionData = {
        // Use actual vehicle_id if available, otherwise let server resolve from equip_no
        vehicle_id: inspection.vehicle_id || null,
        equip_no: inspection.vehicle_equip_no || 'MOBILE_SCAN',
        inspection_date: inspection.inspection_date,
        inspector_name: inspection.inspector_name,
        inspection_type: inspection.inspection_type || 'Mobile Inspection',
        status: this.mapStatusToDatabase(inspection.status),
        notes: inspection.notes || '',
        odometer_reading: inspection.odometer_reading || null,
        tire_condition: inspection.tire_condition,
        brake_condition: inspection.brake_condition,
        lights_working: inspection.lights_working,
        engine_condition: inspection.engine_condition,
        body_condition: inspection.body_condition, // Maps to body_condition in DB
        interior_condition: inspection.interior_condition, // Maps to interior_condition in DB
        star_rating: inspection.star_rating,
        gps_latitude: inspection.gps_latitude || null,
        gps_longitude: inspection.gps_longitude || null
      }

      // Use centralized API service with proper authentication
      let response = await apiFetch('/api/mobile/inspections', {
        method: 'POST',
        body: JSON.stringify(inspectionData)
      }, { token })

      // If unauthorized, refresh token once and retry
      if (response.status === 401) {
        console.warn('🔁 401 Unauthorized on create_inspection, refreshing token...')
        await authService.refreshToken()
        const newToken = await authService.getToken()
        response = await apiFetch('/api/mobile/inspections', {
          method: 'POST',
          body: JSON.stringify(inspectionData)
        }, { token: newToken })
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API error: ${response.status} - ${errorText}`)
      }

      const result = await response.json()

      if (result.success) {
        console.log('✅ Inspection saved via API:', result.data.inspection_id)
        return result.data.inspection_id
      } else {
        throw new Error(result.message || 'Failed to create inspection')
      }

    } catch (error) {
      console.error('❌ Failed to create inspection:', error)
      throw error
    }
  }

  async getVehicleByEquipNo(equipNo: string): Promise<any> {
    try {
      const { apiFetch } = await import('./api')
      const response = await apiFetch(`/api/mobile/vehicles/qr/${encodeURIComponent(equipNo)}`, { method: 'GET' })
      if (!response.ok) return null
      const result = await response.json()
      return result.success ? result.data : null
    } catch (error) {
      console.error('Failed to get vehicle:', error)
      return null
    }
  }

  async uploadPhoto(inspectionId: number, photoBlob: Blob, category: string): Promise<boolean> {
    try {
      const formData = new FormData()
      formData.append('photo', photoBlob, `inspection_${inspectionId}_${Date.now()}.jpg`)
      formData.append('inspection_id', inspectionId.toString())
      formData.append('category', category)

      const { apiFetch } = await import('./api')
      const { AuthService } = await import('./auth')
      const authService = AuthService.getInstance()
      let token = await authService.getToken()

      let response = await apiFetch('/api/mobile/photos', { method: 'POST', body: formData }, { token })

      if (response.status === 401) {
        console.warn('🔁 401 on photo upload, refreshing token...')
        await authService.refreshToken()
        token = await authService.getToken()
        response = await apiFetch('/api/mobile/photos', { method: 'POST', body: formData }, { token })
      }

      if (!response.ok) {
        console.error('Photo upload failed:', response.status, await response.text())
        return false
      }

      const result = await response.json()
      return !!result.success
    } catch (error) {
      console.error('Photo upload error:', error)
      return false
    }
  }

  private mapStatusToDatabase(status: string): string {
    // Map mobile app status to database status
    switch (status.toLowerCase()) {
      case 'failed':
        return 'failed'
      case 'moderate':
        return 'pending'
      case 'pass':
        return 'completed'
      default:
        return 'pending'
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await apiFetch('/api/mobile/health', { method: 'GET' })
      const result = await response.json()

      console.log('🔗 SQL Server connection test:', result.success ? '✅ Connected' : '❌ Failed')
      return result.success
    } catch (error) {
      console.error('❌ Connection test failed:', error)
      return false
    }
  }

  async getAllInspections(): Promise<Inspection[]> {
    try {
      // Use centralized API service (no authentication required)
      const response = await apiFetch('/api/mobile/inspections', { method: 'GET' })

      if (!response.ok) {
        return []
      }

      const result = await response.json()
      return result.success ? result.data : []
    } catch (error) {
      console.error('Failed to get inspections:', error)
      return []
    }
  }
}

// Export singleton instance
export const sqlServerService = new SQLServerService()
export type { Inspection }
