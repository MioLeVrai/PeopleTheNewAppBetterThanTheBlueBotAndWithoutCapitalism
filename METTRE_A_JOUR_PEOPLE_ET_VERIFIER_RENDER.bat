@echo off
setlocal EnableExtensions EnableDelayedExpansion
title People - Push + Verification Render

cd /d "%~dp0"

set "RENDER_URL=https://peoplethenewappbetterthanthebluebotandwithoutcapitalism.onrender.com"

cls
echo.
echo ============================================================
echo          PEOPLE - MISE A JOUR + VERIFICATION RENDER
echo ============================================================
echo.
echo Dossier utilise :
echo %CD%
echo.

REM ------------------------------------------------------------
REM Verifie qu'on est dans le bon projet et que la MAJ camera existe
REM ------------------------------------------------------------
if not exist "server.js" (
    echo [ERREUR] server.js est introuvable.
    echo Mets ce BAT dans D:\crack\Discord 2
    pause
    exit /b 1
)

if not exist "public\index.html" (
    echo [ERREUR] public\index.html est introuvable.
    pause
    exit /b 1
)

findstr /I /C:"cameraButton" "public\index.html" >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERREUR] LA MISE A JOUR CAMERA N'EST PAS DANS CE DOSSIER.
    echo.
    echo Le fichier :
    echo   %CD%\public\index.html
    echo ne contient pas le bouton camera.
    echo.
    echo Recopie People_MAJ_CAMERA.zip dans CE dossier,
    echo puis accepte "Remplacer les fichiers".
    echo.
    pause
    exit /b 1
)

findstr /I /C:"voice-camera" "server.js" >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERREUR] server.js est encore une ancienne version.
    echo Recopie le server.js de la mise a jour camera.
    pause
    exit /b 1
)

echo [OK] Mise a jour camera detectee localement.
echo.

REM ------------------------------------------------------------
REM Git
REM ------------------------------------------------------------
where git >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Git est introuvable.
    pause
    exit /b 1
)

if not exist ".git" (
    echo [ERREUR] Ce dossier n'est pas un depot Git.
    echo Lance d'abord METTRE_PEOPLE_EN_LIGNE.bat.
    pause
    exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Aucun remote GitHub "origin".
    pause
    exit /b 1
)

for /f "delims=" %%R in ('git remote get-url origin') do set "REMOTE=%%R"
echo [OK] Depot distant :
echo !REMOTE!
echo.

REM ------------------------------------------------------------
REM Commit si necessaire
REM ------------------------------------------------------------
echo Fichiers modifies :
echo ------------------------------------------------------------
git status --short
echo ------------------------------------------------------------
echo.

git add -A
if errorlevel 1 (
    echo [ERREUR] git add a echoue.
    pause
    exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
    set "MESSAGE="
    set /p "MESSAGE=Nom de la mise a jour [camera People] : "
    if not defined MESSAGE set "MESSAGE=Ajout camera People"

    echo.
    echo [INFO] Creation du commit...
    git commit -m "!MESSAGE!"
    if errorlevel 1 (
        echo [ERREUR] git commit a echoue.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Aucun nouveau fichier a committer.
    echo [INFO] Je vais quand meme verifier/pousser le commit actuel.
)

REM ------------------------------------------------------------
REM Pousse explicitement HEAD vers main
REM ------------------------------------------------------------
echo.
echo [INFO] Envoi sur GitHub, branche main...
git push origin HEAD:main

if errorlevel 1 (
    echo.
    echo [ERREUR] Le push GitHub a echoue.
    echo.
    echo Copie-moi les lignes juste au-dessus si tu veux que je corrige.
    pause
    exit /b 1
)

REM ------------------------------------------------------------
REM Verification commit local == commit GitHub main
REM ------------------------------------------------------------
for /f "delims=" %%H in ('git rev-parse HEAD') do set "LOCAL_HASH=%%H"
set "REMOTE_HASH="

for /f "tokens=1" %%H in ('git ls-remote origin refs/heads/main') do set "REMOTE_HASH=%%H"

echo.
echo Commit local  : !LOCAL_HASH!
echo Commit GitHub : !REMOTE_HASH!
echo.

if /I not "!LOCAL_HASH!"=="!REMOTE_HASH!" (
    echo [ERREUR] GitHub n'a pas le meme commit que ton PC.
    echo Le probleme est donc entre ton PC et GitHub.
    pause
    exit /b 1
)

echo [OK] GitHub possede exactement ta derniere version.
echo.
echo [INFO] Maintenant j'attends que Render deploie CE code.
echo [INFO] Ca peut prendre quelques minutes.
echo.

REM ------------------------------------------------------------
REM Poll Render jusqu'a ce que l'HTML contienne cameraButton
REM 60 essais x 10 sec = environ 10 minutes
REM ------------------------------------------------------------
set "DEPLOYED="

for /L %%I in (1,1,60) do (
    echo Verification Render %%I/60...

    powershell -NoProfile -Command ^
      "try { $u='%RENDER_URL%/?check=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $r=Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 20; if($r.Content -match 'cameraButton'){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul

    if not errorlevel 1 (
        set "DEPLOYED=1"
        goto RENDER_OK
    )

    timeout /t 10 /nobreak >nul
)

:RENDER_OK
if not defined DEPLOYED (
    echo.
    echo ============================================================
    echo      GITHUB EST A JOUR, MAIS RENDER N'A PAS DEPLOYE
    echo ============================================================
    echo.
    echo Le code avec la camera EST bien sur GitHub.
    echo Le probleme est maintenant cote Render.
    echo.
    echo Ouvre le dashboard Render et regarde :
    echo   - Events
    echo   - Deploys
    echo   - Auto-Deploy
    echo.
    echo Je t'ouvre Render et GitHub.
    start "" "https://dashboard.render.com/"
    start "" "!REMOTE!"
    echo.
    pause
    exit /b 1
)

cls
echo.
echo ============================================================
echo                 PEOPLE EST A JOUR SUR RENDER
echo ============================================================
echo.
echo [OK] Camera detectee dans ton dossier local.
echo [OK] Meme commit confirme sur GitHub.
echo [OK] Nouvelle version detectee sur Render.
echo.
echo Site :
echo %RENDER_URL%
echo.
echo Je l'ouvre avec un parametre anti-cache.
echo.
start "" "%RENDER_URL%/?v=!LOCAL_HASH!"
echo.
echo Si ton navigateur affichait encore l'ancienne page,
echo fais Ctrl+F5 une fois.
echo.
pause
