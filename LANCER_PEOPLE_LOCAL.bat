@echo off
setlocal
title People - Local
cd /d "%~dp0"

echo.
echo ===============================
echo           PEOPLE
echo ===============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [INFO] Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
  )
)

set "PORT=3000"
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%P in ('powershell -NoProfile -Command "$p=3001; while(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue){$p++}; $p"') do set "PORT=%%P"
)

echo [OK] People va demarrer sur http://localhost:%PORT%
start "" "http://localhost:%PORT%"
set PORT=%PORT%
call npm start
pause
