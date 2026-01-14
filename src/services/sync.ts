// Comprehensive offline-first sync service for WERCK mobile app
import { getDB } from './db'
import { apiFetch } from './api'
// import type { WerckDB } from './db'

export interface SyncStatus {
  isOnline: boolean
  isSyncing: boolean
  lastSync: number | null
  pendingItems: number
  failedItems: number
}

class SyncService {
  private isOnline = navigator.onLine
  private isSyncing = false
  private syncInterval: number | null = null
  private retryTimeout: number | null = null
  private listeners: ((status: SyncStatus) => void)[] = []

  constructor() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true
      this.notifyListeners()
      this.startSync()
    })
    
    window.addEventListener('offline', () => {
      this.isOnline = false
      this.notifyListeners()
    })

    // Start periodic sync if online
    if (this.isOnline) {
      this.startPeriodicSync()
    }
  }

  // Subscribe to sync status changes
  onStatusChange(callback: (status: SyncStatus) => void) {
    this.listeners.push(callback)
    // Immediately notify with current status
    this.getStatus().then(callback)
    
    return () => {
      const index = this.listeners.indexOf(callback)
      if (index > -1) this.listeners.splice(index, 1)
    }
  }

  private async notifyListeners() {
    const status = await this.getStatus()
    this.listeners.forEach(callback => callback(status))
  }

  async getStatus(): Promise<SyncStatus> {
    const db = await getDB()
    const queueItems = await db.getAll('syncQueue')
    const failedItems = queueItems.filter(item => item.retries >= 3)
    
    // Get last sync time from users store
    const users = await db.getAll('users')
    const lastSync = users.length > 0 ? users[0].lastSync || null : null

    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      lastSync,
      pendingItems: queueItems.length,
      failedItems: failedItems.length
    }
  }

  private startPeriodicSync() {
    // Sync every 30 seconds when online
    this.syncInterval = window.setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.startSync()
      }
    }, 30000)
  }

  private stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  async startSync(): Promise<void> {
    if (!this.isOnline || this.isSyncing) return

    this.isSyncing = true
    this.notifyListeners()

    try {
      await this.processSyncQueue()
      
      // Update last sync time
      const db = await getDB()
      const users = await db.getAll('users')
      if (users.length > 0) {
        const user = users[0]
        user.lastSync = Date.now()
        await db.put('users', user)
      }
      
    } catch (error) {
      console.error('Sync failed:', error)
    } finally {
      this.isSyncing = false
      this.notifyListeners()
    }
  }

  private async processSyncQueue(): Promise<void> {
    const db = await getDB()
    const queueItems = await db.getAll('syncQueue')
    
    // Sort by priority (lower number = higher priority)
    queueItems.sort((a, b) => a.priority - b.priority)

    for (const item of queueItems) {
      try {
        if (item.kind === 'inspection') {
          await this.syncInspection(item.refId)
        } else if (item.kind === 'photo') {
          await this.syncPhoto(item.refId)
        }
        
        // Remove from queue on success
        await db.delete('syncQueue', item.id)
        
      } catch (error) {
        console.error(`Failed to sync ${item.kind} ${item.refId}:`, error)
        
        // Increment retry count
        item.retries = (item.retries || 0) + 1
        
        if (item.retries >= 3) {
          console.warn(`Max retries reached for ${item.kind} ${item.refId}`)
          // Keep in queue but mark as failed
        }
        
        await db.put('syncQueue', item)
      }
    }
  }

  private async syncInspection(inspectionId: string): Promise<void> {
    const db = await getDB()
    const inspection = await db.get('inspections', inspectionId)

    if (!inspection || !inspection.pendingSync) {
      return // Already synced or doesn't exist
    }

    // Get device token for authentication
    const users = await db.getAll('users')
    let token = users.length > 0 ? users[0].token : null

    // Prepare inspection data for API (map mobile fields to web app fields)
    const inspectionData = {
      // Vehicle identification - include both ID and equipment number for QR-based inspections
      vehicle_id: inspection.vehicleId || null,
      equip_no: inspection.vehicleEquipNo || null,
      inspector_name: inspection.inspectorName,
      inspection_date: inspection.inspectionDate,
      inspection_type: inspection.inspectionType,
      status: inspection.status,
      notes: inspection.notes,
      odometer_reading: inspection.odometerReading,
      // Component conditions (map mobile field names to web app field names)
      tire_condition: inspection.tireCondition,
      brake_condition: inspection.brakeCondition,
      lights_working: inspection.lightsWorking === 'yes' ? true : false,
      engine_condition: inspection.engineCondition,
      body_condition: inspection.bodyExteriorCondition, // Map body_exterior to body_condition
      interior_condition: inspection.bodyInteriorCondition, // Map body_interior to interior_condition
      // Overall rating
      star_rating: inspection.overallStars,
      // GPS coordinates
      gps_latitude: inspection.gpsLatitude,
      gps_longitude: inspection.gpsLongitude
    }

    // Send to web app API with retry on 401
    let response = await apiFetch('/api/mobile/inspections', {
      method: 'POST',
      body: JSON.stringify(inspectionData)
    }, { token: token || undefined })

    // If 401, refresh token and retry once
    if (response.status === 401 && token) {
      console.warn('🔁 401 during sync, refreshing token...')
      const { AuthService } = await import('./auth')
      const authService = AuthService.getInstance()
      await authService.refreshToken()

      // Get fresh token from DB
      const updatedUsers = await db.getAll('users')
      token = updatedUsers.length > 0 ? updatedUsers[0].token : null

      response = await apiFetch('/api/mobile/inspections', {
        method: 'POST',
        body: JSON.stringify(inspectionData)
      }, { token: token || undefined })
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error: ${response.status} - ${errorText}`)
    }

    const result = await response.json()

    if (!result.success) {
      throw new Error(`API returned error: ${result.message || 'Unknown error'}`)
    }

    // Mark as synced
    inspection.pendingSync = false
    await db.put('inspections', inspection)

    console.log(`✅ Inspection ${inspectionId} synced successfully`)
  }

  private async syncPhoto(photoId: string): Promise<void> {
    const db = await getDB()
    const photo = await db.get('photos', photoId)

    if (!photo || !photo.pendingSync) {
      return // Already synced or doesn't exist
    }

    // Get device token for authentication
    const users = await db.getAll('users')
    let token = users.length > 0 ? users[0].token : null

    // Convert data URL to blob
    const response = await fetch(photo.dataURL)
    const blob = await response.blob()

    // Create form data
    const formData = new FormData()
    formData.append('photo', blob, `inspection_photo_${photoId}.jpg`)
    formData.append('inspection_id', photo.inspectionId)
    formData.append('category', photo.category)

    // Send to web app API using centralized service with retry on 401
    let apiResponse = await apiFetch('/api/mobile/photos', {
      method: 'POST',
      body: formData
    }, { token: token || undefined })

    // If 401, refresh token and retry once
    if (apiResponse.status === 401 && token) {
      console.warn('🔁 401 during photo sync, refreshing token...')
      const { AuthService } = await import('./auth')
      const authService = AuthService.getInstance()
      await authService.refreshToken()

      // Get fresh token from DB
      const updatedUsers = await db.getAll('users')
      token = updatedUsers.length > 0 ? updatedUsers[0].token : null

      apiResponse = await apiFetch('/api/mobile/photos', {
        method: 'POST',
        body: formData
      }, { token: token || undefined })
    }

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text()
      throw new Error(`Photo API error: ${apiResponse.status} - ${errorText}`)
    }

    const result = await apiResponse.json()

    if (!result.success) {
      throw new Error(`Photo API returned error: ${result.message || 'Unknown error'}`)
    }

    // Mark as synced
    photo.pendingSync = false
    await db.put('photos', photo)

    console.log(`✅ Photo ${photoId} synced successfully`)
  }

  // Manual sync trigger
  async forcSync(): Promise<void> {
    if (!this.isOnline) {
      throw new Error('Cannot sync while offline')
    }
    
    await this.startSync()
  }

  // Clear failed items from queue
  async clearFailedItems(): Promise<void> {
    const db = await getDB()
    const queueItems = await db.getAll('syncQueue')
    const failedItems = queueItems.filter(item => item.retries >= 3)
    
    for (const item of failedItems) {
      await db.delete('syncQueue', item.id)
    }
    
    this.notifyListeners()
  }

  // Retry failed items
  async retryFailedItems(): Promise<void> {
    const db = await getDB()
    const queueItems = await db.getAll('syncQueue')
    const failedItems = queueItems.filter(item => item.retries >= 3)
    
    for (const item of failedItems) {
      item.retries = 0 // Reset retry count
      await db.put('syncQueue', item)
    }
    
    if (this.isOnline) {
      await this.startSync()
    }
  }

  destroy() {
    this.stopPeriodicSync()
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
    }
    this.listeners = []
  }
}

// Export singleton instance
export const syncService = new SyncService()
