@echo off
cd /d "%~dp0"
echo Starting we-mpkg web UI ... open http://localhost:3090 in your browser
call "%~dp0run.bat" serve %*
pause
