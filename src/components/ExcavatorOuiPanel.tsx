// Excavator operator OUI — prototype ExcavatorOuiPanel layout for the in-cab APK.
// Single screen, no page scroll: header · queue/loading (left) · FULL + plan (right).
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../services/api'
import { useDispatchT } from '../services/dispatchI18n'

/**
 * setInterval that pauses while the app is backgrounded (cab tablet asleep) and
 * resumes with an immediate catch-up tick. Keeps the 2s queue-board poll from
 * hammering the radio/CPU when nobody is looking. Returns a cleanup function.
 */
function visibleInterval(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const start = () => { if (timer == null) timer = setInterval(fn, ms) }
  const stop = () => { if (timer != null) { clearInterval(timer); timer = null } }
  const onVis = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') stop()
    else { fn(); start() }
  }
  if (!(typeof document !== 'undefined' && document.visibilityState === 'hidden')) start()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)
  return () => { stop(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis) }
}

const P = {
  shell: '#0f0f0f',
  panel: '#101010',
  panel2: '#171717',
  line: '#303030',
  ink: '#ffffff',
  sub: '#d6d6d6',
  muted: '#9ca3af',
  accent: '#F5A524',
  loading: '#FF4FB8',
  waiting: '#FFE600',
}

type OpTruck = {
  truck_no: string
  driver_name?: string | null
  zone?: string
  distance_m?: number | null
  state?: string
  state_label?: string
  state_color?: string
  time_in_state_s?: number | null
}

type OpExcavator = {
  excavator_no?: string
  plan_id?: number
  shift?: string
  plan_date?: string | null
  loading_location_name?: string | null
  dump_location_name?: string | null
  loading_zone_m?: number
  waiting_zone_m?: number
  exc_status?: string
  exc_status_color?: string
  exc_status_label?: string
  next_truck_no?: string | null
  preferred_next_truck?: string | null
  next_is_override?: boolean
  target_trips?: number | null
  target_tonnes?: number | null
  planned_truck_count?: number | null
  operator_loads_today?: number | null
} | null

type OpView = {
  has_plan: boolean
  excavator?: OpExcavator
  zones?: { loading_m?: number; waiting_m?: number }
  trucks: OpTruck[]
}

type ManualStatus = 'operating' | 'delay' | 'standby' | 'breakdown' | 'maintenance'

const EXC_STYLE: Record<string, { color: string; label: string }> = {
  loading: { color: '#FF4FB8', label: 'Loading' },
  waiting: { color: '#FFE600', label: 'Waiting' },
  idle: { color: '#94A3B8', label: 'Standby' },
  delay: { color: '#F97316', label: 'Delay' },
  down: { color: '#EF4444', label: 'Down' },
}

const MANUAL: { value: ManualStatus; color: string }[] = [
  { value: 'operating', color: '#16A34A' },
  { value: 'delay', color: '#F97316' },
  { value: 'standby', color: '#6B7280' },
  { value: 'breakdown', color: '#EF4444' },
  { value: 'maintenance', color: '#EF4444' },
]

const REASONS: Record<string, string[]> = {
  delay: ['Fuel', 'Road Block', 'Queue', 'Break', 'Tyre Check', 'Waiting Instruction', 'Other'],
  standby: ['Waiting Instruction', 'No Assignment', 'Shift Change', 'Meal / Break', 'Weather', 'Other'],
  breakdown: ['Engine Fault', 'Tyre Failure', 'Brake Issue', 'Hydraulic Fault', 'Electrical Fault', 'Other'],
  maintenance: ['Planned PM', 'Inspection', 'Tyre Check', 'Fuel / Service', 'Workshop', 'Other'],
}

function fmtTruck(no: string) {
  const s = String(no || '')
  return s.includes('-') ? s.split('-').pop()! : s
}

function stateRank(s?: string) {
  if (s === 'loading') return 0
  if (s === 'spot') return 1
  if (s === 'waiting') return 2
  return 3
}

