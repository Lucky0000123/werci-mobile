// In-cab dispatch screen. Flow (no fleet-type question — type is auto-detected):
//   1. enter Employee ID  → 2. employee card + Kimper authorization
//   3. type the unit number → dropdown of matching SUPPORTED units (excavator /
//      dump truck) from /api/dispatch/units → 4. tap one → the app detects the
//      equipment type and connects → 5. opens the correct OPERATOR WINDOW.
//
// The two operator windows reproduce the WBN FMS prototype (docs/dispatch_cycle_
// spec.md): the EXCAVATOR operator window (current loading + clock, queue with
// the next truck, plan details, the big FULL button, machine-availability) and
// the TRUCK driver window (a single state-driven primary action button that
// walks the 12-state cycle, assignment details, manual equipment status). All
// status names / colours / labels come from the server board legend, which
// mirrors the prototype exactly. Manual statuses (delay / standby / breakdown /
// maintenance) post to /api/dispatch/equipment-status and never break the cycle.
import { useState, useEffect, useRef, useMemo, useCallback, memo, lazy, Suspense } from 'react'
import { apiFetch } from '../services/api'
import { submitDispatchAction, submitCycleEvent } from '../services/backgroundSync'
import { DispatchOutbox } from '../services/dispatchOutbox'
import { advanceOffline, buildOfflineProfile, haversineM, pickTruckPosition, shouldUseDeviceFix, type CycleState, type CycleGeo, type DeviceFix } from '../services/dispatchEngine'
import connectionManager from '../services/connectionManager'
import type { ConnectionStatus } from '../services/connectionManager'
import { useDispatchT } from '../services/dispatchI18n'
import { useI18n, type Language } from '../services/i18n-context'
// NavMap pulls in MapLibre GL + Leaflet (~930 KB) — ~92% of this screen's JS
// chunk — and is ONLY needed by a connected truck driver who opens the MAP view.
// Lazy-load it so the FMS sign-on, the employee card, and the excavator OUI (no
// map at all) never pay the map-engine parse cost on a low-end cab tablet.
const NavMap = lazy(() => import('../components/NavMap'))
// AdvancedRadioPTT is the in-cab radio surface: a floating 96px PTT button
// (tap = channel sheet, hold = push-to-talk, long-press = emergency) with smart
// channel auto-switch. Lazy-loaded so the dispatch screen pulls in NO radio /
// audio code at module load so a voice failure can never affect the haul-cycle,
// and low-end cab tablets pay nothing for it until connected. See
// docs/prism_radio_phase1.md.
const AdvancedRadioPTT = lazy(() => import('../components/AdvancedRadioPTT'))
// CabCallPanel is the in-cab PRISM Cab Call surface: a floating call button (left
// thumb-zone), the blue incoming-call ring, and the amber dispatcher-broadcast
// banner. Lazy-loaded for the same reason as the radio (no cab-call/SSE code at
// module load; a cab-call outage degrades to "Cab Call offline" and never touches
// the haul-cycle). See docs/prism_cab_call.md.
const CabCallPanel = lazy(() => import('../components/CabCallPanel'))
import { TruckStatusPanel } from '../components/TruckStatusPanel'
import ExcavatorOuiPanel from '../components/ExcavatorOuiPanel'
import type { Assignment, StatusState } from '../components/TruckStatusPanel'
import prismLogo from '../assets/Logo1_splash.png'

// ── types ────────────────────────────────────────────────────────────────
type AllowedAction = { action: 'connect_truck' | 'connect_excavator'; unit_type: string; label: string }
type ActiveAssignment = { unit_type: string; unit_no: string; unit_desc?: string; paired_at?: string; source?: string; sim?: boolean } | null
type Profile = {
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
  active_assignment?: ActiveAssignment
}
type Tms = {
  entered_no: string; tms_plate?: string; asset_type?: string
  live?: boolean; lat?: number; lng?: number; state?: string; type_match?: boolean | null
  // True when resolved to a dispatch-SIMULATOR overlay unit (DTSIM1/WSIM01).
  sim?: boolean
} | null
type ConnectResult = {
  success: boolean; authorized?: boolean; message?: string; unit_type?: string
  warnings?: string[]; tms?: Tms; kimper_status?: string
  allowed_type_labels?: string[]
}
type UnitSuggestion = {
  unit_no: string; type: string; type_label: string
  org?: string; live?: boolean; state?: string
}
// Live truck-card preview (Step 2) assembled from existing endpoints:
// resolve-unit (type/live/state), equipment-status (manual maintenance/etc.),
// and the dispatch board (assigned shovel + the connected driver's name). Every
// field is optional so the card degrades gracefully when a source is offline.
type UnitPreview = {
  unit_no: string
  type?: string | null
  type_label?: string
  live?: boolean
  found?: boolean
  manual_status?: string | null        // operating | delay | standby | breakdown | maintenance
  manual_reason?: string | null
  assigned_shovel?: string | null
  current_operator?: string | null     // a DIFFERENT operator already connected
  cycle_label?: string | null          // current haul-cycle stage, if on a plan
}

const SUPPORTED_TYPES = ['excavator', 'dump_truck']
// App-only ancillary equipment (no onboard TMS/GPS) — these sign on through the
// OUI via /connect-equipment and open the lightweight status-only panel instead
// of a haul-cycle window.
const EQUIPMENT_TYPES = ['grader', 'dozer', 'compactor', 'loader', 'light_vehicle', 'other']
const CONNECT_TYPES = [...SUPPORTED_TYPES, ...EQUIPMENT_TYPES]
const isEquipmentType = (t?: string | null) => !!t && EQUIPMENT_TYPES.includes(t)

/**
 * setInterval that PAUSES while the tab/app is backgrounded and resumes (with an
 * immediate catch-up tick) when it becomes visible again. The in-cab OUI runs
 * several polls (operator-view, GPS, outbox, telemetry, route); on a parked/
 * asleep cab tablet they would otherwise keep waking the radio + CPU every few
 * seconds and drain the battery. Returns a cleanup function.
 */
function visibleInterval(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const start = () => { if (timer == null) timer = setInterval(fn, ms) }
  const stop = () => { if (timer != null) { clearInterval(timer); timer = null } }
  const onVis = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      stop()
    } else {
      fn()        // catch up immediately on resume
      start()
    }
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    // start paused
  } else {
    start()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)
  return () => {
    stop()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
  }
}

// ── Keyboard avoidance ────────────────────────────────────────────────────
// On a cab tablet the on-screen keyboard (when the operator isn't using the
// physical one) covers the bottom of the screen. The visualViewport API tells
// us exactly how much is occluded; we return that pixel inset so the sign-on
// column can pad its bottom by it and keep the focused input + preview card in
// view. Zero on desktop / when no keyboard is up. No new dependency.
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const onResize = () => {
      // Occluded height = layout viewport bottom - visual viewport bottom.
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // Ignore tiny deltas (URL bar jitter) so the layout doesn't twitch.
      setInset(occluded > 80 ? Math.round(occluded) : 0)
    }
    onResize()
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize) }
  }, [])
  return inset
}

// Initials from a name (or fall back to the ID) for the avatar tile.
function initialsOf(name?: string, fallback?: string): string {
  const src = (name || '').trim()
  if (src) {
    const parts = src.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return src.slice(0, 2).toUpperCase()
  }
  return (fallback || '').trim().slice(0, 2).toUpperCase() || '–'
}

// A small inline spinner (uses the global .spinner keyframes in index.css).
function Spinner({ size = 22, color = '#f5a524' }: { size?: number; color?: string }) {
  return (
    <span className="spinner" style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      border: `${Math.max(2, Math.round(size / 9))}px solid rgba(255,255,255,0.18)`,
      borderTopColor: color, boxSizing: 'border-box',
    }} />
  )
}

// Connect-time advisories. Each carries a compact ICON (so the cab top bar shows
// a small glyph, not a long sentence) + severity (red = hard/blocking-ish, amber
// = advisory) + the full text revealed when the driver taps the icon cluster.
// icon families: KIMPER licence (id badge), GPS/live-feed (satellite), pairing
// (link), type mismatch (warning).
type WarnMeta = { icon: string; sev: 'red' | 'amber'; full: string }
const WARN_META: Record<string, WarnMeta> = {
  kimper_expired:       { icon: '🪪', sev: 'red',   full: 'KIMPER expired' },
  kimper_expiring_soon: { icon: '🪪', sev: 'amber', full: 'KIMPER expiring soon' },
  kimper_no_date:       { icon: '🪪', sev: 'amber', full: 'KIMPER has no expiry date' },
  not_authorized_type:  { icon: '🪪', sev: 'amber', full: 'Not on KIMPER for this equipment' },
  unit_unknown:         { icon: '📡', sev: 'amber', full: 'Unit not seen in live GPS yet (will link once it reports)' },
  unit_offline:         { icon: '📡', sev: 'amber', full: 'Unit currently offline in GPS' },
  unit_type_mismatch:   { icon: '⚠️', sev: 'amber', full: 'Entered unit type does not match the connect type' },
  unit_already_paired:  { icon: '🔗', sev: 'red',   full: 'Unit is already connected to another operator' },
}

// Light palette for the identify / connect steps (matches the rest of the app).
const C = {
  bg: '#F1F5F9', card: '#FFFFFF', ink: '#0F172A', sub: '#64748B',
  blue: '#2563EB', blueDk: '#1E3A8A', green: '#16A34A', amber: '#D97706',
  red: '#DC2626', line: '#E2E8F0',
}
// Dark palette for the operator windows (matches the prototype look).
const D = {
  bg: '#0b0f17', panel: '#141414', panel2: '#101010', line: '#2a2a2a',
  line2: '#3a3a3a', ink: '#ffffff', sub: '#9ca3af', sub2: '#d6d6d6',
  accent: '#38BDF8',
}
// Professional FMS palette for the sign-on / connect flow — dark shell with a
// gold accent, aligned with the web FMS shell (_fms_shell.html: #0a0a0a base,
// #f5a524 accent) so the in-cab tablet looks like one cohesive product.
const F = {
  bg: '#0a0c10', bg2: '#0f1218', panel: '#15181f', panelHi: '#1c2027',
  line: 'rgba(255,255,255,0.10)', line2: 'rgba(255,255,255,0.18)',
  ink: '#f8fafc', sub: '#94a3b8', sub2: '#cbd5e1',
  gold: '#f5a524', goldHi: '#ffb635',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#38bdf8',
}

// ── CYCLE v2 status palette (EXACT prototype hexes + labels) ──────────────
type StateStyle = { color: string; label: string }
const STATE_STYLE: Record<string, StateStyle> = {
  spot:         { color: '#A78BFA', label: 'Spotting' },
  waiting:      { color: '#FFE600', label: 'Waiting' },
  loading:      { color: '#FF4FB8', label: 'Loading' },
  fullTravel1:  { color: '#86EFAC', label: 'Full Travel 1' },
  fullWB:       { color: '#38BDF8', label: 'Full Weighbridge' },
  fullTravel2:  { color: '#22C55E', label: 'Full Travel 2' },
  sampling:     { color: '#C084FC', label: 'Sampling' },
  fullTravel3:  { color: '#15803D', label: 'Full Travel 3' },
  dumping:      { color: '#A16207', label: 'Dumping' },
  emptyTravel1: { color: '#FFFFFF', label: 'Empty Travel 1' },
  emptyWB:      { color: '#67E8F9', label: 'Empty Weighbridge' },
  emptyTravel2: { color: '#CBD5E1', label: 'Empty Travel 2' },
}
// Cycle progress is shown by the Status-view haul-cycle wheel (TruckStatusPanel),
// which maps the 12 operator states onto the 8 wheel segments + colour legend.
// Truck DRIVER primary action per state (from the prototype's truckActionButtons).
// kind 'first_bucket' → POST /loading/start; 'advance' → POST /cycle-advance to `next`.
//
// CYCLE POLICY (current site = LD.01 → DUMP.01, no weighbridge/sample GPS yet):
//   Only TWO actions are human-driven — the driver's First Bucket (spot→loading)
//   and the excavator's FULL·Kickout (loading→fullTravel1). EVERYTHING ELSE
//   auto-advances by GPS on the server (fullTravel1→dumping→emptyTravel1→requeue).
//   The weighbridge/sampling legs are RESERVED placeholders — they stay out of
//   the driver action map until those locations gain GPS coordinates, at which
//   point the server auto-advances through them too. So the driver only ever
//   taps First Bucket; the rest is hands-off. (A GPS-down manual fallback is
//   offered separately via the "Report GPS Unavailable" affordance.)
type DriverAct = { label: string; color: string; kind: 'first_bucket' | 'advance'; next: string }
const DRIVER_ACTIONS: Record<string, DriverAct> = {
  spot:         { label: 'Confirm Start Loading',          color: '#FF4FB8', kind: 'first_bucket', next: 'loading' },
}
// GPS-down MANUAL fallbacks for the auto legs (only surfaced when the driver
// reports GPS unavailable, so a stuck truck can still be advanced by hand).
const DRIVER_FALLBACK_ACTIONS: Record<string, DriverAct> = {
  fullTravel1:  { label: 'Arrived — Dump',                 color: '#A16207', kind: 'advance', next: 'dumping' },
  // NOTE: 'dumping' has NO fallback advance here. Completing a dump is the
  // dedicated two-tap "Finish Dumping" button (finishDumping() -> POST
  // /api/dispatch/finish-dumping), which is surfaced even in GPS-down mode, so a
  // single, unambiguous control closes the dump event + advances to Travel Empty.
  emptyTravel1: { label: 'Arrived — Shovel · Join Queue',  color: '#FFE600', kind: 'advance', next: 'waiting' },
}

// Manual equipment statuses (prototype legend) — recorded, do not break the cycle.
type ManualStatus = 'operating' | 'delay' | 'standby' | 'breakdown' | 'maintenance'
const MANUAL_STATUSES: { value: ManualStatus; label: string; color: string }[] = [
  { value: 'operating',  label: 'Ready / Operating', color: '#16A34A' },
  { value: 'delay',      label: 'Delay',             color: '#F97316' },
  { value: 'standby',    label: 'Standby',           color: '#6B7280' },
  { value: 'breakdown',  label: 'Breakdown / Down',  color: '#EF4444' },
  { value: 'maintenance', label: 'Maintenance',      color: '#EF4444' },
]
const STATUS_REASONS: Record<string, string[]> = {
  delay: ['Fuel', 'Road Block', 'Queue', 'Break', 'Tyre Check', 'Waiting Instruction', 'Other'],
  standby: ['Waiting Instruction', 'No Assignment', 'Shift Change', 'Meal / Break', 'Weather', 'Other'],
  breakdown: ['Engine Fault', 'Tyre Failure', 'Brake Issue', 'Hydraulic Fault', 'Electrical Fault', 'Other'],
  maintenance: ['Planned PM', 'Inspection', 'Tyre Check', 'Fuel / Service', 'Workshop', 'Other'],
}
function manualMeta(s?: string) { return MANUAL_STATUSES.find((m) => m.value === s) }

