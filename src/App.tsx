import { useState, useEffect, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'

// Import styles
import './styles/theme.css'
import './App.css'

// Import components
import AppHeader from './components/AppHeader'
import BottomNavigation from './components/BottomNavigation'
import ErrorBoundary from './components/ErrorBoundary'
import LoadingScreen from './components/LoadingScreen'
import ToastContainer from './components/ToastContainer'

// Import services
import { I18nProvider, useI18n } from './services/i18n-context'
import { type Language } from './services/i18n'
import { connectionManager } from './services/connectionManager'
import { offlineDataSync } from './services/offlineDataSync'
// import { apiFetch } from './services/api'
import { initBackgroundSync } from './services/backgroundSync'
import { authService, type AuthenticatedUser } from './services/auth'
import {
  checkBiometricAvailability,
  promptBiometricDetailed,
  isBiometricEnabled,
  setBiometricEnabled,
  clearBiometricPreference,
} from './services/biometricAuth'
import { isEmployeeCardVerifyQR, parseEmployeeCardVerifyQR } from './utils/employeeQr'
import type { EmergencyZoneAlert } from './services/emergencyAlert'
import type { LocationStatus } from './services/locationShare'
import { buildPersonDetailPath, getPersonLookupFromCardData } from './utils/personRoute'
import { resolveEmployeeScanTarget } from './utils/employeeScanResolve'

// Import types
import type {
  KimperMapping,
  PersonCardData,
  EmployeeCardData,
  EmployeeFullInfo,
} from './services/offlineDataSync'

// Build a PersonCardData from an EmployeeCardData so PersonDetailPage can render
// QR-scanned employees that have no matching unified person record (e.g. legacy
// records keyed only by employee_id). Mirrors the shape returned by
// /api/mobile/people/all so the page does not need to re-fetch.
function synthesizePersonCardFromEmployeeCard(card: EmployeeCardData): PersonCardData {
  const emp = card.employee
  return {
    success: true,
    person: {
      name: emp.name,
      employee_id: emp.employee_id,
      ktp_number: emp.ktp_number,
      kimper_id: card.kimper?.kimper_id,
      company: emp.company,
      department: emp.department,
      section: emp.section,
      position_title: emp.position,
      position_level: emp.position_level,
      status: emp.status,
      kimper_status: card.kimper?.status ?? undefined,
      qr_code_token: emp.qr_code_token,
    },
    employee: emp,
    // PersonCardData.kimper has a self-conflicting intersection type (string[]
    // vs string for authorized_units). Cast through unknown to satisfy it; the
    // page reads scalar fields like kimper_id / status which are unaffected.
    kimper: card.kimper
      ? ({
          ...card.kimper,
          authorized_units: card.kimper.authorized_units?.join(', '),
          authorized_unit_codes: card.kimper.authorized_unit_codes?.join(', '),
        } as unknown as PersonCardData['kimper'])
      : undefined,
    training_summary: card.training_summary,
    training_categories: card.training_categories,
    violations: card.violations,
    verified_at: card.verified_at,
  }
}

function synthesizePersonCardFromOfflineEmployee(emp: EmployeeFullInfo): PersonCardData {
  return {
    success: true,
    person: {
      name: emp.name,
      employee_id: emp.employee_id,
      ktp_number: emp.ktp_number,
      company: emp.company,
      department: emp.department,
      section: emp.section,
      position_title: emp.position,
      position_level: emp.position_level,
      status: emp.status,
      qr_code_token: emp.qr_code_token,
    },
    employee: {
      id: emp.id ?? 0,
      employee_id: emp.employee_id,
      name: emp.name,
      company: emp.company,
      department: emp.department,
      section: emp.section,
      position: emp.position,
      position_level: emp.position_level,
      status: emp.status,
      qr_code_token: emp.qr_code_token,
      photo_url: emp.photo_url,
      ktp_number: emp.ktp_number,
    },
    training_summary: { total: 0, valid: 0, expired: 0, not_yet: 0, mandatory_total: 0, mandatory_valid: 0, expiring: 0 },
    training_categories: [],
    violations: [],
    verified_at: new Date().toISOString(),
    _partial: true,
    _offline: { cachedAt: 0 },
  }
}

const HomePage = lazy(() => import('./pages/HomePage'))
const ScanPage = lazy(() => import('./pages/ScanPage'))
const DeviationReportPage = lazy(() => import('./pages/DeviationReportPage'))
const CommissioningPage = lazy(() => import('./pages/CommissioningPage'))
const RegisterVehiclePage = lazy(() => import('./pages/RegisterVehiclePage'))
const KimperCardPage = lazy(() => import('./pages/KimperCardPage'))
const EmployeeDetailPage = lazy(() => import('./pages/EmployeeDetailPage'))
const PersonDetailPage = lazy(() => import('./pages/PersonDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))

function AppContent() {
  const location = useLocation()
  const navigate = useNavigate()
  const { setLanguage } = useI18n()
  const [showIntro, setShowIntro] = useState(true)
  const [authReady, setAuthReady] = useState(false)
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null)
  const [biometricGate, setBiometricGate] = useState<'idle' | 'prompting' | 'unlocked' | 'failed' | 'locked'>('idle')
  const [showBiometricPrompt, setShowBiometricPrompt] = useState(false)
  const [biometricPromptAvail, setBiometricPromptAvail] = useState(false)
  const [toasts, setToasts] = useState<Array<{ id: string; type: 'success' | 'error' | 'warning' | 'info'; message: string }>>([])
  const [emergencyAlert, setEmergencyAlert] = useState<EmergencyZoneAlert | null>(null)
  const [locationGuard, setLocationGuard] = useState<LocationStatus | null>(null)

  // Scanned data state
  const [scannedKimper, setScannedKimper] = useState<KimperMapping | null>(null)

  // Add toast helper
  const addToast = (type: 'success' | 'error' | 'warning' | 'info', message: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }

  // Initialize app
  useEffect(() => {
    const lang = new URLSearchParams(location.search).get('lang')
    if (lang === 'en' || lang === 'es' || lang === 'id' || lang === 'zh') {
      setLanguage(lang as Language)
    }
  }, [location.search])

  useEffect(() => {
    const introTimer = setTimeout(() => {
      setShowIntro(false)
    }, 180)
    return () => clearTimeout(introTimer)
  }, [])

  useEffect(() => {
    let active = true

    const bootstrapAuth = async () => {
      try {
        await authService.bootstrap()
        const user = await authService.getCurrentUser()

        if (!active) return

        // If we have a user, silently validate the token when online.
        // Offline users stay logged in regardless.
        if (user && navigator.onLine) {
          try {
            const isValid = await authService.validateToken()
            if (!isValid && active) {
              setCurrentUser(null)
              setAuthReady(true)
              return
            }
          } catch (validateError) {
            console.warn('Token validation error during bootstrap, keeping session:', validateError)
            // Keep session on unexpected errors (network blips, etc.)
          }
        }

        if (!active) return

        // Biometric gate: if user has a session AND opted into biometric lock,
        // prompt native biometric before revealing the app.
        if (user && isBiometricEnabled()) {
          const avail = await checkBiometricAvailability()
          if (avail.isAvailable && active) {
            setBiometricGate('prompting')
            const result = await promptBiometricDetailed('Unlock PRISM')
            if (!active) return
            if (result.success) {
              setBiometricGate('unlocked')
            } else {
              // Don't destroy the session on a cancel or a transient sensor
              // error — that's hostile (user must fully re-login every time the
              // sensor hiccups). Show a lock screen with a Retry button and an
              // explicit "Use password" escape hatch instead.
              setBiometricGate('locked')
              setAuthReady(true)
              return
            }
          } else {
            // Biometric hardware no longer available (e.g. fingerprints deleted)
            // Fall back to normal session.
            setBiometricGate('unlocked')
          }
        } else {
          setBiometricGate('unlocked')
        }

        if (active) {
          setCurrentUser(user)
        }
      } catch (error) {
        console.error('❌ Failed to bootstrap auth state:', error)
      } finally {
        if (active) {
          setAuthReady(true)
        }
      }
    }

    bootstrapAuth()

    // Safety net: never leave the user stuck on the splash/loading screen.
    // If bootstrap wedges (a native call that never resolves, a hung probe),
    // unblock the UI after 8s so they can at least reach the login screen.
    const bootstrapTimeout = window.setTimeout(() => {
      if (active) {
        console.warn('[bootstrap] timed out after 8s — unblocking UI')
        setAuthReady(true)
      }
    }, 8000)

    return () => {
      active = false
      window.clearTimeout(bootstrapTimeout)
    }
  }, [])

  // Deferred service init — runs AFTER UI is visible, never blocks rendering
  useEffect(() => {
    // Make services available globally for debugging (dev only)
    if (import.meta.env.DEV) {
      ;(window as any).connectionManager = connectionManager
      ;(window as any).offlineDataSync = offlineDataSync
      ;(window as any).authService = authService
    }

    // Start connectivity monitoring 3s after UI renders
    connectionManager.init()

    // Initialize background sync for periodic uploads
    initBackgroundSync().catch((e) => console.warn('Background sync init failed:', e))

    console.log('✅ PRISM Mobile UI ready')
  }, [])

  // Always-on safety location: starts automatically once a user is signed in
  // and stops on logout. There is intentionally no user-facing toggle — site
  // safety policy is that the live map covers everyone with the app running.
  useEffect(() => {
    if (!currentUser) {
      import('./services/locationShare')
        .then(m => m.stopSharing())
        .catch(() => { /* not started yet */ })
      return
    }
    import('./services/locationShare')
      .then(async m => {
        await m.startSharing()
        // Android only offers "While using the app" in the permission dialog.
        // For permanent tracking the user must pick "Allow all the time" on
        // the app's settings page — detect the gap and walk them there.
        const status = await m.getLocationStatus()
        if (status && (status.backgroundLocation !== 'granted' || !status.batteryExempt)) {
          setLocationGuard(status)
        }
      })
      .catch((e) => console.warn('Location share start failed:', e))
  }, [currentUser])

  // Emergency zone alerts: full-screen in-app alert on top of whatever page
  // is open (the notification + siren are handled by emergencyAlert itself).
  useEffect(() => {
    let unsub: (() => void) | undefined
    import('./services/emergencyAlert')
      .then(m => { unsub = m.onEmergencyAlert(alert => setEmergencyAlert(alert)) })
      .catch(() => { /* service unavailable */ })
    return () => unsub?.()
  }, [])

  // Kick the 2-hour background auto-sync once the user is signed in. The
  // service's internal freshness gate means most ticks are a cheap no-op;
  // ticks that pass the gate run delta mode (usually < 1 s).
  useEffect(() => {
    if (!currentUser) {
      offlineDataSync.stopAutoSync()
      return
    }
    offlineDataSync.startAutoSync()
    return () => {
      offlineDataSync.stopAutoSync()
    }
  }, [currentUser])

  // Handle Android back button — MUST be before any conditional return
  useEffect(() => {
    const backHandler = CapacitorApp.addListener('backButton', () => {
      const path = location.pathname

      // Navigate back or exit
      if (path === '/home' || path === '/') {
        CapacitorApp.minimizeApp()
      } else {
        navigate(-1)
      }
    })

    return () => {
      backHandler.then(handler => handler.remove())
    }
  }, [location.pathname, navigate])

  // Show loading screen — all hooks are above this point
  if (showIntro || !authReady) {
    return <LoadingScreen />
  }

  // Biometric lock overlay — shown while prompting (and the retry/locked state),
  // before the app UI is revealed.
  if (biometricGate === 'prompting' || biometricGate === 'locked') {
    const isLocked = biometricGate === 'locked'
    const retryUnlock = async () => {
      setBiometricGate('prompting')
      const result = await promptBiometricDetailed('Unlock PRISM')
      if (result.success) {
        const user = await authService.getCurrentUser()
        setCurrentUser(user)
        setBiometricGate('unlocked')
      } else {
        setBiometricGate('locked')
      }
    }
    const usePassword = async () => {
      // Escape hatch: sign out and fall back to username/password login.
      await authService.clearAuth()
      setCurrentUser(null)
      setBiometricGate('idle')
      navigate('/', { replace: true })
    }
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#050a12',
        color: '#f1f5f9',
        gap: 16,
        padding: 24,
      }}>
        <div style={{ fontSize: '3rem' }}>🔒</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>PRISM is locked</div>
        <div style={{ fontSize: '0.85rem', color: '#8b9ab0', textAlign: 'center', maxWidth: 280 }}>
          {isLocked
            ? 'Unlock was cancelled or failed. Try again, or sign in with your password.'
            : 'Use your fingerprint, face, or device PIN to unlock.'}
        </div>
        {isLocked && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 280, marginTop: 8 }}>
            <button onClick={retryUnlock} style={{
              padding: '12px', borderRadius: 12, border: 'none',
              background: '#FC4100', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
            }}>Try again</button>
            <button onClick={usePassword} style={{
              padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: '#c3cad6', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
            }}>Use password instead</button>
          </div>
        )}
      </div>
    )
  }

  const handleLoginSuccess = async (user: AuthenticatedUser) => {
    setCurrentUser(user)
    navigate('/home', { replace: true })
    addToast('success', `Welcome back, ${user.fullName || user.username}`)

    // One-time biometric setup prompt after a fresh login
    if (!isBiometricEnabled()) {
      try {
        const avail = await checkBiometricAvailability()
        if (avail.isAvailable) {
          setBiometricPromptAvail(true)
          setShowBiometricPrompt(true)
        }
      } catch {
        // ignore — biometric not supported, continue normally
      }
    }
  }

  const handleLogout = async () => {
    try {
      await authService.clearAuth()
      clearBiometricPreference()
      setCurrentUser(null)
      setBiometricGate('idle')
      navigate('/', { replace: true })
      addToast('info', 'You have been logged out.')
    } catch (error) {
      console.error('❌ Failed to clear auth session:', error)
      addToast('error', 'Unable to log out right now.')
    }
  }

  if (!currentUser) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      </Suspense>
    )
  }

  // Process QR code
  const processQRCode = async (qrContent: string) => {
    console.log('🔍 QR Code scanned:', qrContent)

    // Detect QR code type - employee-card verify routes must be checked before /employee/qr/
    if (isEmployeeCardVerifyQR(qrContent)) {
      await handleEmployeeCardVerifyQR(qrContent)
    } else if (qrContent.includes('/kimper/qr/')) {
      await handleKimperQRCode(qrContent)
    } else if (qrContent.includes('/employee/qr/')) {
      await handleEmployeeQRCode(qrContent)
    } else {
      addToast('info', 'Vehicle scanning has moved to a separate app.')
    }
  }

  const openPersonDetail = (cardData: PersonCardData) => {
    // fromScan lets PersonDetailPage auto-open the vehicle-pairing flow for
    // QR-scanned KIMPER holders (physical presence at the gate/parking).
    navigate(buildPersonDetailPath(getPersonLookupFromCardData(cardData)), {
      state: { cardData, fromScan: true },
    })
  }

  const openResolvedEmployeeScanTarget = (target: Awaited<ReturnType<typeof resolveEmployeeScanTarget>>) => {
    switch (target.kind) {
      case 'person-detail':
        openPersonDetail(target.personData)
        addToast('success', `Person: ${target.personData.person.name || target.personData.employee.name}`)
        return true
      case 'employee-detail-card': {
        // QR scan → land on PersonDetailPage. The unified person fetch already
        // failed (otherwise resolver would have returned 'person-detail'), so we
        // synthesize a PersonCardData from the verified employee record and pass
        // it via state so the page renders without another lookup.
        const synthesized = synthesizePersonCardFromEmployeeCard(target.cardData)
        openPersonDetail(synthesized)
        addToast('success', `Employee: ${target.cardData.employee.name}`)
        return true
      }
      case 'employee-detail-offline': {
        const synthesized = synthesizePersonCardFromOfflineEmployee(target.employee)
        openPersonDetail(synthesized)
        addToast('warning', 'Offline mode — showing cached profile')
        return true
      }
      case 'employee-card':
        setScannedKimper(target.kimper as KimperMapping)
        navigate('/employee-card', { state: { kimper: target.kimper, type: 'employee' } })
        addToast('success', `Employee found: ${target.kimper.name || 'KIMPER record'}`)
        return true
      default:
        return false
    }
  }

  const handleKimperQRCode = async (qrContent: string) => {
    try {
      const parts = qrContent.split('/kimper/qr/')
      if (parts.length < 2) {
        addToast('error', 'Invalid KIMPER QR code format')
        return
      }

      const kimperId = parseInt(parts[1])
      if (isNaN(kimperId)) {
        addToast('error', 'Invalid KIMPER ID')
        return
      }

      const personData = await offlineDataSync.fetchPersonCardData({ kimperId })
      if (personData?.success) {
        openPersonDetail(personData)
        addToast('success', `Person found: ${personData.person.name || personData.employee.name}`)
        return
      }

      const kimperData = await offlineDataSync.lookupKimperById(kimperId)

      if (!kimperData) {
        addToast('warning', 'KIMPER not found. Please sync data first.')
        return
      }

      setScannedKimper(kimperData)
      navigate('/employee-card', { state: { kimper: kimperData, type: 'kimper' } })
      addToast('success', `KIMPER found: ${kimperData.name}`)
    } catch (error) {
      console.error('❌ Error processing KIMPER QR:', error)
      addToast('error', 'Failed to process KIMPER QR code')
    }
  }

  const handleEmployeeQRCode = async (qrContent: string) => {
    try {
      const parts = qrContent.split('/employee/qr/')
      if (parts.length < 2) {
        addToast('error', 'Invalid Employee QR code format')
        return
      }

      const employeeId = parts[1].split('?')[0].split('#')[0]

      addToast('info', 'Looking up employee online...')

      const target = await resolveEmployeeScanTarget({
        employeeId,
        token: '',
        allowKimperFallback: true,
        fetchEmployeeCardData: (id, token) => offlineDataSync.fetchEmployeeCardData(id, token),
        lookupEmployeeById: (id) => offlineDataSync.lookupEmployeeById(id),
        fetchPersonCardData: (lookup) => offlineDataSync.fetchPersonCardData(lookup),
        lookupPersonCardOffline: (id) => offlineDataSync.lookupPersonCardOffline(id),
        getAllKimper: () => offlineDataSync.getAllKimper(),
      })

      if (!openResolvedEmployeeScanTarget(target)) {
        addToast('warning', 'Employee not found. Please sync data first.')
      }
    } catch (error) {
      console.error('❌ Error processing Employee QR:', error)
      addToast('error', 'Failed to process Employee QR code')
    }
  }

  const handleEmployeeCardVerifyQR = async (qrContent: string) => {
    try {
      const parsedQr = parseEmployeeCardVerifyQR(qrContent)
      const employeeId = parsedQr?.employeeId ?? null
      const token = parsedQr?.token ?? null
      const personKey = parsedQr?.personKey ?? null

      if (!employeeId) {
        addToast('error', 'Invalid employee QR code')
        return
      }

      addToast('info', 'Looking up employee card...')

      const target = await resolveEmployeeScanTarget({
        employeeId,
        token: token || '',
        personKey: personKey || undefined,
        allowKimperFallback: false,
        fetchEmployeeCardData: (id, qrToken) => offlineDataSync.fetchEmployeeCardData(id, qrToken),
        lookupEmployeeById: (id) => offlineDataSync.lookupEmployeeById(id),
        fetchPersonCardData: (lookup) => offlineDataSync.fetchPersonCardData(lookup),
        lookupPersonCardOffline: (id) => offlineDataSync.lookupPersonCardOffline(id),
      })

      if (!openResolvedEmployeeScanTarget(target)) {
        addToast('error', 'Employee not found. Sync data first.')
      }
    } catch (error) {
      console.error('❌ Error processing employee-card verify QR:', error)
      addToast('error', 'Failed to process employee QR code')
    }
  }

  const showBottomNav = !['/scan'].includes(location.pathname)
  const showHeader = !['/scan'].includes(location.pathname)

  return (
    <div className="app-container">
      {/* Header */}
      {showHeader && <AppHeader currentUser={currentUser} onLogout={handleLogout} />}

      {/* Main Content */}
      <main className={`app-main ${showBottomNav ? 'with-bottom-nav' : ''}`}>
        <ErrorBoundary onReset={() => navigate('/home')}>
          <AnimatePresence mode="wait">
          <Suspense
            fallback={
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  minHeight: '100vh',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#050a12',
                  color: '#8b9ab0',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  gap: '14px'
                }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{
                    width: '28px', height: '28px',
                    border: '3px solid rgba(255,255,255,0.08)',
                    borderTop: '3px solid #FC4100',
                    borderRadius: '50%',
                  }}
                />
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  Loading...
                </motion.span>
              </motion.div>
            }
          >
            <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/scan" element={
              <ScanPage 
                onResult={processQRCode}
              />
            } />
            <Route path="/deviation-report" element={
              <DeviationReportPage 
                kimper={scannedKimper}
                onShowToast={addToast}
              />
            } />
            <Route path="/employee-card" element={
              <KimperCardPage
                kimper={scannedKimper}
                onReportDeviation={() => navigate('/deviation-report')}
              />
            } />
            <Route path="/commissioning" element={
              <CommissioningPage onShowToast={addToast} />
            } />
            <Route path="/register-vehicle" element={
              <RegisterVehiclePage onShowToast={addToast} />
            } />
            <Route path="/employee-detail" element={<EmployeeDetailPage />} />
            <Route path="/person-detail" element={<PersonDetailPage />} />
            <Route path="/history" element={<HistoryPage onShowToast={addToast} />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
          </Suspense>
          </AnimatePresence>
        </ErrorBoundary>
      </main>

      {/* Bottom Navigation */}
      {showBottomNav && <BottomNavigation />}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />

      {/* Emergency zone alert — full-screen, on top of everything */}
      {emergencyAlert && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(127, 9, 9, 0.96)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
            style={{
              width: '100%',
              maxWidth: '360px',
              background: '#1a0505',
              border: '2px solid #ef4444',
              borderRadius: '20px',
              padding: '28px',
              textAlign: 'center',
              color: '#fff',
              boxShadow: '0 0 60px rgba(239,68,68,0.55)',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>
              {emergencyAlert.zone_type === 'keepout' ? '⛔' : '🚨'}
            </div>
            <div style={{
              fontSize: '1rem', fontWeight: 800, letterSpacing: '0.12em',
              color: '#f87171', marginBottom: '12px'
            }}>
              {emergencyAlert.zone_type === 'keepout' ? 'RESTRICTED AREA — LEAVE NOW' : 'EMERGENCY ALERT'}
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.5, marginBottom: '20px' }}>
              {emergencyAlert.message}
            </div>
            {emergencyAlert.created_by && (
              <div style={{ fontSize: '0.78rem', color: '#fca5a5', marginBottom: '20px' }}>
                Issued by {emergencyAlert.created_by}
              </div>
            )}
            {emergencyAlert.zone_type === 'keepout' ? (
              <button
                onClick={() => {
                  import('./services/emergencyAlert').then(m => m.stopAlarm()).catch(() => {})
                  setEmergencyAlert(null)
                }}
                style={{
                  width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                  background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer',
                }}
              >
                I UNDERSTAND — LEAVING
              </button>
            ) : (
              // Muster roll-call: the response shows on the safety map as
              // SAFE (green) / NEED HELP (red) next to this person's name.
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => {
                    const zoneId = emergencyAlert.id
                    import('./services/emergencyAlert').then(m => {
                      m.stopAlarm()
                      void m.ackEmergencyZone(zoneId, 'safe')
                    }).catch(() => {})
                    setEmergencyAlert(null)
                    addToast('success', 'Marked as SAFE — visible to the safety team.')
                  }}
                  style={{
                    width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                    background: '#22c55e', color: '#06210f', fontWeight: 800, fontSize: '1rem', cursor: 'pointer',
                  }}
                >
                  ✓ I'M SAFE
                </button>
                <button
                  onClick={() => {
                    const zoneId = emergencyAlert.id
                    import('./services/emergencyAlert').then(m => {
                      m.stopAlarm()
                      void m.ackEmergencyZone(zoneId, 'help')
                    }).catch(() => {})
                    setEmergencyAlert(null)
                    addToast('warning', 'HELP requested — your position is flagged to the safety team.')
                  }}
                  style={{
                    width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
                    background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '1rem', cursor: 'pointer',
                  }}
                >
                  🆘 I NEED HELP
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* Always-on location guard: Android only offers "While using the app"
          in its dialog — permanent tracking needs "Allow all the time" from
          the app settings page, plus a battery-optimization exemption. */}
      {locationGuard && !emergencyAlert && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 2500,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px', background: 'rgba(5,10,18,0.94)', backdropFilter: 'blur(6px)',
          }}
        >
          <div style={{
            width: '100%', maxWidth: '360px', background: '#0d1520',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '20px',
            padding: '26px', color: '#f1f5f9',
          }}>
            <div style={{ fontSize: '2.4rem', textAlign: 'center', marginBottom: '10px' }}>📍</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, textAlign: 'center', marginBottom: '10px' }}>
              Enable permanent safety tracking
            </div>
            <div style={{ fontSize: '0.84rem', color: '#8b9ab0', lineHeight: 1.6, marginBottom: '18px' }}>
              {locationGuard.backgroundLocation !== 'granted' ? (
                <>
                  Location is currently allowed <b>only while the app is open</b>, so
                  tracking stops when the screen is off. On the next screen choose{' '}
                  <b style={{ color: '#FFC55A' }}>Location → Allow all the time</b>.
                </>
              ) : (
                <>
                  Android battery optimization can stop tracking after a while.
                  Tap below and choose <b style={{ color: '#FFC55A' }}>Allow</b> so
                  PRISM keeps reporting with the screen off.
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={async () => {
                  const m = await import('./services/locationShare')
                  if (locationGuard.backgroundLocation !== 'granted') {
                    await m.requestAlwaysOnLocation()
                  } else {
                    await m.requestBatteryExemption()
                  }
                  // Re-check after the user comes back from the system UI.
                  const status = await m.getLocationStatus()
                  if (!status || (status.backgroundLocation === 'granted' && status.batteryExempt)) {
                    setLocationGuard(null)
                  } else {
                    setLocationGuard(status)
                  }
                }}
                style={{
                  width: '100%', padding: '13px', borderRadius: '12px', border: 'none',
                  background: '#FC4100', color: '#fff', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer',
                }}
              >
                {locationGuard.backgroundLocation !== 'granted' ? 'Open Location Settings' : 'Disable Battery Optimization'}
              </button>
              <button
                onClick={() => setLocationGuard(null)}
                style={{
                  width: '100%', padding: '12px', borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                  color: '#8b9ab0', fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer',
                }}
              >
                Later
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Biometric Setup Prompt — shown once after fresh login */}
      {showBiometricPrompt && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(5,10,18,0.92)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            style={{
              width: '100%',
              maxWidth: '340px',
              background: 'rgba(12,18,28,0.98)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '20px',
              padding: '28px',
              textAlign: 'center',
              color: '#f1f5f9',
            }}
          >
            <div style={{ fontSize: '2.4rem', marginBottom: '12px' }}>
              {biometricPromptAvail ? '🧑' : '👆'}
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>
              Enable faster access?
            </div>
            <div style={{ fontSize: '0.85rem', color: '#8b9ab0', lineHeight: 1.5, marginBottom: '24px' }}>
              Use your device {biometricPromptAvail ? 'Face ID' : 'fingerprint'} to unlock PRISM instead of signing in each time.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={async () => {
                  // Verify the biometric actually works BEFORE enabling it —
                  // otherwise we'd lock the user out next launch with a sensor
                  // that errors. Only persist the preference on a real success.
                  const result = await promptBiometricDetailed('Confirm to enable biometric unlock')
                  if (result.success) {
                    setBiometricEnabled(true)
                    setShowBiometricPrompt(false)
                    addToast('success', biometricPromptAvail ? 'Face ID enabled' : 'Fingerprint enabled')
                  } else if (result.cancelled) {
                    setShowBiometricPrompt(false)
                  } else {
                    addToast('error', 'Could not verify biometric. Not enabled.')
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: 'none',
                  background: '#FC4100',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.92rem',
                  cursor: 'pointer',
                }}
              >
                Enable {biometricPromptAvail ? 'Face ID' : 'Fingerprint'}
              </button>
              <button
                onClick={() => setShowBiometricPrompt(false)}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'transparent',
                  color: '#8b9ab0',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Not now
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  )
}

function App() {
  return (
    <I18nProvider>
      <Router>
        <AppContent />
      </Router>
    </I18nProvider>
  )
}

export default App
