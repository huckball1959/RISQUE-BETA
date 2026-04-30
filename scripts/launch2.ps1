# RISQUE Launcher v2
# - Ensures C:\RISQUE\SAVE (or RISQUE_DOWNLOAD_PATH) exists
# - Writes Chromium download prefs (Chrome and Edge use the same Preferences shape)
# - Launches host + public on two monitors (Win32 move for TV)
#
# Env: RISQUE_LAUNCH_HOST_URL, RISQUE_LAUNCH_PUBLIC_URL, RISQUE_DOWNLOAD_PATH
#      RISQUE_BROWSER = auto | chrome | edge   (default auto: Chrome if installed, else Edge)

$chromiumPs1 = Join-Path $PSScriptRoot "risque-chromium-primary.ps1"
if (-not (Test-Path -LiteralPath $chromiumPs1)) { throw "Missing $chromiumPs1" }
. $chromiumPs1

Add-Type -AssemblyName System.Windows.Forms

$hostUrl = if ($env:RISQUE_LAUNCH_HOST_URL) { $env:RISQUE_LAUNCH_HOST_URL.Trim() } else { "" }
$publicUrl = if ($env:RISQUE_LAUNCH_PUBLIC_URL) { $env:RISQUE_LAUNCH_PUBLIC_URL.Trim() } else { "" }

if ([string]::IsNullOrWhiteSpace($hostUrl) -or [string]::IsNullOrWhiteSpace($publicUrl)) {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    $indexPath = Join-Path $repoRoot "index.html"
    $gamePath = Join-Path $repoRoot "game.html"
    if ((Test-Path -LiteralPath $indexPath) -and (Test-Path -LiteralPath $gamePath)) {
        $hostUrl = ([Uri]::new((Resolve-Path $indexPath).Path)).AbsoluteUri
        $publicUrl = ([Uri]::new((Resolve-Path $gamePath).Path)).AbsoluteUri + "?display=public"
        Write-Host "Using default local URLs (repo next to scripts): $hostUrl" -ForegroundColor DarkGray
    }
}

if ([string]::IsNullOrWhiteSpace($hostUrl) -or [string]::IsNullOrWhiteSpace($publicUrl)) {
    throw "Set RISQUE_LAUNCH_HOST_URL and RISQUE_LAUNCH_PUBLIC_URL, or run from launch2.bat / place index.html and game.html beside the repo scripts folder."
}

$downloadPath = if ([string]::IsNullOrWhiteSpace($env:RISQUE_DOWNLOAD_PATH)) {
    "C:\RISQUE\SAVE"
} else {
    $env:RISQUE_DOWNLOAD_PATH.Trim()
}

function Set-RisqueChromiumDownloadDirectory {
    param(
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$DownloadDir
    )
    $defaultDir = Join-Path $ProfileDir "Default"
    $prefsPath = Join-Path $defaultDir "Preferences"
    New-Item -Path $defaultDir -ItemType Directory -Force | Out-Null
    $prefs = @{}
    if (Test-Path $prefsPath) {
        try { $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json -Depth 100 } catch { }
    }
    if (-not $prefs.savefile) { $prefs.savefile = @{} }
    if (-not $prefs.download) { $prefs.download = @{} }
    $prefs.savefile.default_directory = $DownloadDir
    $prefs.download.default_directory = $DownloadDir
    $prefs.download.prompt_for_download = $false
    # Chromium rejects or ignores Preferences if saved with UTF-8 BOM — downloads then fall back to user's Downloads folder.
    $json = $prefs | ConvertTo-Json -Depth 100
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($prefsPath, $json, $utf8NoBom)
}

