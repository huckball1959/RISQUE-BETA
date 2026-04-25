@echo off
title RISQUE — easy start
cd /d "%~dp0"

cls
echo.
echo ============================================================
echo     RISQUE — EASY START
echo     Double-click this file whenever you want to play.
echo   ============================================================
echo.
echo     What will happen:
echo      1. A small background helper starts (you may see a
echo          minimized black window — that is normal).
echo       2. Your web browser should open to the game menu.
echo.
echo     Important:
echo       - Always start this way.
echo       - Do not open index.html or game.html directly from
echo         the folder — that can lose your game or cause errors.
echo.
echo     Starting now...
echo   ============================================================
echo.

call "%~dp0RISQUE.bat"

echo.
echo   ------------------------------------------------------------
echo     If your browser opened with the RISQUE menu, you can
echo     close this window.
echo.
echo     When you are completely done playing, also close the
echo     small background window (or it keeps using the port).
echo   ------------------------------------------------------------
echo.
pause
