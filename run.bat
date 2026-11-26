@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
rem 1) node already on PATH
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

rem 2) portable build: put node.exe anywhere and pass -NodeExe, or just have node on PATH
if not defined NODE_EXE if exist "%~dp0..\nodejs\node.exe" set "NODE_EXE=%~dp0..\nodejs\node.exe"

rem 3) common install locations
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE goto :nonode

"%NODE_EXE%" "%~dp0bin\wempkg.js" %*
exit /b %errorlevel%

:nonode
echo [ERROR] Node.js not found.
echo   Portable build expected at: %~dp0..\nodejs\node.exe
echo   Or install Node 16+ from https://nodejs.org/ and try again.
pause
exit /b 1
