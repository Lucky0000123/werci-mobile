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

// ════════════════════════════════════════════════════════════════════════════
//  OFFLINE CYCLE ENGINE — pure helpers ported verbatim from
//  app/services/dispatch_service.py so the cab can derive arrival/departure
//  transitions from the DEVICE's own GPS when there is no signal. The server is
//  always authoritative when online; this only drives state while offline, and
//  the manual action button always overrides. See docs/offline-cab/03_*.md.
// ════════════════════════════════════════════════════════════════════════════

// 12-state forward cycle (matches models/dispatch.py TRUCK_STATE_ORDER + the
// cab's STATE_STYLE/DRIVER_ACTIONS).
export type CycleState =
  | 'spot' | 'waiting' | 'loading'
  | 'fullTravel1' | 'fullWB' | 'fullTravel2' | 'sampling' | 'fullTravel3' | 'dumping'
  | 'emptyTravel1' | 'emptyWB' | 'emptyTravel2'

const CYCLE_ORDER: CycleState[] = ['spot', 'waiting', 'loading', 'fullTravel1', 'fullWB',
  'fullTravel2', 'sampling', 'fullTravel3', 'dumping', 'emptyTravel1', 'emptyWB', 'emptyTravel2']

/** Position of a state in the forward order, or -1 if unknown. */
export function cycleRank(s: string): number {
  const i = CYCLE_ORDER.indexOf(s as CycleState)
  return i
}

export type Zone = 'loading' | 'waiting' | 'discovery' | 'outside' | 'unknown'

export const ZONE_RANK: Record<Zone, number> =
  { loading: 3, waiting: 2, discovery: 1, outside: 0, unknown: -1 }

/** Great-circle distance in metres. Verbatim port of dispatch_service.haversine_m. */
export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000.0
  const dlat = (bLat - aLat) * Math.PI / 180
  const dlng = (bLng - aLng) * Math.PI / 180
  const s = Math.sin(dlat / 2) ** 2
    + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dlng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Innermost-ring-wins band classifier. Verbatim port of dispatch_service.zone_for. */
export function zoneFor(distM: number | null, loadingM: number, waitingM: number,
                        discoveryM: number | null = null): Zone {
  if (distM == null) return 'unknown'
  if (distM <= loadingM) return 'loading'
  if (distM <= waitingM) return 'waiting'
  if (discoveryM != null && distM <= discoveryM) return 'discovery'
  return 'outside'
}

export interface CycleGeo {
  excLat?: number | null; excLng?: number | null
  dumpLat?: number | null; dumpLng?: number | null
  loadingZoneM?: number; waitingZoneM?: number; discoveryZoneM?: number; dumpZoneM?: number
}

export interface DeviceFix { lat: number; lng: number; ts: number; heading?: number | null }

// One transition the engine raises — maps to an offline-outbox action.
export interface CycleEvent {
  kind: 'zone_event' | 'cycle_advance'
  plan_id: number | null
  truck_no: string
  excavator_no?: string | null
  // zone_event:
  zone_type?: 'discovery' | 'waiting' | 'loading' | 'dump'
  event_type?: 'enter' | 'exit'
  // cycle_advance:
  status?: CycleState
  distance_m?: number | null
  ts: number
}

export interface EngineResult {
  next: CycleState
  events: CycleEvent[]   // the SAME transitions the server would raise
  reason: 'gps' | 'noop'
}

/**
 * Compute the forward-only cycle transition for a truck from a single device GPS
 * fix, OFFLINE. Mirrors the server's deliberately-conservative GPS scope
 * (auto_advance_cycle): GPS only drives POST-LOAD dump legs + inbound arrival at
 * the shovel. spot↔loading and the weighbridge/sampling checkpoints stay on the
 * manual button (the server never GPS-drives them either). Solo-safe: it only
 * ever produces 'waiting' on arrival, never 'spot' (peer arbitration is the
 * server's job; it re-arbitrates spot on reconnect).
 */
export function advanceOffline(
  cur: CycleState,
  fix: DeviceFix,
  geo: CycleGeo,
  ctx: { plan_id: number | null; truck_no: string; excavator_no?: string | null },
): EngineResult {
  const lz = geo.loadingZoneM ?? 10
  const wz = geo.waitingZoneM ?? 20
  const dvz = geo.discoveryZoneM ?? 100
  const dz = geo.dumpZoneM ?? 50
  const ev: CycleEvent[] = []
  const mk = (e: Partial<CycleEvent>): CycleEvent => ({
    plan_id: ctx.plan_id, truck_no: ctx.truck_no, excavator_no: ctx.excavator_no,
    ts: fix.ts, ...e,
  } as CycleEvent)

  const distExc = (geo.excLat != null && geo.excLng != null)
    ? haversineM(fix.lat, fix.lng, geo.excLat, geo.excLng) : null
  const distDump = (geo.dumpLat != null && geo.dumpLng != null)
    ? haversineM(fix.lat, fix.lng, geo.dumpLat, geo.dumpLng) : null

  let next = cur

  // INBOUND (empty / pre-arrival): emptyTravel2 → arrive at shovel → waiting.
  // Discovery-ring crossing fires the "Reporting" zone event; entering the
  // waiting/loading ring advances the local state to 'waiting' (never 'spot').
  if (cur === 'emptyTravel2' || cur === 'waiting') {
    const z = zoneFor(distExc, lz, wz, dvz)
    if (cur === 'emptyTravel2') {
      if (z === 'discovery') {
        ev.push(mk({ kind: 'zone_event', zone_type: 'discovery', event_type: 'enter' }))
      } else if (z === 'waiting' || z === 'loading') {
        next = 'waiting'
        ev.push(mk({ kind: 'zone_event', zone_type: z, event_type: 'enter' }))
      }
    }
  }
  // POST-LOAD dump leg — the EXACT server auto-advance scope. The cycle_advance
  // to dumping/emptyTravel1 already records the dump zone enter/exit server-side,
  // so we don't raise a separate zone_event here (avoids a double audit row).
  else if (cur === 'fullTravel1' && distDump != null && distDump <= dz) {
    next = 'dumping'
    ev.push(mk({ kind: 'cycle_advance', status: 'dumping', distance_m: distDump }))
  }
  else if (cur === 'dumping' && distDump != null && distDump > dz) {
    next = 'emptyTravel1'
    ev.push(mk({ kind: 'cycle_advance', status: 'emptyTravel1', distance_m: distDump }))
  }

  // FORWARD-ONLY clamp: never emit a lower-ranked state — EXCEPT the intended
  // cycle-boundary wrap emptyTravel2 → waiting (rank 11 → 1), which starts the
  // next haul cycle. Every other backwards move is GPS jitter and is dropped.
  const isCycleWrap = cur === 'emptyTravel2' && next === 'waiting'
  if (!isCycleWrap && cycleRank(next) < cycleRank(cur)) { next = cur; ev.length = 0 }
  return { next, events: ev, reason: ev.length ? 'gps' : 'noop' }
}
