// KimperStatus component for mobile KIMPER QR scanning
import DeviationHistory from '../features/deviation/DeviationHistory'

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
    card_type_code?: string
    photo?: string  // base64 encoded photo
    // All 20 units
    unit_1?: string
    unit_2?: string
    unit_3?: string
    unit_4?: string
    unit_5?: string
    unit_6?: string
    unit_7?: string
    unit_8?: string
    unit_9?: string
    unit_10?: string
    unit_11?: string
    unit_12?: string
    unit_13?: string
    unit_14?: string
    unit_15?: string
    unit_16?: string
    unit_17?: string
    unit_18?: string
    unit_19?: string
    unit_20?: string
    // All 20 unit codes (F, T, L, RA)
    unit_1_code?: string
    unit_2_code?: string
    unit_3_code?: string
    unit_4_code?: string
    unit_5_code?: string
    unit_6_code?: string
    unit_7_code?: string
    unit_8_code?: string
    unit_9_code?: string
    unit_10_code?: string
    unit_11_code?: string
    unit_12_code?: string
    unit_13_code?: string
    unit_14_code?: string
    unit_15_code?: string
    unit_16_code?: string
    unit_17_code?: string
    unit_18_code?: string
    unit_19_code?: string
    unit_20_code?: string
  }
  onClose: () => void
  onReportDeviation?: () => void
}

