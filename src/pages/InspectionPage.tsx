import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import InspectionForm from '../features/inspect/InspectionForm'
import { authService } from '../services/auth'
import type { VehicleBasicInfo } from '../services/offlineDataSync'

interface InspectionPageProps {
  vehicle: VehicleBasicInfo | null
  onShowToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

// A vehicle needs re-inspection when its commissioning status is anything other
// than a clean PASS — covers EXPIRED, EXPIRING, RE-COMMISSION SOON, UNKNOWN.
const needsReInspection = (status?: string) => {
  if (!status) return false
  const s = status.toUpperCase()
  return s !== 'PASS' && s !== 'ACTIVE' && s !== 'OK'
}

export default function InspectionPage({ vehicle, onShowToast }: InspectionPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [vehicleData, setVehicleData] = useState<VehicleBasicInfo | null>(vehicle)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    // Check if vehicle data was passed via location state
    const stateVehicle = location.state?.vehicle
    if (stateVehicle) {
      setVehicleData(stateVehicle)
    }
  }, [location.state])

  useEffect(() => {
    authService.getCurrentUser().then((u) => {
      if (u) setUserRole(u.role)
    }).catch(() => {})
  }, [])

  const isReinspection = needsReInspection(vehicleData?.commissioning_status)
  const showReBadge = isReinspection
  const INSPECTION_ALLOWED_ROLES = ['inspector', 'admin', 'superuser']
  const blocked = isReinspection && !!userRole && !INSPECTION_ALLOWED_ROLES.includes(userRole.toLowerCase())

  // Redirect reinspections to the commissioning checklist (auto-matched form)
  const [redirecting, setRedirecting] = useState(false)
  useEffect(() => {
    if (isReinspection && !blocked && vehicleData && !redirecting) {
      setRedirecting(true)
      navigate('/commissioning', { state: { vehicle: vehicleData, autoPick: true } })
    }
    // Reset the flag when the redirect condition no longer holds (e.g. the user
    // hits Back and lands here again) so we don't get stuck on the loader.
    if (redirecting && !(isReinspection && !blocked && vehicleData)) {
      setRedirecting(false)
    }
  }, [isReinspection, blocked, vehicleData, redirecting, navigate])

  // Belt-and-suspenders: clear the redirecting flag on unmount so returning to
  // this page never shows a permanent "Loading commissioning checklist…".
  useEffect(() => {
    return () => setRedirecting(false)
  }, [])

  if (redirecting) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b9ab0', fontSize: '0.95rem' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>⏳</div>
          Loading commissioning checklist…
        </div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '16px',
      maxWidth: '600px',
      margin: '0 auto',
      color: '#f1f5f9'
    }}>
      {/* Header */}
      <div className="prism-hero" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '14px'
      }}>
        <button
          onClick={() => navigate('/home')}
          className="prism-ghost-btn"
          aria-label="Back"
          style={{
            padding: '8px 12px',
            fontSize: '1.1rem',
            flexShrink: 0
          }}
        >
          ←
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div className="prism-hero__eyebrow">PRISM</div>
            {showReBadge && (
              <span style={{
                background: 'linear-gradient(135deg, #FC4100 0%, #d93600 100%)',
                color: '#fff',
                fontSize: '0.62rem',
                fontWeight: 800,
                letterSpacing: '0.9px',
                padding: '3px 8px',
                borderRadius: '6px',
                textTransform: 'uppercase',
                boxShadow: '0 4px 14px rgba(252,65,0,0.42)',
                border: '1px solid rgba(255,255,255,0.14)',
                animation: 'prism-pulse 2.4s ease-in-out infinite'
              }}>
                ⚠ Re-Inspection
              </span>
            )}
          </div>
          <h2 className="prism-hero__title" style={{ margin: 0 }}>
            Vehicle Inspection
          </h2>
          {vehicleData && (
            <p className="prism-hero__subtitle" style={{ margin: 0, marginTop: '2px' }}>
              {vehicleData.equip_no} • {vehicleData.description || 'Fleet Vehicle'}
            </p>
          )}
        </div>
      </div>

      {/* Access guard — only inspector role may perform re-inspections */}
      {blocked ? (
        <div style={{
          padding: '24px 20px',
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: '14px',
          textAlign: 'center',
          color: '#fca5a5'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔒</div>
          <h3 style={{ color: '#fff', margin: '0 0 8px', fontSize: '1.1rem' }}>Access Restricted</h3>
          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5 }}>
            Re-inspections can only be performed by users with the <strong>inspector</strong> role.
          </p>
          <button
            onClick={() => navigate('/home')}
            style={{
              marginTop: '16px',
              padding: '10px 24px',
              background: '#FC4100',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Back to Dashboard
          </button>
        </div>
      ) : (
        <InspectionForm
          scannedVehicle={vehicleData}
          onShowToast={onShowToast}
        />
      )}
    </div>
  )
}
