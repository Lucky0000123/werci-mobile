import { useRef, useState } from 'react'
import InlineQRScanner from '../../components/InlineQRScanner'
import { connectionManager } from '../../services/connectionManager'
import { ensureNativeCameraPermission, openNativeAppSettings } from '../../services/cameraAccess'

interface Vehicle {
  id: number
  equip_no: string
  description: string
  company: string
  manufacturer: string
  unit_model: string
  commissioning_status: string
  current_photo: string | null
}

export default function PhotoUpload() {
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{type: 'success' | 'error', message: string} | null>(null)
  const photoPermissionClickReady = useRef(false)

  // Open the inline QR scanner modal (web-based getUserMedia + zxing).
  // Replaces @capacitor-community/barcode-scanner which crashed on Android 14+.
  function scanQRCode() {
    setScanError('')
    setUploadStatus(null)
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
      // Extract vehicle ID and token from QR code
      // Expected format: http://domain/mobile/inspect/<vehicle_id>?token=<token>
      // or: http://domain/qr/photo/<vehicle_id>?token=<token>
      
      let vehicleId: string | null = null
      let token: string | null = null

      // Parse URL
      if (qrContent.includes('?token=')) {
        const [urlPart, tokenPart] = qrContent.split('?token=')
        token = tokenPart
        
        // Extract vehicle ID from URL
        if (urlPart.includes('/inspect/')) {
          vehicleId = urlPart.split('/inspect/')[1]
        } else if (urlPart.includes('/qr/photo/')) {
          vehicleId = urlPart.split('/qr/photo/')[1]
        }
      }

      if (!vehicleId || !token) {
        setScanError('Invalid QR code format. Please scan a valid equipment QR code.')
        return
      }

      console.log('🔍 Processing vehicle ID:', vehicleId, 'with token')
      
      // Fetch vehicle details from backend using QR token
      await fetchVehicleDetails(vehicleId, token)

    } catch (error) {
      console.error('❌ QR processing error:', error)
      setScanError('Failed to process QR code: ' + (error as Error).message)
    }
  }

  async function fetchVehicleDetails(vehicleId: string, token: string) {
    try {
      const baseUrl = connectionManager.getActiveEndpoint()
      const url = `${baseUrl}/api/qr/photo/${vehicleId}?token=${token}`

      console.log('📡 Fetching vehicle details from:', url)

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const result = await response.json()

      if (result.success && result.data) {
        console.log('✅ Vehicle details fetched:', result.data.vehicle)
        setVehicle(result.data.vehicle)
        setQrToken(token)
        setScanError('')
      } else {
        throw new Error(result.message || 'Failed to fetch vehicle details')
      }
    } catch (error) {
      console.error('❌ Failed to fetch vehicle details:', error)
      setScanError('Failed to load equipment details. Make sure you are on the company network.')
    }
  }

  function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedPhoto(file)
      
      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      
      setUploadStatus(null)
    }
  }

  async function handlePhotoInputClick(event: React.MouseEvent<HTMLInputElement>) {
    if (photoPermissionClickReady.current) {
      photoPermissionClickReady.current = false
      return
    }

    event.preventDefault()
    const input = event.currentTarget
    const allowed = await ensureNativeCameraPermission()
    if (!allowed) {
      setUploadStatus({ type: 'error', message: 'Camera permission denied. Enable camera permission in Android app settings.' })
      await openNativeAppSettings()
      return
    }

    photoPermissionClickReady.current = true
    input.click()
  }

  async function uploadPhoto() {
    if (!selectedPhoto || !vehicle || !qrToken) {
      setUploadStatus({type: 'error', message: 'Missing photo, vehicle, or authentication token'})
      return
    }

    try {
      setIsUploading(true)
      setUploadStatus(null)

      const baseUrl = connectionManager.getActiveEndpoint()
      const url = `${baseUrl}/api/qr/photo/${vehicle.id}?token=${qrToken}`

      const formData = new FormData()
      formData.append('vehicle_photo', selectedPhoto)

      console.log('📤 Uploading photo to:', url)

      const response = await fetch(url, {
        method: 'POST',
        body: formData
      })

      const result = await response.json()

      if (result.success) {
        console.log('✅ Photo uploaded successfully:', result.data)
        setUploadStatus({
          type: 'success', 
          message: `Photo uploaded successfully for ${vehicle.equip_no}!`
        })
        
        // Update vehicle with new photo
        if (result.data?.photo?.path) {
          setVehicle({
            ...vehicle,
            current_photo: result.data.photo.path
          })
        }
        
        // Clear selected photo
        setSelectedPhoto(null)
        setPhotoPreview(null)
      } else {
        throw new Error(result.message || 'Upload failed')
      }
    } catch (error) {
      console.error('❌ Photo upload failed:', error)
      setUploadStatus({
        type: 'error',
        message: 'Failed to upload photo: ' + (error as Error).message
      })
    } finally {
      setIsUploading(false)
    }
  }

  function resetForm() {
    setVehicle(null)
    setQrToken(null)
    setSelectedPhoto(null)
    setPhotoPreview(null)
    setUploadStatus(null)
    setScanError('')
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Inline QR scanner overlay (replaces legacy native plugin). */}
      {isScanning && (
        <InlineQRScanner
          onResult={handleScanResult}
          onClose={() => setIsScanning(false)}
        />
      )}

      <h2 style={{ marginBottom: '20px', color: '#333' }}>📸 Upload Equipment Picture</h2>

      {!vehicle && (
        <div>
          <p style={{ marginBottom: '20px', color: '#666' }}>
            Scan the equipment QR code to upload a new photo
          </p>

          {scanError && (
            <div style={{
              padding: '15px',
              backgroundColor: '#fee',
              border: '1px solid #fcc',
              borderRadius: '8px',
              marginBottom: '20px',
              color: '#c33'
            }}>
              ⚠️ {scanError}
            </div>
          )}

          <button 
            onClick={scanQRCode}
            disabled={isScanning}
            className="primary"
            style={{ width: '100%', padding: '15px', fontSize: '16px' }}
          >
            {isScanning ? '📷 Scanning...' : '📷 Scan Equipment QR Code'}
          </button>
        </div>
      )}

      {vehicle && (
        <div>
          {/* Vehicle Details */}
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '20px',
            borderRadius: '12px',
            marginBottom: '20px',
            border: '2px solid #e9ecef'
          }}>
            <h3 style={{ marginTop: 0, color: '#495057' }}>Equipment Details</h3>
            <div style={{ fontSize: '14px', color: '#6c757d' }}>
              <p><strong>Equipment No:</strong> {vehicle.equip_no}</p>
              <p><strong>Description:</strong> {vehicle.description}</p>
              <p><strong>Company:</strong> {vehicle.company}</p>
              {vehicle.manufacturer && <p><strong>Manufacturer:</strong> {vehicle.manufacturer}</p>}
              {vehicle.unit_model && <p><strong>Model:</strong> {vehicle.unit_model}</p>}
              <p><strong>Status:</strong> <span style={{
                color: vehicle.commissioning_status === 'PASS' ? '#28a745' : '#dc3545',
                fontWeight: 'bold'
              }}>{vehicle.commissioning_status}</span></p>
            </div>
          </div>

          {/* Current Photo */}
          {vehicle.current_photo && (
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ color: '#495057' }}>Current Photo:</h4>
              <img
                src={`${connectionManager.getActiveEndpoint()}/static/${vehicle.current_photo}`}
                alt="Current equipment photo"
                style={{
                  maxWidth: '100%',
                  maxHeight: '200px',
                  borderRadius: '8px',
                  border: '2px solid #dee2e6'
                }}
              />
            </div>
          )}

          {/* Photo Upload */}
          <div style={{
            backgroundColor: '#fff',
            padding: '20px',
            borderRadius: '12px',
            border: '2px solid #007bff',
            marginBottom: '20px'
          }}>
            <h4 style={{ marginTop: 0, color: '#007bff' }}>Upload New Photo</h4>
            
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onClick={handlePhotoInputClick}
              onChange={handlePhotoSelect}
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: '15px',
                border: '1px solid #ced4da',
                borderRadius: '6px'
              }}
            />

            {photoPreview && (
              <div style={{ marginBottom: '15px' }}>
                <p style={{ fontSize: '14px', color: '#6c757d', marginBottom: '8px' }}>Preview:</p>
                <img
                  src={photoPreview}
                  alt="Photo preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '200px',
                    borderRadius: '8px',
                    border: '2px solid #28a745'
                  }}
                />
              </div>
            )}

            <button
              onClick={uploadPhoto}
              disabled={!selectedPhoto || isUploading}
              className="success"
              style={{ width: '100%', padding: '15px', fontSize: '16px' }}
            >
              {isUploading ? '⏳ Uploading...' : '✅ Upload Photo'}
            </button>
          </div>

          {/* Upload Status */}
          {uploadStatus && (
            <div style={{
              padding: '15px',
              backgroundColor: uploadStatus.type === 'success' ? '#d4edda' : '#fee',
              border: `1px solid ${uploadStatus.type === 'success' ? '#c3e6cb' : '#fcc'}`,
              borderRadius: '8px',
              marginBottom: '20px',
              color: uploadStatus.type === 'success' ? '#155724' : '#c33'
            }}>
              {uploadStatus.type === 'success' ? '✅' : '⚠️'} {uploadStatus.message}
            </div>
          )}

          {/* Reset Button */}
          <button
            onClick={resetForm}
            className="secondary"
            style={{ width: '100%', padding: '12px' }}
          >
            🔄 Scan Another Equipment
          </button>
        </div>
      )}
    </div>
  )
}

