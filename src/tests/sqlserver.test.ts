// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
const getTokenMock = vi.fn(async () => 'real-token')
const refreshTokenMock = vi.fn(async () => {})

vi.mock('../services/api', () => ({
  apiFetch: apiFetchMock
}))

vi.mock('../services/auth', () => ({
  AuthService: {
    getInstance: () => ({
      getToken: getTokenMock,
      refreshToken: refreshTokenMock
    })
  }
}))

describe('SQLServerService createInspection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getTokenMock.mockResolvedValue('real-token')
  })

  it('sends the service-request flag for direct mobile inspection submits', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({ success: true, data: { inspection_id: 321 } }),
        text: vi.fn().mockResolvedValue('')
      })

    const { sqlServerService } = await import('../services/sqlserver')

    const inspectionId = await sqlServerService.createInspection({
      vehicle_equip_no: 'EQ-321',
      create_service_request: true,
      inspection_date: '2026-03-07',
      inspector_name: 'Mobile QA',
      inspection_type: 'Mobile Vehicle Inspection',
      status: 'FAILED',
      notes: 'Needs service',
      tire_condition: 'poor',
      brake_condition: 'poor',
      lights_working: false,
      engine_condition: 'poor',
      body_condition: 'poor',
      interior_condition: 'poor',
      star_rating: 1
    })

    expect(inspectionId).toBe(321)
    const payload = JSON.parse(apiFetchMock.mock.calls[1][1].body)
    expect(payload.create_service_request).toBe(true)
  })

  it('fails clearly when no authenticated session is available', async () => {
    getTokenMock.mockResolvedValue(null)

    const { sqlServerService } = await import('../services/sqlserver')

    await expect(sqlServerService.createInspection({
      vehicle_equip_no: 'EQ-404',
      inspection_date: '2026-03-07',
      inspector_name: 'Mobile QA',
      inspection_type: 'Mobile Vehicle Inspection',
      status: 'FAILED',
      tire_condition: 'poor',
      brake_condition: 'poor',
      lights_working: false,
      engine_condition: 'poor',
      body_condition: 'poor',
      interior_condition: 'poor',
      star_rating: 1
    })).rejects.toThrow('LOGIN_REQUIRED')

    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })
})