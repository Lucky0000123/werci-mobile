@echo off
setlocal

:: Set Android Studio's JDK
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%

echo Java version:
"%JAVA_HOME%\bin\java.exe" -version 2>&1
echo.

cd android

echo Building APK... This may take 2-3 minutes...
.\gradlew.bat assembleDebug --no-daemon --offline 2>&1

if %errorlevel% neq 0 (
    echo.
    echo Build failed. Trying with daemon...
    .\gradlew.bat assembleDebug 2>&1
)

echo.
echo Build complete!
pause
