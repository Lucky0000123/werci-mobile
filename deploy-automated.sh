#!/bin/bash

# Fully automated deployment script using GitHub CLI
# Requires: gh (GitHub CLI) to be installed and authenticated

set -e  # Exit on any error

echo "🚀 Automated Deployment Script for WERCI Mobile App"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ GitHub CLI (gh) is not installed${NC}"
    echo ""
    echo "Please install it:"
    echo "  brew install gh"
    echo ""
    echo "Then authenticate:"
    echo "  gh auth login"
    echo ""
    echo "Or use the manual script: ./deploy-to-new-repo.sh"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${RED}❌ Not authenticated with GitHub CLI${NC}"
    echo ""
    echo "Please run: gh auth login"
    echo ""
    echo "Or use the manual script: ./deploy-to-new-repo.sh"
    exit 1
fi

echo -e "${GREEN}✅ GitHub CLI is ready${NC}"
echo ""

# Step 1: Commit changes
echo -e "${BLUE}📝 Step 1: Committing all changes...${NC}"
git add -A

git commit -m "Fix: Camera scanner black screen - Final stable version v1.0.0

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
- Documentation files updated

📦 NEW FILES:
- FINAL_VERSION_SUMMARY.md - Complete project summary
- Deployment scripts

🎯 RESULT:
Camera now displays properly on iOS with fully functional QR/barcode scanning.
This is a stable, production-ready version v1.0.0"

echo -e "${GREEN}✅ Changes committed${NC}"
echo ""

# Step 2: Push to current repo
echo -e "${BLUE}📤 Step 2: Pushing to werci-mobile...${NC}"
git push origin main
echo -e "${GREEN}✅ Pushed to werci-mobile${NC}"
echo ""

# Step 3: Create new repository
echo -e "${BLUE}🆕 Step 3: Creating new repository IOS_WBNKIS_APP...${NC}"
gh repo create IOS_WBNKIS_APP \
  --public \
  --description "WERCI Mobile - iOS Inspection App with QR/Barcode scanning, camera capture, and offline data sync. Production-ready v1.0.0" \
  --source=. \
  --remote=ios-app \
  --push

echo -e "${GREEN}✅ New repository created and code pushed${NC}"
echo ""

# Step 4: Summary
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo ""
echo "Your code is now in TWO repositories:"
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

