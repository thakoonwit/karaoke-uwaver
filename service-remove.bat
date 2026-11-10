@echo off
title VRS Office Radio - Uninstall Windows Service

echo ==================================================
echo   VRS Office Radio - Uninstall Windows Service
echo ==================================================
echo.

echo [>] Uninstalling VRS Office Radio Windows Service...
call node service-remove.js

echo.
echo [OK] Service removed.
echo.
pause
