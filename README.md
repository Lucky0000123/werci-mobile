# WERCI Mobile App - Fleet Inspection

> **Offline-first mobile inspection app for iOS and Android**
>
> 📦 **Repository:** https://github.com/Lucky0000123/werci-mobile
>
> 🔧 **Status:** Production-ready | iOS & Android compatible

## ✨ Key Features

- ✅ **Offline-first architecture** - Works without internet connection
- ✅ **QR code scanning** - Scan vehicle QR codes with camera
- ✅ **Photo capture** - Take and upload inspection photos
- ✅ **Auto-sync** - Automatically syncs when back online
- ✅ **IndexedDB storage** - Stores data locally on device
- ✅ **Network detection** - Switches between company WiFi and cloud server
- ✅ **iOS & Android** - Single codebase for both platforms

## 📱 Technology Stack

**NOT React Native** - This is a **React + TypeScript + Capacitor** application:

- **React 18** - Modern React with hooks
- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling and HMR
- **Capacitor** - Native wrapper for Android/iOS deployment
- **Ionic Components** - Mobile-optimized UI components

### Why Capacitor (not React Native)?

Capacitor wraps a **web application** (React) into a native container, allowing:
- ✅ Single codebase for web and mobile
- ✅ Access to native device APIs (camera, storage, network)
- ✅ Faster development with web technologies
- ✅ Easy deployment to Android/iOS

## 🚀 Quick Start

### Development Server

```bash
npm install
npm run dev
```

### Build for Production

```bash
npm run build
```

### Build Android APK

```bash
# Sync web assets to Capacitor
npx cap sync android

# Build APK
cd android
./gradlew assembleRelease
```

## 📁 Project Structure

```
werci-mobile/
├── src/
│   ├── components/     # React components
│   ├── features/       # Feature modules
│   ├── services/       # API clients
│   └── tests/          # Unit tests
├── android/            # Capacitor Android project
├── capacitor.config.ts # Capacitor configuration
├── vite.config.ts      # Vite build config
└── package.json        # Dependencies
```

## 🔌 Backend Connection

The mobile app connects to the Flask backend API:

- **Company WiFi**: `http://10.40.21.184:8082/api`
- **Mobile Network**: `https://159.65.13.232/api`
- **Offline Mode**: Local IndexedDB cache

Network detection is automatic with intelligent failover.

## 📖 Original Vite Template Info

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
