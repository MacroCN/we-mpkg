@echo off
setlocal
cd /d "%~dp0"

rem Stop the background we-mpkg service (default port 3090, or pass a port: stop.bat 3095)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3090"

set "NODE_EXE=%~dp0nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" -e "const http=require('http');const req=http.request({host:'127.0.0.1',port:%PORT%,path:'/api/shutdown',method:'POST'},res=>{console.log('[OK] service stopped on port %PORT%');process.exit(0)});req.on('error',e=>{console.log('[INFO] no service running on port %PORT% ('+e.code+')');process.exit(0)});req.setTimeout(3000,()=>{console.log('[INFO] timeout');process.exit(0)});req.end();"
ping -n 3 127.0.0.1 >nul
exit /b 0
