@echo off
setlocal
title People - Chiffrement messages V1
cd /d "%~dp0"

echo.
echo ============================================================
echo          PEOPLE - CHIFFREMENT MESSAGES V1
echo ============================================================
echo.
echo Cible :
echo   D:\crack\Discord 2\server.js
echo.
echo Algorithme :
echo   AES-256-GCM
echo.
echo Couvre :
echo   MP
echo   messages serveurs
echo   messages systeme
echo   historique des appels
echo   PostgreSQL + JSON local
echo.
echo SECURITE PATCH :
echo   tous les marqueurs sont verifies AVANT toute ecriture.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  pause
  exit /b 1
)

node "%~dp0PATCH_CHIFFREMENT_MESSAGES_V1.js"

if errorlevel 1 (
  echo.
  echo [ERREUR] Le patch a echoue.
  echo [INFO] Si un marqueur manque : 0 fichier modifie.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo                         TERMINE
echo ============================================================
echo.
echo IMPORTANT AVANT DE DEPLOYER SUR RENDER :
echo.
echo   1. Lance CREER_CLE_CHIFFREMENT_MESSAGES.bat
echo   2. Copie la cle
echo   3. Render ^> Environment
echo   4. Ajoute :
echo      PEOPLE_MESSAGE_ENCRYPTION_KEY = ta_cle
echo.
echo Ne mets JAMAIS cette cle dans GitHub.
echo.
pause
