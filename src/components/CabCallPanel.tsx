// CabCallPanel -- the in-cab PRISM Cab Call surface (the "intercom phone").
//
// Mounted alongside CabCallButton on the connected operator window. It is the
// cab's cab-call SURFACE layer and owns the CabCallController lifecycle:
//
//   * a full-screen BLUE incoming-call ring (Answer / Decline) when the dispatcher
//     calls this cab, and an "on call / calling" state with a tap-to-talk toggle
//     (the call opens MUTED) + End,
//   * an AMBER broadcast banner stack at the top for dispatcher -> fleet messages
//     (tap Dismiss to acknowledge).
//
// The actual CALL trigger (single-tap role picker + long-press emergency) lives in
// the sibling CabCallButton; this panel renders only the in-call + broadcast UI.
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
const BLUE_LT = '#38BDF8'
const AMBER = '#f59e0b'     // broadcast banner
const GREEN = '#22c55e'
const RED = '#ef4444'

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
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(ctrl.isMuted())
  // Live call elapsed-time ticker.
  const [elapsed, setElapsed] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── controller lifecycle: connect on mount, release on unmount ──
  useEffect(() => {
    const off = ctrl.onPhase((p) => setPhase(p))
    const offB = ctrl.onBroadcasts((b) => setBroadcasts([...b]))
    const offM = ctrl.onMute((m) => setMuted(m))
    void ctrl.connect(identity)
    return () => { off(); offB(); offM(); ctrl.disconnect() }
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

  // Tap-to-talk: flip the mic on the leased slot (and the dispatcher "speaking"
  // indicator). The call opens MUTED; this is the operator's PTT toggle.
  const toggleTalk = useCallback(() => {
    ctrl.toggleMute()
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
            ) : connected ? (
              <>
                {/* Tap-to-talk: the call opens MUTED, the operator taps Talk to
                    open the mic (PTT = tap-toggle, matching the radio decision). */}
                <button onClick={toggleTalk} disabled={busy}
                        style={callBtn(muted ? D.line2 : GREEN)}>
                  {muted ? `🎙️ ${dt('cabcall_talk')}` : `● ${dt('cabcall_speaking')}`}
                </button>
                <button onClick={endCall} disabled={busy}
                        style={callBtn(RED)}>✕ {dt('cabcall_end')}</button>
              </>
            ) : (
              <button onClick={endCall} disabled={busy}
                      style={callBtn(RED)}>✕ {dt('cabcall_end')}</button>
            )}
          </div>
        </div>
      )}

      {/* The single floating CALL button (single-tap role picker + long-press
          emergency) now lives in CabCallButton.tsx -- this panel only renders the
          incoming-ring / connected-call surface and the broadcast banner stack. */}
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
