import { useEffect, useState } from 'react'
import { BarcodeScanner } from '@capacitor-community/barcode-scanner'

export default function Scanner({ onResult }: { onResult: (code: string) => void }) {
  const [permission, setPermission] = useState<boolean>(false)
  const [active, setActive] = useState<boolean>(false)

  useEffect(() => {
    return () => {
      if (active) {
        BarcodeScanner.stopScan().catch(() => {})
        BarcodeScanner.showBackground()
      }
    }
  }, [active])

  async function start() {
    const status = await BarcodeScanner.checkPermission({ force: true })
    setPermission(!!status.granted)
    if (!status.granted) return

    await BarcodeScanner.hideBackground()
    document.body.classList.add('qr-scanning')
    setActive(true)

    const result = await BarcodeScanner.startScan()
    setActive(false)
    BarcodeScanner.showBackground()
    document.body.classList.remove('qr-scanning')

    if (result.hasContent && result.content) onResult(result.content)
  }

  async function stop() {
    await BarcodeScanner.stopScan()
    BarcodeScanner.showBackground()
    setActive(false)
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>QR/KIMPER Scanner</h3>
      {!permission && <p>Camera permission is required.</p>}
      <button onClick={active ? stop : start}>{active ? 'Stop' : 'Start'} Scan</button>
    </div>
  )
}

