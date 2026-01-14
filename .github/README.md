# WERCI Mobile - GitHub Actions CI/CD

## 🚀 Automated Build Workflows

### 📱 **build-apk.yml** - Android APK Build
- **Trigger:** Push to `main` branch or manual dispatch
- **Output:** Timestamped APK file (`WERCI_INSPECTOR_YYYYMMDD_HHMMSS.apk`)
- **Features:**
  - Builds React + TypeScript web app
  - Syncs with Capacitor Android
  - Generates debug APK
  - Creates GitHub release with APK attachment
  - 30-day artifact retention

### 🧪 **test-build.yml** - Test & Validation
- **Trigger:** Pull requests to `main` or manual dispatch
- **Purpose:** Validate builds without creating APK
- **Features:**
  - Runs linting checks
  - Tests web build process
  - Validates build artifacts

## 🔧 Manual Build Trigger

To manually trigger an APK build:
1. Go to **Actions** tab in GitHub
2. Select **"Build Android APK (WERCI Mobile)"**
3. Click **"Run workflow"**
4. Select branch (usually `main`)
5. Click **"Run workflow"**

## 📦 Download Built APK

After successful build:
1. Go to **Actions** tab
2. Click on the completed workflow run
3. Download APK from **Artifacts** section
4. Or check **Releases** for tagged builds

## 🛠️ Local Development

```bash
# Install dependencies
npm ci

# Start development server
npm run dev

# Build for production
npm run build

# Sync with Capacitor
npx cap sync android

# Build APK locally
cd android && ./gradlew assembleDebug
```

## 📋 Requirements

- **Node.js:** v20+
- **Java:** v17 (for Android builds)
- **Android SDK:** Managed by GitHub Actions
- **Capacitor:** v5+

## 🔍 Troubleshooting

### Common Issues:
1. **Action not found errors:** Use stable action versions (v3 instead of v4)
2. **Build failures:** Check Node.js and Java versions
3. **APK not generated:** Verify Capacitor sync completed
4. **Permission errors:** Ensure gradlew has execute permissions

### Debug Steps:
1. Check workflow logs in Actions tab
2. Verify package.json scripts
3. Test local build first
4. Check Capacitor configuration
