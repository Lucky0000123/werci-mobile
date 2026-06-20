// Unified Background Sync Service for PRISM Mobile
// Handles inspections, photos, and deviations with retry logic + background execution

import { BackgroundFetch } from '@transistorsoft/capacitor-background-fetch'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { syncService } from './sync'
import { DeviationStorage } from './deviationStorage'
import { CommissioningStorage } from './commissioningStorage'
import { submitCommissioning, type CommissioningSubmitPayload } from './commissioningApi'
import { apiFetch } from './api'
import { DispatchOutbox, MAX_DISPATCH_ATTEMPTS, type PendingDispatchAction } from './dispatchOutbox'
import connectionManager from './connectionManager'

let isBackgroundFetchConfigured = false

/**
 * Initialize background fetch for periodic sync.
 * Call once at app startup (e.g., in App.tsx useEffect).
 */
export async function initBackgroundSync(): Promise<void> {
  if (isBackgroundFetchConfigured) return

  // BackgroundFetch is a native-only plugin. On web (incl. the test runner and
  // the admin browser preview) it throws UNIMPLEMENTED, which surfaced as an
  // unhandled rejection. Skip the native config there and just wire the
  // foreground/online flush listeners below.
  const isNative = Capacitor.isNativePlatform()

  if (isNative) {
    try {
      const status = await BackgroundFetch.configure(
        {
          minimumFetchInterval: 15, // OS minimum ~15 min
          stopOnTerminate: false,
          startOnBoot: true,
          enableHeadless: true,
          requiredNetworkType: 0 // Any network (0 = none required, 1 = any, 2 = unmetered)
        },
        async (taskId: string) => {
          console.log('[BackgroundFetch] EVENT:', taskId)
          await flushAllPending()
          await BackgroundFetch.finish(taskId)
        },
        async (taskId: string) => {
          console.log('[BackgroundFetch] TIMEOUT:', taskId)
          await BackgroundFetch.finish(taskId)
        }
      )

      isBackgroundFetchConfigured = true
      console.log('[BackgroundSync] BackgroundFetch configured, status:', status)

      if (status !== BackgroundFetch.STATUS_AVAILABLE) {
        console.warn('[BackgroundSync] BackgroundFetch not available, status:', status)
      }
    } catch (error) {
      console.error('[BackgroundSync] Failed to configure BackgroundFetch:', error)
    }
  }

  // Also flush when app returns to foreground
  CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      console.log('[BackgroundSync] App active — flushing pending items')
      await flushAllPending()
    }
  })

  // Flush when network comes back
  window.addEventListener('online', () => {
    console.log('[BackgroundSync] Network online — flushing pending items')
    flushAllPending()
  })
}

/**
 * Flush all pending items: inspections, photos, deviations.
 * Called by background-fetch, foreground events, and network comeback.
 */
export async function flushAllPending(): Promise<void> {
  const status = connectionManager.getStatus()
  if (!status.isOnline) {
    console.log('[BackgroundSync] Offline — skipping flush')
    return
  }

  // Backstop for the live safety map: re-post the last GPS fix on every
  // background-fetch tick / foreground return, in case the watcher went quiet.
  import('./locationShare')
    .then(m => m.postLastFixNow())
    .catch(() => { /* location share not started */ })

  try {
    // 0. Pull fresh people data into the offline cache if it's gone stale.
    //    Runs on every background-fetch tick (~15 min, even headless), every
    //    foreground return, and every reconnect — so the user never has to
    //    manually refresh. The ~1 h freshness gate keeps real fetches to once
    //    per hour; in between this is a cheap local no-op. A cold (empty) cache
    //    forces a one-shot initial sync here so it self-heals on reconnect.
    await refreshPeopleDataIfStale()

    // 1. Sync existing inspection/photo queue
    await syncService.startSync()

    // 2. Sync pending deviations
    await syncPendingDeviations()

    // 3. Sync pending commissioning submissions
    await syncPendingCommissioning()

    // 4. Replay queued in-cab dispatch actions (status / cycle / connect) that
    //    were captured while the truck had no signal. Per-truck FIFO + server
    //    idempotency, so replays never double-advance the haul cycle.
    await syncPendingDispatch()

    // 5. Notify user if anything was synced
    const pendingCount = await getTotalPendingCount()
    if (pendingCount === 0) {
      await showSyncNotification('Sync complete', 'All data is up to date.')
    }
  } catch (error) {
    console.error('[BackgroundSync] Flush failed:', error)
  }
}

