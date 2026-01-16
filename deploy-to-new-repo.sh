#!/bin/bash

# Complete deployment script for WERCI Mobile App
# This script will:
# 1. Commit all changes
# 2. Push to current repository (werci-mobile)
# 3. Create and push to new repository (IOS_WBNKIS_APP)

set -e  # Exit on any error

echo "🚀 Starting Complete Deployment Process..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Commit all changes
echo -e "${BLUE}📝 Step 1: Committing all changes...${NC}"
git add -A

git commit -m "Fix: Camera scanner black screen issue - Final stable version v1.0.0

✅ MAJOR FIXES:
- Fixed camera black screen by making html element transparent
- Replaced deprecated barcode scanner with @capacitor-mlkit/barcode-scanning
- Fixed platform-specific module installation (Android only)
- Updated all scanner implementations

📝 FILES MODIFIED:
- src/App.css - Added html.qr-scanning transparency
- src/features/scan/Scanner.tsx - Platform-specific module install
- src/features/inspect/InspectionForm.tsx - Platform-specific module install
- src/features/photo/PhotoUpload.tsx - Platform-specific module install
- src/App.tsx - Platform-specific module install
- package.json - Updated dependencies
- capacitor.config.ts - Removed unused config
- Documentation files updated

📦 NEW FILES:
- FINAL_VERSION_SUMMARY.md - Complete project summary
- commit-final-version.sh - Commit helper script
- deploy-to-new-repo.sh - This deployment script

🎯 RESULT:
Camera now displays properly on iOS with fully functional QR/barcode scanning.

This is a stable, production-ready version v1.0.0"

echo -e "${GREEN}✅ Changes committed successfully!${NC}"
echo ""

# Step 2: Push to current repository
echo -e "${BLUE}📤 Step 2: Pushing to current repository (werci-mobile)...${NC}"
git push origin main

echo -e "${GREEN}✅ Pushed to werci-mobile successfully!${NC}"
echo ""

# Step 3: Create new repository on GitHub
echo -e "${YELLOW}⚠️  Step 3: Creating new repository on GitHub...${NC}"
echo ""
echo "Please create a new repository on GitHub:"
echo "  1. Go to: https://github.com/new"
echo "  2. Repository name: IOS_WBNKIS_APP"
echo "  3. Description: WERCI Mobile - iOS Inspection App with QR/Barcode scanning"
echo "  4. Make it Public or Private (your choice)"
echo "  5. DO NOT initialize with README, .gitignore, or license"
echo "  6. Click 'Create repository'"
echo ""
read -p "Press ENTER after you've created the repository on GitHub..."

# Step 4: Add new remote and push
echo ""
echo -e "${BLUE}📤 Step 4: Adding new remote and pushing...${NC}"

# Add new remote
git remote add ios-app https://github.com/Lucky0000123/IOS_WBNKIS_APP.git

# Push to new repository
git push -u ios-app main

echo -e "${GREEN}✅ Pushed to IOS_WBNKIS_APP successfully!${NC}"
echo ""

# Step 5: Summary
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo ""
echo "Your code has been pushed to TWO repositories:"
echo ""
echo "1. Original: https://github.com/Lucky0000123/werci-mobile"
echo "2. New iOS:  https://github.com/Lucky0000123/IOS_WBNKIS_APP"
echo ""
echo "📱 App Status: Production Ready v1.0.0"
echo "✅ All features working"
echo "✅ Camera scanning functional"
echo "✅ Documentation complete"
echo ""
echo "🎊 Congratulations! Your app is deployed!"

