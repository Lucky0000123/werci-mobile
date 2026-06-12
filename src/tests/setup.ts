import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Mock Capacitor Preferences (native plugin, UNIMPLEMENTED in jsdom).
// Backed by an in-memory map so auth session persistence works in tests.
vi.mock('@capacitor/preferences', () => {
  const store = new Map<string, string>()
  return {
    Preferences: {
      get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
      set: vi.fn(async ({ key, value }: { key: string; value: string }) => { store.set(key, value) }),
      remove: vi.fn(async ({ key }: { key: string }) => { store.delete(key) }),
      clear: vi.fn(async () => { store.clear() }),
    },
  }
})

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

// Mock IntersectionObserver (jsdom lacks it; framer-motion's viewport feature needs it)
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds = []
} as any
