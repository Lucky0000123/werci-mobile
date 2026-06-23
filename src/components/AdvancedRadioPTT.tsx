// AdvancedRadioPTT -- the in-cab tablet radio control.
//
// A single glove-friendly 96px circular button anchored in the bottom thumb-zone
// of the operator window. It is the cab's ENTIRE radio surface:
//
//   * single tap        -> open the channel sheet (talk-group picker)
//   * press and hold     -> push-to-talk (heavy green glow while transmitting)
//   * hold >= 3.0s       -> EMERGENCY: force the SITE_EMERGENCY channel, open the
//                           mic hands-free for 10s, flag the transmission so the
//                           dispatcher map pulses this truck RED, and pulse the
//                           cab screen RED until the operator ends it.
//
// Smart channel auto-switch: the button polls the unit's manual machine status
// (read-only) and follows it on the radio -- BREAKDOWN/MAINTENANCE -> the
// workshop net (button turns red "MAINT"), DELAY -> the dispatch lead (amber
// "DISP"), otherwise the unit's GPS/zone dispatch channel (zinc). It also polls
// the zone resolver so the talk group follows the truck around site.
//
// It talks ONLY to the transport-agnostic RadioController (services/radio.ts) and
// owns its connect/disconnect lifecycle. Every call is best-effort: a voice/zone
// failure degrades to "Radio offline" and can NEVER affect the haul-cycle. This
// file is lazy-loaded so the dispatch screen pulls in no radio/audio code until a
// unit is connected. See docs/prism_radio_phase1.md + prism_radio_phase2.md.

import { useEffect, useRef, useState, useCallback } from 'react'
import { useDispatchT } from '../services/dispatchI18n'
import { apiFetch } from '../services/api'
import {
  getRadioController,
  type RadioState,
  type RadioChannel,
  type RadioIdentity,
  type SpecialChannels,
} from '../services/radio'

// Self-contained dark palette (keeps the component lazy-loadable without pulling
// in DispatchPage internals). High-contrast for sunlight + gloves.
const D = {
  bg: '#0b0f17', panel: '#141414', panel2: '#1c1c1c', line2: '#3a3a3a',
  ink: '#ffffff', sub: '#9ca3af', sub2: '#d6d6d6',
  zinc: '#27272a', zincLine: '#52525b',
}
const GREEN = '#22c55e'
const AMBER = '#f59e0b'
const RED = '#ef4444'
const GOLD = '#f5a524'

// Press timing. A short threshold separates a TAP (open the sheet) from a HOLD
// (push-to-talk); a sustained hold escalates to EMERGENCY at 3.0s.
const TAP_THRESHOLD_MS = 180
const EMERGENCY_LONG_PRESS_MS = 3000
// How often we re-read the unit's manual status (read-only) + re-resolve zones.
const STATUS_POLL_MS = 6000
const ZONE_POLL_MS = 8000
const BUTTON_SIZE = 96

export interface AdvancedRadioPTTProps {
  identity: RadioIdentity
}

// Resting look of the button derived from the talk group it is currently on, so
// the operator can see at a glance which net they are on (spec point 3).
function restingLook(channel: string | null, special: SpecialChannels): { color: string; tag: string } {
  if (channel && channel === special.maintenance) return { color: RED, tag: 'MAINT' }
  if (channel && channel === special.dispatch_lead) return { color: AMBER, tag: 'DISP' }
  return { color: D.zinc, tag: 'DISPATCH' }
}

// One-off keyframes for the emergency pulse + the 3s arming ring.
const KEYFRAMES = `
@keyframes advptt-screen-pulse { 0%,100% { opacity: 0.18 } 50% { opacity: 0.42 } }
@keyframes advptt-ring-pulse   { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.55) } 50% { box-shadow: 0 0 0 18px rgba(239,68,68,0) } }
@keyframes advptt-tx-glow      { 0%,100% { box-shadow: 0 0 24px 6px rgba(34,197,94,0.65) } 50% { box-shadow: 0 0 40px 12px rgba(34,197,94,0.9) } }
`

