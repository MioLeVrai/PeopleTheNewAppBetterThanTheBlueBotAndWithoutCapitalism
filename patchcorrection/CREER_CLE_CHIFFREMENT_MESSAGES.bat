@echo off
setlocal
title People - Creer cle chiffrement messages

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable.
  pause
  exit /b 1
)

for /f "delims=" %%K in ('node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"') do set "PEOPLE_KEY=%%K"

echo.
echo ============================================================
echo        CLE DE CHIFFREMENT DES MESSAGES PEOPLE
echo ============================================================
echo.
echo Variable Render :
echo.
echo PEOPLE_MESSAGE_ENCRYPTION_KEY
echo.
echo Valeur :
echo.
echo %PEOPLE_KEY%
echo.
echo ============================================================
echo.

powershell -NoProfile -Command "Set-Clipboard -Value '%PEOPLE_KEY%'" >nul 2>nul

if not errorlevel 1 (
  echo [OK] La valeur a aussi ete copiee dans le presse-papiers.
)

echo.
echo IMPORTANT :
echo   - garde cette cle en lieu sur
echo   - ne la mets jamais dans GitHub
echo   - si tu la perds, les messages chiffres deviennent illisibles
echo   - ne change pas la cle apres la migration
echo.
pause
