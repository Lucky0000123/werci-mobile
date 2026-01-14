import { useState } from 'react'
import { offlineStorage } from '../services/offlineStorage'

const TestingPanel = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [testResults, setTestResults] = useState<string[]>([])
  const [storageStats, setStorageStats] = useState<any>(null)
  const [isOfflineMode, setIsOfflineMode] = useState(false)

  const addTestResult = (message: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }

  const testConnections = async () => {
    addTestResult('🔄 Starting connection tests...')
    
    // Test local server
    try {
      const localResponse = await fetch('http://localhost:8082/health', { 
        method: 'GET',
        timeout: 3000 
      } as any)
      
      if (localResponse.ok) {
        addTestResult('✅ Local server (localhost:8082) - CONNECTED')
      } else {
        addTestResult('❌ Local server (localhost:8082) - FAILED')
      }
    } catch (error) {
      addTestResult('❌ Local server (localhost:8082) - UNREACHABLE')
    }

    // Test cloud server
    try {
      const cloudResponse = await fetch('http://159.65.13.232:8082/health', { 
        method: 'GET',
        timeout: 5000 
      } as any)
      
      if (cloudResponse.ok) {
        addTestResult('✅ Cloud server (159.65.13.232) - CONNECTED')
      } else {
        addTestResult('❌ Cloud server (159.65.13.232) - FAILED')
      }
    } catch (error) {
      addTestResult('❌ Cloud server (159.65.13.232) - UNREACHABLE')
    }

    addTestResult('🏁 Connection tests completed')
  }

  const testOfflineStorage = async () => {
    addTestResult('🔄 Testing offline storage...')
    
    try {
      await offlineStorage.initialize()
      addTestResult('✅ Offline storage initialized')

      // Test storing sample data
      const sampleVehicle = {
        id: 'TEST001',
        equip_no: 'TEST001',
        description: 'Test Vehicle',
        company: 'WERCI',
        status: 'active',
        vehicle_type: 'truck',
        model: 'Test Model',
        cached_at: Date.now()
      }

      await offlineStorage.storeVehicleData([sampleVehicle])
      addTestResult('✅ Sample vehicle data stored')

      // Test retrieving data
      const retrieved = await offlineStorage.getVehicleByEquipNo('TEST001')
      if (retrieved) {
        addTestResult('✅ Sample vehicle data retrieved')
      } else {
        addTestResult('❌ Failed to retrieve sample vehicle data')
      }

      // Get storage stats
      const stats = await offlineStorage.getStorageStats()
      setStorageStats(stats)
      addTestResult(`📊 Storage stats: ${stats.totalVehicles} vehicles, ${stats.cacheSize}`)

    } catch (error) {
      addTestResult(`❌ Offline storage test failed: ${error}`)
    }
  }

  const simulateOfflineMode = () => {
    setIsOfflineMode(!isOfflineMode)
    if (!isOfflineMode) {
      addTestResult('📵 Offline mode ENABLED - Network requests will be blocked')
    } else {
      addTestResult('📶 Offline mode DISABLED - Network requests restored')
    }
  }

  const testQRScanning = async () => {
    addTestResult('🔄 Testing QR code functionality...')
    
    const testCodes = ['EQUIP:VH001', 'VH002', 'https://werci.com/vehicles/VH003']
    
    for (const code of testCodes) {
      try {
        // Cache the QR lookup
        await offlineStorage.cacheQRLookup(code, code.includes('VH') ? code.match(/VH\d+/)?.[0] || code : code)
        addTestResult(`✅ QR code cached: ${code}`)
        
        // Test retrieval
        const equipNo = await offlineStorage.getEquipNoFromQR(code)
        if (equipNo) {
          addTestResult(`✅ QR lookup successful: ${code} → ${equipNo}`)
        }
      } catch (error) {
        addTestResult(`❌ QR test failed for ${code}: ${error}`)
      }
    }
  }

  const clearTestResults = () => {
    setTestResults([])
    setStorageStats(null)
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          fontSize: '24px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,123,255,0.3)',
          zIndex: 1000
        }}
      >
        🔧
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        width: '400px',
        maxHeight: '80vh',
        backgroundColor: 'white',
        border: '2px solid #007bff',
        borderRadius: '12px',
        padding: '16px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        zIndex: 1000,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, color: '#007bff' }}>🔧 WERCI Testing Panel</h3>
        <button
          onClick={() => setIsOpen(false)}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        <button onClick={testConnections} style={{ padding: '8px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>
          🚀 Test Connections
        </button>
        <button onClick={testOfflineStorage} style={{ padding: '8px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px' }}>
          💾 Test Offline Storage
        </button>
        <button onClick={testQRScanning} style={{ padding: '8px', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '4px' }}>
          📱 Test QR Scanning
        </button>
        <button 
          onClick={simulateOfflineMode} 
          style={{ 
            padding: '8px', 
            backgroundColor: isOfflineMode ? '#dc3545' : '#6c757d', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px' 
          }}
        >
          {isOfflineMode ? '📶 Restore Online' : '📵 Simulate Offline'}
        </button>
        <button onClick={clearTestResults} style={{ padding: '8px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px' }}>
          🗑️ Clear Results
        </button>
      </div>

      {storageStats && (
        <div style={{ marginBottom: '16px', padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px', fontSize: '14px' }}>
          <strong>📊 Storage Stats:</strong><br />
          Vehicles: {storageStats.totalVehicles}<br />
          QR Cache: {storageStats.totalQRCache}<br />
          Size: {storageStats.cacheSize}<br />
          {storageStats.lastSync && <span>Last Sync: {new Date(storageStats.lastSync).toLocaleString()}</span>}
        </div>
      )}

      <div 
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          backgroundColor: '#f8f9fa', 
          padding: '8px', 
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: 'monospace',
          maxHeight: '300px'
        }}
      >
        {testResults.length === 0 ? (
          <div style={{ color: '#666', fontStyle: 'italic' }}>
            Click buttons above to run tests...
          </div>
        ) : (
          testResults.map((result, index) => (
            <div key={index} style={{ marginBottom: '4px' }}>
              {result}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default TestingPanel
