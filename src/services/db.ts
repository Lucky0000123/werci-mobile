// IndexedDB wrapper using idb for PRISM mobile
// Schema v1: inspections, photos, syncQueue, users
import { openDB, deleteDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

const PRISM_DB_NAME = 'prism-mobile'
const PRISM_DB_VERSION = 1

// Classify IDB errors that usually mean the underlying LevelDB store is corrupted
// (common on Chromium/Windows after a crash or partial storage wipe).
// For these, we wipe and recreate the DB instead of propagating the error.
function isRecoverableIdbError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: string; message?: string }
  const name = e.name || ''
  const msg  = e.message || String(err)
  return (
    name === 'UnknownError' ||
    name === 'InvalidStateError' ||
    name === 'NotFoundError' ||
    /internal error/i.test(msg) ||
    /backing store/i.test(msg)
  )
}

export interface StoredUserSession {
  deviceId: string
  token: string
  lastSync?: number
  validUntil?: number
  isTemporary?: boolean
  userId?: number
  username?: string
  role?: string
  fullName?: string
  authenticatedAt?: number
}

interface PrismDB extends DBSchema {
  inspections: {
    key: string // inspectionId
    value: {
      id: string
      createdAt: number
      updatedAt: number
      vehicleId: string
      vehicleEquipNo?: string
      inspectorName: string
      inspectionDate: string
      inspectionType: string
      status: 'FAILED' | 'MODERATE' | 'PASS'
      overallStars: 1 | 2 | 3 | 4 | 5
      notes?: string
      odometerReading?: number
      // Component conditions (good/fair/poor)
      tireCondition: string
      brakeCondition: string
      lightsWorking: string // yes/no
      engineCondition: string
      bodyExteriorCondition: string
      bodyInteriorCondition: string
      // GPS coordinates
      gpsLatitude?: number
      gpsLongitude?: number
      createServiceRequest?: boolean
      pendingSync?: boolean
    }
    indexes: { 'by-updatedAt': number }
  }
  photos: {
    key: string // photoId
    value: {
      id: string
      inspectionId: string
      category: 'tire' | 'brake' | 'lights' | 'engine' | 'body' | 'interior' | 'general'
      mime: string
      dataURL: string // compressed image data
      compressionRatio?: number
      createdAt: number
      pendingSync?: boolean
    }
    indexes: { 'by-inspectionId': string }
  }
  syncQueue: {
    key: string // queueId
    value: {
      id: string
      kind: 'inspection' | 'photo'
      refId: string
      priority: 1 | 2 | 3 | 4
      retries: number
      createdAt: number
    }
    indexes: { 'by-priority': number }
  }
  users: {
    key: string // deviceId
    value: StoredUserSession
  }
}

let dbPromise: Promise<IDBPDatabase<PrismDB>> | null = null

function openPrismDB(): Promise<IDBPDatabase<PrismDB>> {
  return openDB<PrismDB>(PRISM_DB_NAME, PRISM_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('inspections')) {
        const insp = db.createObjectStore('inspections', { keyPath: 'id' })
        insp.createIndex('by-updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('by-inspectionId', 'inspectionId')
      }
      if (!db.objectStoreNames.contains('syncQueue')) {
        const queue = db.createObjectStore('syncQueue', { keyPath: 'id' })
        queue.createIndex('by-priority', 'priority')
      }
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'deviceId' })
      }
    },
    blocked()        { console.warn('[IDB] prism-mobile open blocked by other tab') },
    blocking()       { console.warn('[IDB] prism-mobile blocking newer open; closing') },
    terminated()     { console.warn('[IDB] prism-mobile connection terminated'); dbPromise = null }
  })
}

export function getDB(): Promise<IDBPDatabase<PrismDB>> {
  if (!dbPromise) {
    dbPromise = openPrismDB().catch(async (err) => {
      dbPromise = null
      if (isRecoverableIdbError(err)) {
        console.warn(`[IDB] ${PRISM_DB_NAME} open failed (${(err as Error).name}); wiping and retrying once…`, err)
        try {
          await deleteDB(PRISM_DB_NAME)
          const db = await openPrismDB()
          console.info(`[IDB] ${PRISM_DB_NAME} successfully recreated after wipe`)
          dbPromise = Promise.resolve(db)
          return db
        } catch (retryErr) {
          console.error(`[IDB] ${PRISM_DB_NAME} unrecoverable after wipe`, retryErr)
          throw retryErr
        }
      }
      throw err
    })
  }
  return dbPromise
}

export async function enqueue(item: Omit<PrismDB['syncQueue']['value'], 'id' | 'retries' | 'createdAt'>) {
  const id = crypto.randomUUID()
  const db = await getDB()
  await db.add('syncQueue', { id, ...item, retries: 0, createdAt: Date.now() })
  return id
}

export async function setInspection(v: PrismDB['inspections']['value']) {
  const db = await getDB()
  await db.put('inspections', v)
}

export async function addPhoto(v: PrismDB['photos']['value']) {
  const db = await getDB()
  await db.put('photos', v)
}

export async function clearAllData(): Promise<void> {
  try {
    const db = await getDB()
    // Clear all data stores (only the ones that exist in schema)
    await db.clear('inspections')
    await db.clear('photos')
    await db.clear('users')
    await db.clear('syncQueue')
    console.log('🗑️ All cached data cleared successfully')
  } catch (error) {
    console.error('❌ Failed to clear cache:', error)
    throw error
  }
}

export type { PrismDB }

