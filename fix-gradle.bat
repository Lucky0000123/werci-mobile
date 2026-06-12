@echo off
setlocal

:: Set Java
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%

cd android

echo Stopping Gradle daemon...
.\gradlew.bat --stop 2>nul

echo Clearing Gradle cache...
rd /s /q .gradle 2>nul
rd /s /q %USERPROFILE%\.gradle\caches 2>nul

echo Rebuilding...
.\gradlew.bat assembleDebug --no-daemon --refresh-dependencies 2>&1

pause
