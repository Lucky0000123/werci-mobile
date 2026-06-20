import { useState, useEffect, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import prismLogo from '../assets/Logo1_splash.png'
import { authService, type AuthenticatedUser } from '../services/auth'
import { useI18n, type Language } from '../services/i18n-context'
import {
  checkBiometricAvailability,
  isBiometricEnabled,
  promptBiometricDetailed,
} from '../services/biometricAuth'

interface LoginPageProps {
  onLoginSuccess: (user: AuthenticatedUser) => void
  onBack?: () => void
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 }
  }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 }
  }
} as const

const LOGIN_LANGS: { lang: Language; flag: string; label: string }[] = [
  { lang: 'id', flag: '🇮🇩', label: 'Indonesia' },
  { lang: 'en', flag: '🇬🇧', label: 'English' },
  { lang: 'zh', flag: '🇨🇳', label: '中文' },
]

export default function LoginPage({ onLoginSuccess, onBack }: LoginPageProps) {
  const { language, setLanguage } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Biometric quick-unlock: only offered when (a) the user previously enabled
  // it, (b) the device sensor is available, and (c) a stored session exists to
  // unlock into. Otherwise we just show the username/password form.
  const [bioType, setBioType] = useState<'face' | 'fingerprint' | null>(null)
  const [bioBusy, setBioBusy] = useState(false)

  useEffect(() => {
    let active = true
    const probe = async () => {
      try {
        if (!isBiometricEnabled()) return
        const token = await authService.getToken()
        const user = await authService.getCurrentUser()
        if (!token || !user) return // nothing to unlock into
        const avail = await checkBiometricAvailability()
        if (active && avail.isAvailable) {
          setBioType(avail.biometricType === 'face' ? 'face' : 'fingerprint')
        }
      } catch {
        /* biometric not usable — fall back to password form silently */
      }
    }
    probe()
    return () => { active = false }
  }, [])

  const handleBiometricUnlock = async () => {
    setBioBusy(true)
    setError(null)
    try {
      const result = await promptBiometricDetailed('Unlock PRISM')
      if (result.success) {
        const user = await authService.getCurrentUser()
        if (user) {
          onLoginSuccess(user)
          return
        }
        setError('Your saved session expired. Please sign in with your password.')
      } else if (!result.cancelled) {
        setError('Biometric unlock failed. Use your password instead.')
      }
    } catch {
      setError('Biometric unlock is unavailable right now.')
    } finally {
      setBioBusy(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!username.trim() || !password.trim()) {
      setError('Enter your username and password to continue.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const user = await authService.login(username.trim(), password)
      onLoginSuccess(user)
    } catch (loginError) {
      setError((loginError as Error).message || 'Unable to sign in right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#050a12' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: '100%', maxWidth: '420px', background: 'rgba(12,18,28,0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '28px', boxShadow: '0 24px 60px rgba(0, 0, 0, 0.38)' }}
      >
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Logo */}
          <motion.div variants={itemVariants} style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
            <motion.img
              src={prismLogo}
              alt="PRISM"
              style={{ width: '170px', height: '48px', objectFit: 'contain' }}
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            />
          </motion.div>

          {/* Language selector — pick the language to read this screen in. */}
          <motion.div variants={itemVariants} style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: '18px' }}>
            {LOGIN_LANGS.map(({ lang, flag, label }) => {
              const active = language === lang
              return (
                <button key={lang} type="button" onClick={() => setLanguage(lang)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                 padding: '7px 12px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 700,
                                 border: `1px solid ${active ? '#FC4100' : 'rgba(255,255,255,0.12)'}`,
                                 background: active ? 'rgba(252,65,0,0.16)' : 'rgba(255,255,255,0.03)',
                                 color: active ? '#fda07a' : '#94a3b8' }}>
                  <span style={{ fontSize: '0.95rem' }}>{flag}</span><span>{label}</span>
                </button>
              )
            })}
          </motion.div>

          {/* Title */}
          <motion.div variants={itemVariants} style={{ marginBottom: '20px', textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 8px', color: '#f8fafc', fontSize: '1.45rem' }}>Sign in</h1>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.92rem' }}>
              Login is required before using scan, inspections, and offline sync.
            </p>
          </motion.div>

          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
            {/* Username */}
            <motion.label variants={itemVariants} style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#cbd5e1', fontSize: '0.82rem', fontWeight: 600 }}>Username</span>
              <motion.input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                whileFocus={{ scale: 1.01, borderColor: '#FC4100' }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#f8fafc', fontSize: '0.95rem', outline: 'none' }}
              />
            </motion.label>

            {/* Password */}
            <motion.label variants={itemVariants} style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#cbd5e1', fontSize: '0.82rem', fontWeight: 600 }}>Password</span>
              <motion.input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                whileFocus={{ scale: 1.01, borderColor: '#FC4100' }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#f8fafc', fontSize: '0.95rem', outline: 'none' }}
              />
            </motion.label>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                role="alert"
                style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(239,68,68,0.12)',
                  border: '1px solid rgba(239,68,68,0.24)',
                  color: '#fca5a5',
                  fontSize: '0.86rem'
                }}
              >
                {error}
              </motion.div>
            )}

            {/* Submit Button */}
            <motion.div variants={itemVariants}>
              <motion.button
                type="submit"
                disabled={isSubmitting}
                whileHover={{ scale: isSubmitting ? 1 : 1.02, y: isSubmitting ? 0 : -1 }}
                whileTap={{ scale: isSubmitting ? 1 : 0.97 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                style={{
                  marginTop: '4px',
                  padding: '13px 16px',
                  borderRadius: '14px',
                  border: 'none',
                  background: isSubmitting ? '#9a3412' : '#FC4100',
                  color: 'white',
                  fontSize: '0.96rem',
                  fontWeight: 700,
                  cursor: isSubmitting ? 'progress' : 'pointer',
                  width: '100%',
                  boxShadow: isSubmitting ? 'none' : '0 4px 20px rgba(252, 65, 0, 0.35)',
                }}
              >
                <motion.span
                  animate={isSubmitting ? { opacity: [1, 0.6, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </motion.span>
              </motion.button>
            </motion.div>

            {/* Biometric quick-unlock (only when enabled + session present) */}
            {bioType && (
              <motion.div variants={itemVariants}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '6px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.10)' }} />
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>or</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.10)' }} />
                </div>
                <motion.button
                  type="button"
                  onClick={handleBiometricUnlock}
                  disabled={bioBusy}
                  whileHover={{ scale: bioBusy ? 1 : 1.02 }}
                  whileTap={{ scale: bioBusy ? 1 : 0.97 }}
                  style={{
                    padding: '13px 16px',
                    borderRadius: '14px',
                    border: '1px solid rgba(252, 65, 0, 0.4)',
                    background: 'rgba(252, 65, 0, 0.08)',
                    color: '#FC4100',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    cursor: bioBusy ? 'progress' : 'pointer',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                  }}
                >
                  <span style={{ fontSize: '1.3rem' }}>{bioType === 'face' ? '🧑' : '👆'}</span>
                  {bioBusy ? 'Verifying…' : `Unlock with ${bioType === 'face' ? 'Face ID' : 'Fingerprint'}`}
                </motion.button>
              </motion.div>
            )}
          </form>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{ marginTop: '16px', width: '100%', padding: '10px', background: 'transparent', border: 'none', color: '#64748b', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
            >
              ← Back to mode selection
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  )
}
