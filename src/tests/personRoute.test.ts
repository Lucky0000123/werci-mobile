import { describe, expect, it } from 'vitest'
import { buildPersonDetailPath, getPersonLookupFromCardData } from '../utils/personRoute'
import type { PersonCardData } from '../services/offlineDataSync'

describe('personRoute helpers', () => {
  it('builds a refresh-safe person detail path from available lookup fields', () => {
    const path = buildPersonDetailPath({
      personKey: 'person-123',
      employeeId: 'EMP-9',
      kimperId: 77,
      ktpNumber: '32010001',
    })

    expect(path).toBe('/person-detail?person_key=person-123&employee_id=EMP-9&kimper_id=77&ktp_number=32010001')
    expect(buildPersonDetailPath({})).toBe('/person-detail')
  })

  it('extracts lookup values from unified card data with safe fallbacks', () => {
    const cardData: PersonCardData = {
      success: true,
      person: {
        person_key: 'person-abc',
        employee_id: 'EMP-1',
      },
      employee: {
        employee_id: 'EMP-fallback',
        name: 'Alex Worker',
        ktp_number: 'KTP-22',
      },
      kimper: {
        kimper_id: 42,
      },
      training_summary: {
        total: 0,
        valid: 0,
        expired: 0,
        not_yet: 0,
        mandatory_total: 0,
        mandatory_valid: 0,
        expiring: 0,
      },
      training_categories: [],
      violations: [],
      verified_at: '2026-03-09T00:00:00Z',
    }

    expect(getPersonLookupFromCardData(cardData)).toEqual({
      personKey: 'person-abc',
      employeeId: 'EMP-1',
      kimperId: 42,
      ktpNumber: 'KTP-22',
    })

    expect(getPersonLookupFromCardData(null)).toEqual({
      personKey: undefined,
      employeeId: undefined,
      kimperId: undefined,
      ktpNumber: undefined,
    })
  })
})