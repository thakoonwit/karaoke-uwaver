@echo off
title VRS Office Radio - Install Windows Service

echo ==================================================
echo   VRS Office Radio - Install Windows Service
echo ==================================================
echo.

if not exist "node_modules\node-windows\" (
    echo [!] Installing node-windows module...
    call npm install node-windows
    echo.
)

echo [>] Installing VRS Office Radio as a background Windows Service...
call node service-install.js

echo.
echo [OK] Done! The system will now run automatically in the background every time Windows boots up.
echo.
pause
