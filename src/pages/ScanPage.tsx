import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library'
import { useI18n } from '../services/i18n-context'
import { ensureNativeCameraPermission, openNativeAppSettings } from '../services/cameraAccess'

interface ScanPageProps {
  onResult: (content: string) => void
}

export default function ScanPage({ onResult }: ScanPageProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permDenied, setPermDenied] = useState(false)

  // ── Zoom state ──
  const [zoomSupported, setZoomSupported] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [zoomMin, setZoomMin] = useState(1)
  const [zoomMax, setZoomMax] = useState(1)
  const [zoomStep, setZoomStep] = useState(0.1)
  const [cssZoom, setCssZoom] = useState(1)
  const cssZoomSupported = useRef(false)

  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      try { readerRef.current.reset() } catch { /* ignore */ }
      readerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    trackRef.current = null
    setScanning(false)
    setZoomSupported(false)
    setCssZoom(1)
    cssZoomSupported.current = false
  }, [])

  useEffect(() => {
    startCamera()
    return () => { stopCamera() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCamera = async () => {
    setError(null)
    setPermDenied(false)

    try {
      const allowed = await ensureNativeCameraPermission()
      if (!allowed) {
        setPermDenied(true)
        setError('Camera permission denied. Please allow camera access and try again.')
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

      // 1) Get camera stream manually so we control the MediaStreamTrack.
      // Try 'environment' facing mode first, then fallback to any camera.
      // Using plain 'environment' instead of { ideal: 'environment' } avoids
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
          console.warn('[Scanner] Rear camera constraint failed, trying any camera')
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          })
        } else {
          throw err
        }
      }
      streamRef.current = stream

      const videoTrack = stream.getVideoTracks()[0]
      trackRef.current = videoTrack

      // 2) Attach stream to video element
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      // 3) Detect zoom capabilities
      const capabilities = videoTrack.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } }
      const settings = videoTrack.getSettings() as MediaTrackSettings & { zoom?: number }

      if (capabilities.zoom) {
        setZoomSupported(true)
        setZoomMin(capabilities.zoom.min)
        setZoomMax(capabilities.zoom.max)
        setZoomStep(capabilities.zoom.step || 0.1)
        setZoomLevel(settings.zoom ?? capabilities.zoom.min)
        cssZoomSupported.current = false
      } else {
        // Fallback: use CSS zoom for devices without native PTZ support
        setZoomSupported(false)
        cssZoomSupported.current = true
      }

      setScanning(true)

      // 4) Start ZXing decoder on the video element.
      //    We use decodeContinuously (not decodeFromVideoElement) because the
      //    latter calls this.reset() which stops our manually-created stream.
      reader.decodeContinuously(videoRef.current, (result, err) => {
        if (result) {
          // Guard getText(): a malformed/corrupt symbol can throw here, which
          // would crash the decode callback and freeze the scanner on a black
          // screen. Swallow it and keep scanning so the next frame can succeed.
          let text: string | null = null
          try {
            text = result.getText()
          } catch (textErr) {
            console.warn('[Scanner] could not read decoded result:', textErr)
          }
          if (text) {
            stopCamera()
            onResult(text)
          }
        }
        if (err && !(err instanceof NotFoundException)) {
          console.warn('[Scanner] decode error:', err)
        }
      })
    } catch (err: unknown) {
      setScanning(false)
      const e = err as { name?: string }
      if (e?.name === 'NotAllowedError') {
        setPermDenied(true)
        setError('Camera permission denied. Please allow camera access and try again.')
      } else if (e?.name === 'NotFoundError') {
        setError('No camera found on this device.')
      } else {
        setError('Could not open camera. Please try again.')
        console.error('[Scanner] camera error:', err)
      }
    }
  }

  const applyZoom = async (newZoom: number) => {
    const track = trackRef.current
    if (!track) return

    if (zoomSupported) {
      // Native optical zoom
      const clamped = Math.max(zoomMin, Math.min(zoomMax, newZoom))
      try {
        await track.applyConstraints({ advanced: [{ zoom: clamped }] } as unknown as MediaTrackConstraints)
        setZoomLevel(clamped)
        setCssZoom(1)
      } catch (e) {
        console.warn('[Scanner] Native zoom failed, falling back to CSS:', e)
        // If native zoom fails mid-flight, fall back to CSS
        setZoomSupported(false)
        cssZoomSupported.current = true
        setCssZoom(clamped)
      }
    } else if (cssZoomSupported.current) {
      // CSS transform zoom (digital magnification)
      const clamped = Math.max(1, Math.min(5, newZoom))
      setCssZoom(clamped)
      setZoomLevel(clamped)
    }
  }

  const zoomIn = () => applyZoom(zoomLevel + (zoomSupported ? zoomStep : 0.5))
  const zoomOut = () => applyZoom(zoomLevel - (zoomSupported ? zoomStep : 0.5))

  const handleClose = () => {
    stopCamera()
    navigate('/home')
  }

  // Compute video transform for CSS zoom fallback
  const videoTransform = cssZoom > 1 && !zoomSupported
    ? `scale(${cssZoom})`
    : 'scale(1)'

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: '#000', zIndex: 2000,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center'
    }}>

      {/* ── Real camera feed ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          objectFit: 'cover',
          transform: videoTransform,
          transformOrigin: 'center center',
          transition: 'transform 0.15s ease-out'
        }}
      />

      {/* ── Dark vignette overlay so corners look clean ── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at center, transparent 38%, rgba(0,0,0,0.72) 100%)'
      }} />

      {/* ── Close button ── */}
      <button onClick={handleClose} style={{
        position: 'absolute',
        top: 'max(16px, env(safe-area-inset-top))', right: '16px',
        background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff',
        width: '40px', height: '40px', borderRadius: '50%',
        fontSize: '1.1rem', cursor: 'pointer', zIndex: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>✕</button>

      {/* ── Zoom indicator badge (top-left) ── */}
      {scanning && (
        <div style={{
          position: 'absolute',
          top: 'max(16px, env(safe-area-inset-top))', left: '16px',
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          padding: '6px 12px',
          borderRadius: '20px',
          fontSize: '0.75rem',
          fontWeight: 600,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <span>🔍</span>
          <span>{zoomLevel.toFixed(1)}x</span>
          {zoomSupported ? <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>optical</span> : <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>digital</span>}
        </div>
      )}

      {/* ── Scan-area frame ── */}
      <div style={{ position: 'relative', width: 260, height: 260, zIndex: 5 }}>
        {/* corner markers */}
        {[
          { top: 0, left: 0, borderTop: '4px solid #FC4100', borderLeft: '4px solid #FC4100', borderRadius: '12px 0 0 0' },
          { top: 0, right: 0, borderTop: '4px solid #FC4100', borderRight: '4px solid #FC4100', borderRadius: '0 12px 0 0' },
          { bottom: 0, left: 0, borderBottom: '4px solid #FC4100', borderLeft: '4px solid #FC4100', borderRadius: '0 0 0 12px' },
          { bottom: 0, right: 0, borderBottom: '4px solid #FC4100', borderRight: '4px solid #FC4100', borderRadius: '0 0 12px 0' },
        ].map((s, i) => (
          <div key={i} style={{ position: 'absolute', width: 40, height: 40, ...s }} />
        ))}

        {/* animated scan line */}
        {scanning && (
          <div style={{
            position: 'absolute', left: '8%', right: '8%', height: 2,
            background: 'linear-gradient(90deg, transparent, #FC4100, transparent)',
            boxShadow: '0 0 10px #FC4100',
            animation: 'scanLine 2s linear infinite'
          }} />
        )}
      </div>

      {/* ── Hint label ── */}
      {scanning && !error && (
        <p style={{
          position: 'relative', zIndex: 5,
          marginTop: 24, color: 'rgba(255,255,255,0.8)',
          fontSize: '0.85rem', textAlign: 'center'
        }}>
          {t('scanInstruction')}
        </p>
      )}

      {/* ── Zoom controls (bottom) ── */}
      {scanning && !error && (
        <div style={{
          position: 'absolute',
          bottom: 'max(24px, env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(0,0,0,0.55)',
          padding: '10px 16px',
          borderRadius: '28px',
          backdropFilter: 'blur(4px)'
        }}>
          <button
            onClick={zoomOut}
            disabled={zoomLevel <= (zoomSupported ? zoomMin : 1)}
            style={{
              width: '40px', height: '40px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '1.4rem',
              fontWeight: 700,
              cursor: zoomLevel <= (zoomSupported ? zoomMin : 1) ? 'not-allowed' : 'pointer',
              opacity: zoomLevel <= (zoomSupported ? zoomMin : 1) ? 0.4 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              paddingBottom: '4px'
            }}
          >−</button>

          <input
            type="range"
            min={zoomSupported ? zoomMin : 1}
            max={zoomSupported ? zoomMax : 5}
            step={zoomSupported ? zoomStep : 0.1}
            value={zoomLevel}
            onChange={(e) => applyZoom(parseFloat(e.target.value))}
            style={{
              width: '140px',
              accentColor: '#FC4100'
            }}
          />

          <button
            onClick={zoomIn}
            disabled={zoomLevel >= (zoomSupported ? zoomMax : 5)}
            style={{
              width: '40px', height: '40px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '1.4rem',
              fontWeight: 700,
              cursor: zoomLevel >= (zoomSupported ? zoomMax : 5) ? 'not-allowed' : 'pointer',
              opacity: zoomLevel >= (zoomSupported ? zoomMax : 5) ? 0.4 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              paddingBottom: '4px'
            }}
          >+</button>
        </div>
      )}

      {/* ── Error state ── */}
      {error && (
        <div className="prism-card" style={{
          position: 'relative', zIndex: 5,
          marginTop: 24, textAlign: 'center',
          padding: '16px 20px', maxWidth: 300,
          display: 'flex', flexDirection: 'column', gap: 10,
          borderColor: 'rgba(239,68,68,0.35)',
          background: 'rgba(239,68,68,0.12)'
        }}>
          <p style={{ margin: 0, color: '#FCA5A5', fontSize: '0.9rem' }}>{error}</p>
          {permDenied ? (
            <button onClick={openNativeAppSettings} style={{
              padding: '10px 16px', background: '#FC4100',
              border: 'none', borderRadius: 10, color: '#fff',
              fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer'
            }}>Open App Settings</button>
          ) : (
            <button onClick={startCamera} className="prism-ghost-btn">
              {t('refresh')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
