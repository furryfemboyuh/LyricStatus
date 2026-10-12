@echo off
setlocal
cd /d "%~dp0"
title LyricStatus Setup
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required but was not found.
  echo   Opening the download page - install the LTS version, then run setup.bat again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

node setup.js
if errorlevel 1 pause
