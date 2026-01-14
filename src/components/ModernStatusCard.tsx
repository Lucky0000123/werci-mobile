// React import not needed for JSX in modern React
import './ModernStatusCard.css'

interface StatusCardProps {
  title: string
  status: 'PASS' | 'EXPIRED' | 'RE-COMMISSION SOON' | 'ACTIVE' | 'EXPIRING_SOON' | 'UNKNOWN'
  daysRemaining?: number
  subtitle?: string
  icon?: string
  onClick?: () => void
  isLoading?: boolean
}

export default function ModernStatusCard({ 
  title, 
  status, 
  daysRemaining, 
  subtitle, 
  icon = '🚛', 
  onClick,
  isLoading = false 
}: StatusCardProps) {
  
  const getStatusConfig = () => {
    switch (status) {
      case 'PASS':
      case 'ACTIVE':
        return {
          color: '#10B981', // Green
          bgColor: '#ECFDF5',
          textColor: '#065F46',
          icon: '✅',
          label: status === 'PASS' ? 'PASS' : 'ACTIVE'
        }
      case 'RE-COMMISSION SOON':
      case 'EXPIRING_SOON':
        return {
          color: '#F59E0B', // Amber
          bgColor: '#FFFBEB',
          textColor: '#92400E',
          icon: '⚠️',
          label: status === 'RE-COMMISSION SOON' ? 'RE-COMMISSION SOON' : 'EXPIRING SOON'
        }
      case 'EXPIRED':
        return {
          color: '#EF4444', // Red
          bgColor: '#FEF2F2',
          textColor: '#991B1B',
          icon: '❌',
          label: 'EXPIRED'
        }
      default:
        return {
          color: '#6B7280', // Gray
          bgColor: '#F9FAFB',
          textColor: '#374151',
          icon: '❓',
          label: 'UNKNOWN'
        }
    }
  }

  const statusConfig = getStatusConfig()

  const getDaysMessage = () => {
    if (daysRemaining === undefined || daysRemaining === null) return null
    
    if (daysRemaining < 0) {
      return `${Math.abs(daysRemaining)} days overdue`
    } else if (daysRemaining === 0) {
      return 'Expires today'
    } else if (daysRemaining === 1) {
      return '1 day remaining'
    } else {
      return `${daysRemaining} days remaining`
    }
  }

  return (
    <div 
      className={`modern-status-card ${onClick ? 'clickable' : ''} ${isLoading ? 'loading' : ''}`}
      onClick={onClick}
      style={{
        borderLeftColor: statusConfig.color,
        backgroundColor: statusConfig.bgColor
      }}
    >
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
        </div>
      )}
      
      <div className="card-header">
        <div className="card-icon">{icon}</div>
        <div className="card-title-section">
          <h3 className="card-title">{title}</h3>
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="status-section">
        <div 
          className="status-badge"
          style={{
            backgroundColor: statusConfig.color,
            color: 'white'
          }}
        >
          <span className="status-icon">{statusConfig.icon}</span>
          <span className="status-text">{statusConfig.label}</span>
        </div>

        {getDaysMessage() && (
          <div 
            className="days-indicator"
            style={{ color: statusConfig.textColor }}
          >
            <span className="days-icon">📅</span>
            <span className="days-text">{getDaysMessage()}</span>
          </div>
        )}
      </div>

      {onClick && (
        <div className="card-action-hint">
          <span>Tap for details</span>
          <span className="arrow">→</span>
        </div>
      )}
    </div>
  )
}
