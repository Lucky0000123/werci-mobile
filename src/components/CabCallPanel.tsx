// CabCallPanel -- the in-cab PRISM Cab Call surface (the "intercom phone").
//
// Mounted alongside AdvancedRadioPTT on the connected operator window. It is the
// cab's ENTIRE cab-call surface and owns the CabCallController lifecycle:
//
//   * a floating glove-friendly button (left thumb-zone, mirrored from the radio
//     PTT on the right) -> single tap opens the quick-actions sheet:
//        - Call Dispatch (1:1 private line)
//        - Report breakdown / Request fuel / No assignment (status alerts)
//   * a full-screen BLUE incoming-call ring (Answer / Decline) when the dispatcher
//     calls this cab, and an "on call / calling" state with End,
//   * an AMBER broadcast banner stack at the top for dispatcher -> fleet messages
//     (tap Dismiss to acknowledge).
//
// Distinct from the radio (📻 amber PA) and the emergency path (🚨 red siren):
// cab call is BLUE (calls) + AMBER (broadcasts). MEDICAL_EMERGENCY is intentionally
// NOT offered here -- that stays on the existing emergency flow.
//
// Talks ONLY to the transport-agnostic CabCallController (services/cabcall.ts).
// Every call is best-effort: a cab-call outage degrades to "Cab Call offline" and
// can NEVER affect the haul-cycle. Lazy-loaded so the dispatch screen pulls in no
// cab-call code until a unit is connected. See docs/prism_cab_call.md.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useDispatchT } from '../services/dispatchI18n'
import {
  getCabCallController,
  type CabCallPhase,
  type CabBroadcast,
  type CabIdentity,
} from '../services/cabcall'

// Self-contained palette (lazy-loadable without DispatchPage internals).
const D = {
  bg: '#0b0f17', panel: '#141414', panel2: '#1c1c1c', line2: '#3a3a3a',
  ink: '#ffffff', sub: '#9ca3af', sub2: '#d6d6d6',
}
const BLUE = '#2563eb'      // 1:1 call ring (distinct from radio amber + emergency red)
const BLUE_LT = '#38BDF8'
const AMBER = '#f59e0b'     // broadcast banner
const GREEN = '#22c55e'
const RED = '#ef4444'
const BUTTON_SIZE = 96

export interface CabCallPanelProps {
  identity: CabIdentity
}

const KEYFRAMES = `
@keyframes cabcall-ring-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.55) } 50% { box-shadow: 0 0 0 22px rgba(37,99,235,0) } }
@keyframes cabcall-banner-in  { from { transform: translateY(-12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
`

function PhoneIcon({ size = 32, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.58 3.6a1 1 0 0 1-.25 1l-2.2 2.2Z" fill={color} />
    </svg>
  )
}

