import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeviationApiService from '../services/deviationApi'

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}))

vi.mock('../services/api', () => ({
  apiFetch: apiFetchMock,
}))

vi.mock('../services/auth', () => ({
  authService: {
    getToken: vi.fn().mockResolvedValue('test-jwt-token')
  },
  AuthService: {
    getInstance: () => ({
      getToken: vi.fn().mockResolvedValue('test-jwt-token'),
      refreshToken: vi.fn().mockResolvedValue(undefined)
    })
  }
}))

describe('DeviationApiService.submitDeviation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success', deviation_id: 987 }),
    })
  })

  it('includes unified person identity fields in the submitted FormData', async () => {
    const photo = new File(['demo'], 'evidence.jpg', { type: 'image/jpeg' })

    const deviationId = await DeviationApiService.submitDeviation({
      kimper_id: 11463,
      person_key: 'EMP:1200072',
      employee_id: '1200072',
      ktp_number: 'KTP-001',
      person_involved_name: 'BENNY AJI SASMITO',
      person_involved_id: '1200072',
      deviation_date: '2026-03-09T15:43',
      shift: 'Day',
      location: 'DEV SMOKE TEST - Universal Person Flow',
      activity: 'Live verification',
      deviation_description: 'TEST ONLY',
      status: 'Open',
      reported_by: 'Augment Agent Smoke Test',
      reporter_department: 'Engineering',
      contractor_name: 'TEST ENTRY',
      pic_name: 'Augment Agent',
      photos: [photo],
      language: 'en',
    })

    expect(deviationId).toBe(987)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)

    const [path, init] = apiFetchMock.mock.calls[0]
    expect(path).toBe('/deviations/submit')
    expect(init.method).toBe('POST')

    const body = init.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('kimper_id')).toBe('11463')
    expect(body.get('person_key')).toBe('EMP:1200072')
    expect(body.get('employee_id')).toBe('1200072')
    expect(body.get('ktp_number')).toBe('KTP-001')
    expect(body.get('person_involved_name')).toBe('BENNY AJI SASMITO')
    expect(body.get('reported_by')).toBe('Augment Agent Smoke Test')
    expect(body.getAll('photos')).toHaveLength(1)
  })

  it('builds the person history query from unified lookup fields', async () => {
    apiFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        deviations: [{ id: 3, location: 'Pit A', description: 'Unsafe step', status: 'Open', deviation_date: '2026-03-09T15:43:00' }],
      }),
    })

    const deviations = await DeviationApiService.getDeviationsByPerson({
      personKey: 'EMP:1200072',
      employeeId: '1200072',
      kimperId: 11463,
      ktpNumber: 'KTP-001',
    })

    expect(deviations).toHaveLength(1)
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/deviations/api/by_person?person_key=EMP%3A1200072&employee_id=1200072&kimper_id=11463&ktp_number=KTP-001'
    )
  })
})