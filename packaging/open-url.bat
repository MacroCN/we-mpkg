@echo off
setlocal
timeout /t 4 >nul
start "" "http://localhost:%~1"
