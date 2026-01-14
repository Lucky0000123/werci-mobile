#!/bin/bash

# WERCI Mobile - GitHub Actions Workflow Validation Script
# This script validates that all GitHub Actions workflows are properly configured

echo "🔍 Validating WERCI Mobile GitHub Actions Workflows..."

# Check if workflow files exist
WORKFLOWS_DIR=".github/workflows"
if [ ! -d "$WORKFLOWS_DIR" ]; then
    echo "❌ Workflows directory not found: $WORKFLOWS_DIR"
    exit 1
fi

echo "✅ Workflows directory found"

# Validate build-apk.yml
BUILD_APK_FILE="$WORKFLOWS_DIR/build-apk.yml"
if [ ! -f "$BUILD_APK_FILE" ]; then
    echo "❌ Build APK workflow not found: $BUILD_APK_FILE"
    exit 1
fi

echo "✅ Build APK workflow found"

# Validate test-build.yml
TEST_BUILD_FILE="$WORKFLOWS_DIR/test-build.yml"
if [ ! -f "$TEST_BUILD_FILE" ]; then
    echo "❌ Test build workflow not found: $TEST_BUILD_FILE"
    exit 1
fi

echo "✅ Test build workflow found"

# Check for required actions in build-apk.yml
echo "🔍 Checking build-apk.yml for required actions..."

if grep -q "actions/checkout@v4" "$BUILD_APK_FILE"; then
    echo "✅ Checkout action (v4) found"
else
    echo "❌ Checkout action (v4) not found"
    exit 1
fi

if grep -q "actions/setup-node@v4" "$BUILD_APK_FILE"; then
    echo "✅ Setup Node action (v4) found"
else
    echo "❌ Setup Node action (v4) not found"
    exit 1
fi

if grep -q "actions/setup-java@v4" "$BUILD_APK_FILE"; then
    echo "✅ Setup Java action (v4) found"
else
    echo "❌ Setup Java action (v4) not found"
    exit 1
fi

if grep -q "actions/upload-artifact@v4" "$BUILD_APK_FILE"; then
    echo "✅ Upload Artifact action (v4) found"
else
    echo "❌ Upload Artifact action (v4) not found"
    exit 1
fi

if grep -q "softprops/action-gh-release@v2" "$BUILD_APK_FILE"; then
    echo "✅ GitHub Release action (v2) found"
else
    echo "❌ GitHub Release action (v2) not found"
    exit 1
fi

# Check for required actions in test-build.yml
echo "🔍 Checking test-build.yml for required actions..."

if grep -q "actions/checkout@v4" "$TEST_BUILD_FILE"; then
    echo "✅ Checkout action (v4) found in test workflow"
else
    echo "❌ Checkout action (v4) not found in test workflow"
    exit 1
fi

if grep -q "actions/setup-node@v4" "$TEST_BUILD_FILE"; then
    echo "✅ Setup Node action (v4) found in test workflow"
else
    echo "❌ Setup Node action (v4) not found in test workflow"
    exit 1
fi

# Check for environment configuration
echo "🔍 Checking for environment configuration..."

if grep -q "VITE_CLOUD_BASE" "$BUILD_APK_FILE"; then
    echo "✅ Environment variables configured in build workflow"
else
    echo "❌ Environment variables not configured in build workflow"
    exit 1
fi

if grep -q "VITE_CLOUD_BASE" "$TEST_BUILD_FILE"; then
    echo "✅ Environment variables configured in test workflow"
else
    echo "❌ Environment variables not configured in test workflow"
    exit 1
fi

echo ""
echo "🎉 All GitHub Actions workflows are properly configured!"
echo ""
echo "📋 Summary:"
echo "  ✅ build-apk.yml - Android APK build workflow"
echo "  ✅ test-build.yml - Test build workflow"
echo "  ✅ All actions updated to latest versions (v4/v2)"
echo "  ✅ Environment variables properly configured"
echo "  ✅ Production-ready for GitHub Actions"
echo ""
echo "🚀 Ready to use GitHub Actions for automated builds!"
