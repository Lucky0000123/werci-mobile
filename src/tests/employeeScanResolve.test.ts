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