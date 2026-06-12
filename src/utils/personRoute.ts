import type { PersonCardData, PersonLookupParams } from '../services/offlineDataSync'

export function buildPersonDetailPath(lookup: PersonLookupParams): string {
  const params = new URLSearchParams()
  if (lookup.personKey) params.set('person_key', lookup.personKey)
  if (lookup.employeeId) params.set('employee_id', lookup.employeeId)
  if (lookup.kimperId != null) params.set('kimper_id', lookup.kimperId.toString())
  if (lookup.ktpNumber) params.set('ktp_number', lookup.ktpNumber)

  const query = params.toString()
  return query ? `/person-detail?${query}` : '/person-detail'
}

export function getPersonLookupFromCardData(cardData?: PersonCardData | null): PersonLookupParams {
  return {
    personKey: cardData?.person?.person_key || undefined,
    employeeId: cardData?.person?.employee_id || cardData?.employee?.employee_id || undefined,
    kimperId: cardData?.person?.kimper_id ?? cardData?.kimper?.kimper_id ?? undefined,
    ktpNumber: cardData?.person?.ktp_number || cardData?.employee?.ktp_number || undefined,
  }
}