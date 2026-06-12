/**
 * Deviation Form Component
 * Mobile-optimized form for reporting personnel safety deviations
 */

import { useState, useEffect, useRef } from 'react'
import { getCurrentLanguage, t } from '../../services/i18n'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { authService, type AuthenticatedUser } from '../../services/auth'
import { compressDataUrl } from '../../services/compress'
import { ensureNativeCameraPermission, openNativeAppSettings } from '../../services/cameraAccess'
import type { DeviationFormData, KimperData } from '../../types/deviation'
import './DeviationForm.css'

// Pre-upload compression settings. Backend additionally re-compresses to 1280px/Q70.
const CLIENT_MAX_EDGE_PX = 1280
const CLIENT_JPEG_QUALITY = 0.75
const MIN_PHOTOS_REQUIRED = 1
const MAX_PHOTOS_ALLOWED = 5

interface DeviationFormProps {
  kimperData?: KimperData
  personIdentity?: {
    person_key?: string
    employee_id?: string
    ktp_number?: string
    kimper_id?: number
  }
  initialPersonInvolved?: {
    name?: string
    id?: string
  }
  onSubmit: (formData: DeviationFormData) => Promise<void>
  onCancel: () => void
}

export default function DeviationForm({ kimperData, personIdentity, initialPersonInvolved, onSubmit, onCancel }: DeviationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [isProcessingPhotos, setIsProcessingPhotos] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoPermissionClickReady = useRef(false)
  const [compressionInfo, setCompressionInfo] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null)
  
  // Form state
  const [formData, setFormData] = useState<Partial<DeviationFormData>>({
    kimper_id: personIdentity?.kimper_id ?? kimperData?.id,
    person_key: personIdentity?.person_key,
    employee_id: personIdentity?.employee_id,
    ktp_number: personIdentity?.ktp_number,
    person_involved_name: initialPersonInvolved?.name || kimperData?.name || '',
    person_involved_id: initialPersonInvolved?.id || kimperData?.id_number || '',
    deviation_date: new Date().toISOString().slice(0, 16),
    status: 'Open',
    reporter_department: '',
    language: getCurrentLanguage()
  })

  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      kimper_id: prev.kimper_id ?? personIdentity?.kimper_id ?? kimperData?.id,
      person_key: prev.person_key ?? personIdentity?.person_key,
      employee_id: prev.employee_id ?? personIdentity?.employee_id,
      ktp_number: prev.ktp_number ?? personIdentity?.ktp_number,
      person_involved_name:
        prev.person_involved_name || initialPersonInvolved?.name || kimperData?.name || '',
      person_involved_id:
        prev.person_involved_id || initialPersonInvolved?.id || kimperData?.id_number || ''
    }))
  }, [kimperData, personIdentity, initialPersonInvolved])

  useEffect(() => {
    let cancelled = false

    const prefillReporter = async () => {
      const user = await authService.getCurrentUser()
      if (cancelled || !user) return
      setCurrentUser(user)

      setFormData(prev => ({
        ...prev,
        reported_by: prev.reported_by || user.fullName || user.username,
        reporter_department: prev.reporter_department || kimperData?.department || '',
        language: prev.language || getCurrentLanguage()
      }))
    }

    prefillReporter()
    return () => {
      cancelled = true
    }
  }, [kimperData?.department])
  
  // Re-render when language changes
  const [, setLangTrigger] = useState(0)
  useEffect(() => {
    const handleLanguageChange = () => {
      setLangTrigger(prev => prev + 1)
      setFormData(prev => ({ ...prev, language: getCurrentLanguage() }))
    }
    window.addEventListener('languageChanged', handleLanguageChange)
    return () => window.removeEventListener('languageChanged', handleLanguageChange)
  }, [])
  
  const handleInputChange = (field: keyof DeviationFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }
  
  // Reads a File into a data URL so we can pipe it through compressDataUrl().
  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  // Rebuilds a File from a compressed data URL so FormData still receives a real file.
  const dataUrlToFile = (dataUrl: string, name: string): File => {
    const [meta, b64] = dataUrl.split(',')
    const mime = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg'
    const bin = atob(b64 || '')
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new File([bytes], name, { type: mime })
  }

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    let incoming = Array.from(e.target.files)

    if (incoming.length > MAX_PHOTOS_ALLOWED) {
      setPhotoError(
        (t('photoMaxExceeded') as string) ||
          `Only ${MAX_PHOTOS_ALLOWED} photo(s) allowed — keeping the first ${MAX_PHOTOS_ALLOWED}.`,
      )
      incoming = incoming.slice(0, MAX_PHOTOS_ALLOWED)
    } else {
      setPhotoError(null)
    }

    setIsProcessingPhotos(true)
    setCompressionInfo(null)

    const compressed: File[] = []
    let originalBytes = 0
    let compressedBytes = 0

    for (let i = 0; i < incoming.length; i++) {
      const file = incoming[i]
      originalBytes += file.size
      try {
        const dataUrl = await fileToDataUrl(file)
        const { dataUrl: outUrl } = await compressDataUrl(
          dataUrl,
          CLIENT_JPEG_QUALITY,
          CLIENT_MAX_EDGE_PX,
          CLIENT_MAX_EDGE_PX,
        )
        const outFile = dataUrlToFile(outUrl, `deviation_photo_${i}.jpg`)
        compressed.push(outFile)
        compressedBytes += outFile.size
      } catch (err) {
        // If compression fails (corrupt image etc.), fall back to the raw file.
        console.warn('Photo compression failed, uploading original:', err)
        compressed.push(file)
        compressedBytes += file.size
      }
    }

    setPhotos(compressed)
    setIsProcessingPhotos(false)
    if (originalBytes > 0) {
      const kbIn = Math.round(originalBytes / 1024)
      const kbOut = Math.round(compressedBytes / 1024)
      const saved = Math.max(0, 100 - Math.round((compressedBytes * 100) / originalBytes))
      setCompressionInfo(`${kbIn} KB → ${kbOut} KB (-${saved}%)`)
    }
  }

  const handlePhotoInputClick = async (e: React.MouseEvent<HTMLInputElement>) => {
    if (photoPermissionClickReady.current) {
      photoPermissionClickReady.current = false
      return
    }

    e.preventDefault()
    const input = e.currentTarget
    const allowed = await ensureNativeCameraPermission()
    if (!allowed) {
      setPhotoError('Camera permission denied. Enable camera permission in Android app settings.')
      await openNativeAppSettings()
      return
    }

    photoPermissionClickReady.current = true
    input.click()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.deviation_date || !formData.location || !formData.deviation_description || !formData.reported_by) {
      alert(t('requiredField'))
      return
    }

    if (photos.length < MIN_PHOTOS_REQUIRED) {
      const msg = (t('photoRequired') as string) || 'At least one verification photo is required.'
      setPhotoError(msg)
      alert(msg)
      return
    }

    setIsSubmitting(true)

    try {
      await onSubmit({
        ...formData,
        photos,
        deviation_date: formData.deviation_date!,
        location: formData.location!,
        deviation_description: formData.deviation_description!,
        status: formData.status || 'Open',
        reported_by: formData.reported_by!,
        language: formData.language || 'id'
      } as DeviationFormData)
    } catch (error) {
      console.error('Error submitting deviation:', error)
      alert(t('reportError'))
    } finally {
      setIsSubmitting(false)
    }
  }
  
  return (
    <div className="deviation-form-container">
      <LanguageSwitcher />
      
      <div className="form-header">
        <h2>{t('deviationReport')}</h2>
      </div>

      {/* Auto-fill summary — makes it obvious that reporter and subject were pulled from context. */}
      <div className="autofill-summary">
        <div className="autofill-row">
          <span className="autofill-label">{t('loggedInAs') || 'Reporting as'}</span>
          <span className="autofill-value">
            {currentUser?.fullName || currentUser?.username || formData.reported_by || '\u2014'}
          </span>
        </div>
        {(formData.person_involved_name || formData.person_involved_id) && (
          <div className="autofill-row">
            <span className="autofill-label">{t('subjectPerson') || 'About'}</span>
            <span className="autofill-value">
              {formData.person_involved_name || '\u2014'}
              {formData.person_involved_id ? ` (${formData.person_involved_id})` : ''}
            </span>
          </div>
        )}
      </div>

      {kimperData && (
        <div className="kimper-info">
          <strong><i className="fas fa-user"></i> {t('kimperHolder')}:</strong><br />
          {kimperData.name} ({kimperData.id_number})<br />
          <small>{kimperData.position}</small>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="deviation-form">
        {/* Date & Time */}
        <div className="form-group">
          <label>{t('date')} <span className="required">*</span></label>
          <input
            type="datetime-local"
            value={formData.deviation_date}
            onChange={(e) => handleInputChange('deviation_date', e.target.value)}
            required
          />
        </div>
        
        {/* Location */}
        <div className="form-group">
          <label>{t('location')} <span className="required">*</span></label>
          <input
            type="text"
            placeholder={t('locationPlaceholder')}
            value={formData.location || ''}
            onChange={(e) => handleInputChange('location', e.target.value)}
            required
          />
        </div>
        
        {/* Shift */}
        <div className="form-group">
          <label>{t('shift')}</label>
          <select
            value={formData.shift || ''}
            onChange={(e) => handleInputChange('shift', e.target.value)}
          >
            <option value="">{t('shiftSelect')}</option>
            <option value="Day">{t('shiftDay')}</option>
            <option value="Night">{t('shiftNight')}</option>
          </select>
        </div>
        
        {/* Person Involved */}
        <div className="form-group">
          <label>{t('personInvolved')}</label>
          <input
            type="text"
            placeholder={t('personPlaceholder')}
            value={formData.person_involved_name || ''}
            onChange={(e) => handleInputChange('person_involved_name', e.target.value)}
          />
          <small>Nama orang yang melakukan deviasi / Name of person who committed deviation</small>
        </div>
        
        {/* Activity */}
        <div className="form-group">
          <label>{t('activity')}</label>
          <input
            type="text"
            placeholder={t('activityPlaceholder')}
            value={formData.activity || ''}
            onChange={(e) => handleInputChange('activity', e.target.value)}
          />
        </div>
        
        {/* Description */}
        <div className="form-group">
          <label>{t('description')} <span className="required">*</span></label>
          <textarea
            rows={4}
            placeholder={t('descriptionPlaceholder')}
            value={formData.deviation_description || ''}
            onChange={(e) => handleInputChange('deviation_description', e.target.value)}
            required
          />
        </div>

        {/* Golden Rules */}
        <div className="form-group">
          <label>{t('goldenRules')}</label>
          <select
            value={formData.golden_rules_number || ''}
            onChange={(e) => handleInputChange('golden_rules_number', e.target.value ? parseInt(e.target.value) : undefined)}
          >
            <option value="">-- Pilih Golden Rule --</option>
            {Array.from({ length: 17 }, (_, i) => i + 1).map(num => (
              <option key={num} value={num}>Golden Rule #{num}</option>
            ))}
          </select>
        </div>

        {/* Immediate Action */}
        <div className="form-group">
          <label>{t('immediateAction')}</label>
          <textarea
            rows={3}
            placeholder={t('actionPlaceholder')}
            value={formData.immediate_action || ''}
            onChange={(e) => handleInputChange('immediate_action', e.target.value)}
          />
        </div>

        {/* Status */}
        <div className="form-group">
          <label>{t('status')} <span className="required">*</span></label>
          <select
            value={formData.status}
            onChange={(e) => handleInputChange('status', e.target.value)}
            required
          >
            <option value="Open">{t('statusOpen')}</option>
            <option value="In Progress">{t('statusInProgress')}</option>
            <option value="Closed">{t('statusClosed')}</option>
          </select>
        </div>

        {/* Reported By */}
        <div className="form-group">
          <label>{t('reportedBy')} <span className="required">*</span></label>
          <input
            type="text"
            placeholder={t('reporterPlaceholder')}
            value={formData.reported_by || ''}
            onChange={(e) => handleInputChange('reported_by', e.target.value)}
            required
          />
        </div>

        {/* Department */}
        <div className="form-group">
          <label>{t('department')}</label>
          <input
            type="text"
            placeholder={t('departmentPlaceholder')}
            value={formData.reporter_department || ''}
            onChange={(e) => handleInputChange('reporter_department', e.target.value)}
          />
        </div>

        {/* Contractor */}
        <div className="form-group">
          <label>{t('contractor')}</label>
          <input
            type="text"
            placeholder={t('contractorPlaceholder')}
            value={formData.contractor_name || ''}
            onChange={(e) => handleInputChange('contractor_name', e.target.value)}
          />
          <small>Kosongkan jika bukan kontraktor / Leave empty if not contractor</small>
        </div>

        {/* PIC */}
        <div className="form-group">
          <label>{t('pic')}</label>
          <input
            type="text"
            placeholder={t('picPlaceholder')}
            value={formData.pic_name || ''}
            onChange={(e) => handleInputChange('pic_name', e.target.value)}
          />
        </div>

        {/* Photos */}
        <div className="form-group">
          <label>
            {t('documentation')} <span className="required">*</span>
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onClick={handlePhotoInputClick}
            onChange={handlePhotoChange}
            disabled={isProcessingPhotos || isSubmitting}
          />
          <small>
            {(t('photoRequired') as string) || 'At least one photo is required for verification.'}
          </small>
          {isProcessingPhotos && (
            <div className="photo-preview">
              <i className="fas fa-spinner fa-spin"></i>{' '}
              {(t('compressingPhotos') as string) || 'Optimizing photos…'}
            </div>
          )}
          {!isProcessingPhotos && photos.length > 0 && (
            <div className="photo-preview">
              <i className="fas fa-check-circle"></i> {photos.length} photo(s) ready
              {compressionInfo && <span style={{ marginLeft: 8, opacity: 0.75 }}>{compressionInfo}</span>}
            </div>
          )}
          {photoError && (
            <div className="photo-preview" style={{ color: '#FC4100' }}>
              <i className="fas fa-exclamation-triangle"></i> {photoError}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className="btn-submit"
          disabled={isSubmitting || isProcessingPhotos || photos.length < MIN_PHOTOS_REQUIRED}
          title={
            photos.length < MIN_PHOTOS_REQUIRED
              ? ((t('photoRequired') as string) || 'At least one photo is required')
              : ''
          }
        >
          {isSubmitting ? (
            <><i className="fas fa-spinner fa-spin"></i> {t('submitting')}</>
          ) : (
            <><i className="fas fa-paper-plane"></i> {t('submit')}</>
          )}
        </button>

        <button type="button" className="btn-cancel" onClick={onCancel} disabled={isSubmitting}>
          {t('cancel')}
        </button>
      </form>
    </div>
  )
}
