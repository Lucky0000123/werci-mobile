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
  // Phase 2: server tells the cab whether to follow zones from its GPS.
  zone_channels: boolean
  zone_poll_ms: number
  default_channel: string
  // The talk groups the AdvancedRadioPTT smart-switch / panic button switch to.
  // Advisory: a name missing from `channels` is ignored (the cab keeps its
  // current channel) so a mis-config can never strand the operator.
  special_channels: SpecialChannels
}

// Names of the special talk groups the cab switches to on a manual-status change
// or a panic. Resolved server-side (env-overridable) and sent in /config.
export interface SpecialChannels {
  emergency: string       // SITE_EMERGENCY (panic / long-press)
  dispatch_lead: string   // DELAY status -> escalate to the dispatch lead
  maintenance: string     // BREAKDOWN / MAINTENANCE -> the workshop net
}

const DEFAULT_SPECIAL: SpecialChannels = {
  emergency: 'site_emergency',
  dispatch_lead: 'dispatch_lead',
  maintenance: 'maintenance_workshop',
}

// The cab's manual machine status (mirrors DispatchPage MANUAL_STATUSES). Drives
// the smart channel auto-switch: BREAKDOWN/MAINTENANCE -> maintenance net,
// DELAY -> dispatch lead, everything else -> the unit's normal/zone channel.
export type ManualRadioStatus =
  | 'operating' | 'delay' | 'standby' | 'breakdown' | 'maintenance'

// How long the mic stays open hands-free after a panic long-press (ms).
export const EMERGENCY_HOLD_MS = 10000

export interface RadioIdentity {
  employeeId?: string | null
  unitNo?: string | null
  operatorName?: string | null
}

// ---------------------------------------------------------------------------
// pickChannelForStatus -- the PURE smart-switch decision (easy to unit test).
//
// Given the operator's manual machine status, the special-channel names, the
// list of talk groups that actually exist, and the channel the unit would
// otherwise be on (its GPS/zone channel), return the talk group the cab should
// switch to:
//   breakdown / maintenance -> maintenance net (workshop)
//   delay                    -> dispatch lead (escalation)
//   operating / standby / *  -> the normal/zone channel
// A special channel that the server did not actually publish is ignored (we keep
// `normalChannel`) so a mis-config never strands the operator on a dead group.
// ---------------------------------------------------------------------------
export function pickChannelForStatus(
  status: ManualRadioStatus | string | null | undefined,
  special: SpecialChannels,
  available: RadioChannel[],
  normalChannel: string | null,
): string | null {
  const has = (name: string | null | undefined): name is string =>
    !!name && available.some((c) => c.name === name)
  const want =
    status === 'breakdown' || status === 'maintenance' ? special.maintenance
    : status === 'delay' ? special.dispatch_lead
    : null                                  // operating / standby / unknown
  if (want && has(want)) return want
  return normalChannel
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
  // Optional explicit self-mute (used by the cab-call mute toggle: a connected
  // 1:1 call opens default-MUTED and the operator taps to talk). Optional so the
  // stub + any future transport need not implement it.
  setMuted?(muted: boolean): void
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
  setMuted(): void {}
  onReceiving(cb: (r: boolean) => void): void {
    this.receivingCb = cb
  }
  // Exposed for tests / future transports to simulate inbound audio.
  _emitReceiving(r: boolean): void {
    this.receivingCb?.(r)
  }
}

