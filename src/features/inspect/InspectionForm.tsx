import { useState } from 'react'
import { Camera, CameraResultType } from '@capacitor/camera'
import { compressDataUrl } from '../../services/compress'
import { addPhoto, enqueue, setInspection } from '../../services/db'

function statusFromStars(stars: number): 'FAILED' | 'MODERATE' | 'PASS' {
  if (stars <= 2) return 'FAILED'
  if (stars === 3) return 'MODERATE'
  return 'PASS'
}

export default function InspectionForm() {
  const [vehicleId, setVehicleId] = useState('')
  const [stars, setStars] = useState(3)
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<{ preview: string; ratio: number }[]>([])

  async function capture() {
    const img = await Camera.getPhoto({ resultType: CameraResultType.DataUrl, quality: 90 })
    if (!img.dataUrl) return
    const { dataUrl, compressionRatio } = await compressDataUrl(img.dataUrl, 0.75)
    setPhotos((p) => [...p, { preview: dataUrl, ratio: compressionRatio }])
  }

  async function submit() {
    const id = crypto.randomUUID()
    await setInspection({
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      vehicleId,
      status: statusFromStars(stars),
      stars: stars as 1 | 2 | 3 | 4 | 5,
      notes,
      pendingSync: true,
    })
    await enqueue({ kind: 'inspection', refId: id, priority: 1 })

    // Save photos to DB and enqueue
    for (const p of photos) {
      const pid = crypto.randomUUID()
      await addPhoto({
        id: pid,
        inspectionId: id,
        category: 'general',
        mime: 'image/jpeg',
        dataURL: p.preview,
        compressionRatio: p.ratio,
        createdAt: Date.now(),
        pendingSync: true,
      })
      await enqueue({ kind: 'photo', refId: pid, priority: 3 })
    }

    alert('Inspection saved locally and queued for sync.')
    setVehicleId('')
    setStars(3)
    setNotes('')
    setPhotos([])
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>New Inspection</h3>
      <label>
        Vehicle ID
        <input value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} />
      </label>

      <div>
        <span>Stars: </span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} style={{ fontWeight: stars === n ? 'bold' : 'normal' }}>
            {n}
          </button>
        ))}
        <span style={{ marginLeft: 8 }}>Status: {statusFromStars(stars)}</span>
      </div>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div style={{ margin: '8px 0' }}>
        <button onClick={capture}>Add Photo</button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {photos.map((p, i) => (
            <div key={i}>
              <img src={p.preview} width={120} />
              <div style={{ fontSize: 12 }}>ratio {(p.ratio * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={submit}>Save & Queue</button>
    </div>
  )
}

