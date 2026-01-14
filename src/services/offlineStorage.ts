// Offline Storage Manager for Vehicle Data and KIMPER Information
// Using native IndexedDB for better compatibility

export interface VehicleData {
  id: string
  equip_no: string
  description: string
  company: string
  status: string
  vehicle_type: string
  model: string
  year?: number
  license_plate?: string
  department?: string
  location?: string
  last_inspection?: string
  next_service?: string
  mileage?: number
  fuel_type?: string
  specifications?: Record<string, any>
  maintenance_history?: MaintenanceRecord[]
  inspection_history?: InspectionRecord[]
  kimper_data?: KimperData
  cached_at: number
}

export interface KimperData {
  commissioning_status: 'active' | 'inactive' | 'pending' | 'maintenance'
  commissioning_date?: string
  last_commissioning_check?: string
  next_commissioning_due?: string
  commissioning_records?: CommissioningRecord[]
  certification_status?: string
  compliance_notes?: string
  technical_specifications?: Record<string, any>
}

export interface CommissioningRecord {
  id: string
  date: string
  inspector: string
  status: 'pass' | 'fail' | 'conditional'
  notes?: string
  checklist_items?: ChecklistItem[]
}

export interface ChecklistItem {
  item: string
  status: 'pass' | 'fail' | 'n/a'
  notes?: string
}

export interface MaintenanceRecord {
  id: string
  date: string
  type: string
  description: string
  cost?: number
  technician?: string
  parts_used?: string[]
}

export interface InspectionRecord {
  id: string
  date: string
  inspector: string
  overall_rating: number
  status: 'pass' | 'fail' | 'moderate'
  notes?: string
  component_ratings?: Record<string, string>
}

class OfflineStorageManager {
  private db: IDBDatabase | null = null
  private readonly DB_NAME = 'werci_offline'
  private readonly DB_VERSION = 1

