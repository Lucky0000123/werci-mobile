import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from '../pages/HomePage'

const {
  getSyncStatusMock,
  addSyncListenerMock,
  removeSyncListenerMock,
  getTokenMock,
  apiFetchMock
} = vi.hoisted(() => ({
  getSyncStatusMock: vi.fn(),
  addSyncListenerMock: vi.fn(),
  removeSyncListenerMock: vi.fn(),
  getTokenMock: vi.fn(),
  apiFetchMock: vi.fn()
}))

vi.mock('../services/i18n-context', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      dashboardTitle: 'Employee Cards',
      dashboardSubtitle: 'Overview of your workforce QR activity',
      employees: 'Employees',
      deviations: 'Deviations',
      lastSynced: 'Last synced',
      notSyncedYet: 'Not synced yet. Tap sync button below.',
      refresh: 'Refresh'
    }[key] || key)
  })
}))

vi.mock('../services/offlineDataSync', () => ({
  offlineDataSync: {
    getSyncStatus: getSyncStatusMock,
    addSyncListener: addSyncListenerMock,
    removeSyncListener: removeSyncListenerMock,
    isInMemoryMode: () => false
  }
}))

vi.mock('../services/auth', () => ({
  authService: {
    getToken: getTokenMock
  }
}))

vi.mock('../services/api', () => ({
  apiFetch: apiFetchMock
}))

describe('HomePage personal KPI dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSyncStatusMock.mockResolvedValue({ lastSync: 1710000000000, vehiclesCount: 27, kimperCount: 9, employeesCount: 13 })
    getTokenMock.mockResolvedValue('real-token')
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        data: {
          vehicles_scanned: 5,
          employee_cards_scanned: 7,
          inspections_performed: 3,
          deviations_found: 1
        }
      })
    })
  })

  it('renders real KPI totals and sync overview from the backend', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('Employee Cards')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())

    // Employee-focused KPI grid: only Employees and Deviations tiles remain.
    // 'Employees' also appears in the offline-sync overview, so use getAllByText.
    expect(screen.getAllByText('Employees').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Deviations')).toBeInTheDocument()
    // Vehicles and Inspections tiles are gone from the KPI grid.
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument()
    expect(screen.queryByText('Inspections')).not.toBeInTheDocument()
    // The offline-data card no longer shows a vehicles placeholder at all —
    // only KIMPER (9) and Employees (13) counts remain.
    expect(screen.queryByText('27')).not.toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/api/mobile/kpi/summary', { method: 'GET' }, { token: 'real-token' })
  })

  it('shows an error banner when the KPI request fails', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false, json: vi.fn().mockResolvedValue({ message: 'Dashboard unavailable' }) })

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Dashboard unavailable'))
  })
})