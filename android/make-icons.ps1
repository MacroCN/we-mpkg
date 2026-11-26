# 从 1536×1536 的原始图生成安卓 mipmap 图标（圆角方形 + 圆形两种）
# 路径全部相对脚本自身，输入图默认 logs/icon-src.png，可用 -Src 指定
param([string]$Src = '')
Add-Type -AssemblyName System.Drawing

$projRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$src = if ($Src) { $Src } else { Join-Path $projRoot 'logs\icon-src.png' }
$resRoot = Join-Path $PSScriptRoot 'app\src\main\res'
$sizes = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }

function New-RoundedBitmap {
    param([System.Drawing.Image]$img, [int]$size, [double]$radiusRatio, [bool]$circle)
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($circle) {
        $path.AddEllipse(0, 0, $size, $size)
    } else {
        # 圆角半径按边长比例；用四段圆弧 + 直边拼圆角矩形
        $r = [double]$size * $radiusRatio
        $d = $r * 2
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $size - $d, $d, $d, 90, 90)
        $path.CloseFigure()
    }

    $g.SetClip($path)
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.ResetClip()
    $g.Dispose()
    return $bmp
}

$img = [System.Drawing.Image]::FromFile($src)
foreach ($k in $sizes.Keys) {
    $size = $sizes[$k]
    $dir = Join-Path $resRoot "mipmap-$k"
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    $r1 = New-RoundedBitmap -img $img -size $size -radiusRatio 0.18 -circle $false
    $r1.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $r1.Dispose()

    $r2 = New-RoundedBitmap -img $img -size $size -radiusRatio 0.18 -circle $true
    $r2.Save((Join-Path $dir 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $r2.Dispose()
}
# 512 的预览图（文档/商店用）
$big = New-RoundedBitmap -img $img -size 512 -radiusRatio 0.18 -circle $false
$big.Save((Join-Path $projRoot 'assets\app-icon-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()

# ---------- 自适应图标（Android 8+）：前景 108dp 画布，内容约占 72dp ----------
$adaptive = @{ 'mdpi' = 108; 'hdpi' = 162; 'xhdpi' = 216; 'xxhdpi' = 324; 'xxxhdpi' = 432 }
foreach ($k in $adaptive.Keys) {
    $canvas = $adaptive[$k]
    $inner = [int]($canvas * 0.72)
    $bmp = New-Object System.Drawing.Bitmap $canvas, $canvas
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.Clear([System.Drawing.Color]::Transparent)
    # 前景用带圆角的图，四周留出安全区
    $fg = New-RoundedBitmap -img $img -size $inner -radiusRatio 0.18 -circle $false
    $off = [int](($canvas - $inner) / 2)
    $g.DrawImage($fg, $off, $off, $inner, $inner)
    $fg.Dispose()
    $g.Dispose()
    $dir = Join-Path $resRoot "mipmap-$k"
    $bmp.Save((Join-Path $dir 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

# 自适应图标声明（背景色 + 前景图）
$anydpi = Join-Path $resRoot 'mipmap-anydpi-v26'
New-Item -ItemType Directory -Path $anydpi -Force | Out-Null
$xml = @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'@
Set-Content -Path (Join-Path $anydpi 'ic_launcher.xml') -Value $xml -Encoding UTF8
Set-Content -Path (Join-Path $anydpi 'ic_launcher_round.xml') -Value $xml -Encoding UTF8

$values = Join-Path $resRoot 'values'
New-Item -ItemType Directory -Path $values -Force | Out-Null
$colors = @'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0B1220</color>
</resources>
'@
Set-Content -Path (Join-Path $values 'colors.xml') -Value $colors -Encoding UTF8

$img.Dispose()
Write-Output '图标已生成'
