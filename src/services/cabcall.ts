// PRISM Cab Call service -- the in-cab "intercom phone" client.
//
// Mental model (see docs/prism_cab_call.md): the physical radio is the mine's PA
// system; PRISM Cab Call is the intercom phone bolted into every cab. This is NOT
// a radio replacement, NOT group calling, NOT driver-to-driver. It does three
// things for the DRIVER side (this tablet):
//   A) receive dispatcher -> fleet BROADCASTS (amber banner, tap to dismiss),
//   B) a private 1:1 line with the dispatcher (blue ring, answer / decline / end),
//   C) raise structured STATUS ALERTS (breakdown / fuel / waiting-no-assignment).
//      MEDICAL_EMERGENCY stays on the EXISTING emergency path (emergencyAlert.ts);
//      we do NOT rebuild the siren/red-screen here.
//
// Transport (server decisions 1A + 2A): outbound realtime is Server-Sent Events
// (`/api/cab-call/stream?unit_no=`) with a REST poll fallback (`/inbox`,
// `/active`) so a cab that cannot hold an SSE socket still rings within a poll
// interval. Voice rides a leased Mumble channel slot handed back on answer; we
// drive the EXISTING RadioController to that slot for the call and restore the
// normal talk group on hang-up (no second audio engine).
//
// Decoupling guarantee (mirrors radio.ts): every network call is best-effort and
// swallowed -- a Cab Call failure sets state to `offline` and can NEVER bubble
// into the dispatch render tree or block the haul-cycle. Lazy-loaded so the
// dispatch screen pulls in nothing from here until the cab connects.

import { apiFetch } from './api'

export type CabCallPhase =
  | 'offline'      // not connected / disabled / error
  | 'idle'         // connected, no active call
  | 'ringing_in'   // dispatcher is calling this cab (incoming)
  | 'ringing_out'  // this cab is calling the dispatcher (outgoing)
  | 'connecting'   // answered, joining the voice slot
  | 'connected'    // live call
  | 'ended'        // just ended (transient; returns to idle)

export type CabCallTrigger =
  | 'MANUAL' | 'BREAKDOWN' | 'MEDICAL_EMERGENCY' | 'FUEL' | 'STATUS_CHANGE'

// Structured alert types a cab can raise (server ALERT_TYPES). MEDICAL_EMERGENCY
// is intentionally routed through the existing emergency flow, not this service.
export type CabAlertType =
  | 'BREAKDOWN' | 'FUEL_REQUIRED' | 'WAITING_NO_ASSIGNMENT' | 'MEDICAL_EMERGENCY'

export interface CabIdentity {
  employeeId?: string | null
  unitNo?: string | null
  operatorName?: string | null
}

// The live 1:1 call this cab is on (or being rung for).
export interface ActiveCabCall {
  callId: string
  unitId: string
  phase: CabCallPhase
  callerType?: 'DRIVER' | 'DISPATCHER'
  callerName?: string
  triggerType?: string
  mumbleChannel?: string | null
  startedAt: number          // epoch ms (ring or connect), for the call timer
}

// A broadcast sitting in the cab's banner queue.
export interface CabBroadcast {
  broadcastId: string
  senderName: string
  messageText?: string | null
  audioUrl?: string | null
  priority: string           // NORMAL | URGENT
  sentAt?: string
}

type PhaseListener = (phase: CabCallPhase, call: ActiveCabCall | null) => void
type BroadcastListener = (broadcasts: CabBroadcast[]) => void

// Poll cadences (ms). SSE is the primary path; these are the safety net so a cab
// that loses the stream still rings + sees broadcasts within a poll.
const INBOX_POLL_MS = 6000
const INCOMING_POLL_MS = 4000
// How long an "ended" state lingers before snapping back to idle (UI only).
const ENDED_LINGER_MS = 1500

