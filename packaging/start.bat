@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title we-mpkg - desktop web UI

set "PORT=3090"
if not "%1"=="" set "PORT=%~1"

echo ============================================================
echo   we-mpkg portable
echo   web UI: http://localhost:%PORT%
echo   keep this window open; Ctrl+C or stop.bat to stop
echo   (closing the browser will NOT stop the service)
echo ============================================================
echo.

start "" /min "%~dp0open-url.bat" %PORT%
"%~dp0nodejs\node.exe" "%~dp0bin\wempkg.js" serve --port %PORT%
echo.
echo Server stopped.
pause
