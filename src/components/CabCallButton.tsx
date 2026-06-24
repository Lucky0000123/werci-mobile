// CabCallButton -- the cab's SINGLE smart control button.
//
// This one glove-friendly 96px button replaces the two old floating buttons (the
// radio PTT + the separate cab-call button). The mental model: the PHYSICAL radio
// is the mine's PA, so the tablet does not need a digital radio surface -- it
// needs the intercom (PRISM Cab Call) plus the panic button. So this button does
// exactly two things:
//
//   * single tap   -> open the role sheet (Dispatcher / Maintenance / Safety) and
//                     place a 1:1 cab call to whoever is monitoring that desk.
//   * hold >= 2.0s -> EMERGENCY: the EXISTING radio emergency path, UNCHANGED
//                     (radio.startEmergency() -> force SITE_EMERGENCY, open the
//                     mic hands-free, flag the dispatcher map RED, pulse the cab
//                     screen RED until ended). We only moved the trigger here; the
//                     emergency machinery in services/radio.ts is not touched.
//
// It owns the RadioController lifecycle (connect on mount / disconnect on unmount)
// because (a) the panic button needs a live radio, and (b) the cab-call voice
// borrows the SAME RadioController audio engine for the leased Mumble slot. The
// CabCallController lifecycle + the incoming-ring/connected/broadcast surfaces
// stay in CabCallPanel; this button only reads the cab-call phase (to hide while
// a call is up) and asks the controller to place a role call.
//
// Every call is best-effort: a radio/voice/network failure degrades to "offline"
// and can NEVER affect the haul-cycle. Lazy-loaded so the dispatch screen pulls in
// no radio/cab-call/audio code until a unit is connected.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useDispatchT } from '../services/dispatchI18n'
import { getRadioController, type RadioIdentity } from '../services/radio'
import {
  getCabCallController,
  type CabCallPhase,
  type CabCallRole,
  type CabCallNotice,
} from '../services/cabcall'

const D = {
  panel: '#141414', panel2: '#1c1c1c', line2: '#3a3a3a',
  ink: '#ffffff', sub: '#9ca3af', sub2: '#d6d6d6',
}
const BLUE = '#2563eb'      // cab call (1:1 intercom)
const BLUE_LT = '#38BDF8'
const AMBER = '#f59e0b'     // maintenance desk
const GREEN = '#22c55e'     // safety desk
const RED = '#ef4444'       // emergency
const BUTTON_SIZE = 96

// Hold this long to escalate to EMERGENCY (the single-button panic). 2.0s per the
// remediation spec (shorter than the old 3s radio long-press: the button has no
// hold-to-talk to disambiguate from, so a faster panic is safe).
const EMERGENCY_LONG_PRESS_MS = 2000
const TOAST_MS = 4500

export interface CabCallButtonProps {
  identity: RadioIdentity
}

const KEYFRAMES = `
@keyframes ccb-screen-pulse { 0%,100% { opacity: 0.18 } 50% { opacity: 0.42 } }
@keyframes ccb-ring-pulse   { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.55) } 50% { box-shadow: 0 0 0 18px rgba(239,68,68,0) } }
@keyframes ccb-toast-in     { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
`

function PhoneIcon({ size = 34, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.58 3.6a1 1 0 0 1-.25 1l-2.2 2.2Z" fill={color} />
    </svg>
  )
}
function AlertIcon({ size = 30, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 1.5 21h21L12 3Z" fill={color} />
      <path d="M12 9v5" stroke="#7f1d1d" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="1.3" fill="#7f1d1d" />
    </svg>
  )
}

