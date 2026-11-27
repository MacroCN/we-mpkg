@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
if exist "%~dp0nodejs\node.exe" set "NODE_EXE=%~dp0nodejs\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)

if not defined NODE_EXE goto :nonode

"%NODE_EXE%" "%~dp0bin\wempkg.js" %*
exit /b %errorlevel%

:nonode
echo [ERROR] Node.js not found.
echo   Expected portable runtime at: %~dp0nodejs\node.exe
pause
exit /b 1
