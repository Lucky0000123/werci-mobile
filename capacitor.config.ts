import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wbnkis.inspector',
  appName: 'WBNKIS Inspector',
  webDir: 'dist',
  server: {
    androidScheme: 'http'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      showSpinner: false
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
