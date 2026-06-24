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
  MumbleWebTransport,
  pickChannelForStatus,
  EMERGENCY_HOLD_MS,
  type VoiceTransport,
  type RadioConfig,
  type SpecialChannels,
  type RadioChannel,
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

// ── AdvancedRadioPTT engine: smart-switch + zone follow + emergency ──────────

const SPECIAL: SpecialChannels = {
  emergency: 'site_emergency',
  dispatch_lead: 'dispatch_lead',
  maintenance: 'maintenance_workshop',
}
const ADV_CHANNELS: RadioChannel[] = [
  { name: 'site_emergency', display_name: 'SITE EMERGENCY', sort_order: -100 },
  { name: 'dispatch', display_name: 'Dispatch', sort_order: 5 },
  { name: 'general', display_name: 'General', sort_order: 10 },
  { name: 'dispatch_lead', display_name: 'Dispatch Lead', sort_order: 90 },
  { name: 'maintenance_workshop', display_name: 'Maintenance / Workshop', sort_order: 95 },
]
// A config that mirrors the real /api/radio/config for the advanced cab UI.
const ADV_CONFIG = {
  success: true, enabled: true, mumble_host: 'h', mumble_port: 64738, ws_url: '',
  opus_bitrate: 24000, speak_heartbeat_ms: 50,
  zone_channels: true, zone_poll_ms: 5000, default_channel: 'dispatch',
  special_channels: SPECIAL,
  channels: ADV_CHANNELS,
}
function wireAdvanced(zoneChannel = 'dispatch') {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/radio/config') return okJson(ADV_CONFIG)
    if (path === '/api/radio/identity') return okJson({ success: true, username: 'op_E123' })
    if (path === '/api/radio/ptt') return okJson({ success: true })
    if (path === '/api/radio/zone') return okJson({ success: true, zone_channels: true, channel: zoneChannel, changed: true })
    return okJson({ success: true })
  })
}

describe('pickChannelForStatus (pure smart-switch)', () => {
  it('breakdown + maintenance route to the workshop net', () => {
    expect(pickChannelForStatus('breakdown', SPECIAL, ADV_CHANNELS, 'general')).toBe('maintenance_workshop')
    expect(pickChannelForStatus('maintenance', SPECIAL, ADV_CHANNELS, 'general')).toBe('maintenance_workshop')
  })
  it('delay routes to the dispatch lead', () => {
    expect(pickChannelForStatus('delay', SPECIAL, ADV_CHANNELS, 'general')).toBe('dispatch_lead')
  })
  it('operating / standby / unknown keep the normal channel', () => {
    expect(pickChannelForStatus('operating', SPECIAL, ADV_CHANNELS, 'general')).toBe('general')
    expect(pickChannelForStatus('standby', SPECIAL, ADV_CHANNELS, 'general')).toBe('general')
    expect(pickChannelForStatus(null, SPECIAL, ADV_CHANNELS, 'general')).toBe('general')
  })
  it('falls back to the normal channel when the special group is not published', () => {
    const noSpecials = [{ name: 'general', display_name: 'General' }]
    expect(pickChannelForStatus('breakdown', SPECIAL, noSpecials, 'general')).toBe('general')
  })
})

describe('RadioController smart-switch + zone follow', () => {
  beforeEach(() => { apiFetchMock.mockReset() })

  it('applyStatus(breakdown) switches to the maintenance net, operating restores normal', async () => {
    wireAdvanced('dispatch')
    const c = new RadioController()
    await c.connect(IDENT)
    expect(c.getChannel()).toBe('dispatch')   // default_channel
    await c.applyStatus('breakdown')
    expect(c.getChannel()).toBe('maintenance_workshop')
    await c.applyStatus('delay')
    expect(c.getChannel()).toBe('dispatch_lead')
    await c.applyStatus('operating')
    expect(c.getChannel()).toBe('dispatch')   // back to the normal channel
  })

  it('resolveZoneChannel follows the GPS-resolved talk group', async () => {
    wireAdvanced('general')
    const c = new RadioController()
    await c.connect(IDENT)
    await c.resolveZoneChannel({ lat: 1, lng: 2 })
    expect(c.getChannel()).toBe('general')
  })

  it('a manual status overrides the zone channel until it clears', async () => {
    wireAdvanced('general')
    const c = new RadioController()
    await c.connect(IDENT)
    await c.applyStatus('breakdown')
    expect(c.getChannel()).toBe('maintenance_workshop')
    // A zone resolve arrives while broken down -> remembered, but not applied.
    await c.resolveZoneChannel({ lat: 1, lng: 2 })
    expect(c.getChannel()).toBe('maintenance_workshop')
    // Clearing the status snaps to the remembered zone channel.
    await c.applyStatus('operating')
    expect(c.getChannel()).toBe('general')
  })

  it('does not poll zones when zone-following is off', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/radio/config') return okJson({ ...ADV_CONFIG, zone_channels: false })
      if (path === '/api/radio/identity') return okJson({ success: true, username: 'op_E123' })
      return okJson({ success: true })
    })
    const c = new RadioController()
    await c.connect(IDENT)
    expect(c.isZoneFollowing()).toBe(false)
    await c.resolveZoneChannel({ lat: 1, lng: 2 })
    expect(apiFetchMock.mock.calls.some((cc) => cc[0] === '/api/radio/zone')).toBe(false)
  })
})

