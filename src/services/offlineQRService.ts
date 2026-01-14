// Offline QR Code Service with Complete Vehicle Data Access
import offlineStorage, { type VehicleData } from './offlineStorage'
import connectionManager from './connectionManager'

export interface QRScanResult {
  success: boolean
  equipmentNumber: string
  vehicleData: VehicleData | null
  source: 'offline' | 'online' | 'cache'
  error?: string
}

export interface QRCodeFormats {
  EQUIP_PREFIX: string
  URL_PATTERN: RegExp
  DIRECT_NUMBER: RegExp
}

class OfflineQRService {
  private qrFormats: QRCodeFormats = {
    EQUIP_PREFIX: 'EQUIP:',
    URL_PATTERN: /\/vehicles\/(\w+)/i,
    DIRECT_NUMBER: /^[A-Z0-9_-]+$/i
  }

  // Parse QR code content to extract equipment number
  parseQRCode(qrContent: string): string | null {
    if (!qrContent) return null

    // Remove whitespace
    const cleaned = qrContent.trim()

    // Format 1: EQUIP:EQUIPMENT_NUMBER
    if (cleaned.startsWith(this.qrFormats.EQUIP_PREFIX)) {
      return cleaned.substring(this.qrFormats.EQUIP_PREFIX.length)
    }

    // Format 2: URL with equipment number
    const urlMatch = cleaned.match(this.qrFormats.URL_PATTERN)
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1]
    }

    // Format 3: Direct equipment number
    if (this.qrFormats.DIRECT_NUMBER.test(cleaned)) {
      return cleaned
    }

    return null
  }

  // Scan QR code and retrieve complete vehicle data
  async scanQRCode(qrContent: string): Promise<QRScanResult> {
    try {
      // Parse equipment number from QR code
      const equipmentNumber = this.parseQRCode(qrContent)
      
      if (!equipmentNumber) {
        return {
          success: false,
          equipmentNumber: '',
          vehicleData: null,
          source: 'offline',
          error: 'Invalid QR code format'
        }
      }

      // Cache the QR lookup for future offline use
      await offlineStorage.cacheQRLookup(qrContent, equipmentNumber)

      // Try to get vehicle data from offline storage first
      let vehicleData = await offlineStorage.getVehicleByEquipNo(equipmentNumber)
      let source: 'offline' | 'online' | 'cache' = 'offline'

      // If not found offline and we're online, try to fetch from server
      if (!vehicleData && connectionManager.getStatus().isOnline) {
        try {
          const response = await connectionManager.makeRequest(
            `/api/mobile/vehicles/qr/${encodeURIComponent(equipmentNumber)}`
          )

          if (response.ok) {
            const serverData = await response.json()
            
            if (serverData.success && serverData.vehicle) {
              vehicleData = serverData.vehicle
              source = 'online'

              // Cache the fetched data for offline use
              if (vehicleData) {
                await offlineStorage.storeVehicleData([vehicleData])
              }
            }
          }
        } catch (error) {
          console.warn('Online vehicle lookup failed:', error)
        }
      }

      // If still not found, check QR cache for equipment number
      if (!vehicleData) {
        const cachedEquipNo = await offlineStorage.getEquipNoFromQR(qrContent)
        if (cachedEquipNo) {
          vehicleData = await offlineStorage.getVehicleByEquipNo(cachedEquipNo)
          source = 'cache'
        }
      }

      if (vehicleData) {
        return {
          success: true,
          equipmentNumber,
          vehicleData,
          source,
        }
      } else {
        return {
          success: false,
          equipmentNumber,
          vehicleData: null,
          source: 'offline',
          error: 'Vehicle not found in offline storage. Please sync data when online.'
        }
      }

    } catch (error) {
      console.error('QR scan error:', error)
      return {
        success: false,
        equipmentNumber: '',
        vehicleData: null,
        source: 'offline',
        error: `QR scan failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  // Get comprehensive vehicle information for display
  getVehicleDisplayData(vehicleData: VehicleData): {
    basicInfo: Record<string, any>
    specifications: Record<string, any>
    kimperData: Record<string, any>
    maintenanceHistory: any[]
    inspectionHistory: any[]
  } {
    return {
      basicInfo: {
        'Equipment Number': vehicleData.equip_no,
        'Description': vehicleData.description,
        'Company': vehicleData.company,
        'Status': vehicleData.status,
        'Vehicle Type': vehicleData.vehicle_type,
        'Model': vehicleData.model,
        'Year': vehicleData.year,
        'License Plate': vehicleData.license_plate,
        'Department': vehicleData.department,
        'Location': vehicleData.location,
        'Fuel Type': vehicleData.fuel_type,
        'Current Mileage': vehicleData.mileage
      },
      specifications: vehicleData.specifications || {},
      kimperData: {
        'Commissioning Status': vehicleData.kimper_data?.commissioning_status,
        'Commissioning Date': vehicleData.kimper_data?.commissioning_date,
        'Last Check': vehicleData.kimper_data?.last_commissioning_check,
        'Next Due': vehicleData.kimper_data?.next_commissioning_due,
        'Certification Status': vehicleData.kimper_data?.certification_status,
        'Compliance Notes': vehicleData.kimper_data?.compliance_notes,
        'Technical Specs': vehicleData.kimper_data?.technical_specifications
      },
      maintenanceHistory: vehicleData.maintenance_history || [],
      inspectionHistory: vehicleData.inspection_history || []
    }
  }

  // Format data for mobile display
  formatForMobileDisplay(vehicleData: VehicleData): {
    title: string
    subtitle: string
    status: string
    statusColor: string
    sections: Array<{
      title: string
      items: Array<{ label: string, value: string }>
    }>
  } {
    const displayData = this.getVehicleDisplayData(vehicleData)
    
    // Determine status color
    let statusColor = '#6c757d' // Default gray
    switch (vehicleData.status?.toLowerCase()) {
      case 'active':
      case 'operational':
        statusColor = '#28a745' // Green
        break
      case 'maintenance':
      case 'service':
        statusColor = '#ffc107' // Yellow
        break
      case 'inactive':
      case 'out of service':
        statusColor = '#dc3545' // Red
        break
    }

    const sections = []

    // Basic Information Section
    const basicItems = Object.entries(displayData.basicInfo)
      .filter(([_, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => ({ label, value: String(value) }))

    if (basicItems.length > 0) {
      sections.push({
        title: '🚛 Vehicle Information',
        items: basicItems
      })
    }

    // KIMPER Data Section
    const kimperItems = Object.entries(displayData.kimperData)
      .filter(([_, value]) => value !== undefined && value !== null && value !== '')
      .map(([label, value]) => ({ 
        label, 
        value: typeof value === 'object' ? JSON.stringify(value) : String(value) 
      }))

    if (kimperItems.length > 0) {
      sections.push({
        title: '🔧 KIMPER Commissioning',
        items: kimperItems
      })
    }

    // Specifications Section
    if (displayData.specifications && Object.keys(displayData.specifications).length > 0) {
      const specItems = Object.entries(displayData.specifications)
        .map(([label, value]) => ({ 
          label, 
          value: typeof value === 'object' ? JSON.stringify(value) : String(value) 
        }))

      sections.push({
        title: '⚙️ Technical Specifications',
        items: specItems
      })
    }

    // Recent Maintenance
    if (displayData.maintenanceHistory.length > 0) {
      const recentMaintenance = displayData.maintenanceHistory
        .slice(0, 3) // Show last 3 records
        .map(record => ({
          label: `${record.date} - ${record.type}`,
          value: record.description || 'No description'
        }))

      sections.push({
        title: '🔧 Recent Maintenance',
        items: recentMaintenance
      })
    }

    // Recent Inspections
    if (displayData.inspectionHistory.length > 0) {
      const recentInspections = displayData.inspectionHistory
        .slice(0, 3) // Show last 3 records
        .map(record => ({
          label: `${record.date} - ${record.inspector}`,
          value: `${record.status.toUpperCase()} (${record.overall_rating}⭐)`
        }))

      sections.push({
        title: '📋 Recent Inspections',
        items: recentInspections
      })
    }

    return {
      title: vehicleData.description || vehicleData.equip_no,
      subtitle: `${vehicleData.company} • ${vehicleData.vehicle_type}`,
      status: vehicleData.status || 'Unknown',
      statusColor,
      sections
    }
  }

  // Test QR scanning with sample data
  async testQRScanning(): Promise<{
    testResults: Array<{
      qrCode: string
      result: QRScanResult
    }>
    summary: {
      total: number
      successful: number
      failed: number
    }
  }> {
    const testQRCodes = [
      'EQUIP:TEST001',
      'EQUIP:TEST002',
      'https://werci.com/vehicles/TEST003',
      'TEST004',
      'INVALID_QR_CODE'
    ]

    const testResults = []
    let successful = 0
    let failed = 0

    for (const qrCode of testQRCodes) {
      const result = await this.scanQRCode(qrCode)
      testResults.push({ qrCode, result })
      
      if (result.success) {
        successful++
      } else {
        failed++
      }
    }

    return {
      testResults,
      summary: {
        total: testQRCodes.length,
        successful,
        failed
      }
    }
  }
}

// Export singleton instance
export const offlineQRService = new OfflineQRService()
export default offlineQRService
