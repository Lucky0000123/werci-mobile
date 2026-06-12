interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
}

interface ToastContainerProps {
  toasts: Toast[]
  onRemove: (id: string) => void
}

const toastConfig = {
  success: {
    icon: '✅',
    background: '#10B981',
    color: 'white'
  },
  error: {
    icon: '❌',
    background: '#EF4444',
    color: 'white'
  },
  warning: {
    icon: '⚠️',
    background: '#F59E0B',
    color: 'white'
  },
  info: {
    icon: 'ℹ️',
    background: '#FC4100',
    color: 'white'
  }
}

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '100px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1080,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: 'calc(100% - 32px)',
      maxWidth: '400px',
      pointerEvents: 'none'
    }}>
      {toasts.map((toast, index) => {
        const config = toastConfig[toast.type]
        
        return (
          <div
            key={toast.id}
            onClick={() => onRemove(toast.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 18px',
              background: config.background,
              color: config.color,
              borderRadius: '12px',
              fontSize: '0.9rem',
              fontWeight: 500,
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
              animation: `slideUp 0.3s ease-out ${index * 0.1}s both`,
              cursor: 'pointer',
              pointerEvents: 'auto'
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>{config.icon}</span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <span style={{ 
              fontSize: '1rem', 
              opacity: 0.7,
              marginLeft: '4px'
            }}>
              ✕
            </span>
          </div>
        )
      })}
    </div>
  )
}