// Truck states the EXCAVATOR cares about — at or approaching its bucket.
const AT_BUCKET_STATES = ['waiting', 'spot', 'loading']

function clock(sec?: number | null) {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtMin(sec?: number | null) {
  if (sec == null) return '—'
  return `${Math.max(0, Math.round(sec / 60))} min`
}

const shell: React.CSSProperties = {
  height: '100%',
  boxSizing: 'border-box',
  borderRadius: 20,
  border: '1px solid #3a3a3a',
  background: P.shell,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
}

const panel: React.CSSProperties = {
  background: P.panel,
  border: `1px solid ${P.line}`,
  borderRadius: 16,
}

const InfoTile = memo(function InfoTile({
  label,
  value,
  emphasis,
  tone,
}: {
  label: string
  value: string | number
  emphasis?: boolean
  tone?: string
}) {
  return (
    <div style={{ ...panel, padding: '10px 12px', background: P.panel2 }}>
      <div style={{ color: P.sub, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{
        marginTop: 4,
        fontWeight: 800,
        color: tone || P.ink,
        fontSize: emphasis ? '1.35rem' : '1rem',
        lineHeight: 1.1,
        fontFamily: emphasis ? 'ui-monospace, monospace' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  )
})

export default function ExcavatorOuiPanel({
  employeeId,
  excavatorNo,
  operatorName,
}: {
  employeeId: string
  excavatorNo: string
  operatorName?: string
}) {
  const dt = useDispatchT()
  const [view, setView] = useState<OpView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState<{ status: string; reason?: string } | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [pickStatus, setPickStatus] = useState<ManualStatus | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [nextBusy, setNextBusy] = useState(false)

  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const r = await apiFetch(`/api/dispatch/operator-view?employee_id=${encodeURIComponent(employeeId)}`)
        const d = await r.json()
        if (!alive) return
        if (d.success) {
          setView(d as OpView)
          setErr(null)
        } else setErr(d.message || 'unavailable')
      } catch {
        if (alive) setErr('network error')
      }
    }
    poll()
    const stop = visibleInterval(poll, 2000)
    return () => { alive = false; stop() }
  }, [employeeId])

  useEffect(() => {
    let alive = true
    apiFetch(`/api/dispatch/equipment-status?unit_no=${encodeURIComponent(excavatorNo)}`)
      .then((r) => r.json())
      .then((d) => { if (alive && d.success && d.status) setManual(d.status) })
      .catch(() => {})
    return () => { alive = false }
  }, [excavatorNo])

  // The excavator only cares about trucks AT or APPROACHING its bucket:
  //   waiting / spot (queue, spotting) + loading (under the bucket).
  // Once a truck departs (fullTravel1 → dump → empty legs) it's on the haul
  // cycle and is NOT the excavator's concern — it vanishes from this screen
  // until it returns to the queue. (Pre-arrival emptyTravel2 trucks are still
  // inbound and not yet at the bucket, so they're excluded too.)
  const trucks = useMemo(() => (
    (view?.trucks || [])
      .filter((t) => AT_BUCKET_STATES.includes(t.state || ''))
      .slice().sort((a, b) =>
        (stateRank(a.state) - stateRank(b.state)) || ((a.distance_m ?? 1e9) - (b.distance_m ?? 1e9)))
  ), [view?.trucks])

  const loadingTruck = trucks.find((t) => t.state === 'loading') || null
  const queue = trucks.filter((t) => t.state !== 'loading')
  const nextNo = view?.excavator?.next_truck_no
  const planId = view?.excavator?.plan_id
  // With an active plan, an idle/standby excavator is really WAITING for the
  // next First Bucket — map idle→waiting so the header pill never reads
  // "Standby" mid-plan. The server normally sends loading|waiting; this is the
  // defensive fallback for the idle case (we still render the server status
  // verbatim for loading/waiting).
  const rawExcSt = view?.excavator?.exc_status
  const mapIdleToWaiting = rawExcSt === 'idle' && !!view?.has_plan
  const excSt = mapIdleToWaiting ? 'waiting' : rawExcSt
  const excStyle = excSt ? EXC_STYLE[excSt] : undefined

  const nonOp = manual && manual.status !== 'operating'
  const headColor = nonOp
    ? (MANUAL.find((m) => m.value === manual!.status)?.color || P.muted)
    : (mapIdleToWaiting
        ? (excStyle?.color || P.muted)
        : (view?.excavator?.exc_status_color || excStyle?.color || P.muted))
  const headLabel = nonOp
    ? dt('ms_' + manual!.status)
    : (mapIdleToWaiting
        ? (excStyle?.label || '—')
        : (view?.excavator?.exc_status_label || excStyle?.label || excSt || '—'))

  // Loading timer — runs from First Bucket. Anchor the server's time_in_state_s
  // to a local wall-clock baseline so the counter ticks every second smoothly
  // (instead of jumping on the 2s poll). Re-anchors whenever the loading truck or
  // its server-reported elapsed changes.
  const loadAnchor = useRef<{ truck: string; baseSec: number; at: number } | null>(null)
  if (loadingTruck) {
    const srvSec = loadingTruck.time_in_state_s ?? 0
    const a = loadAnchor.current
    if (!a || a.truck !== loadingTruck.truck_no || Math.abs((a.baseSec) - srvSec) > 2.5) {
      loadAnchor.current = { truck: loadingTruck.truck_no, baseSec: srvSec, at: Date.now() }
    }
  } else {
    loadAnchor.current = null
  }

  useEffect(() => {
    // Reset per-truck transient state whenever the truck under the bucket
    // changes (Truck 1 kickout → Truck 2 First Bucket → Truck 3 …) or clears.
    // Drops the previous truck's FULL-confirmation message so stale "✓ DT-1 …"
    // text never lingers over a new/empty NOW LOADING strip. The load timer
    // re-anchors above on the same truck_no change, so the displayed elapsed
    // always belongs to the CURRENT truck, never the previous one.
    setMsg('')
    if (!loadingTruck) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [loadingTruck?.truck_no])

  void tick
  const loadingSec = loadingTruck && loadAnchor.current
    ? loadAnchor.current.baseSec + Math.floor((Date.now() - loadAnchor.current.at) / 1000)
    : null

  async function full() {
    if (!planId || !loadingTruck) return
    setActing(true)
    setMsg('')
    try {
      const r = await apiFetch('/api/dispatch/loading/finish', {
        method: 'POST',
        body: JSON.stringify({ plan_id: planId, truck_no: loadingTruck.truck_no, excavator_no: excavatorNo }),
      })
      const d = await r.json()
      // Excavator panel = LOADING CONTROL ONLY. After kickout we confirm the
      // load is done but NEVER surface the truck's post-load TRAVEL state
      // (no "Full Travel 1" etc.) — that's haul-cycle info, not the operator's
      // concern. Neutral "loaded" confirmation only.
      setMsg(r.ok && d.success ? `✓ ${fmtTruck(loadingTruck.truck_no)} ${dt('departed')}` : (d.message || 'Finish failed'))
    } catch {
      setMsg('Network error')
    } finally {
      setActing(false)
    }
  }

  // Excavator-operator OVERRIDE: tap a queued truck to make it the next to spot
  // (when the auto longest-waiting pick can't load). Tapping the current 'next'
  // again clears the override back to automatic.
  async function chooseNext(truckNo: string) {
    if (!planId || nextBusy) return
    const clear = truckNo === nextNo && !!view?.excavator?.preferred_next_truck
    setNextBusy(true)
    try {
      await apiFetch('/api/dispatch/loading/next-truck', {
        method: 'POST',
        body: JSON.stringify({ plan_id: planId, truck_no: clear ? null : truckNo }),
      })
      // optimistic: reflect immediately; the 2s poll will confirm
      setView((v) => v ? { ...v, excavator: { ...v.excavator, next_truck_no: clear ? undefined : truckNo, preferred_next_truck: clear ? undefined : truckNo } } as OpView : v)
    } catch { /* poll will correct */ } finally {
      setNextBusy(false)
    }
  }

  async function sendStatus(status: ManualStatus, reason?: string) {
    setStatusBusy(true)
    try {
      const r = await apiFetch('/api/dispatch/equipment-status', {
        method: 'POST',
        body: JSON.stringify({ unit_no: excavatorNo, unit_type: 'excavator', status, reason, employee_id: employeeId }),
      })
      const d = await r.json()
      if (r.ok && d.success) {
        setManual({ status, reason })
        setStatusOpen(false)
        setPickStatus(null)
      }
    } catch { /* keep open */ } finally {
      setStatusBusy(false)
    }
  }

  const shiftDate = view?.excavator?.plan_date
    ? String(view.excavator.plan_date).slice(0, 10)
    : '—'

  return (
    <div style={shell}>
      {/* header — compact: small unit no + operator, slim status pill */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px', borderBottom: `1px solid ${P.line}`, background: '#101010', flexShrink: 0,
      }}>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.15rem', fontWeight: 900, color: P.ink, letterSpacing: '-0.02em' }}>
            {excavatorNo}
          </span>
          <span style={{ color: P.sub, fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {operatorName || dt('operator')}
          </span>
        </div>
        {/* Loaded-today — this OPERATOR's daily total across all their logins. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, marginRight: 4 }}>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.15rem', fontWeight: 900, color: P.loading }}>
            {view?.excavator?.operator_loads_today ?? 0}
          </span>
          <span style={{ color: P.sub, fontSize: '0.5rem', fontWeight: 800, letterSpacing: '0.06em' }}>{dt('loaded_today').toUpperCase()}</span>
        </div>
        <div style={{
          padding: '4px 11px', borderRadius: 999, fontWeight: 900, fontSize: '0.72rem',
          textTransform: 'uppercase', color: P.ink, whiteSpace: 'nowrap',
          border: `1px solid ${headColor}88`, background: `${headColor}33`,
        }}>
          {headLabel}
        </div>
      </header>

      {err && !view && (
        <div style={{ padding: 12, color: P.accent, flexShrink: 0 }}>{err}</div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 10, padding: 10 }}>
        {/* LEFT — queue & loading */}
        <div style={{ flex: '1.05 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {view && !view.has_plan && (
            <div style={{ ...panel, padding: 12, color: P.sub, flexShrink: 0 }}>{dt('no_active_plan')}</div>
          )}

          {nonOp && (
            <div style={{
              ...panel, padding: 12, flexShrink: 0,
              border: `1px solid ${headColor}88`, background: `${headColor}55`, color: P.ink,
            }}>
              <div style={{ fontWeight: 900, fontSize: '1.05rem', textTransform: 'uppercase' }}>{headLabel}</div>
              {manual?.reason && <div style={{ marginTop: 4, fontSize: '0.82rem' }}>{dt('reason')}: {manual.reason}</div>}
              <div style={{ marginTop: 6, fontSize: '0.78rem', color: P.sub }}>{dt('out_of_cycle_exc')}</div>
            </div>
          )}

          {!nonOp && view?.has_plan && (
            <>
              {/* NOW LOADING — one sleek strip: the truck currently under the
                  bucket + its live load timer. Empty = waiting for First Bucket. */}
              <div style={{
                ...panel, padding: '10px 12px', flexShrink: 0,
                border: `1px solid ${loadingTruck ? P.loading : P.line}`,
                background: loadingTruck ? `${P.loading}16` : P.panel2,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: loadingTruck ? P.loading : P.waiting, fontSize: '0.56rem', fontWeight: 900, letterSpacing: '0.1em' }}>
                    {(loadingTruck ? dt('now_loading') : dt('zone_waiting')).toUpperCase()}
                  </div>
                  {loadingTruck ? (
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.7rem', fontWeight: 900, lineHeight: 1.05, color: P.ink }}>
                      {fmtTruck(loadingTruck.truck_no)}
                    </div>
                  ) : (
                    <div style={{ color: P.sub, fontWeight: 700, fontSize: '0.82rem', marginTop: 2 }}>⏳ {dt('waiting_first_bucket')}</div>
                  )}
                </div>
                {loadingTruck && (
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.7rem', fontWeight: 900, color: P.loading, lineHeight: 1 }}>
                    {clock(loadingSec)}
                  </div>
                )}
              </div>

              {/* QUEUE — just truck numbers, tap to choose who loads next. The
                  longest-waiting is highlighted by default; ★ = operator override. */}
              <div style={{ ...panel, flex: 1, minHeight: 0, padding: '10px 12px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                  <span style={{ color: P.ink, fontWeight: 900, fontSize: '0.66rem', letterSpacing: '0.08em' }}>
                    {dt('queue').toUpperCase()} · {queue.length}
                  </span>
                  <span style={{ color: P.muted, fontSize: '0.58rem', fontWeight: 600 }}>{dt('tap_to_load_next')}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {queue.length === 0 && <div style={{ color: P.muted, fontSize: '0.8rem' }}>{dt('no_trucks_feed')}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 6 }}>
                    {queue.map((t) => {
                      const isNext = t.truck_no === nextNo
                      const isOverride = isNext && !!view?.excavator?.next_is_override
                      const tappable = t.state === 'waiting' || t.state === 'spot'
                      return (
                        <button key={t.truck_no} type="button"
                          onClick={() => tappable && chooseNext(t.truck_no)}
                          disabled={!tappable || nextBusy}
                          title={fmtMin(t.time_in_state_s)}
                          style={{
                            position: 'relative',
                            textAlign: 'center', cursor: tappable ? 'pointer' : 'default',
                            padding: '9px 6px', borderRadius: 10,
                            fontFamily: 'ui-monospace, monospace', fontWeight: 900, fontSize: '1rem', color: P.ink,
                            border: isNext ? `2px solid ${P.waiting}` : `1px solid ${P.line}`,
                            background: isNext ? `${P.waiting}1e` : P.panel2,
                          }}>
                          {fmtTruck(t.truck_no)}
                          {isNext && (
                            <span style={{ position: 'absolute', top: 2, right: 5, fontSize: '0.5rem', fontWeight: 900, color: P.waiting }}>
                              {isOverride ? '★' : '▸'}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT — FULL · plan · status */}
        <div style={{ flex: '0.95 1 0', maxWidth: 420, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {nonOp ? (
            <button
              type="button"
              onClick={() => sendStatus('operating', 'Back to Ready')}
              disabled={statusBusy}
              style={{
                minHeight: 72, borderRadius: 16, border: `2px solid ${P.accent}88`,
                background: `${P.accent}22`, color: P.accent, fontWeight: 900, fontSize: '1rem', cursor: 'pointer',
              }}
            >
              {dt('return_operating')}
            </button>
          ) : view?.has_plan ? (
            <>
              <button
                type="button"
                onClick={full}
                disabled={acting || !loadingTruck}
                style={{
                  width: '100%', minHeight: 76, borderRadius: 14, flexShrink: 0,
                  border: `1px solid ${P.accent}aa`, background: acting || !loadingTruck ? '#2c2c2c' : P.accent,
                  color: acting || !loadingTruck ? P.muted : '#1a1a1a',
                  fontWeight: 900, fontSize: '1.5rem', letterSpacing: '0.02em',
                  cursor: acting || !loadingTruck ? 'not-allowed' : 'pointer',
                  boxShadow: loadingTruck ? `0 0 18px ${P.accent}40` : 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                }}
              >
                <span>{acting ? dt('recording') : (loadingTruck ? dt('full_kickout') : dt('full'))}</span>
                {loadingTruck && !acting && (
                  <span style={{ fontSize: '0.62rem', fontWeight: 700, opacity: 0.85 }}>
                    {fmtTruck(loadingTruck.truck_no)}
                  </span>
                )}
              </button>
              {msg && (
                <div style={{ fontSize: '0.78rem', color: msg.includes('✓') ? '#86EFAC' : '#FCA5A5', flexShrink: 0 }}>{msg}</div>
              )}
            </>
          ) : null}

          {view?.excavator && view.has_plan && (
            <div style={{ ...panel, padding: '10px 12px', flex: '1 1 0', minHeight: 0 }}>
              <div style={{ color: P.ink, fontWeight: 900, fontSize: '0.66rem', letterSpacing: '0.08em', marginBottom: 8 }}>
                {dt('plan_details').toUpperCase()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <InfoTile label={dt('plan')} value={planId ? `#${planId}` : '—'} />
                <InfoTile label={dt('shift')} value={`${view.excavator.shift || '?'} · ${shiftDate}`} />
                <InfoTile label={dt('loading_loc')} value={view.excavator.loading_location_name || '—'} />
                <InfoTile label={dt('dump_loc')} value={view.excavator.dump_location_name || '—'} />
                <InfoTile label="Trips" value={view.excavator.target_trips ?? '—'} />
                <InfoTile label="Trucks" value={view.excavator.planned_truck_count ?? '—'} />
              </div>
            </div>
          )}

          {/* Machine-availability / status selector — ALWAYS pinned & visible at
              the bottom of the right column. The plan-details panel above absorbs
              any vertical squeeze (scrolls internally) so this never gets pushed
              off-screen; marginTop:auto keeps it at the bottom when no plan. */}
          <div style={{ marginTop: 'auto', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setStatusOpen(true)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                background: P.panel, border: `1px solid ${manual?.status && manual.status !== 'operating' ? headColor : P.line}`,
              }}
            >
              <span style={{ color: P.sub, fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em' }}>{dt('machine_availability')}</span>
              <span style={{ color: P.accent, fontWeight: 800, fontSize: '0.74rem' }}>{dt('change_status')} ›</span>
            </button>
          </div>
        </div>
      </div>

      {statusOpen && (
        <div
          onClick={() => { setStatusOpen(false); setPickStatus(null) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(0,0,0,0.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 460, background: P.panel, border: `1px solid ${P.line}`,
              borderRadius: 18, padding: 18,
            }}
          >
            <div style={{ color: P.ink, fontWeight: 900, fontSize: '1rem', marginBottom: 12 }}>{dt('machine_availability')}</div>
            {manual?.status && manual.status !== 'operating' && (
              <button type="button" onClick={() => sendStatus('operating')} disabled={statusBusy}
                style={{ width: '100%', marginBottom: 12, padding: 12, borderRadius: 12, border: 'none', background: '#16A34A', color: '#fff', fontWeight: 800 }}>
                {dt('return_operating')}
              </button>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {MANUAL.filter((m) => m.value !== 'operating').map((m) => (
                <button key={m.value} type="button" onClick={() => setPickStatus(m.value)}
                  style={{
                    minHeight: 52, borderRadius: 12, fontWeight: 800, cursor: 'pointer',
                    border: pickStatus === m.value ? `2px solid ${P.accent}` : `1px solid ${P.line}`,
                    background: pickStatus === m.value ? `${P.accent}22` : P.panel2, color: P.ink,
                  }}>
                  {dt('ms_' + m.value)}
                </button>
              ))}
            </div>
            {pickStatus && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: P.sub, fontSize: '0.72rem', marginBottom: 8 }}>{dt('reason')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(REASONS[pickStatus] || ['Other']).map((rsn) => (
                    <button key={rsn} type="button" onClick={() => sendStatus(pickStatus, rsn)} disabled={statusBusy}
                      style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${P.line}`, background: P.panel2, color: P.ink, fontWeight: 700 }}>
                      {rsn}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="button" onClick={() => { setStatusOpen(false); setPickStatus(null) }}
              style={{ marginTop: 14, width: '100%', padding: 10, background: 'transparent', border: `1px solid ${P.line}`, borderRadius: 10, color: P.sub, fontWeight: 700 }}>
              {dt('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
