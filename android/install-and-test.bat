@echo off
setlocal
cd /d "%~dp0"
set "TC=D:\SteamCMD\toolchain"
set "ADB=%TC%\android-sdk\platform-tools\adb.exe"
set "APK=%~dp0..\output\we-mpkg.apk"

if not exist "%ADB%" (
  echo [ERROR] adb not found: %ADB%
  pause & exit /b 1
)

echo === connected devices ===
"%ADB%" devices
echo.
echo === install %APK% ===
"%ADB%" install -r "%APK%"
if errorlevel 1 (
  echo.
  echo Install failed. Check: USB debugging on / accept the RSA prompt on the phone / use a data cable.
  pause & exit /b 1
)

echo.
echo === launch app ===
"%ADB%" shell am force-stop com.wempkg.app
"%ADB%" shell am start -n com.wempkg.app/.MainActivity

echo.
echo === logcat (Ctrl+C to stop) ===
"%ADB%" logcat -c
"%ADB%" logcat wempkg:V wempkg-jni:V wempkg-node:V AndroidRuntime:E *:S
