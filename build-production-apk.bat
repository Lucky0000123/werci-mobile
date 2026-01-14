@echo off
echo ========================================
echo WERCI Mobile App - Production APK Builder
echo ========================================
echo.

REM Find Java installation
set "JAVA_PATHS=C:\Program Files\Java\jdk-17;C:\Program Files\Java\jdk-11;C:\Program Files\Android\Android Studio\jbr;C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot"

for %%p in (%JAVA_PATHS%) do (
    if exist "%%p\bin\java.exe" (
        set "JAVA_HOME=%%p"
        goto :java_found
    )
)

echo ERROR: Java not found! Please install JDK 11 or higher.
pause
exit /b 1

:java_found
set PATH=%JAVA_HOME%\bin;%PATH%
echo Using JAVA_HOME: %JAVA_HOME%
echo.

REM Verify Java
java -version
if errorlevel 1 (
    echo ERROR: Java verification failed!
    pause
    exit /b 1
)
echo.

echo Step 1: Building production web assets...
call npm run build:prod
if errorlevel 1 (
    echo ERROR: Production build failed!
    pause
    exit /b 1
)
echo ✅ Web assets built successfully
echo.

echo Step 2: Syncing with Android...
call npx cap sync android
if errorlevel 1 (
    echo ERROR: Capacitor sync failed!
    pause
    exit /b 1
)
echo ✅ Android sync completed
echo.

echo Step 3: Building APK...
cd android
call gradlew.bat assembleRelease
if errorlevel 1 (
    echo ERROR: APK build failed!
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✅ APK built successfully
echo.

echo ========================================
echo BUILD COMPLETE!
echo ========================================
echo.
echo APK Location:
echo android\app\build\outputs\apk\release\app-release-unsigned.apk
echo.
echo Next steps:
echo 1. Sign the APK (if needed for production)
echo 2. Install on device: adb install android\app\build\outputs\apk\release\app-release-unsigned.apk
echo 3. Or open in Android Studio for signing
echo.
pause

