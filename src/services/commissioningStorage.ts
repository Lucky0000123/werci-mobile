// Offline Commissioning Storage
// Mirrors DeviationStorage: one IndexedDB database with a pending queue
// plus a "synced" history store so inspectors can review their previous
// submissions even without network. Photos are stored as Blobs inline.

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { CommissioningSubmitPayload } from './commissioningApi'

export interface PendingCommissioning {
  _localId: number
  payload: CommissioningSubmitPayload
  photos: Blob[]
  createdAt: number
  equipNo: string
  equipmentLabel: string
  attempts?: number
  lastError?: string
}

export interface SyncedCommissioning {
  id: number                // server-assigned inspection_id
  vehicleId: number
  equipNo: string
  equipmentLabel: string
  formSlug: string
  overallResult: string
  expiryDateSet?: string | null
  inspectionDate: string
  photoCount: number
  syncedAt: number
}

interface CommissioningDB extends DBSchema {
  pendingCommissioning: {
    key: number
    value: PendingCommissioning
    indexes: { 'by-vehicle': string; 'by-created': number }
  }
  syncedCommissioning: {
    key: number
    value: SyncedCommissioning
    indexes: { 'by-vehicle': number; 'by-date': string }
  }
}

let dbPromise: Promise<IDBPDatabase<CommissioningDB>> | null = null

function getDB(): Promise<IDBPDatabase<CommissioningDB>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<CommissioningDB>('PRISMCommissioningDB', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('pendingCommissioning')) {
        const store = db.createObjectStore('pendingCommissioning', {
          keyPath: '_localId',
          autoIncrement: true
        })
        store.createIndex('by-vehicle', 'equipNo')
        store.createIndex('by-created', 'createdAt')
      }
      if (!db.objectStoreNames.contains('syncedCommissioning')) {
        const store = db.createObjectStore('syncedCommissioning', { keyPath: 'id' })
        store.createIndex('by-vehicle', 'vehicleId')
        store.createIndex('by-date', 'inspectionDate')
      }
    }
  })
  return dbPromise
}

export class CommissioningStorage {
  /** Queue a submission for background sync. */
  static async savePending(
    payload: CommissioningSubmitPayload,
    photos: Blob[],
    meta: { equipNo: string; equipmentLabel: string }
  ): Promise<number> {
    const db = await getDB()
    const localId = await db.add('pendingCommissioning', {
      _localId: Date.now() + Math.floor(Math.random() * 1000),
      payload,
      photos,
      createdAt: Date.now(),
      equipNo: meta.equipNo,
      equipmentLabel: meta.equipmentLabel,
      attempts: 0
    } as PendingCommissioning)
    console.log(`📦 Commissioning queued: local=${localId} vehicle=${meta.equipNo}`)
    return localId as number
  }

  static async getPending(): Promise<PendingCommissioning[]> {
    const db = await getDB()
    return db.getAll('pendingCommissioning')
  }

  static async getPendingCount(): Promise<number> {
    const db = await getDB()
    return db.count('pendingCommissioning')
  }

  static async removePending(localId: number): Promise<void> {
    const db = await getDB()
    await db.delete('pendingCommissioning', localId)
  }

  static async recordAttempt(localId: number, error?: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction('pendingCommissioning', 'readwrite')
    const existing = await tx.store.get(localId)
    if (existing) {
      existing.attempts = (existing.attempts || 0) + 1
      existing.lastError = error
      await tx.store.put(existing)
    }
    await tx.done
  }

  static async saveSynced(record: SyncedCommissioning): Promise<void> {
    const db = await getDB()
    await db.put('syncedCommissioning', record)
  }

  static async getByVehicle(vehicleId: number): Promise<SyncedCommissioning[]> {
    const db = await getDB()
    const rows = await db.getAllFromIndex('syncedCommissioning', 'by-vehicle', vehicleId)
    return rows.sort((a, b) => b.syncedAt - a.syncedAt)
  }

  static async clearAll(): Promise<void> {
    const db = await getDB()
    await db.clear('pendingCommissioning')
    await db.clear('syncedCommissioning')
  }
}

export default CommissioningStorage
