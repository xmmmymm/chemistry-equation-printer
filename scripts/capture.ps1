# 截图化学方程式应用窗口：SHOT=1 启动应用（自定位 0,0 并置前台）→ 屏幕区域截图
param([string]$ProjectDir = (Get-Location), [string]$OutPath = 'build\preview_eq.png', [int]$WaitSec = 10)

Get-Process -Name '化学方程式组卷打印系统' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$env:SHOT = '1'
$env:SMOKE = $null
$proc = Start-Process -FilePath (Join-Path $ProjectDir 'node_modules\electron\dist\electron.exe') -ArgumentList '.' -PassThru -WorkingDirectory $ProjectDir -RedirectStandardOutput (Join-Path $ProjectDir 'build\shot-stdout.txt') -RedirectStandardError (Join-Path $ProjectDir 'build\shot-stderr.txt')
Start-Sleep -Seconds $WaitSec
if (Test-Path (Join-Path $ProjectDir 'build\shot-stdout.txt')) { Get-Content (Join-Path $ProjectDir 'build\shot-stdout.txt') | ForEach-Object { Write-Output ("[app] " + $_) } }

$win = $null
for ($i = 0; $i -lt 20; $i++) {
  $win = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*化学方程式*' -or $_.ProcessName -eq '化学方程式组卷打印系统' } | Select-Object -First 1
  if ($win -and $win.MainWindowHandle -ne 0) { break }
  Start-Sleep -Milliseconds 700
}
if (-not $win -or $win.MainWindowHandle -eq 0) { Write-Output 'NO_WINDOW'; Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; exit 1 }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

$r = New-Object W32+RECT
[W32]::GetWindowRect($win.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
Write-Output ("RECT: {0},{1} {2}x{3}" -f $r.Left, $r.Top, $w, $h)
if ($w -lt 100 -or $h -lt 100) { Write-Output 'BAD_RECT'; Stop-Process -Id $win.Id -Force; exit 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$outFile = Join-Path $ProjectDir $OutPath
$outDir = Split-Path $outFile -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory $outDir -Force | Out-Null }
$bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Stop-Process -Id $win.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Write-Output ("SAVED: " + (Get-Item $outFile).Length + " bytes -> " + $outFile)
