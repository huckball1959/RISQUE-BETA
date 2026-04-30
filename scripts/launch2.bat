@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RISQUE Launcher v2

cls
echo =====================================
echo    RISQUE Launcher v2
echo =====================================
echo.

REM --- Paths you may edit once per machine ---
set "LOCAL_ROOT=C:\GitHub\RISQUE-BETA"
REM No trailing slash. Must match Settings → Pages “Visit site” (project site: https://<user>.github.io/<repo>)
set "GITHUB_PAGES_BASE=https://huckball1959.github.io/RISQUE-BETA"

set "DOWNLOAD_FOLDER=C:\RISQUE\SAVE"

echo Saves/downloads: %DOWNLOAD_FOLDER%
echo.
echo Game source:
echo   L  Local files   — file:/// from your clone
echo      (%LOCAL_ROOT%)
echo   G  GitHub Pages — HTTPS (published site)
echo      (%GITHUB_PAGES_BASE%)
echo.
choice /c LG /n /m "Press L for Local or G for GitHub Pages: "
set "SRC=!ERRORLEVEL!"

if "!SRC!"=="2" (
  echo.
  echo Using GitHub Pages. If the URL 404s, set GITHUB_PAGES_BASE in this .bat to your real Pages root.
  set "URL_HOST=%GITHUB_PAGES_BASE%/index.html"
  set "URL_PUBLIC=%GITHUB_PAGES_BASE%/game.html?display=public"
) else (
  set "URL_HOST=file:///%LOCAL_ROOT:\=/%/index.html"
  set "URL_PUBLIC=file:///%LOCAL_ROOT:\=/%/game.html?display=public"
)

echo.
echo Browser for this session:
echo   C  Chrome   (risque-host-chrome profile)
echo   E  Edge     (risque-host-edge profile)
echo   A  Auto     Chrome if installed, else Edge
echo.
choice /c CEA /n /m "Press C, E, or A: "
set "SEL=!ERRORLEVEL!"
set "RISQUE_BROWSER=auto"
if "!SEL!"=="1" set "RISQUE_BROWSER=chrome"
if "!SEL!"=="2" set "RISQUE_BROWSER=edge"
if "!SEL!"=="3" set "RISQUE_BROWSER=auto"

set "RISQUE_LAUNCH_HOST_URL=%URL_HOST%"
set "RISQUE_LAUNCH_PUBLIC_URL=%URL_PUBLIC%"
set "RISQUE_DOWNLOAD_PATH=%DOWNLOAD_FOLDER%"

REM Fire launcher in the background; this CMD exits so the window closes right away.
start "" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch2.ps1"

endlocal
exit /b 0
