// @vitest-environment node
//
// Offline GPS cycle engine: pure transition logic (advanceOffline + helpers).
// No DOM / network — these are verbatim ports of dispatch_service.py.

import { describe, expect, it } from 'vitest'
import { haversineM, zoneFor, advanceOffline, cycleRank, pickTruckPosition, shouldUseDeviceFix, type CycleGeo, type DeviceFix } from '../services/dispatchEngine'

// A loading site: excavator at (0,0), dump 1km north-ish. Rings 10/20/100, dump 50.
const GEO: CycleGeo = {
  excLat: 0, excLng: 0,
  dumpLat: 0.01, dumpLng: 0,   // ~1.11 km north of the excavator
  loadingZoneM: 10, waitingZoneM: 20, discoveryZoneM: 100, dumpZoneM: 50,
}
const CTX = { plan_id: 1, truck_no: 'DT01', excavator_no: 'EX9' }

// Build a fix at a given metres-north offset from the excavator (lat≈0).
function fixNorthMeters(m: number): DeviceFix {
  // 1 deg lat ≈ 111320 m
  return { lat: m / 111320, lng: 0, ts: Math.floor(Date.now() / 1000) }
}

describe('haversineM + zoneFor', () => {
  it('haversine is ~0 at the same point and ~111km per degree lat', () => {
    expect(haversineM(0, 0, 0, 0)).toBeCloseTo(0, 5)
    expect(haversineM(0, 0, 1, 0)).toBeGreaterThan(111000)
    expect(haversineM(0, 0, 1, 0)).toBeLessThan(111600)
  })
  it('zoneFor picks the innermost ring (inclusive edges)', () => {
    expect(zoneFor(5, 10, 20, 100)).toBe('loading')
    expect(zoneFor(10, 10, 20, 100)).toBe('loading')
    expect(zoneFor(15, 10, 20, 100)).toBe('waiting')
    expect(zoneFor(60, 10, 20, 100)).toBe('discovery')
    expect(zoneFor(101, 10, 20, 100)).toBe('outside')
    expect(zoneFor(null, 10, 20, 100)).toBe('unknown')
  })
  it('cycleRank orders the 12-state cycle', () => {
    expect(cycleRank('spot')).toBe(0)
    expect(cycleRank('loading')).toBe(2)
    expect(cycleRank('dumping')).toBe(8)
    expect(cycleRank('garbage')).toBe(-1)
  })
})

describe('advanceOffline — inbound arrival at the shovel', () => {
  it('emptyTravel2 within discovery ring → Reporting zone event (no state change)', () => {
    const res = advanceOffline('emptyTravel2', fixNorthMeters(60), GEO, CTX)
    expect(res.next).toBe('emptyTravel2')         // discovery does NOT advance state
    expect(res.events).toHaveLength(1)
    expect(res.events[0]).toMatchObject({ kind: 'zone_event', zone_type: 'discovery', event_type: 'enter' })
  })
  it('emptyTravel2 within waiting ring → state advances to waiting + zone event', () => {
    const res = advanceOffline('emptyTravel2', fixNorthMeters(15), GEO, CTX)
    expect(res.next).toBe('waiting')
    expect(res.events[0]).toMatchObject({ kind: 'zone_event', zone_type: 'waiting', event_type: 'enter' })
  })
  it('emptyTravel2 within loading ring → waiting (never claims spot — peer arbitration is the server)', () => {
    const res = advanceOffline('emptyTravel2', fixNorthMeters(5), GEO, CTX)
    expect(res.next).toBe('waiting')
    expect(res.events[0]).toMatchObject({ kind: 'zone_event', zone_type: 'loading', event_type: 'enter' })
  })
  it('emptyTravel2 far away → no transition', () => {
    const res = advanceOffline('emptyTravel2', fixNorthMeters(500), GEO, CTX)
    expect(res.next).toBe('emptyTravel2')
    expect(res.events).toHaveLength(0)
    expect(res.reason).toBe('noop')
  })
})

