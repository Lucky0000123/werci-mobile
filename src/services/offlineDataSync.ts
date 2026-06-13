// Offline Data Sync Service for PRISM Mobile
// Handles syncing ALL essential data: Vehicles, KIMPER, and Employees for complete offline QR support

import { apiFetch } from './api'
import { openDB, deleteDB } from 'idb'
import { directSQLServerService } from './directSqlServer'

const PRISM_DB_NAME = 'PRISMOfflineData'
const PRISM_DB_VERSION = 9

// Vehicle data is intentionally NOT synced to the mobile app — PRISM mobile is
// a personnel/workforce tool, and pulling the full fleet bloated every sync.
// Flip to true to restore vehicle caching. When false the pipeline still runs
// end to end; the vehicles store just stays empty.
const SYNC_VEHICLES = false

// Same recoverable-error classifier used in db.ts — see that file for rationale.
function isRecoverableIdbError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: string; message?: string }
  const name = e.name || ''
  const msg  = e.message || String(err)
  return (
    name === 'UnknownError' ||
    name === 'InvalidStateError' ||
    name === 'NotFoundError' ||
    /internal error/i.test(msg) ||
    /backing store/i.test(msg)
  )
}

// Yield to the browser so React can flush state updates and the UI can paint
// between sync stages. Without this, Promise-chained notifyListeners calls run
// in one microtask burst and the progress bar appears frozen until the end.
const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0))

// ============================================
// TYPE DEFINITIONS - Complete Offline Data
// ============================================

// Vehicle with complete commissioning details
interface VehicleFullInfo {
  id: number
  equip_no: string
  description?: string
  company?: string
  manufacturer?: string
  unit_model?: string
  commissioning_date?: string
  year?: number
  commissioning_status: string
  expired_date?: string
  picture?: string
  // Secure QR token (matches fleet_vehicle.qr_code_token). Lets token-format
  // stickers (/inspect/t/<token>) resolve fully offline.
  qr_code_token?: string
  // Additional fields for complete offline support
  vin?: string
  plate_number?: string
  engine_number?: string
  color?: string
  fuel_type?: string
  location?: string
  department?: string
  pic_name?: string
  pic_contact?: string
}

// Complete KIMPER data
interface KimperFullInfo {
  id: number
  name: string
  id_number?: string
  company?: string
  department?: string
  kimper_expired_date?: string
  status?: string
  // Additional fields
  position?: string
  phone?: string
  email?: string
  address?: string
  emergency_contact?: string
  blood_type?: string
  photo_url?: string
  authorized_vehicles?: string[]
  training_certifications?: string[]
  golden_rule_violations?: number
}

// Complete Employee data from EMPLOYEE_MASTER (authoritative source for QR scanning)
export interface EmployeeFullInfo {
  employee_id: string
  name: string
  company?: string
  department?: string
  section?: string
  position?: string
  position_level?: string
  status: string
  qr_code_token?: string
  photo_url?: string
  ktp_number?: string
  authorized_units?: string[]
  authorized_unit_codes?: string[]
  // Legacy fields kept for backward compatibility
  id?: number
  id_number?: string
  hire_date?: string
  phone?: string
  email?: string
  supervisor_name?: string
  work_location?: string
  shift?: string
}

export interface TrainingSummary {
  total: number
  valid: number
  expired: number
  not_yet: number
  mandatory_total: number
  mandatory_valid: number
  mandatory_expired?: number
  mandatory_not_yet?: number
  extras_completed?: number
  expiring: number
}

export interface TrainingItem {
  name: string
  status: string
  days_remaining?: number | null
  expiry_date?: string | null
  expiring_soon: boolean
  requirement: string
  badge_icon: string
}

export interface TrainingCategory {
  category: string
  color: string
  trainings: TrainingItem[]
  stats: {
    total: number
    on_time: number
    expired: number
    not_yet: number
  }
}

export interface EmployeeViolation {
  id: number
  date: string
  description: string
  location: string
  observer_name: string
  severity: string
  status: string
  golden_rules_violation?: string
  action_taken: string
}

export interface EmployeeKimperData {
  mcu_expire_date?: string
  kimper_expired_date?: string
  police_license_type?: string
  police_license_category?: string
  police_license_expired_date?: string
  status?: string
  kimper_name?: string
  kimper_id?: number
  authorized_units?: string[]
  authorized_unit_codes?: string[]
}

export interface PersonLookupParams {
  personKey?: string
  employeeId?: string
  kimperId?: number
  ktpNumber?: string
}

// Kimper sub-block returned inside a unified Person record by /api/mobile/people/all
export interface PersonKimperBlock {
  kimper_id?: number
  id_number?: string | null
  card_type_code?: string | null
  kimper_expired_date?: string | null
  police_license_type?: string | null
  police_license_category?: string | null
  police_license_expired_date?: string | null
  mcu_expire_date?: string | null
  hire_date?: string | null
  status?: string | null
  units?: string[]
  kimper_name?: string | null
}

// One unified record per person, keyed by person_id (KTP-xxx / EMP-xxx / KIM-xxx).
// Source of truth for all offline person data — photo lives here once, not
// duplicated across 3 legacy stores.
export interface Person {
  person_id: string
  ktp_number?: string | null
  name: string
  company?: string | null
  department?: string | null
  section?: string | null
  position?: string | null
  position_level?: string | null
  status?: string
  photo_url?: string | null   // data:image/jpeg;base64,... (200x200 thumbnail)
  photo_source?: string | null
  has_employee: boolean
  has_kimper: boolean
  employee_id?: string | null
  qr_code_token?: string | null
  kimper_status?: string | null
  kimper?: PersonKimperBlock | null
  training_summary?: TrainingSummary | null
  training_categories?: TrainingCategory[] | null
  // 6-mandatory rule (filled by backend; safe to be undefined for older cache)
  mandatory_trainings?: TrainingItem[] | null
  extra_trainings?: TrainingItem[] | null
  violations?: EmployeeViolation[]
}

// QR Code Types for lookup
export type QREntityType = 'vehicle' | 'kimper' | 'employee' | 'unknown'

export interface QRLookupResult {
  type: QREntityType
  data: VehicleFullInfo | KimperFullInfo | EmployeeFullInfo | null
  found: boolean
  source: 'offline' | 'api' | 'none'
}

// Complete offline data package
interface OfflineDataPackage {
  vehicles: VehicleFullInfo[]
  kimperCodes: KimperFullInfo[]
  employees: EmployeeFullInfo[]
  employeeCards: EmployeeCardData[]
  people: Person[]
  lastSyncTimestamp: number
  dataVersion: string
  totalRecords: number
  syncDetails: {
    vehiclesCount: number
    kimperCount: number
    employeesCount: number
    employeeCardsCount: number
    peopleCount: number
  }
}

// Database schema
interface OfflineDataDB {
  vehicles: {
    key: number // id (unique DB PK; equip_no is no longer unique across companies)
    value: VehicleFullInfo
  }
  kimperCodes: {
    key: string // name
    value: KimperFullInfo
  }
  employees: {
    key: string // employee_id
    value: EmployeeFullInfo
  }
  employeeCards: {
    key: string // employee.employee_id
    value: EmployeeCardData & { employee_id: string }
  }
  people: {
    key: string // person_id
    value: Person
  }
  recentInspections: {
    key: string
    value: unknown
  }
  syncMetadata: {
    key: string
    value: unknown
  }
  // Per-scan rich payload cache (person/employee cards + deviation lists) saved
  // the moment a record is opened online, so the same QR scanned offline shows
  // the real saved profile instead of zeros. Generic envelope keyed by a lookup
  // string (e.g. "card:emp:123", "dev:ktp:456").
  qrCache: {
    key: string
    value: QrCacheEnvelope
  }
}

// Envelope stored in the `qrCache` store. `data` is the full payload that was
// fetched online (PersonCardData / EmployeeCardData / DeviationListItem[]).
export interface QrCacheEnvelope {
  key: string
  data: unknown
  cachedAt: number
}

// ============================================================
// In-memory fallback store
// ============================================================
// On some enterprise browser profiles (aggressive SSO / password-manager
// extensions, corrupted Chromium profiles, AV hooks) IndexedDB is permanently
// unusable — every openDB() throws UnknownError even against a freshly-wiped
// database. Rather than hard-failing the app, we fall back to an in-process
// cache so the user can still complete the sync, browse data, and work for
// the current session. Data is lost on refresh; we surface that in the UI.
interface MemoryStores {
  vehicles: Map<string, VehicleFullInfo>
  kimperCodes: Map<string, KimperFullInfo>
  employees: Map<string, EmployeeFullInfo>
  employeeCards: Map<string, EmployeeCardData & { employee_id: string }>
  people: Map<string, Person>
  syncMetadata: Map<string, unknown>
  qrCache: Map<string, QrCacheEnvelope>
}

function createEmptyMemoryStores(): MemoryStores {
  return {
    vehicles: new Map(),
    kimperCodes: new Map(),
    employees: new Map(),
    employeeCards: new Map(),
    people: new Map(),
    syncMetadata: new Map(),
    qrCache: new Map()
  }
}

class OfflineDataSyncService {
  private db: any = null
  private syncInProgress = false
  private listeners: Array<(status: SyncStatus) => void> = []

  // Memory-mode fallback state. Set by initialize() when IDB is permanently
  // unavailable. Consumers should check `memoryMode` before db, and fall back
  // to `memoryStores` for lookups/storage.
  private memoryMode = false
  private memoryStores: MemoryStores = createEmptyMemoryStores()

  // Auto-sync scheduler state — a foreground 2h timer bump. The internal
  // freshness gate inside syncOfflineData will short-circuit if the last
  // sync is still fresh, so this is just a lightweight "wake up and check".
  private autoSyncTimer: number | null = null
  private static readonly AUTO_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000

  /** True when IDB is unusable and we're serving lookups from RAM. */
  isInMemoryMode(): boolean {
    return this.memoryMode
  }

