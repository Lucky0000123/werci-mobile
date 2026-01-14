// Offline Data Sync Service for WERCK Mobile
// Handles syncing essential vehicle and KIMPER data for offline QR scanning

import { apiFetch } from './api'
// Auth service reserved for future authentication features
// import { authService } from './auth'
import { openDB } from 'idb'
// Removed mock data imports - no mock data fallbacks as per user requirements
import { directSQLServerService } from './directSqlServer'

// Type definitions
interface Vehicle {
  id: number
  equip_no: string
  make: string
  model: string
  year: number
  status: string
}

interface KimperCode {
  id: number
  name: string
  id_number: string
  description?: string
}

// Essential data structures for offline operations (per user requirements)
interface VehicleBasicInfo {
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

interface KimperMapping {
  id: number  // Added for QR code lookup by kimper_id
  name: string
  id_number?: string
  company?: string
  department?: string
  kimper_expired_date?: string
  status?: string
}

interface RecentInspection {
  id: number
  vehicle_equip_no: string
  inspection_date: string
  inspector_name: string
  status: string
  star_rating?: number
  notes?: string
}

interface OfflineDataPackage {
  vehicles: VehicleBasicInfo[]
  kimperCodes: KimperMapping[]
  // Removed recentInspections - mobile app creates inspections, doesn't need to view them
  lastSyncTimestamp: number
  dataVersion: string
  totalRecords: number
}

interface OfflineDataDB {
  vehicles: {
    key: string // equip_no
    value: VehicleBasicInfo
  }
  kimperCodes: {
    key: string // name (using name as key since kode is excluded)
    value: KimperMapping
  }
  recentInspections: {
    key: string // inspection id
    value: any // inspection data
  }
  syncMetadata: {
    key: string // 'lastSync', 'dataVersion', etc.
    value: any
  }
}

class OfflineDataSyncService {
  private db: any = null
  private syncInProgress = false
  private listeners: Array<(status: SyncStatus) => void> = []

  async initialize() {
    if (this.db) return this.db

    this.db = await openDB<OfflineDataDB>('WERCKOfflineData', 2, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Vehicles store
        if (!db.objectStoreNames.contains('vehicles')) {
          const vehicleStore = db.createObjectStore('vehicles', { keyPath: 'equip_no' })
          vehicleStore.createIndex('id', 'id', { unique: true })  // Add index on id for QR lookup
          vehicleStore.createIndex('status', 'commissioning_status')
          vehicleStore.createIndex('company', 'company')
        } else if (oldVersion < 2) {
          // Upgrade from version 1 to 2: Add id index to existing store
          const vehicleStore = transaction.objectStore('vehicles')
          if (!vehicleStore.indexNames.contains('id')) {
            vehicleStore.createIndex('id', 'id', { unique: true })
          }
        }

        // KIMPER codes store (using name as key since kode is excluded)
        if (!db.objectStoreNames.contains('kimperCodes')) {
          const kimperStore = db.createObjectStore('kimperCodes', { keyPath: 'name' })
          kimperStore.createIndex('id', 'id', { unique: true })  // Add index on id for QR lookup
          kimperStore.createIndex('id_number', 'id_number')
          kimperStore.createIndex('company', 'company')
          kimperStore.createIndex('status', 'status')
        } else if (oldVersion < 2) {
          // Upgrade from version 1 to 2: Add id index to existing store
          const kimperStore = transaction.objectStore('kimperCodes')
          if (!kimperStore.indexNames.contains('id')) {
            kimperStore.createIndex('id', 'id', { unique: true })
          }
        }

        // Recent inspections store
        if (!db.objectStoreNames.contains('recentInspections')) {
          const inspectionStore = db.createObjectStore('recentInspections', { keyPath: 'id' })
          inspectionStore.createIndex('vehicle', 'vehicle_equip_no')
          inspectionStore.createIndex('date', 'inspection_date')
        }

        // Sync metadata store
        if (!db.objectStoreNames.contains('syncMetadata')) {
          db.createObjectStore('syncMetadata', { keyPath: 'key' })
        }
      }
    })

