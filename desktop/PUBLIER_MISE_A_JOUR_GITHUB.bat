@echo off
setlocal EnableExtensions EnableDelayedExpansion
title People Desktop - Publier la mise a jour
cd /d "%~dp0"

set "REPO=MioLeVrai/PeopleTheNewAppBetterThanTheBlueBotAndWithoutCapitalism"

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "VERSION=%%V"
set "INSTALLER=dist\People-Setup-!VERSION!.exe"

if not exist "!INSTALLER!" (
  echo [ERREUR] !INSTALLER! est introuvable.
  echo Lance d'abord CREER_SETUP_PARTAGEABLE.bat.
  pause
  exit /b 1
)

where gh >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERREUR] GitHub CLI ^(gh^) n'est pas installe.
  echo Publie manuellement :
  echo   !INSTALLER!
  echo dans la Release v!VERSION! du depot :
  echo   https://github.com/%REPO%/releases
  echo.
  start "" "https://github.com/%REPO%/releases"
  pause
  exit /b 1
)

gh auth status >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] GitHub CLI n'est pas connecte.
  echo Lance : gh auth login
  pause
  exit /b 1
)

echo.
echo Publication People v!VERSION!...
echo.

gh release view "v!VERSION!" --repo "%REPO%" >nul 2>nul
if errorlevel 1 (
  gh release create "v!VERSION!" "!INSTALLER!#People-Setup-!VERSION!.exe" --repo "%REPO%" --title "People v!VERSION!" --notes "Mise a jour People v!VERSION!"
) else (
  gh release upload "v!VERSION!" "!INSTALLER!#People-Setup-!VERSION!.exe" --repo "%REPO%" --clobber
)

if errorlevel 1 (
  echo.
  echo [ERREUR] Publication GitHub echouee.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo                INSTALLATEUR PUBLIE
echo ============================================================
echo.
echo Derniere etape :
echo   pousse desktop\release.json sur GitHub / Render.
echo.
echo Des que /api/desktop/version renvoie !VERSION!,
echo les anciennes apps afficheront automatiquement le popup.
echo.
pause