// Crisp inline mic icon (high contrast, scales with the button).
function MicIcon({ size = 34, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" fill={color} />
      <path d="M5 11a7 7 0 0 0 14 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 18v3M8 21h8" stroke={color} strokeWidth="2" strokeLinecap="round" />
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

export default function AdvancedRadioPTT({ identity }: AdvancedRadioPTTProps) {
  const dt = useDispatchT()
  const ctrl = getRadioController()
  const [state, setState] = useState<RadioState>(ctrl.getState())
  const [channels, setChannels] = useState<RadioChannel[]>(ctrl.getChannels())
  const [channel, setChannel] = useState<string | null>(ctrl.getChannel())
  const [special, setSpecial] = useState<SpecialChannels>(ctrl.getSpecial())
  const [emergency, setEmergency] = useState(ctrl.isEmergency())
  const [receiving, setReceiving] = useState(ctrl.isReceiving())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [arming, setArming] = useState(0)            // 0..1 progress toward emergency

  // Press bookkeeping (refs so the pointer handlers never go stale).
  const pressStartRef = useRef(0)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emergTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armRafRef = useRef<number | null>(null)
  const engagedPttRef = useRef(false)                // PTT actually opened this press
  const firedEmergencyRef = useRef(false)            // emergency triggered this press

  // ── controller lifecycle: connect on mount, release on unmount ──
  useEffect(() => {
    const off = ctrl.onState((s) => {
      setState(s)
      setChannels(ctrl.getChannels())
      setChannel(ctrl.getChannel())
      setSpecial(ctrl.getSpecial())
      setReceiving(ctrl.isReceiving())
    })
    const offEmg = ctrl.onEmergency((e) => setEmergency(e))
    void ctrl.connect(identity)
    return () => {
      off(); offEmg()
      // Release PTT + tear down audio so a held button can never stay "stuck"
      // transmitting after the operator window unmounts (end shift / sign-out).
      void ctrl.pttUp()
      void ctrl.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── smart-switch: poll the unit's manual status (READ-ONLY) + follow it ──
  // A best-effort GET against the dispatch board the OUI already populated; the
  // radio only OBSERVES status, it never writes dispatch, so this stays fully
  // decoupled (a radio failure can never touch the haul-cycle).
  useEffect(() => {
    let alive = true
    const unit = identity.unitNo || ''
    if (!unit) return
    async function pollStatus() {
      try {
        const res = await apiFetch(`/api/dispatch/equipment-status?unit_no=${encodeURIComponent(unit)}`, { method: 'GET' })
        if (!res.ok) return
        const body = await res.json()
        const st = body?.status?.status || 'operating'
        if (alive) void ctrl.applyStatus(st)
      } catch { /* status follow is best-effort */ }
    }
    void pollStatus()
    const id = setInterval(pollStatus, STATUS_POLL_MS)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.unitNo])

  // ── zone follow: re-resolve the talk group from the unit's live GPS ──
  // resolveZoneChannel() no-ops when zone-following is off, so this is safe to
  // run unconditionally; the server resolves position from its telematics feed.
  useEffect(() => {
    const id = setInterval(() => { void ctrl.resolveZoneChannel() }, ZONE_POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── press handling: tap vs hold vs 3s long-press ──
  const clearTimers = useCallback(() => {
    if (tapTimerRef.current) { clearTimeout(tapTimerRef.current); tapTimerRef.current = null }
    if (emergTimerRef.current) { clearTimeout(emergTimerRef.current); emergTimerRef.current = null }
    if (armRafRef.current) { cancelAnimationFrame(armRafRef.current); armRafRef.current = null }
    setArming(0)
  }, [])

  const triggerEmergency = useCallback(() => {
    firedEmergencyRef.current = true
    try { navigator.vibrate?.([120, 60, 120, 60, 240]) } catch { /* no haptics */ }
    void ctrl.startEmergency()
  }, [ctrl])

  const onDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    if (state === 'offline' || state === 'connecting') return
    try { (e.target as Element).setPointerCapture?.(e.pointerId) } catch { /* ignore */ }
    pressStartRef.current = Date.now()
    engagedPttRef.current = false
    firedEmergencyRef.current = false
    // Engage PTT once the press passes the tap threshold (so a quick tap opens
    // the sheet instead of keying the mic).
    tapTimerRef.current = setTimeout(() => {
      engagedPttRef.current = true
      void ctrl.pttDown()
    }, TAP_THRESHOLD_MS)
    // Escalate to EMERGENCY at 3.0s; animate an arming ring up to that point.
    emergTimerRef.current = setTimeout(() => triggerEmergency(), EMERGENCY_LONG_PRESS_MS)
    const start = pressStartRef.current
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / EMERGENCY_LONG_PRESS_MS)
      setArming(p)
      if (p < 1 && !firedEmergencyRef.current) armRafRef.current = requestAnimationFrame(tick)
    }
    armRafRef.current = requestAnimationFrame(tick)
  }, [ctrl, state, triggerEmergency])

  const onUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const held = Date.now() - pressStartRef.current
    const wasEmergency = firedEmergencyRef.current
    const wasPtt = engagedPttRef.current
    clearTimers()
    if (wasEmergency) {
      // Hands-free: leave the mic open for its window; the red pulse persists
      // until the operator explicitly ends the emergency.
    } else if (wasPtt) {
      void ctrl.pttUp()
    } else if (held < TAP_THRESHOLD_MS && !emergency) {
      // A clean tap -> open the channel sheet.
      setSheetOpen(true)
    }
    engagedPttRef.current = false
    firedEmergencyRef.current = false
  }, [ctrl, clearTimers, emergency])

  const onCancel = useCallback(() => {
    clearTimers()
    if (engagedPttRef.current && !firedEmergencyRef.current) void ctrl.pttUp()
    engagedPttRef.current = false
  }, [ctrl, clearTimers])

  // Optional hardware / Bluetooth PTT key: a rugged headset's media/volume key
  // drives the SAME pttDown/Up so a wired or BT button is just another input.
  useEffect(() => {
    const isPttKey = (e: KeyboardEvent) =>
      e.code === 'MediaPlayPause' || e.key === 'AudioVolumeMute'
    const kd = (e: KeyboardEvent) => {
      if (!isPttKey(e) || engagedPttRef.current) return
      e.preventDefault(); engagedPttRef.current = true; void ctrl.pttDown()
    }
    const ku = (e: KeyboardEvent) => {
      if (!isPttKey(e) || !engagedPttRef.current) return
      e.preventDefault(); engagedPttRef.current = false; void ctrl.pttUp()
    }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [ctrl])

  const offline = state === 'offline'
  const transmitting = state === 'transmitting'
  const look = restingLook(channel, special)
  const channelLabel = channels.find((c) => c.name === channel)?.display_name || dt('radio_idle')

  // Ring + fill colours for the button.
  const ringColor = emergency ? RED : (offline ? RED : (transmitting ? GREEN : look.color))
  const fillBg = emergency ? 'rgba(239,68,68,0.22)'
    : transmitting ? 'rgba(34,197,94,0.20)'
    : offline ? 'rgba(239,68,68,0.10)'
    : 'rgba(39,39,42,0.92)'

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* full-screen RED pulse while an emergency is active */}
      {emergency && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 7500, pointerEvents: 'none',
                      background: RED, animation: 'advptt-screen-pulse 0.9s ease-in-out infinite' }} />
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
          <button onClick={() => { void ctrl.stopEmergency() }}
                  style={{ pointerEvents: 'auto', padding: '12px 22px', minHeight: 52, borderRadius: 12,
                           background: '#fff', color: '#7f1d1d', border: 'none', fontWeight: 900,
                           fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
            {dt('radio_emergency_end')}
          </button>
        </div>
      )}

      {/* the floating 96px PTT button, bottom thumb-zone */}
      <div style={{ position: 'fixed', zIndex: 7400,
                    right: 'calc(18px + env(safe-area-inset-right,0px))',
                    bottom: 'calc(18px + env(safe-area-inset-bottom,0px))',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {/* state caption above the button */}
        <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em',
                       color: offline ? RED : (transmitting ? GREEN : (receiving ? '#38BDF8' : D.sub2)),
                       background: 'rgba(11,15,23,0.75)', padding: '3px 9px', borderRadius: 999,
                       textTransform: 'uppercase', maxWidth: 150, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {offline ? dt('radio_offline')
            : transmitting ? dt('radio_transmitting')
            : receiving ? dt('radio_receiving')
            : channelLabel}
        </span>

        <button
          aria-label={dt('radio_title')}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={onCancel}
          onPointerCancel={onCancel}
          style={{
            position: 'relative', width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: '50%',
            border: `4px solid ${ringColor}`, background: fillBg, color: '#fff',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
            cursor: offline ? 'default' : 'pointer', touchAction: 'none', userSelect: 'none',
            WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
            boxShadow: emergency ? '0 0 0 0 rgba(239,68,68,0.55)' : '0 10px 30px rgba(0,0,0,0.5)',
            animation: emergency ? 'advptt-ring-pulse 0.9s ease-in-out infinite'
              : transmitting ? 'advptt-tx-glow 0.8s ease-in-out infinite' : 'none',
            opacity: offline ? 0.6 : 1, transition: 'border-color 0.2s, background 0.2s',
          }}>
          {/* 3s arming ring: a conic sweep that fills while held toward emergency */}
          {arming > 0 && !emergency && (
            <span aria-hidden style={{ position: 'absolute', inset: -4, borderRadius: '50%',
                     background: `conic-gradient(${RED} ${Math.round(arming * 360)}deg, transparent 0deg)`,
                     WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))',
                     mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))' }} />
          )}
          {emergency ? <AlertIcon size={32} /> : <MicIcon size={34} color={transmitting ? GREEN : '#fff'} />}
          <span style={{ fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.05em',
                         color: transmitting ? GREEN : (look.color === D.zinc ? D.sub2 : look.color) }}>
            {emergency ? 'SOS' : (transmitting ? dt('radio_ptt_release').split(' ')[0] : look.tag)}
          </span>
        </button>
      </div>

      {/* channel sheet (single tap) — bottom sheet, ≥64px rows */}
      {sheetOpen && (
        <div onClick={() => setSheetOpen(false)}
             style={{ position: 'fixed', inset: 0, zIndex: 7700, background: 'rgba(2,6,12,0.78)',
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: '100%', maxWidth: 560, background: D.panel, borderTopLeftRadius: 22,
                        borderTopRightRadius: 22, border: `1px solid ${D.line2}`, borderBottom: 'none',
                        padding: '18px 16px calc(18px + env(safe-area-inset-bottom,0px))',
                        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)', maxHeight: '70dvh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ color: D.ink, fontWeight: 900, fontSize: '1.05rem' }}>{dt('radio_channel')}</span>
              <button onClick={() => setSheetOpen(false)}
                      style={{ padding: '10px 16px', minHeight: 44, borderRadius: 10, color: D.sub2,
                               background: 'transparent', border: `1px solid ${D.line2}`, fontWeight: 800, cursor: 'pointer' }}>
                ✕ {dt('radio_close')}
              </button>
            </div>

            {offline ? (
              <div style={{ color: D.sub, fontSize: '0.9rem', padding: '14px 4px' }}>{dt('radio_offline_hint')}</div>
            ) : channels.length === 0 ? (
              <div style={{ color: D.sub, fontSize: '0.9rem', padding: '14px 4px' }}>{dt('radio_no_channel')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...channels]
                  // Emergency channel always at the very top (red).
                  .sort((a, b) => (a.name === special.emergency ? -1 : b.name === special.emergency ? 1 : 0))
                  .map((ch) => {
                    const active = ch.name === channel
                    const isEmg = ch.name === special.emergency
                    const isMaint = ch.name === special.maintenance
                    const isLead = ch.name === special.dispatch_lead
                    const accent = isEmg ? RED : isMaint ? RED : isLead ? AMBER : GOLD
                    return (
                      <button key={ch.name}
                              onClick={() => { void ctrl.selectChannel(ch.name); setChannel(ch.name); setSheetOpen(false) }}
                              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 64,
                                       padding: '0 16px', borderRadius: 14, textAlign: 'left', cursor: 'pointer',
                                       border: `2px solid ${active ? accent : (isEmg ? `${RED}99` : D.line2)}`,
                                       background: active ? `${accent}22` : (isEmg ? 'rgba(239,68,68,0.10)' : D.panel2) }}>
                        <span style={{ width: 14, height: 14, borderRadius: '50%', background: accent, flexShrink: 0,
                                       boxShadow: active ? `0 0 8px ${accent}` : 'none' }} />
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ color: isEmg ? RED : D.ink, fontWeight: isEmg ? 900 : 800, fontSize: '1rem',
                                         whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ch.display_name}
                          </span>
                          {isEmg && <span style={{ color: D.sub, fontSize: '0.7rem', fontWeight: 700 }}>{dt('radio_emergency_hint')}</span>}
                        </span>
                        {active && <span style={{ marginLeft: 'auto', color: accent, fontWeight: 900 }}>✓</span>}
                      </button>
                    )
                  })}
              </div>
            )}

            <div style={{ marginTop: 14, color: D.sub, fontSize: '0.72rem', textAlign: 'center' }}>
              {dt('radio_tap_hint')}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
