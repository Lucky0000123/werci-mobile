@echo off
echo ========================================
echo WERCI Mobile - Rebuild and Deploy
echo ========================================
echo.

REM Set JAVA_HOME to Android Studio's JDK
if exist "C:\Program Files\Android\Android Studio\jbr" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
) else if exist "C:\Program Files\Android\Android Studio\jre" (
    set "JAVA_HOME=C:\Program Files\Android\Android Studio\jre"
) else if exist "%LOCALAPPDATA%\Android\Sdk\jdk" (
    set "JAVA_HOME=%LOCALAPPDATA%\Android\Sdk\jdk"
) else (
    echo ERROR: Cannot find Java installation
    echo Please install Android Studio or set JAVA_HOME manually
    pause
    exit /b 1
)

set PATH=%JAVA_HOME%\bin;%PATH%
echo Using JAVA_HOME: %JAVA_HOME%
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
echo Step 3: Building and installing APK on device...
cd android
call gradlew.bat installDebug
if errorlevel 1 (
    echo ERROR: Build or installation failed!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo SUCCESS! App rebuilt and deployed!
echo ========================================
pause

