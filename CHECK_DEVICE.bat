@echo off
echo ========================================
echo   Samsung A15 Device Connection Check
echo ========================================
echo.

REM Find ADB in Android Studio SDK
set "ADB_PATH="

REM Check common Android SDK locations
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
    set "ADB_PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
)

if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe" (
    set "ADB_PATH=%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe"
)

if exist "C:\Android\Sdk\platform-tools\adb.exe" (
    set "ADB_PATH=C:\Android\Sdk\platform-tools\adb.exe"
)

if defined ADB_PATH (
    echo Found ADB at: %ADB_PATH%
    echo.
    echo Checking connected devices...
    echo.
    "%ADB_PATH%" devices
    echo.
    echo ========================================
    echo.
    echo If you see your Samsung A15 listed above,
    echo it's ready for deployment!
    echo.
    echo If you see "unauthorized", check your phone
    echo and allow USB debugging.
    echo.
    echo If no devices are listed:
    echo 1. Make sure USB debugging is enabled
    echo 2. Try unplugging and replugging USB cable
    echo 3. Change USB mode to "File Transfer"
    echo 4. Try a different USB cable or port
    echo.
) else (
    echo ERROR: ADB not found!
    echo.
    echo ADB should be installed with Android Studio.
    echo Please make sure Android Studio setup completed successfully.
    echo.
    echo Expected location:
    echo %LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
    echo.
)

echo ========================================
pause

