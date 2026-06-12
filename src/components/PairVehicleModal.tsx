import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../services/api'

export interface PairDriverInfo {
  name: string
  employeeId?: string | null
  kimperId?: string | number | null
  kimperStatus?: string | null
  kimperExpiredDate?: string | null
  authorizedUnits?: string[] | null
  photoUrl?: string | null
}

interface PairVehicleModalProps {
  driver: PairDriverInfo
  onClose: (paired: boolean) => void
}

interface PairingResult {
  success: boolean
  authorized: boolean
  kimper_status: string
  kimper_expired_date?: string | null
  vehicle_known: boolean
  vehicle_desc?: string | null
  warnings: string[]
  pairing?: { vehicle_no: string }
}

interface VehicleSuggestion {
  equip_no: string
  description?: string | null
}

const WARNING_LABELS: Record<string, string> = {
  kimper_expired: 'KIMPER is EXPIRED',
  no_kimper: 'No KIMPER record found',
  kimper_expiring_soon: 'KIMPER expires within 30 days',
  vehicle_unknown: 'Vehicle number not found in fleet register',
  vehicle_already_paired: 'Another driver is already paired to this vehicle',
  not_fit: 'Driver declared NOT fit for work',
  low_sleep: 'Less than 5 hours of sleep declared',
}

/**
 * Driver↔vehicle pairing, two steps:
 *   1. verify the scanned driver (photo, KIMPER, authorized units),
 *   2. pick the vehicle (autocomplete against the fleet register) + declare
 *      fit-for-work.
 * The server runs the KIMPER authorization gate; the result screen flashes
 * red for an expired/missing KIMPER.
 */