// ---------------------------------------------------------------------------
// CabCallController -- the state machine + transport the UI binds to.
// One process-wide singleton (getCabCallController) so a live call survives the
// React re-render churn of the dispatch board, exactly like RadioController.
// ---------------------------------------------------------------------------
export class CabCallController {
  private phase: CabCallPhase = 'offline'
  private identity: CabIdentity = {}
  private call: ActiveCabCall | null = null
  private broadcasts: CabBroadcast[] = []
  private phaseListeners = new Set<PhaseListener>()
  private broadcastListeners = new Set<BroadcastListener>()

  private sse: EventSource | null = null
  private inboxTimer: ReturnType<typeof setInterval> | null = null
  private incomingTimer: ReturnType<typeof setInterval> | null = null
  private endedTimer: ReturnType<typeof setTimeout> | null = null
  private enabled = true
  // The talk group the radio was on before a call so we can restore it after.
  private channelBeforeCall: string | null = null

  // -- state plumbing -----------------------------------------------------
  getPhase(): CabCallPhase { return this.phase }
  getCall(): ActiveCabCall | null { return this.call }
  getBroadcasts(): CabBroadcast[] { return this.broadcasts }
  isEnabled(): boolean { return this.enabled }

  onPhase(cb: PhaseListener): () => void {
    this.phaseListeners.add(cb)
    cb(this.phase, this.call)
    return () => this.phaseListeners.delete(cb)
  }
  onBroadcasts(cb: BroadcastListener): () => void {
    this.broadcastListeners.add(cb)
    cb(this.broadcasts)
    return () => this.broadcastListeners.delete(cb)
  }
  private setPhase(p: CabCallPhase): void {
    this.phase = p
    this.emitPhase()
  }
  private emitPhase(): void {
    for (const cb of this.phaseListeners) {
      try { cb(this.phase, this.call) } catch { /* listener errors never break cab call */ }
    }
  }
  private emitBroadcasts(): void {
    for (const cb of this.broadcastListeners) {
      try { cb(this.broadcasts) } catch { /* swallow */ }
    }
  }

  // -- lifecycle ----------------------------------------------------------
  async connect(identity: CabIdentity): Promise<void> {
    this.identity = identity || {}
    // Health gate: a disabled feature stays cleanly offline (no SSE, no polls).
    const ok = await this.fetchHealth()
    if (!ok) { this.setPhase('offline'); return }
    this.setPhase('idle')
    this.openStream()
    this.startPolls()
    // Prime the banner queue immediately so a broadcast sent before connect shows.
    void this.pollInbox()
  }

  disconnect(): void {
    this.closeStream()
    this.stopPolls()
    if (this.endedTimer) { clearTimeout(this.endedTimer); this.endedTimer = null }
    this.call = null
    this.setPhase('offline')
  }

