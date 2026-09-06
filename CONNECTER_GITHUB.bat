@echo off
setlocal
title People - Connexion GitHub

echo.
echo ==========================================
echo        PEOPLE - CONNEXION GITHUB
echo ==========================================
echo.

where gh >nul 2>nul
if errorlevel 1 (
    echo [INFO] GitHub CLI n'est pas disponible.
    echo [INFO] Installation avec winget...
    echo.

    where winget >nul 2>nul
    if errorlevel 1 (
        echo [ERREUR] winget est introuvable.
        echo.
        pause
        exit /b 1
    )

    winget install --id GitHub.cli -e --accept-package-agreements --accept-source-agreements

    echo.
    echo [INFO] Installation terminee.
    echo.
    echo IMPORTANT :
    echo Ferme cette fenetre puis relance CONNECTER_GITHUB.bat
    echo pour que Windows recharge GitHub CLI.
    echo.
    pause
    exit /b 0
)

echo [OK] GitHub CLI detecte :
gh --version
echo.

gh auth status >nul 2>nul
if not errorlevel 1 (
    echo [OK] Tu es deja connecte a GitHub.
    echo.
    pause
    exit /b 0
)

echo [INFO] Ouverture de GitHub dans ton navigateur...
start "" "https://github.com/login"

echo.
echo [INFO] Lancement de la connexion GitHub CLI...
echo.
echo Si GitHub CLI affiche un code, garde-le sous les yeux.
echo Si aucune page ne s'ouvre automatiquement, ouvre :
echo https://github.com/login/device
echo puis entre le code affiche ici.
echo.

gh auth login --hostname github.com --git-protocol https --web

echo.
gh auth status
echo.
echo Si tu vois ton compte GitHub au-dessus, c'est bon.
echo Tu peux maintenant relancer METTRE_PEOPLE_EN_LIGNE.bat
echo.
pause
