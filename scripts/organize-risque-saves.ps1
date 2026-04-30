# Moves committed autosave JSON from SAVE root into GAME / REPLAY / STAGING subfolders.
# Safe to run anytime (launcher calls this before opening the browser).

param(
    [Parameter(Mandatory = $true)][string]$SaveRoot
)

$ErrorActionPreference = "Continue"

$gameDir = Join-Path $SaveRoot "GAME"
$replayDir = Join-Path $SaveRoot "REPLAY"
$stagingDir = Join-Path $SaveRoot "STAGING"

foreach ($d in @($gameDir, $replayDir, $stagingDir)) {
    if (-not (Test-Path -LiteralPath $d)) {
        New-Item -Path $d -ItemType Directory -Force | Out-Null
    }
}

try {
    Get-ChildItem -LiteralPath $SaveRoot -File -Filter "*.json" -ErrorAction Stop | ForEach-Object {
        $n = $_.Name
        $dest = $null
        if ($n -eq "RISQUE-STAGING.json" -or ($n -like "RISQUE-STAGING (*).json")) {
            $dest = Join-Path $stagingDir "RISQUE-STAGING.json"
        }
        elseif ($n -like "RQGS*" -or $n -like "*browser-backup*.json") {
            $dest = Join-Path $gameDir $n
        }
        elseif ($n -like "RQRP*" -or $n -like "*-replay.json") {
            $dest = Join-Path $replayDir $n
        }
        if ($dest -and ($dest -ne $_.FullName)) {
            if (Test-Path -LiteralPath $dest) {
                Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
            }
            Move-Item -LiteralPath $_.FullName -Destination $dest -Force -ErrorAction SilentlyContinue
        }
    }
}
catch {
    # Folder missing or empty — ignore
}
