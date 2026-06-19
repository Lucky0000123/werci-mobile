// Cab / kiosk mode. When enabled, the in-cab tablet never shows the username/
// password screen: the app silently authenticates as a configured SERVICE
// ACCOUNT (the dispatch APIs still need a valid token) and opens straight to the
// Dispatch "Enter Employee ID" screen. Operators only ever type their employee
// ID — no per-person password.
//
// Configure at BUILD time via werci-mobile/.env.local (gitignored):
//   VITE_CAB_MODE=1
//   VITE_CAB_USERNAME=<dispatch service account username>
//   VITE_CAB_PASSWORD=<that account's password>
//
// SECURITY NOTE: these credentials are inlined into the app bundle, so anyone
// with the tablet (or the APK) can act as that account. Use a DEDICATED,
// low-privilege account — not a personal admin login.
const truthy = (v: unknown) =>
  v === true || ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase())

export const CAB_MODE = truthy(import.meta.env.VITE_CAB_MODE)
export const CAB_USERNAME = String(import.meta.env.VITE_CAB_USERNAME ?? '').trim()
export const CAB_PASSWORD = String(import.meta.env.VITE_CAB_PASSWORD ?? '')

// Only treat the app as a cab when mode is on AND credentials are present, so a
// half-configured build safely falls back to the normal login screen.
export const cabConfigured = CAB_MODE && CAB_USERNAME.length > 0 && CAB_PASSWORD.length > 0

// Where the cab lands after the silent login.
export const CAB_HOME_ROUTE = '/dispatch'
