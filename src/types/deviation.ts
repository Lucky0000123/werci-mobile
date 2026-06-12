/**
 * Personnel Deviation Types
 * Matches backend schema from app/models/personnel_deviation.py
 */

export interface PersonnelDeviation {
  id?: number
  kimper_id?: number
  person_key?: string
  employee_id?: string
  ktp_number?: string
  person_involved_name?: string
  person_involved_id?: string
  deviation_date: string // ISO datetime string
  shift?: string
  location: string
  activity?: string
  deviation_description: string
  golden_rules_number?: number
  immediate_action?: string
  status: 'Open' | 'In Progress' | 'Closed'
  reported_by: string
  reporter_department?: string
  contractor_name?: string
  pic_name?: string
  photos_json?: string // JSON array of photo paths
  created_at?: string
  synced_at?: string
  language: 'id' | 'en' | 'es' | 'zh'
}

export interface DeviationFormData {
  kimper_id?: number
  person_key?: string
  employee_id?: string
  ktp_number?: string
  person_involved_name?: string
  person_involved_id?: string
  deviation_date: string
  shift?: string
  location: string
  activity?: string
  deviation_description: string
  golden_rules_number?: number
  immediate_action?: string
  status: 'Open' | 'In Progress' | 'Closed'
  reported_by: string
  reporter_department?: string
  contractor_name?: string
  pic_name?: string
  photos: File[]
  language: 'id' | 'en' | 'es' | 'zh'
}

export interface DeviationListItem {
  id: number
  person_key?: string
  employee_id?: string
  kimper_id?: number
  ktp_number?: string
  deviation_date: string
  location: string
  description: string
  status: 'Open' | 'In Progress' | 'Closed'
  golden_rules_number?: number
}

export interface KimperData {
  id: number
  name: string
  id_number: string
  position: string
  department?: string
}
