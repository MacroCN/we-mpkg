@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title we-mpkg - get Steam token for Android app

set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0..\nodejs\node.exe" set "NODE_EXE=%~dp0..\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Put portable node at: %~dp0..\nodejs\node.exe
  pause
  exit /b 1
)

echo ============================================================
echo   Step 1/2: check saved login
echo ============================================================
"%NODE_EXE%" "%~dp0bin\wempkg.js" steamjs status
if errorlevel 2 goto :login

choice /c YN /n /m "Already logged in? Skip scan login and print token? [Y/N] "
if errorlevel 2 goto :login
goto :print

:login
echo.
echo ============================================================
echo   Step 1/2: scan QR with Steam mobile app
echo   (Steam app -^> Steam Guard -^> Scan QR code)
echo ============================================================
"%NODE_EXE%" "%~dp0bin\wempkg.js" steamjs login
if errorlevel 1 (
  echo.
  echo [FAILED] login failed. Check proxy / network and try again.
  pause
  exit /b 1
)

:print
echo.
echo ============================================================
echo   Step 2/2: paste the text below into the Android app
echo   (app -^> start page -^> "Login credential" box -^> Import)
echo ============================================================
echo.
"%NODE_EXE%" "%~dp0bin\wempkg.js" steamjs token
echo.
echo The credential is also cached at: %~dp0.cache\steam-token.json
echo.
pause
