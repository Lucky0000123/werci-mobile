// @vitest-environment jsdom
//
// Offline dispatch outbox: submit-decision matrix + per-scope FIFO replay.
// idb is mocked with an in-memory store so no real IndexedDB is needed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── In-memory IDB stand-in ──────────────────────────────────────────────────
interface Row { _localId: number; scopeKey: string; clientSeq: number; [k: string]: any }
let rows: Row[] = []
let autoId = 1

const fakeDB = {
  add: vi.fn(async (_store: string, value: Row) => {
    const _localId = autoId++
    rows.push({ ...value, _localId })
    return _localId
  }),
  getAll: vi.fn(async () => rows.map(r => ({ ...r }))),
  getAllFromIndex: vi.fn(async (_store: string, _idx: string, key: string) =>
    rows.filter(r => r.scopeKey === key).map(r => ({ ...r }))),
  count: vi.fn(async () => rows.length),
  countFromIndex: vi.fn(async (_store: string, _idx: string, key: string) =>
    rows.filter(r => r.scopeKey === key).length),
  delete: vi.fn(async (_store: string, id: number) => { rows = rows.filter(r => r._localId !== id) }),
  transaction: vi.fn((_store: string, _mode: string) => {
    const store = {
      get: async (id: number) => rows.find(r => r._localId === id),
      put: async (val: Row) => { rows = rows.map(r => r._localId === val._localId ? { ...val } : r) },
    }
    return { store, done: Promise.resolve() }
  }),
  clear: vi.fn(async () => { rows = [] }),
  objectStoreNames: { contains: () => true },
}

vi.mock('idb', () => ({
  openDB: vi.fn(async () => fakeDB),
}))

let online = true
vi.mock('../services/connectionManager', () => ({
  default: { getStatus: () => ({ isOnline: online }) },
  connectionManager: { getStatus: () => ({ isOnline: online }) },
}))

const apiFetchMock = vi.fn()
vi.mock('../services/api', () => ({ apiFetch: (...a: any[]) => apiFetchMock(...a) }))

vi.mock('../services/auth', () => ({
  authService: { getToken: vi.fn(async () => 'tok-123') },
}))

// Avoid pulling the heavy native plugins from backgroundSync's other imports.
vi.mock('@transistorsoft/capacitor-background-fetch', () => ({ BackgroundFetch: { configure: vi.fn(), finish: vi.fn(), STATUS_AVAILABLE: 2 } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { requestPermissions: vi.fn(async () => ({ display: 'denied' })), schedule: vi.fn() } }))

function jsonResponse(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as any
}

async function freshModules() {
  vi.resetModules()
  const outbox = await import('../services/dispatchOutbox')
  const bg = await import('../services/backgroundSync')
  return { outbox, bg }
}