describe('advanceOffline — post-load dump leg (the server GPS scope)', () => {
  // Dump is at lat 0.01 (~1113 m north). dumpZoneM = 50.
  const atDump: DeviceFix = { lat: 0.01, lng: 0, ts: 1 }                 // 0 m from dump
  const nearDump: DeviceFix = { lat: 0.01 - 30 / 111320, lng: 0, ts: 1 } // ~30 m from dump
  const awayFromDump: DeviceFix = { lat: 0, lng: 0, ts: 1 }              // ~1113 m from dump

  it('fullTravel1 reaching the dump geofence → dumping', () => {
    const res = advanceOffline('fullTravel1', nearDump, GEO, CTX)
    expect(res.next).toBe('dumping')
    expect(res.events).toHaveLength(1)
    expect(res.events[0]).toMatchObject({ kind: 'cycle_advance', status: 'dumping' })
  })
  it('fullTravel1 still far from dump → no advance', () => {
    const res = advanceOffline('fullTravel1', awayFromDump, GEO, CTX)
    expect(res.next).toBe('fullTravel1')
    expect(res.events).toHaveLength(0)
  })
  it('dumping leaving the dump geofence → STAYS dumping (handshake: completing the dump is the manual Finish Dumping tap, not GPS exit)', () => {
    const res = advanceOffline('dumping', awayFromDump, GEO, CTX)
    expect(res.next).toBe('dumping')           // NO auto emptyTravel1
    expect(res.events).toHaveLength(0)         // the server board handles revert-on-exit
  })
  it('dumping still at the dump → stays dumping', () => {
    const res = advanceOffline('dumping', atDump, GEO, CTX)
    expect(res.next).toBe('dumping')
    expect(res.events).toHaveLength(0)
  })
})

describe('advanceOffline — manual-only legs and safety', () => {
  it('does NOT GPS-drive spot/loading or the weighbridge/sampling legs', () => {
    for (const s of ['spot', 'loading', 'fullWB', 'fullTravel2', 'sampling', 'fullTravel3', 'emptyWB'] as const) {
      const res = advanceOffline(s, fixNorthMeters(5), GEO, CTX)
      expect(res.next).toBe(s)         // unchanged — these need the manual button
      expect(res.events).toHaveLength(0)
    }
  })
  it('forward-only: never emits a lower-ranked state', () => {
    // Even if somehow at the shovel while "dumping", the clamp keeps it forward.
    const res = advanceOffline('dumping', fixNorthMeters(5), GEO, CTX)
    expect(cycleRank(res.next)).toBeGreaterThanOrEqual(cycleRank('dumping'))
  })
  it('no geo anchor → unknown distance → no transition', () => {
    const res = advanceOffline('emptyTravel2', fixNorthMeters(5), { loadingZoneM: 10, waitingZoneM: 20, discoveryZoneM: 100 }, CTX)
    expect(res.events).toHaveLength(0)
  })
})


// ════════════════════════════════════════════════════════════════════════════
//  LOCATION-SOURCE DECISION — the dispatch-simulator position leak guard.
//
//  Background: a SIMULATOR unit (DTSIM1/WSIM01) gets its position from the server
//  simulation feed. The in-cab APK must NEVER fall back to the tablet's own GPS
//  for a sim unit, and must NEVER drive the offline cycle engine from tablet GPS
//  for one. The classic regression is the PIT DEAD-ZONE: the cab loses signal
//  (online=false) and the truck silently snaps onto the tablet's hardware GPS.
//  These tests pin shouldUseDeviceFix + pickTruckPosition so that can't recur.
// ════════════════════════════════════════════════════════════════════════════

