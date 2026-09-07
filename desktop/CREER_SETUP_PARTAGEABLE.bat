@echo off
setlocal EnableExtensions EnableDelayedExpansion
title People Desktop - Creer le Setup
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  echo Installe Node.js puis relance ce fichier.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] npm est introuvable.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "VERSION=%%V"

echo.
echo ============================================================
echo              PEOPLE - CREATION DU SETUP
echo ============================================================
echo.
echo Version : !VERSION!
echo.

echo [1/4] Nettoyage de l'ancien build...
if exist "dist" rmdir /s /q "dist"

echo [2/4] Installation des dependances...
call npm install
if errorlevel 1 goto :error

echo.
echo [3/4] Creation de People-Setup-!VERSION!.exe...
call npm run dist
if errorlevel 1 goto :error

echo.
echo [4/4] Calcul du hash + preparation release.json...
node scripts\finalize-release.js
if errorlevel 1 goto :error

echo.
echo ============================================================
echo                      SETUP PRET
echo ============================================================
echo.
echo Tu peux partager directement :
echo   %CD%\dist\People-Setup-!VERSION!.exe
echo.
echo IMPORTANT :
echo - Le Setup ne contient pas la base de comptes du serveur.
echo - Il installe seulement l'application desktop People.
echo - Pour activer la mise a jour auto chez les amis :
echo   publie cet EXE via PUBLIER_MISE_A_JOUR_GITHUB.bat
echo   puis deploie le release.json sur le serveur People.
echo.
pause
exit /b 0

:error
echo.
echo [ERREUR] Le build a echoue.
pause
exit /b 1
