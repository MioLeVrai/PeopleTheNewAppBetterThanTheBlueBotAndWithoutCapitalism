@echo off
setlocal
title People - Patch volume local et pings
cd /d "%~dp0"

if not exist "PATCH_PEOPLE_VOLUME_PING.ps1" (
    echo [ERREUR] PATCH_PEOPLE_VOLUME_PING.ps1 est introuvable.
    echo.
    echo Garde le BAT et le PS1 dans le meme dossier.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0PATCH_PEOPLE_VOLUME_PING.ps1"

set "ERR=%ERRORLEVEL%"
echo.

if not "%ERR%"=="0" (
    echo Le patch a rencontre une erreur.
) else (
    echo Patch termine.
)

echo.
pause
exit /b %ERR%
