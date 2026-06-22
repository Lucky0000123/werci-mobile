// PRISM Radio overlay -- the in-cab PTT screen.
//
// A full-screen, glove-friendly, sunlight-readable overlay rendered at the
// DispatchPage level (so it works for BOTH the truck and excavator operator
// windows). NOT a router route -- the cab is locked to /dispatch, so this mirrors
// the existing Connecting-splash / ManualStatusControl modal pattern.
//
// It talks ONLY to the transport-agnostic RadioController (services/radio.ts):
// a big HOLD TO TALK button, a talk-group selector (placeholder groups in Phase
// 1, config-driven), clear connecting/transmitting/receiving/idle/offline states,
// and an optional hardware / Bluetooth PTT key. A voice failure shows "Radio
// offline" cleanly and never affects dispatch.
//
// See docs/prism_radio_phase1.md (S5).

import { useEffect, useRef, useState, useCallback } from 'react'
import { useDispatchT } from '../services/dispatchI18n'
import {
  getRadioController,
  type RadioState,
  type RadioChannel,
  type RadioIdentity,
} from '../services/radio'

// Local copy of the operator-window dark palette (keeps this component
// self-contained and lazy-loadable without importing DispatchPage internals).
const D = {
  bg: '#0b0f17', panel: '#141414', line2: '#3a3a3a',
  ink: '#ffffff', sub: '#9ca3af', sub2: '#d6d6d6', accent: '#38BDF8',
}
const GOLD = '#f5a524'
const GREEN = '#22c55e'
const RED = '#ef4444'

export interface RadioOverlayProps {
  identity: RadioIdentity
  onClose: () => void
}

// State -> {color, key} for the big status pill. Kept declarative so the PTT
// button + banner read the same source.
function stateStyle(state: RadioState, receiving: boolean): { color: string; key: string } {
  if (state === 'offline') return { color: RED, key: 'radio_offline' }
  if (state === 'connecting') return { color: D.sub, key: 'radio_connecting' }
  if (state === 'transmitting') return { color: GREEN, key: 'radio_transmitting' }
  if (receiving) return { color: D.accent, key: 'radio_receiving' }
  return { color: GOLD, key: 'radio_idle' }
}