// Display labels for the app-only ancillary equipment types (used by the
// equipment status panel header). Mirrors the backend EQUIPMENT_TYPE_LABELS.
const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  grader: 'Grader', dozer: 'Dozer', compactor: 'Compactor',
  loader: 'Loader', light_vehicle: 'Light Vehicle', other: 'Equipment',
}
function equipmentTypeLabel(t?: string) {
  return (t && EQUIPMENT_TYPE_LABELS[t]) || 'Equipment'
}

// One colour per fleet family so the connect dropdown reads at a glance:
// excavator = teal, dump truck = blue, app-only ancillary gear = amber/gold.
function fleetTypeColor(t?: string): string {
  if (t === 'excavator') return '#2dd4bf'
  if (t === 'dump_truck') return '#38bdf8'
  if (t && EQUIPMENT_TYPES.includes(t)) return '#f5a524'   // ancillary support equipment
  return '#38bdf8'
}

function statusColor(s?: string) {
  if (s === 'EXPIRED' || s === 'NO_KIMPER') return C.red
  if (s === 'EXPIRING_SOON' || s === 'NO_DATE') return C.amber
  if (s === 'VALID' || s === 'ACTIVE') return C.green
  return C.sub
}
// Readable ink for a status-coloured button (light statuses need dark text).
function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return '#0F172A'
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#0F172A' : '#ffffff'
}

