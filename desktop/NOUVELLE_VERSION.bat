@echo off
setlocal EnableExtensions
title People Desktop - Nouvelle version
cd /d "%~dp0"

set "VERSION="
set /p "VERSION=Nouvelle version (ex: 1.0.1) : "

if not defined VERSION (
  echo [ERREUR] Version vide.
  pause
  exit /b 1
)

node scripts\set-version.js "%VERSION%"
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Creation du nouveau Setup...
call CREER_SETUP_PARTAGEABLE.bat
