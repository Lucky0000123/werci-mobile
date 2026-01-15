# 🍎 COMPLETE iOS BUILD INSTRUCTIONS FOR WERCI MOBILE APP

## 📋 MISSION OBJECTIVE
Build the WERCI Inspector iOS app on Mac, making it **identical** to the Android app already deployed. This is a complete, step-by-step guide that requires **NO prior iOS development experience**.

---

## ⚙️ PREREQUISITES - INSTALL THESE FIRST

### **1. Install Xcode (Required)**
```bash
# Open App Store on Mac
# Search for "Xcode"
# Click "Get" or "Install" (it's FREE but ~12GB download)
# Wait 30-60 minutes for installation
```

**After Xcode installs:**
```bash
# Open Terminal and run:
sudo xcodebuild -license accept
xcode-select --install
```

### **2. Install Homebrew (Package Manager)**
```bash
# Open Terminal and paste this:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Follow the on-screen instructions
# When done, verify:
brew --version
```

### **3. Install Node.js**
```bash
# Install Node.js via Homebrew:
brew install node

# Verify installation:
node --version  # Should show v18 or higher
npm --version   # Should show v9 or higher
```

### **4. Install Git**
```bash
# Install Git:
brew install git

# Configure Git with your details:
git config --global user.name "Rahul Dhiman"
git config --global user.email "rahul.dhiman0000123@gmail.com"

# Verify:
git --version
```

### **5. Install CocoaPods (iOS Dependency Manager)**
```bash
sudo gem install cocoapods
pod --version
```

---

## 📥 STEP 1: CLONE THE REPOSITORY

```bash
# Navigate to Desktop
cd ~/Desktop

# Clone the repository
git clone https://github.com/Lucky0000123/werci-mobile.git

# Navigate into the project
cd werci-mobile

# Verify you're in the right place
ls -la
# You should see: package.json, capacitor.config.ts, src/, android/, etc.
```

---

## 🔧 STEP 2: SETUP ENVIRONMENT VARIABLES

```bash
# Copy the example environment file
cp .env.example .env

# Open the .env file in a text editor
nano .env
```

### **Edit the .env file with these values:**

```env
# Backend Server URLs
VITE_LOCAL_BASE=http://10.40.20.184:8082
VITE_CLOUD_BASE=https://veterinary-gage-garage-categories.trycloudflare.com
VITE_LAN_BASE=http://172.17.132.7:8082

# App Configuration
VITE_APP_NAME=WERCK Inspector
VITE_APP_VERSION=1.0.2
```

**Save the file:**
- Press `Ctrl + O` (write out)
- Press `Enter` (confirm)
- Press `Ctrl + X` (exit)

**Verify the file was saved:**
```bash
cat .env
# Should show the values you just entered
```

---

## 📦 STEP 3: INSTALL DEPENDENCIES

```bash
# Make sure you're in the werci-mobile directory
cd ~/Desktop/werci-mobile

# Install Node.js dependencies (this takes 3-5 minutes)
npm install

# You should see a progress bar and eventually "added XXX packages"
```

**If you see any warnings about vulnerabilities, ignore them for now.**

---

## 🏗️ STEP 4: BUILD THE WEB ASSETS

```bash
# Build the React app
npm run build

# This creates the 'dist/' folder with compiled web assets
# Should take 30-60 seconds
# You should see: "✓ built in XXXms"
```

**Verify the build:**
```bash
ls -la dist/
# Should show: index.html, assets/, and other files
```

---

## 📱 STEP 5: ADD iOS PLATFORM

```bash
# Add iOS platform to the project
npx cap add ios

# This creates the 'ios/' folder with Xcode project
# Should take 1-2 minutes
```

**Verify iOS platform was added:**
```bash
ls -la ios/
# Should show: App/, App.xcodeproj/, App.xcworkspace/, Podfile
```

---

## 🔄 STEP 6: SYNC WEB ASSETS TO iOS

```bash
# Sync the built web assets to iOS native project
npx cap sync ios

# This copies dist/ files to ios/App/App/public/
# Should take 10-20 seconds
```

---

