# 🚀 QUICK START - Rebuild App to Fix Camera Issue

## ⚡ TL;DR - What You Need to Do

The camera permission has been added to fix the dark camera issue. **You need to rebuild the app** for the fix to take effect.

---

## 🎯 Quick Rebuild (3 Steps)

### Step 1: Open Command Prompt
```batch
# Navigate to the werci-mobile folder
cd "d:\CODE_SERVER\Vechle Inspection\Vechle Inspection\werci-mobile"
```

### Step 2: Run Build Script
```batch
build-apk.bat
```

### Step 3: Build in Android Studio
When Android Studio opens:
1. ✅ Wait for Gradle sync (bottom status bar)
2. ✅ Click **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
3. ✅ Wait for "BUILD SUCCESSFUL" message
4. ✅ Click **"locate"** link to find the APK

---

## 📱 Install the New APK

### Option A: USB Install (Fastest)
1. Connect phone via USB
2. Enable USB Debugging on phone
3. In Android Studio, click **Run** (green play button)
4. Select your device
5. Done! App installs automatically

### Option B: Manual Install
1. Find APK at: `android\app\build\outputs\apk\debug\app-debug.apk`
2. Copy to phone (USB/email/cloud)
3. Open APK on phone
4. Install
5. Grant camera permission when prompted

---

## ✅ Test the Fix

1. Open WERCI Inspector app
2. Tap QR Scanner button
3. Grant camera permission (if prompted)
4. **Camera should now be BRIGHT and CLEAR** ✨
5. Scan a KIMPER or Fleet QR code
6. Equipment data should auto-populate

---

## 🔧 What Was Fixed

✅ Added `CAMERA` permission to AndroidManifest.xml  
✅ Added camera hardware feature declarations  
✅ Optimized CSS for better camera rendering  
✅ Removed conflicting styles

---

## 📞 If You Need Help

See detailed guides:
- **[CAMERA_PERMISSION_FIX.md](./CAMERA_PERMISSION_FIX.md)** - Complete fix documentation
- **[QR_SCANNER_FIX_SUMMARY.md](./QR_SCANNER_FIX_SUMMARY.md)** - Technical details

---

## ⏱️ Estimated Time

- Build: **3-5 minutes**
- Install: **1-2 minutes**
- **Total: ~5-7 minutes**

---

**Ready? Run `build-apk.bat` now!** 🚀

