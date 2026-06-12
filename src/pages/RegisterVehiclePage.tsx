import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useI18n } from '../services/i18n-context'
import { authService, type AuthenticatedUser } from '../services/auth'
import { createVehicleMobile, uploadVehiclePhotoMobile, type NewVehiclePayload } from '../services/vehicleApi'
import { ensureNativeCameraPermission, openNativeAppSettings, readImageFileAsDataUrl } from '../services/cameraAccess'
import { compressDataUrl } from '../services/compress'
import connectionManager from '../services/connectionManager'
import type { VehicleBasicInfo } from '../services/offlineDataSync'

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface Props { onShowToast?: (type: ToastType, message: string) => void }

const C = {
  bg: '#050a12',
  card: 'rgba(255,255,255,0.04)',
  cardHi: 'rgba(255,255,255,0.07)',
  border: 'rgba(255,255,255,0.09)',
  borderHi: 'rgba(255,255,255,0.16)',
  accent: '#FC4100',
  gold: '#FFC55A',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  textPri: '#f1f5f9',
  textMut: '#8b9ab0',
}

interface FormField {
  key: keyof NewVehiclePayload
  label: string
  placeholder: string
  required: boolean
  type: 'text' | 'number'
}

export default function RegisterVehiclePage({ onShowToast }: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(connectionManager.getStatus().isOnline)
  const [submitting, setSubmitting] = useState(false)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const prefillEquipNo = (location.state?.prefillEquipNo as string | undefined) || ''

  const [form, setForm] = useState<NewVehiclePayload>({
    equip_no: prefillEquipNo,
    description: '',
    manufacturer: '',
    unit_model: '',
    company: '',
    location: '',
    year: undefined,
    serial_number: '',
  })

  const [errors, setErrors] = useState<Partial<Record<keyof NewVehiclePayload, string>>>({})

  useEffect(() => {
    let cancelled = false
    authService.getCurrentUser().then((u) => { if (!cancelled) setCurrentUser(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const listener = (s: { isOnline: boolean }) => setIsOnline(s.isOnline)
    connectionManager.addStatusListener(listener)
    return () => { connectionManager.removeStatusListener(listener) }
  }, [])

  const fields: FormField[] = [
    { key: 'equip_no', label: t('equipmentNumber'), placeholder: 'EQ-12345', required: true, type: 'text' },
    { key: 'description', label: t('description'), placeholder: t('vehicleDescriptionPlaceholder'), required: true, type: 'text' },
    { key: 'manufacturer', label: t('manufacturer'), placeholder: 'Caterpillar', required: false, type: 'text' },
    { key: 'unit_model', label: t('model'), placeholder: '777E', required: false, type: 'text' },
    { key: 'company', label: t('companyLabel'), placeholder: 'RIM', required: true, type: 'text' },
    { key: 'location', label: t('locationLabel'), placeholder: 'Pit A', required: false, type: 'text' },
    { key: 'year', label: t('year'), placeholder: '2024', required: false, type: 'number' },
    { key: 'serial_number', label: t('serialNumber'), placeholder: 'SN123456', required: false, type: 'text' },
  ]

  function validate(): boolean {
    const next: Partial<Record<keyof NewVehiclePayload, string>> = {}
    if (!form.equip_no.trim()) next.equip_no = t('equipmentNumberRequired')
    if (!form.description.trim()) next.description = t('descriptionRequired')
    if (!form.company.trim()) next.company = t('companyRequired')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function updateField(key: keyof NewVehiclePayload, value: string | number | undefined) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) {
      setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  async function handleAddPhoto() {
    const allowed = await ensureNativeCameraPermission()
    if (!allowed) {
      onShowToast?.('error', 'Camera permission denied. Enable camera permission in Android app settings.')
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
      const { dataUrl } = await compressDataUrl(rawDataUrl, 0.75)
      setPhotoDataUrl(dataUrl)
      setPhotoFile(file)
      onShowToast?.('success', t('photoAdded'))
    } catch (err) {
      const msg = (err as Error)?.message || ''
      if (!/cancel/i.test(msg)) onShowToast?.('error', msg || 'Photo capture failed')
    }
  }

  async function handleSubmit() {
    if (!validate()) {
      onShowToast?.('warning', t('formValidationError'))
      return
    }
    if (!isOnline) {
      onShowToast?.('error', t('registrationRequiresConnection'))
      return
    }
    setSubmitting(true)
    try {
      const payload: NewVehiclePayload = {
        ...form,
        equip_no: form.equip_no.trim().toUpperCase(),
        description: form.description.trim(),
        company: form.company.trim(),
      }
      const newVehicle = await createVehicleMobile(payload)

      // Upload photo if one was taken
      if (photoFile && newVehicle.id) {
        try {
          onShowToast?.('info', t('uploadingPhoto'))
          const uploadResult = await uploadVehiclePhotoMobile(newVehicle.id, photoFile)
          newVehicle.picture = uploadResult.photo_url.replace(/^\//, '')
        } catch (uploadErr) {
          console.warn('Photo upload failed:', uploadErr)
          onShowToast?.('warning', t('photoUploadFailed'))
        }
      }

      onShowToast?.('success', t('vehicleRegisteredSuccess'))
      navigate('/vehicle-detail', { state: { vehicle: adaptToVehicleBasic(newVehicle) } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onShowToast?.('error', msg || t('vehicleRegisterFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPri }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'blur(24px)', background: 'rgba(5,10,18,0.85)', borderBottom: `1px solid ${C.border}`, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => navigate(-1)}
            style={{ width: 40, height: 40, borderRadius: 12, background: C.card, color: C.textPri, border: `1px solid ${C.border}`, fontSize: '1.1rem', cursor: 'pointer' }}>
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: C.textPri, letterSpacing: '0.01em' }}>{t('registerNewVehicle')}</div>
            <div style={{ fontSize: '0.78rem', color: C.textMut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('registerNewVehicleDesc')}
            </div>
          </div>
        </div>
        {!isOnline && (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: `1px solid ${C.warning}`, color: C.warning, fontSize: '0.75rem', fontWeight: 600 }}>
            {t('registrationRequiresConnection')}
          </div>
        )}
      </div>

      {/* Form */}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 600, margin: '0 auto' }}>
        {/* Intro card */}
        <div style={{ padding: 14, borderRadius: 14, background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.03))', border: `1px solid rgba(34,197,94,0.32)` }}>
          <div style={{ fontSize: '0.82rem', color: '#86efac', lineHeight: 1.5 }}>
            <strong style={{ color: '#fff' }}>{t('newVehicleHelpTitle')}</strong> {t('newVehicleHelpDesc')}
          </div>
        </div>

        {fields.map((f) => (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, color: C.textMut, display: 'flex', alignItems: 'center', gap: 4 }}>
              {f.label}
              {f.required && <span style={{ color: C.danger }}>*</span>}
            </label>
            <input
              type={f.type}
              value={form[f.key] ?? ''}
              onChange={(e) => {
                const val = f.type === 'number' ? (e.target.value ? parseInt(e.target.value) : undefined) : e.target.value
                updateField(f.key, val)
              }}
              placeholder={f.placeholder}
              disabled={submitting}
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                border: `1px solid ${errors[f.key] ? C.danger : C.border}`,
                background: C.card,
                color: C.textPri,
                fontSize: '0.95rem',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
            {errors[f.key] && (
              <div style={{ fontSize: '0.76rem', color: C.danger, fontWeight: 600 }}>{errors[f.key]}</div>
            )}
          </div>
        ))}

        {/* Photo capture */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600, color: C.textMut }}>
            {t('addVehiclePhoto')}
          </label>
          {photoDataUrl ? (
            <div style={{ position: 'relative', width: '100%', maxWidth: 280, alignSelf: 'center' }}>
              <img
                src={photoDataUrl}
                alt="Vehicle preview"
                style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 14, border: `1px solid ${C.border}` }}
              />
              <button
                onClick={() => { setPhotoDataUrl(null); setPhotoFile(null) }}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'rgba(0,0,0,0.6)', color: '#fff',
                  border: 'none', borderRadius: 8, padding: '6px 12px',
                  fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t('retakePhoto')}
              </button>
            </div>
          ) : (
            <button
              onClick={handleAddPhoto}
              disabled={submitting}
              style={{
                padding: '14px',
                borderRadius: 12,
                border: `1px dashed ${C.borderHi}`,
                background: C.card,
                color: C.textMut,
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: submitting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 56,
              }}
            >
              <span style={{ fontSize: '1.2rem' }}>📷</span>
              {t('takeVehiclePhoto')}
            </button>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoFileSelected}
            style={{ display: 'none' }}
          />
        </div>

        {/* Inspector info (read-only) */}
        <div style={{ padding: 12, borderRadius: 12, background: C.card, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '0.78rem', color: C.textMut, fontWeight: 600, marginBottom: 4 }}>{t('registeredBy')}</div>
          <div style={{ fontSize: '0.9rem', color: C.textPri, fontWeight: 700 }}>
            {currentUser?.fullName || currentUser?.username || t('notAvailable')}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !isOnline}
          style={{
            padding: '16px 20px',
            borderRadius: 14,
            border: 'none',
            background: submitting || !isOnline ? 'rgba(255,255,255,0.06)' : `linear-gradient(135deg, ${C.success}, #15803d)`,
            color: submitting || !isOnline ? C.textMut : '#fff',
            fontWeight: 800,
            fontSize: '1rem',
            cursor: submitting || !isOnline ? 'not-allowed' : 'pointer',
            boxShadow: submitting || !isOnline ? 'none' : '0 8px 22px rgba(34,197,94,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            minHeight: 56,
          }}
        >
          {submitting ? (
            <>
              <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid rgba(255,255,255,0.2)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              {t('registeringVehicle')}
            </>
          ) : (
            <>
              <span style={{ fontSize: '1.2rem' }}>🚚</span>
              {t('registerVehicle')}
            </>
          )}
        </button>
      </div>
    </div>
  )
}

/** Adapt the backend vehicle response to VehicleBasicInfo shape used by the mobile app. */
function adaptToVehicleBasic(v: any): VehicleBasicInfo {
  return {
    id: v.id,
    equip_no: v.equip_no,
    description: v.description,
    company: v.company,
    manufacturer: v.manufacturer,
    unit_model: v.model ?? v.unit_model,
    commissioning_date: v.commissioning_date,
    year: v.year,
    commissioning_status: v.commissioning_status ?? 'NEW',
    expired_date: v.expired_date,
    location: v.location,
    picture: v.picture,
  }
}
