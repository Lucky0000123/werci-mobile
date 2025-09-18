// IndexedDB wrapper using idb for WERCI mobile
// Schema v1: inspections, photos, syncQueue, users
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

interface WerciDB extends DBSchema {
  inspections: {
    key: string // inspectionId
    value: {
      id: string
      createdAt: number
      updatedAt: number
      vehicleId: string
      status: 'FAILED' | 'MODERATE' | 'PASS'
      stars: 1 | 2 | 3 | 4 | 5
      notes?: string
      pendingSync?: boolean
    }
    indexes: { 'by-updatedAt': number }
  }
  photos: {
    key: string // photoId
    value: {
      id: string
      inspectionId: string
      category: string
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
    value: {
      deviceId: string
      token: string
      lastSync?: number
    }
  }
}

let dbPromise: Promise<IDBPDatabase<WerciDB>> | null = null

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<WerciDB>('werci-mobile', 1, {
      upgrade(db) {
        const insp = db.createObjectStore('inspections', { keyPath: 'id' })
        insp.createIndex('by-updatedAt', 'updatedAt')
        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('by-inspectionId', 'inspectionId')
        const queue = db.createObjectStore('syncQueue', { keyPath: 'id' })
        queue.createIndex('by-priority', 'priority')
        db.createObjectStore('users', { keyPath: 'deviceId' })
      },
    })
  }
  return dbPromise!
}

export async function enqueue(item: Omit<WerciDB['syncQueue']['value'], 'id' | 'retries' | 'createdAt'>) {
  const id = crypto.randomUUID()
  const db = await getDB()
  await db.add('syncQueue', { id, ...item, retries: 0, createdAt: Date.now() })
  return id
}

export async function setInspection(v: WerciDB['inspections']['value']) {
  const db = await getDB()
  await db.put('inspections', v)
}

export async function addPhoto(v: WerciDB['photos']['value']) {
  const db = await getDB()
  await db.put('photos', v)
}

export type { WerciDB }