function Get-RisqueChromeExecutable {
    @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Get-RisqueEdgeExecutable {
    @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

Write-Host "RISQUE Launcher v2 Starting..." -ForegroundColor Green

# === 1. Save folder ===
if (-not (Test-Path -LiteralPath $downloadPath)) {
    New-Item -Path $downloadPath -ItemType Directory -Force | Out-Null
    Write-Host "Created save/download folder: $downloadPath" -ForegroundColor Green
}
else {
    Write-Host "Save folder exists: $downloadPath" -ForegroundColor Green
}

$gameDir = Join-Path $downloadPath "GAME"
$replayDir = Join-Path $downloadPath "REPLAY"
$stagingDir = Join-Path $downloadPath "STAGING"
foreach ($d in @($gameDir, $replayDir, $stagingDir)) {
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -Path $d -ItemType Directory -Force | Out-Null
    }
}

$organizePs1 = Join-Path $PSScriptRoot "organize-risque-saves.ps1"
if (Test-Path -LiteralPath $organizePs1) {
    try {
        & $organizePs1 -SaveRoot $downloadPath
    }
    catch {
        # ignore organize errors
    }
}

# === 2. Pick Chrome or Edge (separate profiles so host+TV share one browser storage + mirror) ===
$chromeExe = Get-RisqueChromeExecutable
$edgeExe = Get-RisqueEdgeExecutable

$browserWant = $env:RISQUE_BROWSER
if ([string]::IsNullOrWhiteSpace($browserWant)) { $browserWant = "auto" }
$browserWant = $browserWant.Trim().ToLower()
if ($browserWant -eq "msedge") { $browserWant = "edge" }

$browserExe = $null
$profileDir = $null
$browserLabel = ""

switch ($browserWant) {
    "chrome" {
        if (-not $chromeExe) { throw "RISQUE_BROWSER=chrome but Google Chrome was not found under Program Files or LocalAppData." }
        $browserExe = $chromeExe
        $profileDir = Join-Path $env:TEMP "risque-host-chrome"
        $browserLabel = "Chrome"
    }
    "edge" {
        if (-not $edgeExe) { throw "RISQUE_BROWSER=edge but Microsoft Edge was not found." }
        $browserExe = $edgeExe
        $profileDir = Join-Path $env:TEMP "risque-host-edge"
        $browserLabel = "Edge"
    }
    Default {
        if ($chromeExe) {
            $browserExe = $chromeExe
            $profileDir = Join-Path $env:TEMP "risque-host-chrome"
            $browserLabel = "Chrome"
        }
        elseif ($edgeExe) {
            $browserExe = $edgeExe
            $profileDir = Join-Path $env:TEMP "risque-host-edge"
            $browserLabel = "Edge"
        }
        else {
            throw "Neither Chrome nor Edge found. Install one of them or set RISQUE_BROWSER."
        }
    }
}

Set-RisqueChromiumDownloadDirectory -ProfileDir $profileDir -DownloadDir $downloadPath
Write-Host "Default download directory set to $downloadPath ($browserLabel profile: $profileDir)" -ForegroundColor Cyan

try {
    $markerPath = Join-Path $downloadPath "RISQUE-LAUNCHER-LAST-RUN.txt"
    $markerLines = @(
        "Last launcher run (local): $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        "Browser: $browserLabel"
        "Host URL: $hostUrl"
        "Public URL: $publicUrl"
        "Profile (user-data-dir): $profileDir"
        "Expected downloads/saves folder: $downloadPath"
        ""
        "Round autosave JSON files appear after a full round completes; a background task moves them into GAME / REPLAY / STAGING folders shortly after they land."
        "If files still land in Downloads, confirm Edge is using this launcher profile (close other Edge windows using the default profile for this test)."
    )
    $utf8Marker = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($markerPath, ($markerLines -join [Environment]::NewLine), $utf8Marker)
}
catch {
    # ignore marker failures
}

# === 3. Monitors ===
$primary = [System.Windows.Forms.Screen]::PrimaryScreen
$secondary = $primary
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    if ($s.DeviceName -ne $primary.DeviceName) {
        $secondary = $s
        break
    }
}

if ($secondary.DeviceName -eq $primary.DeviceName) {
    Write-Warning "Only one display detected — public window will open on top of the host."
}

$pRect = $primary.WorkingArea
$sRect = $secondary.WorkingArea

# === 4. Host on primary (fullscreen) ===
Write-Host "Launching host with $browserLabel on primary ($($pRect.Width)x$($pRect.Height))..." -ForegroundColor Cyan
$hostArgs = @(
    "--user-data-dir=`"$profileDir`""
    "--new-window"
    "--window-position=$($pRect.Left),$($pRect.Top)"
    "--start-fullscreen"
    "--no-first-run"
    "`"$hostUrl`""
)
Start-Process -FilePath $browserExe -ArgumentList $hostArgs

Start-Sleep -Seconds 5

$beforePub = [ChromiumWindowHelper]::ListRootChromium().ToArray()

# === 5. Public / TV + Win32 move to secondary ===
Write-Host "Launching public/TV with $browserLabel (move to secondary $($sRect.Left),$($sRect.Top) $($sRect.Width)x$($sRect.Height))..." -ForegroundColor Cyan
$pubArgs = @(
    "--user-data-dir=`"$profileDir`""
    "--new-window"
    "--no-first-run"
    "`"$publicUrl`""
)
Start-Process -FilePath $browserExe -ArgumentList $pubArgs

$pubHwnd = Wait-RisqueNewChromiumWindow -BeforeHandles $beforePub -TimeoutMs 20000
if ($pubHwnd -eq [IntPtr]::Zero) {
    Write-Warning "Could not detect the new browser window handle — TV may stay on the wrong display."
}
else {
    Start-Sleep -Milliseconds 400
    Move-RisqueChromiumToRect -Handle $pubHwnd -Left $sRect.Left -Top $sRect.Top -Width $sRect.Width -Height $sRect.Height
    Start-Sleep -Milliseconds 700
    Move-RisqueChromiumToRect -Handle $pubHwnd -Left $sRect.Left -Top $sRect.Top -Width $sRect.Width -Height $sRect.Height
    Write-Host "Moved public window to secondary monitor (Win32)." -ForegroundColor Green
}

Write-Host "`nRISQUE Launcher v2 completed." -ForegroundColor Green
Write-Host "Downloads/saves: $downloadPath  |  Browser: $browserLabel" -ForegroundColor Yellow

# Background organizer: moves *.json from SAVE root -> GAME / REPLAY / STAGING while you play (single hidden process).
$watchPs1 = Join-Path $PSScriptRoot "risque-organize-watch.ps1"
if (Test-Path -LiteralPath $watchPs1) {
    try {
        Start-Process -FilePath "powershell.exe" -ArgumentList @(
            "-NoLogo", "-NoProfile", "-ExecutionPolicy Bypass", "-WindowStyle", "Hidden",
            "-File", $watchPs1,
            "-SaveRoot", $downloadPath
        ) | Out-Null
    }
    catch {
        # ignore
    }
}
