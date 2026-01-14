import { useState, useEffect } from 'react'
import './ConnectionStatusChip.css'

interface ConnectionStatus {
  isOnline: boolean
  currentMode: 'cloud' | 'local' | 'offline'
  cloudAvailable: boolean
  localAvailable: boolean
  lastChecked: number
  responseTime?: number
}

export default function ConnectionStatusChip() {
  const [status, setStatus] = useState<ConnectionStatus>({
    isOnline: false,
    currentMode: 'offline',
    cloudAvailable: false,
    localAvailable: false,
    lastChecked: 0
  })

  useEffect(() => {
    // Check if connectionManager is available
    const checkConnectionStatus = async () => {
      try {
        // Try to get status from connectionManager if available
        if (typeof window !== 'undefined' && (window as any).connectionManager) {
          const connectionManager = (window as any).connectionManager
          const currentStatus = connectionManager.getStatus()
          setStatus(currentStatus)
        } else {
          // Fallback: simple online/offline detection
          const isOnline = navigator.onLine
          setStatus(prev => ({
            ...prev,
            isOnline,
            currentMode: isOnline ? 'cloud' : 'offline',
            lastChecked: Date.now()
          }))
        }
      } catch (error) {
        console.warn('Connection status check failed:', error)
      }
    }

    // Initial check
    checkConnectionStatus()

    // Set up periodic checks
    const interval = setInterval(checkConnectionStatus, 30000) // Every 30 seconds

    // Listen for online/offline events
    const handleOnline = () => checkConnectionStatus()
    const handleOffline = () => setStatus(prev => ({ ...prev, currentMode: 'offline', isOnline: false }))

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const getStatusIcon = () => {
    switch (status.currentMode) {
      case 'cloud':
        return '☁️'
      case 'local':
        return '🏢'
      case 'offline':
        return '📴'
      default:
        return '❓'
    }
  }

  const getStatusText = () => {
    switch (status.currentMode) {
      case 'cloud':
        return 'Cloud'
      case 'local':
        return 'Local'
      case 'offline':
        return 'Offline'
      default:
        return 'Unknown'
    }
  }

  const getStatusColor = () => {
    switch (status.currentMode) {
      case 'cloud':
        return '#10B981' // Green
      case 'local':
        return '#3B82F6' // Blue
      case 'offline':
        return '#EF4444' // Red
      default:
        return '#6B7280' // Gray
    }
  }

  const formatResponseTime = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  return (
    <div 
      className="connection-status-chip"
      style={{
        backgroundColor: getStatusColor(),
        color: 'white',
        padding: '4px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '500',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        minWidth: '80px',
        justifyContent: 'center'
      }}
      title={`Mode: ${getStatusText()}${status.responseTime ? ` (${formatResponseTime(status.responseTime)})` : ''}\nLast checked: ${new Date(status.lastChecked).toLocaleTimeString()}`}
    >
      <span>{getStatusIcon()}</span>
      <span>{getStatusText()}</span>
      {status.responseTime && (
        <span style={{ fontSize: '10px', opacity: 0.8 }}>
          {formatResponseTime(status.responseTime)}
        </span>
      )}
    </div>
  )
}
