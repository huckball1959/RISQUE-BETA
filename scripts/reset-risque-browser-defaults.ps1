# Removes custom download/save paths from RISQUE launcher Chromium profiles only.
# Profiles: %TEMP%\risque-host-chrome, %TEMP%\risque-host-edge (same as launch2.ps1)
# Does not change your normal Chrome/Edge user profiles.

param(
    [switch]$ChromeOnly,
    [switch]$EdgeOnly
)

$ErrorActionPreference = "Stop"

function Get-PreferencesPath {
    param([string]$ProfileRoot)
    Join-Path $ProfileRoot "Default\Preferences"
}

function Remove-IfPresent {
    param(
        $Object,
        [string]$PropertyName
    )
    if ($null -eq $Object) { return }
    $p = $Object.PSObject.Properties[$PropertyName]
    if ($null -ne $p) {
        [void]$Object.PSObject.Properties.Remove($PropertyName)
    }
}

function Reset-RisqueChromiumDownloadPrefs {
    param(
        [Parameter(Mandatory)][string]$ProfileRoot,
        [string]$Label
    )
    $prefsPath = Get-PreferencesPath -ProfileRoot $ProfileRoot
    if (-not (Test-Path -LiteralPath $prefsPath)) {
        return [pscustomobject]@{ Ok = $true; Skipped = $true; Message = "$Label : no Preferences file (profile never used or already clean)." }
    }

    try {
        $raw = Get-Content -LiteralPath $prefsPath -Raw -Encoding UTF8
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Skipped = $false; Message = "$Label : could not read Preferences: $($_.Exception.Message)" }
    }

    $prefs = $raw | ConvertFrom-Json
    if ($null -eq $prefs) {
        return [pscustomobject]@{ Ok = $true; Skipped = $true; Message = "$Label : empty Preferences." }
    }

    if ($prefs.savefile) {
        Remove-IfPresent -Object $prefs.savefile -PropertyName "default_directory"
    }
    if ($prefs.download) {
        Remove-IfPresent -Object $prefs.download -PropertyName "default_directory"
        Remove-IfPresent -Object $prefs.download -PropertyName "prompt_for_download"
    }

    $json = $prefs | ConvertTo-Json -Depth 100
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($prefsPath, $json, $utf8NoBom)

    return [pscustomobject]@{ Ok = $true; Skipped = $false; Message = "$Label : download/save location prefs cleared (Chromium will use its normal defaults for this profile)." }
}

$chromeDir = Join-Path $env:TEMP "risque-host-chrome"
$edgeDir = Join-Path $env:TEMP "risque-host-edge"

Write-Host 'RISQUE - reset launcher download defaults' -ForegroundColor Cyan
Write-Host "Profiles: $chromeDir" -ForegroundColor Gray
Write-Host "          $edgeDir" -ForegroundColor Gray
Write-Host ""

$results = [System.Collections.Generic.List[object]]::new()

if (-not $EdgeOnly) {
    $results.Add((Reset-RisqueChromiumDownloadPrefs -ProfileRoot $chromeDir -Label 'Chrome (profile risque-host-chrome)'))
}
if (-not $ChromeOnly) {
    $results.Add((Reset-RisqueChromiumDownloadPrefs -ProfileRoot $edgeDir -Label 'Edge (profile risque-host-edge)'))
}

foreach ($r in $results) {
    if ($r.Ok) {
        Write-Host $r.Message -ForegroundColor $(if ($r.Skipped) { "DarkGray" } else { "Green" })
    }
    else {
        Write-Host $r.Message -ForegroundColor Red
    }
}

Write-Host ""
Write-Host 'Note: Browsers must be closed for the next launch2 run to read a clean state. If Edge or Chrome is still open with the RISQUE profile, close it before running launch2 again.' -ForegroundColor Yellow
