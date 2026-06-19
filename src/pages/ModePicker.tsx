import { motion } from 'framer-motion'
import prismLogo from '../assets/Logo1_splash.png'
import { useDispatchT } from '../services/dispatchI18n'

// First screen (shown when there's no active session): choose how this device is
// used. "User" → the normal username/password login → the full app. "FMS" →
// silently sign in as the in-cab service account → the Dispatch board only.
interface ModePickerProps {
  onPickUser: () => void
  onPickFms: () => void
  fmsAvailable: boolean
  fmsError?: boolean
}

export default function ModePicker({ onPickUser, onPickFms, fmsAvailable, fmsError }: ModePickerProps) {
  const dt = useDispatchT()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#050a12' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: '100%', maxWidth: '440px', background: 'rgba(12,18,28,0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px', padding: '28px', boxShadow: '0 24px 60px rgba(0,0,0,0.38)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
          <img src={prismLogo} alt="PRISM" style={{ width: '170px', height: '48px', objectFit: 'contain' }} />
        </div>
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <h1 style={{ margin: '0 0 8px', color: '#f8fafc', fontSize: '1.4rem' }}>{dt('mode_q')}</h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>{dt('mode_sub')}</p>
        </div>

        {fmsError && (
          <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.24)', color: '#fca5a5', fontSize: '0.85rem', marginBottom: '14px' }}>
            {dt('mode_fms_err')}
          </div>
        )}

        <div style={{ display: 'grid', gap: '14px' }}>
          <motion.button
            type="button"
            onClick={onPickUser}
            whileTap={{ scale: 0.98 }}
            style={cardBtn('#FC4100')}
          >
            <span style={{ fontSize: '1.7rem', lineHeight: 1 }}>👤</span>
            <span style={{ display: 'grid', gap: '2px' }}>
              <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{dt('mode_user')}</span>
              <span style={{ fontSize: '0.82rem', opacity: 0.85, fontWeight: 500 }}>{dt('mode_user_desc')}</span>
            </span>
          </motion.button>

          {fmsAvailable && (
            <motion.button
              type="button"
              onClick={onPickFms}
              whileTap={{ scale: 0.98 }}
              style={cardBtn('#2563EB')}
            >
              <span style={{ fontSize: '1.7rem', lineHeight: 1 }}>🚜</span>
              <span style={{ display: 'grid', gap: '2px' }}>
                <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{dt('mode_fms')}</span>
                <span style={{ fontSize: '0.82rem', opacity: 0.85, fontWeight: 500 }}>{dt('mode_fms_desc')}</span>
              </span>
            </motion.button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function cardBtn(accent: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '14px', width: '100%',
    padding: '18px', borderRadius: '16px', cursor: 'pointer', textAlign: 'left',
    color: '#f8fafc', background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${accent}55`,
  }
}
