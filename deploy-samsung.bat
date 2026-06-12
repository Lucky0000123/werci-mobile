@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ==========================================
echo   WBNKIS Mobile - Samsung Deployment
echo ==========================================
echo.

:: Check if ADB is available
where adb >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ADB not found in PATH
    echo Please install Android SDK Platform Tools
    echo Download from: https://developer.android.com/studio/releases/platform-tools
    pause
    exit /b 1
)

echo ✅ ADB found

:: Check for connected devices
echo.
echo 📱 Checking for connected devices...
adb devices > temp_devices.txt 2>&1

findstr /R "^[0-9]" temp_devices.txt >nul
if %errorlevel% neq 0 (
    echo.
    echo ❌ No Samsung device detected!
    echo.
    echo Please:
    echo 1. Connect your Samsung phone via USB
    echo 2. Enable USB Debugging on your phone:
    echo    - Go to Settings ^> About Phone
    echo    - Tap "Build Number" 7 times
    echo    - Go back to Settings ^> Developer Options
    echo    - Enable "USB Debugging"
    echo 3. Allow USB Debugging when prompted on your phone
    echo.
    del temp_devices.txt
    pause
    exit /b 1
)

echo ✅ Samsung device detected:
findstr /R "^[0-9]" temp_devices.txt
del temp_devices.txt

:: Check if APK exists
set APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk
set RELEASE_APK=android\app\build\outputs\apk\release\app-release-unsigned.apk

if exist "%RELEASE_APK%" (
    set APK_PATH=%RELEASE_APK%
    echo ✅ Release APK found
) else if exist "%APK_PATH%" (
    echo ✅ Debug APK found
) else (
    echo ❌ APK not found!
    echo Building APK first...
    echo.
    goto :BUILD_APK
)

goto :INSTALL_APK

:BUILD_APK
echo.
echo ==========================================
echo   Building APK...
echo ==========================================
echo.

:: Check if Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js not found
    pause
    exit /b 1
)

:: Build web assets
echo 📦 Building web assets...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ Web build failed
    pause
    exit /b 1
)
echo ✅ Web assets built

:: Sync with Capacitor
echo 🔄 Syncing with Capacitor...
call npx cap sync android
if %errorlevel% neq 0 (
    echo ❌ Capacitor sync failed
    pause
    exit /b 1
)
echo ✅ Capacitor sync complete

:: Build APK
echo 🔨 Building APK...
cd android

:: Try to build debug APK first
call .\gradlew.bat assembleDebug
if %errorlevel% neq 0 (
    echo ❌ Debug build failed, trying release...
    call .\gradlew.bat assembleRelease
    if %errorlevel% neq 0 (
        echo ❌ Release build also failed
        cd ..
        pause
        exit /b 1
    )
    set APK_PATH=app\build\outputs\apk\release\app-release-unsigned.apk
) else (
    set APK_PATH=app\build\outputs\apk\debug\app-debug.apk
)

cd ..
echo ✅ APK built successfully

:INSTALL_APK
echo.
echo ==========================================
echo   Installing on Samsung Device
echo ==========================================
echo.

:: Uninstall old version if exists
echo 🗑️ Removing old version (if exists)...
adb uninstall com.wbnkis.inspector >nul 2>&1

:: Install new APK
echo 📲 Installing WBNKIS Mobile...
adb install -r "%APK_PATH%"
if %errorlevel% neq 0 (
    echo ❌ Installation failed
    echo.
    echo Troubleshooting:
    echo 1. Make sure USB Debugging is enabled
    echo 2. Check that your phone allows installations from USB
    echo 3. Try disconnecting and reconnecting USB
    pause
    exit /b 1
)

echo ✅ Installation successful!

:: Launch the app
echo.
echo 🚀 Launching WBNKIS Mobile...
adb shell am start -n com.wbnkis.inspector/.MainActivity
if %errorlevel% neq 0 (
    echo ⚠️ Could not auto-launch app
    echo Please open the app manually on your phone
)

echo.
echo ==========================================
echo   ✅ Deployment Complete!
echo ==========================================
echo.
echo The WBNKIS Mobile app has been installed
echo on your Samsung phone!
echo.
echo 📱 App Name: WBNKIS Inspector
echo 📦 Package: com.wbnkis.inspector
echo.
echo Features:
echo • QR Code scanning (Vehicle, Employee, KIMPER)
echo • Offline-first inspections
echo • English & Indonesian language support
echo • Push notifications
echo • Professional dashboard
echo.
pause
