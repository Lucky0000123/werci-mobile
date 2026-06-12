import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n } from '../services/i18n-context'
import { authService, type AuthenticatedUser } from '../services/auth'
import { compressDataUrl } from '../services/compress'
import { ensureNativeCameraPermission, openNativeAppSettings, readImageFileAsDataUrl } from '../services/cameraAccess'
import {
  getCommissioningIndex,
  getCommissioningForm,
  autoMatchForm,
  searchForms,
  slugFromFile,
} from '../services/commissioningForms'
import type {
  CommissioningFormIndex,
  CommissioningFormIndexEntry,
  CommissioningFormSchema,
  CommissioningItemResponse,
  CommissioningSubmitPayload,
} from '../services/commissioningApi'
import { submitCommissioningWithRetry } from '../services/backgroundSync'
import connectionManager from '../services/connectionManager'
import type { VehicleBasicInfo } from '../services/offlineDataSync'

type ToastType = 'success' | 'error' | 'warning' | 'info'
interface Props { onShowToast?: (type: ToastType, message: string) => void }

type StepKey = 'picker' | 'checklist' | 'submit'
type ItemResult = 'GOOD' | 'FAIL' | 'NA'
type OverallResult = 'PASS' | 'FAIL' | 'CONDITIONAL'

interface ItemState {
  section: string
  code?: string
  label?: string
  label_id?: string
  label_en?: string
  result?: ItemResult
  comment?: string
}

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

const PASS_COLOR = '#22c55e'
const FAIL_COLOR = '#ef4444'
const NA_COLOR = '#8b9ab0'

function isoDateInMonths(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(meta)?.[1] || 'image/jpeg'
  const bytes = atob(b64)
  const buf = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
  return new Blob([buf], { type: mime })
}

function flattenItems(schema: CommissioningFormSchema): ItemState[] {
  const out: ItemState[] = []
  for (const section of schema.sections || []) {
    for (const it of section.items || []) {
      out.push({
        section: section.title,
        code: it.code,
        label: it.label,
        label_id: it.label_id,
        label_en: it.label_en
      })
    }
  }
  return out
}

function getItemLabel(it: ItemState, lang: string): string {
  if (lang === 'id' && it.label_id) return it.label_id
  if (it.label_en) return it.label_en
  return it.label || it.code || ''
}

