/**
 * Biometric authentication wrapper for PRISM mobile app.
 *
 * Provides a "professional app lock" experience: after the first normal login,
 * the user can opt in to unlock the app with Face ID / Fingerprint instead of
 * typing username/password every time.
 *
 * Uses @capgo/capacitor-native-biometric (Capacitor 5 compatible).
 * Samsung A15 supports both fingerprint and face unlock.
 */
import { NativeBiometric } from '@capgo/capacitor-native-biometric'

const BIOMETRIC_ENABLED_KEY = 'prism_biometric_enabled_v1'

export interface BiometricAvailability {
  isAvailable: boolean
  biometricType: 'face' | 'fingerprint' | 'none'
  hasCredentials: boolean
}

/**
 * Check whether this device supports biometric authentication.
 * Returns the specific type (face vs fingerprint) for UI messaging.
 */
export async function checkBiometricAvailability(): Promise<BiometricAvailability> {
  try {
    // useFallback:true lets the device passcode/PIN count as "available" so
    // we don't report unavailable on phones where only a weak face sensor is
    // enrolled or where the biometric is temporarily locked out.
    const result = await NativeBiometric.isAvailable({ useFallback: true })
    const isAvailable = result.isAvailable ?? false

    if (!isAvailable) {
      // errorCode tells us WHY (no hardware / not enrolled / locked out) —
      // surfacing it is the difference between "broken" and "diagnosable".
      console.warn('[biometric] Not available. errorCode:', (result as any).errorCode, result)
    }

    let biometricType: 'face' | 'fingerprint' | 'none' = 'none'
    if (isAvailable) {
      // Distinguish face vs fingerprint on Android (biometryType is iOS-specific)
      const type = String((result as any).biometryType ?? '').toLowerCase()
      if (type.includes('face')) {
        biometricType = 'face'
      } else if (type.includes('finger') || type.includes('touch')) {
        biometricType = 'fingerprint'
      } else {
        // Android often just returns "Biometry" — default to fingerprint
        // since it's the more common Samsung A15 sensor.
        biometricType = 'fingerprint'
      }
    }

    return { isAvailable, biometricType, hasCredentials: isAvailable }
  } catch (err) {
    console.warn('[biometric] Availability check failed:', err)
    return { isAvailable: false, biometricType: 'none', hasCredentials: false }
  }
}

/**
 * Prompt the native biometric dialog.
 * Returns true if the user successfully authenticated.
 */
export interface BiometricPromptResult {
  success: boolean
  /** true when the user explicitly cancelled (vs a hard failure) */
  cancelled: boolean
  errorCode?: number
  errorMessage?: string
}

export async function promptBiometricDetailed(
  reason = 'Unlock PRISM'
): Promise<BiometricPromptResult> {
  try {
    await NativeBiometric.verifyIdentity({
      reason,
      title: 'PRISM Authentication',
      subtitle: 'Verify your identity',
      description: 'Use your fingerprint, face, or device PIN to unlock PRISM',
      // useFallback lets the OS offer the device PIN/pattern if the biometric
      // sensor fails or the user can't use it — without this the prompt simply
      // errors out on many Android devices, which reads as "biometric broken".
      useFallback: true,
      maxAttempts: 3,
    })
    return { success: true, cancelled: false }
  } catch (err: any) {
    const msg = String(err?.message ?? '').toLowerCase()
    const code = err?.code ?? err?.errorCode
    // Codes 10/13/16 and "cancel"/"user cancel" text are user-initiated cancels.
    const cancelled =
      msg.includes('cancel') || code === 10 || code === 13 || code === 16
    if (cancelled) {
      console.log('[biometric] User cancelled biometric prompt')
    } else {
      console.warn('[biometric] Authentication failed. code:', code, 'msg:', err?.message)
    }
    return { success: false, cancelled, errorCode: code, errorMessage: err?.message }
  }
}

/** Backwards-compatible boolean wrapper. */
export async function promptBiometric(reason = 'Unlock PRISM'): Promise<boolean> {
  return (await promptBiometricDetailed(reason)).success
}

/**
 * Store the user's preference for enabling biometric lock.
 */
export function setBiometricEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, JSON.stringify(enabled))
  } catch {
    /* noop — restrictive profiles */ }
}

/**
 * Read whether the user has opted into biometric lock.
 */
export function isBiometricEnabled(): boolean {
  try {
    const raw = localStorage.getItem(BIOMETRIC_ENABLED_KEY)
    return raw ? JSON.parse(raw) === true : false
  } catch {
    return false
  }
}

/**
 * Remove biometric preference (e.g. on explicit logout).
 */
export function clearBiometricPreference(): void {
  try {
    localStorage.removeItem(BIOMETRIC_ENABLED_KEY)
  } catch {
    /* noop */ }
}
