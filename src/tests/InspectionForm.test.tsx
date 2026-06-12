// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import InspectionForm from '../features/inspect/InspectionForm'

const {
  createInspectionMock,
  uploadPhotoMock,
  setInspectionMock,
  addPhotoMock,
  enqueueMock
} = vi.hoisted(() => ({
  createInspectionMock: vi.fn(),
  uploadPhotoMock: vi.fn(),
  setInspectionMock: vi.fn(),
  addPhotoMock: vi.fn(),
  enqueueMock: vi.fn()
}))

vi.mock('@capacitor/camera', () => ({
  Camera: { requestPermissions: vi.fn(), getPhoto: vi.fn() },
  CameraResultType: { DataUrl: 'DataUrl' },
  CameraSource: { Camera: 'Camera' },
  CameraDirection: { Rear: 'Rear' }
}))

vi.mock('@capacitor-community/barcode-scanner', () => ({
  BarcodeScanner: {
    checkPermission: vi.fn(),
    hideBackground: vi.fn(),
    startScan: vi.fn(),
    showBackground: vi.fn()
  }
}))

vi.mock('../services/compress', () => ({
  compressDataUrl: vi.fn(async (dataUrl: string) => ({ dataUrl, compressionRatio: 1 }))
}))

vi.mock('../services/api', () => ({ apiFetch: vi.fn() }))

vi.mock('../services/offlineDataSync', () => ({
  offlineDataSync: { lookupVehicleOffline: vi.fn(async () => null) }
}))

vi.mock('../services/sqlserver', () => ({
  sqlServerService: {
    createInspection: createInspectionMock,
    uploadPhoto: uploadPhotoMock
  }
}))

vi.mock('../services/db', () => ({
  setInspection: setInspectionMock,
  addPhoto: addPhotoMock,
  enqueue: enqueueMock
}))

describe('InspectionForm offline submit fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = vi.fn()
    createInspectionMock.mockRejectedValue(new Error('network down'))
    uploadPhotoMock.mockResolvedValue(true)
    setInspectionMock.mockResolvedValue(undefined)
    addPhotoMock.mockResolvedValue(undefined)
    enqueueMock.mockResolvedValue('queued-id')
  })

  it('preserves createServiceRequest in offline storage when online submit fails', async () => {
    const user = userEvent.setup()
    const showToast = vi.fn()

    render(
      <MemoryRouter>
        <InspectionForm onShowToast={showToast} />
      </MemoryRouter>
    )

    await user.type(screen.getByLabelText(/Inspector Name/i), 'Mobile QA')
    await user.click(screen.getByRole('button', { name: /Poor \(2 stars\)/i }))
    await user.click(screen.getByLabelText(/Create Service Request/i))
    await user.click(screen.getByRole('button', { name: /Submit Inspection/i }))

    await waitFor(() => expect(setInspectionMock).toHaveBeenCalledTimes(1))

    expect(createInspectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create_service_request: true,
        star_rating: 2,
        status: 'FAILED'
      })
    )

    expect(setInspectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inspectorName: 'Mobile QA',
        createServiceRequest: true,
        overallStars: 2,
        status: 'FAILED',
        pendingSync: true
      })
    )

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'inspection', priority: 1 })
    )
    expect(showToast).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('Saved offline')
    )
  })
})