import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DeviationForm from '../features/deviation/DeviationForm'
import type { EmployeeCardData, KimperMapping, PersonCardData } from '../services/offlineDataSync'
import type { DeviationFormData } from '../types/deviation'
import DeviationApiService from '../services/deviationApi'
import DeviationStorage from '../services/deviationStorage'
import { connectionManager } from '../services/connectionManager'
import { flushAllPending } from '../services/backgroundSync'
import { buildPersonDetailPath, getPersonLookupFromCardData } from '../utils/personRoute'
import './DeviationReportPage.css'

interface DeviationReportPageProps {
  kimper: KimperMapping | null
  onShowToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

interface EmployeeStateData {
  employee_id?: string
  id_number?: string
  name?: string
  ktp_number?: string
}

interface PersonIdentityState {
  person_key?: string
  employee_id?: string
  kimper_id?: number
  ktp_number?: string
  name?: string
}

export default function DeviationReportPage({ kimper, onShowToast }: DeviationReportPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [kimperData, setKimperData] = useState<KimperMapping | null>(kimper)
  const [personIdentity, setPersonIdentity] = useState<PersonIdentityState | undefined>(undefined)
  const [personInvolvedPrefill, setPersonInvolvedPrefill] = useState<{ name?: string; id?: string }>({
    name: kimper?.name || '',
    id: kimper?.id_number || ''
  })

  const personCardData = location.state?.personCardData as PersonCardData | undefined
  const navigateBack = () => {
    if (personCardData) {
      navigate(buildPersonDetailPath(getPersonLookupFromCardData(personCardData)), {
        state: { cardData: personCardData },
        replace: true,
      })
      return
    }

    navigate(-1)
  }

  useEffect(() => {
    const statePersonCardData = location.state?.personCardData as PersonCardData | undefined
    const stateEmployeeCardData = location.state?.employeeCardData as EmployeeCardData | undefined
    const stateKimper = location.state?.kimper as KimperMapping | undefined
    const stateEmployee = location.state?.employee as EmployeeStateData | undefined

    if (statePersonCardData) {
      const person = statePersonCardData.person
      setPersonIdentity({
        person_key: person?.person_key,
        employee_id: person?.employee_id || statePersonCardData.employee?.employee_id,
        kimper_id: person?.kimper_id ?? statePersonCardData.kimper?.kimper_id,
        ktp_number: person?.ktp_number || statePersonCardData.employee?.ktp_number,
        name: person?.name || statePersonCardData.employee?.name,
      })
      setPersonInvolvedPrefill({
        name: person?.name || statePersonCardData.employee?.name || '',
        id: person?.employee_id || statePersonCardData.employee?.employee_id || person?.ktp_number || '',
      })

      if (statePersonCardData.kimper?.kimper_id) {
        setKimperData({
          id: statePersonCardData.kimper.kimper_id,
          name: person?.name || statePersonCardData.employee?.name || '',
          id_number: statePersonCardData.employee?.employee_id || person?.ktp_number || '',
          department: person?.department,
          position: statePersonCardData.employee?.position || person?.position_title,
        } as KimperMapping)
      }
      return
    }

    if (stateEmployeeCardData) {
      setPersonIdentity({
        employee_id: stateEmployeeCardData.employee?.employee_id,
        ktp_number: stateEmployeeCardData.employee?.ktp_number,
        kimper_id: stateEmployeeCardData.kimper?.kimper_id,
        name: stateEmployeeCardData.employee?.name,
      })
      setPersonInvolvedPrefill({
        name: stateEmployeeCardData.employee?.name || '',
        id: stateEmployeeCardData.employee?.employee_id || stateEmployeeCardData.employee?.ktp_number || '',
      })

      if (stateEmployeeCardData.kimper?.kimper_id) {
        setKimperData({
          id: stateEmployeeCardData.kimper.kimper_id,
          name: stateEmployeeCardData.employee?.name || '',
          id_number: stateEmployeeCardData.employee?.employee_id || '',
          department: stateEmployeeCardData.employee?.department,
          position: stateEmployeeCardData.employee?.position,
        } as KimperMapping)
      }
      return
    }

    if (stateKimper) {
      setKimperData(stateKimper)
      setPersonIdentity({
        kimper_id: stateKimper.id,
        name: stateKimper.name,
      })
      setPersonInvolvedPrefill({
        name: stateKimper.name || '',
        id: stateKimper.id_number || ''
      })
      return
    }

    if (stateEmployee) {
      setPersonIdentity({
        employee_id: stateEmployee.employee_id,
        ktp_number: stateEmployee.ktp_number,
        name: stateEmployee.name,
      })
      setPersonInvolvedPrefill({
        name: stateEmployee.name || '',
        id: stateEmployee.employee_id || stateEmployee.id_number || ''
      })
    }
  }, [location.state])

  const saveDeviationOffline = async (formData: DeviationFormData) => {
    const photoBlobs: Blob[] = formData.photos

    const localId = await DeviationStorage.savePending(
      {
        kimper_id: formData.kimper_id,
        person_key: formData.person_key,
        employee_id: formData.employee_id,
        ktp_number: formData.ktp_number,
        person_involved_name: formData.person_involved_name,
        person_involved_id: formData.person_involved_id,
        deviation_date: formData.deviation_date,
        shift: formData.shift,
        location: formData.location,
        activity: formData.activity,
        deviation_description: formData.deviation_description,
        golden_rules_number: formData.golden_rules_number,
        immediate_action: formData.immediate_action,
        status: formData.status,
        reported_by: formData.reported_by,
        reporter_department: formData.reporter_department,
        contractor_name: formData.contractor_name,
        pic_name: formData.pic_name,
        language: formData.language
      },
      photoBlobs
    )

    console.log('Deviation saved offline:', localId)
    return localId
  }

  const handleSubmit = async (formData: DeviationFormData) => {
    try {
      const connectionStatus = await connectionManager.checkConnectivity()

      if (connectionStatus.isOnline) {
        const deviationId = await DeviationApiService.submitDeviation(formData)
        console.log('Deviation submitted successfully:', deviationId)
        onShowToast('success', `Deviation #${deviationId} saved successfully`)
      } else {
        await saveDeviationOffline(formData)
        onShowToast('info', 'Saved offline. Will sync when connected.')
        flushAllPending().catch(() => {})
      }

      navigateBack()
    } catch (error) {
      console.error('Error submitting deviation:', error)
      const reason = error instanceof Error && error.message ? error.message : 'network error'
      // Save offline as a safety net, but tell the user exactly why the live submit failed.
      await saveDeviationOffline(formData)
      onShowToast('warning', `Live submit failed (${reason}). Saved offline \u2014 will retry on next sync.`)
      flushAllPending().catch(() => {})
      navigateBack()
    }
  }

  const handleCancel = () => {
    navigateBack()
  }

  return (
    <div className="deviation-report-page" style={{
      padding: '16px',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '18px',
        padding: '14px 16px',
        marginBottom: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.26)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <button
            onClick={handleCancel}
            style={{
              width: '36px',
              height: '36px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.16)',
              borderRadius: '10px',
              cursor: 'pointer',
              color: '#f1f5f9',
              fontSize: '1rem'
            }}
          >
            {'<'}
          </button>
          <div>
            <h2 style={{
              fontSize: '1.18rem',
              fontWeight: 700,
              color: '#f1f5f9',
              margin: 0
            }}>
              Report Deviation
            </h2>
            {(kimperData || personInvolvedPrefill.name) && (
              <p style={{
                fontSize: '0.82rem',
                color: '#8b9ab0',
                margin: 0,
                marginTop: '3px'
              }}>
                {kimperData?.name || personInvolvedPrefill.name}
              </p>
            )}
          </div>
        </div>
      </div>

      <DeviationForm
        kimperData={kimperData ? {
          id: kimperData.id,
          name: kimperData.name,
          id_number: kimperData.id_number || '',
          position: kimperData.position || kimperData.department || ''
        } : undefined}
        personIdentity={personIdentity}
        initialPersonInvolved={personInvolvedPrefill}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  )
}
