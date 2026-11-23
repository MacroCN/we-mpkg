# =====================================================================
#  一键发布 we-mpkg 到 GitHub
#
#  用法（最省事）：
#    1) 在 GitHub 建一个 Personal Access Token（Fine-grained 或 Classic 的 repo 权限）
#       https://github.com/settings/tokens
#    2) 在命令提示符里临时设一次（不要写进文件）：
#         set GITHUB_TOKEN=ghp_xxxxxxxx
#    3) 双击或运行：
#         powershell -ExecutionPolicy Bypass -File publish-github.ps1
#
#  常用参数：
#    -Repo we-mpkg           仓库名（默认取当前目录名）
#    -Visibility private|public   默认 private（含 Steam 相关脚本，建议先私有）
#    -Yes                      不问，直接建仓库并推送
#    -SkipRelease              只推代码，不建 Release、不传安装包
#
#  做的事：建仓库 → 推 main → 推 tag → 建 Release → 上传 APK/绿色版/源码包
#  凭据只在内存里用，不会写进 .git/config 或任何文件。
# =====================================================================
param(
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Repo  = "",
  [string]$Owner = "",
  [ValidateSet('private','public')][string]$Visibility = 'private',
  [string]$Tag = "",
  [switch]$Yes,
  [switch]$SkipRelease
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$git = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path $git)) { $git = 'git' }

function Say($m) { Write-Host $m }
function Die($m) { Write-Host "`n✘ $m`n" -ForegroundColor Red; exit 1 }

# ---------- 0. 前置检查 ----------
if (-not $Token) {
  Die @"
没有 GITHUB_TOKEN。

请先去 https://github.com/settings/tokens 建一个 token（勾 repo 权限），然后：
  set GITHUB_TOKEN=你的token
再运行本脚本。
"@
}
if (Test-Path '.git') {
  $null = & $git rev-parse --is-inside-work-tree
  if ($LASTEXITCODE -ne 0) { Die "当前目录不是 git 仓库" }
} else {
  Say "==> 初始化仓库"
  & $git init -b main | Out-Null
}
if (-not $Repo) { $Repo = Split-Path -Leaf (Get-Location) }
if (-not $Tag)  { $Tag  = (& $git describe --tags --abbrev=0 2>$null); if (-not $Tag) { $Tag = "v$((Get-Content package.json -Raw | ConvertFrom-Json).version)" } }

$apiHeaders = @{
  Authorization          = "token $Token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'we-mpkg-publisher'
}

# ---------- 1. 校验 token ----------
Say "==> 校验 token"
try {
  $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $apiHeaders -TimeoutSec 30
} catch {
  Die "token 无效或没权限（$($_.Exception.Message)）"
}
if (-not $Owner) { $Owner = $me.login }
Say "    账号: $($me.login)"

# ---------- 2. 建仓库（已存在就复用）----------
Say "==> 确认仓库 $Owner/$Repo"
$repoExists = $true
try {
  $null = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo" -Headers $apiHeaders -TimeoutSec 30
  Say "    仓库已存在，直接推送"
} catch {
  $repoExists = $false
}

if (-not $repoExists) {
  if (-not $Yes) {
    $ans = Read-Host "确定要在 GitHub 上新建 $Visibility 仓库 $Owner/$Repo 吗？(y/N)"
    if ($ans -notmatch '^[yY]') { Die "已取消" }
  }
  $body = @{
    name        = $Repo
    private     = ($Visibility -eq 'private')
    description = 'Wallpaper Engine 创意工坊 → 手机版 .mpkg：Windows CLI + 网页界面 + 安卓工程'
    has_issues  = $true
    has_wiki    = $false
    auto_init   = $false
  } | ConvertTo-Json
  try {
    $created = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $apiHeaders -Body $body -ContentType 'application/json' -TimeoutSec 30
    Say "    已创建: $($created.html_url)"
  } catch {
    Die "建仓库失败：$($_.Exception.Message)"
  }
}

# ---------- 3. 推代码（token 只出现在本次命令的临时 URL 里）----------
Say "==> 推送 main 与 tag $Tag"
$remoteUrl = "https://github.com/$Owner/$Repo.git"

