import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { offlineDataSync, type KimperMapping, type EmployeeFullInfo } from '../services/offlineDataSync'

/**
 * Employee lookup, embedded on the dashboard (moved here from the old
 * Employee Card page). Searches the offline people roster and opens the
 * detail / KIMPER card pages.
 */
export default function EmployeeSearch() {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KimperMapping[]>([])
  const [employeeResults, setEmployeeResults] = useState<EmployeeFullInfo[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setEmployeeResults([])
      setHasSearched(false)
      return
    }

    setIsSearching(true)
    setSearchError(null)
    try {
      const { kimperResults, employeeResults } =
        await offlineDataSync.searchPeopleForEmployeeLookup(searchQuery)
      setSearchResults(kimperResults)
      setEmployeeResults(employeeResults)
      setHasSearched(true)
    } catch (error) {
      console.error('Search error:', error)
      setSearchError('Failed to search employees — try syncing data first.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleViewEmployeeDetail = async (employee: EmployeeFullInfo) => {
    const cardData = await offlineDataSync.fetchEmployeeCardData(
      employee.employee_id,
      employee.qr_code_token || ''
    )

    if (cardData?.success) {
      navigate('/employee-detail', { state: { cardData } })
      return
    }

    navigate('/employee-detail', { state: { employee } })
  }

  const handleSelectKimper = (selectedKimper: KimperMapping) => {
    navigate('/employee-card', { state: { kimper: selectedKimper, type: 'employee' } })
  }

  return (
    <div style={{ marginBottom: '14px' }}>
      {/* Search Box */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search employee by name, ID, or company..."
          style={{
            flex: 1,
            padding: '12px 14px',
            fontSize: '0.95rem',
            color: '#f1f5f9',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            outline: 'none'
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={isSearching}
          aria-label="Search"
          style={{
            padding: '12px 18px',
            background: 'linear-gradient(135deg, #FC4100, #C9340A)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: isSearching ? 'progress' : 'pointer',
            boxShadow: '0 6px 16px rgba(252,65,0,0.28)'
          }}
        >
          {isSearching ? '…' : '🔍'}
        </button>
      </div>

      {searchError && (
        <div style={{
          padding: '10px 14px', marginBottom: '12px', borderRadius: '12px',
          border: '1px solid rgba(239,68,68,0.24)', background: 'rgba(239,68,68,0.12)',
          color: '#fecaca', fontSize: '0.82rem'
        }}>
          {searchError}
        </div>
      )}

      {/* Search Results */}
      {searchResults.length > 0 || employeeResults.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {searchResults.length > 0 && (
            <p style={{ fontSize: '0.85rem', color: '#8b9ab0', margin: 0 }}>
              Found {searchResults.length} employee(s)
            </p>
          )}

          {searchResults.map((employee, index) => (
            <button
              key={index}
              onClick={() => handleSelectKimper(employee)}
              className="prism-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '14px',
                cursor: 'pointer',
                textAlign: 'left',
                color: '#f1f5f9',
                width: '100%'
              }}
            >
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #FC4100 0%, #C9340A 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                flexShrink: 0
              }}>
                {(employee as any).photo ? (
                  <img
                    src={`data:image/jpeg;base64,${(employee as any).photo}`}
                    alt={employee.name}
                    style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  '👤'
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: '2px' }}>
                  {employee.name}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#8b9ab0' }}>
                  ID: {employee.id_number || 'N/A'} • {employee.company || 'No Company'}
                </div>
                {employee.department && (
                  <div style={{ fontSize: '0.78rem', color: '#FC4100', marginTop: '4px', fontWeight: 600 }}>
                    {employee.department}
                  </div>
                )}
              </div>

              <span style={{ fontSize: '1.15rem', color: '#8b9ab0' }}>→</span>
            </button>
          ))}

          {employeeResults.length > 0 && (
            <>
              <div className="prism-card" style={{
                marginTop: '4px',
                padding: '12px 14px',
                borderLeft: '3px solid #FC4100'
              }}>
                <p style={{ fontSize: '0.9rem', color: '#FC4100', fontWeight: 700, margin: 0, letterSpacing: '0.02em' }}>
                  📋 {employeeResults.length} Employee Record(s) Found
                </p>
                <p style={{ fontSize: '0.75rem', color: '#8b9ab0', margin: '4px 0 0 0' }}>
                  Click "View Details" to see full employee information
                </p>
              </div>

              {employeeResults.map((employee, index) => (
                <div
                  key={`emp-${index}`}
                  className="prism-card"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px',
                    color: '#f1f5f9'
                  }}
                >
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                    flexShrink: 0
                  }}>
                    {employee.photo_url ? (
                      <img
                        src={employee.photo_url}
                        alt={employee.name}
                        style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      '👤'
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: '2px' }}>
                      {employee.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#8b9ab0' }}>
                      ID: {employee.employee_id} • {employee.position || 'Employee'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#34d399', marginTop: '2px', fontWeight: 600 }}>
                      {employee.department} • {employee.company}
                    </div>
                  </div>

                  <button
                    onClick={() => handleViewEmployeeDetail(employee)}
                    style={{
                      padding: '10px 14px',
                      background: 'linear-gradient(135deg, #FC4100, #C9340A)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 6px 16px rgba(252,65,0,0.3)',
                      flexShrink: 0
                    }}
                  >
                    View Details →
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      ) : hasSearched && searchQuery ? (
        <div className="prism-card" style={{ textAlign: 'center', padding: '24px 20px', color: '#8b9ab0' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔍</div>
          <p style={{ color: '#f1f5f9', margin: 0, fontWeight: 600 }}>
            No employees found matching "{searchQuery}"
          </p>
          <p style={{ fontSize: '0.82rem', marginTop: '6px' }}>
            Try syncing data or use a different search term
          </p>
        </div>
      ) : null}
    </div>
  )
}
