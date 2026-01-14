/**
 * Offline Data Manager - WhatsApp-inspired data management
 * Handles cache size limits, data expiration, and cleanup routines
 */

import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'

interface DataStats {
  totalSize: number
  vehicleCount: number
  kimperCount: number
  // Removed inspectionCount and photoCount - mobile app creates these, doesn't display them
  lastCleanup: number
  cacheHitRate: number
}

interface CleanupOptions {
  maxCacheSize: number // MB
  maxAge: number // days
  // Removed keepRecentInspections - mobile app creates inspections, doesn't need to view them
  compressPhotos: boolean
}

class OfflineDataManager {
  private readonly DEFAULT_OPTIONS: CleanupOptions = {
    maxCacheSize: 50, // 50MB max cache
    maxAge: 30, // 30 days max age
    // Removed keepRecentInspections - mobile app creates inspections, doesn't need to view them
    compressPhotos: true
  }

  private readonly STORAGE_KEYS = {
    VEHICLES: 'werci_vehicles',
    KIMPER: 'werci_kimper',
    // Removed INSPECTIONS - mobile app creates inspections, doesn't need to view them
    PHOTOS: 'werci_photos',
    SYNC_QUEUE: 'werci_sync_queue',
    METADATA: 'werci_metadata'
  }

  private db: IDBPDatabase | null = null

