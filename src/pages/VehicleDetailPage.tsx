import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '../services/i18n-context'
import { authService, type AuthenticatedUser } from '../services/auth'
import { resolveVehiclePhotoUrl } from '../services/vehicleApi'
import type { VehicleBasicInfo } from '../services/offlineDataSync'

interface VehicleDetailPageProps {
  vehicle: VehicleBasicInfo | null
}

// Inspectors, admins, and superusers may run a commissioning / re-commissioning inspection.
const INSPECTION_ALLOWED_ROLES = ['inspector', 'admin', 'superuser']

const C = {
  bg: '#050a12',
  card: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.09)',
  accent: '#FC4100',
  gold: '#FFC55A',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  textPri: '#f1f5f9',
  textMut: '#8b9ab0',
}

const needsReInspection = (status?: string) => {
  if (!status) return false
  const s = status.toUpperCase()
  return s !== 'PASS' && s !== 'ACTIVE' && s !== 'OK' && s !== 'NEW'
}

/** Returns true when the vehicle's expiry is within 30 days or already expired. */
const isNearExpiry = (expiredDate?: string) => {
  if (!expiredDate) return true
  try {
    const expiry = new Date(expiredDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expiry.setHours(0, 0, 0, 0)
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return diffDays <= 30
  } catch {
    return true
  }
}

/** Determine whether the commissioning button should be visible.
 *  - Non-PASS status: always show (vehicle needs commissioning)
 *  - PASS status: only show if within 30 days of expiry or already expired
 */
const showCommissioning = (status?: string, expiredDate?: string) => {
  if (!status) return true
  const s = status.toUpperCase()
  const isPass = s === 'PASS' || s === 'ACTIVE' || s === 'OK'
  if (isPass) {
    return isNearExpiry(expiredDate)
  }
  return true
}

const statusTone = (status?: string) => {
  const s = (status || '').toUpperCase()
  if (s === 'PASS' || s === 'ACTIVE' || s === 'OK') return { bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.32)', fg: '#86efac' }
  if (s === 'NEW') return { bg: 'rgba(56,189,248,0.14)', border: 'rgba(56,189,248,0.32)', fg: '#7dd3fc' }
  if (s.includes('EXPIR')) return { bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.32)', fg: '#fca5a5' }
  if (s.includes('SOON') || s.includes('PENDING')) return { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.32)', fg: '#fcd34d' }
  return { bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.32)', fg: '#cbd5e1' }
}

export default function VehicleDetailPage({ vehicle }: VehicleDetailPageProps) {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [data, setData] = useState<VehicleBasicInfo | null>(vehicle)
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null)

  useEffect(() => {
    const v = location.state?.vehicle as VehicleBasicInfo | undefined
    if (v) setData(v)
  }, [location.state])

  useEffect(() => {
    let cancelled = false
    authService.getCurrentUser().then((u) => { if (!cancelled) setCurrentUser(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const canInspect = !!currentUser?.role && INSPECTION_ALLOWED_ROLES.includes(currentUser.role.toLowerCase())
  const isReinspection = needsReInspection(data?.commissioning_status)
  const shouldShowCommissioning = canInspect && showCommissioning(data?.commissioning_status, data?.expired_date)

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.textMut, padding: '20px' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🚚</div>
        <h2 style={{ color: C.textPri, marginBottom: '8px' }}>{t('vehicleNotFound')}</h2>
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => navigate('/register-vehicle')} style={{ padding: '12px 28px', background: C.accent, color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700 }}>{t('registerNewVehicle')}</button>
          <button onClick={() => navigate('/home')} style={{ padding: '12px 28px', background: 'transparent', color: C.textPri, border: `1px solid ${C.border}`, borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}>{t('backToHome')}</button>
        </div>
      </div>
    )
  }

  const showReBadge = isReinspection
  const tone = statusTone(data.commissioning_status)

  const InfoRow = ({ label, value }: { label: string; value?: string | number | null }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}`, gap: '12px' }}>
      <span style={{ fontSize: '0.78rem', color: C.textMut, fontWeight: 500, letterSpacing: '0.02em' }}>{label}</span>
      <span style={{ fontSize: '0.88rem', color: C.textPri, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value || t('notAvailable')}</span>
    </div>
  )

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto', color: C.textPri }}>
      {/* Hero header */}
      <div className="prism-hero" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
        <button onClick={() => navigate('/home')} className="prism-ghost-btn" aria-label={t('back')} style={{ padding: '8px 12px', fontSize: '1.1rem', flexShrink: 0 }}>←</button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div className="prism-hero__eyebrow">PRISM</div>
            {showReBadge && (
              <span style={{ background: 'linear-gradient(135deg, #FC4100 0%, #d93600 100%)', color: '#fff', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.9px', padding: '3px 8px', borderRadius: '6px', textTransform: 'uppercase', boxShadow: '0 4px 14px rgba(252,65,0,0.42)', border: '1px solid rgba(255,255,255,0.14)', animation: 'prism-pulse 2.4s ease-in-out infinite' }}>⚠ {t('reInspection')}</span>
            )}
          </div>
          <h2 className="prism-hero__title" style={{ margin: 0 }}>{t('vehicleDetails')}</h2>
          <p className="prism-hero__subtitle" style={{ margin: 0, marginTop: '2px' }}>{t('reviewBeforeInspection')}</p>
        </div>
      </div>

      {/* Vehicle identity card */}
      <div className="prism-card" style={{ padding: '18px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        {(() => {
          const photoUrl = resolveVehiclePhotoUrl(data.picture)
          return photoUrl ? (
            <img
              src={photoUrl}
              alt={data.equip_no}
              style={{ width: '56px', height: '56px', borderRadius: '14px', objectFit: 'cover', border: `1px solid ${C.border}`, flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'linear-gradient(135deg, rgba(252,65,0,0.2), rgba(252,65,0,0.05))', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', flexShrink: 0 }}>🚚</div>
          )
        })()}
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Status + Equipment Number on same row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {data.commissioning_status && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '6px 14px',
                fontSize: '0.85rem',
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                borderRadius: '10px',
                background: tone.bg,
                border: `2px solid ${tone.border}`,
                color: tone.fg,
                minHeight: '32px',
                boxShadow: `0 0 12px ${tone.border}`,
              }}>{data.commissioning_status}</div>
            )}
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: C.textPri, letterSpacing: '0.01em', lineHeight: 1.1 }}>{data.equip_no}</div>
          </div>
          <div style={{ fontSize: '0.82rem', color: C.textMut, marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.description || t('fleetVehicle')}</div>
        </div>
      </div>

      {/* Re-inspection warning */}
      {showReBadge && (
        <div style={{ padding: '12px 14px', marginBottom: '14px', background: 'rgba(252,65,0,0.1)', border: '1px solid rgba(252,65,0,0.32)', borderRadius: '12px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ fontSize: '1.1rem' }}>⚠</div>
          <div style={{ fontSize: '0.8rem', color: '#fecaca', lineHeight: 1.5 }}><strong style={{ color: '#fff' }}>{t('reInspectionRequired')}.</strong> {t('reInspectionDesc')}</div>
        </div>
      )}

      {/* Vehicle information */}
      <div className="prism-card" style={{ padding: '4px 16px 12px', marginBottom: '14px' }}>
        <h3 style={{ fontSize: '0.78rem', fontWeight: 700, color: C.gold, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '14px 0 6px' }}>{t('vehicleInformation')}</h3>
        <InfoRow label={t('equipmentNumber')} value={data.equip_no} />
        <InfoRow label={t('manufacturer')} value={data.manufacturer} />
        <InfoRow label={t('model')} value={data.unit_model} />
        <InfoRow label={t('year')} value={data.year} />
        <InfoRow label={t('companyLabel')} value={data.company} />
        <InfoRow label={t('locationLabel')} value={data.location} />
        <InfoRow label={t('commissioningStatus')} value={data.commissioning_status} />
        <InfoRow label={t('expiredDate')} value={data.expired_date} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
        {/* Re-inspection is restricted to inspector role only */}
        {isReinspection && !canInspect ? (
          <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '14px', color: '#fca5a5', fontSize: '0.92rem', fontWeight: 600, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', minHeight: '56px' }}>
            <span style={{ fontSize: '1.2rem' }}>🔒</span>
            {t('reinspectionRestricted')}
          </div>
        ) : (
          <button onClick={() => navigate('/inspection', { state: { vehicle: data } })} style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #FC4100, #d93600)', color: '#fff', border: 'none', borderRadius: '14px', fontSize: '1rem', fontWeight: 800, cursor: 'pointer', letterSpacing: '0.02em', boxShadow: '0 8px 22px rgba(252,65,0,0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', minHeight: '56px' }}>
            <span style={{ fontSize: '1.2rem' }}>✓</span> {t('startInspection')}
          </button>
        )}
        {shouldShowCommissioning && (
          <button onClick={() => navigate('/commissioning', { state: { vehicle: data } })} style={{ padding: '14px 18px', background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.06))', color: '#86efac', border: '1px solid rgba(34,197,94,0.42)', borderRadius: '14px', fontSize: '0.98rem', fontWeight: 800, cursor: 'pointer', letterSpacing: '0.02em', boxShadow: '0 6px 18px rgba(34,197,94,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', minHeight: '54px' }}>
            <span style={{ fontSize: '1.1rem' }}>🛠</span> {t('commissioningCta')}
          </button>
        )}
        <button onClick={() => navigate('/scan')} style={{ padding: '14px 18px', background: C.card, color: C.textPri, border: `1px solid ${C.border}`, borderRadius: '12px', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', minHeight: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', backdropFilter: 'blur(20px)' }}>
          📷 {t('scanAnother')}
        </button>
      </div>
    </div>
  )
}
