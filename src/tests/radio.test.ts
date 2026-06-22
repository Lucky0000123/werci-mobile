// @vitest-environment jsdom
//
// PRISM Radio service (services/radio.ts) -- transport-agnostic PTT controller.
// We mock apiFetch so no backend is needed, and inject a fake VoiceTransport to
// assert the state machine, the talk-group selection, the PTT reporting
// (down/heartbeat/up), and the decoupling guarantee (network failures degrade to
// `offline` and never throw into the caller).

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('../services/api', () => ({ apiFetch: (...a: any[]) => apiFetchMock(...a) }))

import {
  RadioController,
  StubVoiceTransport,
  type VoiceTransport,
  type RadioConfig,
} from '../services/radio'

function okJson(body: any) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
}

const CONFIG_BODY = {
  success: true,
  enabled: true,
  mumble_host: '10.40.20.184',
  mumble_port: 64738,
  ws_url: '',            // no proxy -> client-reported mode (audio stub)
  opus_bitrate: 24000,
  speak_heartbeat_ms: 50,
  channels: [
    { name: 'dispatch', display_name: 'Dispatch', sort_order: 5 },
    { name: 'hauling', display_name: 'Hauling', sort_order: 30 },
  ],
}

// Routes a mocked apiFetch by path so each endpoint returns the right shape.
function wireHappyPath() {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/radio/config') return okJson(CONFIG_BODY)
    if (path === '/api/radio/identity') return okJson({ success: true, username: 'op_E123' })
    if (path === '/api/radio/ptt') return okJson({ success: true })
    return okJson({ success: true })
  })
}

const IDENT = { employeeId: 'E123', unitNo: 'DT-07', operatorName: 'Budi' }

describe('RadioController', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('starts offline', () => {
    const c = new RadioController()
    expect(c.getState()).toBe('offline')
  })

  it('connects to idle and loads channels (default = first)', async () => {
    wireHappyPath()
    const c = new RadioController()
    await c.connect(IDENT)
    expect(c.getState()).toBe('idle')
    expect(c.getChannels().map((x) => x.name)).toEqual(['dispatch', 'hauling'])
    expect(c.getChannel()).toBe('dispatch')
  })

  it('goes offline when the server reports disabled', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/radio/config') return okJson({ success: true, enabled: false, channels: [] })
      return okJson({ success: true })
    })
    const c = new RadioController()
    await c.connect(IDENT)
    expect(c.getState()).toBe('offline')
  })

  it('goes offline when identity is refused (no phantom)', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/radio/config') return okJson(CONFIG_BODY)
      if (path === '/api/radio/identity') return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
      return okJson({ success: true })
    })
    const c = new RadioController()
    await c.connect(IDENT)
    expect(c.getState()).toBe('offline')
  })

  it('PTT down -> transmitting, up -> idle, and reports both', async () => {
    wireHappyPath()
    const c = new RadioController()
    await c.connect(IDENT)
    apiFetchMock.mockClear()

    await c.pttDown()
    expect(c.getState()).toBe('transmitting')
    await c.pttUp()
    expect(c.getState()).toBe('idle')

    const pttCalls = apiFetchMock.mock.calls.filter((c) => c[0] === '/api/radio/ptt')
    const states = pttCalls.map((c) => JSON.parse((c[1] as RequestInit).body as string).state)
    expect(states).toContain('down')
    expect(states).toContain('up')
  })

  it('PTT reports carry the operator + unit identity', async () => {
    wireHappyPath()
    const c = new RadioController()
    await c.connect(IDENT)
    apiFetchMock.mockClear()
    await c.pttDown()
    await c.pttUp()
    const down = apiFetchMock.mock.calls.find(
      (c) => c[0] === '/api/radio/ptt' && JSON.parse((c[1] as RequestInit).body as string).state === 'down')
    const payload = JSON.parse((down![1] as RequestInit).body as string)
    expect(payload.unit_no).toBe('DT-07')
    expect(payload.employee_id).toBe('E123')
    expect(payload.channel).toBe('dispatch')
  })

  it('emits a heartbeat while PTT is held', async () => {
    wireHappyPath()
    const c = new RadioController()
    await c.connect(IDENT)
    apiFetchMock.mockClear()
    await c.pttDown()
    // heartbeat interval is 50ms (from config) -> advance 170ms => >=3 beats
    await vi.advanceTimersByTimeAsync(170)
    await c.pttUp()
    const beats = apiFetchMock.mock.calls.filter(
      (c) => c[0] === '/api/radio/ptt' && JSON.parse((c[1] as RequestInit).body as string).state === 'heartbeat')
    expect(beats.length).toBeGreaterThanOrEqual(3)
  })

  it('selectChannel switches the active talk group', async () => {
    wireHappyPath()
    const c = new RadioController()
    await c.connect(IDENT)
    await c.selectChannel('hauling')
    expect(c.getChannel()).toBe('hauling')
  })

  it('notifies state listeners and supports unsubscribe', async () => {
    wireHappyPath()
    const c = new RadioController()
    const seen: string[] = []
    const off = c.onState((s) => seen.push(s))
    await c.connect(IDENT)
    expect(seen[0]).toBe('offline')       // immediate current state
    expect(seen).toContain('connecting')
    expect(seen).toContain('idle')
    off()
    await c.pttDown()
    // No new entries after unsubscribe.
    expect(seen).not.toContain('transmitting')
  })

  // -- DECOUPLING: a radio/network failure never throws into the caller ------
  it('degrades to offline (no throw) when the network is down', async () => {
    apiFetchMock.mockRejectedValue(new Error('network down'))
    const c = new RadioController()
    await expect(c.connect(IDENT)).resolves.toBeUndefined()
    expect(c.getState()).toBe('offline')
  })

  it('PTT while offline is a no-op (never throws)', async () => {
    const c = new RadioController()   // never connected -> offline
    await expect(c.pttDown()).resolves.toBeUndefined()
    expect(c.getState()).toBe('offline')
  })

  it('PTT report rejection is swallowed', async () => {
    wireHappyPath()
    const c = new RadioController()
    await c.connect(IDENT)
    apiFetchMock.mockRejectedValue(new Error('ptt post failed'))
    // Should not throw even though the report POST rejects.
    await expect(c.pttDown()).resolves.toBeUndefined()
    expect(c.getState()).toBe('transmitting')
    await c.pttUp()
  })
})

