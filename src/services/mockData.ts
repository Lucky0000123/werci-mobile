// Mock data for testing WERCI mobile app sync functionality
// This provides sample data when the database is empty or inaccessible

export interface MockVehicle {
  equip_no: string
  description: string
  company: string
  manufacturer: string
  unit_model: string
  commissioning_date: string
  year: number
  commissioning_status: string
  expired_date: string
  location?: string
}

export interface MockKimper {
  name: string
  id_number: string
  company: string
  department: string
  kimper_expired_date: string
  status: string
}

export interface MockInspection {
  id: number
  equip_no: string
  inspection_date: string
  inspector_name: string
  status: string
  star_rating: number
}

// Sample vehicle data with proper status distribution
export const mockVehicles: MockVehicle[] = [
  {
    equip_no: 'EX001',
    description: 'Excavator CAT 320D',
    company: 'Weda Bay Nickel',
    manufacturer: 'Caterpillar',
    unit_model: '320D',
    commissioning_date: '2023-01-15',
    year: 2023,
    commissioning_status: 'Active',
    expired_date: '2025-01-15',
    location: 'Mining Site A'
  },
  {
    equip_no: 'DT002',
    description: 'Dump Truck Volvo A40G',
    company: 'Weda Bay Nickel',
    manufacturer: 'Volvo',
    unit_model: 'A40G',
    commissioning_date: '2022-06-10',
    year: 2022,
    commissioning_status: 'Active',
    expired_date: '2024-12-10',
    location: 'Mining Site B'
  },
  {
    equip_no: 'BD003',
    description: 'Bulldozer CAT D8T',
    company: 'Contractor ABC',
    manufacturer: 'Caterpillar',
    unit_model: 'D8T',
    commissioning_date: '2021-03-20',
    year: 2021,
    commissioning_status: 'Expired',
    expired_date: '2024-03-20',
    location: 'Workshop'
  },
  {
    equip_no: 'LD004',
    description: 'Loader CAT 966M',
    company: 'Weda Bay Nickel',
    manufacturer: 'Caterpillar',
    unit_model: '966M',
    commissioning_date: '2023-08-05',
    year: 2023,
    commissioning_status: 'Active',
    expired_date: '2025-08-05',
    location: 'Mining Site C'
  },
  {
    equip_no: 'GR005',
    description: 'Grader CAT 140M',
    company: 'Contractor XYZ',
    manufacturer: 'Caterpillar',
    unit_model: '140M',
    commissioning_date: '2022-11-12',
    year: 2022,
    commissioning_status: 'Active',
    expired_date: '2024-11-12',
    location: 'Road Maintenance'
  },
  {
    equip_no: 'CR006',
    description: 'Crane Liebherr LTM 1050',
    company: 'Weda Bay Nickel',
    manufacturer: 'Liebherr',
    unit_model: 'LTM 1050',
    commissioning_date: '2023-04-18',
    year: 2023,
    commissioning_status: 'Active',
    expired_date: '2025-04-18',
    location: 'Construction Site'
  },
  {
    equip_no: 'WT007',
    description: 'Water Truck Volvo FM',
    company: 'Contractor ABC',
    manufacturer: 'Volvo',
    unit_model: 'FM 400',
    commissioning_date: '2020-09-25',
    year: 2020,
    commissioning_status: 'Expired',
    expired_date: '2023-09-25',
    location: 'Maintenance Bay'
  },
  {
    equip_no: 'GN008',
    description: 'Generator CAT C18',
    company: 'Weda Bay Nickel',
    manufacturer: 'Caterpillar',
    unit_model: 'C18',
    commissioning_date: '2023-07-08',
    year: 2023,
    commissioning_status: 'Active',
    expired_date: '2025-07-08',
    location: 'Power Station'
  }
]

// Sample KIMPER data with proper status distribution
export const mockKimper: MockKimper[] = [
  {
    name: 'Ahmad Suryanto',
    id_number: 'KMP001',
    company: 'Weda Bay Nickel',
    department: 'Mining Operations',
    kimper_expired_date: '2025-03-15',
    status: 'Active'
  },
  {
    name: 'Budi Hartono',
    id_number: 'KMP002',
    company: 'Contractor ABC',
    department: 'Heavy Equipment',
    kimper_expired_date: '2024-12-20',
    status: 'Active'
  },
  {
    name: 'Citra Dewi',
    id_number: 'KMP003',
    company: 'Weda Bay Nickel',
    department: 'Safety & Environment',
    kimper_expired_date: '2024-08-10',
    status: 'Expired'
  },
  {
    name: 'Dedi Kurniawan',
    id_number: 'KMP004',
    company: 'Contractor XYZ',
    department: 'Construction',
    kimper_expired_date: '2025-06-05',
    status: 'Active'
  },
  {
    name: 'Eka Pratama',
    id_number: 'KMP005',
    company: 'Weda Bay Nickel',
    department: 'Maintenance',
    kimper_expired_date: '2024-11-30',
    status: 'Active'
  },
  {
    name: 'Fitri Sari',
    id_number: 'KMP006',
    company: 'Contractor ABC',
    department: 'Logistics',
    kimper_expired_date: '2023-12-15',
    status: 'Expired'
  }
]

// Sample recent inspections
export const mockInspections: MockInspection[] = [
  {
    id: 1,
    equip_no: 'EX001',
    inspection_date: '2024-09-20',
    inspector_name: 'Ahmad Suryanto',
    status: 'completed',
    star_rating: 4
  },
  {
    id: 2,
    equip_no: 'DT002',
    inspection_date: '2024-09-19',
    inspector_name: 'Budi Hartono',
    status: 'completed',
    star_rating: 5
  },
  {
    id: 3,
    equip_no: 'BD003',
    inspection_date: '2024-09-18',
    inspector_name: 'Citra Dewi',
    status: 'completed',
    star_rating: 2
  },
  {
    id: 4,
    equip_no: 'LD004',
    inspection_date: '2024-09-17',
    inspector_name: 'Dedi Kurniawan',
    status: 'completed',
    star_rating: 4
  }
]

// Utility functions for status calculations
export function getStatusColor(status: string, expiredDate: string): string {
  if (status === 'Expired') return '#ef4444' // red
  
  const today = new Date()
  const expiry = new Date(expiredDate)
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  if (daysUntilExpiry < 0) return '#ef4444' // red - expired
  if (daysUntilExpiry <= 30) return '#f59e0b' // amber - expiring soon
  return '#10b981' // green - active
}

export function getDaysRemaining(expiredDate: string): number {
  const today = new Date()
  const expiry = new Date(expiredDate)
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function getStatusText(status: string, expiredDate: string): string {
  if (status === 'Expired') return 'Expired'
  
  const daysRemaining = getDaysRemaining(expiredDate)
  
  if (daysRemaining < 0) return `Overdue by ${Math.abs(daysRemaining)} days`
  if (daysRemaining <= 30) return `Expires in ${daysRemaining} days`
  return `Active (${daysRemaining} days remaining)`
}
