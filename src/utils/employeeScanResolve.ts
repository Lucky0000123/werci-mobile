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
  // OFFLINE-FIRST: the on-device cache is fully synced, so a normal badge scan
  // can render instantly instead of blocking on a SQL round-trip through the
  // tunnel. We short-circuit only on a RICH offline source (qrCache → people →
  // employeeCards); a thin employees-only record is held back (used at the
  // bottom) so an online user never flashes a zero'd card. Cards returned here
  // carry `_offline`, which drives the page's silent background refresh — the
  // user sees data immediately and the live copy swaps in moments later.
  let offlineCard: { card: PersonCardData; source: string } | null = null
  if (lookupPersonCardOffline) {
    offlineCard = await lookupPersonCardOffline(employeeId)
    if (offlineCard?.card?.success && offlineCard.source !== 'employees') {
      return { kind: 'person-detail', personData: offlineCard.card }
    }
  }

  // Nothing rich cached → go to the network (authoritative; also refreshes the
  // cache for next time).
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

  // Network missed (offline / not found). Fall back to the thin offline partial
  // we held back above — better than nothing when there's no connectivity.
  if (offlineCard?.card?.success) {
    return { kind: 'person-detail', personData: offlineCard.card }
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
