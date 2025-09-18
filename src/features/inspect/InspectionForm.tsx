import { useState } from 'react'
import { Camera, CameraResultType } from '@capacitor/camera'
import { compressDataUrl } from '../../services/compress'
import { addPhoto, enqueue, setInspection } from '../../services/db'

function statusFromStars(stars: number): 'FAILED' | 'MODERATE' | 'PASS' {
  if (stars <= 2) return 'FAILED'
  if (stars === 3) return 'MODERATE'
  return 'PASS'
}

function calculateOverallRating(ratings: Record<string, number>): number {
  const values = Object.values(ratings)
  return Math.round(values.reduce((sum, val) => sum + val, 0) / values.length)
}

type InspectionCategory = 'tire' | 'brake' | 'lights' | 'engine' | 'body' | 'interior'

interface CategoryPhoto {
  id: string
  preview: string
  ratio: number
  category: InspectionCategory
}

export default function InspectionForm() {
  // Basic form data
  const [vehicleId, setVehicleId] = useState('')
  const [vehicleEquipNo, setVehicleEquipNo] = useState('')
  const [inspectorName, setInspectorName] = useState('')
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().split('T')[0])
  const [odometerReading, setOdometerReading] = useState('')
  const [notes, setNotes] = useState('')

  // Category ratings
  const [ratings, setRatings] = useState({
    tire: 3,
    brake: 3,
    lights: 3,
    engine: 3,
    body: 3,
    interior: 3
  })

  // Photos by category
  const [photos, setPhotos] = useState<CategoryPhoto[]>([])

  // Overall rating (calculated)
  const overallRating = calculateOverallRating(ratings)
  const overallStatus = statusFromStars(overallRating)

  async function capturePhoto(category: InspectionCategory) {
    try {
      const img = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        quality: 90,
        allowEditing: false
      })
      if (!img.dataUrl) return

      const { dataUrl, compressionRatio } = await compressDataUrl(img.dataUrl, 0.75)
      const newPhoto: CategoryPhoto = {
        id: crypto.randomUUID(),
        preview: dataUrl,
        ratio: compressionRatio,
        category
      }
      setPhotos(prev => [...prev, newPhoto])
    } catch (error) {
      console.error('Camera error:', error)
      alert('Camera access failed. Please check permissions.')
    }
  }

  async function submit() {
    // Validation
    if (!vehicleId.trim()) {
      alert('Please enter a Vehicle ID')
      return
    }
    if (!inspectorName.trim()) {
      alert('Please enter Inspector Name')
      return
    }

    const id = crypto.randomUUID()
    await setInspection({
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      vehicleId: vehicleId.trim(),
      vehicleEquipNo: vehicleEquipNo.trim(),
      inspectorName: inspectorName.trim(),
      inspectionDate,
      inspectionType: 'Mobile Inspection',
      status: overallStatus,
      overallStars: overallRating as 1 | 2 | 3 | 4 | 5,
      notes: notes.trim(),
      odometerReading: odometerReading ? parseInt(odometerReading) : undefined,
      tireCondition: ratings.tire as 1 | 2 | 3 | 4 | 5,
      brakeCondition: ratings.brake as 1 | 2 | 3 | 4 | 5,
      lightsWorking: ratings.lights as 1 | 2 | 3 | 4 | 5,
      engineCondition: ratings.engine as 1 | 2 | 3 | 4 | 5,
      bodyCondition: ratings.body as 1 | 2 | 3 | 4 | 5,
      interiorCondition: ratings.interior as 1 | 2 | 3 | 4 | 5,
      pendingSync: true,
    })
    await enqueue({ kind: 'inspection', refId: id, priority: 1 })

    // Save photos to DB and enqueue
    for (const photo of photos) {
      await addPhoto({
        id: photo.id,
        inspectionId: id,
        category: photo.category,
        mime: 'image/jpeg',
        dataURL: photo.preview,
        compressionRatio: photo.ratio,
        createdAt: Date.now(),
        pendingSync: true,
      })
      await enqueue({ kind: 'photo', refId: photo.id, priority: 3 })
    }

    alert(`✅ Inspection saved successfully!\n\nVehicle: ${vehicleId}\nRating: ${overallRating}/5 stars\nStatus: ${overallStatus}\nPhotos: ${photos.length}`)

    // Reset form
    setVehicleId('')
    setVehicleEquipNo('')
    setInspectorName('')
    setInspectionDate(new Date().toISOString().split('T')[0])
    setOdometerReading('')
    setNotes('')
    setRatings({ tire: 3, brake: 3, lights: 3, engine: 3, body: 3, interior: 3 })
    setPhotos([])
  }

  const inspectionCategories = [
    { key: 'tire' as const, label: 'Tire Condition', icon: '🛞' },
    { key: 'brake' as const, label: 'Brake System', icon: '🛑' },
    { key: 'lights' as const, label: 'Lights & Signals', icon: '💡' },
    { key: 'engine' as const, label: 'Engine Condition', icon: '⚙️' },
    { key: 'body' as const, label: 'Body Condition', icon: '🚗' },
    { key: 'interior' as const, label: 'Interior Condition', icon: '🪑' }
  ]

  const StarRating = ({ value, onChange }: { value: number, onChange: (rating: number) => void }) => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '8px 0' }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: star <= value ? '#FFD700' : '#DDD',
            padding: '4px'
          }}
        >
          ⭐
        </button>
      ))}
      <span style={{
        marginLeft: '8px',
        fontSize: '14px',
        color: value <= 2 ? '#e74c3c' : value === 3 ? '#f39c12' : '#27ae60',
        fontWeight: 'bold'
      }}>
        {value <= 2 ? 'Poor' : value === 3 ? 'Fair' : value === 4 ? 'Good' : 'Excellent'}
      </span>
    </div>
  )

  return (
    <div style={{
      padding: '16px',
      maxWidth: '600px',
      margin: '0 auto',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #2E7D32, #4CAF50)',
        color: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        textAlign: 'center'
      }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>🔍 WERCI Mobile Inspection</h2>
        <div style={{ fontSize: '16px', opacity: 0.9 }}>
          Overall Rating: {overallRating}/5 ⭐ | Status: <strong>{overallStatus}</strong>
        </div>
      </div>

      {/* Inspector Information */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#2E7D32', fontSize: '18px' }}>
          👤 Inspector Information
        </h3>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            Inspector Name *
          </label>
          <input
            type="text"
            value={inspectorName}
            onChange={(e) => setInspectorName(e.target.value)}
            placeholder="Enter your full name"
            style={{
              width: '100%',
              padding: '12px',
              border: '2px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            Inspection Date
          </label>
          <input
            type="date"
            value={inspectionDate}
            onChange={(e) => setInspectionDate(e.target.value)}
            style={{
              width: '100%',
              padding: '12px',
              border: '2px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
          />
        </div>
      </div>

      {/* Vehicle Information */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#2E7D32', fontSize: '18px' }}>
          🚗 Vehicle Information
        </h3>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            Vehicle ID *
          </label>
          <input
            type="text"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="Enter or scan vehicle ID"
            style={{
              width: '100%',
              padding: '12px',
              border: '2px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            Equipment Number
          </label>
          <input
            type="text"
            value={vehicleEquipNo}
            onChange={(e) => setVehicleEquipNo(e.target.value)}
            placeholder="Equipment number (optional)"
            style={{
              width: '100%',
              padding: '12px',
              border: '2px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
            Odometer Reading (km)
          </label>
          <input
            type="number"
            value={odometerReading}
            onChange={(e) => setOdometerReading(e.target.value)}
            placeholder="Current odometer reading"
            style={{
              width: '100%',
              padding: '12px',
              border: '2px solid #ddd',
              borderRadius: '8px',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
          />
        </div>
      </div>

      {/* Inspection Categories */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 20px 0', color: '#2E7D32', fontSize: '18px' }}>
          📋 Inspection Categories
        </h3>

        {inspectionCategories.map((category) => (
          <div key={category.key} style={{
            marginBottom: '24px',
            padding: '16px',
            border: '1px solid #eee',
            borderRadius: '8px',
            background: '#fafafa'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px'
            }}>
              <h4 style={{
                margin: 0,
                fontSize: '16px',
                color: '#333',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{ fontSize: '20px' }}>{category.icon}</span>
                {category.label}
              </h4>

              <button
                onClick={() => capturePhoto(category.key)}
                style={{
                  background: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                📸 Photo
              </button>
            </div>

            <StarRating
              value={ratings[category.key]}
              onChange={(rating) => setRatings(prev => ({ ...prev, [category.key]: rating }))}
            />

            {/* Show photos for this category */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              {photos
                .filter(photo => photo.category === category.key)
                .map((photo) => (
                  <div key={photo.id} style={{ position: 'relative' }}>
                    <img
                      src={photo.preview}
                      style={{
                        width: '80px',
                        height: '80px',
                        objectFit: 'cover',
                        borderRadius: '6px',
                        border: '2px solid #ddd'
                      }}
                    />
                    <div style={{
                      fontSize: '10px',
                      textAlign: 'center',
                      color: '#666',
                      marginTop: '2px'
                    }}>
                      {(photo.ratio * 100).toFixed(0)}%
                    </div>
                    <button
                      onClick={() => setPhotos(prev => prev.filter(p => p.id !== photo.id))}
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        background: '#e74c3c',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Notes Section */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#2E7D32', fontSize: '18px' }}>
          📝 Additional Notes
        </h3>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            overallRating <= 2
              ? "⚠️ Critical/Poor rating - Please describe issues in detail..."
              : overallRating === 3
              ? "⚠️ Fair rating - Please note any concerns..."
              : "Any observations or maintenance notes..."
          }
          style={{
            width: '100%',
            minHeight: '100px',
            padding: '12px',
            border: `2px solid ${overallRating <= 2 ? '#e74c3c' : overallRating === 3 ? '#f39c12' : '#ddd'}`,
            borderRadius: '8px',
            fontSize: '16px',
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Summary & Submit */}
      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#2E7D32', fontSize: '18px' }}>
          📊 Inspection Summary
        </h3>

        <div style={{
          background: '#f8f9fa',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
            {inspectionCategories.map((category) => (
              <div key={category.key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{category.icon} {category.label}:</span>
                <span style={{ fontWeight: 'bold' }}>{ratings[category.key]}/5</span>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '2px solid #ddd',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
              Overall Rating: {overallRating}/5 ⭐
            </div>
            <div style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: overallRating <= 2 ? '#e74c3c' : overallRating === 3 ? '#f39c12' : '#27ae60'
            }}>
              Status: {overallStatus}
            </div>
            <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
              Photos: {photos.length} captured
            </div>
          </div>
        </div>

        <button
          onClick={submit}
          style={{
            width: '100%',
            padding: '16px',
            background: 'linear-gradient(135deg, #2E7D32, #4CAF50)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(46, 125, 50, 0.3)'
          }}
        >
          💾 Save Inspection & Queue for Sync
        </button>
      </div>
    </div>
  )
}

