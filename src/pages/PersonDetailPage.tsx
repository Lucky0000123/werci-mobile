import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import PersonDeviationHistory from '../features/deviation/PersonDeviationHistory'
import PairVehicleModal from '../components/PairVehicleModal'
import { apiFetch } from '../services/api'
import { offlineDataSync } from '../services/offlineDataSync'
import type { PersonCardData, PersonLookupParams } from '../services/offlineDataSync'
import { buildPersonDetailPath, getPersonLookupFromCardData } from '../utils/personRoute'
import { useI18n } from '../services/i18n-context'

const C = {
  bg: '#f3f4f6',
  bgGlow: '#ffe6d8',
  surface: '#ffffff',
  surfaceAlt: '#fff8f4',
  border: '#f1d9c8',
  borderStrong: '#f0b892',
  accent: '#FC4100',
  accentSoft: '#fff1eb',
  orange: '#FC4100',
  orangeSoft: '#fff1eb',
  gold: '#d97706',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  textPri: '#111827',
  textSec: '#374151',
  textMut: '#6b7280',
  shadow: '0 18px 40px rgba(252, 65, 0, 0.10)',
}

function statusColor(value?: string) {
  const normalized = value?.toLowerCase()
  if (normalized === 'active' || normalized === 'compliant') return C.success
  if (normalized === 'inactive' || normalized === 'expired' || normalized === 'open') return C.danger
  return C.warning
}

function formatValue(value?: string | number | null) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return parsed.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// Cache older than this is still shown (better than nothing for gate checks)
// but flagged as potentially outdated.
const STALE_CACHE_MS = 7 * 24 * 60 * 60 * 1000

function formatLastSynced(ts?: number) {
  if (!ts) return 'previously'
  const diffMs = Date.now() - ts
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hrs = Math.round(min / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function buildFallbackPortrait(name?: string) {
  const initials =
    name
      ?.split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'PR'

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#e2e8f0" />
          <stop offset="100%" stop-color="#cbd5e1" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="32" fill="url(#bg)" />
      <circle cx="80" cy="58" r="28" fill="#94a3b8" opacity="0.42" />
      <path d="M38 132c10-24 28-36 42-36s32 12 42 36" fill="#94a3b8" opacity="0.32" />
      <circle cx="80" cy="80" r="56" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2" />
      <text x="80" y="145" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="#475569">${initials}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function pillStyle(color: string): CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '0.72rem',
    fontWeight: 700,
    color,
    background: `${color}15`,
    border: `1px solid ${color}33`,
  }
}

function Section({ title, icon, subtitle, children }: { title: string; icon: string; subtitle?: string; children: ReactNode }) {
  return (
    <section
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: '22px',
        padding: '18px',
        boxShadow: C.shadow,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '12px',
            background: C.accentSoft,
            display: 'grid',
            placeItems: 'center',
            fontSize: '1rem',
          }}
        >
          {icon}
        </div>
        <div>
          <strong style={{ color: C.textPri, fontSize: '0.96rem', display: 'block' }}>{title}</strong>
          {subtitle && <span style={{ color: C.textMut, fontSize: '0.78rem' }}>{subtitle}</span>}
        </div>
      </div>
      {children}
    </section>
  )
}

