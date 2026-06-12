import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import PersonDeviationHistory from '../features/deviation/PersonDeviationHistory'
import { useI18n } from '../services/i18n-context'
import { offlineDataSync, type EmployeeFullInfo, type EmployeeCardData } from '../services/offlineDataSync'

type TabId = 'profile' | 'training' | 'violations'

// ── colours matching the web employee card ──────────────────────────────────
const C = {
  bg:       '#050a12',
  card:     'rgba(255,255,255,0.04)',
  border:   'rgba(255,255,255,0.09)',
  accent:   '#FC4100',
  gold:     '#FFC55A',
  success:  '#22c55e',
  warning:  '#f59e0b',
  danger:   '#ef4444',
  textPri:  '#f1f5f9',
  textMut:  '#8b9ab0',
}

// Cache older than this is still shown but flagged as potentially outdated.
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

export default function EmployeeDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  const initialCardData: EmployeeCardData | null = location.state?.cardData ?? null
  const offlineEmployee: EmployeeFullInfo | null = location.state?.employee ?? null
  const [cardData, setCardData] = useState<EmployeeCardData | null>(initialCardData)
  const emp = cardData?.employee ?? offlineEmployee

  useEffect(() => {
    let cancelled = false

    const loadOfflineCardData = async () => {
      if (cardData || !offlineEmployee?.employee_id) return

      const cachedCard = await offlineDataSync.fetchEmployeeCardData(
        offlineEmployee.employee_id,
        offlineEmployee.qr_code_token || ''
      )

      if (!cancelled && cachedCard?.success) {
        setCardData(cachedCard)
      }
    }

    loadOfflineCardData()
    return () => {
      cancelled = true
    }
  }, [cardData, offlineEmployee?.employee_id, offlineEmployee?.qr_code_token])

  // When showing cached offline data and the network returns, silently refresh
  // from the server and swap in the live record.
  useEffect(() => {
    if (!cardData?._offline) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    const employeeId = cardData.employee?.employee_id
    if (!employeeId) return

    let cancelled = false
    const refresh = async () => {
      const fresh = await offlineDataSync.fetchEmployeeCardData(
        employeeId,
        offlineEmployee?.qr_code_token || ''
      )
      if (!cancelled && fresh?.success && !fresh._offline) {
        setCardData(fresh)
      }
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [cardData, offlineEmployee?.qr_code_token])

  if (!emp) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.textMut, padding: '20px' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>👤</div>
        <h2 style={{ color: C.textPri, marginBottom: '8px' }}>{t('noEmployeesFound')}</h2>
        <p style={{ marginBottom: '20px', textAlign: 'center' }}>{t('tryDifferentSearch')}</p>
        <button onClick={() => navigate('/home')} style={{
          padding: '12px 28px', background: C.accent, color: 'white',
          border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700
        }}>{t('back')}</button>
      </div>
    )
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  const statusColor = (s?: string) => {
    const v = s?.toLowerCase()
    if (v === 'active')   return C.success
    if (v === 'inactive' || v === 'resigned') return C.danger
    return C.warning
  }

  const initials = (name?: string) => {
    if (!name) return '👤'
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '👤'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }

  const trainingColor = (s: string) => {
    if (s === 'On Time')    return C.success
    if (s === 'Expired')    return C.danger
    if (s === 'Warning' || s === 'Expiring Soon') return C.warning
    return C.textMut
  }

  const trainingBg = (s: string) => {
    if (s === 'On Time')    return 'rgba(34,197,94,0.12)'
    if (s === 'Expired')    return 'rgba(239,68,68,0.12)'
    if (s === 'Warning' || s === 'Expiring Soon') return 'rgba(245,158,11,0.12)'
    return 'rgba(139,154,176,0.12)'
  }

  // ── shared sub-components ─────────────────────────────────────────────────
  const GlassCard = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px',
      marginBottom: '12px', overflow: 'hidden', ...style
    }}>{children}</div>
  )

  const CardHeader = ({ icon, title }: { icon: string; title: string }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
      background: 'rgba(255,255,255,0.02)'
    }}>
      <div style={{
        width: '28px', height: '28px', borderRadius: '8px',
        background: `rgba(252,65,0,0.15)`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '0.85rem', color: C.accent
      }}>{icon}</div>
      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: C.textPri, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
    </div>
  )

  const InfoGrid = ({ items }: { items: { icon: string; label: string; value?: string | null; badge?: boolean }[] }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: C.border }}>
      {items.map((it, i) => (
        <div key={i} style={{ background: C.bg === '#050a12' ? '#080e18' : C.card, padding: '12px 14px' }}>
          <div style={{ fontSize: '0.68rem', color: C.textMut, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span>{it.icon}</span>{it.label}
          </div>
          {it.badge ? (
            <span style={{
              display: 'inline-block', padding: '2px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700,
              background: statusColor(it.value ?? undefined) + '22', color: statusColor(it.value ?? undefined), border: `1px solid ${statusColor(it.value ?? undefined)}44`
            }}>{it.value || '—'}</span>
          ) : (
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: C.textPri, wordBreak: 'break-word' }}>{it.value || '—'}</div>
          )}
        </div>
      ))}
    </div>
  )

  const summary    = cardData?.training_summary
  const mandatoryItems = cardData?.mandatory_trainings ?? []
  const extraItems     = cardData?.extra_trainings ?? []
  const violations = cardData?.violations ?? []

  const mandatoryTotal    = summary?.mandatory_total ?? mandatoryItems.length ?? 6
  const mandatoryValid    = summary?.mandatory_valid ?? mandatoryItems.filter(t => t.status === 'On Time').length
  const mandatoryExpired  = summary?.mandatory_expired ?? mandatoryItems.filter(t => t.status === 'Expired').length
  const mandatoryNotYet   = summary?.mandatory_not_yet ?? mandatoryItems.filter(t => t.status === 'Not Done' || t.status === 'Not Yet').length
  const extrasCompleted   = summary?.extras_completed ?? extraItems.filter(t => t.status === 'On Time').length
  const compliancePct     = mandatoryTotal > 0 ? Math.round((mandatoryValid / mandatoryTotal) * 100) : 0

  const isOffline = !!cardData?._offline
  const lastSynced = cardData?._offline?.cachedAt
  const isStale = lastSynced ? (Date.now() - lastSynced) > STALE_CACHE_MS : false
  // Distinguish "genuinely zero training" (full payload) from "training detail
  // not available offline" (bulk-cached card with no training detail).
  const hasTrainingData = cardData?.training_summary != null || mandatoryItems.length > 0 || extraItems.length > 0

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPri, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── BRAND BAR ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px 10px',
        borderBottom: `1px solid ${C.border}`
      }}>
        <div>
          <div style={{
            fontSize: '1.1rem', fontWeight: 900, letterSpacing: '3px',
            background: `linear-gradient(135deg, ${C.accent}, ${C.gold})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>PRISM</div>
          <div style={{ fontSize: '0.6rem', color: C.textMut, letterSpacing: '1px', textTransform: 'uppercase' }}>
            Personnel Records &amp; Inspection Safety
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {cardData && !isOffline ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: '50px', padding: '5px 12px', fontSize: '0.7rem', fontWeight: 700, color: '#4ade80'
            }}>✔ VERIFIED</div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '50px', padding: '5px 12px', fontSize: '0.7rem', fontWeight: 700, color: C.warning
            }}>📴 {cardData ? 'SAVED' : 'OFFLINE'}</div>
          )}
          <button onClick={() => navigate(-1)} style={{
            padding: '6px 10px', background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${C.border}`, borderRadius: '8px',
            cursor: 'pointer', color: C.textMut, fontSize: '1rem'
          }}>←</button>
        </div>
      </div>

      {/* ── OFFLINE DATA BANNER ── */}
      {isOffline && (
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 14px', borderRadius: '12px',
            background: isStale ? 'rgba(245,158,11,0.12)' : 'rgba(96,165,250,0.12)',
            border: `1px solid ${isStale ? 'rgba(245,158,11,0.32)' : 'rgba(96,165,250,0.3)'}`,
            color: isStale ? C.warning : '#93c5fd', fontSize: '0.78rem', fontWeight: 600,
          }}>
            <span style={{ fontSize: '1rem' }}>{isStale ? '⚠️' : '📡'}</span>
            <span>
              {isStale ? 'Showing outdated offline data' : 'Showing saved offline data'}
              {' · '}last synced {formatLastSynced(lastSynced)}
            </span>
          </div>
        </div>
      )}

      {/* ── IDENTITY CARD ── */}
      <div style={{ padding: '12px 16px 0' }}>
        <div style={{
          position: 'relative', borderRadius: '20px', overflow: 'hidden',
          border: `1px solid ${C.border}`,
          background: `
            radial-gradient(120% 80% at 0% 0%, rgba(252,65,0,0.10), transparent 55%),
            radial-gradient(100% 70% at 100% 0%, rgba(255,197,90,0.06), transparent 55%),
            ${C.card}
          `,
          marginBottom: '12px',
          boxShadow: '0 10px 28px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.04) inset'
        }}>
          {/* orange gradient top bar */}
          <div style={{ height: '3px', background: `linear-gradient(90deg, ${C.accent}, ${C.gold}, ${C.accent})` }} />

          {/* ── HERO: circular avatar · name · position · EMP/KIMPER pills ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 16px 14px' }}>
            {/* avatar wrapper — gradient ring + status dot */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: '78px', height: '78px', borderRadius: '50%',
                padding: '2px',
                background: `linear-gradient(135deg, ${C.accent}, ${C.gold})`,
                boxShadow: '0 6px 20px rgba(252,65,0,0.28)'
              }}>
                <div style={{
                  width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
                  background: '#0a1220',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: C.textPri, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '1px'
                }}>
                  {emp.photo_url
                    ? <img src={emp.photo_url} alt={emp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{
                        background: `linear-gradient(135deg, ${C.accent}, ${C.gold})`,
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
                      }}>{initials(emp.name)}</span>}
                </div>
              </div>
              {/* status dot */}
              <div style={{
                position: 'absolute', right: '2px', bottom: '2px',
                width: '16px', height: '16px', borderRadius: '50%',
                background: statusColor(emp.status),
                border: `2px solid ${C.card}`,
                boxShadow: `0 0 0 1px ${statusColor(emp.status)}55`
              }} />
            </div>

            {/* right column — vertically centered, tight spacing */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px', justifyContent: 'center' }}>

              {/* name — large, bold, wraps up to 2 lines */}
              <div style={{
                fontSize: '1.1rem', fontWeight: 800, color: C.textPri,
                lineHeight: 1.2, wordBreak: 'break-word', letterSpacing: '0.01em',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
              }}>{emp.name}</div>

              {/* position — muted subtitle, single line to keep card compact */}
              {emp.position && (
                <div style={{
                  fontSize: '0.75rem', color: C.textMut, lineHeight: 1.25,
                  fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>{emp.position}{emp.position_level ? ` · L${emp.position_level}` : ''}</div>
              )}

              {/* EMP + KIMPER pills + status */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  background: `linear-gradient(135deg, ${C.accent}, #d93600)`,
                  borderRadius: '999px', padding: '3px 10px', fontSize: '0.64rem', color: '#fff',
                  fontWeight: 800, letterSpacing: '0.04em',
                  boxShadow: '0 2px 8px rgba(252,65,0,0.4)'
                }}>
                  <span style={{ opacity: 0.85 }}>EMP</span>
                  <span style={{ fontFamily: "'SF Mono', 'Consolas', monospace", letterSpacing: '0.02em' }}>{emp.employee_id}</span>
                </span>
                {cardData?.kimper?.kimper_id && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    background: `linear-gradient(135deg, ${C.gold}, #e5a93d)`,
                    borderRadius: '999px', padding: '3px 10px', fontSize: '0.64rem', color: '#1a1205',
                    fontWeight: 800, letterSpacing: '0.04em',
                    boxShadow: '0 2px 8px rgba(255,197,90,0.32)'
                  }}>
                    <span style={{ opacity: 0.85 }}>KIMPER</span>
                    <span style={{ fontFamily: "'SF Mono', 'Consolas', monospace", letterSpacing: '0.02em' }}>{cardData.kimper.kimper_id}</span>
                  </span>
                )}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '3px 9px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700,
                  background: statusColor(emp.status) + '1c', color: statusColor(emp.status),
                  border: `1px solid ${statusColor(emp.status)}55`, textTransform: 'uppercase', letterSpacing: '0.06em'
                }}>
                  <span style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: statusColor(emp.status),
                    boxShadow: `0 0 6px ${statusColor(emp.status)}`
                  }} />
                  {emp.status || 'Active'}
                </span>
              </div>
            </div>
          </div>

          {/* ── STAT TILES: Training Valid · Required · Violations ── */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px',
            background: C.border, borderTop: `1px solid ${C.border}`
          }}>
            {[
              {
                label: 'Training Valid',
                value: hasTrainingData ? (summary?.mandatory_valid ?? summary?.valid ?? 0) : '—',
                color: C.success,
                tab: 'training' as TabId,
              },
              {
                label: 'Required',
                value: hasTrainingData ? (summary?.mandatory_total ?? summary?.total ?? 0) : '—',
                color: '#60a5fa',
                tab: 'training' as TabId,
              },
              {
                label: 'Violations',
                value: violations.length,
                color: violations.length > 0 ? C.danger : C.textMut,
                tab: 'violations' as TabId,
              },
            ].map((s) => (
              <button
                key={s.label}
                onClick={() => setActiveTab(s.tab)}
                style={{
                  position: 'relative',
                  background: 'linear-gradient(180deg, #0a1220 0%, #070d18 100%)',
                  padding: '13px 6px 12px', textAlign: 'center',
                  border: 'none', cursor: 'pointer', color: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
                  transition: 'background 0.15s ease'
                }}
              >
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{
                  width: '18px', height: '2px', borderRadius: '2px',
                  background: s.color, opacity: 0.55
                }} />
                <div style={{
                  fontSize: '0.6rem', color: C.textMut, textTransform: 'uppercase',
                  letterSpacing: '0.08em', fontWeight: 700
                }}>{s.label}</div>
              </button>
            ))}
          </div>

          {/* ── PHOTO SOURCE FOOTER ── */}
          {(emp as any).photo_source && (
            <div style={{
              textAlign: 'center', padding: '7px 16px',
              borderTop: `1px solid ${C.border}`,
              background: 'rgba(0,0,0,0.2)',
              fontSize: '0.62rem', color: C.textMut, letterSpacing: '0.04em'
            }}>
              📷 Photo source: <strong style={{ color: '#b6c4da' }}>{(emp as any).photo_source}</strong>
            </div>
          )}
        </div>

        {/* ── TAB NAV ── */}
        <div style={{
          display: 'flex', gap: '6px', marginBottom: '12px',
          background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '4px',
          border: `1px solid ${C.border}`
        }}>
          {(['profile', 'training', 'violations'] as TabId[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer',
              borderRadius: '9px', fontSize: '0.75rem', fontWeight: activeTab === tab ? 700 : 500,
              color: activeTab === tab ? 'white' : C.textMut,
              background: activeTab === tab ? `linear-gradient(135deg, ${C.accent}, ${C.gold}88)` : 'transparent',
              transition: 'all 0.2s'
            }}>
              {tab === 'profile' ? '👤 Profile' : tab === 'training' ? '📋 Training' : '⚠️ Violations'}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB CONTENT ── */}
      <div style={{ padding: '0 16px 100px' }}>

        {/* ── PROFILE TAB ── */}
        {activeTab === 'profile' && (
          <div>
            <GlassCard>
              <CardHeader icon="🪪" title="Employee Information" />
              <InfoGrid items={[
                { icon: '🏢', label: 'Company',    value: emp.company },
                { icon: '🏗️', label: 'Department', value: emp.department },
                { icon: '🗂️', label: 'Section',    value: emp.section },
                { icon: '⭐', label: 'Level',       value: emp.position_level },
                { icon: '🔵', label: 'Status',      value: emp.status, badge: true },
              ]} />
            </GlassCard>

            {cardData?.kimper && (
              <GlassCard>
                <CardHeader icon="📄" title="KIMPER Driving Permit" />
                <InfoGrid items={[
                  { icon: '📅', label: 'MCU Expires',        value: cardData.kimper.mcu_expire_date?.split('T')[0] },
                  { icon: '📅', label: 'KIMPER Expires',     value: cardData.kimper.kimper_expired_date?.split('T')[0] },
                  { icon: '🚗', label: 'License Type',       value: cardData.kimper.police_license_type },
                  { icon: '🏷️', label: 'License Category',  value: cardData.kimper.police_license_category },
                  { icon: '📅', label: 'License Expires',    value: cardData.kimper.police_license_expired_date?.split('T')[0] },
                  { icon: '🔵', label: 'KIMPER Status',      value: cardData.kimper.status, badge: true },
                ]} />
                {/* Authorized Units — grouped by access level code (F/T/L/RA) */}
                {(cardData.kimper.authorized_units?.length ?? 0) > 0 && (
                  <div style={{
                    padding: '14px 16px',
                    borderTop: `1px solid ${C.border}`,
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ fontSize: '0.72rem', color: C.textMut, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <span>🚜</span>Authorized Equipment
                    </div>
                    {(() => {
                      const groups: Record<string, { name: string; icon: string; color: string; units: string[] }> = {
                        'F':  { name: 'Full Access Units',      icon: '✅', color: '#10b981', units: [] },
                        'T':  { name: 'Temporary Access Units', icon: '⏰', color: '#ef4444', units: [] },
                        'L':  { name: 'Learning Units',         icon: '🎓', color: '#84cc16', units: [] },
                        'RA': { name: 'Restricted Area Units',  icon: '⚠️', color: '#3b82f6', units: [] },
                      }
                      const units = cardData.kimper.authorized_units ?? []
                      const codes = cardData.kimper.authorized_unit_codes ?? []
                      units.forEach((unit, i) => {
                        const code = (codes[i] || '').toUpperCase()
                        if (unit && code && groups[code]) {
                          groups[code].units.push(unit)
                        }
                      })
                      const totalGrouped = Object.values(groups).reduce((s, g) => s + g.units.length, 0)
                      if (totalGrouped === 0) {
                        // No recognized codes — fall back to flat list
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
                                background: 'rgba(255,255,255,0.03)'
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
              </GlassCard>
            )}

            <button onClick={() => navigate('/deviation-report', {
              state: cardData ? { employeeCardData: cardData } : { employee: emp }
            })} style={{
              width: '100%', padding: '14px', borderRadius: '12px',
              background: `linear-gradient(135deg, ${C.danger}, #b91c1c)`,
              color: 'white', border: 'none', fontWeight: 700, fontSize: '0.95rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}>⚠️ {t('reportDeviationBtn')}</button>
          </div>
        )}

        {/* ── TRAINING TAB ── */}
        {activeTab === 'training' && (
          <div>
            {/* Training Compliance Summary — 6 mandatory rule */}
            {hasTrainingData && (
            <GlassCard>
              <CardHeader icon="🎓" title="Training Compliance Summary" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: C.border, margin: '0' }}>
                {[
                  { label: `Mandatory (${mandatoryTotal})`, value: mandatoryTotal,   color: '#60a5fa' },
                  { label: 'Valid',                          value: mandatoryValid,   color: C.success },
                  { label: 'Expired',                        value: mandatoryExpired, color: C.danger  },
                  { label: 'Not Done',                       value: mandatoryNotYet,  color: C.warning },
                ].map(s => (
                  <div key={s.label} style={{ background: '#080e18', padding: '14px 6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '0.62rem', color: C.textMut, marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 14px 14px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.72rem', color: C.textMut }}>Compliance</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: compliancePct === 100 ? C.success : compliancePct >= 50 ? C.warning : C.danger }}>
                    {compliancePct}% · {mandatoryValid}/{mandatoryTotal}
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: '4px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${compliancePct}%`, height: '100%',
                    background: compliancePct === 100 ? C.success : compliancePct >= 50 ? C.warning : C.danger,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                {extrasCompleted > 0 && (
                  <div style={{
                    marginTop: '10px', padding: '6px 10px', borderRadius: '8px',
                    background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.25)',
                    fontSize: '0.72rem', color: '#93c5fd', textAlign: 'center'
                  }}>
                    + {extrasCompleted} extra training{extrasCompleted === 1 ? '' : 's'} completed
                  </div>
                )}
              </div>
            </GlassCard>
            )}

            {!hasTrainingData && (
              <GlassCard>
                <div style={{ padding: '28px 20px', textAlign: 'center', color: C.textMut }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔒</div>
                  <div style={{ color: C.textPri, fontWeight: 700, marginBottom: '4px' }}>Training data not available offline.</div>
                  <div style={{ fontSize: '0.8rem' }}>Connect to the internet to sync this employee’s training records.</div>
                </div>
              </GlassCard>
            )}

            {/* Mandatory Trainings — fixed 6-item rule */}
            {mandatoryItems.length > 0 && (
              <GlassCard>
                <CardHeader icon="✅" title={`Mandatory Trainings (${mandatoryItems.length})`} />
                <div>
                  {mandatoryItems.map((tr, i) => (
                    <div key={i} style={{
                      padding: '11px 14px',
                      borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'center', gap: '10px'
                    }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.danger, flexShrink: 0 }} title="Mandatory" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', color: C.textPri, lineHeight: 1.3, fontWeight: 500 }}>{tr.name}</div>
                        {tr.expiry_date && (
                          <div style={{ fontSize: '0.65rem', color: C.textMut, marginTop: '2px' }}>
                            Expires: {tr.expiry_date?.split('T')[0]}{tr.days_remaining != null ? ` (${tr.days_remaining}d)` : ''}
                          </div>
                        )}
                      </div>
                      <span style={{
                        padding: '3px 9px', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700,
                        color: trainingColor(tr.status), background: trainingBg(tr.status),
                        whiteSpace: 'nowrap', border: `1px solid ${trainingColor(tr.status)}33`
                      }}>{tr.badge_icon} {tr.status}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}

            {/* Extra Trainings — anything completed beyond the 6 mandatory */}
            {extraItems.length > 0 && (
              <GlassCard>
                <CardHeader icon="⭐" title={`Extra Trainings (${extraItems.length})`} />
                <div>
                  {extraItems.map((tr, i) => (
                    <div key={i} style={{
                      padding: '10px 14px',
                      borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'center', gap: '10px'
                    }}>
                      <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#60a5fa', flexShrink: 0 }} title="Extra" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.76rem', color: C.textPri, lineHeight: 1.3 }}>{tr.name}</div>
                        {tr.expiry_date && (
                          <div style={{ fontSize: '0.65rem', color: C.textMut, marginTop: '1px' }}>
                            Expires: {tr.expiry_date?.split('T')[0]}{tr.days_remaining != null ? ` (${tr.days_remaining}d)` : ''}
                          </div>
                        )}
                      </div>
                      <span style={{
                        padding: '2px 8px', borderRadius: '6px', fontSize: '0.63rem', fontWeight: 700,
                        color: trainingColor(tr.status), background: trainingBg(tr.status),
                        whiteSpace: 'nowrap', border: `1px solid ${trainingColor(tr.status)}33`
                      }}>{tr.badge_icon} {tr.status}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}

            {mandatoryItems.length === 0 && extraItems.length === 0 && cardData && (
              <GlassCard>
                <div style={{ padding: '24px 20px', textAlign: 'center', color: C.textMut, fontSize: '0.82rem' }}>
                  No training records for this employee yet.
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* ── VIOLATIONS TAB ── */}
        {activeTab === 'violations' && (
          <div>
            <GlassCard>
              <CardHeader icon="⚠️" title="Violations &amp; Deviations" />
              {violations.length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>✅</div>
                  <div style={{ fontWeight: 700, color: C.success, marginBottom: '6px' }}>No Violations Recorded</div>
                  <div style={{ fontSize: '0.8rem', color: C.textMut }}>
                    {cardData ? 'This employee has a clean safety record.' : 'Connect to network for violation history.'}
                  </div>
                </div>
              ) : (
                <div style={{ padding: '8px' }}>
                  {violations.map(v => (
                    <div key={v.id} style={{
                      background: v.severity === 'Critical' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${v.severity === 'Critical' ? 'rgba(239,68,68,0.25)' : C.border}`,
                      borderRadius: '12px', padding: '12px 14px', marginBottom: '8px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '20px', fontSize: '0.68rem', fontWeight: 700,
                          background: v.severity === 'Critical' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                          color: v.severity === 'Critical' ? '#f87171' : '#fbbf24'
                        }}>{v.severity}</span>
                        <span style={{ fontSize: '0.7rem', color: C.textMut }}>{v.date?.split('T')[0]}</span>
                      </div>
                      <div style={{ fontSize: '0.84rem', color: C.textPri, fontWeight: 500, marginBottom: '6px' }}>{v.description}</div>
                      <div style={{ fontSize: '0.74rem', color: C.textMut }}>📍 {v.location}</div>
                      {v.observer_name && <div style={{ fontSize: '0.74rem', color: C.textMut, marginTop: '2px' }}>👁 {v.observer_name}</div>}
                      {v.action_taken && <div style={{ fontSize: '0.74rem', color: C.textMut, marginTop: '6px', fontStyle: 'italic' }}>Action: {v.action_taken}</div>}
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard>
              <CardHeader icon="🧾" title="Personnel Deviation Reports" />
              <div style={{ padding: '14px' }}>
                <PersonDeviationHistory
                  lookup={{
                    employeeId: emp.employee_id,
                    ktpNumber: (emp as any).ktp_number || undefined,
                    kimperId: cardData?.kimper?.kimper_id,
                  }}
                />
              </div>
            </GlassCard>
          </div>
        )}

        {/* ── FOOTER ── */}
        {cardData?.verified_at && (
          <div style={{ textAlign: 'center', padding: '12px 0', marginTop: '4px' }}>
            <div style={{ fontSize: '0.65rem', color: C.textMut }}>Verified at {cardData.verified_at}</div>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', marginTop: '2px' }}>WBN Safety Department — PRISM System</div>
          </div>
        )}
      </div>
    </div>
  )
}
