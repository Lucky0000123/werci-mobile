// Comprehensive Network Testing and Offline QR Testing Panel
import React, { useState, useEffect } from 'react'
import connectionManager, { type ConnectionStatus } from '../services/connectionManager'
import offlineStorage from '../services/offlineStorage'
import offlineQRService from '../services/offlineQRService'

interface TestResult {
  test: string
  status: 'pass' | 'fail' | 'warning'
  message: string
  details?: any
}

export const NetworkTestingPanel: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false)
  const [isRunningTests, setIsRunningTests] = useState(false)
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(connectionManager.getStatus())

  useEffect(() => {
    const handleStatusChange = (status: ConnectionStatus) => {
      setConnectionStatus(status)
    }

    connectionManager.addStatusListener(handleStatusChange)
    return () => connectionManager.removeStatusListener(handleStatusChange)
  }, [])

  const runComprehensiveTests = async () => {
    setIsRunningTests(true)
    const results: TestResult[] = []

    try {
      // Test 1: Connection Testing
      results.push({
        test: 'Connection Testing',
        status: 'pass',
        message: 'Starting connectivity tests...'
      })

      const connectivityStatus = await connectionManager.forceCheck()
      
      results.push({
        test: 'Local Server Connectivity',
        status: connectivityStatus.localAvailable ? 'pass' : 'fail',
        message: connectivityStatus.localAvailable 
          ? `✅ Local server (10.40.21.184) is reachable`
          : `❌ Local server (10.40.21.184) is unreachable`,
        details: { responseTime: connectivityStatus.responseTime }
      })

      results.push({
        test: 'Cloud Server Connectivity',
        status: connectivityStatus.cloudAvailable ? 'pass' : 'fail',
        message: connectivityStatus.cloudAvailable 
          ? `✅ Cloud server (159.65.13.232) is reachable`
          : `❌ Cloud server (159.65.13.232) is unreachable`,
        details: { responseTime: connectivityStatus.responseTime }
      })

      // Test 2: Offline Storage
      results.push({
        test: 'Offline Storage Initialization',
        status: 'pass',
        message: 'Testing offline storage...'
      })

      try {
        await offlineStorage.initialize()
        const stats = await offlineStorage.getStorageStats()
        
        results.push({
          test: 'Offline Storage Status',
          status: stats.totalVehicles > 0 ? 'pass' : 'warning',
          message: stats.totalVehicles > 0 
            ? `✅ ${stats.totalVehicles} vehicles cached (${stats.cacheSize})`
            : `⚠️ No vehicles cached - sync needed`,
          details: stats
        })
      } catch (error) {
        results.push({
          test: 'Offline Storage Status',
          status: 'fail',
          message: `❌ Storage error: ${error instanceof Error ? error.message : String(error)}`
        })
      }

      // Test 3: Data Sync (if online)
      if (connectivityStatus.isOnline) {
        results.push({
          test: 'Data Synchronization',
          status: 'pass',
          message: 'Testing data sync...'
        })

        try {
          const syncSuccess = await offlineStorage.syncFromServer(connectionManager)
          
          results.push({
            test: 'Vehicle Data Sync',
            status: syncSuccess ? 'pass' : 'fail',
            message: syncSuccess 
              ? `✅ Vehicle data synced successfully`
              : `❌ Vehicle data sync failed`
          })

          if (syncSuccess) {
            const updatedStats = await offlineStorage.getStorageStats()
            results.push({
              test: 'Post-Sync Storage',
              status: 'pass',
              message: `✅ ${updatedStats.totalVehicles} vehicles now cached`,
              details: updatedStats
            })
          }
        } catch (error) {
          results.push({
            test: 'Vehicle Data Sync',
            status: 'fail',
            message: `❌ Sync failed: ${error instanceof Error ? error.message : String(error)}`
          })
        }
      } else {
        results.push({
          test: 'Data Synchronization',
          status: 'warning',
          message: '⚠️ Skipped - no network connection'
        })
      }

      // Test 4: QR Code Functionality
      results.push({
        test: 'QR Code Testing',
        status: 'pass',
        message: 'Testing QR code functionality...'
      })

      try {
        const qrTestResults = await offlineQRService.testQRScanning()
        
        results.push({
          test: 'QR Code Parsing',
          status: qrTestResults.summary.successful > 0 ? 'pass' : 'fail',
          message: `${qrTestResults.summary.successful}/${qrTestResults.summary.total} QR codes parsed successfully`,
          details: qrTestResults
        })

        // Test specific QR formats
        const testFormats = [
          'EQUIP:TEST001',
          'https://werci.com/vehicles/TEST002',
          'DIRECT123'
        ]

        for (const qrCode of testFormats) {
          const parseResult = offlineQRService.parseQRCode(qrCode)
          results.push({
            test: `QR Format: ${qrCode}`,
            status: parseResult ? 'pass' : 'fail',
            message: parseResult 
              ? `✅ Parsed as: ${parseResult}`
              : `❌ Failed to parse`,
            details: { input: qrCode, output: parseResult }
          })
        }
      } catch (error) {
        results.push({
          test: 'QR Code Testing',
          status: 'fail',
          message: `❌ QR test failed: ${error instanceof Error ? error.message : String(error)}`
        })
      }

      // Test 5: Offline Mode Simulation
      results.push({
        test: 'Offline Mode Testing',
        status: 'pass',
        message: 'Testing offline functionality...'
      })

      // Simulate offline mode
      connectionManager.simulateOffline()
      
      // Wait a moment for status to update
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const offlineStatus = connectionManager.getStatus()
      results.push({
        test: 'Offline Mode Simulation',
        status: offlineStatus.currentMode === 'offline' ? 'pass' : 'fail',
        message: offlineStatus.currentMode === 'offline'
          ? '✅ Successfully entered offline mode'
          : '❌ Failed to enter offline mode'
      })

      // Test offline QR scanning
      try {
        const offlineQRResult = await offlineQRService.scanQRCode('EQUIP:TEST001')
        results.push({
          test: 'Offline QR Scanning',
          status: offlineQRResult.success ? 'pass' : 'warning',
          message: offlineQRResult.success
            ? `✅ QR scan successful in offline mode`
            : `⚠️ ${offlineQRResult.error}`,
          details: offlineQRResult
        })
      } catch (error) {
        results.push({
          test: 'Offline QR Scanning',
          status: 'fail',
          message: `❌ Offline QR scan failed: ${error instanceof Error ? error.message : String(error)}`
        })
      }

      // Restore connectivity
      connectionManager.restoreConnectivity()
      
      results.push({
        test: 'Connectivity Restoration',
        status: 'pass',
        message: '✅ Connectivity testing completed'
      })

    } catch (error) {
      results.push({
        test: 'Test Suite Error',
        status: 'fail',
        message: `❌ Test suite failed: ${error instanceof Error ? error.message : String(error)}`
      })
    }

    setTestResults(results)
    setIsRunningTests(false)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass': return '✅'
      case 'fail': return '❌'
      case 'warning': return '⚠️'
      default: return '❓'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pass': return '#28a745'
      case 'fail': return '#dc3545'
      case 'warning': return '#ffc107'
      default: return '#6c757d'
    }
  }

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '60px',
          height: '60px',
          fontSize: '24px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000
        }}
        title="Open Network Testing Panel"
      >
        🔧
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '400px',
        maxHeight: '80vh',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        zIndex: 1000,
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          backgroundColor: '#f8f9fa',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '18px', color: '#333' }}>
          🔧 Network Testing Panel
        </h3>
        <button
          onClick={() => setIsVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#666'
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px', maxHeight: '60vh', overflowY: 'auto' }}>
        {/* Current Status */}
        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#333' }}>
            📊 Current Status
          </h4>
          <div style={{ fontSize: '12px', color: '#666' }}>
            <div>Mode: <strong style={{ color: getStatusColor(connectionStatus.isOnline ? 'pass' : 'warning') }}>
              {connectionStatus.currentMode.toUpperCase()}
            </strong></div>
            <div>Local: {connectionStatus.localAvailable ? '✅' : '❌'}</div>
            <div>Cloud: {connectionStatus.cloudAvailable ? '✅' : '❌'}</div>
            {connectionStatus.responseTime && (
              <div>Response: {connectionStatus.responseTime}ms</div>
            )}
          </div>
        </div>

        {/* Test Controls */}
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={runComprehensiveTests}
            disabled={isRunningTests}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: isRunningTests ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              cursor: isRunningTests ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {isRunningTests ? '⏳ Running Tests...' : '🚀 Run Comprehensive Tests'}
          </button>
        </div>

        {/* Test Results */}
        {testResults.length > 0 && (
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#333' }}>
              📋 Test Results
            </h4>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {testResults.map((result, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 12px',
                    marginBottom: '8px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '6px',
                    borderLeft: `4px solid ${getStatusColor(result.status)}`
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span>{getStatusIcon(result.status)}</span>
                    <strong style={{ fontSize: '12px', color: '#333' }}>{result.test}</strong>
                  </div>
                  <div style={{ fontSize: '11px', color: '#666', marginLeft: '20px' }}>
                    {result.message}
                  </div>
                  {result.details && (
                    <details style={{ marginTop: '4px', marginLeft: '20px' }}>
                      <summary style={{ fontSize: '10px', color: '#999', cursor: 'pointer' }}>
                        Details
                      </summary>
                      <pre style={{ 
                        fontSize: '10px', 
                        color: '#666', 
                        backgroundColor: '#fff', 
                        padding: '4px', 
                        borderRadius: '4px',
                        overflow: 'auto',
                        maxHeight: '100px'
                      }}>
                        {JSON.stringify(result.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default NetworkTestingPanel
