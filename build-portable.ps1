# 打绿色版（免安装、自带 Node 运行时）
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
#   powershell ... -File .\build-portable.ps1 -Version 1.1.0
#
# 产物：
#   dist\we-mpkg-portable\            可直接运行的绿色目录
#   dist\we-mpkg-portable-<版本>.zip  分发包
#
param(
  [string]$Version = '1.0.0',
  [string]$NodeExe = 'D:\SteamCMD\nodejs\node.exe'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
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
if (Test-Path (Join-Path $root 'tools\test-resume.js')) {
  New-Item -ItemType Directory -Path (Join-Path $dst 'tools') -Force | Out-Null
  foreach ($t in @('test-resume.js', 'zipalign16.js', 'align16k.js')) {
    $src = Join-Path $root "tools\$t"
    if (Test-Path $src) { Copy-Item $src (Join-Path $dst "tools\$t") }
  }
}

Write-Host '==> 复制启动脚本与说明'
Copy-Tree (Join-Path $root 'packaging') $dst

Write-Host "==> 内置 Node 运行时: $NodeExe"
if (-not (Test-Path $NodeExe)) { throw "找不到 Node：$NodeExe（用 -NodeExe 指定）" }
New-Item -ItemType Directory -Path (Join-Path $dst 'nodejs') -Force | Out-Null
Copy-Item $NodeExe (Join-Path $dst 'nodejs\node.exe')

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
