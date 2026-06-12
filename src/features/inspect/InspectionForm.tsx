import { useState, useEffect, useRef } from 'react'
import type { FormEvent, CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Geolocation } from '@capacitor/geolocation'
import InlineQRScanner from '../../components/InlineQRScanner'
import { compressDataUrl } from '../../services/compress'
import { ensureNativeCameraPermission, openNativeAppSettings, readImageFileAsDataUrl } from '../../services/cameraAccess'
import { sqlServerService, type Inspection } from '../../services/sqlserver'
import { apiFetch } from '../../services/api'
import { offlineDataSync } from '../../services/offlineDataSync'
import { setInspection, addPhoto as addPhotoLocal, enqueue } from '../../services/db'
import { flushAllPending } from '../../services/backgroundSync'
import { useI18n } from '../../services/i18n-context'
import './InspectionFormProfessional.css'

// Design tokens shared with the rest of the PRISM mobile UI
const C = {
  card: 'rgba(255,255,255,0.04)',
  cardSolid: 'rgba(15,23,42,0.6)',
  border: 'rgba(255,255,255,0.09)',
  borderHover: 'rgba(252,65,0,0.35)',
  accent: '#FC4100',
  accentDark: '#d93600',
  gold: '#FFC55A',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  textPri: '#f1f5f9',
  textMut: '#8b9ab0',
}

// Section wrapper — glass card with a gold eyebrow title
function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: string }) {
  return (
    <div className="prism-card" style={{ padding: '16px', marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        {icon && <span style={{ fontSize: '0.95rem' }}>{icon}</span>}
        <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: C.gold, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

// Field label + input layout with mobile-friendly spacing
function FieldLabel({ children, required, htmlFor }: { children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: C.textMut, marginBottom: '6px', letterSpacing: '0.02em' }}>
      {children}{required && <span style={{ color: C.accent, marginLeft: '4px' }}>*</span>}
    </label>
  )
}

// Shared dark input style (min 48px touch target)
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: 'rgba(255,255,255,0.03)',
  border: `1px solid ${C.border}`,
  borderRadius: '10px',
  color: C.textPri,
  fontSize: '0.95rem',
  minHeight: '48px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

// Segmented button for Good/Fair/Poor style selections
interface SegOpt { value: string; label: string; tone: 'success' | 'warning' | 'danger' }
function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: SegOpt[] }) {
  const toneBg: Record<string, string> = { success: C.success, warning: C.warning, danger: C.danger }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: '8px' }}>
      {options.map(opt => {
        const active = value === opt.value
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)} style={{
            padding: '12px 10px',
            background: active ? toneBg[opt.tone] : 'rgba(255,255,255,0.03)',
            border: `1px solid ${active ? toneBg[opt.tone] : C.border}`,
            borderRadius: '10px',
            color: active ? '#fff' : C.textPri,
            fontSize: '0.88rem',
            fontWeight: 700,
            cursor: 'pointer',
            minHeight: '48px',
            transition: 'all 0.15s ease',
            letterSpacing: '0.02em',
          }}>{opt.label}</button>
        )
      })}
    </div>
  )
}

function statusFromStars(stars: number): 'FAILED' | 'MODERATE' | 'PASS' {
  if (stars <= 2) return 'FAILED'
  if (stars === 3) return 'MODERATE'  // Moderate condition = pending further review
  return 'PASS'  // 4-5 stars = completed/passed
}

interface InspectionFormProps {
  scannedVehicle?: {
    equip_no: string
    description?: string
    company?: string
    manufacturer?: string
    unit_model?: string
    commissioning_status?: string
    expired_date?: string
  } | null
  onShowToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export default function InspectionForm({ scannedVehicle, onShowToast }: InspectionFormProps = {}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const showToast = onShowToast ?? ((_type: string, msg: string) => alert(msg))
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Form data matching original Bootstrap template
  const [inspectorName, setInspectorName] = useState('')
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().split('T')[0])
  const [brakeCondition, setBrakeCondition] = useState('')
  const [tireCondition, setTireCondition] = useState('')
  const [engineCondition, setEngineCondition] = useState('')
  const [bodyCondition, setBodyCondition] = useState('')
  const [interiorCondition, setInteriorCondition] = useState('')
  const [lightsWorking, setLightsWorking] = useState('')
  const [notes, setNotes] = useState('')
  const [odometerReading, setOdometerReading] = useState('')
  const [overallCondition, setOverallCondition] = useState('')
  const [createServiceRequest, setCreateServiceRequest] = useState(false)

