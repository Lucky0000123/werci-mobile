import { useState, useEffect } from 'react'
import { syncService, type SyncStatus } from '../services/sync'

export default function SyncStatusComponent() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSync: null,
    pendingItems: 0,
    failedItems: 0
  })

  useEffect(() => {
    const unsubscribe = syncService.onStatusChange(setStatus)
    return unsubscribe
  }, [])

  const handleForceSync = async () => {
    try {
      await syncService.forcSync()
    } catch (error) {
      alert('Sync failed: ' + (error as Error).message)
    }
  }

  const handleRetryFailed = async () => {
    try {
      await syncService.retryFailedItems()
    } catch (error) {
      alert('Retry failed: ' + (error as Error).message)
    }
  }

  const handleClearFailed = async () => {
    if (confirm('Clear all failed sync items? This cannot be undone.')) {
      await syncService.clearFailedItems()
    }
  }

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  const getStatusColor = () => {
    if (!status.isOnline) return '#dc3545' // Red for offline
    if (status.isSyncing) return '#ffc107' // Yellow for syncing
    if (status.failedItems > 0) return '#fd7e14' // Orange for failed items
    if (status.pendingItems > 0) return '#17a2b8' // Blue for pending
    return '#28a745' // Green for all good
  }

  const getStatusText = () => {
    if (!status.isOnline) return 'Offline'
    if (status.isSyncing) return 'Syncing...'
    if (status.failedItems > 0) return `${status.failedItems} failed`
    if (status.pendingItems > 0) return `${status.pendingItems} pending`
    return 'Synced'
  }

  return (
    <div style={{
      backgroundColor: '#f8fafc',
      border: `1px solid ${getStatusColor()}`,
      borderRadius: '8px',
      padding: '12px 16px',
      fontSize: '13px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      marginBottom: '16px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '4px'
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: getStatusColor(),
          animation: status.isSyncing ? 'pulse 1.5s infinite' : 'none'
        }} />
        <span style={{ fontWeight: 'bold', color: getStatusColor() }}>
          {getStatusText()}
        </span>
      </div>
      
      <div style={{ color: '#666', fontSize: '10px' }}>
        Last sync: {formatLastSync(status.lastSync)}
      </div>

      {(status.pendingItems > 0 || status.failedItems > 0) && (
        <div style={{ marginTop: '8px', display: 'flex', gap: '4px' }}>
          {status.isOnline && !status.isSyncing && (
            <button
              onClick={handleForceSync}
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                border: '1px solid #007bff',
                backgroundColor: '#007bff',
                color: 'white',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Sync Now
            </button>
          )}
          
          {status.failedItems > 0 && (
            <>
              <button
                onClick={handleRetryFailed}
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  border: '1px solid #fd7e14',
                  backgroundColor: '#fd7e14',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Retry
              </button>
              <button
                onClick={handleClearFailed}
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  border: '1px solid #dc3545',
                  backgroundColor: 'transparent',
                  color: '#dc3545',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
