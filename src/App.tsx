import { useState, useEffect } from 'react'
import './App.css'
import Scanner from './features/scan/Scanner'
import InspectionForm from './features/inspect/InspectionForm'
import PhotoUpload from './features/photo/PhotoUpload'
import SyncStatus from './components/SyncStatus'
import ConnectionStatusChip from './components/ConnectionStatusChip'
import OfflineDataSyncButton from './components/OfflineDataSyncButton'
import DataManagementPanel from './components/DataManagementPanel'
import DiagnosticsPanel from './components/DiagnosticsPanel'

import CommissioningStatus from './components/CommissioningStatus'
import KimperStatus from './components/KimperStatus'
import { syncService } from './services/sync'
import { connectionManager } from './services/connectionManager'
import { clearAllData } from './services/db'
import { offlineDataSync } from './services/offlineDataSync'
import TestingPanel from './components/TestingPanel'
import werciLogo from './assets/werck-logo-new.png'
import { App as CapacitorApp } from '@capacitor/app'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { Capacitor } from '@capacitor/core'
// import { connectionManager } from './services/connectionManager' // Temporarily disabled



function App() {
  const [view, setView] = useState<'home' | 'scan' | 'inspect' | 'photo-upload'>('home')
  const [showDiagnostics, setShowDiagnostics] = useState(false)

  // Add effect to scroll to top when view changes - optimized with smooth behavior
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [view])
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [scannedVehicle, setScannedVehicle] = useState<any>(null)
  const [scannedKimper, setScannedKimper] = useState<any>(null)
  const [showCommissioningStatus, setShowCommissioningStatus] = useState(false)
  const [showKimperStatus, setShowKimperStatus] = useState(false)

  useEffect(() => {
    // Initialize all services for full functionality
    const initializeServices = async () => {
      console.log('🔧 Initializing WERCK mobile app with full sync capabilities...')

      try {
        // Initialize connection manager
        await connectionManager.checkConnectivity()

        // Initialize sync service for auto-sync of queued inspections
        console.log('🔄 Starting sync service for inspection queue...')

        // Make services available globally for debugging
        ;(window as any).connectionManager = connectionManager
        ;(window as any).syncService = syncService

        console.log('✅ WERCK mobile app initialized with full sync capabilities')
        setIsInitialized(true)
      } catch (error) {
        console.error('❌ Failed to initialize services:', error)
        setIsInitialized(true) // Still allow app to work in degraded mode
      }
    }

    initializeServices()
  }, [])

  // Handle Android back button
  useEffect(() => {
    const backHandler = CapacitorApp.addListener('backButton', () => {
      // Close modals first if open
      if (showCommissioningStatus) {
        setShowCommissioningStatus(false)
        setScannedVehicle(null)
        return
      }
      if (showKimperStatus) {
        setShowKimperStatus(false)
        setScannedKimper(null)
        return
      }

      // If we're not on home view, go back to home
      if (view !== 'home') {
        setView('home')
      } else {
        // If on home view, minimize app instead of exiting
        CapacitorApp.minimizeApp()
      }
    })

    return () => {
      backHandler.then(handler => handler.remove())
    }
  }, [view, showCommissioningStatus, showKimperStatus])

  const handleClearCache = async () => {
    if (confirm('Are you sure you want to clear all cached data? This will remove all offline inspections and photos.')) {
      try {
        // Clear both IndexedDB databases and localStorage
        await clearAllData() // Clear werck-mobile database (inspections, photos, users, syncQueue)
        await offlineDataSync.clearOfflineData() // Clear WERCKOfflineData database (vehicles, kimper, etc.)
        localStorage.clear()
        alert('✅ Cache cleared successfully!')
        // Reload the page to reset the app state
        window.location.reload()
      } catch (error) {
        console.error('❌ Failed to clear cache:', error)
        alert('❌ Failed to clear cache: ' + (error as Error).message)
      }
    }
  }

  const handleQRScanResult = async (qrContent: string) => {
    console.log('🔍 QR Code scanned:', qrContent)
    setLastScan(qrContent)

    // Detect QR code type
    if (qrContent.includes('/kimper/qr/')) {
      // KIMPER QR Code
      console.log('📋 Detected KIMPER QR code')
      await handleKimperQRCode(qrContent)
      return
    }

    // Commissioning/Vehicle QR Code
    console.log('🚜 Detected commissioning QR code')
    await handleCommissioningQRCode(qrContent)
  }

  const handleKimperQRCode = async (qrContent: string) => {
    try {
      // Extract KIMPER ID from QR code
      // Format: http://domain/kimper/qr/{kimper_id}
      const parts = qrContent.split('/kimper/qr/')
      if (parts.length < 2) {
        console.error('❌ Invalid KIMPER QR code format')
        alert('Invalid KIMPER QR code format')
        return
      }

      const kimperId = parseInt(parts[1])
      if (isNaN(kimperId)) {
        console.error('❌ Invalid KIMPER ID')
        alert('Invalid KIMPER ID in QR code')
        return
      }

      console.log('🔍 Looking up KIMPER ID:', kimperId)

      // Look up KIMPER data
      const kimperData = await offlineDataSync.lookupKimperById(kimperId)

      if (kimperData) {
        console.log('✅ KIMPER data found:', kimperData.name)
        setScannedKimper(kimperData)
        setShowKimperStatus(true)
      } else {
        console.warn('⚠️ KIMPER not found for ID:', kimperId)
        alert(`KIMPER record not found for ID: ${kimperId}`)
      }

    } catch (error) {
      console.error('❌ Error processing KIMPER QR scan:', error)
      alert('Failed to process KIMPER QR code')
    }
  }

  const handleCommissioningQRCode = async (qrContent: string) => {
    try {
      // Extract vehicle ID from QR code
      // QR code format: http://domain/inspect/{vehicle_id}
      let vehicleId: number | null = null

      if (qrContent.includes('/inspect/')) {
        const parts = qrContent.split('/inspect/')
        if (parts.length > 1) {
          vehicleId = parseInt(parts[1])
        }
      } else if (qrContent.startsWith('EQUIP:')) {
        // Legacy format - treat as equipment number
        const equipNo = qrContent.replace('EQUIP:', '')
        const normalized = equipNo.toUpperCase().trim()
        console.log('🔍 Looking up vehicle by equipment number:', normalized)
        const offlineVehicle = await offlineDataSync.lookupVehicleOffline(normalized)

        if (offlineVehicle) {
          console.log('✅ Vehicle found in offline data:', offlineVehicle.equip_no)
          setScannedVehicle({
            equip_no: offlineVehicle.equip_no,
            description: offlineVehicle.description,
            company: offlineVehicle.company,
            manufacturer: offlineVehicle.manufacturer,
            unit_model: offlineVehicle.unit_model,
            commissioning_status: offlineVehicle.commissioning_status,
            expired_date: offlineVehicle.expired_date
          })
          setShowCommissioningStatus(true)
        } else {
          console.warn('⚠️ Vehicle not found:', normalized)
          alert(`Vehicle not found: ${normalized}. Please sync data first.`)
        }
        return
      }

      if (!vehicleId || isNaN(vehicleId)) {
        console.error('❌ Invalid vehicle ID in QR code')
        alert('Invalid QR code format')
        return
      }

      console.log('🔍 Looking up vehicle by ID:', vehicleId)

      // Look up vehicle by ID (not equipment number!)
      const offlineVehicle = await offlineDataSync.lookupVehicleById(vehicleId)

      if (offlineVehicle) {
        console.log('✅ Vehicle found:', offlineVehicle.equip_no)
        setScannedVehicle({
          equip_no: offlineVehicle.equip_no,
          description: offlineVehicle.description,
          company: offlineVehicle.company,
          manufacturer: offlineVehicle.manufacturer,
          unit_model: offlineVehicle.unit_model,
          commissioning_status: offlineVehicle.commissioning_status,
          expired_date: offlineVehicle.expired_date
        })
        // Show commissioning status modal
        console.log('✅ Showing commissioning status modal')
        setShowCommissioningStatus(true)
      } else {
        console.warn('⚠️ Vehicle not found for ID:', vehicleId)
        alert(`Vehicle not found for ID: ${vehicleId}. Please sync data first.`)
      }

    } catch (error) {
      console.error('❌ Error processing commissioning QR scan:', error)
      alert('Failed to process QR code')
    }
  }

  const handleStartInspection = () => {
    setShowCommissioningStatus(false)
    setView('inspect')
    // Ensure we scroll to top when starting inspection
    setTimeout(() => {
      window.scrollTo(0, 0)
    }, 100)
  }

  const handleUpdatePhoto = () => {
    setShowCommissioningStatus(false)
    setView('photo-upload')
    // Ensure we scroll to top when opening photo upload
    setTimeout(() => {
      window.scrollTo(0, 0)
    }, 100)
  }

  const handleCloseCommissioningStatus = () => {
    setShowCommissioningStatus(false)
    setScannedVehicle(null)
    setView('home')
  }

  const handleCloseKimperStatus = () => {
    setShowKimperStatus(false)
    setScannedKimper(null)
    setView('home')
  }

  // Direct QR scan function - bypasses Scanner page
  const handleDirectScan = async () => {
    try {
      console.log('🔵 Scan button clicked!')

      // Check camera permission
      console.log('🔵 Checking camera permission...')
      const { camera } = await BarcodeScanner.checkPermissions()
      console.log('🔵 Permission status:', camera)

      if (camera !== 'granted') {
        console.log('🔵 Requesting camera permission...')
        const { camera: requestedPermission } = await BarcodeScanner.requestPermissions()
        console.log('🔵 Requested permission status:', requestedPermission)

        if (requestedPermission !== 'granted') {
          console.log('❌ Camera permission denied')
          alert('📷 Camera permission is required for QR scanning. Please enable camera access in Settings.')
          return
        }
      }

      console.log('✅ Camera permission granted, starting scan...')

      // Add scanning class for UI
      document.querySelector('html')?.classList.add('qr-scanning')
      document.body.classList.add('qr-scanning')

      // Set up barcode listener
      let scannedBarcode: string | null = null
      const listener = await BarcodeScanner.addListener('barcodeScanned', async (result) => {
        console.log('🔍 Barcode scanned:', result.barcode)
        scannedBarcode = result.barcode.displayValue

        // Stop scanning and cleanup
        await BarcodeScanner.stopScan()
        document.querySelector('html')?.classList.remove('qr-scanning')
        document.body.classList.remove('qr-scanning')
        listener.remove()

        // Process the scanned barcode
        if (scannedBarcode) {
          console.log('🔍 QR Code scanned:', scannedBarcode)
          await handleQRScanResult(scannedBarcode)
        }
      })

      // Install Google Barcode Scanner module (Android only)
      if (Capacitor.getPlatform() === 'android') {
        try {
          console.log('🔵 Installing barcode scanner module...')
          await BarcodeScanner.installGoogleBarcodeScannerModule()
        } catch (error) {
          console.log('ℹ️ Google Barcode Scanner module already installed or not needed')
        }
      }

      console.log('🔵 Starting scanner...')
      await BarcodeScanner.startScan()
      console.log('🔵 Scanner started, waiting for QR code...')

    } catch (error) {
      console.error('❌ QR scan error:', error)
      document.body.classList.remove('qr-scanning')
      await BarcodeScanner.stopScan().catch(() => {}) // Cleanup on error
      alert('Failed to scan QR code: ' + (error as Error).message)
    }
  }

  if (!isInitialized) {
    return (
      <div>
        {/* Professional Header */}
        <div className="werci-header">
          <img src={werciLogo} alt="WERCK" className="werci-logo" />
          <div>
            <h2 className="werci-title">WERCK Inspector</h2>
            <p className="werci-subtitle">Weda Eramet Commissioning & KIMPER</p>
          </div>
        </div>
        <div className="werci-container">
          <p>Initializing services...</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* QR Scanning Overlay - Shows when camera is active */}
      <div className="qr-scan-overlay">
        <div className="qr-scan-frame">
          <div className="qr-scan-line"></div>
        </div>
        <div className="qr-scan-instructions">
          📱 Point camera at QR code<br/>
          Keep steady until scan completes
        </div>
      </div>

      {/* Professional Header */}
      <div className="werci-header">
        <img src={werciLogo} alt="WERCK" className="werci-logo" />
        <div>
          <h1 className="werci-title">WERCK Inspector</h1>
          <p className="werci-subtitle">Weda Eramet Commissioning & KIMPER</p>
        </div>
        <ConnectionStatusChip />
      </div>

      {/* Main Content */}
      <div className="werci-container">
        <SyncStatus />

        {view === 'home' && (
          <div className="werci-button-group">
            {/* PRIMARY ACTION - Large Scan Button */}
            <button
              onClick={handleDirectScan}
              style={{
                background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                color: 'white',
                border: 'none',
                padding: '25px 30px',
                borderRadius: '20px',
                fontSize: '20px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 8px 25px rgba(79, 172, 254, 0.4)',
                transition: 'all 0.3s ease',
                width: '100%',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px'
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.98)'
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              <span style={{ fontSize: '28px' }}>📱</span>
              <span>SCAN VEHICLE / KIMPER</span>
            </button>

            {/* SYNC BUTTON - Secondary Action */}
            <div style={{
              marginBottom: '25px'
            }}>
              <OfflineDataSyncButton />
            </div>

            {/* Advanced Options - Minimized */}
            <details style={{marginTop: '10px'}}>
              <summary style={{
                cursor: 'pointer',
                padding: '12px 15px',
                backgroundColor: '#e9ecef',
                borderRadius: '12px',
                fontSize: '0.95rem',
                color: '#6c757d',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>⚙️</span>
                <span>Advanced Options</span>
              </summary>
              <div style={{marginTop: '15px', padding: '10px'}}>
                {/* Manual Entry Options */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  marginBottom: '15px'
                }}>
                  <button onClick={() => setView('inspect')} className="secondary" style={{
                    padding: '12px 15px',
                    fontSize: '0.95rem'
                  }}>
                    📋 Manual Vehicle Inspection
                  </button>
                  <button onClick={() => setView('photo-upload')} className="secondary" style={{
                    padding: '12px 15px',
                    fontSize: '0.95rem'
                  }}>
                    📸 Upload Equipment Picture
                  </button>
                </div>

                <DataManagementPanel />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => setShowDiagnostics(v => !v)} className="secondary" style={{ flex: 1 }}>
                    🧪 {showDiagnostics ? 'Hide' : 'Diagnostics'}
                  </button>
                  <button onClick={handleClearCache} className="secondary" style={{ flex: 1 }}>
                    🗑️ Clear Cache
                  </button>
                </div>
                {showDiagnostics && (
                  <div style={{ marginTop: 12 }}>
                    <DiagnosticsPanel />
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {view === 'scan' && (
          <div>
            <Scanner onResult={handleQRScanResult} />
            <div className="werci-button-group">
              <button onClick={() => setView('home')} className="secondary">
                ← Back to Home
              </button>
            </div>
          </div>
        )}

        {view === 'inspect' && (
          <div>
            <InspectionForm scannedVehicle={scannedVehicle} />
            <div className="werci-button-group">
              <button onClick={() => {
                setView('home')
                setScannedVehicle(null) // Clear scanned vehicle when going back
                window.scrollTo(0, 0)
              }} className="secondary">
                ← Back to Home
              </button>
            </div>
          </div>
        )}

        {view === 'photo-upload' && (
          <div>
            <PhotoUpload />
            <div className="werci-button-group">
              <button onClick={() => {
                setView('home')
                window.scrollTo(0, 0)
              }} className="secondary">
                ← Back to Home
              </button>
            </div>
          </div>
        )}

        {lastScan && (
          <div className="werci-status">
            <strong>Last scan:</strong> {lastScan}
          </div>
        )}
      </div>

      {/* Testing Panel - Only in Development */}
      {import.meta.env.DEV && <TestingPanel />}

      {/* Commissioning Status Modal */}
      {showCommissioningStatus && scannedVehicle && (
        <CommissioningStatus
          vehicle={scannedVehicle}
          onStartInspection={handleStartInspection}
          onUpdatePhoto={handleUpdatePhoto}
          onClose={handleCloseCommissioningStatus}
        />
      )}

      {/* KIMPER Status Modal */}
      {showKimperStatus && scannedKimper && (
        <KimperStatus
          kimper={scannedKimper}
          onClose={handleCloseKimperStatus}
        />
      )}
    </div>
  )
}

export default App