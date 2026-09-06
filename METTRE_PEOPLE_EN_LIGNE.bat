@echo off
setlocal EnableExtensions EnableDelayedExpansion
title People - Mise en ligne

cd /d "%~dp0"

set "REPONAME=PeopleTheNewAppBetterThanTheBlueBotAndWithoutCapitalism"

cls
echo.
echo ============================================================
echo                 PEOPLE - MISE EN LIGNE
echo ============================================================
echo.
echo Ce script va :
echo   1. verifier Git et GitHub CLI
echo   2. te connecter a GitHub si besoin
echo   3. envoyer People sur GitHub
echo   4. ouvrir Render
echo.
echo Dossier actuel :
echo %CD%
echo.

REM ------------------------------------------------------------
REM Git
REM ------------------------------------------------------------
where git >nul 2>nul
if errorlevel 1 (
    echo [INFO] Git n'est pas installe.
    echo [INFO] Installation automatique...
    echo.

    where winget >nul 2>nul
    if errorlevel 1 (
        echo [ERREUR] winget est introuvable.
        pause
        exit /b 1
    )

    winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements

    echo.
    echo [INFO] Git vient d'etre installe.
    echo Ferme cette fenetre puis relance ce fichier.
    pause
    exit /b 0
)

REM ------------------------------------------------------------
REM GitHub CLI
REM ------------------------------------------------------------
where gh >nul 2>nul
if errorlevel 1 (
    echo [INFO] GitHub CLI n'est pas installe.
    echo [INFO] Installation automatique...
    echo.

    winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements

    echo.
    echo [INFO] GitHub CLI vient d'etre installe.
    echo Ferme cette fenetre puis relance ce fichier.
    pause
    exit /b 0
)

echo [OK] Git et GitHub CLI sont disponibles.
echo.

REM ------------------------------------------------------------
REM Connexion GitHub
REM ------------------------------------------------------------
gh auth status >nul 2>nul
if errorlevel 1 (
    echo [INFO] Connexion a GitHub...
    echo.
    echo Si le navigateur ne s'ouvre pas, va sur :
    echo https://github.com/login/device
    echo et entre le code affiche dans cette fenetre.
    echo.

    start "" "https://github.com/login/device"
    gh auth login --hostname github.com --git-protocol https --web

    if errorlevel 1 (
        echo.
        echo [ERREUR] Connexion GitHub echouee ou annulee.
        pause
        exit /b 1
    )
)

echo [OK] Connecte a GitHub.
echo.

for /f "delims=" %%U in ('gh api user --jq ".login" 2^>nul') do set "GHUSER=%%U"

if not defined GHUSER (
    echo [ERREUR] Impossible de recuperer ton compte GitHub.
    pause
    exit /b 1
)

echo [OK] Compte GitHub : !GHUSER!
echo.

REM ------------------------------------------------------------
REM Initialise Git
REM ------------------------------------------------------------
if not exist ".git" (
    echo [INFO] Initialisation du depot Git...
    git init
    git branch -M main
)

git config user.name "!GHUSER!" >nul 2>nul
git config user.email "!GHUSER!@users.noreply.github.com" >nul 2>nul

REM Evite d'envoyer node_modules
if not exist ".gitignore" (
    (
        echo node_modules/
        echo .env
        echo npm-debug.log*
    ) > ".gitignore"
)

echo [INFO] Preparation des fichiers...
git add .

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Deploy People"
)

REM ------------------------------------------------------------
REM Repo GitHub
REM ------------------------------------------------------------
gh repo view "!GHUSER!/!REPONAME!" >nul 2>nul
if errorlevel 1 (
    echo [INFO] Creation du depot GitHub...
    gh repo create "!REPONAME!" --public --source=. --remote=origin --push

    if errorlevel 1 (
        echo.
        echo [ERREUR] Impossible de creer le depot GitHub.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Depot GitHub deja existant.

    git remote get-url origin >nul 2>nul
    if errorlevel 1 (
        git remote add origin "https://github.com/!GHUSER!/!REPONAME!.git"
    )

    echo [INFO] Envoi des mises a jour...
    git push -u origin main

    if errorlevel 1 (
        echo.
        echo [ERREUR] Le push GitHub a echoue.
        pause
        exit /b 1
    )
)

set "REPOURL=https://github.com/!GHUSER!/!REPONAME!"
set "RENDERURL=https://render.com/deploy?repo=!REPOURL!"

cls
echo.
echo ============================================================
echo                  GITHUB : TERMINE
echo ============================================================
echo.
echo Ton projet est ici :
echo !REPOURL!
echo.
echo Render va maintenant s'ouvrir.
echo.
echo Sur Render :
echo   1. connecte-toi avec GitHub si besoin
echo   2. accepte l'acces au depot
echo   3. clique sur Deploy Blueprint / Apply
echo   4. attends que le service passe en Live
echo.
echo URL visee :
echo https://peoplethenewappbetterthanthebluebotandwithoutcapitalism.onrender.com
echo.
echo Si ce nom est deja pris, Render te demandera d'en choisir un autre.
echo.
echo Ouverture de GitHub et Render...
start "" "!REPOURL!"
timeout /t 2 /nobreak >nul
start "" "!RENDERURL!"

echo.
pause
