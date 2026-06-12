import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}))

vi.mock('../services/api', () => ({
  apiFetch: apiFetchMock,
}))

vi.mock('../services/directSqlServer', () => ({
  directSQLServerService: {
    isOnCompanyNetwork: vi.fn().mockResolvedValue(false),
    getVehiclesComplete: vi.fn(),
    getPeopleComplete: vi.fn(),
  },
}))

function makeMemoryStores() {
  return {
    vehicles: new Map(), kimperCodes: new Map(), employees: new Map(),
    employeeCards: new Map(), people: new Map(), syncMetadata: new Map(), qrCache: new Map(),
  }
}

async function freshService() {
  vi.resetModules()
  const mod = await import('../services/offlineDataSync')
  const service = mod.offlineDataSync as any
  service.db = null
  service.memoryMode = true
  service.memoryStores = makeMemoryStores()
  service.initialize = vi.fn().mockResolvedValue(null)
  return service
}

const trainingSummary = { total: 6, valid: 5, expired: 1, not_yet: 0, mandatory_total: 6, mandatory_valid: 5, expiring: 1 }

describe('offlineDataSync QR cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('caches person-card payloads by every lookup key and cross-populates employee cards', async () => {
    const service = await freshService()
    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({
      success: true,
      person: { person_key: 'EMP:1200072', employee_id: '1200072', kimper_id: 11463, ktp_number: 'KTP-001' },
      employee: { id: 1, employee_id: '1200072', name: 'Rahul', ktp_number: 'KTP-001' },
      kimper: { kimper_id: 11463, status: 'Active', authorized_units: 'DT 4159, DT 4160', authorized_unit_codes: 'F, F' },
      training_summary: trainingSummary,
      training_categories: [],
      mandatory_trainings: [],
      extra_trainings: [],
      violations: [],
      verified_at: '2026-06-07T00:00:00Z',
    }) })

    await service.fetchPersonCardData({ personKey: 'EMP:1200072', employeeId: '1200072', kimperId: 11463, ktpNumber: 'KTP-001' })

    expect([...service.memoryStores.qrCache.keys()].sort()).toEqual([
      'card:emp:1200072', 'card:kim:11463', 'card:ktp:KTP-001', 'card:pk:EMP:1200072'
    ])
    expect(service.memoryStores.employeeCards.get('1200072').kimper.authorized_units).toEqual(['DT 4159', 'DT 4160'])
    expect(service.memoryStores.employeeCards.get('1200072').kimper.authorized_unit_codes).toEqual(['F', 'F'])
  })

  it('rebuilds a person card from cached employee-card data with flattened unit strings', async () => {
    const service = await freshService()
    service.getQrCache = vi.fn().mockResolvedValue(null)
    service.lookupPersonByEmployeeId = vi.fn().mockResolvedValue(null)
    service.getEmployeeCardDataOffline = vi.fn().mockResolvedValue({
      success: true,
      employee: { id: 1, employee_id: '1200072', name: 'Rahul', position: 'Operator', ktp_number: 'KTP-001' },
      kimper: { kimper_id: 11463, status: 'Active', authorized_units: ['DT 4159', 'DT 4160'], authorized_unit_codes: ['F', 'F'] },
      training_summary: trainingSummary,
      training_categories: [],
      mandatory_trainings: [],
      extra_trainings: [],
      violations: [],
      verified_at: '2026-06-07T00:00:00Z',
    })
    service.getLastSyncTime = vi.fn().mockResolvedValue(1710000000000)

    const result = await service.lookupPersonCardOffline('1200072')

    expect(result?.source).toBe('employeeCards')
    expect(result?.card.kimper?.authorized_units).toBe('DT 4159, DT 4160')
    expect(result?.card.kimper?.authorized_unit_codes).toBe('F, F')
    expect(result?.card.kimper?.units).toEqual(['DT 4159', 'DT 4160'])
    expect(result?.card._offline?.cachedAt).toBe(1710000000000)
  })

  it('serves the saved employee-card payload when the network fails later', async () => {
    const service = await freshService()
    const employeeCard = {
      success: true,
      employee: { id: 1, employee_id: '1200072', name: 'Rahul', ktp_number: 'KTP-001' },
      kimper: { kimper_id: 11463, status: 'Active', authorized_units: ['DT 4159'], authorized_unit_codes: ['F'] },
      training_summary: trainingSummary,
      training_categories: [],
      mandatory_trainings: [],
      extra_trainings: [],
      violations: [],
      verified_at: '2026-06-07T00:00:00Z',
    }
    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => employeeCard })
    apiFetchMock.mockRejectedValueOnce(new Error('offline'))

    await service.fetchEmployeeCardData('1200072', 'token-1')
    const fallback = await service.fetchEmployeeCardData('1200072', 'token-1')

    expect(service.memoryStores.qrCache.has('card:emp:1200072')).toBe(true)
    expect(service.memoryStores.qrCache.has('card:ktp:KTP-001')).toBe(true)
    expect(fallback?.employee.employee_id).toBe('1200072')
    expect(fallback?._offline?.cachedAt).toEqual(expect.any(Number))
  })
})