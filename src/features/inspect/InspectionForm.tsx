import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { Camera, CameraResultType } from '@capacitor/camera'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { Capacitor } from '@capacitor/core'
import { compressDataUrl } from '../../services/compress'
import { sqlServerService, type Inspection } from '../../services/sqlserver'
import { apiFetch } from '../../services/api'
import offlineStorage from '../../services/offlineStorage'
import { offlineDataSync } from '../../services/offlineDataSync'
import { setInspection, addPhoto as addPhotoLocal, enqueue } from '../../services/db'
import './InspectionFormProfessional.css'

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
}

export default function InspectionForm({ scannedVehicle }: InspectionFormProps = {}) {
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
  const [locationName, setLocationName] = useState('') // Reserved for future GPS location feature

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
        document.querySelector('.werci-container'),
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

  // Photo capture
  async function addPhoto() {
    try {
      const img = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        quality: 90,
        allowEditing: false
      })
      if (!img.dataUrl) return

      const { dataUrl, compressionRatio } = await compressDataUrl(img.dataUrl, 0.75)
      const newPhoto = {
        id: crypto.randomUUID(),
        preview: dataUrl,
        ratio: compressionRatio
      }

      setPhotos(prev => [...prev, newPhoto])
    } catch (error) {
      console.error('Camera error:', error)
      alert('Camera access failed. Please check permissions.')
    }
  }

  const removePhoto = (photoId: string) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId))
  }

  // GPS Location capture
  async function getCurrentLocation() {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this browser.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsLatitude(position.coords.latitude)
        setGpsLongitude(position.coords.longitude)
        setLocationName(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`)
      },
      (error) => {
        console.error('Location error:', error)
        alert('Unable to get location. Please check permissions.')
      }
    )
  }



  async function scanQRCode() {
    try {
      setIsScanning(true)
      setScanError('')

      // Check camera permission
      const { camera } = await BarcodeScanner.checkPermissions()

      if (camera !== 'granted') {
        const { camera: requestedPermission } = await BarcodeScanner.requestPermissions()
        if (requestedPermission !== 'granted') {
          setScanError('Camera permission denied')
          setIsScanning(false)
          return
        }
      }

      // Start scanning
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
        setIsScanning(false)
        listener.remove()

        // Process the scanned barcode
        if (scannedBarcode) {
          console.log('🔍 QR Code scanned:', scannedBarcode)
          await processQRCode(scannedBarcode)
        }
      })

      // Install Google Barcode Scanner module (Android only)
      if (Capacitor.getPlatform() === 'android') {
        try {
          await BarcodeScanner.installGoogleBarcodeScannerModule()
        } catch (error) {
          console.log('ℹ️ Google Barcode Scanner module already installed or not needed')
        }
      }

      await BarcodeScanner.startScan()

    } catch (error) {
      console.error('❌ QR scan error:', error)
      setScanError('QR scan failed: ' + (error as Error).message)
      setIsScanning(false)
      document.body.classList.remove('qr-scanning')
      await BarcodeScanner.stopScan().catch(() => {})
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

      // Try to fetch KIMPER data from server
      const response = await apiFetch(`/kimper/qr/${kimperId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      if (response.ok) {
        // Check if it's HTML (web view) or JSON (API response)
        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          console.log('✅ KIMPER data (JSON):', data)
          setKimperDetails(data)

          // Auto-fill inspector name from KIMPER data
          if (data.name) {
            setInspectorName(data.name)
            console.log('✅ Inspector name set to:', data.name)
          }

          setScanError('')
        } else {
          // HTML response - parse it to extract KIMPER data
          const html = await response.text()
          console.log('📄 KIMPER HTML response received')

          // Try to extract KIMPER name from HTML
          const nameMatch = html.match(/<h2[^>]*>([^<]+)<\/h2>/)
          if (nameMatch && nameMatch[1]) {
            const kimperName = nameMatch[1].trim()
            setInspectorName(kimperName)
            setKimperDetails({ name: kimperName, id: kimperId })
            console.log('✅ KIMPER name extracted from HTML:', kimperName)
            setScanError('')
          } else {
            setScanError('KIMPER data found but could not extract name')
          }
        }
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

      // 2) Fallback to legacy offline cache
      const cached = await offlineStorage.getVehicleByEquipNo(normalized)
      if (cached) {
        console.log('📦 Using legacy offline cached vehicle')
        setVehicleDetails(cached)
        setScanError('')
        if (cached.description) {
          setNotes(`Equipment: ${cached.description} (${cached.equip_no})`)
        }
        return
      }

      // 3) Use centralized API with intelligent failover (cloud/local/dev)
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
      alert('Please enter Inspector Name')
      return
    }
    if (!overallCondition) {
      alert('Please select Overall Vehicle Condition')
      return
    }

    try {
      // Calculate star rating from overall condition
      const getStarRating = (condition: string): number => {
        switch (condition) {
          case 'excellent': return 5
          case 'good': return 4
          case 'fair': return 3
          case 'poor': return 2
          case 'critical': return 1
          default: return 0
        }
      }

      const starRating = getStarRating(overallCondition)
      const status = statusFromStars(starRating)

      // Create inspection object for SQL Server
      const inspection: Inspection = {
        vehicle_equip_no: equipmentNumber || 'MOBILE_SCAN',
        inspection_date: inspectionDate,
        inspector_name: inspectorName.trim(),
        inspection_type: 'Mobile Vehicle Inspection',
        status: status,
        notes: notes,
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

        alert(`✅ Inspection saved to database!\n\nOverall Rating: ${starRating}/5 stars (${overallCondition})\nStatus: ${status}\nPhotos: ${totalPhotos}`)
        resetForm()
      } else {
        throw new Error('Failed to save inspection')
      }

    } catch (error) {
      console.warn('📴 Online submit failed, queueing offline:', error)

      // Offline-first fallback: persist to IndexedDB and enqueue for background sync
      const localId = crypto.randomUUID()
      const starRating = ((): number => {
        switch (overallCondition) {
          case 'excellent': return 5
          case 'good': return 4
          case 'fair': return 3
          case 'poor': return 2
          case 'critical': return 1
          default: return 0
        }
      })()

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
        notes: notes || undefined,
        odometerReading: odometerReading ? parseInt(odometerReading) : undefined,
        tireCondition: tireCondition,
        brakeCondition: brakeCondition,
        lightsWorking: lightsWorking || 'no',
        engineCondition: engineCondition,
        bodyExteriorCondition: bodyCondition,
        bodyInteriorCondition: interiorCondition,
        gpsLatitude: gpsLatitude || undefined,
        gpsLongitude: gpsLongitude || undefined,
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

      alert('✅ Saved offline. Your inspection will auto-sync when back online.')
      resetForm()
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

  return (
    <div className="professional-inspection-form">
      {/* Mobile Header */}
      <div className="mobile-header">
        <div className="container">
          <h1 className="text-center mb-0">
            <i className="fas fa-clipboard-check me-2"></i>
            Mobile Vehicle Inspection
          </h1>
        </div>
      </div>

      <div className="container">
        {/* Vehicle Info */}
        {vehicleDetails && (
          <div className="vehicle-info">
            <h4><i className="fas fa-truck text-success me-2"></i>{vehicleDetails.make} {vehicleDetails.model}</h4>
            <p className="text-muted mb-0">Equipment: {equipmentNumber}</p>
          </div>
        )}

        <div className="form-backdrop">
          <form onSubmit={handleSubmit}>
          {/* Equipment Identification */}
          <div className="form-section">
            <h5><i className="fas fa-qrcode"></i> Equipment Identification</h5>

            <button
              type="button"
              className="btn btn-primary w-100 mb-3"
              onClick={scanQRCode}
              disabled={isScanning}
            >
              {isScanning ? (
                <>
                  <i className="fas fa-spinner fa-spin me-2"></i>
                  Scanning QR Code...
                </>
              ) : (
                <>
                  <i className="fas fa-qrcode me-2"></i>
                  Scan Equipment QR Code
                </>
              )}
            </button>

            <div className="input-group">
              <input
                type="text"
                className="form-control"
                placeholder="Or enter equipment number manually"
                value={equipmentNumber}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase().trim();
                  setEquipmentNumber(v);
                  // Do not auto-lookup on manual typing; allow direct entry as requested
                  setScanError('');
                }}
              />
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => equipmentNumber && lookupVehicleDetails(equipmentNumber)}
                disabled={!equipmentNumber.trim()}
                title="Look up vehicle details"
              >
                🔍 Lookup
              </button>
            </div>

            {scanError && (
              <div className="alert alert-danger mt-2">{scanError}</div>
            )}

            {kimperDetails && isKimperScan && (
              <div className="alert alert-info mt-2">
                <strong>👤 KIMPER Scanned:</strong> {kimperDetails.name || 'Inspector'}
                <div className="text-muted small">ID: {kimperDetails.id || 'N/A'}</div>
                <div className="text-success small mt-1">✓ Inspector name auto-filled</div>
              </div>
            )}

            {vehicleDetails && !isKimperScan && (
              <div className="alert alert-success mt-2">
                <strong>Vehicle Found:</strong> {vehicleDetails.make} {vehicleDetails.model}
                {locationName && <div className="text-muted small">Location: {locationName}</div>}
              </div>
            )}
          </div>

      {/* Inspector Information */}
      <div className="form-section" aria-labelledby="inspector-section">
        <h5 id="inspector-section"><i className="fas fa-user"></i> Inspector Information</h5>

        <div className="inline-field mb-3">
          <label className="form-label mb-0" htmlFor="inspector-name">Inspector Name *</label>
          <input
            id="inspector-name"
            className="form-control"
            type="text"
            value={inspectorName}
            onChange={(e) => setInspectorName(e.target.value)}
            placeholder="Enter your name"
            required
          />
        </div>

        <div className="inline-field mb-3">
          <label className="form-label mb-0" htmlFor="inspection-date">Inspection Date</label>
          <input
            id="inspection-date"
            className="form-control"
            type="date"
            value={inspectionDate}
            onChange={(e) => setInspectionDate(e.target.value)}
          />
        </div>

        <div className="inline-field mb-0">
          <label className="form-label mb-0" htmlFor="odometer">Odometer / Hours Reading</label>
          <input
            id="odometer"
            className="form-control"
            type="number"
            value={odometerReading}
            onChange={(e) => setOdometerReading(e.target.value)}
            placeholder="Enter current reading"
            inputMode="numeric"
          />
        </div>
      </div>

          {/* Component Assessment */}
          <div className="form-section">
            <h5><i className="fas fa-tools"></i> Component Assessment</h5>
            <p className="text-muted">Rate each component individually</p>
            <small className="text-muted"><i className="fas fa-info-circle"></i> These individual ratings contribute to the star rating calculation but don't trigger service requests directly.</small>

            {/* Brakes */}
            <div className="mb-4">
              <label className="form-label"><i className="fas fa-stop-circle text-danger"></i> Brakes</label>
              <div className="btn-group w-100 segmented-3" role="group">
                <button
                  type="button"
                  className={`btn ${brakeCondition === 'good' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={() => setBrakeCondition('good')}
                >
                  Good
                </button>
                <button
                  type="button"
                  className={`btn ${brakeCondition === 'fair' ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setBrakeCondition('fair')}
                >
                  Fair
                </button>
                <button
                  type="button"
                  className={`btn ${brakeCondition === 'poor' ? 'btn-danger' : 'btn-outline-danger'}`}
                  onClick={() => setBrakeCondition('poor')}
                >
                  Poor
                </button>
              </div>
            </div>

            {/* Tires */}
            <div className="mb-4">
              <label className="form-label"><i className="fas fa-circle text-dark"></i> Tires</label>
              <div className="btn-group w-100 segmented-3" role="group">
                <button
                  type="button"
                  className={`btn ${tireCondition === 'good' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={() => setTireCondition('good')}
                >
                  Good
                </button>
                <button
                  type="button"
                  className={`btn ${tireCondition === 'fair' ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setTireCondition('fair')}
                >
                  Fair
                </button>
                <button
                  type="button"
                  className={`btn ${tireCondition === 'poor' ? 'btn-danger' : 'btn-outline-danger'}`}
                  onClick={() => setTireCondition('poor')}
                >
                  Poor
                </button>
              </div>
            </div>

            {/* Engine */}
            <div className="mb-4">
              <label className="form-label"><i className="fas fa-cog text-primary"></i> Engine</label>
              <div className="btn-group w-100 segmented-3" role="group">
                <button
                  type="button"
                  className={`btn ${engineCondition === 'good' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={() => setEngineCondition('good')}
                >
                  Good
                </button>
                <button
                  type="button"
                  className={`btn ${engineCondition === 'fair' ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setEngineCondition('fair')}
                >
                  Fair
                </button>
                <button
                  type="button"
                  className={`btn ${engineCondition === 'poor' ? 'btn-danger' : 'btn-outline-danger'}`}
                  onClick={() => setEngineCondition('poor')}
                >
                  Poor
                </button>
              </div>
            </div>

            {/* Body Exterior */}
            <div className="mb-4">
              <label className="form-label"><i className="fas fa-truck text-secondary"></i> Body Exterior</label>
              <div className="btn-group w-100 segmented-3" role="group">
                <button
                  type="button"
                  className={`btn ${bodyCondition === 'good' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={() => setBodyCondition('good')}
                >
                  Good
                </button>
                <button
                  type="button"
                  className={`btn ${bodyCondition === 'fair' ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setBodyCondition('fair')}
                >
                  Fair
                </button>
                <button
                  type="button"
                  className={`btn ${bodyCondition === 'poor' ? 'btn-danger' : 'btn-outline-danger'}`}
                  onClick={() => setBodyCondition('poor')}
                >
                  Poor
                </button>
              </div>
            </div>

            {/* Body Interior */}
            <div className="mb-4">
              <label className="form-label"><i className="fas fa-chair text-info"></i> Body Interior</label>
              <div className="btn-group w-100 segmented-3" role="group">
                <button
                  type="button"
                  className={`btn ${interiorCondition === 'good' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={() => setInteriorCondition('good')}
                >
                  Good
                </button>
                <button
                  type="button"
                  className={`btn ${interiorCondition === 'fair' ? 'btn-warning' : 'btn-outline-warning'}`}
                  onClick={() => setInteriorCondition('fair')}
                >
                  Fair
                </button>
                <button
                  type="button"
                  className={`btn ${interiorCondition === 'poor' ? 'btn-danger' : 'btn-outline-danger'}`}
                  onClick={() => setInteriorCondition('poor')}
                >
                  Poor
                </button>
              </div>
            </div>
          </div>

          {/* Lights Check */}
          <div className="form-section">
            <h5><i className="fas fa-lightbulb text-warning"></i> Lights Check</h5>
            <p>Are all lights working properly?</p>

            <div className="btn-group w-100" role="group">
              <button
                type="button"
                className={`btn ${lightsWorking === 'yes' ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => setLightsWorking('yes')}
              >
                <i className="fas fa-check"></i> Yes
              </button>
              <button
                type="button"
                className={`btn ${lightsWorking === 'no' ? 'btn-danger' : 'btn-outline-danger'}`}
                onClick={() => setLightsWorking('no')}
              >
                <i className="fas fa-times"></i> No
              </button>
            </div>
          </div>

          {/* Overall Vehicle Condition */}
          <div className="form-section">
            <h5><i className="fas fa-star text-warning"></i> Overall Vehicle Condition *</h5>
            <p className="text-muted">This determines the final star rating and inspection status</p>

            <div className="rating-list" role="group">
              <button
                type="button"
                aria-pressed={overallCondition === 'excellent'}
                className={`choice-row ${overallCondition === 'excellent' ? 'active' : ''}`}
                onClick={() => setOverallCondition('excellent')}
              >
                Excellent (5 stars)
              </button>
              <button
                type="button"
                aria-pressed={overallCondition === 'good'}
                className={`choice-row ${overallCondition === 'good' ? 'active' : ''}`}
                onClick={() => setOverallCondition('good')}
              >
                Good (4 stars)
              </button>
              <button
                type="button"
                aria-pressed={overallCondition === 'fair'}
                className={`choice-row ${overallCondition === 'fair' ? 'active' : ''}`}
                onClick={() => setOverallCondition('fair')}
              >
                Fair (3 stars)
              </button>
              <button
                type="button"
                aria-pressed={overallCondition === 'poor'}
                className={`choice-row ${overallCondition === 'poor' ? 'active' : ''}`}
                onClick={() => setOverallCondition('poor')}
              >
                Poor (2 stars)
              </button>
              <button
                type="button"
                aria-pressed={overallCondition === 'critical'}
                className={`choice-row ${overallCondition === 'critical' ? 'active' : ''}`}
                onClick={() => setOverallCondition('critical')}
              >
                Critical (1 star)
              </button>
            </div>

            {/* Star Rating Display */}
            {overallCondition && (
              <div className="alert alert-info mt-3">
                <strong>Current Rating:</strong> {calculateStarRating()} stars
              </div>
            )}

            {/* Service Request (shown immediately after Overall Condition) */}
            {(overallCondition === 'poor' || overallCondition === 'critical') && (
              <div className="mt-3">
                <div className="alert alert-warning mb-3">
                  <i className="fas fa-exclamation-triangle me-2"></i>
                  Overall condition is {overallCondition === 'poor' ? 'Poor (2 stars)' : 'Critical (1 star)'}. Do you want to create a service request?
                </div>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="serviceRequestTop"
                    checked={createServiceRequest}
                    onChange={(e) => setCreateServiceRequest(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="serviceRequestTop">
                    <i className="fas fa-wrench me-2"></i>
                    Create Service Request
                  </label>
                </div>
              </div>
            )}

          </div>

          {/* Additional Notes */}
          <div className="form-section">
            <h5><i className="fas fa-sticky-note"></i> Additional Notes</h5>

            <div className="inline-field mb-3">
              <label className="form-label mb-0">Inspection Notes</label>
              <textarea
                className="form-control"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter any additional observations or comments..."
              />
            </div>


          </div>

          {/* Photo Upload */}
          <div className="form-section">
            <h5><i className="fas fa-camera"></i> Inspection Photos</h5>

            <button
              type="button"
              className="btn btn-outline-primary w-100 mb-3"
              onClick={addPhoto}
            >
              <i className="fas fa-camera me-2"></i>
              Add Photo
            </button>

            {photos.length > 0 && (
              <div className="photo-grid">
                {photos.map((photo) => (
                  <div key={photo.id} className="photo-item">
                    <img src={photo.preview} alt="Inspection" className="img-thumbnail" />
                    <button
                      type="button"
                      className="btn btn-sm btn-danger photo-remove"
                      onClick={() => removePhoto(photo.id)}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* GPS Location */}
          <div className="form-section">
            <h5><i className="fas fa-map-marker-alt"></i> Location</h5>

            <button
              type="button"
              className="btn btn-outline-secondary w-100 mb-3"
              onClick={getCurrentLocation}
            >
              <i className="fas fa-crosshairs me-2"></i>
              Get Current Location
            </button>

            {(gpsLatitude && gpsLongitude) && (
              <div className="alert alert-success">
                <i className="fas fa-check-circle me-2"></i>
                Location captured: {gpsLatitude.toFixed(6)}, {gpsLongitude.toFixed(6)}
              </div>
            )}
          </div>


          {/* Submit Button */}
          <div className="form-section">
            <button
              type="submit"
              className="btn btn-success btn-lg w-100"
              disabled={!inspectorName.trim() || !overallCondition}
            >
              <i className="fas fa-check-circle me-2"></i>
              Submit Inspection
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  )
}
