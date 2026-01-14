# WERCI Mobile App - Deployment Guide

**Date:** 2025-10-10  
**Version:** 1.0.0  
**Status:** ✅ Ready for Deployment

---

## 📱 **App Information**

- **App Name:** WERCI Inspector
- **Package ID:** com.werck.inspector
- **Version:** 1.0.0
- **Platform:** Android
- **Framework:** React + Capacitor + Ionic PWA Elements

---

## 🔧 **Production Configuration**

### API Endpoints
```
Primary (Cloud):    http://159.65.13.232:8080
Fallback (Local):   http://10.40.21.184:8080
SQL Server:         sql.werci.my.id:1434 (via Cloudflare Tunnel)
```

### Features Enabled
- ✅ Offline Mode
- ✅ Photo Capture & Upload
- ✅ QR Code Scanning
- ✅ Auto-sync every 5 minutes
- ✅ Device Authentication
- ✅ Secure Token Management

---

## 🚀 **Deployment Methods**

### Method 1: Build APK via Android Studio (RECOMMENDED)

#### Step 1: Build Web Assets
```bash
cd werci-mobile
npm run build:prod
```

#### Step 2: Sync with Android
```bash
npx cap sync android
```

#### Step 3: Open in Android Studio
```bash
npx cap open android
```

#### Step 4: Build APK in Android Studio
1. Wait for Gradle sync to complete
2. Click **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
3. Wait for build to complete (2-5 minutes)
4. Click **locate** to find the APK
5. APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

#### Step 5: For Release APK (Signed)
1. Click **Build** → **Generate Signed Bundle / APK**
2. Select **APK**
3. Create or select keystore
4. Fill in key details
5. Select **release** build variant
6. Click **Finish**

---

### Method 2: Build via Command Line (If Java is configured)

```bash
cd werci-mobile

# Build production assets
npm run build:prod

# Sync with Android
npx cap sync android

# Build APK
cd android
gradlew assembleRelease
cd ..

# APK location
# android\app\build\outputs\apk\release\app-release-unsigned.apk
```

---

### Method 3: Quick Build Script

Run the provided batch file:
```bash
.\build-production-apk.bat
```

---

## 📦 **APK Output Locations**

### Debug APK (Unsigned)
```
android\app\build\outputs\apk\debug\app-debug.apk
```

### Release APK (Unsigned)
```
android\app\build\outputs\apk\release\app-release-unsigned.apk
```

### Release APK (Signed)
```
android\app\build\outputs\apk\release\app-release.apk
```

---

## 📲 **Installation Methods**

### Method 1: ADB Install (USB Debugging)
```bash
# Enable USB debugging on Android device
# Connect device via USB

# Install APK
adb install android\app\build\outputs\apk\debug\app-debug.apk

# Or for release
adb install android\app\build\outputs\apk\release\app-release.apk
```

### Method 2: Direct Transfer
1. Copy APK to device (via USB, email, cloud storage)
2. On device, enable **Settings** → **Security** → **Install from Unknown Sources**
3. Open APK file on device
4. Tap **Install**

### Method 3: HTTP Server
```bash
# Start HTTP server in werci-mobile directory
python -m http.server 8888

# On Android device browser, navigate to:
# http://YOUR_PC_IP:8888/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🔐 **App Signing (For Production Release)**

### Generate Keystore (First Time Only)
```bash
keytool -genkey -v -keystore werci-release-key.keystore -alias werci -keyalg RSA -keysize 2048 -validity 10000
```

### Sign APK
```bash
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 -keystore werci-release-key.keystore android\app\build\outputs\apk\release\app-release-unsigned.apk werci
```

### Verify Signature
```bash
jarsigner -verify -verbose -certs android\app\build\outputs\apk\release\app-release-unsigned.apk
```

### Optimize APK (zipalign)
```bash
zipalign -v 4 android\app\build\outputs\apk\release\app-release-unsigned.apk android\app\build\outputs\apk\release\app-release.apk
```

---

## ✅ **Pre-Deployment Checklist**

- [x] Production environment variables configured (.env.production)
- [x] API endpoints verified
- [x] SQL Server connection tested (via Cloudflare Tunnel)
- [x] Web assets built successfully
- [x] Android sync completed
- [ ] APK built successfully
- [ ] APK tested on physical device
- [ ] All features working (camera, QR scanner, offline mode)
- [ ] Network switching tested (cloud ↔ local)
- [ ] Data sync verified
- [ ] App signed for production (if releasing to Play Store)

---

## 🧪 **Testing Checklist**

### Basic Functionality
- [ ] App launches successfully
- [ ] Login/device authentication works
- [ ] Vehicle list loads
- [ ] Search and filter work
- [ ] Inspection form opens

### Camera & QR
- [ ] Camera permission granted
- [ ] Photo capture works
- [ ] Photos save to device
- [ ] QR code scanner opens
- [ ] QR codes scan correctly

### Network & Sync
- [ ] Cloud API connection works
- [ ] Local API fallback works
- [ ] Offline mode activates when no network
- [ ] Data syncs when back online
- [ ] Auto-sync works (every 5 minutes)

### Data Persistence
- [ ] Offline data saves to IndexedDB
- [ ] Data persists after app restart
- [ ] Sync queue processes correctly
- [ ] No data loss during sync

---

## 🐛 **Troubleshooting**

### Build Fails
- Check Node.js version (16+ required)
- Run `npm install` to ensure dependencies
- Clear build cache: `rm -rf android/build`
- Clean Gradle: `cd android && gradlew clean`

### APK Won't Install
- Enable "Install from Unknown Sources"
- Check Android version (minimum API 22 / Android 5.1)
- Uninstall previous version first
- Check APK signature

### App Crashes on Launch
- Check logcat: `adb logcat | grep WERCI`
- Verify permissions in AndroidManifest.xml
- Check API endpoints are accessible
- Verify SQL Server connection

### Camera/QR Not Working
- Grant camera permission in app settings
- Check AndroidManifest.xml has camera permissions
- Test on physical device (not emulator)

---

## 📊 **App Permissions Required**

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

---

## 🌐 **Backend Requirements**

### DigitalOcean API Server
- **URL:** http://159.65.13.232:8080
- **Status:** Must be running
- **Endpoints:** /api/mobile/*

### SQL Server (via Cloudflare Tunnel)
- **Hostname:** sql.werci.my.id:1434
- **Status:** Tunnel must be active
- **Database:** Safety
- **Tables:** fleet_vehicle, KIMPER_DATABASE, users, photo_assets

### Cloudflare Tunnel
- **Service:** Must be running on Windows
- **Connections:** 4 active edge connections required
- **Verify:** `cloudflared tunnel list`

---

## 📈 **Next Steps After Deployment**

1. **User Testing**
   - Deploy to 2-3 test users
   - Collect feedback
   - Monitor for crashes

2. **Performance Monitoring**
   - Check API response times
   - Monitor sync performance
   - Track offline usage

3. **Updates**
   - Increment version number
   - Rebuild and redistribute
   - Consider Play Store deployment

4. **Play Store Deployment** (Optional)
   - Create Google Play Developer account ($25 one-time)
   - Prepare store listing (screenshots, description)
   - Upload signed APK/AAB
   - Submit for review

---

## 📞 **Support**

For issues or questions:
- Check logs: `adb logcat`
- Review API logs on DigitalOcean
- Check SQL Server connection
- Verify Cloudflare Tunnel status

---

**Status:** ✅ App is ready for deployment via Android Studio!

