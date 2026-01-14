import { useState, useEffect } from 'react'
import { offlineDataSync, type SyncStatus, type OfflineSyncStatus } from '../services/offlineDataSync'
import './OfflineDataSyncButton.css'

export default function OfflineDataSyncButton() {
  const [syncStatus, setSyncStatus] = useState<OfflineSyncStatus>({ hasData: false, lastSync: 0, totalRecords: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [lastSyncMessage, setLastSyncMessage] = useState('')

  useEffect(() => {
    // Load initial sync status
    loadSyncStatus()

    // Listen for sync updates
    const handleSyncUpdate = (status: SyncStatus) => {
      if (status.status === 'syncing') {
        setIsLoading(true)
      } else if (status.status === 'complete') {
        setIsLoading(false)
        setLastSyncMessage(`✅ Synced ${status.data?.totalRecords || 0} records`)
        loadSyncStatus() // Refresh status

        // Clear success message after 3 seconds
        setTimeout(() => setLastSyncMessage(''), 3000)
      } else if (status.status === 'error') {
        setIsLoading(false)
        setLastSyncMessage(`❌ Sync failed: ${status.error?.message || 'Unknown error'}`)

        // Clear error message after 5 seconds
        setTimeout(() => setLastSyncMessage(''), 5000)
      }
    }

    offlineDataSync.addSyncListener(handleSyncUpdate)

    return () => {
      offlineDataSync.removeSyncListener(handleSyncUpdate)
    }
  }, [])

  const loadSyncStatus = async () => {
    try {
      const status = await offlineDataSync.getSyncStatus()
      setSyncStatus(status)
    } catch (error) {
      console.error('Failed to load sync status:', error)
    }
  }

  const handleSync = async (force = false) => {
    if (isLoading) return

    setIsLoading(true)
    setLastSyncMessage('')

    try {
      const result = await offlineDataSync.syncOfflineData(force)

      if (result.success) {
        if (result.cached) {
          setLastSyncMessage('📋 Data is already fresh')
          setTimeout(() => setLastSyncMessage(''), 3000)
        }
        // Success message handled by sync listener
      } else {
        setLastSyncMessage(`❌ ${result.message}`)
        setTimeout(() => setLastSyncMessage(''), 5000)
      }
    } catch (error) {
      setLastSyncMessage(`❌ Sync failed: ${(error as Error).message}`)
      setTimeout(() => setLastSyncMessage(''), 5000)
    } finally {
      setIsLoading(false)
    }
  }

  const formatLastSync = (timestamp: number) => {
    if (!timestamp) return 'Never'
    
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  const getSyncButtonText = () => {
    if (isLoading) return 'Syncing...'
    if (!syncStatus.hasData) return 'Initial Sync'
    if (syncStatus.isStale) return 'Update Data'
    return 'Refresh Data'
  }

  const getSyncButtonIcon = () => {
    if (!syncStatus.hasData) return '📥'
    if (syncStatus.isStale) return '🔄'
    return '✅'
  }

  return (
    <div className="offline-sync-container">
      {/* Modern Card-Style Sync Buttons */}
      <div className="sync-button-group">
        <button
          className={`modern-sync-button primary ${isLoading ? 'syncing' : ''}`}
          onClick={() => handleSync(!syncStatus.hasData)}
          disabled={isLoading}
          title={`Last sync: ${formatLastSync(syncStatus.lastSync)} | Records: ${syncStatus.totalRecords}`}
          style={{
            background: syncStatus.isStale
              ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
              : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            padding: '18px 25px',
            fontSize: '16px',
            fontWeight: '700',
            boxShadow: syncStatus.isStale
              ? '0 6px 20px rgba(245, 158, 11, 0.4)'
              : '0 6px 20px rgba(16, 185, 129, 0.4)'
          }}
        >
          {isLoading && (
            <>
              <div className="ripple-wave"></div>
              <div className="ripple-wave delay-1"></div>
              <div className="ripple-wave delay-2"></div>
            </>
          )}
          <div className="button-icon">
            {isLoading ? (
              <div className="sync-loader">
                <div className="orbit-spinner">
                  <div className="orbit"></div>
                  <div className="orbit"></div>
                  <div className="orbit"></div>
                </div>
              </div>
            ) : (
              <span className="icon-large" style={{ fontSize: '24px' }}>{getSyncButtonIcon()}</span>
            )}
          </div>
          <div className="button-text">
            {getSyncButtonText()}
          </div>
        </button>

        {/* Force Sync Button (smaller) */}
        {syncStatus.hasData && (
          <button
            className={`modern-sync-button secondary ${isLoading ? 'syncing' : ''}`}
            onClick={() => handleSync(true)}
            disabled={isLoading}
            title="Force full sync (ignores cache)"
            style={{
              padding: '12px 18px',
              fontSize: '14px'
            }}
          >
            {isLoading && (
              <>
                <div className="ripple-wave"></div>
                <div className="ripple-wave delay-1"></div>
              </>
            )}
            <div className="button-icon">
              {isLoading ? (
                <div className="sync-loader">
                  <div className="swirl-spinner">
                    <div className="swirl"></div>
                  </div>
                </div>
              ) : (
                <span className="icon-small">🔄</span>
              )}
            </div>
            <div className="button-text">
              Force Sync
            </div>
          </button>
        )}
      </div>

      {/* Status Information */}
      <div className="sync-status-info">
        {lastSyncMessage && (
          <div className="sync-message">{lastSyncMessage}</div>
        )}

        {!isLoading && syncStatus.hasData && (
          <div className="sync-details">
            <small className="text-muted">
              📊 {syncStatus.totalRecords} records •
              🕒 {formatLastSync(syncStatus.lastSync)}
              {syncStatus.isStale && <span className="text-warning"> • Stale</span>}
            </small>
          </div>
        )}
      </div>
    </div>
  )
}
