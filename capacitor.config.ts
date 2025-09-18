import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.werci.inspector',
  appName: 'WERCI Inspector',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