/**
 * Opportunistically refresh the cached people dataset so workers always scan
 * against recent data without ever tapping "sync". Safe to call on every
 * background tick / foreground return / reconnect because it's gated three ways:
 *   - only when signed in (a token exists),
 *   - cold devices (no cache yet) run a one-shot forced initial sync HERE too,
 *     so a freshly-provisioned cab that never hit the foreground sign-in path
 *     still self-heals on the first reconnect / foreground return,
 *   - syncOfflineData's own freshness gate (~1 h) makes the warm path a no-op
 *     when fresh, and the chunked download keeps RAM flat even on the cold path.
 */
async function refreshPeopleDataIfStale(): Promise<void> {
  try {
    const { authService } = await import('./auth')
    const token = await authService.getToken()
    if (!token) return // not signed in — nothing to refresh

    const { offlineDataSync } = await import('./offlineDataSync')
    const status = await offlineDataSync.getSyncStatus()
    if (!status.hasData) {
      // Cold device: run the first full (chunked) sync right here instead of
      // bailing. This is the sync-on-reconnect / sync-on-foreground path for a
      // cab that booted with a session token but never completed an initial
      // sync — the exact cause of the in-cab "no sync data" dead-end.
      // force=true still routes to performInitialChunkedSync (no cursor yet),
      // so memory stays ~20 MB; syncInProgress guards against overlap.
      const cold = await offlineDataSync.syncOfflineData(true)
      if (cold.success) console.log('[BackgroundSync] cold initial sync complete:', cold.message)
      else console.warn('[BackgroundSync] cold initial sync failed:', cold.message)
      return
    }

    const result = await offlineDataSync.syncOfflineData(false)
    if (result.success && !result.cached) {
      console.log('[BackgroundSync] People data auto-refreshed:', result.message)
    }
  } catch (e) {
    console.warn('[BackgroundSync] People refresh skipped:', e)
  }
}

/**
 * Build a FormData payload for deviation submit that matches the shape
 * used by DeviationApiService.submitDeviation() (deviationApi.ts).
 */
function buildDeviationFormData(deviation: any): FormData {
  const formData = new FormData()

  const appendIfPresent = (field: string, value: unknown) => {
    if (value != null && value !== '') {
      formData.append(field, String(value))
    }
  }

  appendIfPresent('kimper_id', deviation.kimper_id)
  appendIfPresent('person_key', deviation.person_key)
  appendIfPresent('employee_id', deviation.employee_id)
  appendIfPresent('ktp_number', deviation.ktp_number)
  appendIfPresent('person_involved_name', deviation.person_involved_name)
  appendIfPresent('person_involved_id', deviation.person_involved_id)
  appendIfPresent('deviation_date', deviation.deviation_date)
  appendIfPresent('shift', deviation.shift)
  appendIfPresent('location', deviation.location)
  appendIfPresent('activity', deviation.activity)
  appendIfPresent('deviation_description', deviation.deviation_description)
  appendIfPresent('golden_rules_number', deviation.golden_rules_number)
  appendIfPresent('immediate_action', deviation.immediate_action)
  appendIfPresent('status', deviation.status)
  appendIfPresent('reported_by', deviation.reported_by)
  appendIfPresent('reporter_department', deviation.reporter_department)
  appendIfPresent('contractor_name', deviation.contractor_name)
  appendIfPresent('pic_name', deviation.pic_name)
  appendIfPresent('language', deviation.language)

  // Append photos using the same field name as live submit
  if (deviation._photos && deviation._photos.length > 0) {
    deviation._photos.forEach((blob: Blob, idx: number) => {
      formData.append('photos', blob, `deviation_photo_${idx}.jpg`)
    })
  }

  return formData
}

/**
 * Sync pending deviations from DeviationDB.
 */