    return this.db
  }

  // Main sync function - downloads essential data from server
  async syncOfflineData(force = false): Promise<SyncResult> {
    if (this.syncInProgress && !force) {
      return { success: false, message: 'Sync already in progress' }
    }

    this.syncInProgress = true
    this.notifyListeners({ status: 'syncing', progress: 0 })

    try {
      await this.initialize()

      // Check if sync is needed (unless forced)
      if (!force) {
        const lastSync = await this.getLastSyncTime()
        const timeSinceSync = Date.now() - lastSync
        const SYNC_INTERVAL = 4 * 60 * 60 * 1000 // 4 hours

        if (timeSinceSync < SYNC_INTERVAL) {
          return { 
            success: true, 
            message: `Data is fresh (synced ${Math.round(timeSinceSync / 60000)} minutes ago)`,
            cached: true
          }
        }
      }

      console.log('🔄 Starting offline data sync...')
      
      // Fetch essential data from server
      const dataPackage = await this.fetchEssentialData()
      
      this.notifyListeners({ status: 'syncing', progress: 50 })

      // Store data locally
      await this.storeOfflineData(dataPackage)
      
      this.notifyListeners({ status: 'syncing', progress: 100 })

      console.log(`✅ Offline sync complete: ${dataPackage.totalRecords} records`)
      
      this.notifyListeners({ status: 'complete', progress: 100, data: dataPackage })

      return {
        success: true,
        message: `Synced ${dataPackage.totalRecords} records successfully`,
        data: dataPackage
      }

    } catch (error) {
      console.error('❌ Offline sync failed:', error)
      this.notifyListeners({ status: 'error', error: error as Error })
      
      return {
        success: false,
        message: `Sync failed: ${(error as Error).message}`,
        error: error as Error
      }
    } finally {
      this.syncInProgress = false
    }
  }

  // Fetch essential data from server API with intelligent connection routing
  private async fetchEssentialData(): Promise<OfflineDataPackage> {
    console.log('🔄 Fetching essential data from server...')

    try {
      // Check if we're on company network for direct SQL Server connection
      const isOnCompanyNetwork = await directSQLServerService.isOnCompanyNetwork()

      if (isOnCompanyNetwork) {
        console.log('🏢 On company network - using direct SQL Server connection')
        const [vehicleData, kimperData] = await Promise.all([
          directSQLServerService.getVehiclesEssential(),
          directSQLServerService.getKimperEssential()
          // Removed inspections - mobile app creates inspections, doesn't need to view them
        ])

        console.log(`📊 Direct SQL Server data - Vehicles: ${vehicleData.length}, KIMPER: ${kimperData.length}`)

        return {
          vehicles: vehicleData,
          kimperCodes: kimperData,
          lastSyncTimestamp: Date.now(),
          dataVersion: `v${Date.now()}`,
          totalRecords: vehicleData.length + kimperData.length
        }
      } else {
        console.log('📱 Using cloud/fallback API connection')

        // Try new mobile API endpoints first, fallback to existing endpoints
        let vehicleData: any[] = []
        let kimperData: any[] = []
        // Removed inspectionData - mobile app creates inspections, doesn't need to view them

        try {
          // Try new mobile API endpoints (removed inspections - mobile app creates them, doesn't need to view them)
          const [vehiclesResponse, kimperResponse] = await Promise.all([
            apiFetch('/api/mobile/vehicles/essential', { method: 'GET' }),
            apiFetch('/api/mobile/kimper/essential', { method: 'GET' })
          ])

          if (vehiclesResponse.ok) {
            const vehicles = await vehiclesResponse.json()
            if (vehicles.data && vehicles.data.length > 0) {
              vehicleData = vehicles.data
            }
          }

          if (kimperResponse.ok) {
            const kimper = await kimperResponse.json()
            if (kimper.data && kimper.data.length > 0) {
              kimperData = kimper.data
            }
          }

          // Removed inspection handling - mobile app creates inspections, doesn't need to view them

        } catch (error) {
          console.log('⚠️ New mobile API endpoints not available, trying fallback endpoints...')

          try {
            // Fallback to existing API endpoints
            const vehiclesResponse = await apiFetch('/api/vehicles', { method: 'GET' })
            if (vehiclesResponse.ok) {
              const vehicles = await vehiclesResponse.json()
              if (vehicles.vehicles && vehicles.vehicles.length > 0) {
                // Transform existing API format to expected format
                vehicleData = vehicles.vehicles.map((v: any) => ({
                  equip_no: v.equipment_number || v.equip_no,
                  description: v.model || v.description,
                  company: 'WERCK',
                  manufacturer: v.make || v.manufacturer,
                  unit_model: v.model || v.unit_model,
                  commissioning_date: null,
                  year: v.year,
                  commissioning_status: v.status || 'Active',
                  expired_date: null
                }))
                console.log(`✅ Fetched ${vehicleData.length} vehicles from fallback API`)
              }
            }

            // Removed inspection fetching - mobile app creates inspections, doesn't need to view them

            // Try to get users/KIMPER data
            const usersResponse = await apiFetch('/api/users', { method: 'GET' })
            if (usersResponse.ok) {
              const users = await usersResponse.json()
              if (users.users && users.users.length > 0) {
                // Transform users to KIMPER format
                kimperData = users.users.map((u: any) => ({
                  name: u.name || u.username,
                  id_number: u.id || u.employee_id,
                  company: 'WERCK',
                  department: u.department || 'Operations',
                  kimper_expired_date: '2025-12-31',
                  status: u.status || 'Active'
                }))
                console.log(`✅ Fetched ${kimperData.length} KIMPER codes from users API`)
              }
            }

          } catch (fallbackError) {
            console.error('❌ All API endpoints failed:', fallbackError)
            throw new Error('Unable to fetch data from any API endpoint')
          }
        }

        console.log(`📊 Cloud API data - Vehicles: ${vehicleData.length}, KIMPER: ${kimperData.length}`)

        // Always using real data from API endpoints
        console.log('✅ Using real data from API endpoints')

        return {
          vehicles: vehicleData,
          kimperCodes: kimperData,
          // Removed recentInspections - mobile app creates inspections, doesn't need to view them
          lastSyncTimestamp: Date.now(),
          dataVersion: `v${Date.now()}`,
          totalRecords: vehicleData.length + kimperData.length
        }
      }
    } catch (error) {
      console.error('❌ Data fetch failed completely:', error)
      throw error // Re-throw the error instead of using mock data
    }
  }

  // Store data in IndexedDB
  private async storeOfflineData(dataPackage: OfflineDataPackage) {
    console.log('💾 Starting to store data in IndexedDB...', {
      vehicles: dataPackage.vehicles.length,
      kimper: dataPackage.kimperCodes.length,
      // Removed inspections - mobile app creates inspections, doesn't need to view them
      totalRecords: dataPackage.totalRecords
    })

    if (!this.db) throw new Error('Database not initialized')

    const tx = this.db.transaction(['vehicles', 'kimperCodes', 'syncMetadata'], 'readwrite')

    // Clear existing data
    console.log('🗑️ Clearing existing data...')
    await Promise.all([
      tx.objectStore('vehicles').clear(),
      tx.objectStore('kimperCodes').clear()
      // Removed recentInspections clearing - mobile app creates inspections, doesn't need to view them
    ])

    // Store new data
    const vehicleStore = tx.objectStore('vehicles')
    const kimperStore = tx.objectStore('kimperCodes')
    // Removed inspectionStore - mobile app creates inspections, doesn't need to view them
    const metadataStore = tx.objectStore('syncMetadata')

    // Batch insert vehicles
    console.log(`🚛 Storing ${dataPackage.vehicles.length} vehicles...`)
    for (const vehicle of dataPackage.vehicles) {
      await vehicleStore.put(vehicle)
    }

    // Batch insert KIMPER codes
    console.log(`👤 Storing ${dataPackage.kimperCodes.length} KIMPER codes...`)
    for (const kimper of dataPackage.kimperCodes) {
      await kimperStore.put(kimper)
    }

    // Removed inspection storage - mobile app creates inspections, doesn't need to view them

    // Update metadata
    console.log('📊 Storing metadata...')
    await metadataStore.put({ key: 'lastSync', value: dataPackage.lastSyncTimestamp })
    await metadataStore.put({ key: 'dataVersion', value: dataPackage.dataVersion })
    await metadataStore.put({ key: 'totalRecords', value: dataPackage.totalRecords })

    // Wait for transaction to complete
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        console.log('✅ IndexedDB transaction completed successfully!')
        resolve()
      }
      tx.onerror = () => {
        console.error('❌ IndexedDB transaction failed:', tx.error)
        reject(tx.error)
      }
    })

    console.log('✅ Data storage completed successfully!')

    await tx.done
  }

  // Offline-first vehicle lookup by equipment number
  async lookupVehicleOffline(equipmentNumber: string): Promise<VehicleBasicInfo | null> {
    await this.initialize()
    if (!this.db) return null

    try {
      // First try exact match
      let vehicle = await this.db.get('vehicles', equipmentNumber.toUpperCase().trim())

      if (!vehicle) {
        // Try partial match (for QR codes with extra formatting)
        const allVehicles = await this.db.getAll('vehicles')
        vehicle = allVehicles.find((v: Vehicle) =>
          v.equip_no.includes(equipmentNumber) ||
          equipmentNumber.includes(v.equip_no)
        )
      }

      return vehicle || null
    } catch (error) {
      console.error('❌ Offline vehicle lookup failed:', error)
      return null
    }
  }

  // Lookup vehicle by ID (for QR code scanning)
  async lookupVehicleById(vehicleId: number): Promise<VehicleBasicInfo | null> {
    try {
      // Try offline first using index for fast lookup
      await this.initialize()
      if (this.db) {
        try {
          // Use index for fast lookup
          const vehicle = await this.db.getFromIndex('vehicles', 'id', vehicleId)
          if (vehicle) {
            console.log('📦 Using offline vehicle data for ID:', vehicleId, '→', vehicle.equip_no)
            return vehicle
          }
        } catch (indexError) {
          // Fallback to full scan if index doesn't exist yet
          console.warn('⚠️ Index lookup failed, falling back to full scan:', indexError)
          const allVehicles = await this.db.getAll('vehicles')
          const vehicle = allVehicles.find((v: any) => v.id === vehicleId)
          if (vehicle) {
            console.log('📦 Using offline vehicle data (full scan) for ID:', vehicleId)
            return vehicle
          }
        }
      }

      // If not found offline, try API
      console.log('🌐 Fetching vehicle from API for ID:', vehicleId)
      const { apiFetch } = await import('./api')
      const response = await apiFetch(`/api/mobile/vehicles/${vehicleId}`, { method: 'GET' })

      if (!response.ok) {
        console.warn(`❌ Vehicle API lookup failed for ID ${vehicleId}`)
        return null
      }

      const result = await response.json()
      if (result.success && result.data && result.data.vehicle) {
        console.log('✅ Vehicle found via API:', result.data.vehicle.equip_no)
        return result.data.vehicle
      }

      return null
    } catch (error) {
      console.error('❌ Vehicle lookup by ID failed:', error)
      return null
    }
  }

  // Offline-first KIMPER lookup (by name since kode is excluded)
  async lookupKimperOffline(searchTerm: string): Promise<KimperMapping | null> {
    await this.initialize()
    if (!this.db) return null

    try {
      // Try exact name match first
      let kimper = await this.db.get('kimperCodes', searchTerm.trim())

      if (!kimper) {
        // Try partial match by name or id_number
        const allKimper = await this.db.getAll('kimperCodes')
        kimper = allKimper.find((k: KimperCode) =>
          k.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          k.id_number?.includes(searchTerm)
        )
      }

      return kimper || null
    } catch (error) {
      console.error('❌ Offline KIMPER lookup failed:', error)
      return null
    }
  }

  // Lookup KIMPER by ID (for QR code scanning)
  async lookupKimperById(kimperId: number): Promise<any | null> {
    try {
      // Try offline first using index for fast lookup
      await this.initialize()
      if (this.db) {
        try {
          // Use index for fast lookup
          const kimper = await this.db.getFromIndex('kimperCodes', 'id', kimperId)
          if (kimper) {
            console.log('📦 Using offline KIMPER data for ID:', kimperId, '→', kimper.name)
            return kimper
          }
        } catch (indexError) {
          // Fallback to full scan if index doesn't exist yet
          console.warn('⚠️ Index lookup failed, falling back to full scan:', indexError)
          const allKimper = await this.db.getAll('kimperCodes')
          const kimper = allKimper.find((k: any) => k.id === kimperId)
          if (kimper) {
            console.log('📦 Using offline KIMPER data (full scan) for ID:', kimperId)
            return kimper
          }
        }
      }

      // If not found offline, try API
      console.log('🌐 Fetching KIMPER from API for ID:', kimperId)
      const { apiFetch } = await import('./api')
      const response = await apiFetch(`/api/mobile/kimper/${kimperId}`, { method: 'GET' })

      if (!response.ok) {
        console.warn(`❌ KIMPER API lookup failed for ID ${kimperId}`)
        return null
      }

      const result = await response.json()
      if (result.success && result.kimper) {
        console.log('✅ KIMPER found via API:', result.kimper.name)
        return result.kimper
      }

      return null
    } catch (error) {
      console.error('❌ KIMPER lookup by ID failed:', error)
      return null
    }
  }

  // Get sync status and metadata
  async getSyncStatus(): Promise<OfflineSyncStatus> {
    await this.initialize()
    if (!this.db) return { hasData: false, lastSync: 0, totalRecords: 0 }

    try {
      const [lastSync, totalRecords, dataVersion] = await Promise.all([
        this.db.get('syncMetadata', 'lastSync'),
        this.db.get('syncMetadata', 'totalRecords'),
        this.db.get('syncMetadata', 'dataVersion')
      ])

      return {
        hasData: (totalRecords?.value || 0) > 0,
        lastSync: lastSync?.value || 0,
        totalRecords: totalRecords?.value || 0,
        dataVersion: dataVersion?.value || 'unknown',
        isStale: Date.now() - (lastSync?.value || 0) > 4 * 60 * 60 * 1000 // 4 hours
      }
    } catch (error) {
      console.error('❌ Failed to get sync status:', error)
      return { hasData: false, lastSync: 0, totalRecords: 0 }
    }
  }

  private async getLastSyncTime(): Promise<number> {
    if (!this.db) return 0
    const lastSync = await this.db.get('syncMetadata', 'lastSync')
    return lastSync?.value || 0
  }

  // Event listeners for sync status updates
  addSyncListener(callback: (status: SyncStatus) => void) {
    this.listeners.push(callback)
  }

  removeSyncListener(callback: (status: SyncStatus) => void) {
    this.listeners = this.listeners.filter(l => l !== callback)
  }

  private notifyListeners(status: SyncStatus) {
    this.listeners.forEach(callback => callback(status))
  }

  // Clear all offline data
  async clearOfflineData(): Promise<void> {
    await this.initialize()
    if (!this.db) return

    const tx = this.db.transaction(['vehicles', 'kimperCodes', 'recentInspections', 'syncMetadata'], 'readwrite')
    await Promise.all([
      tx.objectStore('vehicles').clear(),
      tx.objectStore('kimperCodes').clear(),
      tx.objectStore('recentInspections').clear(),
      tx.objectStore('syncMetadata').clear()
    ])
    await tx.done

    console.log('🗑️ Offline data cleared')
  }

  // Delete entire database and recreate with latest schema
  async deleteDatabaseAndRecreate(): Promise<void> {
    try {
      console.log('🗑️ Deleting entire IndexedDB database...')

      // Close current connection
      if (this.db) {
        this.db.close()
        this.db = null
      }

      // Delete the database
      await new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase('WERCKOfflineData')
        deleteRequest.onsuccess = () => {
          console.log('✅ Database deleted successfully')
          resolve()
        }
        deleteRequest.onerror = () => {
          console.error('❌ Failed to delete database')
          reject(deleteRequest.error)
        }
        deleteRequest.onblocked = () => {
          console.warn('⚠️ Database deletion blocked - close all tabs')
        }
      })

      // Reinitialize with latest schema
      await this.initialize()
      console.log('✅ Database recreated with latest schema (version 2)')
    } catch (error) {
      console.error('❌ Failed to delete and recreate database:', error)
      throw error
    }
  }

  // Clear database and force fresh sync
  async clearAndResync(): Promise<SyncResult> {
    try {
      console.log('🔄 Starting clear and resync...')

      // Delete and recreate database
      await this.deleteDatabaseAndRecreate()

      // Force sync fresh data
      const result = await this.syncOfflineData(true)

      if (result.success) {
        console.log('✅ Clear and resync completed successfully')
      }

      return result
    } catch (error) {
      console.error('❌ Clear and resync failed:', error)
      return {
        success: false,
        message: `Clear and resync failed: ${error}`,
        error: error as Error
      }
    }
  }
}

// Type definitions
interface SyncResult {
  success: boolean
  message: string
  data?: OfflineDataPackage
  error?: Error
  cached?: boolean
}

interface SyncStatus {
  status: 'syncing' | 'complete' | 'error'
  progress?: number
  data?: OfflineDataPackage
  error?: Error
}

interface OfflineSyncStatus {
  hasData: boolean
  lastSync: number
  totalRecords: number
  dataVersion?: string
  isStale?: boolean
}

// Export singleton instance
export const offlineDataSync = new OfflineDataSyncService()
export type { VehicleBasicInfo, KimperMapping, RecentInspection, SyncResult, SyncStatus, OfflineSyncStatus }