  // QR Code and Equipment Identification
  const [equipmentNumber, setEquipmentNumber] = useState('')
  const [vehicleDetails, setVehicleDetails] = useState<any>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [photos, setPhotos] = useState<{ id: string; preview: string; ratio: number }[]>([])
  const [gpsLatitude, setGpsLatitude] = useState<number | null>(null)
  const [gpsLongitude, setGpsLongitude] = useState<number | null>(null)
  const [locationName, setLocationName] = useState('')

  useEffect(() => {
    if (!['poor', 'critical'].includes(overallCondition) && createServiceRequest) {
      setCreateServiceRequest(false)
    }
  }, [overallCondition, createServiceRequest])

  // KIMPER-specific state
  const [kimperDetails, setKimperDetails] = useState<any>(null)
  const [isKimperScan, setIsKimperScan] = useState(false)

  // Auto-populate equipment number from scanned vehicle
  useEffect(() => {
    if (scannedVehicle?.equip_no) {
      console.log('📋 Auto-populating equipment number from QR scan:', scannedVehicle.equip_no)
      setEquipmentNumber(scannedVehicle.equip_no)
      setVehicleDetails(scannedVehicle)
    }
  }, [scannedVehicle])

  // Ensure form starts at the top when component mounts
  useEffect(() => {
    // Multiple approaches to ensure we start at the top
    const scrollToTop = () => {
      // Scroll window to top
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })

      // Scroll any scrollable containers to top
      const containers = [
        document.querySelector('.professional-inspection-form'),
        document.querySelector('.prism-container'),
        document.body,
        document.documentElement
      ]

      containers.forEach(container => {
        if (container) {
          container.scrollTop = 0
        }
      })
    }

    // Execute immediately
    scrollToTop()

    // Also execute after a short delay to handle any async rendering
    const timeoutId = setTimeout(scrollToTop, 100)

