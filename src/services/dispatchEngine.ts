// Offline dispatch engine — PURE helpers (zero network, zero DB) ported verbatim
// from app/services/dispatch_service.py, plus a cache-based identify so an
// employee-ID lookup + authorization works with NO signal.
//
// Equipment TYPE comes from the Kimper unit DESCRIPTION text (kimper.units),
// NOT the unit_N_code license codes. See docs/dispatch_cycle_spec.md.
import { offlineDataSync } from './offlineDataSync'
import type { Person } from './offlineDataSync'

export type AllowedAction = { action: 'connect_truck' | 'connect_excavator'; unit_type: string; label: string }

export type DispatchProfile = {
  employee_id: string
  name: string
  company?: string
  department?: string
  kimper_status?: string
  kimper_expired_date?: string
  authorized_units: string[]
  authorized_unit_codes: string[]
  allowed_types: string[]
  allowed_type_labels: string[]
  allowed_actions: AllowedAction[]
  dispatch_role: string
  active_assignment?: unknown
  photo_url?: string
  offline?: boolean
}

const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  dump_truck: 'Dump Truck', excavator: 'Excavator', light_vehicle: 'Light Vehicle',
  grader: 'Grader', dozer: 'Dozer', compactor: 'Compactor', loader: 'Loader', other: 'Other',
}

// Description/keyword → canonical type. Excavator first so "exca" wins. ASCII
// needles match by startsWith/substring; CJK needles by substring. Mirrors
// dispatch_service._TYPE_RULES exactly.
const TYPE_RULES: [string, string[]][] = [
  ['excavator', ['EXCAV', 'EXCA', 'EXC', 'EXA', 'XR', 'SHOVEL', 'DIGGER', '挖']],
  ['dump_truck', ['DUMP', 'DT', 'TT', '自卸', '矿卡']],
  ['grader', ['GRADER', 'GRAD', '平地']],
  ['dozer', ['DOZER', 'DOZ', 'BULLDOZ', '推土']],
  ['compactor', ['COMPACTOR', 'COMPEKTOR', 'COMP', 'ROLLER', '压路', '压土']],
  ['loader', ['LOADER', 'LOAD', 'LODER', 'LODR', 'WHEEL LOADER', '装载', '铲车']],
  ['light_vehicle', ['LIGHT VEHICLE', 'LIGHT', 'LV', 'LB']],
]

function isAscii(s: string): boolean { return /^[\x00-\x7F]*$/.test(s) }

export function classifyEquipment(text?: string | null): string | null {
  const s = String(text ?? '').trim()
  if (!s) return null
  const up = s.toUpperCase()
  for (const [etype, needles] of TYPE_RULES) {
    for (const raw of needles) {
      const n = raw.trim()
      if (!n) continue
      if (isAscii(n)) { if (up.startsWith(n) || up.includes(n)) return etype }
      else { if (s.includes(n)) return etype }
    }
  }
  return 'other'
}

export function allowedTypesFromUnits(units: Array<string | null | undefined>): string[] {
  const out: string[] = []
  for (const u of units || []) {
    const t = classifyEquipment(u)
    if (t && t !== 'other' && !out.includes(t)) out.push(t)
  }
  return out
}

const CONNECT_ACTION: Record<string, 'connect_truck' | 'connect_excavator'> = {
  dump_truck: 'connect_truck', excavator: 'connect_excavator',
}

export function allowedActions(types: string[]): AllowedAction[] {
  const actions: AllowedAction[] = []
  const seen = new Set<string>()
  for (const t of types) {
    const act = CONNECT_ACTION[t]
    if (act && !seen.has(act)) {
      seen.add(act)
      actions.push({ action: act, unit_type: t, label: act === 'connect_truck' ? 'Connect Truck' : 'Connect Excavator' })
    }
  }
  return actions
}

export function inferDispatchRole(types: string[]): string {
  if (types.includes('excavator')) return 'operator'
  if (types.includes('dump_truck')) return 'driver'
  if (types.length) return 'operator'
  return 'unknown'
}

const KIMPER_EXPIRING_DAYS = 30

// Recompute the Kimper status client-side from the cached expiry date, so a card
// that lapsed since the last sync still blocks/warns offline. Mirrors _kimper_status.
export function kimperStatus(expired?: string | null): string {
  if (!expired) return 'NO_DATE'
  const exp = new Date(expired)
  if (isNaN(exp.getTime())) return 'UNKNOWN'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const e = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate())
  if (e < today) return 'EXPIRED'
  const soon = new Date(today); soon.setDate(soon.getDate() + KIMPER_EXPIRING_DAYS)
  if (e <= soon) return 'EXPIRING_SOON'
  return 'VALID'
}

/** Build a DispatchProfile from a cached Person — 100% offline. */
export function profileFromPerson(p: Person): DispatchProfile {
  const units = ((p.kimper && p.kimper.units) || []) as string[]
  const types = allowedTypesFromUnits(units)
  const exp = (p.kimper && p.kimper.kimper_expired_date) || undefined
  return {
    employee_id: p.employee_id || '',
    name: p.name || '',
    company: p.company || undefined,
    department: p.department || undefined,
    kimper_status: kimperStatus(exp),
    kimper_expired_date: exp || undefined,
    authorized_units: units,
    authorized_unit_codes: [],
    allowed_types: types,
    allowed_type_labels: types.map((t) => EQUIPMENT_TYPE_LABELS[t] || t),
    allowed_actions: allowedActions(types),
    dispatch_role: inferDispatchRole(types),
    photo_url: p.photo_url || undefined,
    offline: true,
  }
}

/** Resolve an employee ID against the on-device cache → an offline profile (or null). */
export async function buildOfflineProfile(employeeId: string): Promise<DispatchProfile | null> {
  const id = String(employeeId || '').trim()
  if (!id) return null
  const p = await offlineDataSync.lookupPersonByEmployeeId(id)
  return p ? profileFromPerson(p) : null
}

/** Resolve a scanned Kimper id (QR) against the cache → an offline profile (or null). */
export async function buildOfflineProfileByKimperId(kimperId: number): Promise<DispatchProfile | null> {
  if (kimperId == null) return null
  const p = await offlineDataSync.lookupPersonByKimperId(kimperId)
  return p ? profileFromPerson(p) : null
}
