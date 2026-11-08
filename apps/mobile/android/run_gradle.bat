@echo off
setlocal

:: Set JAVA_HOME directly
set "JAVA_HOME=C:\Program Files\Java\jdk-17.0.21.0.3"
set "PATH=%JAVA_HOME%\bin;%PATH%"

:: Verify Java is available
java -version 2>nul
if errorlevel 1 (
    echo ERROR: Java not found in %JAVA_HOME%\bin
    exit /b 1
)

:: Change to project directory
cd /d "C:\Project\ojcam\apps\mobile\android"

:: Run Gradle with java directly
java -cp "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*

endlocal