    return () => clearTimeout(timeoutId)
  }, [])

  // Calculate star rating based on conditions
  const calculateStarRating = () => {
    if (!overallCondition) return 0

    switch (overallCondition) {
      case 'excellent': return 5
      case 'good': return 4
      case 'fair': return 3
      case 'poor': return 2
      case 'critical': return 1
      default: return 0
    }
  }

  // Photo capture uses Android's camera/file picker instead of the native
  // Capacitor Camera plugin. This is more stable on Samsung/Android 14+ and
  // prevents a native plugin crash from killing the whole app.
  async function addPhoto() {
    const allowed = await ensureNativeCameraPermission()
    if (!allowed) {
      showToast('error', 'Camera permission denied. Enable camera permission in Android app settings.')
      await openNativeAppSettings()
      return
    }
    photoInputRef.current?.click()
  }

  async function handlePhotoFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const rawDataUrl = await readImageFileAsDataUrl(file)
      const { dataUrl, compressionRatio } = await compressDataUrl(rawDataUrl, 0.75)
      const newPhoto = {
        id: crypto.randomUUID(),
        preview: dataUrl,
        ratio: compressionRatio
      }

      setPhotos(prev => [...prev, newPhoto])
    } catch (error) {
      console.error('Photo selection error:', error)
      showToast('error', 'Photo capture failed. Please try again.')
    }
  }

  const removePhoto = (photoId: string) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId))
  }

  // GPS Location capture using native Capacitor Geolocation
  async function getCurrentLocation() {
    try {
      // Check and request location permissions first
      const check = await Geolocation.checkPermissions()
      console.log('Location permission check:', check)

      let locationPerm = check.location
      if (locationPerm !== 'granted') {
        const permission = await Geolocation.requestPermissions()
        console.log('Location permission request result:', permission)
        locationPerm = permission.location
      }

      if (locationPerm !== 'granted') {
        showToast('error', 'Location permission is required. Please enable it in settings.')
        return
      }

      let position
      try {
        // Try high accuracy (GPS) first with shorter timeout
        position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 })
      } catch (gpsError) {
        console.warn('GPS high accuracy failed, falling back to network location:', gpsError)
        // Fallback to network/cell tower location — much more reliable
        position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 })
      }

      setGpsLatitude(position.coords.latitude)
      setGpsLongitude(position.coords.longitude)
      // Only overwrite the manual label if it's empty — preserve anything the
      // inspector typed (e.g. "Warehouse A") while still capturing coords.
      setLocationName((prev) =>
        prev.trim() ? prev : `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`
      )
    } catch (error) {
      console.error('Location error:', error)
      const errorMsg = (error as Error).message || String(error)
      if (errorMsg.includes('permission') || errorMsg.includes('denied')) {
        showToast('error', 'Location permission denied. Please enable location access in app settings.')
      } else {
        showToast('error', 'Unable to get location: ' + errorMsg)
      }
    }
  }



  // Open the inline QR scanner modal. The modal handles getUserMedia + zxing
  // decoding and calls back via onResult. This replaces the unmaintained
  // @capacitor-community/barcode-scanner plugin which crashed on Android 14+.
  function scanQRCode() {
    setScanError('')
    setIsScanning(true)
  }

  async function handleScanResult(content: string) {
    setIsScanning(false)
    if (content) {
      console.log('🔍 QR Code scanned:', content)
      await processQRCode(content)
    }
  }

  async function processQRCode(qrContent: string) {
    try {
      console.log('🔍 QR Code scanned:', qrContent)

      // Handle KIMPER QR codes: http://10.40.21.184:8082/kimper/qr/12918
      if (qrContent.includes('/kimper/qr/')) {
        console.log('👤 KIMPER QR code detected')
        const parts = qrContent.split('/kimper/qr/')
        if (parts.length > 1) {
          const kimperId = parts[1].split('?')[0].split('#')[0] // Remove query params
          console.log('👤 KIMPER ID:', kimperId)
          setIsKimperScan(true)
          await lookupKimperDetails(kimperId)
          return
        }
      }

      // Handle Equipment/Vehicle QR codes
      setIsKimperScan(false)

      // Token-format sticker: /inspect/t/<token> (current default). Resolve the
      // token to a vehicle, then reuse the equip_no lookup so all UI state fills.
      // Must run BEFORE the legacy /inspect/<id> branch (token URLs also contain
      // "/inspect/").
      const tokenMatch = qrContent.match(/\/inspect\/t\/([^/?#]+)/)
      if (tokenMatch) {
        const token = decodeURIComponent(tokenMatch[1])
        let v = await offlineDataSync.lookupVehicleByToken(token)
        if (!v) {
          try {
            const resp = await apiFetch(`/api/mobile/vehicles/by-token/${encodeURIComponent(token)}`, { method: 'GET' })
            if (resp.ok) {
              const result = await resp.json()
              if (result.success && result.vehicle) v = result.vehicle
            }
          } catch (e) {
            console.warn('⚠️ Token vehicle lookup failed:', e)
          }
        }
        if (v?.equip_no) {
          setEquipmentNumber(v.equip_no)
          await lookupVehicleDetails(v.equip_no)
        } else {
          setScanError('Vehicle not found for this QR code')
        }
        return
      }

      let equipNo = qrContent

      // Handle different QR code formats
      if (qrContent.startsWith('EQUIP:')) {
        equipNo = qrContent.replace('EQUIP:', '')
      } else if (qrContent.includes('/inspect/')) {
        // Handle URL format: http://domain/inspect/EQUIP123
        const parts = qrContent.split('/inspect/')
        if (parts.length > 1) {
          equipNo = parts[1]
        }
      }

      console.log('🔍 Processing equipment number:', equipNo)
      setEquipmentNumber(equipNo)

      // Look up vehicle details from database
      await lookupVehicleDetails(equipNo)

    } catch (error) {
      console.error('❌ QR processing error:', error)
      setScanError('Failed to process QR code')
    }
  }

  async function lookupKimperDetails(kimperId: string) {
    try {
      console.log('👤 Looking up KIMPER details for ID:', kimperId)
      setScanError('')

      // Use the mobile JSON API endpoint (not the web HTML page /kimper/qr/{id})
      const response = await apiFetch(`/api/mobile/kimper/${kimperId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (response.ok) {
        const data = await response.json()
        console.log('✅ KIMPER data:', data)
        setKimperDetails(data)

        // Auto-fill inspector name from KIMPER data
        if (data.name) {
          setInspectorName(data.name)
          console.log('✅ Inspector name set to:', data.name)
        }

        setScanError('')
      } else {
        console.error('❌ KIMPER lookup failed:', response.status)
        setScanError(`KIMPER not found (ID: ${kimperId})`)
      }

    } catch (error) {
      console.error('❌ KIMPER lookup error:', error)
      setScanError('Failed to load KIMPER data. Check network connection.')
    }
  }

  async function lookupVehicleDetails(equipNo: string) {
    try {
      const normalized = (equipNo || '').toUpperCase().trim()
      console.log('🔍 Looking up vehicle details for:', normalized)

      // 1) Try offline sync data first (WhatsApp-like instant access)
      const offlineVehicle = await offlineDataSync.lookupVehicleOffline(normalized)
      if (offlineVehicle) {
        console.log('📦 Using offline synced vehicle data')
        setVehicleDetails({
          make: offlineVehicle.manufacturer || 'Unknown',
          model: offlineVehicle.unit_model || 'Unknown',
          equip_no: offlineVehicle.equip_no,
          description: offlineVehicle.description,
          company: offlineVehicle.company,
          commissioning_status: offlineVehicle.commissioning_status,
          expired_date: offlineVehicle.expired_date
        })
        setScanError('')
        if (offlineVehicle.description) {
          setNotes(`Equipment: ${offlineVehicle.description} (${offlineVehicle.equip_no})`)
        }
        return
      }

      // 2) Use centralized API with intelligent failover (cloud/local/dev)
      const response = await apiFetch(`/api/mobile/vehicles/qr/${encodeURIComponent(normalized)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.vehicle) {
          console.log('✅ Vehicle found:', data.vehicle)
          setVehicleDetails(data.vehicle)
          setScanError('')

          if (data.vehicle.description) {
            setNotes(`Equipment: ${data.vehicle.description} (${data.vehicle.equip_no})`)
          }
        } else {
          console.warn('⚠️ Vehicle not found in lookup response:', (data && data.message) || normalized)
          setVehicleDetails(null)
          setScanError('')
        }
      } else {
        if (response.status === 404) {
          console.warn('⚠️ Equipment not found (404):', normalized)
          setVehicleDetails(null)
          setScanError('')
          return
        }
        console.error('❌ API request failed:', response.status)
        setScanError('Failed to lookup equipment details')
        setVehicleDetails(null)
      }
    } catch (error) {
      console.error('❌ Vehicle lookup error:', error)
      setScanError('Network error during equipment lookup')
      setVehicleDetails(null)
    }
  }



  async function submit() {
    // Validation
    if (!inspectorName.trim()) {
      showToast('warning', t('requiredFieldMissing'))
      return
    }
    if (!overallCondition) {
      showToast('warning', t('requiredFieldMissing'))
      return
    }

    setIsSubmitting(true)
    const starRating = calculateStarRating()
    const status = statusFromStars(starRating)
    const shouldCreateServiceRequest = createServiceRequest && starRating <= 2

    // Prepend the manual location to notes so it's persisted alongside the
    // inspection (the `inspections` table has gps_latitude/gps_longitude but
    // no dedicated location_name column).
    const trimmedLocation = locationName.trim()
    const notesWithLocation = trimmedLocation
      ? (notes.trim() ? `📍 ${trimmedLocation}\n${notes}` : `📍 ${trimmedLocation}`)
      : notes

    try {
      // Create inspection object for SQL Server
      const inspection: Inspection = {
        vehicle_equip_no: equipmentNumber || 'MOBILE_SCAN',
        create_service_request: shouldCreateServiceRequest,
        inspection_date: inspectionDate,
        inspector_name: inspectorName.trim(),
        inspection_type: 'Mobile Vehicle Inspection',
        status: status,
        notes: notesWithLocation,
        odometer_reading: odometerReading ? parseInt(odometerReading) : undefined,
        tire_condition: tireCondition,
        brake_condition: brakeCondition,
        lights_working: lightsWorking === 'yes',
        engine_condition: engineCondition,
        body_condition: bodyCondition,
        interior_condition: interiorCondition,
        star_rating: starRating,
        gps_latitude: gpsLatitude || undefined,
        gps_longitude: gpsLongitude || undefined
      }

      // Save directly to SQL Server via web app API
      console.log('📤 Submitting inspection to SQL Server...')
      const inspectionId = await sqlServerService.createInspection(inspection)

      if (inspectionId) {
        console.log('✅ Inspection saved with ID:', inspectionId)

        // Upload photos
        let totalPhotos = 0
        if (photos.length > 0) {
          console.log(`📸 Uploading ${photos.length} photos...`)
          for (const photo of photos) {
            try {
              // Convert data URL to blob
              const response = await fetch(photo.preview)
              const blob = await response.blob()

              const success = await sqlServerService.uploadPhoto(inspectionId, blob, 'general')
              if (success) {
                console.log('✅ Photo uploaded successfully')
                totalPhotos++
              } else {
                console.warn('⚠️ Photo upload failed')
              }
            } catch (photoError) {
              console.error('❌ Photo upload error:', photoError)
            }
          }
        }

        showToast('success', `${t('inspectionSaved')} · ${starRating}/5 · ${status} · ${totalPhotos} 📷`)
        resetForm()
        setIsSubmitting(false)
        // Close the inspection screen and return to the dashboard after the
        // toast has had a moment to register (keeps the success feedback visible).
        setTimeout(() => navigate('/home'), 1200)
      } else {
        throw new Error('Failed to save inspection')
      }

    } catch (error) {
      console.warn('📴 Online submit failed, queueing offline:', error)

      // Offline-first fallback: persist to IndexedDB and enqueue for background sync
      const localId = crypto.randomUUID()

      await setInspection({
        id: localId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vehicleId: equipmentNumber || 'MOBILE_SCAN', // Use equipment number as vehicle ID
        vehicleEquipNo: equipmentNumber || 'MOBILE_SCAN',
        inspectorName: inspectorName.trim(),
        inspectionDate: inspectionDate,
        inspectionType: 'Mobile Vehicle Inspection',
        status: statusFromStars(starRating),
        overallStars: (starRating || 0) as 1|2|3|4|5,
        notes: notesWithLocation || undefined,
        odometerReading: odometerReading ? parseInt(odometerReading) : undefined,
        tireCondition: tireCondition,
        brakeCondition: brakeCondition,
        lightsWorking: lightsWorking || 'no',
        engineCondition: engineCondition,
        bodyExteriorCondition: bodyCondition,
        bodyInteriorCondition: interiorCondition,
        gpsLatitude: gpsLatitude || undefined,
        gpsLongitude: gpsLongitude || undefined,
        createServiceRequest: shouldCreateServiceRequest,
        pendingSync: true
      })

      // Persist photos locally and enqueue them
      for (const p of photos) {
        const photoId = crypto.randomUUID()
        await addPhotoLocal({
          id: photoId,
          inspectionId: localId,
          category: 'general',
          mime: 'image/jpeg',
          dataURL: p.preview,
          compressionRatio: p.ratio,
          createdAt: Date.now(),
          pendingSync: true
        })
        await enqueue({ kind: 'photo', refId: photoId, priority: 2 })
      }

      // Enqueue the inspection itself
      await enqueue({ kind: 'inspection', refId: localId, priority: 1 })

      // Trigger immediate sync attempt if network is available
      flushAllPending().catch(() => {})

      showToast('info', t('inspectionSavedOffline'))
      resetForm()
      setIsSubmitting(false)
      // Mirror the online behavior: return to the dashboard after queueing.
      setTimeout(() => navigate('/home'), 1200)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function resetForm() {
    setInspectorName('')
    setInspectionDate(new Date().toISOString().split('T')[0])
    setBrakeCondition('')
    setTireCondition('')
    setEngineCondition('')
    setBodyCondition('')
    setInteriorCondition('')
    setLightsWorking('')
    setOverallCondition('')
    setNotes('')
    setOdometerReading('')
    setCreateServiceRequest(false)
    setPhotos([])
    setGpsLatitude(null)
    setGpsLongitude(null)
    setLocationName('')
    setEquipmentNumber('')
    setVehicleDetails(null)
    setScanError('')
    setIsScanning(false)
  }

  const submitDisabled = !inspectorName.trim() || !overallCondition || isSubmitting

  return (
    <div style={{ minHeight: '100vh', background: '#050a12', paddingBottom: '32px' }}>
      {/* Inline QR scanner overlay (replaces the legacy native barcode plugin). */}
      {isScanning && (
        <InlineQRScanner
          onResult={handleScanResult}
          onClose={() => setIsScanning(false)}
        />
      )}

      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(5,10,18,0.88)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '14px 16px' }}>
        <h1 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.textPri, margin: 0, textAlign: 'center', letterSpacing: '0.02em' }}>📋 {t('vehicleInspection')}</h1>
      </div>

      <div style={{ padding: '16px', maxWidth: '560px', margin: '0 auto' }}>
        {/* Vehicle summary card (shown when a vehicle was scanned/looked-up) */}
        {vehicleDetails && (() => {
          const make = vehicleDetails.make || vehicleDetails.manufacturer || ''
          const model = vehicleDetails.model || vehicleDetails.unit_model || ''
          const name = `${make} ${model}`.trim() || vehicleDetails.description || t('fleetVehicle')
          return (
            <div className="prism-card" style={{ padding: '14px 16px', marginBottom: '14px', borderColor: 'rgba(252,65,0,0.25)' }}>
              <div style={{ fontSize: '0.7rem', color: C.gold, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '6px' }}>{t('vehicleInformation')}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: C.textPri }}>{name}</div>
              <div style={{ fontSize: '0.85rem', color: C.textMut, marginTop: '2px' }}>{t('equipmentNumber')}: <span style={{ color: C.textPri, fontWeight: 600 }}>{equipmentNumber}</span></div>
              {locationName && <div style={{ fontSize: '0.8rem', color: C.textMut, marginTop: '4px' }}>📍 {locationName}</div>}
            </div>
          )
        })()}

        <form onSubmit={handleSubmit}>
          {/* Equipment Identification (only shown when no vehicle was pre-loaded from scan flow) */}
          {!scannedVehicle && (
            <Section title={t('equipmentIdentification')} icon="🏷️">
              <button type="button" onClick={scanQRCode} disabled={isScanning} style={{
                width: '100%', padding: '14px', marginBottom: '12px',
                background: isScanning ? 'rgba(252,65,0,0.4)' : `linear-gradient(135deg, ${C.accent}, ${C.accentDark})`,
                border: 'none', borderRadius: '10px', color: '#fff', fontSize: '0.95rem', fontWeight: 700,
                minHeight: '52px', cursor: isScanning ? 'not-allowed' : 'pointer', letterSpacing: '0.02em',
                boxShadow: isScanning ? 'none' : '0 4px 12px rgba(252,65,0,0.25)',
              }}>
                {isScanning ? `⏳ ${t('loading')}` : `📷 ${t('scanEquipmentQR')}`}
              </button>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" style={inputStyle} placeholder={t('enterEquipmentNumber')} value={equipmentNumber}
                  onChange={(e) => { setEquipmentNumber(e.target.value.toUpperCase().trim()); setScanError('') }} />
                <button type="button" onClick={() => equipmentNumber && lookupVehicleDetails(equipmentNumber)}
                  disabled={!equipmentNumber.trim()}
                  style={{ padding: '12px 18px', background: 'rgba(252,65,0,0.15)', border: `1px solid ${C.borderHover}`,
                    borderRadius: '10px', color: C.accent, fontWeight: 700, minHeight: '48px',
                    cursor: equipmentNumber.trim() ? 'pointer' : 'not-allowed', opacity: equipmentNumber.trim() ? 1 : 0.5 }}>
                  🔍
                </button>
              </div>

              {scanError && (
                <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(239,68,68,0.12)',
                  border: `1px solid rgba(239,68,68,0.3)`, borderRadius: '8px', color: '#fca5a5', fontSize: '0.85rem' }}>
                  ⚠️ {scanError}
                </div>
              )}

              {kimperDetails && isKimperScan && (
                <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(59,130,246,0.1)',
                  border: `1px solid rgba(59,130,246,0.3)`, borderRadius: '8px', color: '#93c5fd', fontSize: '0.85rem' }}>
                  <strong>👤 KIMPER:</strong> {kimperDetails.name || 'Inspector'} · ID: {kimperDetails.id || 'N/A'}
                </div>
              )}
            </Section>
          )}

          {/* Inspector Information */}
          <Section title={t('inspectorInformation')} icon="👤">
            <div style={{ marginBottom: '14px' }}>
              <FieldLabel required htmlFor="inspector-name">{t('inspectorName')}</FieldLabel>
              <input id="inspector-name" type="text" style={inputStyle} value={inspectorName}
                onChange={(e) => setInspectorName(e.target.value)} placeholder={t('inspectorNamePlaceholder')} required />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <FieldLabel htmlFor="inspection-date">{t('inspectionDate')}</FieldLabel>
              <input id="inspection-date" type="date" style={inputStyle} value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="odometer">{t('odometerHours')}</FieldLabel>
              <input id="odometer" type="number" inputMode="numeric" style={inputStyle} value={odometerReading}
                onChange={(e) => setOdometerReading(e.target.value)} placeholder={t('odometerPlaceholder')} />
            </div>
          </Section>

          {/* Component Assessment */}
          <Section title={t('componentAssessment')} icon="🛠️">
            <p style={{ fontSize: '0.82rem', color: C.textMut, margin: '0 0 14px 0' }}>{t('rateComponents')}</p>
            {([
              { label: t('brakes'),       icon: '🛑', value: brakeCondition,    set: setBrakeCondition },
              { label: t('tires'),        icon: '⚫', value: tireCondition,     set: setTireCondition },
              { label: t('engine'),       icon: '⚙️', value: engineCondition,   set: setEngineCondition },
              { label: t('bodyExterior'), icon: '🚚', value: bodyCondition,     set: setBodyCondition },
              { label: t('bodyInterior'), icon: '🪑', value: interiorCondition, set: setInteriorCondition },
            ]).map(c => (
              <div key={c.label} style={{ marginBottom: '14px' }}>
                <FieldLabel>{c.icon} {c.label}</FieldLabel>
                <Segmented value={c.value} onChange={(v) => c.set(v)} options={[
                  { value: 'good', label: t('conditionGood'), tone: 'success' },
                  { value: 'fair', label: t('conditionFair'), tone: 'warning' },
                  { value: 'poor', label: t('conditionPoor'), tone: 'danger' },
                ]} />
              </div>
            ))}
          </Section>

          {/* Lights Check */}
          <Section title={t('lightsCheck')} icon="💡">
            <p style={{ fontSize: '0.85rem', color: C.textMut, margin: '0 0 12px 0' }}>{t('lightsWorking')}</p>
            <Segmented value={lightsWorking} onChange={(v) => setLightsWorking(v)} options={[
              { value: 'yes', label: `✓ ${t('yes')}`, tone: 'success' },
              { value: 'no',  label: `✕ ${t('no')}`,  tone: 'danger'  },
            ]} />
          </Section>

          {/* Overall Vehicle Condition */}
          <Section title={`${t('overallCondition')} *`} icon="⭐">
            <p style={{ fontSize: '0.82rem', color: C.textMut, margin: '0 0 12px 0' }}>{t('overallConditionDesc')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {([
                { value: 'excellent', label: t('excellent'),     stars: 5 },
                { value: 'good',      label: t('good'),          stars: 4 },
                { value: 'fair',      label: t('fair'),          stars: 3 },
                { value: 'poor',      label: t('poor'),          stars: 2 },
                { value: 'critical',  label: t('critical'),      stars: 1 },
              ]).map(o => {
                const active = overallCondition === o.value
                return (
                  <button key={o.value} type="button" aria-pressed={active}
                    aria-label={`${o.label} (${o.stars} star${o.stars === 1 ? '' : 's'})`}
                    onClick={() => setOverallCondition(o.value)} style={{
                    padding: '14px 16px', minHeight: '52px',
                    background: active ? 'linear-gradient(135deg, rgba(252,65,0,0.22), rgba(252,65,0,0.06))' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${active ? C.accent : C.border}`, borderRadius: '10px',
                    color: C.textPri, fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer',
                    textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'all 0.15s ease',
                  }}>
                    <span>{o.label}</span>
                    <span style={{ color: C.gold, letterSpacing: '1px', fontSize: '0.85rem' }}>{'★'.repeat(o.stars)}{'☆'.repeat(5 - o.stars)}</span>
                  </button>
                )
              })}
            </div>

            {(overallCondition === 'poor' || overallCondition === 'critical') && (
              <div style={{ marginTop: '14px', padding: '12px 14px', background: 'rgba(245,158,11,0.1)',
                border: `1px solid rgba(245,158,11,0.3)`, borderRadius: '10px' }}>
                <div style={{ fontSize: '0.85rem', color: '#fbbf24', marginBottom: '10px' }}>⚠️ {t('serviceRequestPrompt')}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', minHeight: '44px' }}>
                  <input type="checkbox" id="serviceRequestTop" checked={createServiceRequest}
                    onChange={(e) => setCreateServiceRequest(e.target.checked)}
                    style={{ width: '20px', height: '20px', accentColor: C.accent, cursor: 'pointer' }} />
                  <span style={{ color: C.textPri, fontWeight: 600, fontSize: '0.9rem' }}>🔧 {t('createServiceRequest')}</span>
                </label>
              </div>
            )}
          </Section>

          {/* Additional Notes */}
          <Section title={t('additionalNotes')} icon="📝">
            <textarea rows={4} style={{ ...inputStyle, minHeight: '100px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} />
          </Section>

          {/* Photos */}
          <Section title={t('inspectionPhotos')} icon="📷">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoFileSelected}
              style={{ display: 'none' }}
            />
            <button type="button" onClick={addPhoto} style={{
              width: '100%', padding: '14px', marginBottom: photos.length > 0 ? '12px' : 0,
              background: 'rgba(255,255,255,0.03)', border: `1px dashed ${C.borderHover}`, borderRadius: '10px',
              color: C.accent, fontSize: '0.9rem', fontWeight: 700, minHeight: '52px', cursor: 'pointer',
            }}>📷 {t('takePhoto')}</button>
            {photos.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                {photos.map(photo => (
                  <div key={photo.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${C.border}` }}>
                    <img src={photo.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button type="button" onClick={() => removePhoto(photo.id)} style={{
                      position: 'absolute', top: '4px', right: '4px', width: '26px', height: '26px',
                      background: 'rgba(239,68,68,0.9)', border: 'none', borderRadius: '50%', color: '#fff',
                      fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* GPS Location */}
          <Section title={t('gpsLocation')} icon="📍">
            <button type="button" onClick={getCurrentLocation} style={{
              width: '100%', padding: '14px', marginBottom: '10px',
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: '10px',
              color: C.textPri, fontSize: '0.9rem', fontWeight: 600, minHeight: '52px', cursor: 'pointer',
            }}>📍 {t('getCurrentLocation')}</button>

            <FieldLabel htmlFor="location-name">{t('locationNameLabel')}</FieldLabel>
            <input
              id="location-name"
              type="text"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder={t('locationNamePlaceholder')}
              style={inputStyle}
            />

            {(gpsLatitude && gpsLongitude) && (
              <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(34,197,94,0.1)',
                border: `1px solid rgba(34,197,94,0.3)`, borderRadius: '8px', color: '#86efac', fontSize: '0.85rem' }}>
                ✓ {t('locationCaptured')}: {gpsLatitude.toFixed(6)}, {gpsLongitude.toFixed(6)}
              </div>
            )}
          </Section>

          {/* Submit */}
          <button type="submit" disabled={submitDisabled} style={{
            width: '100%', padding: '16px', marginTop: '8px',
            background: submitDisabled ? 'rgba(255,255,255,0.05)' : `linear-gradient(135deg, ${C.accent}, ${C.accentDark})`,
            border: 'none', borderRadius: '12px', color: submitDisabled ? C.textMut : '#fff',
            fontSize: '1rem', fontWeight: 800, minHeight: '56px',
            cursor: submitDisabled ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em', textTransform: 'uppercase',
            boxShadow: submitDisabled ? 'none' : '0 6px 18px rgba(252,65,0,0.32)',
            transition: 'all 0.2s ease',
          }}>
            {isSubmitting ? `⏳ ${t('submitting')}` : `✓ ${t('submitInspection')}`}
          </button>
        </form>
      </div>
    </div>
  )
}
