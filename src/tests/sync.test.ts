// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

let state: {
  queue: Array<{ id: string; kind: 'inspection' | 'photo'; refId: string; priority: number; retries: number; createdAt: number }>
  inspections: Record<string, any>
  users: Array<{ deviceId: string; token: string; lastSync?: number; isTemporary?: boolean }>
}

let refreshImpl: () => Promise<void>
let mockToken: string | null = null

const apiFetchMock = vi.fn()
const refreshTokenMock = vi.fn(async () => {
  await refreshImpl()
})
const getTokenMock = vi.fn(async () => mockToken)
const getDBMock = vi.fn(async () => ({
  getAll: vi.fn(async (store: string) => {
    if (store === 'syncQueue') return state.queue.map(item => ({ ...item }))
    if (store === 'users') return state.users.map(user => ({ ...user }))
    return []
  }),
  get: vi.fn(async (store: string, key: string) => {
    if (store === 'inspections') {
      return state.inspections[key] ? { ...state.inspections[key] } : undefined
    }
    return undefined
  }),
  put: vi.fn(async (store: string, value: any) => {
    if (store === 'users') {
      const index = state.users.findIndex(user => user.deviceId === value.deviceId)
      if (index >= 0) state.users[index] = { ...value }
      else state.users.push({ ...value })
      return
    }

    if (store === 'inspections') {
      state.inspections[value.id] = { ...value }
      return
    }

    if (store === 'syncQueue') {
      const index = state.queue.findIndex(item => item.id === value.id)
      if (index >= 0) state.queue[index] = { ...value }
      else state.queue.push({ ...value })
    }
  }),
  delete: vi.fn(async (store: string, key: string) => {
    if (store === 'syncQueue') {
      state.queue = state.queue.filter(item => item.id !== key)
    }
  })
}))

vi.mock('../services/db', () => ({
  getDB: getDBMock
}))

vi.mock('../services/api', () => ({
  apiFetch: apiFetchMock
}))

vi.mock('../services/auth', () => ({
  authService: {
    getToken: getTokenMock,
    refreshToken: refreshTokenMock,
    validateToken: vi.fn().mockResolvedValue(true)
  },
  AuthService: {
    getInstance: () => ({
      getToken: getTokenMock,
      refreshToken: refreshTokenMock,
      validateToken: vi.fn().mockResolvedValue(true)
    })
  }
}))

function createInspection(id: string) {
  return {
    id,
    vehicleId: '1',
    vehicleEquipNo: 'EQ-1',
    inspectorName: 'Inspector',
    inspectionDate: '2026-03-07T10:00',
    inspectionType: 'Pre-start',
    status: 'PASS',
    notes: 'All good',
    odometerReading: 120,
    tireCondition: 'good',
    brakeCondition: 'good',
    lightsWorking: 'yes',
    engineCondition: 'good',
    bodyExteriorCondition: 'good',
    bodyInteriorCondition: 'good',
    overallStars: 5,
    createServiceRequest: false,
    pendingSync: true
  }
}

describe('SyncService inspection auth flow', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true)

    state = {
      queue: [],
      inspections: {},
      users: []
    }

    mockToken = null
    refreshImpl = async () => { mockToken = 'real-token' }
  })

  it('bootstraps a real token before posting queued inspections', async () => {
    state.queue = [{ id: 'q1', kind: 'inspection', refId: 'insp-1', priority: 1, retries: 0, createdAt: 1 }]
    state.inspections['insp-1'] = createInspection('insp-1')

    // Default refreshImpl (from beforeEach) sets mockToken = 'real-token'

    apiFetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({ success: true }),
      text: vi.fn().mockResolvedValue('')
    })

    const { SyncService, syncService } = await import('../services/sync')
    syncService.destroy()

    const service = new SyncService()
    await service.startSync()
    service.destroy()

    expect(refreshTokenMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock.mock.calls[0][2]).toMatchObject({ token: 'real-token' })
    expect(state.queue).toHaveLength(0)
    expect(state.inspections['insp-1'].pendingSync).toBe(false)
  })

  it('includes the service-request flag when syncing a queued inspection', async () => {
    state.queue = [{ id: 'q1', kind: 'inspection', refId: 'insp-1', priority: 1, retries: 0, createdAt: 1 }]
    state.inspections['insp-1'] = {
      ...createInspection('insp-1'),
      overallStars: 1,
      createServiceRequest: true
    }

    // Default refreshImpl (from beforeEach) sets mockToken = 'real-token'

    apiFetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: vi.fn().mockResolvedValue({ success: true }),
      text: vi.fn().mockResolvedValue('')
    })

    const { SyncService, syncService } = await import('../services/sync')
    syncService.destroy()

    const service = new SyncService()
    await service.startSync()
    service.destroy()

    const payload = JSON.parse(apiFetchMock.mock.calls[0][1].body)
    expect(payload.create_service_request).toBe(true)
  })

  it('marks inspection sync as failed when auth cannot be resolved and skips the unauthenticated request', async () => {
    state.queue = [{ id: 'q1', kind: 'inspection', refId: 'insp-1', priority: 1, retries: 0, createdAt: 1 }]
    state.inspections['insp-1'] = createInspection('insp-1')

    // Override so refreshToken never produces a token
    refreshImpl = async () => { /* no-op — token stays null */ }

    const { SyncService, syncService } = await import('../services/sync')
    syncService.destroy()

    const service = new SyncService()
    await service.startSync()
    service.destroy()

    expect(refreshTokenMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(state.queue[0].retries).toBe(3)
  })

  it('does not retry queue items that are already marked as failed', async () => {
    state.queue = [{ id: 'q1', kind: 'inspection', refId: 'insp-1', priority: 1, retries: 3, createdAt: 1 }]
    state.inspections['insp-1'] = createInspection('insp-1')

    const { SyncService, syncService } = await import('../services/sync')
    syncService.destroy()

    const service = new SyncService()
    await service.startSync()
    service.destroy()

    expect(refreshTokenMock).not.toHaveBeenCalled()
    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(state.queue[0].retries).toBe(3)
  })
})