## 🎯 STEP 7: OPEN PROJECT IN XCODE

```bash
# Open the iOS project in Xcode
npx cap open ios

# Xcode should launch automatically
# If it doesn't, manually open: ios/App/App.xcworkspace
```

**⚠️ IMPORTANT:** Always open `App.xcworkspace`, NOT `App.xcodeproj`

---

## 🔐 STEP 8: CONFIGURE XCODE PROJECT

### **8.1 Select Development Team**

1. **In Xcode, click on "App" in the left sidebar** (blue icon at the top)
2. **Select "App" target** (under TARGETS)
3. **Go to "Signing & Capabilities" tab**
4. **Under "Team" dropdown:**
   - If you have an Apple Developer account: Select your team
   - If you DON'T have one: Select "Add an Account..." and sign in with your Apple ID
   - For testing on your own device, a FREE Apple ID works fine!

### **8.2 Change Bundle Identifier**

**Still in "Signing & Capabilities" tab:**

1. **Find "Bundle Identifier"** (currently shows: `com.wbnkis.inspector`)
2. **Change it to something unique:**
   ```
   com.yourcompany.werckinspector
   ```
   OR
   ```
   com.rahul.werckinspector
   ```

   **⚠️ IMPORTANT:** Must be unique and lowercase, no spaces!

### **8.3 Update App Display Name**

1. **Click on "App" in left sidebar again**
2. **Select "App" target**
3. **Go to "General" tab**
4. **Find "Display Name"** and set it to:
   ```
   WERCK Inspector
   ```

### **8.4 Set Deployment Target**

1. **Still in "General" tab**
2. **Find "Minimum Deployments"**
3. **Set "iOS" to:** `13.0` or higher

---

## 📲 STEP 9: CONNECT YOUR iPhone/iPad

### **9.1 Physical Connection**

1. **Connect your iPhone/iPad to Mac using USB cable**
2. **Unlock your device**
3. **On your iPhone/iPad, you'll see a popup: "Trust This Computer?"**
   - Tap **"Trust"**
   - Enter your device passcode if prompted

### **9.2 Select Device in Xcode**

1. **In Xcode, look at the top toolbar**
2. **Click the device dropdown** (next to the Run/Stop buttons)
3. **You should see your device name** (e.g., "Rahul's iPhone")
4. **Select your device**

**If you don't see your device:**
- Wait 10-20 seconds for Xcode to detect it
- Make sure device is unlocked
- Try unplugging and reconnecting
- Go to Window → Devices and Simulators to check

---

## ▶️ STEP 10: BUILD AND RUN THE APP

### **10.1 Build the App**

1. **Click the "Run" button** (▶️ play icon) in top-left of Xcode
2. **OR press:** `Cmd + R`

### **10.2 Wait for Build**

- **First build takes 3-5 minutes** (subsequent builds are faster)
- **You'll see progress in the top bar:** "Building... (X of Y tasks)"
- **Bottom panel shows build logs**

### **10.3 Handle Code Signing (First Time Only)**

**If you see an error about "Untrusted Developer":**

1. **On your iPhone/iPad:**
   - Go to **Settings → General → VPN & Device Management**
   - Find your Apple ID or developer profile
   - Tap it and tap **"Trust"**

2. **Try running again in Xcode**

### **10.4 App Launches!** 🎉

- **The app will automatically install and launch on your device**
- **You should see the WERCK Inspector splash screen**
- **Then the main app interface**

---

## ✅ STEP 11: VERIFY THE APP WORKS

### **Test These Features:**

1. **✅ App Opens** - WERCK Inspector logo and interface loads
2. **✅ Scan QR Code** - Click "Scan Commissioning QR" button
   - Camera should open
   - Point at a QR code to test scanning
3. **✅ Network Connectivity** - Check connection status indicator
   - Should show "Connected" or "Offline"
4. **✅ Inspection Form** - Try creating a test inspection
5. **✅ Photo Upload** - Test camera and photo upload functionality
6. **✅ Offline Mode** - Turn off WiFi/data and verify offline features work

### **Expected Behavior:**

