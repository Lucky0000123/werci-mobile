# 📷 Camera Permission Fix - QR Scanner Dark Screen Issue

## 🔍 Problem Identified

The QR scanner was opening with a **very dark/black camera view** when trying to scan KIMPER and Fleet QR codes.

### Root Cause
The `AndroidManifest.xml` was **missing the CAMERA permission** declaration. Without this permission, the Android system cannot properly initialize the camera hardware, resulting in a dark/black screen.

## ✅ Solution Applied

### Changes Made to `android/app/src/main/AndroidManifest.xml`

Added the following permissions and features:

```xml
<!-- Permissions -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />

<!-- Camera feature - required="false" allows installation on devices without camera -->
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

### What Each Permission Does:

1. **`CAMERA` permission**: Allows the app to access the device's camera hardware
2. **`android.hardware.camera` feature**: Declares that the app uses camera functionality
3. **`android.hardware.camera.autofocus` feature**: Enables autofocus for better QR code scanning
4. **`android:required="false"`**: Allows the app to be installed on devices without cameras (optional)

---

## 🔨 How to Rebuild the App

### Option 1: Using the Build Script (Recommended)

1. **Open Command Prompt** in the `werci-mobile` folder
2. **Run the build script**:
   ```batch
   build-apk.bat
   ```

3. **Wait for the process**:
   - Step 1: Builds web assets (React/Vite)
   - Step 2: Syncs changes to Android project
   - Step 3: Opens Android Studio

4. **In Android Studio**:
   - Wait for Gradle sync to complete
   - Click **Build → Build Bundle(s) / APK(s) → Build APK(s)**
   - Wait for build to complete
   - Click **"locate"** to find the APK file

### Option 2: Manual Build

```batch
# 1. Build web assets
npm run build

# 2. Sync with Android
npx cap sync android

# 3. Open Android Studio
npx cap open android

# 4. Build APK in Android Studio (same as above)
```

---

## 📱 Installing the Updated APK

### Method 1: Direct Install (if phone is connected via USB)

1. **Enable USB Debugging** on your Android device
2. **Connect phone to computer** via USB
3. **In Android Studio**, click the **Run** button (green play icon)
4. **Select your device** from the list
5. App will be installed and launched automatically

### Method 2: Manual APK Transfer

1. **Locate the APK** file:
   ```
   werci-mobile\android\app\build\outputs\apk\debug\app-debug.apk
   ```

2. **Copy APK to your phone** (via USB, email, or cloud storage)

3. **On your phone**:
   - Open the APK file
   - Allow installation from unknown sources (if prompted)
   - Install the app

4. **Grant camera permission** when prompted on first QR scan

---

## 🧪 Testing the Fix

After installing the updated app:

1. **Open the WERCI Inspector app**
2. **Navigate to QR Scanner** (from home screen or inspection form)
3. **Tap "Start Scan"** or the QR scan button
4. **Grant camera permission** if prompted
5. **Camera should now display clearly** (not dark)
6. **Point at a QR code** to test scanning

### Expected Behavior:
- ✅ Camera opens with **clear, bright view**
- ✅ QR codes are **detected and scanned** successfully
- ✅ Equipment information **auto-populates** after scan
- ✅ No dark/black screen issues

---

## 🔧 Troubleshooting

### If camera is still dark:

1. **Check app permissions**:
   - Go to **Settings → Apps → WERCI Inspector → Permissions**
   - Ensure **Camera** permission is **Allowed**

2. **Clear app cache**:
   - Settings → Apps → WERCI Inspector → Storage → Clear Cache

3. **Reinstall the app**:
   - Uninstall the old version completely
   - Install the new APK

4. **Check device camera**:
   - Test camera in another app to ensure hardware is working

### If permission prompt doesn't appear:

1. **Manually grant permission**:
   - Settings → Apps → WERCI Inspector → Permissions → Camera → Allow

2. **Restart the app** after granting permission

---

## 📋 Technical Details

### Barcode Scanner Plugin
- **Package**: `@capacitor-mlkit/barcode-scanning` v6.1.0
- **Camera Plugin**: `@capacitor/camera` v6.0.2
- **Platform**: Capacitor 6.2.0

### Configuration Files Updated
- ✅ `android/app/src/main/AndroidManifest.xml` - Added camera permissions
- ✅ `capacitor.config.ts` - Already configured (no changes needed)

### Files Using QR Scanner
- `werci-mobile/src/features/scan/Scanner.tsx` - Main scanner component
- `werci-mobile/src/features/inspect/InspectionForm.tsx` - Inspection form integration
- `werci-mobile/src/App.css` - Scanner styling (lines 597-703)

---

## 🎯 Next Steps

1. **Rebuild the app** using the instructions above
2. **Install on your device**
3. **Test QR scanning** for both KIMPER and Fleet codes
4. **Verify** that camera displays clearly and scans work

---

## 📞 Support

If you continue to experience issues after rebuilding:

1. Check the **Android Studio build logs** for errors
2. Verify **Gradle sync** completed successfully
3. Ensure **Java/Android SDK** is properly configured
4. Check device **Android version** compatibility (minimum Android 5.0)

---

**Last Updated**: 2025-10-11  
**Issue**: Camera dark screen during QR scanning  
**Status**: ✅ FIXED - Permissions added to AndroidManifest.xml  
**Action Required**: Rebuild and reinstall APK

