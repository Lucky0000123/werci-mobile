import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // CRITICAL: Use relative paths for Capacitor Android/iOS
  server: {
    // Port 5180 — dedicated PRISM mobile dev port.
    // Avoids the ubiquitous 5173 / 19000 / 8081 defaults used by other Vite/Expo
    // projects, so the browser's per-origin IndexedDB storage stays isolated
    // from any stale state left behind by other apps.
    port: 5180,
    strictPort: true,
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
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      external: [],
      output: {
        // Split big, stable vendor libraries into their own chunks so the
        // browser caches them separately from app code — app updates no longer
        // force a re-download of React/router/animation. Route pages are
        // already lazy-loaded (see App.tsx), and @zxing rides along with the
        // lazy ScanPage chunk, so the scanner library only loads on demand.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-router')) return 'react-router'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react-vendor'
          if (id.includes('framer-motion') || id.includes('/motion-')) return 'motion'
          if (id.includes('/idb/')) return 'idb'
          return undefined
        }
      }
    }
  }
})