- ✅ App looks identical to Android version
- ✅ All buttons and navigation work
- ✅ Camera/QR scanner works
- ✅ Can connect to backend server
- ✅ Offline mode stores data locally
- ✅ Sync works when back online

---

## 🔄 STEP 12: MAKING UPDATES (FUTURE CHANGES)

### **When Code is Updated on GitHub:**

```bash
# Navigate to project
cd ~/Desktop/werci-mobile

# Get latest changes from GitHub
git pull origin main

# Reinstall dependencies (if package.json changed)
npm install

# Rebuild web assets
npm run build

# Sync to iOS
npx cap sync ios

# Open in Xcode
npx cap open ios

# Click Run (▶️) to rebuild and install
```

---

## 📤 STEP 13: EXPORT FOR DISTRIBUTION (OPTIONAL)

### **For TestFlight (Beta Testing):**

1. **In Xcode, select "Any iOS Device (arm64)" from device dropdown**
2. **Go to:** Product → Archive
3. **Wait for archive to complete** (5-10 minutes)
4. **Organizer window opens automatically**
5. **Click "Distribute App"**
6. **Select "App Store Connect"**
7. **Follow the wizard to upload to TestFlight**

### **For Ad-Hoc Distribution (Direct Install):**

1. **Select "Any iOS Device (arm64)"**
2. **Product → Archive**
3. **Click "Distribute App"**
4. **Select "Ad Hoc"**
5. **Export and share the .ipa file**

---

## 🆘 TROUBLESHOOTING

### **Problem: "Command not found: npm"**
```bash
# Reinstall Node.js
brew install node
```

### **Problem: "Command not found: pod"**
```bash
# Reinstall CocoaPods
sudo gem install cocoapods
```

### **Problem: Build fails with "No such module 'Capacitor'"**
```bash
cd ios/App
pod install
cd ../..
npx cap sync ios
```

### **Problem: "Signing for 'App' requires a development team"**
- Go to Xcode → Preferences → Accounts
- Add your Apple ID
- Select it as the team in project settings

### **Problem: App crashes on launch**
```bash
# Clean build
# In Xcode: Product → Clean Build Folder (Shift + Cmd + K)
# Then rebuild: Cmd + R
```

### **Problem: "Unable to install app" on device**
- Delete the app from your device
- In Xcode: Product → Clean Build Folder
- Rebuild and run again

### **Problem: Camera doesn't work**
- Check Info.plist has camera permissions
- Should already be configured, but verify:
  - `NSCameraUsageDescription`
  - `NSPhotoLibraryUsageDescription`

### **Problem: Can't connect to backend server**
- Verify .env file has correct URLs
- Make sure Mac and backend server are on same network
- Test backend URL in browser first

### **Problem: "The operation couldn't be completed"**
```bash
# Clear derived data
rm -rf ~/Library/Developer/Xcode/DerivedData/*
# Rebuild in Xcode
```

### **Problem: Pod install fails**
```bash
cd ios/App
pod repo update
pod install
cd ../..
```

---

## 📊 PROJECT INFORMATION

- **App Name:** WERCK Inspector
- **Bundle ID:** com.wbnkis.inspector (change to your own)
- **Version:** 1.0.2
- **Platform:** iOS 13.0+
- **GitHub:** https://github.com/Lucky0000123/werci-mobile
- **Backend Server:** http://10.40.20.184:8082
- **Technology Stack:**
  - React + TypeScript
  - Capacitor (native bridge)
  - Vite (build tool)
  - IndexedDB (offline storage)

---

## 🎯 SUCCESS CRITERIA

**You've successfully completed the build when:**

- ✅ App installs on iPhone/iPad without errors
- ✅ App launches and shows WERCK Inspector interface
- ✅ QR scanner opens camera and can scan codes
- ✅ Can create inspections and upload photos
- ✅ Offline mode works (stores data locally)
- ✅ Sync works when connected to network
- ✅ App looks and behaves identically to Android version
- ✅ All features from Android version work on iOS

---

## 📞 SUPPORT RESOURCES

**If you get stuck:**

