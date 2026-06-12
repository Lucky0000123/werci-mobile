/**
 * Offline Deviation Storage
 * Stores deviation reports in IndexedDB for offline capability
 */

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { PersonnelDeviation } from '../types/deviation'

interface DeviationDB extends DBSchema {
  deviations: {
    key: number
    value: PersonnelDeviation & { _localId?: number; _synced: boolean }
    indexes: { 'by-kimper': number; 'by-status': string; 'by-date': string }
  }
  pendingDeviations: {
    key: number
    value: PersonnelDeviation & { _localId: number; _photos: Blob[] }
  }
}

let db: IDBPDatabase<DeviationDB> | null = null

async function getDB(): Promise<IDBPDatabase<DeviationDB>> {
  if (db) return db
  
  db = await openDB<DeviationDB>('DeviationDB', 1, {
    upgrade(db) {
      // Store for synced deviations
      if (!db.objectStoreNames.contains('deviations')) {
        const deviationStore = db.createObjectStore('deviations', { keyPath: 'id', autoIncrement: true })
        deviationStore.createIndex('by-kimper', 'kimper_id')
        deviationStore.createIndex('by-status', 'status')
        deviationStore.createIndex('by-date', 'deviation_date')
      }
      
      // Store for pending (offline) deviations
      if (!db.objectStoreNames.contains('pendingDeviations')) {
        db.createObjectStore('pendingDeviations', { keyPath: '_localId', autoIncrement: true })
      }
    }
  })
  
  return db
}

export class DeviationStorage {
  /**
   * Save deviation to pending queue (offline)
   */
  static async savePending(deviation: PersonnelDeviation, photos: Blob[]): Promise<number> {
    const database = await getDB()
    const localId = await database.add('pendingDeviations', {
      ...deviation,
      _localId: Date.now(),
      _photos: photos
    })
    console.log(`📦 Deviation saved to pending queue: ${localId}`)
    return localId as number
  }
  
  /**
   * Get all pending deviations
   */
  static async getPending(): Promise<Array<PersonnelDeviation & { _localId: number; _photos: Blob[] }>> {
    const database = await getDB()
    return await database.getAll('pendingDeviations')
  }
  
  /**
   * Remove deviation from pending queue
   */
  static async removePending(localId: number): Promise<void> {
    const database = await getDB()
    await database.delete('pendingDeviations', localId)
    console.log(`✅ Removed deviation from pending queue: ${localId}`)
  }
  
  /**
   * Save synced deviation
   */
  static async saveSynced(deviation: PersonnelDeviation): Promise<void> {
    const database = await getDB()
    await database.put('deviations', { ...deviation, _synced: true })
  }
  
  /**
   * Get deviations by KIMPER ID
   */
  static async getByKimper(kimperId: number): Promise<PersonnelDeviation[]> {
    const database = await getDB()
    return await database.getAllFromIndex('deviations', 'by-kimper', kimperId)
  }
  
  /**
   * Get all deviations
   */
  static async getAll(): Promise<PersonnelDeviation[]> {
    const database = await getDB()
    return await database.getAll('deviations')
  }

  static async getByPerson(lookup: {
    personKey?: string
    employeeId?: string
    kimperId?: number
    ktpNumber?: string
  }): Promise<PersonnelDeviation[]> {
    const database = await getDB()
    const [synced, pending] = await Promise.all([
      database.getAll('deviations'),
      database.getAll('pendingDeviations')
    ])

    return [...synced, ...pending]
      .filter((deviation) => {
        return (
          (!!lookup.personKey && deviation.person_key === lookup.personKey) ||
          (!!lookup.employeeId && deviation.employee_id === lookup.employeeId) ||
          (!!lookup.ktpNumber && deviation.ktp_number === lookup.ktpNumber) ||
          (lookup.kimperId != null && deviation.kimper_id === lookup.kimperId)
        )
      })
      .sort((a, b) => new Date(b.deviation_date).getTime() - new Date(a.deviation_date).getTime())
  }
  
  /**
   * Clear all deviation data
   */
  static async clearAll(): Promise<void> {
    const database = await getDB()
    await database.clear('deviations')
    await database.clear('pendingDeviations')
    console.log('🗑️ All deviation data cleared')
  }
  
  /**
   * Get pending count
   */
  static async getPendingCount(): Promise<number> {
    const database = await getDB()
    return await database.count('pendingDeviations')
  }
}

export default DeviationStorage
