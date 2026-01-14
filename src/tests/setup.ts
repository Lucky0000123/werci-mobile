import { expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Cleanup after each test case
afterEach(() => {
  cleanup()
})

// Mock IndexedDB
global.indexedDB = {
  open: () => ({
    onsuccess: null,
    onerror: null,
    result: {
      createObjectStore: () => ({}),
      transaction: () => ({
        objectStore: () => ({
          add: () => ({}),
          get: () => ({}),
          put: () => ({}),
          delete: () => ({})
        })
      })
    }
  })
} as any

// Mock Capacitor
declare global {
  var Capacitor: any
}

global.Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web'
}
