import { useState } from 'react'
import './App.css'
import Scanner from './features/scan/Scanner'
import InspectionForm from './features/inspect/InspectionForm'

function App() {
  const [view, setView] = useState<'home' | 'scan' | 'inspect'>('home')
  const [lastScan, setLastScan] = useState<string | null>(null)

  return (
    <div style={{ padding: 16 }}>
      <h2>WERCI Inspector</h2>
      {view === 'home' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setView('scan')}>Scan QR / KIMPER</button>
          <button onClick={() => setView('inspect')}>New Inspection</button>
        </div>
      )}

      {view === 'scan' && (
        <>
          <button onClick={() => setView('home')}>Back</button>
          <Scanner onResult={(c) => { setLastScan(c); alert('Scanned: ' + c); }} />
        </>
      )}

      {view === 'inspect' && (
        <>
          <button onClick={() => setView('home')}>Back</button>
          <InspectionForm />
        </>
      )}

      {lastScan && <div style={{ marginTop: 8, fontSize: 12 }}>Last scan: {lastScan}</div>}
    </div>
  )
}

export default App
