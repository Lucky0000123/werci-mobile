// KimperStatus component for mobile KIMPER QR scanning

interface KimperStatusProps {
  kimper: {
    id?: number
    name: string
    id_number?: string
    ktp_sim_number?: string
    company?: string
    department?: string
    date?: string
    kimper_expired_date?: string
    police_license_type?: string
    police_license_category?: string
    police_license_expired_date?: string
    mcu_expire_date?: string
    status?: string
    unit_1?: string
    unit_2?: string
    unit_3?: string
    unit_4?: string
    unit_5?: string
    unit_6?: string
    unit_7?: string
    unit_8?: string
  }
  onClose: () => void
}

export default function KimperStatus({ kimper, onClose }: KimperStatusProps) {
  
  // Calculate days until expiry
  const getDaysInfo = (expiryDate?: string) => {
    if (!expiryDate) return null
    
    try {
      const expiry = new Date(expiryDate)
      const today = new Date()
      const diffTime = expiry.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays < 0) {
        return `Expired ${Math.abs(diffDays)} days ago`
      } else if (diffDays === 0) {
        return 'Expires today'
      } else if (diffDays <= 30) {
        return `Expires in ${diffDays} days`
      } else {
        return `Valid for ${diffDays} days`
      }
    } catch {
      return null
    }
  }

  // Get status color based on expiry
  const getStatusColor = (expiryDate?: string) => {
    if (!expiryDate) return '#6c757d' // gray
    
    try {
      const expiry = new Date(expiryDate)
      const today = new Date()
      const diffTime = expiry.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays < 0) return '#dc3545' // red - expired
      if (diffDays <= 30) return '#ffc107' // yellow - expiring soon
      return '#28a745' // green - active
    } catch {
      return '#6c757d' // gray - unknown
    }
  }

  // Get status text
  const getStatusText = (expiryDate?: string) => {
    if (!expiryDate) return 'UNKNOWN'
    
    try {
      const expiry = new Date(expiryDate)
      const today = new Date()
      const diffTime = expiry.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      
      if (diffDays < 0) return 'EXPIRED'
      if (diffDays <= 30) return 'EXPIRING SOON'
      return 'ACTIVE'
    } catch {
      return 'UNKNOWN'
    }
  }

  const getStatusIcon = (expiryDate?: string) => {
    const status = getStatusText(expiryDate)
    if (status === 'EXPIRED') return '❌'
    if (status === 'EXPIRING SOON') return '⚠️'
    if (status === 'ACTIVE') return '✅'
    return '❓'
  }

  const daysInfo = getDaysInfo(kimper.kimper_expired_date)
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

  // Get authorized units
  const getAuthorizedUnits = () => {
    const units = [
      kimper.unit_1,
      kimper.unit_2,
      kimper.unit_3,
      kimper.unit_4,
      kimper.unit_5,
      kimper.unit_6,
      kimper.unit_7,
      kimper.unit_8
    ].filter(u => u && u.trim())
    
    return units.length > 0 ? units : null
  }

  const authorizedUnits = getAuthorizedUnits()

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
      zIndex: 9999,
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '20px',
        maxWidth: '500px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '25px',
          borderRadius: '20px 20px 0 0',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>👤</div>
          <h2 style={{ margin: '0 0 5px 0', fontSize: '1.5rem' }}>KIMPER Card</h2>
          <p style={{ margin: 0, opacity: 0.9, fontSize: '0.9rem' }}>Company Driving Permit</p>
        </div>

        {/* Content */}
        <div style={{ padding: '25px' }}>
          {/* Name and ID */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.3rem', color: '#333' }}>
              {kimper.name}
            </h3>
            {kimper.id_number && (
              <div style={{
                display: 'inline-block',
                background: '#f8f9fa',
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '0.9rem',
                color: '#6c757d'
              }}>
                ID: {kimper.id_number}
              </div>
            )}
          </div>

          {/* Status Badge - BIGGER */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{
              background: getStatusColor(kimper.kimper_expired_date),
              color: 'white',
              padding: '16px 28px',
              borderRadius: '30px',
              display: 'inline-block',
              fontWeight: 'bold',
              fontSize: '1.3rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}>
              {getStatusIcon(kimper.kimper_expired_date)} {getStatusText(kimper.kimper_expired_date)}
            </div>

            {daysInfo && (
              <div style={{
                marginTop: '8px',
                padding: '6px 12px',
                background: getStatusText(kimper.kimper_expired_date) === 'EXPIRED' ? '#f8d7da' : '#fff3cd',
                color: getStatusText(kimper.kimper_expired_date) === 'EXPIRED' ? '#721c24' : '#856404',
                borderRadius: '15px',
                fontSize: '0.9rem',
                display: 'inline-block'
              }}>
                📅 {daysInfo}
              </div>
            )}
          </div>

          {/* Details Grid */}
          <div style={{
            display: 'grid',
            gap: '15px',
            marginBottom: '20px'
          }}>
            {/* Registration Date */}
            {kimper.date && (
              <div style={{
                background: '#e7f3ff',
                padding: '15px',
                borderRadius: '12px',
                border: '1px solid #b3d9ff'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#0056b3', marginBottom: '5px' }}>
                  📅 Registration Date
                </div>
                <div style={{ fontWeight: '600', color: '#0056b3' }}>
                  {formatDate(kimper.date)}
                </div>
              </div>
            )}

            {/* Company & Department */}
            {(kimper.company || kimper.department) && (
              <div style={{
                background: '#f8f9fa',
                padding: '15px',
                borderRadius: '12px'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#6c757d', marginBottom: '5px' }}>
                  🏢 Organization
                </div>
                <div style={{ fontWeight: '600', color: '#333' }}>
                  {kimper.company || 'N/A'}
                  {kimper.department && ` - ${kimper.department}`}
                </div>
              </div>
            )}

            {/* KIMPER Expiry */}
            {kimper.kimper_expired_date && (
              <div style={{
                background: '#fff3cd',
                padding: '15px',
                borderRadius: '12px',
                border: '1px solid #ffc107'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#856404', marginBottom: '5px' }}>
                  ⏰ KIMPER Expiry Date
                </div>
                <div style={{ fontWeight: '600', color: '#856404' }}>
                  {formatDate(kimper.kimper_expired_date)}
                </div>
              </div>
            )}

            {/* License Info */}
            {(kimper.police_license_type || kimper.police_license_category) && (
              <div style={{
                background: '#f8f9fa',
                padding: '15px',
                borderRadius: '12px'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#6c757d', marginBottom: '5px' }}>
                  🪪 License Information
                </div>
                <div style={{ fontWeight: '600', color: '#333' }}>
                  {kimper.police_license_type && `Type: ${kimper.police_license_type}`}
                  {kimper.police_license_category && ` | Category: ${kimper.police_license_category}`}
                </div>
                {kimper.police_license_expired_date && (
                  <div style={{ fontSize: '0.85rem', color: '#6c757d', marginTop: '5px' }}>
                    Expires: {formatDate(kimper.police_license_expired_date)}
                  </div>
                )}
              </div>
            )}

            {/* MCU Expiry */}
            {kimper.mcu_expire_date && (
              <div style={{
                background: '#f8f9fa',
                padding: '15px',
                borderRadius: '12px'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#6c757d', marginBottom: '5px' }}>
                  🏥 Medical Check-Up Expiry
                </div>
                <div style={{ fontWeight: '600', color: '#333' }}>
                  {formatDate(kimper.mcu_expire_date)}
                </div>
              </div>
            )}

            {/* Authorized Units */}
            {authorizedUnits && (
              <div style={{
                background: '#e7f3ff',
                padding: '15px',
                borderRadius: '12px',
                border: '1px solid #b3d9ff'
              }}>
                <div style={{ fontSize: '0.85rem', color: '#0056b3', marginBottom: '8px', fontWeight: '600' }}>
                  🚜 Authorized Equipment
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {authorizedUnits.map((unit, idx) => (
                    <span key={idx} style={{
                      background: 'white',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      color: '#0056b3',
                      border: '1px solid #b3d9ff'
                    }}>
                      {unit}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            style={{
              width: '100%',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '15px',
              fontSize: '1.1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#5a6268'}
            onMouseOut={(e) => e.currentTarget.style.background = '#6c757d'}
          >
            ✖️ Close
          </button>

          {/* Info Notice */}
          <div style={{
            marginTop: '20px',
            padding: '15px',
            background: '#e9ecef',
            borderRadius: '10px',
            fontSize: '0.85rem',
            color: '#6c757d',
            textAlign: 'center'
          }}>
            📱 This is the mobile KIMPER card view. Ensure all permits are valid before operating equipment.
          </div>
        </div>
      </div>
    </div>
  )
}

