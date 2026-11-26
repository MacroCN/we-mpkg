@echo off
setlocal
cd /d "%~dp0"
rem 工具链位置：环境变量 WE_MPKG_TOOLCHAIN > ANDROID_SDK_ROOT 的上级 > 常见安装位置（存在才用）
rem 找不到就明确报错，不再把某个开发机的路径当默认值
if defined WE_MPKG_TOOLCHAIN set "TC=%WE_MPKG_TOOLCHAIN%"
if not defined TC if defined ANDROID_SDK_ROOT for %%I in ("%ANDROID_SDK_ROOT%\..") do set "TC=%%~fI"
if not defined TC if exist "D:\SteamCMD\toolchain" set "TC=D:\SteamCMD\toolchain"
if not defined TC (
  echo [x] 找不到工具链目录
  echo     设置环境变量 WE_MPKG_TOOLCHAIN 指向含 android-sdk / ndk 的目录，或用 -Toolchain 参数
  exit /b 1
)
if not exist "%TC%" (
  echo [x] 工具链目录不存在：%TC%
  echo     检查 WE_MPKG_TOOLCHAIN 指向是否正确
  exit /b 1
)
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
