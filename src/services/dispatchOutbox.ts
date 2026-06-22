// Offline Dispatch Action Outbox
// ────────────────────────────────────────────────────────────────────────────
// Trucks drive into mine areas with no cell coverage. Every in-cab driver/
// operator action (cycle advance, first-bucket, manual status, connect,
// disconnect) is captured here the instant it's tapped and replayed in order
// when signal returns, so nothing the driver does is lost offline.
//
// Mirrors the existing outbox pattern (commissioningStorage.ts / deviationStorage
// .ts) — one IndexedDB database with a `pendingDispatch` store — and is drained
// by backgroundSync.flushAllPending() exactly like syncPendingCommissioning().
//
// Idempotency + ordering guarantees (must match the server, see
// docs/offline-cab/02_action_outbox.md):
//   • Each action carries a client_event_id (UUID) minted at tap time. The
//     server dedups replays against PRISM_DISPATCH_CLIENT_EVENTS and returns the
//     ORIGINAL response, so a replay never creates a duplicate pairing /
//     load-event / zone-event / status row.
//   • Each action carries client_ts (device tap time) so the server records the
//     real event time, not the replay time.
//   • Replay is PER-SCOPE FIFO: all actions for one truck (scopeKey = truck_no)
//     replay in clientSeq order; if action N fails the scope STOPS (action N+1
//     must never land before N). Other scopes drain independently.
//   • cycle-advance is forward-only on the server: a stale queued advance that
//     is behind the truck's GPS-advanced state returns 409 {stale:true}; we
//     treat that as reconciled (dequeue), not an error.

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

export type DispatchActionKind =
  | 'loading_start'      // POST /api/dispatch/loading/start
  | 'cycle_advance'      // POST /api/dispatch/cycle-advance
  | 'finish_dumping'     // POST /api/dispatch/finish-dumping
  | 'equipment_status'   // POST /api/dispatch/equipment-status
  | 'connect_truck'      // POST /api/dispatch/connect-truck
  | 'connect_excavator'  // POST /api/dispatch/connect-excavator
  | 'disconnect'         // POST /api/dispatch/disconnect

export interface PendingDispatchAction {
  _localId: number          // keyPath, autoIncrement — IDB insertion order
  clientEventId: string     // server dedup key (crypto.randomUUID)
  kind: DispatchActionKind
  endpoint: string          // resolved path, e.g. '/api/dispatch/cycle-advance'
  scopeKey: string          // per-scope FIFO key: truck_no | unit_no | employee_id
  clientSeq: number         // monotonic per scopeKey on THIS device
  payload: Record<string, unknown>  // exact JSON body (already includes client_event_id/client_ts)
  clientTs: number          // Date.now() at tap
  attempts: number
  lastError?: string
  // For optimistic UI + conflict messaging:
  expectedState?: string    // cycle_advance: act.next ; loading_start: 'loading'
  createdAt: number
}

interface DispatchOutboxDB extends DBSchema {
  pendingDispatch: {
    key: number
    value: PendingDispatchAction
    indexes: { 'by-scope': string; 'by-created': number }
  }
}

const DB_NAME = 'PRISMDispatchOutboxDB'
const DB_VERSION = 1
// Drop an action after this many failed replay attempts so a permanently-bad
// row (e.g. a 400 from a since-deleted plan) can't wedge its scope forever.
export const MAX_DISPATCH_ATTEMPTS = 8

let dbPromise: Promise<IDBPDatabase<DispatchOutboxDB>> | null = null

function getDB(): Promise<IDBPDatabase<DispatchOutboxDB>> {
  if (dbPromise) return dbPromise
  dbPromise = openDB<DispatchOutboxDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('pendingDispatch')) {
        const store = db.createObjectStore('pendingDispatch', {
          keyPath: '_localId',
          autoIncrement: true,
        })
        store.createIndex('by-scope', 'scopeKey')
        store.createIndex('by-created', 'createdAt')
      }
    },
  })
  return dbPromise
}

