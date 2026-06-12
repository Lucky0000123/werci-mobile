@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ==========================================
echo   PRISM - Play Store AAB Builder
echo ==========================================
echo.

:: Colors
set GREEN=[92m
set RED=[91m
set YELLOW=[93m
set CYAN=[96m
set RESET=[0m

:: Step 0: Find Java
set "JAVA_PATHS=C:\Program Files\Java\jdk-17;C:\Program Files\Java\jdk-11;C:\Program Files\Android\Android Studio\jbr;C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot"
for %%p in (%JAVA_PATHS%) do (
    if exist "%%p\bin\java.exe" (
        set "JAVA_HOME=%%p"
        goto :java_found
    )
)
echo %RED%❌ Java not found! Install JDK 11+.%RESET%
pause
exit /b 1
:java_found
set PATH=%JAVA_HOME%\bin;%PATH%
echo %CYAN%Using JAVA_HOME: %JAVA_HOME%%RESET%
java -version 2>&1 | findstr "version" | findstr "17" >nul
if errorlevel 1 (
    echo %YELLOW%⚠ Warning: JDK 17 is recommended. Current version:%RESET%
    java -version 2>&1 | findstr "version"
)
echo.

:: Step 1: Bump versionCode automatically
echo %YELLOW%Step 1: Auto-bumping versionCode...%RESET%
powershell -NoProfile -Command "(Get-Content android\app\build.gradle) -replace 'versionCode (\d+)', { 'versionCode ' + ([int]$_.Groups[1].Value + 1) } | Set-Content android\app\build.gradle"
for /f "tokens=2 delims= " %%a in ('findstr /R "versionCode [0-9]" android\app\build.gradle') do (
    set NEW_VERSION_CODE=%%a
)
echo %GREEN%✅ New versionCode: %NEW_VERSION_CODE%%RESET%
echo.

:: Step 2: Build production web assets
echo %YELLOW%Step 2: Building production web assets...%RESET%
call npm run build:prod
if %errorlevel% neq 0 (
    echo %RED%❌ Web build failed%RESET%
    pause
    exit /b 1
)
echo %GREEN%✅ Web assets built%RESET%
echo.

:: Step 3: Sync Capacitor
echo %YELLOW%Step 3: Syncing Capacitor with Android...%RESET%
call npx cap sync android
if %errorlevel% neq 0 (
    echo %RED%❌ Capacitor sync failed%RESET%
    pause
    exit /b 1
)
echo %GREEN%✅ Sync complete%RESET%
echo.

:: Step 4: Build Release AAB
echo %YELLOW%Step 4: Building Release AAB for Play Store...%RESET%
cd android
.\gradlew.bat bundleRelease
if %errorlevel% neq 0 (
    echo %RED%❌ AAB build failed%RESET%
    echo.
    echo %YELLOW%Note: If you see deprecation warnings, the AAB may still be valid.%RESET%
    echo %YELLOW%Check: app\build\outputs\bundle\release\%RESET%
    cd ..
    pause
    exit /b 1
)
cd ..
echo %GREEN%✅ AAB built successfully%RESET%
echo.

:: Step 5: Verify output
echo %YELLOW%Step 5: Verifying output...%RESET%
set "AAB_PATH=android\app\build\outputs\bundle\release\app-release.aab"
if exist "%AAB_PATH%" (
    for %%F in ("%AAB_PATH%") do (
        set AAB_SIZE=%%~zF
    )
    echo %GREEN%✅ AAB found:%RESET%
    echo    %CYAN%Path: %AAB_PATH%%RESET%
    echo    %CYAN%Size: %AAB_SIZE% bytes%RESET%
) else (
    echo %RED%❌ AAB not found at expected path%RESET%
    pause
    exit /b 1
)
echo.

:: Step 6: Print summary
echo ==========================================
echo   %GREEN%PLAY STORE BUNDLE READY%RESET%
echo ==========================================
echo.
echo %CYAN%Next steps:%RESET%
echo   1. Go to https://play.google.com/console
echo   2. Create/select your app: com.prism.inspector
echo   3. Go to Testing ^> Internal testing ^> Create release
echo   4. Upload: %AAB_PATH%
echo   5. Add release notes and save
echo   6. Add testers and send invites
echo   7. Promote to Production after validation
echo.
echo %YELLOW%Version bumped to: %NEW_VERSION_CODE%%RESET%
echo %YELLOW%Target SDK: 34 (Play Store compliant)%RESET%
echo.
pause
