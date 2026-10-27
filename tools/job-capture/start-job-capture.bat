@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-job-capture.ps1" %*

if errorlevel 1 (
    echo.
    echo Job Capture stopped with an error.
    pause
)
