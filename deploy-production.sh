#!/bin/bash

# WERCI Mobile App - Production Deployment Script
# This script builds and deploys the mobile app for production use

set -e  # Exit on any error

echo "🚛 WERCI Mobile App - Production Deployment"
echo "============================================"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from werci-mobile directory"
    exit 1
fi

# Check if required tools are installed
echo "🔍 Checking prerequisites..."

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "❌ Error: npx is not installed"
    exit 1
fi

echo "✅ Prerequisites check passed"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/
rm -rf android/app/build/

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --production=false

# Run TypeScript compilation check
echo "🔍 Running TypeScript checks..."
npx tsc --noEmit

# Build for production
echo "🏗️ Building for production..."
npm run build:prod

# Verify build output
if [ ! -d "dist" ]; then
    echo "❌ Error: Build failed - dist directory not found"
    exit 1
fi

echo "✅ Production build completed successfully"

# Sync with Capacitor
echo "🔄 Syncing with Capacitor..."
npx cap sync android

# Build Android APK
echo "📱 Building Android APK..."
npx cap build android --prod

echo ""
echo "🎉 Production deployment completed successfully!"
echo ""
echo "📱 APK Location:"
echo "   android/app/build/outputs/apk/release/app-release-unsigned.apk"
echo ""
echo "🔐 Next Steps:"
echo "   1. Sign the APK with your production certificate"
echo "   2. Test the APK on physical devices"
echo "   3. Deploy to your distribution method"
echo ""
echo "🚛 WERCI Mobile App is ready for production! ✨"
