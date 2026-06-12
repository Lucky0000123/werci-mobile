import { Capacitor, registerPlugin } from '@capacitor/core'

type CameraPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'

interface PrismPermissionsPlugin {
  checkCameraPermission(): Promise<{ camera: CameraPermissionState }>
  requestCameraPermission(): Promise<{ camera: CameraPermissionState }>
  openAppSettings(): Promise<void>
}

const PrismPermissions = registerPlugin<PrismPermissionsPlugin>('PrismPermissions')

export async function ensureNativeCameraPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true

  try {
    const check = await PrismPermissions.checkCameraPermission()
    if (check.camera === 'granted') return true

    const request = await PrismPermissions.requestCameraPermission()
    return request.camera === 'granted'
  } catch (err) {
    console.warn('[Camera] Native permission check failed:', err)
    return false
  }
}

export async function openNativeAppSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await PrismPermissions.openAppSettings()
  } catch (err) {
    console.warn('[Camera] Could not open Android app settings:', err)
  }
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'))
    reader.readAsDataURL(file)
  })
}