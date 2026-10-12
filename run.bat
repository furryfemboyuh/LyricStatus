@echo off
cd /d "%~dp0"

if not exist ".env" (
  echo First run - starting setup...
  call setup.bat
  exit /b
)

set EL=node_modules\electron\dist\electron.exe
if exist "%EL%" (
  start "" "%EL%" .
) else (
  title LyricStatus
  node index.js
  pause
)
