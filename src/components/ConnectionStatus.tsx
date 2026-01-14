// Connection Status Display Component
import React, { useState, useEffect } from 'react'
import connectionManager, { type ConnectionStatus } from '../services/connectionManager'
import offlineStorage from '../services/offlineStorage'

interface ConnectionStatusProps {
  showDetails?: boolean
  className?: string
}

export const ConnectionStatusComponent: React.FC<ConnectionStatusProps> = ({ 
  showDetails = false, 
  className = '' 
}) => {
  const [status, setStatus] = useState<ConnectionStatus>(connectionManager.getStatus())
  const [storageStats, setStorageStats] = useState<any>(null)
  const [showTestPanel, setShowTestPanel] = useState(false)

  useEffect(() => {
    // Listen for connection status changes
    const handleStatusChange = (newStatus: ConnectionStatus) => {
      setStatus(newStatus)
    }

    connectionManager.addStatusListener(handleStatusChange)

    // Load storage stats
    loadStorageStats()

    return () => {
      connectionManager.removeStatusListener(handleStatusChange)
    }
  }, [])

  const loadStorageStats = async () => {
    try {
      const stats = await offlineStorage.getStorageStats()
      setStorageStats(stats)
    } catch (error) {
      console.error('Failed to load storage stats:', error)
    }
  }

  const getStatusColor = () => {
    switch (status.currentMode) {
      case 'local': return '#28a745' // Green
      case 'cloud': return '#007bff' // Blue
      case 'offline': return '#6c757d' // Gray
      default: return '#6c757d'
    }
  }

  const getStatusIcon = () => {
    switch (status.currentMode) {
      case 'local': return '🏢' // Building for local server
      case 'cloud': return '☁️' // Cloud
      case 'offline': return '📱' // Phone for offline
      default: return '❓'
    }
  }

  const getStatusText = () => {
    switch (status.currentMode) {
      case 'local': return 'Local Server'
      case 'cloud': return 'Cloud Server'
      case 'offline': return 'Offline Mode'
      default: return 'Unknown'
    }
  }

  const handleForceCheck = async () => {
    try {
      await connectionManager.forceCheck()
      await loadStorageStats()
    } catch (error) {
      console.error('Force check failed:', error)
    }
  }

  const handleSimulateOffline = () => {
    connectionManager.simulateOffline()
  }

  const handleRestoreConnectivity = () => {
    connectionManager.restoreConnectivity()
  }

  const handleSyncData = async () => {
    try {
      const success = await offlineStorage.syncFromServer(connectionManager)
      if (success) {
        await loadStorageStats()
        alert('✅ Data sync completed successfully!')
      } else {
        alert('❌ Data sync failed. Check connection and try again.')
      }
    } catch (error) {
      console.error('Sync failed:', error)
      alert('❌ Data sync failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <div className={`connection-status ${className}`}>
      {/* Main Status Display */}
      <div 
        className="status-indicator"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderRadius: '20px',
          border: `2px solid ${getStatusColor()}`,
          fontSize: '14px',
          fontWeight: '500',
          cursor: showDetails ? 'pointer' : 'default'
        }}
        onClick={() => showDetails && setShowTestPanel(!showTestPanel)}
      >
        <span style={{ fontSize: '16px' }}>{getStatusIcon()}</span>
        <span style={{ color: getStatusColor() }}>{getStatusText()}</span>
        {status.responseTime && (
          <span style={{ color: '#666', fontSize: '12px' }}>
            ({status.responseTime}ms)
          </span>
        )}
        {showDetails && (
          <span style={{ color: '#666', fontSize: '12px' }}>⚙️</span>
        )}
      </div>

      {/* Detailed Test Panel */}
      {showTestPanel && showDetails && (
        <div 
          className="test-panel"
          style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            right: '0',
            backgroundColor: 'white',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            marginTop: '8px'
          }}
        >
          <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>
            🔧 Connection Testing
          </h4>

          {/* Connection Status Details */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>🏢 Local Server:</span>
              <span style={{ color: status.localAvailable ? '#28a745' : '#dc3545' }}>
                {status.localAvailable ? '✅ Available' : '❌ Unavailable'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>☁️ Cloud Server:</span>
              <span style={{ color: status.cloudAvailable ? '#28a745' : '#dc3545' }}>
                {status.cloudAvailable ? '✅ Available' : '❌ Unavailable'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>📊 Last Check:</span>
              <span style={{ color: '#666', fontSize: '12px' }}>
                {status.lastChecked ? new Date(status.lastChecked).toLocaleTimeString() : 'Never'}
              </span>
            </div>
          </div>

          {/* Storage Statistics */}
          {storageStats && (
            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
              <h5 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#333' }}>
                📦 Offline Storage
              </h5>
              <div style={{ fontSize: '12px', color: '#666' }}>
                <div>Vehicles: {storageStats.totalVehicles}</div>
                <div>QR Cache: {storageStats.totalQRCache}</div>
                <div>Cache Size: {storageStats.cacheSize}</div>
                {storageStats.lastSync && (
                  <div>Last Sync: {new Date(storageStats.lastSync).toLocaleString()}</div>
                )}
              </div>
            </div>
          )}

          {/* Test Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={handleForceCheck}
              style={{
                padding: '8px 12px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              🔍 Test Connectivity
            </button>

            <button
              onClick={handleSyncData}
              disabled={!status.isOnline}
              style={{
                padding: '8px 12px',
                backgroundColor: status.isOnline ? '#28a745' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: status.isOnline ? 'pointer' : 'not-allowed'
              }}
            >
              🔄 Sync Data
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSimulateOffline}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: '#ffc107',
                  color: '#000',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                📵 Simulate Offline
              </button>

              <button
                onClick={handleRestoreConnectivity}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                📶 Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConnectionStatusComponent
