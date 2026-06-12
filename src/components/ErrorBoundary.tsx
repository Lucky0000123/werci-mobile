import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('💥 ErrorBoundary caught an error:', error)
    console.error('📍 Component stack:', info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  handleHome = () => {
    this.setState({ hasError: false, error: null })
    window.location.hash = ''
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const message = this.state.error?.message || 'An unexpected error occurred'

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#050a12',
          color: '#f1f5f9',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.09)',
            borderRadius: '18px',
            padding: '28px 24px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.45)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 16px',
              borderRadius: '50%',
              background: 'rgba(252, 65, 0, 0.12)',
              border: '1px solid rgba(252, 65, 0, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
            }}
          >
            ⚠️
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 8px', color: '#f1f5f9' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#8b9ab0', margin: '0 0 4px', lineHeight: 1.5 }}>
            The screen ran into a problem and couldn't render.
          </p>
          <p
            style={{
              fontSize: '0.78rem',
              color: '#64748b',
              margin: '0 0 20px',
              wordBreak: 'break-word',
              fontFamily: 'JetBrains Mono, monospace',
              background: 'rgba(0,0,0,0.3)',
              padding: '8px 12px',
              borderRadius: '8px',
              maxHeight: '80px',
              overflow: 'auto',
            }}
          >
            {message}
          </p>
          <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
            <button
              onClick={this.handleRetry}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #FC4100 0%, #C9340A 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '12px',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(252, 65, 0, 0.4)',
              }}
            >
              Try Again
            </button>
            <button
              onClick={this.handleHome}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: 'transparent',
                color: '#f1f5f9',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: '12px',
                fontSize: '0.9rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Go to Home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