  /**
   * Start the 2-hour background auto-sync. Safe to call multiple times —
   * additional calls are no-ops. Call once during app bootstrap.
   *
   * The first tick fires ~30 s after start (so login / initial render
   * isn't competing with a sync). Subsequent ticks fire every 2 hours.
   * Only triggers while the tab is visible — background tabs skip.
   */
  startAutoSync(): void {
    if (this.autoSyncTimer !== null) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        console.log('[auto-sync] skipped — tab hidden')
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        console.log('[auto-sync] skipped — offline')
        return
      }
      this.syncOfflineData(false).catch((err) => {
        console.warn('[auto-sync] delta attempt failed:', err)
      })
    }
    // Initial delayed tick so we don't fight app bootstrap
    window.setTimeout(tick, 30000)
    this.autoSyncTimer = window.setInterval(tick, OfflineDataSyncService.AUTO_SYNC_INTERVAL_MS)
    console.log('[auto-sync] scheduler started (every 2h, foreground only)')
  }

  /** Stop the auto-sync scheduler. */
  stopAutoSync(): void {
    if (this.autoSyncTimer !== null) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  async initialize() {
    if (this.db || this.memoryMode) return this.db

    try {
      this.db = await this.openPrismDB()
    } catch (err) {
      if (isRecoverableIdbError(err)) {
        console.warn(`[IDB] ${PRISM_DB_NAME} open failed (${(err as Error).name}); wiping and retrying once…`, err)
        try {
          await deleteDB(PRISM_DB_NAME)
          this.db = await this.openPrismDB()
          console.info(`[IDB] ${PRISM_DB_NAME} successfully recreated after wipe`)
        } catch (retryErr) {
          console.error(`[IDB] ${PRISM_DB_NAME} unrecoverable after wipe — switching to memory mode`, retryErr)
          this.memoryMode = true
          this.memoryStores = createEmptyMemoryStores()
          return null
        }
      } else {
        console.error(`[IDB] ${PRISM_DB_NAME} non-recoverable error — switching to memory mode`, err)
        this.memoryMode = true
        this.memoryStores = createEmptyMemoryStores()
        return null
      }
    }
    return this.db
  }

  private openPrismDB() {
    return openDB<OfflineDataDB>(PRISM_DB_NAME, PRISM_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // ============================================
        // VEHICLES STORE - Version 7: keyed by DB id instead of equip_no.
        // Different contractors can have the same equip_no (e.g. "LV 11"), so
        // equip_no is NOT a unique identifier. Using id ensures every real
        // vehicle survives sync without silent deduplication.
        // ============================================
        if (oldVersion < 7) {
          // Upgrade path: delete old equip_no-keyed store and recreate with id
          if (db.objectStoreNames.contains('vehicles')) {
            db.deleteObjectStore('vehicles')
          }
          const vehicleStore = db.createObjectStore('vehicles', { keyPath: 'id' })
          vehicleStore.createIndex('equip_no', 'equip_no', { unique: false })
          vehicleStore.createIndex('status', 'commissioning_status')
          vehicleStore.createIndex('company', 'company')
          vehicleStore.createIndex('department', 'department')
          vehicleStore.createIndex('plate_number', 'plate_number')
        } else if (!db.objectStoreNames.contains('vehicles')) {
          // Fresh install at v7+
          const vehicleStore = db.createObjectStore('vehicles', { keyPath: 'id' })
          vehicleStore.createIndex('equip_no', 'equip_no', { unique: false })
          vehicleStore.createIndex('status', 'commissioning_status')
          vehicleStore.createIndex('company', 'company')
          vehicleStore.createIndex('department', 'department')
          vehicleStore.createIndex('plate_number', 'plate_number')
        }

        // ============================================
        // Version 8: index qr_code_token so token-format QR stickers
        // (/inspect/t/<token>) resolve against the offline vehicle store.
        // ============================================
        if (oldVersion < 8 && db.objectStoreNames.contains('vehicles')) {
          const vStore = transaction.objectStore('vehicles')
          if (!vStore.indexNames.contains('qr_code_token')) {
            vStore.createIndex('qr_code_token', 'qr_code_token', { unique: false })
          }
        }

        // ============================================
        // KIMPER STORE - Complete KIMPER data
        // ============================================
        if (!db.objectStoreNames.contains('kimperCodes')) {
          const kimperStore = db.createObjectStore('kimperCodes', { keyPath: 'name' })
          kimperStore.createIndex('id', 'id', { unique: true })
          kimperStore.createIndex('id_number', 'id_number')
          kimperStore.createIndex('company', 'company')
          kimperStore.createIndex('status', 'status')
          kimperStore.createIndex('department', 'department')
        } else if (oldVersion < 2) {
          const kimperStore = transaction.objectStore('kimperCodes')
          if (!kimperStore.indexNames.contains('id')) {
            kimperStore.createIndex('id', 'id', { unique: true })
          }
        }
        // Version 3: Add department index
        if (oldVersion < 3 && db.objectStoreNames.contains('kimperCodes')) {
          const kimperStore = transaction.objectStore('kimperCodes')
          if (!kimperStore.indexNames.contains('department')) {
            kimperStore.createIndex('department', 'department')
          }
        }

        // Version 6: Recreate kimperCodes with 'id' as keyPath instead of 'name'
        // so duplicate names no longer overwrite each other.
        if (oldVersion < 6 && db.objectStoreNames.contains('kimperCodes')) {
          db.deleteObjectStore('kimperCodes')
          const kimperStore = db.createObjectStore('kimperCodes', { keyPath: 'id' })
          kimperStore.createIndex('name', 'name')
          kimperStore.createIndex('id_number', 'id_number')
          kimperStore.createIndex('company', 'company')
          kimperStore.createIndex('status', 'status')
          kimperStore.createIndex('department', 'department')
        }

        // ============================================
        // EMPLOYEES STORE - NEW in Version 3
        // ============================================
        if (!db.objectStoreNames.contains('employees')) {
          const employeeStore = db.createObjectStore('employees', { keyPath: 'employee_id' })
          employeeStore.createIndex('id', 'id', { unique: true })
          employeeStore.createIndex('name', 'name')
          employeeStore.createIndex('id_number', 'id_number')
          employeeStore.createIndex('company', 'company')
          employeeStore.createIndex('department', 'department')
          employeeStore.createIndex('status', 'status')
        }

        if (!db.objectStoreNames.contains('employeeCards')) {
          const employeeCardStore = db.createObjectStore('employeeCards', { keyPath: 'employee_id' })
          employeeCardStore.createIndex('name', 'employee.name')
          employeeCardStore.createIndex('company', 'employee.company')
          employeeCardStore.createIndex('department', 'employee.department')
          employeeCardStore.createIndex('status', 'employee.status')
        }

        // ============================================
        // PEOPLE STORE — NEW in Version 5 (unified source of truth)
        // One record per person, keyed by person_id. Replaces the need to
        // duplicate photos across employees/kimperCodes/employeeCards.
        // ============================================
        if (oldVersion < 5 && !db.objectStoreNames.contains('people')) {
          const peopleStore = db.createObjectStore('people', { keyPath: 'person_id' })
          peopleStore.createIndex('ktp_number', 'ktp_number')
          peopleStore.createIndex('employee_id', 'employee_id')
          peopleStore.createIndex('kimper_id', 'kimper.kimper_id')
          peopleStore.createIndex('name', 'name')
          peopleStore.createIndex('company', 'company')
          peopleStore.createIndex('department', 'department')
        }

        // Recent inspections store
        if (!db.objectStoreNames.contains('recentInspections')) {
          const inspectionStore = db.createObjectStore('recentInspections', { keyPath: 'id' })
          inspectionStore.createIndex('vehicle', 'vehicle_equip_no')
          inspectionStore.createIndex('date', 'inspection_date')
        }

        // Sync metadata store
        if (!db.objectStoreNames.contains('syncMetadata')) {
          db.createObjectStore('syncMetadata', { keyPath: 'key' })
        }

        // ============================================
        // QR CACHE STORE - NEW in Version 9
        // Saves the full rich payload (training/violations/summary/company) for
        // a single person the instant it is opened online, so the same QR code
        // scanned offline shows the saved profile instead of zeros.
        // ============================================
        if (!db.objectStoreNames.contains('qrCache')) {
          db.createObjectStore('qrCache', { keyPath: 'key' })
        }
      },
      blocked()    { console.warn(`[IDB] ${PRISM_DB_NAME} open blocked by other tab`) },
      blocking()   { console.warn(`[IDB] ${PRISM_DB_NAME} blocking newer open; closing`) },
      terminated() { console.warn(`[IDB] ${PRISM_DB_NAME} connection terminated`) }
    })
  }

  // Main sync function - downloads essential data from server
  async syncOfflineData(force = false): Promise<SyncResult> {
    if (this.syncInProgress && !force) {
      return { success: false, message: 'Sync already in progress' }
    }

    this.syncInProgress = true
    this.notifyListeners({ status: 'syncing', progress: 2, stage: 'Preparing sync…' })
    await yieldToBrowser()

    try {
      await this.initialize()

      // In memory mode the freshness check / repair check rely on metadata
      // stores that don't exist — always do a fresh fetch so the user at least
      // has live data for the session.
      if (!this.memoryMode) {
        if (!force) {
          const requiresRepair = await this.requiresEmployeeDataRepair()
          if (requiresRepair) {
            console.warn('⚠️ Legacy employee dataset detected. Forcing employee data repair sync...')
            force = true
          }
        }

        if (!force) {
          const lastSync = await this.getLastSyncTime()
          const timeSinceSync = Date.now() - lastSync
          const SYNC_INTERVAL = 2 * 60 * 60 * 1000 // 2 hours

          if (timeSinceSync < SYNC_INTERVAL) {
            return {
              success: true,
              message: `Data is fresh (synced ${Math.round(timeSinceSync / 60000)} minutes ago)`,
              cached: true
            }
          }
        }
      }

      // --- Pick a strategy -------------------------------------------------
      // Memory mode has no persistent cursor store → always do the full
      // single-shot fetch (acceptable: it's a last-resort fallback).
      // Persistent mode routes to delta sync when a cursor exists, otherwise
      // runs the chunked initial sync.
      const peopleCursor = this.memoryMode ? null : await this.getMeta('peopleSyncCursor')
      const vehiclesCursor = this.memoryMode ? null : await this.getMeta('vehiclesSyncCursor')
      const useDelta = !this.memoryMode && !force && !!peopleCursor && !!vehiclesCursor

      console.log(
        this.memoryMode
          ? '🔄 Sync strategy: memory-mode full fetch'
          : useDelta
            ? '🔄 Sync strategy: delta (incremental)'
            : '🔄 Sync strategy: initial chunked download'
      )

      if (this.memoryMode) {
        this.notifyListeners({
          status: 'syncing', progress: 10,
          stage: 'Memory-mode: connecting to server…'
        })
        await yieldToBrowser()

        const dataPackage = await this.fetchEssentialData()
        this.notifyListeners({
          status: 'syncing', progress: 45,
          stage: `Download complete · ${dataPackage.totalRecords.toLocaleString()} records`
        })
        await yieldToBrowser()

        await this.storeOfflineDataInMemory(dataPackage)
        this.notifyListeners({ status: 'syncing', progress: 98, stage: 'Finalizing…' })
        await yieldToBrowser()

        console.log(`✅ Offline sync complete: ${dataPackage.totalRecords} records (memory mode)`)
        this.notifyListeners({ status: 'complete', progress: 100, stage: 'Done', data: dataPackage })

        return {
          success: true,
          message: `Synced ${dataPackage.totalRecords} records (memory mode — data lost on refresh)`,
          data: dataPackage
        }
      }

      // Persistent mode — run the appropriate strategy. Both methods emit
      // their own progress updates and write directly to IDB.
      const result = useDelta
        ? await this.performDeltaSync()
        : await this.performInitialChunkedSync()

      this.notifyListeners({ status: 'syncing', progress: 98, stage: 'Finalizing…' })
      await yieldToBrowser()

      console.log(`✅ Offline sync complete: ${result.message}`)
      this.notifyListeners({ status: 'complete', progress: 100, stage: 'Done' })

      return result

    } catch (error) {
      console.error('❌ Offline sync failed:', error)
      this.notifyListeners({ status: 'error', error: error as Error })
      
      return {
        success: false,
        message: `Sync failed: ${(error as Error).message}`,
        error: error as Error
      }
    } finally {
      this.syncInProgress = false
    }
  }

  // Fetch ALL data from server: Vehicles + unified People (deduplicated).
  // The unified /people/all endpoint replaces 3 legacy endpoints (kimper,
  // employees/master, employees/cards) and ships thumbnailed photos once per
  // person instead of 3x. Legacy shapes are reconstructed in-memory so the
  // rest of the app keeps working without code changes.
  private async fetchEssentialData(): Promise<OfflineDataPackage> {
    console.log('🔄 Fetching data: Vehicles + unified People (/people/all)…')

    let onCompanyNetwork = false
    try {
      onCompanyNetwork = await directSQLServerService.isOnCompanyNetwork()
    } catch (e) {
      console.warn('⚠️ Company network probe failed, using cloud API:', e)
    }

    // Prefer company/direct path; fall back to cloud API on failure.
    if (onCompanyNetwork) {
      try {
        const companyTasks: Array<{ kind: 'vehicles'|'people'; label: string; fn: () => Promise<any[]> }> = [
          { kind: 'people', label: 'people', fn: () => directSQLServerService.getPeopleComplete() },
        ]
        if (SYNC_VEHICLES) {
          companyTasks.unshift({ kind: 'vehicles', label: 'vehicles', fn: () => directSQLServerService.getVehiclesComplete() })
        }
        return await this.runFetchTasks(companyTasks, 'Company API')
      } catch (e) {
        console.warn('⚠️ Direct SQL path failed, falling back to cloud API:', e)
        this.notifyListeners({ status: 'syncing', progress: 12, stage: 'Company API unavailable, trying cloud…' })
        await yieldToBrowser()
      }
    }

    console.log('☁️ Using cloud API connection')
    const cloudTasks: Array<{ kind: 'vehicles'|'people'; label: string; fn: () => Promise<any[]> }> = [
      { kind: 'people', label: 'people', fn: () => this.fetchJsonList('/api/mobile/people/all?photo_size=200', null, null) },
    ]
    if (SYNC_VEHICLES) {
      cloudTasks.unshift({ kind: 'vehicles', label: 'vehicles', fn: () => this.fetchJsonList('/api/mobile/vehicles/all', '/api/vehicles', 'vehicles') })
    }
    return this.runFetchTasks(cloudTasks, 'Cloud API')
  }

  // Helper: fetch a list endpoint, with optional legacy fallback path.
  // Uses a sync-grade 5-minute timeout (the default apiFetch timeout is 15s
  // which is fine for UI calls but cancels mid-download on large datasets).
  // Explicit gzip hint reduces JSON payload size ~70% when the server supports it.
  private async fetchJsonList(primaryPath: string, legacyPath: string | null, legacyKey: string | null): Promise<any[]> {
    const syncOpts = { timeout: 300000 } // 5 minutes
    const syncInit: RequestInit = {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' }
    }
    const response = await apiFetch(primaryPath, syncInit, syncOpts)
    if (response.ok) {
      const json = await response.json()
      return json.data || []
    }
    if (legacyPath && legacyKey) {
      console.log(`⚠️ ${primaryPath} returned ${response.status}, trying legacy ${legacyPath}`)
      const fallback = await apiFetch(legacyPath, syncInit, syncOpts)
      if (fallback.ok) {
        const json = await fallback.json()
        return json[legacyKey] || json.data || []
      }
      throw new Error(`${primaryPath} HTTP ${response.status}, ${legacyPath} HTTP ${fallback.status}`)
    }
    throw new Error(`${primaryPath} HTTP ${response.status}`)
  }

  // Helper: runs an array of fetch tasks in parallel while emitting granular
  // progress updates as each one settles. Tolerates individual failures so a
  // single dead endpoint doesn't kill the whole sync.
  private async runFetchTasks(
    tasks: Array<{ kind: 'vehicles'|'people'; label: string; fn: () => Promise<any[]> }>,
    sourceLabel: string
  ): Promise<OfflineDataPackage> {
    const baseProgress = 12
    const topProgress = 42
    const span = topProgress - baseProgress
    const total = tasks.length
    let completed = 0

    this.notifyListeners({ status: 'syncing', progress: baseProgress, stage: `${sourceLabel}: fetching 0/${total}…` })
    await yieldToBrowser()

    // Heartbeat: if nothing completes in 15s, surface a reassuring message.
    const heartbeat = setTimeout(() => {
      if (completed === 0) {
        this.notifyListeners({
          status: 'syncing',
          progress: baseProgress + 1,
          stage: `${sourceLabel}: still fetching… large datasets can take up to 2 min.`
        })
      }
    }, 15000)

    const results: Partial<Record<'vehicles'|'people', any[]>> = {}
    const errors: Array<{ label: string; error: Error }> = []

    await Promise.all(tasks.map(async (task) => {
      const startedAt = Date.now()
      try {
        const data = await task.fn()
        results[task.kind] = data
        completed++
        const progress = Math.round(baseProgress + (completed / total) * span)
        const ms = Date.now() - startedAt
        console.log(`✅ Fetched ${data.length} ${task.label} in ${ms}ms`)
        this.notifyListeners({
          status: 'syncing',
          progress,
          stage: `✓ ${task.label} (${data.length.toLocaleString()}) · ${completed}/${total}`
        })
        await yieldToBrowser()
      } catch (e) {
        errors.push({ label: task.label, error: e as Error })
        completed++
        const progress = Math.round(baseProgress + (completed / total) * span)
        console.error(`❌ Failed to fetch ${task.label}:`, e)
        this.notifyListeners({
          status: 'syncing',
          progress,
          stage: `⚠️ ${task.label} failed · ${completed}/${total}`
        })
        await yieldToBrowser()
      }
    }))

    clearTimeout(heartbeat)

    // If every task failed, bubble up so the caller can fall back or show error.
    if (errors.length === tasks.length) {
      throw new Error(`${sourceLabel}: all endpoints failed. First error: ${errors[0].error.message}`)
    }

    const vehicleData = (results.vehicles || []) as VehicleFullInfo[]
    const peopleData = (results.people || []) as Person[]

    // Derive the legacy shapes from unified people so existing pages/lookups
    // keep working with zero changes. Photos are shared by reference — only
    // one copy lives in memory no matter which store reads it.
    const { employees, kimperCodes, employeeCards } = this.splitPeopleToLegacy(peopleData)

    const totalRecords = vehicleData.length + peopleData.length

    console.log(
      `📊 ${sourceLabel} total: ${totalRecords} records ` +
      `(${vehicleData.length} vehicles + ${peopleData.length} people → ` +
      `${employees.length} emp / ${kimperCodes.length} kim / ${employeeCards.length} cards), ` +
      `${errors.length} endpoint(s) failed`
    )

    return {
      vehicles: vehicleData,
      kimperCodes,
      employees,
      employeeCards,
      people: peopleData,
      lastSyncTimestamp: Date.now(),
      dataVersion: `v${Date.now()}`,
      totalRecords,
      syncDetails: {
        vehiclesCount: vehicleData.length,
        kimperCount: kimperCodes.length,
        employeesCount: employees.length,
        employeeCardsCount: employeeCards.length,
        peopleCount: peopleData.length,
      }
    }
  }

  // Split the unified Person[] into legacy-shaped arrays. Intentionally does
  // not dedupe photos by reference — the Person objects already own the single
  // copy; the legacy records just link to the same data URI string.
  private splitPeopleToLegacy(people: Person[]): {
    employees: EmployeeFullInfo[]
    kimperCodes: KimperFullInfo[]
    employeeCards: Array<EmployeeCardData & { employee_id: string }>
  } {
    const employees: EmployeeFullInfo[] = []
    const kimperCodes: KimperFullInfo[] = []
    const employeeCards: Array<EmployeeCardData & { employee_id: string }> = []

    // Track which keys/ids we've emitted so we never generate dupes that would
    // collide with IDB unique indexes or overwrite earlier records silently.
    const employeeIdsSeen = new Set<string>()
    const kimperIdsSeen = new Set<number>()
    const employeeCardIdsSeen = new Set<string>()

    for (const p of people) {
      // Legacy employees store — only for people with an employee_id
      if (p.has_employee && p.employee_id != null && p.employee_id !== '' && !employeeIdsSeen.has(p.employee_id)) {
        employeeIdsSeen.add(p.employee_id)
        employees.push({
          employee_id: p.employee_id,
          name: p.name,
          company: p.company || undefined,
          department: p.department || undefined,
          section: p.section || undefined,
          position: p.position || undefined,
          position_level: p.position_level || undefined,
          status: p.status || 'Active',
          qr_code_token: p.qr_code_token || undefined,
          photo_url: p.photo_url || undefined,
          ktp_number: p.ktp_number || undefined,
        })
      }

      if (p.has_employee && p.employee_id && !employeeCardIdsSeen.has(p.employee_id)) {
        employeeCardIdsSeen.add(p.employee_id)
        // Legacy employee card — reuse training/violations from the unified record
        employeeCards.push({
          employee_id: p.employee_id,
          success: true,
          employee: {
            id: 0,
            employee_id: p.employee_id,
            name: p.name,
            company: p.company || undefined,
            department: p.department || undefined,
            section: p.section || undefined,
            position: p.position || undefined,
            position_level: p.position_level || undefined,
            status: p.status || 'Active',
            qr_code_token: p.qr_code_token || undefined,
            photo_url: p.photo_url || undefined,
            ktp_number: p.ktp_number || undefined,
            photo_source: p.photo_source || undefined,
          },
          kimper: p.kimper ? {
            mcu_expire_date: p.kimper.mcu_expire_date || undefined,
            kimper_expired_date: p.kimper.kimper_expired_date || undefined,
            police_license_type: p.kimper.police_license_type || undefined,
            police_license_category: p.kimper.police_license_category || undefined,
            police_license_expired_date: p.kimper.police_license_expired_date || undefined,
            status: p.kimper.status || undefined,
            kimper_name: p.kimper.kimper_name || undefined,
            kimper_id: p.kimper.kimper_id,
          } : undefined,
          training_summary: p.training_summary || {
            total: 0, valid: 0, expired: 0, not_yet: 0,
            mandatory_total: 0, mandatory_valid: 0, expiring: 0,
          },
          training_categories: p.training_categories || [],
          mandatory_trainings: p.mandatory_trainings || [],
          extra_trainings: p.extra_trainings || [],
          violations: p.violations || [],
          verified_at: new Date().toISOString(),
        })
      }

      // Legacy kimper store — for anyone with KIMPER data (employees AND kimper-only).
      // keyPath is now `id` (DB v6) so each KIMPER record is stored individually.
      // We still dedupe by kimper_id so the same backend row isn't stored twice.
      if (p.has_kimper && p.kimper) {
        const kid = p.kimper.kimper_id
        if (typeof kid !== 'number' || kid <= 0 || kimperIdsSeen.has(kid)) continue
        kimperIdsSeen.add(kid)

        const kName = p.kimper.kimper_name || p.name
        if (!kName) continue

        kimperCodes.push({
          id: kid,
          name: kName,
          id_number: p.kimper.id_number || undefined,
          company: p.company || undefined,
          department: p.department || undefined,
          kimper_expired_date: p.kimper.kimper_expired_date || undefined,
          status: p.kimper.status || p.status || undefined,
          position: p.position || undefined,
          photo_url: p.photo_url || undefined,
          authorized_vehicles: p.kimper.units || undefined,
        } as KimperFullInfo)
      }
    }

    return { employees, kimperCodes, employeeCards }
  }

  // Legacy bulk writer. Retained for reference; the chunked sync path uses
  // writePeopleChunk / writeVehiclesChunk instead. Prefixed with '_' so
  // TypeScript accepts it as intentionally unused.
  // @ts-expect-error — kept for reference until chunked path is proven in the field
  private async _storeOfflineData(dataPackage: OfflineDataPackage) {
    console.log('💾 Storing ALL data in IndexedDB:', {
      vehicles: dataPackage.vehicles.length,
      kimper: dataPackage.kimperCodes.length,
      employees: dataPackage.employees?.length || 0,
      employeeCards: dataPackage.employeeCards?.length || 0,
      people: dataPackage.people?.length || 0,
      totalRecords: dataPackage.totalRecords
    })

    if (!this.db) throw new Error('Database not initialized')

    const tx = this.db.transaction(
      ['vehicles', 'kimperCodes', 'employees', 'employeeCards', 'people', 'syncMetadata'],
      'readwrite'
    )

    // Upsert pattern: put() overwrites existing records by key,
    // so we skip clear() to keep data visible while sync is in progress.
    console.log('📝 Upserting data (no clear — data stays visible during sync)...')

    const vehicleStore = tx.objectStore('vehicles')
    const kimperStore = tx.objectStore('kimperCodes')
    const employeeStore = tx.objectStore('employees')
    const employeeCardStore = tx.objectStore('employeeCards')
    const peopleStore = tx.objectStore('people')
    const metadataStore = tx.objectStore('syncMetadata')

    // Per-record failure counters so one bad row can't abort the whole sync.
    // Each put() is wrapped so a rejected promise is caught *before* it bubbles
    // up and aborts the IDB transaction. We log a single summary at the end.
    const failures = { vehicles: 0, kimper: 0, employees: 0, cards: 0, people: 0 }
    const safePut = async <T>(
      store: { put: (v: T) => Promise<unknown> },
      value: T,
      bucket: keyof typeof failures,
      label: string
    ) => {
      try {
        await store.put(value)
      } catch (e) {
        failures[bucket]++
        if (failures[bucket] <= 3) {
          console.warn(`[IDB] ${label} put failed:`, e, value)
        }
      }
    }

    // Fire puts in parallel per store — each `put()` returns a promise but IDB
    // queues the actual writes inside the single transaction, so this is both
    // correct and dramatically faster than awaiting each one sequentially.
    console.log(`🚛 Writing ${dataPackage.vehicles.length} vehicles...`)
    this.notifyListeners({
      status: 'syncing',
      progress: 55,
      stage: `Saving ${dataPackage.vehicles.length.toLocaleString()} vehicles…`
    })
    await yieldToBrowser()
    await Promise.all(
      dataPackage.vehicles
        .filter(v => v && v.id != null)
        .map(v => safePut(vehicleStore, v, 'vehicles', 'vehicles'))
    )

    console.log(`👷 Writing ${dataPackage.kimperCodes.length} KIMPER codes...`)
    this.notifyListeners({
      status: 'syncing',
      progress: 68,
      stage: `Saving ${dataPackage.kimperCodes.length.toLocaleString()} KIMPER records…`
    })
    await yieldToBrowser()
    await Promise.all(
      dataPackage.kimperCodes
        .filter(k => k && k.id != null && k.id > 0)
        .map(k => safePut(kimperStore, k, 'kimper', 'kimperCodes'))
    )

    const employeeCount = dataPackage.employees?.length || 0
    console.log(`👤 Writing ${employeeCount} employees...`)
    this.notifyListeners({
      status: 'syncing',
      progress: 80,
      stage: `Saving ${employeeCount.toLocaleString()} employees…`
    })
    await yieldToBrowser()
    if (employeeCount > 0) {
      await Promise.all(
        dataPackage.employees
          .filter(e => e && e.employee_id != null && e.employee_id !== '')
          .map(e => safePut(employeeStore, e, 'employees', 'employees'))
      )
    }

    const employeeCardCount = dataPackage.employeeCards?.length || 0
    console.log(`💳 Writing ${employeeCardCount} employee cards...`)
    this.notifyListeners({
      status: 'syncing',
      progress: 88,
      stage: `Saving ${employeeCardCount.toLocaleString()} employee cards…`
    })
    await yieldToBrowser()
    if (employeeCardCount > 0) {
      await Promise.all(
        dataPackage.employeeCards
          .filter(c => c.employee?.employee_id)
          .map(c => safePut(
            employeeCardStore,
            { ...c, employee_id: c.employee!.employee_id },
            'cards',
            'employeeCards'
          ))
      )
    }

    // Unified people store — single source of truth for person records
    const peopleCount = dataPackage.people?.length || 0
    console.log(`👥 Writing ${peopleCount} unified people records...`)
    this.notifyListeners({
      status: 'syncing',
      progress: 93,
      stage: `Saving ${peopleCount.toLocaleString()} people…`
    })
    await yieldToBrowser()
    if (peopleCount > 0) {
      await Promise.all(
        dataPackage.people
          .filter(p => p.person_id)
          .map(p => safePut(peopleStore, p, 'people', 'people'))
      )
    }

    const totalFailures = failures.vehicles + failures.kimper + failures.employees + failures.cards + failures.people
    if (totalFailures > 0) {
      console.warn(`[IDB] sync completed with ${totalFailures} skipped records`, failures)
    }

    // Metadata — small, fast, fire in parallel
    console.log('📊 Writing metadata...')
    this.notifyListeners({ status: 'syncing', progress: 95, stage: 'Finalizing…' })
    await yieldToBrowser()
    await Promise.all([
      metadataStore.put({ key: 'lastSync', value: dataPackage.lastSyncTimestamp }),
      metadataStore.put({ key: 'dataVersion', value: dataPackage.dataVersion }),
      metadataStore.put({ key: 'totalRecords', value: dataPackage.totalRecords }),
      metadataStore.put({ key: 'vehiclesCount', value: dataPackage.syncDetails.vehiclesCount }),
      metadataStore.put({ key: 'kimperCount', value: dataPackage.syncDetails.kimperCount }),
      metadataStore.put({ key: 'employeesCount', value: dataPackage.syncDetails.employeesCount }),
      metadataStore.put({ key: 'employeeCardsCount', value: dataPackage.syncDetails.employeeCardsCount }),
      metadataStore.put({ key: 'peopleCount', value: dataPackage.syncDetails.peopleCount })
    ])

    // Wait for the transaction itself to finish flushing to disk
    await tx.done
    console.log('✅ Data storage completed successfully!')
  }

  // Memory-mode write path. Populates in-process Maps so the rest of the app
  // can serve lookups for the current session without IDB.
  private async storeOfflineDataInMemory(dataPackage: OfflineDataPackage): Promise<void> {
    const stores = this.memoryStores
    stores.vehicles.clear()
    stores.kimperCodes.clear()
    stores.employees.clear()
    stores.employeeCards.clear()
    stores.people.clear()

    this.notifyListeners({ status: 'syncing', progress: 55, stage: `Caching ${dataPackage.vehicles.length.toLocaleString()} vehicles…` })
    await yieldToBrowser()
    for (const v of dataPackage.vehicles) {
      if (v.equip_no) stores.vehicles.set(v.equip_no, v)
    }

    this.notifyListeners({ status: 'syncing', progress: 68, stage: `Caching ${dataPackage.kimperCodes.length.toLocaleString()} KIMPER records…` })
    await yieldToBrowser()
    for (const k of dataPackage.kimperCodes) {
      if (k.name) stores.kimperCodes.set(k.name, k)
    }

    this.notifyListeners({ status: 'syncing', progress: 80, stage: `Caching ${(dataPackage.employees?.length || 0).toLocaleString()} employees…` })
    await yieldToBrowser()
    for (const e of dataPackage.employees || []) {
      if (e.employee_id) stores.employees.set(e.employee_id, e)
    }

    this.notifyListeners({ status: 'syncing', progress: 88, stage: `Caching ${(dataPackage.employeeCards?.length || 0).toLocaleString()} employee cards…` })
    await yieldToBrowser()
    for (const c of dataPackage.employeeCards || []) {
      const id = c.employee?.employee_id
      if (id) stores.employeeCards.set(id, { ...c, employee_id: id })
    }

    this.notifyListeners({ status: 'syncing', progress: 93, stage: `Caching ${(dataPackage.people?.length || 0).toLocaleString()} people…` })
    await yieldToBrowser()
    for (const p of dataPackage.people || []) {
      if (p.person_id) stores.people.set(p.person_id, p)
    }

    stores.syncMetadata.set('lastSync', dataPackage.lastSyncTimestamp)
    stores.syncMetadata.set('dataVersion', dataPackage.dataVersion)
    stores.syncMetadata.set('totalRecords', dataPackage.totalRecords)
    stores.syncMetadata.set('vehiclesCount', dataPackage.syncDetails.vehiclesCount)
    stores.syncMetadata.set('kimperCount', dataPackage.syncDetails.kimperCount)
    stores.syncMetadata.set('employeesCount', dataPackage.syncDetails.employeesCount)
    stores.syncMetadata.set('employeeCardsCount', dataPackage.syncDetails.employeeCardsCount)
    stores.syncMetadata.set('peopleCount', dataPackage.syncDetails.peopleCount)

    console.log('✅ Memory-mode cache populated:', {
      vehicles: stores.vehicles.size,
      kimper: stores.kimperCodes.size,
      employees: stores.employees.size,
      employeeCards: stores.employeeCards.size,
      people: stores.people.size
    })
  }

  // ============================================================
  // CHUNKED + DELTA SYNC (large-dataset safe)
  // ============================================================
  // The unified /people endpoint can return 137 MB / 31k+ records. A single
  // fetch would crash a mobile browser: the decoded JS objects alone are
  // ~500 MB peak. Instead we stream the dataset one page at a time, persist
  // each chunk to IDB, and drop it from memory before requesting the next.
  // RAM stays under ~20 MB and progress is visible chunk-by-chunk.
  //
  // After the first successful initial sync we remember the server's
  // "server_timestamp" per entity. Subsequent syncs only pull rows whose
  // updated_at > cursor, which is ~100 ms instead of 100 s.

  private static readonly PEOPLE_CHUNK_SIZE = 1000
  private static readonly DELTA_MAX_RECORDS = 5000 // above this, fall back to full
  private static readonly SYNC_TIMEOUT_MS = 300000 // 5 min — sync-grade

  private async getMeta(key: string): Promise<any> {
    if (!this.db) return null
    try {
      const row = await this.db.get('syncMetadata', key)
      return row?.value ?? null
    } catch {
      return null
    }
  }

  private async setMetaBatch(entries: Record<string, unknown>): Promise<void> {
    if (!this.db) return
    const tx = this.db.transaction(['syncMetadata'], 'readwrite')
    const store = tx.objectStore('syncMetadata')
    await Promise.all(
      Object.entries(entries).map(([key, value]) =>
        store.put({ key, value }).catch((e: unknown) => {
          console.warn(`[IDB] meta put failed (${key}):`, e)
        })
      )
    )
    await tx.done
  }

  private syncFetchInit(): RequestInit {
    return {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate, br' }
    }
  }

  // Download a single people page. Server caches the heavy SQL join for
  // ~10 min so pages 2..N return in ~250 ms each.
  private async fetchPeoplePage(page: number, size: number): Promise<{
    data: Person[]; total: number; has_more: boolean; server_timestamp: string
  }> {
    const url = `/api/mobile/people/all?page=${page}&size=${size}&photo_size=200`
    const response = await apiFetch(url, this.syncFetchInit(), { timeout: OfflineDataSyncService.SYNC_TIMEOUT_MS })
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
    const json = await response.json()
    return {
      data: (json.data || []) as Person[],
      total: Number(json.total) || 0,
      has_more: !!json.has_more,
      server_timestamp: json.server_timestamp || new Date().toISOString()
    }
  }

  private async fetchPeopleDelta(since: string): Promise<{ data: Person[]; server_timestamp: string }> {
    const url = `/api/mobile/people/delta?since=${encodeURIComponent(since)}&photo_size=200`
    const response = await apiFetch(url, this.syncFetchInit(), { timeout: OfflineDataSyncService.SYNC_TIMEOUT_MS })
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
    const json = await response.json()
    return {
      data: (json.data || []) as Person[],
      server_timestamp: json.server_timestamp || new Date().toISOString()
    }
  }

  private async fetchVehiclesAll(): Promise<{ data: VehicleFullInfo[]; server_timestamp: string }> {
    const url = `/api/mobile/vehicles/all`
    const response = await apiFetch(url, this.syncFetchInit(), { timeout: OfflineDataSyncService.SYNC_TIMEOUT_MS })
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
    const json = await response.json()
    return {
      data: (json.data || []) as VehicleFullInfo[],
      server_timestamp: json.server_timestamp || new Date().toISOString()
    }
  }

  private async fetchVehiclesDelta(since: string): Promise<{ data: VehicleFullInfo[]; server_timestamp: string }> {
    const url = `/api/mobile/vehicles/delta?since=${encodeURIComponent(since)}`
    const response = await apiFetch(url, this.syncFetchInit(), { timeout: OfflineDataSyncService.SYNC_TIMEOUT_MS })
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
    const json = await response.json()
    return {
      data: (json.data || []) as VehicleFullInfo[],
      server_timestamp: json.server_timestamp || new Date().toISOString()
    }
  }

  // Persist a vehicle slice. Short-lived transaction per chunk so a slow
  // chunk can't hold the IDB connection open for the whole sync.
  private async writeVehiclesChunk(vehicles: VehicleFullInfo[]): Promise<void> {
    if (!this.db || vehicles.length === 0) return
    const tx = this.db.transaction(['vehicles'], 'readwrite')
    const store = tx.objectStore('vehicles')
    let failed = 0
    await Promise.all(
      vehicles
        .filter(v => v && v.id != null)
        .map(v => store.put(v).catch((e: unknown) => {
          failed++
          if (failed <= 3) console.warn('[IDB] vehicle put failed:', e, v)
        }))
    )
    await tx.done
    if (failed > 0) console.warn(`[IDB] vehicle chunk: ${failed} skipped`)
  }

  // Persist a people slice. Splits into legacy shapes (employees / kimper /
  // employeeCards) in-memory, then writes all five stores in a single
  // transaction. Per-record failures are swallowed with a counter so one bad
  // row can't abort the chunk.
  private async writePeopleChunk(people: Person[]): Promise<{
    employees: number; kimper: number; cards: number
  }> {
    if (!this.db || people.length === 0) return { employees: 0, kimper: 0, cards: 0 }

    const { employees, kimperCodes, employeeCards } = this.splitPeopleToLegacy(people)

    const tx = this.db.transaction(
      ['people', 'employees', 'kimperCodes', 'employeeCards'],
      'readwrite'
    )
    const peopleStore = tx.objectStore('people')
    const employeeStore = tx.objectStore('employees')
    const kimperStore = tx.objectStore('kimperCodes')
    const cardStore = tx.objectStore('employeeCards')

    const failures = { people: 0, employees: 0, kimper: 0, cards: 0 }
    const safePut = async <T>(store: { put: (v: T) => Promise<unknown> }, value: T, bucket: keyof typeof failures) => {
      try {
        await store.put(value)
      } catch (e) {
        failures[bucket]++
        if (failures[bucket] <= 3) console.warn(`[IDB] ${bucket} put failed:`, e)
      }
    }

    await Promise.all([
      ...people
        .filter(p => p.person_id)
        .map(p => safePut(peopleStore, p, 'people')),
      ...employees
        .filter(e => e.employee_id != null && e.employee_id !== '')
        .map(e => safePut(employeeStore, e, 'employees')),
      ...kimperCodes
        .filter(k => k.id != null && k.id > 0)
        .map(k => safePut(kimperStore, k, 'kimper')),
      ...employeeCards
        .filter(c => c.employee?.employee_id)
        .map(c => safePut(
          cardStore,
          { ...c, employee_id: c.employee!.employee_id },
          'cards'
        ))
    ])
    await tx.done

    const totalFailed = failures.people + failures.employees + failures.kimper + failures.cards
    if (totalFailed > 0) console.warn(`[IDB] people chunk: ${totalFailed} skipped`, failures)

    return {
      employees: employees.length - failures.employees,
      kimper: kimperCodes.length - failures.kimper,
      cards: employeeCards.length - failures.cards
    }
  }

  // Initial / cold-start sync. Vehicles first (tiny), then loop through
  // paginated /people/all writing each chunk straight to IDB. Memory stays
  // flat, progress is visible. At the end we stash per-entity cursors so
  // future syncs can run in delta mode.
  private async performInitialChunkedSync(): Promise<SyncResult> {
    if (!this.db) throw new Error('Database not initialized')
    const startedAt = Date.now()
    const CHUNK = OfflineDataSyncService.PEOPLE_CHUNK_SIZE

    // --- Vehicles (skipped unless SYNC_VEHICLES) ---
    let vehicleRes: { data: VehicleFullInfo[]; server_timestamp: string } = {
      data: [],
      server_timestamp: new Date().toISOString(),
    }
    if (SYNC_VEHICLES) {
      this.notifyListeners({ status: 'syncing', progress: 10, stage: 'Downloading vehicles…' })
      await yieldToBrowser()

      vehicleRes = await this.fetchVehiclesAll()
      await this.writeVehiclesChunk(vehicleRes.data)

      this.notifyListeners({
        status: 'syncing',
        progress: 14,
        stage: `✓ ${vehicleRes.data.length.toLocaleString()} vehicles cached`
      })
      await yieldToBrowser()
    }

    // --- People, chunk by chunk ---
    let page = 1
    let total = 0
    let totalPages = 0
    let peopleWritten = 0
    let peopleServerTs: string | null = null
    const peopleCounts = { employees: 0, kimper: 0, cards: 0 }

    while (true) {
      this.notifyListeners({
        status: 'syncing',
        progress: totalPages > 0
          ? Math.min(92, 15 + Math.round((page / totalPages) * 77))
          : 15,
        stage: totalPages > 0
          ? `Chunk ${page}/${totalPages} · ${peopleWritten.toLocaleString()} of ${total.toLocaleString()} people`
          : `Downloading people (chunk ${page})…`
      })
      await yieldToBrowser()

      const res = await this.fetchPeoplePage(page, CHUNK)
      if (page === 1) {
        total = res.total
        totalPages = Math.max(1, Math.ceil(total / CHUNK))
        peopleServerTs = res.server_timestamp
      }

      const chunkCounts = await this.writePeopleChunk(res.data)
      peopleCounts.employees += chunkCounts.employees
      peopleCounts.kimper += chunkCounts.kimper
      peopleCounts.cards += chunkCounts.cards
      peopleWritten += res.data.length

      if (!res.has_more) break
      page++
      if (page > 500) throw new Error('People sync aborted: exceeded 500 pages')
    }

    // --- Cursors + metadata ---
    const now = Date.now()
    const totalRecords = vehicleRes.data.length + peopleWritten
    await this.setMetaBatch({
      lastSync: now,
      dataVersion: `v${now}`,
      totalRecords,
      vehiclesCount: vehicleRes.data.length,
      kimperCount: peopleCounts.kimper,
      employeesCount: peopleCounts.employees,
      employeeCardsCount: peopleCounts.cards,
      peopleCount: peopleWritten,
      vehiclesSyncCursor: vehicleRes.server_timestamp,
      peopleSyncCursor: peopleServerTs || new Date().toISOString()
    })

    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    console.log(
      `✅ Initial chunked sync: ${vehicleRes.data.length} vehicles + ` +
      `${peopleWritten} people (${totalPages} chunks) in ${secs}s`
    )

    return {
      success: true,
      message: `Initial sync complete · ${totalRecords.toLocaleString()} records in ${secs}s`
    }
  }

  // Delta sync. Fires two small /delta calls, upserts the rows, bumps the
  // cursors. If the payload is unexpectedly huge (cursor has drifted weeks
  // or data was wiped server-side), fall back to the chunked initial path
  // so we don't buffer 100 MB of JSON in a single fetch.
  private async performDeltaSync(): Promise<SyncResult> {
    if (!this.db) throw new Error('Database not initialized')
    const startedAt = Date.now()

    const peopleCursor = (await this.getMeta('peopleSyncCursor')) as string | null
    const vehiclesCursor = (await this.getMeta('vehiclesSyncCursor')) as string | null
    // Vehicles are no longer required for delta — only people must have a cursor.
    if (!peopleCursor || (SYNC_VEHICLES && !vehiclesCursor)) {
      console.warn('[sync] Delta invoked without cursors → initial sync')
      return this.performInitialChunkedSync()
    }

    // --- Vehicles delta (skipped unless SYNC_VEHICLES) ---
    let vDelta: { data: VehicleFullInfo[]; server_timestamp: string } = {
      data: [],
      server_timestamp: vehiclesCursor || new Date().toISOString(),
    }
    if (SYNC_VEHICLES && vehiclesCursor) {
      this.notifyListeners({ status: 'syncing', progress: 20, stage: 'Checking vehicle updates…' })
      await yieldToBrowser()
      vDelta = await this.fetchVehiclesDelta(vehiclesCursor)
      if (vDelta.data.length > 0) await this.writeVehiclesChunk(vDelta.data)
    }

    // --- People delta (with oversize fallback) ---
    this.notifyListeners({
      status: 'syncing',
      progress: 45,
      stage: `✓ ${vDelta.data.length} vehicle updates · checking people…`
    })
    await yieldToBrowser()

    const pDelta = await this.fetchPeopleDelta(peopleCursor)
    if (pDelta.data.length > OfflineDataSyncService.DELTA_MAX_RECORDS) {
      console.warn(`[sync] Delta too large (${pDelta.data.length}) — rerunning as initial chunked sync`)
      this.notifyListeners({
        status: 'syncing',
        progress: 25,
        stage: 'Large update detected — running full refresh…'
      })
      return this.performInitialChunkedSync()
    }
    if (pDelta.data.length > 0) await this.writePeopleChunk(pDelta.data)

    // --- Cursors + lastSync ---
    const now = Date.now()
    await this.setMetaBatch({
      lastSync: now,
      vehiclesSyncCursor: vDelta.server_timestamp,
      peopleSyncCursor: pDelta.server_timestamp
    })

    const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
    console.log(`✅ Delta sync: +${vDelta.data.length} vehicles, +${pDelta.data.length} people in ${secs}s`)

    return {
      success: true,
      message: vDelta.data.length + pDelta.data.length === 0
        ? 'Already up to date'
        : `Updated ${vDelta.data.length} vehicles and ${pDelta.data.length} people`
    }
  }

  // Offline-first vehicle lookup by equipment number
  async lookupVehicleOffline(equipmentNumber: string): Promise<VehicleFullInfo | null> {
    await this.initialize()

    // Memory-mode fallback: scan the in-process Map.
    if (this.memoryMode) {
      const key = equipmentNumber.toUpperCase().trim()
      const direct = this.memoryStores.vehicles.get(key)
      if (direct) return direct
      for (const v of this.memoryStores.vehicles.values()) {
        if (v.equip_no?.includes(equipmentNumber) || equipmentNumber.includes(v.equip_no || '')) return v
      }
      return null
    }

    if (!this.db) return null

    try {
      // First try exact match via equip_no index (equip_no is no longer the key)
      let vehicle = await this.db.getFromIndex('vehicles', 'equip_no', equipmentNumber.toUpperCase().trim())

      if (!vehicle) {
        // Try partial match (for QR codes with extra formatting)
        const allVehicles = await this.db.getAll('vehicles')
        vehicle = allVehicles.find((v: VehicleFullInfo) =>
          v.equip_no?.includes(equipmentNumber) ||
          equipmentNumber.includes(v.equip_no || '')
        )
      }

      return vehicle || null
    } catch (error) {
      console.error('❌ Offline vehicle lookup failed:', error)
      return null
    }
  }

  // Offline-first vehicle lookup by secure QR token (/inspect/t/<token>).
  async lookupVehicleByToken(token: string): Promise<VehicleFullInfo | null> {
    const tok = (token || '').trim()
    if (!tok) return null
    await this.initialize()

    // Memory-mode fallback: scan the in-process Map values.
    if (this.memoryMode) {
      for (const v of this.memoryStores.vehicles.values()) {
        if (v.qr_code_token && v.qr_code_token === tok) return v
      }
      return null
    }

    if (!this.db) return null

    try {
      // Fast path: dedicated index (present on DB v8+).
      if (this.db.objectStoreNames.contains('vehicles')) {
        try {
          const hit = await this.db.getFromIndex('vehicles', 'qr_code_token', tok)
          if (hit) return hit
        } catch {
          // Index may be missing on a not-yet-upgraded DB — fall through to scan.
        }
      }
      // Fallback: full scan (older DBs without the token index).
      const all = await this.db.getAll('vehicles')
      return all.find((v: VehicleFullInfo) => v.qr_code_token === tok) || null
    } catch (error) {
      console.error('❌ Offline vehicle token lookup failed:', error)
      return null
    }
  }

  // Lookup vehicle by ID (for QR code scanning)
  async lookupVehicleById(vehicleId: number): Promise<VehicleFullInfo | null> {
    try {
      // Try offline first using index for fast lookup
      await this.initialize()
      if (this.db) {
        try {
          // id is now the keyPath — direct lookup
          const vehicle = await this.db.get('vehicles', vehicleId)
          if (vehicle) {
            console.log('📦 Using offline vehicle data for ID:', vehicleId, '→', vehicle.equip_no)
            return vehicle
          }
        } catch (keyError) {
          // Fallback to full scan if key lookup fails
          console.warn('⚠️ Key lookup failed, falling back to full scan:', keyError)
          const allVehicles = await this.db.getAll('vehicles')
          const vehicle = allVehicles.find((v: VehicleFullInfo) => v.id === vehicleId)
          if (vehicle) {
            console.log('📦 Using offline vehicle data (full scan) for ID:', vehicleId)
            return vehicle
          }
        }
      }

      // If not found offline, try API
      console.log('🌐 Fetching vehicle from API for ID:', vehicleId)
      const { apiFetch } = await import('./api')
      const response = await apiFetch(`/api/mobile/vehicles/${vehicleId}`, { method: 'GET' })

      if (!response.ok) {
        console.warn(`❌ Vehicle API lookup failed for ID ${vehicleId}`)
        return null
      }

      const result = await response.json()
      if (result.success && result.data && result.data.vehicle) {
        console.log('✅ Vehicle found via API:', result.data.vehicle.equip_no)
        return result.data.vehicle
      }

      return null
    } catch (error) {
      console.error('❌ Vehicle lookup by ID failed:', error)
      return null
    }
  }

  // Offline-first KIMPER lookup (by name since kode is excluded)
  async lookupKimperOffline(searchTerm: string): Promise<KimperFullInfo | null> {
    await this.initialize()
    if (!this.db) return null

    try {
      // Try exact name match first (kimperCodes is keyed by 'id', so use the name index)
      let kimper = await this.db.getFromIndex('kimperCodes', 'name', searchTerm.trim())

      if (!kimper) {
        // Try partial match by name or id_number
        const allKimper = await this.db.getAll('kimperCodes')
        kimper = allKimper.find((k: KimperFullInfo) =>
          k.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          k.id_number?.includes(searchTerm)
        )
      }

      return kimper || null
    } catch (error) {
      console.error('❌ Offline KIMPER lookup failed:', error)
      return null
    }
  }

  // Lookup KIMPER by ID (for QR code scanning)
  async lookupKimperById(kimperId: number): Promise<any | null> {
    try {
      // Try offline first using index for fast lookup
      await this.initialize()
      if (this.db) {
        try {
          // Use index for fast lookup
          const kimper = await this.db.getFromIndex('kimperCodes', 'id', kimperId)
          if (kimper) {
            console.log('📦 Using offline KIMPER data for ID:', kimperId, '→', kimper.name)
            return kimper
          }
        } catch (indexError) {
          // Fallback to full scan if index doesn't exist yet
          console.warn('⚠️ Index lookup failed, falling back to full scan:', indexError)
          const allKimper = await this.db.getAll('kimperCodes')
          const kimper = allKimper.find((k: KimperFullInfo) => k.id === kimperId)
          if (kimper) {
            console.log('📦 Using offline KIMPER data (full scan) for ID:', kimperId)
            return kimper
          }
        }
      }

      // If not found offline, try API
      console.log('🌐 Fetching KIMPER from API for ID:', kimperId)
      const { apiFetch } = await import('./api')
      const response = await apiFetch(`/api/mobile/kimper/${kimperId}`, { method: 'GET' })

      if (!response.ok) {
        console.warn(`❌ KIMPER API lookup failed for ID ${kimperId}`)
        return null
      }

      const result = await response.json()
      if (result.success && result.kimper) {
        console.log('✅ KIMPER found via API:', result.kimper.name)
        return result.kimper
      }

      return null
    } catch (error) {
      console.error('❌ KIMPER lookup by ID failed:', error)
      return null
    }
  }

  // ============================================
  // UNIFIED PEOPLE STORE — read API (preferred for new code)
  // ============================================

  // Get all unified people records
  async getAllPeople(): Promise<Person[]> {
    await this.initialize()
    if (this.memoryMode) return Array.from(this.memoryStores.people.values())
    if (!this.db) return []
    if (!this.db.objectStoreNames.contains('people')) return []
    try {
      return await this.db.getAll('people') || []
    } catch (error) {
      console.error('❌ Failed to get all people:', error)
      return []
    }
  }

  // Look up a person by person_id (KTP-xxx / EMP-xxx / KIM-xxx)
  async lookupPersonById(personId: string): Promise<Person | null> {
    await this.initialize()
    if (this.memoryMode) return this.memoryStores.people.get(personId) || null
    if (!this.db) return null
    if (!this.db.objectStoreNames.contains('people')) return null
    try {
      return (await this.db.get('people', personId)) || null
    } catch (error) {
      console.error('❌ Person lookup by person_id failed:', error)
      return null
    }
  }

  // Look up a person by KTP number — our strongest cross-system identifier
  async lookupPersonByKtp(ktpNumber: string): Promise<Person | null> {
    await this.initialize()
    const ktp = (ktpNumber || '').trim()
    if (!ktp) return null
    if (this.memoryMode) {
      const direct = this.memoryStores.people.get(`KTP-${ktp}`)
      if (direct) return direct
      for (const p of this.memoryStores.people.values()) {
        if (p.ktp_number === ktp) return p
      }
      return null
    }
    if (!this.db) return null
    if (!this.db.objectStoreNames.contains('people')) return null
    try {
      // Primary path: person_id is "KTP-<number>" when KTP is known
      const direct = await this.db.get('people', `KTP-${ktp}`)
      if (direct) return direct
      // Fallback: index lookup (handles records where KTP came from KIMPER only)
      return (await this.db.getFromIndex('people', 'ktp_number', ktp)) || null
    } catch (error) {
      console.error('❌ Person lookup by KTP failed:', error)
      return null
    }
  }

  // Look up a person by HR employee ID
  async lookupPersonByEmployeeId(employeeId: string): Promise<Person | null> {
    await this.initialize()
    if (this.memoryMode) {
      for (const p of this.memoryStores.people.values()) {
        if (p.employee_id === employeeId) return p
      }
      return null
    }
    if (!this.db) return null
    if (!this.db.objectStoreNames.contains('people')) return null
    try {
      return (await this.db.getFromIndex('people', 'employee_id', employeeId)) || null
    } catch (error) {
      console.error('❌ Person lookup by employee_id failed:', error)
      return null
    }
  }

  // Look up a person by KIMPER id (the people store carries a kimper_id index).
  async lookupPersonByKimperId(kimperId: number): Promise<Person | null> {
    await this.initialize()
    if (kimperId == null) return null
    if (this.memoryMode) {
      for (const p of this.memoryStores.people.values()) {
        if (p.kimper?.kimper_id === kimperId) return p
      }
      return null
    }
    if (!this.db) return null
    if (!this.db.objectStoreNames.contains('people')) return null
    try {
      return (await this.db.getFromIndex('people', 'kimper_id', kimperId)) || null
    } catch (error) {
      console.error('❌ Person lookup by kimper_id failed:', error)
      return null
    }
  }

  // Get all KIMPER records (for employee search)
  async getAllKimper(): Promise<KimperFullInfo[]> {
    await this.initialize()
    if (this.memoryMode) return Array.from(this.memoryStores.kimperCodes.values())
    if (!this.db) return []

    try {
      const allKimper = await this.db.getAll('kimperCodes')
      return allKimper || []
    } catch (error) {
      console.error('❌ Failed to get all KIMPER:', error)
      return []
    }
  }

  // Get all vehicles (for search)
  async getAllVehicles(): Promise<VehicleFullInfo[]> {
    await this.initialize()
    if (this.memoryMode) return Array.from(this.memoryStores.vehicles.values())
    if (!this.db) return []

    try {
      const allVehicles = await this.db.getAll('vehicles')
      return allVehicles || []
    } catch (error) {
      console.error('❌ Failed to get all vehicles:', error)
      return []
    }
  }

  // Get sync status and metadata
  async getSyncStatus(): Promise<OfflineSyncStatus> {
    await this.initialize()

    if (this.memoryMode) {
      const meta = this.memoryStores.syncMetadata
      const lastSync = (meta.get('lastSync') as number | undefined) || 0
      const totalRecords = (meta.get('totalRecords') as number | undefined) || 0
      return {
        hasData: this.memoryStores.people.size > 0 || this.memoryStores.vehicles.size > 0,
        lastSync,
        totalRecords,
        vehiclesCount: this.memoryStores.vehicles.size,
        kimperCount: this.memoryStores.kimperCodes.size,
        employeesCount: this.memoryStores.employees.size,
        employeeCardsCount: this.memoryStores.employeeCards.size,
        dataVersion: (meta.get('dataVersion') as string) || 'memory',
        isStale: false
      }
    }

    if (!this.db) return { hasData: false, lastSync: 0, totalRecords: 0 }

    try {
      const [lastSync, totalRecords, dataVersion, vehiclesCount, kimperCount, employeesCount, employeeCardsCount, storeCounts, requiresRepair] = await Promise.all([
        this.db.get('syncMetadata', 'lastSync'),
        this.db.get('syncMetadata', 'totalRecords'),
        this.db.get('syncMetadata', 'dataVersion'),
        this.db.get('syncMetadata', 'vehiclesCount'),
        this.db.get('syncMetadata', 'kimperCount'),
        this.db.get('syncMetadata', 'employeesCount'),
        this.db.get('syncMetadata', 'employeeCardsCount'),
        this.getStoreCounts(),
        this.requiresEmployeeDataRepair()
      ])

      const resolvedVehicles = storeCounts.vehicles || vehiclesCount?.value || 0
      const resolvedKimper = storeCounts.kimper || kimperCount?.value || 0
      const resolvedEmployees = storeCounts.employees || employeesCount?.value || 0
      const resolvedTotal = storeCounts.total || totalRecords?.value || 0
      const safeEmployeeCount = requiresRepair ? 0 : resolvedEmployees

      return {
        hasData: resolvedTotal > 0,
        lastSync: lastSync?.value || 0,
        totalRecords: resolvedTotal,
        vehiclesCount: resolvedVehicles,
        kimperCount: resolvedKimper,
        employeesCount: safeEmployeeCount,
        employeeCardsCount: storeCounts.employeeCards || (typeof employeeCardsCount?.value === 'number' ? employeeCardsCount.value : 0),
        dataVersion: dataVersion?.value || 'unknown',
        isStale: requiresRepair || Date.now() - (lastSync?.value || 0) > 2 * 60 * 60 * 1000 // 2 hours
      }
    } catch (error) {
      console.error('❌ Failed to get sync status:', error)
      return { hasData: false, lastSync: 0, totalRecords: 0 }
    }
  }

  private async getStoreCounts(): Promise<{ vehicles: number; kimper: number; employees: number; employeeCards: number; people: number; total: number }> {
    if (!this.db) return { vehicles: 0, kimper: 0, employees: 0, employeeCards: 0, people: 0, total: 0 }

    try {
      const [vehicles, kimper, employees, employeeCards, people] = await Promise.all([
        this.db.count('vehicles'),
        this.db.count('kimperCodes'),
        this.db.count('employees'),
        this.db.count('employeeCards'),
        // `people` store was added in DB v5 — guard so older DBs don't throw
        this.db.objectStoreNames.contains('people') ? this.db.count('people') : Promise.resolve(0)
      ])
      // Total excludes the unified `people` count because legacy stores already
      // cover those same records (avoids double-counting in the UI).
      return { vehicles, kimper, employees, employeeCards, people, total: vehicles + kimper + employees + employeeCards }
    } catch (error) {
      console.error('❌ Failed to count offline stores:', error)
      return { vehicles: 0, kimper: 0, employees: 0, employeeCards: 0, people: 0, total: 0 }
    }
  }

  private async requiresEmployeeDataRepair(): Promise<boolean> {
    if (!this.db) return false

    try {
      const [employeesMeta, employeeCardsMeta, _kimperMeta, counts] = await Promise.all([
        this.db.get('syncMetadata', 'employeesCount'),
        this.db.get('syncMetadata', 'employeeCardsCount'),
        this.db.get('syncMetadata', 'kimperCount'),
        this.getStoreCounts()
      ])

      const employeeCount = (employeesMeta?.value as number | undefined) ?? counts.employees
      const employeeCardCount = (employeeCardsMeta?.value as number | undefined) ?? counts.employeeCards

      // Large employee catalogs are valid as long as both the light employee
      // store and the full employee-card cache are present and roughly aligned.
      const missingEmployeeCache = employeeCount === 0 && employeeCardCount === 0
      const partialEmployeeCardCache =
        employeeCount > 0 &&
        (employeeCardCount === 0 || Math.abs(employeeCount - employeeCardCount) > 10)

      return missingEmployeeCache || partialEmployeeCardCache
    } catch (error) {
      console.error('❌ Employee repair check failed:', error)
      return false
    }
  }

  private async getLastSyncTime(): Promise<number> {
    if (!this.db) return 0
    const lastSync = await this.db.get('syncMetadata', 'lastSync')
    return lastSync?.value || 0
  }

  // Event listeners for sync status updates
  addSyncListener(callback: (status: SyncStatus) => void) {
    this.listeners.push(callback)
  }

  removeSyncListener(callback: (status: SyncStatus) => void) {
    this.listeners = this.listeners.filter(l => l !== callback)
  }

  private notifyListeners(status: SyncStatus) {
    this.listeners.forEach(callback => callback(status))
  }

  // Clear all offline data
  async clearOfflineData(): Promise<void> {
    await this.initialize()
    if (!this.db) return

    // Build store list defensively in case the `people` store hasn't been
    // migrated yet (app was upgraded from an older schema).
    const storeNames = ['vehicles', 'kimperCodes', 'employees', 'employeeCards', 'recentInspections', 'syncMetadata']
    if (this.db.objectStoreNames.contains('people')) {
      storeNames.push('people')
    }

    const tx = this.db.transaction(storeNames, 'readwrite')
    await Promise.all(storeNames.map(name => tx.objectStore(name).clear()))
    await tx.done

    console.log('🗑️ Offline data cleared (all stores)')
  }

  // Delete entire database and recreate with latest schema
  async deleteDatabaseAndRecreate(): Promise<void> {
    try {
      console.log('🗑️ Deleting entire IndexedDB database...')

      // Close current connection
      if (this.db) {
        this.db.close()
        this.db = null
      }

      // Delete the database
      await new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase('PRISMOfflineData')
        deleteRequest.onsuccess = () => {
          console.log('✅ Database deleted successfully')
          resolve()
        }
        deleteRequest.onerror = () => {
          console.error('❌ Failed to delete database')
          reject(deleteRequest.error)
        }
        deleteRequest.onblocked = () => {
          console.warn('⚠️ Database deletion blocked - close all tabs')
        }
      })

      // Reinitialize with latest schema
      await this.initialize()
      console.log('✅ Database recreated with latest schema (version 3)')
    } catch (error) {
      console.error('❌ Failed to delete and recreate database:', error)
      throw error
    }
  }

  // Clear database and force fresh sync
  async clearAndResync(): Promise<SyncResult> {
    try {
      console.log('🔄 Starting clear and resync...')

      // Delete and recreate database
      await this.deleteDatabaseAndRecreate()

      // Force sync fresh data
      const result = await this.syncOfflineData(true)

      if (result.success) {
        console.log('✅ Clear and resync completed successfully')
      }

      return result
    } catch (error) {
      console.error('❌ Clear and resync failed:', error)
      return {
        success: false,
        message: `Clear and resync failed: ${error}`,
        error: error as Error
      }
    }
  }

  // ============================================
  // COMPREHENSIVE QR CODE LOOKUP - ALL TYPES
  // ============================================
  
  /**
   * Universal QR code lookup - works with ANY QR code type
   * Supports: Vehicles (/inspect/{id}), KIMPER (/kimper/qr/{id}), 
   * Employees (/employee/qr/{id}), Equipment (EQUIP:{number})
   */
  async lookupQRCode(qrContent: string): Promise<QRLookupResult> {
    console.log('🔍 Universal QR lookup:', qrContent)
    
    // Detect QR type and extract ID
    const detection = this.detectQRType(qrContent)
    
    if (!detection.type || !detection.id) {
      return { type: 'unknown', data: null, found: false, source: 'none' }
    }
    
    // Try offline lookup first
    const offlineResult = await this.lookupOffline(detection.type, detection.id)
    if (offlineResult) {
      return { type: detection.type, data: offlineResult, found: true, source: 'offline' }
    }
    
    // If not found offline and we have connectivity, try API
    console.log('📡 Offline lookup failed, trying API...')
    const apiResult = await this.lookupAPI(detection.type, detection.id)
    if (apiResult) {
      return { type: detection.type, data: apiResult, found: true, source: 'api' }
    }
    
    return { type: detection.type, data: null, found: false, source: 'none' }
  }
  
  /**
   * Detect QR code type and extract ID from various formats
   */
  private detectQRType(qrContent: string): { type: QREntityType | null; id: string | number | null } {
    // Clean the content
    const clean = qrContent.trim()
    
    // Vehicle by ID: /inspect/{id}
    if (clean.includes('/inspect/')) {
      const match = clean.match(/\/inspect\/(\d+)/)
      if (match) return { type: 'vehicle', id: parseInt(match[1]) }
    }
    
    // KIMPER by ID: /kimper/qr/{id}
    if (clean.includes('/kimper/qr/')) {
      const match = clean.match(/\/kimper\/qr\/(\d+)/)
      if (match) return { type: 'kimper', id: parseInt(match[1]) }
    }
    
    // Employee by ID: /employee/qr/{id}
    if (clean.includes('/employee/qr/')) {
      const match = clean.match(/\/employee\/qr\/([^/?#]+)/)
      if (match) return { type: 'employee', id: match[1] }
    }
    
    // Equipment number: EQUIP:{number}
    if (clean.startsWith('EQUIP:')) {
      const equipNo = clean.replace('EQUIP:', '').trim()
      return { type: 'vehicle', id: equipNo }
    }
    
    // Try to extract any numeric ID as vehicle (fallback)
    const numericMatch = clean.match(/\/(\d+)(?:\/|$|\?|#)/)
    if (numericMatch) {
      return { type: 'vehicle', id: parseInt(numericMatch[1]) }
    }
    
    return { type: null, id: null }
  }
  
  /**
   * Lookup entity in offline database
   */
  private async lookupOffline(type: QREntityType, id: string | number): Promise<any | null> {
    await this.initialize()
    if (!this.db) return null
    
    try {
      switch (type) {
        case 'vehicle': {
          if (typeof id === 'number') {
            // Lookup by vehicle ID (id is now the keyPath)
            return await this.db.get('vehicles', id)
          } else {
            // Lookup by equipment number via index
            return await this.db.getFromIndex('vehicles', 'equip_no', id.toUpperCase())
          }
        }
        case 'kimper': {
          if (typeof id === 'number') {
            return await this.db.getFromIndex('kimperCodes', 'id', id)
          }
          return null
        }
        case 'employee': {
          // Try employee_id first, then name
          let employee = await this.db.get('employees', id)
          if (!employee) {
            // Search by name
            const allEmployees = await this.db.getAll('employees')
            employee = allEmployees.find((e: EmployeeFullInfo) =>
              e.name?.toLowerCase() === (id as string).toLowerCase() ||
              e.id_number === id
            )
          }
          return employee
        }
      }
    } catch (error) {
      console.error(`❌ Offline lookup error for ${type}:`, error)
    }
    return null
  }
  
  /**
   * Lookup entity via API
   */
  private async lookupAPI(type: QREntityType, id: string | number): Promise<any | null> {
    try {
      const { apiFetch } = await import('./api')
      
      switch (type) {
        case 'vehicle': {
          if (typeof id === 'number') {
            const response = await apiFetch(`/api/mobile/vehicles/${id}`, { method: 'GET' })
            if (response.ok) {
              const result = await response.json()
              return result.data?.vehicle || null
            }
          } else {
            // Lookup by equipment number
            const response = await apiFetch(`/api/mobile/vehicles/lookup?equip_no=${encodeURIComponent(id)}`, { method: 'GET' })
            if (response.ok) {
              const result = await response.json()
              return result.data?.vehicle || null
            }
          }
          break
        }
        case 'kimper': {
          const response = await apiFetch(`/api/mobile/kimper/${id}`, { method: 'GET' })
          if (response.ok) {
            const result = await response.json()
            return result.kimper || null
          }
          break
        }
        case 'employee': {
          const response = await apiFetch(`/api/mobile/employees/${id}`, { method: 'GET' })
          if (response.ok) {
            const result = await response.json()
            return result.data?.employee || null
          }
          break
        }
      }
    } catch (error) {
      console.error(`❌ API lookup error for ${type}:`, error)
    }
    return null
  }
  
  // ============================================
  // EMPLOYEE LOOKUP FUNCTIONS
  // ============================================
  
  /**
   * Get all employees from offline storage
   */
  async getAllEmployees(): Promise<EmployeeFullInfo[]> {
    await this.initialize()
    if (!this.db) return []
    
    try {
      return await this.db.getAll('employees') || []
    } catch (error) {
      console.error('❌ Failed to get all employees:', error)
      return []
    }
  }
  
  /**
   * Lookup employee by employee_id
   */
  async lookupEmployeeById(employeeId: string): Promise<EmployeeFullInfo | null> {
    await this.initialize()
    if (!this.db) return null

    try {
      // Primary: lookup by employee_id (keyPath)
      let result = await this.db.get('employees', employeeId)
      if (result) return result

      // Fallback: lookup by id_number index (HR employee IDs in QR codes)
      result = await this.db.getFromIndex('employees', 'id_number', employeeId)
      if (result) return result

      // Fallback: lookup by numeric id index (KIMPER integer IDs)
      const numericId = parseInt(employeeId, 10)
      if (!isNaN(numericId)) {
        result = await this.db.getFromIndex('employees', 'id', numericId)
        if (result) return result
      }

      return null
    } catch (error) {
      console.error('❌ Employee lookup failed:', error)
      return null
    }
  }
  
  /**
   * Search employees by name or ID
   */
  async searchEmployees(searchTerm: string): Promise<EmployeeFullInfo[]> {
    await this.initialize()
    if (!this.db) return []
    
    try {
      const allEmployees = await this.db.getAll('employees')
      const term = String(searchTerm || '').trim().toLowerCase()
      
      return allEmployees.filter((e: EmployeeFullInfo) =>
        String(e.name || '').toLowerCase().includes(term) ||
        String(e.employee_id || '').toLowerCase().includes(term) ||
        String(e.id_number || '').toLowerCase().includes(term) ||
        String(e.department || '').toLowerCase().includes(term) ||
        String(e.company || '').toLowerCase().includes(term)
      )
    } catch (error) {
      console.error('❌ Employee search failed:', error)
      return []
    }
  }

  private personToEmployeeFullInfoFromPerson(p: Person): EmployeeFullInfo {
    return {
      employee_id: p.employee_id!,
      name: p.name,
      company: p.company ?? undefined,
      department: p.department ?? undefined,
      section: p.section ?? undefined,
      position: p.position ?? undefined,
      position_level: p.position_level ?? undefined,
      status: p.status || 'Active',
      qr_code_token: p.qr_code_token ?? undefined,
      photo_url: p.photo_url ?? undefined,
      ktp_number: p.ktp_number ?? undefined,
    }
  }

  private personToKimperFullInfoFromPerson(p: Person): KimperFullInfo | null {
    if (!p.has_kimper || !p.kimper) return null
    const kid = p.kimper.kimper_id
    const id = typeof kid === 'number' && kid > 0 ? kid : 0
    const displayName = (p.kimper.kimper_name || p.name).trim()
    if (!displayName) return null
    return {
      id,
      name: displayName,
      id_number: p.kimper.id_number ?? undefined,
      company: p.company ?? undefined,
      department: p.department ?? undefined,
      kimper_expired_date: p.kimper.kimper_expired_date ?? undefined,
      status: p.kimper.status || p.status || undefined,
      position: p.position ?? undefined,
      photo_url: p.photo_url ?? undefined,
      authorized_vehicles: p.kimper.units || undefined,
    }
  }

  /**
   * Employee Lookup search: reads the unified `people` roster (one row per person_id).
   * Legacy `kimperCodes` intentionally drops duplicate *names* so IndexedDB keys stay
   * unique — searching only that store misses e.g. a second "Rahul". This API does not.
   * When the people store is empty (pre–v5 DB, or not synced), falls back to kimper +
   * employee table search.
   */
  async searchPeopleForEmployeeLookup(searchTerm: string): Promise<{
    kimperResults: KimperFullInfo[]
    employeeResults: EmployeeFullInfo[]
  }> {
    await this.initialize()
    const term = String(searchTerm || '').trim().toLowerCase()
    if (!term) return { kimperResults: [], employeeResults: [] }

    const matchesPerson = (p: Person): boolean => {
      const bits = [
        p.name,
        p.company,
        p.department,
        p.section,
        p.position,
        p.ktp_number,
        p.employee_id,
        p.kimper?.kimper_name,
        p.kimper?.id_number,
        p.kimper?.kimper_id != null ? String(p.kimper.kimper_id) : '',
      ]
      return bits.some(b => String(b ?? '').toLowerCase().includes(term))
    }

    const allPeople = await this.getAllPeople()
    if (allPeople.length === 0) {
      try {
        const legacyKimper = await this.getAllKimper()
        const kimperResults = legacyKimper.filter((k: KimperFullInfo) =>
          String(k.name || '').toLowerCase().includes(term) ||
          String(k.id_number || '').toLowerCase().includes(term) ||
          String(k.company || '').toLowerCase().includes(term)
        )
        const employeeResults = await this.searchEmployees(searchTerm)
        return { kimperResults, employeeResults }
      } catch (e) {
        console.error('❌ Legacy employee lookup search failed:', e)
        return { kimperResults: [], employeeResults: [] }
      }
    }

    const matched = allPeople.filter(matchesPerson)
    const employeeResults: EmployeeFullInfo[] = []
    const kimperResults: KimperFullInfo[] = []

    for (const p of matched) {
      if (p.has_employee && p.employee_id) {
        employeeResults.push(this.personToEmployeeFullInfoFromPerson(p))
        continue
      }
      if (p.has_kimper && p.kimper) {
        const row = this.personToKimperFullInfoFromPerson(p)
        if (row) kimperResults.push(row)
      }
    }

    return { kimperResults, employeeResults }
  }

  async getEmployeeCardDataOffline(employeeId: string): Promise<EmployeeCardData | null> {
    await this.initialize()
    if (!this.db) return null

    const normalized = (employeeId || '').trim()
    if (!normalized) return null

    try {
      const exactMatch = await this.db.get('employeeCards', normalized)
      if (exactMatch) {
        const { employee_id: _employeeId, ...cardData } = exactMatch
        return cardData as EmployeeCardData
      }

      const employee = await this.lookupEmployeeById(normalized)
      if (!employee?.employee_id) return null

      const fallbackMatch = await this.db.get('employeeCards', employee.employee_id)
      if (!fallbackMatch) return null

      const { employee_id: _fallbackEmployeeId, ...cardData } = fallbackMatch
      return cardData as EmployeeCardData
    } catch (error) {
      console.error('Failed to get offline employee card data:', error)
      return null
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Offline QR cache — saves the full rich payload of a person/employee the
  // moment it is opened online, keyed by every identifier we know, so the same
  // QR scanned offline resolves to the real saved profile (not zeros).
  // ──────────────────────────────────────────────────────────────────────────
  private cardCacheKeysFromLookup(lookup: PersonLookupParams): string[] {
    const keys: string[] = []
    if (lookup.personKey) keys.push(`card:pk:${lookup.personKey}`)
    if (lookup.employeeId) keys.push(`card:emp:${lookup.employeeId.trim()}`)
    if (lookup.kimperId != null) keys.push(`card:kim:${lookup.kimperId}`)
    if (lookup.ktpNumber) keys.push(`card:ktp:${lookup.ktpNumber}`)
    return keys
  }

  private cardCacheKeysFromPersonData(data: PersonCardData): string[] {
    return this.cardCacheKeysFromLookup({
      personKey: data.person?.person_key,
      employeeId: data.person?.employee_id || data.employee?.employee_id,
      kimperId: data.person?.kimper_id ?? data.kimper?.kimper_id,
      ktpNumber: data.person?.ktp_number || data.employee?.ktp_number,
    })
  }

  private devCacheKeysFromLookup(lookup: PersonLookupParams): string[] {
    const keys: string[] = []
    if (lookup.personKey) keys.push(`dev:pk:${lookup.personKey}`)
    if (lookup.employeeId) keys.push(`dev:emp:${lookup.employeeId.trim()}`)
    if (lookup.kimperId != null) keys.push(`dev:kim:${lookup.kimperId}`)
    if (lookup.ktpNumber) keys.push(`dev:ktp:${lookup.ktpNumber}`)
    return keys
  }

  private async putQrCache(keys: string[], data: unknown): Promise<void> {
    const valid = keys.filter(Boolean)
    if (valid.length === 0 || data == null) return
    const cachedAt = Date.now()
    try {
      await this.initialize()
      if (this.memoryMode) {
        for (const key of valid) this.memoryStores.qrCache.set(key, { key, data, cachedAt })
        return
      }
      if (!this.db || !this.db.objectStoreNames.contains('qrCache')) return
      const tx = this.db.transaction(['qrCache'], 'readwrite')
      const store = tx.objectStore('qrCache')
      await Promise.all(valid.map(key => store.put({ key, data, cachedAt })))
      await tx.done
    } catch (error) {
      console.warn('⚠️ putQrCache failed:', error)
    }
  }

  private async getQrCache<T>(keys: string[]): Promise<{ data: T; cachedAt: number } | null> {
    const valid = keys.filter(Boolean)
    if (valid.length === 0) return null
    try {
      await this.initialize()
      if (this.memoryMode) {
        for (const key of valid) {
          const hit = this.memoryStores.qrCache.get(key)
          if (hit) return { data: hit.data as T, cachedAt: hit.cachedAt }
        }
        return null
      }
      if (!this.db || !this.db.objectStoreNames.contains('qrCache')) return null
      for (const key of valid) {
        const hit = (await this.db.get('qrCache', key)) as QrCacheEnvelope | undefined
        if (hit) return { data: hit.data as T, cachedAt: hit.cachedAt }
      }
      return null
    } catch (error) {
      console.warn('⚠️ getQrCache failed:', error)
      return null
    }
  }

  // Flatten the array-typed unit fields of an EmployeeKimperData into the
  // comma-joined string form the PersonDetailPage card expects.
  private flattenKimperForPerson(k?: EmployeeKimperData): PersonCardData['kimper'] {
    if (!k) return undefined
    const { authorized_units, authorized_unit_codes, ...rest } = k
    return {
      ...rest,
      units: authorized_units,
      authorized_units: authorized_units?.join(', '),
      authorized_unit_codes: authorized_unit_codes?.join(', '),
    }
  }

  // Convert a PersonCardData payload into the EmployeeCardData shape the
  // employeeCards store / EmployeeDetailPage expect (string -> string[] units).
  private personCardToEmployeeCard(card: PersonCardData): EmployeeCardData {
    const k = card.kimper
    let kimper: EmployeeKimperData | undefined
    if (k) {
      const { authorized_units, authorized_unit_codes, units, id_number, card_type_code, hire_date, ...rest } = k
      const splitToArray = (v?: string): string[] | undefined =>
        typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined
      kimper = {
        ...rest,
        authorized_units: units ?? splitToArray(authorized_units),
        authorized_unit_codes: splitToArray(authorized_unit_codes),
      }
    }
    return {
      success: card.success,
      employee: card.employee,
      kimper,
      training_summary: card.training_summary,
      training_categories: card.training_categories,
      mandatory_trainings: card.mandatory_trainings,
      extra_trainings: card.extra_trainings,
      violations: card.violations,
      verified_at: card.verified_at,
      _offline: card._offline,
    }
  }

  // Persist a freshly-fetched card into the employeeCards store too, so the
  // EmployeeDetailPage offline path (and the bulk-card index) stay in sync.
  private async saveEmployeeCardForOffline(card: EmployeeCardData): Promise<void> {
    const empId = card.employee?.employee_id
    if (!empId) return
    try {
      await this.initialize()
      if (this.memoryMode) {
        this.memoryStores.employeeCards.set(empId, { ...card, employee_id: empId })
        return
      }
      if (!this.db || !this.db.objectStoreNames.contains('employeeCards')) return
      const tx = this.db.transaction(['employeeCards'], 'readwrite')
      await tx.objectStore('employeeCards').put({ ...card, employee_id: empId })
      await tx.done
    } catch (error) {
      console.warn('⚠️ saveEmployeeCardForOffline failed:', error)
    }
  }

  // Public deviation-list cache wrappers (used by DeviationApiService).
  async cachePersonDeviations(lookup: PersonLookupParams, list: unknown): Promise<void> {
    await this.putQrCache(this.devCacheKeysFromLookup(lookup), list)
  }

  async getCachedPersonDeviations<T>(lookup: PersonLookupParams): Promise<{ data: T; cachedAt: number } | null> {
    return this.getQrCache<T>(this.devCacheKeysFromLookup(lookup))
  }

  private async readEmployeeCardOffline(employeeId: string): Promise<EmployeeCardData | null> {
    // Prefer the per-scan cache (carries an accurate cachedAt timestamp).
    const cached = await this.getQrCache<EmployeeCardData>(this.cardCacheKeysFromLookup({ employeeId }))
    if (cached) return { ...cached.data, _offline: { cachedAt: cached.cachedAt } }
    // Fall back to the bulk-synced employeeCards store.
    const bulk = await this.getEmployeeCardDataOffline(employeeId)
    if (bulk) {
      const lastSync = await this.getLastSyncTime()
      return { ...bulk, _offline: { cachedAt: lastSync || Date.now() } }
    }
    return null
  }

  private async readPersonCardOffline(lookup: PersonLookupParams): Promise<PersonCardData | null> {
    const cached = await this.getQrCache<PersonCardData>(this.cardCacheKeysFromLookup(lookup))
    if (cached) return { ...cached.data, _offline: { cachedAt: cached.cachedAt } }
    return null
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Person → PersonCardData conversion for offline QR scan
  // Bulk-synced Person records carry training/violations data that the plain
  // EmployeeFullInfo store does not. Converting them lets QR scans serve the
  // full profile without showing fake zeros.
  // ──────────────────────────────────────────────────────────────────────────
  private personToPersonCardData(p: Person, cachedAt?: number): PersonCardData {
    const ts = p.training_summary
    const now = new Date().toISOString()
    return {
      success: true,
      person: {
        person_key: p.person_id,
        name: p.name,
        employee_id: p.employee_id ?? undefined,
        kimper_id: p.kimper?.kimper_id ?? undefined,
        ktp_number: p.ktp_number ?? undefined,
        company: p.company ?? undefined,
        department: p.department ?? undefined,
        section: p.section ?? undefined,
        position_title: p.position ?? undefined,
        position_level: p.position_level ?? undefined,
        status: p.status,
        kimper_status: p.kimper?.status ?? p.kimper_status ?? undefined,
        photo_url: p.photo_url ?? undefined,
        qr_code_token: p.qr_code_token ?? undefined,
      },
      employee: {
        id: 0,
        employee_id: p.employee_id || p.person_id,
        name: p.name,
        company: p.company ?? undefined,
        department: p.department ?? undefined,
        section: p.section ?? undefined,
        position: p.position ?? undefined,
        position_level: p.position_level ?? undefined,
        status: p.status || 'Active',
        photo_url: p.photo_url ?? undefined,
        ktp_number: p.ktp_number ?? undefined,
        qr_code_token: p.qr_code_token ?? undefined,
      },
      kimper: p.kimper
        ? {
            kimper_id: p.kimper.kimper_id,
            id_number: p.kimper.id_number ?? undefined,
            card_type_code: p.kimper.card_type_code ?? undefined,
            kimper_expired_date: p.kimper.kimper_expired_date ?? undefined,
            police_license_type: p.kimper.police_license_type ?? undefined,
            police_license_category: p.kimper.police_license_category ?? undefined,
            police_license_expired_date: p.kimper.police_license_expired_date ?? undefined,
            mcu_expire_date: p.kimper.mcu_expire_date ?? undefined,
            hire_date: p.kimper.hire_date ?? undefined,
            status: p.kimper.status ?? undefined,
            units: p.kimper.units,
            authorized_units: p.kimper.units?.join(', '),
            authorized_unit_codes: undefined,
          }
        : undefined,
      training_summary: ts || {
        total: 0,
        valid: 0,
        expired: 0,
        not_yet: 0,
        mandatory_total: 0,
        mandatory_valid: 0,
        expiring: 0,
      },
      training_categories: p.training_categories || [],
      mandatory_trainings: p.mandatory_trainings || undefined,
      extra_trainings: p.extra_trainings || undefined,
      violations: p.violations || [],
      verified_at: now,
      _offline: { cachedAt: cachedAt || Date.now() },
    }
  }

  /**
   * Build a PersonCardData from every offline source we have, richest first.
   *
   * Priority:
   *   1. qrCache (previous online scan — exact cachedAt, full payload)
   *   2. people store (bulk sync — has training/violations)
   *   3. employeeCards store (legacy rich card cache)
   *   4. employees store (basic info only — marked `_partial`)
   *
   * Returns `{ card, source }` or `null` when nothing is available offline.
   */
  async lookupPersonCardOffline(employeeId: string): Promise<{ card: PersonCardData; source: 'qrCache' | 'people' | 'employeeCards' | 'employees' } | null> {
    const normalized = (employeeId || '').trim()
    if (!normalized) return null

    // 1) Richest: previous online scan cached in qrCache.
    const qrCached = await this.getQrCache<PersonCardData>(this.cardCacheKeysFromLookup({ employeeId: normalized }))
    if (qrCached) {
      return { card: { ...qrCached.data, _offline: { cachedAt: qrCached.cachedAt } }, source: 'qrCache' }
    }

    // 2) Bulk-synced people store (contains training/violations).
    const person = await this.lookupPersonByEmployeeId(normalized)
    if (person) {
      const lastSync = await this.getLastSyncTime()
      return { card: this.personToPersonCardData(person, lastSync || Date.now()), source: 'people' }
    }

    // 3) Legacy employeeCards store.
    const card = await this.getEmployeeCardDataOffline(normalized)
    if (card?.success) {
      const lastSync = await this.getLastSyncTime()
      const synthesized: PersonCardData = {
        success: true,
        person: {
          name: card.employee?.name,
          employee_id: card.employee?.employee_id,
          ktp_number: card.employee?.ktp_number,
          company: card.employee?.company,
          department: card.employee?.department,
          section: card.employee?.section,
          position_title: card.employee?.position,
          position_level: card.employee?.position_level,
          status: card.employee?.status,
          kimper_status: card.kimper?.status ?? undefined,
          photo_url: card.employee?.photo_url,
          qr_code_token: card.employee?.qr_code_token,
        },
        employee: card.employee,
        kimper: this.flattenKimperForPerson(card.kimper),
        training_summary: card.training_summary || { total: 0, valid: 0, expired: 0, not_yet: 0, mandatory_total: 0, mandatory_valid: 0, expiring: 0 },
        training_categories: card.training_categories || [],
        mandatory_trainings: card.mandatory_trainings,
        extra_trainings: card.extra_trainings,
        violations: card.violations || [],
        verified_at: card.verified_at || new Date().toISOString(),
        _offline: { cachedAt: lastSync || Date.now() },
      }
      return { card: synthesized, source: 'employeeCards' }
    }

    // 4) Last resort: plain employees store (no training/violations).
    const employee = await this.lookupEmployeeById(normalized)
    if (employee) {
      const now = new Date().toISOString()
      const partialCard: PersonCardData = {
        success: true,
        person: {
          name: employee.name,
          employee_id: employee.employee_id,
          ktp_number: employee.ktp_number,
          company: employee.company,
          department: employee.department,
          section: employee.section,
          position_title: employee.position,
          position_level: employee.position_level,
          status: employee.status,
          photo_url: employee.photo_url,
          qr_code_token: employee.qr_code_token,
        },
        employee: {
          id: employee.id ?? 0,
          employee_id: employee.employee_id,
          name: employee.name,
          company: employee.company,
          department: employee.department,
          section: employee.section,
          position: employee.position,
          position_level: employee.position_level,
          status: employee.status,
          photo_url: employee.photo_url,
          ktp_number: employee.ktp_number,
          qr_code_token: employee.qr_code_token,
        },
        training_summary: {
          total: 0,
          valid: 0,
          expired: 0,
          not_yet: 0,
          mandatory_total: 0,
          mandatory_valid: 0,
          expiring: 0,
        },
        training_categories: [],
        violations: [],
        verified_at: now,
        _offline: { cachedAt: Date.now() },
        _partial: true,
      }
      return { card: partialCard, source: 'employees' }
    }

    return null
  }

  /**
   * Offline-first card resolution for a KIMPER QR scan, keyed by kimper_id.
   * Mirrors lookupPersonCardOffline: qrCache (previous online scan) → bulk
   * people store. Returns a card tagged `_offline` (so the page silently
   * background-refreshes) or null when nothing is cached for this KIMPER.
   */
  async lookupPersonCardOfflineByKimperId(kimperId: number): Promise<PersonCardData | null> {
    if (kimperId == null) return null

    // 1) Richest: a previous online scan cached under this kimper id.
    const qrCached = await this.getQrCache<PersonCardData>(this.cardCacheKeysFromLookup({ kimperId }))
    if (qrCached) {
      return { ...qrCached.data, _offline: { cachedAt: qrCached.cachedAt } }
    }

    // 2) Bulk-synced people store (carries training/violations).
    const person = await this.lookupPersonByKimperId(kimperId)
    if (person) {
      const lastSync = await this.getLastSyncTime()
      return this.personToPersonCardData(person, lastSync || Date.now())
    }

    return null
  }

  /**
   * Fetch full employee card data (profile + training + violations) from API.
   * Called at QR scan time - does NOT require offline sync. On success the full
   * payload is saved locally; on failure/offline the saved copy is returned
   * (tagged with `_offline`).
   */
  async fetchEmployeeCardData(employeeId: string, token: string): Promise<EmployeeCardData | null> {
    try {
      const params = token
        ? `id=${encodeURIComponent(employeeId)}&token=${encodeURIComponent(token)}`
        : `id=${encodeURIComponent(employeeId)}`
      const response = await apiFetch(`/api/mobile/employee/verify?${params}`, { method: 'GET' })
      if (!response.ok) return await this.readEmployeeCardOffline(employeeId)
      const data = await response.json()
      if (!data.success) return await this.readEmployeeCardOffline(employeeId)

      const card = data as EmployeeCardData
      // Persist for offline re-scan (both the per-scan cache and the card store).
      await this.saveEmployeeCardForOffline(card)
      await this.putQrCache(this.cardCacheKeysFromLookup({ employeeId, ktpNumber: card.employee?.ktp_number }), card)
      return card
    } catch (error) {
      console.warn('⚠️ fetchEmployeeCardData failed (offline?):', error)
      return await this.readEmployeeCardOffline(employeeId)
    }
  }

  async fetchPersonCardData(lookup: PersonLookupParams): Promise<PersonCardData | null> {
    try {
      const params = new URLSearchParams()
      if (lookup.personKey) params.set('person_key', lookup.personKey)
      if (lookup.employeeId) params.set('employee_id', lookup.employeeId)
      if (lookup.kimperId != null) params.set('kimper_id', lookup.kimperId.toString())
      if (lookup.ktpNumber) params.set('ktp_number', lookup.ktpNumber)

      if (!params.toString()) {
        return null
      }

      const response = await apiFetch(`/api/mobile/person?${params.toString()}`, { method: 'GET' })
      if (!response.ok) return await this.readPersonCardOffline(lookup)

      const data = await response.json()
      if (!data.success) return await this.readPersonCardOffline(lookup)

      const card = data as PersonCardData
      // Save the full payload under every known identifier so any offline
      // re-scan variant (person_key / employee_id / kimper_id / ktp) resolves.
      await this.putQrCache(this.cardCacheKeysFromPersonData(card), card)
      // Cross-populate the employeeCards store for the EmployeeDetailPage path.
      if (card.employee?.employee_id) await this.saveEmployeeCardForOffline(this.personCardToEmployeeCard(card))
      return card
    } catch (error) {
      console.warn('⚠️ fetchPersonCardData failed (offline?):', error)
      return await this.readPersonCardOffline(lookup)
    }
  }
}

// Employee card data returned from /api/mobile/employee/verify
export interface EmployeeCardData {
  success: boolean
  employee: {
    id: number
    employee_id: string
    name: string
    company?: string
    department?: string
    section?: string
    position?: string
    position_level?: string
    status: string
    qr_code_token?: string
    photo_url?: string
    ktp_number?: string
    photo_source?: string
  }
  kimper?: EmployeeKimperData
  training_summary: TrainingSummary
  training_categories: TrainingCategory[]
  mandatory_trainings?: TrainingItem[]
  extra_trainings?: TrainingItem[]
  violations: EmployeeViolation[]
  verified_at: string
  // Present only when this payload was served from the local offline cache
  // (network unavailable). Drives the "Offline data · Last synced" indicator.
  _offline?: OfflineCacheMeta
}

export interface OfflineCacheMeta {
  cachedAt: number
}

export interface PersonCardData {
  success: boolean
  person: {
    person_key?: string
    name?: string
    employee_id?: string
    kimper_id?: number
    ktp_number?: string
    company?: string
    department?: string
    section?: string
    position_title?: string
    position_level?: string
    status?: string
    match_status?: string
    data_sources?: string
    has_kimper?: string
    kimper_status?: string
    training_status?: string
    training_required?: string
    training_completed?: string
    training_expiry_date?: string
    authorized_units?: string
    authorized_unit_codes?: string
    site_location?: string
    photo_url?: string
    qr_code_token?: string
    lookup_field?: string
  }
  employee: EmployeeCardData['employee']
  // Drop the array-typed unit fields from EmployeeKimperData so the offline
  // converters can supply the flattened string form used by the card UI.
  kimper?: Omit<EmployeeKimperData, 'authorized_units' | 'authorized_unit_codes'> & {
    id_number?: string
    card_type_code?: string
    hire_date?: string
    units?: string[]
    authorized_units?: string
    authorized_unit_codes?: string
  }
  training_summary: TrainingSummary
  training_categories: TrainingCategory[]
  mandatory_trainings?: TrainingItem[]
  extra_trainings?: TrainingItem[]
  violations: EmployeeViolation[]
  verified_at: string
  // Present only when served from the local offline cache (see EmployeeCardData).
  _offline?: OfflineCacheMeta
  // Present only when the record was built from a partial offline source
  // (e.g. the employees store with no training/violations data). Triggers
  // the "No offline data available" UI instead of rendering fake zeros.
  _partial?: boolean
}

// Type definitions
interface SyncResult {
  success: boolean
  message: string
  data?: OfflineDataPackage
  error?: Error
  cached?: boolean
}

interface SyncStatus {
  status: 'syncing' | 'complete' | 'error'
  progress?: number
  stage?: string
  data?: OfflineDataPackage
  error?: Error
}

interface OfflineSyncStatus {
  hasData: boolean
  lastSync: number
  totalRecords: number
  vehiclesCount?: number
  kimperCount?: number
  employeesCount?: number
  employeeCardsCount?: number
  dataVersion?: string
  isStale?: boolean
}

// Export singleton instance
export const offlineDataSync = new OfflineDataSyncService()
export type {
  VehicleFullInfo as VehicleBasicInfo,
  KimperFullInfo as KimperMapping,
  SyncResult,
  SyncStatus,
  OfflineSyncStatus
}

// RecentInspection interface (for backwards compatibility)
export interface RecentInspection {
  id: number
  vehicle_equip_no: string
  inspection_date: string
  inspector_name: string
  status: string
  star_rating?: number
  notes?: string
}
