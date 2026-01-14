@echo off
echo ========================================
echo WERCK Mobile - App Diagnostics
echo ========================================
echo.
echo This will show real-time logs from your phone.
echo Look for errors or issues in the output.
echo.
echo Press Ctrl+C to stop viewing logs.
echo.
echo ========================================
echo.

REM Clear old logs first
C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe logcat -c

REM Show filtered logs for the app
echo Showing logs for WERCK Inspector app...
echo.
C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe logcat | findstr /I "werck capacitor chromium console"