export default function RadioOverlay({ identity, onClose }: RadioOverlayProps) {
  const dt = useDispatchT()
  const ctrl = getRadioController()
  const [state, setState] = useState<RadioState>(ctrl.getState())
  const [channels, setChannels] = useState<RadioChannel[]>(ctrl.getChannels())
  const [channel, setChannel] = useState<string | null>(ctrl.getChannel())
  const [receiving, setReceiving] = useState(ctrl.isReceiving())
  const heldRef = useRef(false)

  // Subscribe to controller state; connect on open, disconnect on close.
  useEffect(() => {
    const off = ctrl.onState((s) => {
      setState(s)
      setChannels(ctrl.getChannels())
      setChannel(ctrl.getChannel())
      setReceiving(ctrl.isReceiving())
    })
    void ctrl.connect(identity)
    return () => {
      off()
      // Release PTT + tear down audio when the overlay closes so a held button
      // can never get "stuck" transmitting after the screen is gone.
      void ctrl.pttUp()
      void ctrl.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const down = useCallback(() => {
    if (heldRef.current) return
    heldRef.current = true
    void ctrl.pttDown()
  }, [ctrl])

  const up = useCallback(() => {
    if (!heldRef.current) return
    heldRef.current = false
    void ctrl.pttUp()
  }, [ctrl])

  // Optional hardware / Bluetooth PTT: many rugged headsets emit a media /
  // volume key. We drive the SAME pttDown/Up so a wired or BT button is just
  // another input into the identical path. (No-op on devices without one.)
  useEffect(() => {
    const isPttKey = (e: KeyboardEvent) =>
      e.code === 'MediaPlayPause' || e.code === 'Space' || e.key === 'AudioVolumeMute'
    const kd = (e: KeyboardEvent) => { if (isPttKey(e)) { e.preventDefault(); down() } }
    const ku = (e: KeyboardEvent) => { if (isPttKey(e)) { e.preventDefault(); up() } }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) }
  }, [down, up])

  const offline = state === 'offline'
  const transmitting = state === 'transmitting'
  const st = stateStyle(state, receiving)

  return (
    <div role="dialog" aria-label={dt('radio_title')}
         style={{ position: 'fixed', inset: 0, zIndex: 7000, background: D.bg,
                  display: 'flex', flexDirection: 'column',
                  padding: 'calc(12px + env(safe-area-inset-top, 0px)) 12px calc(12px + env(safe-area-inset-bottom, 0px))',
                  boxSizing: 'border-box', gap: 14 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: '1.4rem' }} aria-hidden>📻</span>
        <span style={{ color: D.ink, fontWeight: 800, fontSize: '1.05rem' }}>{dt('radio_title')}</span>
        <button onClick={onClose} aria-label={dt('radio_close')}
                style={{ marginLeft: 'auto', padding: '10px 16px', fontSize: '0.85rem', fontWeight: 800,
                         color: D.sub2, background: 'transparent', border: `1px solid ${D.line2}`,
                         borderRadius: 10, cursor: 'pointer', minHeight: 44 }}>
          ✕ {dt('radio_close')}
        </button>
      </div>

      {/* status banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
                    padding: '10px 14px', borderRadius: 12, background: D.panel,
                    border: `1px solid ${st.color}66` }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: st.color,
                       boxShadow: transmitting ? `0 0 10px ${st.color}` : 'none', flexShrink: 0 }} />
        <span style={{ color: st.color, fontWeight: 800, fontSize: '0.95rem' }}>{dt(st.key)}</span>
        {offline && (
          <span style={{ color: D.sub, fontSize: '0.78rem', marginLeft: 'auto', textAlign: 'right' }}>
            {dt('radio_offline_hint')}
          </span>
        )}
      </div>

      {/* talk-group selector */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ color: D.sub, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.04em', marginBottom: 6 }}>
          {dt('radio_channel')}
        </div>
        {channels.length === 0 ? (
          <div style={{ color: D.sub, fontSize: '0.85rem', padding: '10px 0' }}>{dt('radio_no_channel')}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {channels.map((ch) => {
              const active = ch.name === channel
              return (
                <button key={ch.name} disabled={offline}
                        onClick={() => { setChannel(ch.name); void ctrl.selectChannel(ch.name) }}
                        style={{ padding: '12px 18px', fontSize: '0.92rem', fontWeight: 800, minHeight: 48,
                                 borderRadius: 12, cursor: offline ? 'default' : 'pointer',
                                 color: active ? '#0b0f17' : D.sub2,
                                 background: active ? GOLD : 'transparent',
                                 border: `1px solid ${active ? GOLD : D.line2}`,
                                 opacity: offline ? 0.5 : 1 }}>
                  {ch.display_name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* HOLD TO TALK — full width, large, high contrast */}
      <button
        disabled={offline || state === 'connecting'}
        onPointerDown={(e) => { e.preventDefault(); down() }}
        onPointerUp={(e) => { e.preventDefault(); up() }}
        onPointerLeave={() => up()}
        onPointerCancel={() => up()}
        style={{
          flex: 1, minHeight: 160, marginTop: 'auto',
          borderRadius: 20, border: `3px solid ${transmitting ? GREEN : (offline ? RED : GOLD)}`,
          background: transmitting ? 'rgba(34,197,94,0.18)' : (offline ? 'rgba(239,68,68,0.10)' : 'rgba(245,165,36,0.10)'),
          color: transmitting ? GREEN : (offline ? RED : D.ink),
          fontSize: '1.6rem', fontWeight: 900, letterSpacing: '0.04em',
          touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
          cursor: offline ? 'default' : 'pointer', textTransform: 'uppercase',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
        <span style={{ fontSize: '2.4rem' }} aria-hidden>{transmitting ? '🔴' : '🎙️'}</span>
        {offline ? dt('radio_offline') : (transmitting ? dt('radio_ptt_release') : dt('radio_ptt_hold'))}
      </button>
    </div>
  )
}