export default function CabCallButton({ identity }: CabCallButtonProps) {
  const dt = useDispatchT()
  const radio = getRadioController()
  const cab = getCabCallController()

  const [emergency, setEmergency] = useState(radio.isEmergency())
  const [phase, setPhase] = useState<CabCallPhase>(cab.getPhase())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [arming, setArming] = useState(0)        // 0..1 toward emergency

  // Press bookkeeping (refs so the pointer handlers never go stale).
  const pressStartRef = useRef(0)
  const emergTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armRafRef = useRef<number | null>(null)
  const firedEmergencyRef = useRef(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── radio lifecycle: connect on mount (panic + the shared cab-call audio
  //     engine), release on unmount. Mirrors what AdvancedRadioPTT used to do. ──
  useEffect(() => {
    const offEmg = radio.onEmergency((e) => setEmergency(e))
    void radio.connect(identity)
    return () => {
      offEmg()
      void radio.pttUp()
      void radio.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── cab-call phase (read-only here; CabCallPanel owns the lifecycle) ──
  useEffect(() => {
    const off = cab.onPhase((p) => { setPhase(p); if (p !== 'idle') setSheetOpen(false) })
    const offN = cab.onNotice((n: CabCallNotice) => {
      const msg = n.type === 'no_monitor' ? dt('cabcall_no_monitor') : dt('cabcall_busy_notice')
      showToast(msg)
    })
    return () => { off(); offN() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dt])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const clearTimers = useCallback(() => {
    if (emergTimerRef.current) { clearTimeout(emergTimerRef.current); emergTimerRef.current = null }
    if (armRafRef.current) { cancelAnimationFrame(armRafRef.current); armRafRef.current = null }
    setArming(0)
  }, [])

  const triggerEmergency = useCallback(() => {
    firedEmergencyRef.current = true
    try { navigator.vibrate?.([120, 60, 120, 60, 240]) } catch { /* no haptics */ }
    void radio.startEmergency()              // EXISTING emergency path, unchanged
  }, [radio])

  const onDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    if (emergency) return                    // already in emergency: ignore presses
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
    pressStartRef.current = Date.now()
    firedEmergencyRef.current = false
    // Escalate to EMERGENCY at 2.0s; animate an arming ring toward that point.
    emergTimerRef.current = setTimeout(() => triggerEmergency(), EMERGENCY_LONG_PRESS_MS)
    const start = pressStartRef.current
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / EMERGENCY_LONG_PRESS_MS)
      setArming(p)
      if (p < 1 && !firedEmergencyRef.current) armRafRef.current = requestAnimationFrame(tick)
    }
    armRafRef.current = requestAnimationFrame(tick)
  }, [emergency, triggerEmergency])

  const onUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const fired = firedEmergencyRef.current
    clearTimers()
    // A release that did NOT escalate to emergency = a tap -> open the role sheet
    // (unless we are already in an emergency, where the press is a no-op).
    if (!fired && !emergency) setSheetOpen(true)
    firedEmergencyRef.current = false
  }, [clearTimers, emergency])

  const onCancel = useCallback(() => { clearTimers(); firedEmergencyRef.current = false }, [clearTimers])

  const callRole = useCallback(async (role: CabCallRole) => {
    setSheetOpen(false)
    if (phase !== 'idle') return
    await cab.callRole(role)                  // notices (no_monitor/busy) -> toast
  }, [cab, phase])

  const cabOffline = phase === 'offline'
  const inCall = phase !== 'offline' && phase !== 'idle'
  // The button hides entirely while a call surface (ring/connected) is up -- that
  // UI lives in CabCallPanel. Emergency overlay still renders below regardless.
  const showButton = !inCall

  const ringColor = emergency ? RED : (cabOffline ? RED : BLUE)
  const fillBg = emergency ? 'rgba(239,68,68,0.22)'
    : cabOffline ? 'rgba(239,68,68,0.10)'
    : 'rgba(37,99,235,0.16)'

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* full-screen RED pulse while an emergency is active (existing path) */}
      {emergency && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 7500, pointerEvents: 'none',
                      background: RED, animation: 'ccb-screen-pulse 0.9s ease-in-out infinite' }} />
      )}
      {emergency && (
        <div style={{ position: 'fixed', insetInline: 0, top: 'calc(16px + env(safe-area-inset-top,0px))',
                      zIndex: 7600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 14,
                        background: '#7f1d1d', border: `2px solid ${RED}`, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <AlertIcon size={26} />
            <span style={{ color: '#fff', fontWeight: 900, fontSize: '1.05rem', letterSpacing: '0.04em' }}>
              {dt('radio_emergency_active')}
            </span>
          </div>
          <button onClick={() => { void radio.stopEmergency() }}
                  style={{ pointerEvents: 'auto', padding: '12px 22px', minHeight: 52, borderRadius: 12,
                           background: '#fff', color: '#7f1d1d', border: 'none', fontWeight: 900,
                           fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
            {dt('radio_emergency_end')}
          </button>
        </div>
      )}

      {/* transient toast (no-monitor / busy heads-up) */}
      {toast && !inCall && (
        <div style={{ position: 'fixed', insetInline: 0, bottom: 'calc(128px + env(safe-area-inset-bottom,0px))',
                      zIndex: 7650, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 16px' }}>
          <div style={{ maxWidth: 520, background: '#3a2a05', border: `2px solid ${AMBER}`, borderRadius: 14,
                        padding: '12px 16px', color: '#fff', fontWeight: 700, fontSize: '0.95rem',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.5)', animation: 'ccb-toast-in 0.2s ease-out' }}>
            {toast}
          </div>
        </div>
      )}

      {/* the single floating 96px button, bottom thumb-zone (right) */}
      {showButton && (
        <div style={{ position: 'fixed', zIndex: 7400,
                      right: 'calc(18px + env(safe-area-inset-right,0px))',
                      bottom: 'calc(18px + env(safe-area-inset-bottom,0px))',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em',
                         color: emergency ? RED : (cabOffline ? RED : BLUE_LT),
                         background: 'rgba(11,15,23,0.75)', padding: '3px 9px', borderRadius: 999,
                         textTransform: 'uppercase', maxWidth: 150, overflow: 'hidden', whiteSpace: 'nowrap',
                         textOverflow: 'ellipsis' }}>
            {cabOffline ? dt('cabcall_offline') : dt('cabcall')}
          </span>
          <button
            aria-label={dt('cabcall_call')}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerLeave={onCancel}
            onPointerCancel={onCancel}
            style={{
              position: 'relative', width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: '50%',
              border: `4px solid ${ringColor}`, background: fillBg, color: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              cursor: 'pointer', touchAction: 'none', userSelect: 'none',
              WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
              boxShadow: emergency ? '0 0 0 0 rgba(239,68,68,0.55)' : '0 10px 30px rgba(0,0,0,0.5)',
              animation: emergency ? 'ccb-ring-pulse 0.9s ease-in-out infinite' : 'none',
              transition: 'border-color 0.2s, background 0.2s',
            }}>
            {/* 2s arming ring: a conic sweep that fills while held toward emergency */}
            {arming > 0 && !emergency && (
              <span aria-hidden style={{ position: 'absolute', inset: -4, borderRadius: '50%',
                       background: `conic-gradient(${RED} ${Math.round(arming * 360)}deg, transparent 0deg)`,
                       WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))',
                       mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))' }} />
            )}
            {emergency ? <AlertIcon size={32} /> : <PhoneIcon size={34} color={cabOffline ? RED : BLUE_LT} />}
            <span style={{ fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.05em',
                           color: emergency ? '#fff' : (cabOffline ? RED : BLUE_LT) }}>
              {emergency ? 'SOS' : dt('cabcall_call').toUpperCase()}
            </span>
          </button>
        </div>
      )}

      {/* role picker sheet (single tap) — bottom sheet, ≥72px rows */}
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
              <span style={{ color: D.ink, fontWeight: 900, fontSize: '1.05rem' }}>{dt('cabcall_pick_role')}</span>
              <button onClick={() => setSheetOpen(false)}
                      style={{ padding: '10px 16px', minHeight: 44, borderRadius: 10, color: D.sub2,
                               background: 'transparent', border: `1px solid ${D.line2}`, fontWeight: 800, cursor: 'pointer' }}>
                ✕
              </button>
            </div>
            {cabOffline ? (
              <div style={{ color: D.sub, fontSize: '0.95rem', padding: '14px 4px' }}>{dt('cabcall_offline_hint')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={() => void callRole('DISPATCHER')} style={roleBtn(BLUE)}>
                  <PhoneIcon size={26} color={BLUE_LT} /> {dt('cabcall_role_dispatcher')}
                </button>
                <button onClick={() => void callRole('MAINTENANCE')} style={roleBtn(AMBER)}>
                  <span style={{ fontSize: '1.4rem' }} aria-hidden>🛠️</span> {dt('cabcall_role_maintenance')}
                </button>
                <button onClick={() => void callRole('SAFETY')} style={roleBtn(GREEN)}>
                  <span style={{ fontSize: '1.4rem' }} aria-hidden>🦺</span> {dt('cabcall_role_safety')}
                </button>
              </div>
            )}
            <div style={{ marginTop: 14, color: D.sub, fontSize: '0.72rem', textAlign: 'center' }}>
              {dt('cabcall_hold_emergency')}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Full-width role row (>=72px, glove-friendly).
function roleBtn(accent: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 72, padding: '0 18px',
    borderRadius: 14, textAlign: 'left', cursor: 'pointer', color: '#fff', fontWeight: 800, fontSize: '1.05rem',
    border: `2px solid ${accent}`, background: '#1c1c1c',
  }
}
