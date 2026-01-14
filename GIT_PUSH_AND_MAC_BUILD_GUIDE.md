# 🚀 WERCI Mobile - Git Push & Mac Build Guide

## ✅ WHAT I'VE DONE FOR YOU

1. ✅ Updated `.gitignore` to exclude:
   - `.env` files (sensitive data)
   - `*.apk` and `*.aab` files (large binaries)
   - iOS/Android build outputs
   - `node_modules/` (dependencies)

2. ✅ Staged all necessary files (92 files, 20,862 lines added)

3. ✅ Created commit: "Complete WERCI Mobile app - iOS/Android ready with offline-first architecture"

4. ✅ Configured Git user:
   - Email: rahul.dhiman0000123@gmail.com
   - Name: Rahul Dhiman

5. ⏳ **PENDING:** Push to GitHub (waiting for you to complete)

---

## 📤 STEP 1: COMPLETE THE PUSH (ON WINDOWS)

The commit is ready. You just need to push it to GitHub.

### **Open PowerShell/Command Prompt:**

```powershell
cd "D:\WORK\BACKUP_DATA\CODE_SERVER\Vechle Inspection\Vechle Inspection\werci-mobile"

# Push to GitHub
git push origin main
```

### **If it asks for credentials:**

- **Username:** Lucky0000123
- **Password:** Use your GitHub Personal Access Token (not your password)

### **Don't have a Personal Access Token?**

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scope: `repo` (full control of private repositories)
4. Click "Generate token"
5. **Copy the token** (you won't see it again!)
6. Use this token as your password when pushing

### **Verify Push Success:**

```powershell
git status
```

**Should show:** "Your branch is up to date with 'origin/main'"

---

## 📥 STEP 2: CLONE ON MAC (172.17.132.7)

### **On your Mac, open Terminal:**

```bash
# Navigate to Desktop
cd ~/Desktop

# Clone the repository
git clone https://github.com/Lucky0000123/werci-mobile.git

# Navigate to project
cd werci-mobile
```

**Enter your GitHub credentials when prompted.**

---

## 🔧 STEP 3: SETUP ENVIRONMENT ON MAC

```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env with your actual values
nano .env
```

### **Update these values in .env:**

```env
VITE_LOCAL_BASE=http://10.40.20.184:8082
VITE_CLOUD_BASE=https://veterinary-gage-garage-categories.trycloudflare.com
VITE_LAN_BASE=http://172.17.132.7:8082
```

**Save:** Press `Ctrl+O`, then `Enter`, then `Ctrl+X`

---

## 📦 STEP 4: INSTALL DEPENDENCIES

```bash
# Install Node.js packages
npm install
```

**This will take 2-5 minutes and download ~200MB of dependencies.**

---

## 📱 STEP 5: BUILD iOS APP

```bash
# Add iOS platform
npx cap add ios

# Build web assets
npm run build

# Sync to iOS
npx cap sync ios

# Open in Xcode
npx cap open ios
```

---

## 🎯 STEP 6: BUILD IN XCODE

1. **Xcode opens automatically**
2. **Select your Apple Developer team:**
   - Click on "App" in left sidebar
   - Under "Signing & Capabilities"
   - Select your team from dropdown

3. **Change Bundle Identifier:**
   - Change from: `com.werck.inspector`
   - Change to: `com.yourcompany.werci` (or any unique ID)

4. **Connect iPhone/iPad via USB**

5. **Select device** from dropdown (top left, next to "App")

6. **Click Run button** (▶️ play icon)

7. **Wait for build** (1-2 minutes first time)

8. **App installs on device!** 🎉

---

## 🔄 FUTURE UPDATES WORKFLOW

### **On Windows (Make Changes):**

```powershell
cd "D:\WORK\BACKUP_DATA\CODE_SERVER\Vechle Inspection\Vechle Inspection\werci-mobile"

# Make your code changes...

# Check what changed
git status

# Add changes
git add .

# Commit
git commit -m "Description of your changes"

# Push to GitHub
git push origin main
```

### **On Mac (Get Updates & Rebuild):**

```bash
cd ~/Desktop/werci-mobile

# Get latest changes
git pull origin main

# Rebuild
npm run build
npx cap sync ios

# Open in Xcode
npx cap open ios

# Click Run to rebuild and install
```

---

## 📊 REPOSITORY INFO

- **GitHub URL:** https://github.com/Lucky0000123/werci-mobile
- **Repository:** werci-mobile
- **Branch:** main
- **Owner:** Lucky0000123

---

## ✅ WHAT'S INCLUDED IN THE PUSH

- ✅ All source code (`src/`)
- ✅ Configuration files (`package.json`, `capacitor.config.ts`, etc.)
- ✅ `.env.example` (template with placeholders)
- ✅ Android configuration
- ✅ Documentation files
- ✅ Build scripts

## ❌ WHAT'S EXCLUDED (SAFE!)

- ❌ `.env` (your actual sensitive data)
- ❌ `node_modules/` (too large, will be installed on Mac)
- ❌ `*.apk` files (large binaries)
- ❌ Build outputs (`dist/`, `build/`)
- ❌ iOS build artifacts (will be generated on Mac)

---

## 🆘 TROUBLESHOOTING

### **Problem: Push fails with authentication error**

**Solution:** Use Personal Access Token instead of password (see Step 1 above)

### **Problem: npm install fails on Mac**

```bash
# Clear cache
npm cache clean --force

# Try again
npm install
```

### **Problem: Xcode won't open**

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Accept license
sudo xcodebuild -license accept
```

### **Problem: Can't find device in Xcode**

1. Make sure iPhone/iPad is connected via USB
2. Unlock the device
3. Trust the computer (popup on device)
4. Wait a few seconds for Xcode to detect it

---

## 🎉 YOU'RE READY!

**Next steps:**
1. Complete the push on Windows (Step 1)
2. Clone on Mac (Step 2)
3. Build iOS app (Steps 3-6)
4. Test on iPhone/iPad
5. Upload to TestFlight for team distribution

**Total time:** ~30 minutes

Good luck! 🚀

