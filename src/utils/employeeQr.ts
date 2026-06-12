const EMPLOYEE_VERIFY_PATHS = new Set([
  '/employee-card/verify',
  '/employee-card/verify/unified',
  '/card/verify',
  '/driver-card/verify',
])

export interface ParsedEmployeeVerifyQR {
  employeeId: string | null
  token: string | null
  personKey: string | null
  pathname: string
}

function normalizePath(pathname: string): string {
  if (!pathname) return '/'
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function getQrUrl(qrContent: string): URL | null {
  const trimmed = qrContent.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed, 'https://prism.local')
  } catch {
    return null
  }
}

export function isEmployeeCardVerifyQR(qrContent: string): boolean {
  const urlObj = getQrUrl(qrContent)
  if (!urlObj) return false

  return EMPLOYEE_VERIFY_PATHS.has(normalizePath(urlObj.pathname))
}

export function parseEmployeeCardVerifyQR(qrContent: string): ParsedEmployeeVerifyQR | null {
  const urlObj = getQrUrl(qrContent)
  if (!urlObj) return null

  const pathname = normalizePath(urlObj.pathname)
  if (!EMPLOYEE_VERIFY_PATHS.has(pathname)) {
    return null
  }

  const employeeId =
    urlObj.searchParams.get('employee_id')?.trim() ||
    urlObj.searchParams.get('id')?.trim() ||
    null

  const token = urlObj.searchParams.get('token')?.trim() || null
  const personKey = urlObj.searchParams.get('person_key')?.trim() || null

  return {
    employeeId,
    token,
    personKey,
    pathname,
  }
}