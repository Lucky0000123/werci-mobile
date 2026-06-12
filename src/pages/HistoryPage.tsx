import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DeviationStorage from '../services/deviationStorage'

interface HistoryPageProps {
  onShowToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

// Deviation history record (inspections were removed from the mobile app —
// vehicle inspection lives in a separate application now).
interface HistoryRecord {
  id: string
  syncState: 'local' | 'synced'
  title: string          // person name
  subtitle: string       // location / description
  dateISO: string
  status: string
  createdAt: number
}

export default function HistoryPage({ onShowToast }: HistoryPageProps) {
  const navigate = useNavigate()
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    setIsLoading(true)
    try {
      const all: HistoryRecord[] = []

      // ── Deviations — pending (offline queue) ─────────────────────────────
      try {
        const pending = await DeviationStorage.getPending()
        pending.forEach(d => {
          all.push({
            id: `dev_pending_${d._localId}`,
            syncState: 'local',
            title: d.person_involved_name || 'Unnamed Person',
            subtitle: d.location || d.deviation_description || '—',
            dateISO: String(d.deviation_date),
            status: d.status || 'Open',
            createdAt: d._localId || Date.now(),
          })
        })
      } catch (e) {
        console.warn('Could not load pending deviations:', e)
      }

      // ── Deviations — cached synced ───────────────────────────────────────
      try {
        const synced = await DeviationStorage.getAll()
        synced.forEach(d => {
          all.push({
            id: `dev_synced_${d.id}`,
            syncState: 'synced',
            title: d.person_involved_name || 'Unnamed Person',
            subtitle: d.location || d.deviation_description || '—',
            dateISO: String(d.deviation_date),
            status: d.status || 'Open',
            createdAt: new Date(String(d.deviation_date)).getTime() || Date.now(),
          })
        })
      } catch (e) {
        console.warn('Could not load synced deviations:', e)
      }

      all.sort((a, b) => b.createdAt - a.createdAt)
      setRecords(all)
    } catch (error) {
      console.error('Failed to load history:', error)
      onShowToast('error', 'Failed to load deviation history')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'CLOSED':
      case 'RESOLVED':
        return '#22c55e'
      case 'OPEN':
      case 'PENDING':
        return '#f59e0b'
      default:
        return '#8b9ab0'
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    } catch {
      return dateStr
    }
  }

  if (isLoading) {
    return (
      <div style={{
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '16px',
        color: '#8b9ab0'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid rgba(255,255,255,0.16)',
          borderTop: '4px solid #FC4100',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p>Loading history...</p>
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
      <div className="prism-hero" style={{ marginBottom: '14px' }}>
        <div className="prism-hero__eyebrow">PRISM</div>
        <h2 className="prism-hero__title">Deviation History</h2>
        <p className="prism-hero__subtitle">
          {records.length} deviation{records.length === 1 ? '' : 's'}
        </p>
      </div>

      {records.length > 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          {records.map((record) => (
            <div
              key={record.id}
              className="prism-card"
              style={{
                padding: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              {/* status colour bar */}
              <div style={{
                width: '10px',
                height: '52px',
                borderRadius: '6px',
                background: '#ef4444',
                flexShrink: 0
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* row 1 — title + sync badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>⚠️</span>
                  <span style={{
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    color: '#f1f5f9',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {record.title}
                  </span>
                  <span style={{
                    padding: '2px 8px',
                    background: record.syncState === 'local' ? 'rgba(245,158,11,0.14)' : 'rgba(34,197,94,0.14)',
                    color: record.syncState === 'local' ? '#fbbf24' : '#86efac',
                    borderRadius: '6px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    border: '1px solid rgba(255,255,255,0.12)',
                    flexShrink: 0
                  }}>
                    {record.syncState === 'local' ? '⏳ Pending' : '✓ Synced'}
                  </span>
                </div>

                {/* row 2 — subtitle | date */}
                <div style={{
                  fontSize: '0.78rem',
                  color: '#8b9ab0',
                  marginBottom: '3px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {record.subtitle} · {formatDate(record.dateISO)}
                </div>

                {/* row 3 — status */}
                <span style={{
                  fontSize: '0.76rem',
                  color: getStatusColor(record.status),
                  fontWeight: 600
                }}>
                  {record.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="prism-card"
          style={{
            textAlign: 'center',
            padding: '48px 20px',
            color: '#8b9ab0'
          }}
        >
          <h3 style={{
            fontSize: '1rem',
            fontWeight: 600,
            color: '#f1f5f9',
            marginBottom: '8px'
          }}>
            No deviation reports yet
          </h3>
          <p style={{ fontSize: '0.85rem' }}>
            Scan an employee and tap "Report Deviation" to file your first report.
          </p>
          <button
            onClick={() => navigate('/scan')}
            style={{
              marginTop: '16px',
              padding: '10px 20px',
              background: 'linear-gradient(135deg, #FC4100, #d93600)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '0.9rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Open Scan
          </button>
        </div>
      )}
    </div>
  )
}
