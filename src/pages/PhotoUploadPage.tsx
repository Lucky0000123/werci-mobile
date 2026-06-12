import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PhotoUpload from '../features/photo/PhotoUpload'
import type { VehicleBasicInfo } from '../services/offlineDataSync'

interface PhotoUploadPageProps {
  vehicle: VehicleBasicInfo | null
  onShowToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export default function PhotoUploadPage({ vehicle }: PhotoUploadPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [vehicleData, setVehicleData] = useState<VehicleBasicInfo | null>(vehicle)

  useEffect(() => {
    const stateVehicle = location.state?.vehicle
    if (stateVehicle) {
      setVehicleData(stateVehicle)
    }
  }, [location.state])

  return (
    <div style={{
      padding: '20px',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <button
          onClick={() => navigate('/home')}
          style={{
            padding: '10px',
            background: '#F3F4F6',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '1.25rem'
          }}
        >
          ←
        </button>
        <div>
          <h2 style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            color: '#111827',
            margin: 0
          }}>
            Upload Photo
          </h2>
          {vehicleData && (
            <p style={{
              fontSize: '0.85rem',
              color: '#6B7280',
              margin: 0,
              marginTop: '2px'
            }}>
              {vehicleData.equip_no}
            </p>
          )}
        </div>
      </div>

      {/* Photo Upload Component */}
      <PhotoUpload />
    </div>
  )
}
