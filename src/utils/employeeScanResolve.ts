import type { EmployeeCardData, EmployeeFullInfo, PersonCardData } from '../services/offlineDataSync'

export interface MinimalKimperMapping {
  id?: number | null
  id_number?: string | null
  name?: string | null
}

interface ResolveEmployeeScanTargetOptions {
  employeeId: string
  token?: string
  personKey?: string
  allowKimperFallback?: boolean
  fetchEmployeeCardData: (employeeId: string, token: string) => Promise<EmployeeCardData | null>
  lookupEmployeeById: (employeeId: string) => Promise<EmployeeFullInfo | null>
  fetchPersonCardData: (lookup: { personKey?: string; employeeId?: string }) => Promise<PersonCardData | null>
  /** Richer offline lookup that tries qrCache → people → employeeCards → employees. */
  lookupPersonCardOffline?: (employeeId: string) => Promise<{ card: PersonCardData; source: string } | null>
  getAllKimper?: () => Promise<MinimalKimperMapping[]>
}

export type EmployeeScanTarget =
  | { kind: 'employee-detail-card'; cardData: EmployeeCardData }
  | { kind: 'employee-detail-offline'; employee: EmployeeFullInfo }
  | { kind: 'employee-card'; kimper: MinimalKimperMapping }
  | { kind: 'person-detail'; personData: PersonCardData }
  | { kind: 'not-found' }

export async function resolveEmployeeScanTarget({
  employeeId,
  token = '',
  personKey,
  allowKimperFallback = false,
  fetchEmployeeCardData,
  lookupEmployeeById,
  fetchPersonCardData,
  lookupPersonCardOffline,
  getAllKimper,
}: ResolveEmployeeScanTargetOptions): Promise<EmployeeScanTarget> {
  const personData = await fetchPersonCardData({
    personKey: personKey || undefined,
    employeeId,
  })
  if (personData?.success) {
    return { kind: 'person-detail', personData }
  }

  const cardData = await fetchEmployeeCardData(employeeId, token)
  if (cardData?.success) {
    return { kind: 'employee-detail-card', cardData }
  }

  // New richer offline path: try qrCache → people store → employeeCards → employees.
  // This avoids the fake-zero training/violation fallback from synthesizing
  // EmployeeFullInfo into PersonCardData.
  if (lookupPersonCardOffline) {
    const offlineCard = await lookupPersonCardOffline(employeeId)
    if (offlineCard?.card?.success) {
      return { kind: 'person-detail', personData: offlineCard.card }
    }
  }

  // Legacy fallback for older callers / edge cases.
  const employee = await lookupEmployeeById(employeeId)
  if (employee) {
    return { kind: 'employee-detail-offline', employee }
  }

  if (allowKimperFallback && getAllKimper) {
    const allKimper = await getAllKimper()
    const kimper = allKimper.find(k =>
      (k.id_number || '').toString() === employeeId ||
      (k.id != null && String(k.id) === employeeId)
    )
    if (kimper) {
      return { kind: 'employee-card', kimper }
    }
  }

  return { kind: 'not-found' }
}
