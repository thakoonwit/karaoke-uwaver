@echo off
title VRS Office Radio - Music Request System

echo ==================================================
echo   VRS Office Radio - System Startup
echo ==================================================
echo.

if not exist ".env" (
    echo [!] .env file not found. Creating .env from .env.example...
    copy .env.example .env
    echo [!] Please update your .env file with your YOUTUBE_API_KEY.
    echo.
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "vrs-office-radio.exe" (
        echo [>] Node.js not detected in PATH. Launching standalone vrs-office-radio.exe...
        echo.
        vrs-office-radio.exe
        pause
        exit /b 0
    ) else (
        echo [!] Error: Node.js is not installed on this PC.
        echo [!] Please run vrs-office-radio.exe directly or install Node.js from https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
)

if not exist "node_modules\dotenv\" (
    echo [!] Dependencies not found. Installing node_modules...
    call npm install
    echo.
)

echo [>] Starting VRS Office Radio Server...
echo.
call node server.js

pause