# 已存在 origin 就先删掉（没有时 git 会报错，用 try 吃掉）
if ((& $git remote) -contains 'origin') {
  try { & $git remote remove origin | Out-Null } catch { }
}
& $git remote add origin $remoteUrl

# git 会把进度打到 stderr，用 Stop 会误判成失败；这一段只看退出码
# 认证走「URL 里带 x-access-token」：实测 http.extraheader 这套在国内网络下
# 会被拒（Invalid username or token），换 URL 方式才稳定；token 只存在于本次命令的
# 临时 URL 里，不会写进 .git/config（origin 仍是干净的 https 地址）
$ErrorActionPreference = 'Continue'
$authedUrl = "https://x-access-token:$Token@github.com/$Owner/$Repo.git"
& $git push $authedUrl main 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = 'Stop'; Die "推送失败（可能是 token 权限不足或网络不通）" }

& $git push $authedUrl "refs/tags/$Tag" 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { Say "⚠ tag 推送失败（可能已存在），继续" }

# 推送走的是临时 URL，顺手把本地分支的 upstream 补成 origin/main
$sha = (& $git rev-parse HEAD).Trim()
& $git update-ref refs/remotes/origin/main $sha 2>$null
& $git config branch.main.remote origin 2>$null
& $git config branch.main.merge refs/heads/main 2>$null
$ErrorActionPreference = 'Stop'

Say "    代码地址: https://github.com/$Owner/$Repo"

# ---------- 4. Release + 附件 ----------
if (-not $SkipRelease) {
  Say "==> 创建 Release $Tag"
  $notes = ''
  $notesFile = Join-Path $root "dist\发布说明-$($Tag.TrimStart('v')).txt"
  if (Test-Path $notesFile) { $notes = Get-Content $notesFile -Raw }
  $ver = $Tag.TrimStart('v')
  $relBody = @{ tag_name = $Tag; name = "we-mpkg $ver"; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
  $rel = $null
  # 已存在同 tag 的 Release 就复用，不要重复创建（会 400）
  try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases/tags/$Tag" -Headers $apiHeaders -TimeoutSec 30
    Say "    Release 已存在，复用: $($rel.html_url)"
  } catch { $rel = $null }

  if (-not $rel) {
    try {
      $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Owner/$Repo/releases" -Headers $apiHeaders -Body $relBody -ContentType 'application/json' -TimeoutSec 30
      Say "    已创建: $($rel.html_url)"
    } catch {
      Say "⚠ Release 未创建（$($_.Exception.Message)），跳过附件上传"
    }
  }

  # GitHub 会把附件名里的中文吃掉，这里统一转成 ASCII 名
  function Asset-Name([string]$n) {
    $n = $n -replace '发布说明', 'RELEASE-NOTES'
    $ascii = -join ($n.ToCharArray() | Where-Object { [int]$_ -lt 128 })
    $ascii = $ascii -replace '[^\w\.\-\+]', '-'
    if ($ascii -match '^-') { $ascii = 'RELEASE-NOTES' + $ascii }
    return $ascii
  }

  if ($rel) {
    $existing = @()
    try { $existing = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases/tags/$Tag" -Headers $apiHeaders).assets | ForEach-Object { $_.name } } catch { }
    $assets = Get-ChildItem (Join-Path $root 'dist') -File |
      Where-Object { $_.Name -match "$([regex]::Escape($ver))" -and $_.Extension -in '.apk','.zip','.txt' }
    foreach ($f in $assets) {
      $an = Asset-Name $f.Name
      if ($existing -contains $an) { Say "    跳过 $an（已存在）"; continue }
      Say "    上传 $($f.Name) -> $an ($([math]::Round($f.Length/1MB,2)) MB)"
      try {
        $null = Invoke-RestMethod -Method Post `
          -Uri "https://uploads.github.com/repos/$Owner/$Repo/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($an))" `
          -Headers $apiHeaders -ContentType 'application/octet-stream' -InFile $f.FullName -TimeoutSec 900
      } catch {
        Say "    ⚠ $($f.Name) 上传失败：$($_.Exception.Message)"
      }
    }
  }
}

Say @"

✔ 发布完成
  仓库   : https://github.com/$Owner/$Repo
  版本   : $Tag
  Release: https://github.com/$Owner/$Repo/releases/tag/$Tag
"@
