/**
 * Emergency zone alerts.
 *
 * The server piggybacks active emergency zones on the response of every
 * location fix (`POST /api/mobile/location` → `{ alerts: [...] }`). When a fix
 * lands inside a zone we:
 *   1. fire a local notification (works with the app backgrounded — the
 *      background-geolocation foreground service keeps the process alive),
 *   2. play an alarm siren + vibrate,
 *   3. raise an in-app full-screen alert (App.tsx subscribes via onAlert).
 *
 * Each zone alerts once per phone (deduped by zone id, persisted) so people
 * are not re-alarmed every 12 seconds while they remain inside the zone.
 */

export interface EmergencyZoneAlert {
  id: string
  zone_type?: 'alert' | 'keepout'
  lat: number
  lng: number
  radius_m: number
  message: string
  created_by?: string | null
  created_at?: number
}

const SEEN_KEY = 'prism_seen_emergency_zones_v1'
const SEEN_MAX = 50

type AlertListener = (alert: EmergencyZoneAlert) => void
const listeners = new Set<AlertListener>()

/** App.tsx subscribes here to show the full-screen in-app alert. */
export function onEmergencyAlert(listener: AlertListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The seen-set lives in Capacitor Preferences (native SharedPreferences) so
// the headless background-fetch task and the in-app handler dedupe each other
// — a zone that already alarmed while the app was closed won't re-alarm when
// the app opens, and vice versa. localStorage is kept as a sync fallback.
async function loadSeen(): Promise<string[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: SEEN_KEY })
    if (value) {
      const arr = JSON.parse(value) as string[]
      if (Array.isArray(arr)) return arr
    }
  } catch {
    /* fall through to localStorage */
  }
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const arr = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function saveSeen(ids: string[]): Promise<void> {
  const payload = JSON.stringify(ids.slice(-SEEN_MAX))
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key: SEEN_KEY, value: payload })
  } catch {
    /* native storage unavailable */
  }
  try {
    localStorage.setItem(SEEN_KEY, payload)
  } catch {
    /* noop */
  }
}

/** Ask for notification permission (Android 13+ runtime prompt). */
export async function ensureAlertPermissions(): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.requestPermissions()
  } catch {
    // web / plugin unavailable — in-app overlay + sound still work
  }
}

async function notify(alert: EmergencyZoneAlert): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.schedule({
      notifications: [
        {
          // 32-bit int id required on Android
          id: Math.floor(Date.now() % 2147483647),
          title: '🚨 EMERGENCY ALERT',
          body: alert.message,
          extra: { type: 'emergency_zone', zoneId: alert.id },
        },
      ],
    })
  } catch (e) {
    console.warn('[emergencyAlert] notification failed:', e)
  }
}

// ── Alarm sound (Web Audio two-tone siren, no audio asset needed) ────────────
let sirenCtx: AudioContext | null = null
let sirenStop: (() => void) | null = null

export function stopAlarm(): void {
  try {
    sirenStop?.()
  } catch {
    /* noop */
  }
  sirenStop = null
  try {
    navigator.vibrate?.(0)
  } catch {
    /* noop */
  }
}

function playAlarm(durationMs = 15000): void {
  stopAlarm()
  try {
    navigator.vibrate?.([600, 200, 600, 200, 600, 200, 600])
  } catch {
    /* noop */
  }
  try {
    type AudioCtxCtor = typeof AudioContext
    const Ctor: AudioCtxCtor | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext
    if (!Ctor) return
    sirenCtx = sirenCtx || new Ctor()
    const ctx = sirenCtx
    void ctx.resume?.()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    gain.gain.value = 0.18
    osc.connect(gain)
    gain.connect(ctx.destination)

    // Alternate 880/620 Hz every 350 ms — classic two-tone siren.
    let high = true
    osc.frequency.value = 880
    const toneTimer = window.setInterval(() => {
      high = !high
      osc.frequency.value = high ? 880 : 620
    }, 350)

    osc.start()
    const stopTimer = window.setTimeout(() => stopAlarm(), durationMs)
    sirenStop = () => {
      window.clearInterval(toneTimer)
      window.clearTimeout(stopTimer)
      try {
        osc.stop()
        osc.disconnect()
        gain.disconnect()
      } catch {
        /* noop */
      }
    }
  } catch (e) {
    console.warn('[emergencyAlert] alarm sound failed:', e)
  }
}

// Keep-out zones re-arm on exit: this tracks which keep-out zones the phone
// is currently inside (in-memory — keep-out is about *physical presence*, so
// re-entering after an app restart should alarm again anyway).
const insideKeepout = new Set<string>()

function raise(alert: EmergencyZoneAlert): void {
  console.warn('[emergencyAlert] EMERGENCY ZONE ALERT:', alert.zone_type, alert.message)
  void notify(alert)
  listeners.forEach(l => {
    try {
      l(alert)
    } catch {
      /* listener errors must not break the loop */
    }
  })
}

/**
 * Entry point — called by locationShare with the `alerts` array from EVERY
 * location POST response (including empty ones, so keep-out exit transitions
 * are observed).
 *
 * - 'alert' zones ring once per zone id (persisted dedupe).
 * - 'keepout' zones ring on every ENTRY (re-armed when the phone leaves).
 */
export async function handleEmergencyAlerts(alerts: EmergencyZoneAlert[] | undefined | null): Promise<void> {
  const list = (alerts || []).filter(a => a && a.id)
  const keepouts = list.filter(a => a.zone_type === 'keepout')
  const normals = list.filter(a => a.zone_type !== 'keepout')

  // Keep-out transitions: entered = in this response but not the last one.
  const nowInside = new Set(keepouts.map(a => a.id))
  const entered = keepouts.filter(a => !insideKeepout.has(a.id))
  insideKeepout.forEach(id => { if (!nowInside.has(id)) insideKeepout.delete(id) })
  nowInside.forEach(id => insideKeepout.add(id))

  // Normal alerts: once per zone id, shared with the headless native task.
  let fresh: EmergencyZoneAlert[] = []
  if (normals.length) {
    const seen = await loadSeen()
    fresh = normals.filter(a => !seen.includes(a.id))
    if (fresh.length) await saveSeen([...seen, ...fresh.map(a => a.id)])
  }

  const toRaise = [...entered, ...fresh]
  if (!toRaise.length) return
  toRaise.forEach(raise)
  playAlarm()
}

/** Muster roll-call response: I'M SAFE or NEED HELP. */
export async function ackEmergencyZone(zoneId: string, status: 'safe' | 'help'): Promise<boolean> {
  try {
    const { apiFetch } = await import('./api')
    const res = await apiFetch(`/api/mobile/emergency-zones/${zoneId}/ack`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    })
    return res.ok
  } catch (e) {
    console.warn('[emergencyAlert] ack failed:', e)
    return false
  }
}
