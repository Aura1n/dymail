# Renders the Dymail app icon with real alpha and exports every size the
# Windows icon bundle and the tray need.
#   powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'icon-out')
)

Add-Type -AssemblyName System.Drawing

$master = 1024
$sizes = @(16, 24, 32, 48, 64, 256, 512)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-RoundedRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Set-DrawQuality($g) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

function Get-DrawColor([int]$rgb, [int]$alpha) {
    return [System.Drawing.Color]::FromArgb($alpha, ($rgb -shr 16) -band 255, ($rgb -shr 8) -band 255, $rgb -band 255)
}

function New-VerticalBrush([single]$y, [single]$h, [int]$top, [int]$bottom, $mid) {
    $rect = [System.Drawing.RectangleF]::new([single]0, $y, [single]$master, $h)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $rect,
        (Get-DrawColor $top 255),
        (Get-DrawColor $bottom 255),
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $brush.GammaCorrection = $true
    if ($null -ne $mid) {
        $blend = New-Object System.Drawing.Drawing2D.ColorBlend(0)
        $colors = [System.Drawing.Color[]]@(
            (Get-DrawColor $top 255),
            (Get-DrawColor $mid[0] $mid[1]),
            (Get-DrawColor $bottom 255)
        )
        $positions = [single[]]@([single]0, [single]$mid[2], [single]1)
        $blend.Colors = $colors
        $blend.Positions = $positions
        $brush.InterpolationColors = $blend
    }
    return $brush
}

# --- master canvas -----------------------------------------------------------
$canvas = New-Object System.Drawing.Bitmap($master, $master, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($canvas)
Set-DrawQuality $g
$g.Clear([System.Drawing.Color]::Transparent)

$pad = 26
$tileSize = [single]($master - $pad * 2)
$tile = New-RoundedRect $pad $pad $tileSize $tileSize ($tileSize * 0.235)

$tileBrush = New-VerticalBrush $pad $tileSize 0x48A8FF 0x0A50CE $null
$g.FillPath($tileBrush, $tile)
$tileBrush.Dispose()

# Soft gloss fading across the full tile height; keeping one continuous ramp
# avoids the seam a shorter gradient rect leaves where it ends.
$gloss = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.RectangleF]::new([single]$pad, [single]$pad, $tileSize, $tileSize),
    (Get-DrawColor 0xFFFFFF 40),
    (Get-DrawColor 0xFFFFFF 0),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
$gloss.GammaCorrection = $true
$state = $g.Save()
[void]$g.SetClip($tile)
$g.FillRectangle($gloss, [single]$pad, [single]$pad, $tileSize, $tileSize)
$g.Restore($state)
$gloss.Dispose()

# --- envelope ----------------------------------------------------------------
$envW = [single]($master * 0.545)
$envH = [single]($envW * 0.685)
$envX = [single](($master - $envW) / 2)
$envY = [single](($master - $envH) / 2)
$cx = [single]($envX + $envW / 2)
$apexY = [single]($envY + $envH * 0.74)
$apexR = [single]($envW * 0.045)

$body = New-RoundedRect $envX $envY $envW $envH ($envW * 0.082)
$bodyBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPath($bodyBrush, $body)
$bodyBrush.Dispose()

# The flap is clipped to the body so it can never spill past the rounded corners.
$state = $g.Save()
[void]$g.SetClip($body)

$flapBrush = New-VerticalBrush $envY ($apexY - $envY) 0xF8FBFF 0xD6E4F6 $null
$flap = New-Object System.Drawing.Drawing2D.GraphicsPath
$flap.AddPolygon([System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(($envX - 4), $envY),
        [System.Drawing.PointF]::new(($envX + $envW + 4), $envY),
        [System.Drawing.PointF]::new($cx, $apexY)
    ))
$g.FillPath($flapBrush, $flap)
# Disc on the apex rounds the downward point.
$g.FillEllipse($flapBrush, ($cx - $apexR), ($apexY - $apexR * 2), ($apexR * 2), ($apexR * 2))
$flap.Dispose()

$creasePen = New-Object System.Drawing.Pen((Get-DrawColor 0xB4CBE8 255), [single]6.0)
$creasePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$creasePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($creasePen, $envX, $envY, $cx, $apexY)
$g.DrawLine($creasePen, ($envX + $envW), $envY, $cx, $apexY)
$creasePen.Dispose()

$g.Restore($state)
$flapBrush.Dispose()
$body.Dispose()
$tile.Dispose()
$g.Dispose()

# --- exports -----------------------------------------------------------------
foreach ($size in $sizes) {
    $scaled = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $sg = [System.Drawing.Graphics]::FromImage($scaled)
    Set-DrawQuality $sg
    $attrs = New-Object System.Drawing.Imaging.ImageAttributes
    $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    [void]$sg.DrawImage($canvas, $destRect, 0, 0, $master, $master, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
    $attrs.Dispose()
    $sg.Dispose()
    $scaled.Save((Join-Path $OutDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $scaled.Dispose()
}

$canvas.Save((Join-Path $OutDir 'icon-1024.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()

Write-Host "rendered -> $OutDir"