// ---------------------------------------------------------------------------
// MumbleWebTransport -- the REAL audio engine for both the radio PTT and the
// cab-call 1:1 line.
//
// Browsers / the Android WebView cannot speak the native Mumble TCP protocol, so
// voice rides the mumble-web-proxy (WebSocket <-> Murmur). The vendored
// mumble-web client is injected at `window.PrismMumble` when the proxy + bundle
// are deployed; this transport adapts that session to the VoiceTransport surface
// the RadioController + CabCallController already drive. It is the SAME engine
// for the radio talk groups and the leased cab-call slot (no second audio path).
//
// Clean degrade: with no `ws_url` (MUMBLE_WS_URL unset) OR no vendored client,
// connect() returns false and the controller runs client-reported only -- byte
// for byte the same behaviour as the StubVoiceTransport, so an undeployed proxy
// changes nothing. This mirrors the web RadioVoice module in radio_channels.html.
// ---------------------------------------------------------------------------
interface PrismMumbleSession {
  connect?: () => Promise<void> | void
  disconnect?: () => void
  setMuted?: (muted: boolean) => void
  selectChannel?: (channel: string) => void
  onReceiving?: (cb: (receiving: boolean) => void) => void
  connected?: boolean
}
type PrismMumbleFactory = (opts: {
  wsUrl: string
  channel?: string
  username?: string
  token?: string | null
  password?: string | null
  opusBitrate?: number
}) => PrismMumbleSession
declare global {
  // eslint-disable-next-line no-var
  interface Window { PrismMumble?: PrismMumbleFactory }
}

export class MumbleWebTransport implements VoiceTransport {
  readonly name = 'mumble-web'
  private session: PrismMumbleSession | null = null
  private cfg: RadioConfig | null = null
  private username = ''
  private channel: string | null = null
  private muted = true
  private receivingCb: ((r: boolean) => void) | null = null

  private factory(): PrismMumbleFactory | null {
    const f = typeof window !== 'undefined' ? window.PrismMumble : undefined
    return typeof f === 'function' ? f : null
  }

  async connect(cfg: RadioConfig, username: string): Promise<boolean> {
    this.cfg = cfg
    this.username = username
    // No proxy URL OR no vendored client -> audio unavailable; the controller
    // runs client-reported only (identical clean degrade to the stub).
    if (!cfg.ws_url) return false
    const make = this.factory()
    if (!make) return false
    try {
      this.session = make({
        wsUrl: cfg.ws_url, username,
        channel: this.channel || cfg.default_channel,
        opusBitrate: cfg.opus_bitrate,
      })
      this.session.onReceiving?.((r) => this.receivingCb?.(r))
      await Promise.resolve(this.session.connect?.())
      this.session.setMuted?.(this.muted)
      return true
    } catch {
      this.session = null
      return false
    }
  }

  async selectChannel(channelName: string): Promise<void> {
    this.channel = channelName
    if (!this.session) return
    try {
      if (this.session.selectChannel) { this.session.selectChannel(channelName); return }
      // No live channel-switch in the bundle -> reconnect onto the new channel.
      this.session.disconnect?.()
      this.session = null
      if (this.cfg) await this.connect(this.cfg, this.username)
    } catch { /* audio optional: the call still connects via signaling */ }
  }

  async startTransmit(): Promise<void> { this.muted = false; try { this.session?.setMuted?.(false) } catch { /* ignore */ } }
  async stopTransmit(): Promise<void> { this.muted = true; try { this.session?.setMuted?.(true) } catch { /* ignore */ } }
  setMuted(muted: boolean): void { this.muted = muted; try { this.session?.setMuted?.(muted) } catch { /* ignore */ } }

  async disconnect(): Promise<void> {
    try { this.session?.disconnect?.() } catch { /* ignore */ }
    this.session = null
  }
  onReceiving(cb: (r: boolean) => void): void { this.receivingCb = cb }
}

type StateListener = (s: RadioState) => void
type EmergencyListener = (emergency: boolean) => void

// What the cab knows about where it should be (for the smart-switch). The unit's
// "normal" channel is its GPS/zone channel when zone-following is on, else the
// configured default. The status overrides it (delay/breakdown) until cleared.
type GeoFix = { lat?: number | null; lng?: number | null }

