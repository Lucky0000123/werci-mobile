/**
 * Live location sharing — always on.
 *
 * Streams the device's GPS position to the PRISM backend so the web "Live Map"
 * can show where personnel are right now. Positions are ephemeral on the server
 * (Redis TTL, never written to SQL).
 *
 * Sharing starts automatically once the user is logged in (company safety
 * policy — there is no opt-out toggle). Two reliability mechanisms keep the
 * marker alive with the screen off:
 *   1. The native background watcher (@capacitor-community/background-geolocation)
 *      runs a foreground service, so fixes keep arriving while backgrounded.
 *      distanceFilter is 0 so a stationary phone still gets periodic fixes.
 *   2. A heartbeat re-posts the last known fix every 45 s regardless of
 *      movement — without it a parked phone stops emitting watcher callbacks
 *      and silently ages out of the server's 180 s TTL.
 *
 * The location POST response carries active emergency zones containing this
 * position; those are handed to emergencyAlert for alarm + notification.
 */
import { Geolocation, type Position } from '@capacitor/geolocation'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { apiFetch } from './api'
import { handleEmergencyAlerts, ensureAlertPermissions, type EmergencyZoneAlert } from './emergencyAlert'

// ── Custom native helpers (PrismPermissionsPlugin) ───────────────────────────
// Background ("Allow all the time") location can only be granted from the app
// settings screen on Android 11+, and Samsung's battery optimizer kills
// long-running tracking unless the app is exempted. These native methods let
// the app detect both gaps and walk the user through fixing them.
export interface LocationStatus {
  backgroundLocation: 'granted' | 'denied' | 'prompt' | string
  batteryExempt: boolean
}
interface PrismPermissionsPlugin {
  checkLocationStatus(): Promise<LocationStatus>
  requestBackgroundLocation(): Promise<{ backgroundLocation: string }>
  requestIgnoreBatteryOptimizations(): Promise<{ batteryExempt: boolean; requested?: boolean }>
  openAppSettings(): Promise<void>
}
const PrismPermissions = registerPlugin<PrismPermissionsPlugin>('PrismPermissions')

export async function getLocationStatus(): Promise<LocationStatus | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    return await PrismPermissions.checkLocationStatus()
  } catch {
    return null
  }
}

/** Opens the Android page where the user can pick "Allow all the time". */
export async function requestAlwaysOnLocation(): Promise<void> {
  try {
    await PrismPermissions.requestBackgroundLocation()
  } catch {
    try {
      await PrismPermissions.openAppSettings()
    } catch {
      /* not native */
    }
  }
}

/** System dialog asking to exempt PRISM from battery optimization. */
export async function requestBatteryExemption(): Promise<void> {
  try {
    await PrismPermissions.requestIgnoreBatteryOptimizations()
  } catch {
    /* not native */
  }
}

// Throttle network posts: at most one every MIN_POST_INTERVAL_MS, even if the
// OS emits positions more often. Saves battery + bandwidth.
const MIN_POST_INTERVAL_MS = 12000
// Re-post the last fix if nothing has been sent for this long (stationary
// phone / screen off). Must be well under the server's 180 s TTL.
const HEARTBEAT_INTERVAL_MS = 45000

// ── Background geolocation (native) ──────────────────────────────────────────
// @capacitor-community/background-geolocation ships only native code + types,
// so we bind it via registerPlugin and a local interface. On web / when the
// plugin isn't present, addWatcher throws and we fall back to the foreground
// @capacitor/geolocation watcher below.
interface BgLocation {
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  bearing: number | null
  time: number | null
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string
      backgroundTitle?: string
      requestPermissions?: boolean
      stale?: boolean
      distanceFilter?: number
    },
    callback: (position?: BgLocation, error?: { code?: string; message?: string }) => void
  ): Promise<string>
  removeWatcher(options: { id: string }): Promise<void>
  openSettings(): Promise<void>
}
const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

let watchId: string | null = null       // foreground @capacitor/geolocation watch id
let bgWatcherId: string | null = null   // background watcher id
let heartbeatTimer: number | null = null
let lastPostAt = 0
let posting = false

interface NormalizedFix {
  lat: number
  lng: number
  accuracy?: number
  speed?: number | null
  heading?: number | null
  ts: number // epoch seconds
}

let lastFix: NormalizedFix | null = null

export function isSharing(): boolean {
  return Boolean(watchId || bgWatcherId)
}

function fromForeground(pos: Position): NormalizedFix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speed: pos.coords.speed,
    heading: pos.coords.heading,
    ts: Math.round((pos.timestamp || Date.now()) / 1000),
  }
}

function fromBackground(pos: BgLocation): NormalizedFix {
  return {
    lat: pos.latitude,
    lng: pos.longitude,
    accuracy: pos.accuracy,
    speed: pos.speed,
    heading: pos.bearing,
    ts: Math.round((pos.time || Date.now()) / 1000),
  }
}

