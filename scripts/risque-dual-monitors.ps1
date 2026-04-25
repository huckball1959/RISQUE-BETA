#Requires -Version 5.0
$ErrorActionPreference = "Stop"

$p = $env:RISQUE_PORT
if ([string]::IsNullOrWhiteSpace($p)) { $p = "5500" }
$base = "http://127.0.0.1:$p"
$hostUrl = "$base/index.html"
# Same shape as index.html "Open public board" (game-shell expects display=public, tvBootstrap clears stale phase)
$publicUrl = "$base/game.html?display=public&tvBootstrap=1"

Add-Type -AssemblyName System.Windows.Forms

function Get-BrowserPath {
    $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $c1 = Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"
    $c2 = Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"
    $e1 = Join-Path ${env:ProgramFiles} "Microsoft\Edge\Application\msedge.exe"
    $e2 = if ($pf86) { Join-Path $pf86 "Microsoft\Edge\Application\msedge.exe" } else { $null }
    foreach ($x in @($c1, $c2, $e1, $e2)) {
        if ($x -and (Test-Path -LiteralPath $x)) { return $x }
    }
    return $null
}

$exe = Get-BrowserPath
if (-not $exe) {
    Write-Host "ERROR: Chrome or Edge not found in standard locations." -ForegroundColor Red
    exit 1
}

$hostDir = Join-Path $env:TEMP "risque-chrome-host"
$pubDir = Join-Path $env:TEMP "risque-chrome-public"
foreach ($d in @($hostDir, $pubDir)) {
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
}

$primary = [System.Windows.Forms.Screen]::PrimaryScreen
$all = [System.Windows.Forms.Screen]::AllScreens
$secondary = $null
foreach ($s in $all) {
    if ($s.DeviceName -ne $primary.DeviceName) {
        $secondary = $s
        break
    }
}

function Start-BrowserOnBounds {
    param(
        [string]$UserDataDir,
        [System.Drawing.Rectangle]$Bounds,
        [string]$Url,
        [switch]$Fullscreen
    )
    $left = [int]$Bounds.Left
    $top = [int]$Bounds.Top
    $w = [int]$Bounds.Width
    $h = [int]$Bounds.Height
    $args = @(
        "--user-data-dir=$UserDataDir",
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate"
    )
    if ($Fullscreen) {
        # Place on the target monitor first, then fullscreen (omit window-size; it fights fullscreen on some builds).
        $args += "--window-position=$left,$top"
        $args += "--start-fullscreen"
    } else {
        $args += "--window-position=$left,$top"
        $args += "--window-size=$w,$h"
        $args += "--start-maximized"
    }
    $args += $Url
    Start-Process -FilePath $exe -ArgumentList $args -WindowStyle Normal
}

$pb = $primary.Bounds

if ($null -eq $secondary) {
    Write-Host "Only one display detected: opening host tab, then public tab (same screen)." -ForegroundColor Yellow
    Start-BrowserOnBounds -UserDataDir $hostDir -Bounds $pb -Url $hostUrl -Fullscreen
    Start-Sleep -Milliseconds 900
    Start-BrowserOnBounds -UserDataDir $pubDir -Bounds $pb -Url $publicUrl -Fullscreen
    exit 0
}

$sb = $secondary.Bounds
Write-Host "Primary:   $($primary.DeviceName) @ $($pb.Left),$($pb.Top) size $($pb.Width)x$($pb.Height)"
Write-Host "Secondary: $($secondary.DeviceName) @ $($sb.Left),$($sb.Top) size $($sb.Width)x$($sb.Height)"

# Laptop is often primary (built-in); projector/TV as extended — host on primary, TV on secondary.
Start-BrowserOnBounds -UserDataDir $hostDir -Bounds $pb -Url $hostUrl -Fullscreen
Start-Sleep -Milliseconds 700
Start-BrowserOnBounds -UserDataDir $pubDir -Bounds $sb -Url $publicUrl -Fullscreen

exit 0
