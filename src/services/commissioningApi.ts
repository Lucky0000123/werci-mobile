// Commissioning API client — talks to /api/mobile/commissioning/*
// Backend reference: app/views/mobile_api.py (Stage 4).
//
// Responses follow the envelope { success, data, message } used across the
// rest of the mobile API. We unwrap `data` here so callers get the payload
// directly and surface errors as thrown Error instances.

import { apiFetch } from './api'
import { authService } from './auth'

export interface CommissioningFormIndexEntry {
  form_code: string
  equipment: string
  file: string           // e.g. "dump_truck.json" — derive slug by stripping .json
  item_count: number
  sections: number
  flat: boolean
}

export interface CommissioningFormIndex {
  generated_at?: string
  count: number
  forms: CommissioningFormIndexEntry[]
}

export interface CommissioningFormItem {
  code?: string
  label?: string
  label_id?: string
  label_en?: string
}

export interface CommissioningFormSection {
  title: string
  items: CommissioningFormItem[]
}

export interface CommissioningFormSchema {
  form_code: string
  equipment: string
  slug?: string
  form_type?: string
  flat?: boolean
  sections: CommissioningFormSection[]
  header_fields?: Array<{ key: string; label: string; type?: string }>
}

export interface CommissioningItemResponse {
  section: string
  item: string
  result: 'GOOD' | 'FAIL' | 'NA'
  comment?: string
}

export interface CommissioningSubmitPayload {
  vehicle_id: number
  form_slug: string
  overall_result: 'PASS' | 'FAIL' | 'CONDITIONAL'
  items: CommissioningItemResponse[]
  inspector_name?: string
  inspector_area?: string
  inspection_date?: string
  expiry_date_set?: string // ISO date (YYYY-MM-DD) — only honoured on PASS
  header?: Record<string, unknown>
  recommendations?: unknown[]
  comments?: string
  language?: string
}

export interface CommissioningSubmitResult {
  inspection_id: number
  vehicle_id: number
  overall_result: string
  expiry_date_set?: string | null
  photo_count: number
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

export async function fetchCommissioningIndex(): Promise<CommissioningFormIndex> {
  const response = await authedFetch('/api/mobile/commissioning/forms')
  return unwrap<CommissioningFormIndex>(response)
}

export async function fetchCommissioningForm(slug: string): Promise<CommissioningFormSchema> {
  const response = await authedFetch(`/api/mobile/commissioning/forms/${encodeURIComponent(slug)}`)
  return unwrap<CommissioningFormSchema>(response)
}

export async function submitCommissioning(
  payload: CommissioningSubmitPayload,
  photos: Blob[]
): Promise<CommissioningSubmitResult> {
  const formData = new FormData()
  formData.append('payload', JSON.stringify(payload))
  photos.forEach((blob, idx) => {
    formData.append('photos', blob, `commissioning_${idx}.jpg`)
  })

  const response = await authedFetch('/api/mobile/commissioning/submit', {
    method: 'POST',
    body: formData
  })
  return unwrap<CommissioningSubmitResult>(response)
}
