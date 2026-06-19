import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { connectionManager, type ConnectionStatus } from '../services/connectionManager'
import { syncService, type SyncStatus } from '../services/sync'
import { useI18n, type Language } from '../services/i18n-context'
import prismLogo from '../assets/Logo1_splash.png'
import type { AuthenticatedUser } from '../services/auth'

interface AppHeaderProps {
  currentUser: AuthenticatedUser
  onLogout: () => void
}

export default function AppHeader({ currentUser, onLogout }: AppHeaderProps) {
  const navigate = useNavigate()
  const { language, setLanguage, t } = useI18n()
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    isOnline: false,
    currentMode: 'offline',
    cloudAvailable: false,
    localAvailable: false,
    lastChecked: 0
  })
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: false,
    isSyncing: false,
    lastSync: null,
    pendingItems: 0,
    failedItems: 0
  })
  const [showLangMenu, setShowLangMenu] = useState(false)

  useEffect(() => {
    connectionManager.addStatusListener((status) => {
      setConnectionStatus(status)
    })

    syncService.onStatusChange((status) => {
      setSyncStatus(status)
    })
  }, [])

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang)
    setShowLangMenu(false)
  }

  const getConnectionIcon = () => {
    if (!connectionStatus.isOnline) return '📴'
    if (connectionStatus.currentMode === 'local') return '🏢'
    return '☁️'
  }

  const getConnectionColor = () => {
    if (!connectionStatus.isOnline) return '#EF4444'
    if (connectionStatus.currentMode === 'local') return '#10B981'
    return '#3B82F6'
  }

  return (
    <header className="app-header" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 1030,
      background: 'rgba(5,10,18,0.88)',
      backdropFilter: 'blur(10px)',
      borderBottom: '1px solid rgba(255,255,255,0.09)',
      padding: '12px 16px',
      paddingTop: 'max(12px, env(safe-area-inset-top))',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        maxWidth: '600px',
        margin: '0 auto'
      }}>
        {/* Logo & Title */}
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer'
          }}
          onClick={() => navigate('/home')}
        >
          {/* PRISM Logo — Logo1_splash.png is the unified logo */}
          <img
            src={prismLogo}
            alt="PRISM"
            style={{
              width: '148px',
              height: '42px',
              objectFit: 'contain',
              filter: 'drop-shadow(0 4px 12px rgba(252, 65, 0, 0.28))'
            }}
          />
        </div>

        {/* Right Side Controls */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            color: '#e2e8f0'
          }}>
            <div style={{ lineHeight: 1.1 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700 }}>
                {currentUser.role === 'dispatch' ? 'FMS Dispatch' : (currentUser.fullName || currentUser.username)}
              </div>
              {currentUser.role !== 'dispatch' && (
                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {currentUser.role}
                </div>
              )}
            </div>
            <button
              onClick={onLogout}
              style={{
                padding: '6px 8px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(239,68,68,0.12)',
                color: '#fecaca',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 700
              }}
            >
              Logout
            </button>
          </div>

          {/* Language Switcher */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              style={{
                padding: '6px 10px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {language === 'id' ? '🇮🇩' : language === 'zh' ? '🇨🇳' : '🇬🇧'}
              <span>{language.toUpperCase()}</span>
              <span style={{ fontSize: '0.6rem' }}>▼</span>
            </button>

            {/* Language Dropdown */}
            {showLangMenu && (
              <>
                <div
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 1031
                  }}
                  onClick={() => setShowLangMenu(false)}
                />
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  background: '#0d1520',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '12px',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                  overflow: 'hidden',
                  zIndex: 1032,
                  minWidth: '155px'
                }}>
                  {[
                    { lang: 'id' as const, flag: '🇮🇩', label: 'Bahasa Indonesia' },
                    { lang: 'en' as const, flag: '🇬🇧', label: 'English' },
                    { lang: 'zh' as const, flag: '🇨🇳', label: '中文 (Chinese)' }
                  ].map(({ lang, flag, label }) => (
                    <button
                      key={lang}
                      onClick={() => handleLanguageChange(lang)}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        background: language === lang ? 'rgba(252,65,0,0.18)' : 'transparent',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        textAlign: 'left',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: language === lang ? '#FC4100' : '#c5cfe0'
                      }}
                    >
                      {flag} {label}
                      {language === lang && <span style={{ marginLeft: 'auto', color: '#FC4100' }}>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Sync Status */}
          {syncStatus.isSyncing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              fontSize: '0.75rem',
              color: 'white'
            }}>
              <span className="animate-spin">🔄</span>
              <span>{t('syncing')}</span>
            </div>
          )}

          {/* Connection Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '6px 10px',
            background: getConnectionColor(),
            borderRadius: '16px',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'white',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
          }}>
            <span>{getConnectionIcon()}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
