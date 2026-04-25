@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Same default port as VS Code Live Server so localStorage matches when you switch tools (same host).
REM Stop Live Server before running this, or the port-free step below will stop whatever is listening.
set "HTTP_PORT=5500"
REM Free older RISQUE launcher port and legacy Node second port.
set "OLD_HTTP_PORT=8765"
set "OLD_ALT_PORT=9876"

echo.
echo RISQUE — stopping prior dev servers on ports %HTTP_PORT%, %OLD_HTTP_PORT%, %OLD_ALT_PORT%...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { $ports = @(%HTTP_PORT%, %OLD_HTTP_PORT%, %OLD_ALT_PORT%); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } }"
echo   Done.
echo.

REM Brief pause so the port is released before we bind again.
ping -n 2 127.0.0.1 >nul

echo Starting one static server in:
echo   %CD%
echo.

set "MAIN_PORT="

where python >nul 2>&1
if not errorlevel 1 (
  echo   Python: http://127.0.0.1:%HTTP_PORT%/
  start "RISQUE HTTP ^(Python %HTTP_PORT%^)" /MIN /D "%~dp0" cmd /c "python -m http.server %HTTP_PORT%"
  set "MAIN_PORT=%HTTP_PORT%"
) else (
  where py >nul 2>&1
  if not errorlevel 1 (
    echo   Python ^(py^): http://127.0.0.1:%HTTP_PORT%/
    start "RISQUE HTTP ^(Python %HTTP_PORT%^)" /MIN /D "%~dp0" cmd /c "py -3 -m http.server %HTTP_PORT%"
    set "MAIN_PORT=%HTTP_PORT%"
  )
)

if not defined MAIN_PORT (
  where node >nul 2>&1
  if not errorlevel 1 (
    echo   Node ^(npx http-server^): http://127.0.0.1:%HTTP_PORT%/
    start "RISQUE HTTP ^(Node %HTTP_PORT%^)" /MIN /D "%~dp0" cmd /c "npx --yes http-server . -p %HTTP_PORT% -c-1"
    set "MAIN_PORT=%HTTP_PORT%"
  )
)

if not defined MAIN_PORT (
  echo.
  echo ERROR: Neither Python nor Node was found on PATH.
  echo Install Python and/or Node, then try again.
  echo.
  pause
  exit /b 1
)

echo.
echo Opening host tab: http://127.0.0.1:!MAIN_PORT!/index.html
echo Open the public board yourself in another tab when you are ready ^(same URL base^).
echo.
echo Note: Port %HTTP_PORT% matches Live Server default — saved game data ^(localStorage^) is shared
echo   when you alternate Live Server and this script, if you use the same host ^(e.g. 127.0.0.1^).
echo   http://localhost:5500 and http://127.0.0.1:5500 are still different sites — pick one.
echo.

ping -n 3 127.0.0.1 >nul

set "RISQUE_PORT=!MAIN_PORT!"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { $p = $env:RISQUE_PORT; if ([string]::IsNullOrWhiteSpace($p)) { exit 1 }; $idx = ('http://127.0.0.1:{0}/index.html' -f $p); $c1 = Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'; $c2 = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Google\Chrome\Application\chrome.exe'; $e1 = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe'; $e2 = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'; if (Test-Path -LiteralPath $c1) { Start-Process $c1 $idx } elseif (Test-Path -LiteralPath $c2) { Start-Process $c2 $idx } elseif (Test-Path -LiteralPath $e1) { Start-Process $e1 $idx } elseif (Test-Path -LiteralPath $e2) { Start-Process $e2 $idx } else { Start-Process $idx } }"

endlocal
