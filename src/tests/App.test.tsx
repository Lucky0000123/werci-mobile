import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../App'

const { initMock, addListenerMock, minimizeAppMock, removeBackHandlerMock, bootstrapMock, getCurrentUserMock, clearAuthMock } = vi.hoisted(() => ({
  initMock: vi.fn(),
  addListenerMock: vi.fn(),
  minimizeAppMock: vi.fn(),
  removeBackHandlerMock: vi.fn(),
  bootstrapMock: vi.fn(async () => {}),
  getCurrentUserMock: vi.fn(async () => null),
  clearAuthMock: vi.fn(async () => {})
}))

vi.mock('../services/connectionManager', () => ({
  connectionManager: {
    init: initMock,
    getStatus: vi.fn(() => ({ isOnline: false, currentMode: 'offline', cloudAvailable: false, localAvailable: false, lastChecked: 0 })),
    addStatusListener: vi.fn(),
    removeStatusListener: vi.fn()
  }
}))

vi.mock('../services/offlineDataSync', () => ({
  offlineDataSync: {
    addSyncListener: vi.fn(),
    removeSyncListener: vi.fn(),
    startAutoSync: vi.fn(),
    stopAutoSync: vi.fn(),
    getSyncStatus: vi.fn(async () => ({ hasData: false, lastSync: 0, totalRecords: 0 })),
    syncOfflineData: vi.fn(async () => ({ success: true, message: 'mock' }))
  }
}))

vi.mock('../services/sync', () => ({
  syncService: {
    onStatusChange: vi.fn(() => vi.fn())
  }
}))

vi.mock('../services/auth', () => ({
  authService: {
    bootstrap: bootstrapMock,
    getCurrentUser: getCurrentUserMock,
    clearAuth: clearAuthMock
  }
}))

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: addListenerMock,
    minimizeApp: minimizeAppMock
  }
}))

vi.mock('../components/AppHeader', () => ({
  default: () => <div data-testid="app-header">App Header</div>
}))

vi.mock('../components/BottomNavigation', () => ({
  default: () => (
    <nav data-testid="bottom-navigation">
      <span>Home</span>
      <span>Scan QR</span>
      <span>Employee Card</span>
      <span>History</span>
      <span>Settings</span>
    </nav>
  )
}))

vi.mock('../components/ToastContainer', () => ({
  default: () => <div data-testid="toast-container" />
}))

vi.mock('../pages/HomePage', () => ({
  default: () => <div>Mock Home Page</div>
}))

vi.mock('../pages/ScanPage', () => ({
  default: () => <div>Mock Scan Page</div>
}))

vi.mock('../pages/InspectionPage', () => ({
  default: () => <div>Mock Inspection Page</div>
}))

vi.mock('../pages/PhotoUploadPage', () => ({
  default: () => <div>Mock Photo Upload Page</div>
}))

vi.mock('../pages/DeviationReportPage', () => ({
  default: () => <div>Mock Deviation Report Page</div>
}))

vi.mock('../pages/EmployeeCardPage', () => ({
  default: () => <div>Mock Employee Card Page</div>
}))

vi.mock('../pages/EmployeeDetailPage', () => ({
  default: () => <div>Mock Employee Detail Page</div>
}))

vi.mock('../pages/PersonDetailPage', () => ({
  default: () => <div>Mock Person Detail Page</div>
}))

vi.mock('../pages/SettingsPage', () => ({
  default: () => <div>Mock Settings Page</div>
}))

vi.mock('../pages/HistoryPage', () => ({
  default: () => <div>Mock History Page</div>
}))

vi.mock('../pages/LoginPage', () => ({
  default: () => <div>Mock Login Page</div>
}))

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    addListenerMock.mockResolvedValue({ remove: removeBackHandlerMock })
    getCurrentUserMock.mockResolvedValue(null)
  })

  it('shows the PRISM intro screen and initializes app services', async () => {
    render(<App />)

    expect(screen.getByText('PRISM')).toBeInTheDocument()
    await waitFor(() => expect(initMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(bootstrapMock).toHaveBeenCalledTimes(1))
    expect(addListenerMock).toHaveBeenCalledWith('backButton', expect.any(Function))
  })

  it('shows the login screen when no authenticated user session is restored', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Mock Login Page')).toBeInTheDocument()
    }, { timeout: 2000 })

    expect(screen.queryByTestId('app-header')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bottom-navigation')).not.toBeInTheDocument()
  })

  it('renders the protected app shell after the intro delay when a prior login exists', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 7, username: 'restored.user', role: 'inspector' })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Mock Home Page')).toBeInTheDocument()
    }, { timeout: 2000 })

    expect(screen.getByTestId('app-header')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-navigation')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Scan QR')).toBeInTheDocument()
    expect(screen.getByText('Employee Card')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
