// @vitest-environment jsdom
//
// PRISM Cab Call service (services/cabcall.ts) -- the in-cab intercom client.
// We mock apiFetch (so no backend is needed) and the radio module (so the voice
// hop is observable without an audio engine), and stub EventSource so the SSE
// path is inert in CI. We assert the call state machine (idle -> ringing ->
// connected -> ended -> idle), the broadcast queue + ack, the status-alert rules
// (BREAKDOWN auto-call, MEDICAL refusal), the poll fallback that rings a cab when
// SSE is unavailable, and the decoupling guarantee (network failures degrade to
// `offline`/no-op and NEVER throw into the caller).

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
const selectChannelMock = vi.fn(() => Promise.resolve())
const getChannelMock = vi.fn(() => 'hauling')

vi.mock('../services/api', () => ({
  apiFetch: (...a: any[]) => apiFetchMock(...a),
  getEndpointStatus: () => ({ cloud: 'https://c', local: 'http://l', dev: 'http://d', cache: [] }),
}))
vi.mock('../services/radio', () => ({
  getRadioController: () => ({
    getChannel: () => getChannelMock(),
    selectChannel: (n: string) => selectChannelMock(n),
  }),
}))

import {
  CabCallController,
  getCabCallController,
  __setCabCallController,
  type CabCallPhase,
} from '../services/cabcall'

function okJson(body: any) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}
function badStatus(status = 500) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response)
}

const IDENT = { employeeId: 'E123', unitNo: 'DT-07', operatorName: 'Budi' }

// A stub EventSource so openStream() never opens a real socket in CI.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  url: string
  closed = false
  constructor(url: string) { this.url = url; FakeEventSource.instances.push(this) }
  close() { this.closed = true }
  emit(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

// Route apiFetch by path. Health enabled by default; everything else 200-ok.
function wireHealthy(overrides: Record<string, any> = {}) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/cab-call/health') return okJson({ success: true, enabled: true, pool: {}, ...overrides.health })
    if (path.startsWith('/api/broadcast/inbox')) return okJson({ success: true, inbox: overrides.inbox || [] })
    if (path === '/api/cab-call/active') return okJson({ success: true, calls: overrides.active || [] })
    if (path === '/api/cab-call/initiate') return okJson({ success: true, call: { call_id: 'call-out-1' } })
    if (path.endsWith('/answer')) return okJson({ success: true, mumble_channel: 'cab-call-slot-03' })
    if (path.endsWith('/end')) return okJson({ success: true })
    if (path.endsWith('/acknowledge')) return okJson({ success: true })
    if (path === '/api/status-alert/raise') return okJson({ success: true, ...overrides.raise })
    return okJson({ success: true })
  })
}

