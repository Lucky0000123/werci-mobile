@echo off
echo Deploying WERCK app to Android device...

REM Try common Android Studio JDK locations
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

echo Using JAVA_HOME: %JAVA_HOME%

cd /d "%~dp0android"
call gradlew.bat installDebug
if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    pause
    exit /b 1
)

echo App deployed successfully!
pause