async function syncPendingDeviations(): Promise<void> {
  const pending = await DeviationStorage.getPending()
  if (pending.length === 0) return

  console.log(`[BackgroundSync] Syncing ${pending.length} pending deviations...`)

  // Resolve auth token once for the batch
  const { authService } = await import('./auth')
  const token = await authService.getToken()
  if (!token) {
    console.warn('[BackgroundSync] No auth token — skipping deviation sync')
    return
  }

  for (const deviation of pending) {
    try {
      const formData = buildDeviationFormData(deviation)

      const response = await apiFetch('/deviations/submit', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
      }, { token })

      if (response.ok) {
        await DeviationStorage.removePending(deviation._localId)
        console.log(`[BackgroundSync] Deviation ${deviation._localId} synced`)
      } else {
        console.warn(`[BackgroundSync] Deviation ${deviation._localId} sync failed: ${response.status}`)
      }
    } catch (error) {
      console.error(`[BackgroundSync] Deviation ${deviation._localId} sync error:`, error)
    }
  }
}

/**
 * Sync pending commissioning submissions from CommissioningDB.
 */
async function syncPendingCommissioning(): Promise<void> {
  const pending = await CommissioningStorage.getPending()
  if (pending.length === 0) return

  console.log(`[BackgroundSync] Syncing ${pending.length} pending commissioning submissions...`)

  for (const entry of pending) {
    try {
      const result = await submitCommissioning(entry.payload, entry.photos)
      await CommissioningStorage.saveSynced({
        id: result.inspection_id,
        vehicleId: result.vehicle_id,
        equipNo: entry.equipNo,
        equipmentLabel: entry.equipmentLabel,
        formSlug: entry.payload.form_slug,
        overallResult: result.overall_result,
        expiryDateSet: result.expiry_date_set,
        inspectionDate: entry.payload.inspection_date || new Date().toISOString(),
        photoCount: result.photo_count,
        syncedAt: Date.now()
      })
      await CommissioningStorage.removePending(entry._localId)
      console.log(`[BackgroundSync] Commissioning ${entry._localId} synced -> ${result.inspection_id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await CommissioningStorage.recordAttempt(entry._localId, message)
      console.warn(`[BackgroundSync] Commissioning ${entry._localId} sync failed:`, message)
    }
  }
}

/**
 * Result of an attempt to submit a single dispatch action.
 */
export type DispatchSubmitResult =
  | { ok: true; applied: true; data: any }       // server applied it now
  | { ok: true; applied: false; queued: true }   // offline / failed → enqueued for replay
  | { ok: false; rejected: true; data: any }      // business reject (e.g. not authorized) — surfaced to UI

/**
 * Submit one in-cab dispatch action with offline durability.
 *
 * Tries the network immediately when online; on success returns applied:true.
 * On a hard business rejection (403/422 that isn't a transient/stale case) it
 * returns rejected:true so the UI can show the reason. On offline / network
 * failure / 5xx it ENQUEUES the action (with a minted client_event_id +
 * client_ts) and returns queued:true so the caller applies optimistic local
 * state. The queued action is replayed in per-truck FIFO order by
 * syncPendingDispatch() on the next reconnect / foreground / background tick.
 */
export async function submitDispatchAction(args: {
  kind: PendingDispatchAction['kind']
  endpoint: string
  scopeKey: string
  payload: Record<string, unknown>
  expectedState?: string
}): Promise<DispatchSubmitResult> {
  const clientEventId = (await import('./dispatchOutbox')).newClientEventId()
  const clientTs = Date.now()
  const body = { ...args.payload, client_event_id: clientEventId, client_ts: clientTs }

  if (connectionManager.getStatus().isOnline) {
    try {
      const r = await apiFetch(args.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      let data: any = null
      try { data = await r.json() } catch { /* non-JSON */ }
      if (r.ok && (data?.success ?? true)) {
        return { ok: true, applied: true, data }
      }
      // A 409 'stale' means the server already advanced past this action — it's
      // reconciled, not an error. Treat as applied (nothing more to do).
      if (r.status === 409 && data?.stale) {
        return { ok: true, applied: true, data }
      }
      // Hard business rejections we should SHOW (not retry): not authorized,
      // another truck loading, validation. These are deterministic — queuing
      // would just replay the same rejection.
      if (r.status === 403 || r.status === 400 || r.status === 422 ||
          (r.status === 409 && data && data.stale !== true)) {
        return { ok: false, rejected: true, data }
      }
      // 5xx / unknown → fall through to enqueue for retry.
    } catch {
      // Network dropped mid-send → enqueue.
    }
  }

  await DispatchOutbox.enqueue({
    kind: args.kind,
    endpoint: args.endpoint,
    scopeKey: args.scopeKey,
    payload: body,
    clientEventId,
    clientTs,
    expectedState: args.expectedState,
  })
  return { ok: true, applied: false, queued: true }
}

/**
 * Replay queued dispatch actions when back online. Per-SCOPE FIFO: actions for
 * one truck replay in clientSeq order and the scope STOPS on the first failure
 * (so a later advance never lands before an earlier one). Other scopes drain
 * independently. Server idempotency (client_event_id) makes replays safe; the
 * forward-only 409 {stale} is treated as reconciled (dequeue).
 *
 * Exported so it can be triggered/tested in isolation; flushAllPending() calls
 * it as part of the normal flush.
 */
export async function syncPendingDispatch(): Promise<void> {
  if (!connectionManager.getStatus().isOnline) return
  let pending: PendingDispatchAction[]
  try {
    pending = await DispatchOutbox.getPending()
  } catch (e) {
    console.warn('[BackgroundSync] dispatch outbox unavailable:', e)
    return
  }
  if (pending.length === 0) return

  const { authService } = await import('./auth')
  const token = await authService.getToken().catch(() => null)
  if (!token) {
    console.warn('[BackgroundSync] no token — pausing dispatch replay')
    return
  }

  // Group by scope, preserving the global sort (already scope→seq→localId).
  const byScope = new Map<string, PendingDispatchAction[]>()
  for (const a of pending) {
    const arr = byScope.get(a.scopeKey) || []
    arr.push(a)
    byScope.set(a.scopeKey, arr)
  }

  console.log(`[BackgroundSync] replaying ${pending.length} dispatch action(s) across ${byScope.size} scope(s)`)

  // Scopes are independent → replay them in parallel; within a scope, strict FIFO.
  await Promise.all(Array.from(byScope.values()).map(async (actions) => {
    for (const action of actions) {
      try {
        const r = await apiFetch(action.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action.payload),
        }, { token })
        let data: any = null
        try { data = await r.json() } catch { /* non-JSON */ }

        if (r.ok && (data?.success ?? true)) {
          await DispatchOutbox.removePending(action._localId)        // applied (or deduped)
          continue
        }
        if (r.status === 409 && data?.stale) {
          // Server already moved past this state (GPS / web). Obsolete, not an error.
          await DispatchOutbox.removePending(action._localId)
          console.log(`[BackgroundSync] dispatch ${action.kind} reconciled (stale) scope=${action.scopeKey}`)
          continue
        }
        if (r.status === 403 || r.status === 400 || r.status === 422 ||
            (r.status === 409 && data && data.stale !== true)) {
          // Deterministic rejection — drop it (replaying won't help) and move on
          // within this scope (it's terminal for this action, not the scope).
          await DispatchOutbox.removePending(action._localId)
          console.warn(`[BackgroundSync] dispatch ${action.kind} rejected (${r.status}), dropped:`, data?.message)
          continue
        }
        // 5xx / transient → record attempt; STOP this scope to preserve FIFO.
        const attempts = await DispatchOutbox.recordAttempt(action._localId, `HTTP ${r.status}`)
        if (attempts >= MAX_DISPATCH_ATTEMPTS) {
          await DispatchOutbox.removePending(action._localId)
          console.warn(`[BackgroundSync] dispatch ${action.kind} gave up after ${attempts} attempts`)
          continue
        }
        break
      } catch (e) {
        // Network dropped again → stop this scope, leave the rest pending.
        const msg = e instanceof Error ? e.message : String(e)
        const attempts = await DispatchOutbox.recordAttempt(action._localId, msg)
        if (attempts >= MAX_DISPATCH_ATTEMPTS) {
          await DispatchOutbox.removePending(action._localId)
        }
        break
      }
    }
  }))
}

/**
 * Get total count of pending items across all queues.
 */
export async function getTotalPendingCount(): Promise<number> {
  const [syncStatus, deviationCount, commissioningCount, dispatchCount] = await Promise.all([
    syncService.getStatus().catch(() => ({ pendingItems: 0 })),
    DeviationStorage.getPendingCount().catch(() => 0),
    CommissioningStorage.getPendingCount().catch(() => 0),
    DispatchOutbox.getPendingCount().catch(() => 0)
  ])
  return syncStatus.pendingItems + deviationCount + commissioningCount + dispatchCount
}

/**
 * Show a local notification (silent if permission not granted).
 */
async function showSyncNotification(title: string, body: string): Promise<void> {
  try {
    const { display } = await LocalNotifications.requestPermissions()
    if (display !== 'granted') return

    await LocalNotifications.schedule({
      notifications: [{
        id: Date.now(),
        title,
        body,
        schedule: { at: new Date(Date.now() + 1000) },
        sound: undefined,
        smallIcon: 'ic_notification',
        iconColor: '#FC4100'
      }]
    })
  } catch (e) {
    console.warn('[BackgroundSync] Notification error:', e)
  }
}

/**
 * Enqueue an inspection for sync (used by InspectionForm instead of direct online submit).
 * If online, tries immediate upload; on failure, queues for retry.
 */
export async function submitInspectionWithRetry(inspectionData: object): Promise<{ success: boolean; id?: string; queued?: boolean }> {
  try {
    const status = connectionManager.getStatus()
    if (status.isOnline) {
      const response = await apiFetch('/api/mobile/inspections', {
        method: 'POST',
        body: JSON.stringify(inspectionData)
      })
      if (response.ok) {
        const result = await response.json()
        return { success: true, id: result.id }
      }
    }
  } catch (e) {
    console.warn('[BackgroundSync] Immediate inspection submit failed, queuing:', e)
  }

  // Fallback: queue via existing syncService mechanism
  // The caller (InspectionForm) already handles local DB + syncQueue enqueue
  return { success: false, queued: true }
}

/**
 * Enqueue a deviation for sync (used by DeviationForm).
 * If online, tries immediate upload; on failure, saves to pendingDeviations.
 */
export async function submitDeviationWithRetry(deviation: any, photos: Blob[]): Promise<{ success: boolean; queued?: boolean }> {
  try {
    const status = connectionManager.getStatus()
    if (status.isOnline) {
      const { authService } = await import('./auth')
      const token = await authService.getToken()
      if (!token) throw new Error('LOGIN_REQUIRED')

      const formData = buildDeviationFormData({ ...deviation, _photos: photos })

      const response = await apiFetch('/deviations/submit', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
      }, { token })
      if (response.ok) {
        return { success: true }
      }
    }
  } catch (e) {
    console.warn('[BackgroundSync] Immediate deviation submit failed, saving offline:', e)
  }

  // Fallback: save to pending queue
  await DeviationStorage.savePending(deviation, photos)
  return { success: false, queued: true }
}

/**
 * Try to submit a commissioning inspection immediately. If offline or the
 * request fails, queue the submission to be replayed by the background
 * sync loop. Returns a descriminated result so the caller can show the
 * right toast (synced vs queued).
 */
export async function submitCommissioningWithRetry(
  payload: CommissioningSubmitPayload,
  photos: Blob[],
  meta: { equipNo: string; equipmentLabel: string }
): Promise<{ success: boolean; queued?: boolean; inspectionId?: number; expiryDateSet?: string | null }> {
  const status = connectionManager.getStatus()
  if (status.isOnline) {
    try {
      const result = await submitCommissioning(payload, photos)
      await CommissioningStorage.saveSynced({
        id: result.inspection_id,
        vehicleId: result.vehicle_id,
        equipNo: meta.equipNo,
        equipmentLabel: meta.equipmentLabel,
        formSlug: payload.form_slug,
        overallResult: result.overall_result,
        expiryDateSet: result.expiry_date_set,
        inspectionDate: payload.inspection_date || new Date().toISOString(),
        photoCount: result.photo_count,
        syncedAt: Date.now()
      })
      return { success: true, inspectionId: result.inspection_id, expiryDateSet: result.expiry_date_set }
    } catch (e) {
      console.warn('[BackgroundSync] Immediate commissioning submit failed, queuing:', e)
    }
  }

  await CommissioningStorage.savePending(payload, photos, meta)
  return { success: false, queued: true }
}