  async initialize(): Promise<void> {
    if (this.db) return

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        console.log('📦 Offline storage initialized')
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create vehicles store
        if (!db.objectStoreNames.contains('vehicles')) {
          const vehiclesStore = db.createObjectStore('vehicles', { keyPath: 'equip_no' })
          vehiclesStore.createIndex('by-company', 'company')
          vehiclesStore.createIndex('by-status', 'status')
          vehiclesStore.createIndex('by-cached-at', 'cached_at')
        }

        // Create sync metadata store
        if (!db.objectStoreNames.contains('sync_metadata')) {
          db.createObjectStore('sync_metadata', { keyPath: 'key' })
        }

        // Create QR cache store
        if (!db.objectStoreNames.contains('qr_cache')) {
          const qrStore = db.createObjectStore('qr_cache', { keyPath: 'qr_code' })
          qrStore.createIndex('by-accessed', 'last_accessed')
        }
      }
    })
  }

  async storeVehicleData(vehicles: VehicleData[]): Promise<void> {
    await this.initialize()
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('vehicles', 'readwrite')
      const store = tx.objectStore('vehicles')

      tx.onerror = () => reject(tx.error)
      tx.oncomplete = () => {
        console.log(`📦 Stored ${vehicles.length} vehicles in offline cache`)
        resolve()
      }

      for (const vehicle of vehicles) {
        vehicle.cached_at = Date.now()
        store.put(vehicle)
      }
    })
  }

  async getVehicleByEquipNo(equipNo: string): Promise<VehicleData | null> {
    await this.initialize()
    if (!this.db) return null

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('vehicles', 'readonly')
      const store = tx.objectStore('vehicles')
      const request = store.get(equipNo)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const vehicle = request.result
        if (vehicle) {
          console.log(`📦 Retrieved vehicle ${equipNo} from offline cache`)
          resolve(vehicle)
        } else {
          resolve(null)
        }
      }
    })
  }

  async getAllVehicles(): Promise<VehicleData[]> {
    await this.initialize()
    if (!this.db) return []

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('vehicles', 'readonly')
      const store = tx.objectStore('vehicles')
      const request = store.getAll()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || [])
    })
  }

  async cacheQRLookup(qrCode: string, equipNo: string): Promise<void> {
    await this.initialize()
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('qr_cache', 'readwrite')
      const store = tx.objectStore('qr_cache')

      // First get existing entry
      const getRequest = store.get(qrCode)
      getRequest.onsuccess = () => {
        const existing = getRequest.result
        const cacheEntry = {
          qr_code: qrCode,
          equip_no: equipNo,
          lookup_count: existing ? existing.lookup_count + 1 : 1,
          last_accessed: Date.now()
        }

        const putRequest = store.put(cacheEntry)
        putRequest.onerror = () => reject(putRequest.error)
        putRequest.onsuccess = () => resolve()
      }
      getRequest.onerror = () => reject(getRequest.error)
    })
  }

  async getEquipNoFromQR(qrCode: string): Promise<string | null> {
    await this.initialize()
    if (!this.db) return null

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('qr_cache', 'readwrite')
      const store = tx.objectStore('qr_cache')
      const request = store.get(qrCode)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const cached = request.result
        if (cached) {
          cached.last_accessed = Date.now()
          cached.lookup_count++

          const updateRequest = store.put(cached)
          updateRequest.onsuccess = () => resolve(cached.equip_no)
          updateRequest.onerror = () => resolve(cached.equip_no) // Still return the value even if update fails
        } else {
          resolve(null)
        }
      }
    })
  }

  async updateSyncMetadata(key: string, metadata: {
    last_sync: number
    total_records: number
    sync_status: 'complete' | 'partial' | 'failed'
  }): Promise<void> {
    await this.initialize()
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('sync_metadata', 'readwrite')
      const store = tx.objectStore('sync_metadata')
      const request = store.put({ key, ...metadata })

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  async getSyncMetadata(key: string): Promise<any> {
    await this.initialize()
    if (!this.db) return null

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('sync_metadata', 'readonly')
      const store = tx.objectStore('sync_metadata')
      const request = store.get(key)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || null)
    })
  }

  async getStorageStats(): Promise<{
    totalVehicles: number
    totalQRCache: number
    lastSync?: number
    cacheSize: string
  }> {
    await this.initialize()
    if (!this.db) return {
      totalVehicles: 0,
      totalQRCache: 0,
      cacheSize: '0 KB'
    }

    return new Promise(async (resolve, reject) => {
      try {
        const vehicles = await this.getAllVehicles()
        const qrCache = await this.getAllQRCache()
        const syncMeta = await this.getSyncMetadata('vehicles')

        const vehicleDataSize = JSON.stringify(vehicles).length
        const qrCacheSize = JSON.stringify(qrCache).length
        const totalBytes = vehicleDataSize + qrCacheSize
        const cacheSize = totalBytes > 1024 * 1024
          ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
          : `${(totalBytes / 1024).toFixed(1)} KB`

        resolve({
          totalVehicles: vehicles.length,
          totalQRCache: qrCache.length,
          lastSync: syncMeta?.last_sync,
          cacheSize
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  private async getAllQRCache(): Promise<any[]> {
    if (!this.db) return []

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('qr_cache', 'readonly')
      const store = tx.objectStore('qr_cache')
      const request = store.getAll()

      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result || [])
    })
  }

  async syncFromServer(connectionManager: any): Promise<boolean> {
    try {
      console.log('🔄 Starting offline data sync...')

      const response = await connectionManager.makeRequest('/api/mobile/vehicles/sync')

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`)
      }

      const data = await response.json()

      if (data.success && data.vehicles) {
        await this.storeVehicleData(data.vehicles)

        await this.updateSyncMetadata('vehicles', {
          last_sync: Date.now(),
          total_records: data.vehicles.length,
          sync_status: 'complete'
        })

        console.log(`✅ Synced ${data.vehicles.length} vehicles successfully`)
        return true
      }

      return false
    } catch (error) {
      console.error('❌ Sync failed:', error)

      await this.updateSyncMetadata('vehicles', {
        last_sync: Date.now(),
        total_records: 0,
        sync_status: 'failed'
      })

      return false
    }
  }
}

export const offlineStorage = new OfflineStorageManager()
export default offlineStorage