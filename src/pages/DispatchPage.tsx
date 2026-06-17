// In-cab dispatch screen: identify by employee ID → see Kimper authorization →
// enter the unit operated today → connect (truck/excavator). The cab device is
// logged in once as a `dispatch` service account; individual operators just
// enter their employee ID (no per-person password). Position stays on the TMS
// feed; this only links the person to the unit for the shift.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../services/api'

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

const WARN_LABELS: Record<string, string> = {
  kimper_expired: 'KIMPER EXPIRED',
  kimper_expiring_soon: 'KIMPER expiring soon',
  kimper_no_date: 'KIMPER has no expiry date',
  unit_unknown: 'Unit not seen in live GPS yet (will link once it reports)',
  unit_offline: 'Unit currently offline in GPS',
  unit_type_mismatch: 'Entered unit type does not match the connect type',
  unit_already_paired: 'Unit is already connected to another operator',
}

const C = {
  bg: '#F1F5F9', card: '#FFFFFF', ink: '#0F172A', sub: '#64748B',
  blue: '#2563EB', blueDk: '#1E3A8A', green: '#16A34A', amber: '#D97706',
  red: '#DC2626', line: '#E2E8F0',
}

function statusColor(s?: string) {
  if (s === 'EXPIRED' || s === 'NO_KIMPER') return C.red
  if (s === 'EXPIRING_SOON' || s === 'NO_DATE') return C.amber
  if (s === 'VALID' || s === 'ACTIVE') return C.green
  return C.sub
}

export default function DispatchPage() {
  const navigate = useNavigate()
  const [employeeId, setEmployeeId] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [unitNo, setUnitNo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConnectResult | null>(null)

  async function identify() {
    const id = employeeId.trim()
    if (!id) return
    setLoading(true); setError(null); setResult(null); setProfile(null)
    try {
      const r = await apiFetch(`/api/dispatch/lookup?employee_id=${encodeURIComponent(id)}`)
      const data = await r.json()
      if (!r.ok || !data.success) {
        setError(data.message || `Employee ${id} not found in Kimper`)
      } else {
        setProfile(data.profile as Profile)
      }
    } catch {
      setError('Network error — could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  async function connect(action: AllowedAction) {
    if (!profile) return
    const unit = unitNo.trim()
    if (!unit) { setError('Enter the unit number you are operating today'); return }
    const path = action.action === 'connect_truck'
      ? '/api/dispatch/connect-truck' : '/api/dispatch/connect-excavator'
    setLoading(true); setError(null); setResult(null)
    try {
      const r = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ employee_id: profile.employee_id, unit_no: unit }),
      })
      const data = await r.json() as ConnectResult
      if (r.status === 403 && data.authorized === false) {
        setResult(data)            // authorization block — show clearly
      } else if (!r.ok || !data.success) {
        setError(data.message || 'Connection failed')
      } else {
        setResult(data)
      }
    } catch {
      setError('Network error — could not reach the server')
    } finally {
      setLoading(false)
    }
  }

  async function disconnect() {
    if (!profile) return
    setLoading(true); setError(null)
    try {
      await apiFetch('/api/dispatch/disconnect', {
        method: 'POST',
        body: JSON.stringify({ employee_id: profile.employee_id }),
      })
      await identify()  // refresh the profile (active_assignment cleared)
    } catch {
      setError('Network error — could not disconnect')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setEmployeeId(''); setProfile(null); setUnitNo(''); setError(null); setResult(null)
  }

  const connected = result && result.success && result.authorized !== false

  return (
    <div style={{ minHeight: '100%', background: C.bg, padding: '16px 14px 90px' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: C.ink, margin: '4px 2px 14px' }}>
        Dispatch · Connect Unit
      </h1>

      {/* Step 1 — identify */}
      {!profile && (
        <div style={cardStyle}>
          <label style={labelStyle}>Enter your Employee ID</label>
          <input
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && identify()}
            placeholder="e.g. 8221118075"
            autoFocus
            style={inputStyle}
          />
          <button onClick={identify} disabled={loading || !employeeId.trim()} style={primaryBtn(loading || !employeeId.trim())}>
            {loading ? 'Checking…' : 'Identify'}
          </button>
        </div>
      )}

      {/* Step 2 — profile + connect */}
      {profile && !connected && (
        <>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: C.ink }}>{profile.name || '—'}</div>
                <div style={{ color: C.sub, fontSize: '0.85rem' }}>ID {profile.employee_id}</div>
                <div style={{ color: C.sub, fontSize: '0.8rem' }}>
                  {[profile.company, profile.department].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span style={badge(statusColor(profile.kimper_status))}>
                KIMPER {profile.kimper_status || '—'}
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Authorized to operate</div>
              {profile.allowed_type_labels.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {profile.allowed_type_labels.map((t) => (
                    <span key={t} style={chip(C.blue)}>{t}</span>
                  ))}
                </div>
              ) : (
                <div style={{ color: C.amber, fontSize: '0.85rem', marginTop: 4 }}>
                  No equipment authorization on file in Kimper.
                </div>
              )}
            </div>
          </div>

          {/* already connected? */}
          {profile.active_assignment && (
            <div style={{ ...cardStyle, borderLeft: `4px solid ${C.green}` }}>
              <div style={{ fontWeight: 700, color: C.ink }}>
                Currently connected: {profile.active_assignment.unit_no}
              </div>
              <div style={{ color: C.sub, fontSize: '0.85rem' }}>
                {profile.active_assignment.unit_type === 'excavator' ? 'Excavator' : 'Dump Truck'}
                {profile.active_assignment.unit_desc ? ` · ${profile.active_assignment.unit_desc}` : ''}
              </div>
              <button onClick={disconnect} disabled={loading} style={dangerBtn}>End / Disconnect</button>
            </div>
          )}

          {profile.active_assignment?.unit_type === 'excavator' && (
            <OperatorMonitor employeeId={profile.employee_id} />
          )}

          {/* connect actions */}
          {profile.allowed_actions.length > 0 ? (
            <div style={cardStyle}>
              <label style={labelStyle}>Which unit are you operating today?</label>
              <input
                value={unitNo}
                onChange={(e) => setUnitNo(e.target.value.toUpperCase())}
                placeholder="e.g. DT-101 or EX-05"
                style={inputStyle}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {profile.allowed_actions.map((a) => (
                  <button key={a.action} onClick={() => connect(a)} disabled={loading || !unitNo.trim()}
                          style={primaryBtn(loading || !unitNo.trim(), a.action === 'connect_excavator' ? C.amber : C.blue)}>
                    {loading ? 'Connecting…' : a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ ...cardStyle, color: C.sub }}>
              This person is not authorized to operate a truck or excavator.
            </div>
          )}

          {/* authorization block result */}
          {result && result.authorized === false && (
            <div style={{ ...cardStyle, borderLeft: `4px solid ${C.red}` }}>
              <div style={{ fontWeight: 700, color: C.red }}>Not authorized</div>
              <div style={{ color: C.ink, fontSize: '0.9rem' }}>{result.message}</div>
            </div>
          )}

          <button onClick={reset} style={ghostBtn}>← Different employee</button>
        </>
      )}

      {/* Step 3 — connected */}
      {connected && result && (
        <div style={{ ...cardStyle, borderLeft: `4px solid ${C.green}` }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: C.green }}>✓ Connected · Active Today</div>
          <div style={{ marginTop: 8, color: C.ink }}>
            <Row k="Unit" v={result.tms?.entered_no || unitNo} />
            <Row k="Type" v={result.unit_type === 'excavator' ? 'Excavator' : 'Dump Truck'} />
            <Row k="Operator" v={profile?.name || profile?.employee_id || '—'} />
            <Row k="Employee ID" v={profile?.employee_id || '—'} />
            <Row k="GPS" v={result.tms?.live ? `live (${result.tms?.state || '—'})` : 'not in live feed yet'} />
            <Row k="KIMPER" v={result.kimper_status || '—'} />
          </div>
          {result.warnings && result.warnings.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {result.warnings.map((w) => (
                <span key={w} style={chip(w.startsWith('kimper_expired') || w === 'unit_already_paired' ? C.red : C.amber)}>
                  {WARN_LABELS[w] || w}
                </span>
              ))}
            </div>
          )}
          {result.unit_type === 'excavator' && profile?.employee_id && (
            <OperatorMonitor employeeId={profile.employee_id} />
          )}
          <button onClick={reset} style={primaryBtn(false)}>Connect another</button>
          <button onClick={() => navigate('/home')} style={ghostBtn}>Done</button>
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, borderLeft: `4px solid ${C.red}`, color: C.red }}>{error}</div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '0.9rem' }}>
      <span style={{ color: C.sub }}>{k}</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  )
}

