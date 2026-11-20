@echo off
setlocal
cd /d "%~dp0"

rem Stop the background we-mpkg service (default port 3090, or pass a port: stop.bat 3095)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3090"

set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE if exist "%~dp0nodejs\node.exe" set "NODE_EXE=%~dp0nodejs\node.exe"
if not defined NODE_EXE if exist "%~dp0..\nodejs\node.exe" set "NODE_EXE=%~dp0..\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE goto :nonode

"%NODE_EXE%" -e "const http=require('http');const req=http.request({host:'127.0.0.1',port:%PORT%,path:'/api/shutdown',method:'POST'},res=>{console.log('[OK] service stopped on port %PORT% (HTTP '+res.statusCode+')');process.exit(0)});req.on('error',e=>{console.log('[INFO] no service running on port %PORT% ('+e.code+')');process.exit(2)});req.setTimeout(3000,()=>{console.log('[INFO] timeout');process.exit(3)});req.end();"
set "RC=%errorlevel%"
if "%RC%"=="0" goto :done
if "%RC%"=="2" goto :done
echo [WARN] stop request failed (code %RC%). Try closing the console window of start.bat instead.
:done
if /i "%~1"=="-q" exit /b 0
ping -n 3 127.0.0.1 >nul
exit /b 0

:nonode
echo [ERROR] Node.js not found, cannot send stop request.
echo   Close the console window that is running we-mpkg instead.
pause
exit /b 1
