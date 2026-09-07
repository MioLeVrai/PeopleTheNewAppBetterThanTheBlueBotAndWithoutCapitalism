@echo off
setlocal
title People - Logout vrai coin bas droit
cd /d "%~dp0"

if not exist "PATCH_LOGOUT_VRAI_COIN.js" (
  echo [ERREUR] PATCH_LOGOUT_VRAI_COIN.js est introuvable.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  pause
  exit /b 1
)

node "%~dp0PATCH_LOGOUT_VRAI_COIN.js"

if errorlevel 1 (
  echo.
  echo Le patch a rencontre une erreur.
  pause
  exit /b 1
)

echo.
echo [OK] La porte doit maintenant etre vraiment dans le coin bas droit.
echo.
pause
