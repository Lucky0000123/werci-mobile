@echo off
echo ========================================
echo WERCI Mobile App - APK Builder
echo ========================================
echo.

REM Set JAVA_HOME to Android Studio's JDK
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%

echo Setting JAVA_HOME to: %JAVA_HOME%
echo.

echo Step 1: Building web assets...
call npm run build
if errorlevel 1 (
    echo ERROR: Web build failed!
    pause
    exit /b 1
)

echo.
echo Step 2: Syncing with Android...
call npx cap sync android
if errorlevel 1 (
    echo ERROR: Capacitor sync failed!
    pause
    exit /b 1
)

echo.
echo Step 3: Opening Android Studio...
echo Please build the APK in Android Studio:
echo 1. Wait for Gradle sync to complete
echo 2. Click Build -^> Build Bundle(s) / APK(s) -^> Build APK(s)
echo 3. Wait for build to complete
echo 4. Click 'locate' to find the APK
echo.
call npx cap open android

echo.
echo ========================================
echo Android Studio should now be opening...
echo ========================================
pause

