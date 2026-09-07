@echo off
setlocal
title People Desktop - Test
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] npm est introuvable.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo [INFO] Installation des dependances...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call npm start
