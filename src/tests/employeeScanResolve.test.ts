import { describe, expect, it, vi } from 'vitest'

import { resolveEmployeeScanTarget } from '../utils/employeeScanResolve'

describe('resolveEmployeeScanTarget', () => {
  it('prefers unified person detail data before employee card detail', async () => {
    const fetchEmployeeCardData = vi.fn().mockResolvedValue({
      success: true,
      employee: { employee_id: '99980616', name: 'Pierre', status: 'Active' },
    })
    const lookupEmployeeById = vi.fn().mockResolvedValue(null)
    const fetchPersonCardData = vi.fn().mockResolvedValue({
      success: true,
      person: { employee_id: '99980616', name: 'Pierre' },
      employee: { employee_id: '99980616', name: 'Pierre' },
    })

    const result = await resolveEmployeeScanTarget({
      employeeId: '99980616',
      token: 'abc123',
      personKey: 'EMP:99980616',
      fetchEmployeeCardData,
      lookupEmployeeById,
      fetchPersonCardData,
    })

    expect(result.kind).toBe('person-detail')
    expect(fetchPersonCardData).toHaveBeenCalledWith({ personKey: 'EMP:99980616', employeeId: '99980616' })
    expect(fetchEmployeeCardData).not.toHaveBeenCalled()
    expect(lookupEmployeeById).not.toHaveBeenCalled()
  })

  it('serves a rich offline card before making any network call', async () => {
    const fetchPersonCardData = vi.fn().mockResolvedValue(null)
    const fetchEmployeeCardData = vi.fn().mockResolvedValue(null)
    const lookupEmployeeById = vi.fn().mockResolvedValue(null)
    const lookupPersonCardOffline = vi.fn().mockResolvedValue({
      card: {
        success: true,
        person: { employee_id: '1', name: 'Budi' },
        employee: { employee_id: '1', name: 'Budi' },
        _offline: { cachedAt: 1 },
      },
      source: 'people',
    })

    const result = await resolveEmployeeScanTarget({
      employeeId: '1',
      fetchEmployeeCardData,
      lookupEmployeeById,
      fetchPersonCardData,
      lookupPersonCardOffline,
    })

    expect(result.kind).toBe('person-detail')
    expect(lookupPersonCardOffline).toHaveBeenCalledTimes(1)
    expect(fetchPersonCardData).not.toHaveBeenCalled()
    expect(fetchEmployeeCardData).not.toHaveBeenCalled()
  })

  it('skips a thin employees-only offline card and prefers the network', async () => {
    const fetchPersonCardData = vi.fn().mockResolvedValue({
      success: true,
      person: { employee_id: '1', name: 'Budi (live)' },
      employee: { employee_id: '1', name: 'Budi (live)' },
    })
    const fetchEmployeeCardData = vi.fn().mockResolvedValue(null)
    const lookupEmployeeById = vi.fn().mockResolvedValue(null)
    const lookupPersonCardOffline = vi.fn().mockResolvedValue({
      card: {
        success: true,
        person: { employee_id: '1' },
        employee: { employee_id: '1' },
        _partial: true,
      },
      source: 'employees',
    })

    const result = await resolveEmployeeScanTarget({
      employeeId: '1',
      fetchEmployeeCardData,
      lookupEmployeeById,
      fetchPersonCardData,
      lookupPersonCardOffline,
    })

    expect(result.kind).toBe('person-detail')
    expect(lookupPersonCardOffline).toHaveBeenCalledTimes(1)
    expect(fetchPersonCardData).toHaveBeenCalledTimes(1)
    if (result.kind === 'person-detail') {
      expect(result.personData.person.name).toBe('Budi (live)')
    }
  })

  it('falls back to the thin offline card when the network is unavailable', async () => {
    const fetchPersonCardData = vi.fn().mockResolvedValue(null)
    const fetchEmployeeCardData = vi.fn().mockResolvedValue(null)
    const lookupEmployeeById = vi.fn().mockResolvedValue(null)
    const lookupPersonCardOffline = vi.fn().mockResolvedValue({
      card: {
        success: true,
        person: { employee_id: '1', name: 'Budi (cached)' },
        employee: { employee_id: '1', name: 'Budi (cached)' },
        _partial: true,
      },
      source: 'employees',
    })

    const result = await resolveEmployeeScanTarget({
      employeeId: '1',
      fetchEmployeeCardData,
      lookupEmployeeById,
      fetchPersonCardData,
      lookupPersonCardOffline,
    })

    expect(result.kind).toBe('person-detail')
    expect(fetchPersonCardData).toHaveBeenCalledTimes(1)
    expect(fetchEmployeeCardData).toHaveBeenCalledTimes(1)
    if (result.kind === 'person-detail') {
      expect(result.personData.person.name).toBe('Budi (cached)')
    }
  })

  it('falls back to employee card detail when person data is unavailable', async () => {
    const fetchEmployeeCardData = vi.fn().mockResolvedValue({
      success: true,
      employee: { employee_id: '99980616', name: 'Pierre', status: 'Active' },
    })
    const lookupEmployeeById = vi.fn().mockResolvedValue(null)
    const fetchPersonCardData = vi.fn().mockResolvedValue(null)

    const result = await resolveEmployeeScanTarget({
      employeeId: '99980616',
      token: 'abc123',
      fetchEmployeeCardData,
      lookupEmployeeById,
      fetchPersonCardData,
    })

    expect(result.kind).toBe('employee-detail-card')
    expect(fetchPersonCardData).toHaveBeenCalledTimes(1)
    expect(fetchEmployeeCardData).toHaveBeenCalledWith('99980616', 'abc123')
    expect(lookupEmployeeById).not.toHaveBeenCalled()
  })
})