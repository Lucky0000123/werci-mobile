/**
 * Deviation API Service
 * Handles all API calls for personnel deviation tracking
 */

import { apiFetch } from './api'
import type { PersonLookupParams } from './offlineDataSync'
import { offlineDataSync } from './offlineDataSync'
import DeviationStorage from './deviationStorage'
import type { PersonnelDeviation, DeviationFormData, DeviationListItem } from '../types/deviation'

export class DeviationApiService {
  /**
   * Submit new deviation report
   */
  static async submitDeviation(formData: DeviationFormData): Promise<number> {
    const data = new FormData()
    
    // Add all form fields
    if (formData.kimper_id) data.append('kimper_id', formData.kimper_id.toString())
    if (formData.person_key) data.append('person_key', formData.person_key)
    if (formData.employee_id) data.append('employee_id', formData.employee_id)
    if (formData.ktp_number) data.append('ktp_number', formData.ktp_number)
    if (formData.person_involved_name) data.append('person_involved_name', formData.person_involved_name)
    if (formData.person_involved_id) data.append('person_involved_id', formData.person_involved_id)
    
    data.append('deviation_date', formData.deviation_date)
    if (formData.shift) data.append('shift', formData.shift)
    data.append('location', formData.location)
    
    if (formData.activity) data.append('activity', formData.activity)
    data.append('deviation_description', formData.deviation_description)
    if (formData.golden_rules_number) data.append('golden_rules_number', formData.golden_rules_number.toString())
    
    if (formData.immediate_action) data.append('immediate_action', formData.immediate_action)
    data.append('status', formData.status)
    
    data.append('reported_by', formData.reported_by)
    if (formData.reporter_department) data.append('reporter_department', formData.reporter_department)
    
    if (formData.contractor_name) data.append('contractor_name', formData.contractor_name)
    if (formData.pic_name) data.append('pic_name', formData.pic_name)
    
    data.append('language', formData.language)
    
    // Add photos
    formData.photos.forEach((photo, index) => {
      data.append('photos', photo, `deviation_photo_${index}.jpg`)
    })
    
    const { authService } = await import('./auth')
    const token = await authService.getToken()
    if (!token) throw new Error('LOGIN_REQUIRED')

    const response = await apiFetch('/deviations/submit', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: data
    }, { token })

    // Parse response body defensively so we can surface the real reason on failure.
    let payload: { status?: string; message?: string; deviation_id?: number } | null = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      const serverMessage = payload?.message || `HTTP ${response.status} ${response.statusText || ''}`.trim()
      throw new Error(`Submit failed: ${serverMessage}`)
    }

    if (payload?.status !== 'success' || typeof payload?.deviation_id !== 'number') {
      throw new Error(payload?.message || 'Deviation submission did not return a valid ID')
    }

    return payload.deviation_id
  }
  
  /**
   * Get deviations for a specific KIMPER holder
   */
  static async getDeviationsByKimper(kimperId: number): Promise<DeviationListItem[]> {
    const response = await apiFetch(`/deviations/api/by_kimper/${kimperId}`)
    
    if (!response.ok) {
      throw new Error('Failed to fetch deviations')
    }
    
    const data = await response.json()
    return data.status === 'success' ? data.deviations : []
  }

  static async getDeviationsByPerson(lookup: PersonLookupParams): Promise<DeviationListItem[]> {
    try {
      const params = new URLSearchParams()

      if (lookup.personKey) params.set('person_key', lookup.personKey)
      if (lookup.employeeId) params.set('employee_id', lookup.employeeId)
      if (lookup.kimperId != null) params.set('kimper_id', lookup.kimperId.toString())
      if (lookup.ktpNumber) params.set('ktp_number', lookup.ktpNumber)

      const query = params.toString()
      const response = await apiFetch(`/deviations/api/by_person${query ? `?${query}` : ''}`)

      if (!response.ok) {
        throw new Error('Failed to fetch person deviations')
      }

      const data = await response.json()
      if (data.status === 'success') {
        const serverList = (data.deviations || []) as DeviationListItem[]
        // Cache the full server history so an offline re-scan shows it instead
        // of only the device's own pending submissions.
        await offlineDataSync.cachePersonDeviations(lookup, serverList)
        return serverList
      }
    } catch (error) {
      console.warn('Falling back to locally stored deviation history:', error)
    }

    // Offline / failure path: merge the cached server history (full record set
    // saved while online) with any locally-submitted deviations still pending
    // upload. Dedupe by id so a submission that was later synced isn't doubled.
    const cached = await offlineDataSync.getCachedPersonDeviations<DeviationListItem[]>(lookup)
    const cachedList = cached?.data ?? []

    const localSubmissions = await DeviationStorage.getByPerson(lookup)
    const localList: DeviationListItem[] = localSubmissions.map((deviation, index) => ({
      id: deviation.id ?? Number(`9${index + 1}`),
      person_key: deviation.person_key,
      employee_id: deviation.employee_id,
      kimper_id: deviation.kimper_id,
      ktp_number: deviation.ktp_number,
      deviation_date: deviation.deviation_date,
      location: deviation.location,
      description: deviation.deviation_description,
      status: deviation.status,
      golden_rules_number: deviation.golden_rules_number,
    }))

    const seen = new Set(cachedList.map(d => d.id))
    return [...cachedList, ...localList.filter(d => !seen.has(d.id))]
  }
  
  /**
   * Get deviation by ID
   */
  static async getDeviationById(deviationId: number): Promise<PersonnelDeviation | null> {
    const response = await apiFetch(`/deviations/view/${deviationId}`)

    if (!response.ok) {
      return null
    }

    // Parse HTML response (or implement JSON endpoint)
    // TODO: Implement JSON endpoint on backend
    return null
  }

  /**
   * Get all deviations
   */
  static async getAllDeviations(limit: number = 100): Promise<PersonnelDeviation[]> {
    const response = await apiFetch(`/deviations/list?limit=${limit}`)

    if (!response.ok) {
      throw new Error('Failed to fetch deviations')
    }

    // Parse HTML response (or implement JSON endpoint)
    // TODO: Implement JSON endpoint on backend
    return []
  }
}

export default DeviationApiService
