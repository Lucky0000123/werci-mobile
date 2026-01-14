#!/bin/bash

# Set Java 17
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home

# Navigate to android directory
cd android

# Clean everything
echo "🧹 Cleaning build directories..."
rm -rf app/build
rm -rf build
rm -rf .gradle

# Remove all macOS hidden files from entire project
echo "🗑️ Removing macOS hidden files..."
cd ..
find . -name "._*" -delete 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true

# Start background process to continuously clean hidden files
echo "🔄 Starting background cleaner..."
(
    while true; do
        find . -name "._*" -delete 2>/dev/null || true
        find . -name ".DS_Store" -delete 2>/dev/null || true
        sleep 1
    done
) &
CLEANER_PID=$!

# Navigate back to android directory
cd android

# Build the APK
echo "🔨 Building APK..."
./gradlew assembleDebug

# Kill the background cleaner
kill $CLEANER_PID 2>/dev/null || true

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo "📱 APK location: android/app/build/outputs/apk/debug/app-debug.apk"
else
    echo "❌ Build failed!"
    exit 1
fi
