// CommissioningStatus component for mobile QR scanning

interface CommissioningStatusProps {
  vehicle: {
    equip_no: string
    description?: string
    company?: string
    commissioning_status?: string
    commissioning_date?: string
    expired_date?: string
    manufacturer?: string
    unit_model?: string
    location?: string
  }
  onStartInspection: () => void
  onUpdatePhoto: () => void
  onClose: () => void
}

export default function CommissioningStatus({ vehicle, onStartInspection, onUpdatePhoto, onClose }: CommissioningStatusProps) {
  const getStatusColor = (status?: string) => {
    switch (status?.toUpperCase()) {
      case 'PASS': return '#28a745'
      case 'EXPIRED': return '#dc3545'
      case 'EXPIRING': return '#ffc107'
      default: return '#6c757d'
    }
  }

  const getStatusIcon = (status?: string) => {
    switch (status?.toUpperCase()) {
      case 'PASS': return '✅'
      case 'EXPIRED': return '❌'
      case 'RE-COMMISSION SOON': return '⚠️'
      case 'EXPIRING': return '⚠️'
      default: return '❓'
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A'
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

  const getDaysRemaining = (expiredDate?: string) => {
    if (!expiredDate) return null
    
    try {
      const expiry = new Date(expiredDate)
      const today = new Date()
      const diffTime = expiry.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays < 0) {
        return `${Math.abs(diffDays)} days overdue`
      } else if (diffDays === 0) {
        return 'Expires today'
      } else {
        return `${diffDays} days remaining`
      }
    } catch {
      return null
    }
  }

  const daysInfo = getDaysRemaining(vehicle.expired_date)

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        padding: '25px',
        maxWidth: '400px',
        width: '100%',
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '20px',
          paddingBottom: '15px',
          borderBottom: '2px solid #f0f0f0'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            padding: '10px 20px',
            borderRadius: '25px',
            display: 'inline-block',
            fontWeight: 'bold',
            fontSize: '1.1rem',
            marginBottom: '10px'
          }}>
            🚛 {vehicle.equip_no}
          </div>
          <h4 style={{ margin: '0', color: '#333' }}>
            {vehicle.description || 'Fleet Vehicle'}
          </h4>
        </div>

        {/* Status Badge - BIGGER */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            background: getStatusColor(vehicle.commissioning_status),
            color: 'white',
            padding: '16px 28px',
            borderRadius: '30px',
            display: 'inline-block',
            fontWeight: 'bold',
            fontSize: '1.3rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            {getStatusIcon(vehicle.commissioning_status)} {vehicle.commissioning_status || 'UNKNOWN'}
          </div>

          {daysInfo && (
            <div style={{
              marginTop: '8px',
              padding: '6px 12px',
              background: vehicle.commissioning_status === 'EXPIRED' ? '#f8d7da' : '#fff3cd',
              color: vehicle.commissioning_status === 'EXPIRED' ? '#721c24' : '#856404',
              borderRadius: '15px',
              fontSize: '0.9rem',
              display: 'inline-block'
            }}>
              📅 {daysInfo}
            </div>
          )}
        </div>

        {/* Vehicle Details */}
        <div style={{ marginBottom: '25px' }}>
          {vehicle.commissioning_date && (
            <div style={{
              background: '#e7f3ff',
              padding: '10px 15px',
              borderRadius: '10px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              border: '1px solid #b3d9ff'
            }}>
              <span style={{ fontWeight: 'bold', color: '#0056b3' }}>📅 Commissioning Date:</span>
              <span style={{ color: '#0056b3' }}>{formatDate(vehicle.commissioning_date)}</span>
            </div>
          )}

          {vehicle.expired_date && (
            <div style={{
              background: '#fff3cd',
              padding: '10px 15px',
              borderRadius: '10px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              border: '1px solid #ffc107'
            }}>
              <span style={{ fontWeight: 'bold', color: '#856404' }}>⏰ Expiry Date:</span>
              <span style={{ color: '#856404' }}>{formatDate(vehicle.expired_date)}</span>
            </div>
          )}

          {vehicle.company && (
            <div style={{
              background: '#f8f9fa',
              padding: '10px 15px',
              borderRadius: '10px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontWeight: 'bold', color: '#6c757d' }}>Company:</span>
              <span>{vehicle.company}</span>
            </div>
          )}

          {vehicle.manufacturer && (
            <div style={{
              background: '#f8f9fa',
              padding: '10px 15px',
              borderRadius: '10px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontWeight: 'bold', color: '#6c757d' }}>Manufacturer:</span>
              <span>{vehicle.manufacturer}</span>
            </div>
          )}

          {vehicle.unit_model && (
            <div style={{
              background: '#f8f9fa',
              padding: '10px 15px',
              borderRadius: '10px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontWeight: 'bold', color: '#6c757d' }}>Model:</span>
              <span>{vehicle.unit_model}</span>
            </div>
          )}

          {vehicle.location && (
            <div style={{
              background: '#f8f9fa',
              padding: '10px 15px',
              borderRadius: '10px',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontWeight: 'bold', color: '#6c757d' }}>Location:</span>
              <span>{vehicle.location}</span>
            </div>
          )}
        </div>

        {/* Action Buttons - Stacked Layout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Make Inspection Button */}
          <button
            onClick={onStartInspection}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '15px',
              padding: '18px 20px',
              fontSize: '1.05rem',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(59, 130, 246, 0.4)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
          >
            <span style={{ fontSize: '1.3rem' }}>📋</span>
            <span>Make Inspection</span>
          </button>

          {/* Update Vehicle Picture Button */}
          <button
            onClick={onUpdatePhoto}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '15px',
              padding: '18px 20px',
              fontSize: '1.05rem',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(236, 72, 153, 0.4)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}
          >
            <span style={{ fontSize: '1.3rem' }}>📸</span>
            <span>Update Vehicle Picture</span>
          </button>

          {/* Close Button */}
          <button
            onClick={onClose}
            style={{
              width: '100%',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '15px',
              padding: '15px 20px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(108, 117, 125, 0.3)',
              transition: 'all 0.3s ease'
            }}
          >
            ❌ Close
          </button>
        </div>

        {/* Info Notice */}
        <div style={{
          marginTop: '20px',
          padding: '15px',
          background: 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)',
          borderRadius: '12px',
          fontSize: '0.85rem',
          color: '#1e40af',
          textAlign: 'center',
          border: '1px solid #bfdbfe'
        }}>
          💡 Choose an action above to proceed with this vehicle
        </div>
      </div>
    </div>
  )
}
