# 📋 WERCI Inspector - Deployment Checklist

## ✅ **Current Status: Android Studio Installed**

Follow these steps in order:

---

## 📱 **Step 1: Prepare Samsung A15** (5 minutes)

### **Enable Developer Options:**
- [ ] Open **Settings** on Samsung A15
- [ ] Go to **"About phone"**
- [ ] Find **"Build number"**
- [ ] Tap it **7 times** rapidly
- [ ] See message: "You are now a developer!"

### **Enable USB Debugging:**
- [ ] Go back to **Settings**
- [ ] Find **"Developer options"** (now visible)
- [ ] Turn ON **"USB debugging"**
- [ ] Turn ON **"Install via USB"** (if available)

### **Connect Phone:**
- [ ] Connect Samsung A15 to PC with USB cable
- [ ] On phone: Allow USB debugging popup
- [ ] Check **"Always allow from this computer"**
- [ ] Tap **"Allow"** or **"OK"**
- [ ] Select **"File Transfer"** mode

### **Verify Connection:**
- [ ] Run `CHECK_DEVICE.bat` in werci-mobile folder
- [ ] Should see Samsung A15 listed
- [ ] Status should NOT be "unauthorized"

---

## 💻 **Step 2: Open Project in Android Studio** (2 minutes)

### **Option A: Automatic (Recommended)**
- [ ] Navigate to: `werci-mobile` folder
- [ ] Double-click: `OPEN_IN_ANDROID_STUDIO.bat`
- [ ] Android Studio should open with the project

### **Option B: Manual**
- [ ] Launch Android Studio
- [ ] Click **"Open"**
- [ ] Navigate to: `werci-mobile\android`
- [ ] Click **"OK"**

---

## ⏳ **Step 3: Wait for Gradle Sync** (2-5 minutes)