  // Initialize IndexedDB connection (EXACT SAME SCHEMA as offlineDataSync)
  private async initDB() {
    if (this.db) return this.db

    this.db = await openDB('WERCKOfflineData', 2, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Vehicles store
        if (!db.objectStoreNames.contains('vehicles')) {
          const vehicleStore = db.createObjectStore('vehicles', { keyPath: 'equip_no' })
          vehicleStore.createIndex('id', 'id', { unique: true })  // Add id index for QR lookup
          vehicleStore.createIndex('status', 'commissioning_status')
          vehicleStore.createIndex('company', 'company')
        } else if (oldVersion < 2) {
          // Upgrade from version 1 to 2: Add id index to existing store
          const vehicleStore = transaction.objectStore('vehicles')
          if (!vehicleStore.indexNames.contains('id')) {
            vehicleStore.createIndex('id', 'id', { unique: true })
          }
        }

        // KIMPER codes store (using name as key since kode is excluded) - SAME AS SYNC
        if (!db.objectStoreNames.contains('kimperCodes')) {
          const kimperStore = db.createObjectStore('kimperCodes', { keyPath: 'name' })
          kimperStore.createIndex('id', 'id')  // Add id index for lookup
          kimperStore.createIndex('id_number', 'id_number')
          kimperStore.createIndex('company', 'company')
          kimperStore.createIndex('status', 'status')
        } else if (oldVersion < 2) {
          // Upgrade from version 1 to 2: Add id index to existing store
          const kimperStore = transaction.objectStore('kimperCodes')
          if (!kimperStore.indexNames.contains('id')) {
            kimperStore.createIndex('id', 'id')
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

  /**
   * Get comprehensive data statistics
   */
  async getDataStats(): Promise<DataStats> {
    try {
      await this.initDB()
      if (!this.db) throw new Error('Database not initialized')

      console.log('🔍 Getting data stats from IndexedDB...')

      // Get data from IndexedDB (same as offlineDataSync)
      const tx = this.db.transaction(['vehicles', 'kimperCodes', 'syncMetadata'], 'readonly')

      const vehicles = await tx.objectStore('vehicles').getAll()
      const kimper = await tx.objectStore('kimperCodes').getAll()
      // Removed inspections - mobile app creates inspections, doesn't need to view them
      const photos: any[] = [] // Photos not implemented yet

      console.log(`🔍 Raw data from IndexedDB - Vehicles: ${vehicles.length}, KIMPER: ${kimper.length}`)

      // Debug: Log first few records
      if (vehicles.length > 0) {
        console.log('🚛 Sample vehicle:', vehicles[0])
      }
      if (kimper.length > 0) {
        console.log('👤 Sample KIMPER:', kimper[0])
      }

      // Get metadata
      const lastCleanupData = await tx.objectStore('syncMetadata').get('lastCleanup')
      const cacheHitRateData = await tx.objectStore('syncMetadata').get('cacheHitRate')

      // Calculate approximate storage size
      const totalSize = this.calculateStorageSize({
        vehicles,
        kimper,
        // Removed inspections from size calculation
        photos
      })

      console.log(`📊 Final data stats - Vehicles: ${vehicles.length}, KIMPER: ${kimper.length}, Size: ${this.formatBytes(totalSize)}`)

      return {
        totalSize,
        vehicleCount: vehicles.length,
        kimperCount: kimper.length,
        // Removed inspectionCount and photoCount - mobile app creates these, doesn't display them
        lastCleanup: lastCleanupData?.value || 0,
        cacheHitRate: cacheHitRateData?.value || 0
      }
    } catch (error) {
      console.error('❌ Failed to get data stats:', error)
      return {
        totalSize: 0,
        vehicleCount: 0,
        kimperCount: 0,
        // Removed inspectionCount and photoCount - mobile app creates these, doesn't display them
        lastCleanup: 0,
        cacheHitRate: 0
      }
    }
  }

  /**
   * Intelligent cleanup based on usage patterns (WhatsApp-style)
   */
  async performIntelligentCleanup(options: Partial<CleanupOptions> = {}): Promise<{
    cleaned: boolean
    freedSpace: number
    itemsRemoved: number
    details: string[]
  }> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options }
    const details: string[] = []
    let freedSpace = 0
    let itemsRemoved = 0

    try {
      const initialStats = await this.getDataStats()
      
      // Check if cleanup is needed
      if (initialStats.totalSize < opts.maxCacheSize * 1024 * 1024) {
        return {
          cleaned: false,
          freedSpace: 0,
          itemsRemoved: 0,
          details: ['No cleanup needed - cache size within limits']
        }
      }

      // 1. Remove expired data
      const expiredCleanup = await this.removeExpiredData(opts.maxAge)
      freedSpace += expiredCleanup.freedSpace
      itemsRemoved += expiredCleanup.itemsRemoved
      if (expiredCleanup.itemsRemoved > 0) {
        details.push(`Removed ${expiredCleanup.itemsRemoved} expired items`)
      }

      // 2. Compress photos if enabled
      if (opts.compressPhotos) {
        const photoCleanup = await this.compressStoredPhotos()
        freedSpace += photoCleanup.freedSpace
        if (photoCleanup.compressed > 0) {
          details.push(`Compressed ${photoCleanup.compressed} photos`)
        }
      }

      // Removed inspection cleanup - mobile app creates inspections, doesn't need to view them

      // 4. Update metadata
      await this.updateMetadata({
        lastCleanup: Date.now(),
        lastCleanupSize: freedSpace
      })

      const finalStats = await this.getDataStats()
      details.push(`Cache size: ${this.formatBytes(finalStats.totalSize)}`)

      return {
        cleaned: true,
        freedSpace,
        itemsRemoved,
        details
      }
    } catch (error) {
      console.error('Cleanup failed:', error)
      return {
        cleaned: false,
        freedSpace: 0,
        itemsRemoved: 0,
        details: [`Cleanup failed: ${error}`]
      }
    }
  }

  /**
   * Remove data older than specified days
   */
  private async removeExpiredData(_maxAge: number): Promise<{
    freedSpace: number
    itemsRemoved: number
  }> {
    // Reserved for future data cleanup functionality
    // const cutoffDate = Date.now() - (maxAge * 24 * 60 * 60 * 1000)

    try {
      // Mobile app creates inspections, doesn't need to view them
      // Future: implement cleanup of old cached vehicle/KIMPER data
      return { freedSpace: 0, itemsRemoved: 0 }
    } catch (error) {
      console.error('Failed to remove expired data:', error)
      return { freedSpace: 0, itemsRemoved: 0 }
    }
  }

  /**
   * Compress stored photos to save space
   */
  private async compressStoredPhotos(): Promise<{
    freedSpace: number
    compressed: number
  }> {
    // This would implement photo compression logic
    // For now, return placeholder values
    return { freedSpace: 0, compressed: 0 }
  }

  // Removed cleanupOldInspections method - mobile app creates inspections, doesn't need to view them

  /**
   * Calculate approximate storage size
   */
  private calculateStorageSize(data: any): number {
    return this.estimateObjectSize(data)
  }

  /**
   * Estimate object size in bytes
   */
  private estimateObjectSize(obj: any): number {
    const jsonString = JSON.stringify(obj)
    return new Blob([jsonString]).size
  }

  /**
   * Format bytes to human readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * Generic storage helpers
   */
  private async getStoredData(key: string): Promise<any> {
    try {
      const data = localStorage.getItem(key)
      return data ? JSON.parse(data) : null
    } catch (error) {
      console.error(`Failed to get stored data for ${key}:`, error)
      return null
    }
  }

  private async setStoredData(key: string, data: any): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch (error) {
      console.error(`Failed to set stored data for ${key}:`, error)
      throw error
    }
  }

  private async updateMetadata(updates: any): Promise<void> {
    try {
      const existing = await this.getStoredData(this.STORAGE_KEYS.METADATA) || {}
      const updated = { ...existing, ...updates }
      await this.setStoredData(this.STORAGE_KEYS.METADATA, updated)
    } catch (error) {
      console.error('Failed to update metadata:', error)
    }
  }
}

export const offlineDataManager = new OfflineDataManager()
export default offlineDataManager
