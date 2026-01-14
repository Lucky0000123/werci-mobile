import { useState, useEffect } from 'react'
import { offlineDataManager } from '../services/offlineDataManager'
import { getDB } from '../services/db'
import { syncService } from '../services/sync'
import './DataManagementPanel.css'

interface DataStats {
  totalSize: number
  vehicleCount: number
  kimperCount: number
  inspectionCount: number
  photoCount: number
  pendingSyncCount: number
  failedSyncCount: number
  lastCleanup: number
  cacheHitRate: number
}

interface SyncStatus {
  isOnline: boolean
  isSyncing: boolean
  lastSync: number | null
  pendingItems: number
  failedItems: number
}

export default function DataManagementPanel() {
  const [stats, setStats] = useState<DataStats | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    loadStats()

    // Auto-refresh every 10 seconds to catch sync updates
    const interval = setInterval(loadStats, 10000)
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    if (!isRefreshing) {
      setIsLoading(true)
    }

    try {
      // Get offline data stats (vehicles, KIMPER)
      const dataStats = await offlineDataManager.getDataStats()

      // Get inspection and photo counts from werck-mobile database
      const db = await getDB()
      const inspections = await db.getAll('inspections')
      const photos = await db.getAll('photos')
      const syncQueue = await db.getAll('syncQueue')

      // Get sync status
      const syncStat = await syncService.getStatus()
      setSyncStatus(syncStat)

      // Count pending and failed sync items
      const failedItems = syncQueue.filter(item => item.retries >= 3)

      // Calculate total size including inspections and photos
      const inspectionSize = JSON.stringify(inspections).length
      const photoSize = JSON.stringify(photos).length
      const totalSize = dataStats.totalSize + inspectionSize + photoSize

      setStats({
        ...dataStats,
        totalSize,
        inspectionCount: inspections.length,
        photoCount: photos.length,
        pendingSyncCount: syncQueue.length,
        failedSyncCount: failedItems.length
      })
    } catch (error) {
      console.error('Failed to load data stats:', error)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await loadStats()
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatLastSync = (timestamp: number | null): string => {
    if (!timestamp) return 'Never'
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  const getCacheStatus = (): 'PASS' | 'RE-COMMISSION SOON' | 'EXPIRED' => {
    if (!stats) return 'EXPIRED'

    const sizeMB = stats.totalSize / (1024 * 1024)
    if (sizeMB < 30) return 'PASS'
    if (sizeMB < 45) return 'RE-COMMISSION SOON'
    return 'EXPIRED'
  }

  if (isLoading && !stats) {
    return (
      <div className="data-management-panel">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading data statistics...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="data-management-panel">
      {/* Modern Header with Gradient */}
      <div className="panel-header-modern">
        <div className="header-content">
          <div className="header-icon-modern">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" fill="currentColor"/>
            </svg>
          </div>
          <div className="header-info-modern">
            <h2>Data Management</h2>
            <p>Manage offline storage</p>
          </div>
        </div>
        <button
          className={`refresh-button-modern ${isRefreshing ? 'refreshing' : ''}`}
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh data statistics"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
          </svg>
        </button>
      </div>

      {stats && (
        <>
          {/* Storage Overview Card */}
          <div className="storage-card-modern">
            <div className="card-header">
              <div className="card-icon">💾</div>
              <div className="card-title">
                <h3>Storage Overview</h3>
                <span className="card-subtitle">{formatBytes(stats.totalSize)} used</span>
              </div>
              <div className={`status-badge-modern ${getCacheStatus() === 'PASS' ? 'success' : getCacheStatus() === 'RE-COMMISSION SOON' ? 'warning' : 'error'}`}>
                {getCacheStatus() === 'PASS' ? '✓ PASS' : getCacheStatus()}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="storage-progress">
              <div
                className="storage-progress-bar"
                style={{
                  width: `${Math.min((stats.totalSize / (50 * 1024 * 1024)) * 100, 100)}%`,
                  background: getCacheStatus() === 'PASS'
                    ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                    : getCacheStatus() === 'RE-COMMISSION SOON'
                    ? 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)'
                    : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'
                }}
              />
            </div>
            <div className="storage-limit">
              <span>{formatBytes(stats.totalSize)}</span>
              <span className="limit-text">of 50 MB limit</span>
            </div>
          </div>

          {/* Storage Info Text */}
          <div className="storage-info-text">
            <div className="info-row">
              <span className="info-label">Total Storage Used:</span>
              <span className="info-value">{formatBytes(stats.totalSize)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Vehicles Cached:</span>
              <span className="info-value">{stats.vehicleCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">KIMPER Codes:</span>
              <span className="info-value">{stats.kimperCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Offline Inspections:</span>
              <span className="info-value">{stats.inspectionCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Photos Stored:</span>
              <span className="info-value">{stats.photoCount}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Pending Sync:</span>
              <span className="info-value">{stats.pendingSyncCount || 0}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Failed Sync:</span>
              <span className="info-value error">{stats.failedSyncCount || 0}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Connection Status:</span>
              <span className={`info-value ${syncStatus?.isOnline ? 'online' : 'offline'}`}>
                {syncStatus?.isOnline ? '🟢 Online' : '🔴 Offline'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Last Sync:</span>
              <span className="info-value">{formatLastSync(syncStatus?.lastSync || null)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
