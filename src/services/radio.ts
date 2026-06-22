// PRISM Radio service -- transport-agnostic PTT client + speaking reporter.
//
// This module is the in-cab app's single entry point to the radio. The UI talks
// ONLY to RadioController; the actual audio engine sits behind the VoiceTransport
// interface so it can be swapped (mumble-web WASM now, a native Capacitor Mumble
// plugin / Mumla later) without touching the PTT UI, the state machine, the
// talk-group selector, the event reporting, or the Bluetooth PTT handling.
//
// Decoupling guarantee: every network call is best-effort and wrapped so a
// failure sets the radio state to `offline` and is swallowed -- it can NEVER
// bubble into the dispatch render tree or block the haul-cycle. This file is
// lazy-loaded (only when the Radio overlay opens), so the dispatch screen pulls
// in nothing from here at module load.
//
// See docs/prism_radio_phase1.md (S2.2 client-reported speaking, S5).

import { apiFetch } from './api'

export type RadioState =
  | 'offline'       // no server / disabled / error
  | 'connecting'    // handshaking identity / audio
  | 'idle'          // connected, not transmitting
  | 'transmitting'  // PTT held, mic open

export interface RadioChannel {
  id?: number
  name: string
  display_name: string
  channel_type?: string
  linked_zone_id?: number | null
  sort_order?: number
}

export interface RadioConfig {
  enabled: boolean
  mumble_host: string
  mumble_port: number
  ws_url: string
  opus_bitrate: number
  speak_heartbeat_ms: number
  channels: RadioChannel[]
}

export interface RadioIdentity {
  employeeId?: string | null
  unitNo?: string | null
  operatorName?: string | null
}

// ---------------------------------------------------------------------------
// VoiceTransport -- the swappable audio engine.
// Phase 1 ships a stub (no audio in CI / no proxy yet); the real mumble-web
// transport implements this same surface. Returning false from connect() means
// "audio unavailable" and the controller falls back to client-reported mode
// (the map still sees who is talking via the /ptt reports).
// ---------------------------------------------------------------------------
export interface VoiceTransport {
  readonly name: string
  connect(cfg: RadioConfig, username: string): Promise<boolean>
  selectChannel(channelName: string): Promise<void>
  startTransmit(): Promise<void>
  stopTransmit(): Promise<void>
  disconnect(): Promise<void>
  // Fires true when a remote station is heard, false when silence resumes.
  onReceiving(cb: (receiving: boolean) => void): void
}

// A no-audio transport: lets the full PTT UX, state machine, speaking reports
// and map highlight work end-to-end with no Mumble server / no WASM. The real
// MumbleWebTransport (mumble-web over the proxy) drops in behind this interface.
export class StubVoiceTransport implements VoiceTransport {
  readonly name = 'stub'
  private receivingCb: ((r: boolean) => void) | null = null

  async connect(cfg: RadioConfig, _username: string): Promise<boolean> {
    // No proxy URL -> audio unavailable; controller runs client-reported only.
    return Boolean(cfg.ws_url)
  }
  async selectChannel(): Promise<void> {}
  async startTransmit(): Promise<void> {}
  async stopTransmit(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onReceiving(cb: (r: boolean) => void): void {
    this.receivingCb = cb
  }
  // Exposed for tests / future transports to simulate inbound audio.
  _emitReceiving(r: boolean): void {
    this.receivingCb?.(r)
  }
}

type StateListener = (s: RadioState) => void

// ---------------------------------------------------------------------------
// RadioController -- the state machine + HTTP reporter the UI binds to.
// ---------------------------------------------------------------------------
export class RadioController {
  private state: RadioState = 'offline'
  private listeners = new Set<StateListener>()
  private transport: VoiceTransport
  private cfg: RadioConfig | null = null
  private identity: RadioIdentity = {}
  private channel: string | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private receiving = false

  constructor(transport?: VoiceTransport) {
    this.transport = transport || new StubVoiceTransport()
    this.transport.onReceiving((r) => {
      this.receiving = r
      // Surface receiving without overriding an active transmit.
      if (this.state === 'idle' || this.state === 'transmitting') this.emit()
    })
  }

  // -- state plumbing -----------------------------------------------------
  getState(): RadioState { return this.state }
  isReceiving(): boolean { return this.receiving }
  getChannel(): string | null { return this.channel }
  getChannels(): RadioChannel[] { return this.cfg?.channels || [] }

