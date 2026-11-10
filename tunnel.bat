@echo off
title VRS Office Radio - Public Internet Tunnel

echo ==================================================
echo   VRS Office Radio - Public Internet Tunnel
echo ==================================================
echo.

echo [>] Starting Public Tunnel for Port 3000...
echo [>] Everyone can access the web over 4G/5G Internet!
echo.

call npx -y localtunnel --port 3000

pause
