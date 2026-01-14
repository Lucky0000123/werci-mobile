import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // CRITICAL: Use relative paths for Capacitor Android/iOS
  server: {
    port: 5173,
    strictPort: true, // Fail if port 5173 is not available
    host: true // Allow external connections
  },
  optimizeDeps: {
    include: [
      '@capacitor-community/barcode-scanner',
      '@capacitor/camera',
      '@capacitor/device',
      '@capacitor/network',
      '@capacitor/preferences'
    ],
    force: true // Force re-optimization
  },
  build: {
    rollupOptions: {
      external: [],
      output: {
        manualChunks: undefined
      }
    }
  }
})
