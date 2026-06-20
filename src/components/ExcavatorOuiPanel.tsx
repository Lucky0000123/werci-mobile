// Excavator operator OUI — prototype ExcavatorOuiPanel layout for the in-cab APK.
// Single screen, no page scroll: header · queue/loading (left) · FULL + plan (right).
import { memo, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../services/api'
import { useDispatchT } from '../services/dispatchI18n'

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
  waiting: { color: '#FFE600', label: 'Ready / Operating' },
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
    const h = setInterval(poll, 2000)
    return () => { alive = false; clearInterval(h) }
  }, [employeeId])

  useEffect(() => {
    let alive = true
    apiFetch(`/api/dispatch/equipment-status?unit_no=${encodeURIComponent(excavatorNo)}`)
      .then((r) => r.json())
      .then((d) => { if (alive && d.success && d.status) setManual(d.status) })
      .catch(() => {})
    return () => { alive = false }
  }, [excavatorNo])

  const trucks = useMemo(() => (
    (view?.trucks || []).slice().sort((a, b) =>
      (stateRank(a.state) - stateRank(b.state)) || ((a.distance_m ?? 1e9) - (b.distance_m ?? 1e9)))
  ), [view?.trucks])

  const loadingTruck = trucks.find((t) => t.state === 'loading') || null
  const queue = trucks.filter((t) => t.state !== 'loading')
  const nextNo = view?.excavator?.next_truck_no
  const nextTruck = queue.find((t) => t.truck_no === nextNo) || queue[0] || null
  const planId = view?.excavator?.plan_id
  const lz = view?.zones?.loading_m ?? view?.excavator?.loading_zone_m
  const wz = view?.zones?.waiting_m ?? view?.excavator?.waiting_zone_m
  const excSt = view?.excavator?.exc_status
  const excStyle = excSt ? EXC_STYLE[excSt] : undefined

  const nonOp = manual && manual.status !== 'operating'
  const headColor = nonOp
    ? (MANUAL.find((m) => m.value === manual!.status)?.color || P.muted)
    : (view?.excavator?.exc_status_color || excStyle?.color || P.muted)
  const headLabel = nonOp
    ? dt('ms_' + manual!.status)
    : (view?.excavator?.exc_status_label || excStyle?.label || excSt || '—')

  useEffect(() => {
    if (!loadingTruck) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [loadingTruck?.truck_no])

  const loadingSec = loadingTruck?.time_in_state_s ?? null
  void tick

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
      setMsg(r.ok && d.success ? `✓ ${fmtTruck(loadingTruck.truck_no)} → Full Travel 1` : (d.message || 'Finish failed'))
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
      {/* header */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '12px 14px', borderBottom: `1px solid ${P.line}`, background: '#101010', flexShrink: 0,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.75rem', fontWeight: 900, color: P.ink, letterSpacing: '-0.02em' }}>
            {excavatorNo}
          </div>
          <div style={{ color: P.sub, fontSize: '0.78rem', fontWeight: 600 }}>
            {operatorName || dt('operator')} · {dt('excavator')}
            {lz != null && wz != null ? ` · ${lz}/${wz} m` : ''}
          </div>
        </div>
        <div style={{
          padding: '8px 14px', borderRadius: 12, fontWeight: 900, fontSize: '0.95rem',
          textTransform: 'uppercase', color: P.ink,
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, flexShrink: 0 }}>
                <InfoTile
                  label={dt('current_loading')}
                  value={loadingTruck ? fmtTruck(loadingTruck.truck_no) : dt('no_truck_loading')}
                  emphasis
                  tone={loadingTruck ? P.loading : P.ink}
                />
                <InfoTile label={dt('next')} value={nextTruck ? fmtTruck(nextTruck.truck_no) : '—'} emphasis />
                <InfoTile label={dt('queue')} value={queue.length} emphasis tone={P.accent} />
              </div>

              <div style={{
                ...panel, padding: 12, flexShrink: 0,
                border: `1px solid ${P.loading}55`, background: `${P.loading}14`,
              }}>
                <div style={{ color: P.loading, fontWeight: 900, fontSize: '0.62rem', letterSpacing: '0.1em', marginBottom: 8 }}>
                  {dt('current_loading').toUpperCase()}
                </div>
                {loadingTruck ? (
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ color: P.sub, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em' }}>{dt('truck')}</div>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '2.6rem', fontWeight: 900, lineHeight: 1, color: P.ink }}>
                        {fmtTruck(loadingTruck.truck_no)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: P.sub, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em' }}>{dt('loading_cap')}</div>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '2.6rem', fontWeight: 900, lineHeight: 1, color: P.ink }}>
                        {clock(loadingSec)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: P.ink, fontWeight: 800, fontSize: '1.05rem' }}>⏳ {dt('waiting_first_bucket')}</div>
                )}
              </div>

              <div style={{ ...panel, flex: 1, minHeight: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
                  <div style={{ color: P.ink, fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.06em' }}>{dt('queue').toUpperCase()}</div>
                  {nextNo && (
                    <span style={{
                      padding: '3px 8px', borderRadius: 8, fontSize: '0.68rem', fontWeight: 800,
                      border: `1px solid ${P.waiting}66`, background: `${P.waiting}18`, color: P.waiting,
                    }}>
                      {dt('next')}: {fmtTruck(nextNo)}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                  {queue.length === 0 && <div style={{ color: P.muted, fontSize: '0.84rem' }}>{dt('no_trucks_feed')}</div>}
                  {queue.length > 0 && (
                    <div style={{ color: P.muted, fontSize: '0.62rem', fontWeight: 700, marginBottom: 6 }}>
                      {dt('tap_to_load_next')}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
                    {queue.map((t) => {
                      const isNext = t.truck_no === nextNo
                      const isOverride = isNext && !!view?.excavator?.next_is_override
                      const tappable = t.state === 'waiting' || t.state === 'spot'
                      return (
                        <button key={t.truck_no} type="button"
                          onClick={() => tappable && chooseNext(t.truck_no)}
                          disabled={!tappable || nextBusy}
                          style={{
                            ...panel,
                            textAlign: 'left', cursor: tappable ? 'pointer' : 'default',
                            padding: '8px 10px',
                            border: isNext ? `2px solid ${P.waiting}` : `1px solid ${P.line}`,
                            background: isNext ? `${P.waiting}1e` : P.panel2,
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 900, fontSize: '1.05rem', color: P.ink }}>
                              {fmtTruck(t.truck_no)}
                            </span>
                            {isNext && (
                              <span style={{ fontSize: '0.54rem', fontWeight: 900, color: P.waiting, letterSpacing: '0.04em' }}>
                                {isOverride ? '★ ' + dt('next').toUpperCase() : dt('next').toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div style={{ color: P.muted, fontSize: '0.72rem', fontWeight: 700, marginTop: 2 }}>
                            {fmtMin(t.time_in_state_s)}
                          </div>
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
              <div style={{ ...panel, padding: 14, border: `1px solid ${P.accent}55`, background: '#101820', flexShrink: 0 }}>
                <div style={{ color: P.accent, fontWeight: 900, fontSize: '0.62rem', letterSpacing: '0.1em', marginBottom: 8 }}>
                  PRIMARY ACTION
                </div>
                <button
                  type="button"
                  onClick={full}
                  disabled={acting || !loadingTruck}
                  style={{
                    width: '100%', minHeight: 120, borderRadius: 16,
                    border: `1px solid ${P.accent}aa`, background: acting || !loadingTruck ? '#3a3a3a' : P.accent,
                    color: acting || !loadingTruck ? P.muted : '#232323',
                    fontWeight: 900, fontSize: '2.4rem', letterSpacing: '0.04em', cursor: acting || !loadingTruck ? 'not-allowed' : 'pointer',
                    boxShadow: loadingTruck ? `0 0 24px ${P.accent}44` : 'none',
                  }}
                >
                  {acting ? dt('recording') : (loadingTruck ? dt('full_kickout') : dt('full'))}
                </button>
                <div style={{ marginTop: 8, fontSize: '0.76rem', fontWeight: 700, color: P.sub }}>
                  {loadingTruck ? `${dt('complete_load')} · ${fmtTruck(loadingTruck.truck_no)}` : dt('no_truck_loading')}
                </div>
              </div>
              {msg && (
                <div style={{ fontSize: '0.82rem', color: msg.includes('✓') ? '#86EFAC' : '#FCA5A5', flexShrink: 0 }}>{msg}</div>
              )}
            </>
          ) : null}

          {view?.excavator && view.has_plan && (
            <div style={{ ...panel, padding: 12, flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}>
              <div style={{ color: P.ink, fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.06em', marginBottom: 8 }}>
                {dt('plan_details').toUpperCase()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <InfoTile label={dt('plan')} value={planId ? `#${planId}` : '—'} />
                <InfoTile label={dt('shift')} value={view.excavator.shift || '—'} />
                <InfoTile label={dt('loading_loc')} value={view.excavator.loading_location_name || '—'} />
                <InfoTile label={dt('dump_loc')} value={view.excavator.dump_location_name || '—'} />
                <InfoTile label="Shift / Date" value={`${view.excavator.shift || '?'} · ${shiftDate}`} />
                <InfoTile label="Planned trucks" value={view.excavator.planned_truck_count ?? '—'} />
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
