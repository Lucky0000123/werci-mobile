import { useState, useEffect } from 'react'
import { offlineDataSync, type OfflineSyncStatus } from '../services/offlineDataSync'
import { syncService, type SyncStatus as UploadSyncStatus } from '../services/sync'
import { clearAllData } from '../services/db'
import { useI18n } from '../services/i18n-context'
import { connectionManager } from '../services/connectionManager'
import {
  checkBiometricAvailability,
  isBiometricEnabled,
  setBiometricEnabled,
  type BiometricAvailability,
} from '../services/biometricAuth'
import { APP_VERSION } from '../version'

export default function SettingsPage() {
  const { t } = useI18n()
  const [syncStatus, setSyncStatus] = useState<OfflineSyncStatus | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [showConfirmClear, setShowConfirmClear] = useState(false)

  const [biometricAvail, setBiometricAvail] = useState<BiometricAvailability | null>(null)
  const [biometricOn, setBiometricOn] = useState(isBiometricEnabled())
  const [uploadStatus, setUploadStatus] = useState<UploadSyncStatus | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    loadSyncStatus()
    checkBiometricAvailability().then(setBiometricAvail).catch(() => setBiometricAvail(null))
    const unsubscribe = syncService.onStatusChange(setUploadStatus)
    return unsubscribe
  }, [])

  const handleRetryFailed = async () => {
    setIsRetrying(true)
    try {
      await syncService.retryFailedItems()
    } catch (error) {
      console.error('Retry of failed uploads failed:', error)
    } finally {
      setIsRetrying(false)
    }
  }

  const handleDiscardFailed = async () => {
    if (!window.confirm('Discard failed uploads permanently? They will NOT be sent to the server.')) return
    try {
      await syncService.clearFailedItems()
    } catch (error) {
      console.error('Discarding failed uploads failed:', error)
    }
  }

  const loadSyncStatus = async () => {
    try {
      const status = await offlineDataSync.getSyncStatus()
      setSyncStatus(status)
    } catch (error) {
      console.error('Failed to load sync status:', error)
    }
  }

  const handleSyncAll = async () => {
    setIsSyncing(true)
    try {
      const result = await offlineDataSync.syncOfflineData(true) // Force sync
      await loadSyncStatus()
      if (result.success) {
        alert(t('syncCompleted'))
      } else {
        alert(t('syncFailed') + ': ' + result.message)
      }
    } catch (error) {
      console.error('Sync failed:', error)
      alert(t('syncFailed') + ': ' + (error as Error).message)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleClearData = async () => {
    setIsClearing(true)
    try {
      await clearAllData()
      await offlineDataSync.clearOfflineData()
      localStorage.clear()
      await loadSyncStatus()
      setShowConfirmClear(false)
      alert(t('dataCleared'))
    } catch (error) {
      console.error('Failed to clear data:', error)
      alert(t('clearFailed') + ': ' + (error as Error).message)
    } finally {
      setIsClearing(false)
    }
  }

  const C = {
    card:    'rgba(255,255,255,0.04)',
    border:  'rgba(255,255,255,0.09)',
    accent:  '#FC4100',
    textPri: '#f1f5f9',
    textMut: '#8b9ab0',
  }

  const SectionTitle = ({ icon, title }: { icon: string; title: string }) => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '10px',
      color: '#FFC55A',
      fontWeight: 700,
      fontSize: '0.75rem',
      textTransform: 'uppercase',
      letterSpacing: '0.08em'
    }}>
      <span style={{ fontSize: '1rem' }}>{icon}</span>
      <span>{title}</span>
    </div>
  )

  const ActionCard = ({
    icon,
    title,
    subtitle,
    onClick,
    disabled = false,
    danger = false
  }: {
    icon: string
    title: string
    subtitle: string
    onClick: () => void
    disabled?: boolean
    danger?: boolean
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '14px 16px',
        background: danger ? 'rgba(239,68,68,0.08)' : C.card,
        border: `1px solid ${danger ? 'rgba(239,68,68,0.25)' : C.border}`,
        borderRadius: '12px',
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        transition: 'all 0.2s ease'
      }}
    >
      <span style={{ fontSize: '1.4rem' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{
          fontWeight: 600,
          color: danger ? '#f87171' : C.textPri,
          fontSize: '0.9rem'
        }}>
          {title}
        </div>
        <div style={{
          fontSize: '0.75rem',
          color: C.textMut,
          marginTop: '2px'
        }}>
          {subtitle}
        </div>
      </div>
      <span style={{ fontSize: '1rem', color: danger ? '#f87171' : C.textMut }}>›</span>
    </button>
  )

  const connectionStatus = connectionManager.getStatus()

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto', color: '#f1f5f9' }}>
      {/* Data Management Section */}
      <div style={{ marginBottom: '18px' }}>
        <SectionTitle icon="💾" title={t('dataManagement')} />
        <div className="prism-card" style={{ padding: '14px' }}>
          {/* Sync Status Info */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
            marginBottom: '12px'
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FC4100' }}>
                {syncStatus?.totalRecords?.toLocaleString() || '0'}
              </div>
              <div style={{ fontSize: '0.7rem', color: C.textMut }}>
                {t('totalRecords')}
              </div>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: syncStatus?.isStale ? '#f59e0b' : '#22c55e' }}>
                {syncStatus?.isStale ? t('outOfDate') : t('upToDate')}
              </div>
              <div style={{ fontSize: '0.7rem', color: C.textMut }}>
                {t('syncStatus')}
              </div>
            </div>
          </div>

          {/* Last Sync Info */}
          {syncStatus?.lastSync && (
            <div style={{
              fontSize: '0.75rem',
              color: C.textMut,
              textAlign: 'center',
              marginBottom: '12px',
              padding: '8px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '8px',
              border: `1px solid ${C.border}`
            }}>
              {t('lastSynced')}: {new Date(syncStatus.lastSync).toLocaleString()}
            </div>
          )}

          {/* Sync Button */}
          <ActionCard
            icon={isSyncing ? '🔄' : '☁️'}
            title={isSyncing ? t('syncing') : t('syncAllData')}
            subtitle={t('syncAllDataDesc')}
            onClick={handleSyncAll}
            disabled={isSyncing || !connectionStatus.isOnline}
          />

          {/* Clear Data Button */}
          <div style={{ marginTop: '10px' }}>
            <ActionCard
              icon={isClearing ? '🔄' : '🗑️'}
              title={isClearing ? t('clearing') : t('clearOfflineData')}
              subtitle={t('clearOfflineDataDesc')}
              onClick={() => setShowConfirmClear(true)}
              disabled={isClearing}
              danger
            />
          </div>
        </div>
      </div>

      {/* Pending Uploads Section — inspections/photos waiting to reach the server */}
      <div style={{ marginBottom: '18px' }}>
        <SectionTitle icon="📤" title={'Pending Uploads'} />
        <div className="prism-card" style={{ padding: '14px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '10px',
            marginBottom: (uploadStatus?.failedItems || 0) > 0 ? '12px' : 0
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.border}`,
              borderRadius: '12px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFC55A' }}>
                {Math.max((uploadStatus?.pendingItems || 0) - (uploadStatus?.failedItems || 0), 0)}
              </div>
              <div style={{ fontSize: '0.7rem', color: C.textMut }}>Waiting to upload</div>
            </div>
            <div style={{
              background: (uploadStatus?.failedItems || 0) > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${(uploadStatus?.failedItems || 0) > 0 ? 'rgba(239,68,68,0.3)' : C.border}`,
              borderRadius: '12px',
              padding: '12px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: (uploadStatus?.failedItems || 0) > 0 ? '#f87171' : '#22c55e' }}>
                {uploadStatus?.failedItems || 0}
              </div>
              <div style={{ fontSize: '0.7rem', color: C.textMut }}>Failed</div>
            </div>
          </div>

          {(uploadStatus?.failedItems || 0) > 0 && (
            <>
              <div style={{
                fontSize: '0.78rem',
                color: '#fca5a5',
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: '8px',
                padding: '8px 10px',
                marginBottom: '10px'
              }}>
                ⚠️ Some inspections or photos could not be uploaded after several attempts.
                They are saved on this device — retry when you have a better connection.
              </div>
              <ActionCard
                icon={isRetrying ? '🔄' : '🔁'}
                title={isRetrying ? 'Retrying…' : 'Retry Failed Uploads'}
                subtitle="Try sending failed items to the server again"
                onClick={handleRetryFailed}
                disabled={isRetrying || !connectionStatus.isOnline}
              />
              <div style={{ marginTop: '10px' }}>
                <ActionCard
                  icon="🗑️"
                  title="Discard Failed Uploads"
                  subtitle="Remove failed items permanently (data will be lost)"
                  onClick={handleDiscardFailed}
                  danger
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Security Section */}
      <div style={{ marginBottom: '18px' }}>
        <SectionTitle icon="🔐" title={'Security'} />
        <div className="prism-card" style={{ padding: '14px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            opacity: biometricAvail?.isAvailable ? 1 : 0.5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.4rem' }}>
                {biometricAvail?.biometricType === 'face' ? '🧑' : '👆'}
              </span>
              <div>
                <div style={{ fontWeight: 600, color: C.textPri, fontSize: '0.9rem' }}>
                  {'Biometric App Lock'}
                </div>
                <div style={{ fontSize: '0.75rem', color: C.textMut, marginTop: '2px' }}>
                  {biometricAvail?.isAvailable
                    ? (`Use ${biometricAvail.biometricType === 'face' ? 'Face ID' : 'fingerprint'} to unlock`)
                    : ('Not available on this device')}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                if (!biometricAvail?.isAvailable) return
                const next = !biometricOn
                setBiometricEnabled(next)
                setBiometricOn(next)
              }}
              disabled={!biometricAvail?.isAvailable}
              style={{
                width: '48px',
                height: '28px',
                borderRadius: '14px',
                border: 'none',
                cursor: biometricAvail?.isAvailable ? 'pointer' : 'not-allowed',
                background: biometricOn ? '#22c55e' : 'rgba(255,255,255,0.12)',
                position: 'relative',
                transition: 'background 0.2s ease',
              }}
            >
              <span style={{
                position: 'absolute',
                top: '3px',
                left: biometricOn ? '23px' : '3px',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s ease',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
        </div>
      </div>

      {/* Safety Location info — sharing is always on while signed in */}
      <div style={{ marginBottom: '18px' }}>
        <SectionTitle icon="📍" title={'Safety Location'} />
        <div className="prism-card" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>📡</span>
            <div>
              <div style={{ fontWeight: 600, color: C.textPri, fontSize: '0.9rem' }}>
                Live Safety Tracking — Active
              </div>
              <div style={{ fontSize: '0.75rem', color: C.textMut, marginTop: '2px' }}>
                Your live position is shared with site safety for emergency
                response while you are signed in. It is <b>not stored</b> — it
                disappears minutes after you go offline.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostics Section */}
      <div style={{ marginBottom: '18px' }}>
        <SectionTitle icon="🔧" title={t('diagnostics')} />
        <div className="prism-card" style={{ padding: '14px' }}>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${C.border}`,
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: '0.88rem',
              fontWeight: 600,
              color: C.textPri
            }}
          >
            <span>🔍 {t('showDiagnostics')}</span>
            <span style={{ transform: showDiagnostics ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', color: C.textMut }}>▼</span>
          </button>

          {showDiagnostics && (
            <div style={{
              marginTop: '12px', padding: '14px',
              background: 'rgba(0,0,0,0.25)',
              borderRadius: '10px',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              color: C.textPri,
              border: `1px solid ${C.border}`,
              lineHeight: 1.8
            }}>
              <div><span style={{ color: C.textMut }}>{t('connectionMode')}:</span> {connectionStatus.currentMode}</div>
              <div><span style={{ color: C.textMut }}>{t('cloudAvailable')}:</span> {connectionStatus.cloudAvailable ? '✅' : '❌'}</div>
              <div><span style={{ color: C.textMut }}>{t('localAvailable')}:</span> {connectionStatus.localAvailable ? '✅' : '❌'}</div>
              <div><span style={{ color: C.textMut }}>{t('isOnline')}:</span> {connectionStatus.isOnline ? '✅' : '❌'}</div>
              <div><span style={{ color: C.textMut }}>{t('lastChecked')}:</span> {new Date(connectionStatus.lastChecked).toLocaleTimeString()}</div>
            </div>
          )}
        </div>
      </div>

      {/* App Info Section */}
      <div className="prism-card" style={{ textAlign: 'center', padding: '20px' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#FFC55A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
          PRISM System
        </div>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: C.textPri, marginBottom: '4px' }}>
          {t('appName')}
        </div>
        <div style={{ fontSize: '0.8rem', color: C.textMut, marginBottom: '8px' }}>
          {t('version')} {APP_VERSION} (PRISM Edition)
        </div>
        <div style={{ fontSize: '0.72rem', color: '#4a5568' }}>
          © 2026 PRISM. {t('allRightsReserved')}.
        </div>
      </div>

      {/* Clear Data Confirmation Modal */}
      {showConfirmClear && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000, padding: '20px'
        }}>
          <div style={{
            background: '#0d1520',
            border: `1px solid ${C.border}`,
            borderRadius: '20px',
            padding: '24px',
            maxWidth: '380px',
            width: '100%'
          }}>
            <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ textAlign: 'center', margin: '0 0 8px 0', color: C.textPri }}>
              {t('confirmClearTitle')}
            </h3>
            <p style={{ textAlign: 'center', color: C.textMut, marginBottom: '20px', fontSize: '0.88rem' }}>
              {t('confirmClearDesc')}
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowConfirmClear(false)}
                style={{
                  flex: 1, padding: '12px',
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: '10px', fontWeight: 600,
                  color: C.textPri, cursor: 'pointer'
                }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleClearData}
                style={{
                  flex: 1, padding: '12px',
                  background: '#DC2626', color: 'white',
                  border: 'none', borderRadius: '10px',
                  fontWeight: 600, cursor: 'pointer'
                }}
              >
                {t('clearData')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen sync overlay */}
      {isSyncing && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(5,10,18,0.92)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '20px', backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: '56px', height: '56px',
            borderRadius: '50%',
            border: '4px solid rgba(252,65,0,0.15)',
            borderTopColor: '#FC4100',
            animation: 'spin 1s linear infinite',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 600 }}>
            {t('syncing')}
          </div>
          <div style={{ color: '#8b9ab0', fontSize: '0.82rem', textAlign: 'center', maxWidth: '260px' }}>
            Please do not close the app or navigate away while data is being downloaded.
          </div>
        </div>
      )}
    </div>
  )
}
