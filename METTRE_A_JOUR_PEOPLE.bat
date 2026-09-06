@echo off
setlocal EnableExtensions EnableDelayedExpansion
title People - Mise a jour GitHub

cd /d "%~dp0"

cls
echo.
echo ============================================================
echo              PEOPLE - MISE A JOUR GITHUB
echo ============================================================
echo.
echo Dossier :
echo %CD%
echo.

REM ------------------------------------------------------------
REM Verifications
REM ------------------------------------------------------------
where git >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Git n'est pas installe ou n'est pas dans le PATH.
    echo Lance d'abord METTRE_PEOPLE_EN_LIGNE.bat.
    echo.
    pause
    exit /b 1
)

if not exist ".git" (
    echo [ERREUR] Ce dossier n'est pas encore relie a GitHub.
    echo.
    echo Lance d'abord METTRE_PEOPLE_EN_LIGNE.bat une premiere fois.
    echo.
    pause
    exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Aucun depot GitHub distant n'est configure.
    echo Lance d'abord METTRE_PEOPLE_EN_LIGNE.bat.
    echo.
    pause
    exit /b 1
)

echo [OK] Depot Git detecte.
for /f "delims=" %%R in ('git remote get-url origin') do set "REMOTE=%%R"
echo [OK] GitHub : !REMOTE!
echo.

REM ------------------------------------------------------------
REM Montre les changements
REM ------------------------------------------------------------
echo Fichiers modifies :
echo ------------------------------------------------------------
git status --short
echo ------------------------------------------------------------
echo.

git status --porcelain | findstr "." >nul
if errorlevel 1 (
    echo [INFO] Aucun changement a envoyer.
    echo.
    pause
    exit /b 0
)

REM ------------------------------------------------------------
REM Message de mise a jour
REM ------------------------------------------------------------
set "MESSAGE="
set /p "MESSAGE=Nom de la mise a jour (ex: ajout avatars) : "

if not defined MESSAGE (
    set "MESSAGE=Mise a jour People"
)

echo.
echo [INFO] Preparation des fichiers...

REM Evite d'envoyer node_modules si .gitignore manque
if not exist ".gitignore" (
    (
        echo node_modules/
        echo .env
        echo npm-debug.log*
        echo *.log
    ) > ".gitignore"
)

git add -A

if errorlevel 1 (
    echo.
    echo [ERREUR] git add a echoue.
    pause
    exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 (
    echo.
    echo [INFO] Aucun changement a enregistrer apres git add.
    pause
    exit /b 0
)

echo [INFO] Creation du commit...
git commit -m "!MESSAGE!"

if errorlevel 1 (
    echo.
    echo [ERREUR] Impossible de creer le commit.
    pause
    exit /b 1
)

REM ------------------------------------------------------------
REM Recupere le nom de la branche
REM ------------------------------------------------------------
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"

if not defined BRANCH (
    set "BRANCH=main"
)

echo.
echo [INFO] Envoi sur GitHub...
git push origin !BRANCH!

if errorlevel 1 (
    echo.
    echo [ERREUR] Le push GitHub a echoue.
    echo.
    echo Si GitHub te demande de te reconnecter, lance :
    echo CONNECTER_GITHUB.bat
    echo puis relance ce fichier.
    echo.
    pause
    exit /b 1
)

cls
echo.
echo ============================================================
echo                  MISE A JOUR ENVOYEE
echo ============================================================
echo.
echo [OK] People a ete mis a jour sur GitHub.
echo.
echo Commit :
echo !MESSAGE!
echo.
echo Render devrait detecter automatiquement la mise a jour
echo et redeployer People si Auto-Deploy est active.
echo.
echo Tu peux fermer cette fenetre.
echo.
pause
