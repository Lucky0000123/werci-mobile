import { useState, useEffect } from 'react'
import { offlineDataSync, type SyncStatus, type OfflineSyncStatus } from '../services/offlineDataSync'
import { useI18n } from '../services/i18n-context'
import './OfflineDataSyncButton.css'

export default function OfflineDataSyncButton() {
  const { t } = useI18n()
  const [syncStatus, setSyncStatus] = useState<OfflineSyncStatus>({ hasData: false, lastSync: 0, totalRecords: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [lastSyncMessage, setLastSyncMessage] = useState('')
  const [syncDetails, setSyncDetails] = useState({ vehicles: 0, kimper: 0, employees: 0 })

  useEffect(() => {
    loadSyncStatus()

    const handleSyncUpdate = (status: SyncStatus) => {
      if (status.status === 'syncing') {
        setIsLoading(true)
      } else if (status.status === 'complete') {
        setIsLoading(false)
        // Two completion shapes:
        //   - Legacy/memory-mode sync: the full data package is attached and
        //     counts come directly from `status.data.syncDetails`.
        //   - Chunked/delta sync: data lives in IDB (we don't want to pull
        //     arrays back into RAM just for a toast), so re-read from the
        //     sync-status metadata to build the message.
        if (status.data) {
          setSyncDetails({
            vehicles: status.data.syncDetails?.vehiclesCount || 0,
            kimper: status.data.syncDetails?.kimperCount || 0,
            employees: status.data.syncDetails?.employeesCount || 0
          })
          setLastSyncMessage(`Synced ${(status.data.totalRecords || 0).toLocaleString()} records`)
        } else {
          offlineDataSync.getSyncStatus().then((fresh) => {
            setSyncStatus(fresh)
            setSyncDetails({
              vehicles: fresh.vehiclesCount || 0,
              kimper: fresh.kimperCount || 0,
              employees: fresh.employeesCount || 0
            })
            setLastSyncMessage(`Synced ${(fresh.totalRecords || 0).toLocaleString()} records`)
          }).catch(() => {
            setLastSyncMessage('Sync complete')
          })
        }
        loadSyncStatus()
        setTimeout(() => setLastSyncMessage(''), 3000)
      } else if (status.status === 'error') {
        setIsLoading(false)
        setLastSyncMessage(status.error?.message || 'Sync failed')
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
      if (result.success && result.cached) {
        setLastSyncMessage('Data is already fresh')
        setTimeout(() => setLastSyncMessage(''), 2500)
      }
      if (!result.success) {
        setLastSyncMessage(result.message)
        setTimeout(() => setLastSyncMessage(''), 5000)
      }
    } catch (error) {
      setLastSyncMessage((error as Error).message)
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
    return t('justNow') || 'Just now'
  }

  const getSyncButtonText = () => {
    if (isLoading) return t('syncing') || 'Syncing...'
    if (!syncStatus.hasData) return 'Initial Sync'
    if (syncStatus.isStale) return 'Update Data'
    return 'Refresh Data'
  }

  return (
    <div className="offline-sync-container">
      <div className="sync-card" style={{
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '16px',
        padding: '16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.26)',
        border: '1px solid rgba(255,255,255,0.09)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: '#FFC55A',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#050a12',
              fontSize: '0.62rem',
              fontWeight: 800
            }}>
              SY
            </span>
            <span style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.92rem' }}>
              Offline Data
            </span>
          </div>
          {syncStatus.hasData && (
            <span style={{
              fontSize: '0.72rem',
              color: syncStatus.isStale ? '#f59e0b' : '#22c55e',
              background: syncStatus.isStale ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(255,255,255,0.14)',
              padding: '4px 8px',
              borderRadius: '12px'
            }}>
              {syncStatus.isStale ? 'Stale' : 'Fresh'}
            </span>
          )}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          marginBottom: '12px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.08rem', fontWeight: 800, color: '#FC4100' }}>
              {isLoading ? syncDetails.vehicles : (syncStatus.vehiclesCount || 0)}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#8b9ab0' }}>{t('vehicles')}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.08rem', fontWeight: 800, color: '#22c55e' }}>
              {isLoading ? syncDetails.kimper : (syncStatus.kimperCount || 0)}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#8b9ab0' }}>KIMPER</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.08rem', fontWeight: 800, color: '#FFC55A' }}>
              {isLoading ? syncDetails.employees : (syncStatus.employeesCount || 0)}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#8b9ab0' }}>{t('employees')}</div>
          </div>
        </div>

        <div style={{
          fontSize: '0.75rem',
          color: '#8b9ab0',
          marginBottom: '12px',
          textAlign: 'center'
        }}>
          {syncStatus.lastSync ? `Last sync: ${formatLastSync(syncStatus.lastSync)}` : 'Not synced yet'}
        </div>

        <button
          onClick={() => handleSync(!syncStatus.hasData)}
          disabled={isLoading}
          aria-label={isLoading ? 'Syncing in progress' : getSyncButtonText()}
          style={{
            width: '100%',
            padding: '12px',
            background: isLoading
              ? '#1f2937'
              : syncStatus.isStale
                ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                : 'linear-gradient(135deg, #FC4100 0%, #d93600 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '44px'
          }}
        >
          {isLoading ? (
            <span
              aria-hidden="true"
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                border: '2.5px solid rgba(148,163,184,0.25)',
                borderTopColor: '#94a3b8',
                animation: 'spin 0.9s linear infinite',
                display: 'inline-block'
              }}
            />
          ) : (
            getSyncButtonText()
          )}
        </button>

        {syncStatus.hasData && !isLoading && (
          <button
            onClick={() => handleSync(true)}
            style={{
              width: '100%',
              marginTop: '8px',
              padding: '8px',
              background: 'transparent',
              color: '#8b9ab0',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            Force Sync
          </button>
        )}
      </div>

      {lastSyncMessage && (
        <div style={{
          marginTop: '8px',
          padding: '8px 12px',
          background: lastSyncMessage.toLowerCase().includes('fail') ? 'rgba(239,68,68,0.16)' : 'rgba(34,197,94,0.16)',
          color: lastSyncMessage.toLowerCase().includes('fail') ? '#fca5a5' : '#86efac',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '8px',
          fontSize: '0.8rem',
          textAlign: 'center'
        }}>
          {lastSyncMessage}
        </div>
      )}
    </div>
  )
}
