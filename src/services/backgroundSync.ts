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
    // 1. Sync existing inspection/photo queue
    await syncService.startSync()

    // 2. Sync pending deviations
    await syncPendingDeviations()

    // 3. Sync pending commissioning submissions
    await syncPendingCommissioning()

    // 4. Notify user if anything was synced
    const pendingCount = await getTotalPendingCount()
    if (pendingCount === 0) {
      await showSyncNotification('Sync complete', 'All data is up to date.')
    }
  } catch (error) {
    console.error('[BackgroundSync] Flush failed:', error)
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
 * Get total count of pending items across all queues.
 */
export async function getTotalPendingCount(): Promise<number> {
  const [syncStatus, deviationCount, commissioningCount] = await Promise.all([
    syncService.getStatus().catch(() => ({ pendingItems: 0 })),
    DeviationStorage.getPendingCount().catch(() => 0),
    CommissioningStorage.getPendingCount().catch(() => 0)
  ])
  return syncStatus.pendingItems + deviationCount + commissioningCount
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
