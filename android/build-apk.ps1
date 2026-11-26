# 一键构建 Android APK
# 用法: powershell -ExecutionPolicy Bypass -File build-apk.ps1
param(
    [string]$Toolchain = 'D:\SteamCMD\toolchain',
    [ValidateSet('debug', 'release')]
    [string]$Variant = 'debug'
)

$ErrorActionPreference = 'Stop'
$projRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$appDir = Join-Path $PSScriptRoot 'app'
$jniDir = Join-Path $appDir 'src\main\jniLibs\arm64-v8a'
$assetsDir = Join-Path $appDir 'src\main\assets\nodejs-project'
$libnodeGz = Join-Path $Toolchain 'nm-cordova\package\libs\android\libnode\bin\arm64-v8a\libnode.so.gz'
$nodeInclude = Join-Path $Toolchain 'nm-cordova\package\libs\android\libnode\include\node'

Write-Host "[1/5] 准备 libnode.so"
New-Item -ItemType Directory -Path $jniDir -Force | Out-Null
$libnodeSo = Join-Path $jniDir 'libnode.so'
if (-not (Test-Path $libnodeSo)) {
    if (-not (Test-Path $libnodeGz)) { throw "找不到 $libnodeGz（先解包 nodejs-mobile-cordova）" }
    $in = [IO.File]::OpenRead($libnodeGz)
    $gz = New-Object IO.Compression.GzipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $out = [IO.File]::Create($libnodeSo)
    $gz.CopyTo($out)
    $out.Dispose(); $gz.Dispose(); $in.Dispose()
}
Write-Host ("    libnode.so {0:N1} MB" -f ((Get-Item $libnodeSo).Length / 1MB))

