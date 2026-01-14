# 📱 Deploy WERCI Inspector to Samsung A15 - Step by Step Guide

## ✅ **Build Status: READY TO DEPLOY!**

The app has been successfully built and synced with Android. Now we just need to deploy it to your Samsung A15.

---

## 🎯 **Quick Deployment Steps**

### **Option 1: Using Android Studio (Recommended)**

#### **Step 1: Open Android Studio**

1. **Launch Android Studio** from your Start Menu or Desktop
2. Click **"Open"** or **"Open an Existing Project"**
3. Navigate to and select this folder:
   ```
   D:\WORK\BACKUP_DATA\CODE_SERVER\Vechle Inspection\Vechle Inspection\werci-mobile\android
   ```
4. Click **"OK"**

#### **Step 2: Wait for Gradle Sync**

- Android Studio will automatically start syncing Gradle
- Look at the bottom status bar for progress
- Wait for **"Gradle sync finished"** message (2-5 minutes)
- ⚠️ **Do NOT proceed until sync is complete!**

#### **Step 3: Connect Your Samsung A15**

1. **Enable Developer Options on your phone:**
   - Go to **Settings** → **About Phone**
   - Tap **"Build Number"** 7 times
   - You'll see "You are now a developer!"

2. **Enable USB Debugging:**
   - Go to **Settings** → **Developer Options**
   - Turn on **"USB Debugging"**
   - Turn on **"Install via USB"** (if available)

3. **Connect via USB:**
   - Connect your Samsung A15 to PC with USB cable
   - On your phone, allow USB debugging when prompted
   - Select **"File Transfer"** or **"MTP"** mode

4. **Verify Connection:**
   - In Android Studio, look at the device dropdown (top toolbar)
   - You should see your Samsung A15 listed
   - If not, click the dropdown and select your device

#### **Step 4: Run the App**

1. **Click the green "Run" button** (▶️) in the toolbar
   - Or press **Shift + F10**

2. **Select your Samsung A15** from the device list

3. **Wait for installation:**
   - Android Studio will build and install the app
   - This may take 2-5 minutes on first run
   - Watch the "Run" panel at the bottom for progress

4. **App will launch automatically** on your phone!

---

### **Option 2: Manual APK Installation**

If Android Studio doesn't work, you can manually install the APK:

#### **Step 1: Build APK via Command Line**

Open a terminal in the `werci-mobile` folder and run:
```bash
cd android
gradlew assembleDebug
```

Or use the batch file:
```bash
build-apk.bat
```

#### **Step 2: Find the APK**

The APK will be located at:
```
werci-mobile\android\app\build\outputs\apk\debug\app-debug.apk
```

#### **Step 3: Transfer to Phone**

**Option A: USB Transfer**
1. Connect phone via USB
2. Copy `app-debug.apk` to your phone's Downloads folder

**Option B: Email/Cloud**
1. Email the APK to yourself
2. Or upload to Google Drive/OneDrive
3. Download on your phone

#### **Step 4: Install on Phone**

1. Open the APK file on your phone
2. If prompted, allow installation from unknown sources:
   - Settings → Security → Unknown Sources → Enable
   - Or Settings → Apps → Special Access → Install Unknown Apps → Enable for your file manager
3. Tap **"Install"**
4. Tap **"Open"** when installation completes

---

## 🧪 **Testing the App**

Once installed, test these features:

### **1. App Launch**
- ✅ App should open without login screen
- ✅ Should show "WERCK Inspector" header
- ✅ Should display connection status chip

### **2. QR Scanner**
- ✅ Tap the **"📱 Scan QR Code"** button
- ✅ Grant camera permission when prompted
- ✅ Point camera at a vehicle QR code
- ✅ Should scan and show vehicle details

### **3. Offline Mode**
- ✅ Turn off WiFi and mobile data
- ✅ App should still work
- ✅ Should show "Offline" status
- ✅ Can still scan QR codes and create inspections

### **4. Photo Upload**
- ✅ Create an inspection
- ✅ Tap "Add Photo"
- ✅ Grant camera/storage permissions
- ✅ Take a photo
- ✅ Photo should be saved

### **5. Data Sync**
- ✅ Turn WiFi back on
- ✅ Tap the sync button
- ✅ Offline data should sync to server

---

## 🔧 **Troubleshooting**

### **Problem: Android Studio doesn't detect phone**

**Solution:**
1. Unplug and replug USB cable
2. Try a different USB cable
3. Try a different USB port
4. On phone: Disable and re-enable USB debugging
5. On phone: Change USB mode to "File Transfer" or "PTP"
6. Install Samsung USB drivers on PC

### **Problem: "App not installed" error**

**Solution:**
1. Uninstall any previous version of WERCK Inspector
2. Clear package installer cache:
   - Settings → Apps → Package Installer → Storage → Clear Cache
3. Try installing again

### **Problem: Camera permission denied**

**Solution:**
1. Go to Settings → Apps → WERCK Inspector → Permissions
2. Enable Camera permission
3. Enable Storage permission
4. Restart the app

### **Problem: QR scanner not working**

**Solution:**
1. Make sure camera permission is granted
2. Try scanning in good lighting
3. Hold phone steady
4. Make sure QR code is clear and not damaged

---

## 📊 **App Information**

- **App Name:** WERCK Inspector
- **Package ID:** com.werck.inspector
- **Version:** 1.0.0
- **Build Type:** Debug (for testing)
- **Min Android:** 5.0 (API 21)
- **Target Android:** 14 (API 34)

---

## 🚀 **What's Next?**

After successful deployment and testing:

1. **Test all features** thoroughly
2. **Report any bugs** you find
3. **Provide feedback** on user experience
4. **Test in real-world scenarios** (actual vehicle inspections)

---

## 📝 **Build Information**

✅ **Web Assets Built:** `dist/` folder  
✅ **Android Synced:** `android/app/src/main/assets/public`  
✅ **Capacitor Plugins:** 6 plugins installed  
✅ **Ready for Deployment:** YES

---

## 🎉 **You're All Set!**

The app is ready to deploy. Just follow the steps above to install it on your Samsung A15!

**Need help?** Let me know if you encounter any issues during deployment.

---

**Last Updated:** 2025-11-08  
**Build Status:** ✅ Success  
**Deployment Method:** Android Studio or Manual APK