export default function CabCallPanel({ identity }: CabCallPanelProps) {
  const dt = useDispatchT()
  const ctrl = getCabCallController()
  const [phase, setPhase] = useState<CabCallPhase>(ctrl.getPhase())
  const [broadcasts, setBroadcasts] = useState<CabBroadcast[]>(ctrl.getBroadcasts())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Live call elapsed-time ticker.
  const [elapsed, setElapsed] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── controller lifecycle: connect on mount, release on unmount ──
  useEffect(() => {
    const off = ctrl.onPhase((p) => { setPhase(p); if (p !== 'connected') setSheetOpen(false) })
    const offB = ctrl.onBroadcasts((b) => setBroadcasts([...b]))
    void ctrl.connect(identity)
    return () => { off(); offB(); ctrl.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── call timer: count up while connected ──
  useEffect(() => {
    if (phase === 'connected') {
      const start = ctrl.getCall()?.startedAt || Date.now()
      const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
      tick()
      tickRef.current = setInterval(tick, 1000)
    } else {
      setElapsed(0)
    }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const ringing = phase === 'ringing_in'
  const outgoing = phase === 'ringing_out'
  const connected = phase === 'connected'
  const offline = phase === 'offline'
  const inCall = ringing || outgoing || connected || phase === 'connecting'

  const answer = useCallback(async () => {
    if (busy) return
    setBusy(true); try { await ctrl.answer() } finally { setBusy(false) }
  }, [ctrl, busy])
  const decline = useCallback(async () => {
    if (busy) return
    setBusy(true); try { await ctrl.end('DECLINED') } finally { setBusy(false) }
  }, [ctrl, busy])
  const endCall = useCallback(async () => {
    if (busy) return
    setBusy(true); try { await ctrl.end('NORMAL') } finally { setBusy(false) }
  }, [ctrl, busy])

  const callDispatch = useCallback(async () => {
    setSheetOpen(false)
    await ctrl.callDispatcher('MANUAL')
  }, [ctrl])
  const raise = useCallback(async (type: 'BREAKDOWN' | 'FUEL_REQUIRED' | 'WAITING_NO_ASSIGNMENT') => {
    setSheetOpen(false)
    await ctrl.raiseStatusAlert(type)
  }, [ctrl])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* ── broadcast banner stack (top, amber) ── */}
      {broadcasts.length > 0 && (
        <div style={{ position: 'fixed', insetInline: 0, top: 'calc(12px + env(safe-area-inset-top,0px))',
                      zIndex: 7300, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      pointerEvents: 'none', padding: '0 12px' }}>
          {broadcasts.slice(0, 3).map((b) => {
            const urgent = (b.priority || '').toUpperCase() === 'URGENT'
            const accent = urgent ? RED : AMBER
            return (
              <div key={b.broadcastId}
                   style={{ pointerEvents: 'auto', width: '100%', maxWidth: 560,
                            background: urgent ? '#3a0d0d' : '#3a2a05', border: `2px solid ${accent}`,
                            borderRadius: 14, padding: '12px 14px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                            animation: 'cabcall-banner-in 0.25s ease-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: '1.05rem' }} aria-hidden>📢</span>
                  <span style={{ color: accent, fontWeight: 900, fontSize: '0.78rem', letterSpacing: '0.04em',
                                 textTransform: 'uppercase' }}>
                    {urgent ? dt('cabcall_broadcast_urgent') : dt('cabcall_broadcast')}
                  </span>
                  <span style={{ marginLeft: 'auto', color: D.sub, fontSize: '0.72rem', fontWeight: 700 }}>
                    {b.senderName}
                  </span>
                </div>
                {b.messageText && (
                  <div style={{ color: D.ink, fontSize: '0.98rem', fontWeight: 600, lineHeight: 1.35 }}>
                    {b.messageText}
                  </div>
                )}
                <button onClick={() => void ctrl.acknowledgeBroadcast(b.broadcastId)}
                        style={{ marginTop: 10, width: '100%', minHeight: 48, borderRadius: 10, border: 'none',
                                 background: accent, color: '#1a1a1a', fontWeight: 900, fontSize: '0.92rem',
                                 cursor: 'pointer' }}>
                  ✓ {dt('cabcall_dismiss')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── full-screen incoming / active call (blue) ── */}
      {inCall && (
        <div role="dialog" aria-label={dt('cabcall')}
             style={{ position: 'fixed', inset: 0, zIndex: 7800, background: 'rgba(2,6,12,0.92)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 22, padding: 'calc(24px + env(safe-area-inset-top,0px)) 20px calc(24px + env(safe-area-inset-bottom,0px))' }}>
          <div style={{ width: 132, height: 132, borderRadius: '50%', border: `4px solid ${BLUE_LT}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(37,99,235,0.18)',
                        animation: (ringing || outgoing) ? 'cabcall-ring-pulse 1.1s ease-in-out infinite' : 'none' }}>
            <PhoneIcon size={56} color={BLUE_LT} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#fff', fontWeight: 900, fontSize: '1.4rem', letterSpacing: '0.01em' }}>
              {ringing ? dt('cabcall_from_dispatch')
                : outgoing ? dt('cabcall_calling')
                : connected ? dt('cabcall_connected')
                : dt('cabcall_calling')}
            </div>
            {connected && (
              <div style={{ color: BLUE_LT, fontWeight: 800, fontSize: '1.6rem', marginTop: 8,
                            fontVariantNumeric: 'tabular-nums' }}>{mmss}</div>
            )}
            <div style={{ color: D.sub, fontSize: '0.9rem', marginTop: 6 }}>
              {ctrl.getCall()?.callerName || 'Control Room'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {ringing ? (
              <>
                <button onClick={decline} disabled={busy}
                        style={callBtn(RED)}>✕ {dt('cabcall_decline')}</button>
                <button onClick={answer} disabled={busy}
                        style={callBtn(GREEN)}>📞 {dt('cabcall_answer')}</button>
              </>
            ) : (
              <button onClick={endCall} disabled={busy}
                      style={callBtn(RED)}>✕ {dt('cabcall_end')}</button>
            )}
          </div>
        </div>
      )}

      {/* ── floating cab-call button (left thumb-zone; radio PTT is on the right) ── */}
      {!inCall && (
        <div style={{ position: 'fixed', zIndex: 7400,
                      left: 'calc(18px + env(safe-area-inset-left,0px))',
                      bottom: 'calc(18px + env(safe-area-inset-bottom,0px))',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em',
                         color: offline ? RED : BLUE_LT, background: 'rgba(11,15,23,0.75)',
                         padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase' }}>
            {offline ? dt('cabcall_offline') : dt('cabcall')}
          </span>
          <button
            aria-label={dt('cabcall')}
            disabled={offline}
            onClick={() => { if (!offline) setSheetOpen(true) }}
            style={{ width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: '50%',
                     border: `4px solid ${offline ? RED : BLUE}`,
                     background: offline ? 'rgba(239,68,68,0.10)' : 'rgba(37,99,235,0.16)', color: '#fff',
                     display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                     cursor: offline ? 'default' : 'pointer', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                     opacity: offline ? 0.6 : 1 }}>
            <PhoneIcon size={34} color={offline ? RED : BLUE_LT} />
            <span style={{ fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.05em',
                           color: offline ? RED : BLUE_LT }}>
              {offline ? dt('cabcall_offline').split(' ')[0].toUpperCase() : 'CALL'}
            </span>
          </button>
        </div>
      )}

      {/* ── quick-actions sheet (tap the button) ── */}
      {sheetOpen && !inCall && (
        <div onClick={() => setSheetOpen(false)}
             style={{ position: 'fixed', inset: 0, zIndex: 7700, background: 'rgba(2,6,12,0.78)',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: '100%', maxWidth: 560, background: D.panel, borderTopLeftRadius: 22,
                        borderTopRightRadius: 22, border: `1px solid ${D.line2}`, borderBottom: 'none',
                        padding: '18px 16px calc(18px + env(safe-area-inset-bottom,0px))',
                        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ color: D.ink, fontWeight: 900, fontSize: '1.05rem' }}>{dt('cabcall')}</span>
              <button onClick={() => setSheetOpen(false)}
                      style={{ padding: '10px 16px', minHeight: 44, borderRadius: 10, color: D.sub2,
                               background: 'transparent', border: `1px solid ${D.line2}`, fontWeight: 800, cursor: 'pointer' }}>
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={callDispatch} style={sheetBtn(BLUE)}>
                <PhoneIcon size={26} color={BLUE_LT} /> {dt('cabcall_call_dispatch')}
              </button>
              <button onClick={() => void raise('BREAKDOWN')} style={sheetBtn(RED)}>
                <span style={{ fontSize: '1.3rem' }} aria-hidden>🛠️</span> {dt('cabcall_breakdown')}
              </button>
              <button onClick={() => void raise('FUEL_REQUIRED')} style={sheetBtn(AMBER)}>
                <span style={{ fontSize: '1.3rem' }} aria-hidden>⛽</span> {dt('cabcall_fuel')}
              </button>
              <button onClick={() => void raise('WAITING_NO_ASSIGNMENT')} style={sheetBtn(D.sub2)}>
                <span style={{ fontSize: '1.3rem' }} aria-hidden>⏳</span> {dt('cabcall_no_assignment')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Large round-rect action button for the in-call controls.
function callBtn(color: string): React.CSSProperties {
  return {
    minWidth: 150, minHeight: 64, borderRadius: 16, border: 'none', background: color, color: '#fff',
    fontWeight: 900, fontSize: '1.05rem', cursor: 'pointer', letterSpacing: '0.02em',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  }
}
// Full-width sheet row (>=64px, glove-friendly).
function sheetBtn(accent: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 64, padding: '0 16px',
    borderRadius: 14, textAlign: 'left', cursor: 'pointer', color: '#fff', fontWeight: 800, fontSize: '1rem',
    border: `2px solid ${accent}`, background: '#1c1c1c',
  }
}
