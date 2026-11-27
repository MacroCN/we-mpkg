# 打绿色版（免安装、自带 Node 运行时）
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
#   powershell ... -File .\build-portable.ps1 -Version 2.4.11
#   （不写 -Version 就取 package.json 里的 version）
#
# 产物：
#   dist\we-mpkg-portable\            可直接运行的绿色目录
#   dist\we-mpkg-portable-<版本>.zip  分发包
#
param(
  [string]$Version = '',
  [string]$NodeExe = ''
)

$ErrorActionPreference = 'Stop'
# node.exe 从哪来：-NodeExe 参数 > PATH 里的 node（CI 就是这么用的）> 报错。
# 以前默认值写死过某个开发机的路径，换台机器直接跑不起来。
if (-not $NodeExe) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $NodeExe = $cmd.Source }
}
if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
  throw '找不到 node.exe：用 -NodeExe <路径> 指定，或确保 node 在 PATH 里'
}
Write-Host "==> node: $NodeExe"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Version) {
  $pkg = Join-Path $root 'package.json'
  if (Test-Path $pkg) { $Version = (Get-Content $pkg -Raw | ConvertFrom-Json).version }
}
if (-not $Version) { throw '拿不到版本号：用 -Version 指定' }
$dst = Join-Path $root 'dist\we-mpkg-portable'
$robocopy = Join-Path $env:SystemRoot 'System32\robocopy.exe'

function Copy-Tree([string]$src, [string]$to, [string[]]$xd, [string[]]$xf) {
  $rcArgs = @($src, $to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($xd) { $rcArgs += '/XD'; $rcArgs += $xd }
  if ($xf) { $rcArgs += '/XF'; $rcArgs += $xf }
  & $robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败($LASTEXITCODE): $src -> $to" }
}

Write-Host "==> 清理 $dst"
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

Write-Host '==> 复制程序本体'
Copy-Tree (Join-Path $root 'bin')    (Join-Path $dst 'bin')
Copy-Tree (Join-Path $root 'src')    (Join-Path $dst 'src')
Copy-Tree (Join-Path $root 'public') (Join-Path $dst 'public')
Copy-Tree (Join-Path $root 'node_modules') (Join-Path $dst 'node_modules') @('.cache') @('*.md', '*.map', '*.ts', '*.txt')
Copy-Item (Join-Path $root 'package.json') $dst
if (Test-Path (Join-Path $root 'README.md')) { Copy-Item (Join-Path $root 'README.md') (Join-Path $dst 'README.md') }
if (Test-Path (Join-Path $root 'LICENSE')) { Copy-Item (Join-Path $root 'LICENSE') (Join-Path $dst 'LICENSE') }
if (Test-Path (Join-Path $root 'THIRD-PARTY-NOTICES.md')) { Copy-Item (Join-Path $root 'THIRD-PARTY-NOTICES.md') (Join-Path $dst 'THIRD-PARTY-NOTICES.md') }
if (Test-Path (Join-Path $root 'licenses')) { Copy-Tree (Join-Path $root 'licenses') (Join-Path $dst 'licenses') }
if (Test-Path (Join-Path $root 'tools\test-resume.js')) {
  New-Item -ItemType Directory -Path (Join-Path $dst 'tools') -Force | Out-Null
  foreach ($t in @('test-resume.js', 'zipalign16.js', 'align16k.js')) {
    $src = Join-Path $root "tools\$t"
    if (Test-Path $src) { Copy-Item $src (Join-Path $dst "tools\$t") }
  }
}

# ffmpeg：4K / 竖屏视频纹理转码、网页壁纸音频解码要用。
# 只认新版（.cache\toolchain\ffmpeg\bin，CI 从 gyan.dev 拉的官方 essentials）：
# 工坊媒体不可信，不给旧版解码器留任何兜底。
$ffSrc = Join-Path $root '.cache\toolchain\ffmpeg\bin\ffmpeg.exe'
if (Test-Path $ffSrc) {
  $ffDst = Join-Path $dst 'tools\ffmpeg'
  New-Item -ItemType Directory -Path $ffDst -Force | Out-Null
  Copy-Item $ffSrc (Join-Path $ffDst 'ffmpeg.exe') -Force
  Write-Host ("==> 内置 ffmpeg: {0:N1} MB" -f ((Get-Item (Join-Path $ffDst 'ffmpeg.exe')).Length / 1MB))
} else {
  Write-Host '⚠ 未内置 ffmpeg：运行时缺它会提示用户自行下载安装（见 README-GREEN.txt）'
}

Write-Host '==> 复制启动脚本与说明'
Copy-Tree (Join-Path $root 'packaging') $dst

Write-Host "==> 内置 Node 运行时: $NodeExe"
if (-not (Test-Path $NodeExe)) { throw "找不到 Node：$NodeExe（用 -NodeExe 指定）" }
New-Item -ItemType Directory -Path (Join-Path $dst 'nodejs') -Force | Out-Null
Copy-Item $NodeExe (Join-Path $dst 'nodejs\node.exe')
# Node.js 运行时为 MIT 许可，分发时必须随附其许可声明（含内置的 OpenSSL/ICU/V8 等）。
# 找 LICENSE 的顺序：node.exe 同目录 → 上一级 → 仓库里的 licenses\NodeJS-MIT.txt 兜底。
# （CI 用 setup-node，node 目录里不一定带 LICENSE；以前这里只会打一句提示，不解决问题。）
$nodeLicense = Join-Path (Split-Path -Parent $NodeExe) 'LICENSE'
$fallback = Join-Path $root 'licenses\NodeJS-MIT.txt'
if (-not (Test-Path $nodeLicense)) {
  $up = Join-Path (Split-Path -Parent (Split-Path -Parent $NodeExe)) 'LICENSE'
  if (Test-Path $up) { $nodeLicense = $up }
}
if (Test-Path $nodeLicense) {
  Copy-Item $nodeLicense (Join-Path $dst 'nodejs\LICENSE')
} elseif (Test-Path $fallback) {
  Copy-Item $fallback (Join-Path $dst 'nodejs\LICENSE')
  Write-Host '==> Node LICENSE：官方包未随附，已用 licenses\NodeJS-MIT.txt 兜底（MIT 声明）'
} else {
  throw '找不到 Node 的 LICENSE，也没有 licenses\NodeJS-MIT.txt 兜底；为了合规不能继续打包'
}

# 文本文件统一编码：bat 用 CRLF 无 BOM，说明文件用 UTF-8 BOM（记事本才不乱码）
Get-ChildItem $dst -Filter *.bat -File | ForEach-Object {
  $s = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText($_.FullName, $s, (New-Object Text.UTF8Encoding $false))
}
Get-ChildItem $dst -Filter *.txt -File | ForEach-Object {
  $s = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText($_.FullName, $s, (New-Object Text.UTF8Encoding $true))
}

Write-Host '==> 自检：自带 node 能否加载模块'
$n = Join-Path $dst 'nodejs\node.exe'
& $n --version
Push-Location $dst
try {
  & $n -e "require('./src/server.js'); console.log('modules OK')" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '模块加载失败' }
} finally { Pop-Location }

$zip = Join-Path $root ("dist\we-mpkg-portable-$Version.zip")
Write-Host "==> 打包 $zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($dst, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$files = (Get-ChildItem $dst -Recurse -File | Measure-Object).Count
Write-Host ""
Write-Host "完成：dist\we-mpkg-portable\  ($files 个文件)"
Write-Host "      dist\we-mpkg-portable-$Version.zip  ($size MB)"
