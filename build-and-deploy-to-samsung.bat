@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   WBNKIS Mobile - Build and Deploy
echo ==========================================
echo.

:: Set Java to Android Studio's JDK
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo Java: %JAVA_HOME%
"%JAVA_HOME%\bin\java.exe" -version 2>&1
echo.

cd android

echo 🔨 Building APK...
gradlew.bat assembleDebug --no-daemon 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ❌ Build failed. Using existing APK if available.
    echo.
)

cd ..

:: Deploy
set ADB=C:\Users\Administrator\AppData\Local\Android\Sdk\platform-tools\adb.exe
echo.
echo 📱 Deploying to Samsung...
echo.

echo Uninstalling old app...
%ADB% uninstall com.werck.inspector 2>nul
%ADB% uninstall com.wbnkis.inspector 2>nul

echo Installing APK...
if exist "android\app\build\outputs\apk\debug\app-debug.apk" (
    %ADB% install -r "android\app\build\outputs\apk\debug\app-debug.apk"
) else (
    echo ❌ APK not found at expected location
    echo Checking alternative locations...
    for /r "android\app\build" %%f in (*.apk) do (
        echo Found: %%f
        %ADB% install -r "%%f"
        goto :LAUNCH
    )
)

:LAUNCH
echo.
echo 🚀 Launching app...
%ADB% shell monkey -p com.werck.inspector -c android.intent.category.LAUNCHER 1 2>nul || ^
%ADB% shell monkey -p com.wbnkis.inspector -c android.intent.category.LAUNCHER 1 2>nul

echo.
echo ==========================================
echo ✅ Done! Check your Samsung phone.
echo ==========================================
pause
