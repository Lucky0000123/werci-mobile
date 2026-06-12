import { motion } from 'framer-motion'

export default function LoadingScreen() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#050a12',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
      }}
    >
      {/* Animated rings */}
      <div style={{ position: 'relative', width: '80px', height: '80px' }}>
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid #FC4100',
          }}
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
          style={{
            position: 'absolute',
            inset: '8px',
            borderRadius: '50%',
            border: '2px solid #FFC55A',
          }}
        />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          style={{
            position: 'absolute',
            inset: '16px',
            borderRadius: '50%',
            border: '3px solid transparent',
            borderTopColor: '#FC4100',
            borderRightColor: '#FC4100',
          }}
        />
      </div>

      {/* Text */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        style={{ textAlign: 'center' }}
      >
        <motion.span
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            fontSize: '0.85rem',
            color: '#8b9ab0',
            fontWeight: 600,
            letterSpacing: '3px',
            textTransform: 'uppercase',
          }}
        >
          PRISM
        </motion.span>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          style={{
            fontSize: '0.7rem',
            color: '#475569',
            marginTop: '8px',
            letterSpacing: '1px',
          }}
        >
          Loading experience...
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