# libnode.so 依赖 libc++_shared.so（不是系统库，必须一起打包）
$ndkRootForCxx = Get-ChildItem (Join-Path $Toolchain 'android-sdk\ndk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ndkRootForCxx) { throw "没找到 NDK" }
$cxxSrc = Join-Path $ndkRootForCxx.FullName 'toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\lib\aarch64-linux-android\libc++_shared.so'
if (-not (Test-Path $cxxSrc)) { throw "找不到 libc++_shared.so: $cxxSrc" }
Copy-Item $cxxSrc (Join-Path $jniDir 'libc++_shared.so') -Force
Write-Host ("    libc++_shared.so {0:N1} MB" -f ((Get-Item (Join-Path $jniDir 'libc++_shared.so')).Length / 1MB))

# 视频降分辨率用的 Android FFmpeg（LGPL，含 MediaCodec H.264 编码器）。
# 放在 nativeLibraryDir 里以 libffmpeg.so 命名，Node 端通过 WEM_FFMPEG 调用。
$ffmpegSrc = Join-Path $projRoot '.cache\toolchain\ffmpeg-android\ffmpeg'
if (Test-Path $ffmpegSrc) {
    Copy-Item $ffmpegSrc (Join-Path $jniDir 'libffmpeg.so') -Force
    Write-Host ("    libffmpeg.so {0:N1} MB" -f ((Get-Item (Join-Path $jniDir 'libffmpeg.so')).Length / 1MB))
} else {
    Write-Warning '未找到 .cache\toolchain\ffmpeg-android\ffmpeg，Android 视频转码会回退为原样保留'
}

Write-Host "[2/5] 编译 JNI 桥"
$ndkRoot = Get-ChildItem (Join-Path $Toolchain 'android-sdk\ndk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ndkRoot) { throw "没找到 NDK，先 sdkmanager 装 ndk" }
$llvmBin = Join-Path $ndkRoot.FullName 'toolchains\llvm\prebuilt\windows-x86_64\bin'
$clang = Join-Path $llvmBin 'clang++.exe'
if (-not (Test-Path $clang)) { throw "找不到 clang++: $clang" }
$sysroot = Join-Path $ndkRoot.FullName 'toolchains\llvm\prebuilt\windows-x86_64\sysroot'
$shimSo = Join-Path $jniDir 'libwempkg-node.so'
& $clang '--target=aarch64-linux-android24' "-D__ANDROID_API__=24" "--sysroot=$sysroot" `
    '-shared' '-fPIC' '-O2' '-std=c++17' "-I$nodeInclude" `
    '-Wl,-z,max-page-size=16384' '-Wl,-z,common-page-size=16384' `
    (Join-Path $appDir 'src\main\jni\shim.cpp') '-o' $shimSo "-L$jniDir" '-lnode' '-llog'
if (-not (Test-Path $shimSo)) { throw "JNI 桥编译失败" }
Write-Host ("    libwempkg-node.so {0:N1} MB" -f ((Get-Item $shimSo).Length / 1KB))

Write-Host "[3/5] 同步 JS 工程到 assets"
if (Test-Path $assetsDir) { Remove-Item $assetsDir -Recurse -Force }
New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
foreach ($item in @('bin', 'src', 'public', 'package.json')) {
    $src = Join-Path $projRoot $item
    if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination $assetsDir -Recurse -Force }
}

# 纯 JS 下载引擎的依赖（steam-user / steam-session / qrcode-terminal，全部无原生模块）
$nmSrc = Join-Path $projRoot 'node_modules'
if (Test-Path $nmSrc) {
    $nmDst = Join-Path $assetsDir 'node_modules'
    $rc = 0
    $robocopy = Join-Path $env:SystemRoot 'System32\robocopy.exe'
    if (-not (Test-Path $robocopy)) { throw "找不到 robocopy: $robocopy" }
    & $robocopy $nmSrc $nmDst /E /NFL /NDL /NJH /NJS /XD '.github' 'test' 'tests' 'docs' 'examples' '.bin' /XF '*.md' '*.map' '*.ts' '*.gz' '*.zip' > $null
    $rc = $LASTEXITCODE
    if ($rc -ge 8) { throw "复制 node_modules 失败 (robocopy=$rc)" }
}
# 手机端不需要 SteamCMD 相关目录
Get-ChildItem $assetsDir -Recurse -File | Measure-Object -Property Length -Sum |
    ForEach-Object { Write-Host ("    assets {0:N0} 个文件, {1:N1} MB" -f $_.Count, ($_.Sum / 1MB)) }

Write-Host "[4/5] 写 local.properties"
$sdkDir = (Join-Path $Toolchain 'android-sdk').Replace('\', '\\')
Set-Content -Path (Join-Path $PSScriptRoot 'local.properties') -Value "sdk.dir=$sdkDir" -Encoding ASCII
Set-Content -Path (Join-Path $PSScriptRoot 'local.properties') -Value "sdk.dir=$sdkDir" -Encoding ASCII

Write-Host "[5/5] Gradle 构建 ($Variant)"
$env:JAVA_HOME = Join-Path $Toolchain 'jdk'
$env:ANDROID_HOME = Join-Path $Toolchain 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$gradle = Join-Path $Toolchain 'gradle\bin\gradle.bat'
$task = if ($Variant -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
& $gradle '-p' $PSScriptRoot $task '--no-daemon' '--console=plain'

$apk = Get-ChildItem (Join-Path $PSScriptRoot "app\build\outputs\apk\$Variant") -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "没生成 APK" }
$outDir = Join-Path $projRoot 'output'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$dest = Join-Path $outDir 'we-mpkg.apk'

# --- 16 KB 页对齐：.so 不压缩存储，数据区需落在 16 KB 边界，之后再签名 ---
Write-Host "[6/6] 16 KB 对齐 + 重新签名"
$node = 'D:\SteamCMD\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { throw "找不到 node.exe" }
$zipalign16 = Join-Path $projRoot 'tools\zipalign16.js'
$apksigner = Join-Path (Join-Path $Toolchain 'android-sdk\build-tools\34.0.0') 'apksigner.bat'
$aligned = Join-Path $outDir '_aligned.apk'
$signed = Join-Path $outDir '_signed.apk'
Remove-Item $aligned, $signed -Force -ErrorAction SilentlyContinue
& $node $zipalign16 $apk.FullName $aligned
if ($LASTEXITCODE -ne 0) { throw "16 KB 对齐失败" }

if ($Variant -eq 'release') {
    $signingDir = Join-Path $projRoot 'signing'
    $ks = Join-Path $signingDir 'release.keystore'
    $propsPath = Join-Path $signingDir 'keystore.properties'
    if (-not (Test-Path $ks)) { throw "找不到正式签名密钥: $ks" }
    if (-not (Test-Path $propsPath)) { throw "找不到签名配置: $propsPath" }
    $signProps = @{}
    Get-Content -LiteralPath $propsPath | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') { $signProps[$matches[1].Trim()] = $matches[2].Trim() }
    }
    $ksPass = $signProps['storePassword']
    $keyPass = $signProps['keyPassword']
    $alias = $signProps['keyAlias']
    if (-not $ksPass -or -not $alias) { throw "keystore.properties 缺少 storePassword 或 keyAlias" }
    if (-not $keyPass) { $keyPass = $ksPass }
    & $apksigner sign --ks $ks --ks-pass "pass:$ksPass" --key-pass "pass:$keyPass" `
        --ks-key-alias $alias --out $signed $aligned
} else {
    $ks = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.android\debug.keystore'
    & $apksigner sign --ks $ks --ks-pass 'pass:android' --key-pass 'pass:android' `
        --ks-key-alias 'androiddebugkey' --out $signed $aligned
}
if ($LASTEXITCODE -ne 0) { throw "apksigner 签名失败" }
Move-Item $signed $dest -Force
Remove-Item $aligned -Force -ErrorAction SilentlyContinue
& $node $zipalign16 $dest --check | Select-Object -Last 4
Write-Host ("✔ APK: {0}  ({1:N1} MB)" -f $dest, ((Get-Item $dest).Length / 1MB))