// Per-scope monotonic sequence, persisted in localStorage so it survives an IDB
// wipe (mirrors sync.ts's lastSync trick). Guarantees intra-device FIFO ordering.
function nextSeq(scopeKey: string): number {
  const key = `dispatch_seq_${scopeKey}`
  let n = 0
  try {
    n = parseInt(localStorage.getItem(key) || '0', 10) || 0
  } catch { /* localStorage unavailable */ }
  n += 1
  try { localStorage.setItem(key, String(n)) } catch { /* ignore */ }
  return n
}

/** Mint a UUID, falling back when crypto.randomUUID is unavailable (old WebView). */
export function newClientEventId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return 'cev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export class DispatchOutbox {
  /**
   * Queue an action for replay. Returns the stored row (with the minted
   * clientEventId/clientSeq) so the caller can show "queued" UI.
   * The payload is augmented with client_event_id + client_ts in-place.
   */
  static async enqueue(args: {
    kind: DispatchActionKind
    endpoint: string
    scopeKey: string
    payload: Record<string, unknown>
    clientEventId?: string
    clientTs?: number
    expectedState?: string
  }): Promise<PendingDispatchAction> {
    const db = await getDB()
    const clientTs = args.clientTs ?? Date.now()
    const clientEventId = args.clientEventId ?? newClientEventId()
    const row: Omit<PendingDispatchAction, '_localId'> = {
      clientEventId,
      kind: args.kind,
      endpoint: args.endpoint,
      scopeKey: args.scopeKey,
      clientSeq: nextSeq(args.scopeKey),
      payload: { ...args.payload, client_event_id: clientEventId, client_ts: clientTs },
      clientTs,
      attempts: 0,
      expectedState: args.expectedState,
      createdAt: Date.now(),
    }
    const localId = await db.add('pendingDispatch', row as PendingDispatchAction)
    console.log(`📦 Dispatch action queued: ${args.kind} scope=${args.scopeKey} seq=${row.clientSeq} local=${localId}`)
    return { ...(row as PendingDispatchAction), _localId: localId as number }
  }

  /** All pending actions, sorted by scope then clientSeq then insertion order. */
  static async getPending(): Promise<PendingDispatchAction[]> {
    const db = await getDB()
    const all = await db.getAll('pendingDispatch')
    return all.sort((a, b) => {
      if (a.scopeKey !== b.scopeKey) return a.scopeKey < b.scopeKey ? -1 : 1
      if (a.clientSeq !== b.clientSeq) return a.clientSeq - b.clientSeq
      return a._localId - b._localId
    })
  }

  static async getPendingByScope(scopeKey: string): Promise<PendingDispatchAction[]> {
    const db = await getDB()
    const rows = await db.getAllFromIndex('pendingDispatch', 'by-scope', scopeKey)
    return rows.sort((a, b) => a.clientSeq - b.clientSeq || a._localId - b._localId)
  }

  static async getPendingCount(): Promise<number> {
    try {
      const db = await getDB()
      return db.count('pendingDispatch')
    } catch {
      return 0
    }
  }

  static async getPendingCountByScope(scopeKey: string): Promise<number> {
    try {
      const db = await getDB()
      return db.countFromIndex('pendingDispatch', 'by-scope', scopeKey)
    } catch {
      return 0
    }
  }

  static async removePending(localId: number): Promise<void> {
    const db = await getDB()
    await db.delete('pendingDispatch', localId)
  }

  static async recordAttempt(localId: number, error?: string): Promise<number> {
    const db = await getDB()
    const tx = db.transaction('pendingDispatch', 'readwrite')
    const existing = await tx.store.get(localId)
    let attempts = 0
    if (existing) {
      existing.attempts = (existing.attempts || 0) + 1
      existing.lastError = error
      attempts = existing.attempts
      await tx.store.put(existing)
    }
    await tx.done
    return attempts
  }

  static async clearAll(): Promise<void> {
    const db = await getDB()
    await db.clear('pendingDispatch')
  }
}

export default DispatchOutbox