describe('VoiceTransport injection', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('uses an injected transport and forwards channel + PTT calls', async () => {
    wireHappyPath()
    const calls: string[] = []
    const fake: VoiceTransport = {
      name: 'fake',
      connect: vi.fn(async () => { calls.push('connect'); return true }),
      selectChannel: vi.fn(async (ch: string) => { calls.push('select:' + ch) }),
      startTransmit: vi.fn(async () => { calls.push('start') }),
      stopTransmit: vi.fn(async () => { calls.push('stop') }),
      disconnect: vi.fn(async () => { calls.push('disconnect') }),
      onReceiving: vi.fn(),
    }
    const c = new RadioController(fake)
    await c.connect(IDENT)
    await c.pttDown()
    await c.pttUp()
    expect(calls).toContain('connect')
    expect(calls).toContain('start')
    expect(calls).toContain('stop')
    expect(calls.some((x) => x.startsWith('select:'))).toBe(true)
  })

  it('StubVoiceTransport reports audio unavailable without a ws_url', async () => {
    const stub = new StubVoiceTransport()
    const cfg = { ws_url: '' } as RadioConfig
    expect(await stub.connect(cfg, 'op_E123')).toBe(false)
    const cfg2 = { ws_url: 'wss://example/ws' } as RadioConfig
    expect(await stub.connect(cfg2, 'op_E123')).toBe(true)
  })

  it('forwards receiving events to state listeners', async () => {
    wireHappyPath()
    const stub = new StubVoiceTransport()
    const c = new RadioController(stub)
    await c.connect(IDENT)
    expect(c.isReceiving()).toBe(false)
    stub._emitReceiving(true)
    expect(c.isReceiving()).toBe(true)
    stub._emitReceiving(false)
    expect(c.isReceiving()).toBe(false)
  })
})
