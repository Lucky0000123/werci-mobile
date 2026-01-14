import { useEffect, useState } from 'react'
import { connectionManager as cm } from '../services/connectionManager'
import './DiagnosticsPanel.css'

interface ResultRow {
  name: string
  url: string
  type: 'cloud' | 'local'
  available: boolean
  responseTime?: number
  statusCode?: number
  error?: string
}

export default function DiagnosticsPanel() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ResultRow[]>([])
  const [lastRun, setLastRun] = useState<number | null>(null)


  const run = async () => {
    setRunning(true)
    try {
      const diagnostics = await cm.diagnoseAllEndpoints(7000)
      const rows: ResultRow[] = diagnostics.map(d => ({
        name: d.endpoint.name,
        url: d.endpoint.url,
        type: d.endpoint.type,
        available: d.available,
        responseTime: d.responseTime,
        statusCode: d.statusCode,
        error: d.error
      }))
      setResults(rows)
      setLastRun(Date.now())
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    // auto-run on open
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copyReport = async () => {
    const lines = results.map(r => `${r.name} | ${r.url} | ${r.type} | ${r.available ? 'OK' : 'FAIL'} | time=${r.responseTime ?? '-'}ms | status=${r.statusCode ?? '-'} | error=${r.error ?? '-'}`)
    const header = 'WERCI Network Diagnostics\n' + (lastRun ? new Date(lastRun).toISOString() : '')
    const text = header + '\n' + lines.join('\n')
    try { await navigator.clipboard.writeText(text) } catch {}
    alert('Diagnostics copied to clipboard')
  }

  const activeEndpoint = cm.getActiveEndpoint()

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-container">
        <h3 className="diagnostics-header">
          🧪 Network Diagnostics
        </h3>
        <p className="diagnostics-description">
          Run connectivity tests against all configured endpoints and show exact errors.
        </p>

        <div className="diagnostics-actions">
          <button
            onClick={run}
            disabled={running}
            className={`diagnostics-button primary ${running ? 'loading' : ''}`}
          >
            {running ? 'Running…' : 'Run Diagnostics'}
          </button>
          <button onClick={copyReport} className="diagnostics-button secondary">
            Copy Report
          </button>
        </div>

        <div className="active-endpoint">
          <strong>Active endpoint:</strong> {activeEndpoint ?? 'None (offline)'}
        </div>

        <div className="diagnostics-table">
          <div className="table-header">
            <div>Name</div>
            <div>URL</div>
            <div>Type</div>
            <div>Time</div>
            <div>Result / Error</div>
          </div>
          {results.map((r, idx) => (
            <div key={idx} className="table-row">
              <div className="table-cell">{r.name}</div>
              <div className="table-cell" style={{ wordBreak: 'break-all' }}>{r.url}</div>
              <div className="table-cell">{r.type}</div>
              <div className="table-cell">{r.responseTime ?? '-'}ms</div>
              <div className="table-cell">
                {r.available ? (
                  <span className="status-success">
                    ✓ OK {r.statusCode ? `(HTTP ${r.statusCode})` : ''}
                  </span>
                ) : (
                  <span className="status-fail">
                    ✗ FAIL {r.statusCode ? `(HTTP ${r.statusCode})` : ''} {r.error ? `— ${r.error}` : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="diagnostics-notes">
          <strong>Notes:</strong> Emulator host alias is 10.0.2.2. If cloud URL fails with name resolution or HTTP on port 1433, supply a valid HTTP(S) API URL.
        </div>
      </div>
    </div>
  )
}

