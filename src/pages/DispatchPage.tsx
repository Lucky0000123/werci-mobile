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
import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { apiFetch } from '../services/api'
import connectionManager from '../services/connectionManager'
import type { ConnectionStatus } from '../services/connectionManager'
import { buildOfflineProfile } from '../services/dispatchEngine'
import { useDispatchT } from '../services/dispatchI18n'
import NavMap from '../components/NavMap'
import { TruckStatusPanel } from '../components/TruckStatusPanel'
import ExcavatorOuiPanel from '../components/ExcavatorOuiPanel'
import type { Assignment, StatusState } from '../components/TruckStatusPanel'
import prismLogo from '../assets/Logo1_splash.png'

// ── types ────────────────────────────────────────────────────────────────
type AllowedAction = { action: 'connect_truck' | 'connect_excavator'; unit_type: string; label: string }
type ActiveAssignment = { unit_type: string; unit_no: string; unit_desc?: string; paired_at?: string; source?: string } | null
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

const SUPPORTED_TYPES = ['excavator', 'dump_truck']

const WARN_LABELS: Record<string, string> = {
  kimper_expired: 'KIMPER EXPIRED',
  kimper_expiring_soon: 'KIMPER expiring soon',
  kimper_no_date: 'KIMPER has no expiry date',
  not_authorized_type: 'Not on KIMPER for this equipment',
  unit_unknown: 'Unit not seen in live GPS yet (will link once it reports)',
  unit_offline: 'Unit currently offline in GPS',
  unit_type_mismatch: 'Entered unit type does not match the connect type',
  unit_already_paired: 'Unit is already connected to another operator',
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
type DriverAct = { label: string; color: string; kind: 'first_bucket' | 'advance'; next: string }
const DRIVER_ACTIONS: Record<string, DriverAct> = {
  spot:         { label: 'Confirm Start Loading',          color: '#FF4FB8', kind: 'first_bucket', next: 'loading' },
  fullTravel1:  { label: 'Arrived — Full Weighbridge',     color: '#38BDF8', kind: 'advance', next: 'fullWB' },
  fullWB:       { label: 'Confirm Full Weighbridge',       color: '#38BDF8', kind: 'advance', next: 'fullTravel2' },
  fullTravel2:  { label: 'Arrived — Sampling',             color: '#C084FC', kind: 'advance', next: 'sampling' },
  sampling:     { label: 'Complete Sampling',              color: '#C084FC', kind: 'advance', next: 'fullTravel3' },
  fullTravel3:  { label: 'Arrived — Dump',                 color: '#A16207', kind: 'advance', next: 'dumping' },
  dumping:      { label: 'Depart / Complete Dumping',      color: '#A16207', kind: 'advance', next: 'emptyTravel1' },
  emptyTravel1: { label: 'Arrived — Empty Weighbridge',    color: '#67E8F9', kind: 'advance', next: 'emptyWB' },
  emptyWB:      { label: 'Confirm Empty Weighbridge',      color: '#67E8F9', kind: 'advance', next: 'emptyTravel2' },
  emptyTravel2: { label: 'Arrived — Shovel · Join Queue',  color: '#FFE600', kind: 'advance', next: 'waiting' },
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

export default function DispatchPage() {
  const dt = useDispatchT()
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
  // Employee-ID keyboard: numeric by default (IDs are mostly digits), with an
  // in-app 123/ABC toggle since the OS numeric pad has no letter switch.
  const [idMode, setIdMode] = useState<'numeric' | 'text'>('numeric')
  const idInputRef = useRef<HTMLInputElement>(null)
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
      const r = await apiFetch(`/api/dispatch/lookup?employee_id=${encodeURIComponent(id)}`)
      const data = await r.json()
      if (r.ok && data.success) { setProfile(data.profile as Profile); setProfileOffline(false) }
      else if (!cached) setError(data.message || `Employee ${id} not found in Kimper`)
    } catch {
      if (!cached) setError(dt('no_signal_id'))
    } finally {
      setLoading(false)
    }
  }

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
        // Always offer ALL supported equipment (excavator + dump_truck). KIMPER
        // authorization never limits what a driver may connect to — it only adds
        // an advisory warning on connect.
        const types = SUPPORTED_TYPES.join(',')
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
    setShowDrop(false); setLoading(true); setError(null); setResult(null)
    try {
      let t = type
      if (!t || !SUPPORTED_TYPES.includes(t)) {
        // detect from the live feed / asset map
        try {
          const rr = await apiFetch(`/api/dispatch/resolve-unit?unit_no=${encodeURIComponent(u)}`)
          const rd = await rr.json()
          t = rd?.tms?.asset_type || null
        } catch { /* offline / unknown */ }
      }
      // Choose the connect endpoint type. A driver is NEVER blocked here — KIMPER
      // authorization is advisory only (the server attaches a warning, never
      // refuses). Resolve the type from: the picked suggestion → live detection →
      // the operator's single authorized type → fall back to dump_truck.
      if (!t || !SUPPORTED_TYPES.includes(t)) {
        if (supportedAllowed.length === 1) t = supportedAllowed[0]            // one authorized type
        else if (supportedAllowed.length > 1) t = supportedAllowed[0]         // default to first authorized
        else t = 'dump_truck'                                                 // no auth listed — still allow
      }
      const path = t === 'excavator' ? '/api/dispatch/connect-excavator' : '/api/dispatch/connect-truck'
      const r = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ employee_id: profile.employee_id, unit_no: u }),
      })
      const data = await r.json() as ConnectResult
      if (r.status === 403 && data.authorized === false) {
        setError(data.message || dt('not_authorized'))
      } else if (!r.ok || !data.success) {
        setError(data.message || dt('connect_failed'))
      } else {
        setConnectedUnit(u)
        setResult(data)
      }
    } catch {
      setError(online ? dt('network_err') : dt('offline_connect'))
    } finally {
      setLoading(false)
    }
  }

  async function disconnect(employee_id: string) {
    setLoading(true); setError(null)
    try {
      await apiFetch('/api/dispatch/disconnect', {
        method: 'POST', body: JSON.stringify({ employee_id }),
      })
      setResult(null); setConnectedUnit('')
      await identify()      // refresh — active_assignment cleared
    } catch {
      setError('Network error — could not disconnect')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setEmployeeId(''); setProfile(null); setUnitNo(''); setSelectedType(null)
    setSuggestions([]); setShowDrop(false); setError(null); setResult(null); setConnectedUnit('')
  }

  // The active connection drives which operator window opens (from a fresh
  // connect OR an existing pairing surfaced by identify).
  const connection = (() => {
    if (result && result.success && result.authorized !== false) {
      return {
        unit_no: result.tms?.entered_no || connectedUnit,
        unit_type: result.unit_type || 'dump_truck',
        warnings: result.warnings || [],
      }
    }
    if (profile?.active_assignment) {
      return {
        unit_no: profile.active_assignment.unit_no,
        unit_type: profile.active_assignment.unit_type,
        warnings: [] as string[],
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

  // ── connected: full-screen operator window ──
  if (profile && connection) {
    const isExc = connection.unit_type === 'excavator'
    return (
      <div style={{ height: '100dvh', boxSizing: 'border-box', background: D.bg,
                    padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
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
              <div style={{ display: 'flex', gap: 6, overflow: 'hidden' }}>
                {[...connection.warnings]
                  .sort((a, b) => (b.startsWith('kimper_expired') ? 1 : 0) - (a.startsWith('kimper_expired') ? 1 : 0))
                  .slice(0, 3).map((w) => (
                  <span key={w} style={chip(w.startsWith('kimper_expired') || w === 'unit_already_paired' ? C.red : C.amber)}>{WARN_LABELS[w] || w}</span>
                ))}
              </div>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={reset}
                      style={{ padding: '7px 11px', fontSize: '0.74rem', fontWeight: 700, color: D.sub2, background: 'transparent', border: `1px solid ${D.line2}`, borderRadius: 9, cursor: 'pointer' }}>
                {dt('different_emp')}
              </button>
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
          ) : (
            <TruckDriverWindow employeeId={profile.employee_id} truckNo={connection.unit_no} driverName={profile.name}
                               viewMode={viewMode} setViewMode={setViewMode} />
          )}
        </div>
      </div>
    )
  }

  // ── identify / connect ──
  return (
    <div style={{ minHeight: '100%', background: C.bg, padding: '16px 14px 90px' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: C.ink, margin: '4px 2px 14px' }}>
        {dt('title')}
      </h1>

      {!online && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E',
                      borderRadius: 12, padding: '10px 14px', marginBottom: 12, fontSize: '0.84rem', fontWeight: 600 }}>
          ⚠ {dt('offline_banner')}
        </div>
      )}

      {/* Step 1 — identify */}
      {!profile && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>{dt('enter_emp_id')}</label>
            <button
              type="button"
              onClick={toggleIdKeyboard}
              aria-label="Toggle keyboard"
              style={{ padding: '5px 12px', fontSize: '0.78rem', fontWeight: 800, color: C.blue,
                       background: '#EFF6FF', border: `1px solid ${C.blue}40`, borderRadius: 999, cursor: 'pointer' }}
            >
              {idMode === 'numeric' ? 'ABC' : '123'}
            </button>
          </div>
          <input
            ref={idInputRef}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && identify()}
            placeholder="e.g. 8221118075"
            autoFocus
            inputMode={idMode}
            style={inputStyle}
          />
          <button onClick={identify} disabled={loading || !employeeId.trim()} style={primaryBtn(loading || !employeeId.trim())}>
            {loading ? dt('checking') : dt('identify')}
          </button>
        </div>
      )}

      {/* Step 2 — employee card + unit dropdown */}
      {profile && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: C.ink }}>{profile.name || '—'}</div>
                <div style={{ color: C.sub, fontSize: '0.85rem' }}>ID {profile.employee_id}</div>
                {profileOffline && <div style={{ color: C.amber, fontSize: '0.72rem', fontWeight: 700 }}>{dt('from_saved')}</div>}
                <div style={{ color: C.sub, fontSize: '0.8rem' }}>
                  {[profile.company, profile.department].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span style={badge(statusColor(profile.kimper_status))}>
                KIMPER {profile.kimper_status || '—'}
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>{dt('authorized_to_operate')}</div>
              {profile.allowed_type_labels.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {profile.allowed_type_labels.map((t) => (
                    <span key={t} style={chip(C.blue)}>{t}</span>
                  ))}
                </div>
              ) : (
                <div style={{ color: C.amber, fontSize: '0.85rem', marginTop: 4 }}>
                  {dt('no_authorization')}
                </div>
              )}
            </div>
          </div>

          {/* unit number → dropdown → auto-detect type → connect.
              ALWAYS shown — a driver is never blocked by KIMPER from connecting;
              an advisory note appears below when the licence does not list it. */}
          <div style={cardStyle}>
              <label style={labelStyle}>{dt('which_unit')}</label>
              <div style={{ position: 'relative' }}>
                <input
                  value={unitNo}
                  onChange={(e) => { setUnitNo(e.target.value.toUpperCase()); setSelectedType(null); setShowDrop(true) }}
                  onFocus={() => setShowDrop(true)}
                  onKeyDown={(e) => e.key === 'Enter' && connectUnit(unitNo, selectedType)}
                  placeholder={dt('unit_placeholder')}
                  style={inputStyle}
                  autoComplete="off"
                />
                {showDrop && unitNo.trim() && (suggestions.length > 0 || searching) && (
                  <div style={dropStyle}>
                    {searching && suggestions.length === 0 && (
                      <div style={{ padding: '10px 14px', color: C.sub, fontSize: '0.85rem' }}>{dt('searching')}</div>
                    )}
                    {suggestions.map((s) => (
                      <button key={s.unit_no} onClick={() => { setUnitNo(s.unit_no); setSelectedType(s.type); connectUnit(s.unit_no, s.type) }}
                              style={dropItem}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: s.live ? C.green : C.sub, flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.unit_no}</span>
                        </span>
                        <span style={chip(s.type === 'excavator' ? '#0f8a8a' : C.blue)}>{s.type_label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ color: C.sub, fontSize: '0.76rem', marginTop: -4, marginBottom: 8 }}>
                {dt('pick_hint')}
              </div>
              {supportedAllowed.length === 0 && (
                <div style={{ color: C.amber, fontSize: '0.78rem', fontWeight: 600, marginTop: -2, marginBottom: 8 }}>
                  ⚠ {dt('not_auth_advisory')}
                </div>
              )}
              <button onClick={() => connectUnit(unitNo, selectedType)} disabled={loading || !unitNo.trim()}
                      style={primaryBtn(loading || !unitNo.trim())}>
                {loading ? dt('connecting') : selectedType
                  ? `${dt('connect')} ${unitNo} · ${selectedType === 'excavator' ? dt('excavator') : dt('dump_truck')}`
                  : dt('connect')}
              </button>
            </div>

          <button onClick={reset} style={ghostBtn}>{dt('different_emp')}</button>
        </>
      )}

      {error && (
        <div style={{ ...cardStyle, borderLeft: `4px solid ${C.red}`, color: C.red }}>{error}</div>
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
}
type OpExcavator = {
  excavator_no?: string; plan_id?: number; shift?: string; plan_date?: string | null
  loading_location_name?: string | null; dump_location_name?: string | null
  loading_zone_m?: number; waiting_zone_m?: number
  lat?: number | null; lng?: number | null
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
  const [geo, setGeo] = useState<{ excLat?: number | null; excLng?: number | null; dumpLat?: number | null; dumpLng?: number | null; loadingZoneM?: number; dumpZoneM?: number }>({})
  const [tel, setTel] = useState<{ lat?: number; lng?: number; speed?: number; course?: number } | null>(null)
  const [roads, setRoads] = useState<GeoJSON.FeatureCollection | null>(null)
  const [siteImagery, setSiteImagery] = useState(true)   // SITE ortho overlay (FMS-map imagery) vs plain satellite
  const [routePts, setRoutePts] = useState<[number, number][] | null>(null)
  const [routeSegments, setRouteSegments] = useState<{ lane: string; coordinates: [number, number][] }[] | null>(null)
  const [otherLoading, setOtherLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState<{ status: string; reason?: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [gpsNote, setGpsNote] = useState(false)
  const target = useRef(truckNo.trim().toUpperCase())
  useEffect(() => { target.current = truckNo.trim().toUpperCase() }, [truckNo])

  useEffect(() => {
    let alive = true
    function pick(trucks: OpTruck[]) { return trucks.find((t) => (t.truck_no || '').trim().toUpperCase() === target.current) }
    function applyExc(exc: OpExcavator, mine: OpTruck) {
      setTruck({ ...mine, connected: true })
      setPlanId(exc?.plan_id ?? null); setExcavatorNo(exc?.excavator_no ?? null)
      setLoadingLoc(exc?.loading_location_name ?? null); setDumpLoc(exc?.dump_location_name ?? null)
      setShiftDate(exc?.shift, exc?.plan_date)
      setGeo({ excLat: exc?.lat, excLng: exc?.lng, dumpLat: exc?.dump_lat, dumpLng: exc?.dump_lng,
               loadingZoneM: exc?.loading_zone_m, dumpZoneM: exc?.dump_zone_m })
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
    const h = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(h) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId])

  // Live telemetry (position / speed / heading) from the TMS resolver.
  useEffect(() => {
    let alive = true
    async function pull() {
      try {
        const r = await apiFetch(`/api/dispatch/resolve-unit?unit_no=${encodeURIComponent(truckNo)}`)
        const d = await r.json()
        if (!alive) return
        const t = d?.tms
        if (t && t.lat != null && t.lng != null) setTel({ lat: t.lat, lng: t.lng, speed: t.speed, course: t.course })
      } catch { /* offline */ }
    }
    pull()
    const h = setInterval(pull, 5000)
    return () => { alive = false; clearInterval(h) }
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
        const r = await apiFetch('/api/dispatch/loading/start', {
          method: 'POST',
          body: JSON.stringify({ plan_id: planId, truck_no: truck.truck_no, excavator_no: excavatorNo, employee_id: employeeId }),
        })
        const d = await r.json()
        if (r.ok && d.success) { setMsg('✓'); setTruck((t) => t ? { ...t, state: 'loading', state_color: undefined, state_label: undefined } : t) }
        else if (r.status === 409) setMsg(d.message || dt('another_loading'))
        else setMsg(d.message || 'Could not start loading')
      } else {
        const r = await apiFetch('/api/dispatch/cycle-advance', {
          method: 'POST', body: JSON.stringify({ plan_id: planId, truck_no: truck.truck_no, status: act.next }),
        })
        const d = await r.json()
        if (r.ok && d.success) { setMsg('✓'); setTruck((t) => t ? { ...t, state: act.next, state_color: undefined, state_label: undefined } : t) }
        else setMsg(d.message || 'Action failed')
      }
    } catch { setMsg('Network error') } finally { setActing(false) }
  }

  const st = truck?.state
  const v2 = st ? STATE_STYLE[st] : undefined
  const act = st ? DRIVER_ACTIONS[st] : undefined
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
  const geofenceM = isFull ? (geo.dumpZoneM ?? 50) : (geo.loadingZoneM ?? 10)
  const truckPt = (tel?.lat != null && tel?.lng != null)
    ? { lat: tel.lat, lng: tel.lng, course: tel.course }
    : (truck && truck.lat != null && truck.lng != null ? { lat: truck.lat, lng: truck.lng, course: null } : null)
  const speedKph = tel?.speed != null ? Math.max(0, Math.round(tel.speed)) : null
  const nextLocName = isFull ? (dumpLoc || dt('dump_loc')) : (loadingLoc || excavatorNo || dt('shovel'))

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
        const r = await apiFetch(`/api/dispatch/route?from_lat=${from.lat}&from_lng=${from.lng}&to_lat=${to.lat}&to_lng=${to.lng}&weight=time&lane=${isFull ? 'loaded' : 'empty'}`)
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
    const h = setInterval(fetchRoute, 15000)
    return () => { alive = false; clearInterval(h) }
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
                  <NavMap truck={truckPt} dest={dest} geofenceM={geofenceM} lane={isFull ? 'full' : 'empty'}
                          destKind={destKind} stateColor={curColor} route={routePts} routeSegments={routeSegments} roads={roads}
                          height="100%" visible={viewMode === 'map'}
                          siteImagery={siteImagery} />
                </div>
                {/* SAT / SITE basemap toggle: SITE drapes our own high-detail
                    ortho imagery (the FMS-site-map look); SAT is plain satellite. */}
                {viewMode === 'map' && (
                  <button onClick={() => setSiteImagery((v) => !v)} style={{
                    position: 'absolute', right: 12, top: 12, zIndex: 500, cursor: 'pointer',
                    background: 'rgba(8,12,20,0.78)', border: `1px solid ${siteImagery ? '#38BDF8' : D.line2}`,
                    borderRadius: 10, padding: '6px 11px', display: 'flex', alignItems: 'center', gap: 6,
                    color: siteImagery ? '#38BDF8' : D.sub, fontWeight: 800, fontSize: '0.72rem',
                  }}>
                    <span style={{ fontSize: '0.86rem' }}>🛰</span>{siteImagery ? 'SITE' : 'SAT'}
                  </button>
                )}
                {viewMode === 'map' && speedKph != null && (
                  <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 500, background: 'rgba(8,12,20,0.78)',
                                border: `1px solid ${D.line2}`, borderRadius: 12, padding: '6px 12px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.8rem', fontWeight: 900, color: speedKph > 0 ? '#86EFAC' : D.ink, lineHeight: 1 }}>{speedKph}</span>
                    <span style={{ color: D.sub, fontSize: '0.62rem', fontWeight: 700 }}>km/h</span>
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
              <StateLine label={dt('next_state')} value={nextLabel || '—'} color={nextColor} />
              <StateLine label={dt('next_location')} value={nextLocName} color={D.accent} />
            </div>
          )}
        </div>

        {/* RIGHT — data column, ~50% (action · status · assignment; no scroll).
            Always visible: STATUS only swaps the LEFT map box for the wheel. */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {!nonOp && (
            <div style={{ ...panel, flexShrink: 0, padding: 12, border: `1px solid ${D.accent}3A`,
                          background: '#101820', boxShadow: `0 0 0 1px ${D.accent}14` }}>
              {/* OPERATOR ACTION header + the per-state guidance (prototype) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: D.accent, fontSize: '1rem', lineHeight: 1.1 }}>▸</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: D.accent, fontWeight: 800, fontSize: '0.62rem', letterSpacing: '0.1em' }}>{dt('operator_action')}</div>
                  <div style={{ color: D.ink, fontWeight: 700, fontSize: '0.92rem', lineHeight: 1.25, marginTop: 2 }}>{reqHint}</div>
                </div>
              </div>

              {act ? (
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
              {/* secondary actions UNDER the action/waiting-event */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => setStatusOpen(true)} style={secBtn}>Request Status Change</button>
                <button onClick={() => setGpsNote((v) => !v)} style={secBtn}>Report GPS Unavailable</button>
              </div>
              {gpsNote && <div style={{ color: D.sub2, fontSize: '0.72rem', marginTop: 6 }}>Manual mode — confirm arrival with the action button above if GPS/RFID auto-arrival is unavailable.</div>}
            </div>
          )}

          <div style={{ flexShrink: 0 }}>
            <ManualStatusControl unitNo={truckNo} unitType="dump_truck" employeeId={employeeId}
                                 current={manual} open={statusOpen} onOpenChange={setStatusOpen}
                                 onChange={(status, reason) => setManual({ status, reason })} />
          </div>

          {/* ASSIGNMENT — fills remaining space; compact grid fits in view */}
          <div style={{ ...panel, flex: '1 1 0', minHeight: 0, overflow: 'hidden', padding: 8, display: 'flex', flexDirection: 'column' }}>
            <SectionLabel icon="📍" text="ASSIGNMENT" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 5 }}>
              <MiniTile k="Truck ID" v={truck?.truck_no || truckNo} />
              <MiniTile k="Driver" v={truck?.driver_name || '—'} />
              <MiniTile k="Assigned Excavator" v={excavatorNo || '—'} />
              <MiniTile k="Connection" v={truck?.connected ? (truck?.live ? 'Connected · Live' : 'Connected · GPS offline') : 'Not connected'} />
              <MiniTile k="Loading Source" v={loadingLoc || '—'} />
              <MiniTile k="Dump Location" v={dumpLoc || '—'} />
              <MiniTile k="Plan ID" v={planId ? `#${planId}` : '—'} />
              <MiniTile k="Shift / Date" v={shiftDate} />
              <div style={{ gridColumn: '1 / -1' }}><MiniTile k="Next Location" v={nextLocName} /></div>
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
    <div style={{ background: D.panel2, border: `1px solid ${D.line}`, borderRadius: 7, padding: '3px 7px' }}>
      <div style={{ color: D.sub, fontSize: '0.5rem', letterSpacing: '0.02em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</div>
      <div style={{ color: D.ink, fontWeight: 700, fontSize: '0.76rem', marginTop: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
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
//  MANUAL STATUS CONTROL (compact trigger + modal — saves vertical space)
// ════════════════════════════════════════════════════════════════════════
function ManualStatusControl({ unitNo, unitType, employeeId, current, onChange, open: openProp, onOpenChange }:
  { unitNo: string; unitType: string; employeeId: string
    current: { status: string; reason?: string } | null
    onChange: (status: string, reason?: string) => void
    open?: boolean; onOpenChange?: (o: boolean) => void }) {
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
      const r = await apiFetch('/api/dispatch/equipment-status', {
        method: 'POST',
        body: JSON.stringify({ unit_no: unitNo, unit_type: unitType, status, reason, employee_id: employeeId }),
      })
      const d = await r.json()
      if (r.ok && d.success) { onChange(status, reason); setOpen(false); setPick(null) }
    } catch { /* keep open */ } finally { setBusy(false) }
  }

  return (
    <>
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

      {open && (
        <div onClick={() => { setOpen(false); setPick(null) }}
             style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(2,6,12,0.72)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: '100%', maxWidth: 460, background: D.panel, border: `1px solid ${D.line2}`,
                        borderRadius: 18, padding: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ color: D.ink, fontWeight: 800, fontSize: '1rem' }}>{dt('machine_availability')}</div>
              <span style={chip(curMeta?.color || '#16A34A')}>{dt('ms_' + cur).toUpperCase()}</span>
            </div>

            {cur !== 'operating' && (
              <button onClick={() => send('operating')} disabled={busy} style={{ ...darkBtn('#16A34A'), marginBottom: 12 }}>
                {busy ? '…' : dt('return_operating')}
              </button>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MANUAL_STATUSES.filter((m) => m.value !== 'operating').map((m) => (
                <button key={m.value} onClick={() => setPick(m.value)}
                        style={{ ...tag(m.color, pick === m.value), flex: '1 1 30%', minHeight: 48 }}>{dt('ms_' + m.value)}</button>
              ))}
            </div>

            {pick && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: D.sub, fontSize: '0.72rem', marginBottom: 8 }}>{dt('reason')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(STATUS_REASONS[pick] || ['Other']).map((rsn) => (
                    <button key={rsn} onClick={() => send(pick, rsn)} disabled={busy}
                            style={tag(manualMeta(pick)?.color || D.sub, false)}>{rsn}</button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setOpen(false); setPick(null) }} style={{ ...ghostBtn, color: D.sub, marginTop: 14 }}>{dt('cancel')}</button>
          </div>
        </div>
      )}
    </>
  )
}

// ── styles ────────────────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: C.card, borderRadius: 16, padding: 16, marginBottom: 12,
  border: `1px solid ${C.line}`, boxShadow: '0 6px 18px rgba(15,23,42,0.05)',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 700, color: C.sub,
  textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '14px 14px', fontSize: '1.05rem',
  border: `1px solid ${C.line}`, borderRadius: 12, marginBottom: 12, outline: 'none',
}
const dropStyle: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% - 4px)', left: 0, right: 0, zIndex: 20,
  background: '#fff', border: `1px solid ${C.line}`, borderRadius: 12,
  boxShadow: '0 12px 28px rgba(15,23,42,0.16)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
}
const dropItem: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '11px 14px', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.line}`,
  cursor: 'pointer', textAlign: 'left',
}
const panel: React.CSSProperties = {
  background: D.panel, border: `1px solid ${D.line}`, borderRadius: 14, padding: 14,
}
function primaryBtn(disabled: boolean, color: string = C.blue): React.CSSProperties {
  return {
    width: '100%', padding: '14px', fontSize: '1rem', fontWeight: 700, color: '#fff',
    background: disabled ? '#94A3B8' : color, border: 'none', borderRadius: 12,
    cursor: disabled ? 'default' : 'pointer', marginTop: 4,
  }
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
function darkBtn(color: string): React.CSSProperties {
  return { width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 800, color: inkOn(color),
           background: color, border: 'none', borderRadius: 12, cursor: 'pointer' }
}
const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '12px', fontSize: '0.9rem', fontWeight: 600, color: C.sub,
  background: 'transparent', border: 'none', marginTop: 4, cursor: 'pointer',
}
function badge(color: string): React.CSSProperties {
  return { fontSize: '0.7rem', fontWeight: 800, color: '#fff', background: color, padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}
function chip(color: string): React.CSSProperties {
  return { fontSize: '0.72rem', fontWeight: 700, color, background: `${color}1F`, border: `1px solid ${color}55`, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }
}
function tag(color: string, active: boolean): React.CSSProperties {
  return {
    fontSize: '0.8rem', fontWeight: 700, color: active ? inkOn(color) : color,
    background: active ? color : `${color}1A`, border: `1px solid ${color}66`,
    padding: '9px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
  }
}