1. **Check the troubleshooting section above**
2. **Search the error message on Google**
3. **Capacitor iOS Docs:** https://capacitorjs.com/docs/ios
4. **Xcode Documentation:** https://developer.apple.com/documentation/xcode
5. **Check Xcode logs** in the bottom panel for detailed errors
6. **Stack Overflow:** Search for your specific error

---

## ⏱️ ESTIMATED TIME

- **Prerequisites installation:** 1-2 hours (mostly download time)
- **Project setup:** 10-15 minutes
- **First build:** 5-10 minutes
- **Testing:** 15-30 minutes
- **Total:** ~2-3 hours for first-time setup

**Subsequent builds:** 2-5 minutes

---

## 🎉 FINAL CHECKLIST

Before you report completion, verify:

- [ ] Xcode is installed and working
- [ ] Node.js and npm are installed (v18+)
- [ ] CocoaPods is installed
- [ ] Repository cloned successfully from GitHub
- [ ] .env file configured with correct backend URLs
- [ ] Dependencies installed (npm install completed)
- [ ] Web assets built (npm run build completed)
- [ ] iOS platform added (npx cap add ios completed)
- [ ] Project opens in Xcode without errors
- [ ] Bundle ID changed to unique identifier
- [ ] Development team selected in Xcode
- [ ] App builds without errors
- [ ] App installs on physical iPhone/iPad
- [ ] App launches successfully
- [ ] QR scanner works (camera opens)
- [ ] Camera works for photo uploads
- [ ] Network connectivity indicator works
- [ ] Can connect to backend server
- [ ] Offline mode works (stores data locally)
- [ ] Sync works when back online
- [ ] App UI is identical to Android version
- [ ] All buttons and navigation work

---

## 🚀 YOU'RE DONE!

**Congratulations!** You've successfully built the WERCK Inspector iOS app!

The app is now ready for:
- ✅ Internal testing on iOS devices
- ✅ Beta distribution via TestFlight
- ✅ App Store submission (when ready)

**Next Steps:**
1. Test thoroughly on multiple iOS devices (iPhone and iPad)
2. Test on different iOS versions (13.0+)
3. Gather feedback from beta testers
4. Upload to TestFlight for wider beta testing
5. Fix any iOS-specific bugs
6. Submit to App Store for review

---

## 📝 WHAT TO REPORT BACK

When you complete the build, please provide:

1. **✅ Confirmation that app builds successfully**
2. **✅ Screenshots of the app running on iOS device**
3. **✅ List of any errors encountered and how you fixed them**
4. **✅ Confirmation that all features work:**
   - QR scanning
   - Camera/photo upload
   - Offline mode
   - Network sync
   - Inspection creation
5. **✅ iOS version tested on** (e.g., iOS 16.5)
6. **✅ Device tested on** (e.g., iPhone 13)
7. **✅ Any differences from Android version** (if any)

---

## 🔒 IMPORTANT NOTES

1. **Never commit the .env file** - It contains sensitive backend URLs
2. **Keep your Apple ID credentials secure**
3. **The Bundle ID must be unique** - Don't use the default one for production
4. **Test on real devices** - Simulator doesn't support camera/QR scanning
5. **Keep Xcode updated** - Use the latest stable version
6. **Backup your work** - Commit changes to Git regularly

---

## 📱 APP FEATURES (SAME AS ANDROID)

The iOS app includes all features from the Android version:

- ✅ **QR Code Scanning** - Scan commissioning and KIMPER QR codes
- ✅ **Offline-First Architecture** - Works without internet
- ✅ **Automatic Sync** - Syncs data when connection available
- ✅ **Vehicle Inspections** - Create and submit inspections
- ✅ **Photo Upload** - Camera integration for equipment photos
- ✅ **Connection Status** - Visual indicator of network status
- ✅ **Data Management** - View and manage offline data
- ✅ **Diagnostics Panel** - Debug and troubleshooting tools
- ✅ **Professional UI** - Clean, modern interface
- ✅ **Multi-Server Support** - Local, LAN, and Cloud connectivity

---

Good luck with the build! 🍎📱🚀


