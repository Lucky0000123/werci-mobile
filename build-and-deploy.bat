@echo off
echo ==========================================
echo   WBNKIS Mobile - Build & Deploy
echo ==========================================
echo.

:: Colors
set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set RESET=[0m

echo %YELLOW%Step 1: Building web assets...%RESET%
call npm run build
if %errorlevel% neq 0 (
    echo %RED%❌ Web build failed%RESET%
    pause
    exit /b 1
)
echo %GREEN%✅ Web assets built%RESET%

echo.
echo %YELLOW%Step 2: Syncing with Android...%RESET%
call npx cap sync android
if %errorlevel% neq 0 (
    echo %RED%❌ Sync failed%RESET%
    pause
    exit /b 1
)
echo %GREEN%✅ Sync complete%RESET%

echo.
echo %YELLOW%Step 3: Building APK...%RESET%
cd android
.
\gradlew.bat assembleDebug
if %errorlevel% neq 0 (
    echo %RED%❌ APK build failed%RESET%
    cd ..
    pause
    exit /b 1
)
echo %GREEN%✅ APK built%RESET%
cd ..

echo.
echo %YELLOW%Step 4: Checking device...%RESET%
adb devices | findstr /R "^[0-9]" >nul
if %errorlevel% neq 0 (
    echo %RED%❌ No device connected%RESET%
    echo Connect your Samsung phone and enable USB debugging
    pause
    exit /b 1
)
echo %GREEN%✅ Device found%RESET%

echo.
echo %YELLOW%Step 5: Installing APK...%RESET%
adb uninstall com.wbnkis.inspector >nul 2>&1
adb install -r "android\app\build\outputs\apk\debug\app-debug.apk"
if %errorlevel% neq 0 (
    echo %RED%❌ Installation failed%RESET%
    pause
    exit /b 1
)
echo %GREEN%✅ Installed%RESET%

echo.
echo %YELLOW%Step 6: Launching app...%RESET%
adb shell am start -n com.wbnkis.inspector/.MainActivity
echo %GREEN%✅ App launched!%RESET%

echo.
echo ==========================================
echo %GREEN%  ✅ All Done! Check your phone.%RESET%
echo ==========================================
pause
