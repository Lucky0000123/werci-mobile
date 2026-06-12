import { useEffect, useState } from 'react'
import DeviationApiService from '../../services/deviationApi'
import type { PersonLookupParams } from '../../services/offlineDataSync'
import type { DeviationListItem } from '../../types/deviation'

interface PersonDeviationHistoryProps {
  lookup: PersonLookupParams
}

const textPrimary = '#111827'
const textMuted = '#6b7280'

export default function PersonDeviationHistory({ lookup }: PersonDeviationHistoryProps) {
  const [deviations, setDeviations] = useState<DeviationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadDeviations = async () => {
      if (!lookup.personKey && !lookup.employeeId && lookup.kimperId == null && !lookup.ktpNumber) {
        setLoading(false)
        setDeviations([])
        return
      }

      try {
        setLoading(true)
        setError(null)
        const data = await DeviationApiService.getDeviationsByPerson(lookup)
        if (!cancelled) setDeviations(data)
      } catch (err) {
        console.error('Error loading person deviations:', err)
        if (!cancelled) setError('Unable to load deviation history')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDeviations()
    return () => {
      cancelled = true
    }
  }, [lookup.personKey, lookup.employeeId, lookup.kimperId, lookup.ktpNumber])

  const getStatusColor = (status: string) => {
    if (status === 'Closed') return '#22c55e'
    if (status === 'In Progress') return '#f59e0b'
    if (status === 'Open') return '#ef4444'
    return textMuted
  }

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  if (loading) {
    return <div style={{ color: textMuted, fontSize: '0.84rem' }}>Loading deviation history…</div>
  }

  if (error) {
    return <div style={{ color: textMuted, fontSize: '0.84rem' }}>{error}</div>
  }

  if (deviations.length === 0) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    return (
      <div style={{ color: textMuted, fontSize: '0.84rem' }}>
        {offline
          ? '📡 Deviation history is not available offline. Connect to the internet to sync.'
          : 'No recorded personnel deviations for this person.'}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {deviations.map((deviation) => (
        <div key={deviation.id} style={{
          borderLeft: `3px solid ${getStatusColor(deviation.status)}`,
          background: '#f8fafc',
          border: '1px solid #e5e7eb',
          borderRadius: '16px',
          padding: '12px 14px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
            <strong style={{ color: textPrimary, fontSize: '0.86rem' }}>{formatDate(deviation.deviation_date)}</strong>
            <span style={{ color: getStatusColor(deviation.status), fontSize: '0.76rem', fontWeight: 700 }}>{deviation.status}</span>
          </div>
          <div style={{ color: textPrimary, fontSize: '0.84rem', marginBottom: '6px' }}>{deviation.location}</div>
          <div style={{ color: textMuted, fontSize: '0.8rem', lineHeight: 1.5 }}>{deviation.description || 'No description provided.'}</div>
          {deviation.golden_rules_number && (
            <div style={{ marginTop: '8px', color: '#d97706', fontSize: '0.76rem', fontWeight: 600 }}>
              Golden Rule #{deviation.golden_rules_number}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}