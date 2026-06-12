import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { KimperMapping } from '../services/offlineDataSync'
import KimperStatus from '../components/KimperStatus'

interface KimperCardPageProps {
  kimper: KimperMapping | null
  onReportDeviation: () => void
}

/**
 * Renders the KIMPER card for a scanned employee QR. Employee *search* lives
 * on the dashboard (HomePage) now — this page only exists as the landing spot
 * for QR-scan results that resolve to a KIMPER record.
 */
export default function KimperCardPage({ kimper, onReportDeviation }: KimperCardPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const kimperData: KimperMapping | null = location.state?.kimper || kimper

  useEffect(() => {
    if (!kimperData) navigate('/home', { replace: true })
  }, [kimperData, navigate])

  if (!kimperData) return null

  return (
    <KimperStatus
      kimper={kimperData}
      onClose={() => navigate('/home')}
      onReportDeviation={onReportDeviation}
    />
  )
}
