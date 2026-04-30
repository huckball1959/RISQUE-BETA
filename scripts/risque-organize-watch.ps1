# Keeps C:\RISQUE\SAVE tidy: moves new *.json from root into GAME / REPLAY / STAGING while you play.
# Single instance (mutex). Started automatically by launch2.ps1. To stop: Task Manager -> end this PowerShell.

param(
    [string]$SaveRoot = "C:\RISQUE\SAVE",
    [int]$IntervalSeconds = 25
)

$ErrorActionPreference = "SilentlyContinue"

$mutexName = "Global\RisqueOrganizeWatchV1"
try {
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    if (-not $mutex.WaitOne(0)) {
        exit 0
    }
}
catch {
    exit 0
}

$organizePs1 = Join-Path $PSScriptRoot "organize-risque-saves.ps1"
if (-not (Test-Path -LiteralPath $organizePs1)) {
    try { $mutex.ReleaseMutex() } catch { }
    exit 1
}

try {
    while ($true) {
        Start-Sleep -Seconds $IntervalSeconds
        try {
            & $organizePs1 -SaveRoot $SaveRoot
        }
        catch {
            # ignore
        }
    }
}
finally {
    try { $mutex.ReleaseMutex() } catch { }
}
