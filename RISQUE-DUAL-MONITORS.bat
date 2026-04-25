@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================================
REM  RISQUE — start HTTP server, then:
REM    • Host / menu on the Windows PRIMARY display (usually the laptop panel)
REM    • Public TV on another display (extended monitor), each fullscreen-capable
REM
REM  Uses Chrome or Edge if found. Two separate --user-data-dir profiles so both
REM  windows open instead of merging into one browser.
REM
REM  If both windows land on the same screen, check Windows display arrangement
REM  (Settings — System — Display) and that the external monitor is “extended”
REM  (not duplicate-only).
REM ============================================================================

set "HTTP_PORT=5500"
set "OLD_HTTP_PORT=8765"
set "OLD_ALT_PORT=9876"

echo.
echo RISQUE — stopping prior dev servers on ports %HTTP_PORT%, %OLD_HTTP_PORT%, %OLD_ALT_PORT%...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { $ports = @(%HTTP_PORT%, %OLD_HTTP_PORT%, %OLD_ALT_PORT%); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } } }"
echo   Done.
ping -n 2 127.0.0.1 >nul

set "MAIN_PORT="
where python >nul 2>&1
if not errorlevel 1 (
  start "RISQUE HTTP ^(Python %HTTP_PORT%^)" /MIN /D "%~dp0" cmd /c "python -m http.server %HTTP_PORT%"
  set "MAIN_PORT=%HTTP_PORT%"
) else (
  where py >nul 2>&1
  if not errorlevel 1 (
    start "RISQUE HTTP ^(Python %HTTP_PORT%^)" /MIN /D "%~dp0" cmd /c "py -3 -m http.server %HTTP_PORT%"
    set "MAIN_PORT=%HTTP_PORT%"
  )
)

if not defined MAIN_PORT (
  where node >nul 2>&1
  if not errorlevel 1 (
    start "RISQUE HTTP ^(Node %HTTP_PORT%^)" /MIN /D "%~dp0" cmd /c "npx --yes http-server . -p %HTTP_PORT% -c-1"
    set "MAIN_PORT=%HTTP_PORT%"
  )
)

if not defined MAIN_PORT (
  echo.
  echo ERROR: Neither Python nor Node was found on PATH.
  pause
  exit /b 1
)

echo.
echo Server: http://127.0.0.1:!MAIN_PORT!/
echo Opening host window on primary display and public TV on a second display ^(if present^)...
echo.

ping -n 2 127.0.0.1 >nul

set "RISQUE_PORT=!MAIN_PORT!"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\risque-dual-monitors.ps1"
exit /b %ERRORLEVEL%
