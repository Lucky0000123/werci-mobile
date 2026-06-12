@echo off
setlocal

:: Set Java to Android Studio's JDK
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%

echo ==========================================
echo   Rebuilding WBNKIS Mobile APK
echo ==========================================
echo.

echo 📦 Step 1: Clean old build...
cd android
.\gradlew.bat clean --no-daemon 2>&1

echo.
echo 🔨 Step 2: Building APK... (2-3 minutes)
.\gradlew.bat assembleDebug --no-daemon 2>&1

if %errorlevel% neq 0 (
    echo ❌ Build failed!
    pause
    exit /b 1
)

echo.
echo ✅ APK built successfully!
echo 📁 Location: app\build\outputs\apk\debug\app-debug.apk
echo.

:: Deploy to Samsung
echo 📱 Step 3: Deploying to Samsung...
cd ..

set ADB=C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe

echo Uninstalling old version...
%ADB% uninstall com.werck.inspector 2>nul
%ADB% uninstall com.wbnkis.inspector 2>nul

echo Installing new APK...
%ADB% install -r android\app\build\outputs\apk\debug\app-debug.apk

if %errorlevel% neq 0 (
    echo ❌ Install failed!
    pause
    exit /b 1
)

echo.
echo 🚀 Launching app...
%ADB% shell monkey -p com.werck.inspector -c android.intent.category.LAUNCHER 1

echo.
echo ==========================================
echo ✅ Done! Check your Samsung phone!
echo ==========================================
pause
