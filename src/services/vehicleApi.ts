// Vehicle API client — mobile-specific vehicle CRUD
// Backend reference: app/views/mobile_api.py

import { apiFetch } from './api'
import { authService } from './auth'
import connectionManager from './connectionManager'
import type { VehicleBasicInfo } from './offlineDataSync'

export interface NewVehiclePayload {
  equip_no: string
  description: string
  manufacturer?: string
  unit_model?: string
  company: string
  location?: string
  year?: number
  serial_number?: string
}

/**
 * Extract a displayable photo URL from a vehicle's `picture` field.
 *
 * The backend stores either:
 * - A plain path: 'uploads/vehicles/filename.jpg'
 * - A JSON array: '[{"path":"uploads/vehicles/...","url":"/uploads/..."}]'
 */
export function resolveVehiclePhotoUrl(picture: string | undefined | null): string | null {
  if (!picture) return null

  // Plain path string (new format)
  if (picture.startsWith('uploads/')) {
    const base = connectionManager.getActiveEndpoint() || ''
    return `${base}/${picture}`
  }

  // JSON array (legacy format)
  try {
    const parsed = JSON.parse(picture)
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0]
      if (typeof first === 'string') {
        const base = connectionManager.getActiveEndpoint() || ''
        return first.startsWith('/') ? `${base}${first}` : `${base}/${first}`
      }
      if (first && typeof first === 'object') {
        const raw = first.url || first.path || null
        if (raw) {
          const base = connectionManager.getActiveEndpoint() || ''
          return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`
        }
      }
    }
  } catch {
    // Not JSON — ignore
  }

  return null
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await authService.getToken()
  if (!token) throw new Error('LOGIN_REQUIRED')
  return apiFetch(path, init, { token })
}

async function unwrap<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { success?: boolean; data?: T; message?: string } | null
  if (!response.ok || !body?.success || body.data === undefined) {
    throw new Error(body?.message || `Request failed (${response.status})`)
  }
  return body.data
}

/**
 * Create a new vehicle from the mobile app.
 * Returns the created vehicle so the app can redirect straight to commissioning.
 */
export async function createVehicleMobile(payload: NewVehiclePayload): Promise<VehicleBasicInfo> {
  const response = await authedFetch('/api/mobile/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return unwrap<VehicleBasicInfo>(response)
}

/**
 * Upload a vehicle profile photo from the mobile app.
 * The file is sent as multipart/form-data under the key 'vehicle_photo'.
 */
export async function uploadVehiclePhotoMobile(vehicleId: number, file: File): Promise<{ photo_url: string; filename: string }> {
  const token = await authService.getToken()
  if (!token) throw new Error('LOGIN_REQUIRED')

  const formData = new FormData()
  formData.append('vehicle_photo', file)

  const response = await apiFetch(`/api/mobile/vehicles/${vehicleId}/photo`, {
    method: 'POST',
    body: formData,
  }, { token })

  const body = await response.json().catch(() => null) as { success?: boolean; data?: { photo_url: string; filename: string }; message?: string } | null
  if (!response.ok || !body?.success || !body.data) {
    throw new Error(body?.message || `Photo upload failed (${response.status})`)
  }
  return body.data
}