describe('dispatchOutbox + submitDispatchAction', () => {
  beforeEach(() => {
    rows = []; autoId = 1; online = true
    apiFetchMock.mockReset()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('mints unique client event ids', async () => {
    const { outbox } = await freshModules()
    const ids = new Set(Array.from({ length: 200 }, () => outbox.newClientEventId()))
    expect(ids.size).toBe(200)
  })

  it('applies immediately when online and server says success', async () => {
    const { bg } = await freshModules()
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, new_status: 'fullWB' }))
    const res = await bg.submitDispatchAction({
      kind: 'cycle_advance', endpoint: '/api/dispatch/cycle-advance',
      scopeKey: 'DT01', payload: { plan_id: 1, truck_no: 'DT01', status: 'fullWB' },
    })
    expect(res).toMatchObject({ ok: true, applied: true })
    expect(rows.length).toBe(0)           // nothing queued
    // body carried client_event_id + client_ts
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body)
    expect(body.client_event_id).toBeTruthy()
    expect(typeof body.client_ts).toBe('number')
  })

  it('queues when offline and applies optimistic state', async () => {
    const { bg, outbox } = await freshModules()
    online = false
    const res = await bg.submitDispatchAction({
      kind: 'cycle_advance', endpoint: '/api/dispatch/cycle-advance',
      scopeKey: 'DT01', payload: { plan_id: 1, truck_no: 'DT01', status: 'fullWB' },
    })
    expect(res).toMatchObject({ ok: true, applied: false, queued: true })
    expect(apiFetchMock).not.toHaveBeenCalled()
    const pending = await outbox.DispatchOutbox.getPending()
    expect(pending.length).toBe(1)
    expect(pending[0].payload.client_event_id).toBeTruthy()
  })

  it('queues when online but the network throws', async () => {
    const { bg, outbox } = await freshModules()
    apiFetchMock.mockRejectedValueOnce(new Error('network down'))
    const res = await bg.submitDispatchAction({
      kind: 'equipment_status', endpoint: '/api/dispatch/equipment-status',
      scopeKey: 'DT01', payload: { unit_no: 'DT01', status: 'delay' },
    })
    expect(res).toMatchObject({ ok: true, queued: true })
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(1)
  })

  it('surfaces a hard rejection (403) without queuing', async () => {
    const { bg, outbox } = await freshModules()
    apiFetchMock.mockResolvedValueOnce(jsonResponse(403, { success: false, message: 'not authorized' }))
    const res = await bg.submitDispatchAction({
      kind: 'connect_truck', endpoint: '/api/dispatch/connect-truck',
      scopeKey: 'E001', payload: { employee_id: 'E001', unit_no: 'DT01' },
    })
    expect(res.ok).toBe(false)
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(0)
  })

  it('treats a 409 stale as applied (reconciled), not queued', async () => {
    const { bg, outbox } = await freshModules()
    apiFetchMock.mockResolvedValueOnce(jsonResponse(409, { success: false, stale: true, current_state: 'dumping' }))
    const res = await bg.submitDispatchAction({
      kind: 'cycle_advance', endpoint: '/api/dispatch/cycle-advance',
      scopeKey: 'DT01', payload: { plan_id: 1, truck_no: 'DT01', status: 'fullWB' },
    })
    expect(res).toMatchObject({ ok: true, applied: true })
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(0)
  })

  it('replays queued actions in per-scope FIFO order on reconnect', async () => {
    const { bg, outbox } = await freshModules()
    online = false
    // Queue three advances for DT01 in order
    for (const s of ['fullWB', 'fullTravel2', 'sampling']) {
      await bg.submitDispatchAction({
        kind: 'cycle_advance', endpoint: '/api/dispatch/cycle-advance',
        scopeKey: 'DT01', payload: { plan_id: 1, truck_no: 'DT01', status: s },
      })
    }
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(3)

    // Reconnect → all succeed
    online = true
    apiFetchMock.mockResolvedValue(jsonResponse(200, { success: true }))
    await bg.syncPendingDispatch()

    // Drained, and the server saw them in seq order
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(0)
    const sentStatuses = apiFetchMock.mock.calls.map(c => JSON.parse(c[1].body).status)
    expect(sentStatuses).toEqual(['fullWB', 'fullTravel2', 'sampling'])
  })

  it('STOPS a scope on a transient failure to preserve FIFO', async () => {
    const { bg, outbox } = await freshModules()
    online = false
    for (const s of ['fullWB', 'fullTravel2']) {
      await bg.submitDispatchAction({
        kind: 'cycle_advance', endpoint: '/api/dispatch/cycle-advance',
        scopeKey: 'DT01', payload: { plan_id: 1, truck_no: 'DT01', status: s },
      })
    }
    online = true
    // First replay 500s → scope stops; second action must NOT be attempted.
    apiFetchMock.mockResolvedValueOnce(jsonResponse(500, { success: false }))
    await bg.syncPendingDispatch()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)            // stopped after the failure
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(2)  // both still pending
  })

  it('drops a stale (409) action during replay and continues the scope', async () => {
    const { bg, outbox } = await freshModules()
    online = false
    for (const s of ['fullWB', 'fullTravel2']) {
      await bg.submitDispatchAction({
        kind: 'cycle_advance', endpoint: '/api/dispatch/cycle-advance',
        scopeKey: 'DT01', payload: { plan_id: 1, truck_no: 'DT01', status: s },
      })
    }
    online = true
    apiFetchMock
      .mockResolvedValueOnce(jsonResponse(409, { success: false, stale: true }))  // fullWB obsolete
      .mockResolvedValueOnce(jsonResponse(200, { success: true }))                // fullTravel2 applies
    await bg.syncPendingDispatch()
    expect(apiFetchMock).toHaveBeenCalledTimes(2)
    expect(await outbox.DispatchOutbox.getPendingCount()).toBe(0)
  })
})
