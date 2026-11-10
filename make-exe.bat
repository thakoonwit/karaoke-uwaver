@echo off
title VRS Office Radio - Build EXE Package

echo ==================================================
echo   VRS Office Radio - Building Standalone EXE
echo ==================================================
echo.

echo [>] Bundling application into vrs-office-radio.exe...
call npx -y pkg server.js --targets node18-win-x64 --output vrs-office-radio.exe

echo.
if exist "vrs-office-radio.exe" (
    echo [OK] Successfully created vrs-office-radio.exe!
    echo [OK] You can now run vrs-office-radio.exe directly on any Windows PC without installing Node.js.
) else (
    echo [!] Build failed. Please check your internet connection or Node installation.
)

echo.
pause
