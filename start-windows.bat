@echo off
chcp 65001 >nul
title Zreb
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nije instaliran.
  echo   Otvaram https://nodejs.org - preuzmi LTS verziju, instaliraj je i ponovo pokreni ovaj fajl.
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node server.js
pause
