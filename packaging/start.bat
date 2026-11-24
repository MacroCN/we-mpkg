@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem default to the built-in pure-JS engine (no SteamCMD, no system Node needed)
if not defined WE_MPKG_ENGINE set "WE_MPKG_ENGINE=steamjs"
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
