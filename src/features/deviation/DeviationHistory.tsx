/**
 * Deviation History Component
 * Displays deviation history for a KIMPER holder
 */

import { useState, useEffect } from 'react'
import { t } from '../../services/i18n'
import DeviationApiService from '../../services/deviationApi'
import type { DeviationListItem } from '../../types/deviation'
import './DeviationHistory.css'

interface DeviationHistoryProps {
  kimperId: number
}

export default function DeviationHistory({ kimperId }: DeviationHistoryProps) {
  const [deviations, setDeviations] = useState<DeviationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    loadDeviations()
  }, [kimperId])
  
  const loadDeviations = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await DeviationApiService.getDeviationsByKimper(kimperId)
      setDeviations(data)
    } catch (err) {
      console.error('Error loading deviations:', err)
      setError('Unable to load deviation history')
    } finally {
      setLoading(false)
    }
  }
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Closed': return '#4CAF50'
      case 'Open': return '#F44336'
      case 'In Progress': return '#FF9800'
      default: return '#9E9E9E'
    }
  }
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }
  
  if (loading) {
    return (
      <div className="deviation-history">
        <h5><i className="fas fa-exclamation-triangle"></i> {t('deviationHistory')}</h5>
        <div className="text-center text-muted">
          <i className="fas fa-spinner fa-spin"></i> {t('loading')}
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="deviation-history">
        <h5><i className="fas fa-exclamation-triangle"></i> {t('deviationHistory')}</h5>
        <div className="text-center text-muted">
          <i className="fas fa-wifi-slash"></i> {error}
        </div>
      </div>
    )
  }
  
  if (deviations.length === 0) {
    return (
      <div className="deviation-history">
        <h5><i className="fas fa-exclamation-triangle"></i> {t('deviationHistory')}</h5>
        <div className="clean-record">
          <i className="fas fa-check-circle"></i>
          <div className="clean-record-text">
            <strong>{t('noDeviations')}</strong>
            <small>{t('cleanRecord')}</small>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="deviation-history">
      <h5><i className="fas fa-exclamation-triangle"></i> {t('deviationHistory')}</h5>
      
      <div className="deviation-list">
        {deviations.map((deviation) => (
          <div key={deviation.id} className="deviation-item" style={{ borderLeftColor: getStatusColor(deviation.status) }}>
            <div className="deviation-header">
              <strong>{formatDate(deviation.deviation_date)}</strong>
              <span className="status-badge" style={{ backgroundColor: getStatusColor(deviation.status) }}>
                {deviation.status}
              </span>
            </div>
            
            <div className="deviation-location">
              <i className="fas fa-map-marker-alt"></i> {deviation.location}
            </div>
            
            {deviation.golden_rules_number && (
              <div className="deviation-golden-rule">
                <i className="fas fa-exclamation-circle"></i> {t('goldenRule')} #{deviation.golden_rules_number}
              </div>
            )}
            
            <div className="deviation-description">
              {deviation.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

