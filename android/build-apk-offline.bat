@echo off
setlocal

:: Set Java to Android Studio's JDK
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
set PATH=%JAVA_HOME%\bin;%PATH%

cd android

echo Building APK in offline mode...
.\gradlew.bat assembleDebug --offline --no-daemon 2>&1

pause