// ---------------------------------------------------------------------------
// RadioController -- the state machine + HTTP reporter the UI binds to.
// ---------------------------------------------------------------------------
export class RadioController {
  private state: RadioState = 'offline'
  private listeners = new Set<StateListener>()
  private emergencyListeners = new Set<EmergencyListener>()
  private transport: VoiceTransport
  private cfg: RadioConfig | null = null
  private identity: RadioIdentity = {}
  private channel: string | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private receiving = false
  // Smart-switch state. `normalChannel` is the unit's GPS/zone channel (or the
  // configured default); `status` is the last applied manual machine status; the
  // active `channel` is derived from these by pickChannelForStatus(). Emergency
  // forces the channel to special.emergency and rides over everything until
  // stopEmergency() restores the status-derived channel.
  private special: SpecialChannels = DEFAULT_SPECIAL
  private normalChannel: string | null = null
  private status: ManualRadioStatus | null = null
  private emergency = false
  private emergencyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(transport?: VoiceTransport) {
    // Default to the real mumble-web engine. It degrades byte-for-byte like the
    // stub when no proxy URL is configured or the vendored client is absent, so
    // making it the default cannot regress an undeployed environment.
    this.transport = transport || new MumbleWebTransport()
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
  getSpecial(): SpecialChannels { return this.special }
  isEmergency(): boolean { return this.emergency }
  isZoneFollowing(): boolean { return !!this.cfg?.zone_channels }

  onState(cb: StateListener): () => void {
    this.listeners.add(cb)
    cb(this.state)
    return () => this.listeners.delete(cb)
  }
  // Emergency lets the UI pulse the screen RED independently of the talk state.
  onEmergency(cb: EmergencyListener): () => void {
    this.emergencyListeners.add(cb)
    cb(this.emergency)
    return () => this.emergencyListeners.delete(cb)
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
  private emitEmergency(): void {
    for (const cb of this.emergencyListeners) {
      try { cb(this.emergency) } catch { /* listener errors never break the radio */ }
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
      // Special-channel names + the unit's starting "normal" channel. With zone
      // following on we begin on the default and let the first /zone resolve move
      // us; otherwise the default channel IS the normal channel.
      this.special = cfg.special_channels || DEFAULT_SPECIAL
      if (!this.normalChannel) {
        // The configured default only counts if it actually exists as a talk
        // group; otherwise fall back to the first channel so a mis-configured
        // default can never strand the cab on a non-existent group.
        const def = cfg.default_channel
        this.normalChannel = (def && cfg.channels.some((c) => c.name === def))
          ? def
          : (cfg.channels.length ? cfg.channels[0].name : null)
      }
      // Default to the status-derived channel (normal unless a status was already
      // applied before connect). Falls back to the first talk group.
      if (!this.channel) {
        this.channel = pickChannelForStatus(this.status, this.special, cfg.channels, this.normalChannel)
          || (cfg.channels.length ? cfg.channels[0].name : null)
      }
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

  // Explicit self-mute for the cab-call mute toggle. A connected 1:1 call opens
  // MUTED (the operator taps to talk, per the PTT = tap-toggle decision); this
  // forwards the request to the audio engine. Best-effort: no-op if the transport
  // does not implement it (e.g. an audio-less degrade).
  setMuted(muted: boolean): void {
    try { this.transport.setMuted?.(muted) } catch { /* audio optional */ }
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
    this.clearEmergencyTimer()
    try { await this.transport.disconnect() } catch { /* ignore */ }
    this.set('offline')
  }

  // -- smart channel auto-switch -----------------------------------------
  // The cab applies a manual machine status and the radio follows it: BREAKDOWN/
  // MAINTENANCE -> the workshop net, DELAY -> the dispatch lead, anything else ->
  // the unit's normal/zone channel. A no-op while emergency mode is active (panic
  // overrides everything). Best-effort: never throws into the caller.
  async applyStatus(status: ManualRadioStatus | string | null | undefined): Promise<void> {
    this.status = (status as ManualRadioStatus) || null
    if (this.emergency) return            // panic owns the channel
    if (this.state === 'offline' || this.state === 'connecting') return
    const want = pickChannelForStatus(this.status, this.special, this.getChannels(), this.normalChannel)
    if (want && want !== this.channel) await this.selectChannel(want)
  }

  // Resolve which zone talk group this unit belongs on from its live GPS and, if
  // it changed, follow it -- UNLESS a manual status (delay/breakdown) or an
  // emergency currently overrides the channel, in which case we just remember the
  // new normal channel so we snap to it when the status clears. Mirrors the
  // server's /api/radio/zone contract; best-effort, never throws.
  async resolveZoneChannel(fix?: GeoFix): Promise<void> {
    if (!this.cfg?.zone_channels) return
    if (this.state === 'offline' || this.state === 'connecting') return
    try {
      const res = await apiFetch('/api/radio/zone', {
        method: 'POST',
        body: JSON.stringify({
          unit_no: this.identity.unitNo || '',
          employee_id: this.identity.employeeId || '',
          lat: fix?.lat ?? null,
          lng: fix?.lng ?? null,
        }),
      })
      if (!res.ok) return
      const body = await res.json()
      const ch = body?.channel
      if (!ch || typeof ch !== 'string') return
      this.normalChannel = ch
      // Only actually move if nothing is overriding the normal channel.
      if (this.emergency) return
      const want = pickChannelForStatus(this.status, this.special, this.getChannels(), this.normalChannel)
      if (want && want !== this.channel) await this.selectChannel(want)
    } catch { /* zone resolve is best-effort */ }
  }

  // -- EMERGENCY (panic) --------------------------------------------------
  // Force the SITE_EMERGENCY channel, open the mic hands-free for EMERGENCY_HOLD_MS
  // (the operator's hands stay on the wheel), and flag every PTT report so the
  // dispatcher map pulses this truck RED. Auto-releases the mic when the window
  // ends but STAYS in emergency mode until stopEmergency() (so the red screen
  // pulse and the channel lock persist). Best-effort throughout.
  async startEmergency(): Promise<void> {
    if (this.state === 'offline' || this.state === 'connecting') return
    this.emergency = true
    this.emitEmergency()
    // Switch to the emergency talk group if it exists; otherwise stay put but keep
    // the emergency flag (the dispatcher still sees the panic via /speaking).
    const em = this.special.emergency
    if (em && this.getChannels().some((c) => c.name === em) && em !== this.channel) {
      await this.selectChannel(em)
    } else {
      this.emit()                          // reflect the forced state in the UI
    }
    // Open the mic hands-free, then auto-release after the window.
    await this.pttDown()
    this.clearEmergencyTimer()
    this.emergencyTimer = setTimeout(() => {
      this.emergencyTimer = null
      // Release the mic but remain in emergency mode (screen keeps pulsing).
      void this.pttUp()
    }, EMERGENCY_HOLD_MS)
  }

  // End panic mode: release the mic, drop the RED pulse, and snap back to the
  // channel the unit should be on for its current status/zone.
  async stopEmergency(): Promise<void> {
    this.clearEmergencyTimer()
    const wasEmergency = this.emergency
    this.emergency = false
    if (this.state === 'transmitting') await this.pttUp()
    if (wasEmergency) this.emitEmergency()
    const want = pickChannelForStatus(this.status, this.special, this.getChannels(), this.normalChannel)
    if (want && want !== this.channel) await this.selectChannel(want)
  }

  private clearEmergencyTimer(): void {
    if (this.emergencyTimer) { clearTimeout(this.emergencyTimer); this.emergencyTimer = null }
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
        zone_channels: body.zone_channels === true,
        zone_poll_ms: body.zone_poll_ms || 0,
        default_channel: body.default_channel || 'general',
        special_channels: {
          emergency: body.special_channels?.emergency || DEFAULT_SPECIAL.emergency,
          dispatch_lead: body.special_channels?.dispatch_lead || DEFAULT_SPECIAL.dispatch_lead,
          maintenance: body.special_channels?.maintenance || DEFAULT_SPECIAL.maintenance,
        },
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
    // `emergency` rides every report while panic mode is active so the dispatcher
    // map keeps the truck pulsing RED for the whole transmission.
    void apiFetch('/api/radio/ptt', {
      method: 'POST',
      body: JSON.stringify({
        state,
        channel: this.channel || '',
        unit_no: this.identity.unitNo || '',
        employee_id: this.identity.employeeId || '',
        operator_name: this.identity.operatorName || '',
        emergency: this.emergency,
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