type OpTruck = { truck_no: string; driver_name?: string | null; zone: string; distance_m?: number | null; live?: boolean; plan_status?: string }
type OpView = {
  has_plan: boolean
  excavator?: { excavator_no?: string; plan_id?: number; loading_location_name?: string | null; dump_location_name?: string | null; loading_zone_m?: number; waiting_zone_m?: number } | null
  zones?: { loading_m?: number; waiting_m?: number }
  trucks: OpTruck[]
}
function zoneRank(z: string) { return z === 'loading' ? 0 : z === 'waiting' ? 1 : 2 }
function zoneCol(z: string) { return z === 'loading' ? C.green : z === 'waiting' ? C.amber : C.sub }
const POST_LOAD = ['Loaded', 'TravellingToDump', 'AtDump', 'Dumped', 'Returning', 'Completed']
function isPostLoad(s?: string) { return !!s && POST_LOAD.includes(s) }

// Live loading-zone monitor shown to a connected excavator operator: the
// assigned trucks and whether each is waiting / in the loading zone. (The
// Load button arrives in Phase 6.)
function OperatorMonitor({ employeeId }: { employeeId: string }) {
  const [view, setView] = useState<OpView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const r = await apiFetch(`/api/dispatch/operator-view?employee_id=${encodeURIComponent(employeeId)}`)
        const d = await r.json()
        if (!alive) return
        if (d.success) { setView(d as OpView); setErr(null) } else { setErr(d.message || 'unavailable') }
      } catch { if (alive) setErr('network error') }
    }
    tick()
    const h = setInterval(tick, 8000)
    return () => { alive = false; clearInterval(h) }
  }, [employeeId])

  const [acting, setActing] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})

  async function loadTruck(truckNo: string) {
    setActing(truckNo)
    setMsg((m) => ({ ...m, [truckNo]: '' }))
    try {
      const r = await apiFetch('/api/dispatch/load-events', {
        method: 'POST',
        body: JSON.stringify({ operator_employee_id: employeeId, truck_no: truckNo }),
      })
      const d = await r.json()
      if (r.ok && d.success) {
        setMsg((m) => ({ ...m, [truckNo]: `Loaded ✓${d.dump_location_name ? ' → ' + d.dump_location_name : ''}` }))
        setView((v) => v ? { ...v, trucks: v.trucks.map((t) => t.truck_no === truckNo ? { ...t, plan_status: 'Loaded' } : t) } : v)
      } else {
        setMsg((m) => ({ ...m, [truckNo]: d.message || 'Load failed' }))
      }
    } catch {
      setMsg((m) => ({ ...m, [truckNo]: 'Network error' }))
    } finally {
      setActing(null)
    }
  }

  const planId = view?.excavator?.plan_id

  async function markDumped(truckNo: string) {
    if (!planId) return
    setActing(truckNo)
    setMsg((m) => ({ ...m, [truckNo]: '' }))
    try {
      const r = await apiFetch('/api/dispatch/cycle-advance', {
        method: 'POST',
        body: JSON.stringify({ plan_id: planId, truck_no: truckNo, status: 'Dumped' }),
      })
      const d = await r.json()
      if (r.ok && d.success) {
        setMsg((m) => ({ ...m, [truckNo]: 'Dumped ✓' }))
        setView((v) => v ? { ...v, trucks: v.trucks.map((t) => t.truck_no === truckNo ? { ...t, plan_status: 'Dumped' } : t) } : v)
      } else {
        setMsg((m) => ({ ...m, [truckNo]: d.message || 'Failed' }))
      }
    } catch {
      setMsg((m) => ({ ...m, [truckNo]: 'Network error' }))
    } finally {
      setActing(null)
    }
  }

  const trucks = (view?.trucks || []).slice().sort(
    (a, b) => zoneRank(a.zone) - zoneRank(b.zone) || ((a.distance_m ?? 1e9) - (b.distance_m ?? 1e9)))
  const lz = view?.zones?.loading_m ?? view?.excavator?.loading_zone_m
  const wz = view?.zones?.waiting_m ?? view?.excavator?.waiting_zone_m

  return (
    <div style={{ ...cardStyle, borderLeft: '4px solid #0f8a8a' }}>
      <div style={{ fontWeight: 800, color: C.ink }}>Loading zone monitor</div>
      <div style={{ color: C.sub, fontSize: '0.82rem', marginBottom: 8 }}>
        {view?.excavator?.excavator_no ? `Excavator ${view.excavator.excavator_no}` : 'Excavator'}
        {lz != null && wz != null ? ` · loading ${lz} m · waiting ${wz} m` : ''}
      </div>
      {err && <div style={{ color: C.amber, fontSize: '0.82rem' }}>{err}</div>}
      {view && !view.has_plan && (
        <div style={{ color: C.sub, fontSize: '0.85rem' }}>
          No active plan for this excavator yet. Trucks appear once a planner activates a plan.
        </div>
      )}
      {view?.has_plan && trucks.length === 0 && (
        <div style={{ color: C.sub, fontSize: '0.85rem' }}>No assigned trucks located in the live feed yet.</div>
      )}
      {trucks.map((t) => {
        const ps = t.plan_status
        const postLoad = isPostLoad(ps)
        const inLoadingZone = t.zone === 'loading'
        const badgeText = postLoad ? (ps || '').toUpperCase() : (t.zone || 'unknown').toUpperCase()
        const badgeCol = postLoad ? C.blue : zoneCol(t.zone)
        const m = msg[t.truck_no] || ''
        return (
          <div key={t.truck_no} style={{ padding: '8px 0', borderTop: `1px solid ${C.line}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t.truck_no}</div>
                <div style={{ color: C.sub, fontSize: '0.78rem' }}>{t.driver_name || 'no driver linked'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={chip(badgeCol)}>{badgeText}</span>
                <div style={{ color: C.sub, fontSize: '0.78rem', marginTop: 2 }}>{t.distance_m != null ? `${Math.round(t.distance_m)} m` : '—'}</div>
              </div>
            </div>
            {inLoadingZone && !postLoad && (
              <button onClick={() => loadTruck(t.truck_no)} disabled={acting === t.truck_no}
                      style={primaryBtn(acting === t.truck_no, C.green)}>
                {acting === t.truck_no ? 'Recording…' : `Load ${t.truck_no}`}
              </button>
            )}
            {(ps === 'Loaded' || ps === 'AtDump') && (
              <button onClick={() => markDumped(t.truck_no)} disabled={acting === t.truck_no}
                      style={primaryBtn(acting === t.truck_no, C.blue)}>
                {acting === t.truck_no ? 'Recording…' : 'Mark dumped'}
              </button>
            )}
            {m && (
              <div style={{ fontSize: '0.8rem', marginTop: 4, color: (m.includes('✓')) ? C.green : C.red }}>{m}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

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
function primaryBtn(disabled: boolean, color: string = C.blue): React.CSSProperties {
  return {
    width: '100%', padding: '14px', fontSize: '1rem', fontWeight: 700, color: '#fff',
    background: disabled ? '#94A3B8' : color, border: 'none', borderRadius: 12,
    cursor: disabled ? 'default' : 'pointer', marginTop: 4,
  }
}
const dangerBtn: React.CSSProperties = {
  width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 700, color: C.red,
  background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: 12, marginTop: 10, cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '12px', fontSize: '0.9rem', fontWeight: 600, color: C.sub,
  background: 'transparent', border: 'none', marginTop: 4, cursor: 'pointer',
}
function badge(color: string): React.CSSProperties {
  return { fontSize: '0.7rem', fontWeight: 800, color: '#fff', background: color, padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
}
function chip(color: string): React.CSSProperties {
  return { fontSize: '0.78rem', fontWeight: 600, color, background: `${color}14`, border: `1px solid ${color}40`, padding: '4px 10px', borderRadius: 999 }
}
