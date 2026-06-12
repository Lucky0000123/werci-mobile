import { describe, expect, it } from 'vitest'

import { isEmployeeCardVerifyQR, parseEmployeeCardVerifyQR } from '../utils/employeeQr'

describe('employee QR parser', () => {
  it('parses unified employee-card verify URLs', () => {
    const parsed = parseEmployeeCardVerifyQR(
      'https://example.com/employee-card/verify/unified?employee_id=60007696&token=abc12345&person_key=EMP%3A60007696'
    )

    expect(parsed).toEqual({
      employeeId: '60007696',
      token: 'abc12345',
      personKey: 'EMP:60007696',
      pathname: '/employee-card/verify/unified',
    })
  })

  it('parses current legacy employee-card verify URLs', () => {
    const parsed = parseEmployeeCardVerifyQR('/employee-card/verify?id=60007696&token=abc12345')

    expect(parsed?.employeeId).toBe('60007696')
    expect(parsed?.token).toBe('abc12345')
    expect(parsed?.pathname).toBe('/employee-card/verify')
  })

  it('parses older /card/verify QR URLs for backward compatibility', () => {
    const parsed = parseEmployeeCardVerifyQR('/card/verify?id=60007696&token=abc12345')

    expect(parsed?.employeeId).toBe('60007696')
    expect(parsed?.token).toBe('abc12345')
    expect(parsed?.pathname).toBe('/card/verify')
    expect(isEmployeeCardVerifyQR('/card/verify?id=60007696&token=abc12345')).toBe(true)
  })

  it('rejects unrelated QR payloads', () => {
    expect(isEmployeeCardVerifyQR('/employee/qr/60007696')).toBe(false)
    expect(parseEmployeeCardVerifyQR('/employee/qr/60007696')).toBeNull()
  })
})