@echo off
setlocal
title People - API version desktop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  pause
  exit /b 1
)

node "%~dp0PATCH_SERVEUR_VERSION_DESKTOP.js"

if errorlevel 1 (
  echo.
  echo Le patch a rencontre une erreur.
  pause
  exit /b 1
)

echo.
echo Ensuite pousse le projet sur GitHub / Render.
echo.
pause
