import { useEffect, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { BarcodeScanner } from '@capacitor-community/barcode-scanner'

export default function Scanner({ onResult, onClose }: { onResult: (code: string) => void; onClose?: () => void }) {
  const [permission, setPermission] = useState<boolean>(false)
  const [active, setActive] = useState<boolean>(false)

  // Cleanup effect for active scanner
  useEffect(() => {
    return () => {
      if (active) {
        BarcodeScanner.stopScan().catch(() => {})
        BarcodeScanner.showBackground()
        document.body.classList.remove('qr-scanning')
      }
    }
  }, [active])

  // Auto-start scanner on mount and handle Android back button
  useEffect(() => {
    let backHandler: { remove: () => void } | undefined

    ;(async () => {
      try {
        await start()
      } catch (_) {
        // ignore
      }
    })()

    backHandler = CapacitorApp.addListener('backButton', async () => {
      try {
        await stop()
      } finally {
        if (onClose) onClose()
      }
    })

    return () => {
      if (backHandler && typeof backHandler.remove === 'function') {
        backHandler.remove()
      }
    }
  }, [])

  async function start() {
    const status = await BarcodeScanner.checkPermission({ force: true })
    setPermission(!!status.granted)
    if (!status.granted) return

    await BarcodeScanner.hideBackground()
    document.body.classList.add('qr-scanning')
    setActive(true)

    const result = await BarcodeScanner.startScan()
    setActive(false)
    BarcodeScanner.showBackground()
    document.body.classList.remove('qr-scanning')

    if (result.hasContent && result.content) onResult(result.content)
  }

  async function stop() {
    try {
      await BarcodeScanner.stopScan()
    } catch (_) {}
    BarcodeScanner.showBackground()
    document.body.classList.remove('qr-scanning')
    setActive(false)
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{
        textAlign: 'center',
        marginBottom: '20px',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '20px',
        borderRadius: '15px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '1.4rem' }}>
          📱 QR/KIMPER Scanner
        </h3>
        <p style={{ margin: 0, opacity: 0.9, fontSize: '0.9rem' }}>
          Scan vehicle QR codes for commissioning status
        </p>
      </div>

      {!permission && (
        <div style={{
          background: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '10px',
          padding: '15px',
          marginBottom: '20px',
          textAlign: 'center'
        }}>
          <p style={{ margin: 0, color: '#856404' }}>
            📷 Camera permission is required for QR scanning
          </p>
        </div>
      )}

      {active && (
        <div style={{
          background: '#d4edda',
          border: '1px solid #c3e6cb',
          borderRadius: '10px',
          padding: '15px',
          marginBottom: '20px',
          textAlign: 'center'
        }}>
          <p style={{ margin: 0, color: '#155724' }}>
            🔍 Scanning... Point camera at QR code
          </p>
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={active ? stop : start}
          style={{
            background: active ? '#dc3545' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '25px',
            padding: '15px 30px',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
            transition: 'all 0.3s ease',
            minWidth: '200px'
          }}
        >
          {active ? '⏹️ Stop Scan' : '📱 Start Scan'}
        </button>
      </div>

      <div style={{
        marginTop: '20px',
        padding: '15px',
        background: '#e9ecef',
        borderRadius: '10px',
        fontSize: '0.9rem',
        color: '#6c757d'
      }}>
        <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>📋 Instructions:</p>
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          <li>Point camera at vehicle QR code</li>
          <li>Keep steady until scan completes</li>
          <li>QR code will auto-populate inspection form</li>
        </ul>
      </div>
    </div>
  )
}