export default function CommissioningPage({ onShowToast }: Props) {
  const { t, language } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const vehicle = (location.state?.vehicle as VehicleBasicInfo | undefined) || null

  const [step, setStep] = useState<StepKey>('picker')
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(connectionManager.getStatus().isOnline)

  const [index, setIndex] = useState<CommissioningFormIndex | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexLoading, setIndexLoading] = useState(true)
  const [query, setQuery] = useState('')

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [schema, setSchema] = useState<CommissioningFormSchema | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)

  const [items, setItems] = useState<ItemState[]>([])
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({})
  const [editingComment, setEditingComment] = useState<number | null>(null)

  const [overall, setOverall] = useState<OverallResult>('PASS')
  // Validity period in months. -1 means "custom" (user picks an explicit date).
  const [validityMonths, setValidityMonths] = useState<number>(12)
  const [expiryDate, setExpiryDate] = useState<string>(isoDateInMonths(12))
  const [photos, setPhotos] = useState<Array<{ id: string; dataUrl: string }>>([])
  const [inspectorArea, setInspectorArea] = useState('')
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  useEffect(() => {
    let cancelled = false
    setIndexLoading(true)
    setIndexError(null)
    getCommissioningIndex()
      .then((idx) => { if (!cancelled) setIndex(idx) })
      .catch((err) => { if (!cancelled) setIndexError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setIndexLoading(false) })
    return () => { cancelled = true }
  }, [])

  const suggested = useMemo(() => {
    if (!vehicle || !index) return null
    return autoMatchForm(vehicle, index)
  }, [vehicle, index])

  // Auto-pick suggested form when redirected from reinspection flow
  const autoPickedRef = useRef(false)
  useEffect(() => {
    if (location.state?.autoPick && suggested && step === 'picker' && !selectedSlug && !autoPickedRef.current) {
      autoPickedRef.current = true
      handlePickForm(suggested)
    }
  }, [suggested, step, location.state, selectedSlug])

  const filteredForms = useMemo(() => {
    if (!index) return []
    return searchForms(index, query)
  }, [index, query])

  const answeredCount = useMemo(() => items.filter(i => !!i.result).length, [items])
  const totalCount = items.length
  const allAnswered = totalCount > 0 && answeredCount === totalCount
  const hasFail = useMemo(() => items.some(i => i.result === 'FAIL'), [items])

  // Suggest an overall result based on the checklist — inspector can override.
  useEffect(() => {
    if (!allAnswered) return
    setOverall(hasFail ? 'FAIL' : 'PASS')
  }, [allAnswered, hasFail])

  async function handlePickForm(entry: CommissioningFormIndexEntry) {
    const slug = slugFromFile(entry.file)
    setSelectedSlug(slug)
    setSchemaLoading(true)
    try {
      const s = await getCommissioningForm(slug)
      setSchema(s)
      const flat = flattenItems(s)
      setItems(flat)
      // open first section by default, collapse the rest
      const open: Record<string, boolean> = {}
      ;(s.sections || []).forEach((sec, i) => { open[sec.title] = i === 0 })
      setSectionsOpen(open)
      setStep('checklist')
    } catch (err) {
      onShowToast?.('error', err instanceof Error ? err.message : String(err))
      // Clear ALL form state on failure — otherwise a stale schema/items from a
      // previously-opened form stays in memory and the user could submit a
      // checklist for the wrong equipment.
      setSelectedSlug(null)
      setSchema(null)
      setItems([])
      setSectionsOpen({})
      setStep('picker')
    } finally {
      setSchemaLoading(false)
    }
  }

  function setItemResult(idx: number, result: ItemResult) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, result } : it))
  }

  function setItemComment(idx: number, comment: string) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, comment } : it))
  }

  function markSectionGood(sectionTitle: string) {
    setItems(prev => prev.map(it => it.section === sectionTitle ? { ...it, result: it.result ?? 'GOOD' } : it))
  }

  function toggleSection(sectionTitle: string) {
    setSectionsOpen(prev => ({ ...prev, [sectionTitle]: !prev[sectionTitle] }))
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
      setPhotos(prev => [...prev, { id: (crypto as Crypto).randomUUID(), dataUrl }])
    } catch (err) {
      const msg = (err as Error)?.message || ''
      if (!/cancel/i.test(msg)) onShowToast?.('error', msg || 'Photo capture failed')
    }
  }

  function removePhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id))
  }

  async function handleSubmit() {
    if (!vehicle || !schema || !selectedSlug) return
    if (!allAnswered) {
      onShowToast?.('warning', t('commissioningIncompleteWarn'))
      return
    }
    if (overall === 'FAIL' && photos.length === 0) {
      onShowToast?.('warning', t('commissioningPhotoRequiredOnFail'))
      return
    }
    setSubmitting(true)
    try {
      const payload: CommissioningSubmitPayload = {
        vehicle_id: vehicle.id,
        form_slug: selectedSlug,
        overall_result: overall,
        items: items.map<CommissioningItemResponse>(it => ({
          section: it.section,
          item: getItemLabel(it, language),
          result: (it.result || 'NA') as ItemResult,
          comment: it.comment
        })),
        inspector_name: currentUser?.fullName || currentUser?.username,
        inspector_area: inspectorArea || undefined,
        inspection_date: new Date().toISOString(),
        expiry_date_set: overall === 'PASS' ? expiryDate : undefined,
        comments: comments || undefined,
        language,
      }
      const blobs = photos.map(p => dataUrlToBlob(p.dataUrl))
      const result = await submitCommissioningWithRetry(payload, blobs, {
        equipNo: vehicle.equip_no,
        equipmentLabel: schema.equipment
      })
      if (result.queued) {
        onShowToast?.('info', t('commissioningQueuedOffline'))
      } else {
        onShowToast?.('success', t('commissioningSubmittedOk'))
      }
      navigate('/scan', { replace: true })
    } catch (err) {
      onShowToast?.('error', err instanceof Error ? err.message : t('commissioningSubmitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- shared layout helpers ----------
  const stepIndex = step === 'picker' ? 1 : step === 'checklist' ? 2 : 3
  const stepTitles: Record<StepKey, string> = {
    picker: t('commissioningStep1'),
    checklist: t('commissioningStep2'),
    submit: t('commissioningStep3'),
  }

  function Header() {
    return (
      <div style={{ position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'blur(24px)', background: 'rgba(5,10,18,0.85)', borderBottom: `1px solid ${C.border}`, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => (step === 'picker' ? navigate(-1) : setStep(step === 'submit' ? 'checklist' : 'picker'))}
            style={{ width: 40, height: 40, borderRadius: 12, background: C.card, color: C.textPri, border: `1px solid ${C.border}`, fontSize: '1.1rem', cursor: 'pointer' }}>
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: C.textPri, letterSpacing: '0.01em' }}>{t('commissioningTitle')}</div>
            <div style={{ fontSize: '0.78rem', color: C.textMut, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {vehicle ? `${vehicle.equip_no}${vehicle.unit_model ? ` · ${vehicle.unit_model}` : ''}` : ''}
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMut, fontWeight: 700, padding: '6px 10px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}` }}>
            {stepIndex}/3
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          {(['picker', 'checklist', 'submit'] as StepKey[]).map((k) => (
            <div key={k} style={{ flex: 1, height: 4, borderRadius: 3,
              background: stepIndex >= (k === 'picker' ? 1 : k === 'checklist' ? 2 : 3) ? C.accent : 'rgba(255,255,255,0.07)'
            }} />
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: '0.78rem', color: C.textMut }}>{stepTitles[step]}</div>
        {!isOnline && (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: `1px solid ${C.warning}`, color: C.warning, fontSize: '0.75rem', fontWeight: 600 }}>
            {t('commissioningOfflineBanner')}
          </div>
        )}
      </div>
    )
  }

  // ---------- STEP 1: picker ----------
  function renderPicker() {
    if (indexLoading) {
      return <div style={{ padding: 24, textAlign: 'center', color: C.textMut }}>{t('commissioningLoadingForms')}</div>
    }
    if (indexError && !index) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ color: C.danger, marginBottom: 10, fontWeight: 700 }}>{t('commissioningLoadFormsFailed')}</div>
          <div style={{ color: C.textMut, fontSize: '0.85rem', marginBottom: 14 }}>{indexError}</div>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 18px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.textPri, cursor: 'pointer' }}>{t('commissioningRetry')}</button>
        </div>
      )
    }
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {suggested ? (
          <div style={{ padding: 14, borderRadius: 14, background: 'linear-gradient(135deg, rgba(34,197,94,0.14), rgba(34,197,94,0.04))', border: `1px solid rgba(34,197,94,0.38)` }}>
            <div style={{ fontSize: '0.72rem', color: '#86efac', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>✨ {t('commissioningSuggested')}</div>
            <div style={{ fontSize: '1.05rem', color: C.textPri, fontWeight: 800, marginTop: 4 }}>{suggested.equipment}</div>
            <div style={{ fontSize: '0.78rem', color: C.textMut, marginTop: 2 }}>{suggested.form_code} · {suggested.item_count} {t('commissioningItemsLabel')} · {suggested.sections} {t('commissioningSectionsLabel')}</div>
            <button onClick={() => handlePickForm(suggested)} disabled={schemaLoading}
              style={{ marginTop: 12, width: '100%', padding: '12px 16px', borderRadius: 12, border: 'none', background: C.success, color: '#052e14', fontWeight: 800, cursor: 'pointer' }}>
              {schemaLoading ? t('commissioningLoadingForms') : t('commissioningUseThisForm')}
            </button>
          </div>
        ) : index ? (
          <div style={{ padding: 12, borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: `1px solid ${C.warning}`, color: C.warning, fontSize: '0.82rem', fontWeight: 600 }}>
            {t('commissioningNoAutoMatch')}
          </div>
        ) : null}

        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('commissioningSearchForms')}
          style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.textPri, fontSize: '0.95rem', outline: 'none' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredForms.map((f) => (
            <button key={f.file} onClick={() => handlePickForm(f)} disabled={schemaLoading}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.textPri, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{f.equipment}</div>
              <div style={{ fontSize: '0.74rem', color: C.textMut }}>{f.form_code} · {f.item_count} {t('commissioningItemsLabel')} · {f.sections} {t('commissioningSectionsLabel')}</div>
            </button>
          ))}
          {filteredForms.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: C.textMut, fontSize: '0.85rem' }}>—</div>
          )}
        </div>
      </div>
    )
  }

  // ---------- STEP 2: checklist ----------
  function renderChecklist() {
    if (!schema) return null
    const progress = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0
    // group item indices by section title
    const sectionIndices: Record<string, number[]> = {}
    items.forEach((it, idx) => {
      if (!sectionIndices[it.section]) sectionIndices[it.section] = []
      sectionIndices[it.section].push(idx)
    })

    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 12, borderRadius: 12, background: C.card, border: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: C.textMut, marginBottom: 6, fontWeight: 600 }}>
            <span>{schema.equipment}</span>
            <span>{answeredCount}/{totalCount} {t('commissioningProgress')}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: progress === 100 ? C.success : C.accent, transition: 'width 0.25s' }} />
          </div>
        </div>

        {(schema.sections || []).map((sec) => {
          const open = sectionsOpen[sec.title] ?? false
          const idxs = sectionIndices[sec.title] || []
          const answered = idxs.filter(i => !!items[i]?.result).length
          return (
            <div key={sec.title} style={{ borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
              <button onClick={() => toggleSection(sec.title)}
                style={{ width: '100%', textAlign: 'left', padding: '12px 14px', background: 'transparent', border: 'none', color: C.textPri, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, flex: 1 }}>{sec.title}</span>
                <span style={{ fontSize: '0.72rem', color: C.textMut, fontWeight: 600 }}>{answered}/{idxs.length}</span>
                <span style={{ color: C.textMut, transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', fontSize: '0.85rem' }}>▶</span>
              </button>

              {open && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button onClick={() => markSectionGood(sec.title)}
                    style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, border: `1px solid ${C.success}`, background: 'rgba(34,197,94,0.1)', color: C.success, cursor: 'pointer' }}>
                    ✓ {t('commissioningMarkSectionGood')}
                  </button>

                  {idxs.map((idx) => {
                    const it = items[idx]
                    return (
                      <div key={idx} style={{ padding: 12, borderRadius: 12, background: C.cardHi, border: `1px solid ${C.border}` }}>
                        <div style={{ fontSize: '0.78rem', color: C.textMut, fontWeight: 600, marginBottom: 4 }}>{it.code}</div>
                        <div style={{ fontSize: '0.88rem', color: C.textPri, fontWeight: 600, marginBottom: 10 }}>{getItemLabel(it, language)}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(['GOOD', 'FAIL', 'NA'] as ItemResult[]).map((r) => {
                            const active = it.result === r
                            const color = r === 'GOOD' ? PASS_COLOR : r === 'FAIL' ? FAIL_COLOR : NA_COLOR
                            const label = r === 'GOOD' ? t('commissioningItemGood') : r === 'FAIL' ? t('commissioningItemFail') : t('commissioningItemNA')
                            return (
                              <button key={r} onClick={() => setItemResult(idx, r)}
                                style={{ flex: 1, padding: '8px 10px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 700,
                                  border: `1px solid ${active ? color : C.border}`,
                                  background: active ? color : 'transparent',
                                  color: active ? '#0b1020' : color,
                                  cursor: 'pointer' }}>
                                {label}
                              </button>
                            )
                          })}
                        </div>
                        {editingComment === idx ? (
                          <textarea value={it.comment || ''} onChange={(e) => setItemComment(idx, e.target.value)}
                            placeholder={t('commissioningComment')} rows={2}
                            style={{ marginTop: 10, width: '100%', padding: 10, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.textPri, fontSize: '0.85rem', resize: 'vertical', outline: 'none', fontFamily: 'inherit' }}
                            onBlur={() => setEditingComment(null)} autoFocus />
                        ) : (
                          <button onClick={() => setEditingComment(idx)}
                            style={{ marginTop: 8, padding: '4px 0', background: 'transparent', border: 'none', color: C.textMut, cursor: 'pointer', fontSize: '0.76rem', textAlign: 'left' }}>
                            {it.comment ? `💬 ${it.comment}` : `+ ${t('commissioningAddComment')}`}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        <button onClick={() => setStep('submit')} disabled={!allAnswered}
          style={{ padding: '14px 16px', borderRadius: 14, border: 'none',
            background: allAnswered ? `linear-gradient(135deg, ${C.accent}, #d93600)` : 'rgba(255,255,255,0.06)',
            color: allAnswered ? '#fff' : C.textMut,
            fontWeight: 800, fontSize: '1rem', cursor: allAnswered ? 'pointer' : 'not-allowed',
            boxShadow: allAnswered ? '0 8px 22px rgba(252,65,0,0.32)' : 'none' }}>
          {allAnswered ? t('commissioningNext') : t('commissioningIncompleteWarn')}
        </button>
      </div>
    )
  }


  // ---------- STEP 3: submit ----------
  function renderSubmit() {
    if (!schema) return null
    const overallOptions: Array<{ key: OverallResult; label: string; color: string }> = [
      { key: 'PASS', label: t('commissioningPass'), color: PASS_COLOR },
      { key: 'CONDITIONAL', label: t('commissioningConditional'), color: C.warning },
      { key: 'FAIL', label: t('commissioningFail'), color: FAIL_COLOR },
    ]
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Overall result */}
        <div style={{ padding: 14, borderRadius: 14, background: C.card, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '0.78rem', color: C.textMut, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            {t('commissioningOverallResult')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {overallOptions.map(opt => {
              const active = overall === opt.key
              return (
                <button key={opt.key} onClick={() => setOverall(opt.key)}
                  style={{ flex: 1, padding: '12px 8px', borderRadius: 12, fontSize: '0.88rem', fontWeight: 800,
                    border: `1px solid ${active ? opt.color : C.border}`,
                    background: active ? opt.color : 'transparent',
                    color: active ? '#0b1020' : opt.color,
                    cursor: 'pointer' }}>
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Expiry picker (only meaningful on PASS) */}
        {overall === 'PASS' && (
          <div style={{ padding: 14, borderRadius: 14, background: C.card, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: '0.82rem', color: C.textPri, fontWeight: 700, marginBottom: 4 }}>{t('commissioningValidFor')}</div>
            <div style={{ fontSize: '0.72rem', color: C.textMut, marginBottom: 10 }}>{t('commissioningValidForHint')}</div>
            <select
              value={validityMonths}
              onChange={(e) => {
                const months = parseInt(e.target.value, 10)
                setValidityMonths(months)
                if (months > 0) setExpiryDate(isoDateInMonths(months))
              }}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.textPri, fontSize: '0.95rem', colorScheme: 'dark', appearance: 'none' }}>
              {[1, 2, 3, 6, 9, 12, 18, 24, 36].map(m => (
                <option key={m} value={m}>{t('commissioningMonthsOption').replace('{n}', String(m))}</option>
              ))}
              <option value={-1}>{t('commissioningCustomDate')}</option>
            </select>
            {validityMonths === -1 && (
              <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.textPri, fontSize: '0.95rem', colorScheme: 'dark', marginTop: 10 }} />
            )}
            <div style={{ fontSize: '0.78rem', color: C.gold, fontWeight: 700, marginTop: 10 }}>
              {t('commissioningValidUntil').replace('{date}', expiryDate)}
            </div>
          </div>
        )}

        {/* Photos */}
        <div style={{ padding: 14, borderRadius: 14, background: C.card, border: `1px solid ${C.border}` }}>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoFileSelected}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: '0.82rem', color: C.textPri, fontWeight: 700 }}>{t('commissioningPhotos')}</div>
            <div style={{ fontSize: '0.72rem', color: C.textMut }}>{photos.length}{overall === 'FAIL' ? ' · *' : ''}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {photos.map(p => (
              <div key={p.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                <img src={p.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button onClick={() => removePhoto(p.id)}
                  style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}>×</button>
              </div>
            ))}
            <button onClick={handleAddPhoto}
              style={{ aspectRatio: '1', borderRadius: 10, border: `1px dashed ${C.borderHi}`, background: 'transparent', color: C.textMut, cursor: 'pointer', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span style={{ fontSize: '1.4rem' }}>📷</span>
              <span>{t('commissioningAddPhoto')}</span>
            </button>
          </div>
          {overall === 'FAIL' && photos.length === 0 && (
            <div style={{ marginTop: 8, fontSize: '0.72rem', color: C.warning }}>* {t('commissioningPhotoRequiredOnFail')}</div>
          )}
        </div>

        {/* Inspector meta */}
        <div style={{ padding: 14, borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ fontSize: '0.76rem', color: C.textMut, fontWeight: 600 }}>{t('commissioningInspectorName')}</label>
            <div style={{ padding: '10px 12px', marginTop: 4, borderRadius: 10, background: C.bg, color: C.textPri, fontSize: '0.9rem', fontWeight: 600, border: `1px solid ${C.border}` }}>
              {currentUser?.fullName || currentUser?.username || '—'}
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.76rem', color: C.textMut, fontWeight: 600 }}>{t('commissioningInspectorArea')}</label>
            <input type="text" value={inspectorArea} onChange={(e) => setInspectorArea(e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.textPri, fontSize: '0.9rem', outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.76rem', color: C.textMut, fontWeight: 600 }}>{t('commissioningCommentsOverall')}</label>
            <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3}
              style={{ width: '100%', marginTop: 4, padding: '10px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.textPri, fontSize: '0.9rem', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
        </div>

        <button onClick={handleSubmit} disabled={submitting}
          style={{ padding: '16px', borderRadius: 14, border: 'none',
            background: submitting ? 'rgba(255,255,255,0.06)' : `linear-gradient(135deg, ${C.accent}, #d93600)`,
            color: submitting ? C.textMut : '#fff',
            fontWeight: 800, fontSize: '1rem',
            cursor: submitting ? 'not-allowed' : 'pointer',
            boxShadow: submitting ? 'none' : '0 8px 22px rgba(252,65,0,0.36)',
            minHeight: 54 }}>
          {submitting ? t('commissioningSubmitting') : t('commissioningSubmitBtn')}
        </button>
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.textPri, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{ color: C.textMut }}>No vehicle selected</div>
        <button onClick={() => navigate('/scan', { replace: true })}
          style={{ padding: '12px 20px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.textPri, cursor: 'pointer', fontWeight: 700 }}>
          {t('commissioningBackToVehicle')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPri, paddingBottom: 40 }}>
      <Header />
      {step === 'picker' && renderPicker()}
      {step === 'checklist' && renderChecklist()}
      {step === 'submit' && renderSubmit()}
    </div>
  )
}
