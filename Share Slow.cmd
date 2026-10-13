@echo off
rem Double-click to use Slow through this computer from any device.
rem A window opens with your private links. Close it (or press Ctrl+C) to stop sharing.
title Slow sharing
cd /d "%~dp0"
node scripts\share.mjs
echo.
pause