  // -- 1:1 CALL (driver side) --------------------------------------------
  // Driver taps "Call Dispatch". Best-effort: a failure just stays idle (the
  // operator falls back to the physical radio, the documented degrade).
  async callDispatcher(trigger: CabCallTrigger = 'MANUAL'): Promise<boolean> {
    if (!this.enabled || this.phase !== 'idle') return false
    const body = {
      initiator_type: 'DRIVER',
      unit_no: this.identity.unitNo || '',
      initiator_name: this.identity.operatorName || this.identity.unitNo || '',
      trigger_type: trigger,
    }
    try {
      const res = await apiFetch('/api/cab-call/initiate', { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) return false
      const data = await res.json()
      if (!data?.success || !data.call) return false
      this.call = {
        callId: data.call.call_id, unitId: body.unit_no, phase: 'ringing_out',
        callerType: 'DRIVER', callerName: body.initiator_name,
        triggerType: trigger, startedAt: Date.now(),
      }
      this.setPhase('ringing_out')
      return true
    } catch { return false }
  }

  // Driver answers an INCOMING dispatcher call.
  async answer(): Promise<boolean> {
    const c = this.call
    if (!c || this.phase !== 'ringing_in') return false
    this.setPhase('connecting')
    try {
      const res = await apiFetch(`/api/cab-call/${c.callId}/answer`, {
        method: 'POST', body: JSON.stringify({ answered_by: 'DRIVER' }),
      })
      if (!res.ok) { this.setPhase('ringing_in'); return false }
      const data = await res.json()
      if (!data?.success) { this.setPhase('ringing_in'); return false }
      c.mumbleChannel = data.mumble_channel || null
      c.phase = 'connected'
      await this.joinVoice(c.mumbleChannel)
      this.setPhase('connected')
      return true
    } catch { this.setPhase('ringing_in'); return false }
  }

  // Decline an incoming ring OR end/cancel any active/outgoing call.
  async end(reason: 'NORMAL' | 'DECLINED' = 'NORMAL'): Promise<void> {
    const c = this.call
    if (!c) return
    const callId = c.callId
    // Optimistic local teardown so the UI never feels stuck on a flaky network.
    await this.leaveVoice()
    this.call = null
    this.setPhase('ended')
    this.scheduleIdle()
    try {
      await apiFetch(`/api/cab-call/${callId}/end`, {
        method: 'POST', body: JSON.stringify({ ended_by: 'DRIVER', reason }),
      })
    } catch { /* best-effort: local teardown already happened */ }
  }

  // -- STATUS ALERTS (Feature C) -----------------------------------------
  // A cab raises a structured alert. BREAKDOWN auto-opens a call to dispatch
  // (server side); the SSE CAB_CALL_INCOMING / our outgoing mirror then drives
  // the ring. MEDICAL_EMERGENCY is NOT handled here -- callers must use the
  // existing emergency path; we expose the type only for completeness/guarding.
  async raiseStatusAlert(alertType: CabAlertType, driverStatus?: string): Promise<boolean> {
    if (!this.enabled) return false
    if (alertType === 'MEDICAL_EMERGENCY') {
      // Guardrail: medical stays on the existing emergency flow. We refuse here so
      // a mis-wire can never bypass the siren/red-screen path.
      console.warn('[cabcall] MEDICAL_EMERGENCY must use the existing emergency path')
      return false
    }
    try {
      const res = await apiFetch('/api/status-alert/raise', {
        method: 'POST',
        body: JSON.stringify({
          unit_no: this.identity.unitNo || '',
          alert_type: alertType,
          driver_name: this.identity.operatorName || '',
          driver_status: driverStatus || null,
        }),
      })
      if (!res.ok) return false
      const data = await res.json()
      // A BREAKDOWN alert returns the auto-created cab_call; reflect it as outgoing
      // so the cab immediately shows "Calling dispatch..." without waiting on SSE.
      if (data?.cab_call?.call_id && this.phase === 'idle') {
        this.call = {
          callId: data.cab_call.call_id, unitId: this.identity.unitNo || '',
          phase: 'ringing_out', callerType: 'DRIVER',
          callerName: data.cab_call.initiator_name, triggerType: 'BREAKDOWN',
          startedAt: Date.now(),
        }
        this.setPhase('ringing_out')
      }
      return Boolean(data?.success)
    } catch { return false }
  }

  // -- BROADCASTS ---------------------------------------------------------
  async acknowledgeBroadcast(broadcastId: string): Promise<void> {
    // Drop locally first so the banner dismisses instantly.
    this.broadcasts = this.broadcasts.filter((b) => b.broadcastId !== broadcastId)
    this.emitBroadcasts()
    try {
      await apiFetch(`/api/broadcast/${broadcastId}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify({
          unit_no: this.identity.unitNo || '',
          driver_id: this.identity.employeeId || '',
          driver_name: this.identity.operatorName || '',
        }),
      })
    } catch { /* best-effort */ }
  }

  // -- voice (reuse the existing radio audio engine) ---------------------
  // On connect we point the SHARED RadioController at the leased call slot and
  // remember the talk group it was on; on hang-up we restore it. Best-effort and
  // lazy so cabcall.ts never hard-depends on the radio module.
  private async joinVoice(slot: string | null | undefined): Promise<void> {
    if (!slot) return
    try {
      const { getRadioController } = await import('./radio')
      const radio = getRadioController()
      this.channelBeforeCall = radio.getChannel()
      await radio.selectChannel(slot)
    } catch { /* voice optional: the call still connects, fall back to radio */ }
  }
  private async leaveVoice(): Promise<void> {
    if (this.channelBeforeCall == null) return
    const restore = this.channelBeforeCall
    this.channelBeforeCall = null
    try {
      const { getRadioController } = await import('./radio')
      await getRadioController().selectChannel(restore)
    } catch { /* best-effort */ }
  }

  // -- SSE stream ---------------------------------------------------------
  private openStream(): void {
    this.closeStream()
    const unit = this.identity.unitNo || ''
    if (!unit) return
    // EventSource cannot send Authorization headers, so the stream is a best-effort
    // accelerator only -- the REST polls (which DO carry the token) are the
    // guaranteed path. We build the URL against the active endpoint lazily.
    void this.streamUrl(unit).then((url) => {
      if (!url) return
      try {
        const es = new EventSource(url, { withCredentials: true })
        es.onmessage = (e) => this.onStreamEvent(e.data)
        es.onerror = () => { /* the polls keep us alive; let ES auto-retry */ }
        this.sse = es
      } catch { /* SSE unavailable -> polls only */ }
    })
  }
  private closeStream(): void {
    if (this.sse) { try { this.sse.close() } catch { /* ignore */ } this.sse = null }
  }
  private async streamUrl(unit: string): Promise<string | null> {
    try {
      const { getEndpointStatus } = await import('./api')
      const status = getEndpointStatus()
      // Prefer the healthiest cached endpoint; fall back to local then cloud.
      const healthy = status.cache.find((c) => c.healthy)?.url
      const base = healthy || status.local || status.cloud
      return `${base}/api/cab-call/stream?unit_no=${encodeURIComponent(unit)}`
    } catch { return null }
  }
  private onStreamEvent(raw: string): void {
    let ev: any
    try { ev = JSON.parse(raw) } catch { return }
    if (!ev || !ev.event) return
    this.handleEvent(ev)
  }

  // The single event reducer, shared by SSE and the poll fallback so both paths
  // converge on the same state. Idempotent: re-delivering an event is harmless.
  private handleEvent(ev: any): void {
    switch (ev.event) {
      case 'CAB_CALL_INCOMING':
        // Dispatcher is calling this cab. Ignore if we are already on a call.
        if (this.phase === 'idle' && ev.call_id) {
          this.call = {
            callId: ev.call_id, unitId: this.identity.unitNo || '',
            phase: 'ringing_in', callerType: ev.caller_type || 'DISPATCHER',
            callerName: ev.caller_name || 'Control Room', startedAt: Date.now(),
          }
          this.setPhase('ringing_in')
        }
        break
      case 'CAB_CALL_STATE_CHANGED': {
        const c = this.call
        if (!c || ev.call_id !== c.callId) break
        const ns = ev.new_state
        if (ns === 'CONNECTED') {
          c.mumbleChannel = ev.mumble_channel || c.mumbleChannel || null
          c.phase = 'connected'
          c.startedAt = Date.now()
          void this.joinVoice(c.mumbleChannel)
          this.setPhase('connected')
        } else if (ns === 'ENDED' || ns === 'MISSED' || ns === 'DECLINED' || ns === 'ERROR') {
          void this.leaveVoice()
          this.call = null
          this.setPhase('ended')
          this.scheduleIdle()
        }
        break
      }
      case 'BROADCAST_RECEIVED':
        if (ev.broadcast_id) this.upsertBroadcast(this.toBroadcast(ev))
        break
      default:
        break
    }
  }

  // -- poll fallback ------------------------------------------------------
  private startPolls(): void {
    this.stopPolls()
    this.inboxTimer = setInterval(() => void this.pollInbox(), INBOX_POLL_MS)
    this.incomingTimer = setInterval(() => void this.pollIncoming(), INCOMING_POLL_MS)
  }
  private stopPolls(): void {
    if (this.inboxTimer) { clearInterval(this.inboxTimer); this.inboxTimer = null }
    if (this.incomingTimer) { clearInterval(this.incomingTimer); this.incomingTimer = null }
  }

  private async pollInbox(): Promise<void> {
    const unit = this.identity.unitNo || ''
    if (!unit) return
    try {
      const res = await apiFetch(`/api/broadcast/inbox?unit_no=${encodeURIComponent(unit)}`, { method: 'GET' })
      if (!res.ok) return
      const data = await res.json()
      const inbox = Array.isArray(data?.inbox) ? data.inbox : []
      // Reconcile: the inbox is the source of truth for the unread queue.
      const next = inbox.map((b: any) => this.toBroadcast(b))
      const changed = next.length !== this.broadcasts.length ||
        next.some((b: CabBroadcast, i: number) => b.broadcastId !== this.broadcasts[i]?.broadcastId)
      if (changed) { this.broadcasts = next; this.emitBroadcasts() }
    } catch { /* best-effort */ }
  }

  // Poll for an incoming dispatcher ring while idle (SSE has no auth header, so a
  // cab behind a proxy that strips SSE still rings via this). Cheap: only runs
  // while idle and only acts on a RINGING call addressed to this unit.
  private async pollIncoming(): Promise<void> {
    if (this.phase !== 'idle') return
    const unit = (this.identity.unitNo || '').toUpperCase()
    if (!unit) return
    try {
      const res = await apiFetch('/api/cab-call/active', { method: 'GET' })
      if (!res.ok) return
      const data = await res.json()
      const calls = Array.isArray(data?.calls) ? data.calls : []
      const mine = calls.find((c: any) =>
        String(c.unit_id || '').toUpperCase() === unit &&
        c.call_state === 'RINGING' && c.initiator_type === 'DISPATCHER')
      if (mine) {
        this.call = {
          callId: mine.call_id, unitId: unit, phase: 'ringing_in',
          callerType: 'DISPATCHER', callerName: mine.initiator_name || 'Control Room',
          triggerType: mine.trigger_type, startedAt: Date.now(),
        }
        this.setPhase('ringing_in')
      }
    } catch { /* best-effort */ }
  }

  // -- helpers ------------------------------------------------------------
  private async fetchHealth(): Promise<boolean> {
    try {
      const res = await apiFetch('/api/cab-call/health', { method: 'GET' })
      if (!res.ok) return false
      const data = await res.json()
      this.enabled = data?.enabled !== false
      return this.enabled
    } catch { return false }
  }

  private toBroadcast(ev: any): CabBroadcast {
    return {
      broadcastId: String(ev.broadcast_id),
      senderName: ev.sender_name || ev.sent_by_name || 'Control Room',
      messageText: ev.message_text ?? null,
      audioUrl: ev.audio_url ?? null,
      priority: ev.priority || 'NORMAL',
      sentAt: ev.sent_at,
    }
  }
  private upsertBroadcast(b: CabBroadcast): void {
    if (this.broadcasts.some((x) => x.broadcastId === b.broadcastId)) return
    this.broadcasts = [...this.broadcasts, b]
    this.emitBroadcasts()
  }
  private scheduleIdle(): void {
    if (this.endedTimer) clearTimeout(this.endedTimer)
    this.endedTimer = setTimeout(() => {
      this.endedTimer = null
      if (this.phase === 'ended') this.setPhase('idle')
    }, ENDED_LINGER_MS)
  }
}

// Process-wide singleton the cab UI binds to (so a live call survives re-renders).
let _controller: CabCallController | null = null
export function getCabCallController(): CabCallController {
  if (!_controller) _controller = new CabCallController()
  return _controller
}

// Test seam: inject / reset between tests.
export function __setCabCallController(c: CabCallController | null): void {
  _controller = c
}
