import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'

// Mock the services
vi.mock('../services/connectionManager', () => ({
  connectionManager: {
    initialize: vi.fn(),
    getCurrentEndpoint: vi.fn(() => 'http://localhost:8082'),
    isConnected: vi.fn(() => true)
  }
}))

vi.mock('../services/offlineDataSync', () => ({
  offlineDataSync: {
    initialize: vi.fn(),
    syncData: vi.fn()
  }
}))

vi.mock('../services/sync', () => ({
  syncService: {
    initialize: vi.fn()
  }
}))

describe('App Component', () => {
  it('renders WERCI Inspector title', () => {
    render(<App />)
    expect(screen.getByText('WERCI Inspector')).toBeInTheDocument()
  })

  it('renders main navigation buttons', () => {
    render(<App />)
    expect(screen.getByText('QR Scan')).toBeInTheDocument()
    expect(screen.getByText('My Inspections')).toBeInTheDocument()
    expect(screen.getByText('Sync Data')).toBeInTheDocument()
  })

  it('does not render testing panel in production', () => {
    // Mock production environment
    vi.stubEnv('DEV', false)
    render(<App />)
    expect(screen.queryByTestId('testing-panel')).not.toBeInTheDocument()
  })
})