function InfoGrid({
  items,
}: {
  items: Array<{ label: string; value?: string | number | null; badgeColor?: string; formatAsDate?: boolean }>
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
            borderRadius: '16px',
            padding: '12px 14px',
            minHeight: '78px',
          }}
        >
          <div style={{ fontSize: '0.72rem', color: C.textMut, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
          {item.badgeColor ? (
            <span style={pillStyle(item.badgeColor)}>{item.formatAsDate ? formatDate(String(item.value)) : formatValue(item.value)}</span>
          ) : (
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: C.textPri, wordBreak: 'break-word', lineHeight: 1.35 }}>
              {item.formatAsDate ? formatDate(String(item.value)) : formatValue(item.value)}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function PersonDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const [cardData, setCardData] = useState<PersonCardData | null>(location.state?.cardData ?? null)
  const [loading, setLoading] = useState(!location.state?.cardData)
  const [error, setError] = useState<string | null>(null)
  const [showPairModal, setShowPairModal] = useState(false)
  const [currentPairing, setCurrentPairing] = useState<{ vehicle_no: string; paired_at?: string } | null>(null)
  const fromScan = Boolean(location.state?.fromScan)


  const lookup = useMemo<PersonLookupParams>(() => {
    const kimperId = searchParams.get('kimper_id')
    return {
      personKey: searchParams.get('person_key') || undefined,
      employeeId: searchParams.get('employee_id') || undefined,
      kimperId: kimperId && !Number.isNaN(Number(kimperId)) ? Number(kimperId) : undefined,
      ktpNumber: searchParams.get('ktp_number') || undefined,
    }
  }, [searchParams])

  useEffect(() => {
    if (location.state?.cardData) {
      setCardData(location.state.cardData as PersonCardData)
    }
  }, [location.state])

  useEffect(() => {
    if (cardData) {
      const nextPath = buildPersonDetailPath(getPersonLookupFromCardData(cardData))
      if (`${location.pathname}${location.search}` !== nextPath) {
        navigate(nextPath, { replace: true, state: { cardData } })
      }
      return
    }

    if (!lookup.personKey && !lookup.employeeId && lookup.kimperId == null && !lookup.ktpNumber) {
      setLoading(false)
      setError('No person lookup was provided.')
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      const response = await offlineDataSync.fetchPersonCardData(lookup)
      if (cancelled) return

      if (response?.success) {
        setCardData(response)
      } else {
        const offline = typeof navigator !== 'undefined' && !navigator.onLine
        setError(offline
          ? 'No offline data available for this employee. Please connect to the internet to sync.'
          : 'Person not found or unavailable.')
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [cardData, location.pathname, location.search, navigate, lookup])

  // When the page is showing cached offline data and the network returns,
  // silently refresh from the server and swap in the live record.
  useEffect(() => {
    if (!cardData?._offline) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    let cancelled = false
    const refresh = async () => {
      const fresh = await offlineDataSync.fetchPersonCardData(getPersonLookupFromCardData(cardData))
      if (!cancelled && fresh?.success && !fresh._offline) {
        setCardData(fresh)
      }
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [cardData])

  // ── Driver↔vehicle pairing state (drivers = people with a KIMPER) ────────
  const personEmployeeId = cardData?.person?.employee_id ? String(cardData.person.employee_id) : null
  const personHasKimper = Boolean(
    cardData?.person?.kimper_id != null || cardData?.kimper || cardData?.person?.kimper_status
  )
  const autoOpenedPairing = useRef(false)

  const loadCurrentPairing = async (): Promise<{ vehicle_no: string; paired_at?: string } | null> => {
    if (!personEmployeeId) return null
    try {
      const res = await apiFetch(`/api/mobile/pairing/by-employee?employee_id=${encodeURIComponent(personEmployeeId)}`)
      const body = (await res.json().catch(() => null)) as { pairing?: { vehicle_no: string; paired_at?: string } | null } | null
      const pairing = body?.pairing ?? null
      setCurrentPairing(pairing)
      return pairing
    } catch {
      return null // offline — pairing status simply not shown
    }
  }

  // Fetch the person's active pairing; after a QR scan of a KIMPER holder
  // who is not yet paired, auto-open the pairing flow (the user's requested
  // gate: scan + has KIMPER → ask which vehicle).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const pairing = await loadCurrentPairing()
      if (cancelled) return
      if (fromScan && personHasKimper && !pairing && !autoOpenedPairing.current) {
        autoOpenedPairing.current = true
        setShowPairModal(true)
      }
    }
    if (personHasKimper && personEmployeeId) void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personEmployeeId, personHasKimper, fromScan])

  const handleUnpair = async () => {
    if (!personEmployeeId) return
    try {
      await apiFetch('/api/mobile/pairing/end', {
        method: 'POST',
        body: JSON.stringify({ employee_id: personEmployeeId }),
      })
      setCurrentPairing(null)
    } catch {
      /* keep banner; retry later */
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', background: C.bg, color: C.textMut, padding: '32px' }}>
        {t('loadingEmployeeProfile')}
      </div>
    )
  }

  if (!cardData) {
    return (
      <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', background: C.bg, color: C.textPri, padding: '20px' }}>
        <div style={{ textAlign: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '24px', padding: '28px 22px', maxWidth: '380px', boxShadow: C.shadow }}>
          <div style={{ fontSize: '2.7rem', marginBottom: '10px' }}>👤</div>
          <h2 style={{ marginBottom: '8px', color: C.textPri }}>{t('employeeProfileNotAvailable')}</h2>
          <p style={{ color: C.textMut, marginBottom: '16px', lineHeight: 1.5 }}>{error || t('tryScanAgain')}</p>
          <button onClick={() => navigate('/home')} style={{ padding: '12px 22px', borderRadius: '12px', border: 'none', background: C.accent, color: 'white', fontWeight: 700, cursor: 'pointer' }}>{t('back')}</button>
        </div>
      </div>
    )
  }

  const { person, employee, kimper } = cardData
  const training_summary = cardData.training_summary ?? {}
  const violations = cardData.violations ?? []
  const mandatoryItems = cardData.mandatory_trainings ?? []
  const extraItems     = cardData.extra_trainings ?? []
  const mandatoryTotal   = training_summary.mandatory_total ?? mandatoryItems.length ?? 6
  const mandatoryValid   = training_summary.mandatory_valid ?? mandatoryItems.filter(t => t.status === 'On Time').length
  const mandatoryExpired = training_summary.mandatory_expired ?? mandatoryItems.filter(t => t.status === 'Expired').length
  const mandatoryNotYet  = training_summary.mandatory_not_yet ?? mandatoryItems.filter(t => t.status === 'Not Done' || t.status === 'Not Yet').length
  const extrasCompleted  = training_summary.extras_completed ?? extraItems.filter(t => t.status === 'On Time').length
  const historyLookup = getPersonLookupFromCardData(cardData)
  const reportDeviation = () => navigate('/deviation-report', { state: { personCardData: cardData } })
  const displayName = person.name || employee.name || 'Unified workforce profile'
  const profileImage = employee.photo_url || buildFallbackPortrait(displayName)
  const hasKimper = personHasKimper
  const authorizedUnitsList = (() => {
    const raw = (person as { authorized_units?: unknown }).authorized_units
      ?? (kimper as { authorized_units?: unknown } | undefined)?.authorized_units
    if (!raw) return null
    if (Array.isArray(raw)) return raw.filter(Boolean).map(String)
    return String(raw).split(',').map(s => s.trim()).filter(Boolean)
  })()
  const usingFallbackPhoto = !employee.photo_url
  const companyLine = [person.company || employee.company, person.department || employee.department, person.section || employee.section].filter(Boolean)
  const roleLine = [person.position_title || employee.position, person.position_level || employee.position_level].filter(Boolean).join(' · ')
  const isOffline = !!cardData._offline
  const lastSynced = cardData._offline?.cachedAt
  const isStale = lastSynced ? (Date.now() - lastSynced) > STALE_CACHE_MS : false
  const isPartial = !!cardData._partial
  // Distinguish "genuinely zero training" (full payload, server-confirmed) from
  // "training detail not available offline" (bulk-cached card with no detail).
  const hasTrainingData = !isPartial && (cardData.training_summary != null || mandatoryItems.length > 0 || extraItems.length > 0)

  return (
    <div
      style={{
        minHeight: '100%',
        background: `linear-gradient(180deg, #f8fafc 0%, ${C.bg} 42%, ${C.bgGlow} 100%)`,
        color: C.textPri,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: '520px', margin: '0 auto', padding: '16px 14px 26px', display: 'grid', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div>
            <div style={{ color: C.accent, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t('employeeDetailsTitle')}</div>
            <div style={{ color: C.textMut, fontSize: '0.82rem', marginTop: '3px' }}>{t('employeeDetailsSub')}</div>
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 12px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: '14px',
              cursor: 'pointer',
              color: C.textSec,
              fontSize: '0.92rem',
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.05)',
            }}
          >
            ← {t('back')}
          </button>
        </div>

        {isOffline && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 14px', borderRadius: '14px',
            background: isPartial ? 'rgba(220,38,38,0.08)' : isStale ? 'rgba(245,158,11,0.10)' : 'rgba(96,165,250,0.10)',
            border: `1px solid ${isPartial ? 'rgba(220,38,38,0.25)' : isStale ? 'rgba(245,158,11,0.30)' : 'rgba(96,165,250,0.28)'}`,
            color: isPartial ? '#b91c1c' : isStale ? '#b45309' : '#1d4ed8', fontSize: '0.8rem', fontWeight: 600,
          }}>
            <span style={{ fontSize: '1rem' }}>{isPartial ? '⚠️' : isStale ? '⚠️' : '📡'}</span>
            <span>
              {isPartial
                ? t('limitedOfflineData')
                : isStale
                  ? t('showingOutdatedOfflineData')
                  : t('showingSavedOfflineData')}
              {!isPartial && (
                <>
                  {' · '}{t('lastSyncedAt')} {formatLastSynced(lastSynced)}
                </>
              )}
            </span>
          </div>
        )}

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '28px', boxShadow: C.shadow, overflow: 'hidden' }}>
          <div style={{ height: '5px', background: `linear-gradient(90deg, ${C.accent}, ${C.orange}, ${C.gold})` }} />
          <div style={{ padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
              <div style={{ width: '92px', flexShrink: 0 }}>
                <div
                  style={{
                    width: '92px',
                    height: '92px',
                    borderRadius: '24px',
                    overflow: 'hidden',
                    border: `1px solid ${C.borderStrong}`,
                    background: C.surfaceAlt,
                    boxShadow: '0 12px 28px rgba(148, 163, 184, 0.18)',
                  }}
                >
                  <img src={profileImage} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: C.textPri, lineHeight: 1.2, marginBottom: '6px', wordBreak: 'break-word' }}>{displayName}</div>
                <div style={{ color: C.textMut, fontSize: '0.84rem', marginBottom: '10px' }}>{roleLine || 'Position data is still syncing for this person.'}</div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {person.employee_id && <span style={pillStyle(C.accent)}>EMP {person.employee_id}</span>}
                  {person.kimper_id != null && <span style={pillStyle(C.orange)}>KIMPER {person.kimper_id}</span>}
                </div>

                {companyLine.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {companyLine.map((value) => (
                      <span key={value} style={{ padding: '5px 9px', borderRadius: '10px', background: C.surfaceAlt, border: `1px solid ${C.border}`, color: C.textSec, fontSize: '0.76rem', fontWeight: 500 }}>
                        {value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
              {[
                [t('trainingValidLbl'), hasTrainingData ? (training_summary.valid || 0) : '—', C.success, C.surfaceAlt],
                [t('requiredLbl'), hasTrainingData ? (person.training_required || training_summary.mandatory_total || 0) : '—', C.accent, C.accentSoft],
                [t('violationsLbl'), isPartial ? '—' : violations.length, isPartial ? C.textMut : violations.length > 0 ? C.danger : C.success, isPartial ? C.surfaceAlt : violations.length > 0 ? '#fef2f2' : '#f0fdf4'],
              ].map(([label, value, color, background]) => (
                <div key={String(label)} style={{ background: String(background), border: `1px solid ${C.border}`, borderRadius: '18px', padding: '12px' }}>
                  <div style={{ color: C.textMut, fontSize: '0.7rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                  <div style={{ color: String(color), fontWeight: 800, fontSize: '1.1rem' }}>{formatValue(value as string | number)}</div>
                </div>
              ))}
            </div>

            {usingFallbackPhoto && (
              <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '16px', background: C.orangeSoft, border: `1px solid #fed7aa`, color: '#9a3412', fontSize: '0.8rem', lineHeight: 1.45 }}>
                Demo portrait is shown because this real employee record does not have a synced photo yet.
              </div>
            )}

            {/* Driver ↔ vehicle pairing — only offered when the person holds
                a KIMPER (drivers only); auto-opens when they were QR-scanned. */}
            {hasKimper && (
              currentPairing ? (
                <div style={{
                  marginTop: '14px', padding: '12px 14px', borderRadius: '14px',
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Currently paired
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: C.textPri }}>
                      🚛 {currentPairing.vehicle_no}
                      {currentPairing.paired_at && (
                        <span style={{ fontSize: '0.74rem', fontWeight: 500, color: C.textMut }}>
                          {' '}· since {new Date(currentPairing.paired_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleUnpair}
                    style={{
                      padding: '9px 14px', borderRadius: '10px', border: '1px solid #fecaca',
                      background: '#fff', color: '#b91c1c', fontWeight: 700,
                      fontSize: '0.78rem', cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    Unpair
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowPairModal(true)}
                  style={{
                    width: '100%', marginTop: '14px', padding: '13px',
                    borderRadius: '14px', border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg, #FC4100, #C9340A)',
                    color: '#fff', fontWeight: 800, fontSize: '0.92rem',
                    boxShadow: '0 8px 20px rgba(252,65,0,0.3)',
                  }}
                >
                  🚛 Assign Vehicle for Today
                </button>
              )
            )}
          </div>
        </div>

        {showPairModal && (
          <PairVehicleModal
            driver={{
              name: displayName,
              employeeId: person.employee_id ? String(person.employee_id) : null,
              kimperId: person.kimper_id ?? kimper?.kimper_id ?? null,
              kimperStatus: kimper?.status ?? person.kimper_status ?? null,
              kimperExpiredDate: (kimper as { kimper_expired_date?: string } | undefined)?.kimper_expired_date ?? null,
              authorizedUnits: authorizedUnitsList,
              photoUrl: profileImage,
            }}
            onClose={(paired) => {
              setShowPairModal(false)
              if (paired) void loadCurrentPairing()
            }}
          />
        )}

        {/* Authorized Equipment — prominently displayed for gate/truck entry scanning */}
        {(person.authorized_units || person.site_location || kimper?.authorized_units) && (
          <div style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '20px',
            padding: '18px',
            marginBottom: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)'
          }}>
            <div style={{
              fontSize: '1.05rem',
              fontWeight: 700,
              color: C.textPri,
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '1.2rem' }}>🚛</span>
              Authorized Equipment
            </div>

            {person.site_location && (
              <div style={{ background: C.accentSoft, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', padding: '12px 14px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: C.accent, display: 'grid', placeItems: 'center', color: 'white', fontSize: '0.9rem' }}>📍</div>
                <div>
                  <div style={{ fontSize: '0.68rem', color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Authorized Site</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.textPri }}>{person.site_location}</div>
                </div>
              </div>
            )}

            {(() => {
              const rawUnits = person.authorized_units || kimper?.authorized_units || ''
              const rawCodes = person.authorized_unit_codes || kimper?.authorized_unit_codes || ''
              const units = Array.isArray(rawUnits) ? rawUnits : typeof rawUnits === 'string' ? rawUnits.split(',').map(u => u.trim()).filter(Boolean) : []
              const codes = Array.isArray(rawCodes) ? rawCodes : typeof rawCodes === 'string' ? rawCodes.split(',').map(c => c.trim()).filter(Boolean) : []
              if (units.length === 0) return null

              const groups: Record<string, { name: string; icon: string; color: string; units: string[] }> = {
                'F':  { name: 'Full Access Units',      icon: '✅', color: '#10b981', units: [] },
                'T':  { name: 'Temporary Access Units', icon: '⏰', color: '#ef4444', units: [] },
                'L':  { name: 'Learning Units',         icon: '🎓', color: '#84cc16', units: [] },
                'RA': { name: 'Restricted Area Units',  icon: '⚠️', color: '#3b82f6', units: [] },
              }
              units.forEach((unit, i) => {
                const code = (codes[i] || '').toUpperCase()
                if (unit && code && groups[code]) {
                  groups[code].units.push(unit)
                }
              })
              const totalGrouped = Object.values(groups).reduce((s, g) => s + g.units.length, 0)

              if (totalGrouped === 0) {
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {units.map((unit, i) => (
                      <span key={i} style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, color: C.textPri, background: 'rgba(252,65,0,0.12)', border: `1px solid rgba(252,65,0,0.25)` }}>{unit}</span>
                    ))}
                  </div>
                )
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(['F','T','L','RA'] as const).map(code => {
                    const g = groups[code]
                    if (g.units.length === 0) return null
                    return (
                      <div key={code} style={{
                        borderRadius: '12px',
                        border: `2px solid ${g.color}`,
                        overflow: 'hidden',
                        background: C.surface
                      }}>
                        <div style={{
                          background: g.color,
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: 'white',
                          fontWeight: 600,
                          fontSize: '0.85rem'
                        }}>
                          <span style={{ fontSize: '1rem' }}>{g.icon}</span>
                          <span>{g.name} ({code})</span>
                          <span style={{
                            marginLeft: 'auto',
                            background: 'rgba(255,255,255,0.25)',
                            color: 'white',
                            width: '26px',
                            height: '26px',
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 700
                          }}>
                            {g.units.length}
                          </span>
                        </div>
                        <div style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {g.units.map((unit, idx) => (
                            <span key={idx} style={{
                              background: g.color,
                              color: 'white',
                              padding: '6px 14px',
                              borderRadius: '20px',
                              fontSize: '0.8rem',
                              fontWeight: 600
                            }}>
                              {unit}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        <Section title={t('workforceProfile')} icon="👤" subtitle={t('workforceProfileSub')}>
          <InfoGrid
            items={[
              { label: t('employeeStatusLbl'), value: person.status || employee.status, badgeColor: statusColor(person.status || employee.status) },
              { label: t('ktpNikLbl'), value: person.ktp_number || employee.ktp_number },
              { label: 'Position', value: person.position_title || employee.position },
              { label: 'Section', value: person.section || employee.section },
            ]}
          />
        </Section>

        <Section title={t('trainingSummaryLbl')} icon="🎓" subtitle={t('trainingSummarySub')}>
          {!hasTrainingData ? (
            <div style={{
              padding: '14px 16px', borderRadius: '14px', textAlign: 'center',
              background: C.surfaceAlt, border: `1px dashed ${C.border}`,
              color: C.textMut, fontSize: '0.82rem', fontWeight: 600,
            }}>
              {isPartial ? (
                <>
                  🔒 {t('trainingDetailsNotSynced')}
                </>
              ) : (
                <>
                  🔒 Training data not available offline.<br />
                  <span style={{ fontWeight: 500 }}>Connect to the internet to sync this employee’s training records.</span>
                </>
              )}
            </div>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px', marginBottom: '14px' }}>
            {[
              [`Mandatory (${mandatoryTotal})`, mandatoryTotal, C.accent],
              [t('validLbl'), mandatoryValid, C.success],
              [t('expiredLbl'), mandatoryExpired, C.danger],
              ['Not Done', mandatoryNotYet, C.warning],
            ].map(([label, value, color]) => (
              <div key={String(label)} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '12px' }}>
                <div style={{ color: C.textMut, fontSize: '0.7rem', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                <div style={{ color: String(color), fontWeight: 800, fontSize: '1rem' }}>{formatValue(value as string | number)}</div>
              </div>
            ))}
          </div>
          )}

          {extrasCompleted > 0 && (
            <div style={{
              marginBottom: '14px', padding: '8px 12px', borderRadius: '12px',
              background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.25)',
              color: '#2563eb', fontSize: '0.78rem', textAlign: 'center', fontWeight: 600,
            }}>
              + {extrasCompleted} extra training{extrasCompleted === 1 ? '' : 's'} completed
            </div>
          )}

          {mandatoryItems.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.75rem', color: C.textMut, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Mandatory Trainings ({mandatoryItems.length})
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {mandatoryItems.map((tr, i) => (
                  <div key={i} style={{
                    padding: '10px 12px', borderRadius: '12px',
                    background: C.surfaceAlt, border: `1px solid ${C.border}`,
                    display: 'flex', alignItems: 'center', gap: '10px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem', color: C.textPri, fontWeight: 600 }}>{tr.name}</div>
                      {tr.expiry_date && (
                        <div style={{ fontSize: '0.7rem', color: C.textMut, marginTop: '2px' }}>
                          expires {formatDate(tr.expiry_date)}{tr.days_remaining != null ? ` (${tr.days_remaining}d)` : ''}
                        </div>
                      )}
                    </div>
                    <span style={pillStyle(statusColor(tr.status))}>{tr.badge_icon} {tr.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {extraItems.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.75rem', color: C.textMut, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Extra Trainings ({extraItems.length})
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {extraItems.map((tr, i) => (
                  <div key={i} style={{
                    padding: '9px 12px', borderRadius: '12px',
                    background: C.surfaceAlt, border: `1px solid ${C.border}`,
                    display: 'flex', alignItems: 'center', gap: '10px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.78rem', color: C.textPri }}>{tr.name}</div>
                      {tr.expiry_date && (
                        <div style={{ fontSize: '0.7rem', color: C.textMut, marginTop: '1px' }}>
                          expires {formatDate(tr.expiry_date)}{tr.days_remaining != null ? ` (${tr.days_remaining}d)` : ''}
                        </div>
                      )}
                    </div>
                    <span style={pillStyle(statusColor(tr.status))}>{tr.badge_icon} {tr.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mandatoryItems.length === 0 && extraItems.length === 0 && (
            <div style={{ color: C.textMut, fontSize: '0.84rem', textAlign: 'center', padding: '12px' }}>
              {t('noTrainingCategoriesMsg')}
            </div>
          )}
        </Section>

        <Section title={t('kimperDetailsLbl')} icon="🪪" subtitle={t('kimperDetailsSub')}>
          <InfoGrid
            items={[
              { label: t('kimperStatusLbl'), value: kimper?.status || person.kimper_status || t('notLinkedLbl'), badgeColor: statusColor(kimper?.status || person.kimper_status) },
              { label: t('kimperIdLbl'), value: kimper?.kimper_id ?? person.kimper_id ?? '—' },
              { label: t('licenseTypeLbl'), value: kimper?.police_license_type },
              { label: t('licenseCategoryLbl'), value: kimper?.police_license_category },
              { label: t('licenseExpiryLbl'), value: kimper?.police_license_expired_date, formatAsDate: true },
              { label: t('mcuExpiryLbl'), value: kimper?.mcu_expire_date, formatAsDate: true },
            ]}
          />
        </Section>

        <Section title={t('safetyHistoryLbl')} icon="⚠️" subtitle={t('safetyHistorySub')}>
          {violations.length > 0 && (
            <div style={{ marginBottom: '14px', display: 'grid', gap: '10px' }}>
              {violations.slice(0, 5).map((violation) => (
                <div key={violation.id} style={{ background: C.surfaceAlt, borderRadius: '16px', padding: '12px 14px', border: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '0.85rem', color: C.textPri }}>{violation.description}</strong>
                    <span style={pillStyle(statusColor(violation.status || violation.severity))}>{violation.status || violation.severity}</span>
                  </div>
                  <div style={{ color: C.textMut, fontSize: '0.78rem' }}>{formatDate(violation.date)} · {formatValue(violation.location)}</div>
                </div>
              ))}
            </div>
          )}
          <PersonDeviationHistory lookup={historyLookup} />
        </Section>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '22px', padding: '14px', boxShadow: C.shadow }}>
          <button
            onClick={reportDeviation}
            style={{
              width: '100%',
              padding: '15px',
              borderRadius: '16px',
              background: `linear-gradient(135deg, ${C.danger}, #b91c1c)`,
              color: 'white',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.96rem',
              cursor: 'pointer',
              boxShadow: '0 14px 24px rgba(220, 38, 38, 0.18)',
            }}
          >
            ⚠️ {t('reportDeviationForThisPerson')}
          </button>
        </div>
      </div>
    </div>
  )
}