export default function PairVehicleModal({ driver, onClose }: PairVehicleModalProps) {
  const [step, setStep] = useState<'details' | 'form'>('details')
  const [vehicleNo, setVehicleNo] = useState('')
  const [suggestions, setSuggestions] = useState<VehicleSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [hoursSlept, setHoursSlept] = useState('')
  const [feelsFit, setFeelsFit] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PairingResult | null>(null)
  const searchTimer = useRef<number | null>(null)

  const kimperExpired = (driver.kimperStatus || '').toUpperCase() === 'EXPIRED'

  // Debounced fleet-register autocomplete.
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    const q = vehicleNo.trim()
    if (q.length < 2) {
      setSuggestions([])
      return
    }
    searchTimer.current = window.setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/mobile/vehicles/search?q=${encodeURIComponent(q)}`)
        const body = (await res.json().catch(() => null)) as { vehicles?: VehicleSuggestion[] } | null
        setSuggestions(body?.vehicles ?? [])
      } catch {
        setSuggestions([])
      }
    }, 250)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [vehicleNo])

  const submit = async () => {
    const vno = vehicleNo.trim().toUpperCase()
    if (!vno) {
      setError('Enter or pick the vehicle number first.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch('/api/mobile/pairing', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_no: vno,
          employee_id: driver.employeeId || undefined,
          kimper_id: driver.kimperId ?? undefined,
          driver_name: driver.name,
          hours_slept: hoursSlept ? Number(hoursSlept) : undefined,
          feels_fit: feelsFit,
        }),
      })
      const body = (await res.json().catch(() => null)) as PairingResult | null
      if (!res.ok || !body?.success) {
        throw new Error((body as { message?: string } | null)?.message || `HTTP ${res.status}`)
      }
      setResult(body)
      if (!body.authorized) {
        try { navigator.vibrate?.([400, 150, 400, 150, 400]) } catch { /* noop */ }
      }
    } catch (e) {
      setError((e as Error).message || 'Could not save the pairing — check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2200,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '20px', background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(4px)',
  }
  const card: React.CSSProperties = {
    width: '100%', maxWidth: '380px', background: '#ffffff',
    borderRadius: '22px', padding: '22px', color: '#0f172a',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    maxHeight: '88vh', overflowY: 'auto',
  }
  const input: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: '1rem',
    border: '1px solid #cbd5e1', borderRadius: '12px', outline: 'none',
    color: '#0f172a', background: '#f8fafc',
  }
  const primaryBtn: React.CSSProperties = {
    width: '100%', padding: '13px', borderRadius: '12px', border: 'none',
    background: 'linear-gradient(135deg, #FC4100, #C9340A)', color: '#fff',
    fontWeight: 800, fontSize: '0.92rem', cursor: 'pointer',
  }
  const secondaryBtn: React.CSSProperties = {
    width: '100%', padding: '12px', borderRadius: '12px',
    border: '1px solid #cbd5e1', background: '#fff', color: '#334155',
    fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
  }

  // ── Result screen ──
  if (result) {
    const expired = result.warnings.includes('kimper_expired') || result.warnings.includes('no_kimper')
    return (
      <div style={overlay}>
        <style>{`@keyframes pairFlash { 0%,100% { background:#dc2626; } 50% { background:#7f1d1d; } }`}</style>
        <div style={card}>
          {result.authorized ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '8px' }}>✅</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#15803d', marginBottom: '6px' }}>
                PAIRED — AUTHORIZED
              </div>
              <div style={{ fontSize: '0.95rem', marginBottom: '4px' }}>
                <b>{driver.name}</b> → 🚛 <b>{result.pairing?.vehicle_no}</b>
              </div>
              {result.vehicle_desc && (
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '4px' }}>{result.vehicle_desc}</div>
              )}
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                KIMPER: {result.kimper_status}
                {result.kimper_expired_date ? ` (valid until ${result.kimper_expired_date})` : ''}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  animation: expired ? 'pairFlash 0.7s infinite' : undefined,
                  background: '#dc2626', color: '#fff', borderRadius: '14px',
                  padding: '16px 12px', marginBottom: '12px',
                }}
              >
                <div style={{ fontSize: '2rem', marginBottom: '4px' }}>⚠️</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 900, letterSpacing: '0.04em' }}>
                  {result.kimper_status === 'NO_KIMPER' ? 'NO KIMPER' : 'EXPIRED KIMPER'}
                </div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, marginTop: '6px' }}>
                  {driver.name} driving {result.pairing?.vehicle_no}
                </div>
                {result.kimper_expired_date && (
                  <div style={{ fontSize: '0.78rem', marginTop: '4px', opacity: 0.9 }}>
                    Expired: {result.kimper_expired_date}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#7f1d1d', marginBottom: '4px', fontWeight: 600 }}>
                Pairing recorded and flagged to supervision.
              </div>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {result.warnings.map(w => (
                <div key={w} style={{
                  fontSize: '0.78rem', fontWeight: 600, padding: '7px 10px', borderRadius: '9px',
                  background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
                }}>
                  ⚠ {WARNING_LABELS[w] || w}
                </div>
              ))}
            </div>
          )}

          <button onClick={() => onClose(true)} style={{ ...primaryBtn, background: '#0f172a', marginTop: '16px' }}>
            Done
          </button>
        </div>
      </div>
    )
  }

  // ── Step 1: verify the driver ──
  if (step === 'details') {
    return (
      <div style={overlay}>
        <div style={card}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: '#64748b', textAlign: 'center', marginBottom: '14px' }}>
            VEHICLE PAIRING — STEP 1 OF 2
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '16px', overflow: 'hidden',
              background: '#f1f5f9', border: '1px solid #e2e8f0', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem',
            }}>
              {driver.photoUrl
                ? <img src={driver.photoUrl} alt={driver.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : '👤'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '1.02rem', fontWeight: 800 }}>{driver.name}</div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                EMP {driver.employeeId || '—'}{driver.kimperId != null ? ` · KIMPER ${driver.kimperId}` : ''}
              </div>
            </div>
          </div>

          <div style={{
            borderRadius: '12px', padding: '10px 12px', marginBottom: '10px',
            background: kimperExpired ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${kimperExpired ? '#fecaca' : '#bbf7d0'}`,
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '2px' }}>KIMPER STATUS</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: kimperExpired ? '#b91c1c' : '#15803d' }}>
              {driver.kimperStatus || 'Unknown'}
              {driver.kimperExpiredDate ? ` — ${kimperExpired ? 'expired' : 'valid until'} ${driver.kimperExpiredDate}` : ''}
            </div>
          </div>

          {driver.authorizedUnits && driver.authorizedUnits.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>AUTHORIZED UNITS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {driver.authorizedUnits.slice(0, 8).map((u, i) => (
                  <span key={i} style={{
                    fontSize: '0.72rem', fontWeight: 700, padding: '3px 9px', borderRadius: '8px',
                    background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8',
                  }}>{u}</span>
                ))}
                {driver.authorizedUnits.length > 8 && (
                  <span style={{ fontSize: '0.72rem', color: '#64748b', padding: '3px 4px' }}>
                    +{driver.authorizedUnits.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            <button onClick={() => onClose(false)} style={{ ...secondaryBtn, flex: 1 }}>Cancel</button>
            <button onClick={() => setStep('form')} style={{ ...primaryBtn, flex: 2, width: 'auto' }}>
              This is the driver →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 2: vehicle + fit-for-work ──
  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', color: '#64748b', textAlign: 'center', marginBottom: '10px' }}>
          VEHICLE PAIRING — STEP 2 OF 2
        </div>
        <div style={{ fontSize: '1.02rem', fontWeight: 800, textAlign: 'center', marginBottom: '2px' }}>
          What vehicle is {driver.name.split(' ')[0]} driving today?
        </div>
        <div style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'center', marginBottom: '14px' }}>
          Pick from the fleet register or type the unit number
        </div>

        <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>Vehicle / Unit number</label>
        <div style={{ position: 'relative', marginTop: '4px', marginBottom: '12px' }}>
          <input
            type="text"
            value={vehicleNo}
            onChange={e => { setVehicleNo(e.target.value.toUpperCase()); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="e.g. DT-4517"
            autoCapitalize="characters"
            style={{ ...input, fontWeight: 700, letterSpacing: '0.04em' }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
              background: '#fff', border: '1px solid #cbd5e1', borderRadius: '12px',
              marginTop: '4px', overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
              maxHeight: '180px', overflowY: 'auto',
            }}>
              {suggestions.map(v => (
                <div
                  key={v.equip_no}
                  onClick={() => { setVehicleNo(v.equip_no); setShowSuggestions(false) }}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', fontSize: '0.85rem',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <b>{v.equip_no}</b>
                  {v.description && <span style={{ color: '#64748b' }}> — {v.description}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>Hours slept last night</label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          max="24"
          value={hoursSlept}
          onChange={e => setHoursSlept(e.target.value)}
          placeholder="e.g. 7"
          style={{ ...input, marginTop: '4px', marginBottom: '12px' }}
        />

        <div
          onClick={() => setFeelsFit(!feelsFit)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderRadius: '12px', cursor: 'pointer', marginBottom: '14px',
            background: feelsFit ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${feelsFit ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          <span style={{ fontSize: '0.86rem', fontWeight: 700, color: feelsFit ? '#15803d' : '#b91c1c' }}>
            {feelsFit ? '✓ Fit for work' : '✗ NOT fit for work'}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>tap to change</span>
        </div>

        {error && (
          <div style={{
            fontSize: '0.8rem', color: '#b91c1c', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: '10px', padding: '8px 10px', marginBottom: '12px',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setStep('details')} disabled={submitting} style={{ ...secondaryBtn, flex: 1 }}>
            ← Back
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{ ...primaryBtn, flex: 2, width: 'auto', opacity: submitting ? 0.7 : 1, cursor: submitting ? 'progress' : 'pointer' }}
          >
            {submitting ? 'Checking KIMPER…' : 'Pair Vehicle'}
          </button>
        </div>
      </div>
    </div>
  )
}