describe('RadioController emergency (panic) mode', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('forces the emergency channel, opens the mic, flags reports, and pulses', async () => {
    wireAdvanced('general')
    const c = new RadioController()
    const seen: boolean[] = []
    c.onEmergency((e) => seen.push(e))
    await c.connect(IDENT)
    apiFetchMock.mockClear()

    await c.startEmergency()
    expect(c.isEmergency()).toBe(true)
    expect(c.getChannel()).toBe('site_emergency')
    expect(c.getState()).toBe('transmitting')
    expect(seen).toContain(true)            // listener saw the pulse turn on

    // The PTT report carries emergency:true on the emergency channel.
    const down = apiFetchMock.mock.calls.find(
      (cc) => cc[0] === '/api/radio/ptt' &&
        JSON.parse((cc[1] as RequestInit).body as string).state === 'down')
    const payload = JSON.parse((down![1] as RequestInit).body as string)
    expect(payload.emergency).toBe(true)
    expect(payload.channel).toBe('site_emergency')
  })

  it('auto-releases the mic after the hands-free window but stays in emergency', async () => {
    wireAdvanced('general')
    const c = new RadioController()
    await c.connect(IDENT)
    await c.startEmergency()
    expect(c.getState()).toBe('transmitting')
    await vi.advanceTimersByTimeAsync(EMERGENCY_HOLD_MS + 10)
    expect(c.getState()).toBe('idle')       // mic released
    expect(c.isEmergency()).toBe(true)      // but still in emergency mode
  })

  it('stopEmergency releases the mic, drops the pulse, and restores the channel', async () => {
    wireAdvanced('general')
    const c = new RadioController()
    await c.connect(IDENT)
    await c.applyStatus('delay')            // would be on dispatch_lead normally
    await c.startEmergency()
    expect(c.getChannel()).toBe('site_emergency')
    await c.stopEmergency()
    expect(c.isEmergency()).toBe(false)
    expect(c.getState()).toBe('idle')
    expect(c.getChannel()).toBe('dispatch_lead')   // restored to the status channel
  })

  it('applyStatus is ignored while emergency owns the channel', async () => {
    wireAdvanced('general')
    const c = new RadioController()
    await c.connect(IDENT)
    await c.startEmergency()
    await c.applyStatus('breakdown')        // must NOT move off the emergency channel
    expect(c.getChannel()).toBe('site_emergency')
    await c.stopEmergency()
    expect(c.getChannel()).toBe('maintenance_workshop')  // the deferred status now applies
  })
})

// --- MumbleWebTransport (Option A bridge) ----------------------------------
// The real transport mirrors the web's window.PrismMumble factory. With no
// ws_url OR no vendored client it must degrade byte-for-byte like the stub
// (connect -> false, no throw). With both present it drives the session.
describe('MumbleWebTransport', () => {
  const baseCfg: RadioConfig = {
    enabled: true, mumble_host: 'h', mumble_port: 64738, ws_url: '',
    opus_bitrate: 24000, speak_heartbeat_ms: 50, default_channel: 'dispatch',
  } as RadioConfig

  afterEach(() => { delete (window as any).PrismMumble })

  it('degrades to false when ws_url is empty (clean voice-offline)', async () => {
    const t = new MumbleWebTransport()
    const ok = await t.connect({ ...baseCfg, ws_url: '' }, 'TRUCK-1')
    expect(ok).toBe(false)
  })

  it('degrades to false when ws_url is set but no vendored client exists', async () => {
    delete (window as any).PrismMumble
    const t = new MumbleWebTransport()
    const ok = await t.connect({ ...baseCfg, ws_url: 'wss://proxy/ws' }, 'TRUCK-1')
    expect(ok).toBe(false)
  })

  it('builds a session, opens muted, and forwards mute toggles when wired', async () => {
    const setMuted = vi.fn()
    const connect = vi.fn(() => Promise.resolve())
    const made: any = { connect, setMuted, onReceiving: vi.fn(), disconnect: vi.fn() }
    const factory = vi.fn(() => made)
    ;(window as any).PrismMumble = factory

    const t = new MumbleWebTransport()
    const ok = await t.connect({ ...baseCfg, ws_url: 'wss://proxy/ws' }, 'TRUCK-1')
    expect(ok).toBe(true)
    // Factory got the proxy URL + identity + Opus bitrate.
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      wsUrl: 'wss://proxy/ws', username: 'TRUCK-1', opusBitrate: 24000,
    }))
    expect(connect).toHaveBeenCalled()
    // Default resting state is MUTED.
    expect(setMuted).toHaveBeenLastCalledWith(true)
    // Tap-to-talk opens the mic; muting closes it.
    await t.startTransmit()
    expect(setMuted).toHaveBeenLastCalledWith(false)
    t.setMuted(true)
    expect(setMuted).toHaveBeenLastCalledWith(true)
  })

  it('never throws if the session blows up (audio stays optional)', async () => {
    ;(window as any).PrismMumble = () => { throw new Error('boom') }
    const t = new MumbleWebTransport()
    const ok = await t.connect({ ...baseCfg, ws_url: 'wss://proxy/ws' }, 'TRUCK-1')
    expect(ok).toBe(false)
    // setMuted on a dead session must be a silent no-op.
    expect(() => t.setMuted(false)).not.toThrow()
  })
})

