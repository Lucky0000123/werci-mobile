import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { offlineDataSync, type OfflineSyncStatus, type SyncStatus } from '../services/offlineDataSync'
import { useI18n } from '../services/i18n-context'
import { authService } from '../services/auth'
import { apiFetch } from '../services/api'
import EmployeeSearch from '../components/EmployeeSearch'

interface PersonalKpiSummary {
  vehicles_scanned: number
  employee_cards_scanned: number
  inspections_performed: number
  deviations_found: number
}

const KPI_CACHE_KEY = 'prism_dashboard_kpi_v1'

interface CachedKpi {
  data: PersonalKpiSummary
  cachedAt: number
}

function readCachedKpi(): CachedKpi | null {
  try {
    const raw = localStorage.getItem(KPI_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedKpi
    if (!parsed || typeof parsed !== 'object' || !parsed.data) return null
    // Optional: treat stale cache as valid (show old data while refreshing)
    return parsed
  } catch {
    return null
  }
}

function writeCachedKpi(data: PersonalKpiSummary): void {
  try {
    localStorage.setItem(KPI_CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }))
  } catch { /* noop — quota or private mode */ }
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 }
  }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 350, damping: 26 }
  }
} as const

const statCardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 24 }
  }
} as const

export default function HomePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [syncStatus, setSyncStatus] = useState<OfflineSyncStatus | null>(null)
  const [summary, setSummary] = useState<PersonalKpiSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [memoryMode, setMemoryMode] = useState(false)

  const loadDashboard = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false

    if (!silent) {
      // Show full loader only when we have absolutely nothing to display
      const cached = readCachedKpi()
      if (!cached) {
        setIsLoading(true)
      }
    }
    if (silent) {
      setIsRefreshing(true)
    }
    setLoadError(null)

    try {
      const [status, token] = await Promise.all([
        offlineDataSync.getSyncStatus(),
        authService.getToken()
      ])

      setSyncStatus(status)
      setMemoryMode(offlineDataSync.isInMemoryMode())

      if (!token) {
        throw new Error('Login is required before loading your dashboard.')
      }

      const response = await apiFetch('/api/mobile/kpi/summary', { method: 'GET' }, { token })
      const result = await response.json().catch(() => null) as { success?: boolean; message?: string; data?: Partial<PersonalKpiSummary> } | null

      if (!response.ok || !result?.success || !result.data) {
        throw new Error(result?.message || 'Unable to load your latest KPI right now.')
      }

      const fresh: PersonalKpiSummary = {
        vehicles_scanned: Number(result.data.vehicles_scanned || 0),
        employee_cards_scanned: Number(result.data.employee_cards_scanned || 0),
        inspections_performed: Number(result.data.inspections_performed || 0),
        deviations_found: Number(result.data.deviations_found || 0)
      }

      setSummary(fresh)
      writeCachedKpi(fresh)
      setLoadError(null)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
      const msg = (error as Error).message || 'Unable to load your latest KPI right now.'
      // If we have cached data, keep showing it and only show a subtle error
      const cached = readCachedKpi()
      if (cached) {
        setSummary(cached.data)
        setLoadError(msg)
      } else {
        setLoadError(msg)
      }
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const handleSyncUpdate = (status: SyncStatus) => {
      if (status.status === 'complete' || status.status === 'error') {
        void loadDashboard({ silent: true })
      }
    }

    // 1. Instantly hydrate from cache so the UI never blanks
    const cached = readCachedKpi()
    if (cached) {
      setSummary(cached.data)
      setIsLoading(false)
    }

    // 2. Fetch fresh data in the background
    void loadDashboard({ silent: !!cached })
    offlineDataSync.addSyncListener(handleSyncUpdate)

    return () => {
      offlineDataSync.removeSyncListener(handleSyncUpdate)
    }
  }, [])

  const stats = [
    {
      label: t('employees'),
      value: summary?.employee_cards_scanned || 0,
      color: '#FFC55A'
    },
    {
      label: t('deviations'),
      value: summary?.deviations_found || 0,
      color: '#38bdf8'
    }
  ]

  if (isLoading) {
    return (
      <div style={{
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '16px'
      }}>
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="skeleton"
          style={{ width: '80px', height: '80px', borderRadius: '20px' }}
        />
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
          className="skeleton"
          style={{ width: '200px', height: '24px' }}
        />
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
          className="skeleton"
          style={{ width: '150px', height: '16px' }}
        />
      </div>
    )
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="home-page"
      style={{
        padding: '16px',
        maxWidth: '600px',
        margin: '0 auto',
        color: '#f1f5f9'
      }}
    >
      {/* Hero */}
      <motion.div
        variants={itemVariants}
        className="prism-hero"
        style={{ marginBottom: '14px', display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: '12px' }}
      >
        <div style={{ minWidth: 0 }}>
          <motion.div
            className="prism-hero__eyebrow"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
          >
            PRISM
          </motion.div>
          <h2 className="prism-hero__title">{t('dashboardTitle')}</h2>
          <p className="prism-hero__subtitle">
            {syncStatus?.lastSync
              ? `${t('lastSynced')}: ${new Date(syncStatus.lastSync).toLocaleString()}`
              : ''
            }
          </p>
        </div>
        <button
          onClick={() => navigate('/scan')}
          aria-label="Scan QR code"
          title="Scan QR"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            padding: '0 16px',
            background: 'linear-gradient(135deg, #FC4100, #C9340A)',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            fontSize: '0.86rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 6px 16px rgba(252,65,0,0.28)'
          }}
        >
          📷 Scan
        </button>
      </motion.div>

      {/* Error */}
      {/* Refreshing indicator */}
      {isRefreshing && (
        <motion.div
          variants={itemVariants}
          style={{
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontSize: '0.75rem',
            color: '#94a3b8'
          }}
        >
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            ↻
          </motion.span>
          Refreshing…
        </motion.div>
      )}

      {/* Error */}
      {loadError && (
        <motion.div
          variants={itemVariants}
          role="alert"
          style={{
            marginBottom: '14px',
            padding: '12px 14px',
            borderRadius: '14px',
            border: '1px solid rgba(239,68,68,0.24)',
            background: 'rgba(239,68,68,0.12)',
            color: '#fecaca',
            fontSize: '0.82rem'
          }}
        >
          {loadError}
        </motion.div>
      )}

      {/* Memory Mode */}
      {memoryMode && (
        <motion.div
          variants={itemVariants}
          role="status"
          style={{
            marginBottom: '14px',
            padding: '12px 14px',
            borderRadius: '14px',
            border: '1px solid rgba(252,65,0,0.32)',
            background: 'rgba(252,65,0,0.10)',
            color: '#fed7aa',
            fontSize: '0.78rem',
            lineHeight: 1.45
          }}
        >
          <div style={{ fontWeight: 700, color: '#FC4100', marginBottom: '4px' }}>
            ⚡ Memory-only mode
          </div>
          Offline storage is blocked by your browser — sync works but data is
          lost on refresh. To enable persistent offline use, try Incognito
          mode, disable conflicting extensions, or use the native APK.
        </motion.div>
      )}

      {/* Employee Lookup (moved here from the old Employee Card page) */}
      <motion.div variants={itemVariants}>
        <EmployeeSearch />
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        variants={containerVariants}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '12px',
          marginBottom: '14px'
        }}
      >
        {stats.map((stat, index) => (
          <motion.div
            key={index}
            variants={statCardVariants}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="prism-kpi"
            style={{ ['--kpi-accent' as string]: stat.color } as React.CSSProperties}
          >
            <motion.div
              className="prism-kpi__value"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.3 + index * 0.1 }}
            >
              {stat.value.toLocaleString()}
            </motion.div>
            <div className="prism-kpi__label">
              {stat.label}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Offline Data Card */}
      <motion.div
        variants={itemVariants}
        className="prism-card"
        style={{ padding: '16px', marginBottom: '14px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>Offline Data</div>
            <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
              Auto-refreshes every 2 hours. Manual sync available in Settings.
            </div>
          </div>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '12px' }}
        >
          {[
            { value: syncStatus?.kimperCount || 0, label: 'KIMPER', color: '#22c55e' },
            { value: syncStatus?.employeesCount || 0, label: t('employees'), color: '#FFC55A' }
          ].map((item, i) => (
            <motion.div
              key={i}
              variants={statCardVariants}
              whileHover={{ scale: 1.05 }}
              style={{
                padding: '12px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.05)',
                textAlign: 'center'
              }}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.4 + i * 0.08 }}
                style={{ fontSize: '1rem', fontWeight: 800, color: item.color }}
              >
                {item.value.toLocaleString()}
              </motion.div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{item.label}</div>
            </motion.div>
          ))}
        </motion.div>

        {syncStatus?.lastSync && (
          <div style={{ fontSize: '0.76rem', color: '#94a3b8', textAlign: 'center' }}>
            {`${t('lastSynced')}: ${new Date(syncStatus.lastSync).toLocaleString()}`}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
