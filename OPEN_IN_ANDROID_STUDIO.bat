@echo off
echo ========================================
echo   WERCK Inspector - Android Studio
echo ========================================
echo.
echo Opening Android project in Android Studio...
echo.
echo Project Location:
echo %~dp0android
echo.
echo ========================================
echo.
echo INSTRUCTIONS:
echo 1. Android Studio will open shortly
echo 2. Wait for Gradle sync to complete (2-5 min)
echo 3. Connect your Samsung A15 via USB
echo 4. Enable USB Debugging on your phone
echo 5. Click the green Run button (Play icon)
echo 6. Select your Samsung A15 from device list
echo 7. Wait for app to install and launch
echo.
echo ========================================
echo.

REM Try common Android Studio installation paths
set "STUDIO_PATH="

REM Check Program Files
if exist "C:\Program Files\Android\Android Studio\bin\studio64.exe" (
    set "STUDIO_PATH=C:\Program Files\Android\Android Studio\bin\studio64.exe"
)

REM Check Program Files (x86)
if exist "C:\Program Files (x86)\Android\Android Studio\bin\studio64.exe" (
    set "STUDIO_PATH=C:\Program Files (x86)\Android\Android Studio\bin\studio64.exe"
)

REM Check AppData Local
if exist "%LOCALAPPDATA%\Programs\Android\Android Studio\bin\studio64.exe" (
    set "STUDIO_PATH=%LOCALAPPDATA%\Programs\Android\Android Studio\bin\studio64.exe"
)

REM Check if we found Android Studio
if defined STUDIO_PATH (
    echo Found Android Studio at:
    echo %STUDIO_PATH%
    echo.
    echo Opening project...
    start "" "%STUDIO_PATH%" "%~dp0android"
) else (
    echo ERROR: Android Studio not found!
    echo.
    echo Please manually open Android Studio and then:
    echo 1. Click "Open" or "Open an Existing Project"
    echo 2. Navigate to: %~dp0android
    echo 3. Click OK
    echo.
    echo Or set the path manually:
    echo set CAPACITOR_ANDROID_STUDIO_PATH="C:\Path\To\Android Studio\bin\studio64.exe"
    echo.
    pause
    exit /b 1
)

echo.
echo Android Studio should be opening now...
echo.
pause

