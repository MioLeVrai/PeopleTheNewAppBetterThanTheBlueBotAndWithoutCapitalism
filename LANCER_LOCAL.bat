@echo off
setlocal
title People - Local
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js est introuvable.
    echo Installe Node.js puis relance ce fichier.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installation des dependances...
    call npm install
    if errorlevel 1 (
        echo npm install a echoue.
        pause
        exit /b 1
    )
)

echo.
echo People demarre sur http://localhost:3000
start "" "http://localhost:3000"
call npm start
pause
