import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.prism.inspector',
  appName: 'PRISM',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#050a12',
      showSpinner: false,
      androidSplashResourceName: 'splash_dark',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: false,
      splashImmersive: false
    },
    Camera: {
      permissions: ['camera', 'photos']
    },
    BarcodeScanner: {
      permissions: ['camera']
    }
  }
};

export default config;