describe('shouldUseDeviceFix — sim never consumes tablet GPS', () => {
  it('real unit, offline, has device fix → uses device GPS (legacy behaviour kept)', () => {
    expect(shouldUseDeviceFix(false, false, true)).toBe(true)
  })
  it('real unit, online → server position (no device GPS)', () => {
    expect(shouldUseDeviceFix(false, true, true)).toBe(false)
  })
  it('real unit, offline, NO device fix → cannot use device GPS', () => {
    expect(shouldUseDeviceFix(false, false, false)).toBe(false)
  })
  it('SIM unit, online → never device GPS', () => {
    expect(shouldUseDeviceFix(true, true, true)).toBe(false)
  })
  it('SIM unit, OFFLINE, has device fix → STILL never device GPS (pit dead-zone)', () => {
    // THE bug: offline used to flip a sim unit onto the tablet GPS. It must not.
    expect(shouldUseDeviceFix(true, false, true)).toBe(false)
  })
})

describe('pickTruckPosition — source selection by sim flag', () => {
  const deviceFix = { lat: 1.111, lng: 2.222, heading: 90 }      // tablet hardware GPS
  const serverFix = { lat: -0.6157, lng: 127.9247, course: 45 }  // simulation/TMS feed
  const lastFix = { lat: -0.6000, lng: 127.9000, course: null }  // last server-known

  it('REAL unit offline with a device fix → tablet GPS', () => {
    const r = pickTruckPosition({ isSim: false, online: false, deviceFix, serverFix, lastFix })
    expect(r.source).toBe('tablet')
    expect(r.point).toEqual({ lat: deviceFix.lat, lng: deviceFix.lng, course: 90 })
  })

  it('REAL unit online → server (equipment) position', () => {
    const r = pickTruckPosition({ isSim: false, online: true, deviceFix, serverFix, lastFix })
    expect(r.source).toBe('equipment')
    expect(r.point).toEqual({ lat: serverFix.lat, lng: serverFix.lng, course: 45 })
  })

  // ── THE PIT DEAD-ZONE SCENARIO (Leak 1): online=false AND sim===true ─────────
  // This is the exact production failure being fixed. It is asserted standalone,
  // not implied by the online path: a SIM truck that loses signal must keep the
  // SERVER simulation position for BOTH the map marker AND advanceOffline(), and
  // must NOT consume the tablet's device GPS even though a fresh fix exists.
  it('SIM unit OFFLINE with a device fix present → uses SERVER sim position for the marker, NOT the tablet GPS', () => {
    const r = pickTruckPosition({ isSim: true, online: false, deviceFix, serverFix, lastFix })
    // marker comes from the simulation feed...
    expect(r.source).toBe('equipment')
    expect(r.point).toEqual({ lat: serverFix.lat, lng: serverFix.lng, course: 45 })
    // ...and is explicitly NOT the tablet GPS, even though deviceFix is available.
    expect(r.source).not.toBe('tablet')
    expect(r.point).not.toEqual({ lat: deviceFix.lat, lng: deviceFix.lng, course: 90 })
    // and the offline cycle engine is forbidden from consuming the device fix.
    expect(shouldUseDeviceFix(true, false, true)).toBe(false)
  })

  it('SIM unit OFFLINE with NO live server fix → falls back to last server-known (still never tablet GPS)', () => {
    const r = pickTruckPosition({ isSim: true, online: false, deviceFix, serverFix: null, lastFix })
    expect(r.source).toBe('last')
    expect(r.point).toEqual({ lat: lastFix.lat, lng: lastFix.lng, course: null })
    expect(r.source).not.toBe('tablet')
  })

  it('SIM unit OFFLINE with no server position at all → no position (never invents tablet GPS)', () => {
    const r = pickTruckPosition({ isSim: true, online: false, deviceFix, serverFix: null, lastFix: null })
    expect(r.point).toBeNull()
    expect(r.source).toBeNull()
  })

  it('REAL unit offline with NO device fix → server, then last fallback', () => {
    const r1 = pickTruckPosition({ isSim: false, online: false, deviceFix: null, serverFix, lastFix })
    expect(r1.source).toBe('equipment')
    const r2 = pickTruckPosition({ isSim: false, online: false, deviceFix: null, serverFix: null, lastFix })
    expect(r2.source).toBe('last')
  })
})