export default function DispatchPage({ onExit }: { onExit?: () => void } = {}) {
  const dt = useDispatchT()
  const { language, setLanguage } = useI18n()
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileOffline, setProfileOffline] = useState(false)
  const [unitNo, setUnitNo] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<UnitSuggestion[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConnectResult | null>(null)
  const [connectedUnit, setConnectedUnit] = useState('')
  const [online, setOnline] = useState<boolean>(() => connectionManager.getStatus().isOnline)
  const [viewMode, setViewMode] = useState<'map' | 'status'>('map')
  // Full-screen "Connecting…" splash shown between a successful connect tap and
  // the operator window mounting, so the operator gets clear feedback the action
  // took (the connect round-trip can be a second or two on a cab tablet).
  const [connecting, setConnecting] = useState(false)
  // Keyboard inset (px occluded by the on-screen keyboard) so the sign-on column
  // can keep the focused input + its live preview card above the keyboard.
  const kbInset = useKeyboardInset()
  // ── LIVE OPERATOR PREVIEW (Step 1) ──────────────────────────────────────
  // As the operator types their ID we resolve it (debounced) and show a preview
  // card — name, department, KIMPER status, avatar — BEFORE they commit. The
  // confirmed `profile` (which advances to Step 2) is only set when they tap
  // "Continue as <name>". `idPreview` is the in-progress lookup for that card.
  const [idPreview, setIdPreview] = useState<Profile | null>(null)
  const [idPreviewLoading, setIdPreviewLoading] = useState(false)
  const [idPreviewOffline, setIdPreviewOffline] = useState(false)
  const [idPreviewError, setIdPreviewError] = useState<string | null>(null)
  // ── LIVE TRUCK PREVIEW (Step 2) ─────────────────────────────────────────
  // As the operator types the unit number we resolve it (debounced) and show a
  // truck card — model/type, status, assigned shovel, current operator — before
  // they tap Connect. Built from existing endpoints only (resolve-unit + board +
  // equipment-status); fields degrade gracefully when a source is unavailable.
  const [unitPreview, setUnitPreview] = useState<UnitPreview | null>(null)
  const [unitPreviewLoading, setUnitPreviewLoading] = useState(false)
  // Employee-ID keyboard: numeric by default (IDs are mostly digits), with an
  // in-app 123/ABC toggle since the OS numeric pad has no letter switch.
  const [idMode, setIdMode] = useState<'numeric' | 'text'>('numeric')
  const idInputRef = useRef<HTMLInputElement>(null)
  const unitInputRef = useRef<HTMLInputElement>(null)
  function toggleIdKeyboard() {
    setIdMode((m) => (m === 'numeric' ? 'text' : 'numeric'))
    const el = idInputRef.current
    if (el) { el.blur(); setTimeout(() => el.focus(), 60) }  // force the keyboard to refresh
  }

  useEffect(() => {
    const cb = (s: ConnectionStatus) => setOnline(s.isOnline)
    connectionManager.addStatusListener(cb)
    setOnline(connectionManager.getStatus().isOnline)
    return () => connectionManager.removeStatusListener(cb)
  }, [])

  // The supported types this person may actually connect (Kimper ∩ {exc, truck}).
  const supportedAllowed = (profile?.allowed_types || []).filter((t) => SUPPORTED_TYPES.includes(t))

  // Hard-block the Connect button only when the live truck card shows the unit is
  // genuinely unavailable: under maintenance, or already connected to a DIFFERENT
  // operator. (KIMPER / type advisories never block — they're warnings.)
  const connectBlocked = !!unitPreview && (
    unitPreview.manual_status === 'maintenance' ||
    unitPreview.manual_status === 'breakdown' ||
    !!unitPreview.current_operator
  )

  // Offline-FIRST identify: resolve from the on-device cache instantly, then
  // enrich from the server when reachable.
  async function identify() {
    const id = employeeId.trim()
    if (!id) return
    setLoading(true); setError(null); setResult(null); setProfile(null)
    setProfileOffline(false); setUnitNo(''); setSelectedType(null); setSuggestions([])
    let cached: Awaited<ReturnType<typeof buildOfflineProfile>> = null
    try { cached = await buildOfflineProfile(id) } catch { /* cache unavailable */ }
    if (cached) { setProfile(cached as unknown as Profile); setProfileOffline(true) }
    try {
      const r = await apiFetch(`/api/dispatch/lookup?employee_id=${encodeURIComponent(id)}`, {}, { timeout: 45000 })
      const data = await r.json()
      if (r.ok && data.success) { setProfile(data.profile as Profile); setProfileOffline(false) }
      else if (!cached) setError(data.message || `Employee ${id} not found in Kimper`)
    } catch {
      // Network unreachable AND no cached hit. Distinguish "the offline data
      // simply hasn't downloaded yet" (cold cab) from "this ID genuinely isn't
      // in the saved list", so the driver sees a reassuring "syncing…" message
      // instead of a dead-end error — and kick a forced sync to self-heal.
      if (!cached) {
        let dataReady = false
        try {
          const { offlineDataSync } = await import('../services/offlineDataSync')
          const st = await offlineDataSync.getSyncStatus()
          dataReady = !!st.hasData
          if (!dataReady) offlineDataSync.syncOfflineData(true).catch(() => { /* scheduler will retry */ })
        } catch { /* offlineDataSync unavailable — fall through to generic error */ }
        setError(dataReady ? dt('no_signal_id') : dt('data_not_ready_syncing'))
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Step 1: DEBOUNCED LIVE OPERATOR PREVIEW ───────────────────────────────
  // As the operator types their ID, resolve it (offline cache first, then server)
  // and fill the preview card — name, dept, KIMPER, avatar — so they SEE who they
  // are before committing. Debounced 350ms to avoid hammering /lookup per keypress.
  // Only runs on Step 1 (before a profile is confirmed).
  useEffect(() => {
    if (profile) return                                  // already on Step 2
    const id = employeeId.trim()
    if (!id) { setIdPreview(null); setIdPreviewError(null); setIdPreviewLoading(false); return }
    let alive = true
    setIdPreviewLoading(true); setIdPreviewError(null)
    const h = setTimeout(async () => {
      // Offline cache first — instant card with no signal.
      let cached: Awaited<ReturnType<typeof buildOfflineProfile>> = null
      try { cached = await buildOfflineProfile(id) } catch { /* cache miss */ }
      if (alive && cached) { setIdPreview(cached as unknown as Profile); setIdPreviewOffline(true) }
      try {
        const r = await apiFetch(`/api/dispatch/lookup?employee_id=${encodeURIComponent(id)}`, {}, { timeout: 45000 })
        const data = await r.json()
        if (!alive) return
        if (r.ok && data.success) {
          setIdPreview(data.profile as Profile); setIdPreviewOffline(false); setIdPreviewError(null)
        } else if (!cached) {
          setIdPreview(null); setIdPreviewError(dt('id_not_found'))
        }
      } catch {
        // Network unreachable AND no cached hit → reassuring message, not a dead end.
        if (alive && !cached) {
          let dataReady = false
          try {
            const { offlineDataSync } = await import('../services/offlineDataSync')
            const st = await offlineDataSync.getSyncStatus()
            dataReady = !!st.hasData
            if (!dataReady) offlineDataSync.syncOfflineData(true).catch(() => { /* retry later */ })
          } catch { /* unavailable */ }
          setIdPreview(null)
          setIdPreviewError(dataReady ? dt('no_signal_id') : dt('data_not_ready_syncing'))
        }
      } finally {
        if (alive) setIdPreviewLoading(false)
      }
    }, 350)
    return () => { alive = false; clearTimeout(h) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, profile])

  // Commit the previewed operator → advance to Step 2 (no re-fetch; the preview
  // already resolved the profile). Falls back to identify() if the preview hasn't
  // landed yet (e.g. the operator hit Enter very fast).
  function confirmOperator() {
    if (idPreview) {
      setProfile(idPreview)
      setProfileOffline(idPreviewOffline)
      setError(null); setResult(null)
      setUnitNo(''); setSelectedType(null); setSuggestions([]); setUnitPreview(null)
      // focus the unit field for the next step
      setTimeout(() => unitInputRef.current?.focus(), 80)
    } else {
      void identify()
    }
  }

  // ── Step 2: DEBOUNCED LIVE TRUCK PREVIEW ──────────────────────────────────
  // As the operator types the unit number, resolve it (existing endpoints only)
  // and fill the truck card — type, live status, manual status (maintenance/etc.),
  // assigned shovel, and any operator already connected. Debounced 350ms.
  useEffect(() => {
    if (!profile) return
    const u = unitNo.trim().toUpperCase()
    if (!u) { setUnitPreview(null); setUnitPreviewLoading(false); return }
    if (!online) { setUnitPreview(null); setUnitPreviewLoading(false); return }  // offline → free-type
    let alive = true
    setUnitPreviewLoading(true)
    const h = setTimeout(async () => {
      const pv: UnitPreview = { unit_no: u }
      // 1) resolve-unit — type + live + cycle state (cheap, primary source)
      try {
        const r = await apiFetch(`/api/dispatch/resolve-unit?unit_no=${encodeURIComponent(u)}`, {}, { timeout: 45000 })
        const d = await r.json()
        const tms = d?.tms
        pv.found = !!d?.found
        if (tms) {
          pv.type = tms.asset_type || null
          pv.live = !!tms.live
          pv.cycle_label = tms.state ? (STATE_STYLE[tms.state]?.label || tms.state) : null
        }
      } catch { /* offline / unknown */ }
      // 2) equipment-status — manual maintenance/breakdown/standby/delay
      try {
        const r = await apiFetch(`/api/dispatch/equipment-status?unit_no=${encodeURIComponent(u)}`)
        const d = await r.json()
        if (d?.success && d.status) { pv.manual_status = d.status.status; pv.manual_reason = d.status.reason }
      } catch { /* best-effort */ }
      // 3) board — assigned shovel + the connected driver's name (best-effort)
      try {
        const r = await apiFetch('/api/dispatch/board')
        const bd = await r.json()
        if (bd && Array.isArray(bd.excavators)) {
          for (const exc of bd.excavators) {
            const mine = (exc.trucks || []).find((t: OpTruck) => (t.truck_no || '').trim().toUpperCase() === u)
            if (mine) {
              pv.assigned_shovel = exc.excavator_no || null
              if (mine.driver_name && mine.connected) pv.current_operator = mine.driver_name
              if (!pv.cycle_label && mine.state) pv.cycle_label = STATE_STYLE[mine.state]?.label || mine.state
              break
            }
          }
        }
      } catch { /* best-effort */ }
      pv.type_label = pv.type === 'excavator' ? dt('excavator')
        : pv.type === 'dump_truck' ? dt('dump_truck')
        : pv.type ? equipmentTypeLabel(pv.type) : ''
      if (alive) { setUnitPreview(pv); setUnitPreviewLoading(false) }
    }, 350)
    return () => { alive = false; clearTimeout(h) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitNo, profile, online])

  // Debounced unit autocomplete — only the SUPPORTED types this person may run.
  useEffect(() => {
    if (!showDrop) return
    const q = unitNo.trim()
    if (!q) { setSuggestions([]); return }
    if (!online) return                       // offline → free-type, resolve on connect
    let alive = true
    setSearching(true)
    const h = setTimeout(async () => {
      try {
        // Offer ALL connectable equipment — the haul fleet (excavator,
        // dump_truck) plus app-only ancillary gear (grader, dozer, ...). KIMPER
        // authorization never limits what may be connected; it only adds an
        // advisory warning on connect.
        const types = CONNECT_TYPES.join(',')
        const r = await apiFetch(`/api/dispatch/units?q=${encodeURIComponent(q)}&types=${types}&limit=10`)
        const d = await r.json()
        if (!alive) return
        setSuggestions(r.ok && d.success ? (d.units || []) : [])
      } catch { if (alive) setSuggestions([]) } finally { if (alive) setSearching(false) }
    }, 250)
    return () => { alive = false; clearTimeout(h) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitNo, showDrop, online])

  // Connect a unit. `type` comes from the picked suggestion; for free-typed
  // input it's detected via /resolve-unit, then narrowed to what this person
  // may operate (auto — the operator never picks a fleet type).
  async function connectUnit(unit: string, type: string | null) {
    if (!profile) return
    const u = unit.trim().toUpperCase()
    if (!u) { setError(dt('enter_unit_first')); return }
    setShowDrop(false); setLoading(true); setConnecting(true); setError(null); setResult(null)
    try {
      let t = type
      if (!t || !CONNECT_TYPES.includes(t)) {
        // detect from the live feed / asset map
        try {
          const rr = await apiFetch(`/api/dispatch/resolve-unit?unit_no=${encodeURIComponent(u)}`, {}, { timeout: 45000 })
          const rd = await rr.json()
          t = rd?.tms?.asset_type || null
        } catch { /* offline / unknown */ }
      }
      // Choose the connect endpoint type. An operator is NEVER blocked here —
      // KIMPER authorization is advisory only (the server attaches a warning,
      // never refuses). Resolve the type from: the picked suggestion → live
      // detection → the operator's single authorized type → fall back to
      // dump_truck. Unknown/ancillary types route to the app-only equipment flow.
      if (!t || !CONNECT_TYPES.includes(t)) {
        if (supportedAllowed.length >= 1) t = supportedAllowed[0]              // an authorized haul type
        else t = 'dump_truck'                                                 // no auth listed — still allow
      }
      // Route by family: excavator + dump_truck keep their dedicated pairing
      // flows; everything else is app-only ancillary equipment (no TMS/GPS).
      const path = t === 'excavator' ? '/api/dispatch/connect-excavator'
        : isEquipmentType(t) ? '/api/dispatch/connect-equipment'
        : '/api/dispatch/connect-truck'
      const payload: Record<string, unknown> = { employee_id: profile.employee_id, unit_no: u }
      if (isEquipmentType(t)) payload.unit_type = t     // server keeps the picked ancillary type
      const r = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, { timeout: 45000 })   // connect is a one-time user action; tolerate a
                               // slow server (e.g. a concurrent workforce sync)
                               // rather than show a false "couldn't reach server"
      const data = await r.json() as ConnectResult
      if (r.status === 403 && data.authorized === false) {
        setError(data.message || dt('not_authorized')); setConnecting(false)
      } else if (!r.ok || !data.success) {
        setError(data.message || dt('connect_failed')); setConnecting(false)
      } else {
        setConnectedUnit(u)
        setResult(data)
        // Tag GPS posts with this operator/unit so multiple cab tablets on one
        // shared login account each keep their own position on the map.
        // EXCEPT for a SIMULATOR unit (DTSIM1/WSIM01): its position is the
        // simulation feed, so the tablet GPS must NEVER be posted tagged to it
        // (one-way: backend -> cab). Personal safety location keeps streaming
        // untagged. The scope-sync effect below re-asserts this for reopens too.
        void import('../services/locationShare')
          .then((m) => m.setConnectedScope(
            data.tms?.sim ? null : { employeeId: profile.employee_id, unitNo: u }))
          .catch(() => { /* location share unavailable */ })
        // Keep the "Connecting…" splash up briefly so it crossfades into the
        // operator window instead of flashing; the window mounts on `result`.
        setTimeout(() => setConnecting(false), 650)
      }
    } catch {
      setError(online ? dt('network_err') : dt('offline_connect')); setConnecting(false)
    } finally {
      setLoading(false)
    }
  }

  async function disconnect(employee_id: string) {
    setLoading(true); setError(null)
    try {
      // Idempotent on the server (ending 0 active pairings still succeeds), so
      // it's safe to queue + replay if the cab is offline at end-of-shift.
      await submitDispatchAction({
        kind: 'disconnect',
        endpoint: '/api/dispatch/disconnect',
        scopeKey: employee_id,
        payload: { employee_id },
      })
      setResult(null); setConnectedUnit('')
      void import('../services/locationShare')
        .then((m) => m.setConnectedScope(null))
        .catch(() => { /* noop */ })
      await identify()      // refresh — active_assignment cleared
    } catch {
      setError('Network error — could not disconnect')
    } finally {
      setLoading(false)
    }
  }

  // Back from Step 2 → Step 1 (keep nothing from the unit step).
  function backToOperator() {
    setProfile(null); setProfileOffline(false)
    setUnitNo(''); setSelectedType(null); setSuggestions([]); setShowDrop(false)
    setUnitPreview(null); setError(null); setResult(null)
    setTimeout(() => idInputRef.current?.focus(), 80)
  }

  // The active connection drives which operator window opens (from a fresh
  // connect OR an existing pairing surfaced by identify).
  const connection = (() => {
    if (result && result.success && result.authorized !== false) {
      return {
        unit_no: result.tms?.entered_no || connectedUnit,
        unit_type: result.unit_type || 'dump_truck',
        warnings: result.warnings || [],
        sim: !!result.tms?.sim,
      }
    }
    if (profile?.active_assignment) {
      return {
        unit_no: profile.active_assignment.unit_no,
        unit_type: profile.active_assignment.unit_type,
        warnings: [] as string[],
        sim: !!profile.active_assignment.sim,
      }
    }
    return null
  })()

  // Lock the WebView to a fixed viewport while an operator window is open so the
  // in-cab truck/excavator screens can't be dragged, bounced, or page-scrolled
  // (body.oui-locked in index.css pins inset:0 + overflow:hidden + touch-action).
  const ouiOpen = !!(profile && connection)
  useEffect(() => {
    if (ouiOpen) document.body.classList.add('oui-locked')
    else document.body.classList.remove('oui-locked')
    return () => document.body.classList.remove('oui-locked')
  }, [ouiOpen])

  // Keep the GPS-post scope in sync with the active connection (covers a tablet
  // that reopens already-connected via identify, not just a fresh connect), so
  // every cab tablet on the shared login account always tags its own unit.
  useEffect(() => {
    const emp = profile?.employee_id
    const unit = connection?.unit_no
    // A SIMULATOR unit's position is the simulation feed — NEVER tag the tablet
    // GPS with its unit_no (would leak tablet GPS onto the sim unit via the OUI
    // overlay). Real units keep per-tablet scoping. Personal safety location is
    // unaffected (it streams untagged regardless).
    const tagSim = !!connection?.sim
    void import('../services/locationShare')
      .then((m) => m.setConnectedScope(emp && unit && !tagSim ? { employeeId: emp, unitNo: unit } : null))
      .catch(() => { /* noop */ })
  }, [profile?.employee_id, connection?.unit_no, connection?.sim])

  // ── connected: full-screen operator window ──
  if (profile && connection) {
    const isExc = connection.unit_type === 'excavator'
    const isEquip = isEquipmentType(connection.unit_type)   // app-only ancillary gear
    return (
      <div style={{ height: '100dvh', boxSizing: 'border-box', background: D.bg,
                    padding: 8, paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        {/* compact top bar — logo, name, warnings, switch/end (always shown) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <img src={prismLogo} alt="PRISM" style={{ height: 28, width: 'auto', flexShrink: 0 }} />
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
              <span style={{ color: D.ink, fontWeight: 800, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile.name || profile.employee_id}
              </span>
              <span style={{ color: D.sub, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>ID {profile.employee_id}</span>
            </div>
            {connection.warnings.length > 0 && (
              <WarnIcons warnings={connection.warnings} />
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* The radio lives in the floating AdvancedRadioPTT button
                  (bottom thumb-zone), not the top bar -- see below. */}
              {/* Language switcher — must be reachable from EVERY in-cab screen
                  (excavator + truck OUI both render under this top bar). */}
              <div style={{ position: 'relative' }}>
                <button type="button" onClick={() => setShowLangMenu((v) => !v)} aria-label={dt('language')}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px',
                                 fontSize: '0.74rem', fontWeight: 800, color: D.sub2,
                                 background: 'transparent', border: `1px solid ${D.line2}`, borderRadius: 9, cursor: 'pointer' }}>
                  <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>
                    {language === 'id' ? '🇮🇩' : language === 'zh' ? '🇨🇳' : '🇬🇧'}
                  </span>
                  <span>{language.toUpperCase()}</span>
                </button>
                {showLangMenu && (
                  <>
                    <div onClick={() => setShowLangMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41,
                                  background: F.panelHi, border: `1px solid ${F.line2}`, borderRadius: 12,
                                  boxShadow: '0 18px 40px rgba(0,0,0,0.6)', overflow: 'hidden', minWidth: 170 }}>
                      {[
                        { lang: 'id' as Language, flag: '🇮🇩', label: 'Bahasa Indonesia' },
                        { lang: 'en' as Language, flag: '🇬🇧', label: 'English' },
                        { lang: 'zh' as Language, flag: '🇨🇳', label: '中文' },
                      ].map(({ lang, flag, label }) => (
                        <button key={lang} onClick={() => { setLanguage(lang); setShowLangMenu(false) }}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                                         padding: '11px 14px', fontSize: '0.86rem', fontWeight: 600, textAlign: 'left',
                                         cursor: 'pointer', border: 'none', borderBottom: `1px solid ${F.line}`,
                                         background: language === lang ? 'rgba(245,165,36,0.15)' : 'transparent',
                                         color: language === lang ? F.gold : F.sub2 }}>
                          <span>{flag}</span><span>{label}</span>
                          {language === lang && <span style={{ marginLeft: 'auto', color: F.gold }}>✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => disconnect(profile.employee_id)} disabled={loading}
                      style={{ padding: '7px 11px', fontSize: '0.74rem', fontWeight: 700, color: '#fff', background: '#7F1D1D', border: '1px solid #B91C1C', borderRadius: 9, cursor: 'pointer' }}>
                {dt('end_shift')}
              </button>
            </div>
          </div>

        {/* OUI fills the rest — single screen, no page scroll */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {isExc ? (
            <ExcavatorOuiPanel employeeId={profile.employee_id} excavatorNo={connection.unit_no} operatorName={profile.name} />
          ) : isEquip ? (
            <EquipmentOuiPanel employeeId={profile.employee_id} unitNo={connection.unit_no}
                               unitType={connection.unit_type} operatorName={profile.name} />
          ) : (
            <TruckDriverWindow employeeId={profile.employee_id} truckNo={connection.unit_no} driverName={profile.name}
                               viewMode={viewMode} setViewMode={setViewMode} />
          )}
        </div>

        {/* AdvancedRadioPTT -- the cab's entire radio surface: a floating 96px
            PTT button (tap = channel sheet, hold = push-to-talk, 3s long-press =
            emergency) with smart channel auto-switch. Always mounted on the
            connected operator window (truck AND excavator); lazy + Suspense
            fallback null so it never blocks the cab, and a voice/zone failure
            degrades to "Radio offline" without ever touching the haul-cycle. */}
        <Suspense fallback={null}>
          <AdvancedRadioPTT
            identity={{ employeeId: profile.employee_id, unitNo: connection.unit_no, operatorName: profile.name }}
          />
        </Suspense>

        {/* CabCallPanel -- the cab's PRISM Cab Call surface: a floating call button
            (left thumb-zone, opposite the radio PTT), the blue 1:1 incoming-call
            ring, and the amber dispatcher-broadcast banner. Same identity as the
            radio; lazy + Suspense fallback null so it never blocks the cab, and a
            cab-call outage degrades to "Cab Call offline" without ever touching
            the haul-cycle. */}
        <Suspense fallback={null}>
          <CabCallPanel
            identity={{ employeeId: profile.employee_id, unitNo: connection.unit_no, operatorName: profile.name }}
          />
        </Suspense>
      </div>
    )
  }

  // ── identify / connect — professional FMS sign-on ──
  const kColor = statusColor(profile?.kimper_status)
  return (
    <div style={{
      minHeight: '100dvh', boxSizing: 'border-box', background: F.bg,
      backgroundImage: `radial-gradient(1100px 520px at 50% -8%, rgba(245,165,36,0.10), transparent 60%),
                        radial-gradient(900px 480px at 100% 110%, rgba(56,189,248,0.06), transparent 55%)`,
      color: F.ink, padding: '0 0 96px', display: 'flex', flexDirection: 'column',
    }}>
      {/* ── branded header band ── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
        borderBottom: `1px solid ${F.line}`, background: 'rgba(10,12,16,0.72)',
        backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 30,
      }}>
        <img src={prismLogo} alt="PRISM" style={{ height: 34, width: 'auto' }} />
        <div style={{ minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontWeight: 800, fontSize: '0.98rem', letterSpacing: '-0.01em' }}>
            WBN <span style={{ color: F.gold }}>FMS</span>
          </div>
          <div style={{ color: F.sub, fontSize: '0.72rem', fontWeight: 600 }}>Fleet Management · In-Cab Dispatch</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7,
                        fontSize: '0.72rem', fontWeight: 700, color: online ? F.green : F.amber,
                        background: online ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                        border: `1px solid ${online ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}`,
                        borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: online ? F.green : F.amber,
                           boxShadow: `0 0 8px ${online ? F.green : F.amber}` }} />
            {online ? 'ONLINE' : 'OFFLINE'}
          </div>

          {/* Language switcher — operators may not read English; keep it on the
              entry screen since the in-cab session hides the app header/nav. */}
          <div style={{ position: 'relative' }}>
            <button type="button" onClick={() => setShowLangMenu((v) => !v)}
                    aria-label={dt('language')}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px',
                             fontSize: '0.74rem', fontWeight: 800, color: F.sub2,
                             background: F.panel, border: `1px solid ${F.line2}`, borderRadius: 999, cursor: 'pointer' }}>
              <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>
                {language === 'id' ? '🇮🇩' : language === 'zh' ? '🇨🇳' : '🇬🇧'}
              </span>
              <span>{language.toUpperCase()}</span>
            </button>
            {showLangMenu && (
              <>
                <div onClick={() => setShowLangMenu(false)}
                     style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 41,
                              background: F.panelHi, border: `1px solid ${F.line2}`, borderRadius: 12,
                              boxShadow: '0 18px 40px rgba(0,0,0,0.6)', overflow: 'hidden', minWidth: 170 }}>
                  {[
                    { lang: 'id' as Language, flag: '🇮🇩', label: 'Bahasa Indonesia' },
                    { lang: 'en' as Language, flag: '🇬🇧', label: 'English' },
                    { lang: 'zh' as Language, flag: '🇨🇳', label: '中文' },
                  ].map(({ lang, flag, label }) => (
                    <button key={lang} onClick={() => { setLanguage(lang); setShowLangMenu(false) }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                                     padding: '11px 14px', fontSize: '0.86rem', fontWeight: 600, textAlign: 'left',
                                     cursor: 'pointer', border: 'none', borderBottom: `1px solid ${F.line}`,
                                     background: language === lang ? 'rgba(245,165,36,0.15)' : 'transparent',
                                     color: language === lang ? F.gold : F.sub2 }}>
                      <span>{flag}</span><span>{label}</span>
                      {language === lang && <span style={{ marginLeft: 'auto', color: F.gold }}>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Exit — leave the dispatch entry screen back to the login / mode
              picker, for a normal employee-card user who isn't on an FMS device. */}
          {onExit && (
            <button type="button" onClick={onExit} aria-label={dt('sign_out')}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px',
                             fontSize: '0.74rem', fontWeight: 800, color: '#fca5a5',
                             background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.4)',
                             borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ⎋ {dt('sign_out')}
            </button>
          )}
        </div>
      </header>

      {/* ── centered content column (tablet-friendly) ──
          paddingBottom grows with the on-screen keyboard so the focused input +
          its live preview card always stay visible above it (keyboard avoidance). */}
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto',
                    padding: `18px 16px ${24 + kbInset}px`, transition: 'padding-bottom 0.18s ease',
                    display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 2px 0' }}>
          {stepDot('1', !profile ? 'active' : 'done')}
          <div style={{ flex: 1, height: 3, borderRadius: 3, background: profile ? F.gold : F.line2 }} />
          {stepDot('2', profile ? 'active' : 'idle')}
          <div style={{ marginLeft: 8, fontSize: '0.86rem', fontWeight: 700, color: F.sub, whiteSpace: 'nowrap' }}>
            {!profile ? dt('step_identify') : dt('step_select_unit')}
          </div>
        </div>

        {!online && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(245,158,11,0.10)',
                        border: `1px solid rgba(245,158,11,0.40)`, color: '#fcd34d', borderRadius: 14,
                        padding: '12px 15px', fontSize: '0.92rem', fontWeight: 600 }}>
            <span style={{ fontSize: '1.1rem' }}>⚠</span>{dt('offline_banner')}
          </div>
        )}

        {/* ════════ STEP 1 — OPERATOR SIGN-ON ════════ */}
        {!profile && (
          <div style={fmsCard}>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: 3 }}>{dt('operator_signon')}</div>
            <div style={{ color: F.sub, fontSize: '0.95rem', marginBottom: 18 }}>{dt('title')}</div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <label style={fmsLabel}>{dt('enter_emp_id')}</label>
              <button
                type="button"
                onClick={toggleIdKeyboard}
                aria-label="Toggle keyboard"
                style={{ minHeight: 40, padding: '6px 16px', fontSize: '0.86rem', fontWeight: 800, color: F.gold,
                         background: 'rgba(245,165,36,0.12)', border: `1px solid rgba(245,165,36,0.45)`,
                         borderRadius: 999, cursor: 'pointer' }}
              >
                {idMode === 'numeric' ? 'ABC' : '123'}
              </button>
            </div>
            <input
              ref={idInputRef}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmOperator()}
              placeholder={dt('id_placeholder')}
              autoFocus
              inputMode={idMode}
              style={fmsInputBig}
            />

            {/* LIVE PREVIEW CARD — appears as you type. */}
            <OperatorPreviewCard
              employeeId={employeeId} preview={idPreview} loading={idPreviewLoading}
              offline={idPreviewOffline} error={idPreviewError} dt={dt} />

            <button onClick={confirmOperator}
                    disabled={loading || !employeeId.trim() || (!idPreview && !!idPreviewError)}
                    style={fmsBigPrimaryBtn(loading || !employeeId.trim() || (!idPreview && !!idPreviewError))}>
              {loading ? dt('checking')
                : idPreview ? `${dt('continue_as')} ${firstWord(idPreview.name) || idPreview.employee_id}`
                : dt('identify')}
            </button>
          </div>
        )}

        {/* ════════ STEP 2 — CONFIRMED OPERATOR + UNIT ENTRY ════════ */}
        {profile && (
          <>
            <div style={fmsCard}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                {/* operator avatar (initials) */}
                <div style={{ width: 60, height: 60, borderRadius: 16, flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '1.4rem', fontWeight: 800, color: F.gold,
                              background: 'rgba(245,165,36,0.12)', border: `1px solid rgba(245,165,36,0.35)` }}>
                  {initialsOf(profile.name, profile.employee_id)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '1.28rem', fontWeight: 800, color: F.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile.name || '—'}
                  </div>
                  <div style={{ color: F.sub, fontSize: '0.92rem' }}>ID {profile.employee_id}</div>
                  {[profile.company, profile.department].filter(Boolean).length > 0 && (
                    <div style={{ color: F.sub, fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[profile.company, profile.department].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {profileOffline && <div style={{ color: F.amber, fontSize: '0.78rem', fontWeight: 700, marginTop: 2 }}>{dt('from_saved')}</div>}
                </div>
                <span style={{ ...fmsPill(kColor), alignSelf: 'flex-start', fontSize: '0.78rem' }}>
                  KIMPER {profile.kimper_status || '—'}
                </span>
              </div>

              {/* Expired KIMPER → yellow warning, still allowed (dispatcher override). */}
              {(profile.kimper_status === 'EXPIRED' || profile.kimper_status === 'NO_KIMPER' ||
                profile.kimper_status === 'EXPIRING_SOON' || profile.kimper_status === 'NO_DATE') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, color: '#fcd34d',
                              background: 'rgba(245,158,11,0.10)', border: `1px solid rgba(245,158,11,0.40)`,
                              borderRadius: 12, padding: '11px 14px', fontSize: '0.88rem', fontWeight: 600 }}>
                  <span style={{ fontSize: '1.1rem' }}>🪪</span>
                  {profile.kimper_status === 'EXPIRED' || profile.kimper_status === 'NO_KIMPER'
                    ? dt('kimper_warn_expired') : dt('kimper_warn_soon')}
                </div>
              )}

              <div style={{ height: 1, background: F.line, margin: '15px -18px' }} />

              <div style={fmsLabel}>{dt('authorized_to_operate')}</div>
              {profile.allowed_type_labels.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
                  {profile.allowed_type_labels.map((t) => (
                    <span key={t} style={fmsChip(F.blue)}>{t}</span>
                  ))}
                </div>
              ) : (
                <div style={{ color: F.amber, fontSize: '0.92rem', marginTop: 9, fontWeight: 600 }}>
                  {dt('no_authorization')}
                </div>
              )}
            </div>

            {/* unit number → live truck card → connect. */}
            <div style={fmsCard}>
              <label style={fmsLabel}>{dt('which_unit')}</label>
              <div style={{ position: 'relative', marginTop: 9 }}>
                <input
                  ref={unitInputRef}
                  value={unitNo}
                  onChange={(e) => { setUnitNo(e.target.value.toUpperCase()); setSelectedType(null); setShowDrop(true) }}
                  onFocus={() => setShowDrop(true)}
                  onKeyDown={(e) => e.key === 'Enter' && !connectBlocked && connectUnit(unitNo, selectedType)}
                  placeholder={dt('unit_placeholder')}
                  autoFocus
                  style={{ ...fmsInputBig, marginBottom: 0, fontWeight: 800, letterSpacing: '0.05em' }}
                  autoComplete="off"
                />
                {showDrop && unitNo.trim() && (suggestions.length > 0 || searching) && (
                  <div style={fmsDrop}>
                    {searching && suggestions.length === 0 && (
                      <div style={{ padding: '13px 16px', color: F.sub, fontSize: '0.92rem' }}>{dt('searching')}</div>
                    )}
                    {suggestions.map((s) => (
                      <button key={s.unit_no} onClick={() => { setUnitNo(s.unit_no); setSelectedType(s.type); setShowDrop(false) }}
                              style={fmsDropItem}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 999, flexShrink: 0,
                                         background: s.live ? F.green : F.sub,
                                         boxShadow: s.live ? `0 0 7px ${F.green}` : 'none' }} />
                          <span style={{ fontWeight: 800, fontSize: '1rem', color: F.ink, letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.unit_no}</span>
                        </span>
                        <span style={fmsChip(fleetTypeColor(s.type))}>{s.type_label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* LIVE TRUCK CARD — appears as you type. */}
              <TruckPreviewCard preview={unitPreview} loading={unitPreviewLoading} unitNo={unitNo} dt={dt} />

              {!unitNo.trim() && (
                <div style={{ color: F.sub, fontSize: '0.86rem', marginTop: 10, marginBottom: 12 }}>
                  {dt('pick_hint')}
                </div>
              )}
              {supportedAllowed.length === 0 && unitNo.trim() && (
                <div style={{ color: '#fcd34d', fontSize: '0.86rem', fontWeight: 600, marginTop: 10, marginBottom: 4,
                              background: 'rgba(245,158,11,0.10)', border: `1px solid rgba(245,158,11,0.35)`,
                              borderRadius: 10, padding: '10px 13px' }}>
                  ⚠ {dt('not_auth_advisory')}
                </div>
              )}

              <button onClick={() => connectUnit(unitNo, selectedType)} disabled={loading || !unitNo.trim() || connectBlocked}
                      style={{ ...fmsBigPrimaryBtn(loading || !unitNo.trim() || connectBlocked), marginTop: 14 }}>
                {loading ? dt('connecting')
                  : connectBlocked ? dt('unit_unavailable')
                  : `${dt('connect_to')} ${unitNo.trim() || dt('unit_word')}`}
              </button>
            </div>

            <button onClick={backToOperator} style={fmsGhostBtnBig}>{dt('different_emp')}</button>
          </>
        )}

        {error && (
          <div style={{ ...fmsCard, borderColor: 'rgba(239,68,68,0.5)', background: 'rgba(239,68,68,0.08)',
                        color: '#fca5a5', fontWeight: 600, fontSize: '0.95rem', display: 'flex',
                        alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.2rem' }}>⚠</span>{error}
          </div>
        )}
      </div>

      {/* ── FULL-SCREEN "CONNECTING…" SPLASH ── */}
      {connecting && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(5,8,14,0.94)',
                      backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 26 }} className="fade-in">
          <img src={prismLogo} alt="PRISM" style={{ height: 54, width: 'auto', opacity: 0.95 }} className="pulse" />
          <Spinner size={64} color={F.gold} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: F.ink, fontWeight: 800, fontSize: '1.4rem', letterSpacing: '0.01em' }}>
              {dt('connecting_splash')}
            </div>
            {unitNo.trim() && (
              <div style={{ color: F.gold, fontWeight: 800, fontSize: '1.1rem', marginTop: 6, letterSpacing: '0.05em' }}>
                {unitNo.trim().toUpperCase()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── shared board/operator-view shapes ─────────────────────────────────────
type OpTruck = {
  truck_no: string; driver_name?: string | null; zone: string
  distance_m?: number | null; live?: boolean; connected?: boolean; plan_status?: string
  state?: string; state_label?: string; state_color?: string; time_in_state_s?: number | null
  lat?: number | null; lng?: number | null
  reporting?: boolean; departed?: boolean; last_zone?: string | null; zone_changed?: string | null
  driver_trips_today?: number | null
  // True when this truck is a dispatch-SIMULATOR unit (DTSIM1): its position comes
  // from the server simulation feed, never the tablet's GPS. See dispatch_service
  // build_board / resolve_unit `sim`.
  sim?: boolean
}
type OpExcavator = {
  excavator_no?: string; plan_id?: number; shift?: string; plan_date?: string | null
  loading_location_name?: string | null; dump_location_name?: string | null
  loading_zone_m?: number; waiting_zone_m?: number; discovery_zone_m?: number
  lat?: number | null; lng?: number | null
  loading_lat?: number | null; loading_lng?: number | null
  dump_lat?: number | null; dump_lng?: number | null; dump_zone_m?: number
  exc_status?: string; exc_status_color?: string; exc_status_label?: string; next_truck_no?: string | null
} | null

// ════════════════════════════════════════════════════════════════════════
//  TRUCK DRIVER WINDOW
// ════════════════════════════════════════════════════════════════════════
function TruckDriverWindow({ employeeId, truckNo, viewMode, setViewMode }:
  { employeeId: string; truckNo: string; driverName?: string;
    viewMode: 'map' | 'status'; setViewMode: (m: 'map' | 'status') => void }) {
  const dt = useDispatchT()
  const [truck, setTruck] = useState<OpTruck | null>(null)
  const [planId, setPlanId] = useState<number | null>(null)
  const [excavatorNo, setExcavatorNo] = useState<string | null>(null)
  const [loadingLoc, setLoadingLoc] = useState<string | null>(null)
  const [dumpLoc, setDumpLoc] = useState<string | null>(null)
  const [geo, setGeo] = useState<{ excLat?: number | null; excLng?: number | null; loadLat?: number | null; loadLng?: number | null; dumpLat?: number | null; dumpLng?: number | null; loadingZoneM?: number; waitingZoneM?: number; discoveryZoneM?: number; dumpZoneM?: number }>({})
  const [tel, setTel] = useState<{ lat?: number; lng?: number; speed?: number; course?: number; sim?: boolean } | null>(null)
  const [roads, setRoads] = useState<GeoJSON.FeatureCollection | null>(null)
  const [routePts, setRoutePts] = useState<[number, number][] | null>(null)
  const [routeSegments, setRouteSegments] = useState<{ lane: string; coordinates: [number, number][] }[] | null>(null)
  const [otherLoading, setOtherLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [msg, setMsg] = useState('')
  // Dumping-scenario: brief "Dumping Confirmed" success flash after Finish Dumping.
  const [dumpConfirmed, setDumpConfirmed] = useState(false)
  const [manual, setManual] = useState<{ status: string; reason?: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [gpsNote, setGpsNote] = useState(false)
  // Count of this truck's actions still waiting in the offline outbox, polled on
  // the existing tick. Drives the "N pending sync" badge so the driver knows a
  // tap was saved (not lost) while offline.
  const [pendingCount, setPendingCount] = useState(0)
  // Online/offline (the cab's own reachability probe) + the device's own GPS fix.
  // When offline, the local cycle engine drives state from the phone's GPS; when
  // online the server operator-view is authoritative and overwrites local state.
  const [online, setOnline] = useState<boolean>(() => connectionManager.getStatus().isOnline)
  const [deviceFix, setDeviceFix] = useState<DeviceFix | null>(null)
  const [engineActive, setEngineActive] = useState(false)
  // Refs the engine reads without re-subscribing every GPS tick.
  const stateRef = useRef<string | undefined>(undefined)
  const geoRef = useRef<CycleGeo>({})
  const planRef = useRef<number | null>(null)
  const excRef = useRef<string | null>(null)
  const target = useRef(truckNo.trim().toUpperCase())
  useEffect(() => { target.current = truckNo.trim().toUpperCase() }, [truckNo])

  // Keep the engine's input refs in sync with the latest server-known state so a
  // GPS fix can compute the next transition without re-running its effect.
  useEffect(() => { stateRef.current = truck?.state }, [truck?.state])
  useEffect(() => { geoRef.current = geo }, [geo])
  useEffect(() => { planRef.current = planId }, [planId])
  useEffect(() => { excRef.current = excavatorNo }, [excavatorNo])

  // Track the cab's own reachability (offline → the GPS engine takes over).
  useEffect(() => {
    const cb = (s: ConnectionStatus) => setOnline(s.isOnline)
    connectionManager.addStatusListener(cb)
    setOnline(connectionManager.getStatus().isOnline)
    return () => connectionManager.removeStatusListener(cb)
  }, [])

  // Poll the device's OWN GPS (the always-on location watcher already keeps it).
  // Used as the offline-first truck position + the cycle engine's input. Cheap:
  // it just reads a module-level fix, no new GPS request.
  useEffect(() => {
    let alive = true
    const poll = () => {
      import('../services/locationShare')
        .then((m) => {
          const f = m.getLastFix()
          if (alive && f) setDeviceFix({ lat: f.lat, lng: f.lng, ts: f.ts, heading: f.heading })
        })
        .catch(() => { /* location share unavailable */ })
    }
    poll()
    const stop = visibleInterval(poll, 5000)
    return () => { alive = false; stop() }
  }, [])

  // OFFLINE CYCLE ENGINE. When the cab is offline (and we have a device fix +
  // cached geo), derive forward-only cycle transitions locally and enqueue them
  // to the outbox. The manual action button always overrides; while ONLINE this
  // is dormant (the server operator-view tick is authoritative).
  // SIM unit? Its position is the server simulation feed — NEVER the tablet GPS.
  // Sourced from the board row (truck.sim) or the live resolver (tel.sim) so the
  // flag is set the moment either feed identifies the unit as synthetic.
  const isSim = !!(truck?.sim || tel?.sim)

  useEffect(() => {
    // A SIM unit must NEVER run the device-GPS offline engine (the simulator feed
    // is authoritative even with no signal — the pit dead-zone leak). Real units
    // keep the legacy offline behaviour.
    if (!shouldUseDeviceFix(isSim, online, !!deviceFix)) { setEngineActive(false); return }
    if (!deviceFix) { setEngineActive(false); return }
    const cur = stateRef.current as CycleState | undefined
    const g = geoRef.current
    if (!cur) return
    // Need a destination anchor to compute zones (shovel for inbound, dump for
    // the post-load leg). If neither is cached we can't drive — stay manual.
    const haveExc = g.excLat != null && g.excLng != null
    const haveDump = g.dumpLat != null && g.dumpLng != null
    if (!haveExc && !haveDump) { setEngineActive(false); return }
    setEngineActive(true)
    const res = advanceOffline(cur, deviceFix, g, {
      plan_id: planRef.current, truck_no: target.current, excavator_no: excRef.current,
    })
    if (res.events.length === 0) return
    // Apply the local state immediately (so the UI/map keep moving offline) and
    // enqueue the SAME transitions the server would have raised.
    if (res.next !== cur) {
      setTruck((t) => t ? { ...t, state: res.next, state_color: undefined, state_label: undefined } : t)
    }
    for (const ev of res.events) {
      submitCycleEvent({
        kind: ev.kind, plan_id: ev.plan_id, truck_no: ev.truck_no, excavator_no: ev.excavator_no,
        status: ev.status, zone_type: ev.zone_type, event_type: ev.event_type, distance_m: ev.distance_m,
      }).catch(() => { /* queued for replay */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, deviceFix, isSim])

  useEffect(() => {
    let alive = true
    function pick(trucks: OpTruck[]) { return trucks.find((t) => (t.truck_no || '').trim().toUpperCase() === target.current) }
    function applyExc(exc: OpExcavator, mine: OpTruck) {
      setTruck({ ...mine, connected: true })
      setPlanId(exc?.plan_id ?? null); setExcavatorNo(exc?.excavator_no ?? null)
      setLoadingLoc(exc?.loading_location_name ?? null); setDumpLoc(exc?.dump_location_name ?? null)
      setShiftDate(exc?.shift, exc?.plan_date)
      setGeo({ excLat: exc?.lat, excLng: exc?.lng, loadLat: exc?.loading_lat, loadLng: exc?.loading_lng,
               dumpLat: exc?.dump_lat, dumpLng: exc?.dump_lng,
               loadingZoneM: exc?.loading_zone_m, waitingZoneM: exc?.waiting_zone_m,
               discoveryZoneM: exc?.discovery_zone_m, dumpZoneM: exc?.dump_zone_m })
    }
    async function tick() {
      try {
        const r = await apiFetch(`/api/dispatch/operator-view?employee_id=${encodeURIComponent(employeeId)}`)
        const d = await r.json()
        if (!alive) return
        if (d.success && Array.isArray(d.trucks)) {
          const mine = pick(d.trucks as OpTruck[])
          if (mine) {
            applyExc(d.excavator as OpExcavator, mine)
            setOtherLoading((d.trucks as OpTruck[]).some((t) => t.truck_no !== mine.truck_no && t.state === 'loading'))
            setErr(null); return
          }
        }
        const br = await apiFetch('/api/dispatch/board')
        const bd = await br.json()
        if (!alive) return
        if (bd && Array.isArray(bd.excavators)) {
          for (const exc of bd.excavators) {
            const mine = pick(exc.trucks || [])
            if (mine) { applyExc(exc as OpExcavator, mine); setOtherLoading(false); setErr(null); return }
          }
        }
        setTruck(null); setErr(dt('truck_not_in_plan'))
      } catch { if (alive) setErr('network error') }
    }
    tick()
    const stop = visibleInterval(tick, 5000)
    return () => { alive = false; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId])

  // Poll the offline outbox for THIS truck's queued actions (works offline,
  // unlike the network tick) so the "pending sync" badge stays live.
  useEffect(() => {
    let alive = true
    const scope = truckNo.trim().toUpperCase()
    const poll = () => {
      DispatchOutbox.getPendingCountByScope(scope)
        .then((n) => { if (alive) setPendingCount(n) })
        .catch(() => { /* outbox unavailable */ })
    }
    poll()
    const stop = visibleInterval(poll, 3000)
    return () => { alive = false; stop() }
  }, [truckNo])

  // Live telemetry (position / speed / heading) from the TMS resolver.
  useEffect(() => {
    let alive = true
    async function pull() {
      try {
        const r = await apiFetch(`/api/dispatch/resolve-unit?unit_no=${encodeURIComponent(truckNo)}`)
        const d = await r.json()
        if (!alive) return
        const t = d?.tms
        if (t && t.lat != null && t.lng != null) setTel({ lat: t.lat, lng: t.lng, speed: t.speed, course: t.course, sim: !!t.sim })
      } catch { /* offline */ }
    }
    pull()
    const stop = visibleInterval(pull, 5000)
    return () => { alive = false; stop() }
  }, [truckNo])

  // Best-effort haul-road lanes overlay (lights up once the backend ships it).
  useEffect(() => {
    let alive = true
    apiFetch('/api/dispatch/roads').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.type === 'FeatureCollection') setRoads(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    apiFetch(`/api/dispatch/equipment-status?unit_no=${encodeURIComponent(truckNo)}`)
      .then((r) => r.json()).then((d) => { if (alive && d.success && d.status) setManual(d.status) })
      .catch(() => {})
    return () => { alive = false }
  }, [truckNo])

  async function run(act: DriverAct) {
    if (!truck) return
    setActing(true); setMsg('')
    try {
      if (act.kind === 'first_bucket') {
        const res = await submitDispatchAction({
          kind: 'loading_start',
          endpoint: '/api/dispatch/loading/start',
          scopeKey: truck.truck_no,
          payload: { plan_id: planId, truck_no: truck.truck_no, excavator_no: excavatorNo, employee_id: employeeId },
          expectedState: 'loading',
        })
        if (res.ok && res.applied) {
          setMsg('✓'); setTruck((t) => t ? { ...t, state: 'loading', state_color: undefined, state_label: undefined } : t)
        } else if (res.ok && !res.applied) {                    // queued offline
          setMsg(dt('queued_offline')); setTruck((t) => t ? { ...t, state: 'loading', state_color: undefined, state_label: undefined } : t)
        } else {                                                // rejected
          const d = res.data
          setMsg((d?.reason === 'another_truck_loading') ? dt('another_loading') : (d?.message || 'Could not start loading'))
        }
      } else {
        const res = await submitDispatchAction({
          kind: 'cycle_advance',
          endpoint: '/api/dispatch/cycle-advance',
          scopeKey: truck.truck_no,
          payload: { plan_id: planId, truck_no: truck.truck_no, status: act.next, excavator_no: excavatorNo },
          expectedState: act.next,
        })
        if (res.ok && res.applied) {
          setMsg('✓'); setTruck((t) => t ? { ...t, state: act.next, state_color: undefined, state_label: undefined } : t)
        } else if (res.ok && !res.applied) {                    // queued offline
          setMsg(dt('queued_offline')); setTruck((t) => t ? { ...t, state: act.next, state_color: undefined, state_label: undefined } : t)
        } else {
          setMsg(res.data?.message || 'Action failed')
        }
      }
    } catch { setMsg('Network error') } finally { setActing(false) }
  }

  // ── FINISH DUMPING (Dumping-scenario second tap) ────────────────────────
  // The driver confirms the load was discharged. Closes the dump event (dome
  // queue dwell) + advances dumping -> emptyTravel1 (Travel Empty). Offline-
  // first: submitDispatchAction posts when online and otherwise queues the tap
  // (minted client_event_id/client_ts) for FIFO replay, so it works in the
  // low-signal dome. On success we flash "Dumping Confirmed" then drop the truck
  // to the empty-travel/navigation view.
  async function finishDumping() {
    if (!truck) return
    setActing(true); setMsg('')
    try {
      const res = await submitDispatchAction({
        kind: 'finish_dumping',
        endpoint: '/api/dispatch/finish-dumping',
        scopeKey: truck.truck_no,
        payload: { plan_id: planId, truck_no: truck.truck_no, excavator_no: excavatorNo },
        expectedState: 'emptyTravel1',
      })
      if (res.ok && res.applied) {
        setDumpConfirmed(true)
        setTruck((t) => t ? { ...t, state: 'emptyTravel1', state_color: undefined, state_label: undefined } : t)
        setTimeout(() => setDumpConfirmed(false), 2600)
      } else if (res.ok && !res.applied) {                    // queued offline
        setDumpConfirmed(true)
        setMsg(dt('queued_offline'))
        setTruck((t) => t ? { ...t, state: 'emptyTravel1', state_color: undefined, state_label: undefined } : t)
        setTimeout(() => setDumpConfirmed(false), 2600)
      } else {                                                // rejected
        const d = res.data
        // A reverted/stale truck (left the dome without confirming) is reconciled
        // server-side; surface a short, clear note rather than a hard error.
        setMsg((d?.reason === 'not_at_dump') ? dt('not_at_dump')
              : (d?.stale ? dt('dump_already_done') : (d?.message || 'Could not finish dumping')))
      }
    } catch { setMsg('Network error') } finally { setActing(false) }
  }

  const st = truck?.state
  const v2 = st ? STATE_STYLE[st] : undefined
  // Driver's primary action: normally only First Bucket (everything else auto-
  // advances by GPS). When the driver reports GPS unavailable, surface the manual
  // fallback for the current post-load leg so a stuck truck can be advanced.
  const act = st ? (DRIVER_ACTIONS[st] || (gpsNote ? DRIVER_FALLBACK_ACTIONS[st] : undefined)) : undefined
  const actLabel = st ? dt('drv_' + st) : ''
  const nextStyle = act ? STATE_STYLE[act.next] : undefined
  const nextLabel = nextStyle?.label || act?.next
  const nextColor = nextStyle?.color || D.sub
  const nonOp = manual && manual.status !== 'operating'
  const curColor = truck?.state_color || v2?.color || D.sub
  const curLabel = truck?.state_label || v2?.label || st || '—'

  // Where is this truck headed? Full legs → the dump; otherwise → the shovel.
  const isFull = st ? ['fullTravel1', 'fullWB', 'fullTravel2', 'sampling', 'fullTravel3', 'dumping'].includes(st) : false
  const destKind: 'loading' | 'dump' = isFull ? 'dump' : 'loading'
  const dest = isFull
    ? (geo.dumpLat != null && geo.dumpLng != null ? { lat: geo.dumpLat, lng: geo.dumpLng } : null)
    : (geo.excLat != null && geo.excLng != null ? { lat: geo.excLat, lng: geo.excLng } : null)
  // FIXED assigned loading area (the named loading-location's OWN coordinates),
  // shown as a labelled flag alongside the live shovel on the empty leg. The
  // shovel (`dest`) is the real, moving load point; this is where the plan said
  // to load. Only on the empty leg, and only when the location has coordinates.
  const loadingDest = (!isFull && geo.loadLat != null && geo.loadLng != null)
    ? { lat: geo.loadLat, lng: geo.loadLng } : null
  const geofenceM = isFull ? (geo.dumpZoneM ?? 50) : (geo.loadingZoneM ?? 10)
  // Moving multi-ring geofences (Discovery 100m / Waiting 20m / Loading 10m)
  // around the shovel are LOGIC ONLY — the server classifies the truck's zone
  // from them, but they are intentionally NOT drawn on the driver map (no rings,
  // no legend, no radii shown). The only driver-facing cue is the Reporting /
  // Loaded-Departed banner.
  // Truck position: OFFLINE → trust the phone's own GPS (so the map + engine
  // keep working with no signal); ONLINE → the server TMS resolver (carries
  // speed/course and avoids draining only-this-device battery); finally the
  // last server-known position.
  //
  // SIM units are special: their position is the server simulation feed, so the
  // decision NEVER falls back to the tablet GPS for them — even offline (the pit
  // dead-zone leak). pickTruckPosition centralises the rule (unit-tested).
  const _pos = pickTruckPosition({
    isSim, online,
    deviceFix,
    serverFix: (tel?.lat != null && tel?.lng != null) ? { lat: tel.lat, lng: tel.lng, course: tel.course } : null,
    lastFix: (truck && truck.lat != null && truck.lng != null) ? { lat: truck.lat, lng: truck.lng, course: null } : null,
  })
  const truckPt = _pos.point
  // Position-source for the small map badge (an ICON, not a whole sentence):
  //  - 'tablet'    = this device's own GPS (offline local tracking; real units only)
  //  - 'equipment' = the unit's onboard TMS/GPS — or the SIMULATOR feed — via the server
  //  - 'last'      = stale last-server-known fix (no live source right now)
  //  - null        = no position at all
  const gpsSource: 'tablet' | 'equipment' | 'last' | null = _pos.source
  const speedKph = tel?.speed != null ? Math.max(0, Math.round(tel.speed)) : null
  const nextLocName = isFull ? (dumpLoc || dt('dump_loc')) : (loadingLoc || excavatorNo || dt('shovel'))

  // ── Dumping-scenario geofence: is the truck INSIDE the dump dome right now? ──
  // Distance truck -> dump, from the best live fix (offline device GPS, server
  // TMS, or last-known), compared against the dump geofence radius. Drives the
  // big "Finish Dumping" button, which appears ONLY when state==dumping AND the
  // truck is inside the dome (acceptance criteria) and disappears on a drive-by.
  const dumpDistanceM = (truckPt && geo.dumpLat != null && geo.dumpLng != null)
    ? haversineM(truckPt.lat, truckPt.lng, geo.dumpLat, geo.dumpLng) : null
  const atDump = dumpDistanceM != null && dumpDistanceM <= (geo.dumpZoneM ?? 50)
  // Show the Finish Dumping action when Arrived at Dump and inside the dome. When
  // GPS is unavailable (driver reported it) we still surface it so a stuck truck
  // can confirm by hand; the server re-validates the geofence on submit.
  const showFinishDump = st === 'dumping' && (atDump || gpsNote)


  // Prototype "required action" guidance shown above the Waiting-Event button.
  const reqHint = (() => {
    if (!st) return dt('req_default')
    if (st === 'spot' || st === 'waiting') return dt('req_spot')
    if (st === 'loading') return dt('req_loading')
    if (st === 'fullWB' || st === 'emptyWB') return dt('req_wb')
    if (st === 'sampling') return dt('req_sampling')
    if (st === 'dumping') return dt('req_dumping')
    if (st.startsWith('fullTravel') || st.startsWith('emptyTravel')) return dt('req_travel').replace('{loc}', nextLocName)
    return dt('req_default')
  })()

  // "Road ahead" route along the haul network, truck → destination. Refetched on
  // each leg change (new destination) + every 15 s as the truck advances. Refs
  // keep the latest truck/dest without re-running the effect on every GPS tick.
  const fromRef = useRef(truckPt); fromRef.current = truckPt
  const toRef = useRef(dest); toRef.current = dest
  useEffect(() => {
    let alive = true
    async function fetchRoute() {
      const from = fromRef.current, to = toRef.current
      if (!from || !to) { if (alive) { setRoutePts(null); setRouteSegments(null) } return }
      try {
        // NOTE: no `lane=` param. Lane TYPE (loaded/empty) is decided by the
        // server from the ARROW/flow direction of each segment travelled, NOT by
        // this truck's cargo state. An empty truck may legitimately follow a
        // "loaded" lane; forcing lane=empty here used to mis-colour such routes.
        const r = await apiFetch(`/api/dispatch/route?from_lat=${from.lat}&from_lng=${from.lng}&to_lat=${to.lat}&to_lng=${to.lng}&weight=time`)
        const d = await r.json()
        if (!alive) return
        if (d.available && Array.isArray(d.coordinates) && d.coordinates.length >= 2) {
          setRoutePts(d.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]))
          // curated haul-lane segments (loaded/empty) when available
          setRouteSegments(Array.isArray(d.segments) && d.segments.length ? d.segments : null)
        } else { setRoutePts(null); setRouteSegments(null) }
      } catch { if (alive) { setRoutePts(null); setRouteSegments(null) } }
    }
    fetchRoute()
    const stop = visibleInterval(fetchRoute, 15000)
    return () => { alive = false; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest?.lat, dest?.lng])

  const [shiftDate, setShiftDateRaw] = useState<string>('—')
  const setShiftDate = useCallback((shift?: string | null, planDate?: string | null) => {
    const parts: string[] = []
    if (shift) parts.push(shift)
    if (planDate) {
      try {
        const d = new Date(planDate)
        if (!isNaN(d.getTime())) parts.push(d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }))
      } catch { /* ignore */ }
    }
    setShiftDateRaw(parts.length ? parts.join(' · ') : '—')
  }, [])
  const assignment: Assignment = useMemo(() => ({
    truck_no: truck?.truck_no || truckNo,
    driver_name: truck?.driver_name,
    excavator_no: excavatorNo,
    loading_location_name: loadingLoc,
    dump_location_name: dumpLoc,
    plan_id: planId,
    shift: undefined, // rendered via shiftDate
    plan_date: undefined,
    next_location_name: nextLocName,
    connected: truck?.connected,
    live: truck?.live,
    time_in_state_s: truck?.time_in_state_s,
  }), [truck?.truck_no, truck?.driver_name, truck?.connected, truck?.live, truck?.time_in_state_s, truckNo, excavatorNo, loadingLoc, dumpLoc, planId, nextLocName])

  const statusState: StatusState = useMemo(() => ({
    state: st,
    state_label: curLabel,
    state_color: curColor,
    next_state: act?.next,
    next_label: nextLabel,
    next_color: nextColor,
    manual_status: manual && manual.status !== 'operating' ? {
      status: manual.status,
      reason: manual.reason,
      label: manualMeta(manual.status)?.label,
      color: manualMeta(manual.status)?.color,
    } : null,
  }), [st, curLabel, curColor, act?.next, nextLabel, nextColor, manual])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      {/* MIDDLE: map (~50%) | data (~50%). The operator name lives in the parent
          top bar — no header here (avoids the duplicate name + saves space). */}
      <div style={{ flex: 1, display: 'flex', gap: 10, minHeight: 0 }}>
        {/* LEFT — map/status column, ~50% */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {/* "Not in a plan" notice sits where the old cycle bar was — slim, and
              visible in BOTH map & status modes (the wheel already shows cycle). */}
          {err && !truck && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          background: `${C.amber}14`, border: `1px solid ${C.amber}55`, borderRadius: 10 }}>
              <span style={{ fontSize: '0.95rem' }}>⏳</span>
              <span style={{ color: C.amber, fontWeight: 700, fontSize: '0.82rem' }}>{err}</span>
            </div>
          )}

          {/* Map / Status switch */}
          {!nonOp && (
            <div style={{ flexShrink: 0, display: 'flex', background: D.panel2, border: `1px solid ${D.line}`, borderRadius: 10, padding: 4, gap: 4 }}>
              <button onClick={() => setViewMode('map')} style={{
                flex: 1, padding: '7px 8px', borderRadius: 8, border: 'none', fontWeight: 800, fontSize: '0.78rem',
                color: viewMode === 'map' ? '#0b0f17' : D.sub,
                background: viewMode === 'map' ? '#38BDF8' : 'transparent', cursor: 'pointer',
              }}>MAP</button>
              <button onClick={() => setViewMode('status')} style={{
                flex: 1, padding: '7px 8px', borderRadius: 8, border: 'none', fontWeight: 800, fontSize: '0.78rem',
                color: viewMode === 'status' ? '#0b0f17' : D.sub,
                background: viewMode === 'status' ? '#38BDF8' : 'transparent', cursor: 'pointer',
              }}>STATUS</button>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            {nonOp ? (
              <div style={{ ...panel, height: '100%', boxSizing: 'border-box', border: `1px solid ${manualMeta(manual!.status)?.color}`,
                            background: `${manualMeta(manual!.status)?.color}1A`, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <div style={{ color: D.ink, fontWeight: 900, fontSize: '1.5rem' }}>{dt('ms_' + manual!.status)}</div>
                {manual?.reason && <div style={{ color: D.sub2, fontSize: '0.92rem', marginTop: 6 }}>{dt('reason')}: {manual.reason}</div>}
                <div style={{ color: D.sub, fontSize: '0.85rem', marginTop: 8 }}>{dt('out_of_cycle')}</div>
                {/* The Operator Action panel (which hosts the status trigger) is
                    hidden while non-operating, so expose a direct way back to the
                    cycle right here — otherwise the truck is stuck in breakdown/
                    standby with no path to resume (the status modal's own
                    Return-to-Operating button is unreachable once this banner shows). */}
                <button onClick={() => setStatusOpen(true)}
                        style={{ marginTop: 18, padding: '14px 24px', borderRadius: 14, border: 'none',
                                 background: '#22C55E', color: '#04130a', fontWeight: 900, fontSize: '1.05rem',
                                 cursor: 'pointer', boxShadow: '0 6px 18px rgba(34,197,94,0.35)' }}>
                  {dt('return_operating')}
                </button>
              </div>
            ) : (
              <>
                {/* Map layer — always mounted, opacity-switched for instant
                    toggling. Flat 2D nav map (heading-up, follows the truck). */}
                <div style={{
                  position: 'absolute', inset: 0, opacity: viewMode === 'map' ? 1 : 0,
                  pointerEvents: viewMode === 'map' ? 'auto' : 'none', zIndex: viewMode === 'map' ? 1 : 0,
                  transition: 'opacity 0.12s ease',
                }}>
                  <Suspense fallback={<div style={{ position: 'absolute', inset: 0, background: D.panel2,
                                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 color: D.sub, fontSize: '0.82rem', fontWeight: 700 }}>{dt('loading') || 'Loading map…'}</div>}>
                    <NavMap truck={truckPt} dest={dest} loadingDest={loadingDest} loadingLabel={loadingLoc}
                            geofenceM={geofenceM} lane={isFull ? 'full' : 'empty'}
                            destKind={destKind} stateColor={curColor} dumping={st === 'dumping'} route={routePts} routeSegments={routeSegments} roads={roads}
                            height="100%" visible={viewMode === 'map'} />
                  </Suspense>
                </div>
                {viewMode === 'map' && speedKph != null && (
                  <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 500, background: 'rgba(8,12,20,0.78)',
                                border: `1px solid ${D.line2}`, borderRadius: 12, padding: '6px 12px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 900, color: speedKph > 0 ? '#86EFAC' : D.ink, lineHeight: 1 }}>{speedKph}</span>
                    <span style={{ color: D.sub, fontSize: '0.62rem', fontWeight: 700 }}>km/h</span>
                  </div>
                )}
                {/* GPS-SOURCE ICON — a small glyph (NOT a whole text line) telling
                    the driver where the map position is coming from: 📡 = the unit's
                    onboard equipment/TMS GPS, 📱 = this tablet's own GPS (offline
                    local tracking), ⌛ = a stale last-known fix. */}
                {viewMode === 'map' && gpsSource && (
                  <GpsSourceBadge source={gpsSource} label={dt(`gps_src_${gpsSource}`)} />
                )}
                {/* Moving-geofence rings (Discovery/Waiting/Loading) are LOGIC ONLY
                    — deliberately NOT drawn on the driver map nor shown as a legend.
                    The server still classifies the truck's zone; the only driver-
                    facing cue is the Reporting/Departed banner below. */}
                {/* NOTE: there is intentionally NO driver "wrong way" alert. On a
                    dedicated one-way haul road the driver physically CANNOT travel
                    against traffic, so a per-truck alarm would almost always be a
                    false alarm caused by a lane's arrow being drawn backwards on the
                    map — a DISPATCHER map-QA issue (flip the arrow in the Road
                    Network editor), not something to nag the driver about. */}
                {/* Approach / departure cue banner (Reporting → Loaded/Departed). */}
                {viewMode === 'map' && (truck?.reporting || truck?.departed) && (
                  <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 500,
                                background: truck?.departed ? 'rgba(134,239,172,0.16)' : 'rgba(56,189,248,0.16)',
                                border: `1px solid ${truck?.departed ? '#86EFAC' : '#38BDF8'}`, borderRadius: 12, padding: '7px 12px',
                                display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.9rem' }}>{truck?.departed ? '✅' : '📡'}</span>
                    <span style={{ color: truck?.departed ? '#86EFAC' : '#38BDF8', fontWeight: 900, fontSize: '0.74rem', letterSpacing: '0.04em' }}>
                      {truck?.departed ? dt('departed') : dt('reporting')}
                    </span>
                  </div>
                )}
                {/* Status layer — always mounted, opacity-switched */}
                <div style={{
                  position: 'absolute', inset: 0, opacity: viewMode === 'status' ? 1 : 0,
                  pointerEvents: viewMode === 'status' ? 'auto' : 'none', zIndex: viewMode === 'status' ? 1 : 0,
                  transition: 'opacity 0.12s ease',
                }}>
                  <TruckStatusPanel status={statusState} assignment={assignment} />
                </div>
              </>
            )}
          </div>
          {/* current / next / next-location — compact line (boxes removed).
              Hidden in STATUS mode (the wheel's hub already shows it). */}
          {viewMode !== 'status' && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 4, columnGap: 16, padding: '2px 4px' }}>
              <StateLine label={dt('current_state')} value={nonOp ? dt('ms_' + manual!.status) : curLabel} color={nonOp ? (manualMeta(manual!.status)?.color || D.sub) : curColor} />
              <StateLine label={dt('next_location')} value={nextLocName} color={D.accent} />
            </div>
          )}
        </div>

        {/* RIGHT — data column, ~50% (action · status · assignment; no scroll).
            Always visible: STATUS only swaps the LEFT map box for the wheel. */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {!nonOp && (
            <div style={{ ...panel, flexShrink: 0, padding: 12, border: `1px solid ${curColor}55`,
                          background: '#101820', boxShadow: `0 0 0 1px ${curColor}1f` }}>
              {/* OPERATOR ACTION header + the per-state guidance (prototype).
                  Accent follows the CURRENT cycle-status colour. */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: curColor, fontSize: '1rem', lineHeight: 1.1 }}>▸</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: curColor, fontWeight: 800, fontSize: '0.62rem', letterSpacing: '0.1em' }}>{dt('operator_action')}</div>
                  <div style={{ color: D.ink, fontWeight: 700, fontSize: '0.92rem', lineHeight: 1.25, marginTop: 2 }}>{reqHint}</div>
                </div>
              </div>

              {(dumpConfirmed || showFinishDump) ? (
                dumpConfirmed ? (
                  // SUCCESS FLASH — "Dumping Confirmed" before the view drops to
                  // the empty-travel navigation. High-contrast green, gloves-size.
                  <div style={{ marginTop: 12, minHeight: 92, borderRadius: 16,
                                background: '#16A34A', border: '1px solid #22C55E',
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                justifyContent: 'center', textAlign: 'center', padding: '12px 14px',
                                boxShadow: '0 8px 22px rgba(34,197,94,0.45)' }}>
                    <div style={{ color: '#fff', fontWeight: 900, fontSize: '1.35rem', letterSpacing: '0.02em' }}>
                      ✓ {dt('dump_confirmed')}
                    </div>
                    <div style={{ color: '#dcfce7', fontSize: '0.82rem', marginTop: 4 }}>{dt('dump_travel_empty')}</div>
                  </div>
                ) : (
                  // FINISH DUMPING — the Dumping-scenario second tap. Large,
                  // high-contrast green, gloves-friendly. Shown ONLY at the dome.
                  <button onClick={finishDumping} disabled={acting}
                          style={{ ...bigBtn('#16A34A', acting), minHeight: 96, fontSize: '1.4rem', marginTop: 12 }}>
                    {acting ? dt('recording') : dt('finish_dumping')}
                  </button>
                )
              ) : act ? (
                <button onClick={() => run(act)} disabled={acting || (act.kind === 'first_bucket' && otherLoading)}
                        style={{ ...bigBtn(act.color, acting || (act.kind === 'first_bucket' && otherLoading)), minHeight: 92, fontSize: '1.35rem', marginTop: 12 }}>
                  {acting ? dt('recording')
                    : (act.kind === 'first_bucket' && otherLoading) ? dt('another_loading')
                    : actLabel}
                </button>
              ) : (
                <div style={{ marginTop: 12, minHeight: 92, borderRadius: 16, background: D.panel2, border: `1px dashed ${D.line2}`,
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '12px 14px' }}>
                  <div style={{ color: D.sub, fontWeight: 800, fontSize: '0.92rem', letterSpacing: '0.04em' }}>{dt('waiting_event')}</div>
                  <div style={{ color: D.sub2, fontSize: '0.82rem', marginTop: 4 }}>
                    {st === 'loading' ? dt('loading_in_progress') : st === 'waiting' ? dt('waiting_bucket') : dt('no_action')}
                  </div>
                </div>
              )}
              {msg && msg !== '✓' && <div style={{ fontSize: '0.8rem', color: msg.includes('✓') ? '#86EFAC' : '#FCA5A5', textAlign: 'center', marginTop: 6 }}>{msg}</div>}
              {pendingCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 8,
                              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                              borderRadius: 10, padding: '6px 10px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: '#f59e0b',
                                 boxShadow: '0 0 7px #f59e0b' }} />
                  <span style={{ color: '#fcd34d', fontSize: '0.74rem', fontWeight: 800 }}>
                    {pendingCount} {dt('pending_sync')}
                  </span>
                </div>
              )}
              {engineActive && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 8,
                              background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.4)',
                              borderRadius: 10, padding: '6px 10px' }}>
                  <span style={{ fontSize: '0.85rem' }}>📡</span>
                  <span style={{ color: '#7dd3fc', fontSize: '0.72rem', fontWeight: 800 }}>
                    {dt('offline_local_gps')}
                  </span>
                </div>
              )}
              {/* secondary actions UNDER the action/waiting-event */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => setStatusOpen(true)} style={secBtn}>Request Status Change</button>
                <button onClick={() => setGpsNote((v) => !v)} style={secBtn}>Report GPS Unavailable</button>
              </div>
              {gpsNote && <div style={{ color: D.sub2, fontSize: '0.72rem', marginTop: 6 }}>Manual mode — confirm arrival with the action button above if GPS/RFID auto-arrival is unavailable.</div>}
            </div>
          )}

          <div style={{ flexShrink: 0 }}>
            <ManualStatusControl unitNo={truckNo} unitType="dump_truck" employeeId={employeeId} hideTrigger
                                 current={manual} open={statusOpen} onOpenChange={setStatusOpen}
                                 onChange={(status, reason) => setManual({ status, reason })} />
          </div>

          {/* ASSIGNMENT — fills remaining space; grid shrinks to fit, never clips */}
          <div style={{ ...panel, flex: '1 1 0', minHeight: 0, overflow: 'hidden', padding: 8, display: 'flex', flexDirection: 'column' }}>
            <SectionLabel icon="📍" text="ASSIGNMENT" />
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: 'minmax(0, 1fr)', gap: 6, marginTop: 7 }}>
              <MiniTile k="Truck ID" v={truck?.truck_no || truckNo} />
              <MiniTile k="Driver" v={truck?.driver_name || '—'} />
              <MiniTile k="Assigned Excavator" v={excavatorNo || '—'} />
              <MiniTile k="Trips Today" v={String(truck?.driver_trips_today ?? 0)} />
              <MiniTile k="Loading Source" v={loadingLoc || '—'} />
              <MiniTile k="Dump Location" v={dumpLoc || '—'} />
              <MiniTile k="Shift / Date" v={shiftDate} />
              <MiniTile k="Next Location" v={nextLocName} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── OUI presentational helpers (top-bar pills, cycle stepper, bottom chips) ──
// Compact assignment tile (denser than Tile) so the grid fits with no scroll.
const MiniTile = memo(function MiniTile({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ background: D.panel2, border: `1px solid ${D.line}`, borderRadius: 9,
                  padding: '5px 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  minHeight: 30, minWidth: 0, overflow: 'hidden' }}>
      <div style={{ color: D.sub, fontSize: '0.52rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</div>
      <div style={{ color: D.ink, fontWeight: 800, fontSize: '0.82rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
    </div>
  )
})
const SectionLabel = memo(function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F5A524', fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.08em' }}>
      <span>{icon}</span><span>{text}</span>
    </div>
  )
})
// Compact one-line state read-out (replaces the old boxed BottomChips):
// a colour dot + label + value, sitting on a single wrapping line.
const StateLine = memo(function StateLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
      <span style={{ color: D.sub, fontSize: '0.56rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color, fontWeight: 900, fontSize: '0.78rem', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.toUpperCase()}</span>
    </span>
  )
})
// Linear cycle stepper removed — the Status view's haul-cycle wheel is the single
// source of cycle progress (no duplicate bar over the map/status box).
const secBtn: React.CSSProperties = {
  flex: 1, padding: '10px 8px', fontSize: '0.78rem', fontWeight: 700, color: D.sub2,
  background: D.panel2, border: `1px solid ${D.line2}`, borderRadius: 10, cursor: 'pointer',
}

// ════════════════════════════════════════════════════════════════════════
//  EQUIPMENT OUI PANEL — app-only ancillary gear (grader/dozer/etc.)
//  No haul cycle: its whole job is to show + change the manual status, with an
//  always-reachable "Return to Operating". The unit is on the map via the OUI
//  GPS overlay (locationShare scope is set by the parent on connect).
// ════════════════════════════════════════════════════════════════════════
function EquipmentOuiPanel({ employeeId, unitNo, unitType }:
  { employeeId: string; unitNo: string; unitType?: string; operatorName?: string }) {
  const dt = useDispatchT()
  const [manual, setManual] = useState<{ status: string; reason?: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)

  // Restore the last manual status after a reload (matches the truck OUI).
  useEffect(() => {
    let alive = true
    apiFetch(`/api/dispatch/equipment-status?unit_no=${encodeURIComponent(unitNo)}`)
      .then((r) => r.json()).then((d) => { if (alive && d.success && d.status) setManual(d.status) })
      .catch(() => { /* offline / unknown — stays operating */ })
    return () => { alive = false }
  }, [unitNo])

  const cur = manual?.status || 'operating'
  const curMeta = manualMeta(cur)
  const nonOp = cur !== 'operating'
  const typeLabel = equipmentTypeLabel(unitType)
  const typeColor = fleetTypeColor(unitType)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {/* Unit identity card */}
      <div style={{ ...panel, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.5rem', background: `${typeColor}1F`,
                      border: `1px solid ${typeColor}59` }}>🚜</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: D.ink, fontWeight: 900, fontSize: '1.25rem', letterSpacing: '0.03em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unitNo}</div>
          <span style={{ ...chip(typeColor), display: 'inline-block', marginTop: 4 }}>{typeLabel}</span>
        </div>
        <span style={chip(curMeta?.color || '#16A34A')}>{dt('ms_' + cur).toUpperCase()}</span>
      </div>

      {/* Big current-status panel + the primary action */}
      <div style={{ ...panel, flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', alignItems: 'center', gap: 16, textAlign: 'center',
                    borderColor: nonOp ? `${curMeta?.color || D.line2}` : D.line }}>
        <div style={{ color: D.sub, fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.1em' }}>
          {dt('current_state').toUpperCase()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: curMeta?.color || '#16A34A',
                         boxShadow: `0 0 14px ${curMeta?.color || '#16A34A'}` }} />
          <span style={{ color: D.ink, fontWeight: 900, fontSize: '2rem', letterSpacing: '0.02em' }}>
            {dt('ms_' + cur)}
          </span>
        </div>
        {nonOp && manual?.reason && (
          <div style={{ color: D.sub2, fontSize: '0.9rem', fontWeight: 700 }}>{manual.reason}</div>
        )}
        {nonOp && (
          <div style={{ color: D.sub, fontSize: '0.82rem', maxWidth: 360 }}>{dt('out_of_cycle')}</div>
        )}

        {/* Always-visible primary control. When out-of-operating, a direct
            green Return button; otherwise open the change-status modal. */}
        {nonOp ? (
          <button onClick={() => setStatusOpen(true)} style={{ ...bigBtn('#16A34A', false), maxWidth: 420 }}>
            {dt('return_operating')}
          </button>
        ) : (
          <button onClick={() => setStatusOpen(true)} style={{ ...bigBtn(D.accent, false), maxWidth: 420 }}>
            {dt('change_status')}
          </button>
        )}
      </div>

      {/* The shared status modal (trigger hidden — the buttons above open it). */}
      <ManualStatusControl unitNo={unitNo} unitType={unitType || 'other'} employeeId={employeeId} hideTrigger
                           current={manual} open={statusOpen} onOpenChange={setStatusOpen}
                           onChange={(status, reason) => setManual({ status, reason })} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  MANUAL STATUS CONTROL (compact trigger + modal — saves vertical space)
// ════════════════════════════════════════════════════════════════════════
function ManualStatusControl({ unitNo, unitType, employeeId, current, onChange, open: openProp, onOpenChange, hideTrigger }:
  { unitNo: string; unitType: string; employeeId: string
    current: { status: string; reason?: string } | null
    onChange: (status: string, reason?: string) => void
    open?: boolean; onOpenChange?: (o: boolean) => void; hideTrigger?: boolean }) {
  const dt = useDispatchT()
  const [openLocal, setOpenLocal] = useState(false)
  const open = openProp !== undefined ? openProp : openLocal
  const setOpen = (o: boolean) => { if (onOpenChange) onOpenChange(o); else setOpenLocal(o) }
  const [pick, setPick] = useState<ManualStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const cur = current?.status || 'operating'
  const curMeta = manualMeta(cur)

  async function send(status: ManualStatus, reason?: string) {
    setBusy(true)
    try {
      const res = await submitDispatchAction({
        kind: 'equipment_status',
        endpoint: '/api/dispatch/equipment-status',
        scopeKey: unitNo,
        payload: { unit_no: unitNo, unit_type: unitType, status, reason, employee_id: employeeId },
      })
      // Applied online OR queued offline → reflect locally either way (the
      // outbox guarantees it lands on reconnect). Only a hard reject keeps the
      // modal open.
      if (res.ok) { onChange(status, reason); setOpen(false); setPick(null) }
    } catch { /* keep open */ } finally { setBusy(false) }
  }

  return (
    <>
      {!hideTrigger && (
      <button onClick={() => setOpen(true)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                       background: D.panel, border: `1px solid ${cur === 'operating' ? D.line : (curMeta?.color || D.line)}`,
                       borderRadius: 12, padding: '10px 12px', cursor: 'pointer' }}>
        <span style={{ color: D.sub, fontSize: '0.66rem', letterSpacing: '0.06em', fontWeight: 800 }}>{dt('machine_availability')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={chip(curMeta?.color || '#16A34A')}>{dt('ms_' + cur).toUpperCase()}</span>
          <span style={{ color: D.accent, fontSize: '0.72rem', fontWeight: 800 }}>{dt('change_status')} ›</span>
        </span>
      </button>
      )}

      {open && (
        <div onClick={() => { setOpen(false); setPick(null) }}
             style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(2,6,12,0.78)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
                      backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: '100%', maxWidth: 480, background: D.panel, border: `1px solid ${D.line2}`,
                        borderRadius: 20, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ color: D.ink, fontWeight: 900, fontSize: '1.05rem' }}>{dt('machine_availability')}</div>
              <span style={chip(curMeta?.color || '#16A34A')}>{dt('ms_' + cur).toUpperCase()}</span>
            </div>
            <div style={{ color: D.sub, fontSize: '0.72rem', marginBottom: 16 }}>{unitNo}</div>

            {cur !== 'operating' && (
              <button onClick={() => send('operating')} disabled={busy}
                      style={{ width: '100%', minHeight: 54, borderRadius: 14, marginBottom: 14, cursor: 'pointer',
                               border: '1px solid #16A34A', background: '#16A34A', color: '#fff',
                               fontWeight: 900, fontSize: '0.98rem', display: 'flex', alignItems: 'center',
                               justifyContent: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />
                {busy ? '…' : dt('return_operating')}
              </button>
            )}

            <div style={{ color: D.sub, fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8 }}>
              {dt('select_status').toUpperCase()}
            </div>
            {/* Color-coded status cards — one per row, with a status dot. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {MANUAL_STATUSES.filter((m) => m.value !== 'operating').map((m) => {
                const active = pick === m.value
                return (
                  <button key={m.value} onClick={() => setPick(m.value)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                                   minHeight: 50, padding: '0 14px', borderRadius: 13, textAlign: 'left',
                                   border: `2px solid ${active ? m.color : D.line2}`,
                                   background: active ? `${m.color}22` : D.panel2 }}>
                    <span style={{ width: 13, height: 13, borderRadius: '50%', background: m.color, flexShrink: 0,
                                   boxShadow: active ? `0 0 8px ${m.color}` : 'none' }} />
                    <span style={{ color: D.ink, fontWeight: 800, fontSize: '0.96rem' }}>{dt('ms_' + m.value)}</span>
                    {active && <span style={{ marginLeft: 'auto', color: m.color, fontWeight: 900 }}>✓</span>}
                  </button>
                )
              })}
            </div>

            {pick && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${D.line2}` }}>
                <div style={{ color: D.sub, fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8 }}>
                  {dt('reason').toUpperCase()}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(STATUS_REASONS[pick] || ['Other']).map((rsn) => (
                    <button key={rsn} onClick={() => send(pick, rsn)} disabled={busy}
                            style={{ padding: '10px 14px', borderRadius: 11, cursor: 'pointer', fontWeight: 800, fontSize: '0.84rem',
                                     border: `1px solid ${manualMeta(pick)?.color || D.sub}66`,
                                     background: `${manualMeta(pick)?.color || D.sub}14`, color: D.ink }}>
                      {rsn}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setOpen(false); setPick(null) }} style={{ ...ghostBtn, color: D.sub, marginTop: 16 }}>{dt('cancel')}</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── styles ────────────────────────────────────────────────────────────────
// ── FMS sign-on style helpers (dark shell, gold accent — matches web FMS) ──
const fmsCard: React.CSSProperties = {
  background: F.panel, borderRadius: 16, padding: 18,
  border: `1px solid ${F.line}`, boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
}
const fmsLabel: React.CSSProperties = {
  display: 'block', fontSize: '0.74rem', fontWeight: 800, color: F.sub,
  textTransform: 'uppercase', letterSpacing: '0.06em',
}
const fmsDrop: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20,
  background: F.panelHi, border: `1px solid ${F.line2}`, borderRadius: 12,
  boxShadow: '0 18px 40px rgba(0,0,0,0.5)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
}
const fmsDropItem: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '12px 14px', background: 'transparent', border: 'none', borderBottom: `1px solid ${F.line}`,
  cursor: 'pointer', textAlign: 'left',
}
// ── Industrial sign-on: gloves-size inputs/buttons (>=64px targets, 22px+ text) ──
const fmsInputBig: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '18px 18px', fontSize: '1.4rem', minHeight: 64,
  color: F.ink, background: F.bg2, border: `2px solid ${F.line2}`, borderRadius: 14,
  marginBottom: 14, outline: 'none', WebkitTextFillColor: F.ink as unknown as string,
  fontWeight: 700, caretColor: F.gold,
}
function fmsBigPrimaryBtn(disabled: boolean): React.CSSProperties {
  return {
    width: '100%', minHeight: 68, padding: '18px 16px', fontSize: '1.22rem', fontWeight: 800,
    letterSpacing: '0.01em', color: disabled ? '#64748b' : '#1a1205',
    background: disabled ? '#1f2937' : `linear-gradient(180deg, ${F.goldHi}, ${F.gold})`,
    border: disabled ? `1px solid ${F.line}` : 'none', borderRadius: 14,
    cursor: disabled ? 'default' : 'pointer', marginTop: 4,
    boxShadow: disabled ? 'none' : '0 8px 22px rgba(245,165,36,0.28)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  }
}
const fmsGhostBtnBig: React.CSSProperties = {
  width: '100%', minHeight: 64, padding: '16px', fontSize: '1.02rem', fontWeight: 700, color: F.sub2,
  background: 'transparent', border: `1px solid ${F.line2}`, borderRadius: 14, cursor: 'pointer',
}
// First word of a name (for "Continue as <FirstName>" on the confirm button).
function firstWord(name?: string): string {
  return (name || '').trim().split(/\s+/)[0] || ''
}

// ════════════════════════════════════════════════════════════════════════
//  STEP 1 — LIVE OPERATOR PREVIEW CARD (appears as the ID is typed)
//  Soft-green tint when an operator is resolved, red tint on "not found",
//  neutral while loading. Shows name, dept, KIMPER pill, initials avatar.
// ════════════════════════════════════════════════════════════════════════
function OperatorPreviewCard({ employeeId, preview, loading, offline, error, dt }:
  { employeeId: string; preview: Profile | null; loading: boolean; offline: boolean
    error: string | null; dt: (k: string) => string }) {
  const typed = employeeId.trim()
  if (!typed) {
    // Empty state — soft grey placeholder.
    return (
      <div style={{ ...previewShell(F.line2), color: F.sub, fontSize: '1rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', minHeight: 76 }}>
        <span style={{ fontSize: '1.2rem', opacity: 0.7 }}>👤</span>{dt('enter_emp_id')}
      </div>
    )
  }
  if (error && !preview) {
    return (
      <div className="shake" style={{ ...previewShell(F.red), background: 'rgba(220,38,38,0.10)',
                    display: 'flex', alignItems: 'center', gap: 12, minHeight: 76 }}>
        <span style={{ fontSize: '1.4rem' }}>⚠</span>
        <span style={{ color: '#fca5a5', fontWeight: 700, fontSize: '1rem' }}>{error}</span>
      </div>
    )
  }
  if (!preview) {
    // Loading.
    return (
      <div style={{ ...previewShell(F.line2), display: 'flex', alignItems: 'center', gap: 14, minHeight: 76 }}>
        <Spinner size={26} />
        <span style={{ color: F.sub, fontWeight: 600, fontSize: '1rem' }}>{dt('checking')}</span>
      </div>
    )
  }
  const kc = statusColor(preview.kimper_status)
  return (
    <div className="fade-in" style={{ ...previewShell(F.green), background: 'rgba(34,197,94,0.07)',
                  display: 'flex', alignItems: 'center', gap: 14, minHeight: 76 }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0, position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.3rem', fontWeight: 800, color: F.gold,
                    background: 'rgba(245,165,36,0.14)', border: `1px solid rgba(245,165,36,0.4)` }}>
        {initialsOf(preview.name, preview.employee_id)}
        {loading && <span style={{ position: 'absolute', right: -4, bottom: -4 }}><Spinner size={16} /></span>}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '1.22rem', fontWeight: 800, color: F.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview.name || '—'}
        </div>
        {[preview.company, preview.department].filter(Boolean).length > 0 && (
          <div style={{ color: F.sub, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[preview.company, preview.department].filter(Boolean).join(' · ')}
          </div>
        )}
        {offline && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4,
                      color: F.amber, fontSize: '0.76rem', fontWeight: 700 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: F.amber }} />{dt('offline_mode')}
        </div>}
      </div>
      <span style={{ ...fmsPill(kc), alignSelf: 'flex-start', fontSize: '0.78rem' }}>
        KIMPER {preview.kimper_status || '—'}
      </span>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
//  STEP 2 — LIVE TRUCK PREVIEW CARD (appears as the unit number is typed)
//  Shows model/type, status (Idle/Active/Maintenance/etc.), assigned shovel,
//  and any operator already connected. Green tint = available, red = blocked.
// ════════════════════════════════════════════════════════════════════════
function TruckPreviewCard({ preview, loading, unitNo, dt }:
  { preview: UnitPreview | null; loading: boolean; unitNo: string; dt: (k: string) => string }) {
  const typed = unitNo.trim()
  if (!typed) return null
  if (!preview) {
    return (
      <div style={{ ...previewShell(F.line2), marginTop: 12, display: 'flex', alignItems: 'center',
                    gap: 14, minHeight: 72 }}>
        <Spinner size={26} color={F.blue} />
        <span style={{ color: F.sub, fontWeight: 600, fontSize: '1rem' }}>{dt('searching')}</span>
      </div>
    )
  }
  // Status semantics: a manual non-operating status wins; otherwise derive from
  // live/cycle. maintenance/breakdown OR another operator → blocked (red).
  const blocked = preview.manual_status === 'maintenance' || preview.manual_status === 'breakdown' || !!preview.current_operator
  const statusInfo = truckStatusInfo(preview, dt)
  const tint = blocked ? F.red : (statusInfo.tone === 'active' ? F.green : statusInfo.tone === 'idle' ? F.blue : F.amber)
  const fleetTint = fleetTypeColor(preview.type || undefined)
  return (
    <div className="fade-in" style={{ ...previewShell(tint), marginTop: 12,
                  background: blocked ? 'rgba(220,38,38,0.08)' : 'rgba(56,189,248,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.7rem',
                      background: `${fleetTint}1F`, border: `1px solid ${fleetTint}59` }}>
          {preview.type === 'excavator' ? '⛏' : preview.type === 'dump_truck' ? '🚛' : '🚜'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: F.ink, letterSpacing: '0.04em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preview.unit_no}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, flexWrap: 'wrap' }}>
            {preview.type_label ? <span style={fmsChip(fleetTint)}>{preview.type_label}</span> : null}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', fontWeight: 800,
                           color: statusInfo.color }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: statusInfo.color,
                             boxShadow: `0 0 7px ${statusInfo.color}` }} />
              {statusInfo.label}
            </span>
          </div>
        </div>
        {loading && <Spinner size={18} color={F.blue} />}
      </div>

      {/* secondary details: assigned shovel + cycle stage */}
      {(preview.assigned_shovel || preview.cycle_label) && !blocked && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {preview.assigned_shovel && (
            <span style={miniFact}>⛏ {dt('assigned_shovel')}: <b style={{ color: F.ink }}>{preview.assigned_shovel}</b></span>
          )}
          {preview.cycle_label && (
            <span style={miniFact}>● {preview.cycle_label}</span>
          )}
        </div>
      )}

      {/* BLOCKING messages — actionable, specific. */}
      {preview.current_operator && (
        <div style={{ marginTop: 12, color: '#fca5a5', fontWeight: 700, fontSize: '0.92rem', lineHeight: 1.4 }}>
          {preview.unit_no} {dt('already_connected_to')} {preview.current_operator}. {dt('contact_dispatcher')}
        </div>
      )}
      {!preview.current_operator && (preview.manual_status === 'maintenance' || preview.manual_status === 'breakdown') && (
        <div style={{ marginTop: 12, color: '#fca5a5', fontWeight: 700, fontSize: '0.92rem', lineHeight: 1.4 }}>
          {preview.unit_no} {preview.manual_status === 'maintenance' ? dt('under_maintenance') : dt('is_down')}.
          {' '}{dt('request_different')}
        </div>
      )}
      {/* advisory (non-blocking) manual status — delay / standby */}
      {!blocked && (preview.manual_status === 'delay' || preview.manual_status === 'standby') && (
        <div style={{ marginTop: 10, color: '#fcd34d', fontWeight: 600, fontSize: '0.86rem' }}>
          ⚠ {dt('ms_' + preview.manual_status)}{preview.manual_reason ? ` · ${preview.manual_reason}` : ''}
        </div>
      )}
    </div>
  )
}

// Derive the in-cab status label/colour/tone for the truck card from the live
// resolve-unit / equipment-status data (existing endpoints only).
function truckStatusInfo(p: UnitPreview, dt: (k: string) => string): { label: string; color: string; tone: 'active' | 'idle' | 'warn' } {
  if (p.manual_status === 'maintenance') return { label: dt('status_maintenance'), color: F.red, tone: 'warn' }
  if (p.manual_status === 'breakdown') return { label: dt('ms_breakdown'), color: F.red, tone: 'warn' }
  if (p.manual_status === 'delay') return { label: dt('ms_delay'), color: F.amber, tone: 'warn' }
  if (p.manual_status === 'standby') return { label: dt('ms_standby'), color: F.amber, tone: 'warn' }
  if (p.current_operator) return { label: dt('status_in_use'), color: F.amber, tone: 'warn' }
  if (p.cycle_label) return { label: dt('status_active'), color: F.green, tone: 'active' }
  if (p.live) return { label: dt('status_idle'), color: F.blue, tone: 'idle' }
  if (p.found) return { label: dt('status_offline'), color: F.sub, tone: 'idle' }
  return { label: dt('status_not_in_feed'), color: F.sub, tone: 'idle' }
}

// Shared shell for the preview cards — rounded, elevated, tinted border.
function previewShell(borderColor: string): React.CSSProperties {
  return {
    marginTop: 6, marginBottom: 6, borderRadius: 14, padding: '14px 16px',
    background: F.panelHi, border: `1.5px solid ${borderColor}66`,
    boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
  }
}
const miniFact: React.CSSProperties = {
  fontSize: '0.82rem', fontWeight: 600, color: F.sub2, background: F.bg2,
  border: `1px solid ${F.line}`, borderRadius: 9, padding: '6px 10px', whiteSpace: 'nowrap',
}
function fmsPill(color: string): React.CSSProperties {
  return { fontSize: '0.68rem', fontWeight: 800, color, background: `${color}22`,
           border: `1px solid ${color}66`, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }
}
function fmsChip(color: string): React.CSSProperties {
  return { fontSize: '0.72rem', fontWeight: 700, color, background: `${color}1F`,
           border: `1px solid ${color}55`, padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap' }
}
function stepDot(n: string, state: 'idle' | 'active' | 'done'): React.ReactNode {
  const isActive = state === 'active', isDone = state === 'done'
  return (
    <span style={{
      width: 24, height: 24, borderRadius: 999, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.74rem', fontWeight: 800,
      color: isActive ? '#1a1205' : isDone ? F.gold : F.sub,
      background: isActive ? F.gold : isDone ? 'rgba(245,165,36,0.15)' : 'transparent',
      border: `1px solid ${isActive || isDone ? F.gold : F.line2}`,
    }}>{isDone ? '✓' : n}</span>
  )
}
const panel: React.CSSProperties = {
  background: D.panel, border: `1px solid ${D.line}`, borderRadius: 14, padding: 14,
}
function bigBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    width: '100%', minHeight: 84, padding: '16px', fontSize: '1.35rem', fontWeight: 900,
    letterSpacing: '0.02em', color: disabled ? '#64748B' : inkOn(color),
    background: disabled ? '#1f2937' : color, border: 'none', borderRadius: 16,
    cursor: disabled ? 'default' : 'pointer', textAlign: 'center',
    boxShadow: disabled ? 'none' : `0 8px 22px ${color}44`,
  }
}
const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '12px', fontSize: '0.9rem', fontWeight: 600, color: C.sub,
  background: 'transparent', border: 'none', marginTop: 4, cursor: 'pointer',
}
function chip(color: string): React.CSSProperties {
  return { fontSize: '0.72rem', fontWeight: 700, color, background: `${color}1F`, border: `1px solid ${color}55`, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }
}

// ── connect-advisory ICON CLUSTER ────────────────────────────────────────────
// The cab top bar used to spell every connect advisory out as a full sentence
// ("Not on KIMPER for this equipment", "Unit currently offline in GPS", ...),
// which ran a whole line wide and crowded the bar. Instead show ONE small,
// colour-coded icon per advisory (deduped by glyph so two KIMPER notes collapse
// to a single 🪪). The driver taps the cluster to reveal the full wording in a
// compact popover. Red dominates amber for the cluster tint; KIMPER sorts first.
function WarnIcons({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false)
  const metas = warnings
    .map((w) => ({ key: w, meta: WARN_META[w] }))
    .filter((x): x is { key: string; meta: WarnMeta } => !!x.meta)
    .sort((a, b) => (b.meta.sev === 'red' ? 1 : 0) - (a.meta.sev === 'red' ? 1 : 0))
  if (!metas.length) return null
  const anyRed = metas.some((m) => m.meta.sev === 'red')
  const tint = anyRed ? C.red : C.amber
  // Dedupe the row by glyph so repeated families show a single icon; keep the
  // worst severity per glyph for its colour.
  const byIcon = new Map<string, 'red' | 'amber'>()
  for (const m of metas) {
    const prev = byIcon.get(m.meta.icon)
    byIcon.set(m.meta.icon, prev === 'red' || m.meta.sev === 'red' ? 'red' : 'amber')
  }
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Connection advisories"
              style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', cursor: 'pointer',
                       background: `${tint}1A`, border: `1px solid ${tint}66`, borderRadius: 999 }}>
        {[...byIcon.entries()].map(([icon, sev]) => (
          <span key={icon} style={{ fontSize: '0.92rem', lineHeight: 1,
                                    filter: sev === 'red' ? 'none' : 'grayscale(0.15)' }}>{icon}</span>
        ))}
        <span style={{ width: 6, height: 6, borderRadius: 999, background: tint,
                       boxShadow: `0 0 6px ${tint}`, marginLeft: 1 }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41,
                        background: F.panelHi, border: `1px solid ${F.line2}`, borderRadius: 12,
                        boxShadow: '0 18px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
                        minWidth: 220, maxWidth: 280, padding: '6px 0' }}>
            {metas.map(({ key, meta }) => {
              const cc = meta.sev === 'red' ? C.red : C.amber
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 13px' }}>
                  <span style={{ fontSize: '1rem', lineHeight: 1.1, flexShrink: 0 }}>{meta.icon}</span>
                  <span style={{ color: cc, fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.3 }}>{meta.full}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── GPS-SOURCE map badge ──────────────────────────────────────────────────────
// A SMALL pill on the map showing where the truck's position comes from, as an
// icon (not a sentence): 📡 onboard equipment/TMS GPS, 📱 this tablet's own GPS,
// ⌛ a stale last-known fix. Tap to reveal the short label. Sits top-right so it
// never collides with the bottom-left speed read-out or the top-left cue banner.
function GpsSourceBadge({ source, label }: { source: 'tablet' | 'equipment' | 'last'; label: string }) {
  const [open, setOpen] = useState(false)
  const ICON: Record<string, string> = { equipment: '📡', tablet: '📱', last: '⌛' }
  const TINT: Record<string, string> = { equipment: '#38BDF8', tablet: '#86EFAC', last: '#9ca3af' }
  const tint = TINT[source]
  return (
    <div style={{ position: 'absolute', right: 12, top: 12, zIndex: 500 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label={label}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                       background: 'rgba(8,12,20,0.78)', border: `1px solid ${tint}66`,
                       borderRadius: 999, padding: open ? '5px 11px 5px 9px' : '5px 9px' }}>
        <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>{ICON[source]}</span>
        {open && <span style={{ color: tint, fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>{label}</span>}
      </button>
    </div>
  )
}
