@echo off
echo ==========================================
echo   WBNKIS Mobile - Deploy to Samsung
echo ==========================================
echo.

:: Set paths
set ADB=C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe
set APK=werci-mobile\android\app\build\outputs\apk\debug\app-debug.apk

echo 📱 Checking device...
%ADB% devices
echo.

echo 🗑️ Uninstalling old version...
%ADB% uninstall com.werck.inspector
%ADB% uninstall com.wbnkis.inspector
echo.

echo 📲 Installing new APK...
%ADB% install -r %APK%
if %errorlevel% neq 0 (
    echo ❌ Install failed. Checking if APK needs rebuild...
    pause
    exit /b 1
)
echo.

echo ✅ App installed successfully!
echo.
echo 📱 Please open the app manually on your phone:
echo    Look for "WBNKIS Inspector" icon
echo.
pause
