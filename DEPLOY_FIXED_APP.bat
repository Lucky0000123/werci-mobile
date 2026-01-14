@echo off
echo ========================================
echo WERCK Mobile - Deploy Fixed App
echo ========================================
echo.
echo This script will deploy the FIXED version of the app
echo that resolves the BLACK SCREEN issue.
echo.
echo Fix Applied: Changed Vite base path from '/' to './'
echo This ensures assets load correctly in Android WebView.
echo.
echo ========================================
echo.

REM Check if device is connected
echo [1/4] Checking for connected Android device...
C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe devices
echo.

REM Build the app (already done, but can rebuild if needed)
echo [2/4] App already built with fixes. Syncing to Android...
call npx cap sync android
echo.

REM Install to device
echo [3/4] Installing app to your Samsung Galaxy A15...
C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\debug\app-debug.apk
echo.

REM Launch the app
echo [4/4] Launching WERCK Inspector app...
C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe shell am start -n com.werck.inspector/.MainActivity
echo.

echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo The app should now open on your phone WITHOUT black screen.
echo.
echo If you still see issues, run: CHECK_APP_LOGS.bat
echo.
pause

