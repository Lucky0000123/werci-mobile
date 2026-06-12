@echo off
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
call gradlew.bat assembleDebug --no-daemon --quiet
endlocal