- [ ] Look at **bottom status bar** in Android Studio
- [ ] See: "Gradle sync in progress..."
- [ ] **WAIT** for completion (don't click anything!)
- [ ] See: "Gradle sync finished" ✅

**Common Issues:**
- If sync fails, check internet connection
- If errors appear, click "Try Again"
- First sync takes longer (downloads dependencies)

---

## 🔍 **Step 4: Verify Device in Android Studio** (1 minute)

- [ ] Look at **top toolbar**
- [ ] Find **device dropdown** (next to Run button ▶️)
- [ ] Click the dropdown
- [ ] See **Samsung A15** or **SM-A155F** listed
- [ ] Select your device if not already selected

**If device not listed:**
- [ ] Run `CHECK_DEVICE.bat` to verify connection
- [ ] Unplug and replug USB cable
- [ ] Check USB debugging is enabled
- [ ] Try different USB port
- [ ] Restart Android Studio

---

## ▶️ **Step 5: Build and Deploy** (3-5 minutes)

- [ ] Click green **"Run"** button (▶️) in toolbar
  - Or press **Shift + F10**
- [ ] If prompted, select **Samsung A15** from device list
- [ ] Click **"OK"**

### **Watch Build Progress:**
- [ ] See "Building..." in bottom panel
- [ ] See "BUILD SUCCESSFUL" message
- [ ] See "Installing APK..."
- [ ] See "Launching app..."
- [ ] App opens on Samsung A15! 🎉

**Build Time:**
- First build: 3-5 minutes
- Subsequent builds: 30-60 seconds

---

## 🧪 **Step 6: Test the App** (5 minutes)

### **Initial Launch:**
- [ ] App opens without login screen
- [ ] See "WERCK Inspector" header
- [ ] See connection status chip

### **Grant Permissions:**
- [ ] Tap **"📱 Scan QR Code"** button
- [ ] Popup: "Allow WERCK Inspector to take pictures and record video?"
- [ ] Tap **"Allow"** or **"While using the app"**
- [ ] Camera opens for QR scanning ✅

### **Test QR Scanner:**
- [ ] Point camera at any QR code
- [ ] Should scan and detect QR code
- [ ] Scanner should work smoothly

### **Test Offline Mode:**
- [ ] Turn OFF WiFi on phone
- [ ] Turn OFF Mobile Data
- [ ] App should still work
- [ ] See "Offline" status indicator
- [ ] Can still navigate and use features

### **Test Photo Capture:**
- [ ] Create a test inspection
- [ ] Tap "Add Photo"
- [ ] Take a photo
- [ ] Photo should be saved

### **Test Sync:**
- [ ] Turn WiFi back ON
- [ ] Tap sync button (if visible)
- [ ] Data should sync to server

---

## ✅ **Success Criteria**

The deployment is successful if:

- ✅ App installs without errors
- ✅ App launches without login
- ✅ QR scanner works (camera permission granted)
- ✅ Can create inspections
- ✅ Can take photos
- ✅ Works in offline mode
- ✅ No crashes or freezes

---

## 🐛 **Troubleshooting**

### **Problem: Gradle sync fails**
**Solution:**
```
1. Check internet connection
2. In Android Studio: File → Invalidate Caches → Invalidate and Restart
3. Delete: werci-mobile\android\.gradle folder
4. Sync again
```

### **Problem: Device not detected**
**Solution:**
```
1. Run CHECK_DEVICE.bat
2. Enable USB debugging on phone
3. Try different USB cable
4. Install Samsung USB drivers
5. Restart Android Studio
```

### **Problem: Build fails with errors**
**Solution:**
```
1. Read error message in Build panel
2. Click "Build → Clean Project"
3. Click "Build → Rebuild Project"
4. Try running again
```

### **Problem: App crashes on launch**
**Solution:**
```
1. Check Android Studio Logcat panel for errors
2. Uninstall app from phone
3. Rebuild and reinstall
4. Check if all permissions are granted
```

### **Problem: Camera permission denied**
**Solution:**
```
1. On phone: Settings → Apps → WERCK Inspector
2. Tap "Permissions"
3. Enable "Camera"
4. Enable "Storage" or "Files and media"
5. Restart app
```

---

## 📊 **Deployment Summary**

| Step | Task | Time | Status |
|------|------|------|--------|
| 1 | Prepare Samsung A15 | 5 min | ⏳ |
| 2 | Open in Android Studio | 2 min | ⏳ |
| 3 | Gradle Sync | 2-5 min | ⏳ |
| 4 | Verify Device | 1 min | ⏳ |
| 5 | Build & Deploy | 3-5 min | ⏳ |
| 6 | Test App | 5 min | ⏳ |
| **Total** | **End-to-End** | **~20 min** | ⏳ |

---

## 🎯 **Next Steps After Successful Deployment**

Once the app is working:

1. **Test in Real Scenarios:**
   - Use actual vehicle QR codes
   - Perform real inspections
   - Test photo uploads
   - Test offline → online sync

2. **Report Issues:**
   - Note any bugs or crashes
   - Check error messages in Logcat
   - Document steps to reproduce

3. **Gather Feedback:**
   - Is the UI intuitive?
   - Are features working as expected?
   - Any missing functionality?

4. **Plan Improvements:**
   - Based on testing feedback
   - Performance optimizations
   - UI/UX enhancements

---

## 📁 **Useful Files**

- `OPEN_IN_ANDROID_STUDIO.bat` - Quick launcher
- `CHECK_DEVICE.bat` - Verify phone connection
- `DEPLOY_TO_SAMSUNG_A15.md` - Detailed guide
- `MOBILE_APP_DEPLOYMENT_READY.md` - Technical summary

---

## 📞 **Need Help?**

If you encounter any issues:

1. Check the troubleshooting section above
2. Run `CHECK_DEVICE.bat` to verify connection
3. Check Android Studio's "Build" and "Logcat" panels for errors
4. Let me know the specific error message

---

**Last Updated:** 2025-11-08  
**Status:** Ready for Deployment  
**Estimated Time:** ~20 minutes  
**Device:** Samsung A15

---

## 🚀 **Ready to Start?**

Begin with **Step 1: Prepare Samsung A15** and work through each step in order.

Good luck! 🎉