export default function KimperStatus({ kimper, onClose, onReportDeviation }: KimperStatusProps) {
  
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

  // Group units by access level code (F, T, L, RA)
  // Colors match web app exactly: T=Red, L=Yellowish-green, RA=Blue, F=Green
  const getUnitGroups = () => {
    const groups: {
      [key: string]: {
        name: string
        icon: string
        color: string
        gradient: string
        headerColor: string
        units: string[]
      }
    } = {
      'F': {
        name: 'Full Access Units',
        icon: '✅',
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        headerColor: '#065f46',
        units: []
      },
      'T': {
        name: 'Temporary Access Units',
        icon: '⏰',
        color: '#ef4444',
        gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
        headerColor: '#991b1b',
        units: []
      },
      'L': {
        name: 'Learning Units',
        icon: '🎓',
        color: '#84cc16',
        gradient: 'linear-gradient(135deg, #84cc16 0%, #65a30d 100%)',
        headerColor: '#3f6212',
        units: []
      },
      'RA': {
        name: 'Restricted Area Units',
        icon: '⚠️',
        color: '#3b82f6',
        gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        headerColor: '#1e3a8a',
        units: []
      }
    }

    // Collect all 20 units with their codes
    for (let i = 1; i <= 20; i++) {
      const unit = kimper[`unit_${i}` as keyof typeof kimper] as string | undefined
      const code = kimper[`unit_${i}_code` as keyof typeof kimper] as string | undefined

      if (unit && unit.trim() && code && groups[code]) {
        groups[code].units.push(unit.trim())
      }
    }

    return groups
  }

  const unitGroups = getUnitGroups()
  const totalUnits = Object.values(unitGroups).reduce((sum, group) => sum + group.units.length, 0)

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
        {/* Header with Photo */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '25px',
          borderRadius: '20px 20px 0 0',
          textAlign: 'center'
        }}>
          {/* Employee Photo */}
          {kimper.photo ? (
            <img
              src={`data:image/jpeg;base64,${kimper.photo}`}
              alt={kimper.name}
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '4px solid white',
                marginBottom: '15px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
            />
          ) : (
            <div style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              marginBottom: '15px',
              border: '4px solid white'
            }}>
              👤
            </div>
          )}
          <h2 style={{ margin: '0 0 5px 0', fontSize: '1.5rem' }}>{kimper.name}</h2>
          <p style={{ margin: 0, opacity: 0.9, fontSize: '0.9rem' }}>
            {kimper.id_number ? `ID: ${kimper.id_number}` : 'Company Driving Permit'}
          </p>
          {kimper.card_type_code && (
            <div style={{
              display: 'inline-block',
              background: 'rgba(255,255,255,0.3)',
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '0.85rem',
              marginTop: '10px',
              fontWeight: 'bold'
            }}>
              {kimper.card_type_code === 'T' && '⏰ Temporary'}
              {kimper.card_type_code === 'L' && '🎓 Learning'}
              {kimper.card_type_code === 'RA' && '⚠️ Restricted Area'}
              {kimper.card_type_code === 'F' && '✅ Full Access'}
            </div>
          )}
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

          {/* Employee Information Section - Matching Web App Layout */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}>
            <h5 style={{
              marginBottom: '15px',
              fontWeight: 'bold',
              color: '#333',
              fontSize: '1rem'
            }}>
              ℹ️ Employee Information
            </h5>

            {/* Department */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 0',
              borderBottom: '1px solid #f0f0f0'
            }}>
              <div style={{ fontWeight: '600', color: '#495057', fontSize: '0.9rem' }}>
                Department
              </div>
              <div style={{ color: '#212529', fontSize: '0.9rem', textAlign: 'right' }}>
                {kimper.department || '-'}
              </div>
            </div>

            {/* Company */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 0',
              borderBottom: '1px solid #f0f0f0'
            }}>
              <div style={{ fontWeight: '600', color: '#495057', fontSize: '0.9rem' }}>
                Company
              </div>
              <div style={{ color: '#212529', fontSize: '0.9rem', textAlign: 'right' }}>
                {kimper.company || '-'}
              </div>
            </div>

            {/* KIMPER Expiry */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 0',
              borderBottom: '1px solid #f0f0f0'
            }}>
              <div style={{ fontWeight: '600', color: '#495057', fontSize: '0.9rem' }}>
                KIMPER Expiry
              </div>
              <div style={{ color: '#212529', fontSize: '0.9rem', textAlign: 'right' }}>
                {kimper.kimper_expired_date ? formatDate(kimper.kimper_expired_date) : '-'}
              </div>
            </div>

            {/* Police License */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 0'
            }}>
              <div style={{ fontWeight: '600', color: '#495057', fontSize: '0.9rem' }}>
                Police License
              </div>
              <div style={{ color: '#212529', fontSize: '0.9rem', textAlign: 'right' }}>
                {kimper.police_license_type || '-'}
              </div>
            </div>
          </div>

            {/* Authorized Equipment - Grouped by Access Level */}
            <div style={{
              background: '#f8f9fa',
              padding: '15px',
              borderRadius: '12px',
              marginBottom: '15px'
            }}>
              <div style={{
                fontSize: '0.95rem',
                color: '#333',
                marginBottom: '12px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                🚜 Authorized Equipment
                <span style={{
                  background: '#6c757d',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '0.75rem',
                  fontWeight: 'bold'
                }}>
                  {totalUnits}
                </span>
              </div>

              {totalUnits > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Display groups in order: F, T, L, RA */}
                  {['F', 'T', 'L', 'RA'].map(code => {
                    const group = unitGroups[code]
                    if (group.units.length === 0) return null

                    return (
                      <div key={code} style={{
                        background: 'white',
                        padding: '12px',
                        borderRadius: '10px',
                        borderLeft: `4px solid ${group.color}`
                      }}>
                        <div style={{
                          fontSize: '0.85rem',
                          color: group.headerColor,
                          marginBottom: '8px',
                          fontWeight: '600',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <span>{group.icon}</span>
                          <span>{group.name} ({code})</span>
                          <span style={{
                            background: group.color,
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '8px',
                            fontSize: '0.7rem',
                            marginLeft: 'auto'
                          }}>
                            {group.units.length}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {group.units.map((unit, idx) => (
                            <span key={idx} style={{
                              background: group.gradient,
                              color: 'white',
                              padding: '5px 10px',
                              borderRadius: '8px',
                              fontSize: '0.75rem',
                              fontWeight: '600',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}>
                              {unit}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{
                  textAlign: 'center',
                  padding: '20px',
                  color: '#6c757d',
                  fontSize: '0.9rem'
                }}>
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>ℹ️</div>
                  No authorized equipment assigned
                </div>
              )}
            </div>
          </div>

          {/* Deviation History Section */}
          {kimper.id && <DeviationHistory kimperId={kimper.id} />}

          {/* Report Deviation Button */}
          {onReportDeviation && (
            <button
              onClick={onReportDeviation}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #F44336, #E91E63)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '15px',
                fontSize: '1.1rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                marginBottom: '10px',
                boxShadow: '0 4px 12px rgba(244, 67, 54, 0.3)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, #E53935, #D81B60)'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(244, 67, 54, 0.4)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, #F44336, #E91E63)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(244, 67, 54, 0.3)'
              }}
            >
              🚩 Report Deviation
            </button>
          )}

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
  )
}

