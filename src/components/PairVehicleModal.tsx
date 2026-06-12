import { useState } from 'react'
import { apiFetch } from '../services/api'

interface PairVehicleModalProps {
  employeeId?: string | null
  kimperId?: string | number | null
  driverName: string
  onClose: () => void
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
 * "What vehicle are you driving today?" — pairs the scanned driver with a
 * vehicle for the shift. The server runs the KIMPER authorization gate and
 * the result screen flashes red for an expired/missing KIMPER.
 */
export default function PairVehicleModal({ employeeId, kimperId, driverName, onClose }: PairVehicleModalProps) {
  const [vehicleNo, setVehicleNo] = useState('')
  const [hoursSlept, setHoursSlept] = useState('')
  const [feelsFit, setFeelsFit] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PairingResult | null>(null)

  const submit = async () => {
    const vno = vehicleNo.trim().toUpperCase()
    if (!vno) {
      setError('Enter the vehicle number first.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch('/api/mobile/pairing', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_no: vno,
          employee_id: employeeId || undefined,
          kimper_id: kimperId ?? undefined,
          driver_name: driverName,
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
  }
  const input: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: '1rem',
    border: '1px solid #cbd5e1', borderRadius: '12px', outline: 'none',
    color: '#0f172a', background: '#f8fafc',
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
                <b>{driverName}</b> → 🚛 <b>{result.pairing?.vehicle_no}</b>
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
                  {driverName} driving {result.pairing?.vehicle_no}
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

          <button
            onClick={onClose}
            style={{
              width: '100%', marginTop: '16px', padding: '13px', borderRadius: '12px',
              border: 'none', background: '#0f172a', color: '#fff',
              fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // ── Form ──
  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ fontSize: '1.6rem', textAlign: 'center', marginBottom: '4px' }}>🚛</div>
        <div style={{ fontSize: '1.05rem', fontWeight: 800, textAlign: 'center', marginBottom: '2px' }}>
          What vehicle are you driving today?
        </div>
        <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', marginBottom: '16px' }}>
          Driver: <b>{driverName}</b>
        </div>

        <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>Vehicle / Unit number</label>
        <input
          type="text"
          value={vehicleNo}
          onChange={e => setVehicleNo(e.target.value.toUpperCase())}
          placeholder="e.g. DT-4517"
          autoCapitalize="characters"
          style={{ ...input, marginTop: '4px', marginBottom: '12px', fontWeight: 700, letterSpacing: '0.04em' }}
        />

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
            {feelsFit ? '✓ I am fit for work' : '✗ I am NOT fit for work'}
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
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: 1, padding: '13px', borderRadius: '12px',
              border: '1px solid #cbd5e1', background: '#fff', color: '#334155',
              fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{
              flex: 2, padding: '13px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg, #FC4100, #C9340A)', color: '#fff',
              fontWeight: 800, fontSize: '0.9rem',
              cursor: submitting ? 'progress' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Checking KIMPER…' : 'Pair Vehicle'}
          </button>
        </div>
      </div>
    </div>
  )
}