async function postPosition(fix: NormalizedFix, opts: { force?: boolean } = {}): Promise<void> {
  lastFix = fix
  const now = Date.now()
  if (posting) return
  if (!opts.force && now - lastPostAt < MIN_POST_INTERVAL_MS) return
  posting = true
  try {
    const body = {
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      speed: fix.speed ?? undefined,
      heading: fix.heading ?? undefined,
      ts: fix.ts,
    }
    const res = await apiFetch('/api/mobile/location', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (res.ok) {
      lastPostAt = now
      // Emergency zones containing this fix ride back on the response.
      // Always forward (even an empty list) so keep-out exit transitions
      // re-arm the alarm for the next entry.
      const data = (await res.json().catch(() => null)) as { alerts?: EmergencyZoneAlert[] } | null
      void handleEmergencyAlerts(data?.alerts ?? [])
    } else {
      console.warn('[locationShare] post failed:', res.status)
    }
  } catch (e) {
    console.warn('[locationShare] post error:', e)
  } finally {
    posting = false
  }
}

// Heartbeat: if the watcher has gone quiet (no movement → no callbacks), the
// last fix is re-sent so the server TTL never lapses while the app is alive.
function startHeartbeat(): void {
  if (heartbeatTimer != null) return
  heartbeatTimer = window.setInterval(() => {
    if (!lastFix) return
    if (Date.now() - lastPostAt >= HEARTBEAT_INTERVAL_MS - 1000) {
      void postPosition({ ...lastFix, ts: Math.round(Date.now() / 1000) }, { force: true })
    }
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer != null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

// Try the native background watcher (keeps reporting with the screen off and
// shows a persistent "sharing" notification). Returns true if it started.
async function startBackgroundWatcher(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    bgWatcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Sharing your location with site safety',
        backgroundTitle: 'PRISM · Safety Location',
        requestPermissions: true,
        // stale:true delivers the last known fix immediately on start, so the
        // map shows the person within seconds instead of after the first new fix.
        stale: true,
        // 0 = report every fix the OS produces (time-based, even while
        // stationary). The 12 s post throttle keeps network usage flat.
        distanceFilter: 0,
      },
      (position, error) => {
        if (error) {
          // NOT_AUTHORIZED → the user can be sent to settings; log others.
          console.warn('[locationShare] bg watch error:', error.code, error.message)
          return
        }
        if (position) void postPosition(fromBackground(position))
      }
    )
    console.log('[locationShare] background watcher started')
    return true
  } catch (e) {
    console.warn('[locationShare] background watcher unavailable, using foreground:', e)
    bgWatcherId = null
    return false
  }
}

// Foreground fallback (only runs while the app is open).
async function startForegroundWatcher(): Promise<boolean> {
  const perm = await Geolocation.checkPermissions()
  if (perm.location !== 'granted') {
    const req = await Geolocation.requestPermissions()
    if (req.location !== 'granted') {
      console.warn('[locationShare] location permission denied')
      return false
    }
  }
  watchId = await Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 15000 },
    (pos, err) => {
      if (err) {
        console.warn('[locationShare] watch error:', err)
        return
      }
      if (pos) void postPosition(fromForeground(pos))
    }
  )
  return true
}

/**
 * Start streaming location. Idempotent — safe to call repeatedly.
 * Prefers the native background watcher; falls back to the foreground watcher
 * on web or when the background plugin isn't available.
 * Resolves false if permission was denied.
 */
export async function startSharing(): Promise<boolean> {
  if (watchId || bgWatcherId) return true
  try {
    // Notification permission up front — emergency alerts depend on it.
    void ensureAlertPermissions()
    const startedBg = await startBackgroundWatcher()
    if (!startedBg) {
      const startedFg = await startForegroundWatcher()
      if (!startedFg) return false
    }
    startHeartbeat()
    installResumeHook()
    console.log('[locationShare] sharing started')
    return true
  } catch (e) {
    console.warn('[locationShare] could not start:', e)
    return false
  }
}

/**
 * Backstop used by background-fetch and the resume hook: pushes the last
 * known fix immediately (bypassing the throttle) so the server marker is
 * refreshed even when the watcher has been quiet.
 */
export async function postLastFixNow(): Promise<void> {
  if (!lastFix) return
  await postPosition({ ...lastFix, ts: Math.round(Date.now() / 1000) }, { force: true })
}

// When the app returns to the foreground, the OS may have killed the watcher
// or throttled our timers while it slept — re-assert everything and push a
// fresh fix straight away so the map marker recovers within seconds.
let resumeHookInstalled = false
function installResumeHook(): void {
  if (resumeHookInstalled) return
  resumeHookInstalled = true
  void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return
    void postLastFixNow()
    if (!watchId && !bgWatcherId) {
      console.log('[locationShare] watcher missing after resume — restarting')
      void startSharing()
    }
  })
}

/** Stop streaming location (logout — there is no in-app opt-out). */
export async function stopSharing(): Promise<void> {
  stopHeartbeat()
  if (bgWatcherId) {
    try {
      await BackgroundGeolocation.removeWatcher({ id: bgWatcherId })
    } catch {
      /* noop */
    }
    bgWatcherId = null
  }
  if (watchId) {
    try {
      await Geolocation.clearWatch({ id: watchId })
    } catch {
      /* noop */
    }
    watchId = null
  }
  console.log('[locationShare] sharing stopped')
}
