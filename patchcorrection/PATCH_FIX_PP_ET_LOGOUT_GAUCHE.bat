@echo off
setlocal
title People - Fix PP et logout bas gauche
cd /d "%~dp0"

if not exist "PATCH_FIX_PP_ET_LOGOUT_GAUCHE.js" (
  echo [ERREUR] PATCH_FIX_PP_ET_LOGOUT_GAUCHE.js est introuvable.
  pause
  exit /b 1
)

if not exist "people-avatar-upload-fix.js" (
  echo [ERREUR] people-avatar-upload-fix.js est introuvable.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  pause
  exit /b 1
)

node "%~dp0PATCH_FIX_PP_ET_LOGOUT_GAUCHE.js"

if errorlevel 1 (
  echo.
  echo Le patch a rencontre une erreur.
  pause
  exit /b 1
)

echo.
echo TEST :
echo   1. Ouvre ton profil et change la PP.
echo   2. Recadre puis Enregistrer.
echo   3. Le bouton doit afficher Compression, Envoi, Verification.
echo   4. La PP doit apparaitre tout de suite.
echo   5. Recharge la page : elle doit toujours etre la.
echo   6. La porte doit etre en bas a gauche.
echo.
pause
