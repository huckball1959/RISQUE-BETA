@echo off
setlocal
title RISQUE — reset download defaults

:: Resets download/save path overrides in the RISQUE-only Chrome/Edge profiles
:: (same folders launch2.ps1 uses). Your normal browser profiles are untouched.
::
:: Optional: set RISQUE_RESET=chrome  or  edge  to only reset one profile.
::   set RISQUE_RESET=chrome
::   reset-risque-browser-defaults.bat

set "PS_ARG="
if /i "%RISQUE_RESET%"=="chrome" set "PS_ARG=-ChromeOnly"
if /i "%RISQUE_RESET%"=="edge" set "PS_ARG=-EdgeOnly"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset-risque-browser-defaults.ps1" %PS_ARG%
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo Failed with exit code %ERR%.
  pause
  exit /b %ERR%
)

echo.
echo Done. You can create a desktop shortcut to this file.
:: Set RISQUE_NOPAUSE=1 before running for a silent shortcut (no "Press any key").
if /i "%RISQUE_NOPAUSE%"=="1" goto skip_pause
pause
:skip_pause
endlocal
