import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { ensureNativeCameraPermission, openNativeAppSettings } from '../services/cameraAccess'

interface Props {
  onResult: (content: string) => void
  onClose: () => void
}

/**
 * Modal-style QR scanner used inside forms (InspectionForm, PhotoUpload).
 *
 * Uses navigator.mediaDevices.getUserMedia + @zxing/library — the same stack as
 * ScanPage. We intentionally avoid @capacitor-community/barcode-scanner here
 * because it's unmaintained and crashes on Android 14+ when the user denies
 * camera permission with "Don't ask again".
 */
export default function InlineQRScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [permDenied, setPermDenied] = useState(false)
  const [scanning, setScanning] = useState(false)

  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      try { readerRef.current.reset() } catch { /* ignore */ }
      readerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setPermDenied(false)
    try {
      const allowed = await ensureNativeCameraPermission()
      if (!allowed) {
        setPermDenied(true)
        setError('Camera permission denied. Enable camera access in app settings.')
        return
      }
      // Small delay so the WebView updates its internal permission state
      // before getUserMedia is called. Prevents race-condition crashes.
      await new Promise(r => setTimeout(r, 300))
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not available on this device WebView.')
        return
      }

      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader
      if (!videoRef.current) return

      // Try rear camera first, fallback to any camera to avoid
      // OverconstrainedError crashes on some Android WebView versions.
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
      } catch (err) {
        const e = err as { name?: string }
        if (e?.name === 'OverconstrainedError' || e?.name === 'ConstraintNotSatisfiedError') {
          console.warn('[InlineScanner] Rear camera constraint failed, trying any camera')
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          })
        } else {
          throw err
        }
      }
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setScanning(true)

      reader.decodeContinuously(videoRef.current, (result, err) => {
        if (result) {
          stopCamera()
          onResult(result.getText())
        }
        if (err && !(err instanceof NotFoundException)) {
          // Decode noise — ignore
        }
      })
    } catch (err) {
      setScanning(false)
      const e = err as { name?: string }
      if (e?.name === 'NotAllowedError') {
        setPermDenied(true)
        setError('Camera permission denied. Allow camera access and try again.')
      } else if (e?.name === 'NotFoundError') {
        setError('No camera found on this device.')
      } else {
        setError('Could not open camera. Please try again.')
      }
    }
  }, [onResult, stopCamera])

  useEffect(() => {
    start()
    return () => { stopCamera() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClose = () => { stopCamera(); onClose() }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', zIndex: 3000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
    }}>
      <video ref={videoRef} autoPlay playsInline muted style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.72) 100%)'
      }} />

      <button onClick={handleClose} aria-label="Close scanner" style={{
        position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', right: '16px',
        background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff',
        width: 40, height: 40, borderRadius: '50%', fontSize: '1.1rem',
        cursor: 'pointer', zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>✕</button>

      {scanning && !error && (
        <div style={{ position: 'relative', width: 260, height: 260, zIndex: 5 }}>
          {[
            { top: 0, left: 0, borderTop: '4px solid #FC4100', borderLeft: '4px solid #FC4100', borderRadius: '12px 0 0 0' },
            { top: 0, right: 0, borderTop: '4px solid #FC4100', borderRight: '4px solid #FC4100', borderRadius: '0 12px 0 0' },
            { bottom: 0, left: 0, borderBottom: '4px solid #FC4100', borderLeft: '4px solid #FC4100', borderRadius: '0 0 0 12px' },
            { bottom: 0, right: 0, borderBottom: '4px solid #FC4100', borderRight: '4px solid #FC4100', borderRadius: '0 0 12px 0' },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 40, height: 40, ...s }} />
          ))}
          <div style={{
            position: 'absolute', left: '8%', right: '8%', height: 2,
            background: 'linear-gradient(90deg, transparent, #FC4100, transparent)',
            boxShadow: '0 0 10px #FC4100', animation: 'scanLine 2s linear infinite'
          }} />
        </div>
      )}

      {scanning && !error && (
        <p style={{
          position: 'relative', zIndex: 5, marginTop: 24,
          color: 'rgba(255,255,255,0.8)', fontSize: '0.85rem', textAlign: 'center'
        }}>
          Point camera at QR code
        </p>
      )}

      {error && (
        <div style={{
          position: 'relative', zIndex: 5, marginTop: 24, textAlign: 'center',
          padding: '16px 20px', maxWidth: 300,
          display: 'flex', flexDirection: 'column', gap: 10,
          border: '1px solid rgba(239,68,68,0.35)', borderRadius: 12,
          background: 'rgba(239,68,68,0.12)'
        }}>
          <p style={{ margin: 0, color: '#FCA5A5', fontSize: '0.9rem' }}>{error}</p>
          <button onClick={permDenied ? openNativeAppSettings : start} style={{
            padding: '10px 16px', background: '#FC4100', border: 'none',
            borderRadius: 10, color: '#fff', fontSize: '0.9rem',
            fontWeight: 600, cursor: 'pointer'
          }}>{permDenied ? 'Open App Settings' : 'Retry'}</button>
        </div>
      )}
    </div>
  )
}
