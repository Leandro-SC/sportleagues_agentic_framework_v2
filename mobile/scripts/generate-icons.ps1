# Genera los iconos PWA a partir de apps/platform/src/assets/branding/logo_app_tablo.png.
# Requiere Windows PowerShell + System.Drawing. Uso (desde la raíz del repo):
#   powershell -ExecutionPolicy Bypass -File mobile/scripts/generate-icons.ps1
# Salida: apps/platform/public/icons/*.png (fondo #03111c; "maskable" deja el logo dentro del 66 % central).
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$source = Join-Path $root 'apps\platform\src\assets\branding\logo_app_tablo.png'
$outDir = Join-Path $root 'apps\platform\public\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

$logo = [System.Drawing.Image]::FromFile($source)
$bg = [System.Drawing.ColorTranslator]::FromHtml('#03111c')

function New-Icon([int]$size, [double]$fill, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear($bg)
  $box = [int][Math]::Round($size * $fill)
  $ratio = [Math]::Min($box / $logo.Width, $box / $logo.Height)
  $w = [int][Math]::Round($logo.Width * $ratio)
  $h = [int][Math]::Round($logo.Height * $ratio)
  $g.DrawImage($logo, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h)
  $g.Dispose()
  $path = Join-Path $outDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $check = [System.Drawing.Image]::FromFile($path)
  Write-Output ("{0}: {1}x{2}, {3} bytes" -f $name, $check.Width, $check.Height, (Get-Item $path).Length)
  $check.Dispose()
}

New-Icon 192 0.88 'icon-192.png'
New-Icon 512 0.88 'icon-512.png'
New-Icon 192 0.64 'maskable-192.png'
New-Icon 512 0.64 'maskable-512.png'
New-Icon 180 0.88 'apple-touch-icon.png'
$logo.Dispose()