  onState(cb: StateListener): () => void {
    this.listeners.add(cb)
    cb(this.state)
    return () => this.listeners.delete(cb)
  }
  private set(s: RadioState): void {
    if (s === this.state) return
    this.state = s
    this.emit()
  }
  private emit(): void {
    for (const cb of this.listeners) {
      try { cb(this.state) } catch { /* listener errors never break the radio */ }
    }
  }

  // -- lifecycle ----------------------------------------------------------
  async connect(identity: RadioIdentity): Promise<void> {
    this.identity = identity || {}
    this.set('connecting')
    try {
      const cfg = await this.fetchConfig()
      if (!cfg || !cfg.enabled) { this.set('offline'); return }
      this.cfg = cfg
      const ident = await this.mintIdentity()
      if (!ident) { this.set('offline'); return }
      // Default to the first talk group (dispatch usually sorts first).
      if (!this.channel && cfg.channels.length) this.channel = cfg.channels[0].name
      // Best-effort audio connect; failure just means client-reported mode.
      try { await this.transport.connect(cfg, ident.username) } catch { /* audio optional */ }
      if (this.channel) { try { await this.transport.selectChannel(this.channel) } catch { /* ignore */ } }
      this.set('idle')
    } catch {
      this.set('offline')
    }
  }

  async selectChannel(name: string): Promise<void> {
    this.channel = name
    try { await this.transport.selectChannel(name) } catch { /* audio optional */ }
    this.emit()
  }

  // -- PTT ----------------------------------------------------------------
  async pttDown(): Promise<void> {
    if (this.state === 'offline' || this.state === 'connecting') return
    this.set('transmitting')
    try { await this.transport.startTransmit() } catch { /* audio optional */ }
    this.reportPtt('down')
    this.startHeartbeat()
  }

  async pttUp(): Promise<void> {
    this.stopHeartbeat()
    try { await this.transport.stopTransmit() } catch { /* audio optional */ }
    if (this.state === 'transmitting') this.set('idle')
    this.reportPtt('up')
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat()
    try { await this.transport.disconnect() } catch { /* ignore */ }
    this.set('offline')
  }

  // -- HTTP (all best-effort; never throw into the UI) --------------------
  private async fetchConfig(): Promise<RadioConfig | null> {
    try {
      const res = await apiFetch('/api/radio/config', { method: 'GET' })
      if (!res.ok) return null
      const body = await res.json()
      if (!body || body.success === false) return null
      return {
        enabled: body.enabled !== false,
        mumble_host: body.mumble_host || '',
        mumble_port: body.mumble_port || 64738,
        ws_url: body.ws_url || '',
        opus_bitrate: body.opus_bitrate || 24000,
        speak_heartbeat_ms: body.speak_heartbeat_ms || 3000,
        channels: Array.isArray(body.channels) ? body.channels : [],
      }
    } catch {
      return null
    }
  }

  private async mintIdentity(): Promise<{ username: string } | null> {
    try {
      const res = await apiFetch('/api/radio/identity', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: this.identity.employeeId || '',
          unit_no: this.identity.unitNo || '',
        }),
      })
      if (!res.ok) return null
      const body = await res.json()
      if (!body || !body.success || !body.username) return null
      return { username: body.username }
    } catch {
      return null
    }
  }

  private reportPtt(state: 'down' | 'up' | 'heartbeat'): void {
    // Fire-and-forget: the cab must never wait on this and a failure is silent.
    void apiFetch('/api/radio/ptt', {
      method: 'POST',
      body: JSON.stringify({
        state,
        channel: this.channel || '',
        unit_no: this.identity.unitNo || '',
        employee_id: this.identity.employeeId || '',
        operator_name: this.identity.operatorName || '',
      }),
    }).catch(() => { /* swallow */ })
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const ms = this.cfg?.speak_heartbeat_ms || 3000
    this.heartbeat = setInterval(() => this.reportPtt('heartbeat'), ms)
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null }
  }
}

// Process-wide singleton the overlay binds to (so PTT survives re-renders).
let _controller: RadioController | null = null
export function getRadioController(): RadioController {
  if (!_controller) _controller = new RadioController()
  return _controller
}

// Test seam: inject a custom transport / reset between tests.
export function __setRadioController(c: RadioController | null): void {
  _controller = c
}