describe('CabCallController', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    selectChannelMock.mockClear()
    getChannelMock.mockClear()
    FakeEventSource.instances = []
    ;(globalThis as any).EventSource = FakeEventSource as any
    __setCabCallController(null)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('starts offline', () => {
    expect(new CabCallController().getPhase()).toBe('offline')
  })

  it('connects to idle when the feature is enabled', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    expect(c.getPhase()).toBe('idle')
  })

  it('stays offline when the feature is disabled', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/cab-call/health') return okJson({ success: true, enabled: false })
      return okJson({ success: true })
    })
    const c = new CabCallController()
    await c.connect(IDENT)
    expect(c.getPhase()).toBe('offline')
    expect(c.isEnabled()).toBe(false)
  })

  it('stays offline when health fails (decoupling: no throw)', async () => {
    apiFetchMock.mockImplementation(() => badStatus())
    const c = new CabCallController()
    await c.connect(IDENT)            // must not throw
    expect(c.getPhase()).toBe('offline')
  })

  // -- outgoing call -------------------------------------------------------
  it('callDispatcher moves idle -> ringing_out', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    const ok = await c.callDispatcher('MANUAL')
    expect(ok).toBe(true)
    expect(c.getPhase()).toBe('ringing_out')
    expect(c.getCall()?.callId).toBe('call-out-1')
  })

  it('dispatcher answering an outgoing call connects + joins the voice slot', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    await c.callDispatcher('MANUAL')
    // Server pushes CONNECTED for our outgoing call.
    ;(c as any).handleEvent({ event: 'CAB_CALL_STATE_CHANGED', call_id: 'call-out-1',
                              new_state: 'CONNECTED', mumble_channel: 'cab-call-slot-05' })
    expect(c.getPhase()).toBe('connected')
    expect(c.getCall()?.mumbleChannel).toBe('cab-call-slot-05')
    // joinVoice() is fire-and-forget via a dynamic import; flush it then assert.
    await vi.advanceTimersByTimeAsync(0)
    expect(selectChannelMock).toHaveBeenCalledWith('cab-call-slot-05')
  })

  // -- incoming call -------------------------------------------------------
  it('CAB_CALL_INCOMING event rings the cab (ringing_in)', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    ;(c as any).handleEvent({ event: 'CAB_CALL_INCOMING', call_id: 'in-1',
                              caller_type: 'DISPATCHER', caller_name: 'Control Room' })
    expect(c.getPhase()).toBe('ringing_in')
    expect(c.getCall()?.callerName).toBe('Control Room')
  })

  it('answer() leases the slot, connects, and joins voice; remembers prior channel', async () => {
    wireHealthy()
    getChannelMock.mockReturnValue('hauling')
    const c = new CabCallController()
    await c.connect(IDENT)
    ;(c as any).handleEvent({ event: 'CAB_CALL_INCOMING', call_id: 'in-1', caller_type: 'DISPATCHER' })
    const ok = await c.answer()
    expect(ok).toBe(true)
    expect(c.getPhase()).toBe('connected')
    expect(selectChannelMock).toHaveBeenCalledWith('cab-call-slot-03')
  })

  it('end() tears down locally, restores the radio channel, and returns to idle', async () => {
    wireHealthy()
    getChannelMock.mockReturnValue('hauling')
    const c = new CabCallController()
    await c.connect(IDENT)
    ;(c as any).handleEvent({ event: 'CAB_CALL_INCOMING', call_id: 'in-1', caller_type: 'DISPATCHER' })
    await c.answer()
    selectChannelMock.mockClear()
    await c.end('NORMAL')
    expect(c.getPhase()).toBe('ended')
    expect(selectChannelMock).toHaveBeenCalledWith('hauling')   // restored
    await vi.advanceTimersByTimeAsync(2000)
    expect(c.getPhase()).toBe('idle')                            // lingers then idles
  })

  it('a remote end (CAB_CALL_STATE_CHANGED MISSED) drops the call', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    await c.callDispatcher('MANUAL')
    ;(c as any).handleEvent({ event: 'CAB_CALL_STATE_CHANGED', call_id: 'call-out-1', new_state: 'MISSED' })
    expect(c.getPhase()).toBe('ended')
    expect(c.getCall()).toBeNull()
  })

  // -- broadcasts ----------------------------------------------------------
  it('BROADCAST_RECEIVED queues a banner and ack removes it', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    const seen: number[] = []
    c.onBroadcasts((b) => seen.push(b.length))
    ;(c as any).handleEvent({ event: 'BROADCAST_RECEIVED', broadcast_id: 'b1',
                              sender_name: 'Control', message_text: 'Fuel at bay 2', priority: 'URGENT' })
    expect(c.getBroadcasts().map((b) => b.broadcastId)).toEqual(['b1'])
    expect(c.getBroadcasts()[0].priority).toBe('URGENT')
    await c.acknowledgeBroadcast('b1')
    expect(c.getBroadcasts()).toEqual([])
    expect(seen[seen.length - 1]).toBe(0)
  })

  it('duplicate BROADCAST_RECEIVED does not double-queue', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    ;(c as any).handleEvent({ event: 'BROADCAST_RECEIVED', broadcast_id: 'b1', message_text: 'x' })
    ;(c as any).handleEvent({ event: 'BROADCAST_RECEIVED', broadcast_id: 'b1', message_text: 'x' })
    expect(c.getBroadcasts().length).toBe(1)
  })

  it('inbox poll reconciles the banner queue (SSE-less fallback)', async () => {
    wireHealthy({ inbox: [{ broadcast_id: 'b9', message_text: 'check tyres', priority: 'NORMAL' }] })
    const c = new CabCallController()
    await c.connect(IDENT)
    // connect() primes the inbox immediately.
    await vi.advanceTimersByTimeAsync(0)
    expect(c.getBroadcasts().map((b) => b.broadcastId)).toEqual(['b9'])
  })

  // -- status alerts -------------------------------------------------------
  it('raiseStatusAlert(BREAKDOWN) reflects the auto-created call as outgoing', async () => {
    wireHealthy({ raise: { cab_call: { call_id: 'bd-1', initiator_name: 'Budi' } } })
    const c = new CabCallController()
    await c.connect(IDENT)
    const ok = await c.raiseStatusAlert('BREAKDOWN', 'breakdown')
    expect(ok).toBe(true)
    expect(c.getPhase()).toBe('ringing_out')
    expect(c.getCall()?.triggerType).toBe('BREAKDOWN')
  })

  it('raiseStatusAlert(FUEL_REQUIRED) records but does NOT start a call', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    const ok = await c.raiseStatusAlert('FUEL_REQUIRED')
    expect(ok).toBe(true)
    expect(c.getPhase()).toBe('idle')         // no call
  })

  it('raiseStatusAlert(MEDICAL_EMERGENCY) is refused (stays on existing emergency path)', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    const ok = await c.raiseStatusAlert('MEDICAL_EMERGENCY')
    expect(ok).toBe(false)
    expect(apiFetchMock).not.toHaveBeenCalledWith('/api/status-alert/raise', expect.anything())
  })

  // -- poll fallback rings the cab when SSE is unavailable -----------------
  it('pollIncoming rings the cab on a RINGING dispatcher call addressed to this unit', async () => {
    wireHealthy({ active: [{ call_id: 'ring-1', unit_id: 'DT-07', call_state: 'RINGING',
                             initiator_type: 'DISPATCHER', initiator_name: 'Control Room' }] })
    const c = new CabCallController()
    await c.connect(IDENT)
    await (c as any).pollIncoming()
    expect(c.getPhase()).toBe('ringing_in')
    expect(c.getCall()?.callId).toBe('ring-1')
  })

  it('pollIncoming ignores calls for other units', async () => {
    wireHealthy({ active: [{ call_id: 'ring-2', unit_id: 'DT-99', call_state: 'RINGING',
                             initiator_type: 'DISPATCHER' }] })
    const c = new CabCallController()
    await c.connect(IDENT)
    await (c as any).pollIncoming()
    expect(c.getPhase()).toBe('idle')
  })

  // -- decoupling ----------------------------------------------------------
  it('callDispatcher swallows a network failure and stays idle', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    apiFetchMock.mockImplementation(() => Promise.reject(new Error('net down')))
    const ok = await c.callDispatcher('MANUAL')   // must not throw
    expect(ok).toBe(false)
    expect(c.getPhase()).toBe('idle')
  })

  it('disconnect closes the stream and goes offline', async () => {
    wireHealthy()
    const c = new CabCallController()
    await c.connect(IDENT)
    await vi.advanceTimersByTimeAsync(0)   // let openStream resolve
    c.disconnect()
    expect(c.getPhase()).toBe('offline')
    expect(FakeEventSource.instances.every((es) => es.closed)).toBe(true)
  })

  it('getCabCallController returns a singleton', () => {
    const a = getCabCallController()
    const b = getCabCallController()
    expect(a).toBe(b)
  })
})
