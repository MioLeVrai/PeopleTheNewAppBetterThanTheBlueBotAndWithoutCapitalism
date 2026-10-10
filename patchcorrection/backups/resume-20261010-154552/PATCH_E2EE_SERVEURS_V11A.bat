@echo off
setlocal EnableExtensions
chcp 65001 >nul
title People - E2EE Serveurs V11A

set "PATCH_TARGET=D:\crack\Discord 2"
set "PATCH_BAT=%~f0"

echo.
echo ============================================================
echo   PEOPLE - E2EE SERVEURS V11A - ARCHITECTURE DES CLES
echo ============================================================
echo   Cible : %PATCH_TARGET%
echo.
echo Ce patch prepare l'E2EE des salons serveur :
echo   - cle AES-256 par salon et par epoch
echo   - generation des cles uniquement cote appareil
echo   - enveloppement par appareil via ECDH P-256 + HKDF + AES-GCM
echo   - le serveur stocke seulement des enveloppes chiffrees
echo   - rotation lors des changements de membres / permissions
echo   - nouvel appareil = nouvel epoch de synchronisation
echo   - distribution paginee pour ne pas imposer une limite fixe de membres
echo   - engagement SHA-256 de la cle pour detecter une enveloppe incoherente
echo.
echo IMPORTANT :
echo   V11A ne chiffre PAS encore le texte des salons.
echo   V11B utilisera cette couche pour chiffrer les messages et pieces jointes.
echo.
echo Une sauvegarde est creee avant modification.
echo Le patch attend exactement la V10 Roles + Permissions.
echo.

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] PowerShell est introuvable.
  pause
  exit /b 90
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:PATCH_BAT);$o='#<POWERSHELL>';$c='#</POWERSHELL>';$a=$t.LastIndexOf($o);$b=$t.LastIndexOf($c);if($a -lt 0 -or $b -le $a){Write-Error 'Bloc PowerShell introuvable';exit 91};$s=$t.Substring($a+$o.Length,$b-($a+$o.Length));&([ScriptBlock]::Create($s))"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [OK] Termine.
) else (
  echo [ECHEC] Code %RC%.
)
echo.
pause
exit /b %RC%

#<POWERSHELL>
$ErrorActionPreference = 'Stop'
$Target = $env:PATCH_TARGET
$BatPath = $env:PATCH_BAT

function Get-Sha([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Payload-Bytes([string]$Name) {
    $all = [IO.File]::ReadAllText($BatPath)
    $open = '#<' + $Name + '>'
    $close = '#</' + $Name + '>'
    $a = $all.LastIndexOf($open)
    $b = $all.LastIndexOf($close)

    if ($a -lt 0 -or $b -le $a) {
        throw "Payload $Name introuvable."
    }

    $start = $a + $open.Length
    $raw = $all.Substring($start, $b - $start) -replace '\s', ''
    return [Convert]::FromBase64String($raw)
}

if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
    throw "Dossier introuvable : $Target"
}

$Specs = @(
    @{ Rel = 'server.js'; Base = 'a5673f297d04e2cbfbf4bede3c947c1129daf0ea85ce1adc5c99677bb67ecac1'; New = 'dd8dc2decff2ec63b562908dd766ba8f9c2926907698d8371ddea722a0d8bd00'; Payload = 'FILE_SERVER'; NewFile = $false },
    @{ Rel = 'public\people-social.js'; Base = 'e70472c6f1ab9696d84a483eb15df6b4f9eba042fc8681aada3ae39210ddb2bf'; New = 'dad5cadd64a4b01275245da2abeff6d5eb7a7ea5b24763cd06a1fee934dc72f0'; Payload = 'FILE_SOCIAL'; NewFile = $false },
    @{ Rel = 'public\index.html'; Base = '9119086eb98a7cb2dde500a0e0a85c06af76ecf62b9a93af92ee33d41675f0c4'; New = 'adec3702bb3fadcac1da26459ef4dddd5893f046414c9b78a62e9167a9256cea'; Payload = 'FILE_INDEX'; NewFile = $false },
    @{ Rel = 'public\people-notifications-sw.js'; Base = 'dfdc4cb8091e8d2e7c317de1b8318d953ee2becdfcfdff89748341f5274c642e'; New = '1f234e098d14bed87192cb067af0125ae654bf9a0f420072d31bd89de728b8b4'; Payload = 'FILE_SW'; NewFile = $false },
    @{ Rel = 'public\people-server-e2ee.js'; Base = ''; New = 'ede685b5df789fce3141d4f84aa1eeb97799da05b8d6ab4e7a66598755c42e78'; Payload = 'FILE_SERVER_E2EE'; NewFile = $true }
)

$states = @{}
$needsWrite = $false

foreach ($spec in $Specs) {
    $path = Join-Path $Target $spec.Rel

    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $hash = Get-Sha $path

        if ($hash -eq $spec.New) {
            $states[$spec.Rel] = 'done'
            continue
        }

        if (-not $spec.NewFile -and $hash -eq $spec.Base) {
            $states[$spec.Rel] = 'write-existing'
            $needsWrite = $true
            continue
        }

        throw (
            "Version inattendue de " + $spec.Rel + ". " +
            "Le patch s'arrete pour ne pas ecraser tes changements. " +
            "Il attend la V10 Roles + Permissions basee sur le ZIP 20260916-005032."
        )
    }

    if (-not $spec.NewFile) {
        throw "Fichier requis absent : $($spec.Rel)"
    }

    $states[$spec.Rel] = 'write-new'
    $needsWrite = $true
}

if (-not $needsWrite) {
    Write-Host '[OK] E2EE Serveurs V11A est deja installe.' -ForegroundColor Green
    exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupRoot = Join-Path $Target ("_backup_server_e2ee_v11a_" + $stamp)
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

function Backup-One([string]$Rel) {
    $src = Join-Path $Target $Rel
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { return }

    $dst = Join-Path $backupRoot $Rel
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Copy-Item -LiteralPath $src -Destination $dst -Force
}

try {
    foreach ($spec in $Specs) {
        if ($states[$spec.Rel] -eq 'write-existing') {
            Backup-One $spec.Rel
        }
    }

    foreach ($spec in $Specs) {
        $state = $states[$spec.Rel]
        if ($state -eq 'done') { continue }

        $path = Join-Path $Target $spec.Rel
        $dir = Split-Path -Parent $path
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }

        $tmp = $path + '.people-v11a-tmp'
        [IO.File]::WriteAllBytes($tmp, (Payload-Bytes $spec.Payload))

        if ((Get-Sha $tmp) -ne $spec.New) {
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
            throw "Verification du payload echouee : $($spec.Rel)"
        }

        Move-Item -LiteralPath $tmp -Destination $path -Force
        Write-Host ("[PATCH] " + $spec.Rel) -ForegroundColor Cyan
    }

    foreach ($spec in $Specs) {
        $path = Join-Path $Target $spec.Rel
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Verification : fichier absent : $($spec.Rel)"
        }
        if ((Get-Sha $path) -ne $spec.New) {
            throw "Verification SHA-256 echouee : $($spec.Rel)"
        }
    }

    $serverText = [IO.File]::ReadAllText((Join-Path $Target 'server.js'))
    if (-not $serverText.Contains('// === PEOPLE_SERVER_E2EE_KEYS_V1_START ===')) {
        throw 'Bloc E2EE serveur V11A absent de server.js.'
    }

    $socialText = [IO.File]::ReadAllText((Join-Path $Target 'public\people-social.js'))
    if (-not $socialText.Contains('// === PEOPLE_E2EE_DEVICE_BRIDGE_V1_START ===')) {
        throw 'Pont appareil E2EE absent de people-social.js.'
    }

    $indexText = [IO.File]::ReadAllText((Join-Path $Target 'public\index.html'))
    if (-not $indexText.Contains('people-server-e2ee.js')) {
        throw 'Chargement people-server-e2ee.js absent de index.html.'
    }

    $node = Get-Command node -ErrorAction SilentlyContinue

    if ($node) {
        foreach ($rel in @(
            'server.js',
            'public\people-social.js',
            'public\people-server-e2ee.js',
            'public\people-notifications-sw.js'
        )) {
            & $node.Source --check (Join-Path $Target $rel)
            if ($LASTEXITCODE -ne 0) {
                throw "Erreur JavaScript apres patch : $rel"
            }
        }
        Write-Host '[OK] Verification JavaScript avec Node.' -ForegroundColor Green
    } else {
        Write-Host '[INFO] Node absent du PATH : verification JS ignoree.' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '[OK] Architecture E2EE serveurs V11A installee.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Ce qui est actif maintenant :'
    Write-Host '  - gestion des epochs de cles par salon'
    Write-Host '  - cles generees uniquement dans les navigateurs'
    Write-Host '  - enveloppes chiffrees par appareil'
    Write-Host '  - rotation join / leave / kick / ban / permissions'
    Write-Host '  - stockage des cles de salon dans IndexedDB comme CryptoKey non exportable'
    Write-Host ''
    Write-Host 'Le texte des salons reste encore en clair jusqu a V11B.'
    Write-Host ("Sauvegarde : " + $backupRoot)
    Write-Host 'Relance Node/People puis fais Ctrl+F5.'
    exit 0
}
catch {
    Write-Host ''
    Write-Host ("[ERREUR] " + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Restauration de la sauvegarde...' -ForegroundColor Yellow

    foreach ($spec in $Specs) {
        $state = $states[$spec.Rel]
        $dst = Join-Path $Target $spec.Rel

        if ($state -eq 'write-existing') {
            $src = Join-Path $backupRoot $spec.Rel
            if (Test-Path -LiteralPath $src -PathType Leaf) {
                Copy-Item -LiteralPath $src -Destination $dst -Force
            }
        }
        elseif ($state -eq 'write-new') {
            Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue
        }

        Remove-Item -LiteralPath ($dst + '.people-v11a-tmp') -Force -ErrorAction SilentlyContinue
    }

    Write-Host 'Restauration terminee.' -ForegroundColor Yellow
    exit 20
}
#</POWERSHELL>

#<FILE_SERVER>
Y29uc3QgZXhwcmVzcyA9IHJlcXVpcmUoImV4cHJlc3MiKTsKY29uc3QgaHR0cCA9IHJlcXVpcmUoImh0dHAiKTsKY29uc3QgeyBTZXJ2ZXIgfSA9IHJlcXVp
cmUoInNvY2tldC5pbyIpOwoKY29uc3QgYXBwID0gZXhwcmVzcygpOwpjb25zdCBzZXJ2ZXIgPSBodHRwLmNyZWF0ZVNlcnZlcihhcHApOwpjb25zdCBpbyA9
IG5ldyBTZXJ2ZXIoc2VydmVyLCB7CiAgcGluZ1RpbWVvdXQ6IDIwMDAwLAogIHBpbmdJbnRlcnZhbDogMTAwMDAKfSk7CgphcHAudXNlKGV4cHJlc3Muc3Rh
dGljKCJwdWJsaWMiKSk7CgovLyA9PT0gUEVPUExFX0FDQ09VTlRTX1YxX1NUQVJUID09PQpjb25zdCBiY3J5cHQgPSByZXF1aXJlKCJiY3J5cHRqcyIpOwpj
b25zdCBqd3QgPSByZXF1aXJlKCJqc29ud2VidG9rZW4iKTsKY29uc3QgeyBQb29sIH0gPSByZXF1aXJlKCJwZyIpOwpjb25zdCBmc0FjY291bnRzID0gcmVx
dWlyZSgiZnMiKTsKY29uc3QgcGF0aEFjY291bnRzID0gcmVxdWlyZSgicGF0aCIpOwpjb25zdCBjcnlwdG9BY2NvdW50cyA9IHJlcXVpcmUoImNyeXB0byIp
OwoKLyogUEVPUExFX1NFUlZFUl9JQ09OX1YxX0pTT05fTElNSVQgKi8KYXBwLnVzZShleHByZXNzLmpzb24oeyBsaW1pdDogIjUxMmtiIiB9KSk7Cgpjb25z
dCBQRU9QTEVfQ09PS0lFID0gInBlb3BsZV9zZXNzaW9uIjsKY29uc3QgUEVPUExFX0RCX1VSTCA9IFN0cmluZyhwcm9jZXNzLmVudi5EQVRBQkFTRV9VUkwg
fHwgIiIpLnRyaW0oKTsKY29uc3QgUEVPUExFX1BST0RVQ1RJT04gPSBwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gInByb2R1Y3Rpb24iOwpjb25zdCBQRU9Q
TEVfTE9DQUxfQUNDT1VOVFMgPSBwYXRoQWNjb3VudHMuam9pbihfX2Rpcm5hbWUsICJwZW9wbGUtYWNjb3VudHMubG9jYWwuanNvbiIpOwpjb25zdCBQRU9Q
TEVfTE9DQUxfU0VDUkVUID0gcGF0aEFjY291bnRzLmpvaW4oX19kaXJuYW1lLCAiLnBlb3BsZS1sb2NhbC1zZWNyZXQiKTsKCmxldCBwZW9wbGVQb29sID0g
bnVsbDsKCmZ1bmN0aW9uIHBlb3BsZVVzZXJuYW1lKHZhbHVlKSB7CiAgcmV0dXJuIFN0cmluZyh2YWx1ZSB8fCAiIikubm9ybWFsaXplKCJORktDIikudHJp
bSgpOwp9CgpmdW5jdGlvbiBwZW9wbGVVc2VybmFtZUtleSh2YWx1ZSkgewogIHJldHVybiBwZW9wbGVVc2VybmFtZSh2YWx1ZSkudG9Mb2NhbGVMb3dlckNh
c2UoImZyLUZSIik7Cn0KCmZ1bmN0aW9uIHBlb3BsZVZhbGlkVXNlcm5hbWUodmFsdWUpIHsKICBjb25zdCBuYW1lID0gcGVvcGxlVXNlcm5hbWUodmFsdWUp
OwogIHJldHVybiAoCiAgICBuYW1lLmxlbmd0aCA+PSAzICYmCiAgICBuYW1lLmxlbmd0aCA8PSAyNCAmJgogICAgL15bXHB7TH1ccHtOfV8uLV0rJC91LnRl
c3QobmFtZSkKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVWYWxpZFBhc3N3b3JkKHZhbHVlKSB7CiAgcmV0dXJuICgKICAgIHR5cGVvZiB2YWx1ZSA9PT0gInN0
cmluZyIgJiYKICAgIHZhbHVlLmxlbmd0aCA+PSA4ICYmCiAgICB2YWx1ZS5sZW5ndGggPD0gMTI4CiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlU2Vzc2lvblNl
Y3JldCgpIHsKICBpZiAocHJvY2Vzcy5lbnYuU0VTU0lPTl9TRUNSRVQpIHsKICAgIHJldHVybiBTdHJpbmcocHJvY2Vzcy5lbnYuU0VTU0lPTl9TRUNSRVQp
OwogIH0KCiAgaWYgKFBFT1BMRV9EQl9VUkwpIHsKICAgIGNvbnNvbGUud2FybigKICAgICAgIltQZW9wbGVdIFNFU1NJT05fU0VDUkVUIGFic2VudCA6IHNl
Y3JldCBkZXJpdmUgZGUgREFUQUJBU0VfVVJMLiIKICAgICk7CiAgICByZXR1cm4gY3J5cHRvQWNjb3VudHMKICAgICAgLmNyZWF0ZUhhc2goInNoYTI1NiIp
CiAgICAgIC51cGRhdGUoUEVPUExFX0RCX1VSTCArICJ8cGVvcGxlLXNlc3Npb24tdjEiKQogICAgICAuZGlnZXN0KCJoZXgiKTsKICB9CgogIGlmIChQRU9Q
TEVfUFJPRFVDVElPTikgewogICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAiREFUQUJBU0VfVVJMIG1hbnF1ZS4gQ29uZmlndXJlIFBvc3RncmVTUUwgZGFu
cyBSZW5kZXIgYXZhbnQgbGUgZGVwbG9pZW1lbnQuIgogICAgKTsKICB9CgogIGlmIChmc0FjY291bnRzLmV4aXN0c1N5bmMoUEVPUExFX0xPQ0FMX1NFQ1JF
VCkpIHsKICAgIHJldHVybiBmc0FjY291bnRzLnJlYWRGaWxlU3luYyhQRU9QTEVfTE9DQUxfU0VDUkVULCAidXRmOCIpLnRyaW0oKTsKICB9CgogIGNvbnN0
IHNlY3JldCA9IGNyeXB0b0FjY291bnRzLnJhbmRvbUJ5dGVzKDQ4KS50b1N0cmluZygiaGV4Iik7CiAgZnNBY2NvdW50cy53cml0ZUZpbGVTeW5jKFBFT1BM
RV9MT0NBTF9TRUNSRVQsIHNlY3JldCwgeyBtb2RlOiAwbzYwMCB9KTsKICByZXR1cm4gc2VjcmV0Owp9Cgpjb25zdCBQRU9QTEVfU0VTU0lPTl9TRUNSRVQg
PSBwZW9wbGVTZXNzaW9uU2VjcmV0KCk7CgovLyA9PT0gUEVPUExFX01FU1NBR0VfRU5DUllQVElPTl9WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX01FU1NB
R0VfRU5DUllQVElPTl9QUkVGSVggPQogICJwZW9wbGUtbXNnOnYxOiI7Cgpjb25zdCBQRU9QTEVfTUVTU0FHRV9FTkNSWVBUSU9OX0FBRCA9CiAgQnVmZmVy
LmZyb20oCiAgICAiUGVvcGxlIG1lc3NhZ2UgZW5jcnlwdGlvbiB2MSIsCiAgICAidXRmOCIKICApOwoKY29uc3QgUEVPUExFX0xPQ0FMX01FU1NBR0VfS0VZ
ID0KICBwYXRoQWNjb3VudHMuam9pbigKICAgIF9fZGlybmFtZSwKICAgICIucGVvcGxlLW1lc3NhZ2UtZW5jcnlwdGlvbi1rZXkiCiAgKTsKCmZ1bmN0aW9u
IHBlb3BsZURlY29kZU1lc3NhZ2VFbmNyeXB0aW9uS2V5KAogIHZhbHVlCikgewogIGNvbnN0IHJhdyA9CiAgICBTdHJpbmcoCiAgICAgIHZhbHVlIHx8CiAg
ICAgICIiCiAgICApLnRyaW0oKTsKCiAgaWYgKCFyYXcpIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgbGV0IGtleSA9CiAgICBudWxsOwoKICBpZiAoCiAg
ICAvXlswLTlhLWZdezY0fSQvaS50ZXN0KAogICAgICByYXcKICAgICkKICApIHsKICAgIGtleSA9CiAgICAgIEJ1ZmZlci5mcm9tKAogICAgICAgIHJhdywK
ICAgICAgICAiaGV4IgogICAgICApOwogIH0gZWxzZSB7CiAgICB0cnkgewogICAgICBrZXkgPQogICAgICAgIEJ1ZmZlci5mcm9tKAogICAgICAgICAgcmF3
LAogICAgICAgICAgImJhc2U2NHVybCIKICAgICAgICApOwogICAgfSBjYXRjaCB7CiAgICAgIGtleSA9CiAgICAgICAgbnVsbDsKICAgIH0KCiAgICBpZiAo
CiAgICAgICFrZXkgfHwKICAgICAga2V5Lmxlbmd0aCAhPT0KICAgICAgICAzMgogICAgKSB7CiAgICAgIHRyeSB7CiAgICAgICAga2V5ID0KICAgICAgICAg
IEJ1ZmZlci5mcm9tKAogICAgICAgICAgICByYXcsCiAgICAgICAgICAgICJiYXNlNjQiCiAgICAgICAgICApOwogICAgICB9IGNhdGNoIHsKICAgICAgICBr
ZXkgPQogICAgICAgICAgbnVsbDsKICAgICAgfQogICAgfQogIH0KCiAgaWYgKAogICAgIWtleSB8fAogICAga2V5Lmxlbmd0aCAhPT0KICAgICAgMzIKICAp
IHsKICAgIGNvbnN0IGVyciA9CiAgICAgIG5ldyBFcnJvcigKICAgICAgICAiUEVPUExFX01FU1NBR0VfRU5DUllQVElPTl9LRVkgZG9pdCBjb250ZW5pciBl
eGFjdGVtZW50IDMyIG9jdGV0cyAiICsKICAgICAgICAiKGJhc2U2NHVybC9iYXNlNjQgb3UgNjQgY2FyYWN0w6hyZXMgaGV4KS4iCiAgICAgICk7CgogICAg
ZXJyLmNvZGUgPQogICAgICAiUEVPUExFX01FU1NBR0VfS0VZX0lOVkFMSUQiOwoKICAgIHRocm93IGVycjsKICB9CgogIHJldHVybiBrZXk7Cn0KCmZ1bmN0
aW9uIHBlb3BsZU1lc3NhZ2VFbmNyeXB0aW9uS2V5KCkgewogIGNvbnN0IGNvbmZpZ3VyZWQgPQogICAgU3RyaW5nKAogICAgICBwcm9jZXNzLmVudgogICAg
ICAgIC5QRU9QTEVfTUVTU0FHRV9FTkNSWVBUSU9OX0tFWSB8fAogICAgICAiIgogICAgKS50cmltKCk7CgogIGlmIChjb25maWd1cmVkKSB7CiAgICByZXR1
cm4gcGVvcGxlRGVjb2RlTWVzc2FnZUVuY3J5cHRpb25LZXkoCiAgICAgIGNvbmZpZ3VyZWQKICAgICk7CiAgfQoKICBpZiAoUEVPUExFX1BST0RVQ1RJT04p
IHsKICAgIGNvbnN0IGVyciA9CiAgICAgIG5ldyBFcnJvcigKICAgICAgICAiUEVPUExFX01FU1NBR0VfRU5DUllQVElPTl9LRVkgbWFucXVlLiAiICsKICAg
ICAgICAiQWpvdXRlIGNldHRlIHZhcmlhYmxlIGRhbnMgUmVuZGVyID4gRW52aXJvbm1lbnQgYXZhbnQgZGUgZMOpbWFycmVyIFBlb3BsZS4iCiAgICAgICk7
CgogICAgZXJyLmNvZGUgPQogICAgICAiUEVPUExFX01FU1NBR0VfS0VZX01JU1NJTkciOwoKICAgIHRocm93IGVycjsKICB9CgogIGlmICgKICAgIGZzQWNj
b3VudHMuZXhpc3RzU3luYygKICAgICAgUEVPUExFX0xPQ0FMX01FU1NBR0VfS0VZCiAgICApCiAgKSB7CiAgICByZXR1cm4gcGVvcGxlRGVjb2RlTWVzc2Fn
ZUVuY3J5cHRpb25LZXkoCiAgICAgIGZzQWNjb3VudHMucmVhZEZpbGVTeW5jKAogICAgICAgIFBFT1BMRV9MT0NBTF9NRVNTQUdFX0tFWSwKICAgICAgICAi
dXRmOCIKICAgICAgKQogICAgKTsKICB9CgogIGNvbnN0IGtleSA9CiAgICBjcnlwdG9BY2NvdW50cy5yYW5kb21CeXRlcygKICAgICAgMzIKICAgICk7Cgog
IGZzQWNjb3VudHMud3JpdGVGaWxlU3luYygKICAgIFBFT1BMRV9MT0NBTF9NRVNTQUdFX0tFWSwKICAgIGtleS50b1N0cmluZygKICAgICAgImJhc2U2NHVy
bCIKICAgICkgKwogICAgICAiXG4iLAogICAgewogICAgICBtb2RlOgogICAgICAgIDBvNjAwCiAgICB9CiAgKTsKCiAgY29uc29sZS5sb2coCiAgICAiW1Bl
b3BsZV0gQ2zDqSBsb2NhbGUgZGUgY2hpZmZyZW1lbnQgbWVzc2FnZXMgY3LDqcOpZS4iCiAgKTsKCiAgcmV0dXJuIGtleTsKfQoKY29uc3QgUEVPUExFX01F
U1NBR0VfRU5DUllQVElPTl9LRVkgPQogIHBlb3BsZU1lc3NhZ2VFbmNyeXB0aW9uS2V5KCk7CgpmdW5jdGlvbiBwZW9wbGVNZXNzYWdlSXNFbmNyeXB0ZWQo
CiAgdmFsdWUKKSB7CiAgcmV0dXJuIFN0cmluZygKICAgIHZhbHVlIHx8CiAgICAiIgogICkuc3RhcnRzV2l0aCgKICAgIFBFT1BMRV9NRVNTQUdFX0VOQ1JZ
UFRJT05fUFJFRklYCiAgKTsKfQoKY29uc3QgUEVPUExFX0RNX0UyRUVfUFJFRklYID0KICAicGVvcGxlLWUyZWUtZG06djE6IjsKCmZ1bmN0aW9uIHBlb3Bs
ZURtRTJlZUlzRW52ZWxvcGUoCiAgdmFsdWUKKSB7CiAgcmV0dXJuIFN0cmluZygKICAgIHZhbHVlIHx8CiAgICAiIgogICkuc3RhcnRzV2l0aCgKICAgIFBF
T1BMRV9ETV9FMkVFX1BSRUZJWAogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZUVuY3J5cHRNZXNzYWdlVGV4dCgKICB2YWx1ZQopIHsKICBjb25zdCBwbGFpbiA9
CiAgICBTdHJpbmcoCiAgICAgIHZhbHVlIHx8CiAgICAgICIiCiAgICApOwoKICBpZiAoCiAgICAhcGxhaW4gfHwKICAgIHBlb3BsZU1lc3NhZ2VJc0VuY3J5
cHRlZCgKICAgICAgcGxhaW4KICAgICkgfHwKICAgIHBlb3BsZURtRTJlZUlzRW52ZWxvcGUoCiAgICAgIHBsYWluCiAgICApCiAgKSB7CiAgICAvKgogICAg
ICBVbiBNUCBFMkVFIGVzdCBkw6lqw6AgY2hpZmZyw6kgY8O0dMOpIGFwcGFyZWlsIDoKICAgICAgbGUgc2VydmV1ciBsZSBjb25zZXJ2ZSBPUEFRVUUuCiAg
ICAqLwogICAgcmV0dXJuIHBsYWluOwogIH0KCiAgY29uc3QgaXYgPQogICAgY3J5cHRvQWNjb3VudHMucmFuZG9tQnl0ZXMoCiAgICAgIDEyCiAgICApOwoK
ICBjb25zdCBjaXBoZXIgPQogICAgY3J5cHRvQWNjb3VudHMuY3JlYXRlQ2lwaGVyaXYoCiAgICAgICJhZXMtMjU2LWdjbSIsCiAgICAgIFBFT1BMRV9NRVNT
QUdFX0VOQ1JZUFRJT05fS0VZLAogICAgICBpdgogICAgKTsKCiAgY2lwaGVyLnNldEFBRCgKICAgIFBFT1BMRV9NRVNTQUdFX0VOQ1JZUFRJT05fQUFECiAg
KTsKCiAgY29uc3QgY2lwaGVydGV4dCA9CiAgICBCdWZmZXIuY29uY2F0KFsKICAgICAgY2lwaGVyLnVwZGF0ZSgKICAgICAgICBwbGFpbiwKICAgICAgICAi
dXRmOCIKICAgICAgKSwKICAgICAgY2lwaGVyLmZpbmFsKCkKICAgIF0pOwoKICBjb25zdCB0YWcgPQogICAgY2lwaGVyLmdldEF1dGhUYWcoKTsKCiAgcmV0
dXJuICgKICAgIFBFT1BMRV9NRVNTQUdFX0VOQ1JZUFRJT05fUFJFRklYICsKICAgIGl2LnRvU3RyaW5nKAogICAgICAiYmFzZTY0dXJsIgogICAgKSArCiAg
ICAiLiIgKwogICAgdGFnLnRvU3RyaW5nKAogICAgICAiYmFzZTY0dXJsIgogICAgKSArCiAgICAiLiIgKwogICAgY2lwaGVydGV4dC50b1N0cmluZygKICAg
ICAgImJhc2U2NHVybCIKICAgICkKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgdmFsdWUKKSB7CiAgY29uc3Qgc3RvcmVk
ID0KICAgIFN0cmluZygKICAgICAgdmFsdWUgfHwKICAgICAgIiIKICAgICk7CgogIGlmICgKICAgICFzdG9yZWQgfHwKICAgIHBlb3BsZURtRTJlZUlzRW52
ZWxvcGUoCiAgICAgIHN0b3JlZAogICAgKSB8fAogICAgIXBlb3BsZU1lc3NhZ2VJc0VuY3J5cHRlZCgKICAgICAgc3RvcmVkCiAgICApCiAgKSB7CiAgICAv
KgogICAgICAtIGFuY2llbnMgbWVzc2FnZXMgZW4gY2xhaXIgOiBjb21wYXRpYmlsaXTDqQogICAgICAtIG5vdXZlYXV4IE1QIEUyRUUgOiBwYXNzYWdlIG9w
YXF1ZSBqdXNxdSdhdSBjbGllbnQKICAgICovCiAgICByZXR1cm4gc3RvcmVkOwogIH0KCiAgY29uc3QgcGF5bG9hZCA9CiAgICBzdG9yZWQuc2xpY2UoCiAg
ICAgIFBFT1BMRV9NRVNTQUdFX0VOQ1JZUFRJT05fUFJFRklYLmxlbmd0aAogICAgKTsKCiAgY29uc3QgcGFydHMgPQogICAgcGF5bG9hZC5zcGxpdCgKICAg
ICAgIi4iCiAgICApOwoKICBpZiAoCiAgICBwYXJ0cy5sZW5ndGggIT09CiAgICAgIDMKICApIHsKICAgIGNvbnN0IGVyciA9CiAgICAgIG5ldyBFcnJvcigK
ICAgICAgICAiTWVzc2FnZSBjaGlmZnLDqSBpbnZhbGlkZS4iCiAgICAgICk7CgogICAgZXJyLmNvZGUgPQogICAgICAiUEVPUExFX01FU1NBR0VfREVDUllQ
VF9GQUlMRUQiOwoKICAgIHRocm93IGVycjsKICB9CgogIHRyeSB7CiAgICBjb25zdCBpdiA9CiAgICAgIEJ1ZmZlci5mcm9tKAogICAgICAgIHBhcnRzWzBd
LAogICAgICAgICJiYXNlNjR1cmwiCiAgICAgICk7CgogICAgY29uc3QgdGFnID0KICAgICAgQnVmZmVyLmZyb20oCiAgICAgICAgcGFydHNbMV0sCiAgICAg
ICAgImJhc2U2NHVybCIKICAgICAgKTsKCiAgICBjb25zdCBjaXBoZXJ0ZXh0ID0KICAgICAgQnVmZmVyLmZyb20oCiAgICAgICAgcGFydHNbMl0sCiAgICAg
ICAgImJhc2U2NHVybCIKICAgICAgKTsKCiAgICBpZiAoCiAgICAgIGl2Lmxlbmd0aCAhPT0KICAgICAgICAxMiB8fAogICAgICB0YWcubGVuZ3RoICE9PQog
ICAgICAgIDE2CiAgICApIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICJGb3JtYXQgQUVTLUdDTSBpbnZhbGlkZS4iCiAgICAgICk7CiAgICB9
CgogICAgY29uc3QgZGVjaXBoZXIgPQogICAgICBjcnlwdG9BY2NvdW50cy5jcmVhdGVEZWNpcGhlcml2KAogICAgICAgICJhZXMtMjU2LWdjbSIsCiAgICAg
ICAgUEVPUExFX01FU1NBR0VfRU5DUllQVElPTl9LRVksCiAgICAgICAgaXYKICAgICAgKTsKCiAgICBkZWNpcGhlci5zZXRBQUQoCiAgICAgIFBFT1BMRV9N
RVNTQUdFX0VOQ1JZUFRJT05fQUFECiAgICApOwoKICAgIGRlY2lwaGVyLnNldEF1dGhUYWcoCiAgICAgIHRhZwogICAgKTsKCiAgICByZXR1cm4gQnVmZmVy
LmNvbmNhdChbCiAgICAgIGRlY2lwaGVyLnVwZGF0ZSgKICAgICAgICBjaXBoZXJ0ZXh0CiAgICAgICksCiAgICAgIGRlY2lwaGVyLmZpbmFsKCkKICAgIF0p
LnRvU3RyaW5nKAogICAgICAidXRmOCIKICAgICk7CiAgfSBjYXRjaCAoY2F1c2UpIHsKICAgIGNvbnN0IGVyciA9CiAgICAgIG5ldyBFcnJvcigKICAgICAg
ICAiSW1wb3NzaWJsZSBkZSBkw6ljaGlmZnJlciB1biBtZXNzYWdlLiAiICsKICAgICAgICAiVsOpcmlmaWUgUEVPUExFX01FU1NBR0VfRU5DUllQVElPTl9L
RVkuIgogICAgICApOwoKICAgIGVyci5jb2RlID0KICAgICAgIlBFT1BMRV9NRVNTQUdFX0RFQ1JZUFRfRkFJTEVEIjsKCiAgICBlcnIuY2F1c2UgPQogICAg
ICBjYXVzZTsKCiAgICB0aHJvdyBlcnI7CiAgfQp9Ci8vID09PSBQRU9QTEVfTUVTU0FHRV9FTkNSWVBUSU9OX1YxX0VORCA9PT0KCi8vID09PSBQRU9QTEVf
U0lNUExFX0FETUlOX0RFTEVURV9WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX1NJTVBMRV9BRE1JTl9UT0tFTiA9CiAgU3RyaW5nKAogICAgcHJvY2Vzcy5l
bnYuUEVPUExFX1NJTVBMRV9BRE1JTl9UT0tFTiB8fAogICAgIiIKICApLnRyaW0oKTsKCmNvbnN0IHBlb3BsZVNpbXBsZURlbGV0ZWRBY2NvdW50cyA9CiAg
bmV3IFNldCgpOwoKZnVuY3Rpb24gcGVvcGxlU2ltcGxlQWRtaW5BdXRob3JpemVkKAogIHJlcSwKICByZXMKKSB7CiAgaWYgKAogICAgIVBFT1BMRV9TSU1Q
TEVfQURNSU5fVE9LRU4KICApIHsKICAgIHJlcy5zdGF0dXMoNTAzKS5qc29uKHsKICAgICAgb2s6IGZhbHNlLAogICAgICBlcnJvcjoKICAgICAgICAiUEVP
UExFX1NJTVBMRV9BRE1JTl9UT0tFTiBuJ2VzdCBwYXMgY29uZmlndXLDqSBzdXIgUmVuZGVyLiIKICAgIH0pOwoKICAgIHJldHVybiBmYWxzZTsKICB9Cgog
IGNvbnN0IGF1dGhvcml6YXRpb24gPQogICAgU3RyaW5nKAogICAgICByZXEuaGVhZGVycy5hdXRob3JpemF0aW9uIHx8CiAgICAgICIiCiAgICApOwoKICBj
b25zdCBtYXRjaCA9CiAgICBhdXRob3JpemF0aW9uLm1hdGNoKAogICAgICAvXkJlYXJlclxzKyguKykkL2kKICAgICk7CgogIGNvbnN0IGNhbmRpZGF0ZSA9
CiAgICBtYXRjaAogICAgICA/IG1hdGNoWzFdLnRyaW0oKQogICAgICA6ICIiOwoKICBjb25zdCBsZWZ0ID0KICAgIEJ1ZmZlci5mcm9tKAogICAgICBjYW5k
aWRhdGUsCiAgICAgICJ1dGY4IgogICAgKTsKCiAgY29uc3QgcmlnaHQgPQogICAgQnVmZmVyLmZyb20oCiAgICAgIFBFT1BMRV9TSU1QTEVfQURNSU5fVE9L
RU4sCiAgICAgICJ1dGY4IgogICAgKTsKCiAgaWYgKAogICAgIWNhbmRpZGF0ZSB8fAogICAgbGVmdC5sZW5ndGggIT09CiAgICAgIHJpZ2h0Lmxlbmd0aAog
ICkgewogICAgcmVzLnN0YXR1cyg0MDMpLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOgogICAgICAgICJBY2PDqHMgYWRtaW4gcmVmdXPD
qS4iCiAgICB9KTsKCiAgICByZXR1cm4gZmFsc2U7CiAgfQoKICB0cnkgewogICAgaWYgKAogICAgICAhY3J5cHRvQWNjb3VudHMKICAgICAgICAudGltaW5n
U2FmZUVxdWFsKAogICAgICAgICAgbGVmdCwKICAgICAgICAgIHJpZ2h0CiAgICAgICAgKQogICAgKSB7CiAgICAgIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsK
ICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6CiAgICAgICAgICAiQWNjw6hzIGFkbWluIHJlZnVzw6kuIgogICAgICB9KTsKCiAgICAgIHJldHVy
biBmYWxzZTsKICAgIH0KICB9IGNhdGNoIHsKICAgIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsKICAgICAgb2s6IGZhbHNlLAogICAgICBlcnJvcjoKICAgICAg
ICAiQWNjw6hzIGFkbWluIHJlZnVzw6kuIgogICAgfSk7CgogICAgcmV0dXJuIGZhbHNlOwogIH0KCiAgcmV0dXJuIHRydWU7Cn0KLy8gPT09IFBFT1BMRV9T
SU1QTEVfQURNSU5fREVMRVRFX1YxX0VORCA9PT0KCmZ1bmN0aW9uIHBlb3BsZVJlYWRDb29raWVzKGhlYWRlcikgewogIGNvbnN0IG91dCA9IHt9OwoKICBm
b3IgKGNvbnN0IHBhcnQgb2YgU3RyaW5nKGhlYWRlciB8fCAiIikuc3BsaXQoIjsiKSkgewogICAgY29uc3QgaWR4ID0gcGFydC5pbmRleE9mKCI9Iik7CiAg
ICBpZiAoaWR4IDwgMCkgY29udGludWU7CgogICAgY29uc3Qga2V5ID0gcGFydC5zbGljZSgwLCBpZHgpLnRyaW0oKTsKICAgIGNvbnN0IHZhbHVlID0gcGFy
dC5zbGljZShpZHggKyAxKS50cmltKCk7CiAgICBpZiAoIWtleSkgY29udGludWU7CgogICAgdHJ5IHsKICAgICAgb3V0W2tleV0gPSBkZWNvZGVVUklDb21w
b25lbnQodmFsdWUpOwogICAgfSBjYXRjaCB7CiAgICAgIG91dFtrZXldID0gdmFsdWU7CiAgICB9CiAgfQoKICByZXR1cm4gb3V0Owp9CgpmdW5jdGlvbiBw
ZW9wbGVTZXNzaW9uRnJvbUNvb2tpZShoZWFkZXIpIHsKICB0cnkgewogICAgY29uc3QgY29va2llcyA9IHBlb3BsZVJlYWRDb29raWVzKGhlYWRlcik7CiAg
ICBjb25zdCB0b2tlbiA9IGNvb2tpZXNbUEVPUExFX0NPT0tJRV07CiAgICBpZiAoIXRva2VuKSByZXR1cm4gbnVsbDsKCiAgICBjb25zdCBwYXlsb2FkID0g
and0LnZlcmlmeSh0b2tlbiwgUEVPUExFX1NFU1NJT05fU0VDUkVUKTsKICAgIGlmICghcGF5bG9hZCB8fCAhcGF5bG9hZC5zdWIgfHwgIXBheWxvYWQudXNl
cm5hbWUpIHJldHVybiBudWxsOwoKICAgIHJldHVybiB7CiAgICAgIGlkOiBTdHJpbmcocGF5bG9hZC5zdWIpLAogICAgICB1c2VybmFtZTogcGVvcGxlVXNl
cm5hbWUocGF5bG9hZC51c2VybmFtZSkKICAgIH07CiAgfSBjYXRjaCB7CiAgICByZXR1cm4gbnVsbDsKICB9Cn0KCmZ1bmN0aW9uIHBlb3BsZVNldFNlc3Np
b24ocmVzLCB1c2VyKSB7CiAgY29uc3QgdG9rZW4gPSBqd3Quc2lnbigKICAgIHsKICAgICAgc3ViOiBTdHJpbmcodXNlci5pZCksCiAgICAgIHVzZXJuYW1l
OiB1c2VyLnVzZXJuYW1lCiAgICB9LAogICAgUEVPUExFX1NFU1NJT05fU0VDUkVULAogICAgeyBleHBpcmVzSW46ICIzMGQiIH0KICApOwoKICByZXMuY29v
a2llKFBFT1BMRV9DT09LSUUsIHRva2VuLCB7CiAgICBodHRwT25seTogdHJ1ZSwKICAgIHNhbWVTaXRlOiAibGF4IiwKICAgIHNlY3VyZTogUEVPUExFX1BS
T0RVQ1RJT04sCiAgICBtYXhBZ2U6IDMwICogMjQgKiA2MCAqIDYwICogMTAwMCwKICAgIHBhdGg6ICIvIgogIH0pOwp9CgpmdW5jdGlvbiBwZW9wbGVDbGVh
clNlc3Npb24ocmVzKSB7CiAgcmVzLmNsZWFyQ29va2llKFBFT1BMRV9DT09LSUUsIHsKICAgIGh0dHBPbmx5OiB0cnVlLAogICAgc2FtZVNpdGU6ICJsYXgi
LAogICAgc2VjdXJlOiBQRU9QTEVfUFJPRFVDVElPTiwKICAgIHBhdGg6ICIvIgogIH0pOwp9CgpmdW5jdGlvbiBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygp
IHsKICB0cnkgewogICAgaWYgKCFmc0FjY291bnRzLmV4aXN0c1N5bmMoUEVPUExFX0xPQ0FMX0FDQ09VTlRTKSkgcmV0dXJuIFtdOwoKICAgIGNvbnN0IGRh
dGEgPSBKU09OLnBhcnNlKAogICAgICBmc0FjY291bnRzLnJlYWRGaWxlU3luYyhQRU9QTEVfTE9DQUxfQUNDT1VOVFMsICJ1dGY4IikKICAgICk7CgogICAg
cmV0dXJuIEFycmF5LmlzQXJyYXkoZGF0YSkgPyBkYXRhIDogW107CiAgfSBjYXRjaCB7CiAgICByZXR1cm4gW107CiAgfQp9CgpmdW5jdGlvbiBwZW9wbGVX
cml0ZUxvY2FsQWNjb3VudHMoYWNjb3VudHMpIHsKICBmc0FjY291bnRzLndyaXRlRmlsZVN5bmMoCiAgICBQRU9QTEVfTE9DQUxfQUNDT1VOVFMsCiAgICBK
U09OLnN0cmluZ2lmeShhY2NvdW50cywgbnVsbCwgMikgKyAiXG4iLAogICAgInV0ZjgiCiAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlSW5pdEFjY291
bnRzKCkgewogIGlmICghUEVPUExFX0RCX1VSTCkgewogICAgaWYgKFBFT1BMRV9QUk9EVUNUSU9OKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAg
ICAiUGVvcGxlIEFjY291bnRzIDogREFUQUJBU0VfVVJMIGFic2VudC4gIiArCiAgICAgICAgIkFqb3V0ZSBEQVRBQkFTRV9VUkwgZGFucyBSZW5kZXIgPiBF
bnZpcm9ubWVudC4iCiAgICAgICk7CiAgICB9CgogICAgY29uc29sZS5sb2coIltQZW9wbGVdIENvbXB0ZXMgbG9jYXV4IDogcGVvcGxlLWFjY291bnRzLmxv
Y2FsLmpzb24iKTsKICAgIHJldHVybjsKICB9CgogIHBlb3BsZVBvb2wgPSBuZXcgUG9vbCh7CiAgICBjb25uZWN0aW9uU3RyaW5nOiBQRU9QTEVfREJfVVJM
LAogICAgc3NsOiAvbG9jYWxob3N0fDEyN1wuMFwuMFwuMS9pLnRlc3QoUEVPUExFX0RCX1VSTCkKICAgICAgPyBmYWxzZQogICAgICA6IHsgcmVqZWN0VW5h
dXRob3JpemVkOiBmYWxzZSB9CiAgfSk7CgogIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAiQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgcGVvcGxl
X2FjY291bnRzICgiICsKICAgICJpZCBCSUdTRVJJQUwgUFJJTUFSWSBLRVksICIgKwogICAgInVzZXJuYW1lIFZBUkNIQVIoMjQpIE5PVCBOVUxMLCAiICsK
ICAgICJ1c2VybmFtZV9rZXkgVkFSQ0hBUig2NCkgTk9UIE5VTEwgVU5JUVVFLCAiICsKICAgICJwYXNzd29yZF9oYXNoIFRFWFQgTk9UIE5VTEwsICIgKwog
ICAgImNyZWF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSIgKwogICAgIikiCiAgKTsKCiAgY29uc29sZS5sb2coIltQZW9wbGVd
IEJhc2UgY29tcHRlcyBQb3N0Z3JlU1FMIGNvbm5lY3RlZS4iKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRmluZEFjY291bnQodXNlcm5hbWUpIHsKICBj
b25zdCBrZXkgPSBwZW9wbGVVc2VybmFtZUtleSh1c2VybmFtZSk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9w
bGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNUIGlkLCB1c2VybmFtZSwgdXNlcm5hbWVfa2V5LCBwYXNzd29yZF9oYXNoLCBkZXNjcmlwdGlvbiwgY3JlYXRl
ZF9hdCAiICsKICAgICAgIkZST00gcGVvcGxlX2FjY291bnRzIFdIRVJFIHVzZXJuYW1lX2tleSA9ICQxIExJTUlUIDEiLAogICAgICBba2V5XQogICAgKTsK
CiAgICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gfHwgbnVsbDsKICB9CgogIHJldHVybiAoCiAgICBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygpLmZpbmQoCiAg
ICAgIChhY2NvdW50KSA9PiBhY2NvdW50LnVzZXJuYW1lX2tleSA9PT0ga2V5CiAgICApIHx8IG51bGwKICApOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVD
cmVhdGVBY2NvdW50KHVzZXJuYW1lLCBwYXNzd29yZEhhc2gpIHsKICBjb25zdCBuYW1lID0gcGVvcGxlVXNlcm5hbWUodXNlcm5hbWUpOwogIGNvbnN0IGtl
eSA9IHBlb3BsZVVzZXJuYW1lS2V5KG5hbWUpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVy
eSgKICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9hY2NvdW50cyAiICsKICAgICAgIih1c2VybmFtZSwgdXNlcm5hbWVfa2V5LCBwYXNzd29yZF9oYXNoKSAi
ICsKICAgICAgIlZBTFVFUyAoJDEsICQyLCAkMykgIiArCiAgICAgICJSRVRVUk5JTkcgaWQsIHVzZXJuYW1lLCBjcmVhdGVkX2F0IiwKICAgICAgW25hbWUs
IGtleSwgcGFzc3dvcmRIYXNoXQogICAgKTsKCiAgICByZXR1cm4gcmVzdWx0LnJvd3NbMF07CiAgfQoKICBjb25zdCBhY2NvdW50cyA9IHBlb3BsZVJlYWRM
b2NhbEFjY291bnRzKCk7CgogIGlmIChhY2NvdW50cy5zb21lKChhY2NvdW50KSA9PiBhY2NvdW50LnVzZXJuYW1lX2tleSA9PT0ga2V5KSkgewogICAgY29u
c3QgZXJyID0gbmV3IEVycm9yKCJVU0VSTkFNRV9FWElTVFMiKTsKICAgIGVyci5jb2RlID0gIlVTRVJOQU1FX0VYSVNUUyI7CiAgICB0aHJvdyBlcnI7CiAg
fQoKICBjb25zdCBhY2NvdW50ID0gewogICAgaWQ6IGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKSwKICAgIHVzZXJuYW1lOiBuYW1lLAogICAgdXNlcm5h
bWVfa2V5OiBrZXksCiAgICBwYXNzd29yZF9oYXNoOiBwYXNzd29yZEhhc2gsCiAgICBjcmVhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAg
ICBhcHBlYXJhbmNlX3RoZW1lOiAiZGFyayIsCiAgICBhcHBlYXJhbmNlX2FjY2VudDogIiM2NzU4OUQiCiAgfTsKCiAgYWNjb3VudHMucHVzaChhY2NvdW50
KTsKICBwZW9wbGVXcml0ZUxvY2FsQWNjb3VudHMoYWNjb3VudHMpOwogIHJldHVybiBhY2NvdW50Owp9Cgpjb25zdCBwZW9wbGVMb2dpbkZhaWx1cmVzID0g
bmV3IE1hcCgpOwoKZnVuY3Rpb24gcGVvcGxlTG9naW5BbGxvd2VkKHVzZXJuYW1lKSB7CiAgY29uc3Qga2V5ID0gcGVvcGxlVXNlcm5hbWVLZXkodXNlcm5h
bWUpOwogIGNvbnN0IGVudHJ5ID0gcGVvcGxlTG9naW5GYWlsdXJlcy5nZXQoa2V5KTsKCiAgaWYgKCFlbnRyeSkgcmV0dXJuIHRydWU7CgogIGlmIChEYXRl
Lm5vdygpID4gZW50cnkudW50aWwpIHsKICAgIHBlb3BsZUxvZ2luRmFpbHVyZXMuZGVsZXRlKGtleSk7CiAgICByZXR1cm4gdHJ1ZTsKICB9CgogIHJldHVy
biBlbnRyeS5jb3VudCA8IDg7Cn0KCmZ1bmN0aW9uIHBlb3BsZVJlY29yZExvZ2luRmFpbHVyZSh1c2VybmFtZSkgewogIGNvbnN0IGtleSA9IHBlb3BsZVVz
ZXJuYW1lS2V5KHVzZXJuYW1lKTsKICBjb25zdCBub3cgPSBEYXRlLm5vdygpOwogIGNvbnN0IGN1cnJlbnQgPSBwZW9wbGVMb2dpbkZhaWx1cmVzLmdldChr
ZXkpOwoKICBpZiAoIWN1cnJlbnQgfHwgbm93ID4gY3VycmVudC51bnRpbCkgewogICAgcGVvcGxlTG9naW5GYWlsdXJlcy5zZXQoa2V5LCB7CiAgICAgIGNv
dW50OiAxLAogICAgICB1bnRpbDogbm93ICsgMTAgKiA2MCAqIDEwMDAKICAgIH0pOwogICAgcmV0dXJuOwogIH0KCiAgY3VycmVudC5jb3VudCArPSAxOwog
IGN1cnJlbnQudW50aWwgPSBub3cgKyAxMCAqIDYwICogMTAwMDsKfQoKZnVuY3Rpb24gcGVvcGxlQ2xlYXJMb2dpbkZhaWx1cmVzKHVzZXJuYW1lKSB7CiAg
cGVvcGxlTG9naW5GYWlsdXJlcy5kZWxldGUocGVvcGxlVXNlcm5hbWVLZXkodXNlcm5hbWUpKTsKfQoKYXBwLnBvc3QoIi9hcGkvYXV0aC9yZWdpc3RlciIs
IGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCB1c2VybmFtZSA9IHBlb3BsZVVzZXJuYW1lKHJlcS5ib2R5Py51c2VybmFtZSk7CiAg
ICBjb25zdCBwYXNzd29yZCA9IHJlcS5ib2R5Py5wYXNzd29yZDsKCiAgICBpZiAoIXBlb3BsZVZhbGlkVXNlcm5hbWUodXNlcm5hbWUpKSB7CiAgICAgIHJl
dHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIlBzZXVkbyA6IDMgYSAyNCBj
YXJhY3RlcmVzLCBsZXR0cmVzL2NoaWZmcmVzL18vLi8tIHVuaXF1ZW1lbnQuIgogICAgICB9KTsKICAgIH0KCiAgICBpZiAoIXBlb3BsZVZhbGlkUGFzc3dv
cmQocGFzc3dvcmQpKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAg
ICAgICAgIkxlIG1vdCBkZSBwYXNzZSBkb2l0IGNvbnRlbmlyIGVudHJlIDggZXQgMTI4IGNhcmFjdGVyZXMuIgogICAgICB9KTsKICAgIH0KCiAgICBjb25z
dCBleGlzdGluZyA9IGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50KHVzZXJuYW1lKTsKCiAgICBpZiAoZXhpc3RpbmcpIHsKICAgICAgcmV0dXJuIHJlcy5zdGF0
dXMoNDA5KS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6ICJDZSBwc2V1ZG8gZXN0IGRlamEgcHJpcy4iCiAgICAgIH0pOwogICAg
fQoKICAgIGNvbnN0IHBhc3N3b3JkSGFzaCA9IGF3YWl0IGJjcnlwdC5oYXNoKHBhc3N3b3JkLCAxMCk7CgogICAgbGV0IGFjY291bnQ7CgogICAgdHJ5IHsK
ICAgICAgYWNjb3VudCA9IGF3YWl0IHBlb3BsZUNyZWF0ZUFjY291bnQodXNlcm5hbWUsIHBhc3N3b3JkSGFzaCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAg
ICAgaWYgKAogICAgICAgIGVycj8uY29kZSA9PT0gIjIzNTA1IiB8fAogICAgICAgIGVycj8uY29kZSA9PT0gIlVTRVJOQU1FX0VYSVNUUyIKICAgICAgKSB7
CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA5KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOiAiQ2UgcHNldWRvIGVz
dCBkZWphIHByaXMuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICB0aHJvdyBlcnI7CiAgICB9CgogICAgcGVvcGxlU2V0U2Vzc2lvbihyZXMsIGFjY291
bnQpOwoKICAgIHJldHVybiByZXMuanNvbih7CiAgICAgIG9rOiB0cnVlLAogICAgICB1c2VyOiB7CiAgICAgICAgaWQ6IFN0cmluZyhhY2NvdW50LmlkKSwK
ICAgICAgICB1c2VybmFtZTogYWNjb3VudC51c2VybmFtZQogICAgICB9CiAgICB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQ
ZW9wbGUgYXV0aC9yZWdpc3Rlcl0iLCBlcnIpOwoKICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgIG9rOiBmYWxzZSwKICAgICAgZXJy
b3I6ICJJbXBvc3NpYmxlIGRlIGNyZWVyIGxlIGNvbXB0ZS4iCiAgICB9KTsKICB9Cn0pOwoKYXBwLnBvc3QoIi9hcGkvYXV0aC9sb2dpbiIsIGFzeW5jIChy
ZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCB1c2VybmFtZSA9IHBlb3BsZVVzZXJuYW1lKHJlcS5ib2R5Py51c2VybmFtZSk7CiAgICBjb25zdCBw
YXNzd29yZCA9IHJlcS5ib2R5Py5wYXNzd29yZDsKCiAgICBpZiAoIXBlb3BsZUxvZ2luQWxsb3dlZCh1c2VybmFtZSkpIHsKICAgICAgcmV0dXJuIHJlcy5z
dGF0dXMoNDI5KS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6CiAgICAgICAgICAiVHJvcCBkJ2Vzc2FpcyBwb3VyIGNlIHBzZXVk
by4gUmVlc3NhaWUgZGFucyBxdWVscXVlcyBtaW51dGVzLiIKICAgICAgfSk7CiAgICB9CgogICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IHBlb3BsZUZpbmRB
Y2NvdW50KHVzZXJuYW1lKTsKCiAgICBpZiAoIWFjY291bnQgfHwgdHlwZW9mIHBhc3N3b3JkICE9PSAic3RyaW5nIikgewogICAgICBwZW9wbGVSZWNvcmRM
b2dpbkZhaWx1cmUodXNlcm5hbWUpOwoKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJy
b3I6ICJQc2V1ZG8gb3UgbW90IGRlIHBhc3NlIGluY29ycmVjdC4iCiAgICAgIH0pOwogICAgfQoKICAgIGNvbnN0IHZhbGlkID0gYXdhaXQgYmNyeXB0LmNv
bXBhcmUoCiAgICAgIHBhc3N3b3JkLAogICAgICBhY2NvdW50LnBhc3N3b3JkX2hhc2gKICAgICk7CgogICAgaWYgKCF2YWxpZCkgewogICAgICBwZW9wbGVS
ZWNvcmRMb2dpbkZhaWx1cmUodXNlcm5hbWUpOwoKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAxKS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAg
ICAgZXJyb3I6ICJQc2V1ZG8gb3UgbW90IGRlIHBhc3NlIGluY29ycmVjdC4iCiAgICAgIH0pOwogICAgfQoKICAgIHBlb3BsZUNsZWFyTG9naW5GYWlsdXJl
cyh1c2VybmFtZSk7CiAgICBwZW9wbGVTZXRTZXNzaW9uKHJlcywgYWNjb3VudCk7CgogICAgcmV0dXJuIHJlcy5qc29uKHsKICAgICAgb2s6IHRydWUsCiAg
ICAgIHVzZXI6IHsKICAgICAgICBpZDogU3RyaW5nKGFjY291bnQuaWQpLAogICAgICAgIHVzZXJuYW1lOiBhY2NvdW50LnVzZXJuYW1lCiAgICAgIH0KICAg
IH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBhdXRoL2xvZ2luXSIsIGVycik7CgogICAgcmV0dXJuIHJlcy5zdGF0
dXMoNTAwKS5qc29uKHsKICAgICAgb2s6IGZhbHNlLAogICAgICBlcnJvcjogIkNvbm5leGlvbiBpbXBvc3NpYmxlLiIKICAgIH0pOwogIH0KfSk7CgphcHAu
Z2V0KCIvYXBpL2F1dGgvbWUiLCAocmVxLCByZXMpID0+IHsKICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZyb21Db29raWUoCiAgICByZXEuaGVh
ZGVycy5jb29raWUgfHwgIiIKICApOwoKICBpZiAoIXNlc3Npb24pIHsKICAgIHJldHVybiByZXMuc3RhdHVzKDQwMSkuanNvbih7CiAgICAgIG9rOiBmYWxz
ZSwKICAgICAgdXNlcjogbnVsbAogICAgfSk7CiAgfQoKICByZXR1cm4gcmVzLmpzb24oewogICAgb2s6IHRydWUsCiAgICB1c2VyOiBzZXNzaW9uCiAgfSk7
Cn0pOwoKLy8gPT09IFBFT1BMRV9TSU1QTEVfQURNSU5fREVMRVRFX1JPVVRFX1YxID09PQphcHAucG9zdCgKICAiL2FwaS9zaW1wbGUtYWRtaW4vZGVsZXRl
LWFjY291bnQiLAogIGFzeW5jICgKICAgIHJlcSwKICAgIHJlcwogICkgPT4gewogICAgdHJ5IHsKICAgICAgaWYgKAogICAgICAgICFwZW9wbGVTaW1wbGVB
ZG1pbkF1dGhvcml6ZWQoCiAgICAgICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAgICAgfQoK
ICAgICAgY29uc3QgdXNlcm5hbWUgPQogICAgICAgIHBlb3BsZVVzZXJuYW1lKAogICAgICAgICAgcmVxLmJvZHk/LnVzZXJuYW1lCiAgICAgICAgKTsKCiAg
ICAgIGlmICghdXNlcm5hbWUpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAg
ZXJyb3I6CiAgICAgICAgICAgICJQc2V1ZG8gaW52YWxpZGUuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICBjb25zdCBkZWxldGVkID0KICAgICAgICBh
d2FpdCBwZW9wbGVTaW1wbGVBZG1pbkRlbGV0ZUFjY291bnQoCiAgICAgICAgICB1c2VybmFtZQogICAgICAgICk7CgogICAgICBpZiAoIWRlbGV0ZWQpIHsK
ICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICJD
b21wdGUgaW50cm91dmFibGUuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICByZXR1cm4gcmVzLmpzb24oewogICAgICAgIG9rOiB0cnVlLAogICAgICAg
IGRlbGV0ZWQKICAgICAgfSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigKICAgICAgICAiW1Blb3BsZSBzaW1wbGUgYWRtaW4g
ZGVsZXRlXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAg
ICAgICBlcnJvcjoKICAgICAgICAgICJJbXBvc3NpYmxlIGRlIHN1cHByaW1lciBjZSBjb21wdGUuIgogICAgICB9KTsKICAgIH0KICB9Cik7Ci8vID09PSBQ
RU9QTEVfU0lNUExFX0FETUlOX0RFTEVURV9ST1VURV9WMSA9PT0KCmFwcC5wb3N0KCIvYXBpL2F1dGgvbG9nb3V0IiwgKHJlcSwgcmVzKSA9PiB7CiAgcGVv
cGxlQ2xlYXJTZXNzaW9uKHJlcyk7CiAgcmVzLmpzb24oeyBvazogdHJ1ZSB9KTsKfSk7Ci8vID09PSBQRU9QTEVfQUNDT1VOVFNfVjFfRU5EID09PQoKLy8g
PT09IFBFT1BMRV9TT0NJQUxfVjJfU1RBUlQgPT09CmNvbnN0IFBFT1BMRV9MT0NBTF9TT0NJQUwgPSBwYXRoQWNjb3VudHMuam9pbigKICBfX2Rpcm5hbWUs
CiAgInBlb3BsZS1zb2NpYWwubG9jYWwuanNvbiIKKTsKCi8vID09PSBQRU9QTEVfRE1fRTJFRV9TRVJWRVJfVjFfU1RBUlQgPT09CmNvbnN0IFBFT1BMRV9M
T0NBTF9FMkVFID0KICBwYXRoQWNjb3VudHMuam9pbigKICAgIF9fZGlybmFtZSwKICAgICJwZW9wbGUtZTJlZS5sb2NhbC5qc29uIgogICk7CgpmdW5jdGlv
biBwZW9wbGVFMmVlRGV2aWNlSWQodmFsdWUpIHsKICBjb25zdCBjbGVhbiA9CiAgICBTdHJpbmcodmFsdWUgfHwgIiIpLnRyaW0oKTsKCiAgcmV0dXJuIC9e
W2EtekEtWjAtOV8tXXsxNiw4MH0kLy50ZXN0KGNsZWFuKQogICAgPyBjbGVhbgogICAgOiAiIjsKfQoKZnVuY3Rpb24gcGVvcGxlRTJlZVB1YmxpY0p3ayh2
YWx1ZSkgewogIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAib2JqZWN0IikgewogICAgcmV0dXJuIG51bGw7CiAgfQoKICBjb25zdCB4ID0gU3Ry
aW5nKHZhbHVlLnggfHwgIiIpOwogIGNvbnN0IHkgPSBTdHJpbmcodmFsdWUueSB8fCAiIik7CgogIGlmICgKICAgIHZhbHVlLmt0eSAhPT0gIkVDIiB8fAog
ICAgdmFsdWUuY3J2ICE9PSAiUC0yNTYiIHx8CiAgICAhL15bYS16QS1aMC05Xy1dezQwLDkwfSQvLnRlc3QoeCkgfHwKICAgICEvXlthLXpBLVowLTlfLV17
NDAsOTB9JC8udGVzdCh5KQogICkgewogICAgcmV0dXJuIG51bGw7CiAgfQoKICByZXR1cm4gewogICAga3R5OiAiRUMiLAogICAgY3J2OiAiUC0yNTYiLAog
ICAgeCwKICAgIHksCiAgICBleHQ6IHRydWUKICB9Owp9CgpmdW5jdGlvbiBwZW9wbGVSZWFkTG9jYWxFMmVlKCkgewogIHRyeSB7CiAgICBpZiAoIWZzQWNj
b3VudHMuZXhpc3RzU3luYyhQRU9QTEVfTE9DQUxfRTJFRSkpIHsKICAgICAgcmV0dXJuIFtdOwogICAgfQoKICAgIGNvbnN0IHJhdyA9CiAgICAgIEpTT04u
cGFyc2UoCiAgICAgICAgZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoCiAgICAgICAgICBQRU9QTEVfTE9DQUxfRTJFRSwKICAgICAgICAgICJ1dGY4IgogICAg
ICAgICkKICAgICAgKTsKCiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyYXcpCiAgICAgID8gcmF3CiAgICAgIDogW107CiAgfSBjYXRjaCB7CiAgICByZXR1
cm4gW107CiAgfQp9CgpmdW5jdGlvbiBwZW9wbGVXcml0ZUxvY2FsRTJlZShyb3dzKSB7CiAgZnNBY2NvdW50cy53cml0ZUZpbGVTeW5jKAogICAgUEVPUExF
X0xPQ0FMX0UyRUUsCiAgICBKU09OLnN0cmluZ2lmeSgKICAgICAgQXJyYXkuaXNBcnJheShyb3dzKQogICAgICAgID8gcm93cwogICAgICAgIDogW10sCiAg
ICAgIG51bGwsCiAgICAgIDIKICAgICkgKyAiXG4iLAogICAgInV0ZjgiCiAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRTJlZVJlZ2lzdGVyRGV2aWNl
KAogIGFjY291bnRJZCwKICBkZXZpY2VJZCwKICBwdWJsaWNKd2sKKSB7CiAgY29uc3QgdXNlcklkID0KICAgIFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwoK
ICBjb25zdCBkZXZpY2UgPQogICAgcGVvcGxlRTJlZURldmljZUlkKGRldmljZUlkKTsKCiAgY29uc3Qga2V5ID0KICAgIHBlb3BsZUUyZWVQdWJsaWNKd2so
cHVibGljSndrKTsKCiAgaWYgKCF1c2VySWQgfHwgIWRldmljZSB8fCAha2V5KSB7CiAgICBjb25zdCBlcnIgPQogICAgICBuZXcgRXJyb3IoIkUyRUVfREVW
SUNFX0lOVkFMSUQiKTsKCiAgICBlcnIuY29kZSA9CiAgICAgICJFMkVFX0RFVklDRV9JTlZBTElEIjsKCiAgICB0aHJvdyBlcnI7CiAgfQoKICBjb25zdCBz
ZXJpYWxpemVkID0KICAgIEpTT04uc3RyaW5naWZ5KGtleSk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAg
ICAiSU5TRVJUIElOVE8gcGVvcGxlX2UyZWVfZGV2aWNlcyAiICsKICAgICAgIih1c2VyX2lkLCBkZXZpY2VfaWQsIHB1YmxpY19qd2ssIGxhc3Rfc2Vlbl9h
dCkgIiArCiAgICAgICJWQUxVRVMgKCQxLCAkMiwgJDMsIE5PVygpKSAiICsKICAgICAgIk9OIENPTkZMSUNUICh1c2VyX2lkLCBkZXZpY2VfaWQpICIgKwog
ICAgICAiRE8gVVBEQVRFIFNFVCBwdWJsaWNfandrID0gRVhDTFVERUQucHVibGljX2p3aywgbGFzdF9zZWVuX2F0ID0gTk9XKCkiLAogICAgICBbCiAgICAg
ICAgdXNlcklkLAogICAgICAgIGRldmljZSwKICAgICAgICBzZXJpYWxpemVkCiAgICAgIF0KICAgICk7CgogICAgcmV0dXJuOwogIH0KCiAgY29uc3Qgcm93
cyA9CiAgICBwZW9wbGVSZWFkTG9jYWxFMmVlKCk7CgogIGNvbnN0IG5leHQgPSB7CiAgICB1c2VyX2lkOiB1c2VySWQsCiAgICBkZXZpY2VfaWQ6IGRldmlj
ZSwKICAgIHB1YmxpY19qd2s6IHNlcmlhbGl6ZWQsCiAgICBsYXN0X3NlZW5fYXQ6CiAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogIH07CgogIGNv
bnN0IGluZGV4ID0KICAgIHJvd3MuZmluZEluZGV4KAogICAgICAocm93KSA9PgogICAgICAgIFN0cmluZyhyb3cudXNlcl9pZCkgPT09IHVzZXJJZCAmJgog
ICAgICAgIFN0cmluZyhyb3cuZGV2aWNlX2lkKSA9PT0gZGV2aWNlCiAgICApOwoKICBpZiAoaW5kZXggPj0gMCkgewogICAgcm93c1tpbmRleF0gPSBuZXh0
OwogIH0gZWxzZSB7CiAgICByb3dzLnB1c2gobmV4dCk7CiAgfQoKICBwZW9wbGVXcml0ZUxvY2FsRTJlZShyb3dzKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVv
cGxlRTJlZURldmljZXMoYWNjb3VudElkKSB7CiAgY29uc3QgdXNlcklkID0KICAgIFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwoKICBpZiAoIXVzZXJJZCkg
ewogICAgcmV0dXJuIFtdOwogIH0KCiAgbGV0IHJvd3M7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPQogICAgICBhd2FpdCBwZW9w
bGVQb29sLnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgZGV2aWNlX2lkLCBwdWJsaWNfandrLCBsYXN0X3NlZW5fYXQgIiArCiAgICAgICAgIkZST00gcGVvcGxl
X2UyZWVfZGV2aWNlcyAiICsKICAgICAgICAiV0hFUkUgdXNlcl9pZCA9ICQxICIgKwogICAgICAgICJPUkRFUiBCWSBsYXN0X3NlZW5fYXQgREVTQyAiICsK
ICAgICAgICAiTElNSVQgOCIsCiAgICAgICAgW3VzZXJJZF0KICAgICAgKTsKCiAgICByb3dzID0KICAgICAgcmVzdWx0LnJvd3M7CiAgfSBlbHNlIHsKICAg
IHJvd3MgPQogICAgICBwZW9wbGVSZWFkTG9jYWxFMmVlKCkKICAgICAgICAuZmlsdGVyKAogICAgICAgICAgKHJvdykgPT4KICAgICAgICAgICAgU3RyaW5n
KHJvdy51c2VyX2lkKSA9PT0gdXNlcklkCiAgICAgICAgKQogICAgICAgIC5zb3J0KAogICAgICAgICAgKGEsIGIpID0+CiAgICAgICAgICAgIG5ldyBEYXRl
KAogICAgICAgICAgICAgIGIubGFzdF9zZWVuX2F0IHx8IDAKICAgICAgICAgICAgKS5nZXRUaW1lKCkgLQogICAgICAgICAgICBuZXcgRGF0ZSgKICAgICAg
ICAgICAgICBhLmxhc3Rfc2Vlbl9hdCB8fCAwCiAgICAgICAgICAgICkuZ2V0VGltZSgpCiAgICAgICAgKQogICAgICAgIC5zbGljZSgwLCA4KTsKICB9Cgog
IHJldHVybiByb3dzCiAgICAubWFwKAogICAgICAocm93KSA9PiB7CiAgICAgICAgdHJ5IHsKICAgICAgICAgIGNvbnN0IHB1YmxpY0p3ayA9CiAgICAgICAg
ICAgIHBlb3BsZUUyZWVQdWJsaWNKd2soCiAgICAgICAgICAgICAgdHlwZW9mIHJvdy5wdWJsaWNfandrID09PSAic3RyaW5nIgogICAgICAgICAgICAgICAg
PyBKU09OLnBhcnNlKHJvdy5wdWJsaWNfandrKQogICAgICAgICAgICAgICAgOiByb3cucHVibGljX2p3awogICAgICAgICAgICApOwoKICAgICAgICAgIGNv
bnN0IGRldmljZUlkID0KICAgICAgICAgICAgcGVvcGxlRTJlZURldmljZUlkKHJvdy5kZXZpY2VfaWQpOwoKICAgICAgICAgIGlmICghcHVibGljSndrIHx8
ICFkZXZpY2VJZCkgewogICAgICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgICAgIH0KCiAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICB1c2VySWQs
CiAgICAgICAgICAgIGRldmljZUlkLAogICAgICAgICAgICBwdWJsaWNKd2sKICAgICAgICAgIH07CiAgICAgICAgfSBjYXRjaCB7CiAgICAgICAgICByZXR1
cm4gbnVsbDsKICAgICAgICB9CiAgICAgIH0KICAgICkKICAgIC5maWx0ZXIoQm9vbGVhbik7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtRTJlZUVudmVsb3BlKHZh
bHVlKSB7CiAgY29uc3QgYm9keSA9CiAgICBTdHJpbmcodmFsdWUgfHwgIiIpLnRyaW0oKTsKCiAgaWYgKCFwZW9wbGVEbUUyZWVJc0VudmVsb3BlKGJvZHkp
KSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGlmIChib2R5Lmxlbmd0aCA+IDI0MDAwKSB7CiAgICBjb25zdCBlcnIgPQogICAgICBuZXcgRXJyb3IoIkUy
RUVfRU5WRUxPUEVfSU5WQUxJRCIpOwoKICAgIGVyci5jb2RlID0KICAgICAgIkUyRUVfRU5WRUxPUEVfSU5WQUxJRCI7CgogICAgdGhyb3cgZXJyOwogIH0K
CiAgY29uc3QgZW5jb2RlZCA9CiAgICBib2R5LnNsaWNlKAogICAgICBQRU9QTEVfRE1fRTJFRV9QUkVGSVgubGVuZ3RoCiAgICApOwoKICBpZiAoCiAgICAh
ZW5jb2RlZCB8fAogICAgIS9eW2EtekEtWjAtOV8tXSskLy50ZXN0KGVuY29kZWQpCiAgKSB7CiAgICBjb25zdCBlcnIgPQogICAgICBuZXcgRXJyb3IoIkUy
RUVfRU5WRUxPUEVfSU5WQUxJRCIpOwoKICAgIGVyci5jb2RlID0KICAgICAgIkUyRUVfRU5WRUxPUEVfSU5WQUxJRCI7CgogICAgdGhyb3cgZXJyOwogIH0K
CiAgbGV0IGVudmVsb3BlOwoKICB0cnkgewogICAgZW52ZWxvcGUgPQogICAgICBKU09OLnBhcnNlKAogICAgICAgIEJ1ZmZlci5mcm9tKAogICAgICAgICAg
ZW5jb2RlZCwKICAgICAgICAgICJiYXNlNjR1cmwiCiAgICAgICAgKS50b1N0cmluZygidXRmOCIpCiAgICAgICk7CiAgfSBjYXRjaCB7CiAgICBjb25zdCBl
cnIgPQogICAgICBuZXcgRXJyb3IoIkUyRUVfRU5WRUxPUEVfSU5WQUxJRCIpOwoKICAgIGVyci5jb2RlID0KICAgICAgIkUyRUVfRU5WRUxPUEVfSU5WQUxJ
RCI7CgogICAgdGhyb3cgZXJyOwogIH0KCiAgY29uc3QgZnJvbSA9CiAgICBTdHJpbmcoZW52ZWxvcGU/LmZyb20gfHwgIiIpOwoKICBjb25zdCB0byA9CiAg
ICBTdHJpbmcoZW52ZWxvcGU/LnRvIHx8ICIiKTsKCiAgY29uc3Qgc2VuZGVyRGV2aWNlID0KICAgIHBlb3BsZUUyZWVEZXZpY2VJZChlbnZlbG9wZT8uc2Qp
OwoKICBjb25zdCBzZW5kZXJQdWJsaWMgPQogICAgcGVvcGxlRTJlZVB1YmxpY0p3ayhlbnZlbG9wZT8uc3BrKTsKCiAgY29uc3QgbWVzc2FnZUl2ID0KICAg
IFN0cmluZyhlbnZlbG9wZT8uaXYgfHwgIiIpOwoKICBjb25zdCBjaXBoZXJ0ZXh0ID0KICAgIFN0cmluZyhlbnZlbG9wZT8uY3QgfHwgIiIpOwoKICBjb25z
dCBrZXlzID0KICAgIEFycmF5LmlzQXJyYXkoZW52ZWxvcGU/LmtleXMpCiAgICAgID8gZW52ZWxvcGUua2V5cwogICAgICA6IFtdOwoKICBpZiAoCiAgICBl
bnZlbG9wZT8udiAhPT0gMSB8fAogICAgIWZyb20gfHwKICAgICF0byB8fAogICAgZnJvbS5sZW5ndGggPiAxMDAgfHwKICAgIHRvLmxlbmd0aCA+IDEwMCB8
fAogICAgIXNlbmRlckRldmljZSB8fAogICAgIXNlbmRlclB1YmxpYyB8fAogICAgIS9eW2EtekEtWjAtOV8tXXsxNiw0MH0kLy50ZXN0KG1lc3NhZ2VJdikg
fHwKICAgICEvXlthLXpBLVowLTlfLV17MTYsMTYwMDB9JC8udGVzdChjaXBoZXJ0ZXh0KSB8fAogICAga2V5cy5sZW5ndGggPCAxIHx8CiAgICBrZXlzLmxl
bmd0aCA+IDE2CiAgKSB7CiAgICBjb25zdCBlcnIgPQogICAgICBuZXcgRXJyb3IoIkUyRUVfRU5WRUxPUEVfSU5WQUxJRCIpOwoKICAgIGVyci5jb2RlID0K
ICAgICAgIkUyRUVfRU5WRUxPUEVfSU5WQUxJRCI7CgogICAgdGhyb3cgZXJyOwogIH0KCiAgY29uc3Qgbm9ybWFsaXplZEtleXMgPQogICAga2V5cy5tYXAo
CiAgICAgIChpdGVtKSA9PiB7CiAgICAgICAgY29uc3QgdXNlcklkID0KICAgICAgICAgIFN0cmluZyhpdGVtPy51IHx8ICIiKTsKCiAgICAgICAgY29uc3Qg
ZGV2aWNlSWQgPQogICAgICAgICAgcGVvcGxlRTJlZURldmljZUlkKGl0ZW0/LmQpOwoKICAgICAgICBjb25zdCBpdiA9CiAgICAgICAgICBTdHJpbmcoaXRl
bT8uaXYgfHwgIiIpOwoKICAgICAgICBjb25zdCB3cmFwcGVkID0KICAgICAgICAgIFN0cmluZyhpdGVtPy5jdCB8fCAiIik7CgogICAgICAgIGlmICgKICAg
ICAgICAgICF1c2VySWQgfHwKICAgICAgICAgIHVzZXJJZC5sZW5ndGggPiAxMDAgfHwKICAgICAgICAgICFkZXZpY2VJZCB8fAogICAgICAgICAgIS9eW2Et
ekEtWjAtOV8tXXsxNiw0MH0kLy50ZXN0KGl2KSB8fAogICAgICAgICAgIS9eW2EtekEtWjAtOV8tXXszMiwxNjB9JC8udGVzdCh3cmFwcGVkKQogICAgICAg
ICkgewogICAgICAgICAgY29uc3QgZXJyID0KICAgICAgICAgICAgbmV3IEVycm9yKCJFMkVFX0VOVkVMT1BFX0lOVkFMSUQiKTsKCiAgICAgICAgICBlcnIu
Y29kZSA9CiAgICAgICAgICAgICJFMkVFX0VOVkVMT1BFX0lOVkFMSUQiOwoKICAgICAgICAgIHRocm93IGVycjsKICAgICAgICB9CgogICAgICAgIHJldHVy
biB7CiAgICAgICAgICB1OiB1c2VySWQsCiAgICAgICAgICBkOiBkZXZpY2VJZCwKICAgICAgICAgIGl2LAogICAgICAgICAgY3Q6IHdyYXBwZWQKICAgICAg
ICB9OwogICAgICB9CiAgICApOwoKICByZXR1cm4gewogICAgdjogMSwKICAgIGZyb20sCiAgICB0bywKICAgIHNkOiBzZW5kZXJEZXZpY2UsCiAgICBzcGs6
IHNlbmRlclB1YmxpYywKICAgIGl2OiBtZXNzYWdlSXYsCiAgICBjdDogY2lwaGVydGV4dCwKICAgIGtleXM6IG5vcm1hbGl6ZWRLZXlzCiAgfTsKfQovLyA9
PT0gUEVPUExFX0RNX0UyRUVfU0VSVkVSX1YxX0VORCA9PT0KCgpmdW5jdGlvbiBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKSB7CiAgdHJ5IHsKICAgIGlmICgh
ZnNBY2NvdW50cy5leGlzdHNTeW5jKFBFT1BMRV9MT0NBTF9TT0NJQUwpKSB7CiAgICAgIC8vID09PSBQRU9QTEVfRE1fQ0xPU0VfVjFfTE9DQUwgPT09CiAg
ICAgIHJldHVybiB7CiAgICAgICAgZnJpZW5kczogW10sCiAgICAgICAgZG1zOiBbXSwKICAgICAgICBmcmllbmRfcmVxdWVzdHM6IFtdLAogICAgICAgIGNs
b3NlZF9kbXM6IFtdCiAgICAgIH07CiAgICB9CgogICAgY29uc3QgcmF3ID0gSlNPTi5wYXJzZSgKICAgICAgZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoUEVP
UExFX0xPQ0FMX1NPQ0lBTCwgInV0ZjgiKQogICAgKTsKCiAgICByZXR1cm4gewogICAgICBmcmllbmRzOiBBcnJheS5pc0FycmF5KHJhdy5mcmllbmRzKSA/
IHJhdy5mcmllbmRzIDogW10sCiAgICAgIGRtczogQXJyYXkuaXNBcnJheShyYXcuZG1zKQogICAgICAgID8gcmF3LmRtcy5tYXAoCiAgICAgICAgICAgICht
ZXNzYWdlKSA9PiAoewogICAgICAgICAgICAgIC4uLm1lc3NhZ2UsCiAgICAgICAgICAgICAgYm9keToKICAgICAgICAgICAgICAgIHBlb3BsZURlY3J5cHRN
ZXNzYWdlVGV4dCgKICAgICAgICAgICAgICAgICAgbWVzc2FnZT8uYm9keQogICAgICAgICAgICAgICAgKQogICAgICAgICAgICB9KQogICAgICAgICAgKQog
ICAgICAgIDogW10sCiAgICAgIGZyaWVuZF9yZXF1ZXN0czogQXJyYXkuaXNBcnJheShyYXcuZnJpZW5kX3JlcXVlc3RzKQogICAgICAgID8gcmF3LmZyaWVu
ZF9yZXF1ZXN0cwogICAgICAgIDogW10sCiAgICAgIGNsb3NlZF9kbXM6CiAgICAgICAgQXJyYXkuaXNBcnJheShyYXcuY2xvc2VkX2RtcykKICAgICAgICAg
ID8gcmF3LmNsb3NlZF9kbXMKICAgICAgICAgIDogW10KICAgIH07CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBpZiAoCiAgICAgIGVycj8uY29kZSA9PT0KICAg
ICAgICAiUEVPUExFX01FU1NBR0VfREVDUllQVF9GQUlMRUQiCiAgICApIHsKICAgICAgdGhyb3cgZXJyOwogICAgfQoKICAgIHJldHVybiB7CiAgICAgIGZy
aWVuZHM6IFtdLAogICAgICBkbXM6IFtdLAogICAgICBmcmllbmRfcmVxdWVzdHM6IFtdLAogICAgICBjbG9zZWRfZG1zOiBbXQogICAgfTsKICB9Cn0KCmZ1
bmN0aW9uIHBlb3BsZVdyaXRlTG9jYWxTb2NpYWwoZGF0YSkgewogIGZzQWNjb3VudHMud3JpdGVGaWxlU3luYygKICAgIFBFT1BMRV9MT0NBTF9TT0NJQUws
CiAgICBKU09OLnN0cmluZ2lmeSgKICAgICAgewogICAgICAgIGZyaWVuZHM6IEFycmF5LmlzQXJyYXkoZGF0YS5mcmllbmRzKSA/IGRhdGEuZnJpZW5kcyA6
IFtdLAogICAgICAgIGRtczogQXJyYXkuaXNBcnJheShkYXRhLmRtcykKICAgICAgICAgID8gZGF0YS5kbXMubWFwKAogICAgICAgICAgICAgIChtZXNzYWdl
KSA9PiAoewogICAgICAgICAgICAgICAgLi4ubWVzc2FnZSwKICAgICAgICAgICAgICAgIGJvZHk6CiAgICAgICAgICAgICAgICAgIHBlb3BsZUVuY3J5cHRN
ZXNzYWdlVGV4dCgKICAgICAgICAgICAgICAgICAgICBtZXNzYWdlPy5ib2R5CiAgICAgICAgICAgICAgICAgICkKICAgICAgICAgICAgICB9KQogICAgICAg
ICAgICApCiAgICAgICAgICA6IFtdLAogICAgICAgIGZyaWVuZF9yZXF1ZXN0czogQXJyYXkuaXNBcnJheShkYXRhLmZyaWVuZF9yZXF1ZXN0cykKICAgICAg
ICAgID8gZGF0YS5mcmllbmRfcmVxdWVzdHMKICAgICAgICAgIDogW10sCiAgICAgICAgY2xvc2VkX2RtczoKICAgICAgICAgIEFycmF5LmlzQXJyYXkoZGF0
YS5jbG9zZWRfZG1zKQogICAgICAgICAgICA/IGRhdGEuY2xvc2VkX2RtcwogICAgICAgICAgICA6IFtdCiAgICAgIH0sCiAgICAgIG51bGwsCiAgICAgIDIK
ICAgICkgKyAiXG4iLAogICAgInV0ZjgiCiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlUHVibGljQWNjb3VudChhY2NvdW50KSB7CiAgaWYgKCFhY2NvdW50KSBy
ZXR1cm4gbnVsbDsKCiAgcmV0dXJuIHsKICAgIGlkOiBTdHJpbmcoYWNjb3VudC5pZCksCiAgICB1c2VybmFtZTogcGVvcGxlVXNlcm5hbWUoYWNjb3VudC51
c2VybmFtZSksCiAgICBkZXNjcmlwdGlvbjogU3RyaW5nKGFjY291bnQuZGVzY3JpcHRpb24gfHwgIiIpLAogICAgY3JlYXRlZEF0OiBhY2NvdW50LmNyZWF0
ZWRfYXQgfHwgYWNjb3VudC5jcmVhdGVkQXQgfHwgbnVsbAogIH07Cn0KCmZ1bmN0aW9uIHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKSB7CiAg
Y29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gcm9tQ29va2llKHJlcS5oZWFkZXJzLmNvb2tpZSB8fCAiIik7CgogIGlmICghc2Vzc2lvbikgewogICAg
cmVzLnN0YXR1cyg0MDEpLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOiAiQ29ubmV4aW9uIHJlcXVpc2UuIgogICAgfSk7CiAgICByZXR1
cm4gbnVsbDsKICB9CgogIHJldHVybiBzZXNzaW9uOwp9CgovLyA9PT0gUEVPUExFX0RNX0UyRUVfUk9VVEVTX1YxX1NUQVJUID09PQphcHAucG9zdCgKICAi
L2FwaS9lMmVlL2RldmljZSIsCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0cnkgewogICAgICBjb25zdCBzZXNzaW9uID0KICAgICAgICBwZW9wbGVT
ZXNzaW9uRm9yUmVxdWVzdCgKICAgICAgICAgIHJlcSwKICAgICAgICAgIHJlcwogICAgICAgICk7CgogICAgICBpZiAoIXNlc3Npb24pIHsKICAgICAgICBy
ZXR1cm47CiAgICAgIH0KCiAgICAgIGF3YWl0IHBlb3BsZUUyZWVSZWdpc3RlckRldmljZSgKICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgIHJlcS5ib2R5
Py5kZXZpY2VJZCwKICAgICAgICByZXEuYm9keT8ucHVibGljSndrCiAgICAgICk7CgogICAgICByZXR1cm4gcmVzLmpzb24oewogICAgICAgIG9rOiB0cnVl
CiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGlmICgKICAgICAgICBlcnI/LmNvZGUgPT09CiAgICAgICAgICAiRTJFRV9ERVZJQ0VfSU5W
QUxJRCIKICAgICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcwogICAgICAgICAgLnN0YXR1cyg0MDApCiAgICAgICAgICAuanNvbih7CiAgICAgICAgICAgIG9r
OiBmYWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIkNsw6kgRTJFRSBkZSBsJ2FwcGFyZWlsIGludmFsaWRlLiIKICAgICAgICAgIH0p
OwogICAgICB9CgogICAgICBjb25zb2xlLmVycm9yKAogICAgICAgICJbUGVvcGxlIEUyRUUvZGV2aWNlXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAg
ICByZXR1cm4gcmVzCiAgICAgICAgLnN0YXR1cyg1MDApCiAgICAgICAgLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAg
ICAgICAgICAgICJJbXBvc3NpYmxlIGQnZW5yZWdpc3RyZXIgbGEgY2zDqSBFMkVFLiIKICAgICAgICB9KTsKICAgIH0KICB9Cik7CgphcHAuZ2V0KAogICIv
YXBpL2UyZWUvZG0vOnVzZXJuYW1lL2RldmljZXMiLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAg
ICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QoCiAgICAgICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYgKCFzZXNzaW9u
KSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBjb25zdCB0YXJnZXQgPQogICAgICAgIGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50KAogICAgICAg
ICAgcmVxLnBhcmFtcy51c2VybmFtZQogICAgICAgICk7CgogICAgICBpZiAoIXRhcmdldCkgewogICAgICAgIHJldHVybiByZXMKICAgICAgICAgIC5zdGF0
dXMoNDA0KQogICAgICAgICAgLmpzb24oewogICAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAgICJVdGlsaXNh
dGV1ciBpbnRyb3V2YWJsZS4iCiAgICAgICAgICB9KTsKICAgICAgfQoKICAgICAgaWYgKAogICAgICAgIFN0cmluZyh0YXJnZXQuaWQpID09PQogICAgICAg
ICAgU3RyaW5nKHNlc3Npb24uaWQpCiAgICAgICkgewogICAgICAgIHJldHVybiByZXMKICAgICAgICAgIC5zdGF0dXMoNDAwKQogICAgICAgICAgLmpzb24o
ewogICAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAgICJDb252ZXJzYXRpb24gRTJFRSBpbnZhbGlkZS4iCiAg
ICAgICAgICB9KTsKICAgICAgfQoKICAgICAgY29uc3QgWwogICAgICAgIG15RGV2aWNlcywKICAgICAgICBvdGhlckRldmljZXMKICAgICAgXSA9CiAgICAg
ICAgYXdhaXQgUHJvbWlzZS5hbGwoWwogICAgICAgICAgcGVvcGxlRTJlZURldmljZXMoCiAgICAgICAgICAgIHNlc3Npb24uaWQKICAgICAgICAgICksCiAg
ICAgICAgICBwZW9wbGVFMmVlRGV2aWNlcygKICAgICAgICAgICAgdGFyZ2V0LmlkCiAgICAgICAgICApCiAgICAgICAgXSk7CgogICAgICByZXR1cm4gcmVz
Lmpzb24oewogICAgICAgIG9rOiB0cnVlLAogICAgICAgIG1lOiB7CiAgICAgICAgICBpZDoKICAgICAgICAgICAgU3RyaW5nKHNlc3Npb24uaWQpCiAgICAg
ICAgfSwKICAgICAgICBvdGhlcjoKICAgICAgICAgIHBlb3BsZVB1YmxpY0FjY291bnQoCiAgICAgICAgICAgIHRhcmdldAogICAgICAgICAgKSwKICAgICAg
ICBteURldmljZXMsCiAgICAgICAgb3RoZXJEZXZpY2VzCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAg
ICAgIltQZW9wbGUgRTJFRS9kZXZpY2VzXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAgICByZXR1cm4gcmVzCiAgICAgICAgLnN0YXR1cyg1MDApCiAg
ICAgICAgLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICJJbXBvc3NpYmxlIGRlIGNoYXJnZXIgbGVz
IGNsw6lzIEUyRUUuIgogICAgICAgIH0pOwogICAgfQogIH0KKTsKLy8gPT09IFBFT1BMRV9ETV9FMkVFX1JPVVRFU19WMV9FTkQgPT09Ci8vID09PSBQRU9Q
TEVfRE1fU0lERUJBUl9QUkVWSUVXX0NMRUFOX1YxID09PQoKZnVuY3Rpb24gcGVvcGxlQWNjb3VudElzT25saW5lKGFjY291bnRJZCkgewogIGNvbnN0IHdh
bnRlZCA9IFN0cmluZyhhY2NvdW50SWQpOwoKICBmb3IgKGNvbnN0IGlkIG9mIHVzZXJJZHMudmFsdWVzKCkpIHsKICAgIGlmIChTdHJpbmcoaWQpID09PSB3
YW50ZWQpIHJldHVybiB0cnVlOwogIH0KCiAgcmV0dXJuIGZhbHNlOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVGaW5kQWNjb3VudEJ5SWQoaWQpIHsKICBj
b25zdCB3YW50ZWQgPSBTdHJpbmcoaWQpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgK
ICAgICAgIlNFTEVDVCBpZCwgdXNlcm5hbWUsIHVzZXJuYW1lX2tleSwgcGFzc3dvcmRfaGFzaCwgIiArCiAgICAgICJkZXNjcmlwdGlvbiwgY3JlYXRlZF9h
dCAiICsKICAgICAgIkZST00gcGVvcGxlX2FjY291bnRzIFdIRVJFIGlkID0gJDEgTElNSVQgMSIsCiAgICAgIFt3YW50ZWRdCiAgICApOwoKICAgIHJldHVy
biByZXN1bHQucm93c1swXSB8fCBudWxsOwogIH0KCiAgcmV0dXJuICgKICAgIHBlb3BsZVJlYWRMb2NhbEFjY291bnRzKCkuZmluZCgKICAgICAgKGFjY291
bnQpID0+IFN0cmluZyhhY2NvdW50LmlkKSA9PT0gd2FudGVkCiAgICApIHx8IG51bGwKICApOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVGaW5kQWNjb3Vu
dHNCeUlkcyhpZHMpIHsKICBjb25zdCB3YW50ZWQgPSBbCiAgICAuLi5uZXcgU2V0KAogICAgICAoQXJyYXkuaXNBcnJheShpZHMpID8gaWRzIDogW10pCiAg
ICAgICAgLm1hcCgoaWQpID0+IFN0cmluZyhpZCB8fCAiIikpCiAgICAgICAgLmZpbHRlcihCb29sZWFuKQogICAgKQogIF07CgogIGlmICghd2FudGVkLmxl
bmd0aCkgewogICAgcmV0dXJuIFtdOwogIH0KCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnko
CiAgICAgICJTRUxFQ1QgaWQsIHVzZXJuYW1lLCB1c2VybmFtZV9rZXksIHBhc3N3b3JkX2hhc2gsICIgKwogICAgICAiZGVzY3JpcHRpb24sIGNyZWF0ZWRf
YXQgIiArCiAgICAgICJGUk9NIHBlb3BsZV9hY2NvdW50cyAiICsKICAgICAgIldIRVJFIGlkID0gQU5ZKCQxOjpiaWdpbnRbXSkiLAogICAgICBbd2FudGVk
XQogICAgKTsKCiAgICBjb25zdCBieUlkID0gbmV3IE1hcCgKICAgICAgcmVzdWx0LnJvd3MubWFwKChhY2NvdW50KSA9PiBbCiAgICAgICAgU3RyaW5nKGFj
Y291bnQuaWQpLAogICAgICAgIGFjY291bnQKICAgICAgXSkKICAgICk7CgogICAgcmV0dXJuIHdhbnRlZAogICAgICAubWFwKChpZCkgPT4gYnlJZC5nZXQo
aWQpKQogICAgICAuZmlsdGVyKEJvb2xlYW4pOwogIH0KCiAgY29uc3QgYnlJZCA9IG5ldyBNYXAoCiAgICBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygpLm1h
cCgoYWNjb3VudCkgPT4gWwogICAgICBTdHJpbmcoYWNjb3VudC5pZCksCiAgICAgIGFjY291bnQKICAgIF0pCiAgKTsKCiAgcmV0dXJuIHdhbnRlZAogICAg
Lm1hcCgoaWQpID0+IGJ5SWQuZ2V0KGlkKSkKICAgIC5maWx0ZXIoQm9vbGVhbik7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUxpc3RBY2NvdW50cyhzZWFy
Y2ggPSAiIikgewogIGNvbnN0IHEgPSBwZW9wbGVVc2VybmFtZShzZWFyY2gpLnRvTG9jYWxlTG93ZXJDYXNlKCJmci1GUiIpOwoKICBpZiAocGVvcGxlUG9v
bCkgewogICAgY29uc3QgcGFyYW1zID0gW107CiAgICBsZXQgd2hlcmUgPSAiIjsKCiAgICBpZiAocSkgewogICAgICBwYXJhbXMucHVzaCgiJSIgKyBxICsg
IiUiKTsKICAgICAgd2hlcmUgPSAiV0hFUkUgTE9XRVIodXNlcm5hbWUpIExJS0UgJDEiOwogICAgfQoKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3Bs
ZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1QgaWQsIHVzZXJuYW1lLCBkZXNjcmlwdGlvbiwgY3JlYXRlZF9hdCAiICsKICAgICAgIkZST00gcGVvcGxlX2Fj
Y291bnRzICIgKwogICAgICB3aGVyZSArCiAgICAgICIgT1JERVIgQlkgTE9XRVIodXNlcm5hbWUpIEFTQyBMSU1JVCA1MCIsCiAgICAgIHBhcmFtcwogICAg
KTsKCiAgICByZXR1cm4gcmVzdWx0LnJvd3M7CiAgfQoKICByZXR1cm4gcGVvcGxlUmVhZExvY2FsQWNjb3VudHMoKQogICAgLmZpbHRlcigoYWNjb3VudCkg
PT4gewogICAgICBpZiAoIXEpIHJldHVybiB0cnVlOwogICAgICByZXR1cm4gU3RyaW5nKGFjY291bnQudXNlcm5hbWUgfHwgIiIpCiAgICAgICAgLnRvTG9j
YWxlTG93ZXJDYXNlKCJmci1GUiIpCiAgICAgICAgLmluY2x1ZGVzKHEpOwogICAgfSkKICAgIC5zb3J0KChhLCBiKSA9PgogICAgICBTdHJpbmcoYS51c2Vy
bmFtZSB8fCAiIikubG9jYWxlQ29tcGFyZSgKICAgICAgICBTdHJpbmcoYi51c2VybmFtZSB8fCAiIiksCiAgICAgICAgImZyIiwKICAgICAgICB7IHNlbnNp
dGl2aXR5OiAiYmFzZSIgfQogICAgICApCiAgICApCiAgICAuc2xpY2UoMCwgNTApOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVVcGRhdGVEZXNjcmlwdGlv
bihhY2NvdW50SWQsIGRlc2NyaXB0aW9uKSB7CiAgY29uc3QgY2xlYW4gPSBTdHJpbmcoZGVzY3JpcHRpb24gfHwgIiIpLnRyaW0oKS5zbGljZSgwLCAyODAp
OwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlVQREFURSBwZW9wbGVfYWNj
b3VudHMgIiArCiAgICAgICJTRVQgZGVzY3JpcHRpb24gPSAkMSAiICsKICAgICAgIldIRVJFIGlkID0gJDIgIiArCiAgICAgICJSRVRVUk5JTkcgaWQsIHVz
ZXJuYW1lLCBkZXNjcmlwdGlvbiwgY3JlYXRlZF9hdCIsCiAgICAgIFtjbGVhbiwgU3RyaW5nKGFjY291bnRJZCldCiAgICApOwoKICAgIHJldHVybiByZXN1
bHQucm93c1swXSB8fCBudWxsOwogIH0KCiAgY29uc3QgYWNjb3VudHMgPSBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygpOwogIGNvbnN0IGFjY291bnQgPSBh
Y2NvdW50cy5maW5kKAogICAgKGl0ZW0pID0+IFN0cmluZyhpdGVtLmlkKSA9PT0gU3RyaW5nKGFjY291bnRJZCkKICApOwoKICBpZiAoIWFjY291bnQpIHJl
dHVybiBudWxsOwoKICBhY2NvdW50LmRlc2NyaXB0aW9uID0gY2xlYW47CiAgcGVvcGxlV3JpdGVMb2NhbEFjY291bnRzKGFjY291bnRzKTsKICByZXR1cm4g
YWNjb3VudDsKfQoKCi8vID09PSBQRU9QTEVfQVBQRUFSQU5DRV9WMl9TVEFSVCA9PT0KY29uc3QgUEVPUExFX0FQUEVBUkFOQ0VfVEhFTUVTID0gbmV3IFNl
dChbCiAgImRhcmsiLAogICJtaWRuaWdodCIsCiAgImxpZ2h0IiwKICAic3lzdGVtIiwKICAiY3VzdG9tIgpdKTsKCmNvbnN0IFBFT1BMRV9ERUZBVUxUX0FQ
UEVBUkFOQ0VfUEFMRVRURSA9IE9iamVjdC5mcmVlemUoewogIGJhY2tncm91bmQ6ICIjMTAwRTFBIiwKICBwYW5lbDogIiMxODE1MjQiLAogIHNlY29uZGFy
eTogIiMwOTA4MTEiLAogIHRleHQ6ICIjRjJFRkY4IiwKICBhY2NlbnQ6ICIjNjc1ODlEIgp9KTsKCmNvbnN0IFBFT1BMRV9ERUZBVUxUX0FQUEVBUkFOQ0Vf
R1JBRElFTlQgPSBPYmplY3QuZnJlZXplKHsKICBlbmFibGVkOiB0cnVlLAogIGRpcmVjdGlvbjogMTM1LAogIGludGVuc2l0eTogNzIsCiAgc3RhcnQ6ICIj
NTg2NUYyIiwKICBtaWRkbGU6ICIjOEI1Q0Y2IiwKICBlbmQ6ICIjRUI0NTlFIiwKICBjb2xvcnM6IE9iamVjdC5mcmVlemUoWyIjNTg2NUYyIiwgIiM4QjVD
RjYiLCAiI0VCNDU5RSJdKQp9KTsKCmNvbnN0IFBFT1BMRV9BUFBFQVJBTkNFX1BBTEVUVEVfS0VZUyA9IE9iamVjdC5mcmVlemUoWwogICJiYWNrZ3JvdW5k
IiwKICAicGFuZWwiLAogICJzZWNvbmRhcnkiLAogICJ0ZXh0IiwKICAiYWNjZW50IgpdKTsKCmNvbnN0IFBFT1BMRV9ERUZBVUxUX0FQUEVBUkFOQ0UgPSB7
CiAgdGhlbWU6ICJkYXJrIiwKICBhY2NlbnQ6IFBFT1BMRV9ERUZBVUxUX0FQUEVBUkFOQ0VfUEFMRVRURS5hY2NlbnQsCiAgcGFsZXR0ZTogewogICAgLi4u
UEVPUExFX0RFRkFVTFRfQVBQRUFSQU5DRV9QQUxFVFRFLAogICAgZ3JhZGllbnQ6IHsKICAgICAgLi4uUEVPUExFX0RFRkFVTFRfQVBQRUFSQU5DRV9HUkFE
SUVOVAogICAgfQogIH0KfTsKCmZ1bmN0aW9uIHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VUaGVtZSh2YWx1ZSkgewogIGNvbnN0IHRoZW1lID0gU3RyaW5n
KHZhbHVlIHx8ICIiKQogICAgLnRyaW0oKQogICAgLnRvTG93ZXJDYXNlKCk7CgogIHJldHVybiBQRU9QTEVfQVBQRUFSQU5DRV9USEVNRVMuaGFzKHRoZW1l
KQogICAgPyB0aGVtZQogICAgOiBQRU9QTEVfREVGQVVMVF9BUFBFQVJBTkNFLnRoZW1lOwp9CgpmdW5jdGlvbiBwZW9wbGVOb3JtYWxpemVBcHBlYXJhbmNl
SGV4KHZhbHVlLCBmYWxsYmFjaykgewogIGNvbnN0IGNvbG9yID0gU3RyaW5nKHZhbHVlIHx8ICIiKQogICAgLnRyaW0oKQogICAgLnRvVXBwZXJDYXNlKCk7
CgogIHJldHVybiAvXiNbMC05QS1GXXs2fSQvLnRlc3QoY29sb3IpCiAgICA/IGNvbG9yCiAgICA6IGZhbGxiYWNrOwp9CgpmdW5jdGlvbiBwZW9wbGVSZWFk
QXBwZWFyYW5jZVBhbGV0dGUodmFsdWUpIHsKICBpZiAoIXZhbHVlKSByZXR1cm4gbnVsbDsKCiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gIm9iamVjdCIgJiYg
IUFycmF5LmlzQXJyYXkodmFsdWUpKSB7CiAgICByZXR1cm4gdmFsdWU7CiAgfQoKICBpZiAodHlwZW9mIHZhbHVlID09PSAic3RyaW5nIikgewogICAgdHJ5
IHsKICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZSh2YWx1ZSk7CiAgICAgIHJldHVybiBwYXJzZWQgJiYgdHlwZW9mIHBhcnNlZCA9PT0gIm9iamVj
dCIgJiYgIUFycmF5LmlzQXJyYXkocGFyc2VkKQogICAgICAgID8gcGFyc2VkCiAgICAgICAgOiBudWxsOwogICAgfSBjYXRjaCB7CiAgICAgIHJldHVybiBu
dWxsOwogICAgfQogIH0KCiAgcmV0dXJuIG51bGw7Cn0KCmZ1bmN0aW9uIHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VHcmFkaWVudCh2YWx1ZSwgZmFsbGJh
Y2tDb2xvcnMgPSB7fSkgewogIGNvbnN0IHNvdXJjZSA9CiAgICB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICJvYmplY3QiICYmICFBcnJheS5pc0FycmF5
KHZhbHVlKQogICAgICA/IHZhbHVlCiAgICAgIDoge307CgogIGNvbnN0IGRpcmVjdGlvbiA9IE51bWJlcihzb3VyY2UuZGlyZWN0aW9uKTsKICBjb25zdCBp
bnRlbnNpdHkgPSBOdW1iZXIoc291cmNlLmludGVuc2l0eSk7CiAgY29uc3QgZmFsbGJhY2tTdGFydCA9IHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VIZXgo
CiAgICBmYWxsYmFja0NvbG9ycy5zdGFydCwKICAgIFBFT1BMRV9ERUZBVUxUX0FQUEVBUkFOQ0VfR1JBRElFTlQuc3RhcnQKICApOwogIGNvbnN0IGZhbGxi
YWNrTWlkZGxlID0gcGVvcGxlTm9ybWFsaXplQXBwZWFyYW5jZUhleCgKICAgIGZhbGxiYWNrQ29sb3JzLm1pZGRsZSwKICAgIFBFT1BMRV9ERUZBVUxUX0FQ
UEVBUkFOQ0VfR1JBRElFTlQubWlkZGxlCiAgKTsKICBjb25zdCBmYWxsYmFja0VuZCA9IHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VIZXgoCiAgICBmYWxs
YmFja0NvbG9ycy5lbmQsCiAgICBQRU9QTEVfREVGQVVMVF9BUFBFQVJBTkNFX0dSQURJRU5ULmVuZAogICk7CiAgY29uc3QgbGVnYWN5ID0gWwogICAgcGVv
cGxlTm9ybWFsaXplQXBwZWFyYW5jZUhleChzb3VyY2Uuc3RhcnQsIGZhbGxiYWNrU3RhcnQpLAogICAgcGVvcGxlTm9ybWFsaXplQXBwZWFyYW5jZUhleChz
b3VyY2UubWlkZGxlLCBmYWxsYmFja01pZGRsZSksCiAgICBwZW9wbGVOb3JtYWxpemVBcHBlYXJhbmNlSGV4KHNvdXJjZS5lbmQsIGZhbGxiYWNrRW5kKQog
IF07CgogIGxldCBjb2xvcnMgPSBBcnJheS5pc0FycmF5KHNvdXJjZS5jb2xvcnMpCiAgICA/IHNvdXJjZS5jb2xvcnMKICAgICAgICAubWFwKChjb2xvcikg
PT4gcGVvcGxlTm9ybWFsaXplQXBwZWFyYW5jZUhleChjb2xvciwgbnVsbCkpCiAgICAgICAgLmZpbHRlcihCb29sZWFuKQogICAgICAgIC5zbGljZSgwLCA3
KQogICAgOiBsZWdhY3k7CgogIGlmIChjb2xvcnMubGVuZ3RoIDwgMykgY29sb3JzID0gbGVnYWN5OwogIGNvbnN0IG1pZGRsZUluZGV4ID0gTWF0aC5mbG9v
cigoY29sb3JzLmxlbmd0aCAtIDEpIC8gMik7CgogIHJldHVybiB7CiAgICBlbmFibGVkOgogICAgICBzb3VyY2UuZW5hYmxlZCA9PSBudWxsCiAgICAgICAg
PyBQRU9QTEVfREVGQVVMVF9BUFBFQVJBTkNFX0dSQURJRU5ULmVuYWJsZWQKICAgICAgICA6IHNvdXJjZS5lbmFibGVkICE9PSBmYWxzZSwKICAgIGRpcmVj
dGlvbjogTnVtYmVyLmlzRmluaXRlKGRpcmVjdGlvbikKICAgICAgPyBNYXRoLm1heCgwLCBNYXRoLm1pbigzNjAsIE1hdGgucm91bmQoZGlyZWN0aW9uKSkp
CiAgICAgIDogUEVPUExFX0RFRkFVTFRfQVBQRUFSQU5DRV9HUkFESUVOVC5kaXJlY3Rpb24sCiAgICBpbnRlbnNpdHk6IE51bWJlci5pc0Zpbml0ZShpbnRl
bnNpdHkpCiAgICAgID8gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKGludGVuc2l0eSkpKQogICAgICA6IFBFT1BMRV9ERUZBVUxUX0FQ
UEVBUkFOQ0VfR1JBRElFTlQuaW50ZW5zaXR5LAogICAgY29sb3JzLAogICAgc3RhcnQ6IGNvbG9yc1swXSwKICAgIG1pZGRsZTogY29sb3JzW21pZGRsZUlu
ZGV4XSwKICAgIGVuZDogY29sb3JzW2NvbG9ycy5sZW5ndGggLSAxXQogIH07Cn0KCmZ1bmN0aW9uIHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VQYWxldHRl
KHZhbHVlLCBsZWdhY3lBY2NlbnQpIHsKICBjb25zdCBzb3VyY2UgPSBwZW9wbGVSZWFkQXBwZWFyYW5jZVBhbGV0dGUodmFsdWUpIHx8IHt9OwogIGNvbnN0
IGJhc2UgPSBQRU9QTEVfREVGQVVMVF9BUFBFQVJBTkNFX1BBTEVUVEU7CgogIHJldHVybiB7CiAgICBiYWNrZ3JvdW5kOiBwZW9wbGVOb3JtYWxpemVBcHBl
YXJhbmNlSGV4KAogICAgICBzb3VyY2UuYmFja2dyb3VuZCwKICAgICAgYmFzZS5iYWNrZ3JvdW5kCiAgICApLAogICAgcGFuZWw6IHBlb3BsZU5vcm1hbGl6
ZUFwcGVhcmFuY2VIZXgoCiAgICAgIHNvdXJjZS5wYW5lbCwKICAgICAgYmFzZS5wYW5lbAogICAgKSwKICAgIHNlY29uZGFyeTogcGVvcGxlTm9ybWFsaXpl
QXBwZWFyYW5jZUhleCgKICAgICAgc291cmNlLnNlY29uZGFyeSwKICAgICAgYmFzZS5zZWNvbmRhcnkKICAgICksCiAgICB0ZXh0OiBwZW9wbGVOb3JtYWxp
emVBcHBlYXJhbmNlSGV4KAogICAgICBzb3VyY2UudGV4dCwKICAgICAgYmFzZS50ZXh0CiAgICApLAogICAgYWNjZW50OiBwZW9wbGVOb3JtYWxpemVBcHBl
YXJhbmNlSGV4KAogICAgICBzb3VyY2UuYWNjZW50IHx8IGxlZ2FjeUFjY2VudCwKICAgICAgYmFzZS5hY2NlbnQKICAgICksCiAgICBncmFkaWVudDogcGVv
cGxlTm9ybWFsaXplQXBwZWFyYW5jZUdyYWRpZW50KHNvdXJjZS5ncmFkaWVudCwgewogICAgICBzdGFydDogc291cmNlLmJhY2tncm91bmQgfHwgYmFzZS5i
YWNrZ3JvdW5kLAogICAgICBtaWRkbGU6IHNvdXJjZS5hY2NlbnQgfHwgbGVnYWN5QWNjZW50IHx8IGJhc2UuYWNjZW50LAogICAgICBlbmQ6IHNvdXJjZS5z
ZWNvbmRhcnkgfHwgYmFzZS5zZWNvbmRhcnkKICAgIH0pCiAgfTsKfQoKZnVuY3Rpb24gcGVvcGxlQXBwZWFyYW5jZUZyb21BY2NvdW50KGFjY291bnQpIHsK
ICBjb25zdCBsZWdhY3lBY2NlbnQgPSBwZW9wbGVOb3JtYWxpemVBcHBlYXJhbmNlSGV4KAogICAgYWNjb3VudD8uYXBwZWFyYW5jZV9hY2NlbnQgfHwgYWNj
b3VudD8uYXBwZWFyYW5jZUFjY2VudCwKICAgIFBFT1BMRV9ERUZBVUxUX0FQUEVBUkFOQ0VfUEFMRVRURS5hY2NlbnQKICApOwoKICBjb25zdCBwYWxldHRl
ID0gcGVvcGxlTm9ybWFsaXplQXBwZWFyYW5jZVBhbGV0dGUoCiAgICBhY2NvdW50Py5hcHBlYXJhbmNlX3BhbGV0dGUgfHwgYWNjb3VudD8uYXBwZWFyYW5j
ZVBhbGV0dGUsCiAgICBsZWdhY3lBY2NlbnQKICApOwoKICByZXR1cm4gewogICAgdGhlbWU6IHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VUaGVtZSgKICAg
ICAgYWNjb3VudD8uYXBwZWFyYW5jZV90aGVtZSB8fCBhY2NvdW50Py5hcHBlYXJhbmNlVGhlbWUKICAgICksCiAgICBhY2NlbnQ6IHBhbGV0dGUuYWNjZW50
LAogICAgcGFsZXR0ZQogIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUdldEFwcGVhcmFuY2UoYWNjb3VudElkKSB7CiAgY29uc3Qgd2FudGVkID0gU3Ry
aW5nKGFjY291bnRJZCB8fCAiIik7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAg
ICAiU0VMRUNUIGFwcGVhcmFuY2VfdGhlbWUsIGFwcGVhcmFuY2VfYWNjZW50LCBhcHBlYXJhbmNlX3BhbGV0dGUgIiArCiAgICAgICJGUk9NIHBlb3BsZV9h
Y2NvdW50cyBXSEVSRSBpZCA9ICQxIExJTUlUIDEiLAogICAgICBbd2FudGVkXQogICAgKTsKCiAgICByZXR1cm4gcmVzdWx0LnJvd3NbMF0KICAgICAgPyBw
ZW9wbGVBcHBlYXJhbmNlRnJvbUFjY291bnQocmVzdWx0LnJvd3NbMF0pCiAgICAgIDogbnVsbDsKICB9CgogIGNvbnN0IGFjY291bnQgPSBwZW9wbGVSZWFk
TG9jYWxBY2NvdW50cygpLmZpbmQoCiAgICAoaXRlbSkgPT4gU3RyaW5nKGl0ZW0uaWQpID09PSB3YW50ZWQKICApOwoKICByZXR1cm4gYWNjb3VudAogICAg
PyBwZW9wbGVBcHBlYXJhbmNlRnJvbUFjY291bnQoYWNjb3VudCkKICAgIDogbnVsbDsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlVXBkYXRlQXBwZWFyYW5j
ZSgKICBhY2NvdW50SWQsCiAgdGhlbWUsCiAgYXBwZWFyYW5jZVZhbHVlID0ge30KKSB7CiAgY29uc3Qgd2FudGVkID0gU3RyaW5nKGFjY291bnRJZCB8fCAi
Iik7CiAgY29uc3QgY2xlYW5UaGVtZSA9IHBlb3BsZU5vcm1hbGl6ZUFwcGVhcmFuY2VUaGVtZSh0aGVtZSk7CiAgY29uc3QgY2xlYW5QYWxldHRlID0gcGVv
cGxlTm9ybWFsaXplQXBwZWFyYW5jZVBhbGV0dGUoCiAgICBhcHBlYXJhbmNlVmFsdWU/LnBhbGV0dGUsCiAgICBhcHBlYXJhbmNlVmFsdWU/LmFjY2VudAog
ICk7CiAgY29uc3QgcGFsZXR0ZUpzb24gPSBKU09OLnN0cmluZ2lmeShjbGVhblBhbGV0dGUpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVz
dWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlVQREFURSBwZW9wbGVfYWNjb3VudHMgIiArCiAgICAgICJTRVQgYXBwZWFyYW5jZV90aGVt
ZSA9ICQxLCBhcHBlYXJhbmNlX2FjY2VudCA9ICQyLCBhcHBlYXJhbmNlX3BhbGV0dGUgPSAkMyAiICsKICAgICAgIldIRVJFIGlkID0gJDQgIiArCiAgICAg
ICJSRVRVUk5JTkcgYXBwZWFyYW5jZV90aGVtZSwgYXBwZWFyYW5jZV9hY2NlbnQsIGFwcGVhcmFuY2VfcGFsZXR0ZSIsCiAgICAgIFtjbGVhblRoZW1lLCBj
bGVhblBhbGV0dGUuYWNjZW50LCBwYWxldHRlSnNvbiwgd2FudGVkXQogICAgKTsKCiAgICByZXR1cm4gcmVzdWx0LnJvd3NbMF0KICAgICAgPyBwZW9wbGVB
cHBlYXJhbmNlRnJvbUFjY291bnQocmVzdWx0LnJvd3NbMF0pCiAgICAgIDogbnVsbDsKICB9CgogIGNvbnN0IGFjY291bnRzID0gcGVvcGxlUmVhZExvY2Fs
QWNjb3VudHMoKTsKICBjb25zdCBhY2NvdW50ID0gYWNjb3VudHMuZmluZCgKICAgIChpdGVtKSA9PiBTdHJpbmcoaXRlbS5pZCkgPT09IHdhbnRlZAogICk7
CgogIGlmICghYWNjb3VudCkgcmV0dXJuIG51bGw7CgogIGFjY291bnQuYXBwZWFyYW5jZV90aGVtZSA9IGNsZWFuVGhlbWU7CiAgYWNjb3VudC5hcHBlYXJh
bmNlX2FjY2VudCA9IGNsZWFuUGFsZXR0ZS5hY2NlbnQ7CiAgYWNjb3VudC5hcHBlYXJhbmNlX3BhbGV0dGUgPSBjbGVhblBhbGV0dGU7CiAgcGVvcGxlV3Jp
dGVMb2NhbEFjY291bnRzKGFjY291bnRzKTsKCiAgcmV0dXJuIHBlb3BsZUFwcGVhcmFuY2VGcm9tQWNjb3VudChhY2NvdW50KTsKfQovLyA9PT0gUEVPUExF
X0FQUEVBUkFOQ0VfVjJfRU5EID09PQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRnJpZW5kSWRzKGFjY291bnRJZCkgewogIGNvbnN0IG93bmVyID0gU3RyaW5n
KGFjY291bnRJZCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNU
IGZyaWVuZF9pZCBGUk9NIHBlb3BsZV9mcmllbmRzICIgKwogICAgICAiV0hFUkUgdXNlcl9pZCA9ICQxIE9SREVSIEJZIGNyZWF0ZWRfYXQgQVNDIiwKICAg
ICAgW293bmVyXQogICAgKTsKCiAgICByZXR1cm4gcmVzdWx0LnJvd3MubWFwKChyb3cpID0+IFN0cmluZyhyb3cuZnJpZW5kX2lkKSk7CiAgfQoKICBjb25z
dCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CgogIHJldHVybiBkYXRhLmZyaWVuZHMKICAgIC5maWx0ZXIoKGl0ZW0pID0+IFN0cmluZyhpdGVt
LnVzZXJfaWQpID09PSBvd25lcikKICAgIC5tYXAoKGl0ZW0pID0+IFN0cmluZyhpdGVtLmZyaWVuZF9pZCkpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVI
YXNGcmllbmQoYWNjb3VudElkLCBmcmllbmRJZCkgewogIGNvbnN0IGlkcyA9IGF3YWl0IHBlb3BsZUZyaWVuZElkcyhhY2NvdW50SWQpOwogIHJldHVybiBp
ZHMuaW5jbHVkZXMoU3RyaW5nKGZyaWVuZElkKSk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUFkZEZyaWVuZChhY2NvdW50SWQsIGZyaWVuZElkKSB7CiAg
Y29uc3Qgb3duZXIgPSBTdHJpbmcoYWNjb3VudElkKTsKICBjb25zdCBmcmllbmQgPSBTdHJpbmcoZnJpZW5kSWQpOwoKICBpZiAob3duZXIgPT09IGZyaWVu
ZCkgcmV0dXJuOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9mcmll
bmRzICh1c2VyX2lkLCBmcmllbmRfaWQpICIgKwogICAgICAiVkFMVUVTICgkMSwgJDIpLCAoJDIsICQxKSAiICsKICAgICAgIk9OIENPTkZMSUNUIERPIE5P
VEhJTkciLAogICAgICBbb3duZXIsIGZyaWVuZF0KICAgICk7CiAgICByZXR1cm47CiAgfQoKICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU29jaWFs
KCk7CiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpOwoKICBjb25zdCBlbnN1cmUgPSAodXNlcklkLCBmcmllbmRJZFZhbHVlKSA9PiB7
CiAgICBpZiAoCiAgICAgICFkYXRhLmZyaWVuZHMuc29tZSgKICAgICAgICAoaXRlbSkgPT4KICAgICAgICAgIFN0cmluZyhpdGVtLnVzZXJfaWQpID09PSB1
c2VySWQgJiYKICAgICAgICAgIFN0cmluZyhpdGVtLmZyaWVuZF9pZCkgPT09IGZyaWVuZElkVmFsdWUKICAgICAgKQogICAgKSB7CiAgICAgIGRhdGEuZnJp
ZW5kcy5wdXNoKHsKICAgICAgICB1c2VyX2lkOiB1c2VySWQsCiAgICAgICAgZnJpZW5kX2lkOiBmcmllbmRJZFZhbHVlLAogICAgICAgIGNyZWF0ZWRfYXQ6
IG5vdwogICAgICB9KTsKICAgIH0KICB9OwoKICBlbnN1cmUob3duZXIsIGZyaWVuZCk7CiAgZW5zdXJlKGZyaWVuZCwgb3duZXIpOwoKICBwZW9wbGVXcml0
ZUxvY2FsU29jaWFsKGRhdGEpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVSZW1vdmVGcmllbmQoYWNjb3VudElkLCBmcmllbmRJZCkgewogIGNvbnN0IG93
bmVyID0gU3RyaW5nKGFjY291bnRJZCk7CiAgY29uc3QgZnJpZW5kID0gU3RyaW5nKGZyaWVuZElkKTsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0
IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJERUxFVEUgRlJPTSBwZW9wbGVfZnJpZW5kcyAiICsKICAgICAgIldIRVJFICh1c2VyX2lkID0gJDEgQU5EIGZy
aWVuZF9pZCA9ICQyKSAiICsKICAgICAgIk9SICh1c2VyX2lkID0gJDIgQU5EIGZyaWVuZF9pZCA9ICQxKSIsCiAgICAgIFtvd25lciwgZnJpZW5kXQogICAg
KTsKICAgIHJldHVybjsKICB9CgogIGNvbnN0IGRhdGEgPSBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKTsKCiAgZGF0YS5mcmllbmRzID0gZGF0YS5mcmllbmRz
LmZpbHRlcigKICAgIChpdGVtKSA9PgogICAgICAhKAogICAgICAgICgKICAgICAgICAgIFN0cmluZyhpdGVtLnVzZXJfaWQpID09PSBvd25lciAmJgogICAg
ICAgICAgU3RyaW5nKGl0ZW0uZnJpZW5kX2lkKSA9PT0gZnJpZW5kCiAgICAgICAgKSB8fAogICAgICAgICgKICAgICAgICAgIFN0cmluZyhpdGVtLnVzZXJf
aWQpID09PSBmcmllbmQgJiYKICAgICAgICAgIFN0cmluZyhpdGVtLmZyaWVuZF9pZCkgPT09IG93bmVyCiAgICAgICAgKQogICAgICApCiAgKTsKCiAgcGVv
cGxlV3JpdGVMb2NhbFNvY2lhbChkYXRhKTsKfQoKLy8gPT09IFBFT1BMRV9GUklFTkRfUkVRVUVTVFNfVjJfU1RBUlQgPT09CmFzeW5jIGZ1bmN0aW9uIHBl
b3BsZUZyaWVuZFJlcXVlc3RSb3dzKGFjY291bnRJZCkgewogIGNvbnN0IG1lID0gU3RyaW5nKGFjY291bnRJZCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAg
ICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNUIGlkLCBzZW5kZXJfaWQsIHJlY2lwaWVudF9pZCwgY3JlYXRl
ZF9hdCAiICsKICAgICAgIkZST00gcGVvcGxlX2ZyaWVuZF9yZXF1ZXN0cyAiICsKICAgICAgIldIRVJFIHNlbmRlcl9pZCA9ICQxIE9SIHJlY2lwaWVudF9p
ZCA9ICQxICIgKwogICAgICAiT1JERVIgQlkgY3JlYXRlZF9hdCBERVNDIiwKICAgICAgW21lXQogICAgKTsKICAgIHJldHVybiByZXN1bHQucm93czsKICB9
CgogIHJldHVybiBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKQogICAgLmZyaWVuZF9yZXF1ZXN0cwogICAgLmZpbHRlcigKICAgICAgKHJlcXVlc3QpID0+CiAg
ICAgICAgU3RyaW5nKHJlcXVlc3Quc2VuZGVyX2lkKSA9PT0gbWUgfHwKICAgICAgICBTdHJpbmcocmVxdWVzdC5yZWNpcGllbnRfaWQpID09PSBtZQogICAg
KQogICAgLnNvcnQoCiAgICAgIChhLCBiKSA9PgogICAgICAgIG5ldyBEYXRlKGIuY3JlYXRlZF9hdCkuZ2V0VGltZSgpIC0KICAgICAgICBuZXcgRGF0ZShh
LmNyZWF0ZWRfYXQpLmdldFRpbWUoKQogICAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRnJpZW5kUmVsYXRpb24oYWNjb3VudElkLCBvdGhlcklkKSB7
CiAgY29uc3QgbWUgPSBTdHJpbmcoYWNjb3VudElkKTsKICBjb25zdCBvdGhlciA9IFN0cmluZyhvdGhlcklkKTsKCiAgaWYgKGF3YWl0IHBlb3BsZUhhc0Zy
aWVuZChtZSwgb3RoZXIpKSB7CiAgICByZXR1cm4gewogICAgICBpc0ZyaWVuZDogdHJ1ZSwKICAgICAgZnJpZW5kUmVxdWVzdDogbnVsbCwKICAgICAgZnJp
ZW5kUmVxdWVzdElkOiBudWxsCiAgICB9OwogIH0KCiAgY29uc3QgcmVxdWVzdHMgPSBhd2FpdCBwZW9wbGVGcmllbmRSZXF1ZXN0Um93cyhtZSk7CgogIGNv
bnN0IG91dGdvaW5nID0gcmVxdWVzdHMuZmluZCgKICAgIChyZXF1ZXN0KSA9PgogICAgICBTdHJpbmcocmVxdWVzdC5zZW5kZXJfaWQpID09PSBtZSAmJgog
ICAgICBTdHJpbmcocmVxdWVzdC5yZWNpcGllbnRfaWQpID09PSBvdGhlcgogICk7CgogIGlmIChvdXRnb2luZykgewogICAgcmV0dXJuIHsKICAgICAgaXNG
cmllbmQ6IGZhbHNlLAogICAgICBmcmllbmRSZXF1ZXN0OiAib3V0Z29pbmciLAogICAgICBmcmllbmRSZXF1ZXN0SWQ6IFN0cmluZyhvdXRnb2luZy5pZCkK
ICAgIH07CiAgfQoKICBjb25zdCBpbmNvbWluZyA9IHJlcXVlc3RzLmZpbmQoCiAgICAocmVxdWVzdCkgPT4KICAgICAgU3RyaW5nKHJlcXVlc3Quc2VuZGVy
X2lkKSA9PT0gb3RoZXIgJiYKICAgICAgU3RyaW5nKHJlcXVlc3QucmVjaXBpZW50X2lkKSA9PT0gbWUKICApOwoKICBpZiAoaW5jb21pbmcpIHsKICAgIHJl
dHVybiB7CiAgICAgIGlzRnJpZW5kOiBmYWxzZSwKICAgICAgZnJpZW5kUmVxdWVzdDogImluY29taW5nIiwKICAgICAgZnJpZW5kUmVxdWVzdElkOiBTdHJp
bmcoaW5jb21pbmcuaWQpCiAgICB9OwogIH0KCiAgcmV0dXJuIHsKICAgIGlzRnJpZW5kOiBmYWxzZSwKICAgIGZyaWVuZFJlcXVlc3Q6IG51bGwsCiAgICBm
cmllbmRSZXF1ZXN0SWQ6IG51bGwKICB9Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVDcmVhdGVGcmllbmRSZXF1ZXN0KHNlbmRlcklkLCByZWNpcGllbnRJ
ZCkgewogIGNvbnN0IHNlbmRlciA9IFN0cmluZyhzZW5kZXJJZCk7CiAgY29uc3QgcmVjaXBpZW50ID0gU3RyaW5nKHJlY2lwaWVudElkKTsKCiAgaWYgKHNl
bmRlciA9PT0gcmVjaXBpZW50KSB7CiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIlNFTEZfUkVRVUVTVCIpOwogICAgZXJyLmNvZGUgPSAiU0VMRl9SRVFV
RVNUIjsKICAgIHRocm93IGVycjsKICB9CgogIGlmIChhd2FpdCBwZW9wbGVIYXNGcmllbmQoc2VuZGVyLCByZWNpcGllbnQpKSB7CiAgICBjb25zdCBlcnIg
PSBuZXcgRXJyb3IoIkFMUkVBRFlfRlJJRU5EUyIpOwogICAgZXJyLmNvZGUgPSAiQUxSRUFEWV9GUklFTkRTIjsKICAgIHRocm93IGVycjsKICB9CgogIGNv
bnN0IGN1cnJlbnQgPSBhd2FpdCBwZW9wbGVGcmllbmRSZXF1ZXN0Um93cyhzZW5kZXIpOwoKICBjb25zdCBpbmNvbWluZyA9IGN1cnJlbnQuZmluZCgKICAg
IChyZXF1ZXN0KSA9PgogICAgICBTdHJpbmcocmVxdWVzdC5zZW5kZXJfaWQpID09PSByZWNpcGllbnQgJiYKICAgICAgU3RyaW5nKHJlcXVlc3QucmVjaXBp
ZW50X2lkKSA9PT0gc2VuZGVyCiAgKTsKCiAgaWYgKGluY29taW5nKSB7CiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIklOQ09NSU5HX0VYSVNUUyIpOwog
ICAgZXJyLmNvZGUgPSAiSU5DT01JTkdfRVhJU1RTIjsKICAgIGVyci5yZXF1ZXN0SWQgPSBTdHJpbmcoaW5jb21pbmcuaWQpOwogICAgdGhyb3cgZXJyOwog
IH0KCiAgY29uc3QgZXhpc3RpbmcgPSBjdXJyZW50LmZpbmQoCiAgICAocmVxdWVzdCkgPT4KICAgICAgU3RyaW5nKHJlcXVlc3Quc2VuZGVyX2lkKSA9PT0g
c2VuZGVyICYmCiAgICAgIFN0cmluZyhyZXF1ZXN0LnJlY2lwaWVudF9pZCkgPT09IHJlY2lwaWVudAogICk7CgogIGlmIChleGlzdGluZykgcmV0dXJuIGV4
aXN0aW5nOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIklOU0VSVCBJTlRP
IHBlb3BsZV9mcmllbmRfcmVxdWVzdHMgIiArCiAgICAgICIoc2VuZGVyX2lkLCByZWNpcGllbnRfaWQpIFZBTFVFUyAoJDEsICQyKSAiICsKICAgICAgIk9O
IENPTkZMSUNUIERPIE5PVEhJTkcgIiArCiAgICAgICJSRVRVUk5JTkcgaWQsIHNlbmRlcl9pZCwgcmVjaXBpZW50X2lkLCBjcmVhdGVkX2F0IiwKICAgICAg
W3NlbmRlciwgcmVjaXBpZW50XQogICAgKTsKCiAgICBpZiAocmVzdWx0LnJvd3NbMF0pIHJldHVybiByZXN1bHQucm93c1swXTsKCiAgICBjb25zdCBjb25m
bGljdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1QgaWQsIHNlbmRlcl9pZCwgcmVjaXBpZW50X2lkLCBjcmVhdGVkX2F0ICIgKwog
ICAgICAiRlJPTSBwZW9wbGVfZnJpZW5kX3JlcXVlc3RzICIgKwogICAgICAiV0hFUkUgKHNlbmRlcl9pZCA9ICQxIEFORCByZWNpcGllbnRfaWQgPSAkMikg
IiArCiAgICAgICJPUiAoc2VuZGVyX2lkID0gJDIgQU5EIHJlY2lwaWVudF9pZCA9ICQxKSAiICsKICAgICAgIkxJTUlUIDEiLAogICAgICBbc2VuZGVyLCBy
ZWNpcGllbnRdCiAgICApOwoKICAgIGNvbnN0IHJvdyA9IGNvbmZsaWN0LnJvd3NbMF07CgogICAgaWYgKHJvdyAmJiBTdHJpbmcocm93LnNlbmRlcl9pZCkg
PT09IHJlY2lwaWVudCkgewogICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIklOQ09NSU5HX0VYSVNUUyIpOwogICAgICBlcnIuY29kZSA9ICJJTkNPTUlO
R19FWElTVFMiOwogICAgICBlcnIucmVxdWVzdElkID0gU3RyaW5nKHJvdy5pZCk7CiAgICAgIHRocm93IGVycjsKICAgIH0KCiAgICByZXR1cm4gcm93IHx8
IG51bGw7CiAgfQoKICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CgogIGNvbnN0IHJlcXVlc3QgPSB7CiAgICBpZDogY3J5cHRvQWNj
b3VudHMucmFuZG9tVVVJRCgpLAogICAgc2VuZGVyX2lkOiBzZW5kZXIsCiAgICByZWNpcGllbnRfaWQ6IHJlY2lwaWVudCwKICAgIGNyZWF0ZWRfYXQ6IG5l
dyBEYXRlKCkudG9JU09TdHJpbmcoKQogIH07CgogIGRhdGEuZnJpZW5kX3JlcXVlc3RzLnB1c2gocmVxdWVzdCk7CiAgcGVvcGxlV3JpdGVMb2NhbFNvY2lh
bChkYXRhKTsKCiAgcmV0dXJuIHJlcXVlc3Q7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUFjY2VwdEZyaWVuZFJlcXVlc3QoYWNjb3VudElkLCByZXF1ZXN0
SWQpIHsKICBjb25zdCBtZSA9IFN0cmluZyhhY2NvdW50SWQpOwogIGNvbnN0IGlkID0gU3RyaW5nKHJlcXVlc3RJZCk7CgogIGlmIChwZW9wbGVQb29sKSB7
CiAgICBjb25zdCBjbGllbnQgPSBhd2FpdCBwZW9wbGVQb29sLmNvbm5lY3QoKTsKCiAgICB0cnkgewogICAgICBhd2FpdCBjbGllbnQucXVlcnkoIkJFR0lO
Iik7CgogICAgICBjb25zdCBmb3VuZCA9IGF3YWl0IGNsaWVudC5xdWVyeSgKICAgICAgICAiU0VMRUNUIGlkLCBzZW5kZXJfaWQsIHJlY2lwaWVudF9pZCAi
ICsKICAgICAgICAiRlJPTSBwZW9wbGVfZnJpZW5kX3JlcXVlc3RzICIgKwogICAgICAgICJXSEVSRSBpZCA9ICQxIEFORCByZWNpcGllbnRfaWQgPSAkMiAi
ICsKICAgICAgICAiRk9SIFVQREFURSIsCiAgICAgICAgW2lkLCBtZV0KICAgICAgKTsKCiAgICAgIGNvbnN0IHJlcXVlc3QgPSBmb3VuZC5yb3dzWzBdOwoK
ICAgICAgaWYgKCFyZXF1ZXN0KSB7CiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCJST0xMQkFDSyIpOwogICAgICAgIHJldHVybiBudWxsOwogICAgICB9
CgogICAgICBjb25zdCBzZW5kZXIgPSBTdHJpbmcocmVxdWVzdC5zZW5kZXJfaWQpOwoKICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICJJTlNF
UlQgSU5UTyBwZW9wbGVfZnJpZW5kcyAodXNlcl9pZCwgZnJpZW5kX2lkKSAiICsKICAgICAgICAiVkFMVUVTICgkMSwgJDIpLCAoJDIsICQxKSAiICsKICAg
ICAgICAiT04gQ09ORkxJQ1QgRE8gTk9USElORyIsCiAgICAgICAgW21lLCBzZW5kZXJdCiAgICAgICk7CgogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAg
ICAgICAgIkRFTEVURSBGUk9NIHBlb3BsZV9mcmllbmRfcmVxdWVzdHMgIiArCiAgICAgICAgIldIRVJFIChzZW5kZXJfaWQgPSAkMSBBTkQgcmVjaXBpZW50
X2lkID0gJDIpICIgKwogICAgICAgICJPUiAoc2VuZGVyX2lkID0gJDIgQU5EIHJlY2lwaWVudF9pZCA9ICQxKSIsCiAgICAgICAgW21lLCBzZW5kZXJdCiAg
ICAgICk7CgogICAgICBhd2FpdCBjbGllbnQucXVlcnkoIkNPTU1JVCIpOwoKICAgICAgcmV0dXJuIHsKICAgICAgICBzZW5kZXJJZDogc2VuZGVyLAogICAg
ICAgIHJlY2lwaWVudElkOiBtZQogICAgICB9OwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiUk9MTEJBQ0siKS5jYXRj
aCgoKSA9PiB7fSk7CiAgICAgIHRocm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfQoKICBjb25zdCBk
YXRhID0gcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CgogIGNvbnN0IHJlcXVlc3QgPSBkYXRhLmZyaWVuZF9yZXF1ZXN0cy5maW5kKAogICAgKGl0ZW0pID0+
CiAgICAgIFN0cmluZyhpdGVtLmlkKSA9PT0gaWQgJiYKICAgICAgU3RyaW5nKGl0ZW0ucmVjaXBpZW50X2lkKSA9PT0gbWUKICApOwoKICBpZiAoIXJlcXVl
c3QpIHJldHVybiBudWxsOwoKICBjb25zdCBzZW5kZXIgPSBTdHJpbmcocmVxdWVzdC5zZW5kZXJfaWQpOwogIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9J
U09TdHJpbmcoKTsKCiAgY29uc3QgZW5zdXJlID0gKG93bmVyLCBmcmllbmQpID0+IHsKICAgIGlmICgKICAgICAgIWRhdGEuZnJpZW5kcy5zb21lKAogICAg
ICAgIChpdGVtKSA9PgogICAgICAgICAgU3RyaW5nKGl0ZW0udXNlcl9pZCkgPT09IG93bmVyICYmCiAgICAgICAgICBTdHJpbmcoaXRlbS5mcmllbmRfaWQp
ID09PSBmcmllbmQKICAgICAgKQogICAgKSB7CiAgICAgIGRhdGEuZnJpZW5kcy5wdXNoKHsKICAgICAgICB1c2VyX2lkOiBvd25lciwKICAgICAgICBmcmll
bmRfaWQ6IGZyaWVuZCwKICAgICAgICBjcmVhdGVkX2F0OiBub3cKICAgICAgfSk7CiAgICB9CiAgfTsKCiAgZW5zdXJlKG1lLCBzZW5kZXIpOwogIGVuc3Vy
ZShzZW5kZXIsIG1lKTsKCiAgZGF0YS5mcmllbmRfcmVxdWVzdHMgPSBkYXRhLmZyaWVuZF9yZXF1ZXN0cy5maWx0ZXIoCiAgICAoaXRlbSkgPT4KICAgICAg
ISgKICAgICAgICAoCiAgICAgICAgICBTdHJpbmcoaXRlbS5zZW5kZXJfaWQpID09PSBtZSAmJgogICAgICAgICAgU3RyaW5nKGl0ZW0ucmVjaXBpZW50X2lk
KSA9PT0gc2VuZGVyCiAgICAgICAgKSB8fAogICAgICAgICgKICAgICAgICAgIFN0cmluZyhpdGVtLnNlbmRlcl9pZCkgPT09IHNlbmRlciAmJgogICAgICAg
ICAgU3RyaW5nKGl0ZW0ucmVjaXBpZW50X2lkKSA9PT0gbWUKICAgICAgICApCiAgICAgICkKICApOwoKICBwZW9wbGVXcml0ZUxvY2FsU29jaWFsKGRhdGEp
OwoKICByZXR1cm4gewogICAgc2VuZGVySWQ6IHNlbmRlciwKICAgIHJlY2lwaWVudElkOiBtZQogIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZURlbGV0
ZUZyaWVuZFJlcXVlc3QoYWNjb3VudElkLCByZXF1ZXN0SWQpIHsKICBjb25zdCBtZSA9IFN0cmluZyhhY2NvdW50SWQpOwogIGNvbnN0IGlkID0gU3RyaW5n
KHJlcXVlc3RJZCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiREVMRVRF
IEZST00gcGVvcGxlX2ZyaWVuZF9yZXF1ZXN0cyAiICsKICAgICAgIldIRVJFIGlkID0gJDEgIiArCiAgICAgICJBTkQgKHNlbmRlcl9pZCA9ICQyIE9SIHJl
Y2lwaWVudF9pZCA9ICQyKSAiICsKICAgICAgIlJFVFVSTklORyBpZCwgc2VuZGVyX2lkLCByZWNpcGllbnRfaWQiLAogICAgICBbaWQsIG1lXQogICAgKTsK
CiAgICBjb25zdCByb3cgPSByZXN1bHQucm93c1swXTsKCiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGw7CgogICAgcmV0dXJuIHsKICAgICAgc2VuZGVySWQ6
IFN0cmluZyhyb3cuc2VuZGVyX2lkKSwKICAgICAgcmVjaXBpZW50SWQ6IFN0cmluZyhyb3cucmVjaXBpZW50X2lkKQogICAgfTsKICB9CgogIGNvbnN0IGRh
dGEgPSBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKTsKCiAgY29uc3QgcmVxdWVzdCA9IGRhdGEuZnJpZW5kX3JlcXVlc3RzLmZpbmQoCiAgICAoaXRlbSkgPT4K
ICAgICAgU3RyaW5nKGl0ZW0uaWQpID09PSBpZCAmJgogICAgICAoCiAgICAgICAgU3RyaW5nKGl0ZW0uc2VuZGVyX2lkKSA9PT0gbWUgfHwKICAgICAgICBT
dHJpbmcoaXRlbS5yZWNpcGllbnRfaWQpID09PSBtZQogICAgICApCiAgKTsKCiAgaWYgKCFyZXF1ZXN0KSByZXR1cm4gbnVsbDsKCiAgZGF0YS5mcmllbmRf
cmVxdWVzdHMgPSBkYXRhLmZyaWVuZF9yZXF1ZXN0cy5maWx0ZXIoCiAgICAoaXRlbSkgPT4gU3RyaW5nKGl0ZW0uaWQpICE9PSBpZAogICk7CgogIHBlb3Bs
ZVdyaXRlTG9jYWxTb2NpYWwoZGF0YSk7CgogIHJldHVybiB7CiAgICBzZW5kZXJJZDogU3RyaW5nKHJlcXVlc3Quc2VuZGVyX2lkKSwKICAgIHJlY2lwaWVu
dElkOiBTdHJpbmcocmVxdWVzdC5yZWNpcGllbnRfaWQpCiAgfTsKfQovLyA9PT0gUEVPUExFX0ZSSUVORF9SRVFVRVNUU19WMl9FTkQgPT09Cgphc3luYyBm
dW5jdGlvbiBwZW9wbGVDcmVhdGVEbSgKICBzZW5kZXJJZCwKICByZWNpcGllbnRJZCwKICBib2R5LAogIGltYWdlSWQgPSBudWxsLAogIHJlcGx5VG9JZCA9
IG51bGwKKSB7CiAgY29uc3Qgc2VuZGVyID0KICAgIFN0cmluZyhzZW5kZXJJZCk7CgogIGNvbnN0IHJlY2lwaWVudCA9CiAgICBTdHJpbmcocmVjaXBpZW50
SWQpOwoKICBjb25zdCByYXdCb2R5ID0KICAgIFN0cmluZyhib2R5IHx8ICIiKQogICAgICAudHJpbSgpOwoKICBjb25zdCBjbGVhbkJvZHkgPQogICAgcGVv
cGxlRG1FMmVlSXNFbnZlbG9wZSgKICAgICAgcmF3Qm9keQogICAgKQogICAgICA/IHJhd0JvZHkKICAgICAgOiByYXdCb2R5LnNsaWNlKAogICAgICAgICAg
MCwKICAgICAgICAgIDIwMDAKICAgICAgICApOwoKICBjb25zdCBpbWFnZUtleSA9CiAgICBwZW9wbGVOb3JtYWxpemVNZXNzYWdlSW1hZ2VJZCgKICAgICAg
aW1hZ2VJZAogICAgKTsKCiAgY29uc3QgcmVwbHlLZXkgPQogICAgcGVvcGxlUmVwbHlJZCgKICAgICAgcmVwbHlUb0lkCiAgICApOwoKICBpZiAoCiAgICAh
Y2xlYW5Cb2R5ICYmCiAgICAhaW1hZ2VLZXkKICApIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3Bs
ZUVuc3VyZVJlcGx5Q29sdW1ucygpOwoKICAgIGNvbnN0IGNsaWVudCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wuY29ubmVjdCgpOwoKICAgIHRyeSB7CiAg
ICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiQkVHSU4iKTsKCiAgICAgIGNvbnN0IHJlcGx5ID0KICAgICAgICByZXBseUtleQogICAgICAgICAgPyBhd2FpdCBw
ZW9wbGVEbVJlcGx5UHJldmlldygKICAgICAgICAgICAgICBzZW5kZXIsCiAgICAgICAgICAgICAgcmVjaXBpZW50LAogICAgICAgICAgICAgIHJlcGx5S2V5
LAogICAgICAgICAgICAgIGNsaWVudAogICAgICAgICAgICApCiAgICAgICAgICA6IG51bGw7CgogICAgICBpZiAoCiAgICAgICAgcmVwbHlLZXkgJiYKICAg
ICAgICAhcmVwbHkKICAgICAgKSB7CiAgICAgICAgY29uc3QgZXJyID0KICAgICAgICAgIG5ldyBFcnJvcigiUkVQTFlfSU5WQUxJRCIpOwoKICAgICAgICBl
cnIuY29kZSA9CiAgICAgICAgICAiUkVQTFlfSU5WQUxJRCI7CgogICAgICAgIHRocm93IGVycjsKICAgICAgfQoKICAgICAgY29uc3QgcmVzdWx0ID0KICAg
ICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiSU5TRVJUIElOVE8gcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyAiICsKICAgICAgICAgICIoc2Vu
ZGVyX2lkLCByZWNpcGllbnRfaWQsIGJvZHksIHJlcGx5X3RvX2lkKSAiICsKICAgICAgICAgICJWQUxVRVMgKCQxLCAkMiwgJDMsICQ0KSAiICsKICAgICAg
ICAgICJSRVRVUk5JTkcgaWQsIHNlbmRlcl9pZCwgcmVjaXBpZW50X2lkLCBib2R5LCByZXBseV90b19pZCwgY3JlYXRlZF9hdCwgcmVhZF9hdCIsCiAgICAg
ICAgICBbCiAgICAgICAgICAgIHNlbmRlciwKICAgICAgICAgICAgcmVjaXBpZW50LAogICAgICAgICAgICBwZW9wbGVFbmNyeXB0TWVzc2FnZVRleHQoCiAg
ICAgICAgICAgICAgY2xlYW5Cb2R5CiAgICAgICAgICAgICksCiAgICAgICAgICAgIHJlcGx5S2V5IHx8IG51bGwKICAgICAgICAgIF0KICAgICAgICApOwoK
ICAgICAgY29uc3Qgcm93ID0KICAgICAgICByZXN1bHQucm93c1swXTsKCiAgICAgIGxldCBib3VuZEltYWdlSWQgPQogICAgICAgIG51bGw7CgogICAgICBp
ZiAoaW1hZ2VLZXkpIHsKICAgICAgICBib3VuZEltYWdlSWQgPQogICAgICAgICAgYXdhaXQgcGVvcGxlQmluZERtTWVzc2FnZUltYWdlKAogICAgICAgICAg
ICBzZW5kZXIsCiAgICAgICAgICAgIGltYWdlS2V5LAogICAgICAgICAgICByb3cuaWQsCiAgICAgICAgICAgIHNlbmRlciwKICAgICAgICAgICAgcmVjaXBp
ZW50LAogICAgICAgICAgICBjbGllbnQKICAgICAgICAgICk7CgogICAgICAgIGlmICghYm91bmRJbWFnZUlkKSB7CiAgICAgICAgICBjb25zdCBlcnIgPQog
ICAgICAgICAgICBuZXcgRXJyb3IoIklNQUdFX0lOVkFMSUQiKTsKCiAgICAgICAgICBlcnIuY29kZSA9CiAgICAgICAgICAgICJJTUFHRV9JTlZBTElEIjsK
CiAgICAgICAgICB0aHJvdyBlcnI7CiAgICAgICAgfQogICAgICB9CgogICAgICBhd2FpdCBjbGllbnQucXVlcnkoIkNPTU1JVCIpOwoKICAgICAgcm93LmJv
ZHkgPQogICAgICAgIHBlb3BsZURlY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgIHJvdy5ib2R5CiAgICAgICAgKTsKCiAgICAgIHJvdy5pbWFnZV9pZCA9
CiAgICAgICAgYm91bmRJbWFnZUlkOwoKICAgICAgcm93LnJlcGx5X3RvID0KICAgICAgICByZXBseTsKCiAgICAgIHJldHVybiByb3c7CiAgICB9IGNhdGNo
IChlcnIpIHsKICAgICAgYXdhaXQgY2xpZW50CiAgICAgICAgLnF1ZXJ5KCJST0xMQkFDSyIpCiAgICAgICAgLmNhdGNoKCgpID0+IHt9KTsKCiAgICAgIHRo
cm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfQoKICBjb25zdCBkYXRhID0KICAgIHBlb3BsZVJlYWRM
b2NhbFNvY2lhbCgpOwoKICBjb25zdCByZXBseSA9CiAgICByZXBseUtleQogICAgICA/IGF3YWl0IHBlb3BsZURtUmVwbHlQcmV2aWV3KAogICAgICAgICAg
c2VuZGVyLAogICAgICAgICAgcmVjaXBpZW50LAogICAgICAgICAgcmVwbHlLZXkKICAgICAgICApCiAgICAgIDogbnVsbDsKCiAgaWYgKAogICAgcmVwbHlL
ZXkgJiYKICAgICFyZXBseQogICkgewogICAgY29uc3QgZXJyID0KICAgICAgbmV3IEVycm9yKCJSRVBMWV9JTlZBTElEIik7CgogICAgZXJyLmNvZGUgPQog
ICAgICAiUkVQTFlfSU5WQUxJRCI7CgogICAgdGhyb3cgZXJyOwogIH0KCiAgY29uc3QgbWVzc2FnZSA9IHsKICAgIGlkOgogICAgICBjcnlwdG9BY2NvdW50
cy5yYW5kb21VVUlEKCksCiAgICBzZW5kZXJfaWQ6CiAgICAgIHNlbmRlciwKICAgIHJlY2lwaWVudF9pZDoKICAgICAgcmVjaXBpZW50LAogICAgYm9keToK
ICAgICAgY2xlYW5Cb2R5LAogICAgaW1hZ2VfaWQ6CiAgICAgIG51bGwsCiAgICByZXBseV90b19pZDoKICAgICAgcmVwbHlLZXkgfHwgbnVsbCwKICAgIGNy
ZWF0ZWRfYXQ6CiAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSwKICAgIHJlYWRfYXQ6CiAgICAgIG51bGwKICB9OwoKICBpZiAoaW1hZ2VLZXkpIHsK
ICAgIGNvbnN0IGJvdW5kID0KICAgICAgYXdhaXQgcGVvcGxlQmluZERtTWVzc2FnZUltYWdlKAogICAgICAgIHNlbmRlciwKICAgICAgICBpbWFnZUtleSwK
ICAgICAgICBtZXNzYWdlLmlkLAogICAgICAgIHNlbmRlciwKICAgICAgICByZWNpcGllbnQKICAgICAgKTsKCiAgICBpZiAoIWJvdW5kKSB7CiAgICAgIGNv
bnN0IGVyciA9CiAgICAgICAgbmV3IEVycm9yKCJJTUFHRV9JTlZBTElEIik7CgogICAgICBlcnIuY29kZSA9CiAgICAgICAgIklNQUdFX0lOVkFMSUQiOwoK
ICAgICAgdGhyb3cgZXJyOwogICAgfQoKICAgIG1lc3NhZ2UuaW1hZ2VfaWQgPQogICAgICBib3VuZDsKICB9CgogIGRhdGEuZG1zLnB1c2gobWVzc2FnZSk7
CgogIGlmICgKICAgIGRhdGEuZG1zLmxlbmd0aCA+CiAgICAxMDAwMAogICkgewogICAgZGF0YS5kbXMgPQogICAgICBkYXRhLmRtcy5zbGljZSgtMTAwMDAp
OwogIH0KCiAgcGVvcGxlV3JpdGVMb2NhbFNvY2lhbChkYXRhKTsKCiAgbWVzc2FnZS5yZXBseV90byA9CiAgICByZXBseTsKCiAgcmV0dXJuIG1lc3NhZ2U7
Cn0KCi8vID09PSBQRU9QTEVfRE1fUEFHSU5BVElPTl9WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX0RNX0hJU1RPUllfUEFHRV9TSVpFID0gNTA7Cgphc3lu
YyBmdW5jdGlvbiBwZW9wbGVEbUhpc3RvcnkoCiAgYWNjb3VudElkLAogIG90aGVySWQsCiAgb3B0aW9ucyA9IG51bGwKKSB7CiAgY29uc3QgbWUgPQogICAg
U3RyaW5nKGFjY291bnRJZCk7CgogIGNvbnN0IG90aGVyID0KICAgIFN0cmluZyhvdGhlcklkKTsKCiAgY29uc3QgYmVmb3JlUmF3ID0KICAgIFN0cmluZygK
ICAgICAgb3B0aW9ucz8uYmVmb3JlIHx8CiAgICAgICIiCiAgICApLnRyaW0oKTsKCiAgY29uc3QgYWZ0ZXJSYXcgPQogICAgU3RyaW5nKAogICAgICBvcHRp
b25zPy5hZnRlciB8fAogICAgICAiIgogICAgKS50cmltKCk7CgogIGZ1bmN0aW9uIHBlb3BsZURtSGlzdG9yeUN1cnNvcih2YWx1ZSkgewogICAgaWYgKCF2
YWx1ZSkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KCiAgICBjb25zdCBkYXRlID0KICAgICAgbmV3IERhdGUodmFsdWUpOwoKICAgIGlmICgKICAgICAg
TnVtYmVyLmlzTmFOKAogICAgICAgIGRhdGUuZ2V0VGltZSgpCiAgICAgICkKICAgICkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KCiAgICByZXR1cm4g
ZGF0ZS50b0lTT1N0cmluZygpOwogIH0KCiAgY29uc3QgYmVmb3JlID0KICAgIHBlb3BsZURtSGlzdG9yeUN1cnNvcigKICAgICAgYmVmb3JlUmF3CiAgICAp
OwoKICBjb25zdCBhZnRlciA9CiAgICBiZWZvcmUKICAgICAgPyBudWxsCiAgICAgIDogcGVvcGxlRG1IaXN0b3J5Q3Vyc29yKAogICAgICAgICAgYWZ0ZXJS
YXcKICAgICAgICApOwoKICBjb25zdCBkaXJlY3Rpb24gPQogICAgYmVmb3JlCiAgICAgID8gIm9sZGVyIgogICAgICA6IGFmdGVyCiAgICAgICAgPyAibmV3
ZXIiCiAgICAgICAgOiAibGF0ZXN0IjsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3BsZUVuc3VyZVJlcGx5Q29sdW1ucygpOwoKICAgIGNv
bnN0IHBhcmFtcyA9IFsKICAgICAgbWUsCiAgICAgIG90aGVyCiAgICBdOwoKICAgIGxldCBjdXJzb3JTcWwgPSAiIjsKICAgIGxldCBvcmRlclNxbCA9ICJE
RVNDIjsKCiAgICBpZiAoYmVmb3JlKSB7CiAgICAgIHBhcmFtcy5wdXNoKGJlZm9yZSk7CiAgICAgIGN1cnNvclNxbCA9CiAgICAgICAgIiBBTkQgZG0uY3Jl
YXRlZF9hdCA8ICQzICI7CiAgICB9IGVsc2UgaWYgKGFmdGVyKSB7CiAgICAgIHBhcmFtcy5wdXNoKGFmdGVyKTsKICAgICAgY3Vyc29yU3FsID0KICAgICAg
ICAiIEFORCBkbS5jcmVhdGVkX2F0ID4gJDMgIjsKICAgICAgb3JkZXJTcWwgPSAiQVNDIjsKICAgIH0KCiAgICBjb25zdCByZXN1bHQgPQogICAgICBhd2Fp
dCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgIiArCiAgICAgICAgImRtLmlkLCBkbS5zZW5kZXJfaWQsIGRtLnJlY2lwaWVudF9pZCwgZG0u
Ym9keSwgZG0ucmVwbHlfdG9faWQsIGRtLmNyZWF0ZWRfYXQsIGRtLmVkaXRlZF9hdCwgZG0ucmVhZF9hdCwgIiArCiAgICAgICAgIihTRUxFQ1QgaS5pZCBG
Uk9NIHBlb3BsZV9tZXNzYWdlX2ltYWdlcyBpICIgKwogICAgICAgICJXSEVSRSBpLmRtX21lc3NhZ2VfaWQgPSBkbS5pZCBMSU1JVCAxKSBBUyBpbWFnZV9p
ZCwgIiArCiAgICAgICAgInJhLnVzZXJuYW1lIEFTIHJlcGx5X3NlbmRlcl91c2VybmFtZSwgIiArCiAgICAgICAgInJkbS5ib2R5IEFTIHJlcGx5X2JvZHks
ICIgKwogICAgICAgICIoU0VMRUNUIHJpLmlkIEZST00gcGVvcGxlX21lc3NhZ2VfaW1hZ2VzIHJpICIgKwogICAgICAgICJXSEVSRSByaS5kbV9tZXNzYWdl
X2lkID0gcmRtLmlkIExJTUlUIDEpIEFTIHJlcGx5X2ltYWdlX2lkICIgKwogICAgICAgICJGUk9NIHBlb3BsZV9kaXJlY3RfbWVzc2FnZXMgZG0gIiArCiAg
ICAgICAgIkxFRlQgSk9JTiBwZW9wbGVfZGlyZWN0X21lc3NhZ2VzIHJkbSAiICsKICAgICAgICAiT04gcmRtLmlkID0gZG0ucmVwbHlfdG9faWQgIiArCiAg
ICAgICAgIkxFRlQgSk9JTiBwZW9wbGVfYWNjb3VudHMgcmEgIiArCiAgICAgICAgIk9OIHJhLmlkID0gcmRtLnNlbmRlcl9pZCAiICsKICAgICAgICAiV0hF
UkUgKChkbS5zZW5kZXJfaWQgPSAkMSBBTkQgZG0ucmVjaXBpZW50X2lkID0gJDIpICIgKwogICAgICAgICJPUiAoZG0uc2VuZGVyX2lkID0gJDIgQU5EIGRt
LnJlY2lwaWVudF9pZCA9ICQxKSkgIiArCiAgICAgICAgY3Vyc29yU3FsICsKICAgICAgICAiT1JERVIgQlkgZG0uY3JlYXRlZF9hdCAiICsKICAgICAgICBv
cmRlclNxbCArCiAgICAgICAgIiBMSU1JVCAiICsKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBQRU9QTEVfRE1fSElTVE9SWV9QQUdFX1NJWkUgKwogICAg
ICAgICAgMQogICAgICAgICksCiAgICAgICAgcGFyYW1zCiAgICAgICk7CgogICAgY29uc3QgaGFzTW9yZSA9CiAgICAgIHJlc3VsdC5yb3dzLmxlbmd0aCA+
CiAgICAgIFBFT1BMRV9ETV9ISVNUT1JZX1BBR0VfU0laRTsKCiAgICBsZXQgcm93cyA9CiAgICAgIHJlc3VsdC5yb3dzLnNsaWNlKAogICAgICAgIDAsCiAg
ICAgICAgUEVPUExFX0RNX0hJU1RPUllfUEFHRV9TSVpFCiAgICAgICk7CgogICAgaWYgKAogICAgICBvcmRlclNxbCA9PT0gIkRFU0MiCiAgICApIHsKICAg
ICAgcm93cyA9CiAgICAgICAgcm93cy5yZXZlcnNlKCk7CiAgICB9CgogICAgcmV0dXJuIHsKICAgICAgbWVzc2FnZXM6CiAgICAgICAgcm93cy5tYXAoCiAg
ICAgICAgICAocm93KSA9PiAoewogICAgICAgICAgICAuLi5yb3csCiAgICAgICAgICAgIGJvZHk6CiAgICAgICAgICAgICAgcGVvcGxlRGVjcnlwdE1lc3Nh
Z2VUZXh0KAogICAgICAgICAgICAgICAgcm93LmJvZHkKICAgICAgICAgICAgICApLAogICAgICAgICAgICByZXBseV9ib2R5OgogICAgICAgICAgICAgIHJv
dy5yZXBseV9ib2R5ID09PQogICAgICAgICAgICAgICAgbnVsbCB8fAogICAgICAgICAgICAgIHJvdy5yZXBseV9ib2R5ID09PQogICAgICAgICAgICAgICAg
dW5kZWZpbmVkCiAgICAgICAgICAgICAgICA/IHJvdy5yZXBseV9ib2R5CiAgICAgICAgICAgICAgICA6IHBlb3BsZURlY3J5cHRNZXNzYWdlVGV4dCgKICAg
ICAgICAgICAgICAgICAgICByb3cucmVwbHlfYm9keQogICAgICAgICAgICAgICAgICApCiAgICAgICAgICB9KQogICAgICAgICksCiAgICAgIGhhc01vcmUs
CiAgICAgIGRpcmVjdGlvbgogICAgfTsKICB9CgogIGNvbnN0IGFsbCA9CiAgICBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKQogICAgICAuZG1zOwoKICBjb25z
dCBieUlkID0KICAgIG5ldyBNYXAoCiAgICAgIGFsbC5tYXAoCiAgICAgICAgKG1lc3NhZ2UpID0+IFsKICAgICAgICAgIFN0cmluZyhtZXNzYWdlLmlkKSwK
ICAgICAgICAgIG1lc3NhZ2UKICAgICAgICBdCiAgICAgICkKICAgICk7CgogIGNvbnN0IGJlZm9yZVRpbWUgPQogICAgYmVmb3JlCiAgICAgID8gbmV3IERh
dGUoYmVmb3JlKS5nZXRUaW1lKCkKICAgICAgOiBudWxsOwoKICBjb25zdCBhZnRlclRpbWUgPQogICAgYWZ0ZXIKICAgICAgPyBuZXcgRGF0ZShhZnRlciku
Z2V0VGltZSgpCiAgICAgIDogbnVsbDsKCiAgbGV0IGZpbHRlcmVkID0KICAgIGFsbAogICAgICAuZmlsdGVyKAogICAgICAgIChtZXNzYWdlKSA9PiB7CiAg
ICAgICAgICBjb25zdCBpbkNvbnZlcnNhdGlvbiA9CiAgICAgICAgICAgICgKICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICBtZXNzYWdl
LnNlbmRlcl9pZAogICAgICAgICAgICAgICkgPT09IG1lICYmCiAgICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAgICAgbWVzc2FnZS5yZWNpcGll
bnRfaWQKICAgICAgICAgICAgICApID09PSBvdGhlcgogICAgICAgICAgICApIHx8CiAgICAgICAgICAgICgKICAgICAgICAgICAgICBTdHJpbmcoCiAgICAg
ICAgICAgICAgICBtZXNzYWdlLnNlbmRlcl9pZAogICAgICAgICAgICAgICkgPT09IG90aGVyICYmCiAgICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAg
ICAgICAgbWVzc2FnZS5yZWNpcGllbnRfaWQKICAgICAgICAgICAgICApID09PSBtZQogICAgICAgICAgICApOwoKICAgICAgICAgIGlmICghaW5Db252ZXJz
YXRpb24pIHsKICAgICAgICAgICAgcmV0dXJuIGZhbHNlOwogICAgICAgICAgfQoKICAgICAgICAgIGNvbnN0IHRpbWUgPQogICAgICAgICAgICBuZXcgRGF0
ZSgKICAgICAgICAgICAgICBtZXNzYWdlLmNyZWF0ZWRfYXQKICAgICAgICAgICAgKS5nZXRUaW1lKCk7CgogICAgICAgICAgaWYgKAogICAgICAgICAgICBi
ZWZvcmVUaW1lICE9PSBudWxsICYmCiAgICAgICAgICAgICEodGltZSA8IGJlZm9yZVRpbWUpCiAgICAgICAgICApIHsKICAgICAgICAgICAgcmV0dXJuIGZh
bHNlOwogICAgICAgICAgfQoKICAgICAgICAgIGlmICgKICAgICAgICAgICAgYWZ0ZXJUaW1lICE9PSBudWxsICYmCiAgICAgICAgICAgICEodGltZSA+IGFm
dGVyVGltZSkKICAgICAgICAgICkgewogICAgICAgICAgICByZXR1cm4gZmFsc2U7CiAgICAgICAgICB9CgogICAgICAgICAgcmV0dXJuIHRydWU7CiAgICAg
ICAgfQogICAgICApCiAgICAgIC5zb3J0KAogICAgICAgIChhLCBiKSA9PiB7CiAgICAgICAgICBjb25zdCBsZWZ0ID0KICAgICAgICAgICAgbmV3IERhdGUo
CiAgICAgICAgICAgICAgYS5jcmVhdGVkX2F0CiAgICAgICAgICAgICkuZ2V0VGltZSgpOwoKICAgICAgICAgIGNvbnN0IHJpZ2h0ID0KICAgICAgICAgICAg
bmV3IERhdGUoCiAgICAgICAgICAgICAgYi5jcmVhdGVkX2F0CiAgICAgICAgICAgICkuZ2V0VGltZSgpOwoKICAgICAgICAgIHJldHVybiBhZnRlcgogICAg
ICAgICAgICA/IGxlZnQgLSByaWdodAogICAgICAgICAgICA6IHJpZ2h0IC0gbGVmdDsKICAgICAgICB9CiAgICAgICk7CgogIGNvbnN0IGhhc01vcmUgPQog
ICAgZmlsdGVyZWQubGVuZ3RoID4KICAgIFBFT1BMRV9ETV9ISVNUT1JZX1BBR0VfU0laRTsKCiAgZmlsdGVyZWQgPQogICAgZmlsdGVyZWQuc2xpY2UoCiAg
ICAgIDAsCiAgICAgIFBFT1BMRV9ETV9ISVNUT1JZX1BBR0VfU0laRQogICAgKTsKCiAgaWYgKCFhZnRlcikgewogICAgZmlsdGVyZWQucmV2ZXJzZSgpOwog
IH0KCiAgLyoKICAgIE9uIGNsb25lIGxlcyBsaWduZXMgbG9jYWxlcyBhdmFudCBkJ2Fqb3V0ZXIgbGVzIGluZm9zIGRlIHLDqXBvbnNlLgogICAgw4dhIMOp
dml0ZSBkZSBtb2RpZmllciBwZW9wbGUtc29jaWFsLmxvY2FsLmpzb24ganVzdGUgcGFyY2UgcXUnb24gYSBsdQogICAgdW5lIHBhZ2UgZCdoaXN0b3JpcXVl
LgogICovCiAgZmlsdGVyZWQgPQogICAgZmlsdGVyZWQubWFwKAogICAgICAobWVzc2FnZSkgPT4gKHsKICAgICAgICAuLi5tZXNzYWdlCiAgICAgIH0pCiAg
ICApOwoKICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgZmlsdGVyZWQpIHsKICAgIGNvbnN0IHJlcGx5SWQgPQogICAgICBwZW9wbGVSZXBseUlkKAogICAgICAg
IG1lc3NhZ2UucmVwbHlfdG9faWQKICAgICAgKTsKCiAgICBjb25zdCByZXBseSA9CiAgICAgIHJlcGx5SWQKICAgICAgICA/IGJ5SWQuZ2V0KHJlcGx5SWQp
CiAgICAgICAgOiBudWxsOwoKICAgIGlmIChyZXBseUlkICYmIHJlcGx5KSB7CiAgICAgIGNvbnN0IHNlbmRlciA9CiAgICAgICAgYXdhaXQgcGVvcGxlRmlu
ZEFjY291bnRCeUlkKAogICAgICAgICAgcmVwbHkuc2VuZGVyX2lkCiAgICAgICAgKTsKCiAgICAgIG1lc3NhZ2UucmVwbHlfc2VuZGVyX3VzZXJuYW1lID0K
ICAgICAgICBzZW5kZXI/LnVzZXJuYW1lIHx8CiAgICAgICAgIlV0aWxpc2F0ZXVyIjsKCiAgICAgIG1lc3NhZ2UucmVwbHlfYm9keSA9CiAgICAgICAgcmVw
bHkuYm9keSB8fCAiIjsKCiAgICAgIG1lc3NhZ2UucmVwbHlfaW1hZ2VfaWQgPQogICAgICAgIHJlcGx5LmltYWdlX2lkIHx8IG51bGw7CiAgICB9IGVsc2Ug
ewogICAgICBtZXNzYWdlLnJlcGx5X3NlbmRlcl91c2VybmFtZSA9CiAgICAgICAgbnVsbDsKCiAgICAgIG1lc3NhZ2UucmVwbHlfYm9keSA9CiAgICAgICAg
bnVsbDsKCiAgICAgIG1lc3NhZ2UucmVwbHlfaW1hZ2VfaWQgPQogICAgICAgIG51bGw7CiAgICB9CiAgfQoKICByZXR1cm4gewogICAgbWVzc2FnZXM6CiAg
ICAgIGZpbHRlcmVkLAogICAgaGFzTW9yZSwKICAgIGRpcmVjdGlvbgogIH07Cn0KLy8gPT09IFBFT1BMRV9ETV9QQUdJTkFUSU9OX1YxX0VORCA9PT0KCmFz
eW5jIGZ1bmN0aW9uIHBlb3BsZU1hcmtEbVJlYWQoYWNjb3VudElkLCBvdGhlcklkKSB7CiAgY29uc3QgbWUgPSBTdHJpbmcoYWNjb3VudElkKTsKICBjb25z
dCBvdGhlciA9IFN0cmluZyhvdGhlcklkKTsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJVUERBVEUg
cGVvcGxlX2RpcmVjdF9tZXNzYWdlcyBTRVQgcmVhZF9hdCA9IE5PVygpICIgKwogICAgICAiV0hFUkUgcmVjaXBpZW50X2lkID0gJDEgQU5EIHNlbmRlcl9p
ZCA9ICQyIEFORCByZWFkX2F0IElTIE5VTEwiLAogICAgICBbbWUsIG90aGVyXQogICAgKTsKICAgIHJldHVybjsKICB9CgogIGNvbnN0IGRhdGEgPSBwZW9w
bGVSZWFkTG9jYWxTb2NpYWwoKTsKICBsZXQgY2hhbmdlZCA9IGZhbHNlOwoKICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgZGF0YS5kbXMpIHsKICAgIGlmICgK
ICAgICAgU3RyaW5nKG1lc3NhZ2UucmVjaXBpZW50X2lkKSA9PT0gbWUgJiYKICAgICAgU3RyaW5nKG1lc3NhZ2Uuc2VuZGVyX2lkKSA9PT0gb3RoZXIgJiYK
ICAgICAgIW1lc3NhZ2UucmVhZF9hdAogICAgKSB7CiAgICAgIG1lc3NhZ2UucmVhZF9hdCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTsKICAgICAgY2hh
bmdlZCA9IHRydWU7CiAgICB9CiAgfQoKICBpZiAoY2hhbmdlZCkgcGVvcGxlV3JpdGVMb2NhbFNvY2lhbChkYXRhKTsKfQoKLy8gPT09IFBFT1BMRV9ETV9D
TE9TRV9WMV9TVEFSVCA9PT0KYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1DbG9zZWRJZHMoCiAgYWNjb3VudElkCikgewogIGNvbnN0IG1lID0KICAgIFN0cmlu
ZygKICAgICAgYWNjb3VudElkCiAgICApOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0KICAgICAgYXdhaXQgcGVvcGxlUG9vbC5x
dWVyeSgKICAgICAgICAiU0VMRUNUIG90aGVyX2lkIEZST00gcGVvcGxlX2Nsb3NlZF9kbXMgV0hFUkUgdXNlcl9pZCA9ICQxIiwKICAgICAgICBbCiAgICAg
ICAgICBtZQogICAgICAgIF0KICAgICAgKTsKCiAgICByZXR1cm4gbmV3IFNldCgKICAgICAgcmVzdWx0LnJvd3MubWFwKAogICAgICAgIChyb3cpID0+CiAg
ICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIHJvdy5vdGhlcl9pZAogICAgICAgICAgKQogICAgICApCiAgICApOwogIH0KCiAgY29uc3QgZGF0YSA9CiAg
ICBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKTsKCiAgcmV0dXJuIG5ldyBTZXQoCiAgICAoCiAgICAgIEFycmF5LmlzQXJyYXkoCiAgICAgICAgZGF0YS5jbG9z
ZWRfZG1zCiAgICAgICkKICAgICAgICA/IGRhdGEuY2xvc2VkX2RtcwogICAgICAgIDogW10KICAgICkKICAgICAgLmZpbHRlcigKICAgICAgICAoaXRlbSkg
PT4KICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgaXRlbS51c2VyX2lkCiAgICAgICAgICApID09PSBtZQogICAgICApCiAgICAgIC5tYXAoCiAgICAg
ICAgKGl0ZW0pID0+CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIGl0ZW0ub3RoZXJfaWQKICAgICAgICAgICkKICAgICAgKQogICk7Cn0KCmFzeW5j
IGZ1bmN0aW9uIHBlb3BsZVNldERtQ2xvc2VkKAogIGFjY291bnRJZCwKICBvdGhlcklkLAogIGNsb3NlZAopIHsKICBjb25zdCBtZSA9CiAgICBTdHJpbmco
CiAgICAgIGFjY291bnRJZAogICAgKTsKCiAgY29uc3Qgb3RoZXIgPQogICAgU3RyaW5nKAogICAgICBvdGhlcklkCiAgICApOwoKICBpZiAoCiAgICAhbWUg
fHwKICAgICFvdGhlciB8fAogICAgbWUgPT09IG90aGVyCiAgKSB7CiAgICByZXR1cm47CiAgfQoKICBpZiAocGVvcGxlUG9vbCkgewogICAgaWYgKGNsb3Nl
ZCkgewogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJJTlNFUlQgSU5UTyBwZW9wbGVfY2xvc2VkX2RtcyAodXNlcl9pZCwgb3RoZXJf
aWQpICIgKwogICAgICAgICJWQUxVRVMgKCQxLCAkMikgIiArCiAgICAgICAgIk9OIENPTkZMSUNUICh1c2VyX2lkLCBvdGhlcl9pZCkgIiArCiAgICAgICAg
IkRPIFVQREFURSBTRVQgY2xvc2VkX2F0ID0gTk9XKCkiLAogICAgICAgIFsKICAgICAgICAgIG1lLAogICAgICAgICAgb3RoZXIKICAgICAgICBdCiAgICAg
ICk7CiAgICB9IGVsc2UgewogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJERUxFVEUgRlJPTSBwZW9wbGVfY2xvc2VkX2RtcyAiICsK
ICAgICAgICAiV0hFUkUgdXNlcl9pZCA9ICQxIEFORCBvdGhlcl9pZCA9ICQyIiwKICAgICAgICBbCiAgICAgICAgICBtZSwKICAgICAgICAgIG90aGVyCiAg
ICAgICAgXQogICAgICApOwogICAgfQoKICAgIHJldHVybjsKICB9CgogIGNvbnN0IGRhdGEgPQogICAgcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CgogIGNv
bnN0IGxpc3QgPQogICAgQXJyYXkuaXNBcnJheSgKICAgICAgZGF0YS5jbG9zZWRfZG1zCiAgICApCiAgICAgID8gZGF0YS5jbG9zZWRfZG1zCiAgICAgIDog
W107CgogIGRhdGEuY2xvc2VkX2RtcyA9CiAgICBsaXN0LmZpbHRlcigKICAgICAgKGl0ZW0pID0+CiAgICAgICAgISgKICAgICAgICAgIFN0cmluZygKICAg
ICAgICAgICAgaXRlbS51c2VyX2lkCiAgICAgICAgICApID09PSBtZSAmJgogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBpdGVtLm90aGVyX2lkCiAg
ICAgICAgICApID09PSBvdGhlcgogICAgICAgICkKICAgICk7CgogIGlmIChjbG9zZWQpIHsKICAgIGRhdGEuY2xvc2VkX2Rtcy5wdXNoKHsKICAgICAgdXNl
cl9pZDoKICAgICAgICBtZSwKICAgICAgb3RoZXJfaWQ6CiAgICAgICAgb3RoZXIsCiAgICAgIGNsb3NlZF9hdDoKICAgICAgICBuZXcgRGF0ZSgpCiAgICAg
ICAgICAudG9JU09TdHJpbmcoKQogICAgfSk7CiAgfQoKICBwZW9wbGVXcml0ZUxvY2FsU29jaWFsKAogICAgZGF0YQogICk7Cn0KLy8gPT09IFBFT1BMRV9E
TV9DTE9TRV9WMV9FTkQgPT09Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVEbUNvbnZlcnNhdGlvbnMoYWNjb3VudElkKSB7CiAgY29uc3QgbWUgPQogICAgU3Ry
aW5nKGFjY291bnRJZCk7CgogIGNvbnN0IGNsb3NlZElkcyA9CiAgICBhd2FpdCBwZW9wbGVEbUNsb3NlZElkcygKICAgICAgbWUKICAgICk7CgogIGxldCBt
ZXNzYWdlczsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIlNF
TEVDVCAiICsKICAgICAgICAiZG0uaWQsIGRtLnNlbmRlcl9pZCwgZG0ucmVjaXBpZW50X2lkLCBkbS5ib2R5LCBkbS5jcmVhdGVkX2F0LCBkbS5yZWFkX2F0
LCAiICsKICAgICAgICAiKFNFTEVDVCBpLmlkIEZST00gcGVvcGxlX21lc3NhZ2VfaW1hZ2VzIGkgIiArCiAgICAgICAgIldIRVJFIGkuZG1fbWVzc2FnZV9p
ZCA9IGRtLmlkIExJTUlUIDEpIEFTIGltYWdlX2lkICIgKwogICAgICAgICJGUk9NIHBlb3BsZV9kaXJlY3RfbWVzc2FnZXMgZG0gIiArCiAgICAgICAgIldI
RVJFIGRtLnNlbmRlcl9pZCA9ICQxIE9SIGRtLnJlY2lwaWVudF9pZCA9ICQxICIgKwogICAgICAgICJPUkRFUiBCWSBkbS5jcmVhdGVkX2F0IERFU0MgTElN
SVQgMTAwMCIsCiAgICAgICAgW21lXQogICAgICApOwoKICAgIG1lc3NhZ2VzID0KICAgICAgcmVzdWx0LnJvd3M7CiAgfSBlbHNlIHsKICAgIG1lc3NhZ2Vz
ID0KICAgICAgcGVvcGxlUmVhZExvY2FsU29jaWFsKCkKICAgICAgICAuZG1zCiAgICAgICAgLmZpbHRlcigKICAgICAgICAgIChtZXNzYWdlKSA9PgogICAg
ICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgbWVzc2FnZS5zZW5kZXJfaWQKICAgICAgICAgICAgKSA9PT0gbWUgfHwKICAgICAgICAgICAgU3RyaW5n
KAogICAgICAgICAgICAgIG1lc3NhZ2UucmVjaXBpZW50X2lkCiAgICAgICAgICAgICkgPT09IG1lCiAgICAgICAgKQogICAgICAgIC5zb3J0KAogICAgICAg
ICAgKGEsIGIpID0+CiAgICAgICAgICAgIG5ldyBEYXRlKAogICAgICAgICAgICAgIGIuY3JlYXRlZF9hdAogICAgICAgICAgICApLmdldFRpbWUoKSAtCiAg
ICAgICAgICAgIG5ldyBEYXRlKAogICAgICAgICAgICAgIGEuY3JlYXRlZF9hdAogICAgICAgICAgICApLmdldFRpbWUoKQogICAgICAgICkKICAgICAgICAu
c2xpY2UoMCwgMTAwMCk7CiAgfQoKICBjb25zdCBtYXAgPQogICAgbmV3IE1hcCgpOwoKICBmb3IgKAogICAgY29uc3QgbWVzc2FnZSBvZiBtZXNzYWdlcwog
ICkgewogICAgY29uc3Qgb3RoZXJJZCA9CiAgICAgIFN0cmluZygKICAgICAgICBtZXNzYWdlLnNlbmRlcl9pZAogICAgICApID09PSBtZQogICAgICAgID8g
U3RyaW5nKAogICAgICAgICAgICBtZXNzYWdlLnJlY2lwaWVudF9pZAogICAgICAgICAgKQogICAgICAgIDogU3RyaW5nKAogICAgICAgICAgICBtZXNzYWdl
LnNlbmRlcl9pZAogICAgICAgICAgKTsKCiAgICBpZiAoCiAgICAgIGNsb3NlZElkcy5oYXMoCiAgICAgICAgb3RoZXJJZAogICAgICApCiAgICApIHsKICAg
ICAgY29udGludWU7CiAgICB9CgogICAgaWYgKAogICAgICAhbWFwLmhhcyhvdGhlcklkKQogICAgKSB7CiAgICAgIG1hcC5zZXQoCiAgICAgICAgb3RoZXJJ
ZCwKICAgICAgICB7CiAgICAgICAgICBvdGhlcklkLAogICAgICAgICAgbGFzdE1lc3NhZ2U6CiAgICAgICAgICAgIHBlb3BsZURtQ2FsbENvbnZlcnNhdGlv
blByZXZpZXcoCiAgICAgICAgICAgICAgbWVzc2FnZS5ib2R5LAogICAgICAgICAgICAgIG1lc3NhZ2UuaW1hZ2VfaWQKICAgICAgICAgICAgKSwKICAgICAg
ICAgIGxhc3RNZXNzYWdlRTJlZToKICAgICAgICAgICAgcGVvcGxlRG1FMmVlSXNFbnZlbG9wZSgKICAgICAgICAgICAgICBtZXNzYWdlLmJvZHkKICAgICAg
ICAgICAgKQogICAgICAgICAgICAgID8gbWVzc2FnZS5ib2R5CiAgICAgICAgICAgICAgOiBudWxsLAogICAgICAgICAgbGFzdEF0OgogICAgICAgICAgICBt
ZXNzYWdlLmNyZWF0ZWRfYXQsCiAgICAgICAgICB1bnJlYWRDb3VudDoKICAgICAgICAgICAgMAogICAgICAgIH0KICAgICAgKTsKICAgIH0KCiAgICBpZiAo
CiAgICAgIFN0cmluZygKICAgICAgICBtZXNzYWdlLnJlY2lwaWVudF9pZAogICAgICApID09PSBtZSAmJgogICAgICAhbWVzc2FnZS5yZWFkX2F0CiAgICAp
IHsKICAgICAgbWFwLmdldCgKICAgICAgICBvdGhlcklkCiAgICAgICkudW5yZWFkQ291bnQgKz0gMTsKICAgIH0KICB9CgogIGNvbnN0IG91dCA9IFtdOwog
IGNvbnN0IGNvbnZlcnNhdGlvbkl0ZW1zID0gWwogICAgLi4ubWFwLnZhbHVlcygpCiAgXTsKICBjb25zdCBhY2NvdW50cyA9IGF3YWl0IHBlb3BsZUZpbmRB
Y2NvdW50c0J5SWRzKAogICAgY29udmVyc2F0aW9uSXRlbXMubWFwKAogICAgICAoaXRlbSkgPT4gaXRlbS5vdGhlcklkCiAgICApCiAgKTsKICBjb25zdCBh
Y2NvdW50c0J5SWQgPSBuZXcgTWFwKAogICAgYWNjb3VudHMubWFwKChhY2NvdW50KSA9PiBbCiAgICAgIFN0cmluZyhhY2NvdW50LmlkKSwKICAgICAgYWNj
b3VudAogICAgXSkKICApOwoKICBmb3IgKAogICAgY29uc3QgaXRlbSBvZiBjb252ZXJzYXRpb25JdGVtcwogICkgewogICAgY29uc3QgYWNjb3VudCA9CiAg
ICAgIGFjY291bnRzQnlJZC5nZXQoCiAgICAgICAgU3RyaW5nKGl0ZW0ub3RoZXJJZCkKICAgICAgKTsKCiAgICBpZiAoIWFjY291bnQpIHsKICAgICAgY29u
dGludWU7CiAgICB9CgogICAgb3V0LnB1c2goewogICAgICB1c2VyOiB7CiAgICAgICAgLi4ucGVvcGxlUHVibGljQWNjb3VudCgKICAgICAgICAgIGFjY291
bnQKICAgICAgICApLAogICAgICAgIG9ubGluZToKICAgICAgICAgIHBlb3BsZUFjY291bnRJc09ubGluZSgKICAgICAgICAgICAgYWNjb3VudC5pZAogICAg
ICAgICAgKQogICAgICB9LAogICAgICBsYXN0TWVzc2FnZToKICAgICAgICBpdGVtLmxhc3RNZXNzYWdlLAogICAgICBsYXN0TWVzc2FnZUUyZWU6CiAgICAg
ICAgaXRlbS5sYXN0TWVzc2FnZUUyZWUgfHwKICAgICAgICBudWxsLAogICAgICBsYXN0QXQ6CiAgICAgICAgaXRlbS5sYXN0QXQsCiAgICAgIHVucmVhZENv
dW50OgogICAgICAgIGl0ZW0udW5yZWFkQ291bnQKICAgIH0pOwogIH0KCiAgb3V0LnNvcnQoCiAgICAoYSwgYikgPT4KICAgICAgbmV3IERhdGUoCiAgICAg
ICAgYi5sYXN0QXQKICAgICAgKS5nZXRUaW1lKCkgLQogICAgICBuZXcgRGF0ZSgKICAgICAgICBhLmxhc3RBdAogICAgICApLmdldFRpbWUoKQogICk7Cgog
IHJldHVybiBvdXQ7Cn0KCi8vID09PSBQRU9QTEVfR0VORVJBTF9ISVNUT1JZX1YxX1NUQVJUID09PQpjb25zdCBQRU9QTEVfTE9DQUxfR0VORVJBTCA9CiAg
cGF0aEFjY291bnRzLmpvaW4oCiAgICBfX2Rpcm5hbWUsCiAgICAicGVvcGxlLWdlbmVyYWwubG9jYWwuanNvbiIKICApOwoKZnVuY3Rpb24gcGVvcGxlUmVh
ZExvY2FsR2VuZXJhbCgpIHsKICB0cnkgewogICAgaWYgKCFmc0FjY291bnRzLmV4aXN0c1N5bmMoUEVPUExFX0xPQ0FMX0dFTkVSQUwpKSB7CiAgICAgIHJl
dHVybiBbXTsKICAgIH0KCiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZSgKICAgICAgZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoCiAgICAgICAgUEVPUExF
X0xPQ0FMX0dFTkVSQUwsCiAgICAgICAgInV0ZjgiCiAgICAgICkKICAgICk7CgogICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoZGF0YSkKICAgICAgPyBkYXRh
Lm1hcCgKICAgICAgICAgIChtZXNzYWdlKSA9PiAoewogICAgICAgICAgICAuLi5tZXNzYWdlLAogICAgICAgICAgICB0ZXh0OgogICAgICAgICAgICAgIHBl
b3BsZURlY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgICAgICAgIG1lc3NhZ2U/LnRleHQKICAgICAgICAgICAgICApCiAgICAgICAgICB9KQogICAgICAg
ICkKICAgICAgOiBbXTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGlmICgKICAgICAgZXJyPy5jb2RlID09PQogICAgICAgICJQRU9QTEVfTUVTU0FHRV9ERUNS
WVBUX0ZBSUxFRCIKICAgICkgewogICAgICB0aHJvdyBlcnI7CiAgICB9CgogICAgcmV0dXJuIFtdOwogIH0KfQoKZnVuY3Rpb24gcGVvcGxlV3JpdGVMb2Nh
bEdlbmVyYWwobWVzc2FnZXMpIHsKICBmc0FjY291bnRzLndyaXRlRmlsZVN5bmMoCiAgICBQRU9QTEVfTE9DQUxfR0VORVJBTCwKICAgIEpTT04uc3RyaW5n
aWZ5KAogICAgICBBcnJheS5pc0FycmF5KG1lc3NhZ2VzKQogICAgICAgID8gbWVzc2FnZXMKICAgICAgICAgICAgLnNsaWNlKC0xMDAwKQogICAgICAgICAg
ICAubWFwKAogICAgICAgICAgICAgIChtZXNzYWdlKSA9PiAoewogICAgICAgICAgICAgICAgLi4ubWVzc2FnZSwKICAgICAgICAgICAgICAgIHRleHQ6CiAg
ICAgICAgICAgICAgICAgIHBlb3BsZUVuY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgICAgICAgICAgICBtZXNzYWdlPy50ZXh0CiAgICAgICAgICAgICAg
ICAgICkKICAgICAgICAgICAgICB9KQogICAgICAgICAgICApCiAgICAgICAgOiBbXSwKICAgICAgbnVsbCwKICAgICAgMgogICAgKSArICJcbiIsCiAgICAi
dXRmOCIKICApOwp9CgovLyA9PT0gUEVPUExFX01FU1NBR0VfUkVQTElFU19ERUxFVEVfVjFfU1RBUlQgPT09CmxldCBwZW9wbGVSZXBseUNvbHVtbnNQcm9t
aXNlID0gbnVsbDsKCmZ1bmN0aW9uIHBlb3BsZVJlcGx5SWQodmFsdWUpIHsKICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8ICIiKQogICAgLnRyaW0oKQogICAg
LnNsaWNlKDAsIDEwMCk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUVuc3VyZVJlcGx5Q29sdW1ucygpIHsKICBpZiAoIXBlb3BsZVBvb2wpIHJldHVybjsK
CiAgaWYgKCFwZW9wbGVSZXBseUNvbHVtbnNQcm9taXNlKSB7CiAgICBwZW9wbGVSZXBseUNvbHVtbnNQcm9taXNlID0KICAgICAgUHJvbWlzZS5hbGwoWwog
ICAgICAgIHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgICAiQUxURVIgVEFCTEUgcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgIiArCiAgICAgICAgICAiQURE
IENPTFVNTiBJRiBOT1QgRVhJU1RTIHJlcGx5X3RvX2lkIEJJR0lOVCBOVUxMIgogICAgICAgICksCiAgICAgICAgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAg
ICAgICJBTFRFUiBUQUJMRSBwZW9wbGVfZGlyZWN0X21lc3NhZ2VzICIgKwogICAgICAgICAgIkFERCBDT0xVTU4gSUYgTk9UIEVYSVNUUyByZXBseV90b19p
ZCBCSUdJTlQgTlVMTCIKICAgICAgICApLAogICAgICAgIHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgICAiQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMg
cGVvcGxlX2dlbmVyYWxfcmVwbHlfaWR4ICIgKwogICAgICAgICAgIk9OIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzKHJlcGx5X3RvX2lkKSIKICAgICAgICAp
LAogICAgICAgIHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgICAiQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgcGVvcGxlX2RtX3JlcGx5X2lkeCAiICsK
ICAgICAgICAgICJPTiBwZW9wbGVfZGlyZWN0X21lc3NhZ2VzKHJlcGx5X3RvX2lkKSIKICAgICAgICApLAogICAgICAgIHBlb3BsZVBvb2wucXVlcnkoCiAg
ICAgICAgICAiQUxURVIgVEFCTEUgcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgIiArCiAgICAgICAgICAiQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTIGVkaXRl
ZF9hdCBUSU1FU1RBTVBUWiBOVUxMIgogICAgICAgICksCiAgICAgICAgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAgICJBTFRFUiBUQUJMRSBwZW9wbGVf
ZGlyZWN0X21lc3NhZ2VzICIgKwogICAgICAgICAgIkFERCBDT0xVTU4gSUYgTk9UIEVYSVNUUyBlZGl0ZWRfYXQgVElNRVNUQU1QVFogTlVMTCIKICAgICAg
ICApCiAgICAgIF0pLmNhdGNoKChlcnIpID0+IHsKICAgICAgICBwZW9wbGVSZXBseUNvbHVtbnNQcm9taXNlID0gbnVsbDsKICAgICAgICB0aHJvdyBlcnI7
CiAgICAgIH0pOwogIH0KCiAgYXdhaXQgcGVvcGxlUmVwbHlDb2x1bW5zUHJvbWlzZTsKfQoKZnVuY3Rpb24gcGVvcGxlRGVsZXRlZFJlcGx5KGlkKSB7CiAg
cmV0dXJuIHsKICAgIGlkOiBTdHJpbmcoaWQpLAogICAgdXNlcm5hbWU6ICJNZXNzYWdlIHN1cHByaW3DqSIsCiAgICB0ZXh0OiAiIiwKICAgIGltYWdlSWQ6
IG51bGwsCiAgICBkZWxldGVkOiB0cnVlCiAgfTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlR2VuZXJhbFJlcGx5UHJldmlldygKICByZXBseVRvSWQsCiAg
ZGIgPSBwZW9wbGVQb29sCikgewogIGNvbnN0IGlkID0KICAgIHBlb3BsZVJlcGx5SWQocmVwbHlUb0lkKTsKCiAgaWYgKCFpZCkgcmV0dXJuIG51bGw7Cgog
IGlmIChwZW9wbGVQb29sKSB7CiAgICBpZiAoIS9eXGQrJC8udGVzdChpZCkpIHsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgY29uc3QgcmVzdWx0
ID0KICAgICAgYXdhaXQgZGIucXVlcnkoCiAgICAgICAgIlNFTEVDVCBnbS5pZCwgZ20udXNlcm5hbWUsIGdtLmJvZHksICIgKwogICAgICAgICIoU0VMRUNU
IGkuaWQgRlJPTSBwZW9wbGVfbWVzc2FnZV9pbWFnZXMgaSAiICsKICAgICAgICAiV0hFUkUgaS5nZW5lcmFsX21lc3NhZ2VfaWQgPSBnbS5pZCBMSU1JVCAx
KSBBUyBpbWFnZV9pZCAiICsKICAgICAgICAiRlJPTSBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyBnbSAiICsKICAgICAgICAiV0hFUkUgZ20uaWQgPSAkMSBM
SU1JVCAxIiwKICAgICAgICBbaWRdCiAgICAgICk7CgogICAgY29uc3Qgcm93ID0KICAgICAgcmVzdWx0LnJvd3NbMF07CgogICAgaWYgKCFyb3cpIHJldHVy
biBudWxsOwoKICAgIHJldHVybiB7CiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSwKICAgICAgdXNlcm5hbWU6IHJvdy51c2VybmFtZSwKICAgICAgdGV4dDoK
ICAgICAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAgICAgICByb3cuYm9keQogICAgICAgICksCiAgICAgIGltYWdlSWQ6CiAgICAgICAgcm93
LmltYWdlX2lkCiAgICAgICAgICA/IFN0cmluZyhyb3cuaW1hZ2VfaWQpCiAgICAgICAgICA6IG51bGwsCiAgICAgIGRlbGV0ZWQ6IGZhbHNlCiAgICB9Owog
IH0KCiAgY29uc3QgbWVzc2FnZSA9CiAgICBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCkKICAgICAgLmZpbmQoCiAgICAgICAgKGl0ZW0pID0+CiAgICAgICAg
ICBTdHJpbmcoaXRlbS5pZCkgPT09IGlkCiAgICAgICk7CgogIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGw7CgogIHJldHVybiB7CiAgICBpZDogU3RyaW5n
KG1lc3NhZ2UuaWQpLAogICAgdXNlcm5hbWU6CiAgICAgIFN0cmluZyhtZXNzYWdlLnVzZXJuYW1lIHx8ICIiKSwKICAgIHRleHQ6CiAgICAgIFN0cmluZyht
ZXNzYWdlLnRleHQgfHwgIiIpLAogICAgaW1hZ2VJZDoKICAgICAgbWVzc2FnZS5pbWFnZUlkCiAgICAgICAgPyBTdHJpbmcobWVzc2FnZS5pbWFnZUlkKQog
ICAgICAgIDogbnVsbCwKICAgIGRlbGV0ZWQ6IGZhbHNlCiAgfTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1SZXBseVByZXZpZXcoCiAgYWNjb3VudEEs
CiAgYWNjb3VudEIsCiAgcmVwbHlUb0lkLAogIGRiID0gcGVvcGxlUG9vbAopIHsKICBjb25zdCBtZSA9CiAgICBTdHJpbmcoYWNjb3VudEEpOwoKICBjb25z
dCBvdGhlciA9CiAgICBTdHJpbmcoYWNjb3VudEIpOwoKICBjb25zdCBpZCA9CiAgICBwZW9wbGVSZXBseUlkKHJlcGx5VG9JZCk7CgogIGlmICghaWQpIHJl
dHVybiBudWxsOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgaWYgKCEvXlxkKyQvLnRlc3QoaWQpKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAg
IGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IGRiLnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgZG0uaWQsIGRtLnNlbmRlcl9pZCwgZG0uYm9keSwgIiArCiAg
ICAgICAgImEudXNlcm5hbWUgQVMgc2VuZGVyX3VzZXJuYW1lLCAiICsKICAgICAgICAiKFNFTEVDVCBpLmlkIEZST00gcGVvcGxlX21lc3NhZ2VfaW1hZ2Vz
IGkgIiArCiAgICAgICAgIldIRVJFIGkuZG1fbWVzc2FnZV9pZCA9IGRtLmlkIExJTUlUIDEpIEFTIGltYWdlX2lkICIgKwogICAgICAgICJGUk9NIHBlb3Bs
ZV9kaXJlY3RfbWVzc2FnZXMgZG0gIiArCiAgICAgICAgIkxFRlQgSk9JTiBwZW9wbGVfYWNjb3VudHMgYSBPTiBhLmlkID0gZG0uc2VuZGVyX2lkICIgKwog
ICAgICAgICJXSEVSRSBkbS5pZCA9ICQzIEFORCAoIiArCiAgICAgICAgIihkbS5zZW5kZXJfaWQgPSAkMSBBTkQgZG0ucmVjaXBpZW50X2lkID0gJDIpIE9S
ICIgKwogICAgICAgICIoZG0uc2VuZGVyX2lkID0gJDIgQU5EIGRtLnJlY2lwaWVudF9pZCA9ICQxKSIgKwogICAgICAgICIpIExJTUlUIDEiLAogICAgICAg
IFttZSwgb3RoZXIsIGlkXQogICAgICApOwoKICAgIGNvbnN0IHJvdyA9CiAgICAgIHJlc3VsdC5yb3dzWzBdOwoKICAgIGlmICghcm93KSByZXR1cm4gbnVs
bDsKCiAgICByZXR1cm4gewogICAgICBpZDogU3RyaW5nKHJvdy5pZCksCiAgICAgIHVzZXJuYW1lOgogICAgICAgIHJvdy5zZW5kZXJfdXNlcm5hbWUgfHwK
ICAgICAgICAiVXRpbGlzYXRldXIiLAogICAgICB0ZXh0OgogICAgICAgIHBlb3BsZURlY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgIHJvdy5ib2R5CiAg
ICAgICAgKSwKICAgICAgaW1hZ2VJZDoKICAgICAgICByb3cuaW1hZ2VfaWQKICAgICAgICAgID8gU3RyaW5nKHJvdy5pbWFnZV9pZCkKICAgICAgICAgIDog
bnVsbCwKICAgICAgZGVsZXRlZDogZmFsc2UKICAgIH07CiAgfQoKICBjb25zdCBtZXNzYWdlID0KICAgIHBlb3BsZVJlYWRMb2NhbFNvY2lhbCgpCiAgICAg
IC5kbXMKICAgICAgLmZpbmQoCiAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICBTdHJpbmcoaXRlbS5pZCkgPT09IGlkICYmCiAgICAgICAgICAoCiAgICAg
ICAgICAgICgKICAgICAgICAgICAgICBTdHJpbmcoaXRlbS5zZW5kZXJfaWQpID09PSBtZSAmJgogICAgICAgICAgICAgIFN0cmluZyhpdGVtLnJlY2lwaWVu
dF9pZCkgPT09IG90aGVyCiAgICAgICAgICAgICkgfHwKICAgICAgICAgICAgKAogICAgICAgICAgICAgIFN0cmluZyhpdGVtLnNlbmRlcl9pZCkgPT09IG90
aGVyICYmCiAgICAgICAgICAgICAgU3RyaW5nKGl0ZW0ucmVjaXBpZW50X2lkKSA9PT0gbWUKICAgICAgICAgICAgKQogICAgICAgICAgKQogICAgICApOwoK
ICBpZiAoIW1lc3NhZ2UpIHJldHVybiBudWxsOwoKICBjb25zdCBzZW5kZXIgPQogICAgYXdhaXQgcGVvcGxlRmluZEFjY291bnRCeUlkKAogICAgICBtZXNz
YWdlLnNlbmRlcl9pZAogICAgKTsKCiAgcmV0dXJuIHsKICAgIGlkOiBTdHJpbmcobWVzc2FnZS5pZCksCiAgICB1c2VybmFtZToKICAgICAgc2VuZGVyPy51
c2VybmFtZSB8fAogICAgICAiVXRpbGlzYXRldXIiLAogICAgdGV4dDoKICAgICAgU3RyaW5nKG1lc3NhZ2UuYm9keSB8fCAiIiksCiAgICBpbWFnZUlkOgog
ICAgICBtZXNzYWdlLmltYWdlX2lkCiAgICAgICAgPyBTdHJpbmcobWVzc2FnZS5pbWFnZV9pZCkKICAgICAgICA6IG51bGwsCiAgICBkZWxldGVkOiBmYWxz
ZQogIH07Cn0KCmZ1bmN0aW9uIHBlb3BsZURlbGV0ZUxvY2FsQm91bmRNZXNzYWdlSW1hZ2UoCiAgc2NvcGUsCiAgbWVzc2FnZUlkCikgewogIGlmIChwZW9w
bGVQb29sKSByZXR1cm47CgogIGNvbnN0IHdhbnRlZFNjb3BlID0KICAgIFN0cmluZyhzY29wZSk7CgogIGNvbnN0IHdhbnRlZE1lc3NhZ2UgPQogICAgU3Ry
aW5nKG1lc3NhZ2VJZCk7CgogIGNvbnN0IG1ldGEgPQogICAgcGVvcGxlUmVhZExvY2FsTWVzc2FnZUltYWdlTWV0YSgpOwoKICBsZXQgY2hhbmdlZCA9IGZh
bHNlOwoKICBmb3IgKAogICAgY29uc3QgW2lkLCBpdGVtXQogICAgb2YgT2JqZWN0LmVudHJpZXMobWV0YSkKICApIHsKICAgIGlmICgKICAgICAgU3RyaW5n
KGl0ZW0/LnNjb3BlKSAhPT0KICAgICAgICB3YW50ZWRTY29wZSB8fAogICAgICBTdHJpbmcoaXRlbT8ubWVzc2FnZUlkKSAhPT0KICAgICAgICB3YW50ZWRN
ZXNzYWdlCiAgICApIHsKICAgICAgY29udGludWU7CiAgICB9CgogICAgaWYgKGl0ZW0uZmlsZSkgewogICAgICB0cnkgewogICAgICAgIGZzQWNjb3VudHMu
dW5saW5rU3luYygKICAgICAgICAgIHBhdGhBY2NvdW50cy5qb2luKAogICAgICAgICAgICBQRU9QTEVfTE9DQUxfTUVTU0FHRV9JTUFHRV9ESVIsCiAgICAg
ICAgICAgIGl0ZW0uZmlsZQogICAgICAgICAgKQogICAgICAgICk7CiAgICAgIH0gY2F0Y2gge30KICAgIH0KCiAgICBkZWxldGUgbWV0YVtpZF07CiAgICBj
aGFuZ2VkID0gdHJ1ZTsKICB9CgogIGlmIChjaGFuZ2VkKSB7CiAgICBwZW9wbGVXcml0ZUxvY2FsTWVzc2FnZUltYWdlTWV0YSgKICAgICAgbWV0YQogICAg
KTsKICB9Cn0KCi8vID09PSBQRU9QTEVfTUVTU0FHRV9FRElUX1NFUlZFUl9WNl9TVEFSVCA9PT0KYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1Pd25lZE1lc3Nh
Z2VDb250ZXh0KAogIGFjY291bnRJZCwKICBtZXNzYWdlSWQKKSB7CiAgY29uc3Qgb3duZXIgPSBTdHJpbmcoYWNjb3VudElkIHx8ICIiKTsKICBjb25zdCBp
ZCA9IHBlb3BsZVJlcGx5SWQobWVzc2FnZUlkKTsKCiAgaWYgKCFvd25lciB8fCAhaWQpIHJldHVybiBudWxsOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAg
YXdhaXQgcGVvcGxlRW5zdXJlUmVwbHlDb2x1bW5zKCk7CgogICAgaWYgKCEvXlxkKyQvLnRlc3QoaWQpKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQoK
ICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIlNFTEVDVCBkbS5pZCwgZG0uc2VuZGVyX2lkLCBkbS5y
ZWNpcGllbnRfaWQsICIgKwogICAgICAgICJFWElTVFMoU0VMRUNUIDEgRlJPTSBwZW9wbGVfbWVzc2FnZV9pbWFnZXMgaSBXSEVSRSBpLmRtX21lc3NhZ2Vf
aWQgPSBkbS5pZCkgQVMgaGFzX2ltYWdlICIgKwogICAgICAgICJGUk9NIHBlb3BsZV9kaXJlY3RfbWVzc2FnZXMgZG0gIiArCiAgICAgICAgIldIRVJFIGRt
LmlkID0gJDEgQU5EIGRtLnNlbmRlcl9pZCA9ICQyIExJTUlUIDEiLAogICAgICAgIFtpZCwgb3duZXJdCiAgICAgICk7CgogICAgY29uc3Qgcm93ID0gcmVz
dWx0LnJvd3NbMF07CiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGw7CgogICAgcmV0dXJuIHsKICAgICAgaWQ6IFN0cmluZyhyb3cuaWQpLAogICAgICBzZW5k
ZXJJZDogU3RyaW5nKHJvdy5zZW5kZXJfaWQpLAogICAgICByZWNpcGllbnRJZDogU3RyaW5nKHJvdy5yZWNpcGllbnRfaWQpLAogICAgICBoYXNJbWFnZTog
Qm9vbGVhbihyb3cuaGFzX2ltYWdlKQogICAgfTsKICB9CgogIGNvbnN0IG1lc3NhZ2UgPQogICAgcGVvcGxlUmVhZExvY2FsU29jaWFsKCkuZG1zLmZpbmQo
CiAgICAgIChpdGVtKSA9PgogICAgICAgIFN0cmluZyhpdGVtLmlkKSA9PT0gaWQgJiYKICAgICAgICBTdHJpbmcoaXRlbS5zZW5kZXJfaWQpID09PSBvd25l
cgogICAgKTsKCiAgaWYgKCFtZXNzYWdlKSByZXR1cm4gbnVsbDsKCiAgcmV0dXJuIHsKICAgIGlkOiBTdHJpbmcobWVzc2FnZS5pZCksCiAgICBzZW5kZXJJ
ZDogU3RyaW5nKG1lc3NhZ2Uuc2VuZGVyX2lkKSwKICAgIHJlY2lwaWVudElkOiBTdHJpbmcobWVzc2FnZS5yZWNpcGllbnRfaWQpLAogICAgaGFzSW1hZ2U6
IEJvb2xlYW4obWVzc2FnZS5pbWFnZV9pZCkKICB9Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVFZGl0RG1NZXNzYWdlKAogIGFjY291bnRJZCwKICBtZXNz
YWdlSWQsCiAgYm9keSwKICBjb250ZXh0ID0gbnVsbAopIHsKICBjb25zdCBvd25lciA9IFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwogIGNvbnN0IGlkID0g
cGVvcGxlUmVwbHlJZChtZXNzYWdlSWQpOwogIGNvbnN0IHJhd0JvZHkgPSBTdHJpbmcoYm9keSB8fCAiIikudHJpbSgpOwogIGNvbnN0IGNsZWFuQm9keSA9
CiAgICBwZW9wbGVEbUUyZWVJc0VudmVsb3BlKHJhd0JvZHkpCiAgICAgID8gcmF3Qm9keQogICAgICA6IHJhd0JvZHkuc2xpY2UoMCwgMjAwMCk7CgogIGNv
bnN0IGN0eCA9CiAgICBjb250ZXh0IHx8CiAgICBhd2FpdCBwZW9wbGVEbU93bmVkTWVzc2FnZUNvbnRleHQoCiAgICAgIG93bmVyLAogICAgICBpZAogICAg
KTsKCiAgaWYgKCFjdHgpIHJldHVybiBudWxsOwogIGlmICghY2xlYW5Cb2R5ICYmICFjdHguaGFzSW1hZ2UpIHJldHVybiBudWxsOwoKICBjb25zdCBlZGl0
ZWRBdCA9CiAgICBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPQogICAgICBhd2FpdCBw
ZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJVUERBVEUgcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyAiICsKICAgICAgICAiU0VUIGJvZHkgPSAkMywgZWRpdGVk
X2F0ID0gJDQgIiArCiAgICAgICAgIldIRVJFIGlkID0gJDEgQU5EIHNlbmRlcl9pZCA9ICQyICIgKwogICAgICAgICJSRVRVUk5JTkcgaWQsIHNlbmRlcl9p
ZCwgcmVjaXBpZW50X2lkLCBlZGl0ZWRfYXQiLAogICAgICAgIFsKICAgICAgICAgIGlkLAogICAgICAgICAgb3duZXIsCiAgICAgICAgICBwZW9wbGVFbmNy
eXB0TWVzc2FnZVRleHQoY2xlYW5Cb2R5KSwKICAgICAgICAgIGVkaXRlZEF0CiAgICAgICAgXQogICAgICApOwoKICAgIGNvbnN0IHJvdyA9IHJlc3VsdC5y
b3dzWzBdOwogICAgaWYgKCFyb3cpIHJldHVybiBudWxsOwoKICAgIHJldHVybiB7CiAgICAgIGlkOiBTdHJpbmcocm93LmlkKSwKICAgICAgc2VuZGVySWQ6
IFN0cmluZyhyb3cuc2VuZGVyX2lkKSwKICAgICAgcmVjaXBpZW50SWQ6IFN0cmluZyhyb3cucmVjaXBpZW50X2lkKSwKICAgICAgZWRpdGVkQXQ6IHJvdy5l
ZGl0ZWRfYXQKICAgIH07CiAgfQoKICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CiAgY29uc3QgbWVzc2FnZSA9IGRhdGEuZG1zLmZp
bmQoCiAgICAoaXRlbSkgPT4KICAgICAgU3RyaW5nKGl0ZW0uaWQpID09PSBpZCAmJgogICAgICBTdHJpbmcoaXRlbS5zZW5kZXJfaWQpID09PSBvd25lcgog
ICk7CgogIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGw7CgogIG1lc3NhZ2UuYm9keSA9IGNsZWFuQm9keTsKICBtZXNzYWdlLmVkaXRlZF9hdCA9IGVkaXRl
ZEF0OwogIHBlb3BsZVdyaXRlTG9jYWxTb2NpYWwoZGF0YSk7CgogIHJldHVybiB7CiAgICBpZCwKICAgIHNlbmRlcklkOiBTdHJpbmcobWVzc2FnZS5zZW5k
ZXJfaWQpLAogICAgcmVjaXBpZW50SWQ6IFN0cmluZyhtZXNzYWdlLnJlY2lwaWVudF9pZCksCiAgICBlZGl0ZWRBdAogIH07Cn0KCmFzeW5jIGZ1bmN0aW9u
IHBlb3BsZVNlcnZlckVkaXRNZXNzYWdlKAogIGFjY291bnRJZCwKICBzZXJ2ZXJJZCwKICBjaGFubmVsSWQsCiAgbWVzc2FnZUlkLAogIHRleHQKKSB7CiAg
Y29uc3Qgb3duZXIgPSBTdHJpbmcoYWNjb3VudElkIHx8ICIiKTsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9
IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGNvbnN0IGlkID0gcGVvcGxlUmVwbHlJZChtZXNzYWdlSWQpOwogIGNvbnN0IGNsZWFuVGV4dCA9IFN0cmlu
Zyh0ZXh0IHx8ICIiKS50cmltKCkuc2xpY2UoMCwgMTAwMCk7CgogIGlmICghb3duZXIgfHwgIXNpZCB8fCAhY2lkIHx8ICFpZCkgewogICAgcmV0dXJuIG51
bGw7CiAgfQoKICBjb25zdCBlZGl0ZWRBdCA9CiAgICBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBw
ZW9wbGVFbnN1cmVSZXBseUNvbHVtbnMoKTsKCiAgICBpZiAoIS9eXGQrJC8udGVzdChpZCkgfHwgIS9eXGQrJC8udGVzdChzaWQpKSB7CiAgICAgIHJldHVy
biBudWxsOwogICAgfQoKICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIlVQREFURSBwZW9wbGVfZ2Vu
ZXJhbF9tZXNzYWdlcyBnbSAiICsKICAgICAgICAiU0VUIGJvZHkgPSAkNSwgZWRpdGVkX2F0ID0gJDYgIiArCiAgICAgICAgIldIRVJFIGdtLmlkID0gJDEg
QU5EIGdtLnNlbmRlcl9pZCA9ICQyIEFORCBnbS5zZXJ2ZXJfaWQgPSAkMyBBTkQgZ20uY2hhbm5lbF9pZCA9ICQ0ICIgKwogICAgICAgICJBTkQgKGdtLmlz
X3N5c3RlbSA9IEZBTFNFIE9SIGdtLmlzX3N5c3RlbSBJUyBOVUxMKSAiICsKICAgICAgICAiQU5EICgkNzo6Ym9vbGVhbiBPUiBFWElTVFMoU0VMRUNUIDEg
RlJPTSBwZW9wbGVfbWVzc2FnZV9pbWFnZXMgaSBXSEVSRSBpLmdlbmVyYWxfbWVzc2FnZV9pZCA9IGdtLmlkKSkgIiArCiAgICAgICAgIlJFVFVSTklORyBn
bS5pZCwgZ20uZWRpdGVkX2F0IiwKICAgICAgICBbCiAgICAgICAgICBpZCwKICAgICAgICAgIG93bmVyLAogICAgICAgICAgc2lkLAogICAgICAgICAgY2lk
LAogICAgICAgICAgcGVvcGxlRW5jcnlwdE1lc3NhZ2VUZXh0KGNsZWFuVGV4dCksCiAgICAgICAgICBlZGl0ZWRBdCwKICAgICAgICAgIEJvb2xlYW4oY2xl
YW5UZXh0KQogICAgICAgIF0KICAgICAgKTsKCiAgICBjb25zdCByb3cgPSByZXN1bHQucm93c1swXTsKICAgIGlmICghcm93KSByZXR1cm4gbnVsbDsKCiAg
ICByZXR1cm4gewogICAgICBpZDogU3RyaW5nKHJvdy5pZCksCiAgICAgIGNoYW5uZWxJZDogY2lkLAogICAgICB0ZXh0OiBjbGVhblRleHQsCiAgICAgIGVk
aXRlZEF0OiByb3cuZWRpdGVkX2F0CiAgICB9OwogIH0KCiAgY29uc3QgbWVzc2FnZXMgPSBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7CiAgY29uc3QgbWVz
c2FnZSA9IG1lc3NhZ2VzLmZpbmQoCiAgICAoaXRlbSkgPT4KICAgICAgU3RyaW5nKGl0ZW0uaWQpID09PSBpZCAmJgogICAgICBTdHJpbmcoaXRlbS5zZW5k
ZXJJZCkgPT09IG93bmVyICYmCiAgICAgIFN0cmluZyhpdGVtLnNlcnZlcklkKSA9PT0gc2lkICYmCiAgICAgIFN0cmluZyhpdGVtLmNoYW5uZWxJZCB8fCAi
IikgPT09IGNpZCAmJgogICAgICAhaXRlbS5zeXN0ZW0gJiYKICAgICAgIWl0ZW0uaXNTeXN0ZW0KICApOwoKICBpZiAoIW1lc3NhZ2UpIHJldHVybiBudWxs
OwogIGlmICghY2xlYW5UZXh0ICYmICFtZXNzYWdlLmltYWdlSWQpIHJldHVybiBudWxsOwoKICBtZXNzYWdlLnRleHQgPSBjbGVhblRleHQ7CiAgbWVzc2Fn
ZS5lZGl0ZWRBdCA9IGVkaXRlZEF0OwogIHBlb3BsZVdyaXRlTG9jYWxHZW5lcmFsKG1lc3NhZ2VzKTsKCiAgcmV0dXJuIHsKICAgIGlkLAogICAgY2hhbm5l
bElkOiBjaWQsCiAgICB0ZXh0OiBjbGVhblRleHQsCiAgICBlZGl0ZWRBdAogIH07Cn0KLy8gPT09IFBFT1BMRV9NRVNTQUdFX0VESVRfU0VSVkVSX1Y2X0VO
RCA9PT0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZURlbGV0ZUdlbmVyYWxNZXNzYWdlKAogIGFjY291bnRJZCwKICBtZXNzYWdlSWQKKSB7CiAgY29uc3Qgb3du
ZXIgPQogICAgU3RyaW5nKGFjY291bnRJZCk7CgogIGNvbnN0IGlkID0KICAgIHBlb3BsZVJlcGx5SWQobWVzc2FnZUlkKTsKCiAgaWYgKCFpZCkgcmV0dXJu
IGZhbHNlOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgYXdhaXQgcGVvcGxlRW5zdXJlUmVwbHlDb2x1bW5zKCk7CgogICAgaWYgKCEvXlxkKyQvLnRlc3Qo
aWQpKSB7CiAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KCiAgICBjb25zdCByZXN1bHQgPQogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAg
ICJERUxFVEUgRlJPTSBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyAiICsKICAgICAgICAiV0hFUkUgaWQgPSAkMSBBTkQgc2VuZGVyX2lkID0gJDIgIiArCiAg
ICAgICAgIlJFVFVSTklORyBpZCIsCiAgICAgICAgW2lkLCBvd25lcl0KICAgICAgKTsKCiAgICByZXR1cm4gQm9vbGVhbigKICAgICAgcmVzdWx0LnJvd3Nb
MF0KICAgICk7CiAgfQoKICBjb25zdCBtZXNzYWdlcyA9CiAgICBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7CgogIGNvbnN0IGluZGV4ID0KICAgIG1lc3Nh
Z2VzLmZpbmRJbmRleCgKICAgICAgKGl0ZW0pID0+CiAgICAgICAgU3RyaW5nKGl0ZW0uaWQpID09PSBpZCAmJgogICAgICAgIFN0cmluZyhpdGVtLnNlbmRl
cklkKSA9PT0gb3duZXIKICAgICk7CgogIGlmIChpbmRleCA8IDApIHsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIG1lc3NhZ2VzLnNwbGljZSgKICAgIGlu
ZGV4LAogICAgMQogICk7CgogIHBlb3BsZVdyaXRlTG9jYWxHZW5lcmFsKAogICAgbWVzc2FnZXMKICApOwoKICBwZW9wbGVEZWxldGVMb2NhbEJvdW5kTWVz
c2FnZUltYWdlKAogICAgImdlbmVyYWwiLAogICAgaWQKICApOwoKICByZXR1cm4gdHJ1ZTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRGVsZXRlRG1NZXNz
YWdlKAogIGFjY291bnRJZCwKICBtZXNzYWdlSWQKKSB7CiAgY29uc3Qgb3duZXIgPQogICAgU3RyaW5nKGFjY291bnRJZCk7CgogIGNvbnN0IGlkID0KICAg
IHBlb3BsZVJlcGx5SWQobWVzc2FnZUlkKTsKCiAgaWYgKCFpZCkgcmV0dXJuIG51bGw7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVF
bnN1cmVSZXBseUNvbHVtbnMoKTsKCiAgICBpZiAoIS9eXGQrJC8udGVzdChpZCkpIHsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgY29uc3QgcmVz
dWx0ID0KICAgICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAiREVMRVRFIEZST00gcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyAiICsKICAgICAg
ICAiV0hFUkUgaWQgPSAkMSBBTkQgc2VuZGVyX2lkID0gJDIgIiArCiAgICAgICAgIlJFVFVSTklORyBpZCwgc2VuZGVyX2lkLCByZWNpcGllbnRfaWQiLAog
ICAgICAgIFtpZCwgb3duZXJdCiAgICAgICk7CgogICAgY29uc3Qgcm93ID0KICAgICAgcmVzdWx0LnJvd3NbMF07CgogICAgaWYgKCFyb3cpIHJldHVybiBu
dWxsOwoKICAgIHJldHVybiB7CiAgICAgIGlkOgogICAgICAgIFN0cmluZyhyb3cuaWQpLAogICAgICBzZW5kZXJJZDoKICAgICAgICBTdHJpbmcocm93LnNl
bmRlcl9pZCksCiAgICAgIHJlY2lwaWVudElkOgogICAgICAgIFN0cmluZyhyb3cucmVjaXBpZW50X2lkKQogICAgfTsKICB9CgogIGNvbnN0IGRhdGEgPQog
ICAgcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CgogIGNvbnN0IGluZGV4ID0KICAgIGRhdGEuZG1zLmZpbmRJbmRleCgKICAgICAgKGl0ZW0pID0+CiAgICAg
ICAgU3RyaW5nKGl0ZW0uaWQpID09PSBpZCAmJgogICAgICAgIFN0cmluZyhpdGVtLnNlbmRlcl9pZCkgPT09IG93bmVyCiAgICApOwoKICBpZiAoaW5kZXgg
PCAwKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGNvbnN0IG1lc3NhZ2UgPQogICAgZGF0YS5kbXNbaW5kZXhdOwoKICBkYXRhLmRtcy5zcGxpY2UoCiAg
ICBpbmRleCwKICAgIDEKICApOwoKICBwZW9wbGVXcml0ZUxvY2FsU29jaWFsKAogICAgZGF0YQogICk7CgogIHBlb3BsZURlbGV0ZUxvY2FsQm91bmRNZXNz
YWdlSW1hZ2UoCiAgICAiZG0iLAogICAgaWQKICApOwoKICByZXR1cm4gewogICAgaWQsCiAgICBzZW5kZXJJZDoKICAgICAgU3RyaW5nKG1lc3NhZ2Uuc2Vu
ZGVyX2lkKSwKICAgIHJlY2lwaWVudElkOgogICAgICBTdHJpbmcobWVzc2FnZS5yZWNpcGllbnRfaWQpCiAgfTsKfQoKZnVuY3Rpb24gcGVvcGxlRG1SZXBs
eUZyb21IaXN0b3J5Um93KAogIG1lc3NhZ2UKKSB7CiAgY29uc3QgcmVwbHlJZCA9CiAgICBwZW9wbGVSZXBseUlkKAogICAgICBtZXNzYWdlPy5yZXBseV90
b19pZAogICAgKTsKCiAgaWYgKCFyZXBseUlkKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGlmICgKICAgICFtZXNzYWdlLnJlcGx5X3NlbmRlcl91c2Vy
bmFtZQogICkgewogICAgcmV0dXJuIHBlb3BsZURlbGV0ZWRSZXBseSgKICAgICAgcmVwbHlJZAogICAgKTsKICB9CgogIHJldHVybiB7CiAgICBpZDogcmVw
bHlJZCwKICAgIHVzZXJuYW1lOgogICAgICBtZXNzYWdlLnJlcGx5X3NlbmRlcl91c2VybmFtZSwKICAgIHRleHQ6CiAgICAgIG1lc3NhZ2UucmVwbHlfYm9k
eSB8fCAiIiwKICAgIGltYWdlSWQ6CiAgICAgIG1lc3NhZ2UucmVwbHlfaW1hZ2VfaWQKICAgICAgICA/IFN0cmluZygKICAgICAgICAgICAgbWVzc2FnZS5y
ZXBseV9pbWFnZV9pZAogICAgICAgICAgKQogICAgICAgIDogbnVsbCwKICAgIGRlbGV0ZWQ6IGZhbHNlCiAgfTsKfQovLyA9PT0gUEVPUExFX01FU1NBR0Vf
UkVQTElFU19ERUxFVEVfVjFfRU5EID09PQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2F2ZUdlbmVyYWxNZXNzYWdlKAogIHNlbmRlcklkLAogIHVzZXJuYW1l
LAogIHRleHQsCiAgaW1hZ2VJZCA9IG51bGwsCiAgcmVwbHlUb0lkID0gbnVsbAopIHsKICBjb25zdCBjbGVhblVzZXJuYW1lID0KICAgIHBlb3BsZVVzZXJu
YW1lKHVzZXJuYW1lKS5zbGljZSgwLCAyNCk7CgogIGNvbnN0IGNsZWFuVGV4dCA9CiAgICBTdHJpbmcodGV4dCB8fCAiIikKICAgICAgLnRyaW0oKQogICAg
ICAuc2xpY2UoMCwgMTAwMCk7CgogIGNvbnN0IGltYWdlS2V5ID0KICAgIHBlb3BsZU5vcm1hbGl6ZU1lc3NhZ2VJbWFnZUlkKAogICAgICBpbWFnZUlkCiAg
ICApOwoKICBjb25zdCByZXBseUtleSA9CiAgICBwZW9wbGVSZXBseUlkKAogICAgICByZXBseVRvSWQKICAgICk7CgogIGlmICgKICAgICFjbGVhblVzZXJu
YW1lIHx8CiAgICAoCiAgICAgICFjbGVhblRleHQgJiYKICAgICAgIWltYWdlS2V5CiAgICApCiAgKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGlmIChw
ZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVFbnN1cmVSZXBseUNvbHVtbnMoKTsKCiAgICBjb25zdCBjbGllbnQgPQogICAgICBhd2FpdCBwZW9wbGVQ
b29sLmNvbm5lY3QoKTsKCiAgICB0cnkgewogICAgICBhd2FpdCBjbGllbnQucXVlcnkoIkJFR0lOIik7CgogICAgICBjb25zdCByZXBseSA9CiAgICAgICAg
cmVwbHlLZXkKICAgICAgICAgID8gYXdhaXQgcGVvcGxlR2VuZXJhbFJlcGx5UHJldmlldygKICAgICAgICAgICAgICByZXBseUtleSwKICAgICAgICAgICAg
ICBjbGllbnQKICAgICAgICAgICAgKQogICAgICAgICAgOiBudWxsOwoKICAgICAgaWYgKAogICAgICAgIHJlcGx5S2V5ICYmCiAgICAgICAgIXJlcGx5CiAg
ICAgICkgewogICAgICAgIGNvbnN0IGVyciA9CiAgICAgICAgICBuZXcgRXJyb3IoIlJFUExZX0lOVkFMSUQiKTsKCiAgICAgICAgZXJyLmNvZGUgPQogICAg
ICAgICAgIlJFUExZX0lOVkFMSUQiOwoKICAgICAgICB0aHJvdyBlcnI7CiAgICAgIH0KCiAgICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgICAgYXdhaXQgY2xp
ZW50LnF1ZXJ5KAogICAgICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzICIgKwogICAgICAgICAgIihzZW5kZXJfaWQsIHVzZXJu
YW1lLCBib2R5LCByZXBseV90b19pZCkgIiArCiAgICAgICAgICAiVkFMVUVTICgkMSwgJDIsICQzLCAkNCkgIiArCiAgICAgICAgICAiUkVUVVJOSU5HIGlk
LCB1c2VybmFtZSwgYm9keSwgcmVwbHlfdG9faWQsIGNyZWF0ZWRfYXQiLAogICAgICAgICAgWwogICAgICAgICAgICBTdHJpbmcoc2VuZGVySWQpLAogICAg
ICAgICAgICBjbGVhblVzZXJuYW1lLAogICAgICAgICAgICBwZW9wbGVFbmNyeXB0TWVzc2FnZVRleHQoCiAgICAgICAgICAgICAgY2xlYW5UZXh0CiAgICAg
ICAgICAgICksCiAgICAgICAgICAgIHJlcGx5S2V5IHx8IG51bGwKICAgICAgICAgIF0KICAgICAgICApOwoKICAgICAgY29uc3Qgcm93ID0KICAgICAgICBy
ZXN1bHQucm93c1swXTsKCiAgICAgIGxldCBib3VuZEltYWdlSWQgPQogICAgICAgIG51bGw7CgogICAgICBpZiAoaW1hZ2VLZXkpIHsKICAgICAgICBib3Vu
ZEltYWdlSWQgPQogICAgICAgICAgYXdhaXQgcGVvcGxlQmluZEdlbmVyYWxNZXNzYWdlSW1hZ2UoCiAgICAgICAgICAgIHNlbmRlcklkLAogICAgICAgICAg
ICBpbWFnZUtleSwKICAgICAgICAgICAgcm93LmlkLAogICAgICAgICAgICBjbGllbnQKICAgICAgICAgICk7CgogICAgICAgIGlmICghYm91bmRJbWFnZUlk
KSB7CiAgICAgICAgICBjb25zdCBlcnIgPQogICAgICAgICAgICBuZXcgRXJyb3IoIklNQUdFX0lOVkFMSUQiKTsKCiAgICAgICAgICBlcnIuY29kZSA9CiAg
ICAgICAgICAgICJJTUFHRV9JTlZBTElEIjsKCiAgICAgICAgICB0aHJvdyBlcnI7CiAgICAgICAgfQogICAgICB9CgogICAgICBhd2FpdCBjbGllbnQucXVl
cnkoIkNPTU1JVCIpOwoKICAgICAgcmV0dXJuIHsKICAgICAgICBpZDoKICAgICAgICAgIFN0cmluZyhyb3cuaWQpLAogICAgICAgIHVzZXJuYW1lOgogICAg
ICAgICAgcm93LnVzZXJuYW1lLAogICAgICAgIHRleHQ6CiAgICAgICAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAgICAgICAgIHJvdy5ib2R5
CiAgICAgICAgICApLAogICAgICAgIGltYWdlSWQ6CiAgICAgICAgICBib3VuZEltYWdlSWQsCiAgICAgICAgcmVwbHlUbzoKICAgICAgICAgIHJlcGx5LAog
ICAgICAgIHRpbWU6CiAgICAgICAgICBuZXcgRGF0ZSgKICAgICAgICAgICAgcm93LmNyZWF0ZWRfYXQKICAgICAgICAgICkuZ2V0VGltZSgpCiAgICAgIH07
CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgYXdhaXQgY2xpZW50CiAgICAgICAgLnF1ZXJ5KCJST0xMQkFDSyIpCiAgICAgICAgLmNhdGNoKCgpID0+IHt9
KTsKCiAgICAgIHRocm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfQoKICBjb25zdCBtZXNzYWdlcyA9
CiAgICBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7CgogIGNvbnN0IHJlcGx5ID0KICAgIHJlcGx5S2V5CiAgICAgID8gYXdhaXQgcGVvcGxlR2VuZXJhbFJl
cGx5UHJldmlldygKICAgICAgICAgIHJlcGx5S2V5CiAgICAgICAgKQogICAgICA6IG51bGw7CgogIGlmICgKICAgIHJlcGx5S2V5ICYmCiAgICAhcmVwbHkK
ICApIHsKICAgIGNvbnN0IGVyciA9CiAgICAgIG5ldyBFcnJvcigiUkVQTFlfSU5WQUxJRCIpOwoKICAgIGVyci5jb2RlID0KICAgICAgIlJFUExZX0lOVkFM
SUQiOwoKICAgIHRocm93IGVycjsKICB9CgogIGNvbnN0IG1lc3NhZ2UgPSB7CiAgICBpZDoKICAgICAgY3J5cHRvQWNjb3VudHMucmFuZG9tVVVJRCgpLAog
ICAgc2VuZGVySWQ6CiAgICAgIFN0cmluZyhzZW5kZXJJZCksCiAgICB1c2VybmFtZToKICAgICAgY2xlYW5Vc2VybmFtZSwKICAgIHRleHQ6CiAgICAgIGNs
ZWFuVGV4dCwKICAgIGltYWdlSWQ6CiAgICAgIG51bGwsCiAgICByZXBseVRvSWQ6CiAgICAgIHJlcGx5S2V5IHx8IG51bGwsCiAgICB0aW1lOgogICAgICBE
YXRlLm5vdygpCiAgfTsKCiAgaWYgKGltYWdlS2V5KSB7CiAgICBjb25zdCBib3VuZCA9CiAgICAgIGF3YWl0IHBlb3BsZUJpbmRHZW5lcmFsTWVzc2FnZUlt
YWdlKAogICAgICAgIHNlbmRlcklkLAogICAgICAgIGltYWdlS2V5LAogICAgICAgIG1lc3NhZ2UuaWQKICAgICAgKTsKCiAgICBpZiAoIWJvdW5kKSB7CiAg
ICAgIGNvbnN0IGVyciA9CiAgICAgICAgbmV3IEVycm9yKCJJTUFHRV9JTlZBTElEIik7CgogICAgICBlcnIuY29kZSA9CiAgICAgICAgIklNQUdFX0lOVkFM
SUQiOwoKICAgICAgdGhyb3cgZXJyOwogICAgfQoKICAgIG1lc3NhZ2UuaW1hZ2VJZCA9CiAgICAgIGJvdW5kOwogIH0KCiAgbWVzc2FnZXMucHVzaChtZXNz
YWdlKTsKCiAgcGVvcGxlV3JpdGVMb2NhbEdlbmVyYWwoCiAgICBtZXNzYWdlcwogICk7CgogIHJldHVybiB7CiAgICAuLi5tZXNzYWdlLAogICAgcmVwbHlU
bzogcmVwbHkKICB9Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVMb2FkR2VuZXJhbE1lc3NhZ2VzKAogIGxpbWl0ID0gMTAwCikgewogIGNvbnN0IHNhZmVM
aW1pdCA9CiAgICBNYXRoLm1heCgKICAgICAgMSwKICAgICAgTWF0aC5taW4oCiAgICAgICAgMjAwLAogICAgICAgIE51bWJlcihsaW1pdCkgfHwgMTAwCiAg
ICAgICkKICAgICk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVFbnN1cmVSZXBseUNvbHVtbnMoKTsKCiAgICBjb25zdCByZXN1bHQg
PQogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgIiArCiAgICAgICAgImdtLmlkLCBnbS51c2VybmFtZSwgZ20uYm9keSwg
Z20ucmVwbHlfdG9faWQsIGdtLmNyZWF0ZWRfYXQsICIgKwogICAgICAgICIoU0VMRUNUIGkuaWQgRlJPTSBwZW9wbGVfbWVzc2FnZV9pbWFnZXMgaSAiICsK
ICAgICAgICAiV0hFUkUgaS5nZW5lcmFsX21lc3NhZ2VfaWQgPSBnbS5pZCBMSU1JVCAxKSBBUyBpbWFnZV9pZCwgIiArCiAgICAgICAgInJnbS51c2VybmFt
ZSBBUyByZXBseV91c2VybmFtZSwgIiArCiAgICAgICAgInJnbS5ib2R5IEFTIHJlcGx5X2JvZHksICIgKwogICAgICAgICIoU0VMRUNUIHJpLmlkIEZST00g
cGVvcGxlX21lc3NhZ2VfaW1hZ2VzIHJpICIgKwogICAgICAgICJXSEVSRSByaS5nZW5lcmFsX21lc3NhZ2VfaWQgPSByZ20uaWQgTElNSVQgMSkgQVMgcmVw
bHlfaW1hZ2VfaWQgIiArCiAgICAgICAgIkZST00gcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgZ20gIiArCiAgICAgICAgIkxFRlQgSk9JTiBwZW9wbGVfZ2Vu
ZXJhbF9tZXNzYWdlcyByZ20gIiArCiAgICAgICAgIk9OIHJnbS5pZCA9IGdtLnJlcGx5X3RvX2lkICIgKwogICAgICAgICJPUkRFUiBCWSBnbS5jcmVhdGVk
X2F0IERFU0MgIiArCiAgICAgICAgIkxJTUlUICQxIiwKICAgICAgICBbc2FmZUxpbWl0XQogICAgICApOwoKICAgIHJldHVybiByZXN1bHQucm93cwogICAg
ICAucmV2ZXJzZSgpCiAgICAgIC5tYXAoKHJvdykgPT4gKHsKICAgICAgICBpZDoKICAgICAgICAgIFN0cmluZyhyb3cuaWQpLAogICAgICAgIHVzZXJuYW1l
OgogICAgICAgICAgcm93LnVzZXJuYW1lLAogICAgICAgIHRleHQ6CiAgICAgICAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAgICAgICAgIHJv
dy5ib2R5CiAgICAgICAgICApLAogICAgICAgIGltYWdlSWQ6CiAgICAgICAgICByb3cuaW1hZ2VfaWQKICAgICAgICAgICAgPyBTdHJpbmcocm93LmltYWdl
X2lkKQogICAgICAgICAgICA6IG51bGwsCiAgICAgICAgcmVwbHlUbzoKICAgICAgICAgIHJvdy5yZXBseV90b19pZAogICAgICAgICAgICA/ICgKICAgICAg
ICAgICAgICAgIHJvdy5yZXBseV91c2VybmFtZQogICAgICAgICAgICAgICAgICA/IHsKICAgICAgICAgICAgICAgICAgICAgIGlkOgogICAgICAgICAgICAg
ICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICAgICAgICAgICAgcm93LnJlcGx5X3RvX2lkCiAgICAgICAgICAgICAgICAgICAgICAgICksCiAg
ICAgICAgICAgICAgICAgICAgICB1c2VybmFtZToKICAgICAgICAgICAgICAgICAgICAgICAgcm93LnJlcGx5X3VzZXJuYW1lLAogICAgICAgICAgICAgICAg
ICAgICAgdGV4dDoKICAgICAgICAgICAgICAgICAgICAgICAgcGVvcGxlRGVjcnlwdE1lc3NhZ2VUZXh0KAogICAgICAgICAgICAgICAgICAgICAgICAgIHJv
dy5yZXBseV9ib2R5IHx8ICIiCiAgICAgICAgICAgICAgICAgICAgICAgICksCiAgICAgICAgICAgICAgICAgICAgICBpbWFnZUlkOgogICAgICAgICAgICAg
ICAgICAgICAgICByb3cucmVwbHlfaW1hZ2VfaWQKICAgICAgICAgICAgICAgICAgICAgICAgICA/IFN0cmluZygKICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgcm93LnJlcGx5X2ltYWdlX2lkCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgICAgICAgICAgICAgOiBudWxsLAog
ICAgICAgICAgICAgICAgICAgICAgZGVsZXRlZDoKICAgICAgICAgICAgICAgICAgICAgICAgZmFsc2UKICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAg
ICAgICAgICAgIDogcGVvcGxlRGVsZXRlZFJlcGx5KAogICAgICAgICAgICAgICAgICAgICAgcm93LnJlcGx5X3RvX2lkCiAgICAgICAgICAgICAgICAgICAg
KQogICAgICAgICAgICAgICkKICAgICAgICAgICAgOiBudWxsLAogICAgICAgIHRpbWU6CiAgICAgICAgICBuZXcgRGF0ZSgKICAgICAgICAgICAgcm93LmNy
ZWF0ZWRfYXQKICAgICAgICAgICkuZ2V0VGltZSgpCiAgICAgIH0pKTsKICB9CgogIGNvbnN0IGFsbCA9CiAgICBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7
CgogIGNvbnN0IGJ5SWQgPQogICAgbmV3IE1hcCgKICAgICAgYWxsLm1hcCgKICAgICAgICAobWVzc2FnZSkgPT4gWwogICAgICAgICAgU3RyaW5nKG1lc3Nh
Z2UuaWQpLAogICAgICAgICAgbWVzc2FnZQogICAgICAgIF0KICAgICAgKQogICAgKTsKCiAgcmV0dXJuIGFsbAogICAgLnNsaWNlKC1zYWZlTGltaXQpCiAg
ICAubWFwKChtZXNzYWdlKSA9PiB7CiAgICAgIGNvbnN0IHJlcGx5SWQgPQogICAgICAgIHBlb3BsZVJlcGx5SWQoCiAgICAgICAgICBtZXNzYWdlLnJlcGx5
VG9JZAogICAgICAgICk7CgogICAgICBjb25zdCB0YXJnZXQgPQogICAgICAgIHJlcGx5SWQKICAgICAgICAgID8gYnlJZC5nZXQocmVwbHlJZCkKICAgICAg
ICAgIDogbnVsbDsKCiAgICAgIHJldHVybiB7CiAgICAgICAgaWQ6CiAgICAgICAgICBTdHJpbmcobWVzc2FnZS5pZCB8fCAiIiksCiAgICAgICAgdXNlcm5h
bWU6CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIG1lc3NhZ2UudXNlcm5hbWUgfHwgIiIKICAgICAgICAgICksCiAgICAgICAgdGV4dDoKICAgICAg
ICAgIFN0cmluZygKICAgICAgICAgICAgbWVzc2FnZS50ZXh0IHx8ICIiCiAgICAgICAgICApLAogICAgICAgIGltYWdlSWQ6CiAgICAgICAgICBtZXNzYWdl
LmltYWdlSWQKICAgICAgICAgICAgPyBTdHJpbmcoCiAgICAgICAgICAgICAgICBtZXNzYWdlLmltYWdlSWQKICAgICAgICAgICAgICApCiAgICAgICAgICAg
IDogbnVsbCwKICAgICAgICByZXBseVRvOgogICAgICAgICAgcmVwbHlJZAogICAgICAgICAgICA/ICgKICAgICAgICAgICAgICAgIHRhcmdldAogICAgICAg
ICAgICAgICAgICA/IHsKICAgICAgICAgICAgICAgICAgICAgIGlkOgogICAgICAgICAgICAgICAgICAgICAgICBTdHJpbmcodGFyZ2V0LmlkKSwKICAgICAg
ICAgICAgICAgICAgICAgIHVzZXJuYW1lOgogICAgICAgICAgICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0
LnVzZXJuYW1lIHx8ICIiCiAgICAgICAgICAgICAgICAgICAgICAgICksCiAgICAgICAgICAgICAgICAgICAgICB0ZXh0OgogICAgICAgICAgICAgICAgICAg
ICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LnRleHQgfHwgIiIKICAgICAgICAgICAgICAgICAgICAgICAgKSwKICAgICAg
ICAgICAgICAgICAgICAgIGltYWdlSWQ6CiAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5pbWFnZUlkCiAgICAgICAgICAgICAgICAgICAgICAgICAg
PyBTdHJpbmcoCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5pbWFnZUlkCiAgICAgICAgICAgICAgICAgICAgICAgICAgICApCiAgICAg
ICAgICAgICAgICAgICAgICAgICAgOiBudWxsLAogICAgICAgICAgICAgICAgICAgICAgZGVsZXRlZDoKICAgICAgICAgICAgICAgICAgICAgICAgZmFsc2UK
ICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgIDogcGVvcGxlRGVsZXRlZFJlcGx5KAogICAgICAgICAgICAgICAgICAgICAgcmVwbHlJ
ZAogICAgICAgICAgICAgICAgICAgICkKICAgICAgICAgICAgICApCiAgICAgICAgICAgIDogbnVsbCwKICAgICAgICB0aW1lOgogICAgICAgICAgTnVtYmVy
KAogICAgICAgICAgICBtZXNzYWdlLnRpbWUgfHwKICAgICAgICAgICAgRGF0ZS5ub3coKQogICAgICAgICAgKQogICAgICB9OwogICAgfSk7Cn0KLy8gPT09
IFBFT1BMRV9HRU5FUkFMX0hJU1RPUllfVjFfRU5EID09PQoKZnVuY3Rpb24gcGVvcGxlRW1pdFRvQWNjb3VudChhY2NvdW50SWQsIGV2ZW50LCBwYXlsb2Fk
KSB7CiAgY29uc3Qgd2FudGVkID0gU3RyaW5nKGFjY291bnRJZCk7CgogIGZvciAoY29uc3QgW3NvY2tldElkLCBpZF0gb2YgdXNlcklkcy5lbnRyaWVzKCkp
IHsKICAgIGlmIChTdHJpbmcoaWQpID09PSB3YW50ZWQpIHsKICAgICAgaW8udG8oc29ja2V0SWQpLmVtaXQoZXZlbnQsIHBheWxvYWQpOwogICAgfQogIH0K
fQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlSW5pdFNvY2lhbCgpIHsKICBpZiAoIVBFT1BMRV9EQl9VUkwpIHsKICAgIGlmICghZnNBY2NvdW50cy5leGlzdHNT
eW5jKFBFT1BMRV9MT0NBTF9TT0NJQUwpKSB7CiAgICAgIHBlb3BsZVdyaXRlTG9jYWxTb2NpYWwoewogICAgICAgIGZyaWVuZHM6IFtdLAogICAgICAgIGRt
czogW10sCiAgICAgICAgZnJpZW5kX3JlcXVlc3RzOiBbXQogICAgICB9KTsKICAgIH0KCiAgICAvLyBQRU9QTEVfRlJJRU5EU19NVVRVQUxfTE9DQUxfTUlH
UkFUSU9OCiAgICB7CiAgICAgIGNvbnN0IHNvY2lhbERhdGEgPSBwZW9wbGVSZWFkTG9jYWxTb2NpYWwoKTsKICAgICAgY29uc3QgcGFpcnMgPSBuZXcgU2V0
KAogICAgICAgIHNvY2lhbERhdGEuZnJpZW5kcy5tYXAoCiAgICAgICAgICAoaXRlbSkgPT4KICAgICAgICAgICAgU3RyaW5nKGl0ZW0udXNlcl9pZCkgKyAi
OiIgKwogICAgICAgICAgICBTdHJpbmcoaXRlbS5mcmllbmRfaWQpCiAgICAgICAgKQogICAgICApOwoKICAgICAgY29uc3QgY2xlYW5lZCA9IHNvY2lhbERh
dGEuZnJpZW5kcy5maWx0ZXIoCiAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICBwYWlycy5oYXMoCiAgICAgICAgICAgIFN0cmluZyhpdGVtLmZyaWVuZF9p
ZCkgKyAiOiIgKwogICAgICAgICAgICBTdHJpbmcoaXRlbS51c2VyX2lkKQogICAgICAgICAgKQogICAgICApOwoKICAgICAgaWYgKGNsZWFuZWQubGVuZ3Ro
ICE9PSBzb2NpYWxEYXRhLmZyaWVuZHMubGVuZ3RoKSB7CiAgICAgICAgc29jaWFsRGF0YS5mcmllbmRzID0gY2xlYW5lZDsKICAgICAgICBwZW9wbGVXcml0
ZUxvY2FsU29jaWFsKHNvY2lhbERhdGEpOwogICAgICB9CiAgICB9CgogICAgY29uc3QgYWNjb3VudHMgPSBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygpOwog
ICAgbGV0IGNoYW5nZWQgPSBmYWxzZTsKCiAgICBmb3IgKGNvbnN0IGFjY291bnQgb2YgYWNjb3VudHMpIHsKICAgICAgaWYgKHR5cGVvZiBhY2NvdW50LmRl
c2NyaXB0aW9uICE9PSAic3RyaW5nIikgewogICAgICAgIGFjY291bnQuZGVzY3JpcHRpb24gPSAiIjsKICAgICAgICBjaGFuZ2VkID0gdHJ1ZTsKICAgICAg
fQoKICAgICAgY29uc3QgYXBwZWFyYW5jZSA9CiAgICAgICAgcGVvcGxlQXBwZWFyYW5jZUZyb21BY2NvdW50KGFjY291bnQpOwoKICAgICAgaWYgKAogICAg
ICAgIGFjY291bnQuYXBwZWFyYW5jZV90aGVtZSAhPT0KICAgICAgICBhcHBlYXJhbmNlLnRoZW1lCiAgICAgICkgewogICAgICAgIGFjY291bnQuYXBwZWFy
YW5jZV90aGVtZSA9CiAgICAgICAgICBhcHBlYXJhbmNlLnRoZW1lOwogICAgICAgIGNoYW5nZWQgPSB0cnVlOwogICAgICB9CgogICAgICBpZiAoCiAgICAg
ICAgYWNjb3VudC5hcHBlYXJhbmNlX2FjY2VudCAhPT0KICAgICAgICBhcHBlYXJhbmNlLmFjY2VudAogICAgICApIHsKICAgICAgICBhY2NvdW50LmFwcGVh
cmFuY2VfYWNjZW50ID0KICAgICAgICAgIGFwcGVhcmFuY2UuYWNjZW50OwogICAgICAgIGNoYW5nZWQgPSB0cnVlOwogICAgICB9CiAgICB9CgogICAgaWYg
KGNoYW5nZWQpIHBlb3BsZVdyaXRlTG9jYWxBY2NvdW50cyhhY2NvdW50cyk7CgogICAgY29uc29sZS5sb2coIltQZW9wbGVdIFByb2ZpbHMgZXQgTVAgbG9j
YXV4IGFjdGl2ZXMuIik7CiAgICByZXR1cm47CiAgfQoKICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgIkFMVEVSIFRBQkxFIHBlb3BsZV9hY2NvdW50
cyAiICsKICAgICJBREQgQ09MVU1OIElGIE5PVCBFWElTVFMgZGVzY3JpcHRpb24gVkFSQ0hBUigyODApIE5PVCBOVUxMIERFRkFVTFQgJyciCiAgKTsKCiAg
YXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJBTFRFUiBUQUJMRSBwZW9wbGVfYWNjb3VudHMgIiArCiAgICAiQUREIENPTFVNTiBJRiBOT1QgRVhJU1RT
IGFwcGVhcmFuY2VfdGhlbWUgVkFSQ0hBUigxNikgTk9UIE5VTEwgREVGQVVMVCAnZGFyayciCiAgKTsKCiAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAg
ICJBTFRFUiBUQUJMRSBwZW9wbGVfYWNjb3VudHMgIiArCiAgICAiQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTIGFwcGVhcmFuY2VfYWNjZW50IFZBUkNIQVIo
NykgTk9UIE5VTEwgREVGQVVMVCAnIzY3NTg5RCciCiAgKTsKCiAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJBTFRFUiBUQUJMRSBwZW9wbGVfYWNj
b3VudHMgIiArCiAgICAiQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTIGFwcGVhcmFuY2VfcGFsZXR0ZSBURVhUIE5PVCBOVUxMIERFRkFVTFQgJyciCiAgKTsK
CiAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwZW9wbGVfZnJpZW5kcyAoIiArCiAgICAidXNlcl9p
ZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfYWNjb3VudHMoaWQpIE9OIERFTEVURSBDQVNDQURFLCAiICsKICAgICJmcmllbmRfaWQgQklH
SU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAiY3JlYXRlZF9hdCBUSU1FU1RB
TVBUWiBOT1QgTlVMTCBERUZBVUxUIE5PVygpLCAiICsKICAgICJQUklNQVJZIEtFWSAodXNlcl9pZCwgZnJpZW5kX2lkKSIgKwogICAgIikiCiAgKTsKCiAg
YXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwZW9wbGVfZnJpZW5kX3JlcXVlc3RzICgiICsKICAgICJp
ZCBCSUdTRVJJQUwgUFJJTUFSWSBLRVksICIgKwogICAgInNlbmRlcl9pZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfYWNjb3VudHMoaWQp
IE9OIERFTEVURSBDQVNDQURFLCAiICsKICAgICJyZWNpcGllbnRfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBP
TiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAiY3JlYXRlZF9hdCBUSU1FU1RBTVBUWiBOT1QgTlVMTCBERUZBVUxUIE5PVygpLCAiICsKICAgICJVTklRVUUo
c2VuZGVyX2lkLCByZWNpcGllbnRfaWQpLCAiICsKICAgICJDSEVDSyhzZW5kZXJfaWQgPD4gcmVjaXBpZW50X2lkKSIgKwogICAgIikiCiAgKTsKCiAgYXdh
aXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJDUkVBVEUgVU5JUVVFIElOREVYIElGIE5PVCBFWElTVFMgcGVvcGxlX2ZyaWVuZF9yZXF1ZXN0c19wYWlyX2lk
eCAiICsKICAgICJPTiBwZW9wbGVfZnJpZW5kX3JlcXVlc3RzICgiICsKICAgICJMRUFTVChzZW5kZXJfaWQsIHJlY2lwaWVudF9pZCksICIgKwogICAgIkdS
RUFURVNUKHNlbmRlcl9pZCwgcmVjaXBpZW50X2lkKSIgKwogICAgIikiCiAgKTsKCiAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJERUxFVEUgRlJP
TSBwZW9wbGVfZnJpZW5kcyBmICIgKwogICAgIldIRVJFIE5PVCBFWElTVFMgKCIgKwogICAgIlNFTEVDVCAxIEZST00gcGVvcGxlX2ZyaWVuZHMgciAiICsK
ICAgICJXSEVSRSByLnVzZXJfaWQgPSBmLmZyaWVuZF9pZCAiICsKICAgICJBTkQgci5mcmllbmRfaWQgPSBmLnVzZXJfaWQiICsKICAgICIpIgogICk7Cgog
IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAiQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgKCIgKwogICAg
ImlkIEJJR1NFUklBTCBQUklNQVJZIEtFWSwgIiArCiAgICAic2VuZGVyX2lkIEJJR0lOVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBP
TiBERUxFVEUgU0VUIE5VTEwsICIgKwogICAgInVzZXJuYW1lIFZBUkNIQVIoMjQpIE5PVCBOVUxMLCAiICsKICAgICJib2R5IFRFWFQgTk9UIE5VTEwsICIg
KwogICAgImNyZWF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSIgKwogICAgIikiCiAgKTsKCiAgYXdhaXQgcGVvcGxlUG9vbC5x
dWVyeSgKICAgICJDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlc19jcmVhdGVkX2lkeCAiICsKICAgICJPTiBwZW9w
bGVfZ2VuZXJhbF9tZXNzYWdlcyhjcmVhdGVkX2F0IERFU0MpIgogICk7CgogIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAiQ1JFQVRFIFRBQkxFIElG
IE5PVCBFWElTVFMgcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyAoIiArCiAgICAiaWQgQklHU0VSSUFMIFBSSU1BUlkgS0VZLCAiICsKICAgICJzZW5kZXJfaWQg
QklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAicmVjaXBpZW50X2lkIEJJ
R0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9hY2NvdW50cyhpZCkgT04gREVMRVRFIENBU0NBREUsICIgKwogICAgImJvZHkgVEVYVCBOT1QgTlVM
TCwgIiArCiAgICAiY3JlYXRlZF9hdCBUSU1FU1RBTVBUWiBOT1QgTlVMTCBERUZBVUxUIE5PVygpLCAiICsKICAgICJyZWFkX2F0IFRJTUVTVEFNUFRaIE5V
TEwiICsKICAgICIpIgogICk7CiAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwZW9wbGVfZTJlZV9k
ZXZpY2VzICgiICsKICAgICJ1c2VyX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9hY2NvdW50cyhpZCkgT04gREVMRVRFIENBU0NBREUs
ICIgKwogICAgImRldmljZV9pZCBWQVJDSEFSKDgwKSBOT1QgTlVMTCwgIiArCiAgICAicHVibGljX2p3ayBURVhUIE5PVCBOVUxMLCAiICsKICAgICJjcmVh
dGVkX2F0IFRJTUVTVEFNUFRaIE5PVCBOVUxMIERFRkFVTFQgTk9XKCksICIgKwogICAgImxhc3Rfc2Vlbl9hdCBUSU1FU1RBTVBUWiBOT1QgTlVMTCBERUZB
VUxUIE5PVygpLCAiICsKICAgICJQUklNQVJZIEtFWSAodXNlcl9pZCwgZGV2aWNlX2lkKSIgKwogICAgIikiCiAgKTsKCiAgYXdhaXQgcGVvcGxlUG9vbC5x
dWVyeSgKICAgICJDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfZTJlZV9kZXZpY2VzX3NlZW5faWR4ICIgKwogICAgIk9OIHBlb3BsZV9lMmVl
X2RldmljZXModXNlcl9pZCwgbGFzdF9zZWVuX2F0IERFU0MpIgogICk7CgogIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAiQ1JFQVRFIFRBQkxFIElG
IE5PVCBFWElTVFMgcGVvcGxlX2Nsb3NlZF9kbXMgKCIgKwogICAgInVzZXJfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRz
KGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAib3RoZXJfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBP
TiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAiY2xvc2VkX2F0IFRJTUVTVEFNUFRaIE5PVCBOVUxMIERFRkFVTFQgTk9XKCksICIgKwogICAgIlBSSU1BUlkg
S0VZICh1c2VyX2lkLCBvdGhlcl9pZCksICIgKwogICAgIkNIRUNLKHVzZXJfaWQgPD4gb3RoZXJfaWQpIiArCiAgICAiKSIKICApOwoKICBhd2FpdCBwZW9w
bGVQb29sLnF1ZXJ5KAogICAgIkNSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTIHBlb3BsZV9tZXNzYWdlX2ltYWdlcyAoIiArCiAgICAiaWQgQklHU0VSSUFM
IFBSSU1BUlkgS0VZLCAiICsKICAgICJvd25lcl9pZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfYWNjb3VudHMoaWQpIE9OIERFTEVURSBD
QVNDQURFLCAiICsKICAgICJtaW1lX3R5cGUgVkFSQ0hBUigzMikgTk9UIE5VTEwsICIgKwogICAgImRhdGEgQllURUEgTk9UIE5VTEwsICIgKwogICAgImdl
bmVyYWxfbWVzc2FnZV9pZCBCSUdJTlQgVU5JUVVFIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyhpZCkgT04gREVMRVRFIENBU0NB
REUsICIgKwogICAgImRtX21lc3NhZ2VfaWQgQklHSU5UIFVOSVFVRSBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyhpZCkgT04gREVM
RVRFIENBU0NBREUsICIgKwogICAgImNyZWF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSwgIiArCiAgICAiQ0hFQ0soTk9UIChn
ZW5lcmFsX21lc3NhZ2VfaWQgSVMgTk9UIE5VTEwgQU5EIGRtX21lc3NhZ2VfaWQgSVMgTk9UIE5VTEwpKSIgKwogICAgIikiCiAgKTsKCiAgYXdhaXQgcGVv
cGxlUG9vbC5xdWVyeSgKICAgICJDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfbWVzc2FnZV9pbWFnZXNfb3duZXJfaWR4ICIgKwogICAgIk9O
IHBlb3BsZV9tZXNzYWdlX2ltYWdlcyhvd25lcl9pZCwgY3JlYXRlZF9hdCBERVNDKSIKICApOwoKICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgIkNS
RUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIHBlb3BsZV9tZXNzYWdlX2ltYWdlc19wZW5kaW5nX2NyZWF0ZWRfaWR4ICIgKwogICAgIk9OIHBlb3BsZV9tZXNz
YWdlX2ltYWdlcyhjcmVhdGVkX2F0KSAiICsKICAgICJXSEVSRSBnZW5lcmFsX21lc3NhZ2VfaWQgSVMgTlVMTCBBTkQgZG1fbWVzc2FnZV9pZCBJUyBOVUxM
IgogICk7CgogIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAiQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgcGVvcGxlX2RtX3NlbmRlcl9yZWNpcGll
bnRfaWR4ICIgKwogICAgIk9OIHBlb3BsZV9kaXJlY3RfbWVzc2FnZXMoc2VuZGVyX2lkLCByZWNpcGllbnRfaWQsIGNyZWF0ZWRfYXQgREVTQykiCiAgKTsK
CiAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICJDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfZG1fcmVjaXBpZW50X3VucmVhZF9pZHgg
IiArCiAgICAiT04gcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyhyZWNpcGllbnRfaWQsIHJlYWRfYXQpIgogICk7CgogIGNvbnNvbGUubG9nKCJbUGVvcGxlXSBQ
cm9maWxzLCBhbWlzIGV0IE1QIFBvc3RncmVTUUwgYWN0aXZlcy4iKTsKfQoKLy8gPT09IFBFT1BMRV9TSU1QTEVfQURNSU5fREVMRVRFX0hFTFBFUlNfVjEg
PT09CmZ1bmN0aW9uIHBlb3BsZVNpbXBsZUFkbWluS2lja0FjY291bnQoCiAgYWNjb3VudElkCikgewogIGNvbnN0IHdhbnRlZCA9CiAgICBTdHJpbmcoCiAg
ICAgIGFjY291bnRJZAogICAgKTsKCiAgcGVvcGxlU2ltcGxlRGVsZXRlZEFjY291bnRzLmFkZCgKICAgIHdhbnRlZAogICk7CgogIGZvciAoCiAgICBjb25z
dCBjYWxsIG9mCiAgICBbLi4ucGVvcGxlRG1DYWxscy52YWx1ZXMoKV0KICApIHsKICAgIGlmICgKICAgICAgU3RyaW5nKAogICAgICAgIGNhbGw/LmNhbGxl
ckFjY291bnRJZCB8fAogICAgICAgICIiCiAgICAgICkgPT09IHdhbnRlZCB8fAogICAgICBTdHJpbmcoCiAgICAgICAgY2FsbD8uY2FsbGVlQWNjb3VudElk
IHx8CiAgICAgICAgIiIKICAgICAgKSA9PT0gd2FudGVkCiAgICApIHsKICAgICAgcGVvcGxlRG1DYWxsRmluaXNoKAogICAgICAgIGNhbGwuaWQsCiAgICAg
ICAgImRpc2Nvbm5lY3RlZCIKICAgICAgKTsKICAgIH0KICB9CgogIGZvciAoCiAgICBjb25zdCBbCiAgICAgIHNvY2tldElkLAogICAgICBjdXJyZW50SWQK
ICAgIF0KICAgIG9mIFsuLi51c2VySWRzLmVudHJpZXMoKV0KICApIHsKICAgIGlmICgKICAgICAgU3RyaW5nKAogICAgICAgIGN1cnJlbnRJZCB8fAogICAg
ICAgICIiCiAgICAgICkgIT09IHdhbnRlZAogICAgKSB7CiAgICAgIGNvbnRpbnVlOwogICAgfQoKICAgIGNvbnN0IHNvY2tldCA9CiAgICAgIGlvLnNvY2tl
dHMuc29ja2V0cy5nZXQoCiAgICAgICAgc29ja2V0SWQKICAgICAgKTsKCiAgICBpZiAoc29ja2V0KSB7CiAgICAgIGxlYXZlVm9pY2UoCiAgICAgICAgc29j
a2V0CiAgICAgICk7CgogICAgICBzb2NrZXQuZW1pdCgKICAgICAgICAiYWNjb3VudC1kZWxldGVkIiwKICAgICAgICB7CiAgICAgICAgICBvazogdHJ1ZQog
ICAgICAgIH0KICAgICAgKTsKCiAgICAgIHNvY2tldC5kaXNjb25uZWN0KAogICAgICAgIHRydWUKICAgICAgKTsKICAgIH0KCiAgICB1c2Vycy5kZWxldGUo
CiAgICAgIHNvY2tldElkCiAgICApOwoKICAgIHVzZXJJZHMuZGVsZXRlKAogICAgICBzb2NrZXRJZAogICAgKTsKCiAgICBzb2NrZXRTZXJ2ZXJJZHMuZGVs
ZXRlKAogICAgICBzb2NrZXRJZAogICAgKTsKCiAgICB2b2ljZVVzZXJzLmRlbGV0ZSgKICAgICAgc29ja2V0SWQKICAgICk7CiAgfQp9Cgphc3luYyBmdW5j
dGlvbiBwZW9wbGVTaW1wbGVBZG1pbkRlbGV0ZUxvY2FsKAogIGFjY291bnQKKSB7CiAgY29uc3QgaWQgPQogICAgU3RyaW5nKAogICAgICBhY2NvdW50Lmlk
CiAgICApOwoKICBjb25zdCBhY2NvdW50cyA9CiAgICBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygpCiAgICAgIC5maWx0ZXIoCiAgICAgICAgKGl0ZW0pID0+
CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIGl0ZW0uaWQKICAgICAgICAgICkgIT09IGlkCiAgICAgICk7CgogIHBlb3BsZVdyaXRlTG9jYWxBY2Nv
dW50cygKICAgIGFjY291bnRzCiAgKTsKCiAgY29uc3Qgc29jaWFsID0KICAgIHBlb3BsZVJlYWRMb2NhbFNvY2lhbCgpOwoKICBzb2NpYWwuZnJpZW5kcyA9
CiAgICAoCiAgICAgIEFycmF5LmlzQXJyYXkoCiAgICAgICAgc29jaWFsLmZyaWVuZHMKICAgICAgKQogICAgICAgID8gc29jaWFsLmZyaWVuZHMKICAgICAg
ICA6IFtdCiAgICApLmZpbHRlcigKICAgICAgKGl0ZW0pID0+CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgaXRlbS51c2VyX2lkCiAgICAgICAgKSAhPT0g
aWQgJiYKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBpdGVtLmZyaWVuZF9pZAogICAgICAgICkgIT09IGlkCiAgICApOwoKICBzb2NpYWwuZnJpZW5kX3Jl
cXVlc3RzID0KICAgICgKICAgICAgQXJyYXkuaXNBcnJheSgKICAgICAgICBzb2NpYWwuZnJpZW5kX3JlcXVlc3RzCiAgICAgICkKICAgICAgICA/IHNvY2lh
bC5mcmllbmRfcmVxdWVzdHMKICAgICAgICA6IFtdCiAgICApLmZpbHRlcigKICAgICAgKGl0ZW0pID0+CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgaXRl
bS5zZW5kZXJfaWQKICAgICAgICApICE9PSBpZCAmJgogICAgICAgIFN0cmluZygKICAgICAgICAgIGl0ZW0ucmVjaXBpZW50X2lkCiAgICAgICAgKSAhPT0g
aWQKICAgICk7CgogIHNvY2lhbC5kbXMgPQogICAgKAogICAgICBBcnJheS5pc0FycmF5KAogICAgICAgIHNvY2lhbC5kbXMKICAgICAgKQogICAgICAgID8g
c29jaWFsLmRtcwogICAgICAgIDogW10KICAgICkuZmlsdGVyKAogICAgICAoaXRlbSkgPT4KICAgICAgICBTdHJpbmcoCiAgICAgICAgICBpdGVtLnNlbmRl
cl9pZAogICAgICAgICkgIT09IGlkICYmCiAgICAgICAgU3RyaW5nKAogICAgICAgICAgaXRlbS5yZWNpcGllbnRfaWQKICAgICAgICApICE9PSBpZAogICAg
KTsKCiAgaWYgKAogICAgQXJyYXkuaXNBcnJheSgKICAgICAgc29jaWFsLmNsb3NlZF9kbXMKICAgICkKICApIHsKICAgIHNvY2lhbC5jbG9zZWRfZG1zID0K
ICAgICAgc29jaWFsLmNsb3NlZF9kbXMKICAgICAgICAuZmlsdGVyKAogICAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICAgIFN0cmluZygKICAgICAgICAg
ICAgICBpdGVtLnVzZXJfaWQKICAgICAgICAgICAgKSAhPT0gaWQgJiYKICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAgIGl0ZW0ub3RoZXJfaWQK
ICAgICAgICAgICAgKSAhPT0gaWQKICAgICAgICApOwogIH0KCiAgcGVvcGxlV3JpdGVMb2NhbFNvY2lhbCgKICAgIHNvY2lhbAogICk7CgogIGNvbnN0IHNl
cnZlckRhdGEgPQogICAgcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwoKICBzZXJ2ZXJEYXRhLm1lbWJlcnMgPQogICAgc2VydmVyRGF0YS5tZW1iZXJzCiAg
ICAgIC5maWx0ZXIoCiAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIGl0ZW0udXNlcklkID8/CiAgICAgICAgICAgIGl0
ZW0udXNlcl9pZCA/PwogICAgICAgICAgICAiIgogICAgICAgICAgKSAhPT0gaWQKICAgICAgKTsKCiAgLyoKICAgIEljaSBvbiBuZSBkw6l0cnVpdCBwYXMg
ZGlyZWN0ZW1lbnQgbGVzIHNlcnZldXJzIGNyw6nDqXMKICAgIHBhciBjZSBjb21wdGUuIElscyByZXN0ZW50IHNhbnMgcHJvcHJpw6l0YWlyZSBzaSBkZXMK
ICAgIG1lbWJyZXMgc29udCBlbmNvcmUgcHLDqXNlbnRzIDsgbGUgbmV0dG95YWdlIGdsb2JhbAogICAgc3VwcHJpbWVyYSBlbnN1aXRlIGNldXggcXVpIHNv
bnQgZGV2ZW51cyB0b3RhbGVtZW50IHZpZGVzLgogICovCiAgc2VydmVyRGF0YS5zZXJ2ZXJzID0KICAgIHNlcnZlckRhdGEuc2VydmVycy5tYXAoCiAgICAg
IChpdGVtKSA9PiB7CiAgICAgICAgY29uc3Qgb3duZXIgPQogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBpdGVtLm93bmVySWQgPz8KICAgICAgICAg
ICAgaXRlbS5vd25lcl9pZCA/PwogICAgICAgICAgICAiIgogICAgICAgICAgKTsKCiAgICAgICAgaWYgKAogICAgICAgICAgb3duZXIgIT09IGlkCiAgICAg
ICAgKSB7CiAgICAgICAgICByZXR1cm4gaXRlbTsKICAgICAgICB9CgogICAgICAgIHJldHVybiB7CiAgICAgICAgICAuLi5pdGVtLAogICAgICAgICAgb3du
ZXJJZDogbnVsbCwKICAgICAgICAgIG93bmVyX2lkOiBudWxsCiAgICAgICAgfTsKICAgICAgfQogICAgKTsKCiAgcGVvcGxlV3JpdGVMb2NhbFNlcnZlcnMo
CiAgICBzZXJ2ZXJEYXRhCiAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2ltcGxlQWRtaW5EZWxldGVBY2NvdW50KAogIHVzZXJuYW1lCikgewogIGNv
bnN0IGFjY291bnQgPQogICAgYXdhaXQgcGVvcGxlRmluZEFjY291bnQoCiAgICAgIHVzZXJuYW1lCiAgICApOwoKICBpZiAoIWFjY291bnQpIHsKICAgIHJl
dHVybiBudWxsOwogIH0KCiAgY29uc3QgYWNjb3VudElkID0KICAgIFN0cmluZygKICAgICAgYWNjb3VudC5pZAogICAgKTsKCiAgaWYgKHBlb3BsZVBvb2wp
IHsKICAgIC8qCiAgICAgIExlcyBGSyBleGlzdGFudGVzIGRlIFBlb3BsZSBuZXR0b2llbnQgbGVzIGFtaXMsCiAgICAgIGRlbWFuZGVzLCBNUCwgUFAsIGlt
YWdlcyBldCBtZW1iZXJzaGlwcy4KICAgICAgTGVzIG1lc3NhZ2VzIHNlcnZldXIgZ2FyZGVudCBsZXVyIGhpc3RvcmlxdWUKICAgICAgYXZlYyBzZW5kZXJf
aWQgPSBOVUxMIGxvcnNxdWUgcHLDqXZ1IHBhciBsZSBzY2jDqW1hLgogICAgKi8KICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJERUxFVEUg
RlJPTSBwZW9wbGVfYWNjb3VudHMgV0hFUkUgaWQgPSAkMSIsCiAgICAgIFsKICAgICAgICBhY2NvdW50SWQKICAgICAgXQogICAgKTsKICB9IGVsc2Ugewog
ICAgYXdhaXQgcGVvcGxlU2ltcGxlQWRtaW5EZWxldGVMb2NhbCgKICAgICAgYWNjb3VudAogICAgKTsKICB9CgogIHBlb3BsZVNpbXBsZUFkbWluS2lja0Fj
Y291bnQoCiAgICBhY2NvdW50SWQKICApOwoKICAvLyA9PT0gUEVPUExFX0RFTEVURV9FTVBUWV9BRlRFUl9BQ0NPVU5UX0RFTEVURV9WMSA9PT0KICBhd2Fp
dCBwZW9wbGVEZWxldGVBbGxFbXB0eVNlcnZlcnMoKTsKCiAgcmV0dXJuIHsKICAgIGlkOgogICAgICBhY2NvdW50SWQsCiAgICB1c2VybmFtZToKICAgICAg
YWNjb3VudC51c2VybmFtZQogIH07Cn0KLy8gPT09IFBFT1BMRV9TSU1QTEVfQURNSU5fREVMRVRFX0hFTFBFUlNfVjEgPT09CgovLyA9PT0gUEVPUExFX1BS
T0ZJTEVfQVZBVEFSU19WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX0xPQ0FMX0FWQVRBUl9ESVIgPQogIHBhdGhBY2NvdW50cy5qb2luKF9fZGlybmFtZSwg
InBlb3BsZS1hdmF0YXJzIik7Cgpjb25zdCBQRU9QTEVfTE9DQUxfQVZBVEFSX01FVEEgPQogIHBhdGhBY2NvdW50cy5qb2luKAogICAgX19kaXJuYW1lLAog
ICAgInBlb3BsZS1hdmF0YXItbWV0YS5sb2NhbC5qc29uIgogICk7Cgpjb25zdCBQRU9QTEVfQVZBVEFSX01BWF9CWVRFUyA9CiAgMyAqIDEwMjQgKiAxMDI0
OwoKbGV0IHBlb3BsZUF2YXRhclRhYmxlUHJvbWlzZSA9IG51bGw7Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVFbnN1cmVBdmF0YXJUYWJsZSgpIHsKICBpZiAo
IXBlb3BsZVBvb2wpIHJldHVybjsKCiAgaWYgKCFwZW9wbGVBdmF0YXJUYWJsZVByb21pc2UpIHsKICAgIHBlb3BsZUF2YXRhclRhYmxlUHJvbWlzZSA9IHBl
b3BsZVBvb2wKICAgICAgLnF1ZXJ5KAogICAgICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwZW9wbGVfcHJvZmlsZV9hdmF0YXJzICgiICsKICAg
ICAgICAiYWNjb3VudF9pZCBCSUdJTlQgUFJJTUFSWSBLRVkgUkVGRVJFTkNFUyBwZW9wbGVfYWNjb3VudHMoaWQpIE9OIERFTEVURSBDQVNDQURFLCAiICsK
ICAgICAgICAibWltZV90eXBlIFZBUkNIQVIoMzIpIE5PVCBOVUxMLCAiICsKICAgICAgICAiZGF0YSBCWVRFQSBOT1QgTlVMTCwgIiArCiAgICAgICAgInVw
ZGF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSIgKwogICAgICAgICIpIgogICAgICApCiAgICAgIC5jYXRjaCgoZXJyKSA9PiB7
CiAgICAgICAgcGVvcGxlQXZhdGFyVGFibGVQcm9taXNlID0gbnVsbDsKICAgICAgICB0aHJvdyBlcnI7CiAgICAgIH0pOwogIH0KCiAgYXdhaXQgcGVvcGxl
QXZhdGFyVGFibGVQcm9taXNlOwp9CgpmdW5jdGlvbiBwZW9wbGVBdmF0YXJNaW1lKGJ1ZmZlcikgewogIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZmZlcikp
IHJldHVybiBudWxsOwoKICBpZiAoCiAgICBidWZmZXIubGVuZ3RoID49IDggJiYKICAgIGJ1ZmZlci5zdWJhcnJheSgwLCA4KS5lcXVhbHMoCiAgICAgIEJ1
ZmZlci5mcm9tKFsKICAgICAgICAweDg5LCAweDUwLCAweDRlLCAweDQ3LAogICAgICAgIDB4MGQsIDB4MGEsIDB4MWEsIDB4MGEKICAgICAgXSkKICAgICkK
ICApIHsKICAgIHJldHVybiAiaW1hZ2UvcG5nIjsKICB9CgogIGlmICgKICAgIGJ1ZmZlci5sZW5ndGggPj0gMyAmJgogICAgYnVmZmVyWzBdID09PSAweGZm
ICYmCiAgICBidWZmZXJbMV0gPT09IDB4ZDggJiYKICAgIGJ1ZmZlclsyXSA9PT0gMHhmZgogICkgewogICAgcmV0dXJuICJpbWFnZS9qcGVnIjsKICB9Cgog
IGlmIChidWZmZXIubGVuZ3RoID49IDYpIHsKICAgIGNvbnN0IHNpZyA9IGJ1ZmZlci5zdWJhcnJheSgwLCA2KS50b1N0cmluZygiYXNjaWkiKTsKCiAgICBp
ZiAoc2lnID09PSAiR0lGODdhIiB8fCBzaWcgPT09ICJHSUY4OWEiKSB7CiAgICAgIHJldHVybiAiaW1hZ2UvZ2lmIjsKICAgIH0KICB9CgogIGlmICgKICAg
IGJ1ZmZlci5sZW5ndGggPj0gMTIgJiYKICAgIGJ1ZmZlci5zdWJhcnJheSgwLCA0KS50b1N0cmluZygiYXNjaWkiKSA9PT0gIlJJRkYiICYmCiAgICBidWZm
ZXIuc3ViYXJyYXkoOCwgMTIpLnRvU3RyaW5nKCJhc2NpaSIpID09PSAiV0VCUCIKICApIHsKICAgIHJldHVybiAiaW1hZ2Uvd2VicCI7CiAgfQoKICByZXR1
cm4gbnVsbDsKfQoKZnVuY3Rpb24gcGVvcGxlQXZhdGFyRXh0ZW5zaW9uKG1pbWUpIHsKICByZXR1cm4gewogICAgImltYWdlL2pwZWciOiAiLmpwZyIsCiAg
ICAiaW1hZ2UvcG5nIjogIi5wbmciLAogICAgImltYWdlL3dlYnAiOiAiLndlYnAiLAogICAgImltYWdlL2dpZiI6ICIuZ2lmIgogIH1bbWltZV0gfHwgIiI7
Cn0KCmZ1bmN0aW9uIHBlb3BsZVJlYWRBdmF0YXJNZXRhKCkgewogIHRyeSB7CiAgICBpZiAoIWZzQWNjb3VudHMuZXhpc3RzU3luYyhQRU9QTEVfTE9DQUxf
QVZBVEFSX01FVEEpKSB7CiAgICAgIHJldHVybiB7fTsKICAgIH0KCiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZSgKICAgICAgZnNBY2NvdW50cy5yZWFk
RmlsZVN5bmMoUEVPUExFX0xPQ0FMX0FWQVRBUl9NRVRBLCAidXRmOCIpCiAgICApOwoKICAgIHJldHVybiBkYXRhICYmIHR5cGVvZiBkYXRhID09PSAib2Jq
ZWN0IiAmJiAhQXJyYXkuaXNBcnJheShkYXRhKQogICAgICA/IGRhdGEKICAgICAgOiB7fTsKICB9IGNhdGNoIHsKICAgIHJldHVybiB7fTsKICB9Cn0KCmZ1
bmN0aW9uIHBlb3BsZVdyaXRlQXZhdGFyTWV0YShtZXRhKSB7CiAgZnNBY2NvdW50cy53cml0ZUZpbGVTeW5jKAogICAgUEVPUExFX0xPQ0FMX0FWQVRBUl9N
RVRBLAogICAgSlNPTi5zdHJpbmdpZnkobWV0YSB8fCB7fSwgbnVsbCwgMikgKyAiXG4iLAogICAgInV0ZjgiCiAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVv
cGxlU2F2ZUF2YXRhcihhY2NvdW50SWQsIGJ1ZmZlcikgewogIGNvbnN0IG93bmVySWQgPSBTdHJpbmcoYWNjb3VudElkKTsKCiAgaWYgKAogICAgIUJ1ZmZl
ci5pc0J1ZmZlcihidWZmZXIpIHx8CiAgICAhYnVmZmVyLmxlbmd0aCB8fAogICAgYnVmZmVyLmxlbmd0aCA+IFBFT1BMRV9BVkFUQVJfTUFYX0JZVEVTCiAg
KSB7CiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIkFWQVRBUl9TSVpFIik7CiAgICBlcnIuY29kZSA9ICJBVkFUQVJfU0laRSI7CiAgICB0aHJvdyBlcnI7
CiAgfQoKICBjb25zdCBtaW1lID0gcGVvcGxlQXZhdGFyTWltZShidWZmZXIpOwoKICBpZiAoIW1pbWUpIHsKICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigi
QVZBVEFSX1RZUEUiKTsKICAgIGVyci5jb2RlID0gIkFWQVRBUl9UWVBFIjsKICAgIHRocm93IGVycjsKICB9CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBh
d2FpdCBwZW9wbGVFbnN1cmVBdmF0YXJUYWJsZSgpOwoKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJJTlNFUlQgSU5UTyBwZW9wbGVfcHJv
ZmlsZV9hdmF0YXJzICIgKwogICAgICAiKGFjY291bnRfaWQsIG1pbWVfdHlwZSwgZGF0YSwgdXBkYXRlZF9hdCkgIiArCiAgICAgICJWQUxVRVMgKCQxLCAk
MiwgJDMsIE5PVygpKSAiICsKICAgICAgIk9OIENPTkZMSUNUIChhY2NvdW50X2lkKSBETyBVUERBVEUgU0VUICIgKwogICAgICAibWltZV90eXBlID0gRVhD
TFVERUQubWltZV90eXBlLCAiICsKICAgICAgImRhdGEgPSBFWENMVURFRC5kYXRhLCAiICsKICAgICAgInVwZGF0ZWRfYXQgPSBOT1coKSIsCiAgICAgIFtv
d25lcklkLCBtaW1lLCBidWZmZXJdCiAgICApOwoKICAgIHJldHVybiB7CiAgICAgIG1pbWUsCiAgICAgIGJ5dGVTaXplOiBidWZmZXIubGVuZ3RoCiAgICB9
OwogIH0KCiAgZnNBY2NvdW50cy5ta2RpclN5bmMoCiAgICBQRU9QTEVfTE9DQUxfQVZBVEFSX0RJUiwKICAgIHsgcmVjdXJzaXZlOiB0cnVlIH0KICApOwoK
ICBjb25zdCBtZXRhID0gcGVvcGxlUmVhZEF2YXRhck1ldGEoKTsKICBjb25zdCBwcmV2aW91cyA9IG1ldGFbb3duZXJJZF07CgogIGlmIChwcmV2aW91cz8u
ZmlsZSkgewogICAgdHJ5IHsKICAgICAgZnNBY2NvdW50cy51bmxpbmtTeW5jKAogICAgICAgIHBhdGhBY2NvdW50cy5qb2luKAogICAgICAgICAgUEVPUExF
X0xPQ0FMX0FWQVRBUl9ESVIsCiAgICAgICAgICBwcmV2aW91cy5maWxlCiAgICAgICAgKQogICAgICApOwogICAgfSBjYXRjaCB7fQogIH0KCiAgY29uc3Qg
ZmlsZSA9CiAgICBvd25lcklkICsgcGVvcGxlQXZhdGFyRXh0ZW5zaW9uKG1pbWUpOwoKICBmc0FjY291bnRzLndyaXRlRmlsZVN5bmMoCiAgICBwYXRoQWNj
b3VudHMuam9pbigKICAgICAgUEVPUExFX0xPQ0FMX0FWQVRBUl9ESVIsCiAgICAgIGZpbGUKICAgICksCiAgICBidWZmZXIKICApOwoKICBtZXRhW293bmVy
SWRdID0gewogICAgZmlsZSwKICAgIG1pbWUsCiAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogIH07CgogIHBlb3BsZVdyaXRlQXZh
dGFyTWV0YShtZXRhKTsKCiAgcmV0dXJuIHsKICAgIG1pbWUsCiAgICBieXRlU2l6ZTogYnVmZmVyLmxlbmd0aAogIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBl
b3BsZUxvYWRBdmF0YXIoYWNjb3VudElkKSB7CiAgY29uc3Qgb3duZXJJZCA9IFN0cmluZyhhY2NvdW50SWQpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAg
YXdhaXQgcGVvcGxlRW5zdXJlQXZhdGFyVGFibGUoKTsKCiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNU
IG1pbWVfdHlwZSwgZGF0YSAiICsKICAgICAgIkZST00gcGVvcGxlX3Byb2ZpbGVfYXZhdGFycyAiICsKICAgICAgIldIRVJFIGFjY291bnRfaWQgPSAkMSBM
SU1JVCAxIiwKICAgICAgW293bmVySWRdCiAgICApOwoKICAgIGNvbnN0IHJvdyA9IHJlc3VsdC5yb3dzWzBdOwoKICAgIGlmICghcm93KSByZXR1cm4gbnVs
bDsKCiAgICByZXR1cm4gewogICAgICBtaW1lOiByb3cubWltZV90eXBlLAogICAgICBkYXRhOiByb3cuZGF0YQogICAgfTsKICB9CgogIGNvbnN0IG1ldGEg
PSBwZW9wbGVSZWFkQXZhdGFyTWV0YSgpOwogIGNvbnN0IGl0ZW0gPSBtZXRhW293bmVySWRdOwoKICBpZiAoIWl0ZW0/LmZpbGUpIHJldHVybiBudWxsOwoK
ICBjb25zdCBmaWxlUGF0aCA9CiAgICBwYXRoQWNjb3VudHMuam9pbigKICAgICAgUEVPUExFX0xPQ0FMX0FWQVRBUl9ESVIsCiAgICAgIGl0ZW0uZmlsZQog
ICAgKTsKCiAgaWYgKCFmc0FjY291bnRzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIHJldHVybiB7CiAgICBtaW1l
OiBpdGVtLm1pbWUsCiAgICBkYXRhOiBmc0FjY291bnRzLnJlYWRGaWxlU3luYyhmaWxlUGF0aCkKICB9Owp9CgphcHAuZ2V0KAogICIvYXBpL3Byb2ZpbGUv
YXZhdGFyLzp1c2VybmFtZSIsCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0cnkgewogICAgICBjb25zdCBzZXNzaW9uID0KICAgICAgICBwZW9wbGVT
ZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CgogICAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICAgIGNvbnN0IGFjY291bnQgPQogICAgICAgIGF3
YWl0IHBlb3BsZUZpbmRBY2NvdW50KAogICAgICAgICAgcmVxLnBhcmFtcy51c2VybmFtZQogICAgICAgICk7CgogICAgICBpZiAoIWFjY291bnQpIHsKICAg
ICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmVuZCgpOwogICAgICB9CgogICAgICBjb25zdCBhdmF0YXIgPQogICAgICAgIGF3YWl0IHBlb3BsZUxvYWRB
dmF0YXIoYWNjb3VudC5pZCk7CgogICAgICBpZiAoIWF2YXRhcikgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuZW5kKCk7CiAgICAgIH0KCiAg
ICAgIHJlcy5zZXRIZWFkZXIoIkNvbnRlbnQtVHlwZSIsIGF2YXRhci5taW1lKTsKICAgICAgcmVzLnNldEhlYWRlcigKICAgICAgICAiQ29udGVudC1MZW5n
dGgiLAogICAgICAgIFN0cmluZyhhdmF0YXIuZGF0YS5sZW5ndGgpCiAgICAgICk7CiAgICAgIHJlcy5zZXRIZWFkZXIoCiAgICAgICAgIlgtQ29udGVudC1U
eXBlLU9wdGlvbnMiLAogICAgICAgICJub3NuaWZmIgogICAgICApOwogICAgICByZXMuc2V0SGVhZGVyKAogICAgICAgICJDYWNoZS1Db250cm9sIiwKICAg
ICAgICAicHJpdmF0ZSwgbm8tc3RvcmUiCiAgICAgICk7CgogICAgICByZXMuZW5kKGF2YXRhci5kYXRhKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBj
b25zb2xlLmVycm9yKAogICAgICAgICJbUGVvcGxlIGF2YXRhci9nZXRdIiwKICAgICAgICBlcnIKICAgICAgKTsKCiAgICAgIHJlcy5zdGF0dXMoNTAwKS5l
bmQoKTsKICAgIH0KICB9Cik7CgphcHAucHV0KAogICIvYXBpL3Byb2ZpbGUvYXZhdGFyIiwKICBleHByZXNzLnJhdyh7CiAgICB0eXBlOiAoKSA9PiB0cnVl
LAogICAgbGltaXQ6ICIzbWIiCiAgfSksCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0cnkgewogICAgICBjb25zdCBzZXNzaW9uID0KICAgICAgICBw
ZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CgogICAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICAgIGNvbnN0IHNhdmVkID0KICAgICAg
ICBhd2FpdCBwZW9wbGVTYXZlQXZhdGFyKAogICAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAgIHJlcS5ib2R5CiAgICAgICAgKTsKCiAgICAgIGNvbnN0
IHZlcmlmaWVkQXZhdGFyID0KICAgICAgICBhd2FpdCBwZW9wbGVMb2FkQXZhdGFyKAogICAgICAgICAgc2Vzc2lvbi5pZAogICAgICAgICk7CgogICAgICBp
ZiAoCiAgICAgICAgIXZlcmlmaWVkQXZhdGFyIHx8CiAgICAgICAgIUJ1ZmZlci5pc0J1ZmZlcigKICAgICAgICAgIHZlcmlmaWVkQXZhdGFyLmRhdGEKICAg
ICAgICApIHx8CiAgICAgICAgdmVyaWZpZWRBdmF0YXIuZGF0YS5sZW5ndGggPD0gMAogICAgICApIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoCiAgICAg
ICAgICAiQVZBVEFSX1ZFUklGWV9GQUlMRUQiCiAgICAgICAgKTsKICAgICAgfQoKICAgICAgY29uc3QgYWNjb3VudCA9CiAgICAgICAgYXdhaXQgcGVvcGxl
RmluZEFjY291bnRCeUlkKAogICAgICAgICAgc2Vzc2lvbi5pZAogICAgICAgICk7CgogICAgICBpZiAoIWFjY291bnQpIHsKICAgICAgICByZXR1cm4gcmVz
LnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJDb21wdGUgaW50cm91dmFibGUuIgogICAgICAgIH0p
OwogICAgICB9CgogICAgICBpby5lbWl0KAogICAgICAgICJwcm9maWxlLWF2YXRhci11cGRhdGVkIiwKICAgICAgICB7CiAgICAgICAgICB1c2VybmFtZTog
YWNjb3VudC51c2VybmFtZQogICAgICAgIH0KICAgICAgKTsKCiAgICAgIHJlcy5qc29uKHsKICAgICAgICBvazogdHJ1ZSwKICAgICAgICB1c2VybmFtZTog
YWNjb3VudC51c2VybmFtZSwKICAgICAgICBtaW1lOiBzYXZlZC5taW1lLAogICAgICAgIGJ5dGVTaXplOiBzYXZlZC5ieXRlU2l6ZQogICAgICB9KTsKICAg
IH0gY2F0Y2ggKGVycikgewogICAgICBpZiAoCiAgICAgICAgZXJyPy50eXBlID09PSAiZW50aXR5LnRvby5sYXJnZSIgfHwKICAgICAgICBlcnI/LmNvZGUg
PT09ICJBVkFUQVJfU0laRSIKICAgICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDEzKS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAg
ICAgICAgIGVycm9yOgogICAgICAgICAgICAiTGEgcGhvdG8gZGUgcHJvZmlsIGRvaXQgZmFpcmUgbW9pbnMgZGUgMyBNby4iCiAgICAgICAgfSk7CiAgICAg
IH0KCiAgICAgIGlmIChlcnI/LmNvZGUgPT09ICJBVkFUQVJfVFlQRSIpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oewogICAgICAg
ICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICJGb3JtYXQgbm9uIGFjY2VwdGUuIEpQRUcsIFBORywgV2ViUCBvdSBHSUYuIgog
ICAgICAgIH0pOwogICAgICB9CgogICAgICBpZiAoCiAgICAgICAgZXJyPy5tZXNzYWdlID09PQogICAgICAgICJBVkFUQVJfVkVSSUZZX0ZBSUxFRCIKICAg
ICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAg
ICAgICAiTGEgcGhvdG8gYSDDqXTDqSByZcOndWUgbWFpcyBuJ2EgcGFzIHB1IMOqdHJlIHJlbHVlIGRlcHVpcyBsZSBzdG9ja2FnZS4iCiAgICAgICAgfSk7
CiAgICAgIH0KCiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUgYXZhdGFyL3VwbG9hZF0iLAogICAgICAgIGVycgogICAgICApOwoKICAg
ICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAgICAgICJJbXBvc3NpYmxlIGRlIGNoYW5n
ZXIgbGEgcGhvdG8gZGUgcHJvZmlsLiIKICAgICAgfSk7CiAgICB9CiAgfQopOwovLyA9PT0gUEVPUExFX1BST0ZJTEVfQVZBVEFSU19WMV9FTkQgPT09Cgov
LyA9PT0gUEVPUExFX0FWQVRBUl9VTFRSQV9VUExPQURfVjFfU1RBUlQgPT09CmFwcC5wdXQoCiAgIi9hcGkvcHJvZmlsZS9hdmF0YXItdWx0cmEiLAogIGFz
eW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QoCiAgICAg
ICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCBlbmNvZGVkID0KICAg
ICAgICBTdHJpbmcoCiAgICAgICAgICByZXEuYm9keT8uZGF0YSB8fAogICAgICAgICAgIiIKICAgICAgICApLnRyaW0oKTsKCiAgICAgIGlmICgKICAgICAg
ICAhZW5jb2RlZCB8fAogICAgICAgIGVuY29kZWQubGVuZ3RoID4KICAgICAgICAgIDI2MDAwCiAgICAgICkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVz
KDQxMykuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIkxhIHBob3RvIGNvbXByZXNzw6llIGVzdCBl
bmNvcmUgdHJvcCBsb3VyZGUuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICBsZXQgYnVmZmVyID0gbnVsbDsKCiAgICAgIHRyeSB7CiAgICAgICAgYnVm
ZmVyID0KICAgICAgICAgIEJ1ZmZlci5mcm9tKAogICAgICAgICAgICBlbmNvZGVkLAogICAgICAgICAgICAiYmFzZTY0IgogICAgICAgICAgKTsKICAgICAg
fSBjYXRjaCB7CiAgICAgICAgYnVmZmVyID0gbnVsbDsKICAgICAgfQoKICAgICAgaWYgKAogICAgICAgICFCdWZmZXIuaXNCdWZmZXIoCiAgICAgICAgICBi
dWZmZXIKICAgICAgICApIHx8CiAgICAgICAgYnVmZmVyLmxlbmd0aCA8PSAwIHx8CiAgICAgICAgYnVmZmVyLmxlbmd0aCA+CiAgICAgICAgICAxOCAqIDEw
MjQKICAgICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDEzKS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgog
ICAgICAgICAgICAiTGEgcGhvdG8gY29tcHJlc3PDqWUgZMOpcGFzc2UgbGEgbGltaXRlLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgY29uc3QgbWlt
ZSA9CiAgICAgICAgcGVvcGxlQXZhdGFyTWltZSgKICAgICAgICAgIGJ1ZmZlcgogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgbWltZSAhPT0KICAg
ICAgICAiaW1hZ2UvanBlZyIKICAgICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAg
ICAgICAgIGVycm9yOgogICAgICAgICAgICAiTGEgcGhvdG8gZmluYWxlIGRvaXQgw6p0cmUgZW4gSlBFRy4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAg
IGNvbnN0IHNhdmVkID0KICAgICAgICBhd2FpdCBwZW9wbGVTYXZlQXZhdGFyKAogICAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAgIGJ1ZmZlcgogICAg
ICAgICk7CgogICAgICBjb25zdCB2ZXJpZmllZCA9CiAgICAgICAgYXdhaXQgcGVvcGxlTG9hZEF2YXRhcigKICAgICAgICAgIHNlc3Npb24uaWQKICAgICAg
ICApOwoKICAgICAgaWYgKAogICAgICAgICF2ZXJpZmllZCB8fAogICAgICAgICFCdWZmZXIuaXNCdWZmZXIoCiAgICAgICAgICB2ZXJpZmllZC5kYXRhCiAg
ICAgICAgKSB8fAogICAgICAgIHZlcmlmaWVkLmRhdGEubGVuZ3RoIDw9IDAKICAgICAgKSB7CiAgICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICAg
IkFWQVRBUl9VTFRSQV9WRVJJRlkiCiAgICAgICAgKTsKICAgICAgfQoKICAgICAgY29uc3QgYWNjb3VudCA9CiAgICAgICAgYXdhaXQgcGVvcGxlRmluZEFj
Y291bnRCeUlkKAogICAgICAgICAgc2Vzc2lvbi5pZAogICAgICAgICk7CgogICAgICBpZiAoIWFjY291bnQpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1
cyg0MDQpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICJDb21wdGUgaW50cm91dmFibGUuIgogICAg
ICAgIH0pOwogICAgICB9CgogICAgICBpby5lbWl0KAogICAgICAgICJwcm9maWxlLWF2YXRhci11cGRhdGVkIiwKICAgICAgICB7CiAgICAgICAgICB1c2Vy
bmFtZToKICAgICAgICAgICAgYWNjb3VudC51c2VybmFtZQogICAgICAgIH0KICAgICAgKTsKCiAgICAgIHJlcy5qc29uKHsKICAgICAgICBvazogdHJ1ZSwK
ICAgICAgICB1c2VybmFtZToKICAgICAgICAgIGFjY291bnQudXNlcm5hbWUsCiAgICAgICAgYnl0ZVNpemU6CiAgICAgICAgICBzYXZlZC5ieXRlU2l6ZSwK
ICAgICAgICBtaW1lOgogICAgICAgICAgc2F2ZWQubWltZSwKICAgICAgICBhdmF0YXJEYXRhVXJsOgogICAgICAgICAgImRhdGE6IiArCiAgICAgICAgICAo
CiAgICAgICAgICAgIHZlcmlmaWVkLm1pbWUgfHwKICAgICAgICAgICAgc2F2ZWQubWltZSB8fAogICAgICAgICAgICAiaW1hZ2UvanBlZyIKICAgICAgICAg
ICkgKwogICAgICAgICAgIjtiYXNlNjQsIiArCiAgICAgICAgICB2ZXJpZmllZC5kYXRhLnRvU3RyaW5nKAogICAgICAgICAgICAiYmFzZTY0IgogICAgICAg
ICAgKQogICAgICB9KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xlLmVycm9yKAogICAgICAgICJbUGVvcGxlIGF2YXRhci91bHRyYV0iLAog
ICAgICAgIGVycgogICAgICApOwoKICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAg
ICAgICJJbXBvc3NpYmxlIGQnZW5yZWdpc3RyZXIgbGEgcGhvdG8gZGUgcHJvZmlsLiIKICAgICAgfSk7CiAgICB9CiAgfQopOwovLyA9PT0gUEVPUExFX0FW
QVRBUl9VTFRSQV9VUExPQURfVjFfRU5EID09PQoKLy8gPT09IFBFT1BMRV9BVkFUQVJfSlNPTl9ESVNQTEFZX1YxX1NUQVJUID09PQphcHAuZ2V0KAogICIv
YXBpL3Byb2ZpbGUvYXZhdGFyLWpzb24vOnVzZXJuYW1lIiwKICBhc3luYyAocmVxLCByZXMpID0+IHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24g
PQogICAgICAgIHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KAogICAgICAgICAgcmVxLAogICAgICAgICAgcmVzCiAgICAgICAgKTsKCiAgICAgIGlmICghc2Vz
c2lvbikgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc3QgYWNjb3VudCA9CiAgICAgICAgYXdhaXQgcGVvcGxlRmluZEFjY291bnQoCiAg
ICAgICAgICByZXEucGFyYW1zLnVzZXJuYW1lCiAgICAgICAgKTsKCiAgICAgIGlmICghYWNjb3VudCkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQw
NCkuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIlByb2ZpbCBpbnRyb3V2YWJsZS4iCiAgICAgICAg
fSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IGF2YXRhciA9CiAgICAgICAgYXdhaXQgcGVvcGxlTG9hZEF2YXRhcigKICAgICAgICAgIGFjY291bnQuaWQKICAg
ICAgICApOwoKICAgICAgaWYgKAogICAgICAgICFhdmF0YXIgfHwKICAgICAgICAhQnVmZmVyLmlzQnVmZmVyKAogICAgICAgICAgYXZhdGFyLmRhdGEKICAg
ICAgICApIHx8CiAgICAgICAgYXZhdGFyLmRhdGEubGVuZ3RoIDw9IDAKICAgICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcy5qc29uKHsKICAgICAgICAgIG9r
OiB0cnVlLAogICAgICAgICAgYXZhdGFyOiBudWxsCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIHJlcy5zZXRIZWFkZXIoCiAgICAgICAgIkNhY2hlLUNv
bnRyb2wiLAogICAgICAgICJwcml2YXRlLCBuby1zdG9yZSIKICAgICAgKTsKCiAgICAgIHJlcy5qc29uKHsKICAgICAgICBvazogdHJ1ZSwKICAgICAgICBh
dmF0YXI6IHsKICAgICAgICAgIG1pbWU6CiAgICAgICAgICAgIGF2YXRhci5taW1lIHx8CiAgICAgICAgICAgICJpbWFnZS9qcGVnIiwKICAgICAgICAgIGRh
dGE6CiAgICAgICAgICAgIGF2YXRhci5kYXRhLnRvU3RyaW5nKAogICAgICAgICAgICAgICJiYXNlNjQiCiAgICAgICAgICAgICksCiAgICAgICAgICBieXRl
U2l6ZToKICAgICAgICAgICAgYXZhdGFyLmRhdGEubGVuZ3RoCiAgICAgICAgfQogICAgICB9KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xl
LmVycm9yKAogICAgICAgICJbUGVvcGxlIGF2YXRhci9qc29uXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7
CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIkltcG9zc2libGUgZGUgY2hhcmdlciBsYSBwaG90byBkZSBwcm9maWwuIgog
ICAgICB9KTsKICAgIH0KICB9Cik7Ci8vID09PSBQRU9QTEVfQVZBVEFSX0pTT05fRElTUExBWV9WMV9FTkQgPT09CgovLyA9PT0gUEVPUExFX0FQUEVBUkFO
Q0VfUk9VVEVTX1YyX1NUQVJUID09PQphcHAuZ2V0KAogICIvYXBpL3NldHRpbmdzL2FwcGVhcmFuY2UiLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAg
dHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47
CgogICAgICBjb25zdCBhcHBlYXJhbmNlID0gYXdhaXQgcGVvcGxlR2V0QXBwZWFyYW5jZShzZXNzaW9uLmlkKTsKCiAgICAgIGlmICghYXBwZWFyYW5jZSkg
ewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjogIkNvbXB0ZSBpbnRy
b3V2YWJsZS4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIHJldHVybiByZXMuanNvbih7CiAgICAgICAgb2s6IHRydWUsCiAgICAgICAgYXBwZWFyYW5j
ZQogICAgICB9KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxlIGFwcGVhcmFuY2UvZ2V0XSIsIGVycik7CiAgICAg
IHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIGwn
YXBwYXJlbmNlLiIKICAgICAgfSk7CiAgICB9CiAgfQopOwoKYXBwLnB1dCgKICAiL2FwaS9zZXR0aW5ncy9hcHBlYXJhbmNlIiwKICBhc3luYyAocmVxLCBy
ZXMpID0+IHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CiAgICAgIGlmICghc2Vz
c2lvbikgcmV0dXJuOwoKICAgICAgY29uc3QgcmF3VGhlbWUgPSBTdHJpbmcocmVxLmJvZHk/LnRoZW1lIHx8ICIiKQogICAgICAgIC50cmltKCkKICAgICAg
ICAudG9Mb3dlckNhc2UoKTsKCiAgICAgIGlmICghUEVPUExFX0FQUEVBUkFOQ0VfVEhFTUVTLmhhcyhyYXdUaGVtZSkpIHsKICAgICAgICByZXR1cm4gcmVz
LnN0YXR1cyg0MDApLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJUaMOobWUgZCdhcHBhcmVuY2UgaW52YWxpZGUuIgog
ICAgICAgIH0pOwogICAgICB9CgogICAgICBjb25zdCBjdXJyZW50QXBwZWFyYW5jZSA9IGF3YWl0IHBlb3BsZUdldEFwcGVhcmFuY2Uoc2Vzc2lvbi5pZCk7
CgogICAgICBpZiAoIWN1cnJlbnRBcHBlYXJhbmNlKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxz
ZSwKICAgICAgICAgIGVycm9yOiAiQ29tcHRlIGludHJvdXZhYmxlLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgbGV0IHJhd1BhbGV0dGUgPSByZXEu
Ym9keT8ucGFsZXR0ZTsKCiAgICAgIGlmIChyYXdQYWxldHRlID09IG51bGwpIHsKICAgICAgICByYXdQYWxldHRlID0gewogICAgICAgICAgLi4uY3VycmVu
dEFwcGVhcmFuY2UucGFsZXR0ZSwKICAgICAgICAgIGFjY2VudDoKICAgICAgICAgICAgcmVxLmJvZHk/LmFjY2VudCA9PSBudWxsCiAgICAgICAgICAgICAg
PyBjdXJyZW50QXBwZWFyYW5jZS5wYWxldHRlLmFjY2VudAogICAgICAgICAgICAgIDogcmVxLmJvZHkuYWNjZW50CiAgICAgICAgfTsKICAgICAgfQoKICAg
ICAgaWYgKAogICAgICAgICFyYXdQYWxldHRlIHx8CiAgICAgICAgdHlwZW9mIHJhd1BhbGV0dGUgIT09ICJvYmplY3QiIHx8CiAgICAgICAgQXJyYXkuaXNB
cnJheShyYXdQYWxldHRlKQogICAgICApIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAg
ICAgICAgZXJyb3I6ICJQYWxldHRlIGQnYXBwYXJlbmNlIGludmFsaWRlLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgZm9yIChjb25zdCBrZXkgb2Yg
UEVPUExFX0FQUEVBUkFOQ0VfUEFMRVRURV9LRVlTKSB7CiAgICAgICAgY29uc3QgdmFsdWUgPSBTdHJpbmcocmF3UGFsZXR0ZVtrZXldIHx8ICIiKQogICAg
ICAgICAgLnRyaW0oKQogICAgICAgICAgLnRvVXBwZXJDYXNlKCk7CgogICAgICAgIGlmICghL14jWzAtOUEtRl17Nn0kLy50ZXN0KHZhbHVlKSkgewogICAg
ICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjogIkNvdWxldXIgaW52
YWxpZGUgcG91ciAiICsga2V5ICsgIi4iCiAgICAgICAgICB9KTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIGlmIChyYXdQYWxldHRlLmdyYWRpZW50ICE9
IG51bGwpIHsKICAgICAgICBjb25zdCBncmFkaWVudCA9IHJhd1BhbGV0dGUuZ3JhZGllbnQ7CiAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gTnVtYmVyKGdy
YWRpZW50Py5kaXJlY3Rpb24pOwogICAgICAgIGNvbnN0IGludGVuc2l0eSA9IE51bWJlcihncmFkaWVudD8uaW50ZW5zaXR5KTsKICAgICAgICBjb25zdCBn
cmFkaWVudENvbG9ycyA9IFsKICAgICAgICAgIGdyYWRpZW50Py5zdGFydCwKICAgICAgICAgIGdyYWRpZW50Py5taWRkbGUsCiAgICAgICAgICBncmFkaWVu
dD8uZW5kCiAgICAgICAgXTsKCiAgICAgICAgaWYgKAogICAgICAgICAgIWdyYWRpZW50IHx8CiAgICAgICAgICB0eXBlb2YgZ3JhZGllbnQgIT09ICJvYmpl
Y3QiIHx8CiAgICAgICAgICBBcnJheS5pc0FycmF5KGdyYWRpZW50KSB8fAogICAgICAgICAgIU51bWJlci5pc0Zpbml0ZShkaXJlY3Rpb24pIHx8CiAgICAg
ICAgICBkaXJlY3Rpb24gPCAwIHx8CiAgICAgICAgICBkaXJlY3Rpb24gPiAzNjAgfHwKICAgICAgICAgICFOdW1iZXIuaXNGaW5pdGUoaW50ZW5zaXR5KSB8
fAogICAgICAgICAgaW50ZW5zaXR5IDwgMCB8fAogICAgICAgICAgaW50ZW5zaXR5ID4gMTAwIHx8CiAgICAgICAgICBncmFkaWVudENvbG9ycy5zb21lKChj
b2xvcikgPT4KICAgICAgICAgICAgY29sb3IgIT0gbnVsbCAmJiAhL14jWzAtOUEtRl17Nn0kL2kudGVzdChTdHJpbmcoY29sb3IpLnRyaW0oKSkKICAgICAg
ICAgICkKICAgICAgICApIHsKICAgICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAg
ICAgZXJyb3I6ICJSw6lnbGFnZXMgZGUgZMOpZ3JhZMOpIGludmFsaWRlcy4iCiAgICAgICAgICB9KTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIGNvbnN0
IGFwcGVhcmFuY2UgPSBhd2FpdCBwZW9wbGVVcGRhdGVBcHBlYXJhbmNlKAogICAgICAgIHNlc3Npb24uaWQsCiAgICAgICAgcmF3VGhlbWUsCiAgICAgICAg
ewogICAgICAgICAgcGFsZXR0ZTogcmF3UGFsZXR0ZSwKICAgICAgICAgIGFjY2VudDogcmF3UGFsZXR0ZS5hY2NlbnQKICAgICAgICB9CiAgICAgICk7Cgog
ICAgICBpZiAoIWFwcGVhcmFuY2UpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAg
ICAgZXJyb3I6ICJDb21wdGUgaW50cm91dmFibGUuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICByZXR1cm4gcmVzLmpzb24oewogICAgICAgIG9rOiB0
cnVlLAogICAgICAgIGFwcGVhcmFuY2UKICAgICAgfSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBhcHBlYXJh
bmNlL3B1dF0iLCBlcnIpOwogICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjogIklt
cG9zc2libGUgZCdlbnJlZ2lzdHJlciBsJ2FwcGFyZW5jZS4iCiAgICAgIH0pOwogICAgfQogIH0KKTsKLy8gPT09IFBFT1BMRV9BUFBFQVJBTkNFX1JPVVRF
U19WMl9FTkQgPT09CgphcHAuZ2V0KCIvYXBpL3Byb2ZpbGUvOnVzZXJuYW1lIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNl
c3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CiAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICBjb25zdCBhY2NvdW50ID0g
YXdhaXQgcGVvcGxlRmluZEFjY291bnQocmVxLnBhcmFtcy51c2VybmFtZSk7CgogICAgaWYgKCFhY2NvdW50KSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVz
KDQwNCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOiAiUHJvZmlsIGludHJvdXZhYmxlLiIKICAgICAgfSk7CiAgICB9CgogICAg
Y29uc3QgcmVsYXRpb24gPSBhd2FpdCBwZW9wbGVGcmllbmRSZWxhdGlvbigKICAgICAgc2Vzc2lvbi5pZCwKICAgICAgYWNjb3VudC5pZAogICAgKTsKCiAg
ICByZXR1cm4gcmVzLmpzb24oewogICAgICBvazogdHJ1ZSwKICAgICAgcHJvZmlsZTogewogICAgICAgIC4uLnBlb3BsZVB1YmxpY0FjY291bnQoYWNjb3Vu
dCksCiAgICAgICAgb25saW5lOiBwZW9wbGVBY2NvdW50SXNPbmxpbmUoYWNjb3VudC5pZCksCiAgICAgICAgaXNGcmllbmQ6IHJlbGF0aW9uLmlzRnJpZW5k
LAogICAgICAgIGZyaWVuZFJlcXVlc3Q6IHJlbGF0aW9uLmZyaWVuZFJlcXVlc3QsCiAgICAgICAgZnJpZW5kUmVxdWVzdElkOiByZWxhdGlvbi5mcmllbmRS
ZXF1ZXN0SWQsCiAgICAgICAgaXNTZWxmOiBTdHJpbmcoYWNjb3VudC5pZCkgPT09IFN0cmluZyhzZXNzaW9uLmlkKQogICAgICB9CiAgICB9KTsKICB9IGNh
dGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgcHJvZmlsZS9nZXRdIiwgZXJyKTsKICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAg
ICAgb2s6IGZhbHNlLAogICAgICBlcnJvcjogIkltcG9zc2libGUgZGUgY2hhcmdlciBjZSBwcm9maWwuIgogICAgfSk7CiAgfQp9KTsKCmFwcC5wdXQoIi9h
cGkvcHJvZmlsZS9tZSIsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3Qo
cmVxLCByZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgY29uc3QgZGVzY3JpcHRpb24gPSBTdHJpbmcoCiAgICAgIHJlcS5ib2R5Py5kZXNj
cmlwdGlvbiB8fCAiIgogICAgKS50cmltKCk7CgogICAgaWYgKGRlc2NyaXB0aW9uLmxlbmd0aCA+IDI4MCkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0
MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjogIkxhIGRlc2NyaXB0aW9uIGVzdCBsaW1pdGVlIGEgMjgwIGNhcmFjdGVyZXMu
IgogICAgICB9KTsKICAgIH0KCiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgcGVvcGxlVXBkYXRlRGVzY3JpcHRpb24oCiAgICAgIHNlc3Npb24uaWQsCiAg
ICAgIGRlc2NyaXB0aW9uCiAgICApOwoKICAgIGlmICghYWNjb3VudCkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgIG9r
OiBmYWxzZSwKICAgICAgICBlcnJvcjogIkNvbXB0ZSBpbnRyb3V2YWJsZS4iCiAgICAgIH0pOwogICAgfQoKICAgIHJlcy5qc29uKHsKICAgICAgb2s6IHRy
dWUsCiAgICAgIHByb2ZpbGU6IHsKICAgICAgICAuLi5wZW9wbGVQdWJsaWNBY2NvdW50KGFjY291bnQpLAogICAgICAgIG9ubGluZTogdHJ1ZSwKICAgICAg
ICBpc0ZyaWVuZDogZmFsc2UsCiAgICAgICAgaXNTZWxmOiB0cnVlCiAgICAgIH0KICAgIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJv
cigiW1Blb3BsZSBwcm9maWxlL3VwZGF0ZV0iLCBlcnIpOwogICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9y
OiAiSW1wb3NzaWJsZSBkZSBtb2RpZmllciBsZSBwcm9maWwuIgogICAgfSk7CiAgfQp9KTsKCmFwcC5nZXQoIi9hcGkvc29jaWFsL3Blb3BsZSIsIGFzeW5j
IChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFz
ZXNzaW9uKSByZXR1cm47CgogICAgY29uc3QgcXVlcnkgPQogICAgICBTdHJpbmcocmVxLnF1ZXJ5LnEgfHwgIiIpCiAgICAgICAgLnRyaW0oKQogICAgICAg
IC5zbGljZSgwLCA1MCk7CgogICAgY29uc3QgZnJpZW5kSWRzID0gbmV3IFNldCgKICAgICAgYXdhaXQgcGVvcGxlRnJpZW5kSWRzKHNlc3Npb24uaWQpCiAg
ICApOwoKICAgIGNvbnN0IHJlcXVlc3RSb3dzID0KICAgICAgYXdhaXQgcGVvcGxlRnJpZW5kUmVxdWVzdFJvd3Moc2Vzc2lvbi5pZCk7CgogICAgY29uc3Qg
cmVxdWVzdEJ5T3RoZXIgPSBuZXcgTWFwKCk7CgogICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIHJlcXVlc3RSb3dzKSB7CiAgICAgIGNvbnN0IG91dGdvaW5n
ID0KICAgICAgICBTdHJpbmcocmVxdWVzdC5zZW5kZXJfaWQpID09PQogICAgICAgIFN0cmluZyhzZXNzaW9uLmlkKTsKCiAgICAgIGNvbnN0IG90aGVySWQg
PSBvdXRnb2luZwogICAgICAgID8gU3RyaW5nKHJlcXVlc3QucmVjaXBpZW50X2lkKQogICAgICAgIDogU3RyaW5nKHJlcXVlc3Quc2VuZGVyX2lkKTsKCiAg
ICAgIHJlcXVlc3RCeU90aGVyLnNldChvdGhlcklkLCB7CiAgICAgICAgZnJpZW5kUmVxdWVzdDoKICAgICAgICAgIG91dGdvaW5nID8gIm91dGdvaW5nIiA6
ICJpbmNvbWluZyIsCiAgICAgICAgZnJpZW5kUmVxdWVzdElkOiBTdHJpbmcocmVxdWVzdC5pZCkKICAgICAgfSk7CiAgICB9CgogICAgbGV0IGFjY291bnRz
ID0gW107CgogICAgaWYgKHF1ZXJ5KSB7CiAgICAgIC8qCiAgICAgICAgUmVjaGVyY2hlIHZvbG9udGFpcmUgOgogICAgICAgIG9uIHBldXQgcmV0cm91dmVy
IHVuIG5vdXZlYXUgY29tcHRlCiAgICAgICAgdW5pcXVlbWVudCBxdWFuZCBsJ3V0aWxpc2F0ZXVyIHRhcGUKICAgICAgICByw6llbGxlbWVudCB1biBwc2V1
ZG8uCiAgICAgICovCiAgICAgIGFjY291bnRzID0KICAgICAgICBhd2FpdCBwZW9wbGVMaXN0QWNjb3VudHMoCiAgICAgICAgICBxdWVyeQogICAgICAgICk7
CiAgICB9IGVsc2UgewogICAgICAvKgogICAgICAgIEF1Y3VuIGFubnVhaXJlIGdsb2JhbCBhdSByZXBvcy4KICAgICAgICBPbiBuZSBtb250cmUgaWNpIHF1
ZSBsZXMgY29tcHRlcwogICAgICAgIGF2ZWMgbGVzcXVlbHMgdW4gTVAgZXhpc3RlIGTDqWrDoC4KCiAgICAgICAgTGVzIGFtaXMgZXQgZGVtYW5kZXMgc29u
dCBleGNsdXMKICAgICAgICBjYXIgaWxzIHNvbnQgZMOpasOgIGFmZmljaMOpcyBqdXN0ZQogICAgICAgIGF1LWRlc3N1cyBkYW5zIGxldXJzIHByb3ByZXMg
em9uZXMuCiAgICAgICovCiAgICAgIGNvbnN0IGNvbnZlcnNhdGlvbnMgPQogICAgICAgIGF3YWl0IHBlb3BsZURtQ29udmVyc2F0aW9ucygKICAgICAgICAg
IHNlc3Npb24uaWQKICAgICAgICApOwoKICAgICAgZm9yICgKICAgICAgICBjb25zdCBjb252ZXJzYXRpb24KICAgICAgICBvZiBjb252ZXJzYXRpb25zCiAg
ICAgICkgewogICAgICAgIGNvbnN0IGFjY291bnQgPQogICAgICAgICAgY29udmVyc2F0aW9uPy51c2VyOwoKICAgICAgICBpZiAoCiAgICAgICAgICAhYWNj
b3VudD8uaWQKICAgICAgICApIHsKICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KCiAgICAgICAgY29uc3QgaWQgPQogICAgICAgICAgU3RyaW5nKGFj
Y291bnQuaWQpOwoKICAgICAgICBpZiAoCiAgICAgICAgICBmcmllbmRJZHMuaGFzKGlkKSB8fAogICAgICAgICAgcmVxdWVzdEJ5T3RoZXIuaGFzKGlkKQog
ICAgICAgICkgewogICAgICAgICAgY29udGludWU7CiAgICAgICAgfQoKICAgICAgICBhY2NvdW50cy5wdXNoKAogICAgICAgICAgYWNjb3VudAogICAgICAg
ICk7CiAgICAgIH0KICAgIH0KCiAgICBjb25zdCBzZWVuID0KICAgICAgbmV3IFNldCgpOwoKICAgIHJlcy5qc29uKHsKICAgICAgb2s6IHRydWUsCiAgICAg
IHBlb3BsZTogYWNjb3VudHMKICAgICAgICAuZmlsdGVyKAogICAgICAgICAgKGFjY291bnQpID0+IHsKICAgICAgICAgICAgY29uc3QgaWQgPQogICAgICAg
ICAgICAgIFN0cmluZygKICAgICAgICAgICAgICAgIGFjY291bnQ/LmlkIHx8ICIiCiAgICAgICAgICAgICAgKTsKCiAgICAgICAgICAgIGlmICgKICAgICAg
ICAgICAgICAhaWQgfHwKICAgICAgICAgICAgICBpZCA9PT0KICAgICAgICAgICAgICAgIFN0cmluZyhzZXNzaW9uLmlkKSB8fAogICAgICAgICAgICAgIHNl
ZW4uaGFzKGlkKQogICAgICAgICAgICApIHsKICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7CiAgICAgICAgICAgIH0KCiAgICAgICAgICAgIHNlZW4uYWRk
KGlkKTsKCiAgICAgICAgICAgIHJldHVybiB0cnVlOwogICAgICAgICAgfQogICAgICAgICkKICAgICAgICAubWFwKChhY2NvdW50KSA9PiB7CiAgICAgICAg
ICBjb25zdCBpZCA9CiAgICAgICAgICAgIFN0cmluZyhhY2NvdW50LmlkKTsKCiAgICAgICAgICBjb25zdCBwZW5kaW5nID0KICAgICAgICAgICAgcmVxdWVz
dEJ5T3RoZXIuZ2V0KGlkKSB8fAogICAgICAgICAgICB7fTsKCiAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAuLi5wZW9wbGVQdWJsaWNBY2NvdW50
KAogICAgICAgICAgICAgIGFjY291bnQKICAgICAgICAgICAgKSwKICAgICAgICAgICAgb25saW5lOgogICAgICAgICAgICAgIHBlb3BsZUFjY291bnRJc09u
bGluZSgKICAgICAgICAgICAgICAgIGFjY291bnQuaWQKICAgICAgICAgICAgICApLAogICAgICAgICAgICBpc0ZyaWVuZDoKICAgICAgICAgICAgICBmcmll
bmRJZHMuaGFzKGlkKSwKICAgICAgICAgICAgZnJpZW5kUmVxdWVzdDoKICAgICAgICAgICAgICBwZW5kaW5nLmZyaWVuZFJlcXVlc3QgfHwKICAgICAgICAg
ICAgICBudWxsLAogICAgICAgICAgICBmcmllbmRSZXF1ZXN0SWQ6CiAgICAgICAgICAgICAgcGVuZGluZy5mcmllbmRSZXF1ZXN0SWQgfHwKICAgICAgICAg
ICAgICBudWxsCiAgICAgICAgICB9OwogICAgICAgIH0pCiAgICB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc29j
aWFsL3Blb3BsZV0iLCBlcnIpOwoKICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAgICAgb2s6IGZhbHNlLAogICAgICBlcnJvcjogIkltcG9zc2libGUg
ZGUgY2hhcmdlciBsZXMgcGVyc29ubmVzLiIKICAgIH0pOwogIH0KfSk7CgphcHAuZ2V0KCIvYXBpL3NvY2lhbC9mcmllbmRzIiwgYXN5bmMgKHJlcSwgcmVz
KSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CiAgICBpZiAoIXNlc3Npb24pIHJl
dHVybjsKCiAgICBjb25zdCBpZHMgPSBhd2FpdCBwZW9wbGVGcmllbmRJZHMoc2Vzc2lvbi5pZCk7CiAgICBjb25zdCBhY2NvdW50cyA9CiAgICAgIGF3YWl0
IHBlb3BsZUZpbmRBY2NvdW50c0J5SWRzKGlkcyk7CiAgICBjb25zdCBmcmllbmRzID0gYWNjb3VudHMubWFwKAogICAgICAoYWNjb3VudCkgPT4gKHsKICAg
ICAgICAuLi5wZW9wbGVQdWJsaWNBY2NvdW50KGFjY291bnQpLAogICAgICAgIG9ubGluZToKICAgICAgICAgIHBlb3BsZUFjY291bnRJc09ubGluZSgKICAg
ICAgICAgICAgYWNjb3VudC5pZAogICAgICAgICAgKSwKICAgICAgICBpc0ZyaWVuZDogdHJ1ZQogICAgICB9KQogICAgKTsKCiAgICBmcmllbmRzLnNvcnQo
KGEsIGIpID0+IHsKICAgICAgaWYgKGEub25saW5lICE9PSBiLm9ubGluZSkgewogICAgICAgIHJldHVybiBhLm9ubGluZSA/IC0xIDogMTsKICAgICAgfQoK
ICAgICAgcmV0dXJuIGEudXNlcm5hbWUubG9jYWxlQ29tcGFyZSgKICAgICAgICBiLnVzZXJuYW1lLAogICAgICAgICJmciIsCiAgICAgICAgeyBzZW5zaXRp
dml0eTogImJhc2UiIH0KICAgICAgKTsKICAgIH0pOwoKICAgIHJlcy5qc29uKHsKICAgICAgb2s6IHRydWUsCiAgICAgIGZyaWVuZHMKICAgIH0pOwogIH0g
Y2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBzb2NpYWwvZnJpZW5kc10iLCBlcnIpOwogICAgcmVzLnN0YXR1cyg1MDApLmpzb24o
ewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIGxlcyBhbWlzLiIKICAgIH0pOwogIH0KfSk7CgphcHAuZ2V0
KCIvYXBpL3NvY2lhbC9mcmllbmQtcmVxdWVzdHMiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNl
c3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsKICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAgIGNvbnN0IHJvd3MgPQogICAgICBhd2FpdCBwZW9wbGVG
cmllbmRSZXF1ZXN0Um93cyhzZXNzaW9uLmlkKTsKCiAgICBjb25zdCBpbmNvbWluZyA9IFtdOwogICAgY29uc3Qgb3V0Z29pbmcgPSBbXTsKICAgIGNvbnN0
IG90aGVySWRzID0gcm93cy5tYXAoCiAgICAgIChyZXF1ZXN0KSA9PgogICAgICAgIFN0cmluZyhyZXF1ZXN0LnJlY2lwaWVudF9pZCkgPT09CiAgICAgICAg
U3RyaW5nKHNlc3Npb24uaWQpCiAgICAgICAgICA/IHJlcXVlc3Quc2VuZGVyX2lkCiAgICAgICAgICA6IHJlcXVlc3QucmVjaXBpZW50X2lkCiAgICApOwog
ICAgY29uc3QgcmVxdWVzdEFjY291bnRzID0KICAgICAgYXdhaXQgcGVvcGxlRmluZEFjY291bnRzQnlJZHMoCiAgICAgICAgb3RoZXJJZHMKICAgICAgKTsK
ICAgIGNvbnN0IHJlcXVlc3RBY2NvdW50c0J5SWQgPQogICAgICBuZXcgTWFwKAogICAgICAgIHJlcXVlc3RBY2NvdW50cy5tYXAoCiAgICAgICAgICAoYWNj
b3VudCkgPT4gWwogICAgICAgICAgICBTdHJpbmcoYWNjb3VudC5pZCksCiAgICAgICAgICAgIGFjY291bnQKICAgICAgICAgIF0KICAgICAgICApCiAgICAg
ICk7CgogICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIHJvd3MpIHsKICAgICAgY29uc3QgaXNJbmNvbWluZyA9CiAgICAgICAgU3RyaW5nKHJlcXVlc3QucmVj
aXBpZW50X2lkKSA9PT0KICAgICAgICBTdHJpbmcoc2Vzc2lvbi5pZCk7CgogICAgICBjb25zdCBvdGhlcklkID0gaXNJbmNvbWluZwogICAgICAgID8gcmVx
dWVzdC5zZW5kZXJfaWQKICAgICAgICA6IHJlcXVlc3QucmVjaXBpZW50X2lkOwoKICAgICAgY29uc3QgYWNjb3VudCA9CiAgICAgICAgcmVxdWVzdEFjY291
bnRzQnlJZC5nZXQoCiAgICAgICAgICBTdHJpbmcob3RoZXJJZCkKICAgICAgICApOwoKICAgICAgaWYgKCFhY2NvdW50KSBjb250aW51ZTsKCiAgICAgIGNv
bnN0IGl0ZW0gPSB7CiAgICAgICAgaWQ6IFN0cmluZyhyZXF1ZXN0LmlkKSwKICAgICAgICBjcmVhdGVkQXQ6IHJlcXVlc3QuY3JlYXRlZF9hdCwKICAgICAg
ICB1c2VyOiB7CiAgICAgICAgICAuLi5wZW9wbGVQdWJsaWNBY2NvdW50KGFjY291bnQpLAogICAgICAgICAgb25saW5lOgogICAgICAgICAgICBwZW9wbGVB
Y2NvdW50SXNPbmxpbmUoYWNjb3VudC5pZCkKICAgICAgICB9CiAgICAgIH07CgogICAgICBpZiAoaXNJbmNvbWluZykgaW5jb21pbmcucHVzaChpdGVtKTsK
ICAgICAgZWxzZSBvdXRnb2luZy5wdXNoKGl0ZW0pOwogICAgfQoKICAgIHJlcy5qc29uKHsKICAgICAgb2s6IHRydWUsCiAgICAgIGluY29taW5nLAogICAg
ICBvdXRnb2luZwogICAgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKAogICAgICAiW1Blb3BsZSBmcmllbmQtcmVxdWVzdHMvbGlz
dF0iLAogICAgICBlcnIKICAgICk7CgogICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOgogICAgICAgICJJ
bXBvc3NpYmxlIGRlIGNoYXJnZXIgbGVzIGRlbWFuZGVzIGQnYW1pLiIKICAgIH0pOwogIH0KfSk7CgphcHAucG9zdCgiL2FwaS9zb2NpYWwvZnJpZW5kcy86
dXNlcm5hbWUiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwg
cmVzKTsKICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAgIGNvbnN0IHRhcmdldCA9IGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50KAogICAgICByZXEucGFy
YW1zLnVzZXJuYW1lCiAgICApOwoKICAgIGlmICghdGFyZ2V0KSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7CiAgICAgICAgb2s6IGZh
bHNlLAogICAgICAgIGVycm9yOiAiVXRpbGlzYXRldXIgaW50cm91dmFibGUuIgogICAgICB9KTsKICAgIH0KCiAgICBpZiAoU3RyaW5nKHRhcmdldC5pZCkg
PT09IFN0cmluZyhzZXNzaW9uLmlkKSkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBl
cnJvcjoKICAgICAgICAgICJUdSBuZSBwZXV4IHBhcyB0J2Vudm95ZXIgdW5lIGRlbWFuZGUgYSB0b2ktbWVtZS4iCiAgICAgIH0pOwogICAgfQoKICAgIHRy
eSB7CiAgICAgIGNvbnN0IHJlcXVlc3QgPQogICAgICAgIGF3YWl0IHBlb3BsZUNyZWF0ZUZyaWVuZFJlcXVlc3QoCiAgICAgICAgICBzZXNzaW9uLmlkLAog
ICAgICAgICAgdGFyZ2V0LmlkCiAgICAgICAgKTsKCiAgICAgIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICAgICAgdGFyZ2V0LmlkLAogICAgICAgICJmcmll
bmQtc3RhdGUtY2hhbmdlZCIsCiAgICAgICAgewogICAgICAgICAgdHlwZTogInJlcXVlc3QiLAogICAgICAgICAgZnJvbTogc2Vzc2lvbi51c2VybmFtZQog
ICAgICAgIH0KICAgICAgKTsKCiAgICAgIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAiZnJpZW5kLXN0YXRlLWNo
YW5nZWQiLAogICAgICAgIHsKICAgICAgICAgIHR5cGU6ICJyZXF1ZXN0LXNlbnQiLAogICAgICAgICAgdG86IHRhcmdldC51c2VybmFtZQogICAgICAgIH0K
ICAgICAgKTsKCiAgICAgIHJldHVybiByZXMuanNvbih7CiAgICAgICAgb2s6IHRydWUsCiAgICAgICAgc3RhdGU6ICJvdXRnb2luZyIsCiAgICAgICAgcmVx
dWVzdElkOiByZXF1ZXN0CiAgICAgICAgICA/IFN0cmluZyhyZXF1ZXN0LmlkKQogICAgICAgICAgOiBudWxsCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJy
KSB7CiAgICAgIGlmIChlcnI/LmNvZGUgPT09ICJBTFJFQURZX0ZSSUVORFMiKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA5KS5qc29uKHsKICAg
ICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOiAiVm91cyBldGVzIGRlamEgYW1pcy4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGlmIChl
cnI/LmNvZGUgPT09ICJJTkNPTUlOR19FWElTVFMiKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA5KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxz
ZSwKICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAiQ2V0dGUgcGVyc29ubmUgdCdhIGRlamEgZW52b3llIHVuZSBkZW1hbmRlLiAiICsKICAgICAgICAg
ICAgIkFjY2VwdGUtbGEgZGFucyBEZW1hbmRlcyBkJ2FtaS4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIHRocm93IGVycjsKICAgIH0KICB9IGNhdGNo
IChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICJbUGVvcGxlIGZyaWVuZHMvcmVxdWVzdF0iLAogICAgICBlcnIKICAgICk7CgogICAgcmVzLnN0
YXR1cyg1MDApLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOgogICAgICAgICJJbXBvc3NpYmxlIGQnZW52b3llciBsYSBkZW1hbmRlIGQn
YW1pLiIKICAgIH0pOwogIH0KfSk7CgphcHAucG9zdCgKICAiL2FwaS9zb2NpYWwvZnJpZW5kLXJlcXVlc3RzLzppZC9hY2NlcHQiLAogIGFzeW5jIChyZXEs
IHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwoKICAg
ICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCBhY2NlcHRlZCA9CiAgICAgICAgYXdhaXQgcGVvcGxlQWNjZXB0RnJpZW5kUmVxdWVzdCgK
ICAgICAgICAgIHNlc3Npb24uaWQsCiAgICAgICAgICByZXEucGFyYW1zLmlkCiAgICAgICAgKTsKCiAgICAgIGlmICghYWNjZXB0ZWQpIHsKICAgICAgICBy
ZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJEZW1hbmRlIGQnYW1pIGludHJvdXZh
YmxlLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgcGVvcGxlRW1pdFRvQWNjb3VudCgKICAgICAgICBhY2NlcHRlZC5zZW5kZXJJZCwKICAgICAgICAi
ZnJpZW5kLXN0YXRlLWNoYW5nZWQiLAogICAgICAgIHsKICAgICAgICAgIHR5cGU6ICJhY2NlcHRlZCIsCiAgICAgICAgICBieTogc2Vzc2lvbi51c2VybmFt
ZQogICAgICAgIH0KICAgICAgKTsKCiAgICAgIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAiZnJpZW5kLXN0YXRl
LWNoYW5nZWQiLAogICAgICAgIHsgdHlwZTogImFjY2VwdGVkIiB9CiAgICAgICk7CgogICAgICByZXMuanNvbih7IG9rOiB0cnVlIH0pOwogICAgfSBjYXRj
aCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUgZnJpZW5kLXJlcXVlc3RzL2FjY2VwdF0iLAogICAgICAgIGVycgogICAg
ICApOwoKICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAgICAgICJJbXBvc3NpYmxl
IGQnYWNjZXB0ZXIgY2V0dGUgZGVtYW5kZS4iCiAgICAgIH0pOwogICAgfQogIH0KKTsKCmFwcC5kZWxldGUoCiAgIi9hcGkvc29jaWFsL2ZyaWVuZC1yZXF1
ZXN0cy86aWQiLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZv
clJlcXVlc3QocmVxLCByZXMpOwoKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCByZW1vdmVkID0KICAgICAgICBhd2FpdCBwZW9w
bGVEZWxldGVGcmllbmRSZXF1ZXN0KAogICAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAgIHJlcS5wYXJhbXMuaWQKICAgICAgICApOwoKICAgICAgaWYg
KCFyZW1vdmVkKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOiAi
RGVtYW5kZSBkJ2FtaSBpbnRyb3V2YWJsZS4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IG90aGVySWQgPQogICAgICAgIFN0cmluZyhyZW1v
dmVkLnNlbmRlcklkKSA9PT0KICAgICAgICBTdHJpbmcoc2Vzc2lvbi5pZCkKICAgICAgICAgID8gcmVtb3ZlZC5yZWNpcGllbnRJZAogICAgICAgICAgOiBy
ZW1vdmVkLnNlbmRlcklkOwoKICAgICAgcGVvcGxlRW1pdFRvQWNjb3VudCgKICAgICAgICBvdGhlcklkLAogICAgICAgICJmcmllbmQtc3RhdGUtY2hhbmdl
ZCIsCiAgICAgICAgeyB0eXBlOiAicmVxdWVzdC1yZW1vdmVkIiB9CiAgICAgICk7CgogICAgICBwZW9wbGVFbWl0VG9BY2NvdW50KAogICAgICAgIHNlc3Np
b24uaWQsCiAgICAgICAgImZyaWVuZC1zdGF0ZS1jaGFuZ2VkIiwKICAgICAgICB7IHR5cGU6ICJyZXF1ZXN0LXJlbW92ZWQiIH0KICAgICAgKTsKCiAgICAg
IHJlcy5qc29uKHsgb2s6IHRydWUgfSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigKICAgICAgICAiW1Blb3BsZSBmcmllbmQt
cmVxdWVzdHMvZGVsZXRlXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAog
ICAgICAgIGVycm9yOgogICAgICAgICAgIkltcG9zc2libGUgZGUgc3VwcHJpbWVyIGNldHRlIGRlbWFuZGUuIgogICAgICB9KTsKICAgIH0KICB9Cik7Cgph
cHAuZGVsZXRlKCIvYXBpL3NvY2lhbC9mcmllbmRzLzp1c2VybmFtZSIsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9u
ID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgY29uc3QgdGFyZ2V0ID0gYXdhaXQg
cGVvcGxlRmluZEFjY291bnQoCiAgICAgIHJlcS5wYXJhbXMudXNlcm5hbWUKICAgICk7CgogICAgaWYgKCF0YXJnZXQpIHsKICAgICAgcmV0dXJuIHJlcy5z
dGF0dXMoNDA0KS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6ICJVdGlsaXNhdGV1ciBpbnRyb3V2YWJsZS4iCiAgICAgIH0pOwog
ICAgfQoKICAgIGF3YWl0IHBlb3BsZVJlbW92ZUZyaWVuZCgKICAgICAgc2Vzc2lvbi5pZCwKICAgICAgdGFyZ2V0LmlkCiAgICApOwoKICAgIHBlb3BsZUVt
aXRUb0FjY291bnQoCiAgICAgIHRhcmdldC5pZCwKICAgICAgImZyaWVuZC1zdGF0ZS1jaGFuZ2VkIiwKICAgICAgewogICAgICAgIHR5cGU6ICJyZW1vdmVk
IiwKICAgICAgICBieTogc2Vzc2lvbi51c2VybmFtZQogICAgICB9CiAgICApOwoKICAgIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICAgIHNlc3Npb24uaWQs
CiAgICAgICJmcmllbmQtc3RhdGUtY2hhbmdlZCIsCiAgICAgIHsgdHlwZTogInJlbW92ZWQiIH0KICAgICk7CgogICAgcmVzLmpzb24oeyBvazogdHJ1ZSB9
KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICJbUGVvcGxlIGZyaWVuZHMvcmVtb3ZlXSIsCiAgICAgIGVycgogICAgKTsK
CiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgIG9rOiBmYWxzZSwKICAgICAgZXJyb3I6ICJJbXBvc3NpYmxlIGRlIHJldGlyZXIgY2V0IGFtaS4i
CiAgICB9KTsKICB9Cn0pOwoKLy8gPT09IFBFT1BMRV9ETV9FRElUX1JPVVRFX1Y2X1NUQVJUID09PQphcHAucGF0Y2goCiAgIi9hcGkvZG0vbWVzc2FnZS86
aWQiLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVl
c3QoCiAgICAgICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCBib2R5
ID0KICAgICAgICBTdHJpbmcocmVxLmJvZHk/LmJvZHkgfHwgIiIpLnRyaW0oKTsKCiAgICAgIGNvbnN0IGNvbnRleHQgPQogICAgICAgIGF3YWl0IHBlb3Bs
ZURtT3duZWRNZXNzYWdlQ29udGV4dCgKICAgICAgICAgIHNlc3Npb24uaWQsCiAgICAgICAgICByZXEucGFyYW1zLmlkCiAgICAgICAgKTsKCiAgICAgIGlm
ICghY29udGV4dCkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoK
ICAgICAgICAgICAgIlR1IG5lIHBldXggbW9kaWZpZXIgcXVlIHRlcyBwcm9wcmVzIG1lc3NhZ2VzLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgY29u
c3QgZTJlZUVudmVsb3BlID0KICAgICAgICBib2R5CiAgICAgICAgICA/IHBlb3BsZURtRTJlZUVudmVsb3BlKGJvZHkpCiAgICAgICAgICA6IG51bGw7Cgog
ICAgICBpZiAoCiAgICAgICAgKCFib2R5ICYmICFjb250ZXh0Lmhhc0ltYWdlKSB8fAogICAgICAgICghZTJlZUVudmVsb3BlICYmIGJvZHkubGVuZ3RoID4g
MjAwMCkgfHwKICAgICAgICAoZTJlZUVudmVsb3BlICYmIGJvZHkubGVuZ3RoID4gMjQwMDApCiAgICAgICkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVz
KDQwMCkuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIkxlIG1lc3NhZ2UgbW9kaWZpw6kgZXN0IGlu
dmFsaWRlLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgaWYgKGUyZWVFbnZlbG9wZSkgewogICAgICAgIGNvbnN0IHNlbmRlcklkID0KICAgICAgICAg
IFN0cmluZyhjb250ZXh0LnNlbmRlcklkKTsKICAgICAgICBjb25zdCByZWNpcGllbnRJZCA9CiAgICAgICAgICBTdHJpbmcoY29udGV4dC5yZWNpcGllbnRJ
ZCk7CgogICAgICAgIGNvbnN0IGFsbG93ZWRJZHMgPQogICAgICAgICAgbmV3IFNldChbCiAgICAgICAgICAgIHNlbmRlcklkLAogICAgICAgICAgICByZWNp
cGllbnRJZAogICAgICAgICAgXSk7CgogICAgICAgIGNvbnN0IGhhc1NlbmRlcktleSA9CiAgICAgICAgICBlMmVlRW52ZWxvcGUua2V5cy5zb21lKAogICAg
ICAgICAgICAoaXRlbSkgPT4KICAgICAgICAgICAgICBTdHJpbmcoaXRlbS51KSA9PT0KICAgICAgICAgICAgICAgIHNlbmRlcklkCiAgICAgICAgICApOwoK
ICAgICAgICBjb25zdCBoYXNSZWNpcGllbnRLZXkgPQogICAgICAgICAgZTJlZUVudmVsb3BlLmtleXMuc29tZSgKICAgICAgICAgICAgKGl0ZW0pID0+CiAg
ICAgICAgICAgICAgU3RyaW5nKGl0ZW0udSkgPT09CiAgICAgICAgICAgICAgICByZWNpcGllbnRJZAogICAgICAgICAgKTsKCiAgICAgICAgaWYgKAogICAg
ICAgICAgZTJlZUVudmVsb3BlLmZyb20gIT09IHNlbmRlcklkIHx8CiAgICAgICAgICBlMmVlRW52ZWxvcGUudG8gIT09IHJlY2lwaWVudElkIHx8CiAgICAg
ICAgICAhaGFzU2VuZGVyS2V5IHx8CiAgICAgICAgICAhaGFzUmVjaXBpZW50S2V5IHx8CiAgICAgICAgICBlMmVlRW52ZWxvcGUua2V5cy5zb21lKAogICAg
ICAgICAgICAoaXRlbSkgPT4KICAgICAgICAgICAgICAhYWxsb3dlZElkcy5oYXMoCiAgICAgICAgICAgICAgICBTdHJpbmcoaXRlbS51KQogICAgICAgICAg
ICAgICkKICAgICAgICAgICkKICAgICAgICApIHsKICAgICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgICAgIG9rOiBmYWxz
ZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIkVudmVsb3BwZSBFMkVFIGludmFsaWRlLiIKICAgICAgICAgIH0pOwogICAgICAgIH0KICAg
ICAgfQoKICAgICAgY29uc3QgZWRpdGVkID0KICAgICAgICBhd2FpdCBwZW9wbGVFZGl0RG1NZXNzYWdlKAogICAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAg
ICAgIHJlcS5wYXJhbXMuaWQsCiAgICAgICAgICBib2R5LAogICAgICAgICAgY29udGV4dAogICAgICAgICk7CgogICAgICBpZiAoIWVkaXRlZCkgewogICAg
ICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIkltcG9z
c2libGUgZGUgbW9kaWZpZXIgY2UgbWVzc2FnZS4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IHBheWxvYWQgPSB7CiAgICAgICAgaWQ6IGVk
aXRlZC5pZCwKICAgICAgICBzZW5kZXJJZDogZWRpdGVkLnNlbmRlcklkLAogICAgICAgIHJlY2lwaWVudElkOiBlZGl0ZWQucmVjaXBpZW50SWQsCiAgICAg
ICAgZWRpdGVkQXQ6IGVkaXRlZC5lZGl0ZWRBdAogICAgICB9OwoKICAgICAgcGVvcGxlRW1pdFRvQWNjb3VudCgKICAgICAgICBlZGl0ZWQuc2VuZGVySWQs
CiAgICAgICAgImRtLW1lc3NhZ2UtZWRpdGVkIiwKICAgICAgICBwYXlsb2FkCiAgICAgICk7CgogICAgICBwZW9wbGVFbWl0VG9BY2NvdW50KAogICAgICAg
IGVkaXRlZC5yZWNpcGllbnRJZCwKICAgICAgICAiZG0tbWVzc2FnZS1lZGl0ZWQiLAogICAgICAgIHBheWxvYWQKICAgICAgKTsKCiAgICAgIHJlcy5qc29u
KHsKICAgICAgICBvazogdHJ1ZSwKICAgICAgICBtZXNzYWdlOiBwYXlsb2FkCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUu
ZXJyb3IoCiAgICAgICAgIltQZW9wbGUgZG0vZWRpdF0iLAogICAgICAgIGVycgogICAgICApOwoKICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAg
ICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAgICAgICJJbXBvc3NpYmxlIGRlIG1vZGlmaWVyIGNlIG1lc3NhZ2UuIgogICAgICB9KTsKICAg
IH0KICB9Cik7Ci8vID09PSBQRU9QTEVfRE1fRURJVF9ST1VURV9WNl9FTkQgPT09CgovLyA9PT0gUEVPUExFX01FU1NBR0VfREVMRVRFX1JPVVRFU19WMV9T
VEFSVCA9PT0KYXBwLmRlbGV0ZSgKICAiL2FwaS9kbS9tZXNzYWdlLzppZCIsCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0cnkgewogICAgICBjb25z
dCBzZXNzaW9uID0KICAgICAgICBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdCgKICAgICAgICAgIHJlcSwKICAgICAgICAgIHJlcwogICAgICAgICk7CgogICAg
ICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICAgIGNvbnN0IHJlbW92ZWQgPQogICAgICAgIGF3YWl0IHBlb3BsZURlbGV0ZURtTWVzc2FnZSgKICAgICAg
ICAgIHNlc3Npb24uaWQsCiAgICAgICAgICByZXEucGFyYW1zLmlkCiAgICAgICAgKTsKCiAgICAgIGlmICghcmVtb3ZlZCkgewogICAgICAgIHJldHVybiBy
ZXMuc3RhdHVzKDQwMykuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIlR1IG5lIHBldXggc3VwcHJp
bWVyIHF1ZSB0ZXMgcHJvcHJlcyBtZXNzYWdlcy4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IHBheWxvYWQgPSB7CiAgICAgICAgaWQ6CiAg
ICAgICAgICByZW1vdmVkLmlkLAogICAgICAgIHNlbmRlcklkOgogICAgICAgICAgcmVtb3ZlZC5zZW5kZXJJZCwKICAgICAgICByZWNpcGllbnRJZDoKICAg
ICAgICAgIHJlbW92ZWQucmVjaXBpZW50SWQKICAgICAgfTsKCiAgICAgIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICAgICAgcmVtb3ZlZC5zZW5kZXJJZCwK
ICAgICAgICAiZG0tbWVzc2FnZS1kZWxldGVkIiwKICAgICAgICBwYXlsb2FkCiAgICAgICk7CgogICAgICBwZW9wbGVFbWl0VG9BY2NvdW50KAogICAgICAg
IHJlbW92ZWQucmVjaXBpZW50SWQsCiAgICAgICAgImRtLW1lc3NhZ2UtZGVsZXRlZCIsCiAgICAgICAgcGF5bG9hZAogICAgICApOwoKICAgICAgcmVzLmpz
b24oewogICAgICAgIG9rOiB0cnVlCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUg
ZG0vZGVsZXRlXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAg
IGVycm9yOgogICAgICAgICAgIkltcG9zc2libGUgZGUgc3VwcHJpbWVyIGNlIG1lc3NhZ2UuIgogICAgICB9KTsKICAgIH0KICB9Cik7Ci8vID09PSBQRU9Q
TEVfTUVTU0FHRV9ERUxFVEVfUk9VVEVTX1YxX0VORCA9PT0KCi8vID09PSBQRU9QTEVfRE1fQ0xPU0VfUk9VVEVTX1YxX1NUQVJUID09PQphcHAucG9zdCgK
ICAiL2FwaS9kbS86dXNlcm5hbWUvY2xvc2UiLAogIGFzeW5jICgKICAgIHJlcSwKICAgIHJlcwogICkgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vz
c2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QoCiAgICAgICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYg
KCFzZXNzaW9uKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBjb25zdCB0YXJnZXQgPQogICAgICAgIGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50
KAogICAgICAgICAgcmVxLnBhcmFtcy51c2VybmFtZQogICAgICAgICk7CgogICAgICBpZiAoIXRhcmdldCkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVz
KDQwNCkuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIlV0aWxpc2F0ZXVyIGludHJvdXZhYmxlLiIK
ICAgICAgICB9KTsKICAgICAgfQoKICAgICAgaWYgKAogICAgICAgIFN0cmluZygKICAgICAgICAgIHRhcmdldC5pZAogICAgICAgICkgPT09CiAgICAgICAg
U3RyaW5nKAogICAgICAgICAgc2Vzc2lvbi5pZAogICAgICAgICkKICAgICAgKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsKICAg
ICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAiQ29udmVyc2F0aW9uIGludmFsaWRlLiIKICAgICAgICB9KTsKICAgICAg
fQoKICAgICAgYXdhaXQgcGVvcGxlU2V0RG1DbG9zZWQoCiAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICB0YXJnZXQuaWQsCiAgICAgICAgdHJ1ZQogICAg
ICApOwoKICAgICAgcmVzLmpzb24oewogICAgICAgIG9rOiB0cnVlCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3Io
CiAgICAgICAgIltQZW9wbGUgZG0vY2xvc2VdIiwKICAgICAgICBlcnIKICAgICAgKTsKCiAgICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAgICAgICBv
azogZmFsc2UsCiAgICAgICAgZXJyb3I6CiAgICAgICAgICAiSW1wb3NzaWJsZSBkZSBmZXJtZXIgY2UgTVAuIgogICAgICB9KTsKICAgIH0KICB9Cik7Cgph
cHAucG9zdCgKICAiL2FwaS9kbS86dXNlcm5hbWUvb3BlbiIsCiAgYXN5bmMgKAogICAgcmVxLAogICAgcmVzCiAgKSA9PiB7CiAgICB0cnkgewogICAgICBj
b25zdCBzZXNzaW9uID0KICAgICAgICBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdCgKICAgICAgICAgIHJlcSwKICAgICAgICAgIHJlcwogICAgICAgICk7Cgog
ICAgICBpZiAoIXNlc3Npb24pIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGNvbnN0IHRhcmdldCA9CiAgICAgICAgYXdhaXQgcGVvcGxlRmlu
ZEFjY291bnQoCiAgICAgICAgICByZXEucGFyYW1zLnVzZXJuYW1lCiAgICAgICAgKTsKCiAgICAgIGlmICghdGFyZ2V0KSB7CiAgICAgICAgcmV0dXJuIHJl
cy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAiVXRpbGlzYXRldXIgaW50cm91
dmFibGUuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICBhd2FpdCBwZW9wbGVTZXREbUNsb3NlZCgKICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgIHRh
cmdldC5pZCwKICAgICAgICBmYWxzZQogICAgICApOwoKICAgICAgcmVzLmpzb24oewogICAgICAgIG9rOiB0cnVlCiAgICAgIH0pOwogICAgfSBjYXRjaCAo
ZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUgZG0vb3Blbl0iLAogICAgICAgIGVycgogICAgICApOwoKICAgICAgcmVzLnN0
YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAgICAgICJJbXBvc3NpYmxlIGRlIHJvdXZyaXIgY2UgTVAu
IgogICAgICB9KTsKICAgIH0KICB9Cik7Ci8vID09PSBQRU9QTEVfRE1fQ0xPU0VfUk9VVEVTX1YxX0VORCA9PT0KCmFwcC5nZXQoIi9hcGkvZG0vY29udmVy
c2F0aW9ucyIsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCBy
ZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgY29uc3QgY29udmVyc2F0aW9ucyA9CiAgICAgIGF3YWl0IHBlb3BsZURtQ29udmVyc2F0aW9u
cyhzZXNzaW9uLmlkKTsKCiAgICByZXMuanNvbih7CiAgICAgIG9rOiB0cnVlLAogICAgICBjb252ZXJzYXRpb25zLAogICAgICB1bnJlYWRUb3RhbDogY29u
dmVyc2F0aW9ucy5yZWR1Y2UoCiAgICAgICAgKHN1bSwgaXRlbSkgPT4gc3VtICsgTnVtYmVyKGl0ZW0udW5yZWFkQ291bnQgfHwgMCksCiAgICAgICAgMAog
ICAgICApCiAgICB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgZG0vY29udmVyc2F0aW9uc10iLCBlcnIpOwogICAg
cmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIGxlcyBNUC4iCiAgICB9
KTsKICB9Cn0pOwoKYXBwLmdldCgiL2FwaS9kbS86dXNlcm5hbWUiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9
CiAgICAgIHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KAogICAgICAgIHJlcSwKICAgICAgICByZXMKICAgICAgKTsKCiAgICBpZiAoIXNlc3Npb24pIHsKICAg
ICAgcmV0dXJuOwogICAgfQoKICAgIGNvbnN0IHRhcmdldCA9CiAgICAgIGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50KAogICAgICAgIHJlcS5wYXJhbXMudXNl
cm5hbWUKICAgICAgKTsKCiAgICBpZiAoIXRhcmdldCkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwK
ICAgICAgICBlcnJvcjoKICAgICAgICAgICJVdGlsaXNhdGV1ciBpbnRyb3V2YWJsZS4iCiAgICAgIH0pOwogICAgfQoKICAgIGlmICgKICAgICAgU3RyaW5n
KHRhcmdldC5pZCkgPT09CiAgICAgIFN0cmluZyhzZXNzaW9uLmlkKQogICAgKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAg
ICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIlR1IG5lIHBldXggcGFzIG91dnJpciB1biBNUCBhdmVjIHRvaS1tZW1lLiIKICAgICAg
fSk7CiAgICB9CgogICAgLy8gPT09IFBFT1BMRV9OQVZJR0FUSU9OX1BBUkFMTEVMX1YxX0RNID09PQogICAgLy8gTCdoaXN0b3JpcXVlIGV0IGxhIHJlbGF0
aW9uIGQnYW1pdGnDqSBzb250IGluZMOpcGVuZGFudHMgOiBsZXMgYXR0ZW5kcmUKICAgIC8vIGVuIHBhcmFsbMOobGUgcsOpZHVpdCBsYSBsYXRlbmNlIHLD
qWVsbGUgZHUgcHJlbWllciBhZmZpY2hhZ2UgZCd1biBNUC4KICAgIGNvbnN0IFtoaXN0b3J5LCBpc0ZyaWVuZF0gPQogICAgICBhd2FpdCBQcm9taXNlLmFs
bChbCiAgICAgICAgcGVvcGxlRG1IaXN0b3J5KAogICAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAgIHRhcmdldC5pZCwKICAgICAgICAgIHsKICAgICAg
ICAgICAgYmVmb3JlOgogICAgICAgICAgICAgIHJlcS5xdWVyeT8uYmVmb3JlLAogICAgICAgICAgICBhZnRlcjoKICAgICAgICAgICAgICByZXEucXVlcnk/
LmFmdGVyCiAgICAgICAgICB9CiAgICAgICAgKSwKICAgICAgICBwZW9wbGVIYXNGcmllbmQoCiAgICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgICAgdGFy
Z2V0LmlkCiAgICAgICAgKQogICAgICBdKTsKCiAgICBjb25zdCBtZXNzYWdlcyA9CiAgICAgIEFycmF5LmlzQXJyYXkoCiAgICAgICAgaGlzdG9yeT8ubWVz
c2FnZXMKICAgICAgKQogICAgICAgID8gaGlzdG9yeS5tZXNzYWdlcwogICAgICAgIDogW107CgogICAgcmVzLmpzb24oewogICAgICBvazogdHJ1ZSwKICAg
ICAgdXNlcjogewogICAgICAgIC4uLnBlb3BsZVB1YmxpY0FjY291bnQoCiAgICAgICAgICB0YXJnZXQKICAgICAgICApLAogICAgICAgIG9ubGluZToKICAg
ICAgICAgIHBlb3BsZUFjY291bnRJc09ubGluZSgKICAgICAgICAgICAgdGFyZ2V0LmlkCiAgICAgICAgICApLAogICAgICAgIGlzRnJpZW5kCiAgICAgIH0s
CiAgICAgIHBhZ2VTaXplOgogICAgICAgIFBFT1BMRV9ETV9ISVNUT1JZX1BBR0VfU0laRSwKICAgICAgaGFzTW9yZToKICAgICAgICBCb29sZWFuKAogICAg
ICAgICAgaGlzdG9yeT8uaGFzTW9yZQogICAgICAgICksCiAgICAgIGRpcmVjdGlvbjoKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBoaXN0b3J5Py5kaXJl
Y3Rpb24gfHwKICAgICAgICAgICJsYXRlc3QiCiAgICAgICAgKSwKICAgICAgbWVzc2FnZXM6CiAgICAgICAgbWVzc2FnZXMubWFwKAogICAgICAgICAgKG1l
c3NhZ2UpID0+ICh7CiAgICAgICAgICAgIGlkOgogICAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgICAgIG1lc3NhZ2UuaWQKICAgICAgICAgICAg
ICApLAogICAgICAgICAgICBzZW5kZXJJZDoKICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICBtZXNzYWdlLnNlbmRlcl9pZAogICAgICAg
ICAgICAgICksCiAgICAgICAgICAgIHJlY2lwaWVudElkOgogICAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgICAgIG1lc3NhZ2UucmVjaXBpZW50
X2lkCiAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgYm9keToKICAgICAgICAgICAgICBtZXNzYWdlLmJvZHksCiAgICAgICAgICAgIGltYWdlSWQ6CiAg
ICAgICAgICAgICAgbWVzc2FnZS5pbWFnZV9pZAogICAgICAgICAgICAgICAgPyBTdHJpbmcoCiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZS5pbWFnZV9p
ZAogICAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgICA6IG51bGwsCiAgICAgICAgICAgIHJlcGx5VG86CiAgICAgICAgICAgICAgcGVvcGxlRG1S
ZXBseUZyb21IaXN0b3J5Um93KAogICAgICAgICAgICAgICAgbWVzc2FnZQogICAgICAgICAgICAgICksCiAgICAgICAgICAgIGNyZWF0ZWRBdDoKICAgICAg
ICAgICAgICBtZXNzYWdlLmNyZWF0ZWRfYXQsCiAgICAgICAgICAgIGVkaXRlZEF0OgogICAgICAgICAgICAgIG1lc3NhZ2UuZWRpdGVkX2F0IHx8CiAgICAg
ICAgICAgICAgbWVzc2FnZS5lZGl0ZWRBdCB8fAogICAgICAgICAgICAgIG51bGwsCiAgICAgICAgICAgIHJlYWRBdDoKICAgICAgICAgICAgICBtZXNzYWdl
LnJlYWRfYXQgfHwKICAgICAgICAgICAgICBudWxsCiAgICAgICAgICB9KQogICAgICAgICkKICAgIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29s
ZS5lcnJvcigKICAgICAgIltQZW9wbGUgZG0vaGlzdG9yeV0iLAogICAgICBlcnIKICAgICk7CgogICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICBv
azogZmFsc2UsCiAgICAgIGVycm9yOgogICAgICAgICJJbXBvc3NpYmxlIGRlIGNoYXJnZXIgY2V0dGUgY29udmVyc2F0aW9uLiIKICAgIH0pOwogIH0KfSk7
CgphcHAucG9zdCgiL2FwaS9kbS86dXNlcm5hbWUvcmVhZCIsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVv
cGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgY29uc3QgdGFyZ2V0ID0gYXdhaXQgcGVvcGxl
RmluZEFjY291bnQoCiAgICAgIHJlcS5wYXJhbXMudXNlcm5hbWUKICAgICk7CgogICAgaWYgKCF0YXJnZXQpIHsKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMo
NDA0KS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6ICJVdGlsaXNhdGV1ciBpbnRyb3V2YWJsZS4iCiAgICAgIH0pOwogICAgfQoK
ICAgIGF3YWl0IHBlb3BsZU1hcmtEbVJlYWQoc2Vzc2lvbi5pZCwgdGFyZ2V0LmlkKTsKCiAgICByZXMuanNvbih7CiAgICAgIG9rOiB0cnVlCiAgICB9KTsK
ICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgZG0vcmVhZF0iLCBlcnIpOwogICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewog
ICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBtYXJxdWVyIGxlcyBNUCBjb21tZSBsdXMuIgogICAgfSk7CiAgfQp9KTsKCmNv
bnN0IHBlb3BsZURtUmF0ZSA9IG5ldyBNYXAoKTsKCmZ1bmN0aW9uIHBlb3BsZURtUmF0ZUFsbG93ZWQoYWNjb3VudElkKSB7CiAgY29uc3Qga2V5ID0gU3Ry
aW5nKGFjY291bnRJZCk7CiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTsKICBjb25zdCBvbGQgPSBwZW9wbGVEbVJhdGUuZ2V0KGtleSkgfHwgW107CiAgY29u
c3QgZnJlc2ggPSBvbGQuZmlsdGVyKAogICAgKHRpbWUpID0+IG5vdyAtIHRpbWUgPCA1MDAwCiAgKTsKCiAgaWYgKGZyZXNoLmxlbmd0aCA+PSAxMikgewog
ICAgcGVvcGxlRG1SYXRlLnNldChrZXksIGZyZXNoKTsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIGZyZXNoLnB1c2gobm93KTsKICBwZW9wbGVEbVJhdGUu
c2V0KGtleSwgZnJlc2gpOwogIHJldHVybiB0cnVlOwp9CgphcHAucG9zdCgiL2FwaS9kbS86dXNlcm5hbWUiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0
cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgIHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KAogICAgICAgIHJlcSwKICAgICAgICByZXMKICAgICAgKTsK
CiAgICBpZiAoIXNlc3Npb24pIHsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIGlmICgKICAgICAgIXBlb3BsZURtUmF0ZUFsbG93ZWQoCiAgICAgICAgc2Vz
c2lvbi5pZAogICAgICApCiAgICApIHsKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDI5KS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJy
b3I6CiAgICAgICAgICAiVHUgZW52b2llcyB0cm9wIGRlIG1lc3NhZ2VzIHRyb3Agdml0ZS4iCiAgICAgIH0pOwogICAgfQoKICAgIGNvbnN0IHRhcmdldCA9
CiAgICAgIGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50KAogICAgICAgIHJlcS5wYXJhbXMudXNlcm5hbWUKICAgICAgKTsKCiAgICBpZiAoIXRhcmdldCkgewog
ICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAgICAgICJVdGlsaXNhdGV1
ciBpbnRyb3V2YWJsZS4iCiAgICAgIH0pOwogICAgfQoKICAgIGlmICgKICAgICAgU3RyaW5nKHRhcmdldC5pZCkgPT09CiAgICAgIFN0cmluZyhzZXNzaW9u
LmlkKQogICAgKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAg
ICAgIlR1IG5lIHBldXggcGFzIHQnZW52b3llciB1biBNUC4iCiAgICAgIH0pOwogICAgfQoKICAgIGNvbnN0IGJvZHkgPQogICAgICBTdHJpbmcoCiAgICAg
ICAgcmVxLmJvZHk/LmJvZHkgfHwgIiIKICAgICAgKS50cmltKCk7CgogICAgY29uc3QgZTJlZUVudmVsb3BlID0KICAgICAgcGVvcGxlRG1FMmVlRW52ZWxv
cGUoCiAgICAgICAgYm9keQogICAgICApOwoKICAgIGNvbnN0IGltYWdlSWQgPQogICAgICBwZW9wbGVOb3JtYWxpemVNZXNzYWdlSW1hZ2VJZCgKICAgICAg
ICByZXEuYm9keT8uaW1hZ2VJZAogICAgICApOwoKICAgIGNvbnN0IHJlcGx5VG9JZCA9CiAgICAgIHBlb3BsZVJlcGx5SWQoCiAgICAgICAgcmVxLmJvZHk/
LnJlcGx5VG9JZAogICAgICApOwoKICAgIGlmICgKICAgICAgKAogICAgICAgICFib2R5ICYmCiAgICAgICAgIWltYWdlSWQKICAgICAgKSB8fAogICAgICAo
CiAgICAgICAgIWUyZWVFbnZlbG9wZSAmJgogICAgICAgIGJvZHkubGVuZ3RoID4gMjAwMAogICAgICApIHx8CiAgICAgICgKICAgICAgICBlMmVlRW52ZWxv
cGUgJiYKICAgICAgICBib2R5Lmxlbmd0aCA+IDI0MDAwCiAgICAgICkKICAgICkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oewogICAg
ICAgIG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjoKICAgICAgICAgICJMZSBNUCBkb2l0IGNvbnRlbmlyIGR1IHRleHRlIG91IHVuZSBpbWFnZS4iCiAgICAg
IH0pOwogICAgfQoKICAgIGlmIChlMmVlRW52ZWxvcGUpIHsKICAgICAgY29uc3Qgc2VuZGVySWQgPQogICAgICAgIFN0cmluZyhzZXNzaW9uLmlkKTsKCiAg
ICAgIGNvbnN0IHJlY2lwaWVudElkID0KICAgICAgICBTdHJpbmcodGFyZ2V0LmlkKTsKCiAgICAgIGNvbnN0IGFsbG93ZWRJZHMgPQogICAgICAgIG5ldyBT
ZXQoWwogICAgICAgICAgc2VuZGVySWQsCiAgICAgICAgICByZWNpcGllbnRJZAogICAgICAgIF0pOwoKICAgICAgY29uc3QgaGFzU2VuZGVyS2V5ID0KICAg
ICAgICBlMmVlRW52ZWxvcGUua2V5cy5zb21lKAogICAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICAgIFN0cmluZyhpdGVtLnUpID09PQogICAgICAgICAg
ICAgIHNlbmRlcklkCiAgICAgICAgKTsKCiAgICAgIGNvbnN0IGhhc1JlY2lwaWVudEtleSA9CiAgICAgICAgZTJlZUVudmVsb3BlLmtleXMuc29tZSgKICAg
ICAgICAgIChpdGVtKSA9PgogICAgICAgICAgICBTdHJpbmcoaXRlbS51KSA9PT0KICAgICAgICAgICAgICByZWNpcGllbnRJZAogICAgICAgICk7CgogICAg
ICBpZiAoCiAgICAgICAgZTJlZUVudmVsb3BlLmZyb20gIT09CiAgICAgICAgICBzZW5kZXJJZCB8fAogICAgICAgIGUyZWVFbnZlbG9wZS50byAhPT0KICAg
ICAgICAgIHJlY2lwaWVudElkIHx8CiAgICAgICAgIWhhc1NlbmRlcktleSB8fAogICAgICAgICFoYXNSZWNpcGllbnRLZXkgfHwKICAgICAgICBlMmVlRW52
ZWxvcGUua2V5cy5zb21lKAogICAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICAgICFhbGxvd2VkSWRzLmhhcygKICAgICAgICAgICAgICBTdHJpbmcoaXRl
bS51KQogICAgICAgICAgICApCiAgICAgICAgKQogICAgICApIHsKICAgICAgICByZXR1cm4gcmVzCiAgICAgICAgICAuc3RhdHVzKDQwMCkKICAgICAgICAg
IC5qc29uKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiRW52ZWxvcHBlIEUyRUUgaW52YWxpZGUu
IgogICAgICAgICAgfSk7CiAgICAgIH0KICAgIH0KCiAgICBjb25zdCBtZXNzYWdlID0KICAgICAgYXdhaXQgcGVvcGxlQ3JlYXRlRG0oCiAgICAgICAgc2Vz
c2lvbi5pZCwKICAgICAgICB0YXJnZXQuaWQsCiAgICAgICAgYm9keSwKICAgICAgICBpbWFnZUlkLAogICAgICAgIHJlcGx5VG9JZAogICAgICApOwoKICAg
IC8vID09PSBQRU9QTEVfRE1fUkVPUEVOX09OX01FU1NBR0VfVjEgPT09CiAgICBhd2FpdCBwZW9wbGVTZXREbUNsb3NlZCgKICAgICAgc2Vzc2lvbi5pZCwK
ICAgICAgdGFyZ2V0LmlkLAogICAgICBmYWxzZQogICAgKTsKCiAgICBhd2FpdCBwZW9wbGVTZXREbUNsb3NlZCgKICAgICAgdGFyZ2V0LmlkLAogICAgICBz
ZXNzaW9uLmlkLAogICAgICBmYWxzZQogICAgKTsKCiAgICBjb25zdCBzZW5kZXIgPQogICAgICBhd2FpdCBwZW9wbGVGaW5kQWNjb3VudEJ5SWQoCiAgICAg
ICAgc2Vzc2lvbi5pZAogICAgICApOwoKICAgIGNvbnN0IHBheWxvYWQgPSB7CiAgICAgIGlkOgogICAgICAgIFN0cmluZyhtZXNzYWdlLmlkKSwKICAgICAg
c2VuZGVyOgogICAgICAgIHBlb3BsZVB1YmxpY0FjY291bnQoCiAgICAgICAgICBzZW5kZXIKICAgICAgICApLAogICAgICByZWNpcGllbnQ6CiAgICAgICAg
cGVvcGxlUHVibGljQWNjb3VudCgKICAgICAgICAgIHRhcmdldAogICAgICAgICksCiAgICAgIGJvZHk6CiAgICAgICAgbWVzc2FnZS5ib2R5LAogICAgICBp
bWFnZUlkOgogICAgICAgIG1lc3NhZ2UuaW1hZ2VfaWQKICAgICAgICAgID8gU3RyaW5nKAogICAgICAgICAgICAgIG1lc3NhZ2UuaW1hZ2VfaWQKICAgICAg
ICAgICAgKQogICAgICAgICAgOiBudWxsLAogICAgICByZXBseVRvOgogICAgICAgIG1lc3NhZ2UucmVwbHlfdG8gfHwgbnVsbCwKICAgICAgY3JlYXRlZEF0
OgogICAgICAgIG1lc3NhZ2UuY3JlYXRlZF9hdAogICAgfTsKCiAgICBwZW9wbGVFbWl0VG9BY2NvdW50KAogICAgICB0YXJnZXQuaWQsCiAgICAgICJkbS1t
ZXNzYWdlIiwKICAgICAgcGF5bG9hZAogICAgKTsKCiAgICBwZW9wbGVFbWl0VG9BY2NvdW50KAogICAgICBzZXNzaW9uLmlkLAogICAgICAiZG0tbWVzc2Fn
ZS1zZW50IiwKICAgICAgcGF5bG9hZAogICAgKTsKCiAgICByZXMuanNvbih7CiAgICAgIG9rOiB0cnVlLAogICAgICBtZXNzYWdlOiBwYXlsb2FkCiAgICB9
KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGlmICgKICAgICAgZXJyPy5jb2RlID09PQogICAgICAgICJFMkVFX0VOVkVMT1BFX0lOVkFMSUQiCiAgICApIHsK
ICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6CiAgICAgICAgICAiRW52ZWxvcHBl
IEUyRUUgaW52YWxpZGUuIgogICAgICB9KTsKICAgIH0KCiAgICBpZiAoCiAgICAgIGVycj8uY29kZSA9PT0KICAgICAgIklNQUdFX0lOVkFMSUQiCiAgICAp
IHsKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6CiAgICAgICAgICAiQ2V0dGUg
aW1hZ2Ugbidlc3QgcGx1cyBkaXNwb25pYmxlLiBSw6llc3NhaWUgZGUgbGEgc8OpbGVjdGlvbm5lci4iCiAgICAgIH0pOwogICAgfQoKICAgIGNvbnNvbGUu
ZXJyb3IoCiAgICAgICJbUGVvcGxlIGRtL3NlbmRdIiwKICAgICAgZXJyCiAgICApOwoKICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAgICAgb2s6IGZh
bHNlLAogICAgICBlcnJvcjoKICAgICAgICAiSW1wb3NzaWJsZSBkJ2Vudm95ZXIgY2UgTVAuIgogICAgfSk7CiAgfQp9KTsKLy8gPT09IFBFT1BMRV9TT0NJ
QUxfVjJfRU5EID09PQoKLy8gPT09IFBFT1BMRV9NRVNTQUdFX0lNQUdFU19WMl9TVEFSVCA9PT0KLyoKICBQacOoY2VzIGpvaW50ZXMgUGVvcGxlLgogIC0g
U2Fsb25zIHNlcnZldXIgOiBmaWNoaWVyIGNoaWZmcsOpIGF1IHJlcG9zIGVuIEFFUy0yNTYtR0NNLgogIC0gTVAgOiBsZSBuYXZpZ2F0ZXVyIGVudm9pZSB1
biBjb250ZW5ldXIgRTJFRSBvcGFxdWUsIGx1aS1tw6ptZSBjaGlmZnLDqSBhdSByZXBvcy4KICAtIENvbXBhdGliaWxpdMOpIDogbGVzIGFuY2llbm5lcyBp
bWFnZXMgZXQgYW5jaWVucyBjb250ZW5ldXJzIEUyRUUgdjEgcmVzdGVudCBsaXNpYmxlcy4KKi8KY29uc3QgUEVPUExFX01FU1NBR0VfSU1BR0VfTUFYX01C
ID0gTWF0aC5tYXgoCiAgMSwKICBNYXRoLm1pbigKICAgIDEwMCwKICAgIE51bWJlcihwcm9jZXNzLmVudi5QRU9QTEVfQVRUQUNITUVOVF9NQVhfTUIpIHx8
IDI1CiAgKQopOwpjb25zdCBQRU9QTEVfTUVTU0FHRV9JTUFHRV9NQVhfQllURVMgPSBNYXRoLmZsb29yKAogIFBFT1BMRV9NRVNTQUdFX0lNQUdFX01BWF9N
QiAqIDEwMjQgKiAxMDI0Cik7CmNvbnN0IFBFT1BMRV9NRVNTQUdFX0lNQUdFX1RSQU5TUE9SVF9NQVhfQllURVMgPQogIFBFT1BMRV9NRVNTQUdFX0lNQUdF
X01BWF9CWVRFUyArIDEwMjQgKiAxMDI0OwoKY29uc3QgUEVPUExFX0RNX0UyRUVfSU1BR0VfTUlNRSA9CiAgImFwcGxpY2F0aW9uL3gtcGVvcGxlLWUyZWUt
aW1hZ2UiOwpjb25zdCBQRU9QTEVfRE1fRTJFRV9JTUFHRV9NQUdJQyA9IEJ1ZmZlci5mcm9tKAogICJQRU9QTEUtRTJFRS1JTUFHRS1WMVxuIiwKICAiYXNj
aWkiCik7CmNvbnN0IFBFT1BMRV9NRVNTQUdFX0FUVEFDSE1FTlRfTUFHSUMgPSBCdWZmZXIuZnJvbSgKICAiUEVPUExFLUFUVEFDSE1FTlQtVjFcbiIsCiAg
ImFzY2lpIgopOwpjb25zdCBQRU9QTEVfTUVTU0FHRV9JTUFHRV9TVE9SQUdFX01BR0lDID0gQnVmZmVyLmZyb20oCiAgIlBFT1BMRS1JTUctU1RPUkUtVjFc
MCIsCiAgImFzY2lpIgopOwpjb25zdCBQRU9QTEVfTUVTU0FHRV9JTUFHRV9TVE9SQUdFX0FBRCA9IEJ1ZmZlci5mcm9tKAogICJQZW9wbGUgbWVzc2FnZSBp
bWFnZSBzdG9yYWdlIHYxIiwKICAidXRmOCIKKTsKY29uc3QgUEVPUExFX0lOTElORV9JTUFHRV9NSU1FUyA9IG5ldyBTZXQoWwogICJpbWFnZS9qcGVnIiwK
ICAiaW1hZ2UvcG5nIiwKICAiaW1hZ2Uvd2VicCIsCiAgImltYWdlL2dpZiIKXSk7CmNvbnN0IFBFT1BMRV9JTkxJTkVfVklERU9fTUlNRVMgPSBuZXcgU2V0
KFsKICAidmlkZW8vbXA0IiwKICAidmlkZW8vd2VibSIsCiAgInZpZGVvL29nZyIsCiAgInZpZGVvL3F1aWNrdGltZSIKXSk7CgpmdW5jdGlvbiBwZW9wbGVB
dHRhY2htZW50TWltZSh2YWx1ZSkgewogIGNvbnN0IG1pbWUgPSBTdHJpbmcodmFsdWUgfHwgIiIpCiAgICAuc3BsaXQoIjsiLCAxKVswXQogICAgLnRyaW0o
KQogICAgLnRvTG93ZXJDYXNlKCk7CiAgcmV0dXJuIC9eW2EtejAtOSEjJCZeXy4rLV0rXC9bYS16MC05ISMkJl5fListXSskLy50ZXN0KG1pbWUpCiAgICA/
IG1pbWUuc2xpY2UoMCwgMTYwKQogICAgOiAiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtIjsKfQoKZnVuY3Rpb24gcGVvcGxlQXR0YWNobWVudE5hbWUodmFs
dWUsIGZhbGxiYWNrID0gImZpY2hpZXIiKSB7CiAgY29uc3QgbmFtZSA9IFN0cmluZyh2YWx1ZSB8fCAiIikKICAgIC5yZXBsYWNlKC9bXFwvXHUwMDAwLVx1
MDAxZlx1MDA3Zjw+OiJ8PypdKy9nLCAiXyIpCiAgICAudHJpbSgpCiAgICAuc2xpY2UoMCwgMTgwKTsKICByZXR1cm4gbmFtZSB8fCBmYWxsYmFjazsKfQoK
ZnVuY3Rpb24gcGVvcGxlQXR0YWNobWVudE5hbWVGcm9tSGVhZGVyKHJlcSkgewogIGNvbnN0IHJhdyA9IFN0cmluZyhyZXEuaGVhZGVyc1sieC1wZW9wbGUt
ZmlsZS1uYW1lIl0gfHwgIiIpOwogIGlmICghcmF3KSByZXR1cm4gImZpY2hpZXIiOwogIHRyeSB7CiAgICByZXR1cm4gcGVvcGxlQXR0YWNobWVudE5hbWUo
ZGVjb2RlVVJJQ29tcG9uZW50KHJhdykpOwogIH0gY2F0Y2ggewogICAgcmV0dXJuIHBlb3BsZUF0dGFjaG1lbnROYW1lKHJhdyk7CiAgfQp9CgpmdW5jdGlv
biBwZW9wbGVQYWNrTWVzc2FnZUF0dGFjaG1lbnQoYnVmZmVyLCBuYW1lLCBtaW1lKSB7CiAgY29uc3QgYm9keSA9IEJ1ZmZlci5pc0J1ZmZlcihidWZmZXIp
ID8gYnVmZmVyIDogQnVmZmVyLmZyb20oYnVmZmVyIHx8IFtdKTsKICBjb25zdCBtZXRhID0gQnVmZmVyLmZyb20oCiAgICBKU09OLnN0cmluZ2lmeSh7CiAg
ICAgIHY6IDEsCiAgICAgIG5hbWU6IHBlb3BsZUF0dGFjaG1lbnROYW1lKG5hbWUpLAogICAgICBtaW1lOiBwZW9wbGVBdHRhY2htZW50TWltZShtaW1lKSwK
ICAgICAgc2l6ZTogYm9keS5sZW5ndGgKICAgIH0pLAogICAgInV0ZjgiCiAgKTsKICBpZiAobWV0YS5sZW5ndGggPiA0MDk2KSB0aHJvdyBuZXcgRXJyb3Io
IkFUVEFDSE1FTlRfTUVUQV9JTlZBTElEIik7CiAgY29uc3QgbGVuZ3RoID0gQnVmZmVyLmFsbG9jVW5zYWZlKDQpOwogIGxlbmd0aC53cml0ZVVJbnQzMkJF
KG1ldGEubGVuZ3RoLCAwKTsKICByZXR1cm4gQnVmZmVyLmNvbmNhdChbCiAgICBQRU9QTEVfTUVTU0FHRV9BVFRBQ0hNRU5UX01BR0lDLAogICAgbGVuZ3Ro
LAogICAgbWV0YSwKICAgIGJvZHkKICBdKTsKfQoKZnVuY3Rpb24gcGVvcGxlVW5wYWNrTWVzc2FnZUF0dGFjaG1lbnQoYnVmZmVyLCBmYWxsYmFja01pbWUg
PSAiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtIikgewogIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZmZlcikpIHJldHVybiBudWxsOwogIGNvbnN0IG1hZ2lj
ID0gUEVPUExFX01FU1NBR0VfQVRUQUNITUVOVF9NQUdJQzsKICBpZiAoCiAgICBidWZmZXIubGVuZ3RoIDwgbWFnaWMubGVuZ3RoICsgNCB8fAogICAgIWJ1
ZmZlci5zdWJhcnJheSgwLCBtYWdpYy5sZW5ndGgpLmVxdWFscyhtYWdpYykKICApIHsKICAgIHJldHVybiB7CiAgICAgIGRhdGE6IGJ1ZmZlciwKICAgICAg
bWltZTogcGVvcGxlQXR0YWNobWVudE1pbWUoZmFsbGJhY2tNaW1lKSwKICAgICAgbmFtZTogcGVvcGxlQXR0YWNobWVudE5hbWUoCiAgICAgICAgUEVPUExF
X0lOTElORV9JTUFHRV9NSU1FUy5oYXMocGVvcGxlQXR0YWNobWVudE1pbWUoZmFsbGJhY2tNaW1lKSkKICAgICAgICAgID8gImltYWdlIgogICAgICAgICAg
OiAiZmljaGllciIKICAgICAgKSwKICAgICAgc2l6ZTogYnVmZmVyLmxlbmd0aCwKICAgICAgbGVnYWN5OiB0cnVlCiAgICB9OwogIH0KCiAgdHJ5IHsKICAg
IGNvbnN0IG1ldGFMZW5ndGggPSBidWZmZXIucmVhZFVJbnQzMkJFKG1hZ2ljLmxlbmd0aCk7CiAgICBpZiAobWV0YUxlbmd0aCA8IDE2IHx8IG1ldGFMZW5n
dGggPiA0MDk2KSB0aHJvdyBuZXcgRXJyb3IoIkFUVEFDSE1FTlRfTUVUQV9JTlZBTElEIik7CiAgICBjb25zdCBtZXRhU3RhcnQgPSBtYWdpYy5sZW5ndGgg
KyA0OwogICAgY29uc3QgbWV0YUVuZCA9IG1ldGFTdGFydCArIG1ldGFMZW5ndGg7CiAgICBpZiAobWV0YUVuZCA+IGJ1ZmZlci5sZW5ndGgpIHRocm93IG5l
dyBFcnJvcigiQVRUQUNITUVOVF9NRVRBX0lOVkFMSUQiKTsKICAgIGNvbnN0IG1ldGEgPSBKU09OLnBhcnNlKGJ1ZmZlci5zdWJhcnJheShtZXRhU3RhcnQs
IG1ldGFFbmQpLnRvU3RyaW5nKCJ1dGY4IikpOwogICAgY29uc3QgZGF0YSA9IGJ1ZmZlci5zdWJhcnJheShtZXRhRW5kKTsKICAgIGNvbnN0IHNpemUgPSBO
dW1iZXIobWV0YT8uc2l6ZSk7CiAgICBpZiAobWV0YT8udiAhPT0gMSB8fCAhTnVtYmVyLmlzSW50ZWdlcihzaXplKSB8fCBzaXplICE9PSBkYXRhLmxlbmd0
aCkgewogICAgICB0aHJvdyBuZXcgRXJyb3IoIkFUVEFDSE1FTlRfTUVUQV9JTlZBTElEIik7CiAgICB9CiAgICByZXR1cm4gewogICAgICBkYXRhLAogICAg
ICBtaW1lOiBwZW9wbGVBdHRhY2htZW50TWltZShtZXRhPy5taW1lKSwKICAgICAgbmFtZTogcGVvcGxlQXR0YWNobWVudE5hbWUobWV0YT8ubmFtZSksCiAg
ICAgIHNpemUsCiAgICAgIGxlZ2FjeTogZmFsc2UKICAgIH07CiAgfSBjYXRjaCAoY2F1c2UpIHsKICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigiQVRUQUNI
TUVOVF9NRVRBX0lOVkFMSUQiKTsKICAgIGVyci5jb2RlID0gIkFUVEFDSE1FTlRfTUVUQV9JTlZBTElEIjsKICAgIGVyci5jYXVzZSA9IGNhdXNlOwogICAg
dGhyb3cgZXJyOwogIH0KfQoKZnVuY3Rpb24gcGVvcGxlTWVzc2FnZUltYWdlU3RvcmFnZUlzRW5jcnlwdGVkKGJ1ZmZlcikgewogIHJldHVybiBCdWZmZXIu
aXNCdWZmZXIoYnVmZmVyKSAmJgogICAgYnVmZmVyLmxlbmd0aCA+PSBQRU9QTEVfTUVTU0FHRV9JTUFHRV9TVE9SQUdFX01BR0lDLmxlbmd0aCAmJgogICAg
YnVmZmVyLnN1YmFycmF5KDAsIFBFT1BMRV9NRVNTQUdFX0lNQUdFX1NUT1JBR0VfTUFHSUMubGVuZ3RoKQogICAgICAuZXF1YWxzKFBFT1BMRV9NRVNTQUdF
X0lNQUdFX1NUT1JBR0VfTUFHSUMpOwp9CgpmdW5jdGlvbiBwZW9wbGVFbmNyeXB0TWVzc2FnZUltYWdlRGF0YShidWZmZXIpIHsKICBpZiAoIUJ1ZmZlci5p
c0J1ZmZlcihidWZmZXIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCJMZSBjb250ZW51IGRvaXQgw6p0cmUgdW4gQnVmZmVyLiIpOwogIGlmIChwZW9wbGVNZXNz
YWdlSW1hZ2VTdG9yYWdlSXNFbmNyeXB0ZWQoYnVmZmVyKSkgcmV0dXJuIGJ1ZmZlcjsKCiAgY29uc3QgaXYgPSBjcnlwdG9BY2NvdW50cy5yYW5kb21CeXRl
cygxMik7CiAgY29uc3QgY2lwaGVyID0gY3J5cHRvQWNjb3VudHMuY3JlYXRlQ2lwaGVyaXYoCiAgICAiYWVzLTI1Ni1nY20iLAogICAgUEVPUExFX01FU1NB
R0VfRU5DUllQVElPTl9LRVksCiAgICBpdgogICk7CiAgY2lwaGVyLnNldEFBRChQRU9QTEVfTUVTU0FHRV9JTUFHRV9TVE9SQUdFX0FBRCk7CiAgY29uc3Qg
Y2lwaGVydGV4dCA9IEJ1ZmZlci5jb25jYXQoW2NpcGhlci51cGRhdGUoYnVmZmVyKSwgY2lwaGVyLmZpbmFsKCldKTsKICBjb25zdCB0YWcgPSBjaXBoZXIu
Z2V0QXV0aFRhZygpOwogIHJldHVybiBCdWZmZXIuY29uY2F0KFsKICAgIFBFT1BMRV9NRVNTQUdFX0lNQUdFX1NUT1JBR0VfTUFHSUMsCiAgICBpdiwKICAg
IHRhZywKICAgIGNpcGhlcnRleHQKICBdKTsKfQoKZnVuY3Rpb24gcGVvcGxlRGVjcnlwdE1lc3NhZ2VJbWFnZURhdGEoYnVmZmVyKSB7CiAgaWYgKCFCdWZm
ZXIuaXNCdWZmZXIoYnVmZmVyKSkgcmV0dXJuIEJ1ZmZlci5hbGxvYygwKTsKICBpZiAoIXBlb3BsZU1lc3NhZ2VJbWFnZVN0b3JhZ2VJc0VuY3J5cHRlZChi
dWZmZXIpKSByZXR1cm4gYnVmZmVyOwoKICBjb25zdCBvZmZzZXQgPSBQRU9QTEVfTUVTU0FHRV9JTUFHRV9TVE9SQUdFX01BR0lDLmxlbmd0aDsKICBpZiAo
YnVmZmVyLmxlbmd0aCA8IG9mZnNldCArIDI4KSB0aHJvdyBuZXcgRXJyb3IoIlBpw6hjZSBqb2ludGUgY2hpZmZyw6llIGF1IHJlcG9zIGludmFsaWRlLiIp
OwogIGNvbnN0IGl2ID0gYnVmZmVyLnN1YmFycmF5KG9mZnNldCwgb2Zmc2V0ICsgMTIpOwogIGNvbnN0IHRhZyA9IGJ1ZmZlci5zdWJhcnJheShvZmZzZXQg
KyAxMiwgb2Zmc2V0ICsgMjgpOwogIGNvbnN0IGNpcGhlcnRleHQgPSBidWZmZXIuc3ViYXJyYXkob2Zmc2V0ICsgMjgpOwogIGNvbnN0IGRlY2lwaGVyID0g
Y3J5cHRvQWNjb3VudHMuY3JlYXRlRGVjaXBoZXJpdigKICAgICJhZXMtMjU2LWdjbSIsCiAgICBQRU9QTEVfTUVTU0FHRV9FTkNSWVBUSU9OX0tFWSwKICAg
IGl2CiAgKTsKICBkZWNpcGhlci5zZXRBQUQoUEVPUExFX01FU1NBR0VfSU1BR0VfU1RPUkFHRV9BQUQpOwogIGRlY2lwaGVyLnNldEF1dGhUYWcodGFnKTsK
ICByZXR1cm4gQnVmZmVyLmNvbmNhdChbZGVjaXBoZXIudXBkYXRlKGNpcGhlcnRleHQpLCBkZWNpcGhlci5maW5hbCgpXSk7Cn0KCmZ1bmN0aW9uIHBlb3Bs
ZURtRTJlZUltYWdlQ29udGFpbmVyKGJ1ZmZlcikgewogIGlmICgKICAgICFCdWZmZXIuaXNCdWZmZXIoYnVmZmVyKSB8fAogICAgYnVmZmVyLmxlbmd0aCA8
IFBFT1BMRV9ETV9FMkVFX0lNQUdFX01BR0lDLmxlbmd0aCArIDQgKyAzMiB8fAogICAgIWJ1ZmZlci5zdWJhcnJheSgwLCBQRU9QTEVfRE1fRTJFRV9JTUFH
RV9NQUdJQy5sZW5ndGgpLmVxdWFscyhQRU9QTEVfRE1fRTJFRV9JTUFHRV9NQUdJQykKICApIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgdHJ5IHsKICAg
IGNvbnN0IGhlYWRlckxlbmd0aCA9IGJ1ZmZlci5yZWFkVUludDMyQkUoUEVPUExFX0RNX0UyRUVfSU1BR0VfTUFHSUMubGVuZ3RoKTsKICAgIGlmIChoZWFk
ZXJMZW5ndGggPCAzMiB8fCBoZWFkZXJMZW5ndGggPiA2NCAqIDEwMjQpIHRocm93IG5ldyBFcnJvcigiRTJFRV9JTUFHRV9IRUFERVJfSU5WQUxJRCIpOwog
ICAgY29uc3QgaGVhZGVyU3RhcnQgPSBQRU9QTEVfRE1fRTJFRV9JTUFHRV9NQUdJQy5sZW5ndGggKyA0OwogICAgY29uc3QgaGVhZGVyRW5kID0gaGVhZGVy
U3RhcnQgKyBoZWFkZXJMZW5ndGg7CiAgICBpZiAoaGVhZGVyRW5kID49IGJ1ZmZlci5sZW5ndGgpIHRocm93IG5ldyBFcnJvcigiRTJFRV9JTUFHRV9IRUFE
RVJfSU5WQUxJRCIpOwoKICAgIGNvbnN0IGVudmVsb3BlID0gSlNPTi5wYXJzZShidWZmZXIuc3ViYXJyYXkoaGVhZGVyU3RhcnQsIGhlYWRlckVuZCkudG9T
dHJpbmcoInV0ZjgiKSk7CiAgICBjb25zdCB2ZXJzaW9uID0gTnVtYmVyKGVudmVsb3BlPy52KTsKICAgIGNvbnN0IGZyb20gPSBTdHJpbmcoZW52ZWxvcGU/
LmZyb20gfHwgIiIpOwogICAgY29uc3QgdG8gPSBTdHJpbmcoZW52ZWxvcGU/LnRvIHx8ICIiKTsKICAgIGNvbnN0IHNlbmRlckRldmljZSA9IHBlb3BsZUUy
ZWVEZXZpY2VJZChlbnZlbG9wZT8uc2QpOwogICAgY29uc3Qgc2VuZGVyUHVibGljID0gcGVvcGxlRTJlZVB1YmxpY0p3ayhlbnZlbG9wZT8uc3BrKTsKICAg
IGNvbnN0IGl2ID0gU3RyaW5nKGVudmVsb3BlPy5pdiB8fCAiIik7CiAgICBjb25zdCBtaW1lID0gcGVvcGxlQXR0YWNobWVudE1pbWUoZW52ZWxvcGU/Lm1p
bWUpOwogICAgY29uc3QgbmFtZSA9IHBlb3BsZUF0dGFjaG1lbnROYW1lKAogICAgICBlbnZlbG9wZT8ubmFtZSwKICAgICAgdmVyc2lvbiA9PT0gMSA/ICJp
bWFnZSIgOiAiZmljaGllciIKICAgICk7CiAgICBjb25zdCBzaXplID0gTnVtYmVyKGVudmVsb3BlPy5zaXplKTsKICAgIGNvbnN0IGtleXMgPSBBcnJheS5p
c0FycmF5KGVudmVsb3BlPy5rZXlzKSA/IGVudmVsb3BlLmtleXMgOiBbXTsKICAgIGNvbnN0IHYxTWltZU9rID0gdmVyc2lvbiAhPT0gMSB8fCBQRU9QTEVf
SU5MSU5FX0lNQUdFX01JTUVTLmhhcyhtaW1lKTsKICAgIGNvbnN0IHYyTmFtZU9rID0gdmVyc2lvbiAhPT0gMiB8fCBTdHJpbmcoZW52ZWxvcGU/Lm5hbWUg
fHwgIiIpLnRyaW0oKS5sZW5ndGggPiAwOwoKICAgIGlmICgKICAgICAgIVsxLCAyXS5pbmNsdWRlcyh2ZXJzaW9uKSB8fAogICAgICAhZnJvbSB8fCAhdG8g
fHwgZnJvbS5sZW5ndGggPiAxMDAgfHwgdG8ubGVuZ3RoID4gMTAwIHx8CiAgICAgICFzZW5kZXJEZXZpY2UgfHwgIXNlbmRlclB1YmxpYyB8fAogICAgICAh
L15bYS16QS1aMC05Xy1dezE2LDQwfSQvLnRlc3QoaXYpIHx8CiAgICAgIG1pbWUgPT09IFBFT1BMRV9ETV9FMkVFX0lNQUdFX01JTUUgfHwgIXYxTWltZU9r
IHx8ICF2Mk5hbWVPayB8fAogICAgICAhTnVtYmVyLmlzSW50ZWdlcihzaXplKSB8fCBzaXplIDwgMSB8fCBzaXplID4gUEVPUExFX01FU1NBR0VfSU1BR0Vf
TUFYX0JZVEVTIHx8CiAgICAgIGtleXMubGVuZ3RoIDwgMSB8fCBrZXlzLmxlbmd0aCA+IDE2CiAgICApIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKCJFMkVF
X0lNQUdFX0hFQURFUl9JTlZBTElEIik7CiAgICB9CgogICAgY29uc3Qgbm9ybWFsaXplZEtleXMgPSBrZXlzLm1hcCgoaXRlbSkgPT4gewogICAgICBjb25z
dCB1c2VySWQgPSBTdHJpbmcoaXRlbT8udSB8fCAiIik7CiAgICAgIGNvbnN0IGRldmljZUlkID0gcGVvcGxlRTJlZURldmljZUlkKGl0ZW0/LmQpOwogICAg
ICBjb25zdCB3cmFwSXYgPSBTdHJpbmcoaXRlbT8uaXYgfHwgIiIpOwogICAgICBjb25zdCB3cmFwcGVkID0gU3RyaW5nKGl0ZW0/LmN0IHx8ICIiKTsKICAg
ICAgaWYgKAogICAgICAgICF1c2VySWQgfHwgdXNlcklkLmxlbmd0aCA+IDEwMCB8fCAhZGV2aWNlSWQgfHwKICAgICAgICAhL15bYS16QS1aMC05Xy1dezE2
LDQwfSQvLnRlc3Qod3JhcEl2KSB8fAogICAgICAgICEvXlthLXpBLVowLTlfLV17MzIsMTYwfSQvLnRlc3Qod3JhcHBlZCkKICAgICAgKSB7CiAgICAgICAg
dGhyb3cgbmV3IEVycm9yKCJFMkVFX0lNQUdFX0hFQURFUl9JTlZBTElEIik7CiAgICAgIH0KICAgICAgcmV0dXJuIHsgdTogdXNlcklkLCBkOiBkZXZpY2VJ
ZCwgaXY6IHdyYXBJdiwgY3Q6IHdyYXBwZWQgfTsKICAgIH0pOwoKICAgIGNvbnN0IGNpcGhlcnRleHQgPSBidWZmZXIuc3ViYXJyYXkoaGVhZGVyRW5kKTsK
ICAgIGlmIChjaXBoZXJ0ZXh0Lmxlbmd0aCAhPT0gc2l6ZSArIDE2KSB0aHJvdyBuZXcgRXJyb3IoIkUyRUVfSU1BR0VfQ0lQSEVSVEVYVF9JTlZBTElEIik7
CiAgICByZXR1cm4gewogICAgICB2OiB2ZXJzaW9uLAogICAgICBmcm9tLAogICAgICB0bywKICAgICAgc2Q6IHNlbmRlckRldmljZSwKICAgICAgc3BrOiBz
ZW5kZXJQdWJsaWMsCiAgICAgIGl2LAogICAgICBtaW1lLAogICAgICBuYW1lLAogICAgICBzaXplLAogICAgICBrZXlzOiBub3JtYWxpemVkS2V5cywKICAg
ICAgY2lwaGVydGV4dAogICAgfTsKICB9IGNhdGNoIChjYXVzZSkgewogICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCJFMkVFX0lNQUdFX0lOVkFMSUQiKTsK
ICAgIGVyci5jb2RlID0gIkUyRUVfSU1BR0VfSU5WQUxJRCI7CiAgICBlcnIuY2F1c2UgPSBjYXVzZTsKICAgIHRocm93IGVycjsKICB9Cn0KCmZ1bmN0aW9u
IHBlb3BsZURtRTJlZUltYWdlTWF0Y2hlc0NvbnZlcnNhdGlvbihlbnZlbG9wZSwgc2VuZGVySWQsIHJlY2lwaWVudElkKSB7CiAgaWYgKCFlbnZlbG9wZSkg
cmV0dXJuIGZhbHNlOwogIGNvbnN0IHNlbmRlciA9IFN0cmluZyhzZW5kZXJJZCk7CiAgY29uc3QgcmVjaXBpZW50ID0gU3RyaW5nKHJlY2lwaWVudElkKTsK
ICBjb25zdCBhbGxvd2VkSWRzID0gbmV3IFNldChbc2VuZGVyLCByZWNpcGllbnRdKTsKICBjb25zdCBrZXlzID0gQXJyYXkuaXNBcnJheShlbnZlbG9wZS5r
ZXlzKSA/IGVudmVsb3BlLmtleXMgOiBbXTsKICByZXR1cm4gKAogICAgZW52ZWxvcGUuZnJvbSA9PT0gc2VuZGVyICYmCiAgICBlbnZlbG9wZS50byA9PT0g
cmVjaXBpZW50ICYmCiAgICBrZXlzLnNvbWUoKGl0ZW0pID0+IFN0cmluZyhpdGVtPy51KSA9PT0gc2VuZGVyKSAmJgogICAga2V5cy5zb21lKChpdGVtKSA9
PiBTdHJpbmcoaXRlbT8udSkgPT09IHJlY2lwaWVudCkgJiYKICAgICFrZXlzLnNvbWUoKGl0ZW0pID0+ICFhbGxvd2VkSWRzLmhhcyhTdHJpbmcoaXRlbT8u
dSkpKQogICk7Cn0KCmNvbnN0IFBFT1BMRV9MT0NBTF9NRVNTQUdFX0lNQUdFX0RJUiA9IHBhdGhBY2NvdW50cy5qb2luKF9fZGlybmFtZSwgInBlb3BsZS1t
ZXNzYWdlLWltYWdlcyIpOwpjb25zdCBQRU9QTEVfTE9DQUxfTUVTU0FHRV9JTUFHRV9NRVRBID0gcGF0aEFjY291bnRzLmpvaW4oX19kaXJuYW1lLCAicGVv
cGxlLW1lc3NhZ2UtaW1hZ2VzLmxvY2FsLmpzb24iKTsKY29uc3QgcGVvcGxlTWVzc2FnZUltYWdlUmF0ZSA9IG5ldyBNYXAoKTsKCmZ1bmN0aW9uIHBlb3Bs
ZU1lc3NhZ2VJbWFnZU1pbWUoYnVmZmVyKSB7CiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmZmVyKSkgcmV0dXJuIG51bGw7CiAgaWYgKAogICAgYnVmZmVy
Lmxlbmd0aCA+PSA4ICYmCiAgICBidWZmZXIuc3ViYXJyYXkoMCwgOCkuZXF1YWxzKEJ1ZmZlci5mcm9tKFsweDg5LDB4NTAsMHg0ZSwweDQ3LDB4MGQsMHgw
YSwweDFhLDB4MGFdKSkKICApIHJldHVybiAiaW1hZ2UvcG5nIjsKICBpZiAoYnVmZmVyLmxlbmd0aCA+PSAzICYmIGJ1ZmZlclswXSA9PT0gMHhmZiAmJiBi
dWZmZXJbMV0gPT09IDB4ZDggJiYgYnVmZmVyWzJdID09PSAweGZmKSByZXR1cm4gImltYWdlL2pwZWciOwogIGlmIChidWZmZXIubGVuZ3RoID49IDYpIHsK
ICAgIGNvbnN0IHNpZyA9IGJ1ZmZlci5zdWJhcnJheSgwLCA2KS50b1N0cmluZygiYXNjaWkiKTsKICAgIGlmIChzaWcgPT09ICJHSUY4N2EiIHx8IHNpZyA9
PT0gIkdJRjg5YSIpIHJldHVybiAiaW1hZ2UvZ2lmIjsKICB9CiAgaWYgKAogICAgYnVmZmVyLmxlbmd0aCA+PSAxMiAmJgogICAgYnVmZmVyLnN1YmFycmF5
KDAsIDQpLnRvU3RyaW5nKCJhc2NpaSIpID09PSAiUklGRiIgJiYKICAgIGJ1ZmZlci5zdWJhcnJheSg4LCAxMikudG9TdHJpbmcoImFzY2lpIikgPT09ICJX
RUJQIgogICkgcmV0dXJuICJpbWFnZS93ZWJwIjsKICByZXR1cm4gbnVsbDsKfQoKZnVuY3Rpb24gcGVvcGxlTWVzc2FnZUltYWdlRXh0ZW5zaW9uKG1pbWUp
IHsKICByZXR1cm4gewogICAgImltYWdlL2pwZWciOiAiLmpwZyIsCiAgICAiaW1hZ2UvcG5nIjogIi5wbmciLAogICAgImltYWdlL3dlYnAiOiAiLndlYnAi
LAogICAgImltYWdlL2dpZiI6ICIuZ2lmIiwKICAgICJ2aWRlby9tcDQiOiAiLm1wNCIsCiAgICAidmlkZW8vd2VibSI6ICIud2VibSIsCiAgICAidmlkZW8v
b2dnIjogIi5vZ3YiLAogICAgInZpZGVvL3F1aWNrdGltZSI6ICIubW92IiwKICAgIFtQRU9QTEVfRE1fRTJFRV9JTUFHRV9NSU1FXTogIi5iaW4iCiAgfVtt
aW1lXSB8fCAiLmJpbiI7Cn0KCmZ1bmN0aW9uIHBlb3BsZU5vcm1hbGl6ZU1lc3NhZ2VJbWFnZUlkKHZhbHVlKSB7CiAgcmV0dXJuIFN0cmluZyh2YWx1ZSB8
fCAiIikudHJpbSgpLnNsaWNlKDAsIDEwMCk7Cn0KCmZ1bmN0aW9uIHBlb3BsZU1lc3NhZ2VJbWFnZVVwbG9hZEFsbG93ZWQoYWNjb3VudElkKSB7CiAgY29u
c3Qga2V5ID0gU3RyaW5nKGFjY291bnRJZCk7CiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTsKICBjb25zdCByZWNlbnQgPSAocGVvcGxlTWVzc2FnZUltYWdl
UmF0ZS5nZXQoa2V5KSB8fCBbXSkuZmlsdGVyKCh0aW1lKSA9PiBub3cgLSB0aW1lIDwgNjAgKiAxMDAwKTsKICBpZiAocmVjZW50Lmxlbmd0aCA+PSAxMikg
ewogICAgcGVvcGxlTWVzc2FnZUltYWdlUmF0ZS5zZXQoa2V5LCByZWNlbnQpOwogICAgcmV0dXJuIGZhbHNlOwogIH0KICByZWNlbnQucHVzaChub3cpOwog
IHBlb3BsZU1lc3NhZ2VJbWFnZVJhdGUuc2V0KGtleSwgcmVjZW50KTsKICByZXR1cm4gdHJ1ZTsKfQoKZnVuY3Rpb24gcGVvcGxlUmVhZExvY2FsTWVzc2Fn
ZUltYWdlTWV0YSgpIHsKICB0cnkgewogICAgaWYgKCFmc0FjY291bnRzLmV4aXN0c1N5bmMoUEVPUExFX0xPQ0FMX01FU1NBR0VfSU1BR0VfTUVUQSkpIHJl
dHVybiB7fTsKICAgIGNvbnN0IHJhdyA9IEpTT04ucGFyc2UoZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoUEVPUExFX0xPQ0FMX01FU1NBR0VfSU1BR0VfTUVU
QSwgInV0ZjgiKSk7CiAgICByZXR1cm4gcmF3ICYmIHR5cGVvZiByYXcgPT09ICJvYmplY3QiICYmICFBcnJheS5pc0FycmF5KHJhdykgPyByYXcgOiB7fTsK
ICB9IGNhdGNoIHsgcmV0dXJuIHt9OyB9Cn0KCmZ1bmN0aW9uIHBlb3BsZVdyaXRlTG9jYWxNZXNzYWdlSW1hZ2VNZXRhKG1ldGEpIHsKICBmc0FjY291bnRz
LndyaXRlRmlsZVN5bmMoCiAgICBQRU9QTEVfTE9DQUxfTUVTU0FHRV9JTUFHRV9NRVRBLAogICAgSlNPTi5zdHJpbmdpZnkobWV0YSB8fCB7fSwgbnVsbCwg
MikgKyAiXG4iLAogICAgInV0ZjgiCiAgKTsKfQoKbGV0IHBlb3BsZU1lc3NhZ2VJbWFnZUxhc3RDbGVhbnVwQXQgPSAwOwpjb25zdCBQRU9QTEVfTUVTU0FH
RV9JTUFHRV9DTEVBTlVQX0lOVEVSVkFMX01TID0gNjAgKiA2MCAqIDEwMDA7Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVDcmVhdGVQZW5kaW5nTWVzc2FnZUlt
YWdlKG93bmVySWQsIGJ1ZmZlciwgdXBsb2FkTWV0YSA9IHt9KSB7CiAgaWYgKAogICAgIUJ1ZmZlci5pc0J1ZmZlcihidWZmZXIpIHx8ICFidWZmZXIubGVu
Z3RoIHx8CiAgICBidWZmZXIubGVuZ3RoID4gUEVPUExFX01FU1NBR0VfSU1BR0VfVFJBTlNQT1JUX01BWF9CWVRFUwogICkgewogICAgY29uc3QgZXJyID0g
bmV3IEVycm9yKCJJTUFHRV9TSVpFIik7CiAgICBlcnIuY29kZSA9ICJJTUFHRV9TSVpFIjsKICAgIHRocm93IGVycjsKICB9CgogIGNvbnN0IG93bmVyID0g
U3RyaW5nKG93bmVySWQpOwogIGxldCBlMmVlSW1hZ2UgPSBwZW9wbGVEbUUyZWVJbWFnZUNvbnRhaW5lcihidWZmZXIpOwogIGxldCBtaW1lOwogIGxldCBw
bGFpbkZvclN0b3JhZ2U7CiAgbGV0IG5hbWU7CgogIGlmIChlMmVlSW1hZ2UpIHsKICAgIGlmIChlMmVlSW1hZ2UuZnJvbSAhPT0gb3duZXIpIHsKICAgICAg
Y29uc3QgZXJyID0gbmV3IEVycm9yKCJFMkVFX0lNQUdFX0lOVkFMSUQiKTsKICAgICAgZXJyLmNvZGUgPSAiRTJFRV9JTUFHRV9JTlZBTElEIjsKICAgICAg
dGhyb3cgZXJyOwogICAgfQogICAgbWltZSA9IFBFT1BMRV9ETV9FMkVFX0lNQUdFX01JTUU7CiAgICBuYW1lID0gInBpZWNlLWpvaW50ZS1lMmVlLmJpbiI7
CiAgICBwbGFpbkZvclN0b3JhZ2UgPSBidWZmZXI7CiAgfSBlbHNlIHsKICAgIGlmIChidWZmZXIubGVuZ3RoID4gUEVPUExFX01FU1NBR0VfSU1BR0VfTUFY
X0JZVEVTKSB7CiAgICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigiSU1BR0VfU0laRSIpOwogICAgICBlcnIuY29kZSA9ICJJTUFHRV9TSVpFIjsKICAgICAg
dGhyb3cgZXJyOwogICAgfQogICAgY29uc3QgZGVjbGFyZWRNaW1lID0gcGVvcGxlQXR0YWNobWVudE1pbWUodXBsb2FkTWV0YS5taW1lKTsKICAgIGNvbnN0
IHNuaWZmZWRJbWFnZSA9IHBlb3BsZU1lc3NhZ2VJbWFnZU1pbWUoYnVmZmVyKTsKICAgIG1pbWUgPSBzbmlmZmVkSW1hZ2UgfHwgZGVjbGFyZWRNaW1lOwog
ICAgbmFtZSA9IHBlb3BsZUF0dGFjaG1lbnROYW1lKHVwbG9hZE1ldGEubmFtZSwgc25pZmZlZEltYWdlID8gImltYWdlIiA6ICJmaWNoaWVyIik7CiAgICBw
bGFpbkZvclN0b3JhZ2UgPSBwZW9wbGVQYWNrTWVzc2FnZUF0dGFjaG1lbnQoYnVmZmVyLCBuYW1lLCBtaW1lKTsKICB9CgogIGNvbnN0IHN0b3JlZERhdGEg
PSBwZW9wbGVFbmNyeXB0TWVzc2FnZUltYWdlRGF0YShwbGFpbkZvclN0b3JhZ2UpOwogIGNvbnN0IHN0b3JhZ2VNaW1lID0gbWltZS5sZW5ndGggPD0gMzIg
PyBtaW1lIDogImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSI7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpOwogICAg
aWYgKG5vdyAtIHBlb3BsZU1lc3NhZ2VJbWFnZUxhc3RDbGVhbnVwQXQgPj0gUEVPUExFX01FU1NBR0VfSU1BR0VfQ0xFQU5VUF9JTlRFUlZBTF9NUykgewog
ICAgICBwZW9wbGVNZXNzYWdlSW1hZ2VMYXN0Q2xlYW51cEF0ID0gbm93OwogICAgICB0cnkgewogICAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAg
ICAgICAgICAiREVMRVRFIEZST00gcGVvcGxlX21lc3NhZ2VfaW1hZ2VzICIgKwogICAgICAgICAgIldIRVJFIGdlbmVyYWxfbWVzc2FnZV9pZCBJUyBOVUxM
IEFORCBkbV9tZXNzYWdlX2lkIElTIE5VTEwgIiArCiAgICAgICAgICAiQU5EIGNyZWF0ZWRfYXQgPCBOT1coKSAtIElOVEVSVkFMICcxIGRheSciCiAgICAg
ICAgKTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgY29uc29sZS53YXJuKCJbUGVvcGxlIGF0dGFjaG1lbnQgY2xlYW51cF0iLCBlcnI/Lm1lc3Nh
Z2UgfHwgZXJyKTsKICAgICAgfQogICAgfQoKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJJTlNFUlQgSU5UTyBw
ZW9wbGVfbWVzc2FnZV9pbWFnZXMgKG93bmVyX2lkLCBtaW1lX3R5cGUsIGRhdGEpIFZBTFVFUyAoJDEsICQyLCAkMykgUkVUVVJOSU5HIGlkIiwKICAgICAg
W293bmVyLCBzdG9yYWdlTWltZSwgc3RvcmVkRGF0YV0KICAgICk7CiAgICByZXR1cm4geyBpZDogU3RyaW5nKHJlc3VsdC5yb3dzWzBdLmlkKSwgbWltZSB9
OwogIH0KCiAgZnNBY2NvdW50cy5ta2RpclN5bmMoUEVPUExFX0xPQ0FMX01FU1NBR0VfSU1BR0VfRElSLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTsKICBjb25z
dCBpZCA9IGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKTsKICBjb25zdCBmaWxlID0gaWQgKyBwZW9wbGVNZXNzYWdlSW1hZ2VFeHRlbnNpb24obWltZSk7
CiAgZnNBY2NvdW50cy53cml0ZUZpbGVTeW5jKHBhdGhBY2NvdW50cy5qb2luKFBFT1BMRV9MT0NBTF9NRVNTQUdFX0lNQUdFX0RJUiwgZmlsZSksIHN0b3Jl
ZERhdGEpOwoKICBjb25zdCBtZXRhID0gcGVvcGxlUmVhZExvY2FsTWVzc2FnZUltYWdlTWV0YSgpOwogIG1ldGFbaWRdID0gewogICAgaWQsCiAgICBvd25l
cklkOiBvd25lciwKICAgIG1pbWU6IHN0b3JhZ2VNaW1lLAogICAgZmlsZSwKICAgIGUyZWVGcm9tOiBlMmVlSW1hZ2U/LmZyb20gfHwgbnVsbCwKICAgIGUy
ZWVUbzogZTJlZUltYWdlPy50byB8fCBudWxsLAogICAgc2NvcGU6IG51bGwsCiAgICBtZXNzYWdlSWQ6IG51bGwsCiAgICBzZW5kZXJJZDogbnVsbCwKICAg
IHJlY2lwaWVudElkOiBudWxsLAogICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkKICB9OwogIHBlb3BsZVdyaXRlTG9jYWxNZXNzYWdl
SW1hZ2VNZXRhKG1ldGEpOwogIHJldHVybiB7IGlkLCBtaW1lIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUJpbmRHZW5lcmFsTWVzc2FnZUltYWdlKG93
bmVySWQsIGltYWdlSWQsIG1lc3NhZ2VJZCwgY2xpZW50ID0gcGVvcGxlUG9vbCkgewogIGNvbnN0IGltYWdlS2V5ID0gcGVvcGxlTm9ybWFsaXplTWVzc2Fn
ZUltYWdlSWQoaW1hZ2VJZCk7CiAgaWYgKCFpbWFnZUtleSkgcmV0dXJuIG51bGw7CiAgY29uc3Qgb3duZXIgPSBTdHJpbmcob3duZXJJZCk7CiAgY29uc3Qg
bWVzc2FnZSA9IFN0cmluZyhtZXNzYWdlSWQpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgaWYgKCEvXlxkKyQvLnRlc3QoaW1hZ2VLZXkpKSByZXR1cm4g
bnVsbDsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNsaWVudC5xdWVyeSgKICAgICAgIlVQREFURSBwZW9wbGVfbWVzc2FnZV9pbWFnZXMgU0VUIGdlbmVy
YWxfbWVzc2FnZV9pZCA9ICQzICIgKwogICAgICAiV0hFUkUgaWQgPSAkMSBBTkQgb3duZXJfaWQgPSAkMiBBTkQgZ2VuZXJhbF9tZXNzYWdlX2lkIElTIE5V
TEwgIiArCiAgICAgICJBTkQgZG1fbWVzc2FnZV9pZCBJUyBOVUxMIEFORCBtaW1lX3R5cGUgPD4gJDQgUkVUVVJOSU5HIGlkIiwKICAgICAgW2ltYWdlS2V5
LCBvd25lciwgbWVzc2FnZSwgUEVPUExFX0RNX0UyRUVfSU1BR0VfTUlNRV0KICAgICk7CiAgICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gPyBTdHJpbmcocmVz
dWx0LnJvd3NbMF0uaWQpIDogbnVsbDsKICB9CgogIGNvbnN0IG1ldGEgPSBwZW9wbGVSZWFkTG9jYWxNZXNzYWdlSW1hZ2VNZXRhKCk7CiAgY29uc3QgaXRl
bSA9IG1ldGFbaW1hZ2VLZXldOwogIGlmICghaXRlbSB8fCBTdHJpbmcoaXRlbS5vd25lcklkKSAhPT0gb3duZXIgfHwgaXRlbS5zY29wZSB8fCBpdGVtLm1p
bWUgPT09IFBFT1BMRV9ETV9FMkVFX0lNQUdFX01JTUUpIHJldHVybiBudWxsOwogIGl0ZW0uc2NvcGUgPSAiZ2VuZXJhbCI7CiAgaXRlbS5tZXNzYWdlSWQg
PSBtZXNzYWdlOwogIG1ldGFbaW1hZ2VLZXldID0gaXRlbTsKICBwZW9wbGVXcml0ZUxvY2FsTWVzc2FnZUltYWdlTWV0YShtZXRhKTsKICByZXR1cm4gaW1h
Z2VLZXk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUJpbmREbU1lc3NhZ2VJbWFnZShvd25lcklkLCBpbWFnZUlkLCBtZXNzYWdlSWQsIHNlbmRlcklkLCBy
ZWNpcGllbnRJZCwgY2xpZW50ID0gcGVvcGxlUG9vbCkgewogIGNvbnN0IGltYWdlS2V5ID0gcGVvcGxlTm9ybWFsaXplTWVzc2FnZUltYWdlSWQoaW1hZ2VJ
ZCk7CiAgaWYgKCFpbWFnZUtleSkgcmV0dXJuIG51bGw7CiAgY29uc3Qgb3duZXIgPSBTdHJpbmcob3duZXJJZCk7CiAgY29uc3QgbWVzc2FnZSA9IFN0cmlu
ZyhtZXNzYWdlSWQpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgaWYgKCEvXlxkKyQvLnRlc3QoaW1hZ2VLZXkpKSByZXR1cm4gbnVsbDsKICAgIGNvbnN0
IHBlbmRpbmcgPSBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICJTRUxFQ1QgbWltZV90eXBlLCBkYXRhIEZST00gcGVvcGxlX21lc3NhZ2VfaW1hZ2VzICIg
KwogICAgICAiV0hFUkUgaWQgPSAkMSBBTkQgb3duZXJfaWQgPSAkMiBBTkQgZ2VuZXJhbF9tZXNzYWdlX2lkIElTIE5VTEwgIiArCiAgICAgICJBTkQgZG1f
bWVzc2FnZV9pZCBJUyBOVUxMIEZPUiBVUERBVEUiLAogICAgICBbaW1hZ2VLZXksIG93bmVyXQogICAgKTsKICAgIGNvbnN0IHBlbmRpbmdSb3cgPSBwZW5k
aW5nLnJvd3NbMF07CiAgICBpZiAoIXBlbmRpbmdSb3cpIHJldHVybiBudWxsOwogICAgaWYgKHBlbmRpbmdSb3cubWltZV90eXBlID09PSBQRU9QTEVfRE1f
RTJFRV9JTUFHRV9NSU1FKSB7CiAgICAgIGNvbnN0IGVudmVsb3BlID0gcGVvcGxlRG1FMmVlSW1hZ2VDb250YWluZXIoCiAgICAgICAgcGVvcGxlRGVjcnlw
dE1lc3NhZ2VJbWFnZURhdGEocGVuZGluZ1Jvdy5kYXRhKQogICAgICApOwogICAgICBpZiAoIXBlb3BsZURtRTJlZUltYWdlTWF0Y2hlc0NvbnZlcnNhdGlv
bihlbnZlbG9wZSwgc2VuZGVySWQsIHJlY2lwaWVudElkKSkgcmV0dXJuIG51bGw7CiAgICB9CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjbGllbnQucXVl
cnkoCiAgICAgICJVUERBVEUgcGVvcGxlX21lc3NhZ2VfaW1hZ2VzIFNFVCBkbV9tZXNzYWdlX2lkID0gJDMgIiArCiAgICAgICJXSEVSRSBpZCA9ICQxIEFO
RCBvd25lcl9pZCA9ICQyIEFORCBnZW5lcmFsX21lc3NhZ2VfaWQgSVMgTlVMTCAiICsKICAgICAgIkFORCBkbV9tZXNzYWdlX2lkIElTIE5VTEwgUkVUVVJO
SU5HIGlkIiwKICAgICAgW2ltYWdlS2V5LCBvd25lciwgbWVzc2FnZV0KICAgICk7CiAgICByZXR1cm4gcmVzdWx0LnJvd3NbMF0gPyBTdHJpbmcocmVzdWx0
LnJvd3NbMF0uaWQpIDogbnVsbDsKICB9CgogIGNvbnN0IG1ldGEgPSBwZW9wbGVSZWFkTG9jYWxNZXNzYWdlSW1hZ2VNZXRhKCk7CiAgY29uc3QgaXRlbSA9
IG1ldGFbaW1hZ2VLZXldOwogIGlmICghaXRlbSB8fCBTdHJpbmcoaXRlbS5vd25lcklkKSAhPT0gb3duZXIgfHwgaXRlbS5zY29wZSkgcmV0dXJuIG51bGw7
CiAgaWYgKGl0ZW0ubWltZSA9PT0gUEVPUExFX0RNX0UyRUVfSU1BR0VfTUlNRSkgewogICAgY29uc3QgZmlsZVBhdGggPSBwYXRoQWNjb3VudHMuam9pbihQ
RU9QTEVfTE9DQUxfTUVTU0FHRV9JTUFHRV9ESVIsIGl0ZW0uZmlsZSk7CiAgICBpZiAoIWZzQWNjb3VudHMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHJldHVy
biBudWxsOwogICAgY29uc3QgZW52ZWxvcGUgPSBwZW9wbGVEbUUyZWVJbWFnZUNvbnRhaW5lcigKICAgICAgcGVvcGxlRGVjcnlwdE1lc3NhZ2VJbWFnZURh
dGEoZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoZmlsZVBhdGgpKQogICAgKTsKICAgIGlmICghcGVvcGxlRG1FMmVlSW1hZ2VNYXRjaGVzQ29udmVyc2F0aW9u
KGVudmVsb3BlLCBzZW5kZXJJZCwgcmVjaXBpZW50SWQpKSByZXR1cm4gbnVsbDsKICB9CiAgaXRlbS5zY29wZSA9ICJkbSI7CiAgaXRlbS5tZXNzYWdlSWQg
PSBtZXNzYWdlOwogIGl0ZW0uc2VuZGVySWQgPSBTdHJpbmcoc2VuZGVySWQpOwogIGl0ZW0ucmVjaXBpZW50SWQgPSBTdHJpbmcocmVjaXBpZW50SWQpOwog
IG1ldGFbaW1hZ2VLZXldID0gaXRlbTsKICBwZW9wbGVXcml0ZUxvY2FsTWVzc2FnZUltYWdlTWV0YShtZXRhKTsKICByZXR1cm4gaW1hZ2VLZXk7Cn0KCmZ1
bmN0aW9uIHBlb3BsZVNlbmRNZXNzYWdlQXR0YWNobWVudChyZXEsIHJlcywgYXR0YWNobWVudCkgewogIGNvbnN0IGRhdGEgPSBCdWZmZXIuaXNCdWZmZXIo
YXR0YWNobWVudD8uZGF0YSkgPyBhdHRhY2htZW50LmRhdGEgOiBCdWZmZXIuYWxsb2MoMCk7CiAgY29uc3QgbWltZSA9IHBlb3BsZUF0dGFjaG1lbnRNaW1l
KGF0dGFjaG1lbnQ/Lm1pbWUpOwogIGNvbnN0IG5hbWUgPSBwZW9wbGVBdHRhY2htZW50TmFtZShhdHRhY2htZW50Py5uYW1lKTsKICBjb25zdCBlbmNvZGVk
TmFtZSA9IGVuY29kZVVSSUNvbXBvbmVudChuYW1lKTsKICBjb25zdCBpbmxpbmUgPSBQRU9QTEVfSU5MSU5FX0lNQUdFX01JTUVTLmhhcyhtaW1lKSB8fCBQ
RU9QTEVfSU5MSU5FX1ZJREVPX01JTUVTLmhhcyhtaW1lKSB8fCBtaW1lLnN0YXJ0c1dpdGgoImF1ZGlvLyIpOwoKICByZXMuc2V0SGVhZGVyKCJDb250ZW50
LVR5cGUiLCBtaW1lKTsKICByZXMuc2V0SGVhZGVyKCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zIiwgIm5vc25pZmYiKTsKICByZXMuc2V0SGVhZGVyKCJDYWNo
ZS1Db250cm9sIiwgInByaXZhdGUsIG1heC1hZ2U9ODY0MDAiKTsKICByZXMuc2V0SGVhZGVyKCJBY2NlcHQtUmFuZ2VzIiwgImJ5dGVzIik7CiAgcmVzLnNl
dEhlYWRlcigiWC1QZW9wbGUtRmlsZS1OYW1lIiwgZW5jb2RlZE5hbWUpOwogIHJlcy5zZXRIZWFkZXIoIlgtUGVvcGxlLU9yaWdpbmFsLVNpemUiLCBTdHJp
bmcoZGF0YS5sZW5ndGgpKTsKICByZXMuc2V0SGVhZGVyKAogICAgIkNvbnRlbnQtRGlzcG9zaXRpb24iLAogICAgKGlubGluZSA/ICJpbmxpbmUiIDogImF0
dGFjaG1lbnQiKSArICI7IGZpbGVuYW1lKj1VVEYtOCcnIiArIGVuY29kZWROYW1lCiAgKTsKCiAgaWYgKHJlcS5tZXRob2QgPT09ICJIRUFEIikgewogICAg
cmVzLnNldEhlYWRlcigiQ29udGVudC1MZW5ndGgiLCBTdHJpbmcoZGF0YS5sZW5ndGgpKTsKICAgIHJldHVybiByZXMuZW5kKCk7CiAgfQoKICBjb25zdCBy
YW5nZSA9IFN0cmluZyhyZXEuaGVhZGVycy5yYW5nZSB8fCAiIik7CiAgY29uc3QgbWF0Y2ggPSAvXmJ5dGVzPShcZCopLShcZCopJC8uZXhlYyhyYW5nZSk7
CiAgaWYgKG1hdGNoICYmIGRhdGEubGVuZ3RoKSB7CiAgICBsZXQgc3RhcnQ7CiAgICBsZXQgZW5kOwogICAgaWYgKG1hdGNoWzFdID09PSAiIiAmJiBtYXRj
aFsyXSAhPT0gIiIpIHsKICAgICAgY29uc3Qgc3VmZml4ID0gTWF0aC5tYXgoMSwgTnVtYmVyKG1hdGNoWzJdKSB8fCAwKTsKICAgICAgc3RhcnQgPSBNYXRo
Lm1heCgwLCBkYXRhLmxlbmd0aCAtIHN1ZmZpeCk7CiAgICAgIGVuZCA9IGRhdGEubGVuZ3RoIC0gMTsKICAgIH0gZWxzZSB7CiAgICAgIHN0YXJ0ID0gTnVt
YmVyKG1hdGNoWzFdKTsKICAgICAgZW5kID0gbWF0Y2hbMl0gPT09ICIiID8gZGF0YS5sZW5ndGggLSAxIDogTnVtYmVyKG1hdGNoWzJdKTsKICAgIH0KICAg
IGlmICgKICAgICAgTnVtYmVyLmlzSW50ZWdlcihzdGFydCkgJiYgTnVtYmVyLmlzSW50ZWdlcihlbmQpICYmCiAgICAgIHN0YXJ0ID49IDAgJiYgc3RhcnQg
PCBkYXRhLmxlbmd0aCAmJiBlbmQgPj0gc3RhcnQKICAgICkgewogICAgICBlbmQgPSBNYXRoLm1pbihlbmQsIGRhdGEubGVuZ3RoIC0gMSk7CiAgICAgIGNv
bnN0IGNodW5rID0gZGF0YS5zdWJhcnJheShzdGFydCwgZW5kICsgMSk7CiAgICAgIHJlcy5zdGF0dXMoMjA2KTsKICAgICAgcmVzLnNldEhlYWRlcigiQ29u
dGVudC1SYW5nZSIsIGBieXRlcyAke3N0YXJ0fS0ke2VuZH0vJHtkYXRhLmxlbmd0aH1gKTsKICAgICAgcmVzLnNldEhlYWRlcigiQ29udGVudC1MZW5ndGgi
LCBTdHJpbmcoY2h1bmsubGVuZ3RoKSk7CiAgICAgIHJldHVybiByZXMuZW5kKGNodW5rKTsKICAgIH0KICAgIHJlcy5zdGF0dXMoNDE2KTsKICAgIHJlcy5z
ZXRIZWFkZXIoIkNvbnRlbnQtUmFuZ2UiLCBgYnl0ZXMgKi8ke2RhdGEubGVuZ3RofWApOwogICAgcmV0dXJuIHJlcy5lbmQoKTsKICB9CgogIHJlcy5zZXRI
ZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgU3RyaW5nKGRhdGEubGVuZ3RoKSk7CiAgcmV0dXJuIHJlcy5lbmQoZGF0YSk7Cn0KCmFwcC5wb3N0KAogICIvYXBp
L2NoYXQvaW1hZ2UiLAogIGV4cHJlc3MucmF3KHsKICAgIHR5cGU6ICgpID0+IHRydWUsCiAgICBsaW1pdDogUEVPUExFX01FU1NBR0VfSU1BR0VfVFJBTlNQ
T1JUX01BWF9CWVRFUwogIH0pLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25G
b3JSZXF1ZXN0KHJlcSwgcmVzKTsKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICAgIGlmICghcGVvcGxlTWVzc2FnZUltYWdlVXBsb2FkQWxsb3dl
ZChzZXNzaW9uLmlkKSkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQyOSkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBlbnZvaWVzIHRyb3Ag
ZGUgcGnDqGNlcyBqb2ludGVzIHRyb3Agdml0ZS4iIH0pOwogICAgICB9CgogICAgICBjb25zdCBhdHRhY2htZW50ID0gYXdhaXQgcGVvcGxlQ3JlYXRlUGVu
ZGluZ01lc3NhZ2VJbWFnZSgKICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgIHJlcS5ib2R5LAogICAgICAgIHsKICAgICAgICAgIG1pbWU6ICgoKSA9PiB7
CiAgICAgICAgICAgIGNvbnN0IHJhdyA9IFN0cmluZyhyZXEuaGVhZGVyc1sieC1wZW9wbGUtZmlsZS10eXBlIl0gfHwgIiIpOwogICAgICAgICAgICBpZiAo
IXJhdykgcmV0dXJuIHJlcS5oZWFkZXJzWyJjb250ZW50LXR5cGUiXTsKICAgICAgICAgICAgdHJ5IHsgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChyYXcp
OyB9IGNhdGNoIHsgcmV0dXJuIHJhdzsgfQogICAgICAgICAgfSkoKSwKICAgICAgICAgIG5hbWU6IHBlb3BsZUF0dGFjaG1lbnROYW1lRnJvbUhlYWRlcihy
ZXEpCiAgICAgICAgfQogICAgICApOwogICAgICByZXMuanNvbih7IG9rOiB0cnVlLCBpbWFnZUlkOiBhdHRhY2htZW50LmlkIH0pOwogICAgfSBjYXRjaCAo
ZXJyKSB7CiAgICAgIGlmIChlcnI/LnR5cGUgPT09ICJlbnRpdHkudG9vLmxhcmdlIiB8fCBlcnI/LmNvZGUgPT09ICJJTUFHRV9TSVpFIikgewogICAgICAg
IHJldHVybiByZXMuc3RhdHVzKDQxMykuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjogYExhIHBpw6hjZSBqb2ludGUgZG9p
dCBmYWlyZSBtb2lucyBkZSAke1BFT1BMRV9NRVNTQUdFX0lNQUdFX01BWF9NQn0gTW8uYAogICAgICAgIH0pOwogICAgICB9CiAgICAgIGlmIChlcnI/LmNv
ZGUgPT09ICJFMkVFX0lNQUdFX0lOVkFMSUQiKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlBp
w6hjZSBqb2ludGUgRTJFRSBpbnZhbGlkZS4iIH0pOwogICAgICB9CiAgICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgY2hhdC9hdHRhY2htZW50IHVwbG9h
ZF0iLCBlcnIpOwogICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGQnZW52b3llciBsYSBwacOoY2Ug
am9pbnRlLiIgfSk7CiAgICB9CiAgfQopOwoKYXBwLmdldCgKICAiL2FwaS9jaGF0L2ltYWdlLzppZCIsCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0
cnkgewogICAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgICBpZiAoIXNlc3Npb24pIHJldHVybjsK
ICAgICAgY29uc3QgaW1hZ2VJZCA9IHBlb3BsZU5vcm1hbGl6ZU1lc3NhZ2VJbWFnZUlkKHJlcS5wYXJhbXMuaWQpOwogICAgICBpZiAoIWltYWdlSWQpIHJl
dHVybiByZXMuc3RhdHVzKDQwNCkuZW5kKCk7CgogICAgICBpZiAocGVvcGxlUG9vbCkgewogICAgICAgIGlmICghL15cZCskLy50ZXN0KGltYWdlSWQpKSBy
ZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmVuZCgpOwogICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgICAiU0VM
RUNUIGkub3duZXJfaWQsIGkubWltZV90eXBlLCBpLmRhdGEsIGkuZ2VuZXJhbF9tZXNzYWdlX2lkLCBpLmRtX21lc3NhZ2VfaWQsICIgKwogICAgICAgICAg
ImRtLnNlbmRlcl9pZCwgZG0ucmVjaXBpZW50X2lkLCBnbS5zZXJ2ZXJfaWQgQVMgZ2VuZXJhbF9zZXJ2ZXJfaWQsIGdtLmNoYW5uZWxfaWQgQVMgZ2VuZXJh
bF9jaGFubmVsX2lkICIgKwogICAgICAgICAgIkZST00gcGVvcGxlX21lc3NhZ2VfaW1hZ2VzIGkgIiArCiAgICAgICAgICAiTEVGVCBKT0lOIHBlb3BsZV9k
aXJlY3RfbWVzc2FnZXMgZG0gT04gZG0uaWQgPSBpLmRtX21lc3NhZ2VfaWQgIiArCiAgICAgICAgICAiTEVGVCBKT0lOIHBlb3BsZV9nZW5lcmFsX21lc3Nh
Z2VzIGdtIE9OIGdtLmlkID0gaS5nZW5lcmFsX21lc3NhZ2VfaWQgIiArCiAgICAgICAgICAiV0hFUkUgaS5pZCA9ICQxIExJTUlUIDEiLAogICAgICAgICAg
W2ltYWdlSWRdCiAgICAgICAgKTsKICAgICAgICBjb25zdCByb3cgPSByZXN1bHQucm93c1swXTsKICAgICAgICBpZiAoIXJvdykgcmV0dXJuIHJlcy5zdGF0
dXMoNDA0KS5lbmQoKTsKICAgICAgICBjb25zdCBtZSA9IFN0cmluZyhzZXNzaW9uLmlkKTsKICAgICAgICBjb25zdCBnZW5lcmFsQWxsb3dlZCA9IHJvdy5n
ZW5lcmFsX21lc3NhZ2VfaWQgJiYgcm93LmdlbmVyYWxfc2VydmVyX2lkICYmIHJvdy5nZW5lcmFsX2NoYW5uZWxfaWQgJiYKICAgICAgICAgIGF3YWl0IHBl
b3BsZUNhblNlcnZlclBlcm1pc3Npb24obWUsIHJvdy5nZW5lcmFsX3NlcnZlcl9pZCwgIlZJRVdfQ0hBTk5FTCIsIHJvdy5nZW5lcmFsX2NoYW5uZWxfaWQp
OwogICAgICAgIGNvbnN0IGFsbG93ZWQgPSBCb29sZWFuKGdlbmVyYWxBbGxvd2VkKSB8fCBTdHJpbmcocm93Lm93bmVyX2lkKSA9PT0gbWUgfHwKICAgICAg
ICAgIChyb3cuZG1fbWVzc2FnZV9pZCAmJiAoU3RyaW5nKHJvdy5zZW5kZXJfaWQpID09PSBtZSB8fCBTdHJpbmcocm93LnJlY2lwaWVudF9pZCkgPT09IG1l
KSk7CiAgICAgICAgaWYgKCFhbGxvd2VkKSByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmVuZCgpOwoKICAgICAgICBjb25zdCByYXcgPSBwZW9wbGVEZWNyeXB0
TWVzc2FnZUltYWdlRGF0YShyb3cuZGF0YSk7CiAgICAgICAgaWYgKHJvdy5taW1lX3R5cGUgPT09IFBFT1BMRV9ETV9FMkVFX0lNQUdFX01JTUUpIHsKICAg
ICAgICAgIHJldHVybiBwZW9wbGVTZW5kTWVzc2FnZUF0dGFjaG1lbnQocmVxLCByZXMsIHsKICAgICAgICAgICAgZGF0YTogcmF3LAogICAgICAgICAgICBt
aW1lOiBQRU9QTEVfRE1fRTJFRV9JTUFHRV9NSU1FLAogICAgICAgICAgICBuYW1lOiAicGllY2Utam9pbnRlLWUyZWUuYmluIgogICAgICAgICAgfSk7CiAg
ICAgICAgfQogICAgICAgIGNvbnN0IGF0dGFjaG1lbnQgPSBwZW9wbGVVbnBhY2tNZXNzYWdlQXR0YWNobWVudChyYXcsIHJvdy5taW1lX3R5cGUpOwogICAg
ICAgIHJldHVybiBwZW9wbGVTZW5kTWVzc2FnZUF0dGFjaG1lbnQocmVxLCByZXMsIGF0dGFjaG1lbnQpOwogICAgICB9CgogICAgICBjb25zdCBtZXRhID0g
cGVvcGxlUmVhZExvY2FsTWVzc2FnZUltYWdlTWV0YSgpOwogICAgICBjb25zdCBpdGVtID0gbWV0YVtpbWFnZUlkXTsKICAgICAgaWYgKCFpdGVtKSByZXR1
cm4gcmVzLnN0YXR1cyg0MDQpLmVuZCgpOwogICAgICBjb25zdCBtZSA9IFN0cmluZyhzZXNzaW9uLmlkKTsKICAgICAgY29uc3QgZ2VuZXJhbE1lc3NhZ2Ug
PSBpdGVtLnNjb3BlID09PSAiZ2VuZXJhbCIKICAgICAgICA/IHBlb3BsZVJlYWRMb2NhbEdlbmVyYWwoKS5maW5kKChtZXNzYWdlKSA9PiBTdHJpbmcobWVz
c2FnZS5pZCkgPT09IFN0cmluZyhpdGVtLm1lc3NhZ2VJZCkpCiAgICAgICAgOiBudWxsOwogICAgICBjb25zdCBnZW5lcmFsQWxsb3dlZCA9IGdlbmVyYWxN
ZXNzYWdlPy5zZXJ2ZXJJZCAmJiBnZW5lcmFsTWVzc2FnZT8uY2hhbm5lbElkCiAgICAgICAgPyBhd2FpdCBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKG1l
LCBnZW5lcmFsTWVzc2FnZS5zZXJ2ZXJJZCwgIlZJRVdfQ0hBTk5FTCIsIGdlbmVyYWxNZXNzYWdlLmNoYW5uZWxJZCkKICAgICAgICA6IGZhbHNlOwogICAg
ICBjb25zdCBhbGxvd2VkID0gQm9vbGVhbihnZW5lcmFsQWxsb3dlZCkgfHwgU3RyaW5nKGl0ZW0ub3duZXJJZCkgPT09IG1lIHx8CiAgICAgICAgKGl0ZW0u
c2NvcGUgPT09ICJkbSIgJiYgKFN0cmluZyhpdGVtLnNlbmRlcklkKSA9PT0gbWUgfHwgU3RyaW5nKGl0ZW0ucmVjaXBpZW50SWQpID09PSBtZSkpOwogICAg
ICBpZiAoIWFsbG93ZWQpIHJldHVybiByZXMuc3RhdHVzKDQwMykuZW5kKCk7CgogICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGhBY2NvdW50cy5qb2luKFBF
T1BMRV9MT0NBTF9NRVNTQUdFX0lNQUdFX0RJUiwgaXRlbS5maWxlKTsKICAgICAgaWYgKCFmc0FjY291bnRzLmV4aXN0c1N5bmMoZmlsZVBhdGgpKSByZXR1
cm4gcmVzLnN0YXR1cyg0MDQpLmVuZCgpOwogICAgICBjb25zdCByYXcgPSBwZW9wbGVEZWNyeXB0TWVzc2FnZUltYWdlRGF0YShmc0FjY291bnRzLnJlYWRG
aWxlU3luYyhmaWxlUGF0aCkpOwogICAgICBpZiAoaXRlbS5taW1lID09PSBQRU9QTEVfRE1fRTJFRV9JTUFHRV9NSU1FKSB7CiAgICAgICAgcmV0dXJuIHBl
b3BsZVNlbmRNZXNzYWdlQXR0YWNobWVudChyZXEsIHJlcywgewogICAgICAgICAgZGF0YTogcmF3LAogICAgICAgICAgbWltZTogUEVPUExFX0RNX0UyRUVf
SU1BR0VfTUlNRSwKICAgICAgICAgIG5hbWU6ICJwaWVjZS1qb2ludGUtZTJlZS5iaW4iCiAgICAgICAgfSk7CiAgICAgIH0KICAgICAgY29uc3QgYXR0YWNo
bWVudCA9IHBlb3BsZVVucGFja01lc3NhZ2VBdHRhY2htZW50KHJhdywgaXRlbS5taW1lKTsKICAgICAgcmV0dXJuIHBlb3BsZVNlbmRNZXNzYWdlQXR0YWNo
bWVudChyZXEsIHJlcywgYXR0YWNobWVudCk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBjaGF0L2F0dGFjaG1l
bnQgZ2V0XSIsIGVycik7CiAgICAgIHJlcy5zdGF0dXMoNTAwKS5lbmQoKTsKICAgIH0KICB9Cik7Ci8vID09PSBQRU9QTEVfTUVTU0FHRV9JTUFHRVNfVjJf
RU5EID09PQoKLy8gPT09IFBFT1BMRV9VTlJFQURfVjFfU1RBUlQgPT09CmNvbnN0IFBFT1BMRV9MT0NBTF9VTlJFQUQgPSBwYXRoQWNjb3VudHMuam9pbigK
ICBfX2Rpcm5hbWUsCiAgInBlb3BsZS11bnJlYWQubG9jYWwuanNvbiIKKTsKCmxldCBwZW9wbGVVbnJlYWRUYWJsZVByb21pc2UgPSBudWxsOwoKYXN5bmMg
ZnVuY3Rpb24gcGVvcGxlRW5zdXJlVW5yZWFkVGFibGUoKSB7CiAgaWYgKCFwZW9wbGVQb29sKSByZXR1cm47CiAgaWYgKCFwZW9wbGVVbnJlYWRUYWJsZVBy
b21pc2UpIHsKICAgIHBlb3BsZVVucmVhZFRhYmxlUHJvbWlzZSA9IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNU
UyBwZW9wbGVfc2VydmVyX2NoYW5uZWxfcmVhZHMgKCIgKwogICAgICAidXNlcl9pZCBURVhUIE5PVCBOVUxMLCAiICsKICAgICAgInNlcnZlcl9pZCBURVhU
IE5PVCBOVUxMLCAiICsKICAgICAgImNoYW5uZWxfaWQgVEVYVCBOT1QgTlVMTCwgIiArCiAgICAgICJsYXN0X3JlYWRfYXQgVElNRVNUQU1QVFogTk9UIE5V
TEwgREVGQVVMVCBOT1coKSwgIiArCiAgICAgICJQUklNQVJZIEtFWSAodXNlcl9pZCwgc2VydmVyX2lkLCBjaGFubmVsX2lkKSIgKwogICAgICAiKSIKICAg
ICkudGhlbigoKSA9PiBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgcGVvcGxlX3NlcnZlcl9jaGFubmVsX3Jl
YWRzX2xvb2t1cF9pZHggIiArCiAgICAgICJPTiBwZW9wbGVfc2VydmVyX2NoYW5uZWxfcmVhZHModXNlcl9pZCwgc2VydmVyX2lkLCBjaGFubmVsX2lkLCBs
YXN0X3JlYWRfYXQpIgogICAgKSkuY2F0Y2goKGVycikgPT4gewogICAgICBwZW9wbGVVbnJlYWRUYWJsZVByb21pc2UgPSBudWxsOwogICAgICB0aHJvdyBl
cnI7CiAgICB9KTsKICB9CiAgYXdhaXQgcGVvcGxlVW5yZWFkVGFibGVQcm9taXNlOwp9CgpmdW5jdGlvbiBwZW9wbGVSZWFkTG9jYWxVbnJlYWQoKSB7CiAg
dHJ5IHsKICAgIGlmICghZnNBY2NvdW50cy5leGlzdHNTeW5jKFBFT1BMRV9MT0NBTF9VTlJFQUQpKSByZXR1cm4gW107CiAgICBjb25zdCBwYXJzZWQgPSBK
U09OLnBhcnNlKAogICAgICBmc0FjY291bnRzLnJlYWRGaWxlU3luYyhQRU9QTEVfTE9DQUxfVU5SRUFELCAidXRmOCIpCiAgICApOwogICAgcmV0dXJuIEFy
cmF5LmlzQXJyYXkocGFyc2VkKSA/IHBhcnNlZCA6IFtdOwogIH0gY2F0Y2ggewogICAgcmV0dXJuIFtdOwogIH0KfQoKZnVuY3Rpb24gcGVvcGxlV3JpdGVM
b2NhbFVucmVhZChyb3dzKSB7CiAgZnNBY2NvdW50cy53cml0ZUZpbGVTeW5jKAogICAgUEVPUExFX0xPQ0FMX1VOUkVBRCwKICAgIEpTT04uc3RyaW5naWZ5
KEFycmF5LmlzQXJyYXkocm93cykgPyByb3dzIDogW10sIG51bGwsIDIpICsgIlxuIiwKICAgICJ1dGY4IgogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZVVucmVh
ZEtleShhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQpIHsKICByZXR1cm4gWwogICAgU3RyaW5nKGFjY291bnRJZCB8fCAiIiksCiAgICBTdHJpbmco
c2VydmVySWQgfHwgIiIpLAogICAgU3RyaW5nKGNoYW5uZWxJZCB8fCAiIikKICBdLmpvaW4oIlx1MDAxZiIpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVV
bnJlYWRMYXN0UmVhZChhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQpIHsKICBjb25zdCB1aWQgPSBTdHJpbmcoYWNjb3VudElkIHx8ICIiKTsKICBj
b25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGlmICghdWlkIHx8ICFz
aWQgfHwgIWNpZCkgcmV0dXJuIERhdGUubm93KCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVFbnN1cmVVbnJlYWRUYWJsZSgpOwog
ICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9zZXJ2ZXJfY2hhbm5lbF9yZWFkcyAiICsKICAgICAgIih1c2Vy
X2lkLCBzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIGxhc3RfcmVhZF9hdCkgIiArCiAgICAgICJWQUxVRVMgKCQxLCAkMiwgJDMsIE5PVygpKSBPTiBDT05GTElD
VCBETyBOT1RISU5HIiwKICAgICAgW3VpZCwgc2lkLCBjaWRdCiAgICApOwogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAg
ICAgIlNFTEVDVCBsYXN0X3JlYWRfYXQgRlJPTSBwZW9wbGVfc2VydmVyX2NoYW5uZWxfcmVhZHMgIiArCiAgICAgICJXSEVSRSB1c2VyX2lkID0gJDEgQU5E
IHNlcnZlcl9pZCA9ICQyIEFORCBjaGFubmVsX2lkID0gJDMgTElNSVQgMSIsCiAgICAgIFt1aWQsIHNpZCwgY2lkXQogICAgKTsKICAgIGNvbnN0IHZhbHVl
ID0gcmVzdWx0LnJvd3NbMF0/Lmxhc3RfcmVhZF9hdDsKICAgIGNvbnN0IHRpbWUgPSB2YWx1ZSA/IG5ldyBEYXRlKHZhbHVlKS5nZXRUaW1lKCkgOiBEYXRl
Lm5vdygpOwogICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZSh0aW1lKSA/IHRpbWUgOiBEYXRlLm5vdygpOwogIH0KCiAgY29uc3Qgcm93cyA9IHBlb3BsZVJl
YWRMb2NhbFVucmVhZCgpOwogIGNvbnN0IGtleSA9IHBlb3BsZVVucmVhZEtleSh1aWQsIHNpZCwgY2lkKTsKICBsZXQgcm93ID0gcm93cy5maW5kKChpdGVt
KSA9PgogICAgcGVvcGxlVW5yZWFkS2V5KGl0ZW0udXNlcklkLCBpdGVtLnNlcnZlcklkLCBpdGVtLmNoYW5uZWxJZCkgPT09IGtleQogICk7CgogIGlmICgh
cm93KSB7CiAgICByb3cgPSB7CiAgICAgIHVzZXJJZDogdWlkLAogICAgICBzZXJ2ZXJJZDogc2lkLAogICAgICBjaGFubmVsSWQ6IGNpZCwKICAgICAgbGFz
dFJlYWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpCiAgICB9OwogICAgcm93cy5wdXNoKHJvdyk7CiAgICBwZW9wbGVXcml0ZUxvY2FsVW5yZWFkKHJv
d3MpOwogIH0KCiAgY29uc3QgdGltZSA9IG5ldyBEYXRlKHJvdy5sYXN0UmVhZEF0IHx8IDApLmdldFRpbWUoKTsKICByZXR1cm4gTnVtYmVyLmlzRmluaXRl
KHRpbWUpID8gdGltZSA6IERhdGUubm93KCk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVVucmVhZE1hcmtSZWFkKGFjY291bnRJZCwgc2VydmVySWQsIGNo
YW5uZWxJZCkgewogIGNvbnN0IHVpZCA9IFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAg
Y29uc3QgY2lkID0gU3RyaW5nKGNoYW5uZWxJZCB8fCAiIik7CiAgaWYgKCF1aWQgfHwgIXNpZCB8fCAhY2lkKSByZXR1cm47CgogIGlmIChwZW9wbGVQb29s
KSB7CiAgICBhd2FpdCBwZW9wbGVFbnN1cmVVbnJlYWRUYWJsZSgpOwogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIklOU0VSVCBJTlRPIHBl
b3BsZV9zZXJ2ZXJfY2hhbm5lbF9yZWFkcyAiICsKICAgICAgIih1c2VyX2lkLCBzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIGxhc3RfcmVhZF9hdCkgIiArCiAg
ICAgICJWQUxVRVMgKCQxLCAkMiwgJDMsIE5PVygpKSAiICsKICAgICAgIk9OIENPTkZMSUNUICh1c2VyX2lkLCBzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQpICIg
KwogICAgICAiRE8gVVBEQVRFIFNFVCBsYXN0X3JlYWRfYXQgPSBOT1coKSIsCiAgICAgIFt1aWQsIHNpZCwgY2lkXQogICAgKTsKICAgIHJldHVybjsKICB9
CgogIGNvbnN0IHJvd3MgPSBwZW9wbGVSZWFkTG9jYWxVbnJlYWQoKTsKICBjb25zdCBrZXkgPSBwZW9wbGVVbnJlYWRLZXkodWlkLCBzaWQsIGNpZCk7CiAg
Y29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpOwogIGNvbnN0IGluZGV4ID0gcm93cy5maW5kSW5kZXgoKGl0ZW0pID0+CiAgICBwZW9wbGVV
bnJlYWRLZXkoaXRlbS51c2VySWQsIGl0ZW0uc2VydmVySWQsIGl0ZW0uY2hhbm5lbElkKSA9PT0ga2V5CiAgKTsKCiAgY29uc3QgbmV4dCA9IHsKICAgIHVz
ZXJJZDogdWlkLAogICAgc2VydmVySWQ6IHNpZCwKICAgIGNoYW5uZWxJZDogY2lkLAogICAgbGFzdFJlYWRBdDogbm93CiAgfTsKCiAgaWYgKGluZGV4ID49
IDApIHJvd3NbaW5kZXhdID0gbmV4dDsKICBlbHNlIHJvd3MucHVzaChuZXh0KTsKICBwZW9wbGVXcml0ZUxvY2FsVW5yZWFkKHJvd3MpOwp9Cgphc3luYyBm
dW5jdGlvbiBwZW9wbGVVbnJlYWRDaGFubmVsSW5mbyhhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQpIHsKICBjb25zdCB1aWQgPSBTdHJpbmcoYWNj
b3VudElkIHx8ICIiKTsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIp
OwogIGNvbnN0IGxhc3RSZWFkQXQgPSBhd2FpdCBwZW9wbGVVbnJlYWRMYXN0UmVhZCh1aWQsIHNpZCwgY2lkKTsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAg
IGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1QgaWQsIGNyZWF0ZWRfYXQgRlJPTSBwZW9wbGVfZ2VuZXJhbF9t
ZXNzYWdlcyAiICsKICAgICAgIldIRVJFIHNlcnZlcl9pZCA9ICQxIEFORCBjaGFubmVsX2lkID0gJDIgIiArCiAgICAgICJBTkQgY3JlYXRlZF9hdCA+ICQz
IEFORCBDT0FMRVNDRShpc19zeXN0ZW0sIEZBTFNFKSA9IEZBTFNFICIgKwogICAgICAiT1JERVIgQlkgY3JlYXRlZF9hdCBBU0MsIGlkIEFTQyIsCiAgICAg
IFtzaWQsIGNpZCwgbmV3IERhdGUobGFzdFJlYWRBdCldCiAgICApOwoKICAgIHJldHVybiB7CiAgICAgIGNoYW5uZWxJZDogY2lkLAogICAgICB1bnJlYWRD
b3VudDogcmVzdWx0LnJvd3MubGVuZ3RoLAogICAgICBmaXJzdFVucmVhZE1lc3NhZ2VJZDogcmVzdWx0LnJvd3NbMF0/LmlkCiAgICAgICAgPyBTdHJpbmco
cmVzdWx0LnJvd3NbMF0uaWQpCiAgICAgICAgOiBudWxsCiAgICB9OwogIH0KCiAgY29uc3QgaXRlbXMgPSBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCkKICAg
IC5maWx0ZXIoKG1lc3NhZ2UpID0+CiAgICAgIFN0cmluZyhtZXNzYWdlLnNlcnZlcklkIHx8ICIiKSA9PT0gc2lkICYmCiAgICAgIFN0cmluZyhtZXNzYWdl
LmNoYW5uZWxJZCB8fCAiIikgPT09IGNpZCAmJgogICAgICAhbWVzc2FnZS5zeXN0ZW0gJiYKICAgICAgIW1lc3NhZ2UuaXNTeXN0ZW0gJiYKICAgICAgTnVt
YmVyKG1lc3NhZ2UudGltZSB8fCAwKSA+IGxhc3RSZWFkQXQKICAgICkKICAgIC5zb3J0KChhLCBiKSA9PgogICAgICBOdW1iZXIoYS50aW1lIHx8IDApIC0g
TnVtYmVyKGIudGltZSB8fCAwKQogICAgKTsKCiAgcmV0dXJuIHsKICAgIGNoYW5uZWxJZDogY2lkLAogICAgdW5yZWFkQ291bnQ6IGl0ZW1zLmxlbmd0aCwK
ICAgIGZpcnN0VW5yZWFkTWVzc2FnZUlkOiBpdGVtc1swXT8uaWQKICAgICAgPyBTdHJpbmcoaXRlbXNbMF0uaWQpCiAgICAgIDogbnVsbAogIH07Cn0KCmFz
eW5jIGZ1bmN0aW9uIHBlb3BsZVVucmVhZFNlcnZlclN1bW1hcnkoYWNjb3VudElkLCBzZXJ2ZXJJZCkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJ
ZCB8fCAiIik7CiAgY29uc3QgY2hhbm5lbHMgPSAoYXdhaXQgcGVvcGxlTGlzdFZpc2libGVTZXJ2ZXJDaGFubmVscyhhY2NvdW50SWQsIHNpZCkpCiAgICAu
ZmlsdGVyKChjaGFubmVsKSA9PiBjaGFubmVsPy50eXBlID09PSAidGV4dCIpOwoKICBjb25zdCBpbmZvcyA9IFtdOwogIGZvciAoY29uc3QgY2hhbm5lbCBv
ZiBjaGFubmVscykgewogICAgaW5mb3MucHVzaCgKICAgICAgYXdhaXQgcGVvcGxlVW5yZWFkQ2hhbm5lbEluZm8oCiAgICAgICAgYWNjb3VudElkLAogICAg
ICAgIHNpZCwKICAgICAgICBjaGFubmVsLmlkCiAgICAgICkKICAgICk7CiAgfQoKICByZXR1cm4gaW5mb3M7Cn0KCmFwcC5nZXQoIi9hcGkvdW5yZWFkL3Nl
cnZlcnMvOmlkIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEs
IHJlcyk7CiAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICBjb25zdCBzaWQgPSBTdHJpbmcocmVxLnBhcmFtcy5pZCB8fCAiIik7CiAgICBpZiAoIShh
d2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcihzZXNzaW9uLmlkLCBzaWQpKSkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oewogICAgICAg
IG9rOiBmYWxzZSwKICAgICAgICBlcnJvcjogIlR1IG4nZXMgcGFzIG1lbWJyZSBkZSBjZSBzZXJ2ZXVyLiIKICAgICAgfSk7CiAgICB9CgogICAgY29uc3Qg
Y2hhbm5lbHMgPSBhd2FpdCBwZW9wbGVVbnJlYWRTZXJ2ZXJTdW1tYXJ5KAogICAgICBzZXNzaW9uLmlkLAogICAgICBzaWQKICAgICk7CgogICAgcmV0dXJu
IHJlcy5qc29uKHsKICAgICAgb2s6IHRydWUsCiAgICAgIHNlcnZlcklkOiBzaWQsCiAgICAgIGNoYW5uZWxzLAogICAgICB1bnJlYWRUb3RhbDogY2hhbm5l
bHMucmVkdWNlKAogICAgICAgIChzdW0sIGl0ZW0pID0+IHN1bSArIE51bWJlcihpdGVtLnVucmVhZENvdW50IHx8IDApLAogICAgICAgIDAKICAgICAgKQog
ICAgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxlIHVucmVhZC9zdW1tYXJ5XSIsIGVycik7CiAgICByZXR1cm4gcmVz
LnN0YXR1cyg1MDApLmpzb24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIGxlcyBtZXNzYWdlcyBub24g
bHVzLiIKICAgIH0pOwogIH0KfSk7CgphcHAucG9zdCgKICAiL2FwaS91bnJlYWQvc2VydmVycy86aWQvY2hhbm5lbHMvOmNoYW5uZWxJZC9yZWFkIiwKICBh
c3luYyAocmVxLCByZXMpID0+IHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CiAg
ICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAgICAgY29uc3Qgc2lkID0gU3RyaW5nKHJlcS5wYXJhbXMuaWQgfHwgIiIpOwogICAgICBjb25zdCBjaWQg
PSBTdHJpbmcocmVxLnBhcmFtcy5jaGFubmVsSWQgfHwgIiIpOwoKICAgICAgaWYgKCEoYXdhaXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIoc2Vzc2lvbi5pZCwg
c2lkKSkpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJUdSBu
J2VzIHBhcyBtZW1icmUgZGUgY2Ugc2VydmV1ci4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IGNoYW5uZWwgPSBhd2FpdCBwZW9wbGVHZXRT
ZXJ2ZXJDaGFubmVsKAogICAgICAgIHNpZCwKICAgICAgICBjaWQsCiAgICAgICAgInRleHQiCiAgICAgICk7CgogICAgICBpZiAoIWNoYW5uZWwpIHsKICAg
ICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJTYWxvbiB0ZXh0dWVsIGlu
dHJvdXZhYmxlLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgaWYgKCEoYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbihzZXNzaW9uLmlkLCBz
aWQsICJWSUVXX0NIQU5ORUwiLCBjaWQpKSkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBu
J2FzIHBhcyBhY2PDqHMgw6AgY2Ugc2Fsb24uIiB9KTsKICAgICAgfQoKICAgICAgYXdhaXQgcGVvcGxlVW5yZWFkTWFya1JlYWQoCiAgICAgICAgc2Vzc2lv
bi5pZCwKICAgICAgICBzaWQsCiAgICAgICAgY2lkCiAgICAgICk7CgogICAgICByZXR1cm4gcmVzLmpzb24oewogICAgICAgIG9rOiB0cnVlLAogICAgICAg
IHNlcnZlcklkOiBzaWQsCiAgICAgICAgY2hhbm5lbElkOiBjaWQKICAgICAgfSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigi
W1Blb3BsZSB1bnJlYWQvcmVhZF0iLCBlcnIpOwogICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAg
ICBlcnJvcjogIkltcG9zc2libGUgZGUgbWFycXVlciBjZSBzYWxvbiBjb21tZSBsdS4iCiAgICAgIH0pOwogICAgfQogIH0KKTsKLy8gPT09IFBFT1BMRV9V
TlJFQURfVjFfRU5EID09PQoKLy8gPT09IFBFT1BMRV9OT1RJRklDQVRJT05fUFJFRlNfVjFfU1RBUlQgPT09CmNvbnN0IFBFT1BMRV9MT0NBTF9OT1RJRklD
QVRJT05fUFJFRlMgPSBwYXRoQWNjb3VudHMuam9pbigKICBfX2Rpcm5hbWUsCiAgInBlb3BsZS1ub3RpZmljYXRpb24tcHJlZnMubG9jYWwuanNvbiIKKTsK
CmNvbnN0IFBFT1BMRV9OT1RJRklDQVRJT05fTU9ERVMgPSBuZXcgU2V0KFsKICAiaW5oZXJpdCIsCiAgImFsbCIsCiAgIm1lbnRpb25zIiwKICAibm9uZSIK
XSk7Cgpjb25zdCBQRU9QTEVfTk9USUZJQ0FUSU9OX1NPVU5EUyA9IG5ldyBTZXQoWwogICJpbmhlcml0IiwKICAiY2xhc3NpYyIsCiAgInNvZnQiLAogICJk
aWdpdGFsIiwKICAicG9wIiwKICAic2lsZW50IgpdKTsKCmxldCBwZW9wbGVOb3RpZmljYXRpb25QcmVmc1RhYmxlUHJvbWlzZSA9IG51bGw7CgpmdW5jdGlv
biBwZW9wbGVOb3RpZmljYXRpb25Nb2RlKHZhbHVlLCBmYWxsYmFjayA9ICJpbmhlcml0IikgewogIGNvbnN0IG1vZGUgPSBTdHJpbmcodmFsdWUgfHwgIiIp
LnRyaW0oKS50b0xvd2VyQ2FzZSgpOwogIHJldHVybiBQRU9QTEVfTk9USUZJQ0FUSU9OX01PREVTLmhhcyhtb2RlKSA/IG1vZGUgOiBmYWxsYmFjazsKfQoK
ZnVuY3Rpb24gcGVvcGxlTm90aWZpY2F0aW9uU291bmQodmFsdWUsIGZhbGxiYWNrID0gImluaGVyaXQiKSB7CiAgY29uc3Qgc291bmQgPSBTdHJpbmcodmFs
dWUgfHwgIiIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpOwogIHJldHVybiBQRU9QTEVfTk9USUZJQ0FUSU9OX1NPVU5EUy5oYXMoc291bmQpID8gc291bmQgOiBm
YWxsYmFjazsKfQoKZnVuY3Rpb24gcGVvcGxlTm90aWZpY2F0aW9uTXV0ZVVudGlsKHZhbHVlKSB7CiAgaWYgKHZhbHVlID09IG51bGwgfHwgdmFsdWUgPT09
ICIiKSByZXR1cm4gbnVsbDsKCiAgY29uc3QgdGltZXN0YW1wID0gTnVtYmVyKHZhbHVlKTsKICBpZiAoIU51bWJlci5pc0Zpbml0ZSh0aW1lc3RhbXApKSBy
ZXR1cm4gbnVsbDsKCiAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTsKICBjb25zdCBtYXggPSBub3cgKyAzMSAqIDI0ICogNjAgKiA2MCAqIDEwMDA7CiAgaWYg
KHRpbWVzdGFtcCA8PSBub3cpIHJldHVybiBudWxsOwogIHJldHVybiBNYXRoLm1pbihNYXRoLnJvdW5kKHRpbWVzdGFtcCksIG1heCk7Cn0KCmZ1bmN0aW9u
IHBlb3BsZU5vdGlmaWNhdGlvbk92ZXJyaWRlKHZhbHVlKSB7CiAgY29uc3Qgc291cmNlID0gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAib2JqZWN0IiAm
JiAhQXJyYXkuaXNBcnJheSh2YWx1ZSkKICAgID8gdmFsdWUKICAgIDoge307CgogIHJldHVybiB7CiAgICBtb2RlOiBwZW9wbGVOb3RpZmljYXRpb25Nb2Rl
KHNvdXJjZS5tb2RlLCAiaW5oZXJpdCIpLAogICAgc291bmQ6IHBlb3BsZU5vdGlmaWNhdGlvblNvdW5kKHNvdXJjZS5zb3VuZCwgImluaGVyaXQiKSwKICAg
IG11dGVkVW50aWw6IHBlb3BsZU5vdGlmaWNhdGlvbk11dGVVbnRpbChzb3VyY2UubXV0ZWRVbnRpbCkKICB9Owp9CgpmdW5jdGlvbiBwZW9wbGVOb3RpZmlj
YXRpb25NYXAodmFsdWUsIGxpbWl0KSB7CiAgY29uc3Qgc291cmNlID0gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAib2JqZWN0IiAmJiAhQXJyYXkuaXNB
cnJheSh2YWx1ZSkKICAgID8gdmFsdWUKICAgIDoge307CgogIGNvbnN0IG91dCA9IHt9OwogIGxldCBjb3VudCA9IDA7CgogIGZvciAoY29uc3QgW3Jhd0tl
eSwgcmF3VmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZSkpIHsKICAgIGlmIChjb3VudCA+PSBsaW1pdCkgYnJlYWs7CgogICAgY29uc3Qga2V5ID0g
U3RyaW5nKHJhd0tleSB8fCAiIikudHJpbSgpOwogICAgaWYgKCFrZXkgfHwga2V5Lmxlbmd0aCA+IDEyMCB8fCAvW1xyXG5cdF0vLnRlc3Qoa2V5KSkgY29u
dGludWU7CgogICAgb3V0W2tleV0gPSBwZW9wbGVOb3RpZmljYXRpb25PdmVycmlkZShyYXdWYWx1ZSk7CiAgICBjb3VudCArPSAxOwogIH0KCiAgcmV0dXJu
IG91dDsKfQoKZnVuY3Rpb24gcGVvcGxlTm9ybWFsaXplTm90aWZpY2F0aW9uUHJlZnModmFsdWUpIHsKICBjb25zdCBzb3VyY2UgPSB2YWx1ZSAmJiB0eXBl
b2YgdmFsdWUgPT09ICJvYmplY3QiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKQogICAgPyB2YWx1ZQogICAgOiB7fTsKCiAgY29uc3QgZGVmYXVsdHMgPSBz
b3VyY2UuZGVmYXVsdHMgJiYgdHlwZW9mIHNvdXJjZS5kZWZhdWx0cyA9PT0gIm9iamVjdCIKICAgID8gc291cmNlLmRlZmF1bHRzCiAgICA6IHt9OwoKICBj
b25zdCBkbURlZmF1bHRzID0gZGVmYXVsdHMuZG0gJiYgdHlwZW9mIGRlZmF1bHRzLmRtID09PSAib2JqZWN0IgogICAgPyBkZWZhdWx0cy5kbQogICAgOiB7
fTsKCiAgY29uc3Qgc2VydmVyRGVmYXVsdHMgPSBkZWZhdWx0cy5zZXJ2ZXIgJiYgdHlwZW9mIGRlZmF1bHRzLnNlcnZlciA9PT0gIm9iamVjdCIKICAgID8g
ZGVmYXVsdHMuc2VydmVyCiAgICA6IHt9OwoKICBjb25zdCBkbU1vZGUgPSBwZW9wbGVOb3RpZmljYXRpb25Nb2RlKGRtRGVmYXVsdHMubW9kZSwgImFsbCIp
OwogIGNvbnN0IHNlcnZlck1vZGUgPSBwZW9wbGVOb3RpZmljYXRpb25Nb2RlKHNlcnZlckRlZmF1bHRzLm1vZGUsICJtZW50aW9ucyIpOwoKICByZXR1cm4g
ewogICAgdmVyc2lvbjogMSwKICAgIGRlZmF1bHRzOiB7CiAgICAgIGRtOiB7CiAgICAgICAgbW9kZTogZG1Nb2RlID09PSAiaW5oZXJpdCIgPyAiYWxsIiA6
IGRtTW9kZSwKICAgICAgICBzb3VuZDogcGVvcGxlTm90aWZpY2F0aW9uU291bmQoZG1EZWZhdWx0cy5zb3VuZCwgImluaGVyaXQiKQogICAgICB9LAogICAg
ICBzZXJ2ZXI6IHsKICAgICAgICBtb2RlOiBzZXJ2ZXJNb2RlID09PSAiaW5oZXJpdCIgPyAibWVudGlvbnMiIDogc2VydmVyTW9kZSwKICAgICAgICBzb3Vu
ZDogcGVvcGxlTm90aWZpY2F0aW9uU291bmQoc2VydmVyRGVmYXVsdHMuc291bmQsICJpbmhlcml0IikKICAgICAgfQogICAgfSwKICAgIGRtczogcGVvcGxl
Tm90aWZpY2F0aW9uTWFwKHNvdXJjZS5kbXMsIDMwMCksCiAgICBzZXJ2ZXJzOiBwZW9wbGVOb3RpZmljYXRpb25NYXAoc291cmNlLnNlcnZlcnMsIDMwMCks
CiAgICBjaGFubmVsczogcGVvcGxlTm90aWZpY2F0aW9uTWFwKHNvdXJjZS5jaGFubmVscywgMTIwMCkKICB9Owp9CgpmdW5jdGlvbiBwZW9wbGVSZWFkTG9j
YWxOb3RpZmljYXRpb25QcmVmcygpIHsKICB0cnkgewogICAgaWYgKCFmc0FjY291bnRzLmV4aXN0c1N5bmMoUEVPUExFX0xPQ0FMX05PVElGSUNBVElPTl9Q
UkVGUykpIHJldHVybiB7fTsKICAgIGNvbnN0IHJhdyA9IEpTT04ucGFyc2UoCiAgICAgIGZzQWNjb3VudHMucmVhZEZpbGVTeW5jKFBFT1BMRV9MT0NBTF9O
T1RJRklDQVRJT05fUFJFRlMsICJ1dGY4IikKICAgICk7CiAgICByZXR1cm4gcmF3ICYmIHR5cGVvZiByYXcgPT09ICJvYmplY3QiICYmICFBcnJheS5pc0Fy
cmF5KHJhdykgPyByYXcgOiB7fTsKICB9IGNhdGNoIHsKICAgIHJldHVybiB7fTsKICB9Cn0KCmZ1bmN0aW9uIHBlb3BsZVdyaXRlTG9jYWxOb3RpZmljYXRp
b25QcmVmcyh2YWx1ZSkgewogIGZzQWNjb3VudHMud3JpdGVGaWxlU3luYygKICAgIFBFT1BMRV9MT0NBTF9OT1RJRklDQVRJT05fUFJFRlMsCiAgICBKU09O
LnN0cmluZ2lmeSh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICJvYmplY3QiID8gdmFsdWUgOiB7fSwgbnVsbCwgMikgKyAiXG4iLAogICAgInV0ZjgiCiAg
KTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRW5zdXJlTm90aWZpY2F0aW9uUHJlZnNUYWJsZSgpIHsKICBpZiAoIXBlb3BsZVBvb2wpIHJldHVybjsKCiAg
aWYgKCFwZW9wbGVOb3RpZmljYXRpb25QcmVmc1RhYmxlUHJvbWlzZSkgewogICAgcGVvcGxlTm90aWZpY2F0aW9uUHJlZnNUYWJsZVByb21pc2UgPSBwZW9w
bGVQb29sCiAgICAgIC5xdWVyeSgKICAgICAgICAiQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgcGVvcGxlX25vdGlmaWNhdGlvbl9wcmVmZXJlbmNlcyAo
IiArCiAgICAgICAgImFjY291bnRfaWQgVEVYVCBQUklNQVJZIEtFWSwgIiArCiAgICAgICAgInByZWZzX2pzb24gVEVYVCBOT1QgTlVMTCwgIiArCiAgICAg
ICAgInVwZGF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSIgKwogICAgICAgICIpIgogICAgICApCiAgICAgIC5jYXRjaCgoZXJy
KSA9PiB7CiAgICAgICAgcGVvcGxlTm90aWZpY2F0aW9uUHJlZnNUYWJsZVByb21pc2UgPSBudWxsOwogICAgICAgIHRocm93IGVycjsKICAgICAgfSk7CiAg
fQoKICBhd2FpdCBwZW9wbGVOb3RpZmljYXRpb25QcmVmc1RhYmxlUHJvbWlzZTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlR2V0Tm90aWZpY2F0aW9uUHJl
ZnMoYWNjb3VudElkKSB7CiAgY29uc3Qga2V5ID0gU3RyaW5nKGFjY291bnRJZCB8fCAiIik7CiAgaWYgKCFrZXkpIHJldHVybiBwZW9wbGVOb3JtYWxpemVO
b3RpZmljYXRpb25QcmVmcyhudWxsKTsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3BsZUVuc3VyZU5vdGlmaWNhdGlvblByZWZzVGFibGUo
KTsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1QgcHJlZnNfanNvbiBGUk9NIHBlb3BsZV9ub3RpZmlj
YXRpb25fcHJlZmVyZW5jZXMgV0hFUkUgYWNjb3VudF9pZCA9ICQxIExJTUlUIDEiLAogICAgICBba2V5XQogICAgKTsKCiAgICBpZiAoIXJlc3VsdC5yb3dz
WzBdKSByZXR1cm4gcGVvcGxlTm9ybWFsaXplTm90aWZpY2F0aW9uUHJlZnMobnVsbCk7CgogICAgdHJ5IHsKICAgICAgcmV0dXJuIHBlb3BsZU5vcm1hbGl6
ZU5vdGlmaWNhdGlvblByZWZzKAogICAgICAgIEpTT04ucGFyc2UoU3RyaW5nKHJlc3VsdC5yb3dzWzBdLnByZWZzX2pzb24gfHwgInt9IikpCiAgICAgICk7
CiAgICB9IGNhdGNoIHsKICAgICAgcmV0dXJuIHBlb3BsZU5vcm1hbGl6ZU5vdGlmaWNhdGlvblByZWZzKG51bGwpOwogICAgfQogIH0KCiAgY29uc3Qgc3Rv
cmUgPSBwZW9wbGVSZWFkTG9jYWxOb3RpZmljYXRpb25QcmVmcygpOwogIHJldHVybiBwZW9wbGVOb3JtYWxpemVOb3RpZmljYXRpb25QcmVmcyhzdG9yZVtr
ZXldKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2V0Tm90aWZpY2F0aW9uUHJlZnMoYWNjb3VudElkLCB2YWx1ZSkgewogIGNvbnN0IGtleSA9IFN0cmlu
ZyhhY2NvdW50SWQgfHwgIiIpOwogIGlmICgha2V5KSB0aHJvdyBuZXcgRXJyb3IoIk5PVElGSUNBVElPTl9BQ0NPVU5UX0lOVkFMSUQiKTsKCiAgY29uc3Qg
cHJlZnMgPSBwZW9wbGVOb3JtYWxpemVOb3RpZmljYXRpb25QcmVmcyh2YWx1ZSk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVFbnN1
cmVOb3RpZmljYXRpb25QcmVmc1RhYmxlKCk7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiSU5TRVJUIElOVE8gcGVvcGxlX25vdGlmaWNh
dGlvbl9wcmVmZXJlbmNlcyAoYWNjb3VudF9pZCwgcHJlZnNfanNvbiwgdXBkYXRlZF9hdCkgIiArCiAgICAgICJWQUxVRVMgKCQxLCAkMiwgTk9XKCkpICIg
KwogICAgICAiT04gQ09ORkxJQ1QgKGFjY291bnRfaWQpIERPIFVQREFURSAiICsKICAgICAgIlNFVCBwcmVmc19qc29uID0gRVhDTFVERUQucHJlZnNfanNv
biwgdXBkYXRlZF9hdCA9IE5PVygpIiwKICAgICAgW2tleSwgSlNPTi5zdHJpbmdpZnkocHJlZnMpXQogICAgKTsKICAgIHJldHVybiBwcmVmczsKICB9Cgog
IGNvbnN0IHN0b3JlID0gcGVvcGxlUmVhZExvY2FsTm90aWZpY2F0aW9uUHJlZnMoKTsKICBzdG9yZVtrZXldID0gcHJlZnM7CiAgcGVvcGxlV3JpdGVMb2Nh
bE5vdGlmaWNhdGlvblByZWZzKHN0b3JlKTsKICByZXR1cm4gcHJlZnM7Cn0KCmFwcC5nZXQoIi9hcGkvbm90aWZpY2F0aW9uLXByZWZlcmVuY2VzIiwgYXN5
bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CiAgICBpZiAo
IXNlc3Npb24pIHJldHVybjsKCiAgICByZXR1cm4gcmVzLmpzb24oewogICAgICBvazogdHJ1ZSwKICAgICAgcHJlZnM6IGF3YWl0IHBlb3BsZUdldE5vdGlm
aWNhdGlvblByZWZzKHNlc3Npb24uaWQpCiAgICB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgbm90aWZpY2F0aW9u
IHByZWZlcmVuY2VzL2dldF0iLCBlcnIpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAgICAgb2s6IGZhbHNlLAogICAgICBlcnJvcjog
IkltcG9zc2libGUgZGUgY2hhcmdlciBsZXMgcsOpZ2xhZ2VzIGRlIG5vdGlmaWNhdGlvbnMuIgogICAgfSk7CiAgfQp9KTsKCmFwcC5wdXQoIi9hcGkvbm90
aWZpY2F0aW9uLXByZWZlcmVuY2VzIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9y
UmVxdWVzdChyZXEsIHJlcyk7CiAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICBjb25zdCBib2R5ID0gcmVxLmJvZHk/LnByZWZzOwogICAgaWYgKCFi
b2R5IHx8IHR5cGVvZiBib2R5ICE9PSAib2JqZWN0IiB8fCBBcnJheS5pc0FycmF5KGJvZHkpKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNv
bih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOiAiUsOpZ2xhZ2VzIGRlIG5vdGlmaWNhdGlvbnMgaW52YWxpZGVzLiIKICAgICAgfSk7CiAg
ICB9CgogICAgY29uc3Qgc2VyaWFsaXplZCA9IEpTT04uc3RyaW5naWZ5KGJvZHkpOwogICAgaWYgKHNlcmlhbGl6ZWQubGVuZ3RoID4gMTYwMDAwKSB7CiAg
ICAgIHJldHVybiByZXMuc3RhdHVzKDQxMykuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOiAiVHJvcCBkZSByw6lnbGFnZXMgZGUg
bm90aWZpY2F0aW9ucy4iCiAgICAgIH0pOwogICAgfQoKICAgIHJldHVybiByZXMuanNvbih7CiAgICAgIG9rOiB0cnVlLAogICAgICBwcmVmczogYXdhaXQg
cGVvcGxlU2V0Tm90aWZpY2F0aW9uUHJlZnMoc2Vzc2lvbi5pZCwgYm9keSkKICAgIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigi
W1Blb3BsZSBub3RpZmljYXRpb24gcHJlZmVyZW5jZXMvc2V0XSIsIGVycik7CiAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICBvazog
ZmFsc2UsCiAgICAgIGVycm9yOiAiSW1wb3NzaWJsZSBkJ2VucmVnaXN0cmVyIGxlcyByw6lnbGFnZXMgZGUgbm90aWZpY2F0aW9ucy4iCiAgICB9KTsKICB9
Cn0pOwovLyA9PT0gUEVPUExFX05PVElGSUNBVElPTl9QUkVGU19WMV9FTkQgPT09CgovLyA9PT0gUEVPUExFX01FU1NBR0VfUkVBQ1RJT05TX1YxX1NUQVJU
ID09PQpjb25zdCBQRU9QTEVfTE9DQUxfUkVBQ1RJT05TID0gcGF0aEFjY291bnRzLmpvaW4oCiAgX19kaXJuYW1lLAogICJwZW9wbGUtcmVhY3Rpb25zLmxv
Y2FsLmpzb24iCik7CgpsZXQgcGVvcGxlUmVhY3Rpb25UYWJsZVByb21pc2UgPSBudWxsOwoKZnVuY3Rpb24gcGVvcGxlUmVhY3Rpb25TY29wZSh2YWx1ZSkg
ewogIGNvbnN0IHNjb3BlID0gU3RyaW5nKHZhbHVlIHx8ICIiKS50cmltKCkudG9Mb3dlckNhc2UoKTsKICByZXR1cm4gc2NvcGUgPT09ICJkbSIgfHwgc2Nv
cGUgPT09ICJnZW5lcmFsIiA/IHNjb3BlIDogIiI7Cn0KCmZ1bmN0aW9uIHBlb3BsZVJlYWN0aW9uRW1vamkodmFsdWUpIHsKICBjb25zdCBlbW9qaSA9IFN0
cmluZyh2YWx1ZSB8fCAiIikudHJpbSgpOwogIGlmICghZW1vamkgfHwgZW1vamkubGVuZ3RoID4gMzIgfHwgL1tcclxuXHRdLy50ZXN0KGVtb2ppKSkgcmV0
dXJuICIiOwogIHJldHVybiBlbW9qaTsKfQoKZnVuY3Rpb24gcGVvcGxlUmVhY3Rpb25FbW9qaUtleShzY29wZSwgbWVzc2FnZUlkLCBlbW9qaSkgewogIHJl
dHVybiBjcnlwdG9BY2NvdW50cwogICAgLmNyZWF0ZUhtYWMoInNoYTI1NiIsIFBFT1BMRV9NRVNTQUdFX0VOQ1JZUFRJT05fS0VZKQogICAgLnVwZGF0ZShT
dHJpbmcoc2NvcGUgfHwgIiIpICsgIlwwIiArIFN0cmluZyhtZXNzYWdlSWQgfHwgIiIpICsgIlwwIiArIFN0cmluZyhlbW9qaSB8fCAiIiksICJ1dGY4IikK
ICAgIC5kaWdlc3QoImJhc2U2NHVybCIpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVFbnN1cmVSZWFjdGlvblRhYmxlKCkgewogIGlmICghcGVvcGxlUG9v
bCkgcmV0dXJuOwoKICBpZiAoIXBlb3BsZVJlYWN0aW9uVGFibGVQcm9taXNlKSB7CiAgICBwZW9wbGVSZWFjdGlvblRhYmxlUHJvbWlzZSA9IHBlb3BsZVBv
b2wucXVlcnkoCiAgICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwZW9wbGVfbWVzc2FnZV9yZWFjdGlvbnMgKCIgKwogICAgICAiaWQgQklHU0VS
SUFMIFBSSU1BUlkgS0VZLCAiICsKICAgICAgInNjb3BlIFZBUkNIQVIoMTYpIE5PVCBOVUxMLCAiICsKICAgICAgIm1lc3NhZ2VfaWQgVEVYVCBOT1QgTlVM
TCwgIiArCiAgICAgICJhY2NvdW50X2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9hY2NvdW50cyhpZCkgT04gREVMRVRFIENBU0NBREUs
ICIgKwogICAgICAiZW1vamlfa2V5IFZBUkNIQVIoODApIE5PVCBOVUxMLCAiICsKICAgICAgImVtb2ppX2NpcGhlciBURVhUIE5PVCBOVUxMLCAiICsKICAg
ICAgImNyZWF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSwgIiArCiAgICAgICJVTklRVUUoc2NvcGUsIG1lc3NhZ2VfaWQsIGFj
Y291bnRfaWQsIGVtb2ppX2tleSkiICsKICAgICAgIikiCiAgICApLnRoZW4oKCkgPT4gcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkNSRUFURSBJTkRFWCBJ
RiBOT1QgRVhJU1RTIHBlb3BsZV9tZXNzYWdlX3JlYWN0aW9uc19tZXNzYWdlX2lkeCAiICsKICAgICAgIk9OIHBlb3BsZV9tZXNzYWdlX3JlYWN0aW9ucyhz
Y29wZSwgbWVzc2FnZV9pZCwgY3JlYXRlZF9hdCkiCiAgICApKS5jYXRjaCgoZXJyKSA9PiB7CiAgICAgIHBlb3BsZVJlYWN0aW9uVGFibGVQcm9taXNlID0g
bnVsbDsKICAgICAgdGhyb3cgZXJyOwogICAgfSk7CiAgfQoKICBhd2FpdCBwZW9wbGVSZWFjdGlvblRhYmxlUHJvbWlzZTsKfQoKZnVuY3Rpb24gcGVvcGxl
UmVhZExvY2FsUmVhY3Rpb25zKCkgewogIHRyeSB7CiAgICBpZiAoIWZzQWNjb3VudHMuZXhpc3RzU3luYyhQRU9QTEVfTE9DQUxfUkVBQ1RJT05TKSkgcmV0
dXJuIFtdOwogICAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoUEVPUExFX0xPQ0FMX1JFQUNUSU9OUywgInV0Zjgi
KSk7CiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShkYXRhKSA/IGRhdGEgOiBbXTsKICB9IGNhdGNoIHsKICAgIHJldHVybiBbXTsKICB9Cn0KCmZ1bmN0aW9u
IHBlb3BsZVdyaXRlTG9jYWxSZWFjdGlvbnMoaXRlbXMpIHsKICBmc0FjY291bnRzLndyaXRlRmlsZVN5bmMoCiAgICBQRU9QTEVfTE9DQUxfUkVBQ1RJT05T
LAogICAgSlNPTi5zdHJpbmdpZnkoQXJyYXkuaXNBcnJheShpdGVtcykgPyBpdGVtcyA6IFtdLCBudWxsLCAyKSArICJcbiIsCiAgICAidXRmOCIKICApOwp9
Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVSZWFjdGlvbk1lc3NhZ2VDb250ZXh0KHNjb3BlLCBtZXNzYWdlSWQsIGFjY291bnRJZCkgewogIGNvbnN0IGtpbmQg
PSBwZW9wbGVSZWFjdGlvblNjb3BlKHNjb3BlKTsKICBjb25zdCBpZCA9IHBlb3BsZVJlcGx5SWQobWVzc2FnZUlkKTsKICBjb25zdCBtZSA9IFN0cmluZyhh
Y2NvdW50SWQgfHwgIiIpOwoKICBpZiAoIWtpbmQgfHwgIWlkIHx8ICFtZSkgcmV0dXJuIG51bGw7CgogIGlmIChraW5kID09PSAiZG0iKSB7CiAgICBpZiAo
cGVvcGxlUG9vbCkgewogICAgICBpZiAoIS9eXGQrJC8udGVzdChpZCkpIHJldHVybiBudWxsOwogICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQ
b29sLnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgaWQsIHNlbmRlcl9pZCwgcmVjaXBpZW50X2lkIEZST00gcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyBXSEVSRSBp
ZCA9ICQxIExJTUlUIDEiLAogICAgICAgIFtpZF0KICAgICAgKTsKICAgICAgY29uc3Qgcm93ID0gcmVzdWx0LnJvd3NbMF07CiAgICAgIGlmICghcm93KSBy
ZXR1cm4gbnVsbDsKICAgICAgY29uc3Qgc2VuZGVySWQgPSBTdHJpbmcocm93LnNlbmRlcl9pZCk7CiAgICAgIGNvbnN0IHJlY2lwaWVudElkID0gU3RyaW5n
KHJvdy5yZWNpcGllbnRfaWQpOwogICAgICBpZiAoc2VuZGVySWQgIT09IG1lICYmIHJlY2lwaWVudElkICE9PSBtZSkgcmV0dXJuIG51bGw7CiAgICAgIHJl
dHVybiB7IHNjb3BlOiBraW5kLCBtZXNzYWdlSWQ6IGlkLCBzZW5kZXJJZCwgcmVjaXBpZW50SWQgfTsKICAgIH0KCiAgICBjb25zdCBtZXNzYWdlID0gcGVv
cGxlUmVhZExvY2FsU29jaWFsKCkuZG1zLmZpbmQoKGl0ZW0pID0+IFN0cmluZyhpdGVtLmlkKSA9PT0gaWQpOwogICAgaWYgKCFtZXNzYWdlKSByZXR1cm4g
bnVsbDsKICAgIGNvbnN0IHNlbmRlcklkID0gU3RyaW5nKG1lc3NhZ2Uuc2VuZGVyX2lkKTsKICAgIGNvbnN0IHJlY2lwaWVudElkID0gU3RyaW5nKG1lc3Nh
Z2UucmVjaXBpZW50X2lkKTsKICAgIGlmIChzZW5kZXJJZCAhPT0gbWUgJiYgcmVjaXBpZW50SWQgIT09IG1lKSByZXR1cm4gbnVsbDsKICAgIHJldHVybiB7
IHNjb3BlOiBraW5kLCBtZXNzYWdlSWQ6IGlkLCBzZW5kZXJJZCwgcmVjaXBpZW50SWQgfTsKICB9CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBpZiAoIS9e
XGQrJC8udGVzdChpZCkpIHJldHVybiBudWxsOwogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlNFTEVDVCBpZCwg
c2VydmVyX2lkLCBjaGFubmVsX2lkIEZST00gcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgV0hFUkUgaWQgPSAkMSBMSU1JVCAxIiwKICAgICAgW2lkXQogICAg
KTsKICAgIGNvbnN0IHJvdyA9IHJlc3VsdC5yb3dzWzBdOwogICAgaWYgKCFyb3cpIHJldHVybiBudWxsOwogICAgY29uc3Qgc2VydmVySWQgPSByb3cuc2Vy
dmVyX2lkID8gU3RyaW5nKHJvdy5zZXJ2ZXJfaWQpIDogIiI7CiAgICBjb25zdCBjaGFubmVsSWQgPSByb3cuY2hhbm5lbF9pZCA/IFN0cmluZyhyb3cuY2hh
bm5lbF9pZCkgOiAiIjsKICAgIGlmIChzZXJ2ZXJJZCkgewogICAgICBpZiAoIShhd2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcihtZSwgc2VydmVySWQpKSkg
cmV0dXJuIG51bGw7CiAgICAgIGlmIChjaGFubmVsSWQgJiYgIShhd2FpdCBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKG1lLCBzZXJ2ZXJJZCwgIlZJRVdf
Q0hBTk5FTCIsIGNoYW5uZWxJZCkpKSByZXR1cm4gbnVsbDsKICAgIH0KICAgIHJldHVybiB7IHNjb3BlOiBraW5kLCBtZXNzYWdlSWQ6IGlkLCBzZXJ2ZXJJ
ZCwgY2hhbm5lbElkIH07CiAgfQoKICBjb25zdCBtZXNzYWdlID0gcGVvcGxlUmVhZExvY2FsR2VuZXJhbCgpLmZpbmQoKGl0ZW0pID0+IFN0cmluZyhpdGVt
LmlkKSA9PT0gaWQpOwogIGlmICghbWVzc2FnZSkgcmV0dXJuIG51bGw7CiAgY29uc3Qgc2VydmVySWQgPSBtZXNzYWdlLnNlcnZlcklkID8gU3RyaW5nKG1l
c3NhZ2Uuc2VydmVySWQpIDogIiI7CiAgY29uc3QgY2hhbm5lbElkID0gbWVzc2FnZS5jaGFubmVsSWQgPyBTdHJpbmcobWVzc2FnZS5jaGFubmVsSWQpIDog
IiI7CiAgaWYgKHNlcnZlcklkKSB7CiAgICBpZiAoIShhd2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcihtZSwgc2VydmVySWQpKSkgcmV0dXJuIG51bGw7CiAg
ICBpZiAoY2hhbm5lbElkICYmICEoYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbihtZSwgc2VydmVySWQsICJWSUVXX0NIQU5ORUwiLCBjaGFubmVs
SWQpKSkgcmV0dXJuIG51bGw7CiAgfQogIHJldHVybiB7IHNjb3BlOiBraW5kLCBtZXNzYWdlSWQ6IGlkLCBzZXJ2ZXJJZCwgY2hhbm5lbElkIH07Cn0KCmFz
eW5jIGZ1bmN0aW9uIHBlb3BsZVJlYWN0aW9uU3VtbWFyeShzY29wZSwgbWVzc2FnZUlkLCBhY2NvdW50SWQpIHsKICBjb25zdCBraW5kID0gcGVvcGxlUmVh
Y3Rpb25TY29wZShzY29wZSk7CiAgY29uc3QgaWQgPSBwZW9wbGVSZXBseUlkKG1lc3NhZ2VJZCk7CiAgY29uc3QgbWUgPSBTdHJpbmcoYWNjb3VudElkIHx8
ICIiKTsKICBpZiAoIWtpbmQgfHwgIWlkKSByZXR1cm4gW107CgogIGxldCByb3dzID0gW107CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9w
bGVFbnN1cmVSZWFjdGlvblRhYmxlKCk7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNUIHIuZW1vamlf
Y2lwaGVyLCByLmFjY291bnRfaWQsIGEudXNlcm5hbWUsIHIuY3JlYXRlZF9hdCAiICsKICAgICAgIkZST00gcGVvcGxlX21lc3NhZ2VfcmVhY3Rpb25zIHIg
IiArCiAgICAgICJMRUZUIEpPSU4gcGVvcGxlX2FjY291bnRzIGEgT04gYS5pZCA9IHIuYWNjb3VudF9pZCAiICsKICAgICAgIldIRVJFIHIuc2NvcGUgPSAk
MSBBTkQgci5tZXNzYWdlX2lkID0gJDIgIiArCiAgICAgICJPUkRFUiBCWSByLmNyZWF0ZWRfYXQgQVNDIiwKICAgICAgW2tpbmQsIGlkXQogICAgKTsKICAg
IHJvd3MgPSByZXN1bHQucm93cy5tYXAoKHJvdykgPT4gKHsKICAgICAgZW1vamk6IHBlb3BsZURlY3J5cHRNZXNzYWdlVGV4dChyb3cuZW1vamlfY2lwaGVy
KSwKICAgICAgYWNjb3VudElkOiBTdHJpbmcocm93LmFjY291bnRfaWQpLAogICAgICB1c2VybmFtZTogcm93LnVzZXJuYW1lIHx8ICJVdGlsaXNhdGV1ciIK
ICAgIH0pKTsKICB9IGVsc2UgewogICAgY29uc3QgYWNjb3VudHMgPSBuZXcgTWFwKAogICAgICBwZW9wbGVSZWFkTG9jYWxBY2NvdW50cygpLm1hcCgoYWNj
b3VudCkgPT4gW1N0cmluZyhhY2NvdW50LmlkKSwgYWNjb3VudC51c2VybmFtZSB8fCAiVXRpbGlzYXRldXIiXSkKICAgICk7CiAgICByb3dzID0gcGVvcGxl
UmVhZExvY2FsUmVhY3Rpb25zKCkKICAgICAgLmZpbHRlcigoaXRlbSkgPT4gU3RyaW5nKGl0ZW0uc2NvcGUpID09PSBraW5kICYmIFN0cmluZyhpdGVtLm1l
c3NhZ2VJZCkgPT09IGlkKQogICAgICAuc29ydCgoYSwgYikgPT4gTnVtYmVyKGEuY3JlYXRlZEF0IHx8IDApIC0gTnVtYmVyKGIuY3JlYXRlZEF0IHx8IDAp
KQogICAgICAubWFwKChpdGVtKSA9PiAoewogICAgICAgIGVtb2ppOiBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoaXRlbS5lbW9qaSB8fCAiIiksCiAgICAg
ICAgYWNjb3VudElkOiBTdHJpbmcoaXRlbS5hY2NvdW50SWQgfHwgIiIpLAogICAgICAgIHVzZXJuYW1lOiBhY2NvdW50cy5nZXQoU3RyaW5nKGl0ZW0uYWNj
b3VudElkIHx8ICIiKSkgfHwgIlV0aWxpc2F0ZXVyIgogICAgICB9KSk7CiAgfQoKICBjb25zdCBncm91cGVkID0gbmV3IE1hcCgpOwogIGZvciAoY29uc3Qg
cm93IG9mIHJvd3MpIHsKICAgIGlmICghcm93LmVtb2ppKSBjb250aW51ZTsKICAgIGxldCBlbnRyeSA9IGdyb3VwZWQuZ2V0KHJvdy5lbW9qaSk7CiAgICBp
ZiAoIWVudHJ5KSB7CiAgICAgIGVudHJ5ID0geyBlbW9qaTogcm93LmVtb2ppLCBjb3VudDogMCwgbWU6IGZhbHNlLCB1c2VyczogW10gfTsKICAgICAgZ3Jv
dXBlZC5zZXQocm93LmVtb2ppLCBlbnRyeSk7CiAgICB9CiAgICBlbnRyeS5jb3VudCArPSAxOwogICAgaWYgKHJvdy5hY2NvdW50SWQgPT09IG1lKSBlbnRy
eS5tZSA9IHRydWU7CiAgICBpZiAocm93LnVzZXJuYW1lICYmIGVudHJ5LnVzZXJzLmxlbmd0aCA8IDEyICYmICFlbnRyeS51c2Vycy5pbmNsdWRlcyhyb3cu
dXNlcm5hbWUpKSB7CiAgICAgIGVudHJ5LnVzZXJzLnB1c2gocm93LnVzZXJuYW1lKTsKICAgIH0KICB9CgogIHJldHVybiBbLi4uZ3JvdXBlZC52YWx1ZXMo
KV07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVRvZ2dsZVJlYWN0aW9uKHNjb3BlLCBtZXNzYWdlSWQsIGFjY291bnRJZCwgZW1vamkpIHsKICBjb25zdCBr
aW5kID0gcGVvcGxlUmVhY3Rpb25TY29wZShzY29wZSk7CiAgY29uc3QgaWQgPSBwZW9wbGVSZXBseUlkKG1lc3NhZ2VJZCk7CiAgY29uc3QgbWUgPSBTdHJp
bmcoYWNjb3VudElkIHx8ICIiKTsKICBjb25zdCBjbGVhbkVtb2ppID0gcGVvcGxlUmVhY3Rpb25FbW9qaShlbW9qaSk7CgogIGlmICgha2luZCB8fCAhaWQg
fHwgIW1lIHx8ICFjbGVhbkVtb2ppKSB7CiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIlJFQUNUSU9OX0lOVkFMSUQiKTsKICAgIGVyci5jb2RlID0gIlJF
QUNUSU9OX0lOVkFMSUQiOwogICAgdGhyb3cgZXJyOwogIH0KCiAgY29uc3QgZW1vamlLZXkgPSBwZW9wbGVSZWFjdGlvbkVtb2ppS2V5KGtpbmQsIGlkLCBj
bGVhbkVtb2ppKTsKICBjb25zdCBlbW9qaUNpcGhlciA9IHBlb3BsZUVuY3J5cHRNZXNzYWdlVGV4dChjbGVhbkVtb2ppKTsKCiAgaWYgKHBlb3BsZVBvb2wp
IHsKICAgIGF3YWl0IHBlb3BsZUVuc3VyZVJlYWN0aW9uVGFibGUoKTsKICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAg
ICAiREVMRVRFIEZST00gcGVvcGxlX21lc3NhZ2VfcmVhY3Rpb25zICIgKwogICAgICAiV0hFUkUgc2NvcGUgPSAkMSBBTkQgbWVzc2FnZV9pZCA9ICQyIEFO
RCBhY2NvdW50X2lkID0gJDMgQU5EIGVtb2ppX2tleSA9ICQ0ICIgKwogICAgICAiUkVUVVJOSU5HIGlkIiwKICAgICAgW2tpbmQsIGlkLCBtZSwgZW1vamlL
ZXldCiAgICApOwoKICAgIGlmICghcmVtb3ZlZC5yb3dzWzBdKSB7CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIklOU0VSVCBJTlRP
IHBlb3BsZV9tZXNzYWdlX3JlYWN0aW9ucyhzY29wZSwgbWVzc2FnZV9pZCwgYWNjb3VudF9pZCwgZW1vamlfa2V5LCBlbW9qaV9jaXBoZXIpICIgKwogICAg
ICAgICJWQUxVRVMgKCQxLCAkMiwgJDMsICQ0LCAkNSkgT04gQ09ORkxJQ1QgRE8gTk9USElORyIsCiAgICAgICAgW2tpbmQsIGlkLCBtZSwgZW1vamlLZXks
IGVtb2ppQ2lwaGVyXQogICAgICApOwogICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KCiAgICByZXR1cm4gZmFsc2U7CiAgfQoKICBjb25zdCBpdGVtcyA9IHBl
b3BsZVJlYWRMb2NhbFJlYWN0aW9ucygpOwogIGNvbnN0IGluZGV4ID0gaXRlbXMuZmluZEluZGV4KChpdGVtKSA9PgogICAgU3RyaW5nKGl0ZW0uc2NvcGUp
ID09PSBraW5kICYmCiAgICBTdHJpbmcoaXRlbS5tZXNzYWdlSWQpID09PSBpZCAmJgogICAgU3RyaW5nKGl0ZW0uYWNjb3VudElkKSA9PT0gbWUgJiYKICAg
IFN0cmluZyhpdGVtLmVtb2ppS2V5IHx8ICIiKSA9PT0gZW1vamlLZXkKICApOwoKICBpZiAoaW5kZXggPj0gMCkgewogICAgaXRlbXMuc3BsaWNlKGluZGV4
LCAxKTsKICAgIHBlb3BsZVdyaXRlTG9jYWxSZWFjdGlvbnMoaXRlbXMpOwogICAgcmV0dXJuIGZhbHNlOwogIH0KCiAgaXRlbXMucHVzaCh7CiAgICBzY29w
ZToga2luZCwKICAgIG1lc3NhZ2VJZDogaWQsCiAgICBhY2NvdW50SWQ6IG1lLAogICAgZW1vamlLZXksCiAgICBlbW9qaTogZW1vamlDaXBoZXIsCiAgICBj
cmVhdGVkQXQ6IERhdGUubm93KCkKICB9KTsKICBwZW9wbGVXcml0ZUxvY2FsUmVhY3Rpb25zKGl0ZW1zKTsKICByZXR1cm4gdHJ1ZTsKfQoKYXN5bmMgZnVu
Y3Rpb24gcGVvcGxlQnJvYWRjYXN0UmVhY3Rpb25VcGRhdGUoY29udGV4dCkgewogIGlmICghY29udGV4dCkgcmV0dXJuOwoKICBjb25zdCBwYXlsb2FkID0g
ewogICAgc2NvcGU6IGNvbnRleHQuc2NvcGUsCiAgICBtZXNzYWdlSWQ6IGNvbnRleHQubWVzc2FnZUlkCiAgfTsKCiAgaWYgKGNvbnRleHQuc2NvcGUgPT09
ICJkbSIpIHsKICAgIGNvbnN0IHJlY2lwaWVudHMgPSBbLi4ubmV3IFNldChbY29udGV4dC5zZW5kZXJJZCwgY29udGV4dC5yZWNpcGllbnRJZF0uZmlsdGVy
KEJvb2xlYW4pKV07CiAgICBmb3IgKGNvbnN0IHJlY2lwaWVudElkIG9mIHJlY2lwaWVudHMpIHsKICAgICAgcGVvcGxlRW1pdFRvQWNjb3VudChyZWNpcGll
bnRJZCwgIm1lc3NhZ2UtcmVhY3Rpb24tdXBkYXRlZCIsIHBheWxvYWQpOwogICAgfQogICAgcmV0dXJuOwogIH0KCiAgaWYgKGNvbnRleHQuc2VydmVySWQp
IHsKICAgIHBheWxvYWQuc2VydmVySWQgPSBjb250ZXh0LnNlcnZlcklkOwogICAgcGF5bG9hZC5jaGFubmVsSWQgPSBjb250ZXh0LmNoYW5uZWxJZCB8fCAi
IjsKICAgIGF3YWl0IHBlb3BsZUVtaXRTZXJ2ZXJDaGFubmVsRXZlbnQoCiAgICAgIGNvbnRleHQuc2VydmVySWQsCiAgICAgIGNvbnRleHQuY2hhbm5lbElk
IHx8ICIiLAogICAgICAibWVzc2FnZS1yZWFjdGlvbi11cGRhdGVkIiwKICAgICAgcGF5bG9hZAogICAgKTsKICAgIHJldHVybjsKICB9CgogIGlvLmVtaXQo
Im1lc3NhZ2UtcmVhY3Rpb24tdXBkYXRlZCIsIHBheWxvYWQpOwp9CgphcHAuZ2V0KCIvYXBpL21lc3NhZ2UtcmVhY3Rpb25zLzpzY29wZS86aWQiLCBhc3lu
YyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsKICAgIGlmICgh
c2Vzc2lvbikgcmV0dXJuOwoKICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCBwZW9wbGVSZWFjdGlvbk1lc3NhZ2VDb250ZXh0KAogICAgICByZXEucGFyYW1z
LnNjb3BlLAogICAgICByZXEucGFyYW1zLmlkLAogICAgICBzZXNzaW9uLmlkCiAgICApOwoKICAgIGlmICghY29udGV4dCkgewogICAgICByZXR1cm4gcmVz
LnN0YXR1cyg0MDQpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiTWVzc2FnZSBpbnRyb3V2YWJsZS4iIH0pOwogICAgfQoKICAgIGNvbnN0IHJlYWN0aW9u
cyA9IGF3YWl0IHBlb3BsZVJlYWN0aW9uU3VtbWFyeShjb250ZXh0LnNjb3BlLCBjb250ZXh0Lm1lc3NhZ2VJZCwgc2Vzc2lvbi5pZCk7CiAgICByZXMuanNv
bih7IG9rOiB0cnVlLCByZWFjdGlvbnMgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxlIHJlYWN0aW9ucy9nZXRdIiwg
ZXJyKTsKICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZGUgY2hhcmdlciBsZXMgcsOpYWN0aW9ucy4i
IH0pOwogIH0KfSk7CgphcHAucG9zdCgiL2FwaS9tZXNzYWdlLXJlYWN0aW9ucy86c2NvcGUvOmlkL3RvZ2dsZSIsIGFzeW5jIChyZXEsIHJlcykgPT4gewog
IHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1cm47Cgog
ICAgY29uc3QgY29udGV4dCA9IGF3YWl0IHBlb3BsZVJlYWN0aW9uTWVzc2FnZUNvbnRleHQoCiAgICAgIHJlcS5wYXJhbXMuc2NvcGUsCiAgICAgIHJlcS5w
YXJhbXMuaWQsCiAgICAgIHNlc3Npb24uaWQKICAgICk7CgogICAgaWYgKCFjb250ZXh0KSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7
IG9rOiBmYWxzZSwgZXJyb3I6ICJNZXNzYWdlIGludHJvdXZhYmxlLiIgfSk7CiAgICB9CgogICAgaWYgKAogICAgICBjb250ZXh0LnNjb3BlID09PSAiZ2Vu
ZXJhbCIgJiYKICAgICAgY29udGV4dC5zZXJ2ZXJJZCAmJgogICAgICBjb250ZXh0LmNoYW5uZWxJZCAmJgogICAgICAhKGF3YWl0IHBlb3BsZUNhblNlcnZl
clBlcm1pc3Npb24oc2Vzc2lvbi5pZCwgY29udGV4dC5zZXJ2ZXJJZCwgIkFERF9SRUFDVElPTlMiLCBjb250ZXh0LmNoYW5uZWxJZCkpCiAgICApIHsKICAg
ICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlR1IG4nYXMgcGFzIGxhIHBlcm1pc3Npb24gZCdham91dGVyIGRl
cyByw6lhY3Rpb25zIGRhbnMgY2Ugc2Fsb24uIiB9KTsKICAgIH0KCiAgICBjb25zdCBlbW9qaSA9IHBlb3BsZVJlYWN0aW9uRW1vamkocmVxLmJvZHk/LmVt
b2ppKTsKICAgIGlmICghZW1vamkpIHsKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlLDqWFjdGlvbiBp
bnZhbGlkZS4iIH0pOwogICAgfQoKICAgIGNvbnN0IGFjdGl2ZSA9IGF3YWl0IHBlb3BsZVRvZ2dsZVJlYWN0aW9uKGNvbnRleHQuc2NvcGUsIGNvbnRleHQu
bWVzc2FnZUlkLCBzZXNzaW9uLmlkLCBlbW9qaSk7CiAgICBjb25zdCByZWFjdGlvbnMgPSBhd2FpdCBwZW9wbGVSZWFjdGlvblN1bW1hcnkoY29udGV4dC5z
Y29wZSwgY29udGV4dC5tZXNzYWdlSWQsIHNlc3Npb24uaWQpOwoKICAgIHJlcy5qc29uKHsgb2s6IHRydWUsIGFjdGl2ZSwgcmVhY3Rpb25zIH0pOwogICAg
YXdhaXQgcGVvcGxlQnJvYWRjYXN0UmVhY3Rpb25VcGRhdGUoY29udGV4dCk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxl
IHJlYWN0aW9ucy90b2dnbGVdIiwgZXJyKTsKICAgIHJlcy5zdGF0dXMoZXJyPy5jb2RlID09PSAiUkVBQ1RJT05fSU5WQUxJRCIgPyA0MDAgOiA1MDApLmpz
b24oewogICAgICBvazogZmFsc2UsCiAgICAgIGVycm9yOiBlcnI/LmNvZGUgPT09ICJSRUFDVElPTl9JTlZBTElEIiA/ICJSw6lhY3Rpb24gaW52YWxpZGUu
IiA6ICJJbXBvc3NpYmxlIGRlIG1vZGlmaWVyIGxhIHLDqWFjdGlvbi4iCiAgICB9KTsKICB9Cn0pOwovLyA9PT0gUEVPUExFX01FU1NBR0VfUkVBQ1RJT05T
X1YxX0VORCA9PT0KCi8vID09PSBQRU9QTEVfU0VSVkVSU19WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX0xPQ0FMX1NFUlZFUlMgPQogIHBhdGhBY2NvdW50
cy5qb2luKAogICAgX19kaXJuYW1lLAogICAgInBlb3BsZS1zZXJ2ZXJzLmxvY2FsLmpzb24iCiAgKTsKCmZ1bmN0aW9uIHBlb3BsZVNlcnZlclJvb20oc2Vy
dmVySWQpIHsKICByZXR1cm4gKAogICAgInBlb3BsZS1zZXJ2ZXI6IiArCiAgICBTdHJpbmcoc2VydmVySWQpCiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlU2Vy
dmVyTmFtZSh2YWx1ZSkgewogIHJldHVybiBTdHJpbmcodmFsdWUgfHwgIiIpCiAgICAubm9ybWFsaXplKCJORktDIikKICAgIC50cmltKCkKICAgIC5yZXBs
YWNlKC9ccysvZywgIiAiKQogICAgLnNsaWNlKDAsIDQwKTsKfQoKZnVuY3Rpb24gcGVvcGxlVmFsaWRTZXJ2ZXJOYW1lKHZhbHVlKSB7CiAgY29uc3QgbmFt
ZSA9CiAgICBwZW9wbGVTZXJ2ZXJOYW1lKHZhbHVlKTsKCiAgcmV0dXJuICgKICAgIG5hbWUubGVuZ3RoID49IDIgJiYKICAgIG5hbWUubGVuZ3RoIDw9IDQw
ICYmCiAgICAhL1tcdTAwMDAtXHUwMDFmXHUwMDdmXS91LnRlc3QobmFtZSkKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVOZXdJbnZpdGVDb2RlKCkgewogIHJl
dHVybiBjcnlwdG9BY2NvdW50cwogICAgLnJhbmRvbUJ5dGVzKDE0KQogICAgLnRvU3RyaW5nKCJiYXNlNjR1cmwiKTsKfQoKZnVuY3Rpb24gcGVvcGxlUmVh
ZExvY2FsU2VydmVycygpIHsKICB0cnkgewogICAgaWYgKAogICAgICAhZnNBY2NvdW50cy5leGlzdHNTeW5jKAogICAgICAgIFBFT1BMRV9MT0NBTF9TRVJW
RVJTCiAgICAgICkKICAgICkgewogICAgICByZXR1cm4gewogICAgICAgIHNlcnZlcnM6IFtdLAogICAgICAgIG1lbWJlcnM6IFtdLAogICAgICAgIGNoYW5u
ZWxzOiBbXSwKICAgICAgICByb2xlczogW10sCiAgICAgICAgbWVtYmVyUm9sZXM6IFtdLAogICAgICAgIHBlcm1pc3Npb25PdmVycmlkZXM6IFtdLAogICAg
ICAgIGJhbnM6IFtdCiAgICAgIH07CiAgICB9CgogICAgY29uc3QgcmF3ID0KICAgICAgSlNPTi5wYXJzZSgKICAgICAgICBmc0FjY291bnRzLnJlYWRGaWxl
U3luYygKICAgICAgICAgIFBFT1BMRV9MT0NBTF9TRVJWRVJTLAogICAgICAgICAgInV0ZjgiCiAgICAgICAgKQogICAgICApOwoKICAgIHJldHVybiB7CiAg
ICAgIHNlcnZlcnM6CiAgICAgICAgQXJyYXkuaXNBcnJheShyYXc/LnNlcnZlcnMpCiAgICAgICAgICA/IHJhdy5zZXJ2ZXJzCiAgICAgICAgICA6IFtdLAog
ICAgICBtZW1iZXJzOgogICAgICAgIEFycmF5LmlzQXJyYXkocmF3Py5tZW1iZXJzKQogICAgICAgICAgPyByYXcubWVtYmVycwogICAgICAgICAgOiBbXSwK
ICAgICAgY2hhbm5lbHM6CiAgICAgICAgQXJyYXkuaXNBcnJheShyYXc/LmNoYW5uZWxzKQogICAgICAgICAgPyByYXcuY2hhbm5lbHMKICAgICAgICAgIDog
W10sCiAgICAgIHJvbGVzOgogICAgICAgIEFycmF5LmlzQXJyYXkocmF3Py5yb2xlcykKICAgICAgICAgID8gcmF3LnJvbGVzCiAgICAgICAgICA6IFtdLAog
ICAgICBtZW1iZXJSb2xlczoKICAgICAgICBBcnJheS5pc0FycmF5KHJhdz8ubWVtYmVyUm9sZXMpCiAgICAgICAgICA/IHJhdy5tZW1iZXJSb2xlcwogICAg
ICAgICAgOiBbXSwKICAgICAgcGVybWlzc2lvbk92ZXJyaWRlczoKICAgICAgICBBcnJheS5pc0FycmF5KHJhdz8ucGVybWlzc2lvbk92ZXJyaWRlcykKICAg
ICAgICAgID8gcmF3LnBlcm1pc3Npb25PdmVycmlkZXMKICAgICAgICAgIDogW10sCiAgICAgIGJhbnM6CiAgICAgICAgQXJyYXkuaXNBcnJheShyYXc/LmJh
bnMpCiAgICAgICAgICA/IHJhdy5iYW5zCiAgICAgICAgICA6IFtdCiAgICB9OwogIH0gY2F0Y2ggewogICAgcmV0dXJuIHsKICAgICAgc2VydmVyczogW10s
CiAgICAgIG1lbWJlcnM6IFtdLAogICAgICBjaGFubmVsczogW10sCiAgICAgIHJvbGVzOiBbXSwKICAgICAgbWVtYmVyUm9sZXM6IFtdLAogICAgICBwZXJt
aXNzaW9uT3ZlcnJpZGVzOiBbXSwKICAgICAgYmFuczogW10KICAgIH07CiAgfQp9CgpmdW5jdGlvbiBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKSB7
CiAgZnNBY2NvdW50cy53cml0ZUZpbGVTeW5jKAogICAgUEVPUExFX0xPQ0FMX1NFUlZFUlMsCiAgICBKU09OLnN0cmluZ2lmeSgKICAgICAgewogICAgICAg
IHNlcnZlcnM6CiAgICAgICAgICBBcnJheS5pc0FycmF5KGRhdGE/LnNlcnZlcnMpCiAgICAgICAgICAgID8gZGF0YS5zZXJ2ZXJzCiAgICAgICAgICAgIDog
W10sCiAgICAgICAgbWVtYmVyczoKICAgICAgICAgIEFycmF5LmlzQXJyYXkoZGF0YT8ubWVtYmVycykKICAgICAgICAgICAgPyBkYXRhLm1lbWJlcnMKICAg
ICAgICAgICAgOiBbXSwKICAgICAgICBjaGFubmVsczoKICAgICAgICAgIEFycmF5LmlzQXJyYXkoZGF0YT8uY2hhbm5lbHMpCiAgICAgICAgICAgID8gZGF0
YS5jaGFubmVscwogICAgICAgICAgICA6IFtdLAogICAgICAgIHJvbGVzOgogICAgICAgICAgQXJyYXkuaXNBcnJheShkYXRhPy5yb2xlcykKICAgICAgICAg
ICAgPyBkYXRhLnJvbGVzCiAgICAgICAgICAgIDogW10sCiAgICAgICAgbWVtYmVyUm9sZXM6CiAgICAgICAgICBBcnJheS5pc0FycmF5KGRhdGE/Lm1lbWJl
clJvbGVzKQogICAgICAgICAgICA/IGRhdGEubWVtYmVyUm9sZXMKICAgICAgICAgICAgOiBbXSwKICAgICAgICBwZXJtaXNzaW9uT3ZlcnJpZGVzOgogICAg
ICAgICAgQXJyYXkuaXNBcnJheShkYXRhPy5wZXJtaXNzaW9uT3ZlcnJpZGVzKQogICAgICAgICAgICA/IGRhdGEucGVybWlzc2lvbk92ZXJyaWRlcwogICAg
ICAgICAgICA6IFtdLAogICAgICAgIGJhbnM6CiAgICAgICAgICBBcnJheS5pc0FycmF5KGRhdGE/LmJhbnMpCiAgICAgICAgICAgID8gZGF0YS5iYW5zCiAg
ICAgICAgICAgIDogW10KICAgICAgfSwKICAgICAgbnVsbCwKICAgICAgMgogICAgKSArICJcbiIsCiAgICAidXRmOCIKICApOwp9CgovLyA9PT0gUEVPUExF
X1NFUlZFUl9JQ09OX1YxX1BVQkxJQyA9PT0KZnVuY3Rpb24gcGVvcGxlU2VydmVyUHVibGljKHNlcnZlcikgewogIGlmICghc2VydmVyKSByZXR1cm4gbnVs
bDsKCiAgY29uc3Qgb3V0cHV0ID0gewogICAgaWQ6IFN0cmluZyhzZXJ2ZXIuaWQpLAogICAgbmFtZTogc2VydmVyLm5hbWUsCiAgICBvd25lcklkOiBzZXJ2
ZXIub3duZXJJZCA/PyBzZXJ2ZXIub3duZXJfaWQgPz8gbnVsbCwKICAgIG9mZmljaWFsOiBCb29sZWFuKHNlcnZlci5vZmZpY2lhbCA/PyBzZXJ2ZXIuaXNf
b2ZmaWNpYWwpLAogICAgY3JlYXRlZEF0OiBzZXJ2ZXIuY3JlYXRlZEF0ID8/IHNlcnZlci5jcmVhdGVkX2F0ID8/IG51bGwKICB9OwoKICBjb25zdCBpY29u
RGF0YSA9IHNlcnZlci5pY29uRGF0YSA/PyBzZXJ2ZXIuaWNvbl9kYXRhOwogIC8vIEltcG9ydGFudDogc2kgdW5lIGFuY2llbm5lIHJvdXRlIG5lIGNvbm5h
aXQgcGFzIGVuY29yZSBsJ2ljb25lLCBvbiBuJ2Vudm9pZQogIC8vIHBhcyBpY29uRGF0YT1udWxsIGFmaW4gZGUgbmUgcGFzIGVmZmFjZXIgdW5lIGljb25l
IGRlamEgZW4gY2FjaGUgY290ZSBjbGllbnQuCiAgaWYgKGljb25EYXRhICE9PSB1bmRlZmluZWQpIG91dHB1dC5pY29uRGF0YSA9IGljb25EYXRhIHx8IG51
bGw7CgogIHJldHVybiBvdXRwdXQ7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUdldFNlcnZlcihzZXJ2ZXJJZCkgewogIGNvbnN0IGlkID0KICAgIFN0cmlu
ZyhzZXJ2ZXJJZCB8fCAiIikudHJpbSgpOwoKICBpZiAoIWlkKSByZXR1cm4gbnVsbDsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGlmICghL15cZCskLy50
ZXN0KGlkKSkgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KCiAgICBjb25zdCByZXN1bHQgPQogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAg
ICAgICJTRUxFQ1QgaWQsIG5hbWUsIG93bmVyX2lkLCBpbnZpdGVfY29kZSwgaXNfb2ZmaWNpYWwsIGljb25fZGF0YSwgY3JlYXRlZF9hdCAiICsKICAgICAg
ICAiRlJPTSBwZW9wbGVfc2VydmVycyBXSEVSRSBpZCA9ICQxIExJTUlUIDEiLAogICAgICAgIFtpZF0KICAgICAgKTsKCiAgICBjb25zdCByb3cgPQogICAg
ICByZXN1bHQucm93c1swXTsKCiAgICBpZiAoIXJvdykgcmV0dXJuIG51bGw7CgogICAgcmV0dXJuIHsKICAgICAgaWQ6CiAgICAgICAgU3RyaW5nKHJvdy5p
ZCksCiAgICAgIG5hbWU6CiAgICAgICAgcm93Lm5hbWUsCiAgICAgIG93bmVySWQ6CiAgICAgICAgcm93Lm93bmVyX2lkCiAgICAgICAgICA/IFN0cmluZyhy
b3cub3duZXJfaWQpCiAgICAgICAgICA6IG51bGwsCiAgICAgIGludml0ZUNvZGU6CiAgICAgICAgcm93Lmludml0ZV9jb2RlLAogICAgICBvZmZpY2lhbDog
Qm9vbGVhbihyb3cuaXNfb2ZmaWNpYWwpLAogICAgICBpY29uRGF0YTogcm93Lmljb25fZGF0YSB8fCBudWxsLAogICAgICBjcmVhdGVkQXQ6CiAgICAgICAg
cm93LmNyZWF0ZWRfYXQKICAgIH07CiAgfQoKICBjb25zdCBkYXRhID0KICAgIHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKTsKCiAgcmV0dXJuICgKICAgIGRh
dGEuc2VydmVycy5maW5kKAogICAgICAoc2VydmVyKSA9PgogICAgICAgIFN0cmluZyhzZXJ2ZXIuaWQpID09PSBpZAogICAgKSB8fCBudWxsCiAgKTsKfQoK
YXN5bmMgZnVuY3Rpb24gcGVvcGxlR2V0U2VydmVyQnlJbnZpdGUoY29kZSkgewogIGNvbnN0IGludml0ZSA9CiAgICBTdHJpbmcoY29kZSB8fCAiIikKICAg
ICAgLnRyaW0oKQogICAgICAuc2xpY2UoMCwgODApOwoKICBpZiAoIWludml0ZSkgcmV0dXJuIG51bGw7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25z
dCByZXN1bHQgPQogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgaWQsIG5hbWUsIG93bmVyX2lkLCBpbnZpdGVfY29kZSwg
aXNfb2ZmaWNpYWwsIGljb25fZGF0YSwgY3JlYXRlZF9hdCAiICsKICAgICAgICAiRlJPTSBwZW9wbGVfc2VydmVycyBXSEVSRSBpbnZpdGVfY29kZSA9ICQx
IExJTUlUIDEiLAogICAgICAgIFtpbnZpdGVdCiAgICAgICk7CgogICAgY29uc3Qgcm93ID0KICAgICAgcmVzdWx0LnJvd3NbMF07CgogICAgaWYgKCFyb3cp
IHJldHVybiBudWxsOwoKICAgIHJldHVybiB7CiAgICAgIGlkOgogICAgICAgIFN0cmluZyhyb3cuaWQpLAogICAgICBuYW1lOgogICAgICAgIHJvdy5uYW1l
LAogICAgICBvd25lcklkOgogICAgICAgIHJvdy5vd25lcl9pZAogICAgICAgICAgPyBTdHJpbmcocm93Lm93bmVyX2lkKQogICAgICAgICAgOiBudWxsLAog
ICAgICBpbnZpdGVDb2RlOgogICAgICAgIHJvdy5pbnZpdGVfY29kZSwKICAgICAgb2ZmaWNpYWw6IEJvb2xlYW4ocm93LmlzX29mZmljaWFsKSwKICAgICAg
aWNvbkRhdGE6IHJvdy5pY29uX2RhdGEgfHwgbnVsbCwKICAgICAgY3JlYXRlZEF0OgogICAgICAgIHJvdy5jcmVhdGVkX2F0CiAgICB9OwogIH0KCiAgcmV0
dXJuICgKICAgIHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKQogICAgICAuc2VydmVycwogICAgICAuZmluZCgKICAgICAgICAoc2VydmVyKSA9PgogICAgICAg
ICAgU3RyaW5nKHNlcnZlci5pbnZpdGVDb2RlKSA9PT0KICAgICAgICAgIGludml0ZQogICAgICApIHx8IG51bGwKICApOwp9Cgphc3luYyBmdW5jdGlvbiBw
ZW9wbGVJc1NlcnZlck1lbWJlcigKICBhY2NvdW50SWQsCiAgc2VydmVySWQKKSB7CiAgY29uc3QgdXNlcklkID0KICAgIFN0cmluZyhhY2NvdW50SWQgfHwg
IiIpOwoKICBjb25zdCBpZCA9CiAgICBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwoKICBpZiAoIXVzZXJJZCB8fCAhaWQpIHsKICAgIHJldHVybiBmYWxzZTsK
ICB9CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBpZiAoCiAgICAgICEvXlxkKyQvLnRlc3QodXNlcklkKSB8fAogICAgICAhL15cZCskLy50ZXN0KGlkKQog
ICAgKSB7CiAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KCiAgICBjb25zdCByZXN1bHQgPQogICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAg
ICJTRUxFQ1QgMSBGUk9NIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyAiICsKICAgICAgICAiV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIHVzZXJfaWQgPSAkMiBM
SU1JVCAxIiwKICAgICAgICBbCiAgICAgICAgICBpZCwKICAgICAgICAgIHVzZXJJZAogICAgICAgIF0KICAgICAgKTsKCiAgICByZXR1cm4gQm9vbGVhbigK
ICAgICAgcmVzdWx0LnJvd3NbMF0KICAgICk7CiAgfQoKICByZXR1cm4gcGVvcGxlUmVhZExvY2FsU2VydmVycygpCiAgICAubWVtYmVycwogICAgLnNvbWUo
CiAgICAgIChtZW1iZXIpID0+CiAgICAgICAgU3RyaW5nKG1lbWJlci5zZXJ2ZXJJZCkgPT09IGlkICYmCiAgICAgICAgU3RyaW5nKG1lbWJlci51c2VySWQp
ID09PSB1c2VySWQKICAgICk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlck1lbWJlckNvdW50KAogIHNlcnZlcklkCikgewogIGNvbnN0IGlkID0K
ICAgIFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CgogIGlmICghaWQpIHJldHVybiAwOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgaWYgKCEvXlxkKyQvLnRl
c3QoaWQpKSB7CiAgICAgIHJldHVybiAwOwogICAgfQoKICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAg
IlNFTEVDVCBDT1VOVCgqKTo6aW50IEFTIGNvdW50ICIgKwogICAgICAgICJGUk9NIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyBXSEVSRSBzZXJ2ZXJfaWQgPSAk
MSIsCiAgICAgICAgW2lkXQogICAgICApOwoKICAgIHJldHVybiBOdW1iZXIoCiAgICAgIHJlc3VsdC5yb3dzWzBdPy5jb3VudCB8fCAwCiAgICApOwogIH0K
CiAgcmV0dXJuIHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKQogICAgLm1lbWJlcnMKICAgIC5maWx0ZXIoCiAgICAgIChtZW1iZXIpID0+CiAgICAgICAgU3Ry
aW5nKG1lbWJlci5zZXJ2ZXJJZCkgPT09IGlkCiAgICApLmxlbmd0aDsKfQoKLy8gPT09IFBFT1BMRV9ERUxFVEVfRU1QVFlfU0VSVkVSU19WMV9TVEFSVCA9
PT0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZURlbGV0ZVNlcnZlcklmRW1wdHkoCiAgc2VydmVySWQKKSB7CiAgY29uc3QgaWQgPQogICAgU3RyaW5nKAogICAg
ICBzZXJ2ZXJJZCB8fAogICAgICAiIgogICAgKS50cmltKCk7CgogIGlmICghaWQpIHsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIGNvbnN0IHNlcnZlciA9
CiAgICBhd2FpdCBwZW9wbGVHZXRTZXJ2ZXIoCiAgICAgIGlkCiAgICApOwoKICAvKgogICAgTGUgc2VydmV1ciBvZmZpY2llbCBQZW9wbGUgZXN0IHBlcm1h
bmVudC4KICAgIFNldWxzIGxlcyBzZXJ2ZXVycyBjcsOpw6lzIHBhciBsZXMgdXRpbGlzYXRldXJzCiAgICBwZXV2ZW50IGRpc3BhcmHDrnRyZSBhdXRvbWF0
aXF1ZW1lbnQuCiAgKi8KICBpZiAoCiAgICAhc2VydmVyIHx8CiAgICBzZXJ2ZXIub2ZmaWNpYWwKICApIHsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIGlm
IChwZW9wbGVQb29sKSB7CiAgICBpZiAoCiAgICAgICEvXlxkKyQvLnRlc3QoCiAgICAgICAgaWQKICAgICAgKQogICAgKSB7CiAgICAgIHJldHVybiBmYWxz
ZTsKICAgIH0KCiAgICBjb25zdCBjbGllbnQgPQogICAgICBhd2FpdCBwZW9wbGVQb29sLmNvbm5lY3QoKTsKCiAgICB0cnkgewogICAgICBhd2FpdCBjbGll
bnQucXVlcnkoCiAgICAgICAgIkJFR0lOIgogICAgICApOwoKICAgICAgY29uc3QgbG9ja2VkID0KICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAg
ICAgICAiU0VMRUNUIGlkLCBpc19vZmZpY2lhbCBGUk9NIHBlb3BsZV9zZXJ2ZXJzICIgKwogICAgICAgICAgIldIRVJFIGlkID0gJDEgRk9SIFVQREFURSIs
CiAgICAgICAgICBbCiAgICAgICAgICAgIGlkCiAgICAgICAgICBdCiAgICAgICAgKTsKCiAgICAgIGNvbnN0IHJvdyA9CiAgICAgICAgbG9ja2VkLnJvd3Nb
MF07CgogICAgICBpZiAoCiAgICAgICAgIXJvdyB8fAogICAgICAgIHJvdy5pc19vZmZpY2lhbAogICAgICApIHsKICAgICAgICBhd2FpdCBjbGllbnQucXVl
cnkoCiAgICAgICAgICAiUk9MTEJBQ0siCiAgICAgICAgKTsKCiAgICAgICAgcmV0dXJuIGZhbHNlOwogICAgICB9CgogICAgICBjb25zdCBjb3VudFJlc3Vs
dCA9CiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgIlNFTEVDVCBDT1VOVCgqKTo6aW50IEFTIGNvdW50ICIgKwogICAgICAgICAgIkZS
T00gcGVvcGxlX3NlcnZlcl9tZW1iZXJzICIgKwogICAgICAgICAgIldIRVJFIHNlcnZlcl9pZCA9ICQxIiwKICAgICAgICAgIFsKICAgICAgICAgICAgaWQK
ICAgICAgICAgIF0KICAgICAgICApOwoKICAgICAgY29uc3QgbWVtYmVyQ291bnQgPQogICAgICAgIE51bWJlcigKICAgICAgICAgIGNvdW50UmVzdWx0LnJv
d3NbMF0/LmNvdW50IHx8CiAgICAgICAgICAwCiAgICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICBtZW1iZXJDb3VudCA+CiAgICAgICAgMAogICAgICAp
IHsKICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiUk9MTEJBQ0siCiAgICAgICAgKTsKCiAgICAgICAgcmV0dXJuIGZhbHNlOwogICAg
ICB9CgogICAgICAvKgogICAgICAgIExlcyBpbWFnZXMgbGnDqWVzIGF1eCBtZXNzYWdlcyBzb250IGTDqWrDoCBlbiBPTiBERUxFVEUgQ0FTQ0FERS4KICAg
ICAgICBPbiBzdXBwcmltZSBleHBsaWNpdGVtZW50IGxlcyBtZXNzYWdlcyBhdmFudCBsZSBzZXJ2ZXVyCiAgICAgICAgcG91ciByZXN0ZXIgY29tcGF0aWJs
ZSBhdmVjIGxlcyBhbmNpZW5uZXMgYmFzZXMgUGVvcGxlLgogICAgICAqLwogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIkRFTEVURSBGUk9N
IHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzICIgKwogICAgICAgICJXSEVSRSBzZXJ2ZXJfaWQgPSAkMSIsCiAgICAgICAgWwogICAgICAgICAgaWQKICAgICAg
ICBdCiAgICAgICk7CgogICAgICBjb25zdCByZW1vdmVkID0KICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiREVMRVRFIEZST00gcGVv
cGxlX3NlcnZlcnMgIiArCiAgICAgICAgICAiV0hFUkUgaWQgPSAkMSBBTkQgaXNfb2ZmaWNpYWwgPSBGQUxTRSAiICsKICAgICAgICAgICJSRVRVUk5JTkcg
aWQiLAogICAgICAgICAgWwogICAgICAgICAgICBpZAogICAgICAgICAgXQogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIXJlbW92ZWQucm93c1sw
XQogICAgICApIHsKICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiUk9MTEJBQ0siCiAgICAgICAgKTsKCiAgICAgICAgcmV0dXJuIGZh
bHNlOwogICAgICB9CgogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIkNPTU1JVCIKICAgICAgKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAg
ICBhd2FpdCBjbGllbnQKICAgICAgICAucXVlcnkoCiAgICAgICAgICAiUk9MTEJBQ0siCiAgICAgICAgKQogICAgICAgIC5jYXRjaCgKICAgICAgICAgICgp
ID0+IHt9CiAgICAgICAgKTsKCiAgICAgIHRocm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfSBlbHNl
IHsKICAgIGNvbnN0IGRhdGEgPQogICAgICBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CgogICAgY29uc3QgbG9jYWxTZXJ2ZXIgPQogICAgICBkYXRhLnNl
cnZlcnMuZmluZCgKICAgICAgICAoaXRlbSkgPT4KICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgaXRlbS5pZAogICAgICAgICAgKSA9PT0gaWQKICAg
ICAgKTsKCiAgICBpZiAoCiAgICAgICFsb2NhbFNlcnZlciB8fAogICAgICBCb29sZWFuKAogICAgICAgIGxvY2FsU2VydmVyLm9mZmljaWFsCiAgICAgICkK
ICAgICkgewogICAgICByZXR1cm4gZmFsc2U7CiAgICB9CgogICAgY29uc3QgbWVtYmVyQ291bnQgPQogICAgICBkYXRhLm1lbWJlcnMuZmlsdGVyKAogICAg
ICAgIChtZW1iZXIpID0+CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIG1lbWJlci5zZXJ2ZXJJZCA/PwogICAgICAgICAgICBtZW1iZXIuc2VydmVy
X2lkID8/CiAgICAgICAgICAgICIiCiAgICAgICAgICApID09PSBpZAogICAgICApLmxlbmd0aDsKCiAgICBpZiAoCiAgICAgIG1lbWJlckNvdW50ID4KICAg
ICAgMAogICAgKSB7CiAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KCiAgICBjb25zdCBtZXNzYWdlcyA9CiAgICAgIHBlb3BsZVJlYWRMb2NhbEdlbmVyYWwo
KTsKCiAgICBjb25zdCByZW1vdmVkTWVzc2FnZXMgPQogICAgICBtZXNzYWdlcy5maWx0ZXIoCiAgICAgICAgKG1lc3NhZ2UpID0+CiAgICAgICAgICBTdHJp
bmcoCiAgICAgICAgICAgIG1lc3NhZ2Uuc2VydmVySWQgPz8KICAgICAgICAgICAgbWVzc2FnZS5zZXJ2ZXJfaWQgPz8KICAgICAgICAgICAgIiIKICAgICAg
ICAgICkgPT09IGlkCiAgICAgICk7CgogICAgZm9yICgKICAgICAgY29uc3QgbWVzc2FnZSBvZgogICAgICByZW1vdmVkTWVzc2FnZXMKICAgICkgewogICAg
ICBwZW9wbGVEZWxldGVMb2NhbEJvdW5kTWVzc2FnZUltYWdlKAogICAgICAgICJnZW5lcmFsIiwKICAgICAgICBtZXNzYWdlLmlkCiAgICAgICk7CiAgICB9
CgogICAgcGVvcGxlV3JpdGVMb2NhbEdlbmVyYWwoCiAgICAgIG1lc3NhZ2VzLmZpbHRlcigKICAgICAgICAobWVzc2FnZSkgPT4KICAgICAgICAgIFN0cmlu
ZygKICAgICAgICAgICAgbWVzc2FnZS5zZXJ2ZXJJZCA/PwogICAgICAgICAgICBtZXNzYWdlLnNlcnZlcl9pZCA/PwogICAgICAgICAgICAiIgogICAgICAg
ICAgKSAhPT0gaWQKICAgICAgKQogICAgKTsKCiAgICBkYXRhLnNlcnZlcnMgPQogICAgICBkYXRhLnNlcnZlcnMuZmlsdGVyKAogICAgICAgIChpdGVtKSA9
PgogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBpdGVtLmlkCiAgICAgICAgICApICE9PSBpZAogICAgICApOwoKICAgIGRhdGEubWVtYmVycyA9CiAg
ICAgIGRhdGEubWVtYmVycy5maWx0ZXIoCiAgICAgICAgKG1lbWJlcikgPT4KICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgbWVtYmVyLnNlcnZlcklk
ID8/CiAgICAgICAgICAgIG1lbWJlci5zZXJ2ZXJfaWQgPz8KICAgICAgICAgICAgIiIKICAgICAgICAgICkgIT09IGlkCiAgICAgICk7CgogICAgZGF0YS5j
aGFubmVscyA9CiAgICAgIChkYXRhLmNoYW5uZWxzIHx8IFtdKS5maWx0ZXIoCiAgICAgICAgKGNoYW5uZWwpID0+CiAgICAgICAgICBTdHJpbmcoCiAgICAg
ICAgICAgIGNoYW5uZWwuc2VydmVySWQgPz8KICAgICAgICAgICAgY2hhbm5lbC5zZXJ2ZXJfaWQgPz8KICAgICAgICAgICAgIiIKICAgICAgICAgICkgIT09
IGlkCiAgICAgICk7CgogICAgZGF0YS5yb2xlcyA9IChkYXRhLnJvbGVzIHx8IFtdKS5maWx0ZXIoCiAgICAgIChyb2xlKSA9PiBTdHJpbmcocm9sZS5zZXJ2
ZXJJZCA/PyByb2xlLnNlcnZlcl9pZCA/PyAiIikgIT09IGlkCiAgICApOwogICAgZGF0YS5tZW1iZXJSb2xlcyA9IChkYXRhLm1lbWJlclJvbGVzIHx8IFtd
KS5maWx0ZXIoCiAgICAgIChpdGVtKSA9PiBTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgIT09IGlkCiAgICApOwogICAg
ZGF0YS5wZXJtaXNzaW9uT3ZlcnJpZGVzID0gKGRhdGEucGVybWlzc2lvbk92ZXJyaWRlcyB8fCBbXSkuZmlsdGVyKAogICAgICAoaXRlbSkgPT4gU3RyaW5n
KGl0ZW0uc2VydmVySWQgPz8gaXRlbS5zZXJ2ZXJfaWQgPz8gIiIpICE9PSBpZAogICAgKTsKCiAgICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycygKICAgICAg
ZGF0YQogICAgKTsKICB9CgogIC8qCiAgICBOZXR0b3lhZ2UgZMOpZmVuc2lmIGRlcyBzb2NrZXRzIDoKICAgIG5vcm1hbGVtZW50IGlsIG4nZXhpc3RlIGTD
qWrDoCBwbHVzIGF1Y3VuIG1lbWJyZSwKICAgIG1haXMgdW5lIHNvY2tldCBwZXV0IGVuY29yZSBhdm9pciBjZXQgYW5jaWVuIHNlcnZldXIgc8OpbGVjdGlv
bm7DqS4KICAqLwogIGlvLnRvKAogICAgcGVvcGxlU2VydmVyUm9vbSgKICAgICAgaWQKICAgICkKICApLmVtaXQoCiAgICAic2VydmVyLWRlbGV0ZWQiLAog
ICAgewogICAgICBzZXJ2ZXJJZDoKICAgICAgICBpZAogICAgfQogICk7CgogIGZvciAoCiAgICBjb25zdCBbCiAgICAgIHNvY2tldElkLAogICAgICBjdXJy
ZW50U2VydmVySWQKICAgIF0KICAgIG9mIFsKICAgICAgLi4uc29ja2V0U2VydmVySWRzLmVudHJpZXMoKQogICAgXQogICkgewogICAgaWYgKAogICAgICBT
dHJpbmcoCiAgICAgICAgY3VycmVudFNlcnZlcklkIHx8CiAgICAgICAgIiIKICAgICAgKSAhPT0gaWQKICAgICkgewogICAgICBjb250aW51ZTsKICAgIH0K
CiAgICBjb25zdCBzb2NrZXQgPQogICAgICBpby5zb2NrZXRzLnNvY2tldHMuZ2V0KAogICAgICAgIHNvY2tldElkCiAgICAgICk7CgogICAgaWYgKHNvY2tl
dCkgewogICAgICBsZWF2ZVZvaWNlKAogICAgICAgIHNvY2tldAogICAgICApOwoKICAgICAgYXdhaXQgc29ja2V0LmxlYXZlKAogICAgICAgIHBlb3BsZVNl
cnZlclJvb20oCiAgICAgICAgICBpZAogICAgICAgICkKICAgICAgKTsKCiAgICAgIHNvY2tldC5lbWl0KAogICAgICAgICJzZXJ2ZXItbWVtYmVyc2hpcC1s
ZWZ0IiwKICAgICAgICB7CiAgICAgICAgICBzZXJ2ZXJJZDoKICAgICAgICAgICAgaWQsCiAgICAgICAgICBkZWxldGVkOgogICAgICAgICAgICB0cnVlCiAg
ICAgICAgfQogICAgICApOwogICAgfQoKICAgIHNvY2tldFNlcnZlcklkcy5kZWxldGUoCiAgICAgIHNvY2tldElkCiAgICApOwogIH0KCiAgZm9yICgKICAg
IGNvbnN0IFsKICAgICAgdm9pY2VTb2NrZXRJZCwKICAgICAgdm9pY2VVc2VyCiAgICBdCiAgICBvZiBbCiAgICAgIC4uLnZvaWNlVXNlcnMuZW50cmllcygp
CiAgICBdCiAgKSB7CiAgICBpZiAoCiAgICAgIFN0cmluZygKICAgICAgICB2b2ljZVVzZXI/LnNlcnZlcklkIHx8CiAgICAgICAgIiIKICAgICAgKSAhPT0g
aWQKICAgICkgewogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBjb25zdCBzb2NrZXQgPQogICAgICBpby5zb2NrZXRzLnNvY2tldHMuZ2V0KAogICAgICAg
IHZvaWNlU29ja2V0SWQKICAgICAgKTsKCiAgICBpZiAoc29ja2V0KSB7CiAgICAgIGxlYXZlVm9pY2UoCiAgICAgICAgc29ja2V0CiAgICAgICk7CiAgICB9
CiAgfQoKICBjb25zb2xlLmxvZygKICAgICJbUGVvcGxlXSBTZXJ2ZXVyIHZpZGUgc3VwcHJpbcOpIDogIiArCiAgICBpZAogICk7CgogIHJldHVybiB0cnVl
Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVEZWxldGVBbGxFbXB0eVNlcnZlcnMoKSB7CiAgbGV0IGlkcyA9CiAgICBbXTsKCiAgaWYgKHBlb3BsZVBvb2wp
IHsKICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIlNFTEVDVCBzLmlkICIgKwogICAgICAgICJGUk9N
IHBlb3BsZV9zZXJ2ZXJzIHMgIiArCiAgICAgICAgIldIRVJFIHMuaXNfb2ZmaWNpYWwgPSBGQUxTRSAiICsKICAgICAgICAiQU5EIE5PVCBFWElTVFMgKCIg
KwogICAgICAgICJTRUxFQ1QgMSBGUk9NIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyBtICIgKwogICAgICAgICJXSEVSRSBtLnNlcnZlcl9pZCA9IHMuaWQiICsK
ICAgICAgICAiKSIKICAgICAgKTsKCiAgICBpZHMgPQogICAgICByZXN1bHQucm93cy5tYXAoCiAgICAgICAgKHJvdykgPT4KICAgICAgICAgIFN0cmluZygK
ICAgICAgICAgICAgcm93LmlkCiAgICAgICAgICApCiAgICAgICk7CiAgfSBlbHNlIHsKICAgIGNvbnN0IGRhdGEgPQogICAgICBwZW9wbGVSZWFkTG9jYWxT
ZXJ2ZXJzKCk7CgogICAgY29uc3QgdXNlZCA9CiAgICAgIG5ldyBTZXQoCiAgICAgICAgZGF0YS5tZW1iZXJzLm1hcCgKICAgICAgICAgIChtZW1iZXIpID0+
CiAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgICBtZW1iZXIuc2VydmVySWQgPz8KICAgICAgICAgICAgICBtZW1iZXIuc2VydmVyX2lkID8/CiAg
ICAgICAgICAgICAgIiIKICAgICAgICAgICAgKQogICAgICAgICkKICAgICAgKTsKCiAgICBpZHMgPQogICAgICBkYXRhLnNlcnZlcnMKICAgICAgICAuZmls
dGVyKAogICAgICAgICAgKHNlcnZlcikgPT4KICAgICAgICAgICAgIUJvb2xlYW4oCiAgICAgICAgICAgICAgc2VydmVyLm9mZmljaWFsCiAgICAgICAgICAg
ICkgJiYKICAgICAgICAgICAgIXVzZWQuaGFzKAogICAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgICAgIHNlcnZlci5pZAogICAgICAgICAgICAg
ICkKICAgICAgICAgICAgKQogICAgICAgICkKICAgICAgICAubWFwKAogICAgICAgICAgKHNlcnZlcikgPT4KICAgICAgICAgICAgU3RyaW5nKAogICAgICAg
ICAgICAgIHNlcnZlci5pZAogICAgICAgICAgICApCiAgICAgICAgKTsKICB9CgogIGxldCBkZWxldGVkID0KICAgIDA7CgogIGZvciAoCiAgICBjb25zdCBp
ZCBvZgogICAgaWRzCiAgKSB7CiAgICBpZiAoCiAgICAgIGF3YWl0IHBlb3BsZURlbGV0ZVNlcnZlcklmRW1wdHkoCiAgICAgICAgaWQKICAgICAgKQogICAg
KSB7CiAgICAgIGRlbGV0ZWQgKz0KICAgICAgICAxOwogICAgfQogIH0KCiAgaWYgKAogICAgZGVsZXRlZCA+CiAgICAwCiAgKSB7CiAgICBjb25zb2xlLmxv
ZygKICAgICAgIltQZW9wbGVdICIgKwogICAgICBkZWxldGVkICsKICAgICAgIiBzZXJ2ZXVyKHMpIHZpZGUocykgbmV0dG95w6kocykuIgogICAgKTsKICB9
CgogIHJldHVybiBkZWxldGVkOwp9CgovLyA9PT0gUEVPUExFX0RFTEVURV9FTVBUWV9TRVJWRVJTX1YxX0VORCA9PT0KCmFzeW5jIGZ1bmN0aW9uIHBlb3Bs
ZUxpc3RTZXJ2ZXJzRm9yVXNlcigKICBhY2NvdW50SWQKKSB7CiAgY29uc3QgdXNlcklkID0KICAgIFN0cmluZyhhY2NvdW50SWQpOwoKICBpZiAocGVvcGxl
UG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0KICAgICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAiU0VMRUNUIHMuaWQsIHMubmFtZSwgcy5v
d25lcl9pZCwgcy5pc19vZmZpY2lhbCwgcy5pY29uX2RhdGEsIHMuY3JlYXRlZF9hdCAiICsKICAgICAgICAiRlJPTSBwZW9wbGVfc2VydmVycyBzICIgKwog
ICAgICAgICJKT0lOIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyBtIE9OIG0uc2VydmVyX2lkID0gcy5pZCAiICsKICAgICAgICAiV0hFUkUgbS51c2VyX2lkID0g
JDEgIiArCiAgICAgICAgIk9SREVSIEJZIG0uam9pbmVkX2F0IEFTQywgcy5pZCBBU0MiLAogICAgICAgIFt1c2VySWRdCiAgICAgICk7CgogICAgcmV0dXJu
IHJlc3VsdC5yb3dzLm1hcCgKICAgICAgKHJvdykgPT4gKHsKICAgICAgICBpZDoKICAgICAgICAgIFN0cmluZyhyb3cuaWQpLAogICAgICAgIG5hbWU6CiAg
ICAgICAgICByb3cubmFtZSwKICAgICAgICBvd25lcklkOgogICAgICAgICAgcm93Lm93bmVyX2lkCiAgICAgICAgICAgID8gU3RyaW5nKHJvdy5vd25lcl9p
ZCkKICAgICAgICAgICAgOiBudWxsLAogICAgICAgIG9mZmljaWFsOiBCb29sZWFuKHJvdy5pc19vZmZpY2lhbCksCiAgICAgICAgaWNvbkRhdGE6IHJvdy5p
Y29uX2RhdGEgfHwgbnVsbCwKICAgICAgICBjcmVhdGVkQXQ6CiAgICAgICAgICByb3cuY3JlYXRlZF9hdAogICAgICB9KQogICAgKTsKICB9CgogIGNvbnN0
IGRhdGEgPQogICAgcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwoKICBjb25zdCBqb2luZWRJZHMgPQogICAgbmV3IFNldCgKICAgICAgZGF0YS5tZW1iZXJz
CiAgICAgICAgLmZpbHRlcigKICAgICAgICAgIChtZW1iZXIpID0+CiAgICAgICAgICAgIFN0cmluZyhtZW1iZXIudXNlcklkKSA9PT0KICAgICAgICAgICAg
dXNlcklkCiAgICAgICAgKQogICAgICAgIC5tYXAoCiAgICAgICAgICAobWVtYmVyKSA9PgogICAgICAgICAgICBTdHJpbmcobWVtYmVyLnNlcnZlcklkKQog
ICAgICAgICkKICAgICk7CgogIHJldHVybiBkYXRhLnNlcnZlcnMKICAgIC5maWx0ZXIoCiAgICAgIChzZXJ2ZXIpID0+CiAgICAgICAgam9pbmVkSWRzLmhh
cygKICAgICAgICAgIFN0cmluZyhzZXJ2ZXIuaWQpCiAgICAgICAgKQogICAgKQogICAgLm1hcCgKICAgICAgcGVvcGxlU2VydmVyUHVibGljCiAgICApOwp9
Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVKb2luU2VydmVyKAogIGFjY291bnRJZCwKICBzZXJ2ZXJJZAopIHsKICBjb25zdCB1c2VySWQgPQogICAgU3RyaW5n
KGFjY291bnRJZCk7CgogIGNvbnN0IGlkID0KICAgIFN0cmluZyhzZXJ2ZXJJZCk7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29s
LnF1ZXJ5KAogICAgICAiSU5TRVJUIElOVE8gcGVvcGxlX3NlcnZlcl9tZW1iZXJzIChzZXJ2ZXJfaWQsIHVzZXJfaWQpICIgKwogICAgICAiVkFMVUVTICgk
MSwgJDIpIE9OIENPTkZMSUNUIERPIE5PVEhJTkciLAogICAgICBbCiAgICAgICAgaWQsCiAgICAgICAgdXNlcklkCiAgICAgIF0KICAgICk7CgogICAgcmV0
dXJuOwogIH0KCiAgY29uc3QgZGF0YSA9CiAgICBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CgogIGNvbnN0IGV4aXN0cyA9CiAgICBkYXRhLm1lbWJlcnMu
c29tZSgKICAgICAgKG1lbWJlcikgPT4KICAgICAgICBTdHJpbmcobWVtYmVyLnNlcnZlcklkKSA9PT0gaWQgJiYKICAgICAgICBTdHJpbmcobWVtYmVyLnVz
ZXJJZCkgPT09IHVzZXJJZAogICAgKTsKCiAgaWYgKCFleGlzdHMpIHsKICAgIGRhdGEubWVtYmVycy5wdXNoKHsKICAgICAgc2VydmVySWQ6CiAgICAgICAg
aWQsCiAgICAgIHVzZXJJZDoKICAgICAgICB1c2VySWQsCiAgICAgIGpvaW5lZEF0OgogICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogICAgfSk7
CgogICAgcGVvcGxlV3JpdGVMb2NhbFNlcnZlcnMoZGF0YSk7CiAgfQp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVDcmVhdGVTZXJ2ZXIoCiAgYWNjb3VudElk
LAogIHJhd05hbWUKKSB7CiAgY29uc3Qgb3duZXJJZCA9CiAgICBTdHJpbmcoYWNjb3VudElkKTsKCiAgY29uc3QgbmFtZSA9CiAgICBwZW9wbGVTZXJ2ZXJO
YW1lKHJhd05hbWUpOwoKICBpZiAoCiAgICAhcGVvcGxlVmFsaWRTZXJ2ZXJOYW1lKG5hbWUpCiAgKSB7CiAgICBjb25zdCBlcnIgPQogICAgICBuZXcgRXJy
b3IoIlNFUlZFUl9OQU1FIik7CgogICAgZXJyLmNvZGUgPQogICAgICAiU0VSVkVSX05BTUUiOwoKICAgIHRocm93IGVycjsKICB9CgogIGlmIChwZW9wbGVQ
b29sKSB7CiAgICBjb25zdCBjbGllbnQgPQogICAgICBhd2FpdCBwZW9wbGVQb29sLmNvbm5lY3QoKTsKCiAgICB0cnkgewogICAgICBhd2FpdCBjbGllbnQu
cXVlcnkoIkJFR0lOIik7CgogICAgICBjb25zdCByZXN1bHQgPQogICAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgKICAgICAgICAgICJJTlNFUlQgSU5UTyBw
ZW9wbGVfc2VydmVycyAiICsKICAgICAgICAgICIobmFtZSwgb3duZXJfaWQsIGludml0ZV9jb2RlLCBpc19vZmZpY2lhbCwgbGVnYWN5X3NlZWRlZCkgIiAr
CiAgICAgICAgICAiVkFMVUVTICgkMSwgJDIsICQzLCBGQUxTRSwgVFJVRSkgIiArCiAgICAgICAgICAiUkVUVVJOSU5HIGlkLCBuYW1lLCBvd25lcl9pZCwg
aW52aXRlX2NvZGUsIGlzX29mZmljaWFsLCBjcmVhdGVkX2F0IiwKICAgICAgICAgIFsKICAgICAgICAgICAgbmFtZSwKICAgICAgICAgICAgb3duZXJJZCwK
ICAgICAgICAgICAgcGVvcGxlTmV3SW52aXRlQ29kZSgpCiAgICAgICAgICBdCiAgICAgICAgKTsKCiAgICAgIGNvbnN0IHJvdyA9CiAgICAgICAgcmVzdWx0
LnJvd3NbMF07CgogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyAoc2VydmVyX2lk
LCB1c2VyX2lkKSAiICsKICAgICAgICAiVkFMVUVTICgkMSwgJDIpIiwKICAgICAgICBbCiAgICAgICAgICByb3cuaWQsCiAgICAgICAgICBvd25lcklkCiAg
ICAgICAgXQogICAgICApOwoKICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCJDT01NSVQiKTsKCiAgICAgIHJldHVybiB7CiAgICAgICAgaWQ6CiAgICAgICAg
ICBTdHJpbmcocm93LmlkKSwKICAgICAgICBuYW1lOgogICAgICAgICAgcm93Lm5hbWUsCiAgICAgICAgb3duZXJJZDoKICAgICAgICAgIFN0cmluZyhyb3cu
b3duZXJfaWQpLAogICAgICAgIGludml0ZUNvZGU6CiAgICAgICAgICByb3cuaW52aXRlX2NvZGUsCiAgICAgICAgb2ZmaWNpYWw6CiAgICAgICAgICBmYWxz
ZSwKICAgICAgICBjcmVhdGVkQXQ6CiAgICAgICAgICByb3cuY3JlYXRlZF9hdAogICAgICB9OwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGF3YWl0IGNs
aWVudAogICAgICAgIC5xdWVyeSgiUk9MTEJBQ0siKQogICAgICAgIC5jYXRjaCgoKSA9PiB7fSk7CgogICAgICB0aHJvdyBlcnI7CiAgICB9IGZpbmFsbHkg
ewogICAgICBjbGllbnQucmVsZWFzZSgpOwogICAgfQogIH0KCiAgY29uc3QgZGF0YSA9CiAgICBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CgogIGNvbnN0
IGlkID0KICAgIGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKTsKCiAgY29uc3Qgc2VydmVyID0gewogICAgaWQsCiAgICBuYW1lLAogICAgb3duZXJJZCwK
ICAgIGludml0ZUNvZGU6CiAgICAgIHBlb3BsZU5ld0ludml0ZUNvZGUoKSwKICAgIG9mZmljaWFsOgogICAgICBmYWxzZSwKICAgIGxlZ2FjeVNlZWRlZDoK
ICAgICAgdHJ1ZSwKICAgIGNyZWF0ZWRBdDoKICAgICAgbmV3IERhdGUoKS50b0lTT1N0cmluZygpCiAgfTsKCiAgZGF0YS5zZXJ2ZXJzLnB1c2goc2VydmVy
KTsKCiAgZGF0YS5tZW1iZXJzLnB1c2goewogICAgc2VydmVySWQ6CiAgICAgIGlkLAogICAgdXNlcklkOgogICAgICBvd25lcklkLAogICAgam9pbmVkQXQ6
CiAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogIH0pOwoKICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKTsKCiAgcmV0dXJuIHNlcnZlcjsK
fQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2VydmVyUmVwbHlQcmV2aWV3KAogIHNlcnZlcklkLAogIHJlcGx5VG9JZCwKICBkYiA9IHBlb3BsZVBvb2wsCiAg
Y2hhbm5lbElkID0gbnVsbAopIHsKICBjb25zdCBpZCA9CiAgICBwZW9wbGVSZXBseUlkKHJlcGx5VG9JZCk7CgogIGNvbnN0IHNpZCA9CiAgICBTdHJpbmco
c2VydmVySWQgfHwgIiIpOwoKICBjb25zdCBjaWQgPQogICAgY2hhbm5lbElkID8gU3RyaW5nKGNoYW5uZWxJZCkgOiAiIjsKCiAgaWYgKCFpZCB8fCAhc2lk
KSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBpZiAoCiAgICAgICEvXlxkKyQvLnRlc3QoaWQpIHx8CiAgICAgICEv
XlxkKyQvLnRlc3Qoc2lkKQogICAgKSB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAgIGNvbnN0IHJlc3VsdCA9CiAgICAgIGF3YWl0IGRiLnF1ZXJ5
KAogICAgICAgICJTRUxFQ1QgZ20uaWQsIGdtLnVzZXJuYW1lLCBnbS5ib2R5LCAiICsKICAgICAgICAiKFNFTEVDVCBpLmlkIEZST00gcGVvcGxlX21lc3Nh
Z2VfaW1hZ2VzIGkgIiArCiAgICAgICAgIldIRVJFIGkuZ2VuZXJhbF9tZXNzYWdlX2lkID0gZ20uaWQgTElNSVQgMSkgQVMgaW1hZ2VfaWQgIiArCiAgICAg
ICAgIkZST00gcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgZ20gIiArCiAgICAgICAgIldIRVJFIGdtLmlkID0gJDEgQU5EIGdtLnNlcnZlcl9pZCA9ICQyICIg
KwogICAgICAgIChjaWQgPyAiQU5EIGdtLmNoYW5uZWxfaWQgPSAkMyAiIDogIiIpICsKICAgICAgICAiTElNSVQgMSIsCiAgICAgICAgY2lkID8gW2lkLCBz
aWQsIGNpZF0gOiBbaWQsIHNpZF0KICAgICAgKTsKCiAgICBjb25zdCByb3cgPQogICAgICByZXN1bHQucm93c1swXTsKCiAgICBpZiAoIXJvdykgcmV0dXJu
IG51bGw7CgogICAgcmV0dXJuIHsKICAgICAgaWQ6CiAgICAgICAgU3RyaW5nKHJvdy5pZCksCiAgICAgIHVzZXJuYW1lOgogICAgICAgIHJvdy51c2VybmFt
ZSwKICAgICAgdGV4dDoKICAgICAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAgICAgICByb3cuYm9keQogICAgICAgICksCiAgICAgIGltYWdl
SWQ6CiAgICAgICAgcm93LmltYWdlX2lkCiAgICAgICAgICA/IFN0cmluZyhyb3cuaW1hZ2VfaWQpCiAgICAgICAgICA6IG51bGwsCiAgICAgIGRlbGV0ZWQ6
CiAgICAgICAgZmFsc2UKICAgIH07CiAgfQoKICBjb25zdCBtZXNzYWdlID0KICAgIHBlb3BsZVJlYWRMb2NhbEdlbmVyYWwoKQogICAgICAuZmluZCgKICAg
ICAgICAoaXRlbSkgPT4KICAgICAgICAgIFN0cmluZyhpdGVtLmlkKSA9PT0gaWQgJiYKICAgICAgICAgIFN0cmluZyhpdGVtLnNlcnZlcklkKSA9PT0gc2lk
ICYmCiAgICAgICAgICAoIWNpZCB8fCBTdHJpbmcoaXRlbS5jaGFubmVsSWQgfHwgIiIpID09PSBjaWQpCiAgICAgICk7CgogIGlmICghbWVzc2FnZSkgewog
ICAgcmV0dXJuIG51bGw7CiAgfQoKICByZXR1cm4gewogICAgaWQ6CiAgICAgIFN0cmluZyhtZXNzYWdlLmlkKSwKICAgIHVzZXJuYW1lOgogICAgICBTdHJp
bmcobWVzc2FnZS51c2VybmFtZSB8fCAiIiksCiAgICB0ZXh0OgogICAgICBTdHJpbmcobWVzc2FnZS50ZXh0IHx8ICIiKSwKICAgIGltYWdlSWQ6CiAgICAg
IG1lc3NhZ2UuaW1hZ2VJZAogICAgICAgID8gU3RyaW5nKG1lc3NhZ2UuaW1hZ2VJZCkKICAgICAgICA6IG51bGwsCiAgICBkZWxldGVkOgogICAgICBmYWxz
ZQogIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlclNhdmVNZXNzYWdlKAogIHNlcnZlcklkLAogIGNoYW5uZWxJZCwKICBzZW5kZXJJZCwKICB1
c2VybmFtZSwKICB0ZXh0LAogIGltYWdlSWQgPSBudWxsLAogIHJlcGx5VG9JZCA9IG51bGwKKSB7CiAgY29uc3Qgc2lkID0KICAgIFN0cmluZyhzZXJ2ZXJJ
ZCk7CgogIGNvbnN0IGNpZCA9CiAgICBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKCiAgY29uc3QgY2xlYW5Vc2VybmFtZSA9CiAgICBwZW9wbGVVc2VybmFt
ZSh1c2VybmFtZSkKICAgICAgLnNsaWNlKDAsIDI0KTsKCiAgY29uc3QgY2xlYW5UZXh0ID0KICAgIFN0cmluZyh0ZXh0IHx8ICIiKQogICAgICAudHJpbSgp
CiAgICAgIC5zbGljZSgwLCAxMDAwKTsKCiAgY29uc3QgaW1hZ2VLZXkgPQogICAgcGVvcGxlTm9ybWFsaXplTWVzc2FnZUltYWdlSWQoCiAgICAgIGltYWdl
SWQKICAgICk7CgogIGNvbnN0IHJlcGx5S2V5ID0KICAgIHBlb3BsZVJlcGx5SWQoCiAgICAgIHJlcGx5VG9JZAogICAgKTsKCiAgaWYgKAogICAgIXNpZCB8
fAogICAgIWNpZCB8fAogICAgIWNsZWFuVXNlcm5hbWUgfHwKICAgICgKICAgICAgIWNsZWFuVGV4dCAmJgogICAgICAhaW1hZ2VLZXkKICAgICkKICApIHsK
ICAgIHJldHVybiBudWxsOwogIH0KCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IGNsaWVudCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wuY29ubmVj
dCgpOwoKICAgIHRyeSB7CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiQkVHSU4iKTsKCiAgICAgIGNvbnN0IHJlcGx5ID0KICAgICAgICByZXBseUtleQog
ICAgICAgICAgPyBhd2FpdCBwZW9wbGVTZXJ2ZXJSZXBseVByZXZpZXcoCiAgICAgICAgICAgICAgc2lkLAogICAgICAgICAgICAgIHJlcGx5S2V5LAogICAg
ICAgICAgICAgIGNsaWVudCwKICAgICAgICAgICAgICBjaWQKICAgICAgICAgICAgKQogICAgICAgICAgOiBudWxsOwoKICAgICAgaWYgKAogICAgICAgIHJl
cGx5S2V5ICYmCiAgICAgICAgIXJlcGx5CiAgICAgICkgewogICAgICAgIGNvbnN0IGVyciA9CiAgICAgICAgICBuZXcgRXJyb3IoIlJFUExZX0lOVkFMSUQi
KTsKCiAgICAgICAgZXJyLmNvZGUgPQogICAgICAgICAgIlJFUExZX0lOVkFMSUQiOwoKICAgICAgICB0aHJvdyBlcnI7CiAgICAgIH0KCiAgICAgIGNvbnN0
IHJlc3VsdCA9CiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzICIgKwog
ICAgICAgICAgIihzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIHNlbmRlcl9pZCwgdXNlcm5hbWUsIGJvZHksIHJlcGx5X3RvX2lkKSAiICsKICAgICAgICAgICJW
QUxVRVMgKCQxLCAkMiwgJDMsICQ0LCAkNSwgJDYpICIgKwogICAgICAgICAgIlJFVFVSTklORyBpZCwgdXNlcm5hbWUsIGJvZHksIHJlcGx5X3RvX2lkLCBj
cmVhdGVkX2F0IiwKICAgICAgICAgIFsKICAgICAgICAgICAgc2lkLAogICAgICAgICAgICBjaWQsCiAgICAgICAgICAgIFN0cmluZyhzZW5kZXJJZCksCiAg
ICAgICAgICAgIGNsZWFuVXNlcm5hbWUsCiAgICAgICAgICAgIHBlb3BsZUVuY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgICAgICBjbGVhblRleHQKICAg
ICAgICAgICAgKSwKICAgICAgICAgICAgcmVwbHlLZXkgfHwgbnVsbAogICAgICAgICAgXQogICAgICAgICk7CgogICAgICBjb25zdCByb3cgPQogICAgICAg
IHJlc3VsdC5yb3dzWzBdOwoKICAgICAgbGV0IGJvdW5kSW1hZ2VJZCA9CiAgICAgICAgbnVsbDsKCiAgICAgIGlmIChpbWFnZUtleSkgewogICAgICAgIGJv
dW5kSW1hZ2VJZCA9CiAgICAgICAgICBhd2FpdCBwZW9wbGVCaW5kR2VuZXJhbE1lc3NhZ2VJbWFnZSgKICAgICAgICAgICAgc2VuZGVySWQsCiAgICAgICAg
ICAgIGltYWdlS2V5LAogICAgICAgICAgICByb3cuaWQsCiAgICAgICAgICAgIGNsaWVudAogICAgICAgICAgKTsKCiAgICAgICAgaWYgKCFib3VuZEltYWdl
SWQpIHsKICAgICAgICAgIGNvbnN0IGVyciA9CiAgICAgICAgICAgIG5ldyBFcnJvcigiSU1BR0VfSU5WQUxJRCIpOwoKICAgICAgICAgIGVyci5jb2RlID0K
ICAgICAgICAgICAgIklNQUdFX0lOVkFMSUQiOwoKICAgICAgICAgIHRocm93IGVycjsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIGF3YWl0IGNsaWVudC5x
dWVyeSgiQ09NTUlUIik7CgogICAgICByZXR1cm4gewogICAgICAgIGlkOgogICAgICAgICAgU3RyaW5nKHJvdy5pZCksCiAgICAgICAgc2VydmVySWQ6CiAg
ICAgICAgICBzaWQsCiAgICAgICAgY2hhbm5lbElkOgogICAgICAgICAgY2lkLAogICAgICAgIHVzZXJuYW1lOgogICAgICAgICAgcm93LnVzZXJuYW1lLAog
ICAgICAgIHRleHQ6CiAgICAgICAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAgICAgICAgIHJvdy5ib2R5CiAgICAgICAgICApLAogICAgICAg
IGltYWdlSWQ6CiAgICAgICAgICBib3VuZEltYWdlSWQsCiAgICAgICAgcmVwbHlUbzoKICAgICAgICAgIHJlcGx5LAogICAgICAgIHRpbWU6CiAgICAgICAg
ICBuZXcgRGF0ZSgKICAgICAgICAgICAgcm93LmNyZWF0ZWRfYXQKICAgICAgICAgICkuZ2V0VGltZSgpCiAgICAgIH07CiAgICB9IGNhdGNoIChlcnIpIHsK
ICAgICAgYXdhaXQgY2xpZW50CiAgICAgICAgLnF1ZXJ5KCJST0xMQkFDSyIpCiAgICAgICAgLmNhdGNoKCgpID0+IHt9KTsKCiAgICAgIHRocm93IGVycjsK
ICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfQoKICBjb25zdCBtZXNzYWdlcyA9CiAgICBwZW9wbGVSZWFkTG9jYWxH
ZW5lcmFsKCk7CgogIGNvbnN0IHJlcGx5ID0KICAgIHJlcGx5S2V5CiAgICAgID8gYXdhaXQgcGVvcGxlU2VydmVyUmVwbHlQcmV2aWV3KAogICAgICAgICAg
c2lkLAogICAgICAgICAgcmVwbHlLZXksCiAgICAgICAgICBwZW9wbGVQb29sLAogICAgICAgICAgY2lkCiAgICAgICAgKQogICAgICA6IG51bGw7CgogIGlm
ICgKICAgIHJlcGx5S2V5ICYmCiAgICAhcmVwbHkKICApIHsKICAgIGNvbnN0IGVyciA9CiAgICAgIG5ldyBFcnJvcigiUkVQTFlfSU5WQUxJRCIpOwoKICAg
IGVyci5jb2RlID0KICAgICAgIlJFUExZX0lOVkFMSUQiOwoKICAgIHRocm93IGVycjsKICB9CgogIGNvbnN0IG1lc3NhZ2UgPSB7CiAgICBpZDoKICAgICAg
Y3J5cHRvQWNjb3VudHMucmFuZG9tVVVJRCgpLAogICAgc2VydmVySWQ6CiAgICAgIHNpZCwKICAgIGNoYW5uZWxJZDoKICAgICAgY2lkLAogICAgc2VuZGVy
SWQ6CiAgICAgIFN0cmluZyhzZW5kZXJJZCksCiAgICB1c2VybmFtZToKICAgICAgY2xlYW5Vc2VybmFtZSwKICAgIHRleHQ6CiAgICAgIGNsZWFuVGV4dCwK
ICAgIGltYWdlSWQ6CiAgICAgIG51bGwsCiAgICByZXBseVRvSWQ6CiAgICAgIHJlcGx5S2V5IHx8IG51bGwsCiAgICB0aW1lOgogICAgICBEYXRlLm5vdygp
CiAgfTsKCiAgaWYgKGltYWdlS2V5KSB7CiAgICBjb25zdCBib3VuZCA9CiAgICAgIGF3YWl0IHBlb3BsZUJpbmRHZW5lcmFsTWVzc2FnZUltYWdlKAogICAg
ICAgIHNlbmRlcklkLAogICAgICAgIGltYWdlS2V5LAogICAgICAgIG1lc3NhZ2UuaWQKICAgICAgKTsKCiAgICBpZiAoIWJvdW5kKSB7CiAgICAgIGNvbnN0
IGVyciA9CiAgICAgICAgbmV3IEVycm9yKCJJTUFHRV9JTlZBTElEIik7CgogICAgICBlcnIuY29kZSA9CiAgICAgICAgIklNQUdFX0lOVkFMSUQiOwoKICAg
ICAgdGhyb3cgZXJyOwogICAgfQoKICAgIG1lc3NhZ2UuaW1hZ2VJZCA9CiAgICAgIGJvdW5kOwogIH0KCiAgbWVzc2FnZXMucHVzaChtZXNzYWdlKTsKCiAg
cGVvcGxlV3JpdGVMb2NhbEdlbmVyYWwobWVzc2FnZXMpOwoKICByZXR1cm4gewogICAgLi4ubWVzc2FnZSwKICAgIHJlcGx5VG86CiAgICAgIHJlcGx5CiAg
fTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2VydmVyTG9hZE1lc3NhZ2VzKAogIHNlcnZlcklkLAogIGNoYW5uZWxJZCwKICBsaW1pdCA9IDEwMAopIHsK
ICBjb25zdCBzaWQgPQogICAgU3RyaW5nKHNlcnZlcklkKTsKCiAgY29uc3QgY2lkID0KICAgIFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwoKICBjb25zdCBz
YWZlTGltaXQgPQogICAgTWF0aC5tYXgoCiAgICAgIDEsCiAgICAgIE1hdGgubWluKAogICAgICAgIDIwMCwKICAgICAgICBOdW1iZXIobGltaXQpIHx8IDEw
MAogICAgICApCiAgICApOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgYXdhaXQgcGVvcGxlRW5zdXJlUmVwbHlDb2x1bW5zKCk7CgogICAgY29uc3QgcmVz
dWx0ID0KICAgICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAiU0VMRUNUICIgKwogICAgICAgICJnbS5pZCwgZ20udXNlcm5hbWUsIGdtLmJv
ZHksIGdtLnJlcGx5X3RvX2lkLCBnbS5pc19zeXN0ZW0sIGdtLmNyZWF0ZWRfYXQsIGdtLmVkaXRlZF9hdCwgIiArCiAgICAgICAgIihTRUxFQ1QgaS5pZCBG
Uk9NIHBlb3BsZV9tZXNzYWdlX2ltYWdlcyBpICIgKwogICAgICAgICJXSEVSRSBpLmdlbmVyYWxfbWVzc2FnZV9pZCA9IGdtLmlkIExJTUlUIDEpIEFTIGlt
YWdlX2lkLCAiICsKICAgICAgICAicmdtLnVzZXJuYW1lIEFTIHJlcGx5X3VzZXJuYW1lLCAiICsKICAgICAgICAicmdtLmJvZHkgQVMgcmVwbHlfYm9keSwg
IiArCiAgICAgICAgIihTRUxFQ1QgcmkuaWQgRlJPTSBwZW9wbGVfbWVzc2FnZV9pbWFnZXMgcmkgIiArCiAgICAgICAgIldIRVJFIHJpLmdlbmVyYWxfbWVz
c2FnZV9pZCA9IHJnbS5pZCBMSU1JVCAxKSBBUyByZXBseV9pbWFnZV9pZCAiICsKICAgICAgICAiRlJPTSBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyBnbSAi
ICsKICAgICAgICAiTEVGVCBKT0lOIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzIHJnbSAiICsKICAgICAgICAiT04gcmdtLmlkID0gZ20ucmVwbHlfdG9faWQg
QU5EIHJnbS5zZXJ2ZXJfaWQgPSBnbS5zZXJ2ZXJfaWQgQU5EIHJnbS5jaGFubmVsX2lkID0gZ20uY2hhbm5lbF9pZCAiICsKICAgICAgICAiV0hFUkUgZ20u
c2VydmVyX2lkID0gJDEgQU5EIGdtLmNoYW5uZWxfaWQgPSAkMiAiICsKICAgICAgICAiT1JERVIgQlkgZ20uY3JlYXRlZF9hdCBERVNDIExJTUlUICQzIiwK
ICAgICAgICBbCiAgICAgICAgICBzaWQsCiAgICAgICAgICBjaWQsCiAgICAgICAgICBzYWZlTGltaXQKICAgICAgICBdCiAgICAgICk7CgogICAgcmV0dXJu
IHJlc3VsdC5yb3dzCiAgICAgIC5yZXZlcnNlKCkKICAgICAgLm1hcCgKICAgICAgICAocm93KSA9PiAoewogICAgICAgICAgaWQ6CiAgICAgICAgICAgIFN0
cmluZyhyb3cuaWQpLAogICAgICAgICAgc2VydmVySWQ6CiAgICAgICAgICAgIHNpZCwKICAgICAgICAgIGNoYW5uZWxJZDoKICAgICAgICAgICAgY2lkLAog
ICAgICAgICAgc3lzdGVtOgogICAgICAgICAgICBCb29sZWFuKHJvdy5pc19zeXN0ZW0pLAogICAgICAgICAgdXNlcm5hbWU6CiAgICAgICAgICAgIHJvdy51
c2VybmFtZSwKICAgICAgICAgIHRleHQ6CiAgICAgICAgICAgIHBlb3BsZURlY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgICAgICByb3cuYm9keQogICAg
ICAgICAgICApLAogICAgICAgICAgaW1hZ2VJZDoKICAgICAgICAgICAgcm93LmltYWdlX2lkCiAgICAgICAgICAgICAgPyBTdHJpbmcocm93LmltYWdlX2lk
KQogICAgICAgICAgICAgIDogbnVsbCwKICAgICAgICAgIHJlcGx5VG86CiAgICAgICAgICAgIHJvdy5yZXBseV90b19pZAogICAgICAgICAgICAgID8gKAog
ICAgICAgICAgICAgICAgICByb3cucmVwbHlfdXNlcm5hbWUKICAgICAgICAgICAgICAgICAgICA/IHsKICAgICAgICAgICAgICAgICAgICAgICAgaWQ6CiAg
ICAgICAgICAgICAgICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAgICAgICAgICAgICAgICAgcm93LnJlcGx5X3RvX2lkCiAgICAgICAgICAgICAg
ICAgICAgICAgICAgKSwKICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6CiAgICAgICAgICAgICAgICAgICAgICAgICAgcm93LnJlcGx5X3VzZXJu
YW1lLAogICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OgogICAgICAgICAgICAgICAgICAgICAgICAgIHBlb3BsZURlY3J5cHRNZXNzYWdlVGV4dCgKICAg
ICAgICAgICAgICAgICAgICAgICAgICAgIHJvdy5yZXBseV9ib2R5IHx8ICIiCiAgICAgICAgICAgICAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgICAg
ICAgICAgICAgaW1hZ2VJZDoKICAgICAgICAgICAgICAgICAgICAgICAgICByb3cucmVwbHlfaW1hZ2VfaWQKICAgICAgICAgICAgICAgICAgICAgICAgICAg
ID8gU3RyaW5nKAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJvdy5yZXBseV9pbWFnZV9pZAogICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICApCiAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IG51bGwsCiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZWQ6CiAgICAgICAgICAgICAgICAg
ICAgICAgICAgZmFsc2UKICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICA6IHBlb3BsZURlbGV0ZWRSZXBseSgKICAgICAgICAg
ICAgICAgICAgICAgICAgcm93LnJlcGx5X3RvX2lkCiAgICAgICAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgOiBu
dWxsLAogICAgICAgICAgdGltZToKICAgICAgICAgICAgbmV3IERhdGUoCiAgICAgICAgICAgICAgcm93LmNyZWF0ZWRfYXQKICAgICAgICAgICAgKS5nZXRU
aW1lKCksCiAgICAgICAgICBlZGl0ZWRBdDoKICAgICAgICAgICAgcm93LmVkaXRlZF9hdCB8fCBudWxsCiAgICAgICAgfSkKICAgICAgKTsKICB9CgogIGNv
bnN0IGFsbCA9CiAgICBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCkKICAgICAgLmZpbHRlcigKICAgICAgICAobWVzc2FnZSkgPT4KICAgICAgICAgIFN0cmlu
ZyhtZXNzYWdlLnNlcnZlcklkKSA9PT0KICAgICAgICAgIHNpZCAmJgogICAgICAgICAgU3RyaW5nKG1lc3NhZ2UuY2hhbm5lbElkIHx8ICIiKSA9PT0KICAg
ICAgICAgIGNpZAogICAgICApOwoKICBjb25zdCBieUlkID0KICAgIG5ldyBNYXAoCiAgICAgIGFsbC5tYXAoCiAgICAgICAgKG1lc3NhZ2UpID0+IFsKICAg
ICAgICAgIFN0cmluZyhtZXNzYWdlLmlkKSwKICAgICAgICAgIG1lc3NhZ2UKICAgICAgICBdCiAgICAgICkKICAgICk7CgogIHJldHVybiBhbGwKICAgIC5z
bGljZSgtc2FmZUxpbWl0KQogICAgLm1hcCgKICAgICAgKG1lc3NhZ2UpID0+IHsKICAgICAgICBjb25zdCByZXBseUlkID0KICAgICAgICAgIHBlb3BsZVJl
cGx5SWQoCiAgICAgICAgICAgIG1lc3NhZ2UucmVwbHlUb0lkCiAgICAgICAgICApOwoKICAgICAgICBjb25zdCB0YXJnZXQgPQogICAgICAgICAgcmVwbHlJ
ZAogICAgICAgICAgICA/IGJ5SWQuZ2V0KHJlcGx5SWQpCiAgICAgICAgICAgIDogbnVsbDsKCiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgIGlkOgogICAg
ICAgICAgICBTdHJpbmcobWVzc2FnZS5pZCB8fCAiIiksCiAgICAgICAgICBzZXJ2ZXJJZDoKICAgICAgICAgICAgc2lkLAogICAgICAgICAgY2hhbm5lbElk
OgogICAgICAgICAgICBjaWQsCiAgICAgICAgICBzeXN0ZW06CiAgICAgICAgICAgIEJvb2xlYW4oCiAgICAgICAgICAgICAgbWVzc2FnZS5zeXN0ZW0gfHwK
ICAgICAgICAgICAgICBtZXNzYWdlLmlzU3lzdGVtCiAgICAgICAgICAgICksCiAgICAgICAgICB1c2VybmFtZToKICAgICAgICAgICAgU3RyaW5nKAogICAg
ICAgICAgICAgIG1lc3NhZ2UudXNlcm5hbWUgfHwgIiIKICAgICAgICAgICAgKSwKICAgICAgICAgIHRleHQ6CiAgICAgICAgICAgIFN0cmluZygKICAgICAg
ICAgICAgICBtZXNzYWdlLnRleHQgfHwgIiIKICAgICAgICAgICAgKSwKICAgICAgICAgIGltYWdlSWQ6CiAgICAgICAgICAgIG1lc3NhZ2UuaW1hZ2VJZAog
ICAgICAgICAgICAgID8gU3RyaW5nKG1lc3NhZ2UuaW1hZ2VJZCkKICAgICAgICAgICAgICA6IG51bGwsCiAgICAgICAgICByZXBseVRvOgogICAgICAgICAg
ICByZXBseUlkCiAgICAgICAgICAgICAgPyAoCiAgICAgICAgICAgICAgICAgIHRhcmdldAogICAgICAgICAgICAgICAgICAgID8gewogICAgICAgICAgICAg
ICAgICAgICAgICBpZDoKICAgICAgICAgICAgICAgICAgICAgICAgICBTdHJpbmcodGFyZ2V0LmlkKSwKICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5h
bWU6CiAgICAgICAgICAgICAgICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LnVzZXJuYW1lIHx8ICIiCiAg
ICAgICAgICAgICAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDoKICAgICAgICAgICAgICAgICAgICAgICAgICBTdHJpbmco
CiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQudGV4dCB8fCAiIgogICAgICAgICAgICAgICAgICAgICAgICAgICksCiAgICAgICAgICAgICAg
ICAgICAgICAgIGltYWdlSWQ6CiAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0LmltYWdlSWQKICAgICAgICAgICAgICAgICAgICAgICAgICAgID8g
U3RyaW5nKAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldC5pbWFnZUlkCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkKICAg
ICAgICAgICAgICAgICAgICAgICAgICAgIDogbnVsbCwKICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlZDoKICAgICAgICAgICAgICAgICAgICAgICAg
ICBmYWxzZQogICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIDogcGVvcGxlRGVsZXRlZFJlcGx5KAogICAgICAgICAgICAgICAg
ICAgICAgICByZXBseUlkCiAgICAgICAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgOiBudWxsLAogICAgICAgICAg
dGltZToKICAgICAgICAgICAgTnVtYmVyKAogICAgICAgICAgICAgIG1lc3NhZ2UudGltZSB8fAogICAgICAgICAgICAgIERhdGUubm93KCkKICAgICAgICAg
ICAgKSwKICAgICAgICAgIGVkaXRlZEF0OgogICAgICAgICAgICBtZXNzYWdlLmVkaXRlZEF0IHx8CiAgICAgICAgICAgIG1lc3NhZ2UuZWRpdGVkX2F0IHx8
CiAgICAgICAgICAgIG51bGwKICAgICAgICB9OwogICAgICB9CiAgICApOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJEZWxldGVNZXNzYWdlKAog
IGFjY291bnRJZCwKICBzZXJ2ZXJJZCwKICBjaGFubmVsSWQsCiAgbWVzc2FnZUlkCikgewogIGNvbnN0IGFjdG9yID0gU3RyaW5nKGFjY291bnRJZCB8fCAi
Iik7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICBjb25zdCBp
ZCA9IHBlb3BsZVJlcGx5SWQobWVzc2FnZUlkKTsKCiAgaWYgKCFhY3RvciB8fCAhc2lkIHx8ICFjaWQgfHwgIWlkKSByZXR1cm4gZmFsc2U7CgogIGlmIChw
ZW9wbGVQb29sKSB7CiAgICBpZiAoIS9eXGQrJC8udGVzdChpZCkgfHwgIS9eXGQrJC8udGVzdChzaWQpKSByZXR1cm4gZmFsc2U7CiAgICBjb25zdCBmb3Vu
ZCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1Qgc2VuZGVyX2lkIEZST00gcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgIiArCiAgICAg
ICJXSEVSRSBpZCA9ICQxIEFORCBzZXJ2ZXJfaWQgPSAkMiBBTkQgY2hhbm5lbF9pZCA9ICQzIExJTUlUIDEiLAogICAgICBbaWQsIHNpZCwgY2lkXQogICAg
KTsKICAgIGNvbnN0IHJvdyA9IGZvdW5kLnJvd3NbMF07CiAgICBpZiAoIXJvdykgcmV0dXJuIGZhbHNlOwogICAgY29uc3Qgb3duID0gU3RyaW5nKHJvdy5z
ZW5kZXJfaWQpID09PSBhY3RvcjsKICAgIGNvbnN0IG1vZGVyYXRvciA9IG93biA/IGZhbHNlIDogYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbihh
Y3Rvciwgc2lkLCAiTUFOQUdFX01FU1NBR0VTIiwgY2lkKTsKICAgIGlmICghb3duICYmICFtb2RlcmF0b3IpIHJldHVybiBmYWxzZTsKICAgIGNvbnN0IHJl
c3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJERUxFVEUgRlJPTSBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyBXSEVSRSBpZCA9ICQxIEFO
RCBzZXJ2ZXJfaWQgPSAkMiBBTkQgY2hhbm5lbF9pZCA9ICQzIFJFVFVSTklORyBpZCIsCiAgICAgIFtpZCwgc2lkLCBjaWRdCiAgICApOwogICAgcmV0dXJu
IEJvb2xlYW4ocmVzdWx0LnJvd3NbMF0pOwogIH0KCiAgY29uc3QgbWVzc2FnZXMgPSBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7CiAgY29uc3QgaW5kZXgg
PSBtZXNzYWdlcy5maW5kSW5kZXgoKGl0ZW0pID0+CiAgICBTdHJpbmcoaXRlbS5pZCkgPT09IGlkICYmCiAgICBTdHJpbmcoaXRlbS5zZXJ2ZXJJZCkgPT09
IHNpZCAmJgogICAgU3RyaW5nKGl0ZW0uY2hhbm5lbElkIHx8ICIiKSA9PT0gY2lkCiAgKTsKICBpZiAoaW5kZXggPCAwKSByZXR1cm4gZmFsc2U7CgogIGNv
bnN0IG93biA9IFN0cmluZyhtZXNzYWdlc1tpbmRleF0uc2VuZGVySWQgfHwgIiIpID09PSBhY3RvcjsKICBjb25zdCBtb2RlcmF0b3IgPSBvd24gPyBmYWxz
ZSA6IGF3YWl0IHBlb3BsZUNhblNlcnZlclBlcm1pc3Npb24oYWN0b3IsIHNpZCwgIk1BTkFHRV9NRVNTQUdFUyIsIGNpZCk7CiAgaWYgKCFvd24gJiYgIW1v
ZGVyYXRvcikgcmV0dXJuIGZhbHNlOwoKICBtZXNzYWdlcy5zcGxpY2UoaW5kZXgsIDEpOwogIHBlb3BsZVdyaXRlTG9jYWxHZW5lcmFsKG1lc3NhZ2VzKTsK
ICBwZW9wbGVEZWxldGVMb2NhbEJvdW5kTWVzc2FnZUltYWdlKCJnZW5lcmFsIiwgaWQpOwogIHJldHVybiB0cnVlOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9w
bGVJbml0U2VydmVyc1YxKCkgewogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiQ1JFQVRFIFRBQkxFIElG
IE5PVCBFWElTVFMgcGVvcGxlX3NlcnZlcnMgKCIgKwogICAgICAiaWQgQklHU0VSSUFMIFBSSU1BUlkgS0VZLCAiICsKICAgICAgIm5hbWUgVkFSQ0hBUig0
MCkgTk9UIE5VTEwsICIgKwogICAgICAib3duZXJfaWQgQklHSU5UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfYWNjb3VudHMoaWQpIE9OIERFTEVURSBTRVQg
TlVMTCwgIiArCiAgICAgICJpbnZpdGVfY29kZSBWQVJDSEFSKDgwKSBVTklRVUUgTk9UIE5VTEwsICIgKwogICAgICAiaXNfb2ZmaWNpYWwgQk9PTEVBTiBO
T1QgTlVMTCBERUZBVUxUIEZBTFNFLCAiICsKICAgICAgImxlZ2FjeV9zZWVkZWQgQk9PTEVBTiBOT1QgTlVMTCBERUZBVUxUIEZBTFNFLCAiICsKICAgICAg
ImNyZWF0ZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSIgKwogICAgICAiKSIKICAgICk7CgogICAgYXdhaXQgcGVvcGxlUG9vbC5x
dWVyeSgKICAgICAgIkFMVEVSIFRBQkxFIHBlb3BsZV9zZXJ2ZXJzICIgKwogICAgICAiQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTIGxlZ2FjeV9zZWVkZWQg
Qk9PTEVBTiBOT1QgTlVMTCBERUZBVUxUIEZBTFNFIgogICAgKTsKCiAgICAvLyA9PT0gUEVPUExFX1NFUlZFUl9JQ09OX1YxX0RCX0NPTFVNTiA9PT0KICAg
IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJBTFRFUiBUQUJMRSBwZW9wbGVfc2VydmVycyBBREQgQ09MVU1OIElGIE5PVCBFWElTVFMgaWNvbl9k
YXRhIFRFWFQgTlVMTCIKICAgICk7CgogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkNSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTIHBlb3Bs
ZV9zZXJ2ZXJfbWVtYmVycyAoIiArCiAgICAgICJzZXJ2ZXJfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX3NlcnZlcnMoaWQpIE9OIERF
TEVURSBDQVNDQURFLCAiICsKICAgICAgInVzZXJfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBPTiBERUxFVEUg
Q0FTQ0FERSwgIiArCiAgICAgICJqb2luZWRfYXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSwgIiArCiAgICAgICJQUklNQVJZIEtFWShz
ZXJ2ZXJfaWQsIHVzZXJfaWQpIiArCiAgICAgICIpIgogICAgKTsKCiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiQ1JFQVRFIElOREVYIElG
IE5PVCBFWElTVFMgcGVvcGxlX3NlcnZlcl9tZW1iZXJzX3VzZXJfaWR4ICIgKwogICAgICAiT04gcGVvcGxlX3NlcnZlcl9tZW1iZXJzKHVzZXJfaWQsIGpv
aW5lZF9hdCkiCiAgICApOwoKICAgIGxldCBvZmZpY2lhbFJlc3VsdCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIlNFTEVDVCBp
ZCwgbmFtZSwgb3duZXJfaWQsIGludml0ZV9jb2RlLCBpc19vZmZpY2lhbCwgbGVnYWN5X3NlZWRlZCwgY3JlYXRlZF9hdCAiICsKICAgICAgICAiRlJPTSBw
ZW9wbGVfc2VydmVycyBXSEVSRSBpc19vZmZpY2lhbCA9IFRSVUUgTElNSVQgMSIKICAgICAgKTsKCiAgICBsZXQgb2ZmaWNpYWwgPQogICAgICBvZmZpY2lh
bFJlc3VsdC5yb3dzWzBdOwoKICAgIGlmICghb2ZmaWNpYWwpIHsKICAgICAgY29uc3QgZm91bmRlclJlc3VsdCA9CiAgICAgICAgYXdhaXQgcGVvcGxlUG9v
bC5xdWVyeSgKICAgICAgICAgICJTRUxFQ1QgaWQgRlJPTSBwZW9wbGVfYWNjb3VudHMgIiArCiAgICAgICAgICAiT1JERVIgQlkgY3JlYXRlZF9hdCBBU0Ms
IGlkIEFTQyBMSU1JVCAxIgogICAgICAgICk7CgogICAgICBjb25zdCBmb3VuZGVySWQgPQogICAgICAgIGZvdW5kZXJSZXN1bHQucm93c1swXT8uaWQgfHwg
bnVsbDsKCiAgICAgIGNvbnN0IGluc2VydGVkID0KICAgICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICAgIklOU0VSVCBJTlRPIHBlb3Bs
ZV9zZXJ2ZXJzICIgKwogICAgICAgICAgIihuYW1lLCBvd25lcl9pZCwgaW52aXRlX2NvZGUsIGlzX29mZmljaWFsLCBsZWdhY3lfc2VlZGVkKSAiICsKICAg
ICAgICAgICJWQUxVRVMgKCdQZW9wbGUnLCAkMSwgJDIsIFRSVUUsIEZBTFNFKSAiICsKICAgICAgICAgICJSRVRVUk5JTkcgaWQsIG5hbWUsIG93bmVyX2lk
LCBpbnZpdGVfY29kZSwgaXNfb2ZmaWNpYWwsIGxlZ2FjeV9zZWVkZWQsIGNyZWF0ZWRfYXQiLAogICAgICAgICAgWwogICAgICAgICAgICBmb3VuZGVySWQs
CiAgICAgICAgICAgIHBlb3BsZU5ld0ludml0ZUNvZGUoKQogICAgICAgICAgXQogICAgICAgICk7CgogICAgICBvZmZpY2lhbCA9CiAgICAgICAgaW5zZXJ0
ZWQucm93c1swXTsKICAgIH0KCiAgICAvKgogICAgICBNaWdyYXRpb24gOiBzZXVsIGxlIGNvbXB0ZSBmb25kYXRldXIgZ2FyZGUgdW4gYWNjw6hzIGRpcmVj
dC4KICAgICAgQXVjdW4gYXV0cmUgY29tcHRlIGV4aXN0YW50IG91IGZ1dHVyIG4nZXN0IGFqb3V0w6kgYXV0b21hdGlxdWVtZW50LgogICAgKi8KICAgIGlm
ICghb2ZmaWNpYWwubGVnYWN5X3NlZWRlZCkgewogICAgICBpZiAob2ZmaWNpYWwub3duZXJfaWQpIHsKICAgICAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5
KAogICAgICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyAoc2VydmVyX2lkLCB1c2VyX2lkKSAiICsKICAgICAgICAgICJWQUxVRVMg
KCQxLCAkMikgT04gQ09ORkxJQ1QgRE8gTk9USElORyIsCiAgICAgICAgICBbCiAgICAgICAgICAgIG9mZmljaWFsLmlkLAogICAgICAgICAgICBvZmZpY2lh
bC5vd25lcl9pZAogICAgICAgICAgXQogICAgICAgICk7CiAgICAgIH0KCiAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICAgIlVQREFURSBw
ZW9wbGVfc2VydmVycyBTRVQgbGVnYWN5X3NlZWRlZCA9IFRSVUUgV0hFUkUgaWQgPSAkMSIsCiAgICAgICAgW29mZmljaWFsLmlkXQogICAgICApOwogICAg
fQoKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJBTFRFUiBUQUJMRSBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyAiICsKICAgICAgIkFERCBD
T0xVTU4gSUYgTk9UIEVYSVNUUyBzZXJ2ZXJfaWQgQklHSU5UIE5VTEwgIiArCiAgICAgICJSRUZFUkVOQ0VTIHBlb3BsZV9zZXJ2ZXJzKGlkKSBPTiBERUxF
VEUgQ0FTQ0FERSIKICAgICk7CgogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkFMVEVSIFRBQkxFIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2Vz
ICIgKwogICAgICAiQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTIGlzX3N5c3RlbSBCT09MRUFOIE5PVCBOVUxMIERFRkFVTFQgRkFMU0UiCiAgICApOwoKICAg
IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJVUERBVEUgcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgIiArCiAgICAgICJTRVQgc2VydmVyX2lkID0g
JDEgV0hFUkUgc2VydmVyX2lkIElTIE5VTEwiLAogICAgICBbb2ZmaWNpYWwuaWRdCiAgICApOwoKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAg
ICJDUkVBVEUgSU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlc19zZXJ2ZXJfY3JlYXRlZF9pZHggIiArCiAgICAgICJPTiBwZW9w
bGVfZ2VuZXJhbF9tZXNzYWdlcyhzZXJ2ZXJfaWQsIGNyZWF0ZWRfYXQgREVTQykiCiAgICApOwoKICAgIGNvbnNvbGUubG9nKAogICAgICAiW1Blb3BsZV0g
U2VydmV1ciBvZmZpY2llbCBwcsOqdC4gSW52aXRhdGlvbjogL2ludml0ZS8iICsKICAgICAgb2ZmaWNpYWwuaW52aXRlX2NvZGUKICAgICk7CgogICAgcmV0
dXJuOwogIH0KCiAgY29uc3QgZGF0YSA9CiAgICBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CgogIGxldCBvZmZpY2lhbCA9CiAgICBkYXRhLnNlcnZlcnMu
ZmluZCgKICAgICAgKHNlcnZlcikgPT4KICAgICAgICBCb29sZWFuKHNlcnZlci5vZmZpY2lhbCkKICAgICk7CgogIGlmICghb2ZmaWNpYWwpIHsKICAgIGNv
bnN0IGFjY291bnRzID0KICAgICAgcGVvcGxlUmVhZExvY2FsQWNjb3VudHMoKQogICAgICAgIC5zbGljZSgpCiAgICAgICAgLnNvcnQoCiAgICAgICAgICAo
YSwgYikgPT4KICAgICAgICAgICAgbmV3IERhdGUoCiAgICAgICAgICAgICAgYS5jcmVhdGVkX2F0IHx8CiAgICAgICAgICAgICAgYS5jcmVhdGVkQXQgfHwK
ICAgICAgICAgICAgICAwCiAgICAgICAgICAgICkuZ2V0VGltZSgpIC0KICAgICAgICAgICAgbmV3IERhdGUoCiAgICAgICAgICAgICAgYi5jcmVhdGVkX2F0
IHx8CiAgICAgICAgICAgICAgYi5jcmVhdGVkQXQgfHwKICAgICAgICAgICAgICAwCiAgICAgICAgICAgICkuZ2V0VGltZSgpCiAgICAgICAgKTsKCiAgICBj
b25zdCBmb3VuZGVySWQgPQogICAgICBhY2NvdW50c1swXT8uaWQKICAgICAgICA/IFN0cmluZyhhY2NvdW50c1swXS5pZCkKICAgICAgICA6IG51bGw7Cgog
ICAgb2ZmaWNpYWwgPSB7CiAgICAgIGlkOgogICAgICAgIGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKSwKICAgICAgbmFtZToKICAgICAgICAiUGVvcGxl
IiwKICAgICAgb3duZXJJZDoKICAgICAgICBmb3VuZGVySWQsCiAgICAgIGludml0ZUNvZGU6CiAgICAgICAgcGVvcGxlTmV3SW52aXRlQ29kZSgpLAogICAg
ICBvZmZpY2lhbDoKICAgICAgICB0cnVlLAogICAgICBsZWdhY3lTZWVkZWQ6CiAgICAgICAgZmFsc2UsCiAgICAgIGNyZWF0ZWRBdDoKICAgICAgICBuZXcg
RGF0ZSgpLnRvSVNPU3RyaW5nKCkKICAgIH07CgogICAgZGF0YS5zZXJ2ZXJzLnB1c2goCiAgICAgIG9mZmljaWFsCiAgICApOwogIH0KCiAgaWYgKCFvZmZp
Y2lhbC5sZWdhY3lTZWVkZWQpIHsKICAgIGlmIChvZmZpY2lhbC5vd25lcklkKSB7CiAgICAgIGNvbnN0IGV4aXN0cyA9CiAgICAgICAgZGF0YS5tZW1iZXJz
LnNvbWUoCiAgICAgICAgICAobWVtYmVyKSA9PgogICAgICAgICAgICBTdHJpbmcobWVtYmVyLnNlcnZlcklkKSA9PT0KICAgICAgICAgICAgICBTdHJpbmco
b2ZmaWNpYWwuaWQpICYmCiAgICAgICAgICAgIFN0cmluZyhtZW1iZXIudXNlcklkKSA9PT0KICAgICAgICAgICAgICBTdHJpbmcob2ZmaWNpYWwub3duZXJJ
ZCkKICAgICAgICApOwoKICAgICAgaWYgKCFleGlzdHMpIHsKICAgICAgICBkYXRhLm1lbWJlcnMucHVzaCh7CiAgICAgICAgICBzZXJ2ZXJJZDoKICAgICAg
ICAgICAgU3RyaW5nKG9mZmljaWFsLmlkKSwKICAgICAgICAgIHVzZXJJZDoKICAgICAgICAgICAgU3RyaW5nKG9mZmljaWFsLm93bmVySWQpLAogICAgICAg
ICAgam9pbmVkQXQ6CiAgICAgICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogICAgICAgIH0pOwogICAgICB9CiAgICB9CgogICAgb2ZmaWNpYWwu
bGVnYWN5U2VlZGVkID0KICAgICAgdHJ1ZTsKICB9CgogIGNvbnN0IG1lc3NhZ2VzID0KICAgIHBlb3BsZVJlYWRMb2NhbEdlbmVyYWwoKTsKCiAgbGV0IGNo
YW5nZWQgPSBmYWxzZTsKCiAgZm9yIChjb25zdCBtZXNzYWdlIG9mIG1lc3NhZ2VzKSB7CiAgICBpZiAoIW1lc3NhZ2Uuc2VydmVySWQpIHsKICAgICAgbWVz
c2FnZS5zZXJ2ZXJJZCA9CiAgICAgICAgU3RyaW5nKG9mZmljaWFsLmlkKTsKCiAgICAgIGNoYW5nZWQgPSB0cnVlOwogICAgfQogIH0KCiAgaWYgKGNoYW5n
ZWQpIHsKICAgIHBlb3BsZVdyaXRlTG9jYWxHZW5lcmFsKAogICAgICBtZXNzYWdlcwogICAgKTsKICB9CgogIHBlb3BsZVdyaXRlTG9jYWxTZXJ2ZXJzKAog
ICAgZGF0YQogICk7CgogIGNvbnNvbGUubG9nKAogICAgIltQZW9wbGVdIFNlcnZldXIgb2ZmaWNpZWwgbG9jYWwgcHLDqnQuIEludml0YXRpb246IC9pbnZp
dGUvIiArCiAgICBvZmZpY2lhbC5pbnZpdGVDb2RlCiAgKTsKfQoKCi8vID09PSBQRU9QTEVfU0VSVkVSX0NIQU5ORUxTX1YyX1NUQVJUID09PQpmdW5jdGlv
biBwZW9wbGVDaGFubmVsTmFtZSh2YWx1ZSkgewogIHJldHVybiBTdHJpbmcodmFsdWUgfHwgIiIpCiAgICAubm9ybWFsaXplKCJORktDIikKICAgIC50cmlt
KCkKICAgIC5yZXBsYWNlKC9ccysvZywgIiAiKQogICAgLnNsaWNlKDAsIDUwKTsKfQoKZnVuY3Rpb24gcGVvcGxlVmFsaWRDaGFubmVsTmFtZSh2YWx1ZSkg
ewogIGNvbnN0IG5hbWUgPSBwZW9wbGVDaGFubmVsTmFtZSh2YWx1ZSk7CiAgcmV0dXJuIEJvb2xlYW4oCiAgICBuYW1lICYmCiAgICBuYW1lLmxlbmd0aCA8
PSA1MCAmJgogICAgIS9bXHUwMDAwLVx1MDAxZlx1MDA3Zl0vdS50ZXN0KG5hbWUpCiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlQ2hhbm5lbFR5cGUodmFsdWUp
IHsKICBjb25zdCB0eXBlID0gU3RyaW5nKHZhbHVlIHx8ICIiKS50b0xvd2VyQ2FzZSgpOwogIHJldHVybiBbImNhdGVnb3J5IiwgInRleHQiLCAidm9pY2Ui
XS5pbmNsdWRlcyh0eXBlKQogICAgPyB0eXBlCiAgICA6ICIiOwp9CgpmdW5jdGlvbiBwZW9wbGVDaGFubmVsUHVibGljKGNoYW5uZWwpIHsKICBpZiAoIWNo
YW5uZWwpIHJldHVybiBudWxsOwogIHJldHVybiB7CiAgICBpZDogU3RyaW5nKGNoYW5uZWwuaWQpLAogICAgc2VydmVySWQ6IFN0cmluZyhjaGFubmVsLnNl
cnZlcklkID8/IGNoYW5uZWwuc2VydmVyX2lkID8/ICIiKSwKICAgIHR5cGU6IHBlb3BsZUNoYW5uZWxUeXBlKGNoYW5uZWwudHlwZSksCiAgICBuYW1lOiBT
dHJpbmcoY2hhbm5lbC5uYW1lIHx8ICIiKSwKICAgIHBhcmVudElkOiBjaGFubmVsLnBhcmVudElkID8/IGNoYW5uZWwucGFyZW50X2lkID8/IG51bGwsCiAg
ICBwb3NpdGlvbjogTnVtYmVyKGNoYW5uZWwucG9zaXRpb24gfHwgMCksCiAgICBjcmVhdGVkQXQ6IGNoYW5uZWwuY3JlYXRlZEF0ID8/IGNoYW5uZWwuY3Jl
YXRlZF9hdCA/PyBudWxsCiAgfTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlTGlzdFNlcnZlckNoYW5uZWxzKHNlcnZlcklkKSB7CiAgY29uc3Qgc2lkID0g
U3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBpZiAoIXNpZCkgcmV0dXJuIFtdOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdh
aXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlNFTEVDVCBpZCwgc2VydmVyX2lkLCB0eXBlLCBuYW1lLCBwYXJlbnRfaWQsIHBvc2l0aW9uLCBjcmVhdGVk
X2F0ICIgKwogICAgICAiRlJPTSBwZW9wbGVfc2VydmVyX2NoYW5uZWxzIFdIRVJFIHNlcnZlcl9pZCA9ICQxICIgKwogICAgICAiT1JERVIgQlkgcG9zaXRp
b24gQVNDLCBpZCBBU0MiLAogICAgICBbc2lkXQogICAgKTsKICAgIHJldHVybiByZXN1bHQucm93cy5tYXAocGVvcGxlQ2hhbm5lbFB1YmxpYyk7CiAgfQoK
ICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwogIHJldHVybiAoZGF0YS5jaGFubmVscyB8fCBbXSkKICAgIC5maWx0ZXIoKGl0ZW0p
ID0+IFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkKQogICAgLm1hcChwZW9wbGVDaGFubmVsUHVibGljKQog
ICAgLnNvcnQoKGEsIGIpID0+IChhLnBvc2l0aW9uIC0gYi5wb3NpdGlvbikgfHwgYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lLCAiZnIiKSk7Cn0KCmFz
eW5jIGZ1bmN0aW9uIHBlb3BsZUdldFNlcnZlckNoYW5uZWwoc2VydmVySWQsIGNoYW5uZWxJZCwgd2FudGVkVHlwZSA9ICIiKSB7CiAgY29uc3Qgc2lkID0g
U3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICBjb25zdCBleHBlY3RlZCA9IHBlb3BsZUNo
YW5uZWxUeXBlKHdhbnRlZFR5cGUpOwogIGlmICghc2lkIHx8ICFjaWQpIHJldHVybiBudWxsOwoKICBjb25zdCBjaGFubmVscyA9IGF3YWl0IHBlb3BsZUxp
c3RTZXJ2ZXJDaGFubmVscyhzaWQpOwogIHJldHVybiBjaGFubmVscy5maW5kKChpdGVtKSA9PgogICAgU3RyaW5nKGl0ZW0uaWQpID09PSBjaWQgJiYgKCFl
eHBlY3RlZCB8fCBpdGVtLnR5cGUgPT09IGV4cGVjdGVkKQogICkgfHwgbnVsbDsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlRGVmYXVsdFNlcnZlckNoYW5u
ZWwoc2VydmVySWQsIHR5cGUgPSAidGV4dCIpIHsKICBjb25zdCB3YW50ZWQgPSBwZW9wbGVDaGFubmVsVHlwZSh0eXBlKSB8fCAidGV4dCI7CiAgY29uc3Qg
Y2hhbm5lbHMgPSBhd2FpdCBwZW9wbGVMaXN0U2VydmVyQ2hhbm5lbHMoc2VydmVySWQpOwogIHJldHVybiBjaGFubmVscy5maW5kKChpdGVtKSA9PiBpdGVt
LnR5cGUgPT09IHdhbnRlZCkgfHwgbnVsbDsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlQ2FuTWFuYWdlU2VydmVyQ2hhbm5lbHMoYWNjb3VudElkLCBzZXJ2
ZXJJZCwgY2hhbm5lbElkID0gbnVsbCkgewogIHJldHVybiBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKAogICAgYWNjb3VudElkLAogICAgc2VydmVySWQs
CiAgICAiTUFOQUdFX0NIQU5ORUxTIiwKICAgIGNoYW5uZWxJZAogICk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUJyb2FkY2FzdFNlcnZlckNoYW5uZWxz
KHNlcnZlcklkKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBpZiAoIXNpZCkgcmV0dXJuOwoKICBjb25zdCByb29tID0gaW8u
c29ja2V0cy5hZGFwdGVyLnJvb21zLmdldChwZW9wbGVTZXJ2ZXJSb29tKHNpZCkpOwogIGlmICghcm9vbSkgcmV0dXJuOwoKICBjb25zdCBjYWNoZSA9IG5l
dyBNYXAoKTsKICBmb3IgKGNvbnN0IHNvY2tldElkIG9mIHJvb20pIHsKICAgIGNvbnN0IGFjY291bnRJZCA9IFN0cmluZyh1c2VySWRzLmdldChzb2NrZXRJ
ZCkgfHwgIiIpOwogICAgaWYgKCFhY2NvdW50SWQpIGNvbnRpbnVlOwogICAgbGV0IGNoYW5uZWxzID0gY2FjaGUuZ2V0KGFjY291bnRJZCk7CiAgICBpZiAo
IWNoYW5uZWxzKSB7CiAgICAgIGNoYW5uZWxzID0gYXdhaXQgcGVvcGxlTGlzdFZpc2libGVTZXJ2ZXJDaGFubmVscyhhY2NvdW50SWQsIHNpZCk7CiAgICAg
IGNhY2hlLnNldChhY2NvdW50SWQsIGNoYW5uZWxzKTsKICAgIH0KICAgIGlvLnRvKHNvY2tldElkKS5lbWl0KCJzZXJ2ZXItY2hhbm5lbHMtdXBkYXRlZCIs
IHsKICAgICAgc2VydmVySWQ6IHNpZCwKICAgICAgY2hhbm5lbHMKICAgIH0pOwogIH0KfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlQ3JlYXRlU2VydmVyQ2hh
bm5lbChzZXJ2ZXJJZCwgcmF3VHlwZSwgcmF3TmFtZSwgcmF3UGFyZW50SWQgPSBudWxsKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIi
KTsKICBjb25zdCB0eXBlID0gcGVvcGxlQ2hhbm5lbFR5cGUocmF3VHlwZSk7CiAgY29uc3QgbmFtZSA9IHBlb3BsZUNoYW5uZWxOYW1lKHJhd05hbWUpOwog
IGxldCBwYXJlbnRJZCA9IHJhd1BhcmVudElkID8gU3RyaW5nKHJhd1BhcmVudElkKSA6IG51bGw7CgogIGlmICghc2lkIHx8ICF0eXBlIHx8ICFwZW9wbGVW
YWxpZENoYW5uZWxOYW1lKG5hbWUpKSB7CiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIkNIQU5ORUxfSU5WQUxJRCIpOwogICAgZXJyLmNvZGUgPSAiQ0hB
Tk5FTF9JTlZBTElEIjsKICAgIHRocm93IGVycjsKICB9CgogIGlmICh0eXBlID09PSAiY2F0ZWdvcnkiKSB7CiAgICBwYXJlbnRJZCA9IG51bGw7CiAgfSBl
bHNlIGlmIChwYXJlbnRJZCkgewogICAgY29uc3QgcGFyZW50ID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChzaWQsIHBhcmVudElkLCAiY2F0ZWdv
cnkiKTsKICAgIGlmICghcGFyZW50KSBwYXJlbnRJZCA9IG51bGw7CiAgfQoKICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHBlb3BsZUxpc3RTZXJ2ZXJDaGFu
bmVscyhzaWQpOwogIGNvbnN0IHBvc2l0aW9uID0gZXhpc3RpbmcubGVuZ3RoCiAgICA/IE1hdGgubWF4KC4uLmV4aXN0aW5nLm1hcCgoaXRlbSkgPT4gTnVt
YmVyKGl0ZW0ucG9zaXRpb24gfHwgMCkpKSArIDEKICAgIDogMDsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3Bs
ZVBvb2wucXVlcnkoCiAgICAgICJJTlNFUlQgSU5UTyBwZW9wbGVfc2VydmVyX2NoYW5uZWxzIChzZXJ2ZXJfaWQsIHR5cGUsIG5hbWUsIHBhcmVudF9pZCwg
cG9zaXRpb24pICIgKwogICAgICAiVkFMVUVTICgkMSwgJDIsICQzLCAkNCwgJDUpICIgKwogICAgICAiUkVUVVJOSU5HIGlkLCBzZXJ2ZXJfaWQsIHR5cGUs
IG5hbWUsIHBhcmVudF9pZCwgcG9zaXRpb24sIGNyZWF0ZWRfYXQiLAogICAgICBbc2lkLCB0eXBlLCBuYW1lLCBwYXJlbnRJZCwgcG9zaXRpb25dCiAgICAp
OwogICAgcmV0dXJuIHBlb3BsZUNoYW5uZWxQdWJsaWMocmVzdWx0LnJvd3NbMF0pOwogIH0KCiAgY29uc3QgZGF0YSA9IHBlb3BsZVJlYWRMb2NhbFNlcnZl
cnMoKTsKICBjb25zdCBjaGFubmVsID0gewogICAgaWQ6IGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKSwKICAgIHNlcnZlcklkOiBzaWQsCiAgICB0eXBl
LAogICAgbmFtZSwKICAgIHBhcmVudElkLAogICAgcG9zaXRpb24sCiAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogIH07CiAgZGF0
YS5jaGFubmVscyA9IEFycmF5LmlzQXJyYXkoZGF0YS5jaGFubmVscykgPyBkYXRhLmNoYW5uZWxzIDogW107CiAgZGF0YS5jaGFubmVscy5wdXNoKGNoYW5u
ZWwpOwogIHBlb3BsZVdyaXRlTG9jYWxTZXJ2ZXJzKGRhdGEpOwogIHJldHVybiBwZW9wbGVDaGFubmVsUHVibGljKGNoYW5uZWwpOwp9Cgphc3luYyBmdW5j
dGlvbiBwZW9wbGVVcGRhdGVTZXJ2ZXJDaGFubmVsKHNlcnZlcklkLCBjaGFubmVsSWQsIHBhdGNoID0ge30pIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2Vy
dmVySWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCBwZW9wbGVHZXRTZXJ2
ZXJDaGFubmVsKHNpZCwgY2lkKTsKICBpZiAoIWN1cnJlbnQpIHJldHVybiBudWxsOwoKICBsZXQgbmFtZSA9IGN1cnJlbnQubmFtZTsKICBpZiAoT2JqZWN0
LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHBhdGNoLCAibmFtZSIpKSB7CiAgICBuYW1lID0gcGVvcGxlQ2hhbm5lbE5hbWUocGF0Y2gubmFtZSk7
CiAgICBpZiAoIXBlb3BsZVZhbGlkQ2hhbm5lbE5hbWUobmFtZSkpIHsKICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCJDSEFOTkVMX0lOVkFMSUQiKTsK
ICAgICAgZXJyLmNvZGUgPSAiQ0hBTk5FTF9JTlZBTElEIjsKICAgICAgdGhyb3cgZXJyOwogICAgfQogIH0KCiAgbGV0IHBhcmVudElkID0gY3VycmVudC5w
YXJlbnRJZCA/IFN0cmluZyhjdXJyZW50LnBhcmVudElkKSA6IG51bGw7CiAgaWYgKGN1cnJlbnQudHlwZSA9PT0gImNhdGVnb3J5IikgewogICAgcGFyZW50
SWQgPSBudWxsOwogIH0gZWxzZSBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHBhdGNoLCAicGFyZW50SWQiKSkgewogICAgY29u
c3QgcmVxdWVzdGVkID0gcGF0Y2gucGFyZW50SWQgPyBTdHJpbmcocGF0Y2gucGFyZW50SWQpIDogbnVsbDsKICAgIGlmIChyZXF1ZXN0ZWQpIHsKICAgICAg
Y29uc3QgcGFyZW50ID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChzaWQsIHJlcXVlc3RlZCwgImNhdGVnb3J5Iik7CiAgICAgIHBhcmVudElkID0g
cGFyZW50ID8gU3RyaW5nKHBhcmVudC5pZCkgOiBudWxsOwogICAgfSBlbHNlIHsKICAgICAgcGFyZW50SWQgPSBudWxsOwogICAgfQogIH0KCiAgY29uc3Qg
cG9zaXRpb24gPSBOdW1iZXIuaXNGaW5pdGUoTnVtYmVyKHBhdGNoLnBvc2l0aW9uKSkKICAgID8gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihOdW1iZXIocGF0
Y2gucG9zaXRpb24pKSkKICAgIDogY3VycmVudC5wb3NpdGlvbjsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3Bs
ZVBvb2wucXVlcnkoCiAgICAgICJVUERBVEUgcGVvcGxlX3NlcnZlcl9jaGFubmVscyBTRVQgbmFtZSA9ICQzLCBwYXJlbnRfaWQgPSAkNCwgcG9zaXRpb24g
PSAkNSAiICsKICAgICAgIldIRVJFIGlkID0gJDEgQU5EIHNlcnZlcl9pZCA9ICQyICIgKwogICAgICAiUkVUVVJOSU5HIGlkLCBzZXJ2ZXJfaWQsIHR5cGUs
IG5hbWUsIHBhcmVudF9pZCwgcG9zaXRpb24sIGNyZWF0ZWRfYXQiLAogICAgICBbY2lkLCBzaWQsIG5hbWUsIHBhcmVudElkLCBwb3NpdGlvbl0KICAgICk7
CiAgICByZXR1cm4gcGVvcGxlQ2hhbm5lbFB1YmxpYyhyZXN1bHQucm93c1swXSk7CiAgfQoKICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU2VydmVy
cygpOwogIGNvbnN0IGl0ZW0gPSAoZGF0YS5jaGFubmVscyB8fCBbXSkuZmluZCgoZW50cnkpID0+CiAgICBTdHJpbmcoZW50cnkuaWQpID09PSBjaWQgJiYg
U3RyaW5nKGVudHJ5LnNlcnZlcklkID8/IGVudHJ5LnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZAogICk7CiAgaWYgKCFpdGVtKSByZXR1cm4gbnVsbDsKICBp
dGVtLm5hbWUgPSBuYW1lOwogIGl0ZW0ucGFyZW50SWQgPSBwYXJlbnRJZDsKICBpdGVtLnBvc2l0aW9uID0gcG9zaXRpb247CiAgcGVvcGxlV3JpdGVMb2Nh
bFNlcnZlcnMoZGF0YSk7CiAgcmV0dXJuIHBlb3BsZUNoYW5uZWxQdWJsaWMoaXRlbSk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZURlbGV0ZVNlcnZlckNo
YW5uZWwoc2VydmVySWQsIGNoYW5uZWxJZCkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgY2lkID0gU3RyaW5nKGNo
YW5uZWxJZCB8fCAiIik7CiAgY29uc3QgY3VycmVudCA9IGF3YWl0IHBlb3BsZUdldFNlcnZlckNoYW5uZWwoc2lkLCBjaWQpOwogIGlmICghY3VycmVudCkg
cmV0dXJuIHsgb2s6IGZhbHNlLCBjb2RlOiAiTk9UX0ZPVU5EIiB9OwoKICBjb25zdCBjaGFubmVscyA9IGF3YWl0IHBlb3BsZUxpc3RTZXJ2ZXJDaGFubmVs
cyhzaWQpOwogIGlmIChjdXJyZW50LnR5cGUgPT09ICJ0ZXh0IiAmJiBjaGFubmVscy5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0udHlwZSA9PT0gInRleHQiKS5s
ZW5ndGggPD0gMSkgewogICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBjb2RlOiAiTEFTVF9URVhUIiB9OwogIH0KCiAgaWYgKGN1cnJlbnQudHlwZSA9PT0gInZv
aWNlIikgewogICAgZm9yIChjb25zdCBbc29ja2V0SWQsIHZvaWNlVXNlcl0gb2YgWy4uLnZvaWNlVXNlcnMuZW50cmllcygpXSkgewogICAgICBpZiAoCiAg
ICAgICAgU3RyaW5nKHZvaWNlVXNlcj8uc2VydmVySWQgfHwgIiIpID09PSBzaWQgJiYKICAgICAgICBTdHJpbmcodm9pY2VVc2VyPy5jaGFubmVsSWQgfHwg
IiIpID09PSBjaWQKICAgICAgKSB7CiAgICAgICAgY29uc3QgdGFyZ2V0U29ja2V0ID0gaW8uc29ja2V0cy5zb2NrZXRzLmdldChzb2NrZXRJZCk7CiAgICAg
ICAgaWYgKHRhcmdldFNvY2tldCkgbGVhdmVWb2ljZSh0YXJnZXRTb2NrZXQpOwogICAgICB9CiAgICB9CiAgfQoKICBpZiAocGVvcGxlUG9vbCkgewogICAg
Y29uc3QgY2xpZW50ID0gYXdhaXQgcGVvcGxlUG9vbC5jb25uZWN0KCk7CiAgICB0cnkgewogICAgICBhd2FpdCBjbGllbnQucXVlcnkoIkJFR0lOIik7CiAg
ICAgIGlmIChjdXJyZW50LnR5cGUgPT09ICJjYXRlZ29yeSIpIHsKICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiVVBEQVRFIHBlb3Bs
ZV9zZXJ2ZXJfY2hhbm5lbHMgU0VUIHBhcmVudF9pZCA9IE5VTEwgV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIHBhcmVudF9pZCA9ICQyIiwKICAgICAgICAg
IFtzaWQsIGNpZF0KICAgICAgICApOwogICAgICB9CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgKICAgICAgICAiREVMRVRFIEZST00gcGVvcGxlX3NlcnZl
cl9jaGFubmVscyBXSEVSRSBpZCA9ICQxIEFORCBzZXJ2ZXJfaWQgPSAkMiIsCiAgICAgICAgW2NpZCwgc2lkXQogICAgICApOwogICAgICBhd2FpdCBjbGll
bnQucXVlcnkoIkNPTU1JVCIpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiUk9MTEJBQ0siKS5jYXRjaCgoKSA9PiB7
fSk7CiAgICAgIHRocm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfSBlbHNlIHsKICAgIGNvbnN0IGRh
dGEgPSBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CiAgICBpZiAoY3VycmVudC50eXBlID09PSAiY2F0ZWdvcnkiKSB7CiAgICAgIGZvciAoY29uc3QgaXRl
bSBvZiBkYXRhLmNoYW5uZWxzIHx8IFtdKSB7CiAgICAgICAgaWYgKFN0cmluZyhpdGVtLnBhcmVudElkID8/IGl0ZW0ucGFyZW50X2lkID8/ICIiKSA9PT0g
Y2lkKSBpdGVtLnBhcmVudElkID0gbnVsbDsKICAgICAgfQogICAgfQogICAgZGF0YS5jaGFubmVscyA9IChkYXRhLmNoYW5uZWxzIHx8IFtdKS5maWx0ZXIo
KGl0ZW0pID0+IFN0cmluZyhpdGVtLmlkKSAhPT0gY2lkKTsKICAgIGRhdGEucGVybWlzc2lvbk92ZXJyaWRlcyA9IChkYXRhLnBlcm1pc3Npb25PdmVycmlk
ZXMgfHwgW10pLmZpbHRlcigKICAgICAgKGl0ZW0pID0+IFN0cmluZyhpdGVtLmNoYW5uZWxJZCA/PyBpdGVtLmNoYW5uZWxfaWQgPz8gIiIpICE9PSBjaWQK
ICAgICk7CiAgICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKTsKCiAgICBpZiAoY3VycmVudC50eXBlID09PSAidGV4dCIpIHsKICAgICAgY29uc3Qg
bWVzc2FnZXMgPSBwZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7CiAgICAgIGNvbnN0IHJlbW92ZWQgPSBtZXNzYWdlcy5maWx0ZXIoKG1lc3NhZ2UpID0+CiAg
ICAgICAgU3RyaW5nKG1lc3NhZ2Uuc2VydmVySWQgfHwgIiIpID09PSBzaWQgJiYgU3RyaW5nKG1lc3NhZ2UuY2hhbm5lbElkIHx8ICIiKSA9PT0gY2lkCiAg
ICAgICk7CiAgICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiByZW1vdmVkKSB7CiAgICAgICAgcGVvcGxlRGVsZXRlTG9jYWxCb3VuZE1lc3NhZ2VJbWFnZSgi
Z2VuZXJhbCIsIG1lc3NhZ2UuaWQpOwogICAgICB9CiAgICAgIHBlb3BsZVdyaXRlTG9jYWxHZW5lcmFsKG1lc3NhZ2VzLmZpbHRlcigobWVzc2FnZSkgPT4K
ICAgICAgICAhKFN0cmluZyhtZXNzYWdlLnNlcnZlcklkIHx8ICIiKSA9PT0gc2lkICYmIFN0cmluZyhtZXNzYWdlLmNoYW5uZWxJZCB8fCAiIikgPT09IGNp
ZCkKICAgICAgKSk7CiAgICB9CiAgfQoKICByZXR1cm4geyBvazogdHJ1ZSwgY2hhbm5lbDogY3VycmVudCB9Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVJ
bml0U2VydmVyQ2hhbm5lbHNWMigpIHsKICBpZiAocGVvcGxlUG9vbCkgewogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkNSRUFURSBUQUJM
RSBJRiBOT1QgRVhJU1RTIHBlb3BsZV9zZXJ2ZXJfY2hhbm5lbHMgKCIgKwogICAgICAiaWQgQklHU0VSSUFMIFBSSU1BUlkgS0VZLCAiICsKICAgICAgInNl
cnZlcl9pZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfc2VydmVycyhpZCkgT04gREVMRVRFIENBU0NBREUsICIgKwogICAgICAidHlwZSBW
QVJDSEFSKDEyKSBOT1QgTlVMTCBDSEVDSyh0eXBlIElOICgnY2F0ZWdvcnknLCd0ZXh0Jywndm9pY2UnKSksICIgKwogICAgICAibmFtZSBWQVJDSEFSKDUw
KSBOT1QgTlVMTCwgIiArCiAgICAgICJwYXJlbnRfaWQgQklHSU5UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfc2VydmVyX2NoYW5uZWxzKGlkKSBPTiBERUxF
VEUgU0VUIE5VTEwsICIgKwogICAgICAicG9zaXRpb24gSU5URUdFUiBOT1QgTlVMTCBERUZBVUxUIDAsICIgKwogICAgICAiY3JlYXRlZF9hdCBUSU1FU1RB
TVBUWiBOT1QgTlVMTCBERUZBVUxUIE5PVygpIiArCiAgICAgICIpIgogICAgKTsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJDUkVBVEUg
SU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfc2VydmVyX2NoYW5uZWxzX3NlcnZlcl9wb3NpdGlvbl9pZHggIiArCiAgICAgICJPTiBwZW9wbGVfc2VydmVy
X2NoYW5uZWxzKHNlcnZlcl9pZCwgcG9zaXRpb24sIGlkKSIKICAgICk7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiQUxURVIgVEFCTEUg
cGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgQUREIENPTFVNTiBJRiBOT1QgRVhJU1RTIGNoYW5uZWxfaWQgQklHSU5UIE5VTEwgIiArCiAgICAgICJSRUZFUkVO
Q0VTIHBlb3BsZV9zZXJ2ZXJfY2hhbm5lbHMoaWQpIE9OIERFTEVURSBDQVNDQURFIgogICAgKTsKCiAgICBjb25zdCBzZXJ2ZXJzID0gYXdhaXQgcGVvcGxl
UG9vbC5xdWVyeSgiU0VMRUNUIGlkIEZST00gcGVvcGxlX3NlcnZlcnMgT1JERVIgQlkgaWQgQVNDIik7CiAgICBmb3IgKGNvbnN0IHJvdyBvZiBzZXJ2ZXJz
LnJvd3MpIHsKICAgICAgY29uc3Qgc2lkID0gU3RyaW5nKHJvdy5pZCk7CiAgICAgIGxldCB0ZXh0ID0gYXdhaXQgcGVvcGxlRGVmYXVsdFNlcnZlckNoYW5u
ZWwoc2lkLCAidGV4dCIpOwogICAgICBpZiAoIXRleHQpIHRleHQgPSBhd2FpdCBwZW9wbGVDcmVhdGVTZXJ2ZXJDaGFubmVsKHNpZCwgInRleHQiLCAiZ8Op
bsOpcmFsIiwgbnVsbCk7CiAgICAgIGxldCB2b2ljZSA9IGF3YWl0IHBlb3BsZURlZmF1bHRTZXJ2ZXJDaGFubmVsKHNpZCwgInZvaWNlIik7CiAgICAgIGlm
ICghdm9pY2UpIHZvaWNlID0gYXdhaXQgcGVvcGxlQ3JlYXRlU2VydmVyQ2hhbm5lbChzaWQsICJ2b2ljZSIsICJ2b2NhbCIsIG51bGwpOwogICAgICBhd2Fp
dCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAgICJVUERBVEUgcGVvcGxlX2dlbmVyYWxfbWVzc2FnZXMgU0VUIGNoYW5uZWxfaWQgPSAkMiBXSEVSRSBzZXJ2
ZXJfaWQgPSAkMSBBTkQgY2hhbm5lbF9pZCBJUyBOVUxMIiwKICAgICAgICBbc2lkLCB0ZXh0LmlkXQogICAgICApOwogICAgfQogICAgYXdhaXQgcGVvcGxl
UG9vbC5xdWVyeSgKICAgICAgIkNSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzX2NoYW5uZWxfY3JlYXRlZF9pZHgg
IiArCiAgICAgICJPTiBwZW9wbGVfZ2VuZXJhbF9tZXNzYWdlcyhjaGFubmVsX2lkLCBjcmVhdGVkX2F0IERFU0MpIgogICAgKTsKICAgIGNvbnNvbGUubG9n
KCJbUGVvcGxlXSBDYXTDqWdvcmllcyBldCBzYWxvbnMgc2VydmV1ciBWMiBwcsOqdHMuIik7CiAgICByZXR1cm47CiAgfQoKICBjb25zdCBkYXRhID0gcGVv
cGxlUmVhZExvY2FsU2VydmVycygpOwogIGRhdGEuY2hhbm5lbHMgPSBBcnJheS5pc0FycmF5KGRhdGEuY2hhbm5lbHMpID8gZGF0YS5jaGFubmVscyA6IFtd
OwogIGZvciAoY29uc3Qgc2VydmVyIG9mIGRhdGEuc2VydmVycyB8fCBbXSkgewogICAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlci5pZCk7CiAgICBsZXQg
dGV4dCA9IGRhdGEuY2hhbm5lbHMuZmluZCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0uc2VydmVySWQgfHwgIiIpID09PSBzaWQgJiYgaXRlbS50eXBlID09PSAi
dGV4dCIpOwogICAgaWYgKCF0ZXh0KSB7CiAgICAgIHRleHQgPSB7CiAgICAgICAgaWQ6IGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKSwgc2VydmVySWQ6
IHNpZCwgdHlwZTogInRleHQiLCBuYW1lOiAiZ8OpbsOpcmFsIiwKICAgICAgICBwYXJlbnRJZDogbnVsbCwgcG9zaXRpb246IGRhdGEuY2hhbm5lbHMubGVu
Z3RoLCBjcmVhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogICAgICB9OwogICAgICBkYXRhLmNoYW5uZWxzLnB1c2godGV4dCk7CiAgICB9CiAg
ICBpZiAoIWRhdGEuY2hhbm5lbHMuc29tZSgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0uc2VydmVySWQgfHwgIiIpID09PSBzaWQgJiYgaXRlbS50eXBlID09PSAi
dm9pY2UiKSkgewogICAgICBkYXRhLmNoYW5uZWxzLnB1c2goewogICAgICAgIGlkOiBjcnlwdG9BY2NvdW50cy5yYW5kb21VVUlEKCksIHNlcnZlcklkOiBz
aWQsIHR5cGU6ICJ2b2ljZSIsIG5hbWU6ICJ2b2NhbCIsCiAgICAgICAgcGFyZW50SWQ6IG51bGwsIHBvc2l0aW9uOiBkYXRhLmNoYW5uZWxzLmxlbmd0aCwg
Y3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkKICAgICAgfSk7CiAgICB9CiAgICBjb25zdCBtZXNzYWdlcyA9IHBlb3BsZVJlYWRMb2NhbEdl
bmVyYWwoKTsKICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7CiAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgbWVzc2FnZXMpIHsKICAgICAgaWYgKFN0cmluZyht
ZXNzYWdlLnNlcnZlcklkIHx8ICIiKSA9PT0gc2lkICYmICFtZXNzYWdlLmNoYW5uZWxJZCkgewogICAgICAgIG1lc3NhZ2UuY2hhbm5lbElkID0gU3RyaW5n
KHRleHQuaWQpOwogICAgICAgIGNoYW5nZWQgPSB0cnVlOwogICAgICB9CiAgICB9CiAgICBpZiAoY2hhbmdlZCkgcGVvcGxlV3JpdGVMb2NhbEdlbmVyYWwo
bWVzc2FnZXMpOwogIH0KICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKTsKICBjb25zb2xlLmxvZygiW1Blb3BsZV0gQ2F0w6lnb3JpZXMgZXQgc2Fs
b25zIHNlcnZldXIgbG9jYXV4IFYyIHByw6p0cy4iKTsKfQoKYXBwLmdldCgiL2FwaS9zZXJ2ZXJzLzppZC9jaGFubmVscyIsIGFzeW5jIChyZXEsIHJlcykg
PT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1
cm47CiAgICBjb25zdCBtZW1iZXIgPSBhd2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcihzZXNzaW9uLmlkLCByZXEucGFyYW1zLmlkKTsKICAgIGlmICghbWVt
YmVyKSByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiVHUgbidlcyBwYXMgbWVtYnJlIGRlIGNlIHNlcnZldXIuIiB9
KTsKICAgIGNvbnN0IFtjaGFubmVscywgcGVybWlzc2lvbnNdID0gYXdhaXQgUHJvbWlzZS5hbGwoWwogICAgICBwZW9wbGVMaXN0VmlzaWJsZVNlcnZlckNo
YW5uZWxzKHNlc3Npb24uaWQsIHJlcS5wYXJhbXMuaWQpLAogICAgICBwZW9wbGVQZXJtaXNzaW9uU25hcHNob3Qoc2Vzc2lvbi5pZCwgcmVxLnBhcmFtcy5p
ZCkKICAgIF0pOwogICAgcmVzLmpzb24oeyBvazogdHJ1ZSwgY2hhbm5lbHMsIHBlcm1pc3Npb25zIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29s
ZS5lcnJvcigiW1Blb3BsZSBjaGFubmVscy9saXN0XSIsIGVycik7CiAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBv
c3NpYmxlIGRlIGNoYXJnZXIgbGVzIHNhbG9ucy4iIH0pOwogIH0KfSk7CgphcHAucG9zdCgiL2FwaS9zZXJ2ZXJzLzppZC9jaGFubmVscyIsIGFzeW5jIChy
ZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFzZXNz
aW9uKSByZXR1cm47CiAgICBpZiAoIShhd2FpdCBwZW9wbGVDYW5NYW5hZ2VTZXJ2ZXJDaGFubmVscyhzZXNzaW9uLmlkLCByZXEucGFyYW1zLmlkKSkpIHsK
ICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlR1IG4nYXMgcGFzIGxhIHBlcm1pc3Npb24gZGUgZ8OpcmVy
IGxlcyBzYWxvbnMuIiB9KTsKICAgIH0KICAgIGNvbnN0IGNoYW5uZWwgPSBhd2FpdCBwZW9wbGVDcmVhdGVTZXJ2ZXJDaGFubmVsKHJlcS5wYXJhbXMuaWQs
IHJlcS5ib2R5Py50eXBlLCByZXEuYm9keT8ubmFtZSwgcmVxLmJvZHk/LnBhcmVudElkKTsKICAgIGlmIChjaGFubmVsPy50eXBlID09PSAidGV4dCIpIHsK
ICAgICAgYXdhaXQgcGVvcGxlU2VydmVyRTJlZUVuc3VyZVN0YXRlKHJlcS5wYXJhbXMuaWQsIGNoYW5uZWwuaWQsICJjaGFubmVsLWNyZWF0ZWQiKTsKICAg
IH0KICAgIGF3YWl0IHBlb3BsZUJyb2FkY2FzdFNlcnZlckNoYW5uZWxzKHJlcS5wYXJhbXMuaWQpOwogICAgcmVzLnN0YXR1cygyMDEpLmpzb24oeyBvazog
dHJ1ZSwgY2hhbm5lbCB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnN0IHN0YXR1cyA9IGVycj8uY29kZSA9PT0gIkNIQU5ORUxfSU5WQUxJRCIgPyA0
MDAgOiA1MDA7CiAgICByZXMuc3RhdHVzKHN0YXR1cykuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6IHN0YXR1cyA9PT0gNDAwID8gIk5vbSBvdSB0eXBlIGRl
IHNhbG9uIGludmFsaWRlLiIgOiAiSW1wb3NzaWJsZSBkZSBjcsOpZXIgY2V0IMOpbMOpbWVudC4iIH0pOwogIH0KfSk7CgphcHAucGF0Y2goIi9hcGkvc2Vy
dmVycy86aWQvY2hhbm5lbHMvOmNoYW5uZWxJZCIsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vz
c2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICBpZiAoIShhd2FpdCBwZW9wbGVDYW5NYW5hZ2VTZXJ2ZXJD
aGFubmVscyhzZXNzaW9uLmlkLCByZXEucGFyYW1zLmlkLCByZXEucGFyYW1zLmNoYW5uZWxJZCkpKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMyku
anNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGfDqXJlciBjZSBzYWxvbi4iIH0pOwogICAgfQogICAgY29u
c3QgY2hhbm5lbCA9IGF3YWl0IHBlb3BsZVVwZGF0ZVNlcnZlckNoYW5uZWwocmVxLnBhcmFtcy5pZCwgcmVxLnBhcmFtcy5jaGFubmVsSWQsIHJlcS5ib2R5
IHx8IHt9KTsKICAgIGlmICghY2hhbm5lbCkgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlNhbG9uIGludHJvdXZh
YmxlLiIgfSk7CiAgICBhd2FpdCBwZW9wbGVCcm9hZGNhc3RTZXJ2ZXJDaGFubmVscyhyZXEucGFyYW1zLmlkKTsKICAgIHJlcy5qc29uKHsgb2s6IHRydWUs
IGNoYW5uZWwgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zdCBzdGF0dXMgPSBlcnI/LmNvZGUgPT09ICJDSEFOTkVMX0lOVkFMSUQiID8gNDAwIDog
NTAwOwogICAgcmVzLnN0YXR1cyhzdGF0dXMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiBzdGF0dXMgPT09IDQwMCA/ICJOb20gZGUgc2Fsb24gaW52YWxp
ZGUuIiA6ICJJbXBvc3NpYmxlIGRlIG1vZGlmaWVyIGNldCDDqWzDqW1lbnQuIiB9KTsKICB9Cn0pOwoKYXBwLmRlbGV0ZSgiL2FwaS9zZXJ2ZXJzLzppZC9j
aGFubmVscy86Y2hhbm5lbElkIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVx
dWVzdChyZXEsIHJlcyk7CiAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKICAgIGlmICghKGF3YWl0IHBlb3BsZUNhbk1hbmFnZVNlcnZlckNoYW5uZWxzKHNl
c3Npb24uaWQsIHJlcS5wYXJhbXMuaWQsIHJlcS5wYXJhbXMuY2hhbm5lbElkKSkpIHsKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsgb2s6
IGZhbHNlLCBlcnJvcjogIlR1IG4nYXMgcGFzIGxhIHBlcm1pc3Npb24gZGUgZ8OpcmVyIGNlIHNhbG9uLiIgfSk7CiAgICB9CiAgICBjb25zdCByZXN1bHQg
PSBhd2FpdCBwZW9wbGVEZWxldGVTZXJ2ZXJDaGFubmVsKHJlcS5wYXJhbXMuaWQsIHJlcS5wYXJhbXMuY2hhbm5lbElkKTsKICAgIGlmICghcmVzdWx0Lm9r
ICYmIHJlc3VsdC5jb2RlID09PSAiTEFTVF9URVhUIikgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAi
VW4gc2VydmV1ciBkb2l0IGdhcmRlciBhdSBtb2lucyB1biBzYWxvbiB0ZXh0dWVsLiIgfSk7CiAgICB9CiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuIHJl
cy5zdGF0dXMoNDA0KS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlNhbG9uIGludHJvdXZhYmxlLiIgfSk7CiAgICBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVl
RHJvcENoYW5uZWwocmVxLnBhcmFtcy5pZCwgcmVxLnBhcmFtcy5jaGFubmVsSWQpOwogICAgYXdhaXQgcGVvcGxlQnJvYWRjYXN0U2VydmVyQ2hhbm5lbHMo
cmVxLnBhcmFtcy5pZCk7CiAgICByZXMuanNvbih7IG9rOiB0cnVlIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBj
aGFubmVscy9kZWxldGVdIiwgZXJyKTsKICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZGUgc3VwcHJp
bWVyIGNldCDDqWzDqW1lbnQuIiB9KTsKICB9Cn0pOwovLyA9PT0gUEVPUExFX1NFUlZFUl9DSEFOTkVMU19WMl9FTkQgPT09CgovLyA9PT0gUEVPUExFX1JP
TEVTX1BFUk1JU1NJT05TX1YxX1NUQVJUID09PQpjb25zdCBQRU9QTEVfUEVSTUlTU0lPTl9ERUZJTklUSU9OUyA9IE9iamVjdC5mcmVlemUoWwogIHsga2V5
OiAiVklFV19DSEFOTkVMIiwgYml0OiAxIDw8IDAsIGxhYmVsOiAiVm9pciBsZXMgc2Fsb25zIiwgZ3JvdXA6ICJTYWxvbnMiIH0sCiAgeyBrZXk6ICJTRU5E
X01FU1NBR0VTIiwgYml0OiAxIDw8IDEsIGxhYmVsOiAiRW52b3llciBkZXMgbWVzc2FnZXMiLCBncm91cDogIlRleHRlIiB9LAogIHsga2V5OiAiQVRUQUNI
X0ZJTEVTIiwgYml0OiAxIDw8IDIsIGxhYmVsOiAiSm9pbmRyZSBkZXMgZmljaGllcnMiLCBncm91cDogIlRleHRlIiB9LAogIHsga2V5OiAiQUREX1JFQUNU
SU9OUyIsIGJpdDogMSA8PCAzLCBsYWJlbDogIkFqb3V0ZXIgZGVzIHLDqWFjdGlvbnMiLCBncm91cDogIlRleHRlIiB9LAogIHsga2V5OiAiQ09OTkVDVCIs
IGJpdDogMSA8PCA0LCBsYWJlbDogIlJlam9pbmRyZSBsZXMgdm9jYXV4IiwgZ3JvdXA6ICJWb2NhbCIgfSwKICB7IGtleTogIlNQRUFLIiwgYml0OiAxIDw8
IDUsIGxhYmVsOiAiUGFybGVyIiwgZ3JvdXA6ICJWb2NhbCIgfSwKICB7IGtleTogIlNUUkVBTSIsIGJpdDogMSA8PCA2LCBsYWJlbDogIkNhbcOpcmEgZXQg
cGFydGFnZSBkJ8OpY3JhbiIsIGdyb3VwOiAiVm9jYWwiIH0sCiAgeyBrZXk6ICJDUkVBVEVfSU5WSVRFIiwgYml0OiAxIDw8IDcsIGxhYmVsOiAiQ3LDqWVy
IC8gY29waWVyIGRlcyBpbnZpdGF0aW9ucyIsIGdyb3VwOiAiU2VydmV1ciIgfSwKICB7IGtleTogIk1BTkFHRV9NRVNTQUdFUyIsIGJpdDogMSA8PCA4LCBs
YWJlbDogIkfDqXJlciBsZXMgbWVzc2FnZXMiLCBncm91cDogIk1vZMOpcmF0aW9uIiB9LAogIHsga2V5OiAiTUFOQUdFX0NIQU5ORUxTIiwgYml0OiAxIDw8
IDksIGxhYmVsOiAiR8OpcmVyIGxlcyBzYWxvbnMiLCBncm91cDogIlNlcnZldXIiIH0sCiAgeyBrZXk6ICJNQU5BR0VfUk9MRVMiLCBiaXQ6IDEgPDwgMTAs
IGxhYmVsOiAiR8OpcmVyIGxlcyByw7RsZXMiLCBncm91cDogIlNlcnZldXIiIH0sCiAgeyBrZXk6ICJLSUNLX01FTUJFUlMiLCBiaXQ6IDEgPDwgMTEsIGxh
YmVsOiAiRXhjbHVyZSBkZXMgbWVtYnJlcyIsIGdyb3VwOiAiTW9kw6lyYXRpb24iIH0sCiAgeyBrZXk6ICJCQU5fTUVNQkVSUyIsIGJpdDogMSA8PCAxMiwg
bGFiZWw6ICJCYW5uaXIgZGVzIG1lbWJyZXMiLCBncm91cDogIk1vZMOpcmF0aW9uIiB9LAogIHsga2V5OiAiTUFOQUdFX1NFUlZFUiIsIGJpdDogMSA8PCAx
MywgbGFiZWw6ICJHw6lyZXIgbGUgc2VydmV1ciIsIGdyb3VwOiAiU2VydmV1ciIgfSwKICB7IGtleTogIkFETUlOSVNUUkFUT1IiLCBiaXQ6IDEgPDwgMTQs
IGxhYmVsOiAiQWRtaW5pc3RyYXRldXIiLCBncm91cDogIkF2YW5jw6kiIH0KXSk7Cgpjb25zdCBQRU9QTEVfUEVSTUlTU0lPTl9CWV9LRVkgPSBuZXcgTWFw
KAogIFBFT1BMRV9QRVJNSVNTSU9OX0RFRklOSVRJT05TLm1hcCgoaXRlbSkgPT4gW2l0ZW0ua2V5LCBpdGVtXSkKKTsKY29uc3QgUEVPUExFX1BFUk1JU1NJ
T05fQUxMX01BU0sgPSBQRU9QTEVfUEVSTUlTU0lPTl9ERUZJTklUSU9OUy5yZWR1Y2UoCiAgKG1hc2ssIGl0ZW0pID0+IG1hc2sgfCBpdGVtLmJpdCwKICAw
Cik7CmNvbnN0IFBFT1BMRV9QRVJNSVNTSU9OX0VWRVJZT05FX0RFRkFVTFQgPSBbCiAgIlZJRVdfQ0hBTk5FTCIsCiAgIlNFTkRfTUVTU0FHRVMiLAogICJB
VFRBQ0hfRklMRVMiLAogICJBRERfUkVBQ1RJT05TIiwKICAiQ09OTkVDVCIsCiAgIlNQRUFLIiwKICAiU1RSRUFNIiwKICAiQ1JFQVRFX0lOVklURSIKXS5y
ZWR1Y2UoKG1hc2ssIGtleSkgPT4gbWFzayB8IFBFT1BMRV9QRVJNSVNTSU9OX0JZX0tFWS5nZXQoa2V5KS5iaXQsIDApOwoKZnVuY3Rpb24gcGVvcGxlUGVy
bWlzc2lvbk1hc2sodmFsdWUpIHsKICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHsKICAgIHJldHVybiB2YWx1ZS5yZWR1Y2UoKG1hc2ssIGtleSkgPT4g
ewogICAgICBjb25zdCBpdGVtID0gUEVPUExFX1BFUk1JU1NJT05fQllfS0VZLmdldChTdHJpbmcoa2V5IHx8ICIiKS50cmltKCkudG9VcHBlckNhc2UoKSk7
CiAgICAgIHJldHVybiBpdGVtID8gKG1hc2sgfCBpdGVtLmJpdCkgOiBtYXNrOwogICAgfSwgMCkgJiBQRU9QTEVfUEVSTUlTU0lPTl9BTExfTUFTSzsKICB9
CiAgY29uc3QgbnVtYmVyID0gTnVtYmVyKHZhbHVlKTsKICBpZiAoIU51bWJlci5pc0Zpbml0ZShudW1iZXIpKSByZXR1cm4gMDsKICByZXR1cm4gKE1hdGgu
bWF4KDAsIE1hdGguZmxvb3IobnVtYmVyKSkgJiBQRU9QTEVfUEVSTUlTU0lPTl9BTExfTUFTSyk7Cn0KCmZ1bmN0aW9uIHBlb3BsZVBlcm1pc3Npb25OYW1l
cyhtYXNrKSB7CiAgY29uc3QgdmFsdWUgPSBwZW9wbGVQZXJtaXNzaW9uTWFzayhtYXNrKTsKICByZXR1cm4gUEVPUExFX1BFUk1JU1NJT05fREVGSU5JVElP
TlMKICAgIC5maWx0ZXIoKGl0ZW0pID0+ICh2YWx1ZSAmIGl0ZW0uYml0KSA9PT0gaXRlbS5iaXQpCiAgICAubWFwKChpdGVtKSA9PiBpdGVtLmtleSk7Cn0K
CmZ1bmN0aW9uIHBlb3BsZVBlcm1pc3Npb25IYXMobWFzaywga2V5KSB7CiAgY29uc3QgaXRlbSA9IFBFT1BMRV9QRVJNSVNTSU9OX0JZX0tFWS5nZXQoU3Ry
aW5nKGtleSB8fCAiIikudHJpbSgpLnRvVXBwZXJDYXNlKCkpOwogIGlmICghaXRlbSkgcmV0dXJuIGZhbHNlOwogIGNvbnN0IHZhbHVlID0gcGVvcGxlUGVy
bWlzc2lvbk1hc2sobWFzayk7CiAgcmV0dXJuICh2YWx1ZSAmIFBFT1BMRV9QRVJNSVNTSU9OX0JZX0tFWS5nZXQoIkFETUlOSVNUUkFUT1IiKS5iaXQpICE9
PSAwIHx8CiAgICAodmFsdWUgJiBpdGVtLmJpdCkgPT09IGl0ZW0uYml0Owp9CgpmdW5jdGlvbiBwZW9wbGVSb2xlTmFtZSh2YWx1ZSkgewogIHJldHVybiBT
dHJpbmcodmFsdWUgfHwgIiIpCiAgICAubm9ybWFsaXplKCJORktDIikKICAgIC50cmltKCkKICAgIC5yZXBsYWNlKC9ccysvZywgIiAiKQogICAgLnNsaWNl
KDAsIDMyKTsKfQoKZnVuY3Rpb24gcGVvcGxlUm9sZUNvbG9yKHZhbHVlKSB7CiAgY29uc3QgY2xlYW4gPSBTdHJpbmcodmFsdWUgfHwgIiIpLnRyaW0oKS50
b1VwcGVyQ2FzZSgpOwogIHJldHVybiAvXiNbMC05QS1GXXs2fSQvLnRlc3QoY2xlYW4pID8gY2xlYW4gOiAiIzk5QUFCNSI7Cn0KCmZ1bmN0aW9uIHBlb3Bs
ZVJvbGVQdWJsaWMocm9sZSkgewogIGlmICghcm9sZSkgcmV0dXJuIG51bGw7CiAgcmV0dXJuIHsKICAgIGlkOiBTdHJpbmcocm9sZS5pZCksCiAgICBzZXJ2
ZXJJZDogU3RyaW5nKHJvbGUuc2VydmVySWQgPz8gcm9sZS5zZXJ2ZXJfaWQgPz8gIiIpLAogICAgbmFtZTogU3RyaW5nKHJvbGUubmFtZSB8fCAiUsO0bGUi
KSwKICAgIGNvbG9yOiBwZW9wbGVSb2xlQ29sb3Iocm9sZS5jb2xvciB8fCAiIzk5QUFCNSIpLAogICAgcG9zaXRpb246IE51bWJlcihyb2xlLnBvc2l0aW9u
IHx8IDApLAogICAgZXZlcnlvbmU6IEJvb2xlYW4ocm9sZS5ldmVyeW9uZSA/PyByb2xlLmlzX2V2ZXJ5b25lKSwKICAgIHBlcm1pc3Npb25zOiBwZW9wbGVQ
ZXJtaXNzaW9uTmFtZXMocm9sZS5wZXJtaXNzaW9ucyA/PyByb2xlLnBlcm1pc3Npb25fbWFzayA/PyAwKSwKICAgIHBlcm1pc3Npb25NYXNrOiBwZW9wbGVQ
ZXJtaXNzaW9uTWFzayhyb2xlLnBlcm1pc3Npb25zID8/IHJvbGUucGVybWlzc2lvbl9tYXNrID8/IDApLAogICAgY3JlYXRlZEF0OiByb2xlLmNyZWF0ZWRB
dCA/PyByb2xlLmNyZWF0ZWRfYXQgPz8gbnVsbAogIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUVuc3VyZVNlcnZlckV2ZXJ5b25lUm9sZShzZXJ2ZXJJ
ZCkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIikudHJpbSgpOwogIGlmICghc2lkKSByZXR1cm4gbnVsbDsKCiAgaWYgKHBlb3BsZVBv
b2wpIHsKICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlNFTEVDVCBpZCwgc2VydmVyX2lkLCBuYW1lLCBjb2xv
ciwgcGVybWlzc2lvbnMsIHBvc2l0aW9uLCBpc19ldmVyeW9uZSwgY3JlYXRlZF9hdCAiICsKICAgICAgIkZST00gcGVvcGxlX3NlcnZlcl9yb2xlcyBXSEVS
RSBzZXJ2ZXJfaWQgPSAkMSBBTkQgaXNfZXZlcnlvbmUgPSBUUlVFIExJTUlUIDEiLAogICAgICBbc2lkXQogICAgKTsKICAgIGlmIChleGlzdGluZy5yb3dz
WzBdKSByZXR1cm4gcGVvcGxlUm9sZVB1YmxpYyhleGlzdGluZy5yb3dzWzBdKTsKCiAgICBjb25zdCBpbnNlcnRlZCA9IGF3YWl0IHBlb3BsZVBvb2wucXVl
cnkoCiAgICAgICJJTlNFUlQgSU5UTyBwZW9wbGVfc2VydmVyX3JvbGVzICIgKwogICAgICAiKHNlcnZlcl9pZCwgbmFtZSwgY29sb3IsIHBlcm1pc3Npb25z
LCBwb3NpdGlvbiwgaXNfZXZlcnlvbmUpICIgKwogICAgICAiVkFMVUVTICgkMSwgJ0BldmVyeW9uZScsICcjOTlBQUI1JywgJDIsIDAsIFRSVUUpICIgKwog
ICAgICAiUkVUVVJOSU5HIGlkLCBzZXJ2ZXJfaWQsIG5hbWUsIGNvbG9yLCBwZXJtaXNzaW9ucywgcG9zaXRpb24sIGlzX2V2ZXJ5b25lLCBjcmVhdGVkX2F0
IiwKICAgICAgW3NpZCwgUEVPUExFX1BFUk1JU1NJT05fRVZFUllPTkVfREVGQVVMVF0KICAgICk7CiAgICByZXR1cm4gcGVvcGxlUm9sZVB1YmxpYyhpbnNl
cnRlZC5yb3dzWzBdKTsKICB9CgogIGNvbnN0IGRhdGEgPSBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CiAgZGF0YS5yb2xlcyA9IEFycmF5LmlzQXJyYXko
ZGF0YS5yb2xlcykgPyBkYXRhLnJvbGVzIDogW107CiAgbGV0IHJvbGUgPSBkYXRhLnJvbGVzLmZpbmQoKGl0ZW0pID0+CiAgICBTdHJpbmcoaXRlbS5zZXJ2
ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJiBCb29sZWFuKGl0ZW0uZXZlcnlvbmUgPz8gaXRlbS5pc19ldmVyeW9uZSkKICApOwog
IGlmICghcm9sZSkgewogICAgcm9sZSA9IHsKICAgICAgaWQ6IGNyeXB0b0FjY291bnRzLnJhbmRvbVVVSUQoKSwKICAgICAgc2VydmVySWQ6IHNpZCwKICAg
ICAgbmFtZTogIkBldmVyeW9uZSIsCiAgICAgIGNvbG9yOiAiIzk5QUFCNSIsCiAgICAgIHBlcm1pc3Npb25zOiBQRU9QTEVfUEVSTUlTU0lPTl9FVkVSWU9O
RV9ERUZBVUxULAogICAgICBwb3NpdGlvbjogMCwKICAgICAgZXZlcnlvbmU6IHRydWUsCiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmlu
ZygpCiAgICB9OwogICAgZGF0YS5yb2xlcy5wdXNoKHJvbGUpOwogICAgcGVvcGxlV3JpdGVMb2NhbFNlcnZlcnMoZGF0YSk7CiAgfQogIHJldHVybiBwZW9w
bGVSb2xlUHVibGljKHJvbGUpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVMaXN0U2VydmVyUm9sZXMoc2VydmVySWQpIHsKICBjb25zdCBzaWQgPSBTdHJp
bmcoc2VydmVySWQgfHwgIiIpLnRyaW0oKTsKICBpZiAoIXNpZCkgcmV0dXJuIFtdOwogIGF3YWl0IHBlb3BsZUVuc3VyZVNlcnZlckV2ZXJ5b25lUm9sZShz
aWQpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlNFTEVDVCBpZCwgc2Vy
dmVyX2lkLCBuYW1lLCBjb2xvciwgcGVybWlzc2lvbnMsIHBvc2l0aW9uLCBpc19ldmVyeW9uZSwgY3JlYXRlZF9hdCAiICsKICAgICAgIkZST00gcGVvcGxl
X3NlcnZlcl9yb2xlcyBXSEVSRSBzZXJ2ZXJfaWQgPSAkMSBPUkRFUiBCWSBwb3NpdGlvbiBERVNDLCBpZCBBU0MiLAogICAgICBbc2lkXQogICAgKTsKICAg
IHJldHVybiByZXN1bHQucm93cy5tYXAocGVvcGxlUm9sZVB1YmxpYyk7CiAgfQoKICByZXR1cm4gcGVvcGxlUmVhZExvY2FsU2VydmVycygpLnJvbGVzCiAg
ICAuZmlsdGVyKChyb2xlKSA9PiBTdHJpbmcocm9sZS5zZXJ2ZXJJZCA/PyByb2xlLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCkKICAgIC5tYXAocGVvcGxl
Um9sZVB1YmxpYykKICAgIC5zb3J0KChhLCBiKSA9PiAoYi5wb3NpdGlvbiAtIGEucG9zaXRpb24pIHx8IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSwg
ImZyIikpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVHZXRTZXJ2ZXJSb2xlKHNlcnZlcklkLCByb2xlSWQpIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2Vy
dmVySWQgfHwgIiIpLnRyaW0oKTsKICBjb25zdCByaWQgPSBTdHJpbmcocm9sZUlkIHx8ICIiKS50cmltKCk7CiAgaWYgKCFzaWQgfHwgIXJpZCkgcmV0dXJu
IG51bGw7CiAgY29uc3Qgcm9sZXMgPSBhd2FpdCBwZW9wbGVMaXN0U2VydmVyUm9sZXMoc2lkKTsKICByZXR1cm4gcm9sZXMuZmluZCgocm9sZSkgPT4gU3Ry
aW5nKHJvbGUuaWQpID09PSByaWQpIHx8IG51bGw7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZU1lbWJlclJvbGVJZHMoc2VydmVySWQsIGFjY291bnRJZCkg
ewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgdWlkID0gU3RyaW5nKGFjY291bnRJZCB8fCAiIik7CiAgaWYgKCFzaWQg
fHwgIXVpZCkgcmV0dXJuIFtdOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAg
IlNFTEVDVCByb2xlX2lkIEZST00gcGVvcGxlX3NlcnZlcl9tZW1iZXJfcm9sZXMgV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIHVzZXJfaWQgPSAkMiIsCiAg
ICAgIFtzaWQsIHVpZF0KICAgICk7CiAgICByZXR1cm4gcmVzdWx0LnJvd3MubWFwKChyb3cpID0+IFN0cmluZyhyb3cucm9sZV9pZCkpOwogIH0KCiAgcmV0
dXJuIHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKS5tZW1iZXJSb2xlcwogICAgLmZpbHRlcigoaXRlbSkgPT4KICAgICAgU3RyaW5nKGl0ZW0uc2VydmVySWQg
Pz8gaXRlbS5zZXJ2ZXJfaWQgPz8gIiIpID09PSBzaWQgJiYKICAgICAgU3RyaW5nKGl0ZW0udXNlcklkID8/IGl0ZW0udXNlcl9pZCA/PyAiIikgPT09IHVp
ZAogICAgKQogICAgLm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0ucm9sZUlkID8/IGl0ZW0ucm9sZV9pZCA/PyAiIikpCiAgICAuZmlsdGVyKEJvb2xlYW4p
Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJSb2xlU3RhdGUoYWNjb3VudElkLCBzZXJ2ZXJJZCkgewogIGNvbnN0IHVpZCA9IFN0cmluZyhhY2Nv
dW50SWQgfHwgIiIpOwogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3Qgc2VydmVyID0gYXdhaXQgcGVvcGxlR2V0U2VydmVy
KHNpZCk7CiAgaWYgKCFzZXJ2ZXIgfHwgIXVpZCB8fCAhKGF3YWl0IHBlb3BsZUlzU2VydmVyTWVtYmVyKHVpZCwgc2lkKSkpIHsKICAgIHJldHVybiBudWxs
OwogIH0KCiAgY29uc3Qgcm9sZXMgPSBhd2FpdCBwZW9wbGVMaXN0U2VydmVyUm9sZXMoc2lkKTsKICBjb25zdCBldmVyeW9uZSA9IHJvbGVzLmZpbmQoKHJv
bGUpID0+IHJvbGUuZXZlcnlvbmUpIHx8IG51bGw7CiAgY29uc3Qgcm9sZUlkcyA9IG5ldyBTZXQoYXdhaXQgcGVvcGxlTWVtYmVyUm9sZUlkcyhzaWQsIHVp
ZCkpOwogIGNvbnN0IGFzc2lnbmVkID0gcm9sZXMuZmlsdGVyKChyb2xlKSA9PiAhcm9sZS5ldmVyeW9uZSAmJiByb2xlSWRzLmhhcyhTdHJpbmcocm9sZS5p
ZCkpKTsKICBjb25zdCBvd25lciA9IEJvb2xlYW4oc2VydmVyLm93bmVySWQgJiYgU3RyaW5nKHNlcnZlci5vd25lcklkKSA9PT0gdWlkKTsKICBsZXQgbWFz
ayA9IHBlb3BsZVBlcm1pc3Npb25NYXNrKGV2ZXJ5b25lPy5wZXJtaXNzaW9uTWFzayB8fCAwKTsKICBmb3IgKGNvbnN0IHJvbGUgb2YgYXNzaWduZWQpIG1h
c2sgfD0gcGVvcGxlUGVybWlzc2lvbk1hc2socm9sZS5wZXJtaXNzaW9uTWFzayk7CiAgaWYgKHBlb3BsZVBlcm1pc3Npb25IYXMobWFzaywgIkFETUlOSVNU
UkFUT1IiKSB8fCBvd25lcikgbWFzayA9IFBFT1BMRV9QRVJNSVNTSU9OX0FMTF9NQVNLOwogIGNvbnN0IGhpZ2hlc3RSb2xlUG9zaXRpb24gPSBvd25lcgog
ICAgPyAxMDAwMDAwMDAwCiAgICA6IGFzc2lnbmVkLnJlZHVjZSgobWF4LCByb2xlKSA9PiBNYXRoLm1heChtYXgsIE51bWJlcihyb2xlLnBvc2l0aW9uIHx8
IDApKSwgMCk7CgogIHJldHVybiB7IHNlcnZlciwgcm9sZXMsIGV2ZXJ5b25lLCBhc3NpZ25lZCwgcm9sZUlkcywgb3duZXIsIG1hc2ssIGhpZ2hlc3RSb2xl
UG9zaXRpb24gfTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlTGlzdENoYW5uZWxSb2xlT3ZlcnJpZGVzKHNlcnZlcklkLCBjaGFubmVsSWQpIHsKICBjb25z
dCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGlmICghc2lkIHx8ICFjaWQp
IHJldHVybiBbXTsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1Qg
c2VydmVyX2lkLCBjaGFubmVsX2lkLCByb2xlX2lkLCBhbGxvd19wZXJtaXNzaW9ucywgZGVueV9wZXJtaXNzaW9ucyAiICsKICAgICAgIkZST00gcGVvcGxl
X3NlcnZlcl9yb2xlX2NoYW5uZWxfb3ZlcnJpZGVzIFdIRVJFIHNlcnZlcl9pZCA9ICQxIEFORCBjaGFubmVsX2lkID0gJDIiLAogICAgICBbc2lkLCBjaWRd
CiAgICApOwogICAgcmV0dXJuIHJlc3VsdC5yb3dzLm1hcCgocm93KSA9PiAoewogICAgICBzZXJ2ZXJJZDogU3RyaW5nKHJvdy5zZXJ2ZXJfaWQpLAogICAg
ICBjaGFubmVsSWQ6IFN0cmluZyhyb3cuY2hhbm5lbF9pZCksCiAgICAgIHJvbGVJZDogU3RyaW5nKHJvdy5yb2xlX2lkKSwKICAgICAgYWxsb3c6IHBlb3Bs
ZVBlcm1pc3Npb25NYXNrKHJvdy5hbGxvd19wZXJtaXNzaW9ucyksCiAgICAgIGRlbnk6IHBlb3BsZVBlcm1pc3Npb25NYXNrKHJvdy5kZW55X3Blcm1pc3Np
b25zKQogICAgfSkpOwogIH0KCiAgcmV0dXJuIHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKS5wZXJtaXNzaW9uT3ZlcnJpZGVzCiAgICAuZmlsdGVyKChpdGVt
KSA9PgogICAgICBTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJgogICAgICBTdHJpbmcoaXRlbS5jaGFu
bmVsSWQgPz8gaXRlbS5jaGFubmVsX2lkID8/ICIiKSA9PT0gY2lkCiAgICApCiAgICAubWFwKChpdGVtKSA9PiAoewogICAgICBzZXJ2ZXJJZDogc2lkLAog
ICAgICBjaGFubmVsSWQ6IGNpZCwKICAgICAgcm9sZUlkOiBTdHJpbmcoaXRlbS5yb2xlSWQgPz8gaXRlbS5yb2xlX2lkID8/ICIiKSwKICAgICAgYWxsb3c6
IHBlb3BsZVBlcm1pc3Npb25NYXNrKGl0ZW0uYWxsb3cgPz8gaXRlbS5hbGxvd19wZXJtaXNzaW9ucyksCiAgICAgIGRlbnk6IHBlb3BsZVBlcm1pc3Npb25N
YXNrKGl0ZW0uZGVueSA/PyBpdGVtLmRlbnlfcGVybWlzc2lvbnMpCiAgICB9KSk7Cn0KCmZ1bmN0aW9uIHBlb3BsZUFwcGx5Um9sZU92ZXJyaWRlTGV2ZWwo
bWFzaywgcm9sZVN0YXRlLCBvdmVycmlkZXMpIHsKICBsZXQgcmVzdWx0ID0gcGVvcGxlUGVybWlzc2lvbk1hc2sobWFzayk7CiAgaWYgKCFyb2xlU3RhdGUg
fHwgcm9sZVN0YXRlLm93bmVyIHx8IHBlb3BsZVBlcm1pc3Npb25IYXMocmVzdWx0LCAiQURNSU5JU1RSQVRPUiIpKSB7CiAgICByZXR1cm4gUEVPUExFX1BF
Uk1JU1NJT05fQUxMX01BU0s7CiAgfQoKICBjb25zdCBldmVyeW9uZUlkID0gcm9sZVN0YXRlLmV2ZXJ5b25lID8gU3RyaW5nKHJvbGVTdGF0ZS5ldmVyeW9u
ZS5pZCkgOiAiIjsKICBjb25zdCBldmVyeW9uZU92ZXJyaWRlID0gb3ZlcnJpZGVzLmZpbmQoKGl0ZW0pID0+IFN0cmluZyhpdGVtLnJvbGVJZCkgPT09IGV2
ZXJ5b25lSWQpOwogIGlmIChldmVyeW9uZU92ZXJyaWRlKSB7CiAgICByZXN1bHQgJj0gfnBlb3BsZVBlcm1pc3Npb25NYXNrKGV2ZXJ5b25lT3ZlcnJpZGUu
ZGVueSk7CiAgICByZXN1bHQgfD0gcGVvcGxlUGVybWlzc2lvbk1hc2soZXZlcnlvbmVPdmVycmlkZS5hbGxvdyk7CiAgfQoKICBsZXQgcm9sZURlbnkgPSAw
OwogIGxldCByb2xlQWxsb3cgPSAwOwogIGZvciAoY29uc3Qgcm9sZSBvZiByb2xlU3RhdGUuYXNzaWduZWQpIHsKICAgIGNvbnN0IG92ZXJyaWRlID0gb3Zl
cnJpZGVzLmZpbmQoKGl0ZW0pID0+IFN0cmluZyhpdGVtLnJvbGVJZCkgPT09IFN0cmluZyhyb2xlLmlkKSk7CiAgICBpZiAoIW92ZXJyaWRlKSBjb250aW51
ZTsKICAgIHJvbGVEZW55IHw9IHBlb3BsZVBlcm1pc3Npb25NYXNrKG92ZXJyaWRlLmRlbnkpOwogICAgcm9sZUFsbG93IHw9IHBlb3BsZVBlcm1pc3Npb25N
YXNrKG92ZXJyaWRlLmFsbG93KTsKICB9CiAgcmVzdWx0ICY9IH5yb2xlRGVueTsKICByZXN1bHQgfD0gcm9sZUFsbG93OwogIHJldHVybiByZXN1bHQgJiBQ
RU9QTEVfUEVSTUlTU0lPTl9BTExfTUFTSzsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2VydmVyRWZmZWN0aXZlUGVybWlzc2lvbk1hc2soYWNjb3VudElk
LCBzZXJ2ZXJJZCwgY2hhbm5lbElkID0gbnVsbCkgewogIGNvbnN0IHN0YXRlID0gYXdhaXQgcGVvcGxlU2VydmVyUm9sZVN0YXRlKGFjY291bnRJZCwgc2Vy
dmVySWQpOwogIGlmICghc3RhdGUpIHJldHVybiAwOwogIGlmIChzdGF0ZS5vd25lciB8fCBwZW9wbGVQZXJtaXNzaW9uSGFzKHN0YXRlLm1hc2ssICJBRE1J
TklTVFJBVE9SIikpIHsKICAgIHJldHVybiBQRU9QTEVfUEVSTUlTU0lPTl9BTExfTUFTSzsKICB9CgogIGxldCBtYXNrID0gc3RhdGUubWFzazsKICBjb25z
dCBjaWQgPSBjaGFubmVsSWQgPyBTdHJpbmcoY2hhbm5lbElkKSA6ICIiOwogIGlmICghY2lkKSByZXR1cm4gbWFzazsKCiAgY29uc3QgY2hhbm5lbCA9IGF3
YWl0IHBlb3BsZUdldFNlcnZlckNoYW5uZWwoc2VydmVySWQsIGNpZCk7CiAgaWYgKCFjaGFubmVsKSByZXR1cm4gMDsKCiAgaWYgKGNoYW5uZWwucGFyZW50
SWQpIHsKICAgIGNvbnN0IGNhdGVnb3J5T3ZlcnJpZGVzID0gYXdhaXQgcGVvcGxlTGlzdENoYW5uZWxSb2xlT3ZlcnJpZGVzKHNlcnZlcklkLCBjaGFubmVs
LnBhcmVudElkKTsKICAgIG1hc2sgPSBwZW9wbGVBcHBseVJvbGVPdmVycmlkZUxldmVsKG1hc2ssIHN0YXRlLCBjYXRlZ29yeU92ZXJyaWRlcyk7CiAgfQog
IGNvbnN0IGNoYW5uZWxPdmVycmlkZXMgPSBhd2FpdCBwZW9wbGVMaXN0Q2hhbm5lbFJvbGVPdmVycmlkZXMoc2VydmVySWQsIGNpZCk7CiAgbWFzayA9IHBl
b3BsZUFwcGx5Um9sZU92ZXJyaWRlTGV2ZWwobWFzaywgc3RhdGUsIGNoYW5uZWxPdmVycmlkZXMpOwogIHJldHVybiBtYXNrOwp9Cgphc3luYyBmdW5jdGlv
biBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKGFjY291bnRJZCwgc2VydmVySWQsIHBlcm1pc3Npb24sIGNoYW5uZWxJZCA9IG51bGwpIHsKICBjb25zdCBt
YXNrID0gYXdhaXQgcGVvcGxlU2VydmVyRWZmZWN0aXZlUGVybWlzc2lvbk1hc2soYWNjb3VudElkLCBzZXJ2ZXJJZCwgY2hhbm5lbElkKTsKICByZXR1cm4g
cGVvcGxlUGVybWlzc2lvbkhhcyhtYXNrLCBwZXJtaXNzaW9uKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlUGVybWlzc2lvblNuYXBzaG90KGFjY291bnRJ
ZCwgc2VydmVySWQsIGNoYW5uZWxJZCA9IG51bGwpIHsKICBjb25zdCBzdGF0ZSA9IGF3YWl0IHBlb3BsZVNlcnZlclJvbGVTdGF0ZShhY2NvdW50SWQsIHNl
cnZlcklkKTsKICBpZiAoIXN0YXRlKSByZXR1cm4geyBtYXNrOiAwLCBuYW1lczogW10sIG93bmVyOiBmYWxzZSwgaGlnaGVzdFJvbGVQb3NpdGlvbjogMCB9
OwogIGNvbnN0IG1hc2sgPSBjaGFubmVsSWQKICAgID8gYXdhaXQgcGVvcGxlU2VydmVyRWZmZWN0aXZlUGVybWlzc2lvbk1hc2soYWNjb3VudElkLCBzZXJ2
ZXJJZCwgY2hhbm5lbElkKQogICAgOiBzdGF0ZS5tYXNrOwogIHJldHVybiB7CiAgICBtYXNrLAogICAgbmFtZXM6IHBlb3BsZVBlcm1pc3Npb25OYW1lcyht
YXNrKSwKICAgIG93bmVyOiBzdGF0ZS5vd25lciwKICAgIGhpZ2hlc3RSb2xlUG9zaXRpb246IHN0YXRlLmhpZ2hlc3RSb2xlUG9zaXRpb24KICB9Owp9Cgph
c3luYyBmdW5jdGlvbiBwZW9wbGVMaXN0VmlzaWJsZVNlcnZlckNoYW5uZWxzKGFjY291bnRJZCwgc2VydmVySWQpIHsKICBjb25zdCBjaGFubmVscyA9IGF3
YWl0IHBlb3BsZUxpc3RTZXJ2ZXJDaGFubmVscyhzZXJ2ZXJJZCk7CiAgY29uc3Qgb3V0cHV0ID0gW107CiAgZm9yIChjb25zdCBjaGFubmVsIG9mIGNoYW5u
ZWxzKSB7CiAgICBjb25zdCBtYXNrID0gYXdhaXQgcGVvcGxlU2VydmVyRWZmZWN0aXZlUGVybWlzc2lvbk1hc2soYWNjb3VudElkLCBzZXJ2ZXJJZCwgY2hh
bm5lbC5pZCk7CiAgICBpZiAoIXBlb3BsZVBlcm1pc3Npb25IYXMobWFzaywgIlZJRVdfQ0hBTk5FTCIpKSBjb250aW51ZTsKICAgIG91dHB1dC5wdXNoKHsK
ICAgICAgLi4uY2hhbm5lbCwKICAgICAgcGVybWlzc2lvbnM6IHBlb3BsZVBlcm1pc3Npb25OYW1lcyhtYXNrKSwKICAgICAgcGVybWlzc2lvbk1hc2s6IG1h
c2sKICAgIH0pOwogIH0KICByZXR1cm4gb3V0cHV0Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVFbWl0U2VydmVyQ2hhbm5lbEV2ZW50KHNlcnZlcklkLCBj
aGFubmVsSWQsIGV2ZW50TmFtZSwgcGF5bG9hZCkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgY2lkID0gU3RyaW5n
KGNoYW5uZWxJZCB8fCAiIik7CiAgaWYgKCFzaWQgfHwgIWV2ZW50TmFtZSkgcmV0dXJuOwogIGNvbnN0IHJvb20gPSBpby5zb2NrZXRzLmFkYXB0ZXIucm9v
bXMuZ2V0KHBlb3BsZVNlcnZlclJvb20oc2lkKSk7CiAgaWYgKCFyb29tKSByZXR1cm47CgogIGNvbnN0IGNhY2hlID0gbmV3IE1hcCgpOwogIGZvciAoY29u
c3Qgc29ja2V0SWQgb2Ygcm9vbSkgewogICAgY29uc3QgdWlkID0gU3RyaW5nKHVzZXJJZHMuZ2V0KHNvY2tldElkKSB8fCAiIik7CiAgICBpZiAoIXVpZCkg
Y29udGludWU7CiAgICBsZXQgYWxsb3dlZCA9IGNhY2hlLmdldCh1aWQpOwogICAgaWYgKGFsbG93ZWQgPT09IHVuZGVmaW5lZCkgewogICAgICBhbGxvd2Vk
ID0gY2lkID8gYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbih1aWQsIHNpZCwgIlZJRVdfQ0hBTk5FTCIsIGNpZCkgOiB0cnVlOwogICAgICBjYWNo
ZS5zZXQodWlkLCBhbGxvd2VkKTsKICAgIH0KICAgIGlmIChhbGxvd2VkKSBpby50byhzb2NrZXRJZCkuZW1pdChldmVudE5hbWUsIHBheWxvYWQpOwogIH0K
fQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlQnJvYWRjYXN0U2VydmVyUGVybWlzc2lvblJlZnJlc2goc2VydmVySWQpIHsKICBjb25zdCBzaWQgPSBTdHJpbmco
c2VydmVySWQgfHwgIiIpOwogIGlmICghc2lkKSByZXR1cm47CiAgYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJlcXVlc3RSb3RhdGlvbkFsbChzaWQsICJwZXJt
aXNzaW9ucyIpOwogIGF3YWl0IHBlb3BsZUJyb2FkY2FzdFNlcnZlckNoYW5uZWxzKHNpZCk7CiAgY29uc3Qgcm9vbSA9IGlvLnNvY2tldHMuYWRhcHRlci5y
b29tcy5nZXQocGVvcGxlU2VydmVyUm9vbShzaWQpKTsKICBpZiAoIXJvb20pIHJldHVybjsKICBjb25zdCBjYWNoZSA9IG5ldyBNYXAoKTsKICBmb3IgKGNv
bnN0IHNvY2tldElkIG9mIHJvb20pIHsKICAgIGNvbnN0IHVpZCA9IFN0cmluZyh1c2VySWRzLmdldChzb2NrZXRJZCkgfHwgIiIpOwogICAgaWYgKCF1aWQp
IGNvbnRpbnVlOwogICAgbGV0IHNuYXBzaG90ID0gY2FjaGUuZ2V0KHVpZCk7CiAgICBpZiAoIXNuYXBzaG90KSB7CiAgICAgIHNuYXBzaG90ID0gYXdhaXQg
cGVvcGxlUGVybWlzc2lvblNuYXBzaG90KHVpZCwgc2lkKTsKICAgICAgY2FjaGUuc2V0KHVpZCwgc25hcHNob3QpOwogICAgfQogICAgaW8udG8oc29ja2V0
SWQpLmVtaXQoInNlcnZlci1wZXJtaXNzaW9ucy11cGRhdGVkIiwgeyBzZXJ2ZXJJZDogc2lkLCBwZXJtaXNzaW9uczogc25hcHNob3QgfSk7CiAgfQp9Cgph
c3luYyBmdW5jdGlvbiBwZW9wbGVDcmVhdGVTZXJ2ZXJSb2xlKHNlcnZlcklkLCBuYW1lLCBjb2xvciwgcGVybWlzc2lvbnMsIGFjdG9yU3RhdGUpIHsKICBj
b25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGNsZWFuTmFtZSA9IHBlb3BsZVJvbGVOYW1lKG5hbWUpOwogIGlmICghc2lkIHx8
ICFjbGVhbk5hbWUgfHwgY2xlYW5OYW1lID09PSAiQGV2ZXJ5b25lIikgewogICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCJST0xFX0lOVkFMSUQiKTsgZXJy
LmNvZGUgPSAiUk9MRV9JTlZBTElEIjsgdGhyb3cgZXJyOwogIH0KICBjb25zdCBjbGVhbk1hc2sgPSBwZW9wbGVQZXJtaXNzaW9uTWFzayhwZXJtaXNzaW9u
cyk7CiAgaWYgKCFhY3RvclN0YXRlPy5vd25lciAmJiAoY2xlYW5NYXNrICYgfmFjdG9yU3RhdGUubWFzaykgIT09IDApIHsKICAgIGNvbnN0IGVyciA9IG5l
dyBFcnJvcigiUk9MRV9QRVJNSVNTSU9OX0VTQ0FMQVRJT04iKTsgZXJyLmNvZGUgPSAiUk9MRV9QRVJNSVNTSU9OX0VTQ0FMQVRJT04iOyB0aHJvdyBlcnI7
CiAgfQogIGNvbnN0IHJvbGVzID0gYXdhaXQgcGVvcGxlTGlzdFNlcnZlclJvbGVzKHNpZCk7CiAgY29uc3QgbWF4UG9zaXRpb24gPSByb2xlcy5yZWR1Y2Uo
KG1heCwgcm9sZSkgPT4gTWF0aC5tYXgobWF4LCBOdW1iZXIocm9sZS5wb3NpdGlvbiB8fCAwKSksIDApOwogIGxldCBwb3NpdGlvbiA9IG1heFBvc2l0aW9u
ICsgMTA7CiAgaWYgKCFhY3RvclN0YXRlPy5vd25lcikgcG9zaXRpb24gPSBNYXRoLm1heCgxLCBNYXRoLm1pbihwb3NpdGlvbiwgYWN0b3JTdGF0ZS5oaWdo
ZXN0Um9sZVBvc2l0aW9uIC0gMSkpOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAg
ICAgIklOU0VSVCBJTlRPIHBlb3BsZV9zZXJ2ZXJfcm9sZXMgKHNlcnZlcl9pZCwgbmFtZSwgY29sb3IsIHBlcm1pc3Npb25zLCBwb3NpdGlvbiwgaXNfZXZl
cnlvbmUpICIgKwogICAgICAiVkFMVUVTICgkMSwgJDIsICQzLCAkNCwgJDUsIEZBTFNFKSAiICsKICAgICAgIlJFVFVSTklORyBpZCwgc2VydmVyX2lkLCBu
YW1lLCBjb2xvciwgcGVybWlzc2lvbnMsIHBvc2l0aW9uLCBpc19ldmVyeW9uZSwgY3JlYXRlZF9hdCIsCiAgICAgIFtzaWQsIGNsZWFuTmFtZSwgcGVvcGxl
Um9sZUNvbG9yKGNvbG9yKSwgY2xlYW5NYXNrLCBwb3NpdGlvbl0KICAgICk7CiAgICByZXR1cm4gcGVvcGxlUm9sZVB1YmxpYyhyZXN1bHQucm93c1swXSk7
CiAgfQoKICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwogIGNvbnN0IHJvbGUgPSB7CiAgICBpZDogY3J5cHRvQWNjb3VudHMucmFu
ZG9tVVVJRCgpLCBzZXJ2ZXJJZDogc2lkLCBuYW1lOiBjbGVhbk5hbWUsCiAgICBjb2xvcjogcGVvcGxlUm9sZUNvbG9yKGNvbG9yKSwgcGVybWlzc2lvbnM6
IGNsZWFuTWFzaywgcG9zaXRpb24sCiAgICBldmVyeW9uZTogZmFsc2UsIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpCiAgfTsKICBkYXRh
LnJvbGVzLnB1c2gocm9sZSk7CiAgcGVvcGxlV3JpdGVMb2NhbFNlcnZlcnMoZGF0YSk7CiAgcmV0dXJuIHBlb3BsZVJvbGVQdWJsaWMocm9sZSk7Cn0KCmFz
eW5jIGZ1bmN0aW9uIHBlb3BsZVVwZGF0ZVNlcnZlclJvbGUoc2VydmVySWQsIHJvbGVJZCwgcGF0Y2gsIGFjdG9yU3RhdGUpIHsKICBjb25zdCBzaWQgPSBT
dHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCBwZW9wbGVHZXRTZXJ2ZXJSb2xlKHNpZCwgcm9sZUlkKTsKICBpZiAoIWN1
cnJlbnQpIHJldHVybiBudWxsOwogIGlmICghYWN0b3JTdGF0ZT8ub3duZXIgJiYgTnVtYmVyKGN1cnJlbnQucG9zaXRpb24gfHwgMCkgPj0gYWN0b3JTdGF0
ZS5oaWdoZXN0Um9sZVBvc2l0aW9uKSB7CiAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIlJPTEVfSElFUkFSQ0hZIik7IGVyci5jb2RlID0gIlJPTEVfSElF
UkFSQ0hZIjsgdGhyb3cgZXJyOwogIH0KCiAgbGV0IG5hbWUgPSBjdXJyZW50Lm5hbWU7CiAgbGV0IGNvbG9yID0gY3VycmVudC5jb2xvcjsKICBsZXQgbWFz
ayA9IGN1cnJlbnQucGVybWlzc2lvbk1hc2s7CiAgbGV0IHBvc2l0aW9uID0gY3VycmVudC5wb3NpdGlvbjsKICBpZiAoIWN1cnJlbnQuZXZlcnlvbmUgJiYg
T2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHBhdGNoIHx8IHt9LCAibmFtZSIpKSB7CiAgICBuYW1lID0gcGVvcGxlUm9sZU5hbWUocGF0
Y2gubmFtZSk7CiAgICBpZiAoIW5hbWUgfHwgbmFtZSA9PT0gIkBldmVyeW9uZSIpIHsgY29uc3QgZXJyID0gbmV3IEVycm9yKCJST0xFX0lOVkFMSUQiKTsg
ZXJyLmNvZGUgPSAiUk9MRV9JTlZBTElEIjsgdGhyb3cgZXJyOyB9CiAgfQogIGlmICghY3VycmVudC5ldmVyeW9uZSAmJiBPYmplY3QucHJvdG90eXBlLmhh
c093blByb3BlcnR5LmNhbGwocGF0Y2ggfHwge30sICJjb2xvciIpKSBjb2xvciA9IHBlb3BsZVJvbGVDb2xvcihwYXRjaC5jb2xvcik7CiAgaWYgKE9iamVj
dC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChwYXRjaCB8fCB7fSwgInBlcm1pc3Npb25zIikpIHsKICAgIG1hc2sgPSBwZW9wbGVQZXJtaXNzaW9u
TWFzayhwYXRjaC5wZXJtaXNzaW9ucyk7CiAgICBpZiAoIWFjdG9yU3RhdGU/Lm93bmVyICYmIChtYXNrICYgfmFjdG9yU3RhdGUubWFzaykgIT09IDApIHsK
ICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCJST0xFX1BFUk1JU1NJT05fRVNDQUxBVElPTiIpOyBlcnIuY29kZSA9ICJST0xFX1BFUk1JU1NJT05fRVND
QUxBVElPTiI7IHRocm93IGVycjsKICAgIH0KICB9CiAgaWYgKCFjdXJyZW50LmV2ZXJ5b25lICYmIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHku
Y2FsbChwYXRjaCB8fCB7fSwgInBvc2l0aW9uIikpIHsKICAgIHBvc2l0aW9uID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihOdW1iZXIocGF0Y2gucG9zaXRp
b24pIHx8IDEpKTsKICAgIGlmICghYWN0b3JTdGF0ZT8ub3duZXIgJiYgcG9zaXRpb24gPj0gYWN0b3JTdGF0ZS5oaWdoZXN0Um9sZVBvc2l0aW9uKSB7CiAg
ICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigiUk9MRV9ISUVSQVJDSFkiKTsgZXJyLmNvZGUgPSAiUk9MRV9ISUVSQVJDSFkiOyB0aHJvdyBlcnI7CiAgICB9
CiAgfQoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlVQREFURSBwZW9wbGVf
c2VydmVyX3JvbGVzIFNFVCBuYW1lID0gJDMsIGNvbG9yID0gJDQsIHBlcm1pc3Npb25zID0gJDUsIHBvc2l0aW9uID0gJDYgIiArCiAgICAgICJXSEVSRSBp
ZCA9ICQxIEFORCBzZXJ2ZXJfaWQgPSAkMiAiICsKICAgICAgIlJFVFVSTklORyBpZCwgc2VydmVyX2lkLCBuYW1lLCBjb2xvciwgcGVybWlzc2lvbnMsIHBv
c2l0aW9uLCBpc19ldmVyeW9uZSwgY3JlYXRlZF9hdCIsCiAgICAgIFtTdHJpbmcoY3VycmVudC5pZCksIHNpZCwgbmFtZSwgY29sb3IsIG1hc2ssIHBvc2l0
aW9uXQogICAgKTsKICAgIHJldHVybiBwZW9wbGVSb2xlUHVibGljKHJlc3VsdC5yb3dzWzBdKTsKICB9CgogIGNvbnN0IGRhdGEgPSBwZW9wbGVSZWFkTG9j
YWxTZXJ2ZXJzKCk7CiAgY29uc3Qgc3RvcmVkID0gZGF0YS5yb2xlcy5maW5kKChyb2xlKSA9PiBTdHJpbmcocm9sZS5pZCkgPT09IFN0cmluZyhjdXJyZW50
LmlkKSAmJiBTdHJpbmcocm9sZS5zZXJ2ZXJJZCA/PyByb2xlLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCk7CiAgaWYgKCFzdG9yZWQpIHJldHVybiBudWxs
OwogIHN0b3JlZC5uYW1lID0gbmFtZTsgc3RvcmVkLmNvbG9yID0gY29sb3I7IHN0b3JlZC5wZXJtaXNzaW9ucyA9IG1hc2s7IHN0b3JlZC5wb3NpdGlvbiA9
IHBvc2l0aW9uOwogIHBlb3BsZVdyaXRlTG9jYWxTZXJ2ZXJzKGRhdGEpOwogIHJldHVybiBwZW9wbGVSb2xlUHVibGljKHN0b3JlZCk7Cn0KCmFzeW5jIGZ1
bmN0aW9uIHBlb3BsZURlbGV0ZVNlcnZlclJvbGUoc2VydmVySWQsIHJvbGVJZCwgYWN0b3JTdGF0ZSkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJ
ZCB8fCAiIik7CiAgY29uc3QgY3VycmVudCA9IGF3YWl0IHBlb3BsZUdldFNlcnZlclJvbGUoc2lkLCByb2xlSWQpOwogIGlmICghY3VycmVudCB8fCBjdXJy
ZW50LmV2ZXJ5b25lKSByZXR1cm4gZmFsc2U7CiAgaWYgKCFhY3RvclN0YXRlPy5vd25lciAmJiBOdW1iZXIoY3VycmVudC5wb3NpdGlvbiB8fCAwKSA+PSBh
Y3RvclN0YXRlLmhpZ2hlc3RSb2xlUG9zaXRpb24pIHsKICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigiUk9MRV9ISUVSQVJDSFkiKTsgZXJyLmNvZGUgPSAi
Uk9MRV9ISUVSQVJDSFkiOyB0aHJvdyBlcnI7CiAgfQoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5x
dWVyeSgKICAgICAgIkRFTEVURSBGUk9NIHBlb3BsZV9zZXJ2ZXJfcm9sZXMgV0hFUkUgaWQgPSAkMSBBTkQgc2VydmVyX2lkID0gJDIgUkVUVVJOSU5HIGlk
IiwKICAgICAgW1N0cmluZyhjdXJyZW50LmlkKSwgc2lkXQogICAgKTsKICAgIHJldHVybiBCb29sZWFuKHJlc3VsdC5yb3dzWzBdKTsKICB9CgogIGNvbnN0
IGRhdGEgPSBwZW9wbGVSZWFkTG9jYWxTZXJ2ZXJzKCk7CiAgY29uc3QgYmVmb3JlID0gZGF0YS5yb2xlcy5sZW5ndGg7CiAgZGF0YS5yb2xlcyA9IGRhdGEu
cm9sZXMuZmlsdGVyKChyb2xlKSA9PiBTdHJpbmcocm9sZS5pZCkgIT09IFN0cmluZyhjdXJyZW50LmlkKSk7CiAgZGF0YS5tZW1iZXJSb2xlcyA9IGRhdGEu
bWVtYmVyUm9sZXMuZmlsdGVyKChpdGVtKSA9PiBTdHJpbmcoaXRlbS5yb2xlSWQgPz8gaXRlbS5yb2xlX2lkID8/ICIiKSAhPT0gU3RyaW5nKGN1cnJlbnQu
aWQpKTsKICBkYXRhLnBlcm1pc3Npb25PdmVycmlkZXMgPSBkYXRhLnBlcm1pc3Npb25PdmVycmlkZXMuZmlsdGVyKChpdGVtKSA9PiBTdHJpbmcoaXRlbS5y
b2xlSWQgPz8gaXRlbS5yb2xlX2lkID8/ICIiKSAhPT0gU3RyaW5nKGN1cnJlbnQuaWQpKTsKICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKTsKICBy
ZXR1cm4gZGF0YS5yb2xlcy5sZW5ndGggIT09IGJlZm9yZTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2V0TWVtYmVyUm9sZXMoc2VydmVySWQsIHRhcmdl
dFVzZXJJZCwgcmVxdWVzdGVkUm9sZUlkcywgYWN0b3JTdGF0ZSkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgdWlk
ID0gU3RyaW5nKHRhcmdldFVzZXJJZCB8fCAiIik7CiAgaWYgKCFzaWQgfHwgIXVpZCB8fCAhKGF3YWl0IHBlb3BsZUlzU2VydmVyTWVtYmVyKHVpZCwgc2lk
KSkpIHsKICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigiTUVNQkVSX0lOVkFMSUQiKTsgZXJyLmNvZGUgPSAiTUVNQkVSX0lOVkFMSUQiOyB0aHJvdyBlcnI7
CiAgfQogIGNvbnN0IHJvbGVzID0gYXdhaXQgcGVvcGxlTGlzdFNlcnZlclJvbGVzKHNpZCk7CiAgY29uc3QgYnlJZCA9IG5ldyBNYXAocm9sZXMuZmlsdGVy
KChyb2xlKSA9PiAhcm9sZS5ldmVyeW9uZSkubWFwKChyb2xlKSA9PiBbU3RyaW5nKHJvbGUuaWQpLCByb2xlXSkpOwogIGNvbnN0IHJlcXVlc3RlZCA9IFsu
Li5uZXcgU2V0KChBcnJheS5pc0FycmF5KHJlcXVlc3RlZFJvbGVJZHMpID8gcmVxdWVzdGVkUm9sZUlkcyA6IFtdKS5tYXAoU3RyaW5nKSldCiAgICAuZmls
dGVyKChpZCkgPT4gYnlJZC5oYXMoaWQpKTsKICBjb25zdCBjdXJyZW50ID0gYXdhaXQgcGVvcGxlTWVtYmVyUm9sZUlkcyhzaWQsIHVpZCk7CiAgY29uc3Qg
Y2hhbmdlZCA9IG5ldyBTZXQoWy4uLmN1cnJlbnQsIC4uLnJlcXVlc3RlZF0pOwogIGZvciAoY29uc3QgcmlkIG9mIGNoYW5nZWQpIHsKICAgIGNvbnN0IGlu
Q3VycmVudCA9IGN1cnJlbnQuaW5jbHVkZXMocmlkKTsKICAgIGNvbnN0IGluUmVxdWVzdGVkID0gcmVxdWVzdGVkLmluY2x1ZGVzKHJpZCk7CiAgICBpZiAo
aW5DdXJyZW50ID09PSBpblJlcXVlc3RlZCkgY29udGludWU7CiAgICBjb25zdCByb2xlID0gYnlJZC5nZXQocmlkKTsKICAgIGlmICghcm9sZSkgY29udGlu
dWU7CiAgICBpZiAoIWFjdG9yU3RhdGU/Lm93bmVyICYmIE51bWJlcihyb2xlLnBvc2l0aW9uIHx8IDApID49IGFjdG9yU3RhdGUuaGlnaGVzdFJvbGVQb3Np
dGlvbikgewogICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoIlJPTEVfSElFUkFSQ0hZIik7IGVyci5jb2RlID0gIlJPTEVfSElFUkFSQ0hZIjsgdGhyb3cg
ZXJyOwogICAgfQogIH0KCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IGNsaWVudCA9IGF3YWl0IHBlb3BsZVBvb2wuY29ubmVjdCgpOwogICAgdHJ5
IHsKICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCJCRUdJTiIpOwogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIkRFTEVURSBGUk9NIHBlb3Bs
ZV9zZXJ2ZXJfbWVtYmVyX3JvbGVzIFdIRVJFIHNlcnZlcl9pZCA9ICQxIEFORCB1c2VyX2lkID0gJDIiLAogICAgICAgIFtzaWQsIHVpZF0KICAgICAgKTsK
ICAgICAgZm9yIChjb25zdCByaWQgb2YgcmVxdWVzdGVkKSB7CiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgIklOU0VSVCBJTlRPIHBl
b3BsZV9zZXJ2ZXJfbWVtYmVyX3JvbGVzIChzZXJ2ZXJfaWQsIHVzZXJfaWQsIHJvbGVfaWQpIFZBTFVFUyAoJDEsICQyLCAkMykgT04gQ09ORkxJQ1QgRE8g
Tk9USElORyIsCiAgICAgICAgICBbc2lkLCB1aWQsIHJpZF0KICAgICAgICApOwogICAgICB9CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiQ09NTUlUIik7
CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCJST0xMQkFDSyIpLmNhdGNoKCgpID0+IHt9KTsKICAgICAgdGhyb3cgZXJy
OwogICAgfSBmaW5hbGx5IHsKICAgICAgY2xpZW50LnJlbGVhc2UoKTsKICAgIH0KICB9IGVsc2UgewogICAgY29uc3QgZGF0YSA9IHBlb3BsZVJlYWRMb2Nh
bFNlcnZlcnMoKTsKICAgIGRhdGEubWVtYmVyUm9sZXMgPSBkYXRhLm1lbWJlclJvbGVzLmZpbHRlcigoaXRlbSkgPT4KICAgICAgIShTdHJpbmcoaXRlbS5z
ZXJ2ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJiBTdHJpbmcoaXRlbS51c2VySWQgPz8gaXRlbS51c2VyX2lkID8/ICIiKSA9PT0g
dWlkKQogICAgKTsKICAgIGZvciAoY29uc3QgcmlkIG9mIHJlcXVlc3RlZCkgewogICAgICBkYXRhLm1lbWJlclJvbGVzLnB1c2goeyBzZXJ2ZXJJZDogc2lk
LCB1c2VySWQ6IHVpZCwgcm9sZUlkOiByaWQsIGFzc2lnbmVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KTsKICAgIH0KICAgIHBlb3BsZVdyaXRl
TG9jYWxTZXJ2ZXJzKGRhdGEpOwogIH0KICByZXR1cm4gcmVxdWVzdGVkOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXRSb2xlQ2hhbm5lbE92ZXJyaWRl
KHNlcnZlcklkLCBjaGFubmVsSWQsIHJvbGVJZCwgYWxsb3csIGRlbnksIGFjdG9yU3RhdGUpIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwg
IiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGNvbnN0IHJvbGUgPSBhd2FpdCBwZW9wbGVHZXRTZXJ2ZXJSb2xlKHNpZCwg
cm9sZUlkKTsKICBjb25zdCBjaGFubmVsID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChzaWQsIGNpZCk7CiAgaWYgKCFyb2xlIHx8ICFjaGFubmVs
KSB7IGNvbnN0IGVyciA9IG5ldyBFcnJvcigiT1ZFUlJJREVfSU5WQUxJRCIpOyBlcnIuY29kZSA9ICJPVkVSUklERV9JTlZBTElEIjsgdGhyb3cgZXJyOyB9
CiAgaWYgKCFhY3RvclN0YXRlPy5vd25lciAmJiBOdW1iZXIocm9sZS5wb3NpdGlvbiB8fCAwKSA+PSBhY3RvclN0YXRlLmhpZ2hlc3RSb2xlUG9zaXRpb24g
JiYgIXJvbGUuZXZlcnlvbmUpIHsKICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcigiUk9MRV9ISUVSQVJDSFkiKTsgZXJyLmNvZGUgPSAiUk9MRV9ISUVSQVJD
SFkiOyB0aHJvdyBlcnI7CiAgfQogIGxldCBhbGxvd01hc2sgPSBwZW9wbGVQZXJtaXNzaW9uTWFzayhhbGxvdyk7CiAgbGV0IGRlbnlNYXNrID0gcGVvcGxl
UGVybWlzc2lvbk1hc2soZGVueSk7CiAgZGVueU1hc2sgJj0gfmFsbG93TWFzazsKICBpZiAoIWFjdG9yU3RhdGU/Lm93bmVyICYmIChhbGxvd01hc2sgJiB+
YWN0b3JTdGF0ZS5tYXNrKSAhPT0gMCkgewogICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCJST0xFX1BFUk1JU1NJT05fRVNDQUxBVElPTiIpOyBlcnIuY29k
ZSA9ICJST0xFX1BFUk1JU1NJT05fRVNDQUxBVElPTiI7IHRocm93IGVycjsKICB9CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29s
LnF1ZXJ5KAogICAgICAiSU5TRVJUIElOVE8gcGVvcGxlX3NlcnZlcl9yb2xlX2NoYW5uZWxfb3ZlcnJpZGVzICIgKwogICAgICAiKHNlcnZlcl9pZCwgY2hh
bm5lbF9pZCwgcm9sZV9pZCwgYWxsb3dfcGVybWlzc2lvbnMsIGRlbnlfcGVybWlzc2lvbnMpICIgKwogICAgICAiVkFMVUVTICgkMSwgJDIsICQzLCAkNCwg
JDUpICIgKwogICAgICAiT04gQ09ORkxJQ1QgKHNlcnZlcl9pZCwgY2hhbm5lbF9pZCwgcm9sZV9pZCkgRE8gVVBEQVRFIFNFVCAiICsKICAgICAgImFsbG93
X3Blcm1pc3Npb25zID0gRVhDTFVERUQuYWxsb3dfcGVybWlzc2lvbnMsIGRlbnlfcGVybWlzc2lvbnMgPSBFWENMVURFRC5kZW55X3Blcm1pc3Npb25zIiwK
ICAgICAgW3NpZCwgY2lkLCBTdHJpbmcocm9sZS5pZCksIGFsbG93TWFzaywgZGVueU1hc2tdCiAgICApOwogIH0gZWxzZSB7CiAgICBjb25zdCBkYXRhID0g
cGVvcGxlUmVhZExvY2FsU2VydmVycygpOwogICAgZGF0YS5wZXJtaXNzaW9uT3ZlcnJpZGVzID0gZGF0YS5wZXJtaXNzaW9uT3ZlcnJpZGVzLmZpbHRlcigo
aXRlbSkgPT4KICAgICAgIShTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJgogICAgICAgIFN0cmluZyhp
dGVtLmNoYW5uZWxJZCA/PyBpdGVtLmNoYW5uZWxfaWQgPz8gIiIpID09PSBjaWQgJiYKICAgICAgICBTdHJpbmcoaXRlbS5yb2xlSWQgPz8gaXRlbS5yb2xl
X2lkID8/ICIiKSA9PT0gU3RyaW5nKHJvbGUuaWQpKQogICAgKTsKICAgIGRhdGEucGVybWlzc2lvbk92ZXJyaWRlcy5wdXNoKHsgc2VydmVySWQ6IHNpZCwg
Y2hhbm5lbElkOiBjaWQsIHJvbGVJZDogU3RyaW5nKHJvbGUuaWQpLCBhbGxvdzogYWxsb3dNYXNrLCBkZW55OiBkZW55TWFzayB9KTsKICAgIHBlb3BsZVdy
aXRlTG9jYWxTZXJ2ZXJzKGRhdGEpOwogIH0KICByZXR1cm4geyBzZXJ2ZXJJZDogc2lkLCBjaGFubmVsSWQ6IGNpZCwgcm9sZUlkOiBTdHJpbmcocm9sZS5p
ZCksIGFsbG93OiBwZW9wbGVQZXJtaXNzaW9uTmFtZXMoYWxsb3dNYXNrKSwgZGVueTogcGVvcGxlUGVybWlzc2lvbk5hbWVzKGRlbnlNYXNrKSB9Owp9Cgph
c3luYyBmdW5jdGlvbiBwZW9wbGVEZWxldGVSb2xlQ2hhbm5lbE92ZXJyaWRlKHNlcnZlcklkLCBjaGFubmVsSWQsIHJvbGVJZCkgewogIGNvbnN0IHNpZCA9
IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgY2lkID0gU3RyaW5nKGNoYW5uZWxJZCB8fCAiIik7CiAgY29uc3QgcmlkID0gU3RyaW5nKHJvbGVJ
ZCB8fCAiIik7CiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJERUxFVEUgRlJPTSBwZW9wbGVfc2VydmVy
X3JvbGVfY2hhbm5lbF9vdmVycmlkZXMgV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIGNoYW5uZWxfaWQgPSAkMiBBTkQgcm9sZV9pZCA9ICQzIiwKICAgICAg
W3NpZCwgY2lkLCByaWRdCiAgICApOwogICAgcmV0dXJuOwogIH0KICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwogIGRhdGEucGVy
bWlzc2lvbk92ZXJyaWRlcyA9IGRhdGEucGVybWlzc2lvbk92ZXJyaWRlcy5maWx0ZXIoKGl0ZW0pID0+CiAgICAhKFN0cmluZyhpdGVtLnNlcnZlcklkID8/
IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmCiAgICAgIFN0cmluZyhpdGVtLmNoYW5uZWxJZCA/PyBpdGVtLmNoYW5uZWxfaWQgPz8gIiIpID09
PSBjaWQgJiYKICAgICAgU3RyaW5nKGl0ZW0ucm9sZUlkID8/IGl0ZW0ucm9sZV9pZCA/PyAiIikgPT09IHJpZCkKICApOwogIHBlb3BsZVdyaXRlTG9jYWxT
ZXJ2ZXJzKGRhdGEpOwp9CgoKLy8gPT09IFBFT1BMRV9TRVJWRVJfTU9ERVJBVElPTl9QRVJNSVNTSU9OU19WMV9TVEFSVCA9PT0KYXN5bmMgZnVuY3Rpb24g
cGVvcGxlU2VydmVySXNCYW5uZWQoc2VydmVySWQsIHVzZXJJZCkgewogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgdWlk
ID0gU3RyaW5nKHVzZXJJZCB8fCAiIik7CiAgaWYgKCFzaWQgfHwgIXVpZCkgcmV0dXJuIGZhbHNlOwogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCBy
ZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNUIDEgRlJPTSBwZW9wbGVfc2VydmVyX2JhbnMgV0hFUkUgc2VydmVyX2lkID0g
JDEgQU5EIHVzZXJfaWQgPSAkMiBMSU1JVCAxIiwKICAgICAgW3NpZCwgdWlkXQogICAgKTsKICAgIHJldHVybiBCb29sZWFuKHJlc3VsdC5yb3dzWzBdKTsK
ICB9CiAgY29uc3QgZGF0YSA9IHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKTsKICByZXR1cm4gKGRhdGEuYmFucyB8fCBbXSkuc29tZSgoaXRlbSkgPT4KICAg
IFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmCiAgICBTdHJpbmcoaXRlbS51c2VySWQgPz8gaXRlbS51
c2VyX2lkID8/ICIiKSA9PT0gdWlkCiAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2VydmVyTGlzdEJhbnMoc2VydmVySWQpIHsKICBjb25zdCBzaWQg
PSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGxldCByb3dzID0gW107CiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBl
b3BsZVBvb2wucXVlcnkoCiAgICAgICJTRUxFQ1QgYi51c2VyX2lkLCBiLmJhbm5lZF9ieSwgYi5yZWFzb24sIGIuY3JlYXRlZF9hdCwgYS51c2VybmFtZSAi
ICsKICAgICAgIkZST00gcGVvcGxlX3NlcnZlcl9iYW5zIGIgSk9JTiBwZW9wbGVfYWNjb3VudHMgYSBPTiBhLmlkID0gYi51c2VyX2lkICIgKwogICAgICAi
V0hFUkUgYi5zZXJ2ZXJfaWQgPSAkMSBPUkRFUiBCWSBiLmNyZWF0ZWRfYXQgREVTQyIsCiAgICAgIFtzaWRdCiAgICApOwogICAgcm93cyA9IHJlc3VsdC5y
b3dzLm1hcCgocm93KSA9PiAoewogICAgICB1c2VySWQ6IFN0cmluZyhyb3cudXNlcl9pZCksIHVzZXJuYW1lOiByb3cudXNlcm5hbWUsIGJhbm5lZEJ5OiBy
b3cuYmFubmVkX2J5ID8gU3RyaW5nKHJvdy5iYW5uZWRfYnkpIDogbnVsbCwKICAgICAgcmVhc29uOiBTdHJpbmcocm93LnJlYXNvbiB8fCAiIiksIGNyZWF0
ZWRBdDogcm93LmNyZWF0ZWRfYXQKICAgIH0pKTsKICB9IGVsc2UgewogICAgY29uc3QgZGF0YSA9IHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKTsKICAgIGNv
bnN0IHNvdXJjZSA9IChkYXRhLmJhbnMgfHwgW10pLmZpbHRlcigoaXRlbSkgPT4gU3RyaW5nKGl0ZW0uc2VydmVySWQgPz8gaXRlbS5zZXJ2ZXJfaWQgPz8g
IiIpID09PSBzaWQpOwogICAgY29uc3QgYWNjb3VudHMgPSBhd2FpdCBwZW9wbGVGaW5kQWNjb3VudHNCeUlkcyhzb3VyY2UubWFwKChpdGVtKSA9PiBpdGVt
LnVzZXJJZCA/PyBpdGVtLnVzZXJfaWQpKTsKICAgIGNvbnN0IGJ5SWQgPSBuZXcgTWFwKGFjY291bnRzLm1hcCgoYWNjb3VudCkgPT4gW1N0cmluZyhhY2Nv
dW50LmlkKSwgYWNjb3VudF0pKTsKICAgIHJvd3MgPSBzb3VyY2UubWFwKChpdGVtKSA9PiB7CiAgICAgIGNvbnN0IHVpZCA9IFN0cmluZyhpdGVtLnVzZXJJ
ZCA/PyBpdGVtLnVzZXJfaWQgPz8gIiIpOwogICAgICByZXR1cm4gewogICAgICAgIHVzZXJJZDogdWlkLAogICAgICAgIHVzZXJuYW1lOiBwZW9wbGVVc2Vy
bmFtZShieUlkLmdldCh1aWQpPy51c2VybmFtZSB8fCAiVXRpbGlzYXRldXIiKSwKICAgICAgICBiYW5uZWRCeTogaXRlbS5iYW5uZWRCeSA/PyBpdGVtLmJh
bm5lZF9ieSA/PyBudWxsLAogICAgICAgIHJlYXNvbjogU3RyaW5nKGl0ZW0ucmVhc29uIHx8ICIiKSwKICAgICAgICBjcmVhdGVkQXQ6IGl0ZW0uY3JlYXRl
ZEF0ID8/IGl0ZW0uY3JlYXRlZF9hdCA/PyBudWxsCiAgICAgIH07CiAgICB9KS5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLmNyZWF0ZWRBdCB8fCAwKSAt
IG5ldyBEYXRlKGEuY3JlYXRlZEF0IHx8IDApKTsKICB9CiAgcmV0dXJuIHJvd3M7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlckNhbk1vZGVyYXRl
KGFjdG9ySWQsIHNlcnZlcklkLCB0YXJnZXRJZCwgcGVybWlzc2lvbikgewogIGNvbnN0IGFjdG9yID0gU3RyaW5nKGFjdG9ySWQgfHwgIiIpOwogIGNvbnN0
IHRhcmdldCA9IFN0cmluZyh0YXJnZXRJZCB8fCAiIik7CiAgaWYgKCFhY3RvciB8fCAhdGFyZ2V0IHx8IGFjdG9yID09PSB0YXJnZXQpIHJldHVybiB7IG9r
OiBmYWxzZSwgcmVhc29uOiAiVHUgbmUgcGV1eCBwYXMgdGUgbW9kw6lyZXIgdG9pLW3Dqm1lLiIgfTsKICBjb25zdCBzZXJ2ZXIgPSBhd2FpdCBwZW9wbGVH
ZXRTZXJ2ZXIoc2VydmVySWQpOwogIGlmICghc2VydmVyKSByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogIlNlcnZldXIgaW50cm91dmFibGUuIiB9Owog
IGlmIChzZXJ2ZXIub3duZXJJZCAmJiBTdHJpbmcoc2VydmVyLm93bmVySWQpID09PSB0YXJnZXQpIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiAiTGUg
cHJvcHJpw6l0YWlyZSBkdSBzZXJ2ZXVyIG5lIHBldXQgcGFzIMOqdHJlIG1vZMOpcsOpLiIgfTsKICBjb25zdCBhY3RvclN0YXRlID0gYXdhaXQgcGVvcGxl
U2VydmVyUm9sZVN0YXRlKGFjdG9yLCBzZXJ2ZXIuaWQpOwogIGlmICghYWN0b3JTdGF0ZSB8fCAhcGVvcGxlUGVybWlzc2lvbkhhcyhhY3RvclN0YXRlLm1h
c2ssIHBlcm1pc3Npb24pKSB7CiAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogIlR1IG4nYXMgcGFzIGNldHRlIHBlcm1pc3Npb24gZGUgbW9kw6ly
YXRpb24uIiB9OwogIH0KICBpZiAoYWN0b3JTdGF0ZS5vd25lcikgcmV0dXJuIHsgb2s6IHRydWUsIHNlcnZlciwgYWN0b3JTdGF0ZSB9OwogIGNvbnN0IHRh
cmdldE1lbWJlciA9IGF3YWl0IHBlb3BsZUlzU2VydmVyTWVtYmVyKHRhcmdldCwgc2VydmVyLmlkKTsKICBpZiAodGFyZ2V0TWVtYmVyKSB7CiAgICBjb25z
dCB0YXJnZXRTdGF0ZSA9IGF3YWl0IHBlb3BsZVNlcnZlclJvbGVTdGF0ZSh0YXJnZXQsIHNlcnZlci5pZCk7CiAgICBpZiAodGFyZ2V0U3RhdGUgJiYgTnVt
YmVyKHRhcmdldFN0YXRlLmhpZ2hlc3RSb2xlUG9zaXRpb24gfHwgMCkgPj0gTnVtYmVyKGFjdG9yU3RhdGUuaGlnaGVzdFJvbGVQb3NpdGlvbiB8fCAwKSkg
ewogICAgICByZXR1cm4geyBvazogZmFsc2UsIHJlYXNvbjogIkNlIG1lbWJyZSBhIHVuIHLDtGxlIMOpZ2FsIG91IHN1cMOpcmlldXIgYXUgdGllbi4iIH07
CiAgICB9CiAgfQogIHJldHVybiB7IG9rOiB0cnVlLCBzZXJ2ZXIsIGFjdG9yU3RhdGUgfTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2VydmVyUmVtb3Zl
TWVtYmVyKHNlcnZlcklkLCB1c2VySWQpIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IHVpZCA9IFN0cmluZyh1c2Vy
SWQgfHwgIiIpOwogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KCJERUxFVEUgRlJPTSBwZW9wbGVfc2VydmVyX21lbWJl
cnMgV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIHVzZXJfaWQgPSAkMiIsIFtzaWQsIHVpZF0pOwogIH0gZWxzZSB7CiAgICBjb25zdCBkYXRhID0gcGVvcGxl
UmVhZExvY2FsU2VydmVycygpOwogICAgZGF0YS5tZW1iZXJzID0gZGF0YS5tZW1iZXJzLmZpbHRlcigoaXRlbSkgPT4gIShTdHJpbmcoaXRlbS5zZXJ2ZXJJ
ZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJiBTdHJpbmcoaXRlbS51c2VySWQgPz8gaXRlbS51c2VyX2lkID8/ICIiKSA9PT0gdWlkKSk7
CiAgICBkYXRhLm1lbWJlclJvbGVzID0gKGRhdGEubWVtYmVyUm9sZXMgfHwgW10pLmZpbHRlcigoaXRlbSkgPT4gIShTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/
PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJiBTdHJpbmcoaXRlbS51c2VySWQgPz8gaXRlbS51c2VyX2lkID8/ICIiKSA9PT0gdWlkKSk7CiAg
ICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKTsKICB9CgogIGZvciAoY29uc3QgW3NvY2tldElkLCBjdXJyZW50U2VydmVySWRdIG9mIFsuLi5zb2Nr
ZXRTZXJ2ZXJJZHMuZW50cmllcygpXSkgewogICAgaWYgKFN0cmluZyhjdXJyZW50U2VydmVySWQgfHwgIiIpICE9PSBzaWQgfHwgU3RyaW5nKHVzZXJJZHMu
Z2V0KHNvY2tldElkKSB8fCAiIikgIT09IHVpZCkgY29udGludWU7CiAgICBjb25zdCB0YXJnZXRTb2NrZXQgPSBpby5zb2NrZXRzLnNvY2tldHMuZ2V0KHNv
Y2tldElkKTsKICAgIGlmICh0YXJnZXRTb2NrZXQpIHsKICAgICAgbGVhdmVWb2ljZSh0YXJnZXRTb2NrZXQpOwogICAgICBhd2FpdCB0YXJnZXRTb2NrZXQu
bGVhdmUocGVvcGxlU2VydmVyUm9vbShzaWQpKTsKICAgICAgdGFyZ2V0U29ja2V0LmVtaXQoInNlcnZlci1tZW1iZXJzaGlwLWxlZnQiLCB7IHNlcnZlcklk
OiBzaWQgfSk7CiAgICB9CiAgICBzb2NrZXRTZXJ2ZXJJZHMuZGVsZXRlKHNvY2tldElkKTsKICAgIHNvY2tldFRleHRDaGFubmVsSWRzLmRlbGV0ZShzb2Nr
ZXRJZCk7CiAgfQoKICBmb3IgKGNvbnN0IFt2b2ljZVNvY2tldElkLCB2b2ljZVVzZXJdIG9mIFsuLi52b2ljZVVzZXJzLmVudHJpZXMoKV0pIHsKICAgIGlm
IChTdHJpbmcodm9pY2VVc2VyPy5zZXJ2ZXJJZCB8fCAiIikgIT09IHNpZCB8fCBTdHJpbmcodm9pY2VVc2VyPy5hY2NvdW50SWQgfHwgdXNlcklkcy5nZXQo
dm9pY2VTb2NrZXRJZCkgfHwgIiIpICE9PSB1aWQpIGNvbnRpbnVlOwogICAgY29uc3Qgdm9pY2VTb2NrZXQgPSBpby5zb2NrZXRzLnNvY2tldHMuZ2V0KHZv
aWNlU29ja2V0SWQpOwogICAgaWYgKHZvaWNlU29ja2V0KSBsZWF2ZVZvaWNlKHZvaWNlU29ja2V0KTsKICB9CgogIGVtaXRPbmxpbmVVc2VycyhzaWQpOwog
IHBlb3BsZUJyb2FkY2FzdFNlcnZlclBlcm1pc3Npb25SZWZyZXNoKHNpZCk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlckJhbk1lbWJlcihzZXJ2
ZXJJZCwgdGFyZ2V0SWQsIGFjdG9ySWQsIHJlYXNvbiA9ICIiKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCB1aWQg
PSBTdHJpbmcodGFyZ2V0SWQgfHwgIiIpOwogIGNvbnN0IGFjdG9yID0gU3RyaW5nKGFjdG9ySWQgfHwgIiIpOwogIGNvbnN0IGNsZWFuUmVhc29uID0gU3Ry
aW5nKHJlYXNvbiB8fCAiIikudHJpbSgpLnNsaWNlKDAsIDI0MCk7CiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAg
ICAgICJJTlNFUlQgSU5UTyBwZW9wbGVfc2VydmVyX2JhbnMgKHNlcnZlcl9pZCwgdXNlcl9pZCwgYmFubmVkX2J5LCByZWFzb24pIFZBTFVFUyAoJDEsICQy
LCAkMywgJDQpICIgKwogICAgICAiT04gQ09ORkxJQ1QgKHNlcnZlcl9pZCwgdXNlcl9pZCkgRE8gVVBEQVRFIFNFVCBiYW5uZWRfYnkgPSBFWENMVURFRC5i
YW5uZWRfYnksIHJlYXNvbiA9IEVYQ0xVREVELnJlYXNvbiwgY3JlYXRlZF9hdCA9IE5PVygpIiwKICAgICAgW3NpZCwgdWlkLCBhY3RvciwgY2xlYW5SZWFz
b25dCiAgICApOwogIH0gZWxzZSB7CiAgICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwogICAgZGF0YS5iYW5zID0gQXJyYXkuaXNB
cnJheShkYXRhLmJhbnMpID8gZGF0YS5iYW5zIDogW107CiAgICBkYXRhLmJhbnMgPSBkYXRhLmJhbnMuZmlsdGVyKChpdGVtKSA9PiAhKFN0cmluZyhpdGVt
LnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmIFN0cmluZyhpdGVtLnVzZXJJZCA/PyBpdGVtLnVzZXJfaWQgPz8gIiIpID09
PSB1aWQpKTsKICAgIGRhdGEuYmFucy5wdXNoKHsgc2VydmVySWQ6IHNpZCwgdXNlcklkOiB1aWQsIGJhbm5lZEJ5OiBhY3RvciwgcmVhc29uOiBjbGVhblJl
YXNvbiwgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSk7CiAgICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRhKTsKICB9CiAgaWYg
KGF3YWl0IHBlb3BsZUlzU2VydmVyTWVtYmVyKHVpZCwgc2lkKSkgYXdhaXQgcGVvcGxlU2VydmVyUmVtb3ZlTWVtYmVyKHNpZCwgdWlkKTsKfQoKYXN5bmMg
ZnVuY3Rpb24gcGVvcGxlU2VydmVyVW5iYW5NZW1iZXIoc2VydmVySWQsIHRhcmdldElkKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIi
KTsKICBjb25zdCB1aWQgPSBTdHJpbmcodGFyZ2V0SWQgfHwgIiIpOwogIGlmIChwZW9wbGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KCJE
RUxFVEUgRlJPTSBwZW9wbGVfc2VydmVyX2JhbnMgV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIHVzZXJfaWQgPSAkMiIsIFtzaWQsIHVpZF0pOwogIH0gZWxz
ZSB7CiAgICBjb25zdCBkYXRhID0gcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwogICAgZGF0YS5iYW5zID0gKGRhdGEuYmFucyB8fCBbXSkuZmlsdGVyKChp
dGVtKSA9PiAhKFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmIFN0cmluZyhpdGVtLnVzZXJJZCA/PyBp
dGVtLnVzZXJfaWQgPz8gIiIpID09PSB1aWQpKTsKICAgIHBlb3BsZVdyaXRlTG9jYWxTZXJ2ZXJzKGRhdGEpOwogIH0KfQovLyA9PT0gUEVPUExFX1NFUlZF
Ul9NT0RFUkFUSU9OX1BFUk1JU1NJT05TX1YxX0VORCA9PT0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUluaXRTZXJ2ZXJSb2xlc1YxKCkgewogIGlmIChwZW9w
bGVQb29sKSB7CiAgICBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgcGVvcGxlX3NlcnZlcl9yb2xl
cyAoIiArCiAgICAgICJpZCBCSUdTRVJJQUwgUFJJTUFSWSBLRVksICIgKwogICAgICAic2VydmVyX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBl
b3BsZV9zZXJ2ZXJzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJuYW1lIFZBUkNIQVIoMzIpIE5PVCBOVUxMLCAiICsKICAgICAgImNvbG9y
IFZBUkNIQVIoMTYpIE5PVCBOVUxMIERFRkFVTFQgJyM5OUFBQjUnLCAiICsKICAgICAgInBlcm1pc3Npb25zIElOVEVHRVIgTk9UIE5VTEwgREVGQVVMVCAw
LCAiICsKICAgICAgInBvc2l0aW9uIElOVEVHRVIgTk9UIE5VTEwgREVGQVVMVCAwLCAiICsKICAgICAgImlzX2V2ZXJ5b25lIEJPT0xFQU4gTk9UIE5VTEwg
REVGQVVMVCBGQUxTRSwgIiArCiAgICAgICJjcmVhdGVkX2F0IFRJTUVTVEFNUFRaIE5PVCBOVUxMIERFRkFVTFQgTk9XKCkiICsKICAgICAgIikiCiAgICAp
OwogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkNSRUFURSBVTklRVUUgSU5ERVggSUYgTk9UIEVYSVNUUyBwZW9wbGVfc2VydmVyX3JvbGVz
X2V2ZXJ5b25lX2lkeCAiICsKICAgICAgIk9OIHBlb3BsZV9zZXJ2ZXJfcm9sZXMoc2VydmVyX2lkKSBXSEVSRSBpc19ldmVyeW9uZSA9IFRSVUUiCiAgICAp
OwogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkNSRUFURSBJTkRFWCBJRiBOT1QgRVhJU1RTIHBlb3BsZV9zZXJ2ZXJfcm9sZXNfb3JkZXJf
aWR4IE9OIHBlb3BsZV9zZXJ2ZXJfcm9sZXMoc2VydmVyX2lkLCBwb3NpdGlvbiBERVNDLCBpZCkiCiAgICApOwogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVy
eSgKICAgICAgIkNSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTIHBlb3BsZV9zZXJ2ZXJfbWVtYmVyX3JvbGVzICgiICsKICAgICAgInNlcnZlcl9pZCBCSUdJ
TlQgTk9UIE5VTEwsICIgKwogICAgICAidXNlcl9pZCBCSUdJTlQgTk9UIE5VTEwsICIgKwogICAgICAicm9sZV9pZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJF
TkNFUyBwZW9wbGVfc2VydmVyX3JvbGVzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJhc3NpZ25lZF9hdCBUSU1FU1RBTVBUWiBOT1QgTlVM
TCBERUZBVUxUIE5PVygpLCAiICsKICAgICAgIlBSSU1BUlkgS0VZKHNlcnZlcl9pZCwgdXNlcl9pZCwgcm9sZV9pZCksICIgKwogICAgICAiRk9SRUlHTiBL
RVkoc2VydmVyX2lkLCB1c2VyX2lkKSBSRUZFUkVOQ0VTIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyhzZXJ2ZXJfaWQsIHVzZXJfaWQpIE9OIERFTEVURSBDQVND
QURFIiArCiAgICAgICIpIgogICAgKTsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyBwZW9w
bGVfc2VydmVyX3JvbGVfY2hhbm5lbF9vdmVycmlkZXMgKCIgKwogICAgICAic2VydmVyX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9z
ZXJ2ZXJzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJjaGFubmVsX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9zZXJ2
ZXJfY2hhbm5lbHMoaWQpIE9OIERFTEVURSBDQVNDQURFLCAiICsKICAgICAgInJvbGVfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX3Nl
cnZlcl9yb2xlcyhpZCkgT04gREVMRVRFIENBU0NBREUsICIgKwogICAgICAiYWxsb3dfcGVybWlzc2lvbnMgSU5URUdFUiBOT1QgTlVMTCBERUZBVUxUIDAs
ICIgKwogICAgICAiZGVueV9wZXJtaXNzaW9ucyBJTlRFR0VSIE5PVCBOVUxMIERFRkFVTFQgMCwgIiArCiAgICAgICJQUklNQVJZIEtFWShzZXJ2ZXJfaWQs
IGNoYW5uZWxfaWQsIHJvbGVfaWQpIiArCiAgICAgICIpIgogICAgKTsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJDUkVBVEUgVEFCTEUg
SUYgTk9UIEVYSVNUUyBwZW9wbGVfc2VydmVyX2JhbnMgKCIgKwogICAgICAic2VydmVyX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9z
ZXJ2ZXJzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJ1c2VyX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9hY2NvdW50
cyhpZCkgT04gREVMRVRFIENBU0NBREUsICIgKwogICAgICAiYmFubmVkX2J5IEJJR0lOVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBP
TiBERUxFVEUgU0VUIE5VTEwsICIgKwogICAgICAicmVhc29uIFZBUkNIQVIoMjQwKSBOT1QgTlVMTCBERUZBVUxUICcnLCAiICsKICAgICAgImNyZWF0ZWRf
YXQgVElNRVNUQU1QVFogTk9UIE5VTEwgREVGQVVMVCBOT1coKSwgIiArCiAgICAgICJQUklNQVJZIEtFWShzZXJ2ZXJfaWQsIHVzZXJfaWQpIiArCiAgICAg
ICIpIgogICAgKTsKICAgIGNvbnN0IHNlcnZlcnMgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KCJTRUxFQ1QgaWQgRlJPTSBwZW9wbGVfc2VydmVycyBPUkRF
UiBCWSBpZCBBU0MiKTsKICAgIGZvciAoY29uc3Qgcm93IG9mIHNlcnZlcnMucm93cykgYXdhaXQgcGVvcGxlRW5zdXJlU2VydmVyRXZlcnlvbmVSb2xlKFN0
cmluZyhyb3cuaWQpKTsKICB9IGVsc2UgewogICAgY29uc3QgZGF0YSA9IHBlb3BsZVJlYWRMb2NhbFNlcnZlcnMoKTsKICAgIGxldCBjaGFuZ2VkID0gZmFs
c2U7CiAgICBkYXRhLnJvbGVzID0gQXJyYXkuaXNBcnJheShkYXRhLnJvbGVzKSA/IGRhdGEucm9sZXMgOiBbXTsKICAgIGRhdGEubWVtYmVyUm9sZXMgPSBB
cnJheS5pc0FycmF5KGRhdGEubWVtYmVyUm9sZXMpID8gZGF0YS5tZW1iZXJSb2xlcyA6IFtdOwogICAgZGF0YS5wZXJtaXNzaW9uT3ZlcnJpZGVzID0gQXJy
YXkuaXNBcnJheShkYXRhLnBlcm1pc3Npb25PdmVycmlkZXMpID8gZGF0YS5wZXJtaXNzaW9uT3ZlcnJpZGVzIDogW107CiAgICBkYXRhLmJhbnMgPSBBcnJh
eS5pc0FycmF5KGRhdGEuYmFucykgPyBkYXRhLmJhbnMgOiBbXTsKICAgIGZvciAoY29uc3Qgc2VydmVyIG9mIGRhdGEuc2VydmVycykgewogICAgICBjb25z
dCBzaWQgPSBTdHJpbmcoc2VydmVyLmlkIHx8ICIiKTsKICAgICAgaWYgKCFzaWQpIGNvbnRpbnVlOwogICAgICBpZiAoIWRhdGEucm9sZXMuc29tZSgocm9s
ZSkgPT4gU3RyaW5nKHJvbGUuc2VydmVySWQgPz8gcm9sZS5zZXJ2ZXJfaWQgPz8gIiIpID09PSBzaWQgJiYgQm9vbGVhbihyb2xlLmV2ZXJ5b25lID8/IHJv
bGUuaXNfZXZlcnlvbmUpKSkgewogICAgICAgIGRhdGEucm9sZXMucHVzaCh7CiAgICAgICAgICBpZDogY3J5cHRvQWNjb3VudHMucmFuZG9tVVVJRCgpLCBz
ZXJ2ZXJJZDogc2lkLCBuYW1lOiAiQGV2ZXJ5b25lIiwgY29sb3I6ICIjOTlBQUI1IiwKICAgICAgICAgIHBlcm1pc3Npb25zOiBQRU9QTEVfUEVSTUlTU0lP
Tl9FVkVSWU9ORV9ERUZBVUxULCBwb3NpdGlvbjogMCwgZXZlcnlvbmU6IHRydWUsIGNyZWF0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpCiAgICAg
ICAgfSk7CiAgICAgICAgY2hhbmdlZCA9IHRydWU7CiAgICAgIH0KICAgIH0KICAgIGlmIChjaGFuZ2VkKSBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhkYXRh
KTsKICB9CiAgY29uc29sZS5sb2coIltQZW9wbGVdIFLDtGxlcyBldCBwZXJtaXNzaW9ucyBzZXJ2ZXVyIFYxIHByw6p0cy4iKTsKfQoKZnVuY3Rpb24gcGVv
cGxlUGVybWlzc2lvbkNhdGFsb2coKSB7CiAgcmV0dXJuIFBFT1BMRV9QRVJNSVNTSU9OX0RFRklOSVRJT05TLm1hcCgoaXRlbSkgPT4gKHsga2V5OiBpdGVt
LmtleSwgbGFiZWw6IGl0ZW0ubGFiZWwsIGdyb3VwOiBpdGVtLmdyb3VwLCBiaXQ6IGl0ZW0uYml0IH0pKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlUmVx
dWlyZVJvbGVNYW5hZ2VyKHNlc3Npb24sIHNlcnZlcklkKSB7CiAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJSb2xlU3RhdGUoc2Vzc2lvbi5p
ZCwgc2VydmVySWQpOwogIGlmICghc3RhdGUgfHwgIXBlb3BsZVBlcm1pc3Npb25IYXMoc3RhdGUubWFzaywgIk1BTkFHRV9ST0xFUyIpKSByZXR1cm4gbnVs
bDsKICByZXR1cm4gc3RhdGU7Cn0KCmFwcC5nZXQoIi9hcGkvc2VydmVycy86aWQvcGVybWlzc2lvbnMvbWUiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0
cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICBpZiAo
IShhd2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcihzZXNzaW9uLmlkLCByZXEucGFyYW1zLmlkKSkpIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7IG9r
OiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2VzIHBhcyBtZW1icmUgZGUgY2Ugc2VydmV1ci4iIH0pOwogICAgcmV0dXJuIHJlcy5qc29uKHsgb2s6IHRydWUsIHBl
cm1pc3Npb25zOiBhd2FpdCBwZW9wbGVQZXJtaXNzaW9uU25hcHNob3Qoc2Vzc2lvbi5pZCwgcmVxLnBhcmFtcy5pZCksIGNhdGFsb2c6IHBlb3BsZVBlcm1p
c3Npb25DYXRhbG9nKCkgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxlIHBlcm1pc3Npb25zL21lXSIsIGVycik7CiAg
ICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIHRlcyBwZXJtaXNzaW9ucy4i
IH0pOwogIH0KfSk7CgphcHAuZ2V0KCIvYXBpL3NlcnZlcnMvOmlkL3JvbGVzIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNl
c3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7IGlmICghc2Vzc2lvbikgcmV0dXJuOwogICAgaWYgKCEoYXdhaXQgcGVvcGxlSXNT
ZXJ2ZXJNZW1iZXIoc2Vzc2lvbi5pZCwgcmVxLnBhcmFtcy5pZCkpKSByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAi
VHUgbidlcyBwYXMgbWVtYnJlIGRlIGNlIHNlcnZldXIuIiB9KTsKICAgIGNvbnN0IFtyb2xlcywgbWVdID0gYXdhaXQgUHJvbWlzZS5hbGwoW3Blb3BsZUxp
c3RTZXJ2ZXJSb2xlcyhyZXEucGFyYW1zLmlkKSwgcGVvcGxlUGVybWlzc2lvblNuYXBzaG90KHNlc3Npb24uaWQsIHJlcS5wYXJhbXMuaWQpXSk7CiAgICBy
ZXR1cm4gcmVzLmpzb24oeyBvazogdHJ1ZSwgcm9sZXMsIHBlcm1pc3Npb25zOiBwZW9wbGVQZXJtaXNzaW9uQ2F0YWxvZygpLCBtZSB9KTsKICB9IGNhdGNo
IChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgcm9sZXMvbGlzdF0iLCBlcnIpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsg
b2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZGUgY2hhcmdlciBsZXMgcsO0bGVzLiIgfSk7CiAgfQp9KTsKCmFwcC5wb3N0KCIvYXBpL3NlcnZlcnMv
OmlkL3JvbGVzIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEs
IHJlcyk7IGlmICghc2Vzc2lvbikgcmV0dXJuOwogICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVSZXF1aXJlUm9sZU1hbmFnZXIoc2Vzc2lvbiwgcmVx
LnBhcmFtcy5pZCk7CiAgICBpZiAoIXN0YXRlKSByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiVHUgbidhcyBwYXMg
bGEgcGVybWlzc2lvbiBkZSBnw6lyZXIgbGVzIHLDtGxlcy4iIH0pOwogICAgY29uc3Qgcm9sZSA9IGF3YWl0IHBlb3BsZUNyZWF0ZVNlcnZlclJvbGUocmVx
LnBhcmFtcy5pZCwgcmVxLmJvZHk/Lm5hbWUsIHJlcS5ib2R5Py5jb2xvciwgcmVxLmJvZHk/LnBlcm1pc3Npb25zIHx8IFtdLCBzdGF0ZSk7CiAgICBhd2Fp
dCBwZW9wbGVCcm9hZGNhc3RTZXJ2ZXJQZXJtaXNzaW9uUmVmcmVzaChyZXEucGFyYW1zLmlkKTsKICAgIHJldHVybiByZXMuc3RhdHVzKDIwMSkuanNvbih7
IG9rOiB0cnVlLCByb2xlIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc3QgYmFkID0gWyJST0xFX0lOVkFMSUQiLCAiUk9MRV9QRVJNSVNTSU9OX0VT
Q0FMQVRJT04iLCAiUk9MRV9ISUVSQVJDSFkiXS5pbmNsdWRlcyhlcnI/LmNvZGUpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoYmFkID8gNDAwIDogNTAwKS5q
c29uKHsgb2s6IGZhbHNlLCBlcnJvcjogZXJyPy5jb2RlID09PSAiUk9MRV9QRVJNSVNTSU9OX0VTQ0FMQVRJT04iID8gIlR1IG5lIHBldXggcGFzIGFjY29y
ZGVyIHVuZSBwZXJtaXNzaW9uIHF1ZSB0dSBuZSBwb3Nzw6hkZXMgcGFzLiIgOiAiSW1wb3NzaWJsZSBkZSBjcsOpZXIgY2UgcsO0bGUuIiB9KTsKICB9Cn0p
OwoKYXBwLnBhdGNoKCIvYXBpL3NlcnZlcnMvOmlkL3JvbGVzLzpyb2xlSWQiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vz
c2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHBl
b3BsZVJlcXVpcmVSb2xlTWFuYWdlcihzZXNzaW9uLCByZXEucGFyYW1zLmlkKTsKICAgIGlmICghc3RhdGUpIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNv
bih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGfDqXJlciBsZXMgcsO0bGVzLiIgfSk7CiAgICBjb25zdCByb2xl
ID0gYXdhaXQgcGVvcGxlVXBkYXRlU2VydmVyUm9sZShyZXEucGFyYW1zLmlkLCByZXEucGFyYW1zLnJvbGVJZCwgcmVxLmJvZHkgfHwge30sIHN0YXRlKTsK
ICAgIGlmICghcm9sZSkgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlLDtGxlIGludHJvdXZhYmxlLiIgfSk7CiAg
ICBhd2FpdCBwZW9wbGVCcm9hZGNhc3RTZXJ2ZXJQZXJtaXNzaW9uUmVmcmVzaChyZXEucGFyYW1zLmlkKTsKICAgIHJldHVybiByZXMuanNvbih7IG9rOiB0
cnVlLCByb2xlIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc3QgbWVzc2FnZSA9IGVycj8uY29kZSA9PT0gIlJPTEVfSElFUkFSQ0hZIiA/ICJDZSBy
w7RsZSBlc3QgdHJvcCBoYXV0IGRhbnMgbGEgaGnDqXJhcmNoaWUuIiA6CiAgICAgIGVycj8uY29kZSA9PT0gIlJPTEVfUEVSTUlTU0lPTl9FU0NBTEFUSU9O
IiA/ICJUdSBuZSBwZXV4IHBhcyBhY2NvcmRlciB1bmUgcGVybWlzc2lvbiBxdWUgdHUgbmUgcG9zc8OoZGVzIHBhcy4iIDogIkltcG9zc2libGUgZGUgbW9k
aWZpZXIgY2UgcsO0bGUuIjsKICAgIHJldHVybiByZXMuc3RhdHVzKFsiUk9MRV9JTlZBTElEIiwiUk9MRV9ISUVSQVJDSFkiLCJST0xFX1BFUk1JU1NJT05f
RVNDQUxBVElPTiJdLmluY2x1ZGVzKGVycj8uY29kZSkgPyA0MDAgOiA1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiBtZXNzYWdlIH0pOwogIH0KfSk7
CgphcHAuZGVsZXRlKCIvYXBpL3NlcnZlcnMvOmlkL3JvbGVzLzpyb2xlSWQiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vz
c2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHBl
b3BsZVJlcXVpcmVSb2xlTWFuYWdlcihzZXNzaW9uLCByZXEucGFyYW1zLmlkKTsKICAgIGlmICghc3RhdGUpIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNv
bih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGfDqXJlciBsZXMgcsO0bGVzLiIgfSk7CiAgICBjb25zdCByZW1v
dmVkID0gYXdhaXQgcGVvcGxlRGVsZXRlU2VydmVyUm9sZShyZXEucGFyYW1zLmlkLCByZXEucGFyYW1zLnJvbGVJZCwgc3RhdGUpOwogICAgaWYgKCFyZW1v
dmVkKSByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiQ2UgcsO0bGUgbmUgcGV1dCBwYXMgw6p0cmUgc3VwcHJpbcOp
LiIgfSk7CiAgICBhd2FpdCBwZW9wbGVCcm9hZGNhc3RTZXJ2ZXJQZXJtaXNzaW9uUmVmcmVzaChyZXEucGFyYW1zLmlkKTsKICAgIHJldHVybiByZXMuanNv
bih7IG9rOiB0cnVlIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgcmV0dXJuIHJlcy5zdGF0dXMoZXJyPy5jb2RlID09PSAiUk9MRV9ISUVSQVJDSFkiID8g
NDAwIDogNTAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogZXJyPy5jb2RlID09PSAiUk9MRV9ISUVSQVJDSFkiID8gIkNlIHLDtGxlIGVzdCB0cm9wIGhh
dXQgZGFucyBsYSBoacOpcmFyY2hpZS4iIDogIkltcG9zc2libGUgZGUgc3VwcHJpbWVyIGNlIHLDtGxlLiIgfSk7CiAgfQp9KTsKCmFwcC5nZXQoIi9hcGkv
c2VydmVycy86aWQvbWVtYmVyLXJvbGVzIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9u
Rm9yUmVxdWVzdChyZXEsIHJlcyk7IGlmICghc2Vzc2lvbikgcmV0dXJuOwogICAgY29uc3Qgc2VydmVyID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyKHJlcS5w
YXJhbXMuaWQpOwogICAgaWYgKCFzZXJ2ZXIgfHwgIShhd2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcihzZXNzaW9uLmlkLCBzZXJ2ZXIuaWQpKSkgcmV0dXJu
IHJlcy5zdGF0dXMoNDAzKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkFjY8OocyByZWZ1c8OpLiIgfSk7CiAgICBjb25zdCByb3N0ZXIgPSBhd2FpdCBw
ZW9wbGVTZXJ2ZXJQcmVzZW5jZVJvc3RlcihzZXJ2ZXIuaWQpOwogICAgY29uc3QgbWVtYmVycyA9IFtdOwogICAgZm9yIChjb25zdCBtZW1iZXIgb2Ygcm9z
dGVyKSB7CiAgICAgIGNvbnN0IGlkID0gU3RyaW5nKG1lbWJlci5hY2NvdW50SWQgfHwgbWVtYmVyLmlkIHx8ICIiKTsKICAgICAgbWVtYmVycy5wdXNoKHsK
ICAgICAgICBpZCwKICAgICAgICB1c2VybmFtZTogbWVtYmVyLnVzZXJuYW1lIHx8ICJNZW1icmUiLAogICAgICAgIG93bmVyOiBCb29sZWFuKHNlcnZlci5v
d25lcklkICYmIFN0cmluZyhzZXJ2ZXIub3duZXJJZCkgPT09IGlkKSwKICAgICAgICByb2xlSWRzOiBhd2FpdCBwZW9wbGVNZW1iZXJSb2xlSWRzKHNlcnZl
ci5pZCwgaWQpCiAgICAgIH0pOwogICAgfQogICAgcmV0dXJuIHJlcy5qc29uKHsgb2s6IHRydWUsIG1lbWJlcnMsIG1lOiBhd2FpdCBwZW9wbGVQZXJtaXNz
aW9uU25hcHNob3Qoc2Vzc2lvbi5pZCwgc2VydmVyLmlkKSB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgcm9sZXMv
bWVtYmVyc10iLCBlcnIpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZGUgY2hhcmdl
ciBsZXMgcsO0bGVzIGRlcyBtZW1icmVzLiIgfSk7CiAgfQp9KTsKCmFwcC5wdXQoIi9hcGkvc2VydmVycy86aWQvbWVtYmVycy86dXNlcklkL3JvbGVzIiwg
YXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7IGlmICgh
c2Vzc2lvbikgcmV0dXJuOwogICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVSZXF1aXJlUm9sZU1hbmFnZXIoc2Vzc2lvbiwgcmVxLnBhcmFtcy5pZCk7
CiAgICBpZiAoIXN0YXRlKSByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiVHUgbidhcyBwYXMgbGEgcGVybWlzc2lv
biBkZSBnw6lyZXIgbGVzIHLDtGxlcy4iIH0pOwogICAgY29uc3Qgcm9sZUlkcyA9IGF3YWl0IHBlb3BsZVNldE1lbWJlclJvbGVzKHJlcS5wYXJhbXMuaWQs
IHJlcS5wYXJhbXMudXNlcklkLCByZXEuYm9keT8ucm9sZUlkcywgc3RhdGUpOwogICAgYXdhaXQgcGVvcGxlQnJvYWRjYXN0U2VydmVyUGVybWlzc2lvblJl
ZnJlc2gocmVxLnBhcmFtcy5pZCk7CiAgICByZXR1cm4gcmVzLmpzb24oeyBvazogdHJ1ZSwgcm9sZUlkcyB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNv
bnN0IHN0YXR1cyA9IFsiTUVNQkVSX0lOVkFMSUQiLCAiUk9MRV9ISUVSQVJDSFkiXS5pbmNsdWRlcyhlcnI/LmNvZGUpID8gNDAwIDogNTAwOwogICAgcmV0
dXJuIHJlcy5zdGF0dXMoc3RhdHVzKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogZXJyPy5jb2RlID09PSAiUk9MRV9ISUVSQVJDSFkiID8gIlR1IG5lIHBl
dXggcGFzIGF0dHJpYnVlciBvdSByZXRpcmVyIHVuIHLDtGxlIMOpZ2FsIG91IHN1cMOpcmlldXIgYXUgdGllbi4iIDogIkltcG9zc2libGUgZGUgbW9kaWZp
ZXIgbGVzIHLDtGxlcyBkZSBjZSBtZW1icmUuIiB9KTsKICB9Cn0pOwoKYXBwLmdldCgiL2FwaS9zZXJ2ZXJzLzppZC9wZXJtaXNzaW9uLW92ZXJyaWRlcyIs
IGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOyBpZiAo
IXNlc3Npb24pIHJldHVybjsKICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgcGVvcGxlU2VydmVyUm9sZVN0YXRlKHNlc3Npb24uaWQsIHJlcS5wYXJhbXMuaWQp
OwogICAgaWYgKCFzdGF0ZSB8fCAhKHBlb3BsZVBlcm1pc3Npb25IYXMoc3RhdGUubWFzaywgIk1BTkFHRV9ST0xFUyIpIHx8IHBlb3BsZVBlcm1pc3Npb25I
YXMoc3RhdGUubWFzaywgIk1BTkFHRV9DSEFOTkVMUyIpKSkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9y
OiAiVHUgbidhcyBwYXMgbGEgcGVybWlzc2lvbiBkZSBnw6lyZXIgbGVzIHBlcm1pc3Npb25zIGRlIHNhbG9uLiIgfSk7CiAgICB9CiAgICBjb25zdCBjaGFu
bmVsID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChyZXEucGFyYW1zLmlkLCByZXEucXVlcnk/LmNoYW5uZWxJZCk7CiAgICBpZiAoIWNoYW5uZWwp
IHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJTYWxvbiBpbnRyb3V2YWJsZS4iIH0pOwogICAgY29uc3Qgb3ZlcnJp
ZGVzID0gYXdhaXQgcGVvcGxlTGlzdENoYW5uZWxSb2xlT3ZlcnJpZGVzKHJlcS5wYXJhbXMuaWQsIGNoYW5uZWwuaWQpOwogICAgcmV0dXJuIHJlcy5qc29u
KHsKICAgICAgb2s6IHRydWUsCiAgICAgIGNoYW5uZWwsCiAgICAgIG92ZXJyaWRlczogb3ZlcnJpZGVzLm1hcCgoaXRlbSkgPT4gKHsgLi4uaXRlbSwgYWxs
b3c6IHBlb3BsZVBlcm1pc3Npb25OYW1lcyhpdGVtLmFsbG93KSwgZGVueTogcGVvcGxlUGVybWlzc2lvbk5hbWVzKGl0ZW0uZGVueSkgfSkpCiAgICB9KTsK
ICB9IGNhdGNoIChlcnIpIHsKICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGRlIGNoYXJn
ZXIgbGVzIHBlcm1pc3Npb25zIGR1IHNhbG9uLiIgfSk7CiAgfQp9KTsKCmFwcC5wdXQoIi9hcGkvc2VydmVycy86aWQvY2hhbm5lbHMvOmNoYW5uZWxJZC9y
b2xlLW92ZXJyaWRlcy86cm9sZUlkIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9y
UmVxdWVzdChyZXEsIHJlcyk7IGlmICghc2Vzc2lvbikgcmV0dXJuOwogICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJSb2xlU3RhdGUoc2Vz
c2lvbi5pZCwgcmVxLnBhcmFtcy5pZCk7CiAgICBpZiAoIXN0YXRlIHx8ICEocGVvcGxlUGVybWlzc2lvbkhhcyhzdGF0ZS5tYXNrLCAiTUFOQUdFX1JPTEVT
IikgfHwgcGVvcGxlUGVybWlzc2lvbkhhcyhzdGF0ZS5tYXNrLCAiTUFOQUdFX0NIQU5ORUxTIikpKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMyku
anNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGfDqXJlciBsZXMgcGVybWlzc2lvbnMgZGUgc2Fsb24uIiB9
KTsKICAgIH0KICAgIGNvbnN0IG92ZXJyaWRlID0gYXdhaXQgcGVvcGxlU2V0Um9sZUNoYW5uZWxPdmVycmlkZSgKICAgICAgcmVxLnBhcmFtcy5pZCwgcmVx
LnBhcmFtcy5jaGFubmVsSWQsIHJlcS5wYXJhbXMucm9sZUlkLAogICAgICByZXEuYm9keT8uYWxsb3cgfHwgW10sIHJlcS5ib2R5Py5kZW55IHx8IFtdLCBz
dGF0ZQogICAgKTsKICAgIGF3YWl0IHBlb3BsZUJyb2FkY2FzdFNlcnZlclBlcm1pc3Npb25SZWZyZXNoKHJlcS5wYXJhbXMuaWQpOwogICAgcmV0dXJuIHJl
cy5qc29uKHsgb2s6IHRydWUsIG92ZXJyaWRlIH0pOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc3QgYmFkID0gWyJPVkVSUklERV9JTlZBTElEIiwiUk9M
RV9ISUVSQVJDSFkiLCJST0xFX1BFUk1JU1NJT05fRVNDQUxBVElPTiJdLmluY2x1ZGVzKGVycj8uY29kZSk7CiAgICByZXR1cm4gcmVzLnN0YXR1cyhiYWQg
PyA0MDAgOiA1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiBlcnI/LmNvZGUgPT09ICJST0xFX0hJRVJBUkNIWSIgPyAiQ2UgcsO0bGUgZXN0IHRyb3Ag
aGF1dCBkYW5zIGxhIGhpw6lyYXJjaGllLiIgOiBlcnI/LmNvZGUgPT09ICJST0xFX1BFUk1JU1NJT05fRVNDQUxBVElPTiIgPyAiVHUgbmUgcGV1eCBwYXMg
YXV0b3Jpc2VyIHVuZSBwZXJtaXNzaW9uIHF1ZSB0dSBuZSBwb3Nzw6hkZXMgcGFzLiIgOiAiSW1wb3NzaWJsZSBkZSBtb2RpZmllciBjZXMgcGVybWlzc2lv
bnMuIiB9KTsKICB9Cn0pOwoKYXBwLmRlbGV0ZSgiL2FwaS9zZXJ2ZXJzLzppZC9jaGFubmVscy86Y2hhbm5lbElkL3JvbGUtb3ZlcnJpZGVzLzpyb2xlSWQi
LCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsgaWYg
KCFzZXNzaW9uKSByZXR1cm47CiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHBlb3BsZVNlcnZlclJvbGVTdGF0ZShzZXNzaW9uLmlkLCByZXEucGFyYW1zLmlk
KTsKICAgIGlmICghc3RhdGUgfHwgIShwZW9wbGVQZXJtaXNzaW9uSGFzKHN0YXRlLm1hc2ssICJNQU5BR0VfUk9MRVMiKSB8fCBwZW9wbGVQZXJtaXNzaW9u
SGFzKHN0YXRlLm1hc2ssICJNQU5BR0VfQ0hBTk5FTFMiKSkpIHsKICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJv
cjogIlR1IG4nYXMgcGFzIGxhIHBlcm1pc3Npb24gZGUgZ8OpcmVyIGxlcyBwZXJtaXNzaW9ucyBkZSBzYWxvbi4iIH0pOwogICAgfQogICAgYXdhaXQgcGVv
cGxlRGVsZXRlUm9sZUNoYW5uZWxPdmVycmlkZShyZXEucGFyYW1zLmlkLCByZXEucGFyYW1zLmNoYW5uZWxJZCwgcmVxLnBhcmFtcy5yb2xlSWQpOwogICAg
YXdhaXQgcGVvcGxlQnJvYWRjYXN0U2VydmVyUGVybWlzc2lvblJlZnJlc2gocmVxLnBhcmFtcy5pZCk7CiAgICByZXR1cm4gcmVzLmpzb24oeyBvazogdHJ1
ZSB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGRl
IHLDqWluaXRpYWxpc2VyIGNlcyBwZXJtaXNzaW9ucy4iIH0pOwogIH0KfSk7CgoKLy8gPT09IFBFT1BMRV9TRVJWRVJfTU9ERVJBVElPTl9ST1VURVNfVjFf
U1RBUlQgPT09CmFwcC5kZWxldGUoIi9hcGkvc2VydmVycy86aWQvbWVtYmVycy86dXNlcklkIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAg
IGNvbnN0IHNlc3Npb24gPSBwZW9wbGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7IGlmICghc2Vzc2lvbikgcmV0dXJuOwogICAgY29uc3QgdGFyZ2V0
SWQgPSBTdHJpbmcocmVxLnBhcmFtcy51c2VySWQgfHwgIiIpOwogICAgaWYgKCEoYXdhaXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIodGFyZ2V0SWQsIHJlcS5w
YXJhbXMuaWQpKSkgewogICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiQ2UgbWVtYnJlIG4nZXN0IHBsdXMg
ZGFucyBsZSBzZXJ2ZXVyLiIgfSk7CiAgICB9CiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHBlb3BsZVNlcnZlckNhbk1vZGVyYXRlKHNlc3Npb24uaWQsIHJl
cS5wYXJhbXMuaWQsIHRhcmdldElkLCAiS0lDS19NRU1CRVJTIik7CiAgICBpZiAoIWNoZWNrLm9rKSByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBv
azogZmFsc2UsIGVycm9yOiBjaGVjay5yZWFzb24gfSk7CiAgICBhd2FpdCBwZW9wbGVTZXJ2ZXJSZW1vdmVNZW1iZXIocmVxLnBhcmFtcy5pZCwgdGFyZ2V0
SWQpOwogICAgcmV0dXJuIHJlcy5qc29uKHsgb2s6IHRydWUsIHVzZXJJZDogdGFyZ2V0SWQgfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVy
cm9yKCJbUGVvcGxlIHNlcnZlci9raWNrXSIsIGVycik7CiAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiSW1w
b3NzaWJsZSBkJ2V4Y2x1cmUgY2UgbWVtYnJlLiIgfSk7CiAgfQp9KTsKCmFwcC5nZXQoIi9hcGkvc2VydmVycy86aWQvYmFucyIsIGFzeW5jIChyZXEsIHJl
cykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOyBpZiAoIXNlc3Npb24pIHJldHVy
bjsKICAgIGlmICghKGF3YWl0IHBlb3BsZUNhblNlcnZlclBlcm1pc3Npb24oc2Vzc2lvbi5pZCwgcmVxLnBhcmFtcy5pZCwgIkJBTl9NRU1CRVJTIikpKSB7
CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIHZvaXIg
bGVzIGJhbm5pc3NlbWVudHMuIiB9KTsKICAgIH0KICAgIHJldHVybiByZXMuanNvbih7IG9rOiB0cnVlLCBiYW5zOiBhd2FpdCBwZW9wbGVTZXJ2ZXJMaXN0
QmFucyhyZXEucGFyYW1zLmlkKSB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc2VydmVyL2JhbnNdIiwgZXJyKTsK
ICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGRlIGNoYXJnZXIgbGVzIGJhbm5pc3NlbWVu
dHMuIiB9KTsKICB9Cn0pOwoKYXBwLnB1dCgiL2FwaS9zZXJ2ZXJzLzppZC9iYW5zLzp1c2VySWQiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewog
ICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsgaWYgKCFzZXNzaW9uKSByZXR1cm47CiAgICBjb25zdCB0YXJn
ZXRJZCA9IFN0cmluZyhyZXEucGFyYW1zLnVzZXJJZCB8fCAiIik7CiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgcGVvcGxlRmluZEFjY291bnRCeUlkKHRh
cmdldElkKTsKICAgIGlmICghYWNjb3VudCkgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlV0aWxpc2F0ZXVyIGlu
dHJvdXZhYmxlLiIgfSk7CiAgICBjb25zdCBjaGVjayA9IGF3YWl0IHBlb3BsZVNlcnZlckNhbk1vZGVyYXRlKHNlc3Npb24uaWQsIHJlcS5wYXJhbXMuaWQs
IHRhcmdldElkLCAiQkFOX01FTUJFUlMiKTsKICAgIGlmICghY2hlY2sub2spIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7IG9rOiBmYWxzZSwgZXJy
b3I6IGNoZWNrLnJlYXNvbiB9KTsKICAgIGF3YWl0IHBlb3BsZVNlcnZlckJhbk1lbWJlcihyZXEucGFyYW1zLmlkLCB0YXJnZXRJZCwgc2Vzc2lvbi5pZCwg
cmVxLmJvZHk/LnJlYXNvbik7CiAgICByZXR1cm4gcmVzLmpzb24oeyBvazogdHJ1ZSwgdXNlcklkOiB0YXJnZXRJZCB9KTsKICB9IGNhdGNoIChlcnIpIHsK
ICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc2VydmVyL2Jhbl0iLCBlcnIpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgb2s6IGZhbHNl
LCBlcnJvcjogIkltcG9zc2libGUgZGUgYmFubmlyIGNldCB1dGlsaXNhdGV1ci4iIH0pOwogIH0KfSk7CgphcHAuZGVsZXRlKCIvYXBpL3NlcnZlcnMvOmlk
L2JhbnMvOnVzZXJJZCIsIGFzeW5jIChyZXEsIHJlcykgPT4gewogIHRyeSB7CiAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3Qo
cmVxLCByZXMpOyBpZiAoIXNlc3Npb24pIHJldHVybjsKICAgIGlmICghKGF3YWl0IHBlb3BsZUNhblNlcnZlclBlcm1pc3Npb24oc2Vzc2lvbi5pZCwgcmVx
LnBhcmFtcy5pZCwgIkJBTl9NRU1CRVJTIikpKSB7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBu
J2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGxldmVyIGNlIGJhbm5pc3NlbWVudC4iIH0pOwogICAgfQogICAgYXdhaXQgcGVvcGxlU2VydmVyVW5iYW5NZW1i
ZXIocmVxLnBhcmFtcy5pZCwgcmVxLnBhcmFtcy51c2VySWQpOwogICAgcmV0dXJuIHJlcy5qc29uKHsgb2s6IHRydWUsIHVzZXJJZDogU3RyaW5nKHJlcS5w
YXJhbXMudXNlcklkIHx8ICIiKSB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc2VydmVyL3VuYmFuXSIsIGVycik7
CiAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBsZXZlciBjZSBiYW5uaXNzZW1lbnQu
IiB9KTsKICB9Cn0pOwovLyA9PT0gUEVPUExFX1NFUlZFUl9NT0RFUkFUSU9OX1JPVVRFU19WMV9FTkQgPT09CgovLyA9PT0gUEVPUExFX1JPTEVTX1BFUk1J
U1NJT05TX1YxX0VORCA9PT0KCi8vID09PSBQRU9QTEVfU0VSVkVSX0UyRUVfS0VZU19WMV9TVEFSVCA9PT0KLyoKICBWMTFBIOKAlCBhcmNoaXRlY3R1cmUg
RTJFRSBkZXMgc2VydmV1cnMuCgogIElNUE9SVEFOVCA6IGNlIGJsb2MgbmUgY2hpZmZyZSBQQVMgZW5jb3JlIGxlIHRleHRlIGRlcyBzYWxvbnMuIElsIHBy
w6lwYXJlCiAgbGEgY291Y2hlIGRlIGRpc3RyaWJ1dGlvbiBkZXMgY2zDqXMgcXVpIHNlcmEgdXRpbGlzw6llIHBhciBWMTFCLgoKICBQcmluY2lwZSA6CiAg
LSB1bmUgY2zDqSBBRVMtMjU2IGVzdCBjcsOpw6llIGPDtHTDqSBhcHBhcmVpbCBwb3VyIGNoYXF1ZSBzYWxvbi9lcG9jaCA7CiAgLSBsZSBzZXJ2ZXVyIG5l
IHJlw6dvaXQgamFtYWlzIGNldHRlIGNsw6kgZW4gY2xhaXIgOwogIC0gZWxsZSBlc3QgZW52ZWxvcHDDqWUgc8OpcGFyw6ltZW50IHBvdXIgY2hhcXVlIGFw
cGFyZWlsIGF1dG9yaXPDqSB2aWEgRUNESAogICAgUC0yNTYgKyBIS0RGLVNIQTI1NiArIEFFUy1HQ00gOwogIC0gdW4gY2hhbmdlbWVudCBkZSBtZW1icmVz
L3Blcm1pc3Npb25zIGTDqWNsZW5jaGUgdW4gbm91dmVsIGVwb2NoIDsKICAtIGxlcyBlbnZlbG9wcGVzIGQnYW5jaWVucyBlcG9jaHMgc29udCBjb25zZXJ2
w6llcyBwb3VyIGwnaGlzdG9yaXF1ZSA7CiAgLSBsJ0FQSSBlc3QgcGFnaW7DqWUvY2h1bmvDqWUgYWZpbiBkZSBuZSBwYXMgZMOpcGVuZHJlIGQndW5lIGxp
bWl0ZSBmaXhlIGRlCiAgICBtZW1icmVzIGRhbnMgdW4gc2VydmV1ci4KKi8KY29uc3QgUEVPUExFX1NFUlZFUl9FMkVFX1BST1RPQ09MID0gInBlb3BsZS1z
ZXJ2ZXItc2VuZGVyLWtleS12MSI7CmNvbnN0IFBFT1BMRV9TRVJWRVJfRTJFRV9TVUlURSA9ICJQMjU2LUhLREYtU0hBMjU2LUFFUzI1NkdDTSI7CmNvbnN0
IFBFT1BMRV9TRVJWRVJfRTJFRV9MT0NBTCA9IHBhdGhBY2NvdW50cy5qb2luKAogIF9fZGlybmFtZSwKICAicGVvcGxlLXNlcnZlci1lMmVlLmxvY2FsLmpz
b24iCik7CmNvbnN0IFBFT1BMRV9TRVJWRVJfRTJFRV9DTEFJTV9NUyA9IDIgKiA2MCAqIDEwMDA7CmNvbnN0IFBFT1BMRV9TRVJWRVJfRTJFRV9SRUNJUElF
TlRfUEFHRSA9IDEwMDsKY29uc3QgUEVPUExFX1NFUlZFUl9FMkVFX1BBQ0tBR0VfQ0hVTksgPSAxMDA7CgpmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlTm93
SXNvKCkgewogIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7Cn0KCmZ1bmN0aW9uIHBlb3BsZVNlcnZlckUyZWVDbGVhblJlYXNvbih2YWx1ZSkg
ewogIHJldHVybiBTdHJpbmcodmFsdWUgfHwgInJvdGF0aW9uIikKICAgIC50cmltKCkKICAgIC5yZXBsYWNlKC9bXHJcblx0XSsvZywgIiAiKQogICAgLnNs
aWNlKDAsIDgwKSB8fCAicm90YXRpb24iOwp9CgpmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlQ2xlYW5DaXBoZXIodmFsdWUsIG1pbiA9IDE2LCBtYXggPSA1
MTIpIHsKICBjb25zdCBjbGVhbiA9IFN0cmluZyh2YWx1ZSB8fCAiIikudHJpbSgpOwogIGlmICghbmV3IFJlZ0V4cChgXltBLVphLXowLTlfLV17JHttaW59
LCR7bWF4fX0kYCkudGVzdChjbGVhbikpIHJldHVybiAiIjsKICByZXR1cm4gY2xlYW47Cn0KCmZ1bmN0aW9uIHBlb3BsZVNlcnZlckUyZWVSZWFkTG9jYWwo
KSB7CiAgdHJ5IHsKICAgIGlmICghZnNBY2NvdW50cy5leGlzdHNTeW5jKFBFT1BMRV9TRVJWRVJfRTJFRV9MT0NBTCkpIHsKICAgICAgcmV0dXJuIHsgY2hh
bm5lbHM6IFtdLCBwYWNrYWdlczogW10gfTsKICAgIH0KICAgIGNvbnN0IHJhdyA9IEpTT04ucGFyc2UoZnNBY2NvdW50cy5yZWFkRmlsZVN5bmMoUEVPUExF
X1NFUlZFUl9FMkVFX0xPQ0FMLCAidXRmOCIpKTsKICAgIHJldHVybiB7CiAgICAgIGNoYW5uZWxzOiBBcnJheS5pc0FycmF5KHJhdz8uY2hhbm5lbHMpID8g
cmF3LmNoYW5uZWxzIDogW10sCiAgICAgIHBhY2thZ2VzOiBBcnJheS5pc0FycmF5KHJhdz8ucGFja2FnZXMpID8gcmF3LnBhY2thZ2VzIDogW10KICAgIH07
CiAgfSBjYXRjaCB7CiAgICByZXR1cm4geyBjaGFubmVsczogW10sIHBhY2thZ2VzOiBbXSB9OwogIH0KfQoKZnVuY3Rpb24gcGVvcGxlU2VydmVyRTJlZVdy
aXRlTG9jYWwoZGF0YSkgewogIGZzQWNjb3VudHMud3JpdGVGaWxlU3luYygKICAgIFBFT1BMRV9TRVJWRVJfRTJFRV9MT0NBTCwKICAgIEpTT04uc3RyaW5n
aWZ5KAogICAgICB7CiAgICAgICAgY2hhbm5lbHM6IEFycmF5LmlzQXJyYXkoZGF0YT8uY2hhbm5lbHMpID8gZGF0YS5jaGFubmVscyA6IFtdLAogICAgICAg
IHBhY2thZ2VzOiBBcnJheS5pc0FycmF5KGRhdGE/LnBhY2thZ2VzKSA/IGRhdGEucGFja2FnZXMgOiBbXQogICAgICB9LAogICAgICBudWxsLAogICAgICAy
CiAgICApICsgIlxuIiwKICAgICJ1dGY4IgogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZVNlcnZlckUyZWVQdWJsaWNTdGF0ZShyb3cpIHsKICBpZiAoIXJvdykg
cmV0dXJuIG51bGw7CiAgcmV0dXJuIHsKICAgIHNlcnZlcklkOiBTdHJpbmcocm93LnNlcnZlcklkID8/IHJvdy5zZXJ2ZXJfaWQgPz8gIiIpLAogICAgY2hh
bm5lbElkOiBTdHJpbmcocm93LmNoYW5uZWxJZCA/PyByb3cuY2hhbm5lbF9pZCA/PyAiIiksCiAgICBlcG9jaDogTWF0aC5tYXgoMSwgTnVtYmVyKHJvdy5l
cG9jaCB8fCAxKSksCiAgICBzdGF0dXM6IFN0cmluZyhyb3cuc3RhdHVzIHx8ICJwZW5kaW5nIikgPT09ICJyZWFkeSIgPyAicmVhZHkiIDogInBlbmRpbmci
LAogICAgcHJvdG9jb2w6IFN0cmluZyhyb3cucHJvdG9jb2wgfHwgUEVPUExFX1NFUlZFUl9FMkVFX1BST1RPQ09MKSwKICAgIHN1aXRlOiBTdHJpbmcocm93
LnN1aXRlIHx8IFBFT1BMRV9TRVJWRVJfRTJFRV9TVUlURSksCiAgICByZWFzb246IFN0cmluZyhyb3cucmVhc29uIHx8ICJpbml0aWFsIiksCiAgICBjb21t
aXRtZW50OiBTdHJpbmcocm93LmtleUNvbW1pdG1lbnQgPz8gcm93LmtleV9jb21taXRtZW50ID8/ICIiKSwKICAgIHJlcXVlc3RlZEF0OiByb3cucmVxdWVz
dGVkQXQgPz8gcm93LnJlcXVlc3RlZF9hdCA/PyBudWxsLAogICAgcmVhZHlBdDogcm93LnJlYWR5QXQgPz8gcm93LnJlYWR5X2F0ID8/IG51bGwsCiAgICBj
bGFpbWVkQXQ6IHJvdy5jbGFpbWVkQXQgPz8gcm93LmNsYWltZWRfYXQgPz8gbnVsbCwKICAgIHNlbmRlcjogKHJvdy5zZW5kZXJVc2VySWQgPz8gcm93LnNl
bmRlcl91c2VyX2lkKSAmJiAocm93LnNlbmRlckRldmljZUlkID8/IHJvdy5zZW5kZXJfZGV2aWNlX2lkKQogICAgICA/IHsKICAgICAgICAgIHVzZXJJZDog
U3RyaW5nKHJvdy5zZW5kZXJVc2VySWQgPz8gcm93LnNlbmRlcl91c2VyX2lkKSwKICAgICAgICAgIGRldmljZUlkOiBTdHJpbmcocm93LnNlbmRlckRldmlj
ZUlkID8/IHJvdy5zZW5kZXJfZGV2aWNlX2lkKSwKICAgICAgICAgIHB1YmxpY0p3azogKCgpID0+IHsKICAgICAgICAgICAgY29uc3QgcmF3ID0gcm93LnNl
bmRlclB1YmxpY0p3ayA/PyByb3cuc2VuZGVyX3B1YmxpY19qd2s7CiAgICAgICAgICAgIGlmICghcmF3KSByZXR1cm4gbnVsbDsKICAgICAgICAgICAgdHJ5
IHsKICAgICAgICAgICAgICByZXR1cm4gcGVvcGxlRTJlZVB1YmxpY0p3ayh0eXBlb2YgcmF3ID09PSAic3RyaW5nIiA/IEpTT04ucGFyc2UocmF3KSA6IHJh
dyk7CiAgICAgICAgICAgIH0gY2F0Y2ggewogICAgICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgICAgICB9CiAgICAgICAgICB9KSgpCiAgICAgICAg
fQogICAgICA6IG51bGwKICB9Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlR2V0U3RhdGUoc2VydmVySWQsIGNoYW5uZWxJZCkgewogIGNv
bnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgY2lkID0gU3RyaW5nKGNoYW5uZWxJZCB8fCAiIik7CiAgaWYgKCFzaWQgfHwgIWNp
ZCkgcmV0dXJuIG51bGw7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VM
RUNUIHNlcnZlcl9pZCwgY2hhbm5lbF9pZCwgZXBvY2gsIHN0YXR1cywgcHJvdG9jb2wsIHN1aXRlLCByZWFzb24sIGtleV9jb21taXRtZW50LCAiICsKICAg
ICAgInNlbmRlcl91c2VyX2lkLCBzZW5kZXJfZGV2aWNlX2lkLCBzZW5kZXJfcHVibGljX2p3aywgcmVxdWVzdGVkX2F0LCBjbGFpbWVkX2F0LCByZWFkeV9h
dCAiICsKICAgICAgIkZST00gcGVvcGxlX3NlcnZlcl9lMmVlX2NoYW5uZWxzIFdIRVJFIHNlcnZlcl9pZCA9ICQxIEFORCBjaGFubmVsX2lkID0gJDIgTElN
SVQgMSIsCiAgICAgIFtzaWQsIGNpZF0KICAgICk7CiAgICByZXR1cm4gcGVvcGxlU2VydmVyRTJlZVB1YmxpY1N0YXRlKHJlc3VsdC5yb3dzWzBdIHx8IG51
bGwpOwogIH0KCiAgY29uc3QgZGF0YSA9IHBlb3BsZVNlcnZlckUyZWVSZWFkTG9jYWwoKTsKICByZXR1cm4gcGVvcGxlU2VydmVyRTJlZVB1YmxpY1N0YXRl
KAogICAgZGF0YS5jaGFubmVscy5maW5kKChpdGVtKSA9PgogICAgICBTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09
IHNpZCAmJgogICAgICBTdHJpbmcoaXRlbS5jaGFubmVsSWQgPz8gaXRlbS5jaGFubmVsX2lkID8/ICIiKSA9PT0gY2lkCiAgICApIHx8IG51bGwKICApOwp9
Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlRW5zdXJlU3RhdGUoc2VydmVySWQsIGNoYW5uZWxJZCwgcmVhc29uID0gImluaXRpYWwiKSB7CiAg
Y29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICBjb25zdCBjaGFubmVs
ID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChzaWQsIGNpZCwgInRleHQiKTsKICBpZiAoIWNoYW5uZWwpIHJldHVybiBudWxsOwoKICBsZXQgc3Rh
dGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlR2V0U3RhdGUoc2lkLCBjaWQpOwogIGlmIChzdGF0ZSkgcmV0dXJuIHN0YXRlOwoKICBpZiAocGVvcGxlUG9v
bCkgewogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9zZXJ2ZXJfZTJlZV9jaGFu
bmVscyAiICsKICAgICAgIihzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIGVwb2NoLCBzdGF0dXMsIHByb3RvY29sLCBzdWl0ZSwgcmVhc29uKSAiICsKICAgICAg
IlZBTFVFUyAoJDEsICQyLCAxLCAncGVuZGluZycsICQzLCAkNCwgJDUpICIgKwogICAgICAiT04gQ09ORkxJQ1QgKHNlcnZlcl9pZCwgY2hhbm5lbF9pZCkg
RE8gTk9USElORyAiICsKICAgICAgIlJFVFVSTklORyBzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIGVwb2NoLCBzdGF0dXMsIHByb3RvY29sLCBzdWl0ZSwgcmVh
c29uLCBrZXlfY29tbWl0bWVudCwgIiArCiAgICAgICJzZW5kZXJfdXNlcl9pZCwgc2VuZGVyX2RldmljZV9pZCwgc2VuZGVyX3B1YmxpY19qd2ssIHJlcXVl
c3RlZF9hdCwgY2xhaW1lZF9hdCwgcmVhZHlfYXQiLAogICAgICBbc2lkLCBjaWQsIFBFT1BMRV9TRVJWRVJfRTJFRV9QUk9UT0NPTCwgUEVPUExFX1NFUlZF
Ul9FMkVFX1NVSVRFLCBwZW9wbGVTZXJ2ZXJFMmVlQ2xlYW5SZWFzb24ocmVhc29uKV0KICAgICk7CiAgICBpZiAocmVzdWx0LnJvd3NbMF0pIHJldHVybiBw
ZW9wbGVTZXJ2ZXJFMmVlUHVibGljU3RhdGUocmVzdWx0LnJvd3NbMF0pOwogICAgcmV0dXJuIHBlb3BsZVNlcnZlckUyZWVHZXRTdGF0ZShzaWQsIGNpZCk7
CiAgfQoKICBjb25zdCBkYXRhID0gcGVvcGxlU2VydmVyRTJlZVJlYWRMb2NhbCgpOwogIGNvbnN0IHJvdyA9IHsKICAgIHNlcnZlcklkOiBzaWQsCiAgICBj
aGFubmVsSWQ6IGNpZCwKICAgIGVwb2NoOiAxLAogICAgc3RhdHVzOiAicGVuZGluZyIsCiAgICBwcm90b2NvbDogUEVPUExFX1NFUlZFUl9FMkVFX1BST1RP
Q09MLAogICAgc3VpdGU6IFBFT1BMRV9TRVJWRVJfRTJFRV9TVUlURSwKICAgIHJlYXNvbjogcGVvcGxlU2VydmVyRTJlZUNsZWFuUmVhc29uKHJlYXNvbiks
CiAgICBrZXlDb21taXRtZW50OiAiIiwKICAgIHNlbmRlclVzZXJJZDogbnVsbCwKICAgIHNlbmRlckRldmljZUlkOiBudWxsLAogICAgc2VuZGVyUHVibGlj
SndrOiBudWxsLAogICAgcmVxdWVzdGVkQXQ6IHBlb3BsZVNlcnZlckUyZWVOb3dJc28oKSwKICAgIGNsYWltZWRBdDogbnVsbCwKICAgIHJlYWR5QXQ6IG51
bGwKICB9OwogIGRhdGEuY2hhbm5lbHMucHVzaChyb3cpOwogIHBlb3BsZVNlcnZlckUyZWVXcml0ZUxvY2FsKGRhdGEpOwogIHJldHVybiBwZW9wbGVTZXJ2
ZXJFMmVlUHVibGljU3RhdGUocm93KTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlU2VydmVyRTJlZU1lbWJlcklkcyhzZXJ2ZXJJZCkgewogIGNvbnN0IHNp
ZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgaWYgKCFzaWQpIHJldHVybiBbXTsKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0ID0g
YXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlNFTEVDVCB1c2VyX2lkIEZST00gcGVvcGxlX3NlcnZlcl9tZW1iZXJzIFdIRVJFIHNlcnZlcl9pZCA9
ICQxIE9SREVSIEJZIHVzZXJfaWQgQVNDIiwKICAgICAgW3NpZF0KICAgICk7CiAgICByZXR1cm4gcmVzdWx0LnJvd3MubWFwKChyb3cpID0+IFN0cmluZyhy
b3cudXNlcl9pZCkpOwogIH0KICByZXR1cm4gcGVvcGxlUmVhZExvY2FsU2VydmVycygpLm1lbWJlcnMKICAgIC5maWx0ZXIoKGl0ZW0pID0+IFN0cmluZyhp
dGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkKQogICAgLm1hcCgoaXRlbSkgPT4gU3RyaW5nKGl0ZW0udXNlcklkID8/IGl0
ZW0udXNlcl9pZCA/PyAiIikpCiAgICAuZmlsdGVyKEJvb2xlYW4pCiAgICAuc29ydCgpOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlUmVj
aXBpZW50RGV2aWNlcyhzZXJ2ZXJJZCwgY2hhbm5lbElkKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBT
dHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICBjb25zdCBtZW1iZXJzID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZU1lbWJlcklkcyhzaWQpOwogIGNvbnN0IG91
dHB1dCA9IFtdOwoKICBmb3IgKGNvbnN0IHVzZXJJZCBvZiBtZW1iZXJzKSB7CiAgICBpZiAoIShhd2FpdCBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKHVz
ZXJJZCwgc2lkLCAiVklFV19DSEFOTkVMIiwgY2lkKSkpIGNvbnRpbnVlOwogICAgY29uc3QgZGV2aWNlcyA9IGF3YWl0IHBlb3BsZUUyZWVEZXZpY2VzKHVz
ZXJJZCk7CiAgICBmb3IgKGNvbnN0IGRldmljZSBvZiBkZXZpY2VzKSB7CiAgICAgIGNvbnN0IGRldmljZUlkID0gcGVvcGxlRTJlZURldmljZUlkKGRldmlj
ZT8uZGV2aWNlSWQpOwogICAgICBjb25zdCBwdWJsaWNKd2sgPSBwZW9wbGVFMmVlUHVibGljSndrKGRldmljZT8ucHVibGljSndrKTsKICAgICAgaWYgKCFk
ZXZpY2VJZCB8fCAhcHVibGljSndrKSBjb250aW51ZTsKICAgICAgb3V0cHV0LnB1c2goeyB1c2VySWQ6IFN0cmluZyh1c2VySWQpLCBkZXZpY2VJZCwgcHVi
bGljSndrIH0pOwogICAgfQogIH0KCiAgb3V0cHV0LnNvcnQoKGEsIGIpID0+IHsKICAgIGNvbnN0IHVzZXJDb21wYXJlID0gU3RyaW5nKGEudXNlcklkKS5s
b2NhbGVDb21wYXJlKFN0cmluZyhiLnVzZXJJZCksICJlbiIsIHsgbnVtZXJpYzogdHJ1ZSB9KTsKICAgIHJldHVybiB1c2VyQ29tcGFyZSB8fCBTdHJpbmco
YS5kZXZpY2VJZCkubG9jYWxlQ29tcGFyZShTdHJpbmcoYi5kZXZpY2VJZCkpOwogIH0pOwogIHJldHVybiBvdXRwdXQ7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBl
b3BsZVNlcnZlckUyZWVSZWdpc3RlcmVkRGV2aWNlKHVzZXJJZCwgZGV2aWNlSWQpIHsKICBjb25zdCB1aWQgPSBTdHJpbmcodXNlcklkIHx8ICIiKTsKICBj
b25zdCBkaWQgPSBwZW9wbGVFMmVlRGV2aWNlSWQoZGV2aWNlSWQpOwogIGlmICghdWlkIHx8ICFkaWQpIHJldHVybiBudWxsOwogIGNvbnN0IGRldmljZXMg
PSBhd2FpdCBwZW9wbGVFMmVlRGV2aWNlcyh1aWQpOwogIHJldHVybiBkZXZpY2VzLmZpbmQoKGl0ZW0pID0+IFN0cmluZyhpdGVtLmRldmljZUlkKSA9PT0g
ZGlkKSB8fCBudWxsOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlUmVxdWVzdFJvdGF0aW9uQ2hhbm5lbChzZXJ2ZXJJZCwgY2hhbm5lbElk
LCByZWFzb24gPSAicm90YXRpb24iKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5l
bElkIHx8ICIiKTsKICBjb25zdCBjaGFubmVsID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChzaWQsIGNpZCwgInRleHQiKTsKICBpZiAoIWNoYW5u
ZWwpIHJldHVybiBudWxsOwogIGNvbnN0IG5vdyA9IERhdGUubm93KCk7CiAgY29uc3QgY3VycmVudCA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVFbnN1cmVT
dGF0ZShzaWQsIGNpZCwgcmVhc29uKTsKICBpZiAoIWN1cnJlbnQpIHJldHVybiBudWxsOwoKICAvLyBQbHVzaWV1cnMgaG9va3MgcGV1dmVudCBzaWduYWxl
ciBsZSBtw6ptZSBjaGFuZ2VtZW50LiBPbiBmdXNpb25uZSBsZXMKICAvLyByb3RhdGlvbnMgcGVuZGFudGVzIGTDqWNsZW5jaMOpZXMgcHJlc3F1ZSBzaW11
bHRhbsOpbWVudC4KICBjb25zdCByZXF1ZXN0ZWRNcyA9IG5ldyBEYXRlKGN1cnJlbnQucmVxdWVzdGVkQXQgfHwgMCkuZ2V0VGltZSgpOwogIGlmIChjdXJy
ZW50LnN0YXR1cyA9PT0gInBlbmRpbmciICYmIE51bWJlci5pc0Zpbml0ZShyZXF1ZXN0ZWRNcykgJiYgbm93IC0gcmVxdWVzdGVkTXMgPCAxNTAwKSB7CiAg
ICByZXR1cm4gY3VycmVudDsKICB9CgogIGxldCBuZXh0OwogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29s
LnF1ZXJ5KAogICAgICAiVVBEQVRFIHBlb3BsZV9zZXJ2ZXJfZTJlZV9jaGFubmVscyBTRVQgIiArCiAgICAgICJlcG9jaCA9IGVwb2NoICsgMSwgc3RhdHVz
ID0gJ3BlbmRpbmcnLCByZWFzb24gPSAkMywga2V5X2NvbW1pdG1lbnQgPSAnJywgIiArCiAgICAgICJzZW5kZXJfdXNlcl9pZCA9IE5VTEwsIHNlbmRlcl9k
ZXZpY2VfaWQgPSBOVUxMLCBzZW5kZXJfcHVibGljX2p3ayA9IE5VTEwsICIgKwogICAgICAicmVxdWVzdGVkX2F0ID0gTk9XKCksIGNsYWltZWRfYXQgPSBO
VUxMLCByZWFkeV9hdCA9IE5VTEwgIiArCiAgICAgICJXSEVSRSBzZXJ2ZXJfaWQgPSAkMSBBTkQgY2hhbm5lbF9pZCA9ICQyICIgKwogICAgICAiUkVUVVJO
SU5HIHNlcnZlcl9pZCwgY2hhbm5lbF9pZCwgZXBvY2gsIHN0YXR1cywgcHJvdG9jb2wsIHN1aXRlLCByZWFzb24sIGtleV9jb21taXRtZW50LCAiICsKICAg
ICAgInNlbmRlcl91c2VyX2lkLCBzZW5kZXJfZGV2aWNlX2lkLCBzZW5kZXJfcHVibGljX2p3aywgcmVxdWVzdGVkX2F0LCBjbGFpbWVkX2F0LCByZWFkeV9h
dCIsCiAgICAgIFtzaWQsIGNpZCwgcGVvcGxlU2VydmVyRTJlZUNsZWFuUmVhc29uKHJlYXNvbildCiAgICApOwogICAgbmV4dCA9IHBlb3BsZVNlcnZlckUy
ZWVQdWJsaWNTdGF0ZShyZXN1bHQucm93c1swXSk7CiAgfSBlbHNlIHsKICAgIGNvbnN0IGRhdGEgPSBwZW9wbGVTZXJ2ZXJFMmVlUmVhZExvY2FsKCk7CiAg
ICBjb25zdCByb3cgPSBkYXRhLmNoYW5uZWxzLmZpbmQoKGl0ZW0pID0+CiAgICAgIFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/
ICIiKSA9PT0gc2lkICYmCiAgICAgIFN0cmluZyhpdGVtLmNoYW5uZWxJZCA/PyBpdGVtLmNoYW5uZWxfaWQgPz8gIiIpID09PSBjaWQKICAgICk7CiAgICBp
ZiAoIXJvdykgcmV0dXJuIHBlb3BsZVNlcnZlckUyZWVFbnN1cmVTdGF0ZShzaWQsIGNpZCwgcmVhc29uKTsKICAgIHJvdy5lcG9jaCA9IE1hdGgubWF4KDEs
IE51bWJlcihyb3cuZXBvY2ggfHwgMSkpICsgMTsKICAgIHJvdy5zdGF0dXMgPSAicGVuZGluZyI7CiAgICByb3cucmVhc29uID0gcGVvcGxlU2VydmVyRTJl
ZUNsZWFuUmVhc29uKHJlYXNvbik7CiAgICByb3cua2V5Q29tbWl0bWVudCA9ICIiOwogICAgcm93LnNlbmRlclVzZXJJZCA9IG51bGw7CiAgICByb3cuc2Vu
ZGVyRGV2aWNlSWQgPSBudWxsOwogICAgcm93LnNlbmRlclB1YmxpY0p3ayA9IG51bGw7CiAgICByb3cucmVxdWVzdGVkQXQgPSBwZW9wbGVTZXJ2ZXJFMmVl
Tm93SXNvKCk7CiAgICByb3cuY2xhaW1lZEF0ID0gbnVsbDsKICAgIHJvdy5yZWFkeUF0ID0gbnVsbDsKICAgIHBlb3BsZVNlcnZlckUyZWVXcml0ZUxvY2Fs
KGRhdGEpOwogICAgbmV4dCA9IHBlb3BsZVNlcnZlckUyZWVQdWJsaWNTdGF0ZShyb3cpOwogIH0KCiAgaWYgKG5leHQpIHsKICAgIGF3YWl0IHBlb3BsZUVt
aXRTZXJ2ZXJDaGFubmVsRXZlbnQoc2lkLCBjaWQsICJzZXJ2ZXItZTJlZS1yb3RhdGlvbi1uZWVkZWQiLCB7CiAgICAgIHNlcnZlcklkOiBzaWQsCiAgICAg
IGNoYW5uZWxJZDogY2lkLAogICAgICBlcG9jaDogbmV4dC5lcG9jaCwKICAgICAgcmVhc29uOiBuZXh0LnJlYXNvbiwKICAgICAgcHJvdG9jb2w6IFBFT1BM
RV9TRVJWRVJfRTJFRV9QUk9UT0NPTAogICAgfSk7CiAgfQogIHJldHVybiBuZXh0Owp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlUmVxdWVz
dFJvdGF0aW9uQWxsKHNlcnZlcklkLCByZWFzb24gPSAicGVybWlzc2lvbnMiKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBp
ZiAoIXNpZCkgcmV0dXJuIFtdOwogIGNvbnN0IGNoYW5uZWxzID0gKGF3YWl0IHBlb3BsZUxpc3RTZXJ2ZXJDaGFubmVscyhzaWQpKS5maWx0ZXIoKGNoYW5u
ZWwpID0+IGNoYW5uZWwudHlwZSA9PT0gInRleHQiKTsKICBjb25zdCBvdXRwdXQgPSBbXTsKICBmb3IgKGNvbnN0IGNoYW5uZWwgb2YgY2hhbm5lbHMpIHsK
ICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJlcXVlc3RSb3RhdGlvbkNoYW5uZWwoc2lkLCBjaGFubmVsLmlkLCByZWFzb24pOwog
ICAgaWYgKHN0YXRlKSBvdXRwdXQucHVzaChzdGF0ZSk7CiAgfQogIHJldHVybiBvdXRwdXQ7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlckUyZWVE
cm9wQ2hhbm5lbChzZXJ2ZXJJZCwgY2hhbm5lbElkKSB7CiAgaWYgKHBlb3BsZVBvb2wpIHJldHVybjsgLy8gRksgT04gREVMRVRFIENBU0NBREUgZmFpdCBs
ZSB0cmF2YWlsLgogIGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgY29uc3QgY2lkID0gU3RyaW5nKGNoYW5uZWxJZCB8fCAiIik7CiAg
Y29uc3QgZGF0YSA9IHBlb3BsZVNlcnZlckUyZWVSZWFkTG9jYWwoKTsKICBkYXRhLmNoYW5uZWxzID0gZGF0YS5jaGFubmVscy5maWx0ZXIoKGl0ZW0pID0+
ICEoCiAgICBTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/PyBpdGVtLnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJgogICAgU3RyaW5nKGl0ZW0uY2hhbm5lbElk
ID8/IGl0ZW0uY2hhbm5lbF9pZCA/PyAiIikgPT09IGNpZAogICkpOwogIGRhdGEucGFja2FnZXMgPSBkYXRhLnBhY2thZ2VzLmZpbHRlcigoaXRlbSkgPT4g
ISgKICAgIFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmCiAgICBTdHJpbmcoaXRlbS5jaGFubmVsSWQg
Pz8gaXRlbS5jaGFubmVsX2lkID8/ICIiKSA9PT0gY2lkCiAgKSk7CiAgcGVvcGxlU2VydmVyRTJlZVdyaXRlTG9jYWwoZGF0YSk7Cn0KCmFzeW5jIGZ1bmN0
aW9uIHBlb3BsZVNlcnZlckUyZWVQYWNrYWdlRm9yRGV2aWNlKHNlcnZlcklkLCBjaGFubmVsSWQsIGVwb2NoLCB1c2VySWQsIGRldmljZUlkKSB7CiAgY29u
c3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICBjb25zdCB1aWQgPSBTdHJp
bmcodXNlcklkIHx8ICIiKTsKICBjb25zdCBkaWQgPSBTdHJpbmcoZGV2aWNlSWQgfHwgIiIpOwogIGNvbnN0IGUgPSBOdW1iZXIoZXBvY2ggfHwgMCk7CiAg
aWYgKCFzaWQgfHwgIWNpZCB8fCAhdWlkIHx8ICFkaWQgfHwgIWUpIHJldHVybiBudWxsOwoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29uc3QgcmVzdWx0
ID0gYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIlNFTEVDVCBpdiwgY2lwaGVydGV4dCBGUk9NIHBlb3BsZV9zZXJ2ZXJfZTJlZV9wYWNrYWdlcyAi
ICsKICAgICAgIldIRVJFIHNlcnZlcl9pZCA9ICQxIEFORCBjaGFubmVsX2lkID0gJDIgQU5EIGVwb2NoID0gJDMgQU5EIHVzZXJfaWQgPSAkNCBBTkQgZGV2
aWNlX2lkID0gJDUgTElNSVQgMSIsCiAgICAgIFtzaWQsIGNpZCwgZSwgdWlkLCBkaWRdCiAgICApOwogICAgY29uc3Qgcm93ID0gcmVzdWx0LnJvd3NbMF07
CiAgICByZXR1cm4gcm93ID8geyBpdjogU3RyaW5nKHJvdy5pdiksIGN0OiBTdHJpbmcocm93LmNpcGhlcnRleHQpIH0gOiBudWxsOwogIH0KCiAgY29uc3Qg
cm93ID0gcGVvcGxlU2VydmVyRTJlZVJlYWRMb2NhbCgpLnBhY2thZ2VzLmZpbmQoKGl0ZW0pID0+CiAgICBTdHJpbmcoaXRlbS5zZXJ2ZXJJZCA/PyBpdGVt
LnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJgogICAgU3RyaW5nKGl0ZW0uY2hhbm5lbElkID8/IGl0ZW0uY2hhbm5lbF9pZCA/PyAiIikgPT09IGNpZCAm
JgogICAgTnVtYmVyKGl0ZW0uZXBvY2ggfHwgMCkgPT09IGUgJiYKICAgIFN0cmluZyhpdGVtLnVzZXJJZCA/PyBpdGVtLnVzZXJfaWQgPz8gIiIpID09PSB1
aWQgJiYKICAgIFN0cmluZyhpdGVtLmRldmljZUlkID8/IGl0ZW0uZGV2aWNlX2lkID8/ICIiKSA9PT0gZGlkCiAgKTsKICByZXR1cm4gcm93ID8geyBpdjog
U3RyaW5nKHJvdy5pdiksIGN0OiBTdHJpbmcocm93LmN0ID8/IHJvdy5jaXBoZXJ0ZXh0ID8/ICIiKSB9IDogbnVsbDsKfQoKYXN5bmMgZnVuY3Rpb24gcGVv
cGxlU2VydmVyRTJlZUNsYWltKHNlcnZlcklkLCBjaGFubmVsSWQsIGFjY291bnRJZCwgZGV2aWNlSWQsIHJlc3RhcnQgPSBmYWxzZSwgY29tbWl0bWVudCA9
ICIiKSB7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICBjb25z
dCB1aWQgPSBTdHJpbmcoYWNjb3VudElkIHx8ICIiKTsKICBjb25zdCBkaWQgPSBwZW9wbGVFMmVlRGV2aWNlSWQoZGV2aWNlSWQpOwogIGNvbnN0IGtleUNv
bW1pdG1lbnQgPSBwZW9wbGVTZXJ2ZXJFMmVlQ2xlYW5DaXBoZXIoY29tbWl0bWVudCwgNDAsIDY0KTsKICBpZiAoIXNpZCB8fCAhY2lkIHx8ICF1aWQgfHwg
IWRpZCB8fCAha2V5Q29tbWl0bWVudCkgcmV0dXJuIHsgb2s6IGZhbHNlLCBjb2RlOiAiSU5WQUxJRCIgfTsKICBpZiAoIShhd2FpdCBwZW9wbGVDYW5TZXJ2
ZXJQZXJtaXNzaW9uKHVpZCwgc2lkLCAiVklFV19DSEFOTkVMIiwgY2lkKSkpIHsKICAgIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIkZPUkJJRERFTiIg
fTsKICB9CiAgY29uc3QgZGV2aWNlID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJlZ2lzdGVyZWREZXZpY2UodWlkLCBkaWQpOwogIGlmICghZGV2aWNlPy5w
dWJsaWNKd2spIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIkRFVklDRV9VTktOT1dOIiB9OwogIGNvbnN0IHB1YmxpY0p3ayA9IHBlb3BsZUUyZWVQdWJs
aWNKd2soZGV2aWNlLnB1YmxpY0p3ayk7CiAgaWYgKCFwdWJsaWNKd2spIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIkRFVklDRV9VTktOT1dOIiB9OwoK
ICBsZXQgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlRW5zdXJlU3RhdGUoc2lkLCBjaWQsICJpbml0aWFsIik7CiAgaWYgKCFzdGF0ZSB8fCBzdGF0
ZS5zdGF0dXMgIT09ICJwZW5kaW5nIikgcmV0dXJuIHsgb2s6IGZhbHNlLCBjb2RlOiAiTk9UX1BFTkRJTkciLCBzdGF0ZSB9OwoKICBjb25zdCBzYW1lU2Vu
ZGVyID0gc3RhdGUuc2VuZGVyICYmIHN0YXRlLnNlbmRlci51c2VySWQgPT09IHVpZCAmJiBzdGF0ZS5zZW5kZXIuZGV2aWNlSWQgPT09IGRpZDsKICBjb25z
dCBjbGFpbWVkQXQgPSBuZXcgRGF0ZShzdGF0ZS5jbGFpbWVkQXQgfHwgMCkuZ2V0VGltZSgpOwogIGNvbnN0IGV4cGlyZWQgPSAhTnVtYmVyLmlzRmluaXRl
KGNsYWltZWRBdCkgfHwgRGF0ZS5ub3coKSAtIGNsYWltZWRBdCA+IFBFT1BMRV9TRVJWRVJfRTJFRV9DTEFJTV9NUzsKICBpZiAoc3RhdGUuc2VuZGVyICYm
ICFzYW1lU2VuZGVyICYmICFleHBpcmVkKSB7CiAgICByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICJDTEFJTUVEIiwgc3RhdGUgfTsKICB9CgogIGlmIChw
ZW9wbGVQb29sKSB7CiAgICBjb25zdCBjbGllbnQgPSBhd2FpdCBwZW9wbGVQb29sLmNvbm5lY3QoKTsKICAgIHRyeSB7CiAgICAgIGF3YWl0IGNsaWVudC5x
dWVyeSgiQkVHSU4iKTsKICAgICAgY29uc3QgbG9ja2VkID0gYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICJTRUxFQ1QgZXBvY2gsIHN0YXR1cywgc2Vu
ZGVyX3VzZXJfaWQsIHNlbmRlcl9kZXZpY2VfaWQsIGNsYWltZWRfYXQgRlJPTSBwZW9wbGVfc2VydmVyX2UyZWVfY2hhbm5lbHMgIiArCiAgICAgICAgIldI
RVJFIHNlcnZlcl9pZCA9ICQxIEFORCBjaGFubmVsX2lkID0gJDIgRk9SIFVQREFURSIsCiAgICAgICAgW3NpZCwgY2lkXQogICAgICApOwogICAgICBjb25z
dCByb3cgPSBsb2NrZWQucm93c1swXTsKICAgICAgaWYgKCFyb3cgfHwgcm93LnN0YXR1cyAhPT0gInBlbmRpbmciKSB7CiAgICAgICAgYXdhaXQgY2xpZW50
LnF1ZXJ5KCJST0xMQkFDSyIpOwogICAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIk5PVF9QRU5ESU5HIiwgc3RhdGU6IGF3YWl0IHBlb3BsZVNl
cnZlckUyZWVHZXRTdGF0ZShzaWQsIGNpZCkgfTsKICAgICAgfQogICAgICBjb25zdCByb3dTYW1lID0gU3RyaW5nKHJvdy5zZW5kZXJfdXNlcl9pZCB8fCAi
IikgPT09IHVpZCAmJiBTdHJpbmcocm93LnNlbmRlcl9kZXZpY2VfaWQgfHwgIiIpID09PSBkaWQ7CiAgICAgIGNvbnN0IHJvd0NsYWltZWQgPSBuZXcgRGF0
ZShyb3cuY2xhaW1lZF9hdCB8fCAwKS5nZXRUaW1lKCk7CiAgICAgIGNvbnN0IHJvd0V4cGlyZWQgPSAhTnVtYmVyLmlzRmluaXRlKHJvd0NsYWltZWQpIHx8
IERhdGUubm93KCkgLSByb3dDbGFpbWVkID4gUEVPUExFX1NFUlZFUl9FMkVFX0NMQUlNX01TOwogICAgICBpZiAocm93LnNlbmRlcl91c2VyX2lkICYmICFy
b3dTYW1lICYmICFyb3dFeHBpcmVkKSB7CiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCJST0xMQkFDSyIpOwogICAgICAgIHJldHVybiB7IG9rOiBmYWxz
ZSwgY29kZTogIkNMQUlNRUQiLCBzdGF0ZTogYXdhaXQgcGVvcGxlU2VydmVyRTJlZUdldFN0YXRlKHNpZCwgY2lkKSB9OwogICAgICB9CgogICAgICBpZiAo
cmVzdGFydCB8fCAhcm93U2FtZSB8fCByb3dFeHBpcmVkKSB7CiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgIkRFTEVURSBGUk9NIHBl
b3BsZV9zZXJ2ZXJfZTJlZV9wYWNrYWdlcyBXSEVSRSBzZXJ2ZXJfaWQgPSAkMSBBTkQgY2hhbm5lbF9pZCA9ICQyIEFORCBlcG9jaCA9ICQzIiwKICAgICAg
ICAgIFtzaWQsIGNpZCwgTnVtYmVyKHJvdy5lcG9jaCldCiAgICAgICAgKTsKICAgICAgfQogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIlVQ
REFURSBwZW9wbGVfc2VydmVyX2UyZWVfY2hhbm5lbHMgU0VUIHNlbmRlcl91c2VyX2lkID0gJDMsIHNlbmRlcl9kZXZpY2VfaWQgPSAkNCwgIiArCiAgICAg
ICAgInNlbmRlcl9wdWJsaWNfandrID0gJDUsIGtleV9jb21taXRtZW50ID0gJDYsIGNsYWltZWRfYXQgPSBOT1coKSBXSEVSRSBzZXJ2ZXJfaWQgPSAkMSBB
TkQgY2hhbm5lbF9pZCA9ICQyIiwKICAgICAgICBbc2lkLCBjaWQsIHVpZCwgZGlkLCBKU09OLnN0cmluZ2lmeShwdWJsaWNKd2spLCBrZXlDb21taXRtZW50
XQogICAgICApOwogICAgICBhd2FpdCBjbGllbnQucXVlcnkoIkNPTU1JVCIpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGF3YWl0IGNsaWVudC5xdWVy
eSgiUk9MTEJBQ0siKS5jYXRjaCgoKSA9PiB7fSk7CiAgICAgIHRocm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAg
ICB9CiAgfSBlbHNlIHsKICAgIGNvbnN0IGRhdGEgPSBwZW9wbGVTZXJ2ZXJFMmVlUmVhZExvY2FsKCk7CiAgICBjb25zdCByb3cgPSBkYXRhLmNoYW5uZWxz
LmZpbmQoKGl0ZW0pID0+CiAgICAgIFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmCiAgICAgIFN0cmlu
ZyhpdGVtLmNoYW5uZWxJZCA/PyBpdGVtLmNoYW5uZWxfaWQgPz8gIiIpID09PSBjaWQKICAgICk7CiAgICBpZiAoIXJvdyB8fCBTdHJpbmcocm93LnN0YXR1
cyB8fCAiIikgIT09ICJwZW5kaW5nIikgewogICAgICByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICJOT1RfUEVORElORyIsIHN0YXRlOiBwZW9wbGVTZXJ2
ZXJFMmVlUHVibGljU3RhdGUocm93KSB9OwogICAgfQogICAgY29uc3Qgcm93U2FtZSA9IFN0cmluZyhyb3cuc2VuZGVyVXNlcklkIHx8ICIiKSA9PT0gdWlk
ICYmIFN0cmluZyhyb3cuc2VuZGVyRGV2aWNlSWQgfHwgIiIpID09PSBkaWQ7CiAgICBjb25zdCByb3dDbGFpbWVkID0gbmV3IERhdGUocm93LmNsYWltZWRB
dCB8fCAwKS5nZXRUaW1lKCk7CiAgICBjb25zdCByb3dFeHBpcmVkID0gIU51bWJlci5pc0Zpbml0ZShyb3dDbGFpbWVkKSB8fCBEYXRlLm5vdygpIC0gcm93
Q2xhaW1lZCA+IFBFT1BMRV9TRVJWRVJfRTJFRV9DTEFJTV9NUzsKICAgIGlmIChyb3cuc2VuZGVyVXNlcklkICYmICFyb3dTYW1lICYmICFyb3dFeHBpcmVk
KSB7CiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIkNMQUlNRUQiLCBzdGF0ZTogcGVvcGxlU2VydmVyRTJlZVB1YmxpY1N0YXRlKHJvdykgfTsK
ICAgIH0KICAgIGlmIChyZXN0YXJ0IHx8ICFyb3dTYW1lIHx8IHJvd0V4cGlyZWQpIHsKICAgICAgZGF0YS5wYWNrYWdlcyA9IGRhdGEucGFja2FnZXMuZmls
dGVyKChpdGVtKSA9PiAhKAogICAgICAgIFN0cmluZyhpdGVtLnNlcnZlcklkID8/IGl0ZW0uc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmCiAgICAgICAg
U3RyaW5nKGl0ZW0uY2hhbm5lbElkID8/IGl0ZW0uY2hhbm5lbF9pZCA/PyAiIikgPT09IGNpZCAmJgogICAgICAgIE51bWJlcihpdGVtLmVwb2NoIHx8IDAp
ID09PSBOdW1iZXIocm93LmVwb2NoIHx8IDApCiAgICAgICkpOwogICAgfQogICAgcm93LnNlbmRlclVzZXJJZCA9IHVpZDsKICAgIHJvdy5zZW5kZXJEZXZp
Y2VJZCA9IGRpZDsKICAgIHJvdy5zZW5kZXJQdWJsaWNKd2sgPSBwdWJsaWNKd2s7CiAgICByb3cua2V5Q29tbWl0bWVudCA9IGtleUNvbW1pdG1lbnQ7CiAg
ICByb3cuY2xhaW1lZEF0ID0gcGVvcGxlU2VydmVyRTJlZU5vd0lzbygpOwogICAgcGVvcGxlU2VydmVyRTJlZVdyaXRlTG9jYWwoZGF0YSk7CiAgfQoKICBz
dGF0ZSA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVHZXRTdGF0ZShzaWQsIGNpZCk7CiAgcmV0dXJuIHsgb2s6IHRydWUsIHN0YXRlIH07Cn0KCmFzeW5jIGZ1
bmN0aW9uIHBlb3BsZVNlcnZlckUyZWVTdG9yZVBhY2thZ2VDaHVuayhzZXJ2ZXJJZCwgY2hhbm5lbElkLCBhY2NvdW50SWQsIGJvZHkpIHsKICBjb25zdCBz
aWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGNvbnN0IHVpZCA9IFN0cmluZyhh
Y2NvdW50SWQgfHwgIiIpOwogIGNvbnN0IGVwb2NoID0gTWF0aC5tYXgoMCwgTnVtYmVyKGJvZHk/LmVwb2NoIHx8IDApKTsKICBjb25zdCBzZW5kZXJEZXZp
Y2VJZCA9IHBlb3BsZUUyZWVEZXZpY2VJZChib2R5Py5zZW5kZXJEZXZpY2VJZCk7CiAgY29uc3QgcGFja2FnZXMgPSBBcnJheS5pc0FycmF5KGJvZHk/LnBh
Y2thZ2VzKSA/IGJvZHkucGFja2FnZXMgOiBbXTsKICBpZiAoIWVwb2NoIHx8ICFzZW5kZXJEZXZpY2VJZCB8fCAhcGFja2FnZXMubGVuZ3RoIHx8IHBhY2th
Z2VzLmxlbmd0aCA+IFBFT1BMRV9TRVJWRVJfRTJFRV9QQUNLQUdFX0NIVU5LKSB7CiAgICByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICJJTlZBTElEIiB9
OwogIH0KCiAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlR2V0U3RhdGUoc2lkLCBjaWQpOwogIGlmICghc3RhdGUgfHwgc3RhdGUuc3Rh
dHVzICE9PSAicGVuZGluZyIgfHwgc3RhdGUuZXBvY2ggIT09IGVwb2NoIHx8CiAgICAgIHN0YXRlLnNlbmRlcj8udXNlcklkICE9PSB1aWQgfHwgc3RhdGUu
c2VuZGVyPy5kZXZpY2VJZCAhPT0gc2VuZGVyRGV2aWNlSWQpIHsKICAgIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIkNMQUlNX0xPU1QiIH07CiAgfQoK
ICBjb25zdCByZWNpcGllbnRzID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJlY2lwaWVudERldmljZXMoc2lkLCBjaWQpOwogIGNvbnN0IGFsbG93ZWQgPSBu
ZXcgU2V0KHJlY2lwaWVudHMubWFwKChpdGVtKSA9PiBgJHtpdGVtLnVzZXJJZH1cdTAwMDAke2l0ZW0uZGV2aWNlSWR9YCkpOwogIGNvbnN0IG5vcm1hbGl6
ZWQgPSBbXTsKICBjb25zdCBzZWVuID0gbmV3IFNldCgpOwogIGZvciAoY29uc3QgaXRlbSBvZiBwYWNrYWdlcykgewogICAgY29uc3QgdXNlcklkID0gU3Ry
aW5nKGl0ZW0/LnVzZXJJZCB8fCAiIik7CiAgICBjb25zdCBkZXZpY2VJZCA9IHBlb3BsZUUyZWVEZXZpY2VJZChpdGVtPy5kZXZpY2VJZCk7CiAgICBjb25z
dCBpdiA9IHBlb3BsZVNlcnZlckUyZWVDbGVhbkNpcGhlcihpdGVtPy5pdiwgMTYsIDQwKTsKICAgIGNvbnN0IGN0ID0gcGVvcGxlU2VydmVyRTJlZUNsZWFu
Q2lwaGVyKGl0ZW0/LmN0LCAzMiwgMjU2KTsKICAgIGNvbnN0IGtleSA9IGAke3VzZXJJZH1cdTAwMDAke2RldmljZUlkfWA7CiAgICBpZiAoIXVzZXJJZCB8
fCAhZGV2aWNlSWQgfHwgIWl2IHx8ICFjdCB8fCAhYWxsb3dlZC5oYXMoa2V5KSB8fCBzZWVuLmhhcyhrZXkpKSB7CiAgICAgIHJldHVybiB7IG9rOiBmYWxz
ZSwgY29kZTogIlJFQ0lQSUVOVF9JTlZBTElEIiB9OwogICAgfQogICAgc2Vlbi5hZGQoa2V5KTsKICAgIG5vcm1hbGl6ZWQucHVzaCh7IHVzZXJJZCwgZGV2
aWNlSWQsIGl2LCBjdCB9KTsKICB9CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCBjbGllbnQgPSBhd2FpdCBwZW9wbGVQb29sLmNvbm5lY3QoKTsK
ICAgIHRyeSB7CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiQkVHSU4iKTsKICAgICAgZm9yIChjb25zdCBpdGVtIG9mIG5vcm1hbGl6ZWQpIHsKICAgICAg
ICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiSU5TRVJUIElOVE8gcGVvcGxlX3NlcnZlcl9lMmVlX3BhY2thZ2VzICIgKwogICAgICAgICAgIihz
ZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIGVwb2NoLCB1c2VyX2lkLCBkZXZpY2VfaWQsIHNlbmRlcl91c2VyX2lkLCBzZW5kZXJfZGV2aWNlX2lkLCBpdiwgY2lw
aGVydGV4dCkgIiArCiAgICAgICAgICAiVkFMVUVTICgkMSwkMiwkMywkNCwkNSwkNiwkNywkOCwkOSkgIiArCiAgICAgICAgICAiT04gQ09ORkxJQ1QgKHNl
cnZlcl9pZCwgY2hhbm5lbF9pZCwgZXBvY2gsIHVzZXJfaWQsIGRldmljZV9pZCkgRE8gVVBEQVRFIFNFVCAiICsKICAgICAgICAgICJzZW5kZXJfdXNlcl9p
ZCA9IEVYQ0xVREVELnNlbmRlcl91c2VyX2lkLCBzZW5kZXJfZGV2aWNlX2lkID0gRVhDTFVERUQuc2VuZGVyX2RldmljZV9pZCwgIiArCiAgICAgICAgICAi
aXYgPSBFWENMVURFRC5pdiwgY2lwaGVydGV4dCA9IEVYQ0xVREVELmNpcGhlcnRleHQsIGNyZWF0ZWRfYXQgPSBOT1coKSIsCiAgICAgICAgICBbc2lkLCBj
aWQsIGVwb2NoLCBpdGVtLnVzZXJJZCwgaXRlbS5kZXZpY2VJZCwgdWlkLCBzZW5kZXJEZXZpY2VJZCwgaXRlbS5pdiwgaXRlbS5jdF0KICAgICAgICApOwog
ICAgICB9CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgiQ09NTUlUIik7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KCJS
T0xMQkFDSyIpLmNhdGNoKCgpID0+IHt9KTsKICAgICAgdGhyb3cgZXJyOwogICAgfSBmaW5hbGx5IHsKICAgICAgY2xpZW50LnJlbGVhc2UoKTsKICAgIH0K
ICB9IGVsc2UgewogICAgY29uc3QgZGF0YSA9IHBlb3BsZVNlcnZlckUyZWVSZWFkTG9jYWwoKTsKICAgIGZvciAoY29uc3QgaXRlbSBvZiBub3JtYWxpemVk
KSB7CiAgICAgIGRhdGEucGFja2FnZXMgPSBkYXRhLnBhY2thZ2VzLmZpbHRlcigocm93KSA9PiAhKAogICAgICAgIFN0cmluZyhyb3cuc2VydmVySWQgPz8g
cm93LnNlcnZlcl9pZCA/PyAiIikgPT09IHNpZCAmJgogICAgICAgIFN0cmluZyhyb3cuY2hhbm5lbElkID8/IHJvdy5jaGFubmVsX2lkID8/ICIiKSA9PT0g
Y2lkICYmCiAgICAgICAgTnVtYmVyKHJvdy5lcG9jaCB8fCAwKSA9PT0gZXBvY2ggJiYKICAgICAgICBTdHJpbmcocm93LnVzZXJJZCA/PyByb3cudXNlcl9p
ZCA/PyAiIikgPT09IGl0ZW0udXNlcklkICYmCiAgICAgICAgU3RyaW5nKHJvdy5kZXZpY2VJZCA/PyByb3cuZGV2aWNlX2lkID8/ICIiKSA9PT0gaXRlbS5k
ZXZpY2VJZAogICAgICApKTsKICAgICAgZGF0YS5wYWNrYWdlcy5wdXNoKHsKICAgICAgICBzZXJ2ZXJJZDogc2lkLAogICAgICAgIGNoYW5uZWxJZDogY2lk
LAogICAgICAgIGVwb2NoLAogICAgICAgIHVzZXJJZDogaXRlbS51c2VySWQsCiAgICAgICAgZGV2aWNlSWQ6IGl0ZW0uZGV2aWNlSWQsCiAgICAgICAgc2Vu
ZGVyVXNlcklkOiB1aWQsCiAgICAgICAgc2VuZGVyRGV2aWNlSWQsCiAgICAgICAgaXY6IGl0ZW0uaXYsCiAgICAgICAgY3Q6IGl0ZW0uY3QsCiAgICAgICAg
Y3JlYXRlZEF0OiBwZW9wbGVTZXJ2ZXJFMmVlTm93SXNvKCkKICAgICAgfSk7CiAgICB9CiAgICBwZW9wbGVTZXJ2ZXJFMmVlV3JpdGVMb2NhbChkYXRhKTsK
ICB9CgogIHJldHVybiB7IG9rOiB0cnVlLCBzdG9yZWQ6IG5vcm1hbGl6ZWQubGVuZ3RoIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlckUyZWVG
aW5hbGl6ZShzZXJ2ZXJJZCwgY2hhbm5lbElkLCBhY2NvdW50SWQsIGJvZHkpIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNv
bnN0IGNpZCA9IFN0cmluZyhjaGFubmVsSWQgfHwgIiIpOwogIGNvbnN0IHVpZCA9IFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwogIGNvbnN0IGVwb2NoID0g
TWF0aC5tYXgoMCwgTnVtYmVyKGJvZHk/LmVwb2NoIHx8IDApKTsKICBjb25zdCBzZW5kZXJEZXZpY2VJZCA9IHBlb3BsZUUyZWVEZXZpY2VJZChib2R5Py5z
ZW5kZXJEZXZpY2VJZCk7CiAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlR2V0U3RhdGUoc2lkLCBjaWQpOwogIGlmICghc3RhdGUgfHwg
c3RhdGUuc3RhdHVzICE9PSAicGVuZGluZyIgfHwgc3RhdGUuZXBvY2ggIT09IGVwb2NoIHx8ICFzZW5kZXJEZXZpY2VJZCB8fAogICAgICBzdGF0ZS5zZW5k
ZXI/LnVzZXJJZCAhPT0gdWlkIHx8IHN0YXRlLnNlbmRlcj8uZGV2aWNlSWQgIT09IHNlbmRlckRldmljZUlkKSB7CiAgICByZXR1cm4geyBvazogZmFsc2Us
IGNvZGU6ICJDTEFJTV9MT1NUIiB9OwogIH0KCiAgY29uc3QgZXhwZWN0ZWQgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlUmVjaXBpZW50RGV2aWNlcyhzaWQs
IGNpZCk7CiAgaWYgKCFleHBlY3RlZC5sZW5ndGgpIHJldHVybiB7IG9rOiBmYWxzZSwgY29kZTogIk5PX1JFQ0lQSUVOVFMiIH07CiAgY29uc3QgZXhwZWN0
ZWRLZXlzID0gbmV3IFNldChleHBlY3RlZC5tYXAoKGl0ZW0pID0+IGAke2l0ZW0udXNlcklkfVx1MDAwMCR7aXRlbS5kZXZpY2VJZH1gKSk7CiAgbGV0IGFj
dHVhbEtleXM7CgogIGlmIChwZW9wbGVQb29sKSB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiU0VMRUNUIHVz
ZXJfaWQsIGRldmljZV9pZCBGUk9NIHBlb3BsZV9zZXJ2ZXJfZTJlZV9wYWNrYWdlcyAiICsKICAgICAgIldIRVJFIHNlcnZlcl9pZCA9ICQxIEFORCBjaGFu
bmVsX2lkID0gJDIgQU5EIGVwb2NoID0gJDMgQU5EIHNlbmRlcl91c2VyX2lkID0gJDQgQU5EIHNlbmRlcl9kZXZpY2VfaWQgPSAkNSIsCiAgICAgIFtzaWQs
IGNpZCwgZXBvY2gsIHVpZCwgc2VuZGVyRGV2aWNlSWRdCiAgICApOwogICAgYWN0dWFsS2V5cyA9IG5ldyBTZXQocmVzdWx0LnJvd3MubWFwKChyb3cpID0+
IGAke1N0cmluZyhyb3cudXNlcl9pZCl9XHUwMDAwJHtTdHJpbmcocm93LmRldmljZV9pZCl9YCkpOwogIH0gZWxzZSB7CiAgICBhY3R1YWxLZXlzID0gbmV3
IFNldCgKICAgICAgcGVvcGxlU2VydmVyRTJlZVJlYWRMb2NhbCgpLnBhY2thZ2VzCiAgICAgICAgLmZpbHRlcigocm93KSA9PgogICAgICAgICAgU3RyaW5n
KHJvdy5zZXJ2ZXJJZCA/PyByb3cuc2VydmVyX2lkID8/ICIiKSA9PT0gc2lkICYmCiAgICAgICAgICBTdHJpbmcocm93LmNoYW5uZWxJZCA/PyByb3cuY2hh
bm5lbF9pZCA/PyAiIikgPT09IGNpZCAmJgogICAgICAgICAgTnVtYmVyKHJvdy5lcG9jaCB8fCAwKSA9PT0gZXBvY2ggJiYKICAgICAgICAgIFN0cmluZyhy
b3cuc2VuZGVyVXNlcklkID8/IHJvdy5zZW5kZXJfdXNlcl9pZCA/PyAiIikgPT09IHVpZCAmJgogICAgICAgICAgU3RyaW5nKHJvdy5zZW5kZXJEZXZpY2VJ
ZCA/PyByb3cuc2VuZGVyX2RldmljZV9pZCA/PyAiIikgPT09IHNlbmRlckRldmljZUlkCiAgICAgICAgKQogICAgICAgIC5tYXAoKHJvdykgPT4gYCR7U3Ry
aW5nKHJvdy51c2VySWQgPz8gcm93LnVzZXJfaWQpfVx1MDAwMCR7U3RyaW5nKHJvdy5kZXZpY2VJZCA/PyByb3cuZGV2aWNlX2lkKX1gKQogICAgKTsKICB9
CgogIGlmIChhY3R1YWxLZXlzLnNpemUgIT09IGV4cGVjdGVkS2V5cy5zaXplIHx8IFsuLi5leHBlY3RlZEtleXNdLnNvbWUoKGtleSkgPT4gIWFjdHVhbEtl
eXMuaGFzKGtleSkpKSB7CiAgICByZXR1cm4geyBvazogZmFsc2UsIGNvZGU6ICJSRUNJUElFTlRfU0VUX0NIQU5HRUQiLCBleHBlY3RlZDogZXhwZWN0ZWRL
ZXlzLnNpemUsIHN0b3JlZDogYWN0dWFsS2V5cy5zaXplIH07CiAgfQoKICBpZiAocGVvcGxlUG9vbCkgewogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgK
ICAgICAgIlVQREFURSBwZW9wbGVfc2VydmVyX2UyZWVfY2hhbm5lbHMgU0VUIHN0YXR1cyA9ICdyZWFkeScsIHJlYWR5X2F0ID0gTk9XKCkgIiArCiAgICAg
ICJXSEVSRSBzZXJ2ZXJfaWQgPSAkMSBBTkQgY2hhbm5lbF9pZCA9ICQyIEFORCBlcG9jaCA9ICQzIEFORCBzZW5kZXJfdXNlcl9pZCA9ICQ0IEFORCBzZW5k
ZXJfZGV2aWNlX2lkID0gJDUiLAogICAgICBbc2lkLCBjaWQsIGVwb2NoLCB1aWQsIHNlbmRlckRldmljZUlkXQogICAgKTsKICB9IGVsc2UgewogICAgY29u
c3QgZGF0YSA9IHBlb3BsZVNlcnZlckUyZWVSZWFkTG9jYWwoKTsKICAgIGNvbnN0IHJvdyA9IGRhdGEuY2hhbm5lbHMuZmluZCgoaXRlbSkgPT4KICAgICAg
U3RyaW5nKGl0ZW0uc2VydmVySWQgPz8gaXRlbS5zZXJ2ZXJfaWQgPz8gIiIpID09PSBzaWQgJiYKICAgICAgU3RyaW5nKGl0ZW0uY2hhbm5lbElkID8/IGl0
ZW0uY2hhbm5lbF9pZCA/PyAiIikgPT09IGNpZAogICAgKTsKICAgIGlmICghcm93IHx8IE51bWJlcihyb3cuZXBvY2ggfHwgMCkgIT09IGVwb2NoKSByZXR1
cm4geyBvazogZmFsc2UsIGNvZGU6ICJDTEFJTV9MT1NUIiB9OwogICAgcm93LnN0YXR1cyA9ICJyZWFkeSI7CiAgICByb3cucmVhZHlBdCA9IHBlb3BsZVNl
cnZlckUyZWVOb3dJc28oKTsKICAgIHBlb3BsZVNlcnZlckUyZWVXcml0ZUxvY2FsKGRhdGEpOwogIH0KCiAgY29uc3QgcmVhZHkgPSBhd2FpdCBwZW9wbGVT
ZXJ2ZXJFMmVlR2V0U3RhdGUoc2lkLCBjaWQpOwogIGF3YWl0IHBlb3BsZUVtaXRTZXJ2ZXJDaGFubmVsRXZlbnQoc2lkLCBjaWQsICJzZXJ2ZXItZTJlZS1r
ZXktcmVhZHkiLCB7CiAgICBzZXJ2ZXJJZDogc2lkLAogICAgY2hhbm5lbElkOiBjaWQsCiAgICBlcG9jaCwKICAgIHByb3RvY29sOiBQRU9QTEVfU0VSVkVS
X0UyRUVfUFJPVE9DT0wKICB9KTsKICByZXR1cm4geyBvazogdHJ1ZSwgc3RhdGU6IHJlYWR5IH07Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZUluaXRTZXJ2
ZXJFMmVlVjEoKSB7CiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAgICJDUkVBVEUgVEFCTEUgSUYgTk9UIEVY
SVNUUyBwZW9wbGVfc2VydmVyX2UyZWVfY2hhbm5lbHMgKCIgKwogICAgICAic2VydmVyX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9z
ZXJ2ZXJzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJjaGFubmVsX2lkIEJJR0lOVCBOT1QgTlVMTCBSRUZFUkVOQ0VTIHBlb3BsZV9zZXJ2
ZXJfY2hhbm5lbHMoaWQpIE9OIERFTEVURSBDQVNDQURFLCAiICsKICAgICAgImVwb2NoIElOVEVHRVIgTk9UIE5VTEwgREVGQVVMVCAxLCAiICsKICAgICAg
InN0YXR1cyBWQVJDSEFSKDEyKSBOT1QgTlVMTCBERUZBVUxUICdwZW5kaW5nJyBDSEVDSyhzdGF0dXMgSU4gKCdwZW5kaW5nJywncmVhZHknKSksICIgKwog
ICAgICAicHJvdG9jb2wgVkFSQ0hBUig2NCkgTk9UIE5VTEwgREVGQVVMVCAncGVvcGxlLXNlcnZlci1zZW5kZXIta2V5LXYxJywgIiArCiAgICAgICJzdWl0
ZSBWQVJDSEFSKDgwKSBOT1QgTlVMTCBERUZBVUxUICdQMjU2LUhLREYtU0hBMjU2LUFFUzI1NkdDTScsICIgKwogICAgICAicmVhc29uIFZBUkNIQVIoODAp
IE5PVCBOVUxMIERFRkFVTFQgJ2luaXRpYWwnLCAiICsKICAgICAgImtleV9jb21taXRtZW50IFZBUkNIQVIoNjQpIE5PVCBOVUxMIERFRkFVTFQgJycsICIg
KwogICAgICAic2VuZGVyX3VzZXJfaWQgQklHSU5UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfYWNjb3VudHMoaWQpIE9OIERFTEVURSBTRVQgTlVMTCwgIiAr
CiAgICAgICJzZW5kZXJfZGV2aWNlX2lkIFZBUkNIQVIoODApIE5VTEwsICIgKwogICAgICAic2VuZGVyX3B1YmxpY19qd2sgVEVYVCBOVUxMLCAiICsKICAg
ICAgInJlcXVlc3RlZF9hdCBUSU1FU1RBTVBUWiBOT1QgTlVMTCBERUZBVUxUIE5PVygpLCAiICsKICAgICAgImNsYWltZWRfYXQgVElNRVNUQU1QVFogTlVM
TCwgIiArCiAgICAgICJyZWFkeV9hdCBUSU1FU1RBTVBUWiBOVUxMLCAiICsKICAgICAgIlBSSU1BUlkgS0VZKHNlcnZlcl9pZCwgY2hhbm5lbF9pZCkiICsK
ICAgICAgIikiCiAgICApOwogICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIkFMVEVSIFRBQkxFIHBlb3BsZV9zZXJ2ZXJfZTJlZV9jaGFubmVs
cyBBREQgQ09MVU1OIElGIE5PVCBFWElTVFMga2V5X2NvbW1pdG1lbnQgVkFSQ0hBUig2NCkgTk9UIE5VTEwgREVGQVVMVCAnJyIKICAgICk7CiAgICBhd2Fp
dCBwZW9wbGVQb29sLnF1ZXJ5KAogICAgICAiQ1JFQVRFIFRBQkxFIElGIE5PVCBFWElTVFMgcGVvcGxlX3NlcnZlcl9lMmVlX3BhY2thZ2VzICgiICsKICAg
ICAgInNlcnZlcl9pZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfc2VydmVycyhpZCkgT04gREVMRVRFIENBU0NBREUsICIgKwogICAgICAi
Y2hhbm5lbF9pZCBCSUdJTlQgTk9UIE5VTEwgUkVGRVJFTkNFUyBwZW9wbGVfc2VydmVyX2NoYW5uZWxzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAg
ICAgICJlcG9jaCBJTlRFR0VSIE5PVCBOVUxMLCAiICsKICAgICAgInVzZXJfaWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRz
KGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJkZXZpY2VfaWQgVkFSQ0hBUig4MCkgTk9UIE5VTEwsICIgKwogICAgICAic2VuZGVyX3VzZXJf
aWQgQklHSU5UIE5PVCBOVUxMIFJFRkVSRU5DRVMgcGVvcGxlX2FjY291bnRzKGlkKSBPTiBERUxFVEUgQ0FTQ0FERSwgIiArCiAgICAgICJzZW5kZXJfZGV2
aWNlX2lkIFZBUkNIQVIoODApIE5PVCBOVUxMLCAiICsKICAgICAgIml2IFZBUkNIQVIoNjQpIE5PVCBOVUxMLCAiICsKICAgICAgImNpcGhlcnRleHQgVEVY
VCBOT1QgTlVMTCwgIiArCiAgICAgICJjcmVhdGVkX2F0IFRJTUVTVEFNUFRaIE5PVCBOVUxMIERFRkFVTFQgTk9XKCksICIgKwogICAgICAiUFJJTUFSWSBL
RVkoc2VydmVyX2lkLCBjaGFubmVsX2lkLCBlcG9jaCwgdXNlcl9pZCwgZGV2aWNlX2lkKSIgKwogICAgICAiKSIKICAgICk7CiAgICBhd2FpdCBwZW9wbGVQ
b29sLnF1ZXJ5KAogICAgICAiQ1JFQVRFIElOREVYIElGIE5PVCBFWElTVFMgcGVvcGxlX3NlcnZlcl9lMmVlX3BhY2thZ2VzX3VzZXJfaWR4ICIgKwogICAg
ICAiT04gcGVvcGxlX3NlcnZlcl9lMmVlX3BhY2thZ2VzKHVzZXJfaWQsIGRldmljZV9pZCwgc2VydmVyX2lkLCBjaGFubmVsX2lkLCBlcG9jaCBERVNDKSIK
ICAgICk7CiAgfQoKICBjb25zdCBzZXJ2ZXJzID0gcGVvcGxlUG9vbAogICAgPyAoYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgiU0VMRUNUIGlkIEZST00gcGVv
cGxlX3NlcnZlcnMgT1JERVIgQlkgaWQgQVNDIikpLnJvd3MubWFwKChyb3cpID0+IFN0cmluZyhyb3cuaWQpKQogICAgOiBwZW9wbGVSZWFkTG9jYWxTZXJ2
ZXJzKCkuc2VydmVycy5tYXAoKHNlcnZlcikgPT4gU3RyaW5nKHNlcnZlci5pZCkpOwoKICBmb3IgKGNvbnN0IHNlcnZlcklkIG9mIHNlcnZlcnMpIHsKICAg
IGNvbnN0IGNoYW5uZWxzID0gKGF3YWl0IHBlb3BsZUxpc3RTZXJ2ZXJDaGFubmVscyhzZXJ2ZXJJZCkpLmZpbHRlcigoY2hhbm5lbCkgPT4gY2hhbm5lbC50
eXBlID09PSAidGV4dCIpOwogICAgZm9yIChjb25zdCBjaGFubmVsIG9mIGNoYW5uZWxzKSB7CiAgICAgIGF3YWl0IHBlb3BsZVNlcnZlckUyZWVFbnN1cmVT
dGF0ZShzZXJ2ZXJJZCwgY2hhbm5lbC5pZCwgImluaXRpYWwiKTsKICAgIH0KICB9CgogIGNvbnNvbGUubG9nKCJbUGVvcGxlXSBBcmNoaXRlY3R1cmUgRTJF
RSBzZXJ2ZXVycyBWMTFBIHByw6p0ZSAoY2zDqXMgY8O0dMOpIGFwcGFyZWlscywgbWVzc2FnZXMgZW5jb3JlIGVuIGNsYWlyIGp1c3F1J8OgIFYxMUIpLiIp
Owp9CgpmdW5jdGlvbiBwZW9wbGVTZXJ2ZXJFMmVlSHR0cEVycm9yKHJlcywgY29kZSkgewogIGNvbnN0IG1lc3NhZ2VzID0gewogICAgRk9SQklEREVOOiBb
NDAzLCAiVHUgbidhcyBwYXMgYWNjw6hzIMOgIGNlIHNhbG9uLiJdLAogICAgREVWSUNFX1VOS05PV046IFs0MDAsICJDZXQgYXBwYXJlaWwgRTJFRSBuJ2Vz
dCBwYXMgZW5yZWdpc3Ryw6kuIl0sCiAgICBJTlZBTElEOiBbNDAwLCAiUmVxdcOqdGUgRTJFRSBpbnZhbGlkZS4iXSwKICAgIENMQUlNRUQ6IFs0MDksICJV
biBhdXRyZSBhcHBhcmVpbCBwcsOpcGFyZSBkw6lqw6AgbGEgY2zDqSBkZSBjZSBzYWxvbi4iXSwKICAgIE5PVF9QRU5ESU5HOiBbNDA5LCAiQ2V0IGVwb2No
IEUyRUUgbidlc3QgcGx1cyBlbiBhdHRlbnRlLiJdLAogICAgQ0xBSU1fTE9TVDogWzQwOSwgIkNldCBhcHBhcmVpbCBuZSBwb3Nzw6hkZSBwbHVzIGxlIHZl
cnJvdSBkZSBnw6luw6lyYXRpb24gZGUgY2zDqS4iXSwKICAgIFJFQ0lQSUVOVF9JTlZBTElEOiBbNDAwLCAiVW4gZGVzdGluYXRhaXJlIEUyRUUgZXN0IGlu
dmFsaWRlLiJdLAogICAgUkVDSVBJRU5UX1NFVF9DSEFOR0VEOiBbNDA5LCAiTGEgbGlzdGUgZGVzIGFwcGFyZWlscyBhdXRvcmlzw6lzIGEgY2hhbmfDqSBw
ZW5kYW50IGxhIHJvdGF0aW9uLiJdLAogICAgTk9fUkVDSVBJRU5UUzogWzQwOSwgIkF1Y3VuIGFwcGFyZWlsIEUyRUUgYXV0b3Jpc8OpIG4nZXN0IGRpc3Bv
bmlibGUuIl0KICB9OwogIGNvbnN0IFtzdGF0dXMsIGVycm9yXSA9IG1lc3NhZ2VzW2NvZGVdIHx8IFs1MDAsICJFcnJldXIgRTJFRSBzZXJ2ZXVyLiJdOwog
IHJldHVybiByZXMuc3RhdHVzKHN0YXR1cykuanNvbih7IG9rOiBmYWxzZSwgY29kZSwgZXJyb3IgfSk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZl
ckUyZWVSb3V0ZUNvbnRleHQocmVxLCByZXMpIHsKICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogIGlmICgh
c2Vzc2lvbikgcmV0dXJuIG51bGw7CiAgY29uc3Qgc2lkID0gU3RyaW5nKHJlcS5wYXJhbXMuaWQgfHwgIiIpOwogIGNvbnN0IGNpZCA9IFN0cmluZyhyZXEu
cGFyYW1zLmNoYW5uZWxJZCB8fCAiIik7CiAgY29uc3QgY2hhbm5lbCA9IGF3YWl0IHBlb3BsZUdldFNlcnZlckNoYW5uZWwoc2lkLCBjaWQsICJ0ZXh0Iik7
CiAgaWYgKCFjaGFubmVsKSB7CiAgICByZXMuc3RhdHVzKDQwNCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJTYWxvbiB0ZXh0dWVsIGludHJvdXZhYmxl
LiIgfSk7CiAgICByZXR1cm4gbnVsbDsKICB9CiAgaWYgKCEoYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbihzZXNzaW9uLmlkLCBzaWQsICJWSUVX
X0NIQU5ORUwiLCBjaWQpKSkgewogICAgcmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiVHUgbidhcyBwYXMgYWNjw6hzIMOgIGNl
IHNhbG9uLiIgfSk7CiAgICByZXR1cm4gbnVsbDsKICB9CiAgcmV0dXJuIHsgc2Vzc2lvbiwgc2lkLCBjaWQsIGNoYW5uZWwgfTsKfQoKYXBwLmdldCgiL2Fw
aS9zZXJ2ZXJzLzppZC9lMmVlL2NoYW5uZWxzLzpjaGFubmVsSWQvc3RhdGUiLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3QgY29u
dGV4dCA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVSb3V0ZUNvbnRleHQocmVxLCByZXMpOyBpZiAoIWNvbnRleHQpIHJldHVybjsKICAgIGNvbnN0IGRldmlj
ZUlkID0gcGVvcGxlRTJlZURldmljZUlkKHJlcS5xdWVyeT8uZGV2aWNlSWQpOwogICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlRW5z
dXJlU3RhdGUoY29udGV4dC5zaWQsIGNvbnRleHQuY2lkLCAiaW5pdGlhbCIpOwogICAgbGV0IHBhY2thZ2VGb3JEZXZpY2UgPSBudWxsOwogICAgbGV0IGRl
dmljZUtub3duID0gZmFsc2U7CiAgICBpZiAoZGV2aWNlSWQpIHsKICAgICAgZGV2aWNlS25vd24gPSBCb29sZWFuKGF3YWl0IHBlb3BsZVNlcnZlckUyZWVS
ZWdpc3RlcmVkRGV2aWNlKGNvbnRleHQuc2Vzc2lvbi5pZCwgZGV2aWNlSWQpKTsKICAgICAgaWYgKGRldmljZUtub3duICYmIHN0YXRlPy5zdGF0dXMgPT09
ICJyZWFkeSIpIHsKICAgICAgICBwYWNrYWdlRm9yRGV2aWNlID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZVBhY2thZ2VGb3JEZXZpY2UoCiAgICAgICAgICBj
b250ZXh0LnNpZCwgY29udGV4dC5jaWQsIHN0YXRlLmVwb2NoLCBjb250ZXh0LnNlc3Npb24uaWQsIGRldmljZUlkCiAgICAgICAgKTsKICAgICAgfQogICAg
fQogICAgcmV0dXJuIHJlcy5qc29uKHsKICAgICAgb2s6IHRydWUsCiAgICAgIC4uLnN0YXRlLAogICAgICBkZXZpY2VLbm93biwKICAgICAgcGFja2FnZTog
cGFja2FnZUZvckRldmljZSwKICAgICAgY2xhaW1FeHBpcmVzTXM6IFBFT1BMRV9TRVJWRVJfRTJFRV9DTEFJTV9NUwogICAgfSk7CiAgfSBjYXRjaCAoZXJy
KSB7CiAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxlIHNlcnZlciBFMkVFL3N0YXRlXSIsIGVycik7CiAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24o
eyBvazogZmFsc2UsIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIGwnw6l0YXQgRTJFRSBkdSBzYWxvbi4iIH0pOwogIH0KfSk7CgphcHAucG9zdCgi
L2FwaS9zZXJ2ZXJzLzppZC9lMmVlL2NoYW5uZWxzLzpjaGFubmVsSWQvY2xhaW0iLCBhc3luYyAocmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3Qg
Y29udGV4dCA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVSb3V0ZUNvbnRleHQocmVxLCByZXMpOyBpZiAoIWNvbnRleHQpIHJldHVybjsKICAgIGNvbnN0IHJl
c3VsdCA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVDbGFpbSgKICAgICAgY29udGV4dC5zaWQsIGNvbnRleHQuY2lkLCBjb250ZXh0LnNlc3Npb24uaWQsIHJl
cS5ib2R5Py5kZXZpY2VJZCwgcmVxLmJvZHk/LnJlc3RhcnQgPT09IHRydWUsIHJlcS5ib2R5Py5jb21taXRtZW50CiAgICApOwogICAgaWYgKCFyZXN1bHQu
b2spIHJldHVybiBwZW9wbGVTZXJ2ZXJFMmVlSHR0cEVycm9yKHJlcywgcmVzdWx0LmNvZGUpOwogICAgcmV0dXJuIHJlcy5qc29uKHsgb2s6IHRydWUsIC4u
LnJlc3VsdC5zdGF0ZSB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc2VydmVyIEUyRUUvY2xhaW1dIiwgZXJyKTsK
ICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGRlIHLDqXNlcnZlciBsYSByb3RhdGlvbiBF
MkVFLiIgfSk7CiAgfQp9KTsKCmFwcC5nZXQoIi9hcGkvc2VydmVycy86aWQvZTJlZS9jaGFubmVscy86Y2hhbm5lbElkL3JlY2lwaWVudHMiLCBhc3luYyAo
cmVxLCByZXMpID0+IHsKICB0cnkgewogICAgY29uc3QgY29udGV4dCA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVSb3V0ZUNvbnRleHQocmVxLCByZXMpOyBp
ZiAoIWNvbnRleHQpIHJldHVybjsKICAgIGNvbnN0IGRldmljZUlkID0gcGVvcGxlRTJlZURldmljZUlkKHJlcS5xdWVyeT8uZGV2aWNlSWQpOwogICAgY29u
c3QgZXBvY2ggPSBNYXRoLm1heCgwLCBOdW1iZXIocmVxLnF1ZXJ5Py5lcG9jaCB8fCAwKSk7CiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHBlb3BsZVNlcnZl
ckUyZWVHZXRTdGF0ZShjb250ZXh0LnNpZCwgY29udGV4dC5jaWQpOwogICAgaWYgKCFzdGF0ZSB8fCBzdGF0ZS5zdGF0dXMgIT09ICJwZW5kaW5nIiB8fCBz
dGF0ZS5lcG9jaCAhPT0gZXBvY2ggfHwKICAgICAgICBzdGF0ZS5zZW5kZXI/LnVzZXJJZCAhPT0gU3RyaW5nKGNvbnRleHQuc2Vzc2lvbi5pZCkgfHwgc3Rh
dGUuc2VuZGVyPy5kZXZpY2VJZCAhPT0gZGV2aWNlSWQpIHsKICAgICAgcmV0dXJuIHBlb3BsZVNlcnZlckUyZWVIdHRwRXJyb3IocmVzLCAiQ0xBSU1fTE9T
VCIpOwogICAgfQogICAgY29uc3QgYWxsID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJlY2lwaWVudERldmljZXMoY29udGV4dC5zaWQsIGNvbnRleHQuY2lk
KTsKICAgIGNvbnN0IGN1cnNvciA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoTnVtYmVyKHJlcS5xdWVyeT8uY3Vyc29yIHx8IDApKSk7CiAgICBjb25zdCBs
aW1pdCA9IE1hdGgubWF4KDEsIE1hdGgubWluKFBFT1BMRV9TRVJWRVJfRTJFRV9SRUNJUElFTlRfUEFHRSwgTWF0aC5mbG9vcihOdW1iZXIocmVxLnF1ZXJ5
Py5saW1pdCB8fCBQRU9QTEVfU0VSVkVSX0UyRUVfUkVDSVBJRU5UX1BBR0UpKSkpOwogICAgY29uc3QgcGFnZSA9IGFsbC5zbGljZShjdXJzb3IsIGN1cnNv
ciArIGxpbWl0KTsKICAgIGNvbnN0IG5leHRDdXJzb3IgPSBjdXJzb3IgKyBwYWdlLmxlbmd0aCA8IGFsbC5sZW5ndGggPyBTdHJpbmcoY3Vyc29yICsgcGFn
ZS5sZW5ndGgpIDogbnVsbDsKICAgIHJldHVybiByZXMuanNvbih7IG9rOiB0cnVlLCBlcG9jaCwgcmVjaXBpZW50czogcGFnZSwgbmV4dEN1cnNvciwgdG90
YWw6IGFsbC5sZW5ndGggfSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKCJbUGVvcGxlIHNlcnZlciBFMkVFL3JlY2lwaWVudHNdIiwg
ZXJyKTsKICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGRlIGNoYXJnZXIgbGVzIGFwcGFy
ZWlscyBFMkVFIGF1dG9yaXPDqXMuIiB9KTsKICB9Cn0pOwoKYXBwLnBvc3QoIi9hcGkvc2VydmVycy86aWQvZTJlZS9jaGFubmVscy86Y2hhbm5lbElkL3Bh
Y2thZ2VzIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlUm91dGVDb250
ZXh0KHJlcSwgcmVzKTsgaWYgKCFjb250ZXh0KSByZXR1cm47CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlU3RvcmVQYWNrYWdl
Q2h1bmsoCiAgICAgIGNvbnRleHQuc2lkLCBjb250ZXh0LmNpZCwgY29udGV4dC5zZXNzaW9uLmlkLCByZXEuYm9keSB8fCB7fQogICAgKTsKICAgIGlmICgh
cmVzdWx0Lm9rKSByZXR1cm4gcGVvcGxlU2VydmVyRTJlZUh0dHBFcnJvcihyZXMsIHJlc3VsdC5jb2RlKTsKICAgIHJldHVybiByZXMuanNvbihyZXN1bHQp
OwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBzZXJ2ZXIgRTJFRS9wYWNrYWdlc10iLCBlcnIpOwogICAgcmV0dXJuIHJl
cy5zdGF0dXMoNTAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZCdlbnJlZ2lzdHJlciBsZXMgZW52ZWxvcHBlcyBFMkVFLiIgfSk7
CiAgfQp9KTsKCmFwcC5wb3N0KCIvYXBpL3NlcnZlcnMvOmlkL2UyZWUvY2hhbm5lbHMvOmNoYW5uZWxJZC9maW5hbGl6ZSIsIGFzeW5jIChyZXEsIHJlcykg
PT4gewogIHRyeSB7CiAgICBjb25zdCBjb250ZXh0ID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJvdXRlQ29udGV4dChyZXEsIHJlcyk7IGlmICghY29udGV4
dCkgcmV0dXJuOwogICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcGVvcGxlU2VydmVyRTJlZUZpbmFsaXplKAogICAgICBjb250ZXh0LnNpZCwgY29udGV4dC5j
aWQsIGNvbnRleHQuc2Vzc2lvbi5pZCwgcmVxLmJvZHkgfHwge30KICAgICk7CiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuIHBlb3BsZVNlcnZlckUyZWVI
dHRwRXJyb3IocmVzLCByZXN1bHQuY29kZSk7CiAgICByZXR1cm4gcmVzLmpzb24oeyBvazogdHJ1ZSwgLi4ucmVzdWx0LnN0YXRlIH0pOwogIH0gY2F0Y2gg
KGVycikgewogICAgY29uc29sZS5lcnJvcigiW1Blb3BsZSBzZXJ2ZXIgRTJFRS9maW5hbGl6ZV0iLCBlcnIpOwogICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAw
KS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZGUgZmluYWxpc2VyIGxhIGNsw6kgRTJFRS4iIH0pOwogIH0KfSk7CgphcHAucG9zdCgi
L2FwaS9zZXJ2ZXJzLzppZC9lMmVlL2NoYW5uZWxzLzpjaGFubmVsSWQvcmVxdWVzdC1zeW5jIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgdHJ5IHsKICAg
IGNvbnN0IGNvbnRleHQgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlUm91dGVDb250ZXh0KHJlcSwgcmVzKTsgaWYgKCFjb250ZXh0KSByZXR1cm47CiAgICBj
b25zdCBkZXZpY2VJZCA9IHBlb3BsZUUyZWVEZXZpY2VJZChyZXEuYm9keT8uZGV2aWNlSWQpOwogICAgaWYgKCFkZXZpY2VJZCB8fCAhKGF3YWl0IHBlb3Bs
ZVNlcnZlckUyZWVSZWdpc3RlcmVkRGV2aWNlKGNvbnRleHQuc2Vzc2lvbi5pZCwgZGV2aWNlSWQpKSkgewogICAgICByZXR1cm4gcGVvcGxlU2VydmVyRTJl
ZUh0dHBFcnJvcihyZXMsICJERVZJQ0VfVU5LTk9XTiIpOwogICAgfQogICAgY29uc3Qgc3RhdGUgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlRW5zdXJlU3Rh
dGUoY29udGV4dC5zaWQsIGNvbnRleHQuY2lkLCAiZGV2aWNlLXN5bmMiKTsKICAgIGlmIChzdGF0ZS5zdGF0dXMgPT09ICJwZW5kaW5nIikgcmV0dXJuIHJl
cy5qc29uKHsgb2s6IHRydWUsIC4uLnN0YXRlIH0pOwogICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJFMmVlUGFja2FnZUZvckRldmlj
ZSgKICAgICAgY29udGV4dC5zaWQsIGNvbnRleHQuY2lkLCBzdGF0ZS5lcG9jaCwgY29udGV4dC5zZXNzaW9uLmlkLCBkZXZpY2VJZAogICAgKTsKICAgIGlm
IChleGlzdGluZykgcmV0dXJuIHJlcy5qc29uKHsgb2s6IHRydWUsIC4uLnN0YXRlLCBhbHJlYWR5QXZhaWxhYmxlOiB0cnVlIH0pOwogICAgY29uc3QgbmV4
dCA9IGF3YWl0IHBlb3BsZVNlcnZlckUyZWVSZXF1ZXN0Um90YXRpb25DaGFubmVsKGNvbnRleHQuc2lkLCBjb250ZXh0LmNpZCwgImRldmljZS1zeW5jIik7
CiAgICByZXR1cm4gcmVzLmpzb24oeyBvazogdHJ1ZSwgLi4ubmV4dCB9KTsKICB9IGNhdGNoIChlcnIpIHsKICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUg
c2VydmVyIEUyRUUvcmVxdWVzdC1zeW5jXSIsIGVycik7CiAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiSW1w
b3NzaWJsZSBkZSBzeW5jaHJvbmlzZXIgY2V0IGFwcGFyZWlsIEUyRUUuIiB9KTsKICB9Cn0pOwovLyA9PT0gUEVPUExFX1NFUlZFUl9FMkVFX0tFWVNfVjFf
RU5EID09PQoKCgphcHAuZ2V0KAogICIvYXBpL3NlcnZlcnMiLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lv
biA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QoCiAgICAgICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYgKCFz
ZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCBzZXJ2ZXJzID0KICAgICAgICBhd2FpdCBwZW9wbGVMaXN0U2VydmVyc0ZvclVzZXIoCiAgICAgICAgICBz
ZXNzaW9uLmlkCiAgICAgICAgKTsKCiAgICAgIHJlcy5qc29uKHsKICAgICAgICBvazogdHJ1ZSwKICAgICAgICBzZXJ2ZXJzCiAgICAgIH0pOwogICAgfSBj
YXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUgc2VydmVycy9saXN0XSIsCiAgICAgICAgZXJyCiAgICAgICk7Cgog
ICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIkltcG9zc2libGUgZGUgY2hh
cmdlciB0ZXMgc2VydmV1cnMuIgogICAgICB9KTsKICAgIH0KICB9Cik7CgphcHAucG9zdCgKICAiL2FwaS9zZXJ2ZXJzIiwKICBhc3luYyAocmVxLCByZXMp
ID0+IHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24gPQogICAgICAgIHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KAogICAgICAgICAgcmVxLAogICAg
ICAgICAgcmVzCiAgICAgICAgKTsKCiAgICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAgICAgY29uc3Qgc2VydmVyID0KICAgICAgICBhd2FpdCBwZW9w
bGVDcmVhdGVTZXJ2ZXIoCiAgICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgICAgcmVxLmJvZHk/Lm5hbWUKICAgICAgICApOwoKICAgICAgaWYgKCEoYXdh
aXQgcGVvcGxlRGVmYXVsdFNlcnZlckNoYW5uZWwoc2VydmVyLmlkLCAidGV4dCIpKSkgewogICAgICAgIGF3YWl0IHBlb3BsZUNyZWF0ZVNlcnZlckNoYW5u
ZWwoc2VydmVyLmlkLCAidGV4dCIsICJnw6luw6lyYWwiLCBudWxsKTsKICAgICAgfQogICAgICBpZiAoIShhd2FpdCBwZW9wbGVEZWZhdWx0U2VydmVyQ2hh
bm5lbChzZXJ2ZXIuaWQsICJ2b2ljZSIpKSkgewogICAgICAgIGF3YWl0IHBlb3BsZUNyZWF0ZVNlcnZlckNoYW5uZWwoc2VydmVyLmlkLCAidm9pY2UiLCAi
dm9jYWwiLCBudWxsKTsKICAgICAgfQoKICAgICAgcmVzLnN0YXR1cygyMDEpLmpzb24oewogICAgICAgIG9rOiB0cnVlLAogICAgICAgIHNlcnZlcjoKICAg
ICAgICAgIHBlb3BsZVNlcnZlclB1YmxpYyhzZXJ2ZXIpCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGlmICgKICAgICAgICBlcnI/LmNv
ZGUgPT09CiAgICAgICAgIlNFUlZFUl9OQU1FIgogICAgICApIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oewogICAgICAgICAgb2s6
IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICJMZSBub20gZHUgc2VydmV1ciBkb2l0IGZhaXJlIGVudHJlIDIgZXQgNDAgY2FyYWN0w6hy
ZXMuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICBjb25zb2xlLmVycm9yKAogICAgICAgICJbUGVvcGxlIHNlcnZlcnMvY3JlYXRlXSIsCiAgICAgICAg
ZXJyCiAgICAgICk7CgogICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIklt
cG9zc2libGUgZGUgY3LDqWVyIGxlIHNlcnZldXIuIgogICAgICB9KTsKICAgIH0KICB9Cik7CgovLyA9PT0gUEVPUExFX1NFUlZFUl9TRVRUSU5HU19WMV9S
RU5BTUVfU1RBUlQgPT09CmFwcC5wYXRjaCgKICAiL2FwaS9zZXJ2ZXJzLzppZCIsCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0cnkgewogICAgICBj
b25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVxLCByZXMpOwogICAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICAgIGNvbnN0
IHNlcnZlciA9IGF3YWl0IHBlb3BsZUdldFNlcnZlcihyZXEucGFyYW1zLmlkKTsKICAgICAgaWYgKCFzZXJ2ZXIpIHsKICAgICAgICByZXR1cm4gcmVzLnN0
YXR1cyg0MDQpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiU2VydmV1ciBpbnRyb3V2YWJsZS4iIH0pOwogICAgICB9CgogICAgICBpZiAoIShhd2FpdCBw
ZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKHNlc3Npb24uaWQsIHNlcnZlci5pZCwgIk1BTkFHRV9TRVJWRVIiKSkpIHsKICAgICAgICByZXR1cm4gcmVzLnN0
YXR1cyg0MDMpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGfDqXJl
ciBjZSBzZXJ2ZXVyLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgY29uc3QgbmFtZSA9IHBlb3BsZVNlcnZlck5hbWUocmVxLmJvZHk/Lm5hbWUpOwog
ICAgICBpZiAoIXBlb3BsZVZhbGlkU2VydmVyTmFtZShuYW1lKSkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgICBv
azogZmFsc2UsCiAgICAgICAgICBlcnJvcjogIkxlIG5vbSBkdSBzZXJ2ZXVyIGRvaXQgZmFpcmUgZW50cmUgMiBldCA0MCBjYXJhY3TDqHJlcy4iCiAgICAg
ICAgfSk7CiAgICAgIH0KCiAgICAgIGxldCB1cGRhdGVkOwogICAgICBpZiAocGVvcGxlUG9vbCkgewogICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHBl
b3BsZVBvb2wucXVlcnkoCiAgICAgICAgICAiVVBEQVRFIHBlb3BsZV9zZXJ2ZXJzIFNFVCBuYW1lID0gJDIgV0hFUkUgaWQgPSAkMSAiICsKICAgICAgICAg
ICJSRVRVUk5JTkcgaWQsIG5hbWUsIG93bmVyX2lkLCBpbnZpdGVfY29kZSwgaXNfb2ZmaWNpYWwsIGNyZWF0ZWRfYXQiLAogICAgICAgICAgW1N0cmluZyhz
ZXJ2ZXIuaWQpLCBuYW1lXQogICAgICAgICk7CiAgICAgICAgY29uc3Qgcm93ID0gcmVzdWx0LnJvd3NbMF07CiAgICAgICAgaWYgKCFyb3cpIHJldHVybiBy
ZXMuc3RhdHVzKDQwNCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJTZXJ2ZXVyIGludHJvdXZhYmxlLiIgfSk7CiAgICAgICAgdXBkYXRlZCA9IHsKICAg
ICAgICAgIGlkOiBTdHJpbmcocm93LmlkKSwgbmFtZTogcm93Lm5hbWUsCiAgICAgICAgICBvd25lcklkOiByb3cub3duZXJfaWQgPyBTdHJpbmcocm93Lm93
bmVyX2lkKSA6IG51bGwsCiAgICAgICAgICBpbnZpdGVDb2RlOiByb3cuaW52aXRlX2NvZGUsIG9mZmljaWFsOiBCb29sZWFuKHJvdy5pc19vZmZpY2lhbCks
CiAgICAgICAgICBjcmVhdGVkQXQ6IHJvdy5jcmVhdGVkX2F0CiAgICAgICAgfTsKICAgICAgfSBlbHNlIHsKICAgICAgICBjb25zdCBkYXRhID0gcGVvcGxl
UmVhZExvY2FsU2VydmVycygpOwogICAgICAgIGNvbnN0IHN0b3JlZCA9IGRhdGEuc2VydmVycy5maW5kKGl0ZW0gPT4gU3RyaW5nKGl0ZW0uaWQpID09PSBT
dHJpbmcoc2VydmVyLmlkKSk7CiAgICAgICAgaWYgKCFzdG9yZWQpIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJT
ZXJ2ZXVyIGludHJvdXZhYmxlLiIgfSk7CiAgICAgICAgLy8gT24gY2hhbmdlIHNldWxlbWVudCBsZSBub20gdmlzaWJsZTogaW52aXRlQ29kZSBldCBpZCBy
ZXN0ZW50IGludGFjdHMuCiAgICAgICAgc3RvcmVkLm5hbWUgPSBuYW1lOwogICAgICAgIHBlb3BsZVdyaXRlTG9jYWxTZXJ2ZXJzKGRhdGEpOwogICAgICAg
IHVwZGF0ZWQgPSB7IC4uLnN0b3JlZCB9OwogICAgICB9CgogICAgICBjb25zdCBwdWJsaWNTZXJ2ZXIgPSBwZW9wbGVTZXJ2ZXJQdWJsaWModXBkYXRlZCk7
CiAgICAgIGlvLnRvKHBlb3BsZVNlcnZlclJvb20oU3RyaW5nKHNlcnZlci5pZCkpKS5lbWl0KCJzZXJ2ZXItdXBkYXRlZCIsIHsgc2VydmVyOiBwdWJsaWNT
ZXJ2ZXIgfSk7CiAgICAgIHJldHVybiByZXMuanNvbih7IG9rOiB0cnVlLCBzZXJ2ZXI6IHB1YmxpY1NlcnZlciwgaW52aXRlVW5jaGFuZ2VkOiB0cnVlIH0p
OwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc2VydmVyL3NldHRpbmdzIHJlbmFtZV0iLCBlcnIpOwogICAgICBy
ZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiSW1wb3NzaWJsZSBkZSBtb2RpZmllciBsZSBzZXJ2ZXVyLiIgfSk7CiAg
ICB9CiAgfQopOwovLyA9PT0gUEVPUExFX1NFUlZFUl9TRVRUSU5HU19WMV9SRU5BTUVfRU5EID09PQoKLy8gPT09IFBFT1BMRV9TRVJWRVJfSUNPTl9WMV9S
T1VURV9TVEFSVCA9PT0KYXBwLnBhdGNoKAogICIvYXBpL3NlcnZlcnMvOmlkL2ljb24iLAogIGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAg
ICAgY29uc3Qgc2Vzc2lvbiA9IHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KHJlcSwgcmVzKTsKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBj
b25zdCBjdXJyZW50ID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyKHJlcS5wYXJhbXMuaWQpOwogICAgICBpZiAoIWN1cnJlbnQpIHsKICAgICAgICByZXR1cm4g
cmVzLnN0YXR1cyg0MDQpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiU2VydmV1ciBpbnRyb3V2YWJsZS4iIH0pOwogICAgICB9CiAgICAgIGlmICghKGF3
YWl0IHBlb3BsZUNhblNlcnZlclBlcm1pc3Npb24oc2Vzc2lvbi5pZCwgY3VycmVudC5pZCwgIk1BTkFHRV9TRVJWRVIiKSkpIHsKICAgICAgICByZXR1cm4g
cmVzLnN0YXR1cyg0MDMpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiVHUgbidhcyBwYXMgbGEgcGVybWlzc2lvbiBkZSBnw6lyZXIgY2Ugc2VydmV1ci4i
IH0pOwogICAgICB9CgogICAgICBjb25zdCByYXcgPSByZXEuYm9keT8uaWNvbkRhdGE7CiAgICAgIGxldCBpY29uRGF0YSA9IG51bGw7CgogICAgICBpZiAo
cmF3ICE9PSBudWxsICYmIHJhdyAhPT0gdW5kZWZpbmVkICYmIFN0cmluZyhyYXcpLnRyaW0oKSAhPT0gIiIpIHsKICAgICAgICBjb25zdCB2YWx1ZSA9IFN0
cmluZyhyYXcpOwogICAgICAgIGNvbnN0IG1hdGNoID0gdmFsdWUubWF0Y2goL15kYXRhOmltYWdlXC8ocG5nfGpwZWd8d2VicCk7YmFzZTY0LChbQS1aYS16
MC05Ky89XSspJC9pKTsKICAgICAgICBpZiAoIW1hdGNoKSB7CiAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBvazogZmFsc2UsIGVy
cm9yOiAiRm9ybWF0IGQnaW1hZ2UgaW52YWxpZGUuIFV0aWxpc2UgUE5HLCBKUEVHIG91IFdlYlAuIiB9KTsKICAgICAgICB9CgogICAgICAgIGxldCBkZWNv
ZGVkOwogICAgICAgIHRyeSB7IGRlY29kZWQgPSBCdWZmZXIuZnJvbShtYXRjaFsyXSwgImJhc2U2NCIpOyB9CiAgICAgICAgY2F0Y2ggeyBkZWNvZGVkID0g
bnVsbDsgfQogICAgICAgIGlmICghZGVjb2RlZCB8fCAhZGVjb2RlZC5sZW5ndGggfHwgZGVjb2RlZC5sZW5ndGggPiAzODQgKiAxMDI0KSB7CiAgICAgICAg
ICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiTCdpbWFnZSBkdSBzZXJ2ZXVyIGVzdCB0cm9wIGxvdXJkZS4iIH0p
OwogICAgICAgIH0KICAgICAgICBpY29uRGF0YSA9IHZhbHVlOwogICAgICB9CgogICAgICBpZiAocGVvcGxlUG9vbCkgewogICAgICAgIGF3YWl0IHBlb3Bs
ZVBvb2wucXVlcnkoCiAgICAgICAgICAiVVBEQVRFIHBlb3BsZV9zZXJ2ZXJzIFNFVCBpY29uX2RhdGEgPSAkMiBXSEVSRSBpZCA9ICQxIiwKICAgICAgICAg
IFtTdHJpbmcoY3VycmVudC5pZCksIGljb25EYXRhXQogICAgICAgICk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgY29uc3QgZGF0YSA9IHBlb3BsZVJlYWRM
b2NhbFNlcnZlcnMoKTsKICAgICAgICBjb25zdCBzdG9yZWQgPSBkYXRhLnNlcnZlcnMuZmluZChpdGVtID0+IFN0cmluZyhpdGVtLmlkKSA9PT0gU3RyaW5n
KGN1cnJlbnQuaWQpKTsKICAgICAgICBpZiAoIXN0b3JlZCkgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIlNlcnZl
dXIgaW50cm91dmFibGUuIiB9KTsKICAgICAgICBzdG9yZWQuaWNvbkRhdGEgPSBpY29uRGF0YTsKICAgICAgICBwZW9wbGVXcml0ZUxvY2FsU2VydmVycyhk
YXRhKTsKICAgICAgfQoKICAgICAgY29uc3QgdXBkYXRlZCA9IHsgLi4uY3VycmVudCwgaWNvbkRhdGEgfTsKICAgICAgY29uc3QgcHVibGljU2VydmVyID0g
cGVvcGxlU2VydmVyUHVibGljKHVwZGF0ZWQpOwogICAgICBpby50byhwZW9wbGVTZXJ2ZXJSb29tKFN0cmluZyhjdXJyZW50LmlkKSkpLmVtaXQoInNlcnZl
ci11cGRhdGVkIiwgeyBzZXJ2ZXI6IHB1YmxpY1NlcnZlciB9KTsKCiAgICAgIHJldHVybiByZXMuanNvbih7CiAgICAgICAgb2s6IHRydWUsCiAgICAgICAg
c2VydmVyOiBwdWJsaWNTZXJ2ZXIsCiAgICAgICAgaWRVbmNoYW5nZWQ6IHRydWUsCiAgICAgICAgaW52aXRlVW5jaGFuZ2VkOiB0cnVlCiAgICAgIH0pOwog
ICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgc2VydmVyL2ljb25dIiwgZXJyKTsKICAgICAgcmV0dXJuIHJlcy5zdGF0
dXMoNTAwKS5qc29uKHsgb2s6IGZhbHNlLCBlcnJvcjogIkltcG9zc2libGUgZGUgbW9kaWZpZXIgbCdpbWFnZSBkdSBzZXJ2ZXVyLiIgfSk7CiAgICB9CiAg
fQopOwovLyA9PT0gUEVPUExFX1NFUlZFUl9JQ09OX1YxX1JPVVRFX0VORCA9PT0KCmFwcC5nZXQoCiAgIi9hcGkvc2VydmVycy9pbnZpdGUvOmNvZGUiLAog
IGFzeW5jIChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QoCiAg
ICAgICAgICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCBzZXJ2ZXIgPQog
ICAgICAgIGF3YWl0IHBlb3BsZUdldFNlcnZlckJ5SW52aXRlKAogICAgICAgICAgcmVxLnBhcmFtcy5jb2RlCiAgICAgICAgKTsKCiAgICAgIGlmICghc2Vy
dmVyKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAg
ICAgICAiQ2V0dGUgaW52aXRhdGlvbiBuJ2V4aXN0ZSBwbHVzLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgLy8gPT09IFBFT1BMRV9OQVZJR0FUSU9O
X1BBUkFMTEVMX1YxX0lOVklURSA9PT0KICAgICAgY29uc3QgW2pvaW5lZCwgbWVtYmVyQ291bnRdID0KICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChbCiAg
ICAgICAgICBwZW9wbGVJc1NlcnZlck1lbWJlcigKICAgICAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICAgICAgc2VydmVyLmlkCiAgICAgICAgICApLAog
ICAgICAgICAgcGVvcGxlU2VydmVyTWVtYmVyQ291bnQoCiAgICAgICAgICAgIHNlcnZlci5pZAogICAgICAgICAgKQogICAgICAgIF0pOwoKICAgICAgcmVz
Lmpzb24oewogICAgICAgIG9rOiB0cnVlLAogICAgICAgIHNlcnZlcjogewogICAgICAgICAgLi4ucGVvcGxlU2VydmVyUHVibGljKAogICAgICAgICAgICBz
ZXJ2ZXIKICAgICAgICAgICksCiAgICAgICAgICBqb2luZWQsCiAgICAgICAgICBtZW1iZXJDb3VudAogICAgICAgIH0KICAgICAgfSk7CiAgICB9IGNhdGNo
IChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigKICAgICAgICAiW1Blb3BsZSBzZXJ2ZXJzL2ludml0ZSBwcmV2aWV3XSIsCiAgICAgICAgZXJyCiAgICAg
ICk7CgogICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIkltcG9zc2libGUg
ZGUgY2hhcmdlciBsJ2ludml0YXRpb24uIgogICAgICB9KTsKICAgIH0KICB9Cik7CgovLyA9PT0gUEVPUExFX1NFUlZFUl9NRU1CRVJTSElQX01FU1NBR0VT
X1YxX1NUQVJUID09PQphc3luYyBmdW5jdGlvbiBwZW9wbGVTYXZlU2VydmVyU3lzdGVtTWVzc2FnZSgKICBzZXJ2ZXJJZCwKICB0ZXh0CikgewogIGNvbnN0
IHNpZCA9CiAgICBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwoKICBjb25zdCBjbGVhblRleHQgPQogICAgU3RyaW5nKHRleHQgfHwgIiIpCiAgICAgIC50cmlt
KCkKICAgICAgLnNsaWNlKDAsIDEwMDApOwoKICBpZiAoCiAgICAhc2lkIHx8CiAgICAhY2xlYW5UZXh0CiAgKSB7CiAgICByZXR1cm4gbnVsbDsKICB9Cgog
IGNvbnN0IHRleHRDaGFubmVsID0gYXdhaXQgcGVvcGxlRGVmYXVsdFNlcnZlckNoYW5uZWwoc2lkLCAidGV4dCIpOwogIGNvbnN0IGNoYW5uZWxJZCA9IHRl
eHRDaGFubmVsID8gU3RyaW5nKHRleHRDaGFubmVsLmlkKSA6IG51bGw7CiAgaWYgKCFjaGFubmVsSWQpIHJldHVybiBudWxsOwoKICBpZiAocGVvcGxlUG9v
bCkgewogICAgY29uc3QgcmVzdWx0ID0KICAgICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAiSU5TRVJUIElOVE8gcGVvcGxlX2dlbmVyYWxf
bWVzc2FnZXMgIiArCiAgICAgICAgIihzZXJ2ZXJfaWQsIGNoYW5uZWxfaWQsIHNlbmRlcl9pZCwgdXNlcm5hbWUsIGJvZHksIGlzX3N5c3RlbSkgIiArCiAg
ICAgICAgIlZBTFVFUyAoJDEsICQyLCBOVUxMLCAkMywgJDQsIFRSVUUpICIgKwogICAgICAgICJSRVRVUk5JTkcgaWQsIGJvZHksIGNyZWF0ZWRfYXQiLAog
ICAgICAgIFsKICAgICAgICAgIHNpZCwKICAgICAgICAgIGNoYW5uZWxJZCwKICAgICAgICAgICJTeXN0w6htZSIsCiAgICAgICAgICBwZW9wbGVFbmNyeXB0
TWVzc2FnZVRleHQoCiAgICAgICAgICAgIGNsZWFuVGV4dAogICAgICAgICAgKQogICAgICAgIF0KICAgICAgKTsKCiAgICBjb25zdCByb3cgPQogICAgICBy
ZXN1bHQucm93c1swXTsKCiAgICByZXR1cm4gewogICAgICBpZDoKICAgICAgICBTdHJpbmcocm93LmlkKSwKICAgICAgc2VydmVySWQ6CiAgICAgICAgc2lk
LAogICAgICBjaGFubmVsSWQsCiAgICAgIHVzZXJuYW1lOgogICAgICAgICJTeXN0w6htZSIsCiAgICAgIHRleHQ6CiAgICAgICAgcGVvcGxlRGVjcnlwdE1l
c3NhZ2VUZXh0KAogICAgICAgICAgcm93LmJvZHkKICAgICAgICApLAogICAgICBzeXN0ZW06CiAgICAgICAgdHJ1ZSwKICAgICAgdGltZToKICAgICAgICBu
ZXcgRGF0ZSgKICAgICAgICAgIHJvdy5jcmVhdGVkX2F0CiAgICAgICAgKS5nZXRUaW1lKCkKICAgIH07CiAgfQoKICBjb25zdCBtZXNzYWdlcyA9CiAgICBw
ZW9wbGVSZWFkTG9jYWxHZW5lcmFsKCk7CgogIGNvbnN0IG1lc3NhZ2UgPSB7CiAgICBpZDoKICAgICAgY3J5cHRvQWNjb3VudHMucmFuZG9tVVVJRCgpLAog
ICAgc2VydmVySWQ6CiAgICAgIHNpZCwKICAgIGNoYW5uZWxJZCwKICAgIHNlbmRlcklkOgogICAgICBudWxsLAogICAgdXNlcm5hbWU6CiAgICAgICJTeXN0
w6htZSIsCiAgICB0ZXh0OgogICAgICBjbGVhblRleHQsCiAgICBpbWFnZUlkOgogICAgICBudWxsLAogICAgcmVwbHlUb0lkOgogICAgICBudWxsLAogICAg
c3lzdGVtOgogICAgICB0cnVlLAogICAgdGltZToKICAgICAgRGF0ZS5ub3coKQogIH07CgogIG1lc3NhZ2VzLnB1c2goCiAgICBtZXNzYWdlCiAgKTsKCiAg
cGVvcGxlV3JpdGVMb2NhbEdlbmVyYWwoCiAgICBtZXNzYWdlcwogICk7CgogIHJldHVybiBtZXNzYWdlOwp9Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVFbWl0
U2VydmVyTWVtYmVyc2hpcE1lc3NhZ2UoCiAgc2VydmVySWQsCiAgYWNjb3VudElkLAogIGFjdGlvbgopIHsKICBjb25zdCBzaWQgPQogICAgU3RyaW5nKHNl
cnZlcklkIHx8ICIiKTsKCiAgY29uc3QgdWlkID0KICAgIFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwoKICBpZiAoCiAgICAhc2lkIHx8CiAgICAhdWlkCiAg
KSB7CiAgICByZXR1cm47CiAgfQoKICBjb25zdCBhY2NvdW50ID0KICAgIGF3YWl0IHBlb3BsZUZpbmRBY2NvdW50QnlJZCgKICAgICAgdWlkCiAgICApOwoK
ICBjb25zdCB1c2VybmFtZSA9CiAgICBwZW9wbGVVc2VybmFtZSgKICAgICAgYWNjb3VudD8udXNlcm5hbWUgfHwKICAgICAgIlF1ZWxxdSd1biIKICAgICk7
CgogIGNvbnN0IHRleHQgPQogICAgYWN0aW9uID09PSAibGVhdmUiCiAgICAgID8gYCR7dXNlcm5hbWV9IGEgcXVpdHTDqSBsZSBzZXJ2ZXVyYAogICAgICA6
IGAke3VzZXJuYW1lfSBhIHJlam9pbnQgbGUgc2VydmV1cmA7CgogIGNvbnN0IHNhdmVkID0KICAgIGF3YWl0IHBlb3BsZVNhdmVTZXJ2ZXJTeXN0ZW1NZXNz
YWdlKAogICAgICBzaWQsCiAgICAgIHRleHQKICAgICk7CgogIGlmICghc2F2ZWQpIHsKICAgIHJldHVybjsKICB9CgogIGlvLnRvKAogICAgcGVvcGxlU2Vy
dmVyUm9vbSgKICAgICAgc2lkCiAgICApCiAgKS5lbWl0KAogICAgInN5c3RlbS1tZXNzYWdlIiwKICAgIHNhdmVkCiAgKTsKfQovLyA9PT0gUEVPUExFX1NF
UlZFUl9NRU1CRVJTSElQX01FU1NBR0VTX1YxX0VORCA9PT0KCmFwcC5wb3N0KAogICIvYXBpL3NlcnZlcnMvaW52aXRlLzpjb2RlL2pvaW4iLAogIGFzeW5j
IChyZXEsIHJlcykgPT4gewogICAgdHJ5IHsKICAgICAgY29uc3Qgc2Vzc2lvbiA9CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QoCiAgICAgICAg
ICByZXEsCiAgICAgICAgICByZXMKICAgICAgICApOwoKICAgICAgaWYgKCFzZXNzaW9uKSByZXR1cm47CgogICAgICBjb25zdCBzZXJ2ZXIgPQogICAgICAg
IGF3YWl0IHBlb3BsZUdldFNlcnZlckJ5SW52aXRlKAogICAgICAgICAgcmVxLnBhcmFtcy5jb2RlCiAgICAgICAgKTsKCiAgICAgIGlmICghc2VydmVyKSB7
CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAi
Q2V0dGUgaW52aXRhdGlvbiBuJ2V4aXN0ZSBwbHVzLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgaWYgKGF3YWl0IHBlb3BsZVNlcnZlcklzQmFubmVk
KHNlcnZlci5pZCwgc2Vzc2lvbi5pZCkpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAg
ICAgICAgZXJyb3I6ICJUdSBlcyBiYW5uaSBkZSBjZSBzZXJ2ZXVyLiIKICAgICAgICB9KTsKICAgICAgfQoKICAgICAgY29uc3Qgd2FzQWxyZWFkeU1lbWJl
ciA9CiAgICAgICAgYXdhaXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIoCiAgICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgICAgc2VydmVyLmlkCiAgICAgICAg
KTsKCiAgICAgIGF3YWl0IHBlb3BsZUpvaW5TZXJ2ZXIoCiAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICBzZXJ2ZXIuaWQKICAgICAgKTsKCiAgICAgIGlm
ICghd2FzQWxyZWFkeU1lbWJlcikgewogICAgICAgIGF3YWl0IHBlb3BsZVNlcnZlckUyZWVSZXF1ZXN0Um90YXRpb25BbGwoCiAgICAgICAgICBzZXJ2ZXIu
aWQsCiAgICAgICAgICAibWVtYmVyLWpvaW5lZCIKICAgICAgICApOwoKICAgICAgICBhd2FpdCBwZW9wbGVFbWl0U2VydmVyTWVtYmVyc2hpcE1lc3NhZ2Uo
CiAgICAgICAgICBzZXJ2ZXIuaWQsCiAgICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgICAgImpvaW4iCiAgICAgICAgKTsKCiAgICAgICAgYXdhaXQgZW1p
dE9ubGluZVVzZXJzKAogICAgICAgICAgc2VydmVyLmlkCiAgICAgICAgKTsKICAgICAgfQoKICAgICAgcmVzLmpzb24oewogICAgICAgIG9rOiB0cnVlLAog
ICAgICAgIHNlcnZlcjoKICAgICAgICAgIHBlb3BsZVNlcnZlclB1YmxpYyhzZXJ2ZXIpCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNv
bnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUgc2VydmVycy9qb2luXSIsCiAgICAgICAgZXJyCiAgICAgICk7CgogICAgICByZXMuc3RhdHVzKDUwMCku
anNvbih7CiAgICAgICAgb2s6IGZhbHNlLAogICAgICAgIGVycm9yOgogICAgICAgICAgIkltcG9zc2libGUgZGUgcmVqb2luZHJlIGxlIHNlcnZldXIuIgog
ICAgICB9KTsKICAgIH0KICB9Cik7CgovLyA9PT0gUEVPUExFX1NFUlZFUl9MRUFWRV9WMV9TVEFSVCA9PT0KYXBwLmRlbGV0ZSgKICAiL2FwaS9zZXJ2ZXJz
LzppZC9tZW1iZXJzaGlwIiwKICBhc3luYyAocmVxLCByZXMpID0+IHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24gPQogICAgICAgIHBlb3BsZVNl
c3Npb25Gb3JSZXF1ZXN0KAogICAgICAgICAgcmVxLAogICAgICAgICAgcmVzCiAgICAgICAgKTsKCiAgICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAg
ICAgY29uc3Qgc2VydmVyID0KICAgICAgICBhd2FpdCBwZW9wbGVHZXRTZXJ2ZXIoCiAgICAgICAgICByZXEucGFyYW1zLmlkCiAgICAgICAgKTsKCiAgICAg
IGlmICghc2VydmVyKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9y
OgogICAgICAgICAgICAiU2VydmV1ciBpbnRyb3V2YWJsZS4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IG1lbWJlciA9CiAgICAgICAgYXdh
aXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIoCiAgICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgICAgc2VydmVyLmlkCiAgICAgICAgKTsKCiAgICAgIGlmICgh
bWVtYmVyKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAg
ICAgICAgICAiVHUgbidlcyBwYXMgbWVtYnJlIGRlIGNlIHNlcnZldXIuIgogICAgICAgIH0pOwogICAgICB9CgogICAgICAvLyA9PT0gUEVPUExFX09XTkVS
X0NBTl9MRUFWRV9VU0VSX1NFUlZFUl9WMSA9PT0KICAgICAgY29uc3QgbGVhdmluZ093bmVyID0KICAgICAgICBCb29sZWFuKAogICAgICAgICAgc2VydmVy
Lm93bmVySWQgJiYKICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgc2VydmVyLm93bmVySWQKICAgICAgICAgICkgPT09CiAgICAgICAgICAgIFN0cmlu
ZygKICAgICAgICAgICAgICBzZXNzaW9uLmlkCiAgICAgICAgICAgICkKICAgICAgICApOwoKICAgICAgLyoKICAgICAgICBMZSBzZXJ2ZXVyIG9mZmljaWVs
IFBlb3BsZSByZXN0ZSBwZXJtYW5lbnQuCiAgICAgICAgUG91ciB1biBzZXJ2ZXVyIHV0aWxpc2F0ZXVyLCBsZSBwcm9wcmnDqXRhaXJlIHBldXQgcGFydGly
LgogICAgICAqLwogICAgICBpZiAoCiAgICAgICAgc2VydmVyLm9mZmljaWFsICYmCiAgICAgICAgbGVhdmluZ093bmVyCiAgICAgICkgewogICAgICAgIHJl
dHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIkxlIHByb3ByacOp
dGFpcmUgZHUgc2VydmV1ciBvZmZpY2llbCBQZW9wbGUgbmUgcGV1dCBwYXMgbGUgcXVpdHRlci4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGlmIChw
ZW9wbGVQb29sKSB7CiAgICAgICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAgICJERUxFVEUgRlJPTSBwZW9wbGVfc2VydmVyX21lbWJlcnMg
IiArCiAgICAgICAgICAiV0hFUkUgc2VydmVyX2lkID0gJDEgQU5EIHVzZXJfaWQgPSAkMiIsCiAgICAgICAgICBbCiAgICAgICAgICAgIFN0cmluZyhzZXJ2
ZXIuaWQpLAogICAgICAgICAgICBTdHJpbmcoc2Vzc2lvbi5pZCkKICAgICAgICAgIF0KICAgICAgICApOwoKICAgICAgICAvLyA9PT0gUEVPUExFX09XTkVS
X0NMRUFSX09OX0xFQVZFX1YxID09PQogICAgICAgIGlmIChsZWF2aW5nT3duZXIpIHsKICAgICAgICAgIGF3YWl0IHBlb3BsZVBvb2wucXVlcnkoCiAgICAg
ICAgICAgICJVUERBVEUgcGVvcGxlX3NlcnZlcnMgIiArCiAgICAgICAgICAgICJTRVQgb3duZXJfaWQgPSBOVUxMICIgKwogICAgICAgICAgICAiV0hFUkUg
aWQgPSAkMSBBTkQgaXNfb2ZmaWNpYWwgPSBGQUxTRSIsCiAgICAgICAgICAgIFsKICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICBzZXJ2
ZXIuaWQKICAgICAgICAgICAgICApCiAgICAgICAgICAgIF0KICAgICAgICAgICk7CiAgICAgICAgfQogICAgICB9IGVsc2UgewogICAgICAgIGNvbnN0IGRh
dGEgPQogICAgICAgICAgcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwoKICAgICAgICBkYXRhLm1lbWJlcnMgPQogICAgICAgICAgZGF0YS5tZW1iZXJzLmZp
bHRlcigKICAgICAgICAgICAgKGVudHJ5KSA9PgogICAgICAgICAgICAgICEoCiAgICAgICAgICAgICAgICBTdHJpbmcoZW50cnkuc2VydmVySWQpID09PQog
ICAgICAgICAgICAgICAgICBTdHJpbmcoc2VydmVyLmlkKSAmJgogICAgICAgICAgICAgICAgU3RyaW5nKGVudHJ5LnVzZXJJZCkgPT09CiAgICAgICAgICAg
ICAgICAgIFN0cmluZyhzZXNzaW9uLmlkKQogICAgICAgICAgICAgICkKICAgICAgICAgICk7CgogICAgICAgIGRhdGEubWVtYmVyUm9sZXMgPSAoZGF0YS5t
ZW1iZXJSb2xlcyB8fCBbXSkuZmlsdGVyKAogICAgICAgICAgKGVudHJ5KSA9PiAhKAogICAgICAgICAgICBTdHJpbmcoZW50cnkuc2VydmVySWQgPz8gZW50
cnkuc2VydmVyX2lkID8/ICIiKSA9PT0gU3RyaW5nKHNlcnZlci5pZCkgJiYKICAgICAgICAgICAgU3RyaW5nKGVudHJ5LnVzZXJJZCA/PyBlbnRyeS51c2Vy
X2lkID8/ICIiKSA9PT0gU3RyaW5nKHNlc3Npb24uaWQpCiAgICAgICAgICApCiAgICAgICAgKTsKCiAgICAgICAgaWYgKGxlYXZpbmdPd25lcikgewogICAg
ICAgICAgY29uc3Qgc3RvcmVkU2VydmVyID0KICAgICAgICAgICAgZGF0YS5zZXJ2ZXJzLmZpbmQoCiAgICAgICAgICAgICAgKGl0ZW0pID0+CiAgICAgICAg
ICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICAgIGl0ZW0uaWQKICAgICAgICAgICAgICAgICkgPT09CiAgICAgICAgICAgICAgICAgIFN0cmluZygK
ICAgICAgICAgICAgICAgICAgICBzZXJ2ZXIuaWQKICAgICAgICAgICAgICAgICAgKQogICAgICAgICAgICApOwoKICAgICAgICAgIGlmICgKICAgICAgICAg
ICAgc3RvcmVkU2VydmVyICYmCiAgICAgICAgICAgICFCb29sZWFuKAogICAgICAgICAgICAgIHN0b3JlZFNlcnZlci5vZmZpY2lhbAogICAgICAgICAgICAp
CiAgICAgICAgICApIHsKICAgICAgICAgICAgc3RvcmVkU2VydmVyLm93bmVySWQgPQogICAgICAgICAgICAgIG51bGw7CgogICAgICAgICAgICBzdG9yZWRT
ZXJ2ZXIub3duZXJfaWQgPQogICAgICAgICAgICAgIG51bGw7CiAgICAgICAgICB9CiAgICAgICAgfQoKICAgICAgICBwZW9wbGVXcml0ZUxvY2FsU2VydmVy
cygKICAgICAgICAgIGRhdGEKICAgICAgICApOwogICAgICB9CgogICAgICBmb3IgKAogICAgICAgIGNvbnN0IFsKICAgICAgICAgIHNvY2tldElkLAogICAg
ICAgICAgY3VycmVudFNlcnZlcklkCiAgICAgICAgXQogICAgICAgIG9mIHNvY2tldFNlcnZlcklkcy5lbnRyaWVzKCkKICAgICAgKSB7CiAgICAgICAgaWYg
KAogICAgICAgICAgU3RyaW5nKGN1cnJlbnRTZXJ2ZXJJZCkgIT09CiAgICAgICAgICAgIFN0cmluZyhzZXJ2ZXIuaWQpIHx8CiAgICAgICAgICBTdHJpbmco
CiAgICAgICAgICAgIHVzZXJJZHMuZ2V0KHNvY2tldElkKSB8fCAiIgogICAgICAgICAgKSAhPT0KICAgICAgICAgICAgU3RyaW5nKHNlc3Npb24uaWQpCiAg
ICAgICAgKSB7CiAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IHRhcmdldFNvY2tldCA9CiAgICAgICAgICBpby5zb2NrZXRz
LnNvY2tldHMuZ2V0KAogICAgICAgICAgICBzb2NrZXRJZAogICAgICAgICAgKTsKCiAgICAgICAgaWYgKHRhcmdldFNvY2tldCkgewogICAgICAgICAgbGVh
dmVWb2ljZSgKICAgICAgICAgICAgdGFyZ2V0U29ja2V0CiAgICAgICAgICApOwoKICAgICAgICAgIGF3YWl0IHRhcmdldFNvY2tldC5sZWF2ZSgKICAgICAg
ICAgICAgcGVvcGxlU2VydmVyUm9vbSgKICAgICAgICAgICAgICBzZXJ2ZXIuaWQKICAgICAgICAgICAgKQogICAgICAgICAgKTsKCiAgICAgICAgICB0YXJn
ZXRTb2NrZXQuZW1pdCgKICAgICAgICAgICAgInNlcnZlci1tZW1iZXJzaGlwLWxlZnQiLAogICAgICAgICAgICB7CiAgICAgICAgICAgICAgc2VydmVySWQ6
CiAgICAgICAgICAgICAgICBTdHJpbmcoc2VydmVyLmlkKQogICAgICAgICAgICB9CiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAgICAgc29ja2V0U2Vy
dmVySWRzLmRlbGV0ZSgKICAgICAgICAgIHNvY2tldElkCiAgICAgICAgKTsKICAgICAgfQoKICAgICAgLy8gPT09IFBFT1BMRV9WT0lDRV9NRU1CRVJTSElQ
X0NMRUFOVVBfVjIgPT09CiAgICAgIGZvciAoCiAgICAgICAgY29uc3QgWwogICAgICAgICAgdm9pY2VTb2NrZXRJZCwKICAgICAgICAgIHZvaWNlVXNlcgog
ICAgICAgIF0KICAgICAgICBvZiBbLi4udm9pY2VVc2Vycy5lbnRyaWVzKCldCiAgICAgICkgewogICAgICAgIGlmICgKICAgICAgICAgIFN0cmluZygKICAg
ICAgICAgICAgdm9pY2VVc2VyPy5zZXJ2ZXJJZCB8fAogICAgICAgICAgICAiIgogICAgICAgICAgKSAhPT0KICAgICAgICAgICAgU3RyaW5nKAogICAgICAg
ICAgICAgIHNlcnZlci5pZAogICAgICAgICAgICApIHx8CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIHZvaWNlVXNlcj8uYWNjb3VudElkIHx8CiAg
ICAgICAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgICAgICAgIHZvaWNlU29ja2V0SWQKICAgICAgICAgICAgKSB8fAogICAgICAgICAgICAiIgogICAgICAg
ICAgKSAhPT0KICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAgIHNlc3Npb24uaWQKICAgICAgICAgICAgKQogICAgICAgICkgewogICAgICAgICAg
Y29udGludWU7CiAgICAgICAgfQoKICAgICAgICBjb25zdCB2b2ljZVNvY2tldCA9CiAgICAgICAgICBpby5zb2NrZXRzLnNvY2tldHMuZ2V0KAogICAgICAg
ICAgICB2b2ljZVNvY2tldElkCiAgICAgICAgICApOwoKICAgICAgICBpZiAodm9pY2VTb2NrZXQpIHsKICAgICAgICAgIGxlYXZlVm9pY2UoCiAgICAgICAg
ICAgIHZvaWNlU29ja2V0CiAgICAgICAgICApOwogICAgICAgIH0KICAgICAgfQoKICAgICAgLy8gPT09IFBFT1BMRV9ERUxFVEVfRU1QVFlfQUZURVJfTEVB
VkVfVjEgPT09CiAgICAgIGNvbnN0IHNlcnZlckRlbGV0ZWQgPQogICAgICAgIGF3YWl0IHBlb3BsZURlbGV0ZVNlcnZlcklmRW1wdHkoCiAgICAgICAgICBz
ZXJ2ZXIuaWQKICAgICAgICApOwoKICAgICAgaWYgKCFzZXJ2ZXJEZWxldGVkKSB7CiAgICAgICAgYXdhaXQgcGVvcGxlU2VydmVyRTJlZVJlcXVlc3RSb3Rh
dGlvbkFsbCgKICAgICAgICAgIHNlcnZlci5pZCwKICAgICAgICAgICJtZW1iZXItbGVmdCIKICAgICAgICApOwoKICAgICAgICBlbWl0T25saW5lVXNlcnMo
CiAgICAgICAgICBzZXJ2ZXIuaWQKICAgICAgICApOwoKICAgICAgICBhd2FpdCBwZW9wbGVFbWl0U2VydmVyTWVtYmVyc2hpcE1lc3NhZ2UoCiAgICAgICAg
ICBzZXJ2ZXIuaWQsCiAgICAgICAgICBzZXNzaW9uLmlkLAogICAgICAgICAgImxlYXZlIgogICAgICAgICk7CiAgICAgIH0KCiAgICAgIHJlcy5qc29uKHsK
ICAgICAgICBvazogdHJ1ZSwKICAgICAgICBzZXJ2ZXJJZDoKICAgICAgICAgIFN0cmluZyhzZXJ2ZXIuaWQpLAogICAgICAgIGRlbGV0ZWQ6CiAgICAgICAg
ICBzZXJ2ZXJEZWxldGVkCiAgICAgIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgIltQZW9wbGUgc2VydmVy
cy9sZWF2ZV0iLAogICAgICAgIGVycgogICAgICApOwoKICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oewogICAgICAgIG9rOiBmYWxzZSwKICAgICAgICBl
cnJvcjoKICAgICAgICAgICJJbXBvc3NpYmxlIGRlIHF1aXR0ZXIgbGUgc2VydmV1ci4iCiAgICAgIH0pOwogICAgfQogIH0KKTsKLy8gPT09IFBFT1BMRV9T
RVJWRVJfTEVBVkVfVjFfRU5EID09PQoKLy8gPT09IFBFT1BMRV9TRVJWRVJfU0VUVElOR1NfVjJfTUVNQkVSU19ST1VURV9TVEFSVCA9PT0KYXBwLmdldCgK
ICAiL2FwaS9zZXJ2ZXJzLzppZC9tZW1iZXJzIiwKICBhc3luYyAocmVxLCByZXMpID0+IHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24gPSBwZW9w
bGVTZXNzaW9uRm9yUmVxdWVzdChyZXEsIHJlcyk7CiAgICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAgICAgY29uc3Qgc2VydmVyID0gYXdhaXQgcGVv
cGxlR2V0U2VydmVyKHJlcS5wYXJhbXMuaWQpOwogICAgICBpZiAoIXNlcnZlcikgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7IG9r
OiBmYWxzZSwgZXJyb3I6ICJTZXJ2ZXVyIGludHJvdXZhYmxlLiIgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IG1lbWJlciA9IGF3YWl0IHBlb3BsZUlzU2Vy
dmVyTWVtYmVyKHNlc3Npb24uaWQsIHNlcnZlci5pZCk7CiAgICAgIGlmICghbWVtYmVyKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29u
KHsgb2s6IGZhbHNlLCBlcnJvcjogIlR1IG4nZXMgcGFzIG1lbWJyZSBkZSBjZSBzZXJ2ZXVyLiIgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IHJvc3RlciA9
IGF3YWl0IHBlb3BsZVNlcnZlclByZXNlbmNlUm9zdGVyKHNlcnZlci5pZCk7CiAgICAgIGNvbnN0IG93bmVySWQgPSBzZXJ2ZXIub3duZXJJZCA/IFN0cmlu
ZyhzZXJ2ZXIub3duZXJJZCkgOiBudWxsOwogICAgICBjb25zdCBtZW1iZXJzID0gYXdhaXQgUHJvbWlzZS5hbGwocm9zdGVyLm1hcChhc3luYyAoZW50cnkp
ID0+IHsKICAgICAgICBjb25zdCBpZCA9IFN0cmluZyhlbnRyeS5hY2NvdW50SWQgfHwgZW50cnkuaWQgfHwgIiIpOwogICAgICAgIGNvbnN0IHJvbGVTdGF0
ZSA9IGF3YWl0IHBlb3BsZVNlcnZlclJvbGVTdGF0ZShpZCwgc2VydmVyLmlkKTsKICAgICAgICByZXR1cm4gewogICAgICAgICAgaWQsCiAgICAgICAgICBh
Y2NvdW50SWQ6IGlkLAogICAgICAgICAgdXNlcm5hbWU6IGVudHJ5LnVzZXJuYW1lIHx8ICJNZW1icmUiLAogICAgICAgICAgb25saW5lOiBCb29sZWFuKGVu
dHJ5Lm9ubGluZSksCiAgICAgICAgICBjb25uZWN0aW9uczogTnVtYmVyKGVudHJ5LmNvbm5lY3Rpb25zIHx8IDApLAogICAgICAgICAgb3duZXI6IEJvb2xl
YW4ob3duZXJJZCAmJiBpZCA9PT0gb3duZXJJZCksCiAgICAgICAgICByb2xlSWRzOiBBcnJheS5pc0FycmF5KHJvbGVTdGF0ZT8ucm9sZUlkcykgPyByb2xl
U3RhdGUucm9sZUlkcyA6IFtdLAogICAgICAgICAgaGlnaGVzdFJvbGVQb3NpdGlvbjogTnVtYmVyKHJvbGVTdGF0ZT8uaGlnaGVzdFJvbGVQb3NpdGlvbiB8
fCAwKQogICAgICAgIH07CiAgICAgIH0pKTsKCiAgICAgIHJldHVybiByZXMuanNvbih7CiAgICAgICAgb2s6IHRydWUsCiAgICAgICAgc2VydmVySWQ6IFN0
cmluZyhzZXJ2ZXIuaWQpLAogICAgICAgIGNvdW50OiBtZW1iZXJzLmxlbmd0aCwKICAgICAgICBvbmxpbmVDb3VudDogbWVtYmVycy5maWx0ZXIoaXRlbSA9
PiBpdGVtLm9ubGluZSkubGVuZ3RoLAogICAgICAgIG1lbWJlcnMKICAgICAgfSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgY29uc29sZS5lcnJvcigi
W1Blb3BsZSBzZXJ2ZXIvc2V0dGluZ3MgbWVtYmVyc10iLCBlcnIpOwogICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVy
cm9yOiAiSW1wb3NzaWJsZSBkZSBjaGFyZ2VyIGxlcyBtZW1icmVzLiIgfSk7CiAgICB9CiAgfQopOwovLyA9PT0gUEVPUExFX1NFUlZFUl9TRVRUSU5HU19W
Ml9NRU1CRVJTX1JPVVRFX0VORCA9PT0KCmFwcC5nZXQoCiAgIi9hcGkvc2VydmVycy86aWQvaW52aXRlIiwKICBhc3luYyAocmVxLCByZXMpID0+IHsKICAg
IHRyeSB7CiAgICAgIGNvbnN0IHNlc3Npb24gPQogICAgICAgIHBlb3BsZVNlc3Npb25Gb3JSZXF1ZXN0KAogICAgICAgICAgcmVxLAogICAgICAgICAgcmVz
CiAgICAgICAgKTsKCiAgICAgIGlmICghc2Vzc2lvbikgcmV0dXJuOwoKICAgICAgY29uc3Qgc2VydmVyID0KICAgICAgICBhd2FpdCBwZW9wbGVHZXRTZXJ2
ZXIoCiAgICAgICAgICByZXEucGFyYW1zLmlkCiAgICAgICAgKTsKCiAgICAgIGlmICghc2VydmVyKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0
KS5qc29uKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAiU2VydmV1ciBpbnRyb3V2YWJsZS4iCiAgICAgICAg
fSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IG1lbWJlciA9CiAgICAgICAgYXdhaXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIoCiAgICAgICAgICBzZXNzaW9uLmlk
LAogICAgICAgICAgc2VydmVyLmlkCiAgICAgICAgKTsKCiAgICAgIGlmICghbWVtYmVyKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29u
KHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAiVHUgbidlcyBwYXMgbWVtYnJlIGRlIGNlIHNlcnZldXIuIgog
ICAgICAgIH0pOwogICAgICB9CgogICAgICBpZiAoIShhd2FpdCBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKHNlc3Npb24uaWQsIHNlcnZlci5pZCwgIkNS
RUFURV9JTlZJVEUiKSkpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJy
b3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIGNyw6llciB1bmUgaW52aXRhdGlvbi4iCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIHJlcy5q
c29uKHsKICAgICAgICBvazogdHJ1ZSwKICAgICAgICBpbnZpdGVQYXRoOgogICAgICAgICAgIi9pbnZpdGUvIiArCiAgICAgICAgICBzZXJ2ZXIuaW52aXRl
Q29kZQogICAgICB9KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xlLmVycm9yKAogICAgICAgICJbUGVvcGxlIHNlcnZlcnMvaW52aXRlIGxp
bmtdIiwKICAgICAgICBlcnIKICAgICAgKTsKCiAgICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsKICAgICAgICBvazogZmFsc2UsCiAgICAgICAgZXJyb3I6
CiAgICAgICAgICAiSW1wb3NzaWJsZSBkZSBjcsOpZXIgbGUgbGllbiBkJ2ludml0YXRpb24uIgogICAgICB9KTsKICAgIH0KICB9Cik7CgphcHAuZ2V0KAog
ICIvaW52aXRlLzpjb2RlIiwKICAocmVxLCByZXMpID0+IHsKICAgIHJlcy5zZW5kRmlsZSgKICAgICAgcGF0aEFjY291bnRzLmpvaW4oCiAgICAgICAgX19k
aXJuYW1lLAogICAgICAgICJwdWJsaWMiLAogICAgICAgICJpbmRleC5odG1sIgogICAgICApCiAgICApOwogIH0KKTsKLy8gPT09IFBFT1BMRV9TRVJWRVJT
X1YxX0VORCA9PT0KCi8vID09PSBQRU9QTEVfREVTS1RPUF9BUFBfVkVSU0lPTl9WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX0RFU0tUT1BfUkVMRUFTRV9G
SUxFID0KICBwYXRoQWNjb3VudHMuam9pbigKICAgIF9fZGlybmFtZSwKICAgICJyZWxlYXNlLmpzb24iCiAgKTsKCmNvbnN0IFBFT1BMRV9ERVNLVE9QX0RF
RkFVTFRfVkVSU0lPTiA9CiAgIjEuMC4wIjsKCmNvbnN0IFBFT1BMRV9ERVNLVE9QX0RFRkFVTFRfSU5TVEFMTEVSX1VSTCA9CiAgImh0dHBzOi8vZ2l0aHVi
LmNvbS9NaW9MZVZyYWkvUGVvcGxlVGhlTmV3QXBwQmV0dGVyVGhhblRoZUJsdWVCb3RBbmRXaXRob3V0Q2FwaXRhbGlzbS9yZWxlYXNlcy9sYXRlc3QvZG93
bmxvYWQvUGVvcGxlLVNldHVwLmV4ZSI7CgpmdW5jdGlvbiBwZW9wbGVEZXNrdG9wUmVsZWFzZUluZm8oKSB7CiAgbGV0IHJlbGVhc2UgPSB7fTsKCiAgdHJ5
IHsKICAgIGlmICgKICAgICAgZnNBY2NvdW50cy5leGlzdHNTeW5jKAogICAgICAgIFBFT1BMRV9ERVNLVE9QX1JFTEVBU0VfRklMRQogICAgICApCiAgICAp
IHsKICAgICAgcmVsZWFzZSA9CiAgICAgICAgSlNPTi5wYXJzZSgKICAgICAgICAgIGZzQWNjb3VudHMucmVhZEZpbGVTeW5jKAogICAgICAgICAgICBQRU9Q
TEVfREVTS1RPUF9SRUxFQVNFX0ZJTEUsCiAgICAgICAgICAgICJ1dGY4IgogICAgICAgICAgKQogICAgICAgICk7CiAgICB9CiAgfSBjYXRjaCAoZXJyKSB7
CiAgICBjb25zb2xlLndhcm4oCiAgICAgICJbUGVvcGxlIHJlbGVhc2UuanNvbl0iLAogICAgICBlcnI/Lm1lc3NhZ2UgfHwgZXJyCiAgICApOwogIH0KCiAg
Y29uc3QgdmVyc2lvbiA9CiAgICBTdHJpbmcoCiAgICAgIHByb2Nlc3MuZW52LlBFT1BMRV9ERVNLVE9QX1ZFUlNJT04gfHwKICAgICAgcmVsZWFzZT8udmVy
c2lvbiB8fAogICAgICBQRU9QTEVfREVTS1RPUF9ERUZBVUxUX1ZFUlNJT04KICAgICkudHJpbSgpIHx8CiAgICBQRU9QTEVfREVTS1RPUF9ERUZBVUxUX1ZF
UlNJT047CgogIGNvbnN0IGluc3RhbGxlclVybCA9CiAgICBTdHJpbmcoCiAgICAgIHByb2Nlc3MuZW52LlBFT1BMRV9ERVNLVE9QX0lOU1RBTExFUl9VUkwg
fHwKICAgICAgcmVsZWFzZT8uaW5zdGFsbGVyVXJsIHx8CiAgICAgIFBFT1BMRV9ERVNLVE9QX0RFRkFVTFRfSU5TVEFMTEVSX1VSTAogICAgKS50cmltKCk7
CgogIGNvbnN0IHNoYTI1NiA9CiAgICBTdHJpbmcoCiAgICAgIHByb2Nlc3MuZW52LlBFT1BMRV9ERVNLVE9QX1NIQTI1NiB8fAogICAgICByZWxlYXNlPy5z
aGEyNTYgfHwKICAgICAgIiIKICAgICkKICAgICAgLnRyaW0oKQogICAgICAudG9Mb3dlckNhc2UoKTsKCiAgY29uc3QgbWVzc2FnZSA9CiAgICBTdHJpbmco
CiAgICAgIHByb2Nlc3MuZW52LlBFT1BMRV9ERVNLVE9QX1VQREFURV9NRVNTQUdFIHx8CiAgICAgIHJlbGVhc2U/Lm1lc3NhZ2UgfHwKICAgICAgIlVuZSBu
b3V2ZWxsZSB2ZXJzaW9uIGRlIFBlb3BsZSBlc3QgZGlzcG9uaWJsZS4iCiAgICApLnRyaW0oKTsKCiAgcmV0dXJuIHsKICAgIHZlcnNpb24sCiAgICBpbnN0
YWxsZXJVcmwsCiAgICBzaGEyNTYsCiAgICBtZXNzYWdlCiAgfTsKfQoKYXBwLmdldCgKICAiL2FwaS9kZXNrdG9wL3ZlcnNpb24iLAogIChyZXEsIHJlcykg
PT4gewogICAgcmVzLnNldCgKICAgICAgIkNhY2hlLUNvbnRyb2wiLAogICAgICAibm8tc3RvcmUsIG1heC1hZ2U9MCIKICAgICk7CgogICAgcmVzLnN0YXR1
cygyMDApLmpzb24oewogICAgICBvazogdHJ1ZSwKICAgICAgLi4ucGVvcGxlRGVza3RvcFJlbGVhc2VJbmZvKCkKICAgIH0pOwogIH0KKTsKLy8gPT09IFBF
T1BMRV9ERVNLVE9QX0FQUF9WRVJTSU9OX1YxX0VORCA9PT0KCmFwcC5nZXQoIi9oZWFsdGgiLCAocmVxLCByZXMpID0+IHsKICByZXMuc3RhdHVzKDIwMCku
anNvbih7IG9rOiB0cnVlLCBhcHA6ICJQZW9wbGUiIH0pOwp9KTsKCmNvbnN0IHVzZXJzID0gbmV3IE1hcCgpOwpjb25zdCB1c2VySWRzID0gbmV3IE1hcCgp
Owpjb25zdCBzb2NrZXRTZXJ2ZXJJZHMgPSBuZXcgTWFwKCk7CmNvbnN0IHNvY2tldFRleHRDaGFubmVsSWRzID0gbmV3IE1hcCgpOwpjb25zdCB2b2ljZVVz
ZXJzID0gbmV3IE1hcCgpOwoKLy8gPT09IFBFT1BMRV9ETV9DQUxMU19WMV9TVEFSVCA9PT0KY29uc3QgcGVvcGxlRG1DYWxscyA9CiAgbmV3IE1hcCgpOwoK
Y29uc3QgcGVvcGxlRG1DYWxsVGltZXJzID0KICBuZXcgTWFwKCk7Cgpjb25zdCBwZW9wbGVEbUNhbGxSaW5nVGltZXJzID0KICBuZXcgTWFwKCk7Cgpjb25z
dCBwZW9wbGVEbUNhbGxMYXN0U3RhcnQgPQogIG5ldyBNYXAoKTsKCmNvbnN0IFBFT1BMRV9ETV9DQUxMX1JJTkdfTVMgPQogIDM1ICogMTAwMDsKCmNvbnN0
IFBFT1BMRV9ETV9DQUxMX1NPTE9fTVMgPQogIDMgKiA2MCAqIDEwMDA7Cgphc3luYyBmdW5jdGlvbiBwZW9wbGVEbUNhbGxGaW5kQWNjb3VudEJ5VXNlcm5h
bWUoCiAgdmFsdWUKKSB7CiAgY29uc3Qgd2FudGVkS2V5ID0KICAgIHBlb3BsZVVzZXJuYW1lS2V5KAogICAgICB2YWx1ZQogICAgKTsKCiAgaWYgKCF3YW50
ZWRLZXkpIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgY29uc3QgbWF0Y2hlcyA9CiAgICBhd2FpdCBwZW9wbGVMaXN0QWNjb3VudHMoCiAgICAgIHZhbHVl
CiAgICApOwoKICByZXR1cm4gKAogICAgbWF0Y2hlcy5maW5kKAogICAgICAoYWNjb3VudCkgPT4KICAgICAgICBwZW9wbGVVc2VybmFtZUtleSgKICAgICAg
ICAgIGFjY291bnQ/LnVzZXJuYW1lCiAgICAgICAgKSA9PT0gd2FudGVkS2V5CiAgICApIHx8CiAgICBudWxsCiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlRG1D
YWxsQWNjb3VudFNvY2tldElkcygKICBhY2NvdW50SWQKKSB7CiAgY29uc3Qgd2FudGVkID0KICAgIFN0cmluZygKICAgICAgYWNjb3VudElkIHx8CiAgICAg
ICIiCiAgICApOwoKICBjb25zdCBzb2NrZXRzID0gW107CgogIGZvciAoCiAgICBjb25zdCBbc29ja2V0SWQsIGN1cnJlbnRJZF0KICAgIG9mIHVzZXJJZHMu
ZW50cmllcygpCiAgKSB7CiAgICBpZiAoCiAgICAgIFN0cmluZyhjdXJyZW50SWQpID09PQogICAgICB3YW50ZWQKICAgICkgewogICAgICBzb2NrZXRzLnB1
c2goCiAgICAgICAgc29ja2V0SWQKICAgICAgKTsKICAgIH0KICB9CgogIHJldHVybiBzb2NrZXRzOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxBY2NvdW50
QnVzeSgKICBhY2NvdW50SWQKKSB7CiAgY29uc3Qgd2FudGVkID0KICAgIFN0cmluZygKICAgICAgYWNjb3VudElkIHx8CiAgICAgICIiCiAgICApOwoKICBp
ZiAoIXdhbnRlZCkgewogICAgcmV0dXJuIGZhbHNlOwogIH0KCiAgZm9yICgKICAgIGNvbnN0IGNhbGwgb2YKICAgIHBlb3BsZURtQ2FsbHMudmFsdWVzKCkK
ICApIHsKICAgIGlmICgKICAgICAgY2FsbC5zdGF0dXMgIT09CiAgICAgICAgImFjdGl2ZSIKICAgICkgewogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBj
b25zdCByb2xlID0KICAgICAgcGVvcGxlRG1DYWxsUm9sZUZvckFjY291bnQoCiAgICAgICAgY2FsbCwKICAgICAgICB3YW50ZWQKICAgICAgKTsKCiAgICBp
ZiAoCiAgICAgIHJvbGUgJiYKICAgICAgcGVvcGxlRG1DYWxsU29ja2V0Rm9yUm9sZSgKICAgICAgICBjYWxsLAogICAgICAgIHJvbGUKICAgICAgKQogICAg
KSB7CiAgICAgIHJldHVybiB0cnVlOwogICAgfQogIH0KCiAgcmV0dXJuIGZhbHNlOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxFbWl0U29ja2V0SWRzKAog
IHNvY2tldElkcywKICBldmVudCwKICBwYXlsb2FkCikgewogIGNvbnN0IHVuaXF1ZSA9CiAgICBuZXcgU2V0KAogICAgICBzb2NrZXRJZHMKICAgICAgICAu
bWFwKAogICAgICAgICAgKGlkKSA9PgogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgaWQgfHwKICAgICAgICAgICAgICAiIgogICAgICAgICAg
ICApCiAgICAgICAgKQogICAgICAgIC5maWx0ZXIoQm9vbGVhbikKICAgICk7CgogIGZvciAoCiAgICBjb25zdCBzb2NrZXRJZCBvZgogICAgdW5pcXVlCiAg
KSB7CiAgICBpby50bygKICAgICAgc29ja2V0SWQKICAgICkuZW1pdCgKICAgICAgZXZlbnQsCiAgICAgIHBheWxvYWQKICAgICk7CiAgfQp9CgpmdW5jdGlv
biBwZW9wbGVEbUNhbGxDbGVhclRpbWVyKAogIG1hcCwKICBjYWxsSWQKKSB7CiAgY29uc3QgaWQgPQogICAgU3RyaW5nKAogICAgICBjYWxsSWQgfHwKICAg
ICAgIiIKICAgICk7CgogIGNvbnN0IHRpbWVyID0KICAgIG1hcC5nZXQoCiAgICAgIGlkCiAgICApOwoKICBpZiAodGltZXIpIHsKICAgIGNsZWFyVGltZW91
dCgKICAgICAgdGltZXIKICAgICk7CiAgfQoKICBtYXAuZGVsZXRlKAogICAgaWQKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxQYXJ0aWNpcGFudENv
dW50KAogIGNhbGwKKSB7CiAgaWYgKCFjYWxsKSB7CiAgICByZXR1cm4gMDsKICB9CgogIGxldCBjb3VudCA9IDA7CgogIGlmICgKICAgIFN0cmluZygKICAg
ICAgY2FsbC5jYWxsZXJTb2NrZXRJZCB8fAogICAgICAiIgogICAgKQogICkgewogICAgY291bnQgKz0gMTsKICB9CgogIGlmICgKICAgIFN0cmluZygKICAg
ICAgY2FsbC5jYWxsZWVTb2NrZXRJZCB8fAogICAgICAiIgogICAgKQogICkgewogICAgY291bnQgKz0gMTsKICB9CgogIHJldHVybiBjb3VudDsKfQoKZnVu
Y3Rpb24gcGVvcGxlRG1DYWxsUm9sZUZvckFjY291bnQoCiAgY2FsbCwKICBhY2NvdW50SWQKKSB7CiAgY29uc3Qgd2FudGVkID0KICAgIFN0cmluZygKICAg
ICAgYWNjb3VudElkIHx8CiAgICAgICIiCiAgICApOwoKICBpZiAoCiAgICB3YW50ZWQgJiYKICAgIFN0cmluZygKICAgICAgY2FsbD8uY2FsbGVyQWNjb3Vu
dElkIHx8CiAgICAgICIiCiAgICApID09PSB3YW50ZWQKICApIHsKICAgIHJldHVybiAiY2FsbGVyIjsKICB9CgogIGlmICgKICAgIHdhbnRlZCAmJgogICAg
U3RyaW5nKAogICAgICBjYWxsPy5jYWxsZWVBY2NvdW50SWQgfHwKICAgICAgIiIKICAgICkgPT09IHdhbnRlZAogICkgewogICAgcmV0dXJuICJjYWxsZWUi
OwogIH0KCiAgcmV0dXJuICIiOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxTb2NrZXRGb3JSb2xlKAogIGNhbGwsCiAgcm9sZQopIHsKICByZXR1cm4gU3Ry
aW5nKAogICAgcm9sZSA9PT0gImNhbGxlciIKICAgICAgPyBjYWxsPy5jYWxsZXJTb2NrZXRJZCB8fCAiIgogICAgICA6IHJvbGUgPT09ICJjYWxsZWUiCiAg
ICAgICAgPyBjYWxsPy5jYWxsZWVTb2NrZXRJZCB8fCAiIgogICAgICAgIDogIiIKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxTZXRTb2NrZXRGb3JS
b2xlKAogIGNhbGwsCiAgcm9sZSwKICBzb2NrZXRJZAopIHsKICBjb25zdCB2YWx1ZSA9CiAgICBTdHJpbmcoCiAgICAgIHNvY2tldElkIHx8CiAgICAgICIi
CiAgICApIHx8IG51bGw7CgogIGlmIChyb2xlID09PSAiY2FsbGVyIikgewogICAgY2FsbC5jYWxsZXJTb2NrZXRJZCA9CiAgICAgIHZhbHVlOwogIH0gZWxz
ZSBpZiAoCiAgICByb2xlID09PSAiY2FsbGVlIgogICkgewogICAgY2FsbC5jYWxsZWVTb2NrZXRJZCA9CiAgICAgIHZhbHVlOwogIH0KfQoKZnVuY3Rpb24g
cGVvcGxlRG1DYWxsTWVkaWFGb3JSb2xlKAogIGNhbGwsCiAgcm9sZQopIHsKICBjb25zdCB2YWx1ZSA9CiAgICByb2xlID09PSAiY2FsbGVyIgogICAgICA/
IGNhbGw/LmNhbGxlck1lZGlhCiAgICAgIDogY2FsbD8uY2FsbGVlTWVkaWE7CgogIHJldHVybiB7CiAgICBtdXRlZDoKICAgICAgQm9vbGVhbigKICAgICAg
ICB2YWx1ZT8ubXV0ZWQKICAgICAgKSwKICAgIGNhbWVyYToKICAgICAgQm9vbGVhbigKICAgICAgICB2YWx1ZT8uY2FtZXJhCiAgICAgICksCiAgICBzY3Jl
ZW46CiAgICAgIEJvb2xlYW4oCiAgICAgICAgdmFsdWU/LnNjcmVlbgogICAgICApCiAgfTsKfQoKZnVuY3Rpb24gcGVvcGxlRG1DYWxsU2V0TWVkaWFGb3JS
b2xlKAogIGNhbGwsCiAgcm9sZSwKICBtZWRpYSA9IHt9CikgewogIGNvbnN0IHZhbHVlID0gewogICAgbXV0ZWQ6CiAgICAgIEJvb2xlYW4oCiAgICAgICAg
bWVkaWE/Lm11dGVkCiAgICAgICksCiAgICBjYW1lcmE6CiAgICAgIEJvb2xlYW4oCiAgICAgICAgbWVkaWE/LmNhbWVyYQogICAgICApLAogICAgc2NyZWVu
OgogICAgICBCb29sZWFuKAogICAgICAgIG1lZGlhPy5zY3JlZW4KICAgICAgKQogIH07CgogIGlmIChyb2xlID09PSAiY2FsbGVyIikgewogICAgY2FsbC5j
YWxsZXJNZWRpYSA9CiAgICAgIHZhbHVlOwogIH0gZWxzZSBpZiAoCiAgICByb2xlID09PSAiY2FsbGVlIgogICkgewogICAgY2FsbC5jYWxsZWVNZWRpYSA9
CiAgICAgIHZhbHVlOwogIH0KfQoKZnVuY3Rpb24gcGVvcGxlRG1DYWxsT3RoZXJSb2xlKAogIHJvbGUKKSB7CiAgcmV0dXJuIHJvbGUgPT09ICJjYWxsZXIi
CiAgICA/ICJjYWxsZWUiCiAgICA6IHJvbGUgPT09ICJjYWxsZWUiCiAgICAgID8gImNhbGxlciIKICAgICAgOiAiIjsKfQoKZnVuY3Rpb24gcGVvcGxlRG1D
YWxsVXNlcm5hbWVGb3JSb2xlKAogIGNhbGwsCiAgcm9sZQopIHsKICByZXR1cm4gU3RyaW5nKAogICAgcm9sZSA9PT0gImNhbGxlciIKICAgICAgPyBjYWxs
Py5jYWxsZXJVc2VybmFtZSB8fCAiVXRpbGlzYXRldXIiCiAgICAgIDogcm9sZSA9PT0gImNhbGxlZSIKICAgICAgICA/IGNhbGw/LmNhbGxlZVVzZXJuYW1l
IHx8ICJVdGlsaXNhdGV1ciIKICAgICAgICA6ICJVdGlsaXNhdGV1ciIKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxBY2NvdW50SWRGb3JSb2xlKAog
IGNhbGwsCiAgcm9sZQopIHsKICByZXR1cm4gU3RyaW5nKAogICAgcm9sZSA9PT0gImNhbGxlciIKICAgICAgPyBjYWxsPy5jYWxsZXJBY2NvdW50SWQgfHwg
IiIKICAgICAgOiByb2xlID09PSAiY2FsbGVlIgogICAgICAgID8gY2FsbD8uY2FsbGVlQWNjb3VudElkIHx8ICIiCiAgICAgICAgOiAiIgogICk7Cn0KCmZ1
bmN0aW9uIHBlb3BsZURtQ2FsbEZpbmRCZXR3ZWVuKAogIGFjY291bnRBLAogIGFjY291bnRCCikgewogIGNvbnN0IGEgPQogICAgU3RyaW5nKAogICAgICBh
Y2NvdW50QSB8fAogICAgICAiIgogICAgKTsKCiAgY29uc3QgYiA9CiAgICBTdHJpbmcoCiAgICAgIGFjY291bnRCIHx8CiAgICAgICIiCiAgICApOwoKICBp
ZiAoIWEgfHwgIWIpIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgZm9yICgKICAgIGNvbnN0IGNhbGwgb2YKICAgIHBlb3BsZURtQ2FsbHMudmFsdWVzKCkK
ICApIHsKICAgIGlmICgKICAgICAgY2FsbC5zdGF0dXMgIT09CiAgICAgICAgImFjdGl2ZSIKICAgICkgewogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBj
b25zdCBzYW1lUGFpciA9CiAgICAgICgKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBjYWxsLmNhbGxlckFjY291bnRJZAogICAgICAgICkgPT09IGEgJiYK
ICAgICAgICBTdHJpbmcoCiAgICAgICAgICBjYWxsLmNhbGxlZUFjY291bnRJZAogICAgICAgICkgPT09IGIKICAgICAgKSB8fAogICAgICAoCiAgICAgICAg
U3RyaW5nKAogICAgICAgICAgY2FsbC5jYWxsZXJBY2NvdW50SWQKICAgICAgICApID09PSBiICYmCiAgICAgICAgU3RyaW5nKAogICAgICAgICAgY2FsbC5j
YWxsZWVBY2NvdW50SWQKICAgICAgICApID09PSBhCiAgICAgICk7CgogICAgaWYgKHNhbWVQYWlyKSB7CiAgICAgIHJldHVybiBjYWxsOwogICAgfQogIH0K
CiAgcmV0dXJuIG51bGw7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbEZpbmlzaCgKICBjYWxsSWQsCiAgcmVhc29uID0gImhhbmd1cCIKKSB7CiAgY29uc3Qg
aWQgPQogICAgU3RyaW5nKAogICAgICBjYWxsSWQgfHwKICAgICAgIiIKICAgICk7CgogIGNvbnN0IGNhbGwgPQogICAgcGVvcGxlRG1DYWxscy5nZXQoCiAg
ICAgIGlkCiAgICApOwoKICBpZiAoIWNhbGwpIHsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIHBlb3BsZURtQ2FsbENsZWFyVGltZXIoCiAgICBwZW9wbGVE
bUNhbGxUaW1lcnMsCiAgICBpZAogICk7CgogIHBlb3BsZURtQ2FsbENsZWFyVGltZXIoCiAgICBwZW9wbGVEbUNhbGxSaW5nVGltZXJzLAogICAgaWQKICAp
OwoKICBwZW9wbGVEbUNhbGxzLmRlbGV0ZSgKICAgIGlkCiAgKTsKCiAgY29uc3QgZHVyYXRpb25TZWNvbmRzID0KICAgIGNhbGwuYWNjZXB0ZWRBdAogICAg
ICA/IE1hdGgubWF4KAogICAgICAgICAgMCwKICAgICAgICAgIE1hdGgucm91bmQoCiAgICAgICAgICAgICgKICAgICAgICAgICAgICBEYXRlLm5vdygpIC0K
ICAgICAgICAgICAgICBOdW1iZXIoCiAgICAgICAgICAgICAgICBjYWxsLmFjY2VwdGVkQXQKICAgICAgICAgICAgICApCiAgICAgICAgICAgICkgLwogICAg
ICAgICAgICAxMDAwCiAgICAgICAgICApCiAgICAgICAgKQogICAgICA6IDA7CgogIHBlb3BsZURtQ2FsbFNhdmVUaW1lbGluZSgKICAgIGNhbGwsCiAgICAi
ZW5kZWQiLAogICAgU3RyaW5nKAogICAgICByZWFzb24gfHwKICAgICAgImhhbmd1cCIKICAgICksCiAgICBkdXJhdGlvblNlY29uZHMKICApOwoKICBwZW9w
bGVEbUNhbGxFbWl0U29ja2V0SWRzKAogICAgWwogICAgICBjYWxsLmNhbGxlclNvY2tldElkLAogICAgICBjYWxsLmNhbGxlZVNvY2tldElkLAogICAgICAu
Li5wZW9wbGVEbUNhbGxBY2NvdW50U29ja2V0SWRzKAogICAgICAgIGNhbGwuY2FsbGVyQWNjb3VudElkCiAgICAgICksCiAgICAgIC4uLnBlb3BsZURtQ2Fs
bEFjY291bnRTb2NrZXRJZHMoCiAgICAgICAgY2FsbC5jYWxsZWVBY2NvdW50SWQKICAgICAgKQogICAgXSwKICAgICJkbS1jYWxsLWVuZGVkIiwKICAgIHsK
ICAgICAgY2FsbElkOgogICAgICAgIGlkLAogICAgICByZWFzb246CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgcmVhc29uIHx8CiAgICAgICAgICAiaGFu
Z3VwIgogICAgICAgICkKICAgIH0KICApOwoKICBwZW9wbGVWb2ljZVJlZnJlc2hBY2NvdW50KAogICAgY2FsbC5jYWxsZXJBY2NvdW50SWQKICApOwoKICBw
ZW9wbGVWb2ljZVJlZnJlc2hBY2NvdW50KAogICAgY2FsbC5jYWxsZWVBY2NvdW50SWQKICApOwoKICByZXR1cm4gdHJ1ZTsKfQoKZnVuY3Rpb24gcGVvcGxl
RG1DYWxsU2NoZWR1bGVTb2xvVGltZW91dCgKICBjYWxsCikgewogIGlmICghY2FsbCkgewogICAgcmV0dXJuOwogIH0KCiAgcGVvcGxlRG1DYWxsQ2xlYXJU
aW1lcigKICAgIHBlb3BsZURtQ2FsbFRpbWVycywKICAgIGNhbGwuaWQKICApOwoKICBjb25zdCBjb3VudCA9CiAgICBwZW9wbGVEbUNhbGxQYXJ0aWNpcGFu
dENvdW50KAogICAgICBjYWxsCiAgICApOwoKICBpZiAoY291bnQgPT09IDApIHsKICAgIHBlb3BsZURtQ2FsbEZpbmlzaCgKICAgICAgY2FsbC5pZCwKICAg
ICAgImVtcHR5IgogICAgKTsKCiAgICByZXR1cm47CiAgfQoKICBpZiAoY291bnQgIT09IDEpIHsKICAgIHJldHVybjsKICB9CgogIGNhbGwuc29sb1NpbmNl
ID0KICAgIERhdGUubm93KCk7CgogIGNvbnN0IHRpbWVyID0KICAgIHNldFRpbWVvdXQoCiAgICAgICgpID0+IHsKICAgICAgICBjb25zdCBjdXJyZW50ID0K
ICAgICAgICAgIHBlb3BsZURtQ2FsbHMuZ2V0KAogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgY2FsbC5pZAogICAgICAgICAgICApCiAgICAg
ICAgICApOwoKICAgICAgICBpZiAoCiAgICAgICAgICAhY3VycmVudCB8fAogICAgICAgICAgcGVvcGxlRG1DYWxsUGFydGljaXBhbnRDb3VudCgKICAgICAg
ICAgICAgY3VycmVudAogICAgICAgICAgKSAhPT0gMQogICAgICAgICkgewogICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KCiAgICAgICAgcGVvcGxlRG1D
YWxsRmluaXNoKAogICAgICAgICAgY3VycmVudC5pZCwKICAgICAgICAgICJhbG9uZS10aW1lb3V0IgogICAgICAgICk7CiAgICAgIH0sCiAgICAgIFBFT1BM
RV9ETV9DQUxMX1NPTE9fTVMKICAgICk7CgogIHBlb3BsZURtQ2FsbFRpbWVycy5zZXQoCiAgICBTdHJpbmcoCiAgICAgIGNhbGwuaWQKICAgICksCiAgICB0
aW1lcgogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbFN0b3BSaW5naW5nKAogIGNhbGwKKSB7CiAgaWYgKCFjYWxsKSB7CiAgICByZXR1cm47CiAgfQoK
ICBjYWxsLnJpbmdBY3RpdmUgPQogICAgZmFsc2U7CgogIHBlb3BsZURtQ2FsbENsZWFyVGltZXIoCiAgICBwZW9wbGVEbUNhbGxSaW5nVGltZXJzLAogICAg
Y2FsbC5pZAogICk7CgogIHBlb3BsZURtQ2FsbEVtaXRTb2NrZXRJZHMoCiAgICBbCiAgICAgIC4uLnBlb3BsZURtQ2FsbEFjY291bnRTb2NrZXRJZHMoCiAg
ICAgICAgY2FsbC5jYWxsZXJBY2NvdW50SWQKICAgICAgKSwKICAgICAgLi4ucGVvcGxlRG1DYWxsQWNjb3VudFNvY2tldElkcygKICAgICAgICBjYWxsLmNh
bGxlZUFjY291bnRJZAogICAgICApCiAgICBdLAogICAgImRtLWNhbGwtcmluZy1lbmRlZCIsCiAgICB7CiAgICAgIGNhbGxJZDoKICAgICAgICBjYWxsLmlk
CiAgICB9CiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlRG1DYWxsU2NoZWR1bGVSaW5nVGltZW91dCgKICBjYWxsCikgewogIGlmICghY2FsbCkgewogICAgcmV0
dXJuOwogIH0KCiAgcGVvcGxlRG1DYWxsQ2xlYXJUaW1lcigKICAgIHBlb3BsZURtQ2FsbFJpbmdUaW1lcnMsCiAgICBjYWxsLmlkCiAgKTsKCiAgY2FsbC5y
aW5nQWN0aXZlID0KICAgIHRydWU7CgogIGNvbnN0IHRpbWVyID0KICAgIHNldFRpbWVvdXQoCiAgICAgICgpID0+IHsKICAgICAgICBjb25zdCBjdXJyZW50
ID0KICAgICAgICAgIHBlb3BsZURtQ2FsbHMuZ2V0KAogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgY2FsbC5pZAogICAgICAgICAgICApCiAg
ICAgICAgICApOwoKICAgICAgICBpZiAoIWN1cnJlbnQpIHsKICAgICAgICAgIHJldHVybjsKICAgICAgICB9CgogICAgICAgIHBlb3BsZURtQ2FsbFN0b3BS
aW5naW5nKAogICAgICAgICAgY3VycmVudAogICAgICAgICk7CiAgICAgIH0sCiAgICAgIFBFT1BMRV9ETV9DQUxMX1JJTkdfTVMKICAgICk7CgogIHBlb3Bs
ZURtQ2FsbFJpbmdUaW1lcnMuc2V0KAogICAgU3RyaW5nKAogICAgICBjYWxsLmlkCiAgICApLAogICAgdGltZXIKICApOwp9CgpmdW5jdGlvbiBwZW9wbGVE
bUNhbGxGb3JBY3RpdmVTb2NrZXQoCiAgY2FsbElkLAogIHNvY2tldElkCikgewogIGNvbnN0IGNhbGwgPQogICAgcGVvcGxlRG1DYWxscy5nZXQoCiAgICAg
IFN0cmluZygKICAgICAgICBjYWxsSWQgfHwKICAgICAgICAiIgogICAgICApCiAgICApOwoKICBpZiAoCiAgICAhY2FsbCB8fAogICAgY2FsbC5zdGF0dXMg
IT09CiAgICAgICJhY3RpdmUiCiAgKSB7CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGNvbnN0IGN1cnJlbnRTb2NrZXQgPQogICAgU3RyaW5nKAogICAgICBz
b2NrZXRJZCB8fAogICAgICAiIgogICAgKTsKCiAgaWYgKAogICAgU3RyaW5nKAogICAgICBjYWxsLmNhbGxlclNvY2tldElkIHx8CiAgICAgICIiCiAgICAp
ICE9PSBjdXJyZW50U29ja2V0ICYmCiAgICBTdHJpbmcoCiAgICAgIGNhbGwuY2FsbGVlU29ja2V0SWQgfHwKICAgICAgIiIKICAgICkgIT09IGN1cnJlbnRT
b2NrZXQKICApIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgcmV0dXJuIGNhbGw7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbE90aGVyU29ja2V0KAogIGNh
bGwsCiAgc29ja2V0SWQKKSB7CiAgY29uc3QgY3VycmVudCA9CiAgICBTdHJpbmcoCiAgICAgIHNvY2tldElkIHx8CiAgICAgICIiCiAgICApOwoKICBpZiAo
CiAgICBTdHJpbmcoCiAgICAgIGNhbGwuY2FsbGVyU29ja2V0SWQgfHwKICAgICAgIiIKICAgICkgPT09IGN1cnJlbnQKICApIHsKICAgIHJldHVybiBTdHJp
bmcoCiAgICAgIGNhbGwuY2FsbGVlU29ja2V0SWQgfHwKICAgICAgIiIKICAgICk7CiAgfQoKICBpZiAoCiAgICBTdHJpbmcoCiAgICAgIGNhbGwuY2FsbGVl
U29ja2V0SWQgfHwKICAgICAgIiIKICAgICkgPT09IGN1cnJlbnQKICApIHsKICAgIHJldHVybiBTdHJpbmcoCiAgICAgIGNhbGwuY2FsbGVyU29ja2V0SWQg
fHwKICAgICAgIiIKICAgICk7CiAgfQoKICByZXR1cm4gIiI7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbE5vdGlmeUNvbm5lY3RlZCgKICBjYWxsLAogIGpv
aW5pbmdTb2NrZXRJZAopIHsKICBjb25zdCBjYWxsZXJTb2NrZXQgPQogICAgU3RyaW5nKAogICAgICBjYWxsPy5jYWxsZXJTb2NrZXRJZCB8fAogICAgICAi
IgogICAgKTsKCiAgY29uc3QgY2FsbGVlU29ja2V0ID0KICAgIFN0cmluZygKICAgICAgY2FsbD8uY2FsbGVlU29ja2V0SWQgfHwKICAgICAgIiIKICAgICk7
CgogIGlmICgKICAgICFjYWxsZXJTb2NrZXQgfHwKICAgICFjYWxsZWVTb2NrZXQKICApIHsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIHBlb3BsZURtQ2Fs
bENsZWFyVGltZXIoCiAgICBwZW9wbGVEbUNhbGxUaW1lcnMsCiAgICBjYWxsLmlkCiAgKTsKCiAgY2FsbC5zb2xvU2luY2UgPQogICAgbnVsbDsKCiAgcGVv
cGxlRG1DYWxsU3RvcFJpbmdpbmcoCiAgICBjYWxsCiAgKTsKCiAgY29uc3QgY2FsbGVyTWVkaWEgPQogICAgcGVvcGxlRG1DYWxsTWVkaWFGb3JSb2xlKAog
ICAgICBjYWxsLAogICAgICAiY2FsbGVyIgogICAgKTsKCiAgY29uc3QgY2FsbGVlTWVkaWEgPQogICAgcGVvcGxlRG1DYWxsTWVkaWFGb3JSb2xlKAogICAg
ICBjYWxsLAogICAgICAiY2FsbGVlIgogICAgKTsKCiAgaW8udG8oCiAgICBjYWxsZXJTb2NrZXQKICApLmVtaXQoCiAgICAiZG0tY2FsbC1hY2NlcHRlZCIs
CiAgICB7CiAgICAgIGNhbGxJZDoKICAgICAgICBjYWxsLmlkLAogICAgICBwZWVyU29ja2V0SWQ6CiAgICAgICAgY2FsbGVlU29ja2V0LAogICAgICBwZWVy
VXNlcm5hbWU6CiAgICAgICAgY2FsbC5jYWxsZWVVc2VybmFtZSwKICAgICAgaW5pdGlhdG9yOgogICAgICAgIFN0cmluZygKICAgICAgICAgIGNhbGxlclNv
Y2tldAogICAgICAgICkgIT09IFN0cmluZygKICAgICAgICAgIGpvaW5pbmdTb2NrZXRJZCB8fAogICAgICAgICAgIiIKICAgICAgICApLAogICAgICBwZWVy
TXV0ZWQ6CiAgICAgICAgY2FsbGVlTWVkaWEubXV0ZWQsCiAgICAgIHBlZXJDYW1lcmE6CiAgICAgICAgY2FsbGVlTWVkaWEuY2FtZXJhLAogICAgICBwZWVy
U2NyZWVuOgogICAgICAgIGNhbGxlZU1lZGlhLnNjcmVlbgogICAgfQogICk7CgogIGlvLnRvKAogICAgY2FsbGVlU29ja2V0CiAgKS5lbWl0KAogICAgImRt
LWNhbGwtYWNjZXB0ZWQiLAogICAgewogICAgICBjYWxsSWQ6CiAgICAgICAgY2FsbC5pZCwKICAgICAgcGVlclNvY2tldElkOgogICAgICAgIGNhbGxlclNv
Y2tldCwKICAgICAgcGVlclVzZXJuYW1lOgogICAgICAgIGNhbGwuY2FsbGVyVXNlcm5hbWUsCiAgICAgIGluaXRpYXRvcjoKICAgICAgICBTdHJpbmcoCiAg
ICAgICAgICBjYWxsZWVTb2NrZXQKICAgICAgICApICE9PSBTdHJpbmcoCiAgICAgICAgICBqb2luaW5nU29ja2V0SWQgfHwKICAgICAgICAgICIiCiAgICAg
ICAgKSwKICAgICAgcGVlck11dGVkOgogICAgICAgIGNhbGxlck1lZGlhLm11dGVkLAogICAgICBwZWVyQ2FtZXJhOgogICAgICAgIGNhbGxlck1lZGlhLmNh
bWVyYSwKICAgICAgcGVlclNjcmVlbjoKICAgICAgICBjYWxsZXJNZWRpYS5zY3JlZW4KICAgIH0KICApOwoKICByZXR1cm4gdHJ1ZTsKfQoKZnVuY3Rpb24g
cGVvcGxlRG1DYWxsSm9pblBhcnRpY2lwYW50KAogIGNhbGwsCiAgYWNjb3VudElkLAogIHNvY2tldElkCikgewogIGlmICgKICAgICFjYWxsIHx8CiAgICBj
YWxsLnN0YXR1cyAhPT0KICAgICAgImFjdGl2ZSIKICApIHsKICAgIHJldHVybiB7CiAgICAgIG9rOiBmYWxzZSwKICAgICAgcmVhc29uOgogICAgICAgICJ1
bmF2YWlsYWJsZSIKICAgIH07CiAgfQoKICBjb25zdCByb2xlID0KICAgIHBlb3BsZURtQ2FsbFJvbGVGb3JBY2NvdW50KAogICAgICBjYWxsLAogICAgICBh
Y2NvdW50SWQKICAgICk7CgogIGlmICghcm9sZSkgewogICAgcmV0dXJuIHsKICAgICAgb2s6IGZhbHNlLAogICAgICByZWFzb246CiAgICAgICAgInVuYXZh
aWxhYmxlIgogICAgfTsKICB9CgogIGNvbnN0IGN1cnJlbnRTb2NrZXQgPQogICAgcGVvcGxlRG1DYWxsU29ja2V0Rm9yUm9sZSgKICAgICAgY2FsbCwKICAg
ICAgcm9sZQogICAgKTsKCiAgaWYgKGN1cnJlbnRTb2NrZXQpIHsKICAgIHJldHVybiB7CiAgICAgIG9rOiBmYWxzZSwKICAgICAgcmVhc29uOgogICAgICAg
ICJhbHJlYWR5LWpvaW5lZCIKICAgIH07CiAgfQoKICBpZiAoCiAgICAhcGVvcGxlQWNjb3VudEhhc1ZvaWNlU2xvdCgKICAgICAgYWNjb3VudElkCiAgICAp
CiAgKSB7CiAgICByZXR1cm4gewogICAgICBvazogZmFsc2UsCiAgICAgIHJlYXNvbjoKICAgICAgICAibGltaXQiCiAgICB9OwogIH0KCiAgcGVvcGxlRG1D
YWxsU2V0U29ja2V0Rm9yUm9sZSgKICAgIGNhbGwsCiAgICByb2xlLAogICAgc29ja2V0SWQKICApOwoKICBwZW9wbGVEbUNhbGxTZXRNZWRpYUZvclJvbGUo
CiAgICBjYWxsLAogICAgcm9sZSwKICAgIHsKICAgICAgbXV0ZWQ6IGZhbHNlLAogICAgICBjYW1lcmE6IGZhbHNlLAogICAgICBzY3JlZW46IGZhbHNlCiAg
ICB9CiAgKTsKCiAgcGVvcGxlRG1DYWxscy5zZXQoCiAgICBjYWxsLmlkLAogICAgY2FsbAogICk7CgogIHBlb3BsZVZvaWNlUmVmcmVzaEFjY291bnQoCiAg
ICBhY2NvdW50SWQKICApOwoKICBjb25zdCBvdGhlclJvbGUgPQogICAgcGVvcGxlRG1DYWxsT3RoZXJSb2xlKAogICAgICByb2xlCiAgICApOwoKICBjb25z
dCBwZWVyU29ja2V0SWQgPQogICAgcGVvcGxlRG1DYWxsU29ja2V0Rm9yUm9sZSgKICAgICAgY2FsbCwKICAgICAgb3RoZXJSb2xlCiAgICApOwoKICBpZiAo
cGVlclNvY2tldElkKSB7CiAgICBwZW9wbGVEbUNhbGxOb3RpZnlDb25uZWN0ZWQoCiAgICAgIGNhbGwsCiAgICAgIHNvY2tldElkCiAgICApOwogIH0gZWxz
ZSB7CiAgICBwZW9wbGVEbUNhbGxTY2hlZHVsZVNvbG9UaW1lb3V0KAogICAgICBjYWxsCiAgICApOwogIH0KCiAgY29uc3QgcGVlck1lZGlhID0KICAgIHBl
b3BsZURtQ2FsbE1lZGlhRm9yUm9sZSgKICAgICAgY2FsbCwKICAgICAgb3RoZXJSb2xlCiAgICApOwoKICByZXR1cm4gewogICAgb2s6IHRydWUsCiAgICBy
b2xlLAogICAgcGVlclNvY2tldElkLAogICAgcGVlclVzZXJuYW1lOgogICAgICBwZW9wbGVEbUNhbGxVc2VybmFtZUZvclJvbGUoCiAgICAgICAgY2FsbCwK
ICAgICAgICBvdGhlclJvbGUKICAgICAgKSwKICAgIHBlZXJNdXRlZDoKICAgICAgcGVlck1lZGlhLm11dGVkLAogICAgcGVlckNhbWVyYToKICAgICAgcGVl
ck1lZGlhLmNhbWVyYSwKICAgIHBlZXJTY3JlZW46CiAgICAgIHBlZXJNZWRpYS5zY3JlZW4sCiAgICBpbml0aWF0b3I6CiAgICAgIGZhbHNlCiAgfTsKfQoK
ZnVuY3Rpb24gcGVvcGxlRG1DYWxsTGVhdmVTb2NrZXQoCiAgY2FsbCwKICBzb2NrZXRJZCwKICByZWFzb24gPSAibGVmdCIKKSB7CiAgaWYgKCFjYWxsKSB7
CiAgICByZXR1cm4gZmFsc2U7CiAgfQoKICBjb25zdCBjdXJyZW50ID0KICAgIFN0cmluZygKICAgICAgc29ja2V0SWQgfHwKICAgICAgIiIKICAgICk7Cgog
IGxldCByb2xlID0gIiI7CgogIGlmICgKICAgIFN0cmluZygKICAgICAgY2FsbC5jYWxsZXJTb2NrZXRJZCB8fAogICAgICAiIgogICAgKSA9PT0gY3VycmVu
dAogICkgewogICAgcm9sZSA9ICJjYWxsZXIiOwogIH0gZWxzZSBpZiAoCiAgICBTdHJpbmcoCiAgICAgIGNhbGwuY2FsbGVlU29ja2V0SWQgfHwKICAgICAg
IiIKICAgICkgPT09IGN1cnJlbnQKICApIHsKICAgIHJvbGUgPSAiY2FsbGVlIjsKICB9CgogIGlmICghcm9sZSkgewogICAgcmV0dXJuIGZhbHNlOwogIH0K
CiAgY29uc3QgYWNjb3VudElkID0KICAgIHBlb3BsZURtQ2FsbEFjY291bnRJZEZvclJvbGUoCiAgICAgIGNhbGwsCiAgICAgIHJvbGUKICAgICk7CgogIGNv
bnN0IG90aGVyUm9sZSA9CiAgICBwZW9wbGVEbUNhbGxPdGhlclJvbGUoCiAgICAgIHJvbGUKICAgICk7CgogIGNvbnN0IG90aGVyU29ja2V0ID0KICAgIHBl
b3BsZURtQ2FsbFNvY2tldEZvclJvbGUoCiAgICAgIGNhbGwsCiAgICAgIG90aGVyUm9sZQogICAgKTsKCiAgcGVvcGxlRG1DYWxsU2V0U29ja2V0Rm9yUm9s
ZSgKICAgIGNhbGwsCiAgICByb2xlLAogICAgbnVsbAogICk7CgogIHBlb3BsZURtQ2FsbFNldE1lZGlhRm9yUm9sZSgKICAgIGNhbGwsCiAgICByb2xlLAog
ICAgewogICAgICBtdXRlZDogZmFsc2UsCiAgICAgIGNhbWVyYTogZmFsc2UsCiAgICAgIHNjcmVlbjogZmFsc2UKICAgIH0KICApOwoKICBwZW9wbGVEbUNh
bGxzLnNldCgKICAgIGNhbGwuaWQsCiAgICBjYWxsCiAgKTsKCiAgaW8udG8oCiAgICBjdXJyZW50CiAgKS5lbWl0KAogICAgImRtLWNhbGwtbGVmdCIsCiAg
ICB7CiAgICAgIGNhbGxJZDoKICAgICAgICBjYWxsLmlkLAogICAgICByZWFzb246CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgcmVhc29uIHx8CiAgICAg
ICAgICAibGVmdCIKICAgICAgICApCiAgICB9CiAgKTsKCiAgaWYgKG90aGVyU29ja2V0KSB7CiAgICBpby50bygKICAgICAgb3RoZXJTb2NrZXQKICAgICku
ZW1pdCgKICAgICAgImRtLWNhbGwtcGVlci1sZWZ0IiwKICAgICAgewogICAgICAgIGNhbGxJZDoKICAgICAgICAgIGNhbGwuaWQsCiAgICAgICAgcmVhc29u
OgogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICByZWFzb24gfHwKICAgICAgICAgICAgImxlZnQiCiAgICAgICAgICApLAogICAgICAgIHJlam9pbldp
bmRvd01zOgogICAgICAgICAgUEVPUExFX0RNX0NBTExfU09MT19NUwogICAgICB9CiAgICApOwogIH0KCiAgcGVvcGxlVm9pY2VSZWZyZXNoQWNjb3VudCgK
ICAgIGFjY291bnRJZAogICk7CgogIGlmICgKICAgIHBlb3BsZURtQ2FsbFBhcnRpY2lwYW50Q291bnQoCiAgICAgIGNhbGwKICAgICkgPT09IDAKICApIHsK
ICAgIHBlb3BsZURtQ2FsbEZpbmlzaCgKICAgICAgY2FsbC5pZCwKICAgICAgImVtcHR5IgogICAgKTsKICB9IGVsc2UgewogICAgcGVvcGxlRG1DYWxsU2No
ZWR1bGVTb2xvVGltZW91dCgKICAgICAgY2FsbAogICAgKTsKICB9CgogIHJldHVybiB0cnVlOwp9CgpmdW5jdGlvbiBwZW9wbGVEbUNhbGxEaXNjb25uZWN0
KAogIHNvY2tldAopIHsKICBjb25zdCBzb2NrZXRJZCA9CiAgICBTdHJpbmcoCiAgICAgIHNvY2tldD8uaWQgfHwKICAgICAgIiIKICAgICk7CgogIGNvbnN0
IGFjY291bnRJZCA9CiAgICBTdHJpbmcoCiAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgIHNvY2tldElkCiAgICAgICkgfHwKICAgICAgIiIKICAgICk7Cgog
IGlmICgKICAgICFzb2NrZXRJZCB8fAogICAgIWFjY291bnRJZAogICkgewogICAgcmV0dXJuOwogIH0KCiAgZm9yICgKICAgIGNvbnN0IGNhbGwgb2YKICAg
IFsuLi5wZW9wbGVEbUNhbGxzLnZhbHVlcygpXQogICkgewogICAgaWYgKAogICAgICBTdHJpbmcoCiAgICAgICAgY2FsbC5jYWxsZXJTb2NrZXRJZCB8fAog
ICAgICAgICIiCiAgICAgICkgPT09IHNvY2tldElkIHx8CiAgICAgIFN0cmluZygKICAgICAgICBjYWxsLmNhbGxlZVNvY2tldElkIHx8CiAgICAgICAgIiIK
ICAgICAgKSA9PT0gc29ja2V0SWQKICAgICkgewogICAgICBwZW9wbGVEbUNhbGxMZWF2ZVNvY2tldCgKICAgICAgICBjYWxsLAogICAgICAgIHNvY2tldElk
LAogICAgICAgICJkaXNjb25uZWN0ZWQiCiAgICAgICk7CiAgICB9CiAgfQp9CgovLyA9PT0gUEVPUExFX0RNX0NBTExTX1YxX0VORCA9PT0KCi8vID09PSBQ
RU9QTEVfRE1fQ0FMTFNfVjJfU1RBUlQgPT09CmNvbnN0IFBFT1BMRV9ETV9DQUxMX0VWRU5UX1BSRUZJWCA9CiAgIltbUEVPUExFX0NBTExfVjF8IjsKCmZ1
bmN0aW9uIHBlb3BsZURtQ2FsbEV2ZW50Qm9keSgKICB0eXBlLAogIGNhbGxJZCwKICByZWFzb24gPSAiIiwKICBkdXJhdGlvblNlY29uZHMgPSAwCikgewog
IGNvbnN0IGNsZWFuVHlwZSA9CiAgICB0eXBlID09PSAiZW5kZWQiCiAgICAgID8gImVuZGVkIgogICAgICA6ICJzdGFydGVkIjsKCiAgY29uc3QgY2xlYW5J
ZCA9CiAgICBTdHJpbmcoCiAgICAgIGNhbGxJZCB8fAogICAgICAiIgogICAgKS5yZXBsYWNlKAogICAgICAvW15hLXpBLVowLTktXS9nLAogICAgICAiIgog
ICAgKTsKCiAgY29uc3QgY2xlYW5SZWFzb24gPQogICAgU3RyaW5nKAogICAgICByZWFzb24gfHwKICAgICAgIiIKICAgICkucmVwbGFjZSgKICAgICAgL1te
YS16QS1aMC05LV0vZywKICAgICAgIiIKICAgICk7CgogIGNvbnN0IGR1cmF0aW9uID0KICAgIE1hdGgubWF4KAogICAgICAwLAogICAgICBNYXRoLm1pbigK
ICAgICAgICAyNCAqIDYwICogNjAsCiAgICAgICAgTWF0aC5yb3VuZCgKICAgICAgICAgIE51bWJlcigKICAgICAgICAgICAgZHVyYXRpb25TZWNvbmRzCiAg
ICAgICAgICApIHx8IDAKICAgICAgICApCiAgICAgICkKICAgICk7CgogIHJldHVybiAoCiAgICBQRU9QTEVfRE1fQ0FMTF9FVkVOVF9QUkVGSVggKwogICAg
Y2xlYW5UeXBlICsKICAgICJ8IiArCiAgICBjbGVhbklkICsKICAgICJ8IiArCiAgICBjbGVhblJlYXNvbiArCiAgICAifCIgKwogICAgZHVyYXRpb24gKwog
ICAgIl1dIgogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbFBhcnNlRXZlbnRCb2R5KAogIGJvZHkKKSB7CiAgY29uc3QgbWF0Y2ggPQogICAgU3RyaW5n
KAogICAgICBib2R5IHx8CiAgICAgICIiCiAgICApLm1hdGNoKAogICAgICAvXlxbXFtQRU9QTEVfQ0FMTF9WMVx8KHN0YXJ0ZWR8ZW5kZWQpXHwoW2EtekEt
WjAtOS1dKylcfChbYS16QS1aMC05LV0qKVx8KFxkKylcXVxdJC8KICAgICk7CgogIGlmICghbWF0Y2gpIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgcmV0
dXJuIHsKICAgIHR5cGU6CiAgICAgIG1hdGNoWzFdLAogICAgY2FsbElkOgogICAgICBtYXRjaFsyXSwKICAgIHJlYXNvbjoKICAgICAgbWF0Y2hbM10gfHwg
IiIsCiAgICBkdXJhdGlvblNlY29uZHM6CiAgICAgIE1hdGgubWF4KAogICAgICAgIDAsCiAgICAgICAgTnVtYmVyKAogICAgICAgICAgbWF0Y2hbNF0KICAg
ICAgICApIHx8IDAKICAgICAgKQogIH07Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbENvbnZlcnNhdGlvblByZXZpZXcoCiAgYm9keSwKICBpbWFnZUlkCikg
ewogIGNvbnN0IGNsZWFuQm9keSA9CiAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAgIGJvZHkKICAgICk7CgogIGlmICgKICAgIHBlb3BsZURt
RTJlZUlzRW52ZWxvcGUoCiAgICAgIGNsZWFuQm9keQogICAgKQogICkgewogICAgcmV0dXJuICJNZXNzYWdlIHByaXbDqSI7CiAgfQoKICBjb25zdCBldmVu
dCA9CiAgICBwZW9wbGVEbUNhbGxQYXJzZUV2ZW50Qm9keSgKICAgICAgY2xlYW5Cb2R5CiAgICApOwoKICBpZiAoIWV2ZW50KSB7CiAgICByZXR1cm4gKAog
ICAgICBjbGVhbkJvZHkgfHwKICAgICAgKAogICAgICAgIGltYWdlSWQKICAgICAgICAgID8gIvCflrzvuI8gSW1hZ2UiCiAgICAgICAgICA6ICIiCiAgICAg
ICkKICAgICk7CiAgfQoKICBpZiAoCiAgICBldmVudC50eXBlID09PQogICAgInN0YXJ0ZWQiCiAgKSB7CiAgICByZXR1cm4gIvCfk54gQXBwZWwgbGFuY8Op
IjsKICB9CgogIGNvbnN0IGxhYmVscyA9IHsKICAgIGRlY2xpbmVkOgogICAgICAi8J+TniBBcHBlbCByZWZ1c8OpIiwKICAgIGNhbmNlbGxlZDoKICAgICAg
IvCfk54gQXBwZWwgYW5udWzDqSIsCiAgICB0aW1lb3V0OgogICAgICAi8J+TniBBcHBlbCBtYW5xdcOpIiwKICAgICJhbG9uZS10aW1lb3V0IjoKICAgICAg
IvCfk54gQXBwZWwgdGVybWluw6kiLAogICAgZW1wdHk6CiAgICAgICLwn5OeIEFwcGVsIHRlcm1pbsOpIiwKICAgIGRpc2Nvbm5lY3RlZDoKICAgICAgIvCf
k54gQXBwZWwgaW50ZXJyb21wdSIsCiAgICBoYW5ndXA6CiAgICAgICLwn5OeIEFwcGVsIHRlcm1pbsOpIgogIH07CgogIHJldHVybiAoCiAgICBsYWJlbHNb
CiAgICAgIGV2ZW50LnJlYXNvbgogICAgXSB8fAogICAgIvCfk54gQXBwZWwgdGVybWluw6kiCiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlRG1DYWxsRW1pdEhp
c3RvcnkoCiAgY2FsbCwKICB0eXBlLAogIHJlYXNvbiwKICBkdXJhdGlvblNlY29uZHMsCiAgY3JlYXRlZEF0CikgewogIGNvbnN0IHBheWxvYWQgPSB7CiAg
ICBjYWxsSWQ6CiAgICAgIGNhbGwuaWQsCiAgICBjYWxsZXJJZDoKICAgICAgU3RyaW5nKAogICAgICAgIGNhbGwuY2FsbGVyQWNjb3VudElkCiAgICAgICks
CiAgICBjYWxsZWVJZDoKICAgICAgU3RyaW5nKAogICAgICAgIGNhbGwuY2FsbGVlQWNjb3VudElkCiAgICAgICksCiAgICB0eXBlLAogICAgcmVhc29uOgog
ICAgICBTdHJpbmcoCiAgICAgICAgcmVhc29uIHx8CiAgICAgICAgIiIKICAgICAgKSwKICAgIGR1cmF0aW9uU2Vjb25kczoKICAgICAgTnVtYmVyKAogICAg
ICAgIGR1cmF0aW9uU2Vjb25kcyB8fAogICAgICAgIDAKICAgICAgKSwKICAgIGNyZWF0ZWRBdAogIH07CgogIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICBj
YWxsLmNhbGxlckFjY291bnRJZCwKICAgICJkbS1jYWxsLWhpc3RvcnkiLAogICAgcGF5bG9hZAogICk7CgogIHBlb3BsZUVtaXRUb0FjY291bnQoCiAgICBj
YWxsLmNhbGxlZUFjY291bnRJZCwKICAgICJkbS1jYWxsLWhpc3RvcnkiLAogICAgcGF5bG9hZAogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZURtQ2FsbFNhdmVU
aW1lbGluZSgKICBjYWxsLAogIHR5cGUsCiAgcmVhc29uID0gIiIsCiAgZHVyYXRpb25TZWNvbmRzID0gMAopIHsKICBpZiAoIWNhbGwpIHsKICAgIHJldHVy
bjsKICB9CgogIGNvbnN0IGJvZHkgPQogICAgcGVvcGxlRG1DYWxsRXZlbnRCb2R5KAogICAgICB0eXBlLAogICAgICBjYWxsLmlkLAogICAgICByZWFzb24s
CiAgICAgIGR1cmF0aW9uU2Vjb25kcwogICAgKTsKCiAgY29uc3QgY3JlYXRlZEF0ID0KICAgIG5ldyBEYXRlKCkKICAgICAgLnRvSVNPU3RyaW5nKCk7Cgog
IC8qCiAgICBMJ8OpdsOpbmVtZW50IGRlIGZpbiBuZSBjcsOpZSBwYXMgdW4gZGV1eGnDqG1lIGJhZGdlIG5vbiBsdS4KICAgIElsIHJlc3RlIGJpZW4gdmlz
aWJsZSBkYW5zIGwnaGlzdG9yaXF1ZS4KICAqLwogIGNvbnN0IHJlYWRBdCA9CiAgICB0eXBlID09PSAiZW5kZWQiCiAgICAgID8gY3JlYXRlZEF0CiAgICAg
IDogbnVsbDsKCiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIHZvaWQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgIklOU0VSVCBJTlRPIHBlb3BsZV9kaXJlY3Rf
bWVzc2FnZXMgIiArCiAgICAgICIoc2VuZGVyX2lkLCByZWNpcGllbnRfaWQsIGJvZHksIHJlYWRfYXQpICIgKwogICAgICAiVkFMVUVTICgkMSwgJDIsICQz
LCAkNCkgIiArCiAgICAgICJSRVRVUk5JTkcgaWQiLAogICAgICBbCiAgICAgICAgU3RyaW5nKAogICAgICAgICAgY2FsbC5jYWxsZXJBY2NvdW50SWQKICAg
ICAgICApLAogICAgICAgIFN0cmluZygKICAgICAgICAgIGNhbGwuY2FsbGVlQWNjb3VudElkCiAgICAgICAgKSwKICAgICAgICBwZW9wbGVFbmNyeXB0TWVz
c2FnZVRleHQoCiAgICAgICAgICBib2R5CiAgICAgICAgKSwKICAgICAgICByZWFkQXQKICAgICAgXQogICAgKQogICAgICAudGhlbigKICAgICAgICAoKSA9
PiB7CiAgICAgICAgICBwZW9wbGVEbUNhbGxFbWl0SGlzdG9yeSgKICAgICAgICAgICAgY2FsbCwKICAgICAgICAgICAgdHlwZSwKICAgICAgICAgICAgcmVh
c29uLAogICAgICAgICAgICBkdXJhdGlvblNlY29uZHMsCiAgICAgICAgICAgIGNyZWF0ZWRBdAogICAgICAgICAgKTsKICAgICAgICB9CiAgICAgICkKICAg
ICAgLmNhdGNoKAogICAgICAgIChlcnIpID0+IHsKICAgICAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgICAgICJbUGVvcGxlIGRtLWNhbGwvaGlzdG9y
eV0iLAogICAgICAgICAgICBlcnIKICAgICAgICAgICk7CiAgICAgICAgfQogICAgICApOwoKICAgIHJldHVybjsKICB9CgogIHRyeSB7CiAgICBjb25zdCBk
YXRhID0KICAgICAgcGVvcGxlUmVhZExvY2FsU29jaWFsKCk7CgogICAgZGF0YS5kbXMucHVzaCh7CiAgICAgIGlkOgogICAgICAgIGNyeXB0b0FjY291bnRz
CiAgICAgICAgICAucmFuZG9tVVVJRCgpLAogICAgICBzZW5kZXJfaWQ6CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgY2FsbC5jYWxsZXJBY2NvdW50SWQK
ICAgICAgICApLAogICAgICByZWNpcGllbnRfaWQ6CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgY2FsbC5jYWxsZWVBY2NvdW50SWQKICAgICAgICApLAog
ICAgICBib2R5LAogICAgICBpbWFnZV9pZDoKICAgICAgICBudWxsLAogICAgICByZXBseV90b19pZDoKICAgICAgICBudWxsLAogICAgICBjcmVhdGVkX2F0
OgogICAgICAgIGNyZWF0ZWRBdCwKICAgICAgcmVhZF9hdDoKICAgICAgICByZWFkQXQKICAgIH0pOwoKICAgIGlmICgKICAgICAgZGF0YS5kbXMubGVuZ3Ro
ID4KICAgICAgMTAwMDAKICAgICkgewogICAgICBkYXRhLmRtcyA9CiAgICAgICAgZGF0YS5kbXMuc2xpY2UoCiAgICAgICAgICAtMTAwMDAKICAgICAgICAp
OwogICAgfQoKICAgIHBlb3BsZVdyaXRlTG9jYWxTb2NpYWwoCiAgICAgIGRhdGEKICAgICk7CgogICAgcGVvcGxlRG1DYWxsRW1pdEhpc3RvcnkoCiAgICAg
IGNhbGwsCiAgICAgIHR5cGUsCiAgICAgIHJlYXNvbiwKICAgICAgZHVyYXRpb25TZWNvbmRzLAogICAgICBjcmVhdGVkQXQKICAgICk7CiAgfSBjYXRjaCAo
ZXJyKSB7CiAgICBjb25zb2xlLmVycm9yKAogICAgICAiW1Blb3BsZSBkbS1jYWxsL2hpc3RvcnkgbG9jYWxdIiwKICAgICAgZXJyCiAgICApOwogIH0KfQoK
ZnVuY3Rpb24gcGVvcGxlRG1DYWxsRGVsaXZlclBlbmRpbmdGb3JBY2NvdW50KAogIGFjY291bnRJZCwKICBzb2NrZXRJZAopIHsKICBjb25zdCB3YW50ZWQg
PQogICAgU3RyaW5nKAogICAgICBhY2NvdW50SWQgfHwKICAgICAgIiIKICAgICk7CgogIGNvbnN0IHRhcmdldFNvY2tldCA9CiAgICBTdHJpbmcoCiAgICAg
IHNvY2tldElkIHx8CiAgICAgICIiCiAgICApOwoKICBpZiAoCiAgICAhd2FudGVkIHx8CiAgICAhdGFyZ2V0U29ja2V0CiAgKSB7CiAgICByZXR1cm47CiAg
fQoKICBmb3IgKAogICAgY29uc3QgY2FsbCBvZgogICAgcGVvcGxlRG1DYWxscy52YWx1ZXMoKQogICkgewogICAgaWYgKAogICAgICBjYWxsLnN0YXR1cyAh
PT0KICAgICAgICAiYWN0aXZlIgogICAgKSB7CiAgICAgIGNvbnRpbnVlOwogICAgfQoKICAgIGNvbnN0IHJvbGUgPQogICAgICBwZW9wbGVEbUNhbGxSb2xl
Rm9yQWNjb3VudCgKICAgICAgICBjYWxsLAogICAgICAgIHdhbnRlZAogICAgICApOwoKICAgIGlmICghcm9sZSkgewogICAgICBjb250aW51ZTsKICAgIH0K
CiAgICBpZiAoCiAgICAgIHBlb3BsZURtQ2FsbFNvY2tldEZvclJvbGUoCiAgICAgICAgY2FsbCwKICAgICAgICByb2xlCiAgICAgICkKICAgICkgewogICAg
ICBjb250aW51ZTsKICAgIH0KCiAgICBjb25zdCBvdGhlclJvbGUgPQogICAgICBwZW9wbGVEbUNhbGxPdGhlclJvbGUoCiAgICAgICAgcm9sZQogICAgICAp
OwoKICAgIGNvbnN0IG90aGVyU29ja2V0ID0KICAgICAgcGVvcGxlRG1DYWxsU29ja2V0Rm9yUm9sZSgKICAgICAgICBjYWxsLAogICAgICAgIG90aGVyUm9s
ZQogICAgICApOwoKICAgIGlmICghb3RoZXJTb2NrZXQpIHsKICAgICAgY29udGludWU7CiAgICB9CgogICAgY29uc3QgaW5pdGlhbFJpbmcgPQogICAgICBy
b2xlID09PSAiY2FsbGVlIiAmJgogICAgICBCb29sZWFuKAogICAgICAgIGNhbGwucmluZ0FjdGl2ZQogICAgICApOwoKICAgIGlvLnRvKAogICAgICB0YXJn
ZXRTb2NrZXQKICAgICkuZW1pdCgKICAgICAgImRtLWNhbGwtaW5jb21pbmciLAogICAgICB7CiAgICAgICAgY2FsbElkOgogICAgICAgICAgY2FsbC5pZCwK
ICAgICAgICBjYWxsZXI6IHsKICAgICAgICAgIGlkOgogICAgICAgICAgICBwZW9wbGVEbUNhbGxBY2NvdW50SWRGb3JSb2xlKAogICAgICAgICAgICAgIGNh
bGwsCiAgICAgICAgICAgICAgb3RoZXJSb2xlCiAgICAgICAgICAgICksCiAgICAgICAgICB1c2VybmFtZToKICAgICAgICAgICAgcGVvcGxlRG1DYWxsVXNl
cm5hbWVGb3JSb2xlKAogICAgICAgICAgICAgIGNhbGwsCiAgICAgICAgICAgICAgb3RoZXJSb2xlCiAgICAgICAgICAgICkKICAgICAgICB9LAogICAgICAg
IHJlam9pbjoKICAgICAgICAgICFpbml0aWFsUmluZywKICAgICAgICBzaWxlbnQ6CiAgICAgICAgICAhaW5pdGlhbFJpbmcKICAgICAgfQogICAgKTsKICB9
Cn0KCi8vID09PSBQRU9QTEVfRE1fQ0FMTFNfVjJfRU5EID09PQoKZnVuY3Rpb24gY2xlYW5Vc2VybmFtZSh2YWx1ZSkgewogIHJldHVybiBTdHJpbmcodmFs
dWUgfHwgIkludml0w6kiKQogICAgLnRyaW0oKQogICAgLnNsaWNlKDAsIDI0KSB8fCAiSW52aXTDqSI7Cn0KCmZ1bmN0aW9uIHBlb3BsZUFjY291bnRDb25u
ZWN0aW9uQ291bnQoCiAgYWNjb3VudElkCikgewogIGNvbnN0IHdhbnRlZCA9CiAgICBTdHJpbmcoYWNjb3VudElkIHx8ICIiKTsKCiAgaWYgKCF3YW50ZWQp
IHsKICAgIHJldHVybiAwOwogIH0KCiAgbGV0IGNvdW50ID0gMDsKCiAgZm9yICgKICAgIGNvbnN0IGlkCiAgICBvZiB1c2VySWRzLnZhbHVlcygpCiAgKSB7
CiAgICBpZiAoCiAgICAgIFN0cmluZyhpZCkgPT09CiAgICAgIHdhbnRlZAogICAgKSB7CiAgICAgIGNvdW50ICs9IDE7CiAgICB9CiAgfQoKICByZXR1cm4g
Y291bnQ7Cn0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVNlcnZlclByZXNlbmNlUm9zdGVyKAogIHNlcnZlcklkCikgewogIGNvbnN0IHNpZCA9CiAgICBTdHJp
bmcoc2VydmVySWQgfHwgIiIpOwoKICBpZiAoIXNpZCkgewogICAgcmV0dXJuIFtdOwogIH0KCiAgY29uc3QgY29ubmVjdGlvbkNvdW50cyA9CiAgICBuZXcg
TWFwKCk7CgogIGZvciAoY29uc3QgaWQgb2YgdXNlcklkcy52YWx1ZXMoKSkgewogICAgY29uc3Qga2V5ID0KICAgICAgU3RyaW5nKGlkIHx8ICIiKTsKCiAg
ICBpZiAoIWtleSkgewogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBjb25uZWN0aW9uQ291bnRzLnNldCgKICAgICAga2V5LAogICAgICAoCiAgICAgICAg
Y29ubmVjdGlvbkNvdW50cy5nZXQoa2V5KSB8fAogICAgICAgIDAKICAgICAgKSArIDEKICAgICk7CiAgfQoKICBpZiAocGVvcGxlUG9vbCkgewogICAgY29u
c3QgcmVzdWx0ID0KICAgICAgYXdhaXQgcGVvcGxlUG9vbC5xdWVyeSgKICAgICAgICAiU0VMRUNUIGEuaWQsIGEudXNlcm5hbWUsIG0uam9pbmVkX2F0ICIg
KwogICAgICAgICJGUk9NIHBlb3BsZV9zZXJ2ZXJfbWVtYmVycyBtICIgKwogICAgICAgICJKT0lOIHBlb3BsZV9hY2NvdW50cyBhIE9OIGEuaWQgPSBtLnVz
ZXJfaWQgIiArCiAgICAgICAgIldIRVJFIG0uc2VydmVyX2lkID0gJDEgIiArCiAgICAgICAgIk9SREVSIEJZIExPV0VSKGEudXNlcm5hbWUpIEFTQywgYS5p
ZCBBU0MiLAogICAgICAgIFtzaWRdCiAgICAgICk7CgogICAgcmV0dXJuIHJlc3VsdC5yb3dzLm1hcCgKICAgICAgKHJvdykgPT4gewogICAgICAgIGNvbnN0
IGFjY291bnRJZCA9CiAgICAgICAgICBTdHJpbmcocm93LmlkKTsKCiAgICAgICAgY29uc3QgY29ubmVjdGlvbnMgPQogICAgICAgICAgY29ubmVjdGlvbkNv
dW50cy5nZXQoCiAgICAgICAgICAgIGFjY291bnRJZAogICAgICAgICAgKSB8fCAwOwoKICAgICAgICByZXR1cm4gewogICAgICAgICAgaWQ6CiAgICAgICAg
ICAgIGFjY291bnRJZCwKICAgICAgICAgIGFjY291bnRJZCwKICAgICAgICAgIHVzZXJuYW1lOgogICAgICAgICAgICByb3cudXNlcm5hbWUsCiAgICAgICAg
ICBvbmxpbmU6CiAgICAgICAgICAgIGNvbm5lY3Rpb25zID4gMCwKICAgICAgICAgIGNvbm5lY3Rpb25zCiAgICAgICAgfTsKICAgICAgfQogICAgKTsKICB9
CgogIGNvbnN0IHNlcnZlckRhdGEgPQogICAgcGVvcGxlUmVhZExvY2FsU2VydmVycygpOwoKICBjb25zdCBhY2NvdW50cyA9CiAgICBwZW9wbGVSZWFkTG9j
YWxBY2NvdW50cygpOwoKICByZXR1cm4gc2VydmVyRGF0YS5tZW1iZXJzCiAgICAuZmlsdGVyKAogICAgICAobWVtYmVyKSA9PgogICAgICAgIFN0cmluZygK
ICAgICAgICAgIG1lbWJlci5zZXJ2ZXJJZAogICAgICAgICkgPT09IHNpZAogICAgKQogICAgLm1hcCgKICAgICAgKG1lbWJlcikgPT4gewogICAgICAgIGNv
bnN0IGFjY291bnRJZCA9CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIG1lbWJlci51c2VySWQKICAgICAgICAgICk7CgogICAgICAgIGNvbnN0IGFj
Y291bnQgPQogICAgICAgICAgYWNjb3VudHMuZmluZCgKICAgICAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAg
ICAgaXRlbS5pZAogICAgICAgICAgICAgICkgPT09CiAgICAgICAgICAgICAgYWNjb3VudElkCiAgICAgICAgICApOwoKICAgICAgICBpZiAoIWFjY291bnQp
IHsKICAgICAgICAgIHJldHVybiBudWxsOwogICAgICAgIH0KCiAgICAgICAgY29uc3QgY29ubmVjdGlvbnMgPQogICAgICAgICAgY29ubmVjdGlvbkNvdW50
cy5nZXQoCiAgICAgICAgICAgIGFjY291bnRJZAogICAgICAgICAgKSB8fCAwOwoKICAgICAgICByZXR1cm4gewogICAgICAgICAgaWQ6CiAgICAgICAgICAg
IGFjY291bnRJZCwKICAgICAgICAgIGFjY291bnRJZCwKICAgICAgICAgIHVzZXJuYW1lOgogICAgICAgICAgICBhY2NvdW50LnVzZXJuYW1lLAogICAgICAg
ICAgb25saW5lOgogICAgICAgICAgICBjb25uZWN0aW9ucyA+IDAsCiAgICAgICAgICBjb25uZWN0aW9ucwogICAgICAgIH07CiAgICAgIH0KICAgICkKICAg
IC5maWx0ZXIoQm9vbGVhbikKICAgIC5zb3J0KAogICAgICAoYSwgYikgPT4KICAgICAgICBTdHJpbmcoCiAgICAgICAgICBhLnVzZXJuYW1lIHx8ICIiCiAg
ICAgICAgKS5sb2NhbGVDb21wYXJlKAogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBiLnVzZXJuYW1lIHx8ICIiCiAgICAgICAgICApLAogICAgICAg
ICAgImZyIiwKICAgICAgICAgIHsKICAgICAgICAgICAgc2Vuc2l0aXZpdHk6CiAgICAgICAgICAgICAgImJhc2UiCiAgICAgICAgICB9CiAgICAgICAgKQog
ICAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gZW1pdE9ubGluZVVzZXJzKAogIHNlcnZlcklkLAogIGtub3duUm9zdGVyID0gbnVsbAopIHsKICBjb25zdCBzaWQg
PQogICAgU3RyaW5nKHNlcnZlcklkIHx8ICIiKTsKCiAgaWYgKCFzaWQpIHsKICAgIHJldHVybjsKICB9CgogIHRyeSB7CiAgICBjb25zdCByb3N0ZXIgPQog
ICAgICBBcnJheS5pc0FycmF5KAogICAgICAgIGtub3duUm9zdGVyCiAgICAgICkKICAgICAgICA/IGtub3duUm9zdGVyCiAgICAgICAgOiBhd2FpdCBwZW9w
bGVTZXJ2ZXJQcmVzZW5jZVJvc3RlcigKICAgICAgICAgICAgc2lkCiAgICAgICAgICApOwoKICAgIGNvbnN0IG9ubGluZUNvdW50ID0KICAgICAgcm9zdGVy
LmZpbHRlcigKICAgICAgICAodXNlcikgPT4KICAgICAgICAgIHVzZXI/Lm9ubGluZSA9PT0KICAgICAgICAgIHRydWUKICAgICAgKS5sZW5ndGg7CgogICAg
aW8udG8oCiAgICAgIHBlb3BsZVNlcnZlclJvb20oCiAgICAgICAgc2lkCiAgICAgICkKICAgICkuZW1pdCgKICAgICAgInVzZXItY291bnQiLAogICAgICBv
bmxpbmVDb3VudAogICAgKTsKCiAgICBpby50bygKICAgICAgcGVvcGxlU2VydmVyUm9vbSgKICAgICAgICBzaWQKICAgICAgKQogICAgKS5lbWl0KAogICAg
ICAib25saW5lLXVzZXJzIiwKICAgICAgcm9zdGVyCiAgICApOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigKICAgICAgIltQZW9wbGUg
cHJlc2VuY2Uvc2VydmVyXSIsCiAgICAgIHNpZCwKICAgICAgZXJyCiAgICApOwogIH0KfQoKLy8gPT09IFBFT1BMRV9HTE9CQUxfUFJFU0VOQ0VfRVZFTlRf
VjFfU1RBUlQgPT09CmZ1bmN0aW9uIHBlb3BsZUVtaXRHbG9iYWxQcmVzZW5jZSgKICBhY2NvdW50SWQKKSB7CiAgY29uc3QgdWlkID0KICAgIFN0cmluZygK
ICAgICAgYWNjb3VudElkIHx8CiAgICAgICIiCiAgICApOwoKICBpZiAoIXVpZCkgewogICAgcmV0dXJuOwogIH0KCiAgY29uc3QgcGF5bG9hZCA9IHsKICAg
IGFjY291bnRJZDoKICAgICAgdWlkLAogICAgb25saW5lOgogICAgICBwZW9wbGVBY2NvdW50SXNPbmxpbmUoCiAgICAgICAgdWlkCiAgICAgICkKICB9OwoK
ICAvKgogICAgRW52b2kgdW5pcXVlbWVudCBhdXggc29ja2V0cyBQZW9wbGUgYXV0aGVudGlmacOpZXMuCiAgICBMYSBwcsOpc2VuY2Ugw6l0YWl0IGTDqWrD
oCBwdWJsaXF1ZSBkYW5zIGwnYW5udWFpcmUvcHJvZmlscyA7CiAgICBjZXQgw6l2w6luZW1lbnQgbmUgcmFqb3V0ZSBhdWN1bmUgZG9ubsOpZSBwcml2w6ll
LgogICovCiAgZm9yICgKICAgIGNvbnN0IHNvY2tldElkIG9mCiAgICB1c2VySWRzLmtleXMoKQogICkgewogICAgaW8udG8oCiAgICAgIHNvY2tldElkCiAg
ICApLmVtaXQoCiAgICAgICJwZW9wbGUtcHJlc2VuY2UtY2hhbmdlZCIsCiAgICAgIHBheWxvYWQKICAgICk7CiAgfQp9Ci8vID09PSBQRU9QTEVfR0xPQkFM
X1BSRVNFTkNFX0VWRU5UX1YxX0VORCA9PT0KCmFzeW5jIGZ1bmN0aW9uIHBlb3BsZVJlZnJlc2hQcmVzZW5jZUZvckFjY291bnQoCiAgYWNjb3VudElkCikg
ewogIGNvbnN0IHVpZCA9CiAgICBTdHJpbmcoYWNjb3VudElkIHx8ICIiKTsKCiAgaWYgKCF1aWQpIHsKICAgIHJldHVybjsKICB9CgogIC8vID09PSBQRU9Q
TEVfR0xPQkFMX1BSRVNFTkNFX1JFRlJFU0hfVjEgPT09CiAgcGVvcGxlRW1pdEdsb2JhbFByZXNlbmNlKAogICAgdWlkCiAgKTsKCiAgdHJ5IHsKICAgIGNv
bnN0IHNlcnZlcnMgPQogICAgICBhd2FpdCBwZW9wbGVMaXN0U2VydmVyc0ZvclVzZXIoCiAgICAgICAgdWlkCiAgICAgICk7CgogICAgYXdhaXQgUHJvbWlz
ZS5hbGwoCiAgICAgIHNlcnZlcnMubWFwKAogICAgICAgIChzZXJ2ZXIpID0+CiAgICAgICAgICBlbWl0T25saW5lVXNlcnMoCiAgICAgICAgICAgIHNlcnZl
ci5pZAogICAgICAgICAgKQogICAgICApCiAgICApOwogIH0gY2F0Y2ggKGVycikgewogICAgY29uc29sZS5lcnJvcigKICAgICAgIltQZW9wbGUgcHJlc2Vu
Y2UvYWNjb3VudF0iLAogICAgICB1aWQsCiAgICAgIGVycgogICAgKTsKICB9Cn0KCi8qCiAgVW5lIHBldGl0ZSBncsOiY2Ugw6l2aXRlIGxlIGNsaWdub3Rl
bWVudCAiaG9ycyBsaWduZSIKICBwZW5kYW50IHVuIHNpbXBsZSBGNSAvIHJlY29ubmVjdCBTb2NrZXQuSU8uCiAgQ2hhbmdlciBkJ29uZ2xldCBuYXZpZ2F0
ZXVyIG5lIGZlcm1lIHBhcyBsYSBzb2NrZXQsCiAgZG9uYyDDp2EgbmUgdG91Y2hlIGphbWFpcyBhdSBzdGF0dXQuCiovCmNvbnN0IHBlb3BsZVByZXNlbmNl
T2ZmbGluZVRpbWVycyA9CiAgbmV3IE1hcCgpOwoKZnVuY3Rpb24gcGVvcGxlQ2FuY2VsUHJlc2VuY2VPZmZsaW5lKAogIGFjY291bnRJZAopIHsKICBjb25z
dCB1aWQgPQogICAgU3RyaW5nKGFjY291bnRJZCB8fCAiIik7CgogIGNvbnN0IHRpbWVyID0KICAgIHBlb3BsZVByZXNlbmNlT2ZmbGluZVRpbWVycy5nZXQo
CiAgICAgIHVpZAogICAgKTsKCiAgaWYgKCF0aW1lcikgewogICAgcmV0dXJuIGZhbHNlOwogIH0KCiAgY2xlYXJUaW1lb3V0KHRpbWVyKTsKCiAgcGVvcGxl
UHJlc2VuY2VPZmZsaW5lVGltZXJzLmRlbGV0ZSgKICAgIHVpZAogICk7CgogIHJldHVybiB0cnVlOwp9CgpmdW5jdGlvbiBwZW9wbGVTY2hlZHVsZVByZXNl
bmNlT2ZmbGluZSgKICBhY2NvdW50SWQKKSB7CiAgY29uc3QgdWlkID0KICAgIFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwoKICBpZiAoIXVpZCkgewogICAg
cmV0dXJuOwogIH0KCiAgcGVvcGxlQ2FuY2VsUHJlc2VuY2VPZmZsaW5lKAogICAgdWlkCiAgKTsKCiAgY29uc3QgdGltZXIgPQogICAgc2V0VGltZW91dCgK
ICAgICAgYXN5bmMgKCkgPT4gewogICAgICAgIHBlb3BsZVByZXNlbmNlT2ZmbGluZVRpbWVycy5kZWxldGUoCiAgICAgICAgICB1aWQKICAgICAgICApOwoK
ICAgICAgICBpZiAoCiAgICAgICAgICBwZW9wbGVBY2NvdW50SXNPbmxpbmUoCiAgICAgICAgICAgIHVpZAogICAgICAgICAgKQogICAgICAgICkgewogICAg
ICAgICAgcmV0dXJuOwogICAgICAgIH0KCiAgICAgICAgYXdhaXQgcGVvcGxlUmVmcmVzaFByZXNlbmNlRm9yQWNjb3VudCgKICAgICAgICAgIHVpZAogICAg
ICAgICk7CiAgICAgIH0sCiAgICAgIDEyMDAKICAgICk7CgogIHBlb3BsZVByZXNlbmNlT2ZmbGluZVRpbWVycy5zZXQoCiAgICB1aWQsCiAgICB0aW1lcgog
ICk7Cn0KCi8vID09PSBQRU9QTEVfVk9JQ0VfTkFWSUdBVElPTl9WMl9TVEFSVCA9PT0KZnVuY3Rpb24gcGVvcGxlVm9pY2VSb29tKAogIHNlcnZlcklkCikg
ewogIGNvbnN0IHNpZCA9CiAgICBTdHJpbmcoCiAgICAgIHNlcnZlcklkIHx8CiAgICAgICIiCiAgICApOwoKICByZXR1cm4gKAogICAgInBlb3BsZTp2b2lj
ZToiICsKICAgIHNpZAogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZVZvaWNlQ2hhbm5lbFJvb20oc2VydmVySWQsIGNoYW5uZWxJZCkgewogIHJldHVybiAicGVv
cGxlOnZvaWNlLWNoYW5uZWw6IiArIFN0cmluZyhzZXJ2ZXJJZCB8fCAiIikgKyAiOiIgKyBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKfQovLyA9PT0gUEVP
UExFX1ZPSUNFX05BVklHQVRJT05fVjJfRU5EID09PQoKLy8gPT09IFBFT1BMRV9NVUxUSV9WT0lDRV9WMV9TVEFSVCA9PT0KY29uc3QgUEVPUExFX01BWF9W
T0lDRV9ST09NU19QRVJfQUNDT1VOVCA9CiAgMTsKCmZ1bmN0aW9uIHBlb3BsZVZvaWNlQWNjb3VudFNlcnZlcklkcygKICBhY2NvdW50SWQsCiAgZXhjZXB0
U29ja2V0SWQgPSAiIgopIHsKICBjb25zdCB3YW50ZWRBY2NvdW50ID0KICAgIFN0cmluZygKICAgICAgYWNjb3VudElkIHx8CiAgICAgICIiCiAgICApOwoK
ICBjb25zdCBleGNsdWRlZFNvY2tldCA9CiAgICBTdHJpbmcoCiAgICAgIGV4Y2VwdFNvY2tldElkIHx8CiAgICAgICIiCiAgICApOwoKICBjb25zdCByb29t
cyA9CiAgICBuZXcgU2V0KCk7CgogIGlmICghd2FudGVkQWNjb3VudCkgewogICAgcmV0dXJuIHJvb21zOwogIH0KCiAgZm9yICgKICAgIGNvbnN0IFtzb2Nr
ZXRJZCwgdXNlcl0KICAgIG9mIHZvaWNlVXNlcnMuZW50cmllcygpCiAgKSB7CiAgICBpZiAoCiAgICAgIGV4Y2x1ZGVkU29ja2V0ICYmCiAgICAgIFN0cmlu
Zyhzb2NrZXRJZCkgPT09CiAgICAgICAgZXhjbHVkZWRTb2NrZXQKICAgICkgewogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBpZiAoCiAgICAgIFN0cmlu
ZygKICAgICAgICB1c2VyPy5hY2NvdW50SWQgfHwKICAgICAgICAiIgogICAgICApICE9PSB3YW50ZWRBY2NvdW50CiAgICApIHsKICAgICAgY29udGludWU7
CiAgICB9CgogICAgY29uc3Qgc2VydmVySWQgPQogICAgICBTdHJpbmcoCiAgICAgICAgdXNlcj8uc2VydmVySWQgfHwKICAgICAgICAiIgogICAgICApOwoK
ICAgIGlmIChzZXJ2ZXJJZCkgewogICAgICByb29tcy5hZGQoCiAgICAgICAgc2VydmVySWQKICAgICAgKTsKICAgIH0KICB9CgogIHJldHVybiByb29tczsK
fQoKLy8gPT09IFBFT1BMRV9VTklGSUVEX1ZPSUNFX0xJTUlUX1YzX1NUQVJUID09PQovLyA9PT0gUEVPUExFX1NJTkdMRV9WT0lDRV9HTE9CQUxfVjQgPT09
CmNvbnN0IFBFT1BMRV9NQVhfU0lNVUxUQU5FT1VTX1ZPSUNFUyA9CiAgMTsKCmZ1bmN0aW9uIHBlb3BsZUFjY291bnREbUNhbGxDb3VudCgKICBhY2NvdW50
SWQsCiAgewogICAgaW5jbHVkZVJpbmdpbmcgPSBmYWxzZQogIH0gPSB7fQopIHsKICBjb25zdCB3YW50ZWQgPQogICAgU3RyaW5nKAogICAgICBhY2NvdW50
SWQgfHwKICAgICAgIiIKICAgICk7CgogIGlmICghd2FudGVkKSB7CiAgICByZXR1cm4gMDsKICB9CgogIGxldCBjb3VudCA9CiAgICAwOwoKICBmb3IgKAog
ICAgY29uc3QgY2FsbCBvZgogICAgcGVvcGxlRG1DYWxscy52YWx1ZXMoKQogICkgewogICAgaWYgKAogICAgICBjYWxsLnN0YXR1cyAhPT0KICAgICAgICAi
YWN0aXZlIgogICAgKSB7CiAgICAgIGNvbnRpbnVlOwogICAgfQoKICAgIGNvbnN0IHJvbGUgPQogICAgICBwZW9wbGVEbUNhbGxSb2xlRm9yQWNjb3VudCgK
ICAgICAgICBjYWxsLAogICAgICAgIHdhbnRlZAogICAgICApOwoKICAgIGlmICghcm9sZSkgewogICAgICBjb250aW51ZTsKICAgIH0KCiAgICBpZiAoCiAg
ICAgIHBlb3BsZURtQ2FsbFNvY2tldEZvclJvbGUoCiAgICAgICAgY2FsbCwKICAgICAgICByb2xlCiAgICAgICkKICAgICkgewogICAgICBjb3VudCArPQog
ICAgICAgIDE7CiAgICB9CiAgfQoKICByZXR1cm4gY291bnQ7Cn0KCmZ1bmN0aW9uIHBlb3BsZUFjY291bnRBY3RpdmVWb2ljZUNvdW50KAogIGFjY291bnRJ
ZAopIHsKICByZXR1cm4gKAogICAgcGVvcGxlVm9pY2VBY2NvdW50U2VydmVySWRzKAogICAgICBhY2NvdW50SWQKICAgICkuc2l6ZSArCiAgICBwZW9wbGVB
Y2NvdW50RG1DYWxsQ291bnQoCiAgICAgIGFjY291bnRJZAogICAgKQogICk7Cn0KCmZ1bmN0aW9uIHBlb3BsZUFjY291bnRSZXNlcnZlZFZvaWNlQ291bnQo
CiAgYWNjb3VudElkCikgewogIC8qCiAgICBVbiBhcHBlbCBxdWkgc29ubmUgcmVzZXJ2ZSBkZWphIGwndW5pcXVlIHBsYWNlIHZvY2FsZS4KICAgIE9uIG5l
IHBldXQgZG9uYyBwYXMgcmVqb2luZHJlIHVuIHZvY2FsIHNlcnZldXIKICAgIHBlbmRhbnQgcXUndW4gYXBwZWwgTVAgZXN0IGVuIGF0dGVudGUuCiAgKi8K
ICByZXR1cm4gKAogICAgcGVvcGxlVm9pY2VBY2NvdW50U2VydmVySWRzKAogICAgICBhY2NvdW50SWQKICAgICkuc2l6ZSArCiAgICBwZW9wbGVBY2NvdW50
RG1DYWxsQ291bnQoCiAgICAgIGFjY291bnRJZCwKICAgICAgewogICAgICAgIGluY2x1ZGVSaW5naW5nOgogICAgICAgICAgdHJ1ZQogICAgICB9CiAgICAp
CiAgKTsKfQoKZnVuY3Rpb24gcGVvcGxlQWNjb3VudEhhc1ZvaWNlU2xvdCgKICBhY2NvdW50SWQKKSB7CiAgcmV0dXJuICgKICAgIHBlb3BsZUFjY291bnRS
ZXNlcnZlZFZvaWNlQ291bnQoCiAgICAgIGFjY291bnRJZAogICAgKSA8CiAgICBQRU9QTEVfTUFYX1NJTVVMVEFORU9VU19WT0lDRVMKICApOwp9Ci8vID09
PSBQRU9QTEVfVU5JRklFRF9WT0lDRV9MSU1JVF9WM19FTkQgPT09CgpmdW5jdGlvbiBwZW9wbGVWb2ljZUFjY291bnRJblNlcnZlcigKICBhY2NvdW50SWQs
CiAgc2VydmVySWQsCiAgZXhjZXB0U29ja2V0SWQgPSAiIgopIHsKICBjb25zdCB3YW50ZWRBY2NvdW50ID0KICAgIFN0cmluZygKICAgICAgYWNjb3VudElk
IHx8CiAgICAgICIiCiAgICApOwoKICBjb25zdCB3YW50ZWRTZXJ2ZXIgPQogICAgU3RyaW5nKAogICAgICBzZXJ2ZXJJZCB8fAogICAgICAiIgogICAgKTsK
CiAgY29uc3QgZXhjbHVkZWRTb2NrZXQgPQogICAgU3RyaW5nKAogICAgICBleGNlcHRTb2NrZXRJZCB8fAogICAgICAiIgogICAgKTsKCiAgaWYgKAogICAg
IXdhbnRlZEFjY291bnQgfHwKICAgICF3YW50ZWRTZXJ2ZXIKICApIHsKICAgIHJldHVybiBmYWxzZTsKICB9CgogIGZvciAoCiAgICBjb25zdCBbc29ja2V0
SWQsIHVzZXJdCiAgICBvZiB2b2ljZVVzZXJzLmVudHJpZXMoKQogICkgewogICAgaWYgKAogICAgICBleGNsdWRlZFNvY2tldCAmJgogICAgICBTdHJpbmco
c29ja2V0SWQpID09PQogICAgICAgIGV4Y2x1ZGVkU29ja2V0CiAgICApIHsKICAgICAgY29udGludWU7CiAgICB9CgogICAgaWYgKAogICAgICBTdHJpbmco
CiAgICAgICAgdXNlcj8uYWNjb3VudElkIHx8CiAgICAgICAgIiIKICAgICAgKSA9PT0gd2FudGVkQWNjb3VudCAmJgogICAgICBTdHJpbmcoCiAgICAgICAg
dXNlcj8uc2VydmVySWQgfHwKICAgICAgICAiIgogICAgICApID09PSB3YW50ZWRTZXJ2ZXIKICAgICkgewogICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KICB9
CgogIHJldHVybiBmYWxzZTsKfQoKZnVuY3Rpb24gcGVvcGxlVm9pY2VQdWJsaWNVc2VyKAogIHNvY2tldElkLAogIHVzZXIKKSB7CiAgcmV0dXJuIHsKICAg
IGlkOgogICAgICBTdHJpbmcoCiAgICAgICAgc29ja2V0SWQKICAgICAgKSwKICAgIHVzZXJuYW1lOgogICAgICB1c2VyPy51c2VybmFtZSwKICAgIGNoYW5u
ZWxJZDoKICAgICAgdXNlcj8uY2hhbm5lbElkID8gU3RyaW5nKHVzZXIuY2hhbm5lbElkKSA6IG51bGwsCiAgICBtdXRlZDoKICAgICAgQm9vbGVhbigKICAg
ICAgICB1c2VyPy5tdXRlZAogICAgICApLAogICAgY2FtZXJhOgogICAgICBCb29sZWFuKAogICAgICAgIHVzZXI/LmNhbWVyYQogICAgICApLAogICAgc2Ny
ZWVuOgogICAgICBCb29sZWFuKAogICAgICAgIHVzZXI/LnNjcmVlbgogICAgICApCiAgfTsKfQoKZnVuY3Rpb24gcGVvcGxlVm9pY2VSZWZyZXNoQWNjb3Vu
dCgKICBhY2NvdW50SWQsCiAgZXh0cmFTZXJ2ZXJJZHMgPSBbXQopIHsKICBjb25zdCByb29tcyA9CiAgICBwZW9wbGVWb2ljZUFjY291bnRTZXJ2ZXJJZHMo
CiAgICAgIGFjY291bnRJZAogICAgKTsKCiAgZm9yICgKICAgIGNvbnN0IHZhbHVlIG9mCiAgICBleHRyYVNlcnZlcklkcyB8fCBbXQogICkgewogICAgY29u
c3Qgc2lkID0KICAgICAgU3RyaW5nKAogICAgICAgIHZhbHVlIHx8CiAgICAgICAgIiIKICAgICAgKTsKCiAgICBpZiAoc2lkKSB7CiAgICAgIHJvb21zLmFk
ZCgKICAgICAgICBzaWQKICAgICAgKTsKICAgIH0KICB9CgogIGZvciAoCiAgICBjb25zdCBzaWQgb2YKICAgIHJvb21zCiAgKSB7CiAgICBlbWl0Vm9pY2VT
dGF0ZSgKICAgICAgc2lkCiAgICApOwogIH0KfQovLyA9PT0gUEVPUExFX01VTFRJX1ZPSUNFX1YxX0VORCA9PT0KCmZ1bmN0aW9uIHBlb3BsZVZvaWNlUm9z
dGVyKAogIHNlcnZlcklkCikgewogIGNvbnN0IHNpZCA9CiAgICBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwoKICByZXR1cm4gWwogICAgLi4udm9pY2VVc2Vy
cy5lbnRyaWVzKCkKICBdCiAgICAuZmlsdGVyKAogICAgICAoWywgdXNlcl0pID0+CiAgICAgICAgU3RyaW5nKHVzZXIuc2VydmVySWQpID09PQogICAgICAg
IHNpZAogICAgKQogICAgLm1hcCgKICAgICAgKFtpZCwgdXNlcl0pID0+CiAgICAgICAgcGVvcGxlVm9pY2VQdWJsaWNVc2VyKAogICAgICAgICAgaWQsCiAg
ICAgICAgICB1c2VyCiAgICAgICAgKQogICAgKTsKfQoKYXN5bmMgZnVuY3Rpb24gcGVvcGxlVm9pY2VSb3N0ZXJGb3JBY2NvdW50KHNlcnZlcklkLCBhY2Nv
dW50SWQpIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIpOwogIGNvbnN0IHVpZCA9IFN0cmluZyhhY2NvdW50SWQgfHwgIiIpOwogIGlm
ICghc2lkIHx8ICF1aWQpIHJldHVybiBbXTsKICBjb25zdCByb3N0ZXIgPSBwZW9wbGVWb2ljZVJvc3RlcihzaWQpOwogIGNvbnN0IHZpc2libGUgPSBuZXcg
TWFwKCk7CiAgY29uc3Qgb3V0cHV0ID0gW107CiAgZm9yIChjb25zdCB1c2VyIG9mIHJvc3RlcikgewogICAgY29uc3QgY2lkID0gU3RyaW5nKHVzZXI/LmNo
YW5uZWxJZCB8fCAiIik7CiAgICBpZiAoIWNpZCkgY29udGludWU7CiAgICBsZXQgYWxsb3dlZCA9IHZpc2libGUuZ2V0KGNpZCk7CiAgICBpZiAoYWxsb3dl
ZCA9PT0gdW5kZWZpbmVkKSB7CiAgICAgIGFsbG93ZWQgPSBhd2FpdCBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKHVpZCwgc2lkLCAiVklFV19DSEFOTkVM
IiwgY2lkKTsKICAgICAgdmlzaWJsZS5zZXQoY2lkLCBhbGxvd2VkKTsKICAgIH0KICAgIGlmIChhbGxvd2VkKSBvdXRwdXQucHVzaCh1c2VyKTsKICB9CiAg
cmV0dXJuIG91dHB1dDsKfQoKZnVuY3Rpb24gZW1pdFZvaWNlU3RhdGUoc2VydmVySWQpIHsKICBjb25zdCBzaWQgPSBTdHJpbmcoc2VydmVySWQgfHwgIiIp
OwogIGlmICghc2lkKSByZXR1cm47CgogIHZvaWQgKGFzeW5jICgpID0+IHsKICAgIGNvbnN0IHNvY2tldElkcyA9IG5ldyBTZXQoWwogICAgICAuLi4oaW8u
c29ja2V0cy5hZGFwdGVyLnJvb21zLmdldChwZW9wbGVTZXJ2ZXJSb29tKHNpZCkpIHx8IFtdKSwKICAgICAgLi4uKGlvLnNvY2tldHMuYWRhcHRlci5yb29t
cy5nZXQocGVvcGxlVm9pY2VSb29tKHNpZCkpIHx8IFtdKQogICAgXSk7CiAgICBjb25zdCBjYWNoZSA9IG5ldyBNYXAoKTsKICAgIGZvciAoY29uc3Qgc29j
a2V0SWQgb2Ygc29ja2V0SWRzKSB7CiAgICAgIGNvbnN0IHVpZCA9IFN0cmluZyh1c2VySWRzLmdldChzb2NrZXRJZCkgfHwgIiIpOwogICAgICBpZiAoIXVp
ZCkgY29udGludWU7CiAgICAgIGxldCByb3N0ZXIgPSBjYWNoZS5nZXQodWlkKTsKICAgICAgaWYgKCFyb3N0ZXIpIHsKICAgICAgICByb3N0ZXIgPSBhd2Fp
dCBwZW9wbGVWb2ljZVJvc3RlckZvckFjY291bnQoc2lkLCB1aWQpOwogICAgICAgIGNhY2hlLnNldCh1aWQsIHJvc3Rlcik7CiAgICAgIH0KICAgICAgaW8u
dG8oc29ja2V0SWQpLmVtaXQoInZvaWNlLXN0YXRlIiwgeyBzZXJ2ZXJJZDogc2lkLCByb3N0ZXIgfSk7CiAgICB9CiAgfSkoKS5jYXRjaCgoZXJyKSA9PiBj
b25zb2xlLmVycm9yKCJbUGVvcGxlIHZvaWNlIHBlcm1pc3Npb25zXSIsIGVycikpOwp9CgpmdW5jdGlvbiBsZWF2ZVZvaWNlKHNvY2tldCkgewogIGNvbnN0
IGN1cnJlbnQgPQogICAgdm9pY2VVc2Vycy5nZXQoCiAgICAgIHNvY2tldC5pZAogICAgKTsKCiAgaWYgKCFjdXJyZW50KSByZXR1cm47CgogIGNvbnN0IHNp
ZCA9CiAgICBTdHJpbmcoCiAgICAgIGN1cnJlbnQuc2VydmVySWQgfHwgIiIKICAgICk7CgogIGNvbnN0IGFjY291bnRJZCA9CiAgICBTdHJpbmcoCiAgICAg
IGN1cnJlbnQuYWNjb3VudElkIHx8CiAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgIHNvY2tldC5pZAogICAgICApIHx8CiAgICAgICIiCiAgICApOwoKICB2
b2ljZVVzZXJzLmRlbGV0ZSgKICAgIHNvY2tldC5pZAogICk7CgogIGlmIChzaWQpIHsKICAgIC8qCiAgICAgIExlcyBwZWVycyByZXN0ZW50IGFib25uw6lz
IMOgIHBlb3BsZVZvaWNlUm9vbShzaWQpCiAgICAgIG3Dqm1lIHMnaWxzIHNvbnQgYWN0dWVsbGVtZW50IGRhbnMgQW1pcyAvIE1QIC8gYXV0cmUgc2VydmV1
ci4KICAgICovCiAgICBzb2NrZXQudG8oCiAgICAgIHBlb3BsZVZvaWNlUm9vbSgKICAgICAgICBzaWQKICAgICAgKQogICAgKS5lbWl0KAogICAgICAicGVl
ci1sZWZ0IiwKICAgICAgc29ja2V0LmlkCiAgICApOwoKICAgIHZvaWQgc29ja2V0LmxlYXZlKAogICAgICBwZW9wbGVWb2ljZVJvb20oCiAgICAgICAgc2lk
CiAgICAgICkKICAgICk7CgogICAgaWYgKGN1cnJlbnQuY2hhbm5lbElkKSB7CiAgICAgIHZvaWQgc29ja2V0LmxlYXZlKAogICAgICAgIHBlb3BsZVZvaWNl
Q2hhbm5lbFJvb20oCiAgICAgICAgICBzaWQsCiAgICAgICAgICBjdXJyZW50LmNoYW5uZWxJZAogICAgICAgICkKICAgICAgKTsKICAgIH0KICB9CgogIGlm
IChhY2NvdW50SWQpIHsKICAgIHBlb3BsZVZvaWNlUmVmcmVzaEFjY291bnQoCiAgICAgIGFjY291bnRJZCwKICAgICAgWwogICAgICAgIHNpZAogICAgICBd
CiAgICApOwogIH0gZWxzZSBpZiAoc2lkKSB7CiAgICBlbWl0Vm9pY2VTdGF0ZSgKICAgICAgc2lkCiAgICApOwogIH0KfQoKCi8vID09PSBQRU9QTEVfT0ZG
TElORV9TRVJWRVJfU0VORF9WMV9TVEFSVCA9PT0KYXBwLnBvc3QoCiAgIi9hcGkvc2VydmVycy86c2VydmVySWQvY2hhbm5lbHMvOmNoYW5uZWxJZC9tZXNz
YWdlcyIsCiAgYXN5bmMgKHJlcSwgcmVzKSA9PiB7CiAgICB0cnkgewogICAgICBjb25zdCBzZXNzaW9uID0gcGVvcGxlU2Vzc2lvbkZvclJlcXVlc3QocmVx
LCByZXMpOwogICAgICBpZiAoIXNlc3Npb24pIHJldHVybjsKCiAgICAgIGNvbnN0IHNlcnZlcklkID0gU3RyaW5nKHJlcS5wYXJhbXMuc2VydmVySWQgfHwg
IiIpLnRyaW0oKTsKICAgICAgY29uc3QgY2hhbm5lbElkID0gU3RyaW5nKHJlcS5wYXJhbXMuY2hhbm5lbElkIHx8ICIiKS50cmltKCk7CgogICAgICBpZiAo
IXNlcnZlcklkIHx8ICFjaGFubmVsSWQpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiU2Fsb24g
aW52YWxpZGUuIiB9KTsKICAgICAgfQoKICAgICAgaWYgKCEoYXdhaXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIoc2Vzc2lvbi5pZCwgc2VydmVySWQpKSkgewog
ICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMykuanNvbih7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2VzIHBhcyBtZW1icmUgZGUgY2Ugc2VydmV1ci4i
IH0pOwogICAgICB9CgogICAgICBjb25zdCBjaGFubmVsID0gYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbChzZXJ2ZXJJZCwgY2hhbm5lbElkLCAidGV4
dCIpOwogICAgICBpZiAoIWNoYW5uZWwpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiU2Fsb24g
dGV4dHVlbCBpbnRyb3V2YWJsZS4iIH0pOwogICAgICB9CgogICAgICBpZiAoIShhd2FpdCBwZW9wbGVDYW5TZXJ2ZXJQZXJtaXNzaW9uKHNlc3Npb24uaWQs
IHNlcnZlcklkLCAiU0VORF9NRVNTQUdFUyIsIGNoYW5uZWxJZCkpKSB7CiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAzKS5qc29uKHsgb2s6IGZhbHNl
LCBlcnJvcjogIlR1IG4nYXMgcGFzIGxhIHBlcm1pc3Npb24gZCdlbnZveWVyIGRlcyBtZXNzYWdlcyBkYW5zIGNlIHNhbG9uLiIgfSk7CiAgICAgIH0KCiAg
ICAgIGNvbnN0IHRleHQgPSBTdHJpbmcocmVxLmJvZHk/LnRleHQgfHwgIiIpLnRyaW0oKS5zbGljZSgwLCAxMDAwKTsKICAgICAgY29uc3QgcmVwbHlUb0lk
ID0gcGVvcGxlUmVwbHlJZChyZXEuYm9keT8ucmVwbHlUb0lkKTsKICAgICAgY29uc3QgY2xpZW50SWQgPSBTdHJpbmcocmVxLmJvZHk/LmNsaWVudElkIHx8
ICIiKS50cmltKCkuc2xpY2UoMCwgMTIwKTsKCiAgICAgIGlmICghdGV4dCkgewogICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7IG9rOiBm
YWxzZSwgZXJyb3I6ICJNZXNzYWdlIHZpZGUuIiB9KTsKICAgICAgfQoKICAgICAgY29uc3Qgc2F2ZWQgPSBhd2FpdCBwZW9wbGVTZXJ2ZXJTYXZlTWVzc2Fn
ZSgKICAgICAgICBzZXJ2ZXJJZCwKICAgICAgICBjaGFubmVsSWQsCiAgICAgICAgc2Vzc2lvbi5pZCwKICAgICAgICBzZXNzaW9uLnVzZXJuYW1lLAogICAg
ICAgIHRleHQsCiAgICAgICAgbnVsbCwKICAgICAgICByZXBseVRvSWQKICAgICAgKTsKCiAgICAgIGlmICghc2F2ZWQpIHsKICAgICAgICByZXR1cm4gcmVz
LnN0YXR1cyg1MDApLmpzb24oeyBvazogZmFsc2UsIGVycm9yOiAiSW1wb3NzaWJsZSBkJ2VucmVnaXN0cmVyIGxlIG1lc3NhZ2UuIiB9KTsKICAgICAgfQoK
ICAgICAgY29uc3QgcGF5bG9hZCA9IGNsaWVudElkID8geyAuLi5zYXZlZCwgY2xpZW50SWQgfSA6IHNhdmVkOwogICAgICBhd2FpdCBwZW9wbGVFbWl0U2Vy
dmVyQ2hhbm5lbEV2ZW50KHNlcnZlcklkLCBjaGFubmVsSWQsICJjaGF0LW1lc3NhZ2UiLCBwYXlsb2FkKTsKCiAgICAgIHJldHVybiByZXMuanNvbih7IG9r
OiB0cnVlLCBtZXNzYWdlOiBwYXlsb2FkIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUuZXJyb3IoIltQZW9wbGUgb2ZmbGluZSBzZXJ2
ZXIgc2VuZF0iLCBlcnIpOwogICAgICBjb25zdCBlcnJvciA9IGVycj8uY29kZSA9PT0gIlJFUExZX0lOVkFMSUQiCiAgICAgICAgPyAiTGUgbWVzc2FnZSBh
dXF1ZWwgdHUgcsOpcG9uZHMgbidlc3QgcGx1cyBkaXNwb25pYmxlLiIKICAgICAgICA6ICJMZSBtZXNzYWdlIGVuIGF0dGVudGUgbidhIHBhcyBwdSDDqnRy
ZSBlbnZvecOpLiI7CiAgICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IG9rOiBmYWxzZSwgZXJyb3IgfSk7CiAgICB9CiAgfQopOwovLyA9PT0g
UEVPUExFX09GRkxJTkVfU0VSVkVSX1NFTkRfVjFfRU5EID09PQoKaW8ub24oImNvbm5lY3Rpb24iLCAoc29ja2V0KSA9PiB7CiAgc29ja2V0Lm9uKAogICAg
ImtlZXBhbGl2ZSIsCiAgICAoKSA9PiB7fQogICk7CgogIHNvY2tldC5vbigKICAgICJqb2luIiwKICAgICgpID0+IHsKICAgICAgY29uc3QgYWNjb3VudCA9
CiAgICAgICAgcGVvcGxlU2Vzc2lvbkZyb21Db29raWUoCiAgICAgICAgICBzb2NrZXQuaGFuZHNoYWtlLmhlYWRlcnMuY29va2llIHx8CiAgICAgICAgICAi
IgogICAgICAgICk7CgogICAgICBpZiAoIWFjY291bnQpIHsKICAgICAgICBzb2NrZXQuZW1pdCgKICAgICAgICAgICJhdXRoLXJlcXVpcmVkIgogICAgICAg
ICk7CgogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc3QgYWNjb3VudElkID0KICAgICAgICBTdHJpbmcoYWNjb3VudC5pZCk7CgogICAgICBj
b25zdCB3YXNBbHJlYWR5T25saW5lID0KICAgICAgICBwZW9wbGVBY2NvdW50SXNPbmxpbmUoCiAgICAgICAgICBhY2NvdW50SWQKICAgICAgICApOwoKICAg
ICAgY29uc3QgaGFkUGVuZGluZ09mZmxpbmUgPQogICAgICAgIHBlb3BsZUNhbmNlbFByZXNlbmNlT2ZmbGluZSgKICAgICAgICAgIGFjY291bnRJZAogICAg
ICAgICk7CgogICAgICB1c2Vycy5zZXQoCiAgICAgICAgc29ja2V0LmlkLAogICAgICAgIGNsZWFuVXNlcm5hbWUoCiAgICAgICAgICBhY2NvdW50LnVzZXJu
YW1lCiAgICAgICAgKQogICAgICApOwoKICAgICAgdXNlcklkcy5zZXQoCiAgICAgICAgc29ja2V0LmlkLAogICAgICAgIGFjY291bnRJZAogICAgICApOwoK
ICAgICAgcGVvcGxlRG1DYWxsRGVsaXZlclBlbmRpbmdGb3JBY2NvdW50KAogICAgICAgIFN0cmluZyhhY2NvdW50LmlkKSwKICAgICAgICBzb2NrZXQuaWQK
ICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICAhd2FzQWxyZWFkeU9ubGluZSAmJgogICAgICAgICFoYWRQZW5kaW5nT2ZmbGluZQogICAgICApIHsKICAg
ICAgICB2b2lkIHBlb3BsZVJlZnJlc2hQcmVzZW5jZUZvckFjY291bnQoCiAgICAgICAgICBhY2NvdW50SWQKICAgICAgICApOwogICAgICB9CgogICAgICBz
b2NrZXQuZW1pdCgKICAgICAgICAicGVvcGxlLXJlYWR5IiwKICAgICAgICB7CiAgICAgICAgICBvazogdHJ1ZQogICAgICAgIH0KICAgICAgKTsKICAgIH0K
ICApOwoKLy8gPT09IFBFT1BMRV9ETV9DQUxMX1NPQ0tFVF9WMV9TVEFSVCA9PT0KICBzb2NrZXQub24oCiAgICAiZG0tY2FsbC1zdGFydCIsCiAgICBhc3lu
YyAoCiAgICAgIHsgdGFyZ2V0VXNlcm5hbWUgfSA9IHt9LAogICAgICBhY2sgPSAoKSA9PiB7fQogICAgKSA9PiB7CiAgICAgIHRyeSB7CiAgICAgICAgY29u
c3QgY2FsbGVyQWNjb3VudElkID0KICAgICAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgICAgICBzb2NrZXQuaWQKICAgICAgICAgICk7CgogICAgICAgIGNv
bnN0IGNhbGxlclVzZXJuYW1lID0KICAgICAgICAgIHVzZXJzLmdldCgKICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICApOwoKICAgICAgICBpZiAo
CiAgICAgICAgICAhY2FsbGVyQWNjb3VudElkIHx8CiAgICAgICAgICAhY2FsbGVyVXNlcm5hbWUKICAgICAgICApIHsKICAgICAgICAgIHJldHVybiBhY2so
ewogICAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAgICJTZXNzaW9uIGludmFsaWRlLiIKICAgICAgICAgIH0p
OwogICAgICAgIH0KCiAgICAgICAgY29uc3QgdGFyZ2V0ID0KICAgICAgICAgIGF3YWl0IHBlb3BsZURtQ2FsbEZpbmRBY2NvdW50QnlVc2VybmFtZSgKICAg
ICAgICAgICAgdGFyZ2V0VXNlcm5hbWUKICAgICAgICAgICk7CgogICAgICAgIGlmICghdGFyZ2V0KSB7CiAgICAgICAgICByZXR1cm4gYWNrKHsKICAgICAg
ICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiVXRpbGlzYXRldXIgaW50cm91dmFibGUuIgogICAgICAgICAgfSk7
CiAgICAgICAgfQoKICAgICAgICBpZiAoCiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIHRhcmdldC5pZAogICAgICAgICAgKSA9PT0KICAgICAgICAg
IFN0cmluZygKICAgICAgICAgICAgY2FsbGVyQWNjb3VudElkCiAgICAgICAgICApCiAgICAgICAgKSB7CiAgICAgICAgICByZXR1cm4gYWNrKHsKICAgICAg
ICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiVHUgbmUgcGV1eCBwYXMgdCdhcHBlbGVyIHRvaS1tw6ptZS4iCiAg
ICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IGV4aXN0aW5nQ2FsbCA9CiAgICAgICAgICBwZW9wbGVEbUNhbGxGaW5kQmV0d2VlbigKICAg
ICAgICAgICAgY2FsbGVyQWNjb3VudElkLAogICAgICAgICAgICB0YXJnZXQuaWQKICAgICAgICAgICk7CgogICAgICAgIGlmIChleGlzdGluZ0NhbGwpIHsK
ICAgICAgICAgIGNvbnN0IHJvbGUgPQogICAgICAgICAgICBwZW9wbGVEbUNhbGxSb2xlRm9yQWNjb3VudCgKICAgICAgICAgICAgICBleGlzdGluZ0NhbGws
CiAgICAgICAgICAgICAgY2FsbGVyQWNjb3VudElkCiAgICAgICAgICAgICk7CgogICAgICAgICAgaWYgKAogICAgICAgICAgICBwZW9wbGVEbUNhbGxTb2Nr
ZXRGb3JSb2xlKAogICAgICAgICAgICAgIGV4aXN0aW5nQ2FsbCwKICAgICAgICAgICAgICByb2xlCiAgICAgICAgICAgICkKICAgICAgICAgICkgewogICAg
ICAgICAgICByZXR1cm4gYWNrKHsKICAgICAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgICAiVHUgZXMg
ZMOpasOgIGRhbnMgY2V0IGFwcGVsLiIKICAgICAgICAgICAgfSk7CiAgICAgICAgICB9CgogICAgICAgICAgY29uc3Qgam9pbmVkID0KICAgICAgICAgICAg
cGVvcGxlRG1DYWxsSm9pblBhcnRpY2lwYW50KAogICAgICAgICAgICAgIGV4aXN0aW5nQ2FsbCwKICAgICAgICAgICAgICBjYWxsZXJBY2NvdW50SWQsCiAg
ICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICAgICk7CgogICAgICAgICAgaWYgKCFqb2luZWQub2spIHsKICAgICAgICAgICAgcmV0dXJuIGFjayh7
CiAgICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICAgIHJlYXNvbjoKICAgICAgICAgICAgICAgIGpvaW5lZC5yZWFzb24sCiAgICAgICAgICAg
ICAgZXJyb3I6CiAgICAgICAgICAgICAgICBqb2luZWQucmVhc29uID09PSAibGltaXQiCiAgICAgICAgICAgICAgICAgID8gIlR1IGVzIGTDqWrDoCBkYW5z
IHVuIHZvY2FsIG91IHVuIGF1dHJlIGFwcGVsLiIKICAgICAgICAgICAgICAgICAgOiAiSW1wb3NzaWJsZSBkZSByZWpvaW5kcmUgY2V0IGFwcGVsLiIKICAg
ICAgICAgICAgfSk7CiAgICAgICAgICB9CgogICAgICAgICAgcmV0dXJuIGFjayh7CiAgICAgICAgICAgIG9rOiB0cnVlLAogICAgICAgICAgICBjYWxsSWQ6
CiAgICAgICAgICAgICAgZXhpc3RpbmdDYWxsLmlkLAogICAgICAgICAgICB0YXJnZXQ6CiAgICAgICAgICAgICAgcGVvcGxlUHVibGljQWNjb3VudCgKICAg
ICAgICAgICAgICAgIHRhcmdldAogICAgICAgICAgICAgICksCiAgICAgICAgICAgIGNyZWF0ZWQ6CiAgICAgICAgICAgICAgZmFsc2UsCiAgICAgICAgICAg
IHJlam9pbmVkOgogICAgICAgICAgICAgIHRydWUsCiAgICAgICAgICAgIHBlZXJTb2NrZXRJZDoKICAgICAgICAgICAgICBqb2luZWQucGVlclNvY2tldElk
LAogICAgICAgICAgICBwZWVyVXNlcm5hbWU6CiAgICAgICAgICAgICAgam9pbmVkLnBlZXJVc2VybmFtZSwKICAgICAgICAgICAgcGVlck11dGVkOgogICAg
ICAgICAgICAgIGpvaW5lZC5wZWVyTXV0ZWQsCiAgICAgICAgICAgIHBlZXJDYW1lcmE6CiAgICAgICAgICAgICAgam9pbmVkLnBlZXJDYW1lcmEsCiAgICAg
ICAgICAgIHBlZXJTY3JlZW46CiAgICAgICAgICAgICAgam9pbmVkLnBlZXJTY3JlZW4sCiAgICAgICAgICAgIGluaXRpYXRvcjoKICAgICAgICAgICAgICBq
b2luZWQuaW5pdGlhdG9yCiAgICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IG5vdyA9CiAgICAgICAgICBEYXRlLm5vdygpOwoKICAgICAg
ICBjb25zdCBsYXN0U3RhcnQgPQogICAgICAgICAgTnVtYmVyKAogICAgICAgICAgICBwZW9wbGVEbUNhbGxMYXN0U3RhcnQuZ2V0KAogICAgICAgICAgICAg
IFN0cmluZygKICAgICAgICAgICAgICAgIGNhbGxlckFjY291bnRJZAogICAgICAgICAgICAgICkKICAgICAgICAgICAgKSB8fCAwCiAgICAgICAgICApOwoK
ICAgICAgICBpZiAoCiAgICAgICAgICBub3cgLSBsYXN0U3RhcnQgPAogICAgICAgICAgMzAwMAogICAgICAgICkgewogICAgICAgICAgcmV0dXJuIGFjayh7
CiAgICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIkF0dGVuZHMgdW4gaW5zdGFudCBhdmFudCBkZSByYXBw
ZWxlci4iCiAgICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIHBlb3BsZURtQ2FsbExhc3RTdGFydC5zZXQoCiAgICAgICAgICBTdHJpbmcoCiAgICAg
ICAgICAgIGNhbGxlckFjY291bnRJZAogICAgICAgICAgKSwKICAgICAgICAgIG5vdwogICAgICAgICk7CgogICAgICAgIGlmICgKICAgICAgICAgICFwZW9w
bGVBY2NvdW50SGFzVm9pY2VTbG90KAogICAgICAgICAgICBjYWxsZXJBY2NvdW50SWQKICAgICAgICAgICkKICAgICAgICApIHsKICAgICAgICAgIHJldHVy
biBhY2soewogICAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICAgIGVycm9yOgogICAgICAgICAgICAgICJUdSBlcyBkw6lqw6AgZGFucyB1biB2b2Nh
bCBvdSB1biBhcHBlbC4iCiAgICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGlmICgKICAgICAgICAgIHBlb3BsZUFjY291bnRBY3RpdmVWb2ljZUNv
dW50KAogICAgICAgICAgICB0YXJnZXQuaWQKICAgICAgICAgICkgPj0KICAgICAgICAgIFBFT1BMRV9NQVhfU0lNVUxUQU5FT1VTX1ZPSUNFUwogICAgICAg
ICkgewogICAgICAgICAgcmV0dXJuIGFjayh7CiAgICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIkNldHRl
IHBlcnNvbm5lIGVzdCBkw6lqw6AgZGFucyB1biB2b2NhbCBvdSB1biBhcHBlbC4iCiAgICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IGNh
bGxJZCA9CiAgICAgICAgICBjcnlwdG9BY2NvdW50cwogICAgICAgICAgICAucmFuZG9tVVVJRCgpOwoKICAgICAgICBjb25zdCBjYWxsID0gewogICAgICAg
ICAgaWQ6CiAgICAgICAgICAgIGNhbGxJZCwKICAgICAgICAgIHN0YXR1czoKICAgICAgICAgICAgImFjdGl2ZSIsCiAgICAgICAgICBjYWxsZXJBY2NvdW50
SWQ6CiAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgICBjYWxsZXJBY2NvdW50SWQKICAgICAgICAgICAgKSwKICAgICAgICAgIGNhbGxlclNvY2tl
dElkOgogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICAgICksCiAgICAgICAgICBjYWxsZXJVc2VybmFtZToK
ICAgICAgICAgICAgY2xlYW5Vc2VybmFtZSgKICAgICAgICAgICAgICBjYWxsZXJVc2VybmFtZQogICAgICAgICAgICApLAogICAgICAgICAgY2FsbGVyTWVk
aWE6IHsKICAgICAgICAgICAgbXV0ZWQ6IGZhbHNlLAogICAgICAgICAgICBjYW1lcmE6IGZhbHNlLAogICAgICAgICAgICBzY3JlZW46IGZhbHNlCiAgICAg
ICAgICB9LAogICAgICAgICAgY2FsbGVlQWNjb3VudElkOgogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgdGFyZ2V0LmlkCiAgICAgICAgICAg
ICksCiAgICAgICAgICBjYWxsZWVTb2NrZXRJZDoKICAgICAgICAgICAgbnVsbCwKICAgICAgICAgIGNhbGxlZVVzZXJuYW1lOgogICAgICAgICAgICBjbGVh
blVzZXJuYW1lKAogICAgICAgICAgICAgIHRhcmdldC51c2VybmFtZQogICAgICAgICAgICApLAogICAgICAgICAgY2FsbGVlTWVkaWE6IHsKICAgICAgICAg
ICAgbXV0ZWQ6IGZhbHNlLAogICAgICAgICAgICBjYW1lcmE6IGZhbHNlLAogICAgICAgICAgICBzY3JlZW46IGZhbHNlCiAgICAgICAgICB9LAogICAgICAg
ICAgY3JlYXRlZEF0OgogICAgICAgICAgICBEYXRlLm5vdygpLAogICAgICAgICAgYWNjZXB0ZWRBdDoKICAgICAgICAgICAgRGF0ZS5ub3coKSwKICAgICAg
ICAgIHNvbG9TaW5jZToKICAgICAgICAgICAgRGF0ZS5ub3coKSwKICAgICAgICAgIHJpbmdBY3RpdmU6CiAgICAgICAgICAgIHRydWUKICAgICAgICB9OwoK
ICAgICAgICBwZW9wbGVEbUNhbGxzLnNldCgKICAgICAgICAgIGNhbGxJZCwKICAgICAgICAgIGNhbGwKICAgICAgICApOwoKICAgICAgICBwZW9wbGVEbUNh
bGxTYXZlVGltZWxpbmUoCiAgICAgICAgICBjYWxsLAogICAgICAgICAgInN0YXJ0ZWQiCiAgICAgICAgKTsKCiAgICAgICAgcGVvcGxlVm9pY2VSZWZyZXNo
QWNjb3VudCgKICAgICAgICAgIGNhbGxlckFjY291bnRJZAogICAgICAgICk7CgogICAgICAgIHBlb3BsZURtQ2FsbFNjaGVkdWxlU29sb1RpbWVvdXQoCiAg
ICAgICAgICBjYWxsCiAgICAgICAgKTsKCiAgICAgICAgcGVvcGxlRG1DYWxsU2NoZWR1bGVSaW5nVGltZW91dCgKICAgICAgICAgIGNhbGwKICAgICAgICAp
OwoKICAgICAgICBjb25zdCB0YXJnZXRTb2NrZXRzID0KICAgICAgICAgIHBlb3BsZURtQ2FsbEFjY291bnRTb2NrZXRJZHMoCiAgICAgICAgICAgIHRhcmdl
dC5pZAogICAgICAgICAgKTsKCiAgICAgICAgcGVvcGxlRG1DYWxsRW1pdFNvY2tldElkcygKICAgICAgICAgIHRhcmdldFNvY2tldHMsCiAgICAgICAgICAi
ZG0tY2FsbC1pbmNvbWluZyIsCiAgICAgICAgICB7CiAgICAgICAgICAgIGNhbGxJZCwKICAgICAgICAgICAgY2FsbGVyOiB7CiAgICAgICAgICAgICAgaWQ6
CiAgICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICAgIGNhbGxlckFjY291bnRJZAogICAgICAgICAgICAgICAgKSwKICAgICAgICAgICAg
ICB1c2VybmFtZToKICAgICAgICAgICAgICAgIGNhbGwuY2FsbGVyVXNlcm5hbWUKICAgICAgICAgICAgfSwKICAgICAgICAgICAgcmVqb2luOgogICAgICAg
ICAgICAgIGZhbHNlLAogICAgICAgICAgICBzaWxlbnQ6CiAgICAgICAgICAgICAgZmFsc2UKICAgICAgICAgIH0KICAgICAgICApOwoKICAgICAgICBhY2so
ewogICAgICAgICAgb2s6IHRydWUsCiAgICAgICAgICBjYWxsSWQsCiAgICAgICAgICB0YXJnZXQ6CiAgICAgICAgICAgIHBlb3BsZVB1YmxpY0FjY291bnQo
CiAgICAgICAgICAgICAgdGFyZ2V0CiAgICAgICAgICAgICksCiAgICAgICAgICBjcmVhdGVkOgogICAgICAgICAgICB0cnVlLAogICAgICAgICAgcmVqb2lu
ZWQ6CiAgICAgICAgICAgIGZhbHNlLAogICAgICAgICAgcGVlclNvY2tldElkOgogICAgICAgICAgICAiIiwKICAgICAgICAgIHBlZXJVc2VybmFtZToKICAg
ICAgICAgICAgY2FsbC5jYWxsZWVVc2VybmFtZSwKICAgICAgICAgIHBlZXJNdXRlZDoKICAgICAgICAgICAgZmFsc2UsCiAgICAgICAgICBwZWVyQ2FtZXJh
OgogICAgICAgICAgICBmYWxzZSwKICAgICAgICAgIHBlZXJTY3JlZW46CiAgICAgICAgICAgIGZhbHNlLAogICAgICAgICAgaW5pdGlhdG9yOgogICAgICAg
ICAgICBmYWxzZQogICAgICAgIH0pOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBjb25zb2xlLmVycm9yKAogICAgICAgICAgIltQZW9wbGUgZG0t
Y2FsbC9zdGFydF0iLAogICAgICAgICAgZXJyCiAgICAgICAgKTsKCiAgICAgICAgYWNrKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIGVycm9y
OgogICAgICAgICAgICAiSW1wb3NzaWJsZSBkZSBsYW5jZXIgbCdhcHBlbC4iCiAgICAgICAgfSk7CiAgICAgIH0KICAgIH0KICApOwoKICBzb2NrZXQub24o
CiAgICAiZG0tY2FsbC1hbnN3ZXIiLAogICAgKAogICAgICB7IGNhbGxJZCB9ID0ge30sCiAgICAgIGFjayA9ICgpID0+IHt9CiAgICApID0+IHsKICAgICAg
Y29uc3QgY2FsbCA9CiAgICAgICAgcGVvcGxlRG1DYWxscy5nZXQoCiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIGNhbGxJZCB8fAogICAgICAgICAg
ICAiIgogICAgICAgICAgKQogICAgICAgICk7CgogICAgICBjb25zdCBhY2NvdW50SWQgPQogICAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgICAgc29ja2V0
LmlkCiAgICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICAhY2FsbCB8fAogICAgICAgIGNhbGwuc3RhdHVzICE9PQogICAgICAgICAgImFjdGl2ZSIgfHwK
ICAgICAgICAhYWNjb3VudElkCiAgICAgICkgewogICAgICAgIHJldHVybiBhY2soewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgcmVhc29uOgog
ICAgICAgICAgICAidW5hdmFpbGFibGUiCiAgICAgICAgfSk7CiAgICAgIH0KCiAgICAgIGNvbnN0IHJvbGUgPQogICAgICAgIHBlb3BsZURtQ2FsbFJvbGVG
b3JBY2NvdW50KAogICAgICAgICAgY2FsbCwKICAgICAgICAgIGFjY291bnRJZAogICAgICAgICk7CgogICAgICBpZiAoIXJvbGUpIHsKICAgICAgICByZXR1
cm4gYWNrKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIHJlYXNvbjoKICAgICAgICAgICAgInVuYXZhaWxhYmxlIgogICAgICAgIH0pOwogICAg
ICB9CgogICAgICBjb25zdCBqb2luZWQgPQogICAgICAgIHBlb3BsZURtQ2FsbEpvaW5QYXJ0aWNpcGFudCgKICAgICAgICAgIGNhbGwsCiAgICAgICAgICBh
Y2NvdW50SWQsCiAgICAgICAgICBzb2NrZXQuaWQKICAgICAgICApOwoKICAgICAgaWYgKCFqb2luZWQub2spIHsKICAgICAgICByZXR1cm4gYWNrKHsKICAg
ICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgIHJlYXNvbjoKICAgICAgICAgICAgam9pbmVkLnJlYXNvbgogICAgICAgIH0pOwogICAgICB9CgogICAgICBj
b25zdCBvdGhlckFjY291bnRTb2NrZXRzID0KICAgICAgICBwZW9wbGVEbUNhbGxBY2NvdW50U29ja2V0SWRzKAogICAgICAgICAgYWNjb3VudElkCiAgICAg
ICAgKS5maWx0ZXIoCiAgICAgICAgICAoaWQpID0+CiAgICAgICAgICAgIFN0cmluZyhpZCkgIT09CiAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAg
ICBzb2NrZXQuaWQKICAgICAgICAgICAgKQogICAgICAgICk7CgogICAgICBwZW9wbGVEbUNhbGxFbWl0U29ja2V0SWRzKAogICAgICAgIG90aGVyQWNjb3Vu
dFNvY2tldHMsCiAgICAgICAgImRtLWNhbGwtbGVmdCIsCiAgICAgICAgewogICAgICAgICAgY2FsbElkOgogICAgICAgICAgICBjYWxsLmlkLAogICAgICAg
ICAgcmVhc29uOgogICAgICAgICAgICAiam9pbmVkLWVsc2V3aGVyZSIKICAgICAgICB9CiAgICAgICk7CgogICAgICBhY2soewogICAgICAgIG9rOiB0cnVl
LAogICAgICAgIHBlZXJTb2NrZXRJZDoKICAgICAgICAgIGpvaW5lZC5wZWVyU29ja2V0SWQsCiAgICAgICAgcGVlclVzZXJuYW1lOgogICAgICAgICAgam9p
bmVkLnBlZXJVc2VybmFtZSwKICAgICAgICBwZWVyTXV0ZWQ6CiAgICAgICAgICBqb2luZWQucGVlck11dGVkLAogICAgICAgIHBlZXJDYW1lcmE6CiAgICAg
ICAgICBqb2luZWQucGVlckNhbWVyYSwKICAgICAgICBwZWVyU2NyZWVuOgogICAgICAgICAgam9pbmVkLnBlZXJTY3JlZW4sCiAgICAgICAgaW5pdGlhdG9y
OgogICAgICAgICAgam9pbmVkLmluaXRpYXRvcgogICAgICB9KTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAiZG0tY2FsbC1kZWNsaW5lIiwKICAg
ICh7IGNhbGxJZCB9ID0ge30pID0+IHsKICAgICAgY29uc3QgY2FsbCA9CiAgICAgICAgcGVvcGxlRG1DYWxscy5nZXQoCiAgICAgICAgICBTdHJpbmcoCiAg
ICAgICAgICAgIGNhbGxJZCB8fAogICAgICAgICAgICAiIgogICAgICAgICAgKQogICAgICAgICk7CgogICAgICBjb25zdCBhY2NvdW50SWQgPQogICAgICAg
IHVzZXJJZHMuZ2V0KAogICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICAhY2FsbCB8fAogICAgICAgIGNhbGwuc3Rh
dHVzICE9PQogICAgICAgICAgImFjdGl2ZSIgfHwKICAgICAgICAhYWNjb3VudElkCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAg
Y29uc3Qgcm9sZSA9CiAgICAgICAgcGVvcGxlRG1DYWxsUm9sZUZvckFjY291bnQoCiAgICAgICAgICBjYWxsLAogICAgICAgICAgYWNjb3VudElkCiAgICAg
ICAgKTsKCiAgICAgIGlmICghcm9sZSkgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgaWYgKAogICAgICAgIHBlb3BsZURtQ2FsbFNvY2tldEZv
clJvbGUoCiAgICAgICAgICBjYWxsLAogICAgICAgICAgcm9sZQogICAgICAgICkKICAgICAgKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBp
ZiAoCiAgICAgICAgcm9sZSA9PT0gImNhbGxlZSIKICAgICAgKSB7CiAgICAgICAgcGVvcGxlRG1DYWxsU3RvcFJpbmdpbmcoCiAgICAgICAgICBjYWxsCiAg
ICAgICAgKTsKICAgICAgfQoKICAgICAgcGVvcGxlRG1DYWxsRW1pdFNvY2tldElkcygKICAgICAgICBwZW9wbGVEbUNhbGxBY2NvdW50U29ja2V0SWRzKAog
ICAgICAgICAgYWNjb3VudElkCiAgICAgICAgKSwKICAgICAgICAiZG0tY2FsbC1sZWZ0IiwKICAgICAgICB7CiAgICAgICAgICBjYWxsSWQ6CiAgICAgICAg
ICAgIGNhbGwuaWQsCiAgICAgICAgICByZWFzb246CiAgICAgICAgICAgICJkZWNsaW5lZCIKICAgICAgICB9CiAgICAgICk7CgogICAgICBjb25zdCBvdGhl
clJvbGUgPQogICAgICAgIHBlb3BsZURtQ2FsbE90aGVyUm9sZSgKICAgICAgICAgIHJvbGUKICAgICAgICApOwoKICAgICAgY29uc3Qgb3RoZXJTb2NrZXQg
PQogICAgICAgIHBlb3BsZURtQ2FsbFNvY2tldEZvclJvbGUoCiAgICAgICAgICBjYWxsLAogICAgICAgICAgb3RoZXJSb2xlCiAgICAgICAgKTsKCiAgICAg
IGlmIChvdGhlclNvY2tldCkgewogICAgICAgIGlvLnRvKAogICAgICAgICAgb3RoZXJTb2NrZXQKICAgICAgICApLmVtaXQoCiAgICAgICAgICAiZG0tY2Fs
bC1wZWVyLWRlY2xpbmVkIiwKICAgICAgICAgIHsKICAgICAgICAgICAgY2FsbElkOgogICAgICAgICAgICAgIGNhbGwuaWQKICAgICAgICAgIH0KICAgICAg
ICApOwogICAgICB9CiAgICB9CiAgKTsKCiAgc29ja2V0Lm9uKAogICAgImRtLWNhbGwtY2FuY2VsIiwKICAgICh7IGNhbGxJZCB9ID0ge30pID0+IHsKICAg
ICAgY29uc3QgY2FsbCA9CiAgICAgICAgcGVvcGxlRG1DYWxscy5nZXQoCiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIGNhbGxJZCB8fAogICAgICAg
ICAgICAiIgogICAgICAgICAgKQogICAgICAgICk7CgogICAgICBpZiAoIWNhbGwpIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIHBlb3BsZURt
Q2FsbExlYXZlU29ja2V0KAogICAgICAgIGNhbGwsCiAgICAgICAgc29ja2V0LmlkLAogICAgICAgICJsZWZ0IgogICAgICApOwogICAgfQogICk7CgogIHNv
Y2tldC5vbigKICAgICJkbS1jYWxsLWhhbmd1cCIsCiAgICAoeyBjYWxsSWQgfSA9IHt9KSA9PiB7CiAgICAgIGNvbnN0IGNhbGwgPQogICAgICAgIHBlb3Bs
ZURtQ2FsbHMuZ2V0KAogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBjYWxsSWQgfHwKICAgICAgICAgICAgIiIKICAgICAgICAgICkKICAgICAgICAp
OwoKICAgICAgaWYgKCFjYWxsKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBwZW9wbGVEbUNhbGxMZWF2ZVNvY2tldCgKICAgICAgICBjYWxs
LAogICAgICAgIHNvY2tldC5pZCwKICAgICAgICAibGVmdCIKICAgICAgKTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAiZG0tY2FsbC13ZWJydGMt
b2ZmZXIiLAogICAgKHsKICAgICAgY2FsbElkLAogICAgICB0YXJnZXQsCiAgICAgIHNkcAogICAgfSA9IHt9KSA9PiB7CiAgICAgIGNvbnN0IGNhbGwgPQog
ICAgICAgIHBlb3BsZURtQ2FsbEZvckFjdGl2ZVNvY2tldCgKICAgICAgICAgIGNhbGxJZCwKICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICk7CgogICAg
ICBpZiAoCiAgICAgICAgIWNhbGwgfHwKICAgICAgICAhc2RwCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc3Qgb3RoZXIg
PQogICAgICAgIHBlb3BsZURtQ2FsbE90aGVyU29ja2V0KAogICAgICAgICAgY2FsbCwKICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICk7CgogICAgICBp
ZiAoCiAgICAgICAgIW90aGVyIHx8CiAgICAgICAgU3RyaW5nKHRhcmdldCkgIT09CiAgICAgICAgICBvdGhlcgogICAgICApIHsKICAgICAgICByZXR1cm47
CiAgICAgIH0KCiAgICAgIGlvLnRvKAogICAgICAgIG90aGVyCiAgICAgICkuZW1pdCgKICAgICAgICAiZG0tY2FsbC13ZWJydGMtb2ZmZXIiLAogICAgICAg
IHsKICAgICAgICAgIGNhbGxJZDoKICAgICAgICAgICAgY2FsbC5pZCwKICAgICAgICAgIGZyb206CiAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAg
ICBzb2NrZXQuaWQKICAgICAgICAgICAgKSwKICAgICAgICAgIHNkcAogICAgICAgIH0KICAgICAgKTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAi
ZG0tY2FsbC13ZWJydGMtYW5zd2VyIiwKICAgICh7CiAgICAgIGNhbGxJZCwKICAgICAgdGFyZ2V0LAogICAgICBzZHAKICAgIH0gPSB7fSkgPT4gewogICAg
ICBjb25zdCBjYWxsID0KICAgICAgICBwZW9wbGVEbUNhbGxGb3JBY3RpdmVTb2NrZXQoCiAgICAgICAgICBjYWxsSWQsCiAgICAgICAgICBzb2NrZXQuaWQK
ICAgICAgICApOwoKICAgICAgaWYgKAogICAgICAgICFjYWxsIHx8CiAgICAgICAgIXNkcAogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAg
ICAgIGNvbnN0IG90aGVyID0KICAgICAgICBwZW9wbGVEbUNhbGxPdGhlclNvY2tldCgKICAgICAgICAgIGNhbGwsCiAgICAgICAgICBzb2NrZXQuaWQKICAg
ICAgICApOwoKICAgICAgaWYgKAogICAgICAgICFvdGhlciB8fAogICAgICAgIFN0cmluZyh0YXJnZXQpICE9PQogICAgICAgICAgb3RoZXIKICAgICAgKSB7
CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpby50bygKICAgICAgICBvdGhlcgogICAgICApLmVtaXQoCiAgICAgICAgImRtLWNhbGwtd2VicnRj
LWFuc3dlciIsCiAgICAgICAgewogICAgICAgICAgY2FsbElkOgogICAgICAgICAgICBjYWxsLmlkLAogICAgICAgICAgZnJvbToKICAgICAgICAgICAgU3Ry
aW5nKAogICAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgICApLAogICAgICAgICAgc2RwCiAgICAgICAgfQogICAgICApOwogICAgfQogICk7Cgog
IHNvY2tldC5vbigKICAgICJkbS1jYWxsLXdlYnJ0Yy1pY2UiLAogICAgKHsKICAgICAgY2FsbElkLAogICAgICB0YXJnZXQsCiAgICAgIGNhbmRpZGF0ZQog
ICAgfSA9IHt9KSA9PiB7CiAgICAgIGNvbnN0IGNhbGwgPQogICAgICAgIHBlb3BsZURtQ2FsbEZvckFjdGl2ZVNvY2tldCgKICAgICAgICAgIGNhbGxJZCwK
ICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIWNhbGwgfHwKICAgICAgICAhY2FuZGlkYXRlCiAgICAgICkgewog
ICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc3Qgb3RoZXIgPQogICAgICAgIHBlb3BsZURtQ2FsbE90aGVyU29ja2V0KAogICAgICAgICAgY2Fs
bCwKICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIW90aGVyIHx8CiAgICAgICAgU3RyaW5nKHRhcmdldCkgIT09
CiAgICAgICAgICBvdGhlcgogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlvLnRvKAogICAgICAgIG90aGVyCiAgICAgICkuZW1p
dCgKICAgICAgICAiZG0tY2FsbC13ZWJydGMtaWNlIiwKICAgICAgICB7CiAgICAgICAgICBjYWxsSWQ6CiAgICAgICAgICAgIGNhbGwuaWQsCiAgICAgICAg
ICBmcm9tOgogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICAgICksCiAgICAgICAgICBjYW5kaWRhdGUKICAg
ICAgICB9CiAgICAgICk7CiAgICB9CiAgKTsKCiAgc29ja2V0Lm9uKAogICAgImRtLWNhbGwtbWVkaWEtc3RhdGUiLAogICAgKHsKICAgICAgY2FsbElkLAog
ICAgICBtdXRlZCwKICAgICAgY2FtZXJhLAogICAgICBzY3JlZW4KICAgIH0gPSB7fSkgPT4gewogICAgICBjb25zdCBjYWxsID0KICAgICAgICBwZW9wbGVE
bUNhbGxGb3JBY3RpdmVTb2NrZXQoCiAgICAgICAgICBjYWxsSWQsCiAgICAgICAgICBzb2NrZXQuaWQKICAgICAgICApOwoKICAgICAgaWYgKCFjYWxsKSB7
CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBjb25zdCBjdXJyZW50ID0KICAgICAgICBTdHJpbmcoCiAgICAgICAgICBzb2NrZXQuaWQKICAgICAg
ICApOwoKICAgICAgY29uc3Qgcm9sZSA9CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgY2FsbC5jYWxsZXJTb2NrZXRJZCB8fAogICAgICAgICAgIiIKICAg
ICAgICApID09PSBjdXJyZW50CiAgICAgICAgICA/ICJjYWxsZXIiCiAgICAgICAgICA6ICJjYWxsZWUiOwoKICAgICAgcGVvcGxlRG1DYWxsU2V0TWVkaWFG
b3JSb2xlKAogICAgICAgIGNhbGwsCiAgICAgICAgcm9sZSwKICAgICAgICB7CiAgICAgICAgICBtdXRlZCwKICAgICAgICAgIGNhbWVyYSwKICAgICAgICAg
IHNjcmVlbgogICAgICAgIH0KICAgICAgKTsKCiAgICAgIHBlb3BsZURtQ2FsbHMuc2V0KAogICAgICAgIGNhbGwuaWQsCiAgICAgICAgY2FsbAogICAgICAp
OwoKICAgICAgY29uc3Qgb3RoZXIgPQogICAgICAgIHBlb3BsZURtQ2FsbE90aGVyU29ja2V0KAogICAgICAgICAgY2FsbCwKICAgICAgICAgIHNvY2tldC5p
ZAogICAgICAgICk7CgogICAgICBpZiAoIW90aGVyKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpby50bygKICAgICAgICBvdGhlcgogICAg
ICApLmVtaXQoCiAgICAgICAgImRtLWNhbGwtbWVkaWEtc3RhdGUiLAogICAgICAgIHsKICAgICAgICAgIGNhbGxJZDoKICAgICAgICAgICAgY2FsbC5pZCwK
ICAgICAgICAgIG11dGVkOgogICAgICAgICAgICBCb29sZWFuKAogICAgICAgICAgICAgIG11dGVkCiAgICAgICAgICAgICksCiAgICAgICAgICBjYW1lcmE6
CiAgICAgICAgICAgIEJvb2xlYW4oCiAgICAgICAgICAgICAgY2FtZXJhCiAgICAgICAgICAgICksCiAgICAgICAgICBzY3JlZW46CiAgICAgICAgICAgIEJv
b2xlYW4oCiAgICAgICAgICAgICAgc2NyZWVuCiAgICAgICAgICAgICkKICAgICAgICB9CiAgICAgICk7CiAgICB9CiAgKTsKICAvLyA9PT0gUEVPUExFX0RN
X0NBTExfU09DS0VUX1YxX0VORCA9PT0KCiAgc29ja2V0Lm9uKAogICAgInNlcnZlci1zZWxlY3QiLAogICAgYXN5bmMgKAogICAgICB7IHNlcnZlcklkLCBj
aGFubmVsSWQgfSA9IHt9LAogICAgICBhY2sgPSAoKSA9PiB7fQogICAgKSA9PiB7CiAgICAgIHRyeSB7CiAgICAgICAgY29uc3QgYWNjb3VudElkID0KICAg
ICAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgICAgICBzb2NrZXQuaWQKICAgICAgICAgICk7CgogICAgICAgIGlmICghYWNjb3VudElkKSB7CiAgICAgICAg
ICByZXR1cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiU2Vzc2lvbiBpbnZhbGlkZS4i
CiAgICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IHNlcnZlciA9CiAgICAgICAgICBhd2FpdCBwZW9wbGVHZXRTZXJ2ZXIoCiAgICAgICAg
ICAgIHNlcnZlcklkCiAgICAgICAgICApOwoKICAgICAgICBpZiAoIXNlcnZlcikgewogICAgICAgICAgcmV0dXJuIGFjayh7CiAgICAgICAgICAgIG9rOiBm
YWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIlNlcnZldXIgaW50cm91dmFibGUuIgogICAgICAgICAgfSk7CiAgICAgICAgfQoKICAg
ICAgICBjb25zdCBtZW1iZXIgPQogICAgICAgICAgYXdhaXQgcGVvcGxlSXNTZXJ2ZXJNZW1iZXIoCiAgICAgICAgICAgIGFjY291bnRJZCwKICAgICAgICAg
ICAgc2VydmVyLmlkCiAgICAgICAgICApOwoKICAgICAgICBpZiAoIW1lbWJlcikgewogICAgICAgICAgcmV0dXJuIGFjayh7CiAgICAgICAgICAgIG9rOiBm
YWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIlR1IG4nZXMgcGFzIG1lbWJyZSBkZSBjZSBzZXJ2ZXVyLiIKICAgICAgICAgIH0pOwog
ICAgICAgIH0KCiAgICAgICAgY29uc3Qgb2xkU2VydmVySWQgPQogICAgICAgICAgc29ja2V0U2VydmVySWRzLmdldCgKICAgICAgICAgICAgc29ja2V0Lmlk
CiAgICAgICAgICApOwoKICAgICAgICBpZiAoCiAgICAgICAgICBvbGRTZXJ2ZXJJZCAmJgogICAgICAgICAgU3RyaW5nKG9sZFNlcnZlcklkKSAhPT0KICAg
ICAgICAgICAgU3RyaW5nKHNlcnZlci5pZCkKICAgICAgICApIHsKICAgICAgICAgIC8qCiAgICAgICAgICAgIExlIHNlcnZldXIgY29uc3VsdMOpIGNoYW5n
ZSwgbWFpcyBsZSB2b2NhbAogICAgICAgICAgICBkZSBjZXQgb25nbGV0IHJlc3RlIHRvdGFsZW1lbnQgaW5kw6lwZW5kYW50LgogICAgICAgICAgKi8KICAg
ICAgICAgIGF3YWl0IHNvY2tldC5sZWF2ZSgKICAgICAgICAgICAgcGVvcGxlU2VydmVyUm9vbSgKICAgICAgICAgICAgICBvbGRTZXJ2ZXJJZAogICAgICAg
ICAgICApCiAgICAgICAgICApOwoKICAgICAgICAgIHNvY2tldFNlcnZlcklkcy5kZWxldGUoCiAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgKTsK
ICAgICAgICAgIHNvY2tldFRleHRDaGFubmVsSWRzLmRlbGV0ZSgKICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICApOwoKICAgICAgICAgIGVtaXRP
bmxpbmVVc2VycygKICAgICAgICAgICAgb2xkU2VydmVySWQKICAgICAgICAgICk7CiAgICAgICAgfQoKICAgICAgICBzb2NrZXRTZXJ2ZXJJZHMuc2V0KAog
ICAgICAgICAgc29ja2V0LmlkLAogICAgICAgICAgU3RyaW5nKHNlcnZlci5pZCkKICAgICAgICApOwoKICAgICAgICBhd2FpdCBzb2NrZXQuam9pbigKICAg
ICAgICAgIHBlb3BsZVNlcnZlclJvb20oCiAgICAgICAgICAgIHNlcnZlci5pZAogICAgICAgICAgKQogICAgICAgICk7CgogICAgICAgIGNvbnN0IFtjaGFu
bmVscywgcGVybWlzc2lvbnNdID0gYXdhaXQgUHJvbWlzZS5hbGwoWwogICAgICAgICAgcGVvcGxlTGlzdFZpc2libGVTZXJ2ZXJDaGFubmVscyhhY2NvdW50
SWQsIHNlcnZlci5pZCksCiAgICAgICAgICBwZW9wbGVQZXJtaXNzaW9uU25hcHNob3QoYWNjb3VudElkLCBzZXJ2ZXIuaWQpCiAgICAgICAgXSk7CiAgICAg
ICAgY29uc3QgcmVxdWVzdGVkVGV4dCA9IGNoYW5uZWxJZAogICAgICAgICAgPyBjaGFubmVscy5maW5kKChpdGVtKSA9PiBTdHJpbmcoaXRlbS5pZCkgPT09
IFN0cmluZyhjaGFubmVsSWQpICYmIGl0ZW0udHlwZSA9PT0gInRleHQiKQogICAgICAgICAgOiBudWxsOwogICAgICAgIGNvbnN0IGFjdGl2ZVRleHRDaGFu
bmVsID0gcmVxdWVzdGVkVGV4dCB8fCBjaGFubmVscy5maW5kKChpdGVtKSA9PiBpdGVtLnR5cGUgPT09ICJ0ZXh0IikgfHwgbnVsbDsKCiAgICAgICAgaWYg
KCFhY3RpdmVUZXh0Q2hhbm5lbCkgewogICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIGFjY8OocyDDoCBhdWN1biBz
YWxvbiB0ZXh0dWVsIGRlIGNlIHNlcnZldXIuIiB9KTsKICAgICAgICB9CgogICAgICAgIHNvY2tldFRleHRDaGFubmVsSWRzLnNldChzb2NrZXQuaWQsIFN0
cmluZyhhY3RpdmVUZXh0Q2hhbm5lbC5pZCkpOwoKICAgICAgICAvLyA9PT0gUEVPUExFX05BVklHQVRJT05fUEFSQUxMRUxfVjFfU0VSVkVSID09PQogICAg
ICAgIC8vIEhpc3RvcmlxdWUgZXQgcHLDqXNlbmNlIG5lIGTDqXBlbmRlbnQgcGFzIGwndW4gZGUgbCdhdXRyZS4KICAgICAgICBjb25zdCBbaGlzdG9yeSwg
b25saW5lXSA9CiAgICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChbCiAgICAgICAgICAgIHBlb3BsZVNlcnZlckxvYWRNZXNzYWdlcygKICAgICAgICAgICAg
ICBzZXJ2ZXIuaWQsCiAgICAgICAgICAgICAgYWN0aXZlVGV4dENoYW5uZWwuaWQsCiAgICAgICAgICAgICAgMTAwCiAgICAgICAgICAgICksCiAgICAgICAg
ICAgIHBlb3BsZVNlcnZlclByZXNlbmNlUm9zdGVyKAogICAgICAgICAgICAgIHNlcnZlci5pZAogICAgICAgICAgICApCiAgICAgICAgICBdKTsKCiAgICAg
ICAgY29uc3Qgdm9pY2UgPQogICAgICAgICAgYXdhaXQgcGVvcGxlVm9pY2VSb3N0ZXJGb3JBY2NvdW50KAogICAgICAgICAgICBzZXJ2ZXIuaWQsCiAgICAg
ICAgICAgIGFjY291bnRJZAogICAgICAgICAgKTsKCiAgICAgICAgZW1pdE9ubGluZVVzZXJzKAogICAgICAgICAgc2VydmVyLmlkLAogICAgICAgICAgb25s
aW5lCiAgICAgICAgKTsKCiAgICAgICAgYWNrKHsKICAgICAgICAgIG9rOiB0cnVlLAogICAgICAgICAgc2VydmVyOgogICAgICAgICAgICBwZW9wbGVTZXJ2
ZXJQdWJsaWMoCiAgICAgICAgICAgICAgc2VydmVyCiAgICAgICAgICAgICksCiAgICAgICAgICBoaXN0b3J5LAogICAgICAgICAgb25saW5lLAogICAgICAg
ICAgdm9pY2UsCiAgICAgICAgICBjaGFubmVscywKICAgICAgICAgIHBlcm1pc3Npb25zLAogICAgICAgICAgYWN0aXZlQ2hhbm5lbElkOiBTdHJpbmcoYWN0
aXZlVGV4dENoYW5uZWwuaWQpCiAgICAgICAgfSk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgICAiW1Bl
b3BsZSBzZXJ2ZXIvc2VsZWN0XSIsCiAgICAgICAgICBlcnIKICAgICAgICApOwoKICAgICAgICBhY2soewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAg
ICAgZXJyb3I6CiAgICAgICAgICAgICJJbXBvc3NpYmxlIGQnb3V2cmlyIGNlIHNlcnZldXIuIgogICAgICAgIH0pOwogICAgICB9CiAgICB9CiAgKTsKCgog
IHNvY2tldC5vbigKICAgICJzZXJ2ZXItY2hhbm5lbC1zZWxlY3QiLAogICAgYXN5bmMgKHsgc2VydmVySWQsIGNoYW5uZWxJZCB9ID0ge30sIGFjayA9ICgp
ID0+IHt9KSA9PiB7CiAgICAgIHRyeSB7CiAgICAgICAgY29uc3QgYWNjb3VudElkID0gdXNlcklkcy5nZXQoc29ja2V0LmlkKTsKICAgICAgICBjb25zdCBz
aWQgPSBTdHJpbmcoc2VydmVySWQgfHwgc29ja2V0U2VydmVySWRzLmdldChzb2NrZXQuaWQpIHx8ICIiKTsKICAgICAgICBpZiAoIWFjY291bnRJZCB8fCAh
c2lkKSByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBlcnJvcjogIlNlc3Npb24gaW52YWxpZGUuIiB9KTsKICAgICAgICBpZiAoIShhd2FpdCBwZW9wbGVJc1Nl
cnZlck1lbWJlcihhY2NvdW50SWQsIHNpZCkpKSByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBlcnJvcjogIlR1IG4nZXMgcGFzIG1lbWJyZSBkZSBjZSBzZXJ2
ZXVyLiIgfSk7CiAgICAgICAgY29uc3QgY2hhbm5lbCA9IGF3YWl0IHBlb3BsZUdldFNlcnZlckNoYW5uZWwoc2lkLCBjaGFubmVsSWQsICJ0ZXh0Iik7CiAg
ICAgICAgaWYgKCFjaGFubmVsKSByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBlcnJvcjogIlNhbG9uIHRleHR1ZWwgaW50cm91dmFibGUuIiB9KTsKICAgICAg
ICBjb25zdCBjaGFubmVsTWFzayA9IGF3YWl0IHBlb3BsZVNlcnZlckVmZmVjdGl2ZVBlcm1pc3Npb25NYXNrKGFjY291bnRJZCwgc2lkLCBjaGFubmVsLmlk
KTsKICAgICAgICBpZiAoIXBlb3BsZVBlcm1pc3Npb25IYXMoY2hhbm5lbE1hc2ssICJWSUVXX0NIQU5ORUwiKSkgewogICAgICAgICAgcmV0dXJuIGFjayh7
IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBhY2PDqHMgw6AgY2Ugc2Fsb24uIiB9KTsKICAgICAgICB9CiAgICAgICAgc29ja2V0U2VydmVySWRz
LnNldChzb2NrZXQuaWQsIHNpZCk7CiAgICAgICAgc29ja2V0VGV4dENoYW5uZWxJZHMuc2V0KHNvY2tldC5pZCwgU3RyaW5nKGNoYW5uZWwuaWQpKTsKICAg
ICAgICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgcGVvcGxlU2VydmVyTG9hZE1lc3NhZ2VzKHNpZCwgY2hhbm5lbC5pZCwgMTAwKTsKICAgICAgICBhY2soewog
ICAgICAgICAgb2s6IHRydWUsCiAgICAgICAgICBzZXJ2ZXJJZDogc2lkLAogICAgICAgICAgY2hhbm5lbDogeyAuLi5jaGFubmVsLCBwZXJtaXNzaW9uczog
cGVvcGxlUGVybWlzc2lvbk5hbWVzKGNoYW5uZWxNYXNrKSwgcGVybWlzc2lvbk1hc2s6IGNoYW5uZWxNYXNrIH0sCiAgICAgICAgICBhY3RpdmVDaGFubmVs
SWQ6IFN0cmluZyhjaGFubmVsLmlkKSwKICAgICAgICAgIGhpc3RvcnkKICAgICAgICB9KTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgY29uc29s
ZS5lcnJvcigiW1Blb3BsZSBjaGFubmVsL3NlbGVjdF0iLCBlcnIpOwogICAgICAgIGFjayh7IG9rOiBmYWxzZSwgZXJyb3I6ICJJbXBvc3NpYmxlIGQnb3V2
cmlyIGNlIHNhbG9uLiIgfSk7CiAgICAgIH0KICAgIH0KICApOwoKICAvLyA9PT0gUEVPUExFX0dFTkVSQUxfT1BUSU1JU1RJQ19TRVJWRVJfVjFfU1RBUlQg
PT09CiAgc29ja2V0Lm9uKAogICAgImNoYXQtbWVzc2FnZSIsCiAgICBhc3luYyAoCiAgICAgIHsKICAgICAgICB0ZXh0LAogICAgICAgIGltYWdlSWQsCiAg
ICAgICAgcmVwbHlUb0lkLAogICAgICAgIGNsaWVudElkCiAgICAgIH0gPSB7fSwKICAgICAgYWNrID0gKCkgPT4ge30KICAgICkgPT4gewogICAgICBjb25z
dCByZXBseSA9CiAgICAgICAgdHlwZW9mIGFjayA9PT0gImZ1bmN0aW9uIgogICAgICAgICAgPyBhY2sKICAgICAgICAgIDogKCkgPT4ge307CgogICAgICBj
b25zdCB1c2VybmFtZSA9CiAgICAgICAgdXNlcnMuZ2V0KHNvY2tldC5pZCk7CgogICAgICBjb25zdCBzZW5kZXJJZCA9CiAgICAgICAgdXNlcklkcy5nZXQo
c29ja2V0LmlkKTsKCiAgICAgIGNvbnN0IHNlcnZlcklkID0KICAgICAgICBzb2NrZXRTZXJ2ZXJJZHMuZ2V0KHNvY2tldC5pZCk7CgogICAgICBjb25zdCBj
aGFubmVsSWQgPQogICAgICAgIHNvY2tldFRleHRDaGFubmVsSWRzLmdldChzb2NrZXQuaWQpOwoKICAgICAgaWYgKCF1c2VybmFtZSB8fCAhc2VuZGVySWQg
fHwgIXNlcnZlcklkIHx8ICFjaGFubmVsSWQpIHsKICAgICAgICByZXBseSh7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjogIlNlc3Np
b24gb3Ugc2VydmV1ciBpbnZhbGlkZS4iCiAgICAgICAgfSk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBjb25zdCBjbGVhblRleHQgPQogICAg
ICAgIFN0cmluZyh0ZXh0IHx8ICIiKQogICAgICAgICAgLnRyaW0oKQogICAgICAgICAgLnNsaWNlKDAsIDEwMDApOwoKICAgICAgY29uc3QgaW1hZ2VLZXkg
PQogICAgICAgIHBlb3BsZU5vcm1hbGl6ZU1lc3NhZ2VJbWFnZUlkKGltYWdlSWQpOwoKICAgICAgaWYgKCFjbGVhblRleHQgJiYgIWltYWdlS2V5KSB7CiAg
ICAgICAgcmVwbHkoewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6ICJNZXNzYWdlIHZpZGUuIgogICAgICAgIH0pOwogICAgICAgIHJl
dHVybjsKICAgICAgfQoKICAgICAgaWYgKCEoYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbihzZW5kZXJJZCwgc2VydmVySWQsICJTRU5EX01FU1NB
R0VTIiwgY2hhbm5lbElkKSkpIHsKICAgICAgICByZXBseSh7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGQnZW52b3ll
ciBkZXMgbWVzc2FnZXMgZGFucyBjZSBzYWxvbi4iIH0pOwogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgaWYgKGltYWdlS2V5ICYmICEoYXdhaXQg
cGVvcGxlQ2FuU2VydmVyUGVybWlzc2lvbihzZW5kZXJJZCwgc2VydmVySWQsICJBVFRBQ0hfRklMRVMiLCBjaGFubmVsSWQpKSkgewogICAgICAgIHJlcGx5
KHsgb2s6IGZhbHNlLCBlcnJvcjogIlR1IG4nYXMgcGFzIGxhIHBlcm1pc3Npb24gZGUgam9pbmRyZSBkZXMgZmljaGllcnMgZGFucyBjZSBzYWxvbi4iIH0p
OwogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgLy8gSWRlbnRpZmlhbnQgcHVyZW1lbnQgY2xpZW50IDogaWwgc2VydCB1bmlxdWVtZW50IMOgIHJl
bXBsYWNlciBsZQogICAgICAvLyBtZXNzYWdlIG9wdGltaXN0ZSBsb2NhbCBwYXIgbGEgdmVyc2lvbiBwZXJzaXN0w6llIGR1IHNlcnZldXIuCiAgICAgIGNv
bnN0IGNsZWFuQ2xpZW50SWQgPQogICAgICAgIFN0cmluZyhjbGllbnRJZCB8fCAiIikKICAgICAgICAgIC50cmltKCkKICAgICAgICAgIC5zbGljZSgwLCAx
MjApOwoKICAgICAgdHJ5IHsKICAgICAgICBjb25zdCBzYXZlZCA9CiAgICAgICAgICBhd2FpdCBwZW9wbGVTZXJ2ZXJTYXZlTWVzc2FnZSgKICAgICAgICAg
ICAgc2VydmVySWQsCiAgICAgICAgICAgIGNoYW5uZWxJZCwKICAgICAgICAgICAgc2VuZGVySWQsCiAgICAgICAgICAgIHVzZXJuYW1lLAogICAgICAgICAg
ICBjbGVhblRleHQsCiAgICAgICAgICAgIGltYWdlS2V5LAogICAgICAgICAgICByZXBseVRvSWQKICAgICAgICAgICk7CgogICAgICAgIGlmICghc2F2ZWQp
IHsKICAgICAgICAgIHJlcGx5KHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjogIkltcG9zc2libGUgZCdlbnJlZ2lzdHJlciBs
ZSBtZXNzYWdlLiIKICAgICAgICAgIH0pOwogICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KCiAgICAgICAgY29uc3QgcGF5bG9hZCA9CiAgICAgICAgICBj
bGVhbkNsaWVudElkCiAgICAgICAgICAgID8geyAuLi5zYXZlZCwgY2xpZW50SWQ6IGNsZWFuQ2xpZW50SWQgfQogICAgICAgICAgICA6IHNhdmVkOwoKICAg
ICAgICBhd2FpdCBwZW9wbGVFbWl0U2VydmVyQ2hhbm5lbEV2ZW50KAogICAgICAgICAgc2VydmVySWQsCiAgICAgICAgICBjaGFubmVsSWQsCiAgICAgICAg
ICAiY2hhdC1tZXNzYWdlIiwKICAgICAgICAgIHBheWxvYWQKICAgICAgICApOwoKICAgICAgICByZXBseSh7CiAgICAgICAgICBvazogdHJ1ZSwKICAgICAg
ICAgIG1lc3NhZ2U6IHBheWxvYWQKICAgICAgICB9KTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgY29uc29sZS5lcnJvcigKICAgICAgICAgICJb
UGVvcGxlIHNlcnZlciBtZXNzYWdlL3NhdmVdIiwKICAgICAgICAgIGVycgogICAgICAgICk7CgogICAgICAgIGNvbnN0IGVycm9yVGV4dCA9CiAgICAgICAg
ICBlcnI/LmNvZGUgPT09ICJJTUFHRV9JTlZBTElEIgogICAgICAgICAgICA/ICJDZXR0ZSBpbWFnZSBuJ2VzdCBwbHVzIGRpc3BvbmlibGUuIFLDqWVzc2Fp
ZSBkZSBsYSBzw6lsZWN0aW9ubmVyLiIKICAgICAgICAgICAgOiBlcnI/LmNvZGUgPT09ICJSRVBMWV9JTlZBTElEIgogICAgICAgICAgICAgID8gIkxlIG1l
c3NhZ2UgYXVxdWVsIHR1IHLDqXBvbmRzIG4nZXN0IHBsdXMgZGlzcG9uaWJsZS4iCiAgICAgICAgICAgICAgOiAiTGUgbWVzc2FnZSBuJ2EgcGFzIHB1IMOq
dHJlIHNhdXZlZ2FyZMOpLiI7CgogICAgICAgIC8vIENvbXBvcnRlbWVudCBoaXN0b3JpcXVlIGNvbnNlcnbDqSBwb3VyIHRvdXMgbGVzIGFuY2llbnMgY2xp
ZW50cy4KICAgICAgICBzb2NrZXQuZW1pdCgKICAgICAgICAgICJzeXN0ZW0tbWVzc2FnZSIsCiAgICAgICAgICB7CiAgICAgICAgICAgIHRleHQ6IGVycm9y
VGV4dCwKICAgICAgICAgICAgdGltZTogRGF0ZS5ub3coKQogICAgICAgICAgfQogICAgICAgICk7CgogICAgICAgIC8vIExlcyBjbGllbnRzIHLDqWNlbnRz
IHBldXZlbnQgZW4gcGx1cyByZXRpcmVyIGxldXIgYnVsbGUgb3B0aW1pc3RlLgogICAgICAgIHJlcGx5KHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAg
ICAgIGVycm9yOiBlcnJvclRleHQKICAgICAgICB9KTsKICAgICAgfQogICAgfQogICk7CiAgLy8gPT09IFBFT1BMRV9HRU5FUkFMX09QVElNSVNUSUNfU0VS
VkVSX1YxX0VORCA9PT0KCiAgLy8gPT09IFBFT1BMRV9TRVJWRVJfTUVTU0FHRV9FRElUX1NPQ0tFVF9WNl9TVEFSVCA9PT0KICBzb2NrZXQub24oCiAgICAi
Y2hhdC1tZXNzYWdlLWVkaXQiLAogICAgYXN5bmMgKAogICAgICB7IGlkLCB0ZXh0IH0gPSB7fSwKICAgICAgYWNrID0gKCkgPT4ge30KICAgICkgPT4gewog
ICAgICB0cnkgewogICAgICAgIGNvbnN0IHNlbmRlcklkID0KICAgICAgICAgIHVzZXJJZHMuZ2V0KHNvY2tldC5pZCk7CgogICAgICAgIGNvbnN0IHNlcnZl
cklkID0KICAgICAgICAgIHNvY2tldFNlcnZlcklkcy5nZXQoc29ja2V0LmlkKTsKCiAgICAgICAgY29uc3QgY2hhbm5lbElkID0KICAgICAgICAgIHNvY2tl
dFRleHRDaGFubmVsSWRzLmdldChzb2NrZXQuaWQpOwoKICAgICAgICBpZiAoIXNlbmRlcklkIHx8ICFzZXJ2ZXJJZCB8fCAhY2hhbm5lbElkKSB7CiAgICAg
ICAgICByZXR1cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiQXVjdW4gc2VydmV1ciBh
Y3RpZi4iCiAgICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IHJhd1RleHQgPQogICAgICAgICAgU3RyaW5nKHRleHQgfHwgIiIpOwoKICAg
ICAgICBpZiAocmF3VGV4dC5sZW5ndGggPiAxMDAwKSB7CiAgICAgICAgICByZXR1cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAg
ICBlcnJvcjoKICAgICAgICAgICAgICAiTGUgbWVzc2FnZSBlc3QgdHJvcCBsb25nLiIKICAgICAgICAgIH0pOwogICAgICAgIH0KCiAgICAgICAgY29uc3Qg
ZWRpdGVkID0KICAgICAgICAgIGF3YWl0IHBlb3BsZVNlcnZlckVkaXRNZXNzYWdlKAogICAgICAgICAgICBzZW5kZXJJZCwKICAgICAgICAgICAgc2VydmVy
SWQsCiAgICAgICAgICAgIGNoYW5uZWxJZCwKICAgICAgICAgICAgaWQsCiAgICAgICAgICAgIHJhd1RleHQKICAgICAgICAgICk7CgogICAgICAgIGlmICgh
ZWRpdGVkKSB7CiAgICAgICAgICByZXR1cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAi
VHUgbmUgcGV1eCBtb2RpZmllciBxdWUgdGVzIHByb3ByZXMgbWVzc2FnZXMuIgogICAgICAgICAgfSk7CiAgICAgICAgfQoKICAgICAgICBjb25zdCBwYXls
b2FkID0gewogICAgICAgICAgaWQ6IGVkaXRlZC5pZCwKICAgICAgICAgIGNoYW5uZWxJZDogZWRpdGVkLmNoYW5uZWxJZCwKICAgICAgICAgIHRleHQ6IGVk
aXRlZC50ZXh0LAogICAgICAgICAgZWRpdGVkQXQ6IGVkaXRlZC5lZGl0ZWRBdAogICAgICAgIH07CgogICAgICAgIGF3YWl0IHBlb3BsZUVtaXRTZXJ2ZXJD
aGFubmVsRXZlbnQoCiAgICAgICAgICBzZXJ2ZXJJZCwKICAgICAgICAgIGNoYW5uZWxJZCwKICAgICAgICAgICJjaGF0LW1lc3NhZ2UtZWRpdGVkIiwKICAg
ICAgICAgIHBheWxvYWQKICAgICAgICApOwoKICAgICAgICBhY2soewogICAgICAgICAgb2s6IHRydWUsCiAgICAgICAgICBtZXNzYWdlOiBwYXlsb2FkCiAg
ICAgICAgfSk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgICAiW1Blb3BsZSBzZXJ2ZXIgbWVzc2FnZS9l
ZGl0XSIsCiAgICAgICAgICBlcnIKICAgICAgICApOwoKICAgICAgICBhY2soewogICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgZXJyb3I6CiAgICAg
ICAgICAgICJJbXBvc3NpYmxlIGRlIG1vZGlmaWVyIGNlIG1lc3NhZ2UuIgogICAgICAgIH0pOwogICAgICB9CiAgICB9CiAgKTsKICAvLyA9PT0gUEVPUExF
X1NFUlZFUl9NRVNTQUdFX0VESVRfU09DS0VUX1Y2X0VORCA9PT0KCiAgc29ja2V0Lm9uKAogICAgImNoYXQtbWVzc2FnZS1kZWxldGUiLAogICAgYXN5bmMg
KAogICAgICB7IGlkIH0gPSB7fSwKICAgICAgYWNrID0gKCkgPT4ge30KICAgICkgPT4gewogICAgICB0cnkgewogICAgICAgIGNvbnN0IHNlbmRlcklkID0K
ICAgICAgICAgIHVzZXJJZHMuZ2V0KAogICAgICAgICAgICBzb2NrZXQuaWQKICAgICAgICAgICk7CgogICAgICAgIGNvbnN0IHNlcnZlcklkID0KICAgICAg
ICAgIHNvY2tldFNlcnZlcklkcy5nZXQoCiAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgKTsKCiAgICAgICAgY29uc3QgY2hhbm5lbElkID0KICAg
ICAgICAgIHNvY2tldFRleHRDaGFubmVsSWRzLmdldCgKICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICApOwoKICAgICAgICBpZiAoCiAgICAgICAg
ICAhc2VuZGVySWQgfHwKICAgICAgICAgICFzZXJ2ZXJJZCB8fAogICAgICAgICAgIWNoYW5uZWxJZAogICAgICAgICkgewogICAgICAgICAgcmV0dXJuIGFj
ayh7CiAgICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIkF1Y3VuIHNlcnZldXIgYWN0aWYuIgogICAgICAg
ICAgfSk7CiAgICAgICAgfQoKICAgICAgICBjb25zdCByZW1vdmVkID0KICAgICAgICAgIGF3YWl0IHBlb3BsZVNlcnZlckRlbGV0ZU1lc3NhZ2UoCiAgICAg
ICAgICAgIHNlbmRlcklkLAogICAgICAgICAgICBzZXJ2ZXJJZCwKICAgICAgICAgICAgY2hhbm5lbElkLAogICAgICAgICAgICBpZAogICAgICAgICAgKTsK
CiAgICAgICAgaWYgKCFyZW1vdmVkKSB7CiAgICAgICAgICByZXR1cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoK
ICAgICAgICAgICAgICAiVHUgbidhcyBwYXMgbGEgcGVybWlzc2lvbiBkZSBzdXBwcmltZXIgY2UgbWVzc2FnZS4iCiAgICAgICAgICB9KTsKICAgICAgICB9
CgogICAgICAgIGF3YWl0IHBlb3BsZUVtaXRTZXJ2ZXJDaGFubmVsRXZlbnQoCiAgICAgICAgICBzZXJ2ZXJJZCwKICAgICAgICAgIGNoYW5uZWxJZCwKICAg
ICAgICAgICJjaGF0LW1lc3NhZ2UtZGVsZXRlZCIsCiAgICAgICAgICB7CiAgICAgICAgICAgIGlkOiBTdHJpbmcoaWQpLAogICAgICAgICAgICBjaGFubmVs
SWQ6IFN0cmluZyhjaGFubmVsSWQpCiAgICAgICAgICB9CiAgICAgICAgKTsKCiAgICAgICAgYWNrKHsKICAgICAgICAgIG9rOiB0cnVlCiAgICAgICAgfSk7
CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGNvbnNvbGUuZXJyb3IoCiAgICAgICAgICAiW1Blb3BsZSBzZXJ2ZXIgbWVzc2FnZS9kZWxldGVdIiwK
ICAgICAgICAgIGVycgogICAgICAgICk7CgogICAgICAgIGFjayh7CiAgICAgICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAg
IkltcG9zc2libGUgZGUgc3VwcHJpbWVyIGNlIG1lc3NhZ2UuIgogICAgICAgIH0pOwogICAgICB9CiAgICB9CiAgKTsKCiAgc29ja2V0Lm9uKAogICAgInZv
aWNlLWpvaW4iLAogICAgYXN5bmMgKAogICAgICB7CiAgICAgICAgc2VydmVySWQ6CiAgICAgICAgICByZXF1ZXN0ZWRTZXJ2ZXJJZCwKICAgICAgICBjaGFu
bmVsSWQ6CiAgICAgICAgICByZXF1ZXN0ZWRDaGFubmVsSWQsCiAgICAgICAgbXV0ZWQsCiAgICAgICAgY2FtZXJhLAogICAgICAgIHNjcmVlbgogICAgICB9
ID0ge30sCiAgICAgIGFjayA9ICgpID0+IHt9CiAgICApID0+IHsKICAgICAgLy8gPT09IFBFT1BMRV9WT0lDRV9KT0lOX1YyID09PQogICAgICB0cnkgewog
ICAgICAgIGNvbnN0IHVzZXJuYW1lID0KICAgICAgICAgIHVzZXJzLmdldCgKICAgICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgICApOwoKICAgICAgICBj
b25zdCBhY2NvdW50SWQgPQogICAgICAgICAgdXNlcklkcy5nZXQoCiAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgKTsKCiAgICAgICAgY29uc3Qg
d2FudGVkU2VydmVySWQgPQogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICByZXF1ZXN0ZWRTZXJ2ZXJJZCB8fAogICAgICAgICAgICBzb2NrZXRTZXJ2
ZXJJZHMuZ2V0KAogICAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgICApIHx8CiAgICAgICAgICAgICIiCiAgICAgICAgICApOwoKICAgICAgICBp
ZiAoCiAgICAgICAgICAhdXNlcm5hbWUgfHwKICAgICAgICAgICFhY2NvdW50SWQgfHwKICAgICAgICAgICF3YW50ZWRTZXJ2ZXJJZAogICAgICAgICkgewog
ICAgICAgICAgcmV0dXJuIGFjayh7CiAgICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIlNlc3Npb24gdm9j
YWxlIGludmFsaWRlLiIKICAgICAgICAgIH0pOwogICAgICAgIH0KCiAgICAgICAgY29uc3Qgc2VydmVyID0KICAgICAgICAgIGF3YWl0IHBlb3BsZUdldFNl
cnZlcigKICAgICAgICAgICAgd2FudGVkU2VydmVySWQKICAgICAgICAgICk7CgogICAgICAgIGlmICghc2VydmVyKSB7CiAgICAgICAgICByZXR1cm4gYWNr
KHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiU2VydmV1ciB2b2NhbCBpbnRyb3V2YWJsZS4iCiAg
ICAgICAgICB9KTsKICAgICAgICB9CgogICAgICAgIGNvbnN0IG1lbWJlciA9CiAgICAgICAgICBhd2FpdCBwZW9wbGVJc1NlcnZlck1lbWJlcigKICAgICAg
ICAgICAgYWNjb3VudElkLAogICAgICAgICAgICBzZXJ2ZXIuaWQKICAgICAgICAgICk7CgogICAgICAgIGlmICghbWVtYmVyKSB7CiAgICAgICAgICByZXR1
cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgICAiVHUgbidlcyBwbHVzIG1lbWJyZSBkZSBj
ZSBzZXJ2ZXVyLiIKICAgICAgICAgIH0pOwogICAgICAgIH0KCiAgICAgICAgY29uc3Qgc2lkID0KICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgc2Vy
dmVyLmlkCiAgICAgICAgICApOwoKICAgICAgICBjb25zdCB2b2ljZUNoYW5uZWwgPQogICAgICAgICAgYXdhaXQgcGVvcGxlR2V0U2VydmVyQ2hhbm5lbCgK
ICAgICAgICAgICAgc2lkLAogICAgICAgICAgICByZXF1ZXN0ZWRDaGFubmVsSWQsCiAgICAgICAgICAgICJ2b2ljZSIKICAgICAgICAgICkgfHwKICAgICAg
ICAgIGF3YWl0IHBlb3BsZURlZmF1bHRTZXJ2ZXJDaGFubmVsKAogICAgICAgICAgICBzaWQsCiAgICAgICAgICAgICJ2b2ljZSIKICAgICAgICAgICk7Cgog
ICAgICAgIGlmICghdm9pY2VDaGFubmVsKSB7CiAgICAgICAgICByZXR1cm4gYWNrKHsgb2s6IGZhbHNlLCBlcnJvcjogIlNhbG9uIHZvY2FsIGludHJvdXZh
YmxlLiIgfSk7CiAgICAgICAgfQoKICAgICAgICBjb25zdCB2b2ljZUNoYW5uZWxJZCA9IFN0cmluZyh2b2ljZUNoYW5uZWwuaWQpOwogICAgICAgIGNvbnN0
IHZvaWNlTWFzayA9IGF3YWl0IHBlb3BsZVNlcnZlckVmZmVjdGl2ZVBlcm1pc3Npb25NYXNrKGFjY291bnRJZCwgc2lkLCB2b2ljZUNoYW5uZWxJZCk7CiAg
ICAgICAgaWYgKCFwZW9wbGVQZXJtaXNzaW9uSGFzKHZvaWNlTWFzaywgIlZJRVdfQ0hBTk5FTCIpIHx8ICFwZW9wbGVQZXJtaXNzaW9uSGFzKHZvaWNlTWFz
aywgIkNPTk5FQ1QiKSkgewogICAgICAgICAgcmV0dXJuIGFjayh7IG9rOiBmYWxzZSwgZXJyb3I6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIHJl
am9pbmRyZSBjZSB2b2NhbC4iIH0pOwogICAgICAgIH0KICAgICAgICBjb25zdCBjYW5TcGVha0hlcmUgPSBwZW9wbGVQZXJtaXNzaW9uSGFzKHZvaWNlTWFz
aywgIlNQRUFLIik7CiAgICAgICAgY29uc3QgY2FuU3RyZWFtSGVyZSA9IHBlb3BsZVBlcm1pc3Npb25IYXModm9pY2VNYXNrLCAiU1RSRUFNIik7CgogICAg
ICAgIGNvbnN0IGFpZCA9CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIGFjY291bnRJZAogICAgICAgICAgKTsKCiAgICAgICAgY29uc3QgY3VycmVu
dFZvaWNlID0KICAgICAgICAgIHZvaWNlVXNlcnMuZ2V0KAogICAgICAgICAgICBzb2NrZXQuaWQKICAgICAgICAgICk7CgogICAgICAgIC8qCiAgICAgICAg
ICBVbmUgc2V1bGUgc2Vzc2lvbiB2b2NhbGUgUGVvcGxlIGVzdCBhdXRvcmlzZWUKICAgICAgICAgIHBhciBjb21wdGUsIHF1ZWwgcXVlIHNvaXQgbCdvbmds
ZXQgdXRpbGlzZS4KICAgICAgICAqLwogICAgICAgIGlmIChjdXJyZW50Vm9pY2UpIHsKICAgICAgICAgIGlmICgKICAgICAgICAgICAgU3RyaW5nKAogICAg
ICAgICAgICAgIGN1cnJlbnRWb2ljZS5zZXJ2ZXJJZAogICAgICAgICAgICApID09PSBzaWQgJiYKICAgICAgICAgICAgU3RyaW5nKGN1cnJlbnRWb2ljZS5j
aGFubmVsSWQgfHwgIiIpID09PSB2b2ljZUNoYW5uZWxJZAogICAgICAgICAgKSB7CiAgICAgICAgICAgIGF3YWl0IHNvY2tldC5qb2luKAogICAgICAgICAg
ICAgIHBlb3BsZVZvaWNlUm9vbSgKICAgICAgICAgICAgICAgIHNpZAogICAgICAgICAgICAgICkKICAgICAgICAgICAgKTsKICAgICAgICAgICAgYXdhaXQg
c29ja2V0LmpvaW4oCiAgICAgICAgICAgICAgcGVvcGxlVm9pY2VDaGFubmVsUm9vbSgKICAgICAgICAgICAgICAgIHNpZCwKICAgICAgICAgICAgICAgIHZv
aWNlQ2hhbm5lbElkCiAgICAgICAgICAgICAgKQogICAgICAgICAgICApOwoKICAgICAgICAgICAgY29uc3Qgcm9zdGVyID0KICAgICAgICAgICAgICBwZW9w
bGVWb2ljZVJvc3RlcigKICAgICAgICAgICAgICAgIHNpZAogICAgICAgICAgICAgICk7CgogICAgICAgICAgICByZXR1cm4gYWNrKHsKICAgICAgICAgICAg
ICBvazogdHJ1ZSwKICAgICAgICAgICAgICBzZXJ2ZXJJZDoKICAgICAgICAgICAgICAgIHNpZCwKICAgICAgICAgICAgICBjaGFubmVsSWQ6CiAgICAgICAg
ICAgICAgICB2b2ljZUNoYW5uZWxJZCwKICAgICAgICAgICAgICByb3N0ZXI6IHJvc3Rlci5maWx0ZXIoKHVzZXIpID0+IFN0cmluZyh1c2VyLmNoYW5uZWxJ
ZCB8fCAiIikgPT09IHZvaWNlQ2hhbm5lbElkKSwKICAgICAgICAgICAgICB2b2ljZVJvb21zOgogICAgICAgICAgICAgICAgcGVvcGxlVm9pY2VBY2NvdW50
U2VydmVySWRzKAogICAgICAgICAgICAgICAgICBhaWQKICAgICAgICAgICAgICAgICkuc2l6ZQogICAgICAgICAgICB9KTsKICAgICAgICAgIH0KICAgICAg
ICB9CgogICAgICAgIC8qCiAgICAgICAgICBPbiB2w6lyaWZpZSBsZXMgYXV0cmVzIHNlc3Npb25zIGR1IGNvbXB0ZSBBVkFOVCBkZSBxdWl0dGVyIGxlCiAg
ICAgICAgICB2b2NhbCBhY3R1ZWwuIEFpbnNpLCB1biBjaGFuZ2VtZW50IHJlZnVzw6kgbmUgZmFpdCBqYW1haXMgcGVyZHJlCiAgICAgICAgICBsYSByb29t
IGRhbnMgbGFxdWVsbGUgbCd1dGlsaXNhdGV1ciBzZSB0cm91dmFpdCBkw6lqw6AuCiAgICAgICAgKi8KICAgICAgICBpZiAoCiAgICAgICAgICBwZW9wbGVW
b2ljZUFjY291bnRJblNlcnZlcigKICAgICAgICAgICAgYWlkLAogICAgICAgICAgICBzaWQsCiAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgKQog
ICAgICAgICkgewogICAgICAgICAgcmV0dXJuIGFjayh7CiAgICAgICAgICAgIG9rOiBmYWxzZSwKICAgICAgICAgICAgY29kZToKICAgICAgICAgICAgICAi
Vk9JQ0VfQUxSRUFEWV9IRVJFIiwKICAgICAgICAgICAgZXJyb3I6CiAgICAgICAgICAgICAgIlRvbiBjb21wdGUgZXN0IGTDqWrDoCBjb25uZWN0w6kgw6Ag
dW4gdm9jYWwuIgogICAgICAgICAgfSk7CiAgICAgICAgfQoKICAgICAgICBjb25zdCBjdXJyZW50Um9vbXMgPQogICAgICAgICAgcGVvcGxlVm9pY2VBY2Nv
dW50U2VydmVySWRzKAogICAgICAgICAgICBhaWQsCiAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgKTsKCiAgICAgICAgY29uc3QgcmVzZXJ2ZWRF
bHNld2hlcmUgPQogICAgICAgICAgY3VycmVudFJvb21zLnNpemUgKwogICAgICAgICAgcGVvcGxlQWNjb3VudERtQ2FsbENvdW50KAogICAgICAgICAgICBh
aWQsCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICBpbmNsdWRlUmluZ2luZzoKICAgICAgICAgICAgICAgIHRydWUKICAgICAgICAgICAgfQogICAgICAg
ICAgKTsKCiAgICAgICAgaWYgKAogICAgICAgICAgIWN1cnJlbnRSb29tcy5oYXMoCiAgICAgICAgICAgIHNpZAogICAgICAgICAgKSAmJgogICAgICAgICAg
cmVzZXJ2ZWRFbHNld2hlcmUgPj0KICAgICAgICAgICAgUEVPUExFX01BWF9TSU1VTFRBTkVPVVNfVk9JQ0VTCiAgICAgICAgKSB7CiAgICAgICAgICByZXR1
cm4gYWNrKHsKICAgICAgICAgICAgb2s6IGZhbHNlLAogICAgICAgICAgICBjb2RlOgogICAgICAgICAgICAgICJWT0lDRV9MSU1JVCIsCiAgICAgICAgICAg
IGVycm9yOgogICAgICAgICAgICAgICJUdSBlcyBkw6lqw6AgZGFucyB1biBhdXRyZSB2b2NhbCBvdSB1biBhcHBlbC4iCiAgICAgICAgICB9KTsKICAgICAg
ICB9CgogICAgICAgIC8qCiAgICAgICAgICA9PT0gUEVPUExFX1ZPSUNFX0FVVE9fU1dJVENIX1YxID09PQogICAgICAgICAgU2kgQ0Ugc29ja2V0IGVzdCBk
w6lqw6AgZGFucyB1biBhdXRyZSB2b2NhbCBzZXJ2ZXVyLCBsZSBub3V2ZWF1CiAgICAgICAgICB2b2ljZS1qb2luIGRldmllbnQgdW4gZMOpcGxhY2VtZW50
IGF0b21pcXVlIDogb24gYW5ub25jZSBsZSBkw6lwYXJ0CiAgICAgICAgICDDoCBsJ2FuY2llbm5lIHJvb20gcHVpcyBvbiBjb250aW51ZSBpbW3DqWRpYXRl
bWVudCB2ZXJzIGxhIG5vdXZlbGxlLgogICAgICAgICovCiAgICAgICAgaWYgKGN1cnJlbnRWb2ljZSkgewogICAgICAgICAgbGVhdmVWb2ljZShzb2NrZXQp
OwogICAgICAgIH0KCiAgICAgICAgdm9pY2VVc2Vycy5zZXQoCiAgICAgICAgICBzb2NrZXQuaWQsCiAgICAgICAgICB7CiAgICAgICAgICAgIHNlcnZlcklk
OgogICAgICAgICAgICAgIHNpZCwKICAgICAgICAgICAgYWNjb3VudElkOgogICAgICAgICAgICAgIGFpZCwKICAgICAgICAgICAgY2hhbm5lbElkOgogICAg
ICAgICAgICAgIHZvaWNlQ2hhbm5lbElkLAogICAgICAgICAgICB1c2VybmFtZSwKICAgICAgICAgICAgbXV0ZWQ6CiAgICAgICAgICAgICAgY2FuU3BlYWtI
ZXJlCiAgICAgICAgICAgICAgICA/IEJvb2xlYW4obXV0ZWQpCiAgICAgICAgICAgICAgICA6IHRydWUsCiAgICAgICAgICAgIGNhbWVyYToKICAgICAgICAg
ICAgICBjYW5TdHJlYW1IZXJlCiAgICAgICAgICAgICAgICA/IEJvb2xlYW4oY2FtZXJhKQogICAgICAgICAgICAgICAgOiBmYWxzZSwKICAgICAgICAgICAg
c2NyZWVuOgogICAgICAgICAgICAgIGNhblN0cmVhbUhlcmUKICAgICAgICAgICAgICAgID8gQm9vbGVhbihzY3JlZW4pCiAgICAgICAgICAgICAgICA6IGZh
bHNlCiAgICAgICAgICB9CiAgICAgICAgKTsKCiAgICAgICAgYXdhaXQgc29ja2V0LmpvaW4oCiAgICAgICAgICBwZW9wbGVWb2ljZVJvb20oCiAgICAgICAg
ICAgIHNpZAogICAgICAgICAgKQogICAgICAgICk7CgogICAgICAgIGF3YWl0IHNvY2tldC5qb2luKAogICAgICAgICAgcGVvcGxlVm9pY2VDaGFubmVsUm9v
bSgKICAgICAgICAgICAgc2lkLAogICAgICAgICAgICB2b2ljZUNoYW5uZWxJZAogICAgICAgICAgKQogICAgICAgICk7CgogICAgICAgIGNvbnN0IHJvc3Rl
ciA9CiAgICAgICAgICBwZW9wbGVWb2ljZVJvc3RlcigKICAgICAgICAgICAgc2lkCiAgICAgICAgICApOwoKICAgICAgICBzb2NrZXQuZW1pdCgKICAgICAg
ICAgICJ2b2ljZS1wZWVycyIsCiAgICAgICAgICByb3N0ZXIuZmlsdGVyKAogICAgICAgICAgICAodXNlcikgPT4KICAgICAgICAgICAgICB1c2VyLmlkICE9
PSBzb2NrZXQuaWQgJiYKICAgICAgICAgICAgICBTdHJpbmcodXNlci5jaGFubmVsSWQgfHwgIiIpID09PSB2b2ljZUNoYW5uZWxJZAogICAgICAgICAgKQog
ICAgICAgICk7CgogICAgICAgIC8qCiAgICAgICAgICBSYWZyYWljaGl0IGwnZXRhdCB2b2NhbCBkdSBjb21wdGUuCiAgICAgICAgKi8KICAgICAgICBwZW9w
bGVWb2ljZVJlZnJlc2hBY2NvdW50KAogICAgICAgICAgYWlkCiAgICAgICAgKTsKCiAgICAgICAgY29uc3Qgcm9vbUNvdW50ID0KICAgICAgICAgIHBlb3Bs
ZUFjY291bnRBY3RpdmVWb2ljZUNvdW50KAogICAgICAgICAgICBhaWQKICAgICAgICAgICk7CgogICAgICAgIGFjayh7CiAgICAgICAgICBvazogdHJ1ZSwK
ICAgICAgICAgIHNlcnZlcklkOgogICAgICAgICAgICBzaWQsCiAgICAgICAgICBjaGFubmVsSWQ6CiAgICAgICAgICAgIHZvaWNlQ2hhbm5lbElkLAogICAg
ICAgICAgcm9zdGVyOiByb3N0ZXIuZmlsdGVyKCh1c2VyKSA9PiBTdHJpbmcodXNlci5jaGFubmVsSWQgfHwgIiIpID09PSB2b2ljZUNoYW5uZWxJZCksCiAg
ICAgICAgICB2b2ljZVJvb21zOgogICAgICAgICAgICByb29tQ291bnQKICAgICAgICB9KTsKICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgY29uc29s
ZS5lcnJvcigKICAgICAgICAgICJbUGVvcGxlIHZvaWNlLWpvaW4gVjJdIiwKICAgICAgICAgIGVycgogICAgICAgICk7CgogICAgICAgIGFjayh7CiAgICAg
ICAgICBvazogZmFsc2UsCiAgICAgICAgICBlcnJvcjoKICAgICAgICAgICAgIkltcG9zc2libGUgZGUgcmVqb2luZHJlIGxlIHZvY2FsLiIKICAgICAgICB9
KTsKICAgICAgfQogICAgfQogICk7CgogIHNvY2tldC5vbigKICAgICJ2b2ljZS1sZWF2ZSIsCiAgICAoKSA9PiB7CiAgICAgIGxlYXZlVm9pY2Uoc29ja2V0
KTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAidm9pY2UtbXV0ZSIsCiAgICBhc3luYyAoeyBtdXRlZCB9ID0ge30pID0+IHsKICAgICAgY29uc3Qg
dXNlciA9IHZvaWNlVXNlcnMuZ2V0KHNvY2tldC5pZCk7CiAgICAgIGlmICghdXNlcikgcmV0dXJuOwogICAgICBpZiAoIUJvb2xlYW4obXV0ZWQpKSB7CiAg
ICAgICAgY29uc3QgYWxsb3dlZCA9IGF3YWl0IHBlb3BsZUNhblNlcnZlclBlcm1pc3Npb24oCiAgICAgICAgICB1c2VyLmFjY291bnRJZCwKICAgICAgICAg
IHVzZXIuc2VydmVySWQsCiAgICAgICAgICAiU1BFQUsiLAogICAgICAgICAgdXNlci5jaGFubmVsSWQKICAgICAgICApOwogICAgICAgIGlmICghYWxsb3dl
ZCkgewogICAgICAgICAgc29ja2V0LmVtaXQoInN5c3RlbS1tZXNzYWdlIiwgeyB0ZXh0OiAiVHUgbidhcyBwYXMgbGEgcGVybWlzc2lvbiBkZSBwYXJsZXIg
ZGFucyBjZSB2b2NhbC4iLCB0aW1lOiBEYXRlLm5vdygpIH0pOwogICAgICAgICAgdXNlci5tdXRlZCA9IHRydWU7CiAgICAgICAgICB2b2ljZVVzZXJzLnNl
dChzb2NrZXQuaWQsIHVzZXIpOwogICAgICAgICAgZW1pdFZvaWNlU3RhdGUodXNlci5zZXJ2ZXJJZCk7CiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQog
ICAgICB9CiAgICAgIHVzZXIubXV0ZWQgPSBCb29sZWFuKG11dGVkKTsKICAgICAgdm9pY2VVc2Vycy5zZXQoc29ja2V0LmlkLCB1c2VyKTsKICAgICAgZW1p
dFZvaWNlU3RhdGUodXNlci5zZXJ2ZXJJZCk7CiAgICB9CiAgKTsKCiAgc29ja2V0Lm9uKAogICAgInZvaWNlLWNhbWVyYSIsCiAgICBhc3luYyAoeyBjYW1l
cmEgfSA9IHt9KSA9PiB7CiAgICAgIGNvbnN0IHVzZXIgPSB2b2ljZVVzZXJzLmdldChzb2NrZXQuaWQpOwogICAgICBpZiAoIXVzZXIpIHJldHVybjsKICAg
ICAgaWYgKEJvb2xlYW4oY2FtZXJhKSAmJiAhKGF3YWl0IHBlb3BsZUNhblNlcnZlclBlcm1pc3Npb24odXNlci5hY2NvdW50SWQsIHVzZXIuc2VydmVySWQs
ICJTVFJFQU0iLCB1c2VyLmNoYW5uZWxJZCkpKSB7CiAgICAgICAgc29ja2V0LmVtaXQoInN5c3RlbS1tZXNzYWdlIiwgeyB0ZXh0OiAiVHUgbidhcyBwYXMg
bGEgcGVybWlzc2lvbiBkJ2FjdGl2ZXIgdGEgY2Ftw6lyYSBkYW5zIGNlIHZvY2FsLiIsIHRpbWU6IERhdGUubm93KCkgfSk7CiAgICAgICAgdXNlci5jYW1l
cmEgPSBmYWxzZTsKICAgICAgfSBlbHNlIHsKICAgICAgICB1c2VyLmNhbWVyYSA9IEJvb2xlYW4oY2FtZXJhKTsKICAgICAgfQogICAgICB2b2ljZVVzZXJz
LnNldChzb2NrZXQuaWQsIHVzZXIpOwogICAgICBlbWl0Vm9pY2VTdGF0ZSh1c2VyLnNlcnZlcklkKTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAi
dm9pY2Utc2NyZWVuIiwKICAgIGFzeW5jICh7IHNjcmVlbiB9ID0ge30pID0+IHsKICAgICAgY29uc3QgdXNlciA9IHZvaWNlVXNlcnMuZ2V0KHNvY2tldC5p
ZCk7CiAgICAgIGlmICghdXNlcikgcmV0dXJuOwogICAgICBpZiAoQm9vbGVhbihzY3JlZW4pICYmICEoYXdhaXQgcGVvcGxlQ2FuU2VydmVyUGVybWlzc2lv
bih1c2VyLmFjY291bnRJZCwgdXNlci5zZXJ2ZXJJZCwgIlNUUkVBTSIsIHVzZXIuY2hhbm5lbElkKSkpIHsKICAgICAgICBzb2NrZXQuZW1pdCgic3lzdGVt
LW1lc3NhZ2UiLCB7IHRleHQ6ICJUdSBuJ2FzIHBhcyBsYSBwZXJtaXNzaW9uIGRlIHBhcnRhZ2VyIHRvbiDDqWNyYW4gZGFucyBjZSB2b2NhbC4iLCB0aW1l
OiBEYXRlLm5vdygpIH0pOwogICAgICAgIHVzZXIuc2NyZWVuID0gZmFsc2U7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgdXNlci5zY3JlZW4gPSBCb29sZWFu
KHNjcmVlbik7CiAgICAgIH0KICAgICAgdm9pY2VVc2Vycy5zZXQoc29ja2V0LmlkLCB1c2VyKTsKICAgICAgZW1pdFZvaWNlU3RhdGUodXNlci5zZXJ2ZXJJ
ZCk7CiAgICB9CiAgKTsKCiAgc29ja2V0Lm9uKAogICAgIndlYnJ0Yy1vZmZlciIsCiAgICAoewogICAgICB0YXJnZXQsCiAgICAgIHNkcAogICAgfSA9IHt9
KSA9PiB7CiAgICAgIGNvbnN0IG1pbmUgPQogICAgICAgIHZvaWNlVXNlcnMuZ2V0KAogICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgKTsKCiAgICAgIGNv
bnN0IG90aGVyID0KICAgICAgICB2b2ljZVVzZXJzLmdldCgKICAgICAgICAgIHRhcmdldAogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIW1pbmUg
fHwKICAgICAgICAhb3RoZXIgfHwKICAgICAgICBTdHJpbmcobWluZS5zZXJ2ZXJJZCkgIT09CiAgICAgICAgICBTdHJpbmcob3RoZXIuc2VydmVySWQpIHx8
CiAgICAgICAgU3RyaW5nKG1pbmUuY2hhbm5lbElkIHx8ICIiKSAhPT0KICAgICAgICAgIFN0cmluZyhvdGhlci5jaGFubmVsSWQgfHwgIiIpIHx8CiAgICAg
ICAgIXNkcAogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlvLnRvKHRhcmdldCkuZW1pdCgKICAgICAgICAid2VicnRjLW9mZmVy
IiwKICAgICAgICB7CiAgICAgICAgICBmcm9tOgogICAgICAgICAgICBzb2NrZXQuaWQsCiAgICAgICAgICB1c2VybmFtZToKICAgICAgICAgICAgdXNlcnMu
Z2V0KAogICAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICAgICApIHx8ICJJbnZpdMOpIiwKICAgICAgICAgIHNkcAogICAgICAgIH0KICAgICAgKTsK
ICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAid2VicnRjLWFuc3dlciIsCiAgICAoewogICAgICB0YXJnZXQsCiAgICAgIHNkcAogICAgfSA9IHt9KSA9
PiB7CiAgICAgIGNvbnN0IG1pbmUgPQogICAgICAgIHZvaWNlVXNlcnMuZ2V0KAogICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgKTsKCiAgICAgIGNvbnN0
IG90aGVyID0KICAgICAgICB2b2ljZVVzZXJzLmdldCgKICAgICAgICAgIHRhcmdldAogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIW1pbmUgfHwK
ICAgICAgICAhb3RoZXIgfHwKICAgICAgICBTdHJpbmcobWluZS5zZXJ2ZXJJZCkgIT09CiAgICAgICAgICBTdHJpbmcob3RoZXIuc2VydmVySWQpIHx8CiAg
ICAgICAgU3RyaW5nKG1pbmUuY2hhbm5lbElkIHx8ICIiKSAhPT0KICAgICAgICAgIFN0cmluZyhvdGhlci5jaGFubmVsSWQgfHwgIiIpIHx8CiAgICAgICAg
IXNkcAogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlvLnRvKHRhcmdldCkuZW1pdCgKICAgICAgICAid2VicnRjLWFuc3dlciIs
CiAgICAgICAgewogICAgICAgICAgZnJvbToKICAgICAgICAgICAgc29ja2V0LmlkLAogICAgICAgICAgc2RwCiAgICAgICAgfQogICAgICApOwogICAgfQog
ICk7CgogIHNvY2tldC5vbigKICAgICJ3ZWJydGMtaWNlLWNhbmRpZGF0ZSIsCiAgICAoewogICAgICB0YXJnZXQsCiAgICAgIGNhbmRpZGF0ZQogICAgfSA9
IHt9KSA9PiB7CiAgICAgIGNvbnN0IG1pbmUgPQogICAgICAgIHZvaWNlVXNlcnMuZ2V0KAogICAgICAgICAgc29ja2V0LmlkCiAgICAgICAgKTsKCiAgICAg
IGNvbnN0IG90aGVyID0KICAgICAgICB2b2ljZVVzZXJzLmdldCgKICAgICAgICAgIHRhcmdldAogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIW1p
bmUgfHwKICAgICAgICAhb3RoZXIgfHwKICAgICAgICBTdHJpbmcobWluZS5zZXJ2ZXJJZCkgIT09CiAgICAgICAgICBTdHJpbmcob3RoZXIuc2VydmVySWQp
IHx8CiAgICAgICAgU3RyaW5nKG1pbmUuY2hhbm5lbElkIHx8ICIiKSAhPT0KICAgICAgICAgIFN0cmluZyhvdGhlci5jaGFubmVsSWQgfHwgIiIpIHx8CiAg
ICAgICAgIWNhbmRpZGF0ZQogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlvLnRvKHRhcmdldCkuZW1pdCgKICAgICAgICAid2Vi
cnRjLWljZS1jYW5kaWRhdGUiLAogICAgICAgIHsKICAgICAgICAgIGZyb206CiAgICAgICAgICAgIHNvY2tldC5pZCwKICAgICAgICAgIGNhbmRpZGF0ZQog
ICAgICAgIH0KICAgICAgKTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAgICAidm9pY2UtcGVlci1yZWNvbm5lY3QiLAogICAgKHsgdGFyZ2V0IH0gPSB7
fSkgPT4gewogICAgICBjb25zdCBtaW5lID0KICAgICAgICB2b2ljZVVzZXJzLmdldCgKICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICk7CgogICAgICBj
b25zdCBvdGhlciA9CiAgICAgICAgdm9pY2VVc2Vycy5nZXQoCiAgICAgICAgICB0YXJnZXQKICAgICAgICApOwoKICAgICAgaWYgKAogICAgICAgICFtaW5l
IHx8CiAgICAgICAgIW90aGVyIHx8CiAgICAgICAgU3RyaW5nKG1pbmUuc2VydmVySWQpICE9PQogICAgICAgICAgU3RyaW5nKG90aGVyLnNlcnZlcklkKSB8
fAogICAgICAgIFN0cmluZyhtaW5lLmNoYW5uZWxJZCB8fCAiIikgIT09CiAgICAgICAgICBTdHJpbmcob3RoZXIuY2hhbm5lbElkIHx8ICIiKQogICAgICAp
IHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlvLnRvKHRhcmdldCkuZW1pdCgKICAgICAgICAidm9pY2UtcGVlci1yZWNvbm5lY3QiLAogICAg
ICAgIHsKICAgICAgICAgIGZyb206CiAgICAgICAgICAgIHNvY2tldC5pZAogICAgICAgIH0KICAgICAgKTsKICAgIH0KICApOwoKICBzb2NrZXQub24oCiAg
ICAiZGlzY29ubmVjdCIsCiAgICAoKSA9PiB7IAogICAgICBwZW9wbGVEbUNhbGxEaXNjb25uZWN0KAogICAgICAgIHNvY2tldAogICAgICApOwoKICAgICAg
Y29uc3QgYWNjb3VudElkID0KICAgICAgICB1c2VySWRzLmdldCgKICAgICAgICAgIHNvY2tldC5pZAogICAgICAgICk7CgogICAgICBsZWF2ZVZvaWNlKAog
ICAgICAgIHNvY2tldAogICAgICApOwoKICAgICAgdXNlcnMuZGVsZXRlKAogICAgICAgIHNvY2tldC5pZAogICAgICApOwoKICAgICAgdXNlcklkcy5kZWxl
dGUoCiAgICAgICAgc29ja2V0LmlkCiAgICAgICk7CgogICAgICBzb2NrZXRTZXJ2ZXJJZHMuZGVsZXRlKAogICAgICAgIHNvY2tldC5pZAogICAgICApOwoK
ICAgICAgc29ja2V0VGV4dENoYW5uZWxJZHMuZGVsZXRlKAogICAgICAgIHNvY2tldC5pZAogICAgICApOwoKICAgICAgaWYgKAogICAgICAgIGFjY291bnRJ
ZCAmJgogICAgICAgICFwZW9wbGVBY2NvdW50SXNPbmxpbmUoCiAgICAgICAgICBhY2NvdW50SWQKICAgICAgICApCiAgICAgICkgewogICAgICAgIHBlb3Bs
ZVNjaGVkdWxlUHJlc2VuY2VPZmZsaW5lKAogICAgICAgICAgYWNjb3VudElkCiAgICAgICAgKTsKICAgICAgfQogICAgfQogICk7Cn0pOwoKLy8gPT09IFBF
T1BMRV9NRVNTQUdFX0VOQ1JZUFRJT05fTUlHUkFUSU9OX1YyX1NUQVJUID09PQphc3luYyBmdW5jdGlvbiBwZW9wbGVNaWdyYXRlU3RvcmVkTWVzc2FnZUVu
Y3J5cHRpb24oKSB7CiAgaWYgKHBlb3BsZVBvb2wpIHsKICAgIGNvbnN0IGNsaWVudCA9CiAgICAgIGF3YWl0IHBlb3BsZVBvb2wuY29ubmVjdCgpOwoKICAg
IGxldCBtaWdyYXRlZEdlbmVyYWwgPQogICAgICAwOwoKICAgIGxldCBtaWdyYXRlZERtID0KICAgICAgMDsKCiAgICBsZXQgbWlncmF0ZWRJbWFnZXMgPQog
ICAgICAwOwoKICAgIHRyeSB7CiAgICAgIGF3YWl0IGNsaWVudC5xdWVyeSgKICAgICAgICAiQkVHSU4iCiAgICAgICk7CgogICAgICAvKgogICAgICAgIExl
cyBjaXBoZXJ0ZXh0cyBBRVMtR0NNIHNvbnQgcGx1cyBsb25ncyBxdWUgbGUgdGV4dGUgaW5pdGlhbC4KICAgICAgICBURVhUIMOpdml0ZSB0b3V0ZSB0cm9u
Y2F0dXJlLgogICAgICAqLwogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIkFMVEVSIFRBQkxFIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzICIg
KwogICAgICAgICJBTFRFUiBDT0xVTU4gYm9keSBUWVBFIFRFWFQiCiAgICAgICk7CgogICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgIkFMVEVS
IFRBQkxFIHBlb3BsZV9kaXJlY3RfbWVzc2FnZXMgIiArCiAgICAgICAgIkFMVEVSIENPTFVNTiBib2R5IFRZUEUgVEVYVCIKICAgICAgKTsKCiAgICAgIGNv
bnN0IGdlbmVyYWxSb3dzID0KICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiU0VMRUNUIGlkLCBib2R5IEZST00gcGVvcGxlX2dlbmVy
YWxfbWVzc2FnZXMgT1JERVIgQlkgaWQgQVNDIgogICAgICAgICk7CgogICAgICBmb3IgKAogICAgICAgIGNvbnN0IHJvdyBvZgogICAgICAgIGdlbmVyYWxS
b3dzLnJvd3MKICAgICAgKSB7CiAgICAgICAgY29uc3QgYm9keSA9CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIHJvdy5ib2R5IHx8CiAgICAgICAg
ICAgICIiCiAgICAgICAgICApOwoKICAgICAgICBpZiAoIWJvZHkpIHsKICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KCiAgICAgICAgaWYgKAogICAg
ICAgICAgcGVvcGxlTWVzc2FnZUlzRW5jcnlwdGVkKAogICAgICAgICAgICBib2R5CiAgICAgICAgICApCiAgICAgICAgKSB7CiAgICAgICAgICAvLyBWYWxp
ZGUgw6lnYWxlbWVudCBxdWUgbGEgY2zDqSBhY3R1ZWxsZSBlc3QgbGEgYm9ubmUuCiAgICAgICAgICBwZW9wbGVEZWNyeXB0TWVzc2FnZVRleHQoCiAgICAg
ICAgICAgIGJvZHkKICAgICAgICAgICk7CgogICAgICAgICAgY29udGludWU7CiAgICAgICAgfQoKICAgICAgICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAg
ICAgICAiVVBEQVRFIHBlb3BsZV9nZW5lcmFsX21lc3NhZ2VzIFNFVCBib2R5ID0gJDEgV0hFUkUgaWQgPSAkMiIsCiAgICAgICAgICBbCiAgICAgICAgICAg
IHBlb3BsZUVuY3J5cHRNZXNzYWdlVGV4dCgKICAgICAgICAgICAgICBib2R5CiAgICAgICAgICAgICksCiAgICAgICAgICAgIHJvdy5pZAogICAgICAgICAg
XQogICAgICAgICk7CgogICAgICAgIG1pZ3JhdGVkR2VuZXJhbCArPQogICAgICAgICAgMTsKICAgICAgfQoKICAgICAgY29uc3QgZG1Sb3dzID0KICAgICAg
ICBhd2FpdCBjbGllbnQucXVlcnkoCiAgICAgICAgICAiU0VMRUNUIGlkLCBib2R5IEZST00gcGVvcGxlX2RpcmVjdF9tZXNzYWdlcyBPUkRFUiBCWSBpZCBB
U0MiCiAgICAgICAgKTsKCiAgICAgIGZvciAoCiAgICAgICAgY29uc3Qgcm93IG9mCiAgICAgICAgZG1Sb3dzLnJvd3MKICAgICAgKSB7CiAgICAgICAgY29u
c3QgYm9keSA9CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIHJvdy5ib2R5IHx8CiAgICAgICAgICAgICIiCiAgICAgICAgICApOwoKICAgICAgICBp
ZiAoIWJvZHkpIHsKICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KCiAgICAgICAgaWYgKAogICAgICAgICAgcGVvcGxlRG1FMmVlSXNFbnZlbG9wZSgK
ICAgICAgICAgICAgYm9keQogICAgICAgICAgKQogICAgICAgICkgewogICAgICAgICAgLyoKICAgICAgICAgICAgRMOpasOgIGNoaWZmcsOpIGRlIGJvdXQg
ZW4gYm91dCA6CiAgICAgICAgICAgIG5lIHN1cnRvdXQgcGFzIGxlIGNvbnZlcnRpciBlbiBBRVMgc2VydmV1ci4KICAgICAgICAgICovCiAgICAgICAgICBj
b250aW51ZTsKICAgICAgICB9CgogICAgICAgIGlmICgKICAgICAgICAgIHBlb3BsZU1lc3NhZ2VJc0VuY3J5cHRlZCgKICAgICAgICAgICAgYm9keQogICAg
ICAgICAgKQogICAgICAgICkgewogICAgICAgICAgcGVvcGxlRGVjcnlwdE1lc3NhZ2VUZXh0KAogICAgICAgICAgICBib2R5CiAgICAgICAgICApOwoKICAg
ICAgICAgIGNvbnRpbnVlOwogICAgICAgIH0KCiAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgIlVQREFURSBwZW9wbGVfZGlyZWN0X21l
c3NhZ2VzIFNFVCBib2R5ID0gJDEgV0hFUkUgaWQgPSAkMiIsCiAgICAgICAgICBbCiAgICAgICAgICAgIHBlb3BsZUVuY3J5cHRNZXNzYWdlVGV4dCgKICAg
ICAgICAgICAgICBib2R5CiAgICAgICAgICAgICksCiAgICAgICAgICAgIHJvdy5pZAogICAgICAgICAgXQogICAgICAgICk7CgogICAgICAgIG1pZ3JhdGVk
RG0gKz0KICAgICAgICAgIDE7CiAgICAgIH0KCiAgICAgIC8qCiAgICAgICAgTGVzIGFuY2llbm5lcyBpbWFnZXMgw6l0YWllbnQgc3RvY2vDqWVzIGVuIGNs
YWlyLiBPbiBsZXMgbWlncmUKICAgICAgICBwYXIgcGV0aXRzIGxvdHMgcG91ciDDqXZpdGVyIGRlIGNoYXJnZXIgdG91cyBsZXMgQllURUEgZW4gbcOpbW9p
cmUuCiAgICAgICAgVW4gY29udGVuZXVyIEUyRUUgcmVzdGUgRTJFRSA6IG9uIGNoaWZmcmUgc2V1bGVtZW50IHNhIGNvdWNoZQogICAgICAgIGRlIHN0b2Nr
YWdlLCBqYW1haXMgc29uIGNvbnRlbnUgY8O0dMOpIHNlcnZldXIuCiAgICAgICovCiAgICAgIGxldCBsYXN0SW1hZ2VJZCA9CiAgICAgICAgIjAiOwoKICAg
ICAgbGV0IHZlcmlmaWVkRW5jcnlwdGVkSW1hZ2UgPQogICAgICAgIGZhbHNlOwoKICAgICAgd2hpbGUgKHRydWUpIHsKICAgICAgICBjb25zdCBpbWFnZVJv
d3MgPQogICAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgICAiU0VMRUNUIGlkLCBkYXRhICIgKwogICAgICAgICAgICAiRlJPTSBwZW9w
bGVfbWVzc2FnZV9pbWFnZXMgIiArCiAgICAgICAgICAgICJXSEVSRSBpZCA+ICQxICIgKwogICAgICAgICAgICAiT1JERVIgQlkgaWQgQVNDIExJTUlUIDUi
LAogICAgICAgICAgICBbbGFzdEltYWdlSWRdCiAgICAgICAgICApOwoKICAgICAgICBpZiAoIWltYWdlUm93cy5yb3dzLmxlbmd0aCkgewogICAgICAgICAg
YnJlYWs7CiAgICAgICAgfQoKICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiBpbWFnZVJvd3Mucm93cykgewogICAgICAgICAgbGFzdEltYWdlSWQgPQogICAg
ICAgICAgICBTdHJpbmcocm93LmlkKTsKCiAgICAgICAgICBpZiAoCiAgICAgICAgICAgIHBlb3BsZU1lc3NhZ2VJbWFnZVN0b3JhZ2VJc0VuY3J5cHRlZCgK
ICAgICAgICAgICAgICByb3cuZGF0YQogICAgICAgICAgICApCiAgICAgICAgICApIHsKICAgICAgICAgICAgLyoKICAgICAgICAgICAgICBVbmUgc2V1bGUg
dsOpcmlmaWNhdGlvbiBjb21wbMOodGUgc3VmZml0IHBvdXIgZMOpdGVjdGVyIHVuZQogICAgICAgICAgICAgIG1hdXZhaXNlIGNsw6kgc2FucyByZWTDqWNo
aWZmcmVyIHBsdXNpZXVycyBNbyDDoCBjaGFxdWUgZMOpbWFycmFnZS4KICAgICAgICAgICAgKi8KICAgICAgICAgICAgaWYgKCF2ZXJpZmllZEVuY3J5cHRl
ZEltYWdlKSB7CiAgICAgICAgICAgICAgcGVvcGxlRGVjcnlwdE1lc3NhZ2VJbWFnZURhdGEoCiAgICAgICAgICAgICAgICByb3cuZGF0YQogICAgICAgICAg
ICAgICk7CgogICAgICAgICAgICAgIHZlcmlmaWVkRW5jcnlwdGVkSW1hZ2UgPQogICAgICAgICAgICAgICAgdHJ1ZTsKICAgICAgICAgICAgfQoKICAgICAg
ICAgICAgY29udGludWU7CiAgICAgICAgICB9CgogICAgICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICAgICAiVVBEQVRFIHBlb3BsZV9tZXNz
YWdlX2ltYWdlcyAiICsKICAgICAgICAgICAgIlNFVCBkYXRhID0gJDEgV0hFUkUgaWQgPSAkMiIsCiAgICAgICAgICAgIFsKICAgICAgICAgICAgICBwZW9w
bGVFbmNyeXB0TWVzc2FnZUltYWdlRGF0YSgKICAgICAgICAgICAgICAgIHJvdy5kYXRhCiAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgICByb3cuaWQK
ICAgICAgICAgICAgXQogICAgICAgICAgKTsKCiAgICAgICAgICBtaWdyYXRlZEltYWdlcyArPQogICAgICAgICAgICAxOwogICAgICAgIH0KICAgICAgfQoK
ICAgICAgYXdhaXQgY2xpZW50LnF1ZXJ5KAogICAgICAgICJDT01NSVQiCiAgICAgICk7CgogICAgICBjb25zb2xlLmxvZygKICAgICAgICAiW1Blb3BsZV0g
Q2hpZmZyZW1lbnQgbWVzc2FnZXMgOiAiICsKICAgICAgICBtaWdyYXRlZEdlbmVyYWwgKwogICAgICAgICIgc2VydmV1cihzKSArICIgKwogICAgICAgIG1p
Z3JhdGVkRG0gKwogICAgICAgICIgTVAgKyAiICsKICAgICAgICBtaWdyYXRlZEltYWdlcyArCiAgICAgICAgIiBpbWFnZShzKSBtaWdyw6llKHMpLiIKICAg
ICAgKTsKCiAgICAgIHJldHVybjsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBhd2FpdCBjbGllbnQKICAgICAgICAucXVlcnkoCiAgICAgICAgICAiUk9M
TEJBQ0siCiAgICAgICAgKQogICAgICAgIC5jYXRjaCgKICAgICAgICAgICgpID0+IHt9CiAgICAgICAgKTsKCiAgICAgIHRocm93IGVycjsKICAgIH0gZmlu
YWxseSB7CiAgICAgIGNsaWVudC5yZWxlYXNlKCk7CiAgICB9CiAgfQoKICAvKgogICAgRW4gbG9jYWwsIGxlcyBoZWxwZXJzIGRlIGxlY3R1cmUgcmVudm9p
ZW50IGR1IHBsYWludGV4dAogICAgZXQgbGVzIGhlbHBlcnMgZCfDqWNyaXR1cmUgcmVjaGlmZnJlbnQgYXZhbnQgSlNPTi5zdHJpbmdpZnkoKS4KICAqLwog
IGlmICgKICAgIGZzQWNjb3VudHMuZXhpc3RzU3luYygKICAgICAgUEVPUExFX0xPQ0FMX1NPQ0lBTAogICAgKQogICkgewogICAgcGVvcGxlV3JpdGVMb2Nh
bFNvY2lhbCgKICAgICAgcGVvcGxlUmVhZExvY2FsU29jaWFsKCkKICAgICk7CiAgfQoKICBpZiAoCiAgICBmc0FjY291bnRzLmV4aXN0c1N5bmMoCiAgICAg
IFBFT1BMRV9MT0NBTF9HRU5FUkFMCiAgICApCiAgKSB7CiAgICBwZW9wbGVXcml0ZUxvY2FsR2VuZXJhbCgKICAgICAgcGVvcGxlUmVhZExvY2FsR2VuZXJh
bCgpCiAgICApOwogIH0KCiAgbGV0IG1pZ3JhdGVkTG9jYWxJbWFnZXMgPQogICAgMDsKCiAgbGV0IHZlcmlmaWVkTG9jYWxFbmNyeXB0ZWRJbWFnZSA9CiAg
ICBmYWxzZTsKCiAgaWYgKAogICAgZnNBY2NvdW50cy5leGlzdHNTeW5jKAogICAgICBQRU9QTEVfTE9DQUxfTUVTU0FHRV9JTUFHRV9NRVRBCiAgICApCiAg
KSB7CiAgICBjb25zdCBtZXRhID0KICAgICAgcGVvcGxlUmVhZExvY2FsTWVzc2FnZUltYWdlTWV0YSgpOwoKICAgIGZvciAoCiAgICAgIGNvbnN0IGl0ZW0g
b2YKICAgICAgT2JqZWN0LnZhbHVlcyhtZXRhKQogICAgKSB7CiAgICAgIGNvbnN0IGZpbGUgPQogICAgICAgIFN0cmluZyhpdGVtPy5maWxlIHx8ICIiKTsK
CiAgICAgIGlmICghZmlsZSkgewogICAgICAgIGNvbnRpbnVlOwogICAgICB9CgogICAgICBjb25zdCBmaWxlUGF0aCA9CiAgICAgICAgcGF0aEFjY291bnRz
LmpvaW4oCiAgICAgICAgICBQRU9QTEVfTE9DQUxfTUVTU0FHRV9JTUFHRV9ESVIsCiAgICAgICAgICBmaWxlCiAgICAgICAgKTsKCiAgICAgIGlmICgKICAg
ICAgICAhZnNBY2NvdW50cy5leGlzdHNTeW5jKAogICAgICAgICAgZmlsZVBhdGgKICAgICAgICApCiAgICAgICkgewogICAgICAgIGNvbnRpbnVlOwogICAg
ICB9CgogICAgICBjb25zdCBzdG9yZWQgPQogICAgICAgIGZzQWNjb3VudHMucmVhZEZpbGVTeW5jKAogICAgICAgICAgZmlsZVBhdGgKICAgICAgICApOwoK
ICAgICAgaWYgKAogICAgICAgIHBlb3BsZU1lc3NhZ2VJbWFnZVN0b3JhZ2VJc0VuY3J5cHRlZCgKICAgICAgICAgIHN0b3JlZAogICAgICAgICkKICAgICAg
KSB7CiAgICAgICAgaWYgKCF2ZXJpZmllZExvY2FsRW5jcnlwdGVkSW1hZ2UpIHsKICAgICAgICAgIHBlb3BsZURlY3J5cHRNZXNzYWdlSW1hZ2VEYXRhKAog
ICAgICAgICAgICBzdG9yZWQKICAgICAgICAgICk7CgogICAgICAgICAgdmVyaWZpZWRMb2NhbEVuY3J5cHRlZEltYWdlID0KICAgICAgICAgICAgdHJ1ZTsK
ICAgICAgICB9CgogICAgICAgIGNvbnRpbnVlOwogICAgICB9CgogICAgICBmc0FjY291bnRzLndyaXRlRmlsZVN5bmMoCiAgICAgICAgZmlsZVBhdGgsCiAg
ICAgICAgcGVvcGxlRW5jcnlwdE1lc3NhZ2VJbWFnZURhdGEoCiAgICAgICAgICBzdG9yZWQKICAgICAgICApCiAgICAgICk7CgogICAgICBtaWdyYXRlZExv
Y2FsSW1hZ2VzICs9CiAgICAgICAgMTsKICAgIH0KICB9CgogIGNvbnNvbGUubG9nKAogICAgIltQZW9wbGVdIENoaWZmcmVtZW50IG1lc3NhZ2VzIGxvY2Fs
IHbDqXJpZmnDqTsgIiArCiAgICBtaWdyYXRlZExvY2FsSW1hZ2VzICsKICAgICIgaW1hZ2UocykgbG9jYWxlKHMpIG1pZ3LDqWUocykuIgogICk7Cn0KLy8g
PT09IFBFT1BMRV9NRVNTQUdFX0VOQ1JZUFRJT05fTUlHUkFUSU9OX1YyX0VORCA9PT0KCmNvbnN0IFBPUlQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuUE9SVCkg
fHwgMzAwMDsKCnBlb3BsZUluaXRBY2NvdW50cygpCiAgLnRoZW4oKCkgPT4gcGVvcGxlSW5pdFNvY2lhbCgpKQogIC50aGVuKCgpID0+IHBlb3BsZUluaXRT
ZXJ2ZXJzVjEoKSkKICAudGhlbigoKSA9PiBwZW9wbGVJbml0U2VydmVyQ2hhbm5lbHNWMigpKQogIC50aGVuKCgpID0+IHBlb3BsZUluaXRTZXJ2ZXJSb2xl
c1YxKCkpCiAgLnRoZW4oKCkgPT4gcGVvcGxlSW5pdFNlcnZlckUyZWVWMSgpKQogIC50aGVuKCgpID0+IHBlb3BsZU1pZ3JhdGVTdG9yZWRNZXNzYWdlRW5j
cnlwdGlvbigpKQogIC8vID09PSBQRU9QTEVfREVMRVRFX0VNUFRZX09OX1NUQVJUVVBfVjEgPT09CiAgLnRoZW4oKCkgPT4gcGVvcGxlRGVsZXRlQWxsRW1w
dHlTZXJ2ZXJzKCkpCiAgLnRoZW4oKCkgPT4gewogICAgc2VydmVyLmxpc3RlbihQT1JULCAiMC4wLjAuMCIsICgpID0+IHsKICAgICAgY29uc29sZS5sb2co
YFBlb3BsZSBsYW5jZSBzdXIgaHR0cDovL2xvY2FsaG9zdDoke1BPUlR9YCk7CiAgICB9KTsKICB9KQogIC5jYXRjaCgoZXJyKSA9PiB7CiAgICBjb25zb2xl
LmVycm9yKAogICAgICAiW1Blb3BsZV0gSW1wb3NzaWJsZSBkJ2luaXRpYWxpc2VyIGxlcyBjb21wdGVzIDoiLAogICAgICBlcnIKICAgICk7CiAgICBwcm9j
ZXNzLmV4aXQoMSk7CiAgfSk7
#</FILE_SERVER>

#<FILE_SOCIAL>
KCgpID0+IHsKICAidXNlIHN0cmljdCI7CgogIGNvbnN0IHNoZWxsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInBlb3BsZUFwcFNoZWxsIik7CiAgY29u
c3QgaG9tZVJhaWxCdXR0b24gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiaG9tZVJhaWxCdXR0b24iKTsKICBjb25zdCBwZW9wbGVSYWlsQnV0dG9uID0g
ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInBlb3BsZVJhaWxCdXR0b24iKTsKICBjb25zdCBob21lVW5yZWFkQmFkZ2UgPSBkb2N1bWVudC5nZXRFbGVtZW50
QnlJZCgiaG9tZVVucmVhZEJhZGdlIik7CiAgY29uc3QgaG9tZVNpZGViYXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiaG9tZVNpZGViYXIiKTsKICBj
b25zdCBwZW9wbGVTaWRlYmFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInBlb3BsZVNpZGViYXIiKTsKICBjb25zdCBwZW9wbGVNYWluID0gZG9jdW1l
bnQuZ2V0RWxlbWVudEJ5SWQoInBlb3BsZU1haW4iKTsKICBjb25zdCBob21lTWFpbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJob21lTWFpbiIpOwog
IGNvbnN0IGZyaWVuZHNOYXZCdXR0b24gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZnJpZW5kc05hdkJ1dHRvbiIpOwogIGNvbnN0IGRtQ29udmVyc2F0
aW9uTGlzdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJkbUNvbnZlcnNhdGlvbkxpc3QiKTsKICBjb25zdCBmcmllbmRzVmlldyA9IGRvY3VtZW50Lmdl
dEVsZW1lbnRCeUlkKCJmcmllbmRzVmlldyIpOwogIGNvbnN0IGRtVmlldyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJkbVZpZXciKTsKICBjb25zdCBw
ZW9wbGVTZWFyY2hJbnB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwZW9wbGVTZWFyY2hJbnB1dCIpOwogIGNvbnN0IGZyaWVuZHNMaXN0ID0gZG9j
dW1lbnQuZ2V0RWxlbWVudEJ5SWQoImZyaWVuZHNMaXN0Iik7CiAgY29uc3QgZnJpZW5kc0NvdW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImZyaWVu
ZHNDb3VudCIpOwovLyA9PT0gUEVPUExFX0ZSSUVORF9SRVFVRVNUU19DTElFTlRfVjJfU1RBUlQgPT09CiAgY29uc3QgZnJpZW5kUmVxdWVzdHNDb3VudCA9
CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZnJpZW5kUmVxdWVzdHNDb3VudCIpOwogIGNvbnN0IGluY29taW5nRnJpZW5kUmVxdWVzdHMgPQogICAg
ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImluY29taW5nRnJpZW5kUmVxdWVzdHMiKTsKICBjb25zdCBvdXRnb2luZ0ZyaWVuZFJlcXVlc3RzID0KICAgIGRv
Y3VtZW50LmdldEVsZW1lbnRCeUlkKCJvdXRnb2luZ0ZyaWVuZFJlcXVlc3RzIik7CiAgLy8gPT09IFBFT1BMRV9GUklFTkRfUkVRVUVTVFNfQ0xJRU5UX1Yy
X0VORCA9PT0KICBjb25zdCBwZW9wbGVEaXJlY3RvcnkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicGVvcGxlRGlyZWN0b3J5Iik7CiAgY29uc3QgcGVv
cGxlRGlyZWN0b3J5U2VjdGlvbiA9CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgKICAgICAgInBlb3BsZURpcmVjdG9yeVNlY3Rpb24iCiAgICApOwog
IGNvbnN0IGhvbWVNYWluVGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiaG9tZU1haW5UaXRsZSIpOwogIGNvbnN0IGhvbWVNYWluU3VidGl0bGUg
PSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiaG9tZU1haW5TdWJ0aXRsZSIpOwoKICBjb25zdCBkbUJhY2tCdXR0b24gPSBkb2N1bWVudC5nZXRFbGVtZW50
QnlJZCgiZG1CYWNrQnV0dG9uIik7CiAgY29uc3QgZG1Qcm9maWxlQnV0dG9uID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImRtUHJvZmlsZUJ1dHRvbiIp
OwogIGNvbnN0IGRtSGVhZGVyQXZhdGFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImRtSGVhZGVyQXZhdGFyIik7CiAgY29uc3QgZG1IZWFkZXJOYW1l
ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoImRtSGVhZGVyTmFtZSIpOwogIGNvbnN0IGRtSGVhZGVyU3RhdHVzID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5
SWQoImRtSGVhZGVyU3RhdHVzIik7CiAgY29uc3QgZG1NZXNzYWdlcyA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJkbU1lc3NhZ2VzIik7CiAgY29uc3Qg
ZG1XZWxjb21lVGl0bGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgiZG1XZWxjb21lVGl0bGUiKTsKICBjb25zdCBkbUZvcm0gPSBkb2N1bWVudC5nZXRF
bGVtZW50QnlJZCgiZG1Gb3JtIik7CiAgY29uc3QgZG1JbnB1dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJkbUlucHV0Iik7CiAgY29uc3QgZG1JbWFn
ZUJ1dHRvbiA9CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgKICAgICAgImRtSW1hZ2VCdXR0b24iCiAgICApOwoKICBjb25zdCBkbUltYWdlSW5wdXQg
PQogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoCiAgICAgICJkbUltYWdlSW5wdXQiCiAgICApOwoKICBjb25zdCBkbUltYWdlUHJldmlldyA9CiAgICBk
b2N1bWVudC5nZXRFbGVtZW50QnlJZCgKICAgICAgImRtSW1hZ2VQcmV2aWV3IgogICAgKTsKCiAgY29uc3QgcGVvcGxlRG1JbWFnZVBpY2tlciA9CiAgICB3
aW5kb3cuUGVvcGxlUmljaENvbnRlbnQKICAgICAgPy5jcmVhdGVJbWFnZVBpY2tlcih7CiAgICAgICAgYnV0dG9uOgogICAgICAgICAgZG1JbWFnZUJ1dHRv
biwKICAgICAgICBpbnB1dDoKICAgICAgICAgIGRtSW1hZ2VJbnB1dCwKICAgICAgICBwcmV2aWV3OgogICAgICAgICAgZG1JbWFnZVByZXZpZXcsCiAgICAg
ICAgcGFzdGVUYXJnZXQ6CiAgICAgICAgICBkbUlucHV0CiAgICAgIH0pOwoKLy8gPT09IFBFT1BMRV9ETV9NRVNTQUdFX0FDVElPTlNfVjFfU1RBUlQgPT09
CiAgY29uc3QgcGVvcGxlRG1SZXBseUNvbnRyb2xsZXIgPQogICAgd2luZG93LlBlb3BsZU1lc3NhZ2VBY3Rpb25zCiAgICAgID8uY3JlYXRlUmVwbHlDb250
cm9sbGVyKHsKICAgICAgICBmb3JtOgogICAgICAgICAgZG1Gb3JtLAogICAgICAgIGlucHV0OgogICAgICAgICAgZG1JbnB1dAogICAgICB9KTsKCiAgYXN5
bmMgZnVuY3Rpb24gcGVvcGxlRGVsZXRlRG1NZXNzYWdlKAogICAgaWQKICApIHsKICAgIGF3YWl0IGFwaSgKICAgICAgIi9hcGkvZG0vbWVzc2FnZS8iICsK
ICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoaWQpLAogICAgICB7CiAgICAgICAgbWV0aG9kOgogICAgICAgICAgIkRFTEVURSIKICAgICAgfQogICAgKTsK
ICB9CiAgLy8gPT09IFBFT1BMRV9ETV9FRElUX1Y2X1NUQVJUID09PQogIGFzeW5jIGZ1bmN0aW9uIHBlb3BsZUVkaXREbU1lc3NhZ2UoCiAgICBpZCwKICAg
IHBsYWluVGV4dAogICkgewogICAgY29uc3QgdGFyZ2V0VXNlcm5hbWUgPQogICAgICBTdHJpbmcoCiAgICAgICAgYWN0aXZlRG1Vc2VyPy51c2VybmFtZSB8
fCAiIgogICAgICApLnRyaW0oKTsKCiAgICBpZiAoIXRhcmdldFVzZXJuYW1lKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAiQ29udmVyc2F0
aW9uIHByaXbDqWUgaW50cm91dmFibGUuIgogICAgICApOwogICAgfQoKICAgIGNvbnN0IGNsZWFuID0KICAgICAgU3RyaW5nKHBsYWluVGV4dCB8fCAiIiku
dHJpbSgpOwoKICAgIGNvbnN0IGVuY3J5cHRlZEJvZHkgPQogICAgICBjbGVhbgogICAgICAgID8gYXdhaXQgcGVvcGxlRG1FMmVlRW5jcnlwdFRleHQoCiAg
ICAgICAgICAgIGNsZWFuLAogICAgICAgICAgICB0YXJnZXRVc2VybmFtZQogICAgICAgICAgKQogICAgICAgIDogIiI7CgogICAgcmV0dXJuIGFwaSgKICAg
ICAgIi9hcGkvZG0vbWVzc2FnZS8iICsKICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoaWQpLAogICAgICB7CiAgICAgICAgbWV0aG9kOiAiUEFUQ0giLAog
ICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsKICAgICAgICAgIGJvZHk6IGVuY3J5cHRlZEJvZHkKICAgICAgICB9KQogICAgICB9CiAgICApOwogIH0K
CiAgZnVuY3Rpb24gcGVvcGxlU3RhcnREbU1lc3NhZ2VFZGl0KAogICAgdW5pdCwKICAgIGlkCiAgKSB7CiAgICB3aW5kb3cuUGVvcGxlTWVzc2FnZUFjdGlv
bnMKICAgICAgPy5zdGFydElubGluZUVkaXQoCiAgICAgICAgdW5pdCwKICAgICAgICB7CiAgICAgICAgICBpbml0aWFsVGV4dDoKICAgICAgICAgICAgdW5p
dD8uZGF0YXNldD8ucGVvcGxlUGxhaW5UZXh0IHx8ICIiLAogICAgICAgICAgbWF4TGVuZ3RoOiAyMDAwLAogICAgICAgICAgYWxsb3dFbXB0eToKICAgICAg
ICAgICAgQm9vbGVhbigKICAgICAgICAgICAgICB1bml0Py5kYXRhc2V0Py5wZW9wbGVJbWFnZUlkCiAgICAgICAgICAgICksCiAgICAgICAgICBvblNhdmU6
CiAgICAgICAgICAgIChuZXh0VGV4dCkgPT4KICAgICAgICAgICAgICBwZW9wbGVFZGl0RG1NZXNzYWdlKAogICAgICAgICAgICAgICAgaWQsCiAgICAgICAg
ICAgICAgICBuZXh0VGV4dAogICAgICAgICAgICAgICkKICAgICAgICB9CiAgICAgICk7CiAgfQogIC8vID09PSBQRU9QTEVfRE1fRURJVF9WNl9FTkQgPT09
CgogIC8vID09PSBQRU9QTEVfRE1fTUVTU0FHRV9BQ1RJT05TX1YxX0VORCA9PT0KCiAgY29uc3QgcHJvZmlsZU1vZGFsID0gZG9jdW1lbnQuZ2V0RWxlbWVu
dEJ5SWQoInByb2ZpbGVNb2RhbCIpOwogIGNvbnN0IHByb2ZpbGVNb2RhbENsb3NlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVNb2RhbENs
b3NlIik7CiAgY29uc3QgcHJvZmlsZU1vZGFsQXZhdGFyID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVNb2RhbEF2YXRhciIpOwogIGNvbnN0
IHByb2ZpbGVBdmF0YXJFZGl0V3JhcCA9CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgKICAgICAgInByb2ZpbGVBdmF0YXJFZGl0V3JhcCIKICAgICk7
CgogIGNvbnN0IHByb2ZpbGVBdmF0YXJVcGxvYWRCdXR0b24gPQogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoCiAgICAgICJwcm9maWxlQXZhdGFyVXBs
b2FkQnV0dG9uIgogICAgKTsKCiAgY29uc3QgcHJvZmlsZUF2YXRhcklucHV0ID0KICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKAogICAgICAicHJvZmls
ZUF2YXRhcklucHV0IgogICAgKTsKICBjb25zdCBwcm9maWxlTW9kYWxOYW1lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVNb2RhbE5hbWUi
KTsKICBjb25zdCBwcm9maWxlTW9kYWxPbmxpbmUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicHJvZmlsZU1vZGFsT25saW5lIik7CiAgY29uc3QgcHJv
ZmlsZURlc2NyaXB0aW9uVGV4dCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwcm9maWxlRGVzY3JpcHRpb25UZXh0Iik7CiAgY29uc3QgcHJvZmlsZUVk
aXRXcmFwID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVFZGl0V3JhcCIpOwogIGNvbnN0IHByb2ZpbGVEZXNjcmlwdGlvbklucHV0ID0gZG9j
dW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVEZXNjcmlwdGlvbklucHV0Iik7CiAgY29uc3QgcHJvZmlsZURlc2NyaXB0aW9uQ291bnQgPSBkb2N1bWVu
dC5nZXRFbGVtZW50QnlJZCgicHJvZmlsZURlc2NyaXB0aW9uQ291bnQiKTsKICBjb25zdCBwcm9maWxlU2F2ZUJ1dHRvbiA9IGRvY3VtZW50LmdldEVsZW1l
bnRCeUlkKCJwcm9maWxlU2F2ZUJ1dHRvbiIpOwogIGNvbnN0IHByb2ZpbGVDcmVhdGVkQXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicHJvZmlsZUNy
ZWF0ZWRBdCIpOwogIGNvbnN0IHByb2ZpbGVBY3Rpb25zID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVBY3Rpb25zIik7CiAgY29uc3QgcHJv
ZmlsZURtQnV0dG9uID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVEbUJ1dHRvbiIpOwogIGNvbnN0IHByb2ZpbGVGcmllbmRCdXR0b24gPSBk
b2N1bWVudC5nZXRFbGVtZW50QnlJZCgicHJvZmlsZUZyaWVuZEJ1dHRvbiIpOwogIGNvbnN0IGF2YXRhckJ1dHRvbiA9IGRvY3VtZW50LmdldEVsZW1lbnRC
eUlkKCJhdmF0YXIiKTsKICBjb25zdCBwcm9maWxlSW5mb0J1dHRvbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwcm9maWxlSW5mb0J1dHRvbiIpOwoK
ICBsZXQgbWUgPSBudWxsOwogIGxldCBhY3RpdmVEbVVzZXIgPSBudWxsOwogIGxldCBjdXJyZW50UHJvZmlsZSA9IG51bGw7CiAgbGV0IGNvbnZlcnNhdGlv
bnMgPSBbXTsKICBsZXQgZGlyZWN0b3J5VGltZXIgPSBudWxsOwogIGxldCBzb2NpYWxSZWFkeSA9IGZhbHNlOwogIGNvbnN0IFBFT1BMRV9EQVRFX1RJTUVf
Rk9STUFUVEVSID0KICAgIG5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KAogICAgICAiZnItRlIiLAogICAgICB7CiAgICAgICAgZGF0ZVN0eWxlOiAic2hvcnQi
LAogICAgICAgIHRpbWVTdHlsZTogInNob3J0IgogICAgICB9CiAgICApOwoKICBjb25zdCBQRU9QTEVfREFURV9GT1JNQVRURVIgPQogICAgbmV3IEludGwu
RGF0ZVRpbWVGb3JtYXQoCiAgICAgICJmci1GUiIsCiAgICAgIHsKICAgICAgICBkYXk6ICJudW1lcmljIiwKICAgICAgICBtb250aDogImxvbmciLAogICAg
ICAgIHllYXI6ICJudW1lcmljIgogICAgICB9CiAgICApOwoKICBjb25zdCBQRU9QTEVfQVZBVEFSX0FDQ0VQVEVEX1RZUEVTID0KICAgIG5ldyBTZXQoWwog
ICAgICAiaW1hZ2UvanBlZyIsCiAgICAgICJpbWFnZS9wbmciLAogICAgICAiaW1hZ2Uvd2VicCIsCiAgICAgICJpbWFnZS9naWYiCiAgICBdKTsKCiAgbGV0
IGNvbnZlcnNhdGlvbnNSZWZyZXNoUHJvbWlzZSA9IG51bGw7CiAgbGV0IGNvbnZlcnNhdGlvbnNSZWZyZXNoUXVldWVkID0gZmFsc2U7CiAgbGV0IGZyaWVu
ZFN1cmZhY2VzUmVmcmVzaFByb21pc2UgPSBudWxsOwogIGxldCBmcmllbmRTdXJmYWNlc1JlZnJlc2hRdWV1ZWQgPSBmYWxzZTsKICBsZXQgb25saW5lVXNl
cnNSZWZyZXNoVGltZXIgPSBudWxsOwogIGxldCBkaXJlY3RvcnlSZXF1ZXN0VmVyc2lvbiA9IDA7CiAgbGV0IGNvbnZlcnNhdGlvbnNCeVVzZXJuYW1lID0g
bmV3IE1hcCgpOwoKICAvLyA9PT0gUEVPUExFX0RNX0lOU1RBTlRfT1BFTl9WM19TVEFSVCA9PT0KICAvLyBDYWNoZSBjb3VydCBlbiBtw6ltb2lyZSA6IHVu
IE1QIGTDqWrDoCBvdXZlcnQgcsOpYXBwYXJhw650IGltbcOpZGlhdGVtZW50LgogIC8vIExlcyByw6lwb25zZXMgcsOpc2VhdSByZXN0ZW50IGxhIHNvdXJj
ZSBkZSB2w6lyaXTDqSBldCByZW1wbGFjZW50IGxlIGNhY2hlCiAgLy8gZMOocyBxdSdlbGxlcyBhcnJpdmVudC4KICBjb25zdCBQRU9QTEVfRE1fVklFV19D
QUNIRV9NQVggPSA4OwogIGNvbnN0IFBFT1BMRV9ETV9ERUNSWVBUX0NBQ0hFX01BWCA9IDE0MDA7CiAgY29uc3QgUEVPUExFX0RNX1BSRUZFVENIX01BWF9B
R0VfTVMgPSAzMDAwMDsKCiAgLy8gSGlzdG9yaXF1ZSBNUCBjaGFyZ2UgcGFyIHBhZ2VzLCBhdmVjIHVuZSBmZW5ldHJlIGJvcm5lZSBlbiBtZW1vaXJlL0RP
TS4KICBjb25zdCBQRU9QTEVfRE1fSElTVE9SWV9QQUdFX1NJWkUgPSA1MDsKICBjb25zdCBQRU9QTEVfRE1fSElTVE9SWV9XSU5ET1dfTUFYID0gMjAwOwog
IGNvbnN0IFBFT1BMRV9ETV9ISVNUT1JZX0VER0VfUFggPSAxNDA7CgogIGNvbnN0IHBlb3BsZURtVmlld0NhY2hlID0gbmV3IE1hcCgpOwogIGNvbnN0IHBl
b3BsZURtRGVjcnlwdENhY2hlID0gbmV3IE1hcCgpOwogIGNvbnN0IHBlb3BsZURtUHJlZmV0Y2hQcm9taXNlcyA9IG5ldyBNYXAoKTsKICBsZXQgcGVvcGxl
RG1Mb2FkUmVxdWVzdFZlcnNpb24gPSAwOwogIGxldCBwZW9wbGVEbVByZWZldGNoVGltZXIgPSBudWxsOwoKICBmdW5jdGlvbiBwZW9wbGVEbVVzZXJuYW1l
S2V5KHZhbHVlKSB7CiAgICByZXR1cm4gU3RyaW5nKHZhbHVlIHx8ICIiKQogICAgICAudHJpbSgpCiAgICAgIC50b0xvY2FsZUxvd2VyQ2FzZSgiZnItRlIi
KTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtVHJpbU1hcChtYXAsIG1heCkgewogICAgd2hpbGUgKG1hcC5zaXplID4gbWF4KSB7CiAgICAgIGNvbnN0IGZp
cnN0ID0gbWFwLmtleXMoKS5uZXh0KCkudmFsdWU7CiAgICAgIGlmIChmaXJzdCA9PT0gdW5kZWZpbmVkKSBicmVhazsKICAgICAgbWFwLmRlbGV0ZShmaXJz
dCk7CiAgICB9CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbVJlbWVtYmVyVmlldygKICAgIHVzZXJuYW1lLAogICAgdXNlciwKICAgIG1lc3NhZ2VzLAogICAg
bWV0YSA9IG51bGwKICApIHsKICAgIGNvbnN0IGtleSA9IHBlb3BsZURtVXNlcm5hbWVLZXkodXNlcm5hbWUpOwogICAgaWYgKCFrZXkpIHJldHVybjsKCiAg
ICBjb25zdCBwcmV2aW91cyA9CiAgICAgIHBlb3BsZURtVmlld0NhY2hlLmdldChrZXkpIHx8CiAgICAgIG51bGw7CgogICAgY29uc3QgdmFsdWUgPSB7CiAg
ICAgIHVzZXI6IHsKICAgICAgICAuLi4odXNlciB8fCB7fSksCiAgICAgICAgdXNlcm5hbWU6IFN0cmluZyh1c2VyPy51c2VybmFtZSB8fCB1c2VybmFtZSB8
fCAiIikKICAgICAgfSwKICAgICAgbWVzc2FnZXM6CiAgICAgICAgQXJyYXkuaXNBcnJheShtZXNzYWdlcykKICAgICAgICAgID8gbWVzc2FnZXMKICAgICAg
ICAgIDogW10sCiAgICAgIGhhc09sZGVyOgogICAgICAgIG1ldGE/Lmhhc09sZGVyID09PSB1bmRlZmluZWQKICAgICAgICAgID8gQm9vbGVhbihwcmV2aW91
cz8uaGFzT2xkZXIpCiAgICAgICAgICA6IEJvb2xlYW4obWV0YS5oYXNPbGRlciksCiAgICAgIGhhc05ld2VyOgogICAgICAgIG1ldGE/Lmhhc05ld2VyID09
PSB1bmRlZmluZWQKICAgICAgICAgID8gQm9vbGVhbihwcmV2aW91cz8uaGFzTmV3ZXIpCiAgICAgICAgICA6IEJvb2xlYW4obWV0YS5oYXNOZXdlciksCiAg
ICAgIHVwZGF0ZWRBdDogRGF0ZS5ub3coKQogICAgfTsKCiAgICAvLyBkZWxldGUgKyBzZXQgPSBlbnRyw6llIHLDqWNlbW1lbnQgdXRpbGlzw6llIMOgIGxh
IGZpbiBkZSBsYSBNYXAuCiAgICBwZW9wbGVEbVZpZXdDYWNoZS5kZWxldGUoa2V5KTsKICAgIHBlb3BsZURtVmlld0NhY2hlLnNldChrZXksIHZhbHVlKTsK
ICAgIHBlb3BsZURtVHJpbU1hcChwZW9wbGVEbVZpZXdDYWNoZSwgUEVPUExFX0RNX1ZJRVdfQ0FDSEVfTUFYKTsKICAgIHZvaWQgd2luZG93LlBlb3BsZU9m
ZmxpbmU/LmNhY2hlRG1WaWV3Py4odXNlcm5hbWUsIHZhbHVlKTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtQ2FjaGVkVmlldyh1c2VybmFtZSkgewogICAg
Y29uc3Qga2V5ID0gcGVvcGxlRG1Vc2VybmFtZUtleSh1c2VybmFtZSk7CiAgICBjb25zdCBjYWNoZWQgPSBwZW9wbGVEbVZpZXdDYWNoZS5nZXQoa2V5KTsK
ICAgIGlmICghY2FjaGVkKSByZXR1cm4gbnVsbDsKCiAgICBwZW9wbGVEbVZpZXdDYWNoZS5kZWxldGUoa2V5KTsKICAgIHBlb3BsZURtVmlld0NhY2hlLnNl
dChrZXksIGNhY2hlZCk7CiAgICByZXR1cm4gY2FjaGVkOwogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1EZWNyeXB0Q2FjaGVLZXkobWVzc2FnZSkgewogICAg
Y29uc3QgcmVwbHkgPSBtZXNzYWdlPy5yZXBseVRvIHx8IG51bGw7CiAgICByZXR1cm4gWwogICAgICBTdHJpbmcobWVzc2FnZT8uaWQgfHwgIiIpLAogICAg
ICBTdHJpbmcobWVzc2FnZT8uYm9keSB8fCAiIiksCiAgICAgIFN0cmluZyhtZXNzYWdlPy5pbWFnZUlkIHx8ICIiKSwKICAgICAgU3RyaW5nKHJlcGx5Py5p
ZCB8fCAiIiksCiAgICAgIFN0cmluZyhyZXBseT8udGV4dCB8fCAiIiksCiAgICAgIFN0cmluZyhyZXBseT8uaW1hZ2VJZCB8fCAiIikKICAgIF0uam9pbigi
XHUwMDFmIik7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBwZW9wbGVEbUUyZWVEZWNyeXB0TWVzc2FnZXNDYWNoZWQobGlzdCkgewogICAgY29uc3QgbWVzc2Fn
ZXMgPSBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdOwoKICAgIHJldHVybiBQcm9taXNlLmFsbCgKICAgICAgbWVzc2FnZXMubWFwKGFzeW5jICht
ZXNzYWdlKSA9PiB7CiAgICAgICAgY29uc3Qga2V5ID0gcGVvcGxlRG1EZWNyeXB0Q2FjaGVLZXkobWVzc2FnZSk7CiAgICAgICAgaWYgKGtleSAmJiBwZW9w
bGVEbURlY3J5cHRDYWNoZS5oYXMoa2V5KSkgewogICAgICAgICAgcmV0dXJuIHBlb3BsZURtRGVjcnlwdENhY2hlLmdldChrZXkpOwogICAgICAgIH0KCiAg
ICAgICAgY29uc3QgZGVjcnlwdGVkID0gYXdhaXQgcGVvcGxlRG1FMmVlRGVjcnlwdE1lc3NhZ2UobWVzc2FnZSk7CgogICAgICAgIGlmIChrZXkpIHsKICAg
ICAgICAgIHBlb3BsZURtRGVjcnlwdENhY2hlLnNldChrZXksIGRlY3J5cHRlZCk7CiAgICAgICAgICBwZW9wbGVEbVRyaW1NYXAoCiAgICAgICAgICAgIHBl
b3BsZURtRGVjcnlwdENhY2hlLAogICAgICAgICAgICBQRU9QTEVfRE1fREVDUllQVF9DQUNIRV9NQVgKICAgICAgICAgICk7CiAgICAgICAgfQoKICAgICAg
ICByZXR1cm4gZGVjcnlwdGVkOwogICAgICB9KQogICAgKTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtQ29udmVyc2F0aW9uVXNlcih1c2VybmFtZSkgewog
ICAgY29uc3Qgd2FudGVkID0gcGVvcGxlRG1Vc2VybmFtZUtleSh1c2VybmFtZSk7CiAgICBpZiAoIXdhbnRlZCkgcmV0dXJuIG51bGw7CgogICAgZm9yIChj
b25zdCBjb252ZXJzYXRpb24gb2YgY29udmVyc2F0aW9uc0J5VXNlcm5hbWUudmFsdWVzKCkpIHsKICAgICAgaWYgKAogICAgICAgIHBlb3BsZURtVXNlcm5h
bWVLZXkoY29udmVyc2F0aW9uPy51c2VyPy51c2VybmFtZSkgPT09IHdhbnRlZAogICAgICApIHsKICAgICAgICByZXR1cm4gY29udmVyc2F0aW9uLnVzZXIg
fHwgbnVsbDsKICAgICAgfQogICAgfQoKICAgIHJldHVybiBudWxsOwogIH0KICAvLyA9PT0gUEVPUExFX0RNX0lOU1RBTlRfT1BFTl9WM19FTkQgPT09Cgog
IC8vID09PSBQRU9QTEVfRE1fT1BUSU1JU1RJQ19WMl9TVEFSVCA9PT0KICAvLyBMZXMgTVAgdGV4dGUgc29udCBhZmZpY2jDqXMgaW1tw6lkaWF0ZW1lbnQs
IGF2YW50IGxlIGNoaWZmcmVtZW50IEUyRUUKICAvLyBldCBhdmFudCBsJ2FsbGVyLXJldG91ciBIVFRQLiBMZXMgbWVzc2FnZXMgcmVzdGVudCBkYW5zIGNl
dHRlIGZpbGUKICAvLyBqdXNxdSfDoCBjb25maXJtYXRpb24gZHUgc2VydmV1ci4KICBjb25zdCBwZW9wbGVEbVBlbmRpbmdNZXNzYWdlcyA9CiAgICBuZXcg
TWFwKCk7CgogIGxldCBwZW9wbGVEbVBlbmRpbmdTZXF1ZW5jZSA9CiAgICAwOwoKICBmdW5jdGlvbiBwZW9wbGVEbUNyZWF0ZVBlbmRpbmdJZCgpIHsKICAg
IHBlb3BsZURtUGVuZGluZ1NlcXVlbmNlICs9CiAgICAgIDE7CgogICAgcmV0dXJuICgKICAgICAgInBlbmRpbmctZG0tIiArCiAgICAgIERhdGUubm93KCku
dG9TdHJpbmcoMzYpICsKICAgICAgIi0iICsKICAgICAgcGVvcGxlRG1QZW5kaW5nU2VxdWVuY2UudG9TdHJpbmcoMzYpCiAgICApOwogIH0KCiAgZnVuY3Rp
b24gcGVvcGxlRG1QZW5kaW5nRm9yKAogICAgdXNlcm5hbWUKICApIHsKICAgIGNvbnN0IHdhbnRlZCA9CiAgICAgIFN0cmluZyh1c2VybmFtZSB8fCAiIikK
ICAgICAgICAudHJpbSgpCiAgICAgICAgLnRvTG9jYWxlTG93ZXJDYXNlKCJmci1GUiIpOwoKICAgIHJldHVybiBbCiAgICAgIC4uLnBlb3BsZURtUGVuZGlu
Z01lc3NhZ2VzLnZhbHVlcygpCiAgICBdCiAgICAgIC5maWx0ZXIoCiAgICAgICAgKGVudHJ5KSA9PgogICAgICAgICAgZW50cnkudXNlcm5hbWVLZXkgPT09
CiAgICAgICAgICB3YW50ZWQKICAgICAgKQogICAgICAuc29ydCgKICAgICAgICAobGVmdCwgcmlnaHQpID0+CiAgICAgICAgICBkbU1lc3NhZ2VUaW1lc3Rh
bXAoCiAgICAgICAgICAgIGxlZnQubWVzc2FnZQogICAgICAgICAgKSAtCiAgICAgICAgICBkbU1lc3NhZ2VUaW1lc3RhbXAoCiAgICAgICAgICAgIHJpZ2h0
Lm1lc3NhZ2UKICAgICAgICAgICkKICAgICAgKTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtQWRkUGVuZGluZygKICAgIHVzZXJuYW1lLAogICAgYm9keQog
ICkgewogICAgY29uc3QgaWQgPQogICAgICBwZW9wbGVEbUNyZWF0ZVBlbmRpbmdJZCgpOwoKICAgIGNvbnN0IGVudHJ5ID0gewogICAgICBpZCwKICAgICAg
dXNlcm5hbWVLZXk6CiAgICAgICAgU3RyaW5nKHVzZXJuYW1lIHx8ICIiKQogICAgICAgICAgLnRyaW0oKQogICAgICAgICAgLnRvTG9jYWxlTG93ZXJDYXNl
KCJmci1GUiIpLAogICAgICBtZXNzYWdlOiB7CiAgICAgICAgc2VuZGVySWQ6CiAgICAgICAgICBTdHJpbmcobWU/LmlkIHx8ICIiKSwKICAgICAgICByZWNp
cGllbnRJZDoKICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgYWN0aXZlRG1Vc2VyPy5pZCB8fCAiIgogICAgICAgICAgKSwKICAgICAgICBib2R5Ogog
ICAgICAgICAgU3RyaW5nKGJvZHkgfHwgIiIpLAogICAgICAgIGltYWdlSWQ6CiAgICAgICAgICBudWxsLAogICAgICAgIHJlcGx5VG86CiAgICAgICAgICBu
dWxsLAogICAgICAgIGNyZWF0ZWRBdDoKICAgICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogICAgICB9CiAgICB9OwoKICAgIHBlb3BsZURtUGVu
ZGluZ01lc3NhZ2VzLnNldCgKICAgICAgaWQsCiAgICAgIGVudHJ5CiAgICApOwoKICAgIHJldHVybiBlbnRyeTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURt
UmVtb3ZlUGVuZGluZygKICAgIGlkCiAgKSB7CiAgICBwZW9wbGVEbVBlbmRpbmdNZXNzYWdlcy5kZWxldGUoCiAgICAgIFN0cmluZyhpZCB8fCAiIikKICAg
ICk7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbVJlbW92ZVBlbmRpbmdFbGVtZW50KAogICAgaWQKICApIHsKICAgIGNvbnN0IHdhbnRlZCA9CiAgICAgIFN0
cmluZyhpZCB8fCAiIik7CgogICAgZG1NZXNzYWdlcwogICAgICA/LnF1ZXJ5U2VsZWN0b3JBbGwoCiAgICAgICAgIltkYXRhLXBlb3BsZS1kbS1wZW5kaW5n
LWlkXSIKICAgICAgKQogICAgICAuZm9yRWFjaCgKICAgICAgICAoZWxlbWVudCkgPT4gewogICAgICAgICAgaWYgKAogICAgICAgICAgICBlbGVtZW50LmRh
dGFzZXQKICAgICAgICAgICAgICAucGVvcGxlRG1QZW5kaW5nSWQgPT09CiAgICAgICAgICAgIHdhbnRlZAogICAgICAgICAgKSB7CiAgICAgICAgICAgIGVs
ZW1lbnQucmVtb3ZlKCk7CiAgICAgICAgICB9CiAgICAgICAgfQogICAgICApOwogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1BcHBlbmRQZW5kaW5nKAogICAg
dXNlcm5hbWUsCiAgICB0YXJnZXQgPSBkbU1lc3NhZ2VzCiAgKSB7CiAgICBpZiAoIXRhcmdldCkgewogICAgICByZXR1cm47CiAgICB9CgogICAgZm9yICgK
ICAgICAgY29uc3QgZW50cnkgb2YKICAgICAgcGVvcGxlRG1QZW5kaW5nRm9yKAogICAgICAgIHVzZXJuYW1lCiAgICAgICkKICAgICkgewogICAgICBjb25z
dCBidWlsdCA9CiAgICAgICAgZG1NZXNzYWdlRWxlbWVudCgKICAgICAgICAgIGVudHJ5Lm1lc3NhZ2UKICAgICAgICApOwoKICAgICAgYnVpbHQucm93LmRh
dGFzZXQKICAgICAgICAucGVvcGxlRG1QZW5kaW5nSWQgPQogICAgICAgIGVudHJ5LmlkOwoKICAgICAgYnVpbHQucm93LmNsYXNzTGlzdC5hZGQoCiAgICAg
ICAgInBlb3BsZS1kbS1wZW5kaW5nIgogICAgICApOwoKICAgICAgdGFyZ2V0LmFwcGVuZENoaWxkKAogICAgICAgIGJ1aWx0LnJvdwogICAgICApOwogICAg
fQogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1TY3JvbGxUb0JvdHRvbSgpIHsKICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgKICAgICAgKCkgPT4gewogICAg
ICAgIGlmICghZG1NZXNzYWdlcykgewogICAgICAgICAgcmV0dXJuOwogICAgICAgIH0KCiAgICAgICAgZG1NZXNzYWdlcy5zY3JvbGxUb3AgPQogICAgICAg
ICAgZG1NZXNzYWdlcy5zY3JvbGxIZWlnaHQ7CiAgICAgIH0KICAgICk7CiAgfQogIC8vID09PSBQRU9QTEVfRE1fT1BUSU1JU1RJQ19WMl9FTkQgPT09Cgog
IGZ1bmN0aW9uIGVzYyh2YWx1ZSkgewogICAgcmV0dXJuIFN0cmluZyh2YWx1ZSB8fCAiIik7CiAgfQoKICBmdW5jdGlvbiBpbml0aWFsc1NvY2lhbCh2YWx1
ZSkgewogICAgY29uc3QgY2xlYW4gPSBTdHJpbmcodmFsdWUgfHwgIj8iKS50cmltKCk7CiAgICByZXR1cm4gY2xlYW4uc2xpY2UoMCwgMikudG9VcHBlckNh
c2UoKSB8fCAiPyI7CiAgfQoKICBmdW5jdGlvbiBmb3JtYXREYXRlKHZhbHVlLCB3aXRoVGltZSA9IGZhbHNlKSB7CiAgICBjb25zdCBkYXRlID0gbmV3IERh
dGUodmFsdWUpOwogICAgaWYgKE51bWJlci5pc05hTihkYXRlLmdldFRpbWUoKSkpIHJldHVybiAi4oCUIjsKCiAgICByZXR1cm4gKAogICAgICB3aXRoVGlt
ZQogICAgICAgID8gUEVPUExFX0RBVEVfVElNRV9GT1JNQVRURVIKICAgICAgICA6IFBFT1BMRV9EQVRFX0ZPUk1BVFRFUgogICAgKS5mb3JtYXQoZGF0ZSk7
CiAgfQoKICBhc3luYyBmdW5jdGlvbiBhcGkodXJsLCBvcHRpb25zID0ge30pIHsKICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7CiAg
ICAgIGNyZWRlbnRpYWxzOiAic2FtZS1vcmlnaW4iLAogICAgICAuLi5vcHRpb25zLAogICAgICBoZWFkZXJzOiB7CiAgICAgICAgLi4uKG9wdGlvbnMuYm9k
eSA/IHsgIkNvbnRlbnQtVHlwZSI6ICJhcHBsaWNhdGlvbi9qc29uIiB9IDoge30pLAogICAgICAgIC4uLihvcHRpb25zLmhlYWRlcnMgfHwge30pCiAgICAg
IH0KICAgIH0pOwoKICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZQogICAgICAuanNvbigpCiAgICAgIC5jYXRjaCgoKSA9PiAoe30pKTsKCiAgICBp
ZiAoIXJlc3BvbnNlLm9rIHx8IGRhdGEub2sgPT09IGZhbHNlKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICBkYXRhLmVycm9yIHx8ICJVbmUg
ZXJyZXVyIGVzdCBzdXJ2ZW51ZS4iCiAgICAgICk7CiAgICB9CgogICAgcmV0dXJuIGRhdGE7CiAgfQoKICAvLyA9PT0gUEVPUExFX0RNX0UyRUVfQ0xJRU5U
X1YxX1NUQVJUID09PQogIGNvbnN0IFBFT1BMRV9ETV9FMkVFX1BSRUZJWCA9CiAgICAicGVvcGxlLWUyZWUtZG06djE6IjsKCiAgY29uc3QgUEVPUExFX0RN
X0UyRUVfREIgPQogICAgInBlb3BsZS1lMmVlLXYxIjsKCiAgY29uc3QgUEVPUExFX0RNX0UyRUVfU1RPUkUgPQogICAgImRldmljZXMiOwoKICBjb25zdCBw
ZW9wbGVEbUUyZWVFbmNvZGVyID0KICAgIG5ldyBUZXh0RW5jb2RlcigpOwoKICBjb25zdCBwZW9wbGVEbUUyZWVEZWNvZGVyID0KICAgIG5ldyBUZXh0RGVj
b2RlcigpOwoKICBjb25zdCBQRU9QTEVfRE1fRTJFRV9JTUFHRV9NSU1FID0KICAgICJhcHBsaWNhdGlvbi94LXBlb3BsZS1lMmVlLWltYWdlIjsKCiAgY29u
c3QgUEVPUExFX0RNX0UyRUVfSU1BR0VfTUFHSUMgPQogICAgcGVvcGxlRG1FMmVlRW5jb2Rlci5lbmNvZGUoCiAgICAgICJQRU9QTEUtRTJFRS1JTUFHRS1W
MVxuIgogICAgKTsKCiAgY29uc3QgUEVPUExFX0RNX0UyRUVfSU1BR0VfTUFYX0JZVEVTID0KICAgIDI1ICogMTAyNCAqIDEwMjQ7CgogIGNvbnN0IFBFT1BM
RV9ETV9FMkVFX0lNQUdFX1RZUEVTID0KICAgIG5ldyBTZXQoWwogICAgICAiaW1hZ2UvanBlZyIsCiAgICAgICJpbWFnZS9wbmciLAogICAgICAiaW1hZ2Uv
d2VicCIsCiAgICAgICJpbWFnZS9naWYiCiAgICBdKTsKCiAgY29uc3QgcGVvcGxlRG1FMmVlSW1hZ2VDYWNoZSA9CiAgICBuZXcgTWFwKCk7CgogIGxldCBw
ZW9wbGVEbUUyZWVEYlByb21pc2UgPQogICAgbnVsbDsKCiAgbGV0IHBlb3BsZURtRTJlZURldmljZVByb21pc2UgPQogICAgbnVsbDsKCiAgbGV0IHBlb3Bs
ZURtRTJlZUFjdGl2ZUFjY291bnRJZCA9CiAgICAiIjsKCiAgY29uc3QgcGVvcGxlRG1FMmVlRGVyaXZlZEtleUNhY2hlID0KICAgIG5ldyBNYXAoKTsKCiAg
ZnVuY3Rpb24gcGVvcGxlRG1FMmVlQnl0ZXNUb0Jhc2U2NFVybCgKICAgIHZhbHVlCiAgKSB7CiAgICBjb25zdCBieXRlcyA9CiAgICAgIHZhbHVlIGluc3Rh
bmNlb2YgVWludDhBcnJheQogICAgICAgID8gdmFsdWUKICAgICAgICA6IG5ldyBVaW50OEFycmF5KAogICAgICAgICAgICB2YWx1ZQogICAgICAgICAgKTsK
CiAgICBsZXQgYmluYXJ5ID0KICAgICAgIiI7CgogICAgZm9yICgKICAgICAgbGV0IGluZGV4ID0gMDsKICAgICAgaW5kZXggPCBieXRlcy5sZW5ndGg7CiAg
ICAgIGluZGV4ICs9IDEKICAgICkgewogICAgICBiaW5hcnkgKz0KICAgICAgICBTdHJpbmcuZnJvbUNoYXJDb2RlKAogICAgICAgICAgYnl0ZXNbaW5kZXhd
CiAgICAgICAgKTsKICAgIH0KCiAgICByZXR1cm4gYnRvYShiaW5hcnkpCiAgICAgIC5yZXBsYWNlKC9cKy9nLCAiLSIpCiAgICAgIC5yZXBsYWNlKC9cLy9n
LCAiXyIpCiAgICAgIC5yZXBsYWNlKC89KyQvZywgIiIpOwogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1FMmVlQmFzZTY0VXJsVG9CeXRlcygKICAgIHZhbHVl
CiAgKSB7CiAgICBjb25zdCByYXcgPQogICAgICBTdHJpbmcodmFsdWUgfHwgIiIpOwoKICAgIGNvbnN0IGJhc2U2NCA9CiAgICAgIHJhdwogICAgICAgIC5y
ZXBsYWNlKC8tL2csICIrIikKICAgICAgICAucmVwbGFjZSgvXy9nLCAiLyIpCiAgICAgICAgLnBhZEVuZCgKICAgICAgICAgIE1hdGguY2VpbCgKICAgICAg
ICAgICAgcmF3Lmxlbmd0aCAvIDQKICAgICAgICAgICkgKiA0LAogICAgICAgICAgIj0iCiAgICAgICAgKTsKCiAgICBjb25zdCBiaW5hcnkgPQogICAgICBh
dG9iKGJhc2U2NCk7CgogICAgY29uc3QgYnl0ZXMgPQogICAgICBuZXcgVWludDhBcnJheSgKICAgICAgICBiaW5hcnkubGVuZ3RoCiAgICAgICk7CgogICAg
Zm9yICgKICAgICAgbGV0IGluZGV4ID0gMDsKICAgICAgaW5kZXggPCBiaW5hcnkubGVuZ3RoOwogICAgICBpbmRleCArPSAxCiAgICApIHsKICAgICAgYnl0
ZXNbaW5kZXhdID0KICAgICAgICBiaW5hcnkuY2hhckNvZGVBdCgKICAgICAgICAgIGluZGV4CiAgICAgICAgKTsKICAgIH0KCiAgICByZXR1cm4gYnl0ZXM7
CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbUUyZWVFbmNvZGVKc29uKAogICAgdmFsdWUKICApIHsKICAgIHJldHVybiBwZW9wbGVEbUUyZWVCeXRlc1RvQmFz
ZTY0VXJsKAogICAgICBwZW9wbGVEbUUyZWVFbmNvZGVyLmVuY29kZSgKICAgICAgICBKU09OLnN0cmluZ2lmeSgKICAgICAgICAgIHZhbHVlCiAgICAgICAg
KQogICAgICApCiAgICApOwogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1FMmVlRGVjb2RlRW52ZWxvcGUoCiAgICB2YWx1ZQogICkgewogICAgY29uc3QgYm9k
eSA9CiAgICAgIFN0cmluZyh2YWx1ZSB8fCAiIik7CgogICAgaWYgKAogICAgICAhYm9keS5zdGFydHNXaXRoKAogICAgICAgIFBFT1BMRV9ETV9FMkVFX1BS
RUZJWAogICAgICApCiAgICApIHsKICAgICAgcmV0dXJuIG51bGw7CiAgICB9CgogICAgdHJ5IHsKICAgICAgY29uc3QgZW52ZWxvcGUgPQogICAgICAgIEpT
T04ucGFyc2UoCiAgICAgICAgICBwZW9wbGVEbUUyZWVEZWNvZGVyLmRlY29kZSgKICAgICAgICAgICAgcGVvcGxlRG1FMmVlQmFzZTY0VXJsVG9CeXRlcygK
ICAgICAgICAgICAgICBib2R5LnNsaWNlKAogICAgICAgICAgICAgICAgUEVPUExFX0RNX0UyRUVfUFJFRklYLmxlbmd0aAogICAgICAgICAgICAgICkKICAg
ICAgICAgICAgKQogICAgICAgICAgKQogICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgZW52ZWxvcGU/LnYgIT09IDEgfHwKICAgICAgICAhZW52ZWxv
cGU/LmZyb20gfHwKICAgICAgICAhZW52ZWxvcGU/LnRvIHx8CiAgICAgICAgIWVudmVsb3BlPy5zZCB8fAogICAgICAgICFlbnZlbG9wZT8uc3BrIHx8CiAg
ICAgICAgIWVudmVsb3BlPy5pdiB8fAogICAgICAgICFlbnZlbG9wZT8uY3QgfHwKICAgICAgICAhQXJyYXkuaXNBcnJheSgKICAgICAgICAgIGVudmVsb3Bl
Py5rZXlzCiAgICAgICAgKQogICAgICApIHsKICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgfQoKICAgICAgcmV0dXJuIGVudmVsb3BlOwogICAgfSBjYXRj
aCB7CiAgICAgIHJldHVybiBudWxsOwogICAgfQogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1FMmVlT3BlbkRiKCkgewogICAgaWYgKHBlb3BsZURtRTJlZURi
UHJvbWlzZSkgewogICAgICByZXR1cm4gcGVvcGxlRG1FMmVlRGJQcm9taXNlOwogICAgfQoKICAgIHBlb3BsZURtRTJlZURiUHJvbWlzZSA9CiAgICAgIG5l
dyBQcm9taXNlKAogICAgICAgICgKICAgICAgICAgIHJlc29sdmUsCiAgICAgICAgICByZWplY3QKICAgICAgICApID0+IHsKICAgICAgICAgIGNvbnN0IHJl
cXVlc3QgPQogICAgICAgICAgICBpbmRleGVkREIub3BlbigKICAgICAgICAgICAgICBQRU9QTEVfRE1fRTJFRV9EQiwKICAgICAgICAgICAgICAxCiAgICAg
ICAgICAgICk7CgogICAgICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPQogICAgICAgICAgICAoKSA9PiB7CiAgICAgICAgICAgICAgY29uc3QgZGIg
PQogICAgICAgICAgICAgICAgcmVxdWVzdC5yZXN1bHQ7CgogICAgICAgICAgICAgIGlmICgKICAgICAgICAgICAgICAgICFkYi5vYmplY3RTdG9yZU5hbWVz
CiAgICAgICAgICAgICAgICAgIC5jb250YWlucygKICAgICAgICAgICAgICAgICAgICBQRU9QTEVfRE1fRTJFRV9TVE9SRQogICAgICAgICAgICAgICAgICAp
CiAgICAgICAgICAgICAgKSB7CiAgICAgICAgICAgICAgICBkYi5jcmVhdGVPYmplY3RTdG9yZSgKICAgICAgICAgICAgICAgICAgUEVPUExFX0RNX0UyRUVf
U1RPUkUsCiAgICAgICAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgICAgICBrZXlQYXRoOgogICAgICAgICAgICAgICAgICAgICAgImFjY291bnRJZCIK
ICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgKTsKICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH07CgogICAgICAgICAgcmVxdWVzdC5v
bnN1Y2Nlc3MgPQogICAgICAgICAgICAoKSA9PgogICAgICAgICAgICAgIHJlc29sdmUoCiAgICAgICAgICAgICAgICByZXF1ZXN0LnJlc3VsdAogICAgICAg
ICAgICAgICk7CgogICAgICAgICAgcmVxdWVzdC5vbmVycm9yID0KICAgICAgICAgICAgKCkgPT4KICAgICAgICAgICAgICByZWplY3QoCiAgICAgICAgICAg
ICAgICByZXF1ZXN0LmVycm9yIHx8CiAgICAgICAgICAgICAgICBuZXcgRXJyb3IoCiAgICAgICAgICAgICAgICAgICJJbmRleGVkREIgRTJFRSBpbmRpc3Bv
bmlibGUuIgogICAgICAgICAgICAgICAgKQogICAgICAgICAgICAgICk7CiAgICAgICAgfQogICAgICApOwoKICAgIHJldHVybiBwZW9wbGVEbUUyZWVEYlBy
b21pc2U7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBwZW9wbGVEbUUyZWVSZWFkRGV2aWNlKAogICAgYWNjb3VudElkCiAgKSB7CiAgICBjb25zdCBkYiA9CiAg
ICAgIGF3YWl0IHBlb3BsZURtRTJlZU9wZW5EYigpOwoKICAgIHJldHVybiBuZXcgUHJvbWlzZSgKICAgICAgKAogICAgICAgIHJlc29sdmUsCiAgICAgICAg
cmVqZWN0CiAgICAgICkgPT4gewogICAgICAgIGNvbnN0IHR4ID0KICAgICAgICAgIGRiLnRyYW5zYWN0aW9uKAogICAgICAgICAgICBQRU9QTEVfRE1fRTJF
RV9TVE9SRSwKICAgICAgICAgICAgInJlYWRvbmx5IgogICAgICAgICAgKTsKCiAgICAgICAgY29uc3QgcmVxdWVzdCA9CiAgICAgICAgICB0eAogICAgICAg
ICAgICAub2JqZWN0U3RvcmUoCiAgICAgICAgICAgICAgUEVPUExFX0RNX0UyRUVfU1RPUkUKICAgICAgICAgICAgKQogICAgICAgICAgICAuZ2V0KAogICAg
ICAgICAgICAgIFN0cmluZyhhY2NvdW50SWQpCiAgICAgICAgICAgICk7CgogICAgICAgIHJlcXVlc3Qub25zdWNjZXNzID0KICAgICAgICAgICgpID0+CiAg
ICAgICAgICAgIHJlc29sdmUoCiAgICAgICAgICAgICAgcmVxdWVzdC5yZXN1bHQgfHwKICAgICAgICAgICAgICBudWxsCiAgICAgICAgICAgICk7CgogICAg
ICAgIHJlcXVlc3Qub25lcnJvciA9CiAgICAgICAgICAoKSA9PgogICAgICAgICAgICByZWplY3QoCiAgICAgICAgICAgICAgcmVxdWVzdC5lcnJvcgogICAg
ICAgICAgICApOwogICAgICB9CiAgICApOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1FMmVlV3JpdGVEZXZpY2UoCiAgICByZWNvcmQKICApIHsK
ICAgIGNvbnN0IGRiID0KICAgICAgYXdhaXQgcGVvcGxlRG1FMmVlT3BlbkRiKCk7CgogICAgcmV0dXJuIG5ldyBQcm9taXNlKAogICAgICAoCiAgICAgICAg
cmVzb2x2ZSwKICAgICAgICByZWplY3QKICAgICAgKSA9PiB7CiAgICAgICAgY29uc3QgdHggPQogICAgICAgICAgZGIudHJhbnNhY3Rpb24oCiAgICAgICAg
ICAgIFBFT1BMRV9ETV9FMkVFX1NUT1JFLAogICAgICAgICAgICAicmVhZHdyaXRlIgogICAgICAgICAgKTsKCiAgICAgICAgdHgub2JqZWN0U3RvcmUoCiAg
ICAgICAgICBQRU9QTEVfRE1fRTJFRV9TVE9SRQogICAgICAgICkucHV0KAogICAgICAgICAgcmVjb3JkCiAgICAgICAgKTsKCiAgICAgICAgdHgub25jb21w
bGV0ZSA9CiAgICAgICAgICAoKSA9PgogICAgICAgICAgICByZXNvbHZlKCk7CgogICAgICAgIHR4Lm9uZXJyb3IgPQogICAgICAgICAgKCkgPT4KICAgICAg
ICAgICAgcmVqZWN0KAogICAgICAgICAgICAgIHR4LmVycm9yCiAgICAgICAgICAgICk7CgogICAgICAgIHR4Lm9uYWJvcnQgPQogICAgICAgICAgKCkgPT4K
ICAgICAgICAgICAgcmVqZWN0KAogICAgICAgICAgICAgIHR4LmVycm9yCiAgICAgICAgICAgICk7CiAgICAgIH0KICAgICk7CiAgfQoKICBmdW5jdGlvbiBw
ZW9wbGVEbUUyZWVOZXdEZXZpY2VJZCgpIHsKICAgIGlmIChjcnlwdG8ucmFuZG9tVVVJRCkgewogICAgICByZXR1cm4gKAogICAgICAgICJkZXZfIiArCiAg
ICAgICAgY3J5cHRvLnJhbmRvbVVVSUQoKQogICAgICAgICAgLnJlcGxhY2UoCiAgICAgICAgICAgIC8tL2csCiAgICAgICAgICAgICJfIgogICAgICAgICAg
KQogICAgICApOwogICAgfQoKICAgIHJldHVybiAoCiAgICAgICJkZXZfIiArCiAgICAgIHBlb3BsZURtRTJlZUJ5dGVzVG9CYXNlNjRVcmwoCiAgICAgICAg
Y3J5cHRvLmdldFJhbmRvbVZhbHVlcygKICAgICAgICAgIG5ldyBVaW50OEFycmF5KAogICAgICAgICAgICAyNAogICAgICAgICAgKQogICAgICAgICkKICAg
ICAgKQogICAgKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtRTJlZUNyZWF0ZURldmljZSgKICAgIGFjY291bnRJZAogICkgewogICAgaWYgKAog
ICAgICAhd2luZG93LmNyeXB0bz8uc3VidGxlIHx8CiAgICAgICF3aW5kb3cuaW5kZXhlZERCCiAgICApIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAg
ICAgICJDZSBuYXZpZ2F0ZXVyIG5lIHBlcm1ldCBwYXMgbCdFMkVFIFBlb3BsZS4iCiAgICAgICk7CiAgICB9CgogICAgLyoKICAgICAgTGEgcGFpcmUgZXN0
IGfDqW7DqXLDqWUgZXhwb3J0YWJsZSB1bmlxdWVtZW50IGxlIHRlbXBzCiAgICAgIGQnZXh0cmFpcmUgbGUgSldLIHB1YmxpYy4gTGEgY2zDqSBwcml2w6ll
IHN0b2Nrw6llIGVuc3VpdGUKICAgICAgZXN0IHLDqWltcG9ydMOpZSBOT04gZXhwb3J0YWJsZS4KICAgICovCiAgICBjb25zdCBnZW5lcmF0ZWQgPQogICAg
ICBhd2FpdCBjcnlwdG8uc3VidGxlLmdlbmVyYXRlS2V5KAogICAgICAgIHsKICAgICAgICAgIG5hbWU6CiAgICAgICAgICAgICJFQ0RIIiwKICAgICAgICAg
IG5hbWVkQ3VydmU6CiAgICAgICAgICAgICJQLTI1NiIKICAgICAgICB9LAogICAgICAgIHRydWUsCiAgICAgICAgWwogICAgICAgICAgImRlcml2ZUJpdHMi
CiAgICAgICAgXQogICAgICApOwoKICAgIGNvbnN0IHB1YmxpY0p3ayA9CiAgICAgIGF3YWl0IGNyeXB0by5zdWJ0bGUuZXhwb3J0S2V5KAogICAgICAgICJq
d2siLAogICAgICAgIGdlbmVyYXRlZC5wdWJsaWNLZXkKICAgICAgKTsKCiAgICBjb25zdCBwcml2YXRlSndrID0KICAgICAgYXdhaXQgY3J5cHRvLnN1YnRs
ZS5leHBvcnRLZXkoCiAgICAgICAgImp3ayIsCiAgICAgICAgZ2VuZXJhdGVkLnByaXZhdGVLZXkKICAgICAgKTsKCiAgICBjb25zdCBwcml2YXRlS2V5ID0K
ICAgICAgYXdhaXQgY3J5cHRvLnN1YnRsZS5pbXBvcnRLZXkoCiAgICAgICAgImp3ayIsCiAgICAgICAgcHJpdmF0ZUp3aywKICAgICAgICB7CiAgICAgICAg
ICBuYW1lOgogICAgICAgICAgICAiRUNESCIsCiAgICAgICAgICBuYW1lZEN1cnZlOgogICAgICAgICAgICAiUC0yNTYiCiAgICAgICAgfSwKICAgICAgICBm
YWxzZSwKICAgICAgICBbCiAgICAgICAgICAiZGVyaXZlQml0cyIKICAgICAgICBdCiAgICAgICk7CgogICAgY29uc3QgcmVjb3JkID0gewogICAgICBhY2Nv
dW50SWQ6CiAgICAgICAgU3RyaW5nKGFjY291bnRJZCksCiAgICAgIGRldmljZUlkOgogICAgICAgIHBlb3BsZURtRTJlZU5ld0RldmljZUlkKCksCiAgICAg
IHByaXZhdGVLZXksCiAgICAgIHB1YmxpY0p3azogewogICAgICAgIGt0eToKICAgICAgICAgIHB1YmxpY0p3ay5rdHksCiAgICAgICAgY3J2OgogICAgICAg
ICAgcHVibGljSndrLmNydiwKICAgICAgICB4OgogICAgICAgICAgcHVibGljSndrLngsCiAgICAgICAgeToKICAgICAgICAgIHB1YmxpY0p3ay55LAogICAg
ICAgIGV4dDoKICAgICAgICAgIHRydWUKICAgICAgfSwKICAgICAgY3JlYXRlZEF0OgogICAgICAgIERhdGUubm93KCkKICAgIH07CgogICAgYXdhaXQgcGVv
cGxlRG1FMmVlV3JpdGVEZXZpY2UoCiAgICAgIHJlY29yZAogICAgKTsKCiAgICByZXR1cm4gcmVjb3JkOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gcGVvcGxl
RG1FMmVlRW5zdXJlRGV2aWNlKCkgewogICAgaWYgKCFtZT8uaWQpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICJDb21wdGUgUGVvcGxlIGlu
ZGlzcG9uaWJsZSBwb3VyIEUyRUUuIgogICAgICApOwogICAgfQoKICAgIGNvbnN0IGFjY291bnRJZCA9CiAgICAgIFN0cmluZyhtZS5pZCk7CgogICAgLyoK
ICAgICAgRMOpY29ubmV4aW9uIC8gY29ubmV4aW9uIGQndW4gYXV0cmUgY29tcHRlIDoKICAgICAgamFtYWlzIGRlIHLDqXV0aWxpc2F0aW9uIGRlIGxhIGNs
w6kgcHJpdsOpZSBwcsOpY8OpZGVudGUuCiAgICAqLwogICAgaWYgKAogICAgICBwZW9wbGVEbUUyZWVBY3RpdmVBY2NvdW50SWQgIT09CiAgICAgICAgYWNj
b3VudElkCiAgICApIHsKICAgICAgcGVvcGxlRG1FMmVlQWN0aXZlQWNjb3VudElkID0KICAgICAgICBhY2NvdW50SWQ7CgogICAgICBwZW9wbGVEbUUyZWVE
ZXZpY2VQcm9taXNlID0KICAgICAgICBudWxsOwoKICAgICAgcGVvcGxlRG1FMmVlRGVyaXZlZEtleUNhY2hlLmNsZWFyKCk7CiAgICAgIHBlb3BsZURtRTJl
ZUltYWdlQ2FjaGUuY2xlYXIoKTsKICAgIH0KCiAgICBpZiAocGVvcGxlRG1FMmVlRGV2aWNlUHJvbWlzZSkgewogICAgICByZXR1cm4gcGVvcGxlRG1FMmVl
RGV2aWNlUHJvbWlzZTsKICAgIH0KCiAgICBwZW9wbGVEbUUyZWVEZXZpY2VQcm9taXNlID0KICAgICAgKAogICAgICAgIGFzeW5jICgpID0+IHsKICAgICAg
ICAgIGxldCByZWNvcmQgPQogICAgICAgICAgICBhd2FpdCBwZW9wbGVEbUUyZWVSZWFkRGV2aWNlKAogICAgICAgICAgICAgIGFjY291bnRJZAogICAgICAg
ICAgICApOwoKICAgICAgICAgIGlmICgKICAgICAgICAgICAgIXJlY29yZD8uZGV2aWNlSWQgfHwKICAgICAgICAgICAgIXJlY29yZD8ucHJpdmF0ZUtleSB8
fAogICAgICAgICAgICAhcmVjb3JkPy5wdWJsaWNKd2sKICAgICAgICAgICkgewogICAgICAgICAgICByZWNvcmQgPQogICAgICAgICAgICAgIGF3YWl0IHBl
b3BsZURtRTJlZUNyZWF0ZURldmljZSgKICAgICAgICAgICAgICAgIGFjY291bnRJZAogICAgICAgICAgICAgICk7CiAgICAgICAgICB9CgogICAgICAgICAg
aWYgKG5hdmlnYXRvci5vbkxpbmUgIT09IGZhbHNlKSB7CiAgICAgICAgICAgIGF3YWl0IGFwaSgKICAgICAgICAgICAgICAiL2FwaS9lMmVlL2RldmljZSIs
CiAgICAgICAgICAgICAgewogICAgICAgICAgICAgICAgbWV0aG9kOgogICAgICAgICAgICAgICAgICAiUE9TVCIsCiAgICAgICAgICAgICAgICBib2R5Ogog
ICAgICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7CiAgICAgICAgICAgICAgICAgICAgZGV2aWNlSWQ6CiAgICAgICAgICAgICAgICAgICAgICByZWNv
cmQuZGV2aWNlSWQsCiAgICAgICAgICAgICAgICAgICAgcHVibGljSndrOgogICAgICAgICAgICAgICAgICAgICAgcmVjb3JkLnB1YmxpY0p3awogICAgICAg
ICAgICAgICAgICB9KQogICAgICAgICAgICAgIH0KICAgICAgICAgICAgKTsKICAgICAgICAgIH0KCiAgICAgICAgICByZXR1cm4gcmVjb3JkOwogICAgICAg
IH0KICAgICAgKSgpOwoKICAgIHRyeSB7CiAgICAgIHJldHVybiBhd2FpdCBwZW9wbGVEbUUyZWVEZXZpY2VQcm9taXNlOwogICAgfSBjYXRjaCAoZXJyKSB7
CiAgICAgIHBlb3BsZURtRTJlZURldmljZVByb21pc2UgPQogICAgICAgIG51bGw7CgogICAgICB0aHJvdyBlcnI7CiAgICB9CiAgfQoKICBhc3luYyBmdW5j
dGlvbiBwZW9wbGVEbUUyZWVJbXBvcnRQdWJsaWNLZXkoCiAgICBwdWJsaWNKd2sKICApIHsKICAgIHJldHVybiBjcnlwdG8uc3VidGxlLmltcG9ydEtleSgK
ICAgICAgImp3ayIsCiAgICAgIHB1YmxpY0p3aywKICAgICAgewogICAgICAgIG5hbWU6CiAgICAgICAgICAiRUNESCIsCiAgICAgICAgbmFtZWRDdXJ2ZToK
ICAgICAgICAgICJQLTI1NiIKICAgICAgfSwKICAgICAgZmFsc2UsCiAgICAgIFtdCiAgICApOwogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1FMmVlUGFpclNh
bHQoCiAgICBmcm9tLAogICAgdG8KICApIHsKICAgIHJldHVybiBwZW9wbGVEbUUyZWVFbmNvZGVyLmVuY29kZSgKICAgICAgIlBlb3BsZSBFMkVFIERNIHNh
bHQgdjF8IiArCiAgICAgIFN0cmluZyhmcm9tKSArCiAgICAgICJ8IiArCiAgICAgIFN0cmluZyh0bykKICAgICk7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVE
bUUyZWVXcmFwSW5mbygKICAgIHNlbmRlckRldmljZSwKICAgIHRhcmdldFVzZXIsCiAgICB0YXJnZXREZXZpY2UKICApIHsKICAgIHJldHVybiBwZW9wbGVE
bUUyZWVFbmNvZGVyLmVuY29kZSgKICAgICAgIlBlb3BsZSBFMkVFIERNIHdyYXAgdjF8IiArCiAgICAgIFN0cmluZyhzZW5kZXJEZXZpY2UpICsKICAgICAg
InwiICsKICAgICAgU3RyaW5nKHRhcmdldFVzZXIpICsKICAgICAgInwiICsKICAgICAgU3RyaW5nKHRhcmdldERldmljZSkKICAgICk7CiAgfQoKICBmdW5j
dGlvbiBwZW9wbGVEbUUyZWVXcmFwQWFkKAogICAgZnJvbSwKICAgIHRvLAogICAgc2VuZGVyRGV2aWNlLAogICAgdGFyZ2V0VXNlciwKICAgIHRhcmdldERl
dmljZQogICkgewogICAgcmV0dXJuIHBlb3BsZURtRTJlZUVuY29kZXIuZW5jb2RlKAogICAgICAiUGVvcGxlIEUyRUUgRE0ga2V5IHYxfCIgKwogICAgICBT
dHJpbmcoZnJvbSkgKwogICAgICAifCIgKwogICAgICBTdHJpbmcodG8pICsKICAgICAgInwiICsKICAgICAgU3RyaW5nKHNlbmRlckRldmljZSkgKwogICAg
ICAifCIgKwogICAgICBTdHJpbmcodGFyZ2V0VXNlcikgKwogICAgICAifCIgKwogICAgICBTdHJpbmcodGFyZ2V0RGV2aWNlKQogICAgKTsKICB9CgogIGZ1
bmN0aW9uIHBlb3BsZURtRTJlZU1lc3NhZ2VBYWQoCiAgICBmcm9tLAogICAgdG8sCiAgICBzZW5kZXJEZXZpY2UKICApIHsKICAgIHJldHVybiBwZW9wbGVE
bUUyZWVFbmNvZGVyLmVuY29kZSgKICAgICAgIlBlb3BsZSBFMkVFIERNIG1lc3NhZ2UgdjF8IiArCiAgICAgIFN0cmluZyhmcm9tKSArCiAgICAgICJ8IiAr
CiAgICAgIFN0cmluZyh0bykgKwogICAgICAifCIgKwogICAgICBTdHJpbmcoc2VuZGVyRGV2aWNlKQogICAgKTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURt
RTJlZUltYWdlQWFkKAogICAgZnJvbSwKICAgIHRvLAogICAgc2VuZGVyRGV2aWNlLAogICAgbWltZSwKICAgIHNpemUsCiAgICBuYW1lID0gIiIsCiAgICB2
ZXJzaW9uID0gMQogICkgewogICAgaWYgKE51bWJlcih2ZXJzaW9uKSA+PSAyKSB7CiAgICAgIHJldHVybiBwZW9wbGVEbUUyZWVFbmNvZGVyLmVuY29kZSgK
ICAgICAgICAiUGVvcGxlIEUyRUUgRE0gYXR0YWNobWVudCB2MnwiICsKICAgICAgICBTdHJpbmcoZnJvbSkgKyAifCIgKwogICAgICAgIFN0cmluZyh0bykg
KyAifCIgKwogICAgICAgIFN0cmluZyhzZW5kZXJEZXZpY2UpICsgInwiICsKICAgICAgICBTdHJpbmcobWltZSkgKyAifCIgKwogICAgICAgIFN0cmluZyhz
aXplKSArICJ8IiArCiAgICAgICAgU3RyaW5nKG5hbWUpCiAgICAgICk7CiAgICB9CgogICAgcmV0dXJuIHBlb3BsZURtRTJlZUVuY29kZXIuZW5jb2RlKAog
ICAgICAiUGVvcGxlIEUyRUUgRE0gaW1hZ2UgdjF8IiArCiAgICAgIFN0cmluZyhmcm9tKSArICJ8IiArCiAgICAgIFN0cmluZyh0bykgKyAifCIgKwogICAg
ICBTdHJpbmcoc2VuZGVyRGV2aWNlKSArICJ8IiArCiAgICAgIFN0cmluZyhtaW1lKSArICJ8IiArCiAgICAgIFN0cmluZyhzaXplKQogICAgKTsKICB9Cgog
IGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtRTJlZURlcml2ZVdyYXBLZXkoCiAgICBwcml2YXRlS2V5LAogICAgcGVlclB1YmxpY0p3aywKICAgIGZyb20sCiAg
ICB0bywKICAgIHNlbmRlckRldmljZSwKICAgIHRhcmdldFVzZXIsCiAgICB0YXJnZXREZXZpY2UKICApIHsKICAgIGNvbnN0IGNhY2hlS2V5ID0KICAgICAg
WwogICAgICAgIGZyb20sCiAgICAgICAgdG8sCiAgICAgICAgc2VuZGVyRGV2aWNlLAogICAgICAgIHRhcmdldFVzZXIsCiAgICAgICAgdGFyZ2V0RGV2aWNl
LAogICAgICAgIHBlZXJQdWJsaWNKd2s/LngsCiAgICAgICAgcGVlclB1YmxpY0p3az8ueQogICAgICBdLmpvaW4oCiAgICAgICAgInwiCiAgICAgICk7Cgog
ICAgaWYgKAogICAgICBwZW9wbGVEbUUyZWVEZXJpdmVkS2V5Q2FjaGUuaGFzKAogICAgICAgIGNhY2hlS2V5CiAgICAgICkKICAgICkgewogICAgICByZXR1
cm4gcGVvcGxlRG1FMmVlRGVyaXZlZEtleUNhY2hlLmdldCgKICAgICAgICBjYWNoZUtleQogICAgICApOwogICAgfQoKICAgIGNvbnN0IHBlZXJQdWJsaWMg
PQogICAgICBhd2FpdCBwZW9wbGVEbUUyZWVJbXBvcnRQdWJsaWNLZXkoCiAgICAgICAgcGVlclB1YmxpY0p3awogICAgICApOwoKICAgIGNvbnN0IHNoYXJl
ZEJpdHMgPQogICAgICBhd2FpdCBjcnlwdG8uc3VidGxlLmRlcml2ZUJpdHMoCiAgICAgICAgewogICAgICAgICAgbmFtZToKICAgICAgICAgICAgIkVDREgi
LAogICAgICAgICAgcHVibGljOgogICAgICAgICAgICBwZWVyUHVibGljCiAgICAgICAgfSwKICAgICAgICBwcml2YXRlS2V5LAogICAgICAgIDI1NgogICAg
ICApOwoKICAgIGNvbnN0IGhrZGZLZXkgPQogICAgICBhd2FpdCBjcnlwdG8uc3VidGxlLmltcG9ydEtleSgKICAgICAgICAicmF3IiwKICAgICAgICBzaGFy
ZWRCaXRzLAogICAgICAgICJIS0RGIiwKICAgICAgICBmYWxzZSwKICAgICAgICBbCiAgICAgICAgICAiZGVyaXZlS2V5IgogICAgICAgIF0KICAgICAgKTsK
CiAgICBjb25zdCB3cmFwS2V5ID0KICAgICAgYXdhaXQgY3J5cHRvLnN1YnRsZS5kZXJpdmVLZXkoCiAgICAgICAgewogICAgICAgICAgbmFtZToKICAgICAg
ICAgICAgIkhLREYiLAogICAgICAgICAgaGFzaDoKICAgICAgICAgICAgIlNIQS0yNTYiLAogICAgICAgICAgc2FsdDoKICAgICAgICAgICAgcGVvcGxlRG1F
MmVlUGFpclNhbHQoCiAgICAgICAgICAgICAgZnJvbSwKICAgICAgICAgICAgICB0bwogICAgICAgICAgICApLAogICAgICAgICAgaW5mbzoKICAgICAgICAg
ICAgcGVvcGxlRG1FMmVlV3JhcEluZm8oCiAgICAgICAgICAgICAgc2VuZGVyRGV2aWNlLAogICAgICAgICAgICAgIHRhcmdldFVzZXIsCiAgICAgICAgICAg
ICAgdGFyZ2V0RGV2aWNlCiAgICAgICAgICAgICkKICAgICAgICB9LAogICAgICAgIGhrZGZLZXksCiAgICAgICAgewogICAgICAgICAgbmFtZToKICAgICAg
ICAgICAgIkFFUy1HQ00iLAogICAgICAgICAgbGVuZ3RoOgogICAgICAgICAgICAyNTYKICAgICAgICB9LAogICAgICAgIGZhbHNlLAogICAgICAgIFsKICAg
ICAgICAgICJlbmNyeXB0IiwKICAgICAgICAgICJkZWNyeXB0IgogICAgICAgIF0KICAgICAgKTsKCiAgICBwZW9wbGVEbUUyZWVEZXJpdmVkS2V5Q2FjaGUu
c2V0KAogICAgICBjYWNoZUtleSwKICAgICAgd3JhcEtleQogICAgKTsKCiAgICByZXR1cm4gd3JhcEtleTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHBlb3Bs
ZURtRTJlZUltYWdlQ29udGV4dCgKICAgIHVzZXJuYW1lCiAgKSB7CiAgICBjb25zdCBzdGF0ZSA9CiAgICAgIGF3YWl0IHBlb3BsZURtRTJlZUVuc3VyZURl
dmljZSgpOwoKICAgIGNvbnN0IGtleXMgPQogICAgICBhd2FpdCBhcGkoCiAgICAgICAgIi9hcGkvZTJlZS9kbS8iICsKICAgICAgICBlbmNvZGVVUklDb21w
b25lbnQoCiAgICAgICAgICB1c2VybmFtZQogICAgICAgICkgKwogICAgICAgICIvZGV2aWNlcyIKICAgICAgKTsKCiAgICBjb25zdCBvdGhlcklkID0KICAg
ICAgU3RyaW5nKAogICAgICAgIGtleXM/Lm90aGVyPy5pZCB8fAogICAgICAgICIiCiAgICAgICk7CgogICAgaWYgKAogICAgICAhb3RoZXJJZCB8fAogICAg
ICAhQXJyYXkuaXNBcnJheSgKICAgICAgICBrZXlzPy5vdGhlckRldmljZXMKICAgICAgKSB8fAogICAgICAha2V5cy5vdGhlckRldmljZXMubGVuZ3RoCiAg
ICApIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICJDZXQgdXRpbGlzYXRldXIgbidhIHBhcyBlbmNvcmUgYWN0aXbDqSBsZXMgTVAgRTJFRSBz
dXIgdW4gYXBwYXJlaWwuIgogICAgICApOwogICAgfQoKICAgIGNvbnN0IGRldmljZXMgPSBbCiAgICAgIC4uLigKICAgICAgICBBcnJheS5pc0FycmF5KAog
ICAgICAgICAga2V5cz8ubXlEZXZpY2VzCiAgICAgICAgKQogICAgICAgICAgPyBrZXlzLm15RGV2aWNlcwogICAgICAgICAgOiBbXQogICAgICApLAogICAg
ICAuLi5rZXlzLm90aGVyRGV2aWNlcwogICAgXTsKCiAgICBjb25zdCB1bmlxdWUgPQogICAgICBuZXcgTWFwKCk7CgogICAgZm9yIChjb25zdCBkZXZpY2Ug
b2YgZGV2aWNlcykgewogICAgICBjb25zdCB1c2VySWQgPQogICAgICAgIFN0cmluZygKICAgICAgICAgIGRldmljZT8udXNlcklkIHx8CiAgICAgICAgICAi
IgogICAgICAgICk7CgogICAgICBjb25zdCBkZXZpY2VJZCA9CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgZGV2aWNlPy5kZXZpY2VJZCB8fAogICAgICAg
ICAgIiIKICAgICAgICApOwoKICAgICAgaWYgKAogICAgICAgICF1c2VySWQgfHwKICAgICAgICAhZGV2aWNlSWQgfHwKICAgICAgICAhZGV2aWNlPy5wdWJs
aWNKd2sKICAgICAgKSB7CiAgICAgICAgY29udGludWU7CiAgICAgIH0KCiAgICAgIHVuaXF1ZS5zZXQoCiAgICAgICAgdXNlcklkICsgIjoiICsgZGV2aWNl
SWQsCiAgICAgICAgewogICAgICAgICAgdXNlcklkLAogICAgICAgICAgZGV2aWNlSWQsCiAgICAgICAgICBwdWJsaWNKd2s6CiAgICAgICAgICAgIGRldmlj
ZS5wdWJsaWNKd2sKICAgICAgICB9CiAgICAgICk7CiAgICB9CgogICAgY29uc3QgZnJvbSA9CiAgICAgIFN0cmluZyhtZS5pZCk7CgogICAgY29uc3QgdG8g
PQogICAgICBvdGhlcklkOwoKICAgIGlmICgKICAgICAgIVsKICAgICAgICAuLi51bmlxdWUudmFsdWVzKCkKICAgICAgXS5zb21lKAogICAgICAgIChkZXZp
Y2UpID0+CiAgICAgICAgICBkZXZpY2UudXNlcklkID09PSB0bwogICAgICApCiAgICApIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICJBdWN1
bmUgY2zDqSBFMkVFIHZhbGlkZSB0cm91dsOpZSBwb3VyIGNlIGRlc3RpbmF0YWlyZS4iCiAgICAgICk7CiAgICB9CgogICAgaWYgKHVuaXF1ZS5zaXplID4g
MTYpIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICJUcm9wIGQnYXBwYXJlaWxzIEUyRUUgc29udCBlbnJlZ2lzdHLDqXMgcG91ciBjZXR0ZSBj
b252ZXJzYXRpb24uIgogICAgICApOwogICAgfQoKICAgIHJldHVybiB7CiAgICAgIHN0YXRlLAogICAgICBmcm9tLAogICAgICB0bywKICAgICAgZGV2aWNl
czogWwogICAgICAgIC4uLnVuaXF1ZS52YWx1ZXMoKQogICAgICBdCiAgICB9OwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1FMmVlV3JhcENvbnRl
bnRLZXkoCiAgICBjb250ZXh0LAogICAgcmF3Q29udGVudEtleQogICkgewogICAgY29uc3Qgd3JhcHBlZEtleXMgPSBbXTsKCiAgICBmb3IgKAogICAgICBj
b25zdCBkZXZpY2Ugb2YKICAgICAgY29udGV4dC5kZXZpY2VzCiAgICApIHsKICAgICAgY29uc3Qgd3JhcEtleSA9CiAgICAgICAgYXdhaXQgcGVvcGxlRG1F
MmVlRGVyaXZlV3JhcEtleSgKICAgICAgICAgIGNvbnRleHQuc3RhdGUucHJpdmF0ZUtleSwKICAgICAgICAgIGRldmljZS5wdWJsaWNKd2ssCiAgICAgICAg
ICBjb250ZXh0LmZyb20sCiAgICAgICAgICBjb250ZXh0LnRvLAogICAgICAgICAgY29udGV4dC5zdGF0ZS5kZXZpY2VJZCwKICAgICAgICAgIGRldmljZS51
c2VySWQsCiAgICAgICAgICBkZXZpY2UuZGV2aWNlSWQKICAgICAgICApOwoKICAgICAgY29uc3Qgd3JhcEl2ID0KICAgICAgICBjcnlwdG8uZ2V0UmFuZG9t
VmFsdWVzKAogICAgICAgICAgbmV3IFVpbnQ4QXJyYXkoCiAgICAgICAgICAgIDEyCiAgICAgICAgICApCiAgICAgICAgKTsKCiAgICAgIGNvbnN0IHdyYXBw
ZWQgPQogICAgICAgIGF3YWl0IGNyeXB0by5zdWJ0bGUuZW5jcnlwdCgKICAgICAgICAgIHsKICAgICAgICAgICAgbmFtZToKICAgICAgICAgICAgICAiQUVT
LUdDTSIsCiAgICAgICAgICAgIGl2OgogICAgICAgICAgICAgIHdyYXBJdiwKICAgICAgICAgICAgYWRkaXRpb25hbERhdGE6CiAgICAgICAgICAgICAgcGVv
cGxlRG1FMmVlV3JhcEFhZCgKICAgICAgICAgICAgICAgIGNvbnRleHQuZnJvbSwKICAgICAgICAgICAgICAgIGNvbnRleHQudG8sCiAgICAgICAgICAgICAg
ICBjb250ZXh0LnN0YXRlLmRldmljZUlkLAogICAgICAgICAgICAgICAgZGV2aWNlLnVzZXJJZCwKICAgICAgICAgICAgICAgIGRldmljZS5kZXZpY2VJZAog
ICAgICAgICAgICAgICksCiAgICAgICAgICAgIHRhZ0xlbmd0aDoKICAgICAgICAgICAgICAxMjgKICAgICAgICAgIH0sCiAgICAgICAgICB3cmFwS2V5LAog
ICAgICAgICAgcmF3Q29udGVudEtleQogICAgICAgICk7CgogICAgICB3cmFwcGVkS2V5cy5wdXNoKHsKICAgICAgICB1OgogICAgICAgICAgZGV2aWNlLnVz
ZXJJZCwKICAgICAgICBkOgogICAgICAgICAgZGV2aWNlLmRldmljZUlkLAogICAgICAgIGl2OgogICAgICAgICAgcGVvcGxlRG1FMmVlQnl0ZXNUb0Jhc2U2
NFVybCgKICAgICAgICAgICAgd3JhcEl2CiAgICAgICAgICApLAogICAgICAgIGN0OgogICAgICAgICAgcGVvcGxlRG1FMmVlQnl0ZXNUb0Jhc2U2NFVybCgK
ICAgICAgICAgICAgd3JhcHBlZAogICAgICAgICAgKQogICAgICB9KTsKICAgIH0KCiAgICByZXR1cm4gd3JhcHBlZEtleXM7CiAgfQoKICBmdW5jdGlvbiBw
ZW9wbGVEbUUyZWVEZWNvZGVJbWFnZUNvbnRhaW5lcigKICAgIHZhbHVlCiAgKSB7CiAgICBjb25zdCBieXRlcyA9IHZhbHVlIGluc3RhbmNlb2YgVWludDhB
cnJheQogICAgICA/IHZhbHVlCiAgICAgIDogbmV3IFVpbnQ4QXJyYXkodmFsdWUpOwoKICAgIGNvbnN0IG1hZ2ljID0gUEVPUExFX0RNX0UyRUVfSU1BR0Vf
TUFHSUM7CiAgICBpZiAoYnl0ZXMubGVuZ3RoIDwgbWFnaWMubGVuZ3RoICsgNCArIDMyKSByZXR1cm4gbnVsbDsKCiAgICBmb3IgKGxldCBpbmRleCA9IDA7
IGluZGV4IDwgbWFnaWMubGVuZ3RoOyBpbmRleCArPSAxKSB7CiAgICAgIGlmIChieXRlc1tpbmRleF0gIT09IG1hZ2ljW2luZGV4XSkgcmV0dXJuIG51bGw7
CiAgICB9CgogICAgdHJ5IHsKICAgICAgY29uc3QgdmlldyA9IG5ldyBEYXRhVmlldyhieXRlcy5idWZmZXIsIGJ5dGVzLmJ5dGVPZmZzZXQsIGJ5dGVzLmJ5
dGVMZW5ndGgpOwogICAgICBjb25zdCBoZWFkZXJMZW5ndGggPSB2aWV3LmdldFVpbnQzMihtYWdpYy5sZW5ndGgsIGZhbHNlKTsKICAgICAgaWYgKGhlYWRl
ckxlbmd0aCA8IDMyIHx8IGhlYWRlckxlbmd0aCA+IDY0ICogMTAyNCkgewogICAgICAgIHRocm93IG5ldyBFcnJvcigiRW4tdMOqdGUgRTJFRSBpbnZhbGlk
ZS4iKTsKICAgICAgfQoKICAgICAgY29uc3QgaGVhZGVyU3RhcnQgPSBtYWdpYy5sZW5ndGggKyA0OwogICAgICBjb25zdCBoZWFkZXJFbmQgPSBoZWFkZXJT
dGFydCArIGhlYWRlckxlbmd0aDsKICAgICAgaWYgKGhlYWRlckVuZCA+PSBieXRlcy5sZW5ndGgpIHRocm93IG5ldyBFcnJvcigiQ29udGVuZXVyIEUyRUUg
dHJvbnF1w6kuIik7CgogICAgICBjb25zdCBlbnZlbG9wZSA9IEpTT04ucGFyc2UoCiAgICAgICAgcGVvcGxlRG1FMmVlRGVjb2Rlci5kZWNvZGUoYnl0ZXMu
c3ViYXJyYXkoaGVhZGVyU3RhcnQsIGhlYWRlckVuZCkpCiAgICAgICk7CiAgICAgIGNvbnN0IHZlcnNpb24gPSBOdW1iZXIoZW52ZWxvcGU/LnYpOwogICAg
ICBjb25zdCBzaXplID0gTnVtYmVyKGVudmVsb3BlPy5zaXplKTsKICAgICAgY29uc3QgbWltZSA9IFN0cmluZyhlbnZlbG9wZT8ubWltZSB8fCAiIikudG9M
b3dlckNhc2UoKTsKICAgICAgY29uc3QgbmFtZSA9IFN0cmluZyhlbnZlbG9wZT8ubmFtZSB8fCAiIikudHJpbSgpOwogICAgICBjb25zdCB2YWxpZE1pbWUg
PSAvXlthLXowLTkhIyQmXl8uKy1dK1wvW2EtejAtOSEjJCZeXy4rLV0rJC8udGVzdChtaW1lKTsKICAgICAgY29uc3QgdjFUeXBlT2sgPSB2ZXJzaW9uICE9
PSAxIHx8IFBFT1BMRV9ETV9FMkVFX0lNQUdFX1RZUEVTLmhhcyhtaW1lKTsKICAgICAgY29uc3QgdjJOYW1lT2sgPSB2ZXJzaW9uICE9PSAyIHx8IChuYW1l
Lmxlbmd0aCA+PSAxICYmIG5hbWUubGVuZ3RoIDw9IDE4MCk7CgogICAgICBpZiAoCiAgICAgICAgIVsxLCAyXS5pbmNsdWRlcyh2ZXJzaW9uKSB8fAogICAg
ICAgICFlbnZlbG9wZT8uZnJvbSB8fCAhZW52ZWxvcGU/LnRvIHx8ICFlbnZlbG9wZT8uc2QgfHwgIWVudmVsb3BlPy5zcGsgfHwgIWVudmVsb3BlPy5pdiB8
fAogICAgICAgICF2YWxpZE1pbWUgfHwgbWltZSA9PT0gUEVPUExFX0RNX0UyRUVfSU1BR0VfTUlNRSB8fCAhdjFUeXBlT2sgfHwgIXYyTmFtZU9rIHx8CiAg
ICAgICAgIU51bWJlci5pc0ludGVnZXIoc2l6ZSkgfHwgc2l6ZSA8IDEgfHwgc2l6ZSA+IFBFT1BMRV9ETV9FMkVFX0lNQUdFX01BWF9CWVRFUyB8fAogICAg
ICAgICFBcnJheS5pc0FycmF5KGVudmVsb3BlPy5rZXlzKSB8fCAhZW52ZWxvcGUua2V5cy5sZW5ndGggfHwgZW52ZWxvcGUua2V5cy5sZW5ndGggPiAxNgog
ICAgICApIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoIk3DqXRhZG9ubsOpZXMgRTJFRSBpbnZhbGlkZXMuIik7CiAgICAgIH0KCiAgICAgIGNvbnN0IGNp
cGhlcnRleHQgPSBieXRlcy5zdWJhcnJheShoZWFkZXJFbmQpOwogICAgICBpZiAoY2lwaGVydGV4dC5ieXRlTGVuZ3RoICE9PSBzaXplICsgMTYpIHsKICAg
ICAgICB0aHJvdyBuZXcgRXJyb3IoIlRhaWxsZSBFMkVFIGludmFsaWRlLiIpOwogICAgICB9CgogICAgICByZXR1cm4geyBlbnZlbG9wZSwgY2lwaGVydGV4
dCB9OwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnNvbGUud2FybigiW1Blb3BsZSBFMkVFL2F0dGFjaG1lbnQtY29udGFpbmVyXSIsIGVycik7CiAg
ICAgIHJldHVybiBudWxsOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1FMmVlRW5jcnlwdEltYWdlKAogICAgZmlsZSwKICAgIHVzZXJu
YW1lCiAgKSB7CiAgICBpZiAoIWZpbGUpIHRocm93IG5ldyBFcnJvcigiQXVjdW4gZmljaGllciBzw6lsZWN0aW9ubsOpLiIpOwoKICAgIGNvbnN0IG1pbWVS
YXcgPSBTdHJpbmcoZmlsZS50eXBlIHx8ICJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0iKQogICAgICAuc3BsaXQoIjsiLCAxKVswXQogICAgICAudHJpbSgp
CiAgICAgIC50b0xvd2VyQ2FzZSgpOwogICAgY29uc3QgbWltZSA9IC9eW2EtejAtOSEjJCZeXy4rLV0rXC9bYS16MC05ISMkJl5fListXSskLy50ZXN0KG1p
bWVSYXcpCiAgICAgID8gbWltZVJhdwogICAgICA6ICJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0iOwogICAgY29uc3QgbmFtZSA9IFN0cmluZyhmaWxlLm5h
bWUgfHwgImZpY2hpZXIiKQogICAgICAucmVwbGFjZSgvW1xcL1x1MDAwMC1cdTAwMWZcdTAwN2Y8PjoifD8qXSsvZywgIl8iKQogICAgICAudHJpbSgpCiAg
ICAgIC5zbGljZSgwLCAxODApIHx8ICJmaWNoaWVyIjsKCiAgICBpZiAoZmlsZS5zaXplIDw9IDAgfHwgZmlsZS5zaXplID4gUEVPUExFX0RNX0UyRUVfSU1B
R0VfTUFYX0JZVEVTKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigiTGEgcGnDqGNlIGpvaW50ZSBkb2l0IGZhaXJlIG1vaW5zIGRlIDI1IE1vLiIpOwogICAg
fQoKICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCBwZW9wbGVEbUUyZWVJbWFnZUNvbnRleHQodXNlcm5hbWUpOwogICAgY29uc3QgcmF3SW1hZ2VLZXkgPSBj
cnlwdG8uZ2V0UmFuZG9tVmFsdWVzKG5ldyBVaW50OEFycmF5KDMyKSk7CiAgICBjb25zdCBpbWFnZUtleSA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuaW1wb3J0
S2V5KAogICAgICAicmF3IiwKICAgICAgcmF3SW1hZ2VLZXksCiAgICAgIHsgbmFtZTogIkFFUy1HQ00iIH0sCiAgICAgIGZhbHNlLAogICAgICBbImVuY3J5
cHQiXQogICAgKTsKICAgIGNvbnN0IGltYWdlSXYgPSBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKG5ldyBVaW50OEFycmF5KDEyKSk7CiAgICBjb25zdCBwbGFp
biA9IGF3YWl0IGZpbGUuYXJyYXlCdWZmZXIoKTsKICAgIGNvbnN0IGNpcGhlcnRleHQgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmVuY3J5cHQoCiAgICAgIHsK
ICAgICAgICBuYW1lOiAiQUVTLUdDTSIsCiAgICAgICAgaXY6IGltYWdlSXYsCiAgICAgICAgYWRkaXRpb25hbERhdGE6IHBlb3BsZURtRTJlZUltYWdlQWFk
KAogICAgICAgICAgY29udGV4dC5mcm9tLAogICAgICAgICAgY29udGV4dC50bywKICAgICAgICAgIGNvbnRleHQuc3RhdGUuZGV2aWNlSWQsCiAgICAgICAg
ICBtaW1lLAogICAgICAgICAgZmlsZS5zaXplLAogICAgICAgICAgbmFtZSwKICAgICAgICAgIDIKICAgICAgICApLAogICAgICAgIHRhZ0xlbmd0aDogMTI4
CiAgICAgIH0sCiAgICAgIGltYWdlS2V5LAogICAgICBwbGFpbgogICAgKTsKCiAgICBjb25zdCB3cmFwcGVkS2V5cyA9IGF3YWl0IHBlb3BsZURtRTJlZVdy
YXBDb250ZW50S2V5KGNvbnRleHQsIHJhd0ltYWdlS2V5KTsKICAgIGNvbnN0IGhlYWRlciA9IHsKICAgICAgdjogMiwKICAgICAgZnJvbTogY29udGV4dC5m
cm9tLAogICAgICB0bzogY29udGV4dC50bywKICAgICAgc2Q6IGNvbnRleHQuc3RhdGUuZGV2aWNlSWQsCiAgICAgIHNwazogY29udGV4dC5zdGF0ZS5wdWJs
aWNKd2ssCiAgICAgIGl2OiBwZW9wbGVEbUUyZWVCeXRlc1RvQmFzZTY0VXJsKGltYWdlSXYpLAogICAgICBtaW1lLAogICAgICBuYW1lLAogICAgICBzaXpl
OiBmaWxlLnNpemUsCiAgICAgIGtleXM6IHdyYXBwZWRLZXlzCiAgICB9OwoKICAgIGNvbnN0IGhlYWRlckJ5dGVzID0gcGVvcGxlRG1FMmVlRW5jb2Rlci5l
bmNvZGUoSlNPTi5zdHJpbmdpZnkoaGVhZGVyKSk7CiAgICBpZiAoaGVhZGVyQnl0ZXMuYnl0ZUxlbmd0aCA+IDY0ICogMTAyNCkgewogICAgICB0aHJvdyBu
ZXcgRXJyb3IoIkVuLXTDqnRlIEUyRUUgdHJvcCB2b2x1bWluZXV4LiIpOwogICAgfQoKICAgIGNvbnN0IGVuY3J5cHRlZEJ5dGVzID0gbmV3IFVpbnQ4QXJy
YXkoY2lwaGVydGV4dCk7CiAgICBjb25zdCBvdXRwdXQgPSBuZXcgVWludDhBcnJheSgKICAgICAgUEVPUExFX0RNX0UyRUVfSU1BR0VfTUFHSUMubGVuZ3Ro
ICsgNCArIGhlYWRlckJ5dGVzLmJ5dGVMZW5ndGggKyBlbmNyeXB0ZWRCeXRlcy5ieXRlTGVuZ3RoCiAgICApOwogICAgb3V0cHV0LnNldChQRU9QTEVfRE1f
RTJFRV9JTUFHRV9NQUdJQywgMCk7CiAgICBuZXcgRGF0YVZpZXcob3V0cHV0LmJ1ZmZlcikuc2V0VWludDMyKAogICAgICBQRU9QTEVfRE1fRTJFRV9JTUFH
RV9NQUdJQy5sZW5ndGgsCiAgICAgIGhlYWRlckJ5dGVzLmJ5dGVMZW5ndGgsCiAgICAgIGZhbHNlCiAgICApOwogICAgY29uc3QgaGVhZGVyU3RhcnQgPSBQ
RU9QTEVfRE1fRTJFRV9JTUFHRV9NQUdJQy5sZW5ndGggKyA0OwogICAgb3V0cHV0LnNldChoZWFkZXJCeXRlcywgaGVhZGVyU3RhcnQpOwogICAgb3V0cHV0
LnNldChlbmNyeXB0ZWRCeXRlcywgaGVhZGVyU3RhcnQgKyBoZWFkZXJCeXRlcy5ieXRlTGVuZ3RoKTsKCiAgICByZXR1cm4gbmV3IEJsb2IoW291dHB1dF0s
IHsgdHlwZTogUEVPUExFX0RNX0UyRUVfSU1BR0VfTUlNRSB9KTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtRTJlZURlY3J5cHRJbWFnZUJsb2Io
CiAgICBibG9iCiAgKSB7CiAgICBpZiAoIWJsb2IgfHwgYmxvYi50eXBlICE9PSBQRU9QTEVfRE1fRTJFRV9JTUFHRV9NSU1FKSB7CiAgICAgIHJldHVybiB7
CiAgICAgICAgYmxvYiwKICAgICAgICBtaW1lOiBTdHJpbmcoYmxvYj8udHlwZSB8fCAiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtIiksCiAgICAgICAgbmFt
ZTogImZpY2hpZXIiLAogICAgICAgIHNpemU6IE51bWJlcihibG9iPy5zaXplIHx8IDApCiAgICAgIH07CiAgICB9CgogICAgY29uc3QgZGVjb2RlZCA9IHBl
b3BsZURtRTJlZURlY29kZUltYWdlQ29udGFpbmVyKGF3YWl0IGJsb2IuYXJyYXlCdWZmZXIoKSk7CiAgICBpZiAoIWRlY29kZWQpIHRocm93IG5ldyBFcnJv
cigiUGnDqGNlIGpvaW50ZSBFMkVFIGludmFsaWRlLiIpOwoKICAgIGNvbnN0IGVudmVsb3BlID0gZGVjb2RlZC5lbnZlbG9wZTsKICAgIGNvbnN0IG15SWQg
PSBTdHJpbmcobWU/LmlkIHx8ICIiKTsKICAgIGlmIChTdHJpbmcoZW52ZWxvcGUuZnJvbSkgIT09IG15SWQgJiYgU3RyaW5nKGVudmVsb3BlLnRvKSAhPT0g
bXlJZCkgewogICAgICB0aHJvdyBuZXcgRXJyb3IoIkNldHRlIHBpw6hjZSBqb2ludGUgRTJFRSBuZSB0J2VzdCBwYXMgZGVzdGluw6llLiIpOwogICAgfQoK
ICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgcGVvcGxlRG1FMmVlRW5zdXJlRGV2aWNlKCk7CiAgICBjb25zdCBjb3B5ID0gZW52ZWxvcGUua2V5cy5maW5kKAog
ICAgICAoaXRlbSkgPT4gU3RyaW5nKGl0ZW0/LnUpID09PSBteUlkICYmIFN0cmluZyhpdGVtPy5kKSA9PT0gU3RyaW5nKHN0YXRlLmRldmljZUlkKQogICAg
KTsKICAgIGlmICghY29weSkgdGhyb3cgbmV3IEVycm9yKCJQacOoY2Ugam9pbnRlIGluZGlzcG9uaWJsZSBzdXIgY2V0IGFwcGFyZWlsLiIpOwoKICAgIGNv
bnN0IHdyYXBLZXkgPSBhd2FpdCBwZW9wbGVEbUUyZWVEZXJpdmVXcmFwS2V5KAogICAgICBzdGF0ZS5wcml2YXRlS2V5LAogICAgICBlbnZlbG9wZS5zcGss
CiAgICAgIGVudmVsb3BlLmZyb20sCiAgICAgIGVudmVsb3BlLnRvLAogICAgICBlbnZlbG9wZS5zZCwKICAgICAgY29weS51LAogICAgICBjb3B5LmQKICAg
ICk7CiAgICBjb25zdCByYXdJbWFnZUtleSA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGVjcnlwdCgKICAgICAgewogICAgICAgIG5hbWU6ICJBRVMtR0NNIiwK
ICAgICAgICBpdjogcGVvcGxlRG1FMmVlQmFzZTY0VXJsVG9CeXRlcyhjb3B5Lml2KSwKICAgICAgICBhZGRpdGlvbmFsRGF0YTogcGVvcGxlRG1FMmVlV3Jh
cEFhZCgKICAgICAgICAgIGVudmVsb3BlLmZyb20sCiAgICAgICAgICBlbnZlbG9wZS50bywKICAgICAgICAgIGVudmVsb3BlLnNkLAogICAgICAgICAgY29w
eS51LAogICAgICAgICAgY29weS5kCiAgICAgICAgKSwKICAgICAgICB0YWdMZW5ndGg6IDEyOAogICAgICB9LAogICAgICB3cmFwS2V5LAogICAgICBwZW9w
bGVEbUUyZWVCYXNlNjRVcmxUb0J5dGVzKGNvcHkuY3QpCiAgICApOwogICAgY29uc3QgaW1hZ2VLZXkgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmltcG9ydEtl
eSgKICAgICAgInJhdyIsCiAgICAgIHJhd0ltYWdlS2V5LAogICAgICB7IG5hbWU6ICJBRVMtR0NNIiB9LAogICAgICBmYWxzZSwKICAgICAgWyJkZWNyeXB0
Il0KICAgICk7CiAgICBjb25zdCBwbGFpbiA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGVjcnlwdCgKICAgICAgewogICAgICAgIG5hbWU6ICJBRVMtR0NNIiwK
ICAgICAgICBpdjogcGVvcGxlRG1FMmVlQmFzZTY0VXJsVG9CeXRlcyhlbnZlbG9wZS5pdiksCiAgICAgICAgYWRkaXRpb25hbERhdGE6IHBlb3BsZURtRTJl
ZUltYWdlQWFkKAogICAgICAgICAgZW52ZWxvcGUuZnJvbSwKICAgICAgICAgIGVudmVsb3BlLnRvLAogICAgICAgICAgZW52ZWxvcGUuc2QsCiAgICAgICAg
ICBlbnZlbG9wZS5taW1lLAogICAgICAgICAgZW52ZWxvcGUuc2l6ZSwKICAgICAgICAgIGVudmVsb3BlLm5hbWUgfHwgIiIsCiAgICAgICAgICBlbnZlbG9w
ZS52CiAgICAgICAgKSwKICAgICAgICB0YWdMZW5ndGg6IDEyOAogICAgICB9LAogICAgICBpbWFnZUtleSwKICAgICAgZGVjb2RlZC5jaXBoZXJ0ZXh0CiAg
ICApOwogICAgaWYgKHBsYWluLmJ5dGVMZW5ndGggIT09IE51bWJlcihlbnZlbG9wZS5zaXplKSkgewogICAgICB0aHJvdyBuZXcgRXJyb3IoIlBpw6hjZSBq
b2ludGUgRTJFRSBkw6ljaGlmZnLDqWUgYXZlYyB1bmUgdGFpbGxlIGluY29ow6lyZW50ZS4iKTsKICAgIH0KCiAgICBjb25zdCBtaW1lID0gU3RyaW5nKGVu
dmVsb3BlLm1pbWUgfHwgImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSIpOwogICAgY29uc3QgbmFtZSA9IFN0cmluZyhlbnZlbG9wZS5uYW1lIHx8IChtaW1l
LnN0YXJ0c1dpdGgoImltYWdlLyIpID8gImltYWdlIiA6ICJmaWNoaWVyIikpOwogICAgcmV0dXJuIHsKICAgICAgYmxvYjogbmV3IEJsb2IoW3BsYWluXSwg
eyB0eXBlOiBtaW1lIH0pLAogICAgICBtaW1lLAogICAgICBuYW1lLAogICAgICBzaXplOiBOdW1iZXIoZW52ZWxvcGUuc2l6ZSkKICAgIH07CiAgfQoKICBh
c3luYyBmdW5jdGlvbiBwZW9wbGVEbUUyZWVMb2FkSW1hZ2UoCiAgICBpbWFnZUlkCiAgKSB7CiAgICBjb25zdCBpZCA9IFN0cmluZyhpbWFnZUlkIHx8ICIi
KS50cmltKCk7CiAgICBpZiAoIWlkKSB0aHJvdyBuZXcgRXJyb3IoIlBpw6hjZSBqb2ludGUgaW50cm91dmFibGUuIik7CgogICAgaWYgKHBlb3BsZURtRTJl
ZUltYWdlQ2FjaGUuaGFzKGlkKSkgewogICAgICByZXR1cm4gcGVvcGxlRG1FMmVlSW1hZ2VDYWNoZS5nZXQoaWQpOwogICAgfQoKICAgIGNvbnN0IHByb21p
c2UgPSAoYXN5bmMgKCkgPT4gewogICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKAogICAgICAgICIvYXBpL2NoYXQvaW1hZ2UvIiArIGVuY29k
ZVVSSUNvbXBvbmVudChpZCksCiAgICAgICAgeyBjcmVkZW50aWFsczogInNhbWUtb3JpZ2luIiwgY2FjaGU6ICJuby1zdG9yZSIgfQogICAgICApOwogICAg
ICBpZiAoIXJlc3BvbnNlLm9rKSB0aHJvdyBuZXcgRXJyb3IoIkltcG9zc2libGUgZGUgY2hhcmdlciBsYSBwacOoY2Ugam9pbnRlLiIpOwoKICAgICAgY29u
c3QgYmxvYiA9IGF3YWl0IHJlc3BvbnNlLmJsb2IoKTsKICAgICAgaWYgKGJsb2IudHlwZSA9PT0gUEVPUExFX0RNX0UyRUVfSU1BR0VfTUlNRSkgewogICAg
ICAgIHJldHVybiBwZW9wbGVEbUUyZWVEZWNyeXB0SW1hZ2VCbG9iKGJsb2IpOwogICAgICB9CgogICAgICBsZXQgbmFtZSA9ICJmaWNoaWVyIjsKICAgICAg
Y29uc3QgcmF3TmFtZSA9IHJlc3BvbnNlLmhlYWRlcnMuZ2V0KCJYLVBlb3BsZS1GaWxlLU5hbWUiKSB8fCAiIjsKICAgICAgaWYgKHJhd05hbWUpIHsKICAg
ICAgICB0cnkgeyBuYW1lID0gZGVjb2RlVVJJQ29tcG9uZW50KHJhd05hbWUpOyB9IGNhdGNoIHt9CiAgICAgIH0gZWxzZSBpZiAoYmxvYi50eXBlLnN0YXJ0
c1dpdGgoImltYWdlLyIpKSB7CiAgICAgICAgbmFtZSA9ICJpbWFnZSI7CiAgICAgIH0KICAgICAgcmV0dXJuIHsKICAgICAgICBibG9iLAogICAgICAgIG1p
bWU6IGJsb2IudHlwZSB8fCAiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtIiwKICAgICAgICBuYW1lLAogICAgICAgIHNpemU6IGJsb2Iuc2l6ZQogICAgICB9
OwogICAgfSkoKTsKCiAgICBwZW9wbGVEbUUyZWVJbWFnZUNhY2hlLnNldChpZCwgcHJvbWlzZSk7CiAgICB3aGlsZSAocGVvcGxlRG1FMmVlSW1hZ2VDYWNo
ZS5zaXplID4gMTIpIHsKICAgICAgY29uc3QgZmlyc3RLZXkgPSBwZW9wbGVEbUUyZWVJbWFnZUNhY2hlLmtleXMoKS5uZXh0KCkudmFsdWU7CiAgICAgIGlm
ICghZmlyc3RLZXkpIGJyZWFrOwogICAgICBwZW9wbGVEbUUyZWVJbWFnZUNhY2hlLmRlbGV0ZShmaXJzdEtleSk7CiAgICB9CiAgICBwcm9taXNlLmNhdGNo
KCgpID0+IHsKICAgICAgaWYgKHBlb3BsZURtRTJlZUltYWdlQ2FjaGUuZ2V0KGlkKSA9PT0gcHJvbWlzZSkgewogICAgICAgIHBlb3BsZURtRTJlZUltYWdl
Q2FjaGUuZGVsZXRlKGlkKTsKICAgICAgfQogICAgfSk7CiAgICByZXR1cm4gcHJvbWlzZTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtRTJlZUVu
Y3J5cHRUZXh0KAogICAgcGxhaW5UZXh0LAogICAgdXNlcm5hbWUKICApIHsKICAgIGNvbnN0IHRleHQgPQogICAgICBTdHJpbmcocGxhaW5UZXh0IHx8ICIi
KTsKCiAgICBpZiAoIXRleHQpIHsKICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIGlmICh0ZXh0Lmxlbmd0aCA+IDIwMDApIHsKICAgICAgdGhyb3cgbmV3
IEVycm9yKAogICAgICAgICJMZSBNUCBuZSBwZXV0IHBhcyBkw6lwYXNzZXIgMjAwMCBjYXJhY3TDqHJlcy4iCiAgICAgICk7CiAgICB9CgogICAgY29uc3Qg
c3RhdGUgPQogICAgICBhd2FpdCBwZW9wbGVEbUUyZWVFbnN1cmVEZXZpY2UoKTsKCiAgICBjb25zdCBrZXlzID0KICAgICAgYXdhaXQgYXBpKAogICAgICAg
ICIvYXBpL2UyZWUvZG0vIiArCiAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KAogICAgICAgICAgdXNlcm5hbWUKICAgICAgICApICsKICAgICAgICAiL2Rl
dmljZXMiCiAgICAgICk7CgogICAgY29uc3Qgb3RoZXJJZCA9CiAgICAgIFN0cmluZygKICAgICAgICBrZXlzPy5vdGhlcj8uaWQgfHwKICAgICAgICAiIgog
ICAgICApOwoKICAgIGlmICgKICAgICAgIW90aGVySWQgfHwKICAgICAgIUFycmF5LmlzQXJyYXkoCiAgICAgICAga2V5cz8ub3RoZXJEZXZpY2VzCiAgICAg
ICkgfHwKICAgICAgIWtleXMub3RoZXJEZXZpY2VzLmxlbmd0aAogICAgKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigKICAgICAgICAiQ2V0IHV0aWxpc2F0
ZXVyIG4nYSBwYXMgZW5jb3JlIGFjdGl2w6kgbGVzIE1QIEUyRUUgc3VyIHVuIGFwcGFyZWlsLiIKICAgICAgKTsKICAgIH0KCiAgICBjb25zdCBkZXZpY2Vz
ID0gWwogICAgICAuLi4oCiAgICAgICAgQXJyYXkuaXNBcnJheSgKICAgICAgICAgIGtleXM/Lm15RGV2aWNlcwogICAgICAgICkKICAgICAgICAgID8ga2V5
cy5teURldmljZXMKICAgICAgICAgIDogW10KICAgICAgKSwKICAgICAgLi4ua2V5cy5vdGhlckRldmljZXMKICAgIF07CgogICAgY29uc3QgdW5pcXVlID0K
ICAgICAgbmV3IE1hcCgpOwoKICAgIGZvciAoY29uc3QgZGV2aWNlIG9mIGRldmljZXMpIHsKICAgICAgY29uc3QgdXNlcklkID0KICAgICAgICBTdHJpbmco
CiAgICAgICAgICBkZXZpY2U/LnVzZXJJZCB8fAogICAgICAgICAgIiIKICAgICAgICApOwoKICAgICAgY29uc3QgZGV2aWNlSWQgPQogICAgICAgIFN0cmlu
ZygKICAgICAgICAgIGRldmljZT8uZGV2aWNlSWQgfHwKICAgICAgICAgICIiCiAgICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICAhdXNlcklkIHx8CiAg
ICAgICAgIWRldmljZUlkIHx8CiAgICAgICAgIWRldmljZT8ucHVibGljSndrCiAgICAgICkgewogICAgICAgIGNvbnRpbnVlOwogICAgICB9CgogICAgICB1
bmlxdWUuc2V0KAogICAgICAgIHVzZXJJZCArCiAgICAgICAgICAiOiIgKwogICAgICAgICAgZGV2aWNlSWQsCiAgICAgICAgewogICAgICAgICAgdXNlcklk
LAogICAgICAgICAgZGV2aWNlSWQsCiAgICAgICAgICBwdWJsaWNKd2s6CiAgICAgICAgICAgIGRldmljZS5wdWJsaWNKd2sKICAgICAgICB9CiAgICAgICk7
CiAgICB9CgogICAgY29uc3QgZnJvbSA9CiAgICAgIFN0cmluZyhtZS5pZCk7CgogICAgY29uc3QgdG8gPQogICAgICBvdGhlcklkOwoKICAgIGlmICgKICAg
ICAgIVsKICAgICAgICAuLi51bmlxdWUudmFsdWVzKCkKICAgICAgXS5zb21lKAogICAgICAgIChkZXZpY2UpID0+CiAgICAgICAgICBkZXZpY2UudXNlcklk
ID09PSB0bwogICAgICApCiAgICApIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICJBdWN1bmUgY2zDqSBFMkVFIHZhbGlkZSB0cm91dsOpZSBw
b3VyIGNlIGRlc3RpbmF0YWlyZS4iCiAgICAgICk7CiAgICB9CgogICAgY29uc3QgcmF3TWVzc2FnZUtleSA9CiAgICAgIGNyeXB0by5nZXRSYW5kb21WYWx1
ZXMoCiAgICAgICAgbmV3IFVpbnQ4QXJyYXkoCiAgICAgICAgICAzMgogICAgICAgICkKICAgICAgKTsKCiAgICBjb25zdCBtZXNzYWdlS2V5ID0KICAgICAg
YXdhaXQgY3J5cHRvLnN1YnRsZS5pbXBvcnRLZXkoCiAgICAgICAgInJhdyIsCiAgICAgICAgcmF3TWVzc2FnZUtleSwKICAgICAgICB7CiAgICAgICAgICBu
YW1lOgogICAgICAgICAgICAiQUVTLUdDTSIKICAgICAgICB9LAogICAgICAgIGZhbHNlLAogICAgICAgIFsKICAgICAgICAgICJlbmNyeXB0IgogICAgICAg
IF0KICAgICAgKTsKCiAgICBjb25zdCBtZXNzYWdlSXYgPQogICAgICBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKAogICAgICAgIG5ldyBVaW50OEFycmF5KAog
ICAgICAgICAgMTIKICAgICAgICApCiAgICAgICk7CgogICAgY29uc3QgY2lwaGVydGV4dCA9CiAgICAgIGF3YWl0IGNyeXB0by5zdWJ0bGUuZW5jcnlwdCgK
ICAgICAgICB7CiAgICAgICAgICBuYW1lOgogICAgICAgICAgICAiQUVTLUdDTSIsCiAgICAgICAgICBpdjoKICAgICAgICAgICAgbWVzc2FnZUl2LAogICAg
ICAgICAgYWRkaXRpb25hbERhdGE6CiAgICAgICAgICAgIHBlb3BsZURtRTJlZU1lc3NhZ2VBYWQoCiAgICAgICAgICAgICAgZnJvbSwKICAgICAgICAgICAg
ICB0bywKICAgICAgICAgICAgICBzdGF0ZS5kZXZpY2VJZAogICAgICAgICAgICApLAogICAgICAgICAgdGFnTGVuZ3RoOgogICAgICAgICAgICAxMjgKICAg
ICAgICB9LAogICAgICAgIG1lc3NhZ2VLZXksCiAgICAgICAgcGVvcGxlRG1FMmVlRW5jb2Rlci5lbmNvZGUoCiAgICAgICAgICB0ZXh0CiAgICAgICAgKQog
ICAgICApOwoKICAgIGNvbnN0IHdyYXBwZWRLZXlzID0KICAgICAgW107CgogICAgZm9yICgKICAgICAgY29uc3QgZGV2aWNlIG9mCiAgICAgIHVuaXF1ZS52
YWx1ZXMoKQogICAgKSB7CiAgICAgIGNvbnN0IHdyYXBLZXkgPQogICAgICAgIGF3YWl0IHBlb3BsZURtRTJlZURlcml2ZVdyYXBLZXkoCiAgICAgICAgICBz
dGF0ZS5wcml2YXRlS2V5LAogICAgICAgICAgZGV2aWNlLnB1YmxpY0p3aywKICAgICAgICAgIGZyb20sCiAgICAgICAgICB0bywKICAgICAgICAgIHN0YXRl
LmRldmljZUlkLAogICAgICAgICAgZGV2aWNlLnVzZXJJZCwKICAgICAgICAgIGRldmljZS5kZXZpY2VJZAogICAgICAgICk7CgogICAgICBjb25zdCB3cmFw
SXYgPQogICAgICAgIGNyeXB0by5nZXRSYW5kb21WYWx1ZXMoCiAgICAgICAgICBuZXcgVWludDhBcnJheSgKICAgICAgICAgICAgMTIKICAgICAgICAgICkK
ICAgICAgICApOwoKICAgICAgY29uc3Qgd3JhcHBlZCA9CiAgICAgICAgYXdhaXQgY3J5cHRvLnN1YnRsZS5lbmNyeXB0KAogICAgICAgICAgewogICAgICAg
ICAgICBuYW1lOgogICAgICAgICAgICAgICJBRVMtR0NNIiwKICAgICAgICAgICAgaXY6CiAgICAgICAgICAgICAgd3JhcEl2LAogICAgICAgICAgICBhZGRp
dGlvbmFsRGF0YToKICAgICAgICAgICAgICBwZW9wbGVEbUUyZWVXcmFwQWFkKAogICAgICAgICAgICAgICAgZnJvbSwKICAgICAgICAgICAgICAgIHRvLAog
ICAgICAgICAgICAgICAgc3RhdGUuZGV2aWNlSWQsCiAgICAgICAgICAgICAgICBkZXZpY2UudXNlcklkLAogICAgICAgICAgICAgICAgZGV2aWNlLmRldmlj
ZUlkCiAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgdGFnTGVuZ3RoOgogICAgICAgICAgICAgIDEyOAogICAgICAgICAgfSwKICAgICAgICAgIHdyYXBL
ZXksCiAgICAgICAgICByYXdNZXNzYWdlS2V5CiAgICAgICAgKTsKCiAgICAgIHdyYXBwZWRLZXlzLnB1c2goewogICAgICAgIHU6CiAgICAgICAgICBkZXZp
Y2UudXNlcklkLAogICAgICAgIGQ6CiAgICAgICAgICBkZXZpY2UuZGV2aWNlSWQsCiAgICAgICAgaXY6CiAgICAgICAgICBwZW9wbGVEbUUyZWVCeXRlc1Rv
QmFzZTY0VXJsKAogICAgICAgICAgICB3cmFwSXYKICAgICAgICAgICksCiAgICAgICAgY3Q6CiAgICAgICAgICBwZW9wbGVEbUUyZWVCeXRlc1RvQmFzZTY0
VXJsKAogICAgICAgICAgICB3cmFwcGVkCiAgICAgICAgICApCiAgICAgIH0pOwogICAgfQoKICAgIGNvbnN0IGVudmVsb3BlID0gewogICAgICB2OgogICAg
ICAgIDEsCiAgICAgIGZyb20sCiAgICAgIHRvLAogICAgICBzZDoKICAgICAgICBzdGF0ZS5kZXZpY2VJZCwKICAgICAgc3BrOgogICAgICAgIHN0YXRlLnB1
YmxpY0p3aywKICAgICAgaXY6CiAgICAgICAgcGVvcGxlRG1FMmVlQnl0ZXNUb0Jhc2U2NFVybCgKICAgICAgICAgIG1lc3NhZ2VJdgogICAgICAgICksCiAg
ICAgIGN0OgogICAgICAgIHBlb3BsZURtRTJlZUJ5dGVzVG9CYXNlNjRVcmwoCiAgICAgICAgICBjaXBoZXJ0ZXh0CiAgICAgICAgKSwKICAgICAga2V5czoK
ICAgICAgICB3cmFwcGVkS2V5cwogICAgfTsKCiAgICByZXR1cm4gKAogICAgICBQRU9QTEVfRE1fRTJFRV9QUkVGSVggKwogICAgICBwZW9wbGVEbUUyZWVF
bmNvZGVKc29uKAogICAgICAgIGVudmVsb3BlCiAgICAgICkKICAgICk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBwZW9wbGVEbUUyZWVEZWNyeXB0VGV4dCgK
ICAgIHZhbHVlCiAgKSB7CiAgICBjb25zdCBib2R5ID0KICAgICAgU3RyaW5nKHZhbHVlIHx8ICIiKTsKCiAgICBjb25zdCBlbnZlbG9wZSA9CiAgICAgIHBl
b3BsZURtRTJlZURlY29kZUVudmVsb3BlKAogICAgICAgIGJvZHkKICAgICAgKTsKCiAgICBpZiAoIWVudmVsb3BlKSB7CiAgICAgIC8qCiAgICAgICAgQW5j
aWVuIE1QIDoKICAgICAgICBsZSBzZXJ2ZXVyIEFFUyBWMSBsZSBkw6ljaGlmZnJlIGVuY29yZSBjb21tZSBhdmFudC4KICAgICAgKi8KICAgICAgcmV0dXJu
IGJvZHk7CiAgICB9CgogICAgdHJ5IHsKICAgICAgY29uc3Qgc3RhdGUgPQogICAgICAgIGF3YWl0IHBlb3BsZURtRTJlZUVuc3VyZURldmljZSgpOwoKICAg
ICAgY29uc3QgY29weSA9CiAgICAgICAgZW52ZWxvcGUua2V5cy5maW5kKAogICAgICAgICAgKGl0ZW0pID0+CiAgICAgICAgICAgIFN0cmluZyhpdGVtPy51
KSA9PT0KICAgICAgICAgICAgICBTdHJpbmcobWUuaWQpICYmCiAgICAgICAgICAgIFN0cmluZyhpdGVtPy5kKSA9PT0KICAgICAgICAgICAgICBTdHJpbmco
c3RhdGUuZGV2aWNlSWQpCiAgICAgICAgKTsKCiAgICAgIGlmICghY29weSkgewogICAgICAgIHJldHVybiAiTWVzc2FnZSBpbmRpc3BvbmlibGUgc3VyIGNl
dCBhcHBhcmVpbCI7CiAgICAgIH0KCiAgICAgIGNvbnN0IHdyYXBLZXkgPQogICAgICAgIGF3YWl0IHBlb3BsZURtRTJlZURlcml2ZVdyYXBLZXkoCiAgICAg
ICAgICBzdGF0ZS5wcml2YXRlS2V5LAogICAgICAgICAgZW52ZWxvcGUuc3BrLAogICAgICAgICAgZW52ZWxvcGUuZnJvbSwKICAgICAgICAgIGVudmVsb3Bl
LnRvLAogICAgICAgICAgZW52ZWxvcGUuc2QsCiAgICAgICAgICBjb3B5LnUsCiAgICAgICAgICBjb3B5LmQKICAgICAgICApOwoKICAgICAgY29uc3QgcmF3
TWVzc2FnZUtleSA9CiAgICAgICAgYXdhaXQgY3J5cHRvLnN1YnRsZS5kZWNyeXB0KAogICAgICAgICAgewogICAgICAgICAgICBuYW1lOgogICAgICAgICAg
ICAgICJBRVMtR0NNIiwKICAgICAgICAgICAgaXY6CiAgICAgICAgICAgICAgcGVvcGxlRG1FMmVlQmFzZTY0VXJsVG9CeXRlcygKICAgICAgICAgICAgICAg
IGNvcHkuaXYKICAgICAgICAgICAgICApLAogICAgICAgICAgICBhZGRpdGlvbmFsRGF0YToKICAgICAgICAgICAgICBwZW9wbGVEbUUyZWVXcmFwQWFkKAog
ICAgICAgICAgICAgICAgZW52ZWxvcGUuZnJvbSwKICAgICAgICAgICAgICAgIGVudmVsb3BlLnRvLAogICAgICAgICAgICAgICAgZW52ZWxvcGUuc2QsCiAg
ICAgICAgICAgICAgICBjb3B5LnUsCiAgICAgICAgICAgICAgICBjb3B5LmQKICAgICAgICAgICAgICApLAogICAgICAgICAgICB0YWdMZW5ndGg6CiAgICAg
ICAgICAgICAgMTI4CiAgICAgICAgICB9LAogICAgICAgICAgd3JhcEtleSwKICAgICAgICAgIHBlb3BsZURtRTJlZUJhc2U2NFVybFRvQnl0ZXMoCiAgICAg
ICAgICAgIGNvcHkuY3QKICAgICAgICAgICkKICAgICAgICApOwoKICAgICAgY29uc3QgbWVzc2FnZUtleSA9CiAgICAgICAgYXdhaXQgY3J5cHRvLnN1YnRs
ZS5pbXBvcnRLZXkoCiAgICAgICAgICAicmF3IiwKICAgICAgICAgIHJhd01lc3NhZ2VLZXksCiAgICAgICAgICB7CiAgICAgICAgICAgIG5hbWU6CiAgICAg
ICAgICAgICAgIkFFUy1HQ00iCiAgICAgICAgICB9LAogICAgICAgICAgZmFsc2UsCiAgICAgICAgICBbCiAgICAgICAgICAgICJkZWNyeXB0IgogICAgICAg
ICAgXQogICAgICAgICk7CgogICAgICBjb25zdCBwbGFpbiA9CiAgICAgICAgYXdhaXQgY3J5cHRvLnN1YnRsZS5kZWNyeXB0KAogICAgICAgICAgewogICAg
ICAgICAgICBuYW1lOgogICAgICAgICAgICAgICJBRVMtR0NNIiwKICAgICAgICAgICAgaXY6CiAgICAgICAgICAgICAgcGVvcGxlRG1FMmVlQmFzZTY0VXJs
VG9CeXRlcygKICAgICAgICAgICAgICAgIGVudmVsb3BlLml2CiAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgYWRkaXRpb25hbERhdGE6CiAgICAgICAg
ICAgICAgcGVvcGxlRG1FMmVlTWVzc2FnZUFhZCgKICAgICAgICAgICAgICAgIGVudmVsb3BlLmZyb20sCiAgICAgICAgICAgICAgICBlbnZlbG9wZS50bywK
ICAgICAgICAgICAgICAgIGVudmVsb3BlLnNkCiAgICAgICAgICAgICAgKSwKICAgICAgICAgICAgdGFnTGVuZ3RoOgogICAgICAgICAgICAgIDEyOAogICAg
ICAgICAgfSwKICAgICAgICAgIG1lc3NhZ2VLZXksCiAgICAgICAgICBwZW9wbGVEbUUyZWVCYXNlNjRVcmxUb0J5dGVzKAogICAgICAgICAgICBlbnZlbG9w
ZS5jdAogICAgICAgICAgKQogICAgICAgICk7CgogICAgICByZXR1cm4gcGVvcGxlRG1FMmVlRGVjb2Rlci5kZWNvZGUoCiAgICAgICAgcGxhaW4KICAgICAg
KTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xlLndhcm4oCiAgICAgICAgIltQZW9wbGUgRTJFRS9kZWNyeXB0XSIsCiAgICAgICAgZXJyCiAg
ICAgICk7CgogICAgICByZXR1cm4gIuKaoO+4jyBNZXNzYWdlIGNoaWZmcsOpIGltcG9zc2libGUgw6AgdsOpcmlmaWVyIjsKICAgIH0KICB9CgogIGFzeW5j
IGZ1bmN0aW9uIHBlb3BsZURtRTJlZURlY3J5cHRNZXNzYWdlKAogICAgbWVzc2FnZQogICkgewogICAgY29uc3QgbmV4dCA9IHsKICAgICAgLi4ubWVzc2Fn
ZSwKICAgICAgYm9keToKICAgICAgICBhd2FpdCBwZW9wbGVEbUUyZWVEZWNyeXB0VGV4dCgKICAgICAgICAgIG1lc3NhZ2U/LmJvZHkKICAgICAgICApCiAg
ICB9OwoKICAgIGlmICgKICAgICAgbWVzc2FnZT8ucmVwbHlUbyAmJgogICAgICAhbWVzc2FnZS5yZXBseVRvLmRlbGV0ZWQKICAgICkgewogICAgICBuZXh0
LnJlcGx5VG8gPSB7CiAgICAgICAgLi4ubWVzc2FnZS5yZXBseVRvLAogICAgICAgIHRleHQ6CiAgICAgICAgICBhd2FpdCBwZW9wbGVEbUUyZWVEZWNyeXB0
VGV4dCgKICAgICAgICAgICAgbWVzc2FnZS5yZXBseVRvLnRleHQKICAgICAgICAgICkKICAgICAgfTsKICAgIH0KCiAgICByZXR1cm4gbmV4dDsKICB9Cgog
IGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtRTJlZURlY3J5cHRNZXNzYWdlcygKICAgIGxpc3QKICApIHsKICAgIGNvbnN0IG1lc3NhZ2VzID0KICAgICAgQXJy
YXkuaXNBcnJheShsaXN0KQogICAgICAgID8gbGlzdAogICAgICAgIDogW107CgogICAgcmV0dXJuIFByb21pc2UuYWxsKAogICAgICBtZXNzYWdlcy5tYXAo
CiAgICAgICAgcGVvcGxlRG1FMmVlRGVjcnlwdE1lc3NhZ2UKICAgICAgKQogICAgKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtRTJlZU5vdGlm
aWNhdGlvblBheWxvYWQoCiAgICBwYXlsb2FkCiAgKSB7CiAgICBpZiAoCiAgICAgICFwYXlsb2FkIHx8CiAgICAgICFTdHJpbmcoCiAgICAgICAgcGF5bG9h
ZC5ib2R5IHx8CiAgICAgICAgIiIKICAgICAgKS5zdGFydHNXaXRoKAogICAgICAgIFBFT1BMRV9ETV9FMkVFX1BSRUZJWAogICAgICApCiAgICApIHsKICAg
ICAgcmV0dXJuIHBheWxvYWQ7CiAgICB9CgogICAgcmV0dXJuIHsKICAgICAgLi4ucGF5bG9hZCwKICAgICAgYm9keToKICAgICAgICBhd2FpdCBwZW9wbGVE
bUUyZWVEZWNyeXB0VGV4dCgKICAgICAgICAgIHBheWxvYWQuYm9keQogICAgICAgICkKICAgIH07CiAgfQogIC8vID09PSBQRU9QTEVfRTJFRV9ERVZJQ0Vf
QlJJREdFX1YxX1NUQVJUID09PQogIC8qCiAgICBQb250IGZpcnN0LXBhcnR5IHZlcnMgbGEgZnV0dXJlIGNvdWNoZSBFMkVFIGRlcyBzZXJ2ZXVycy4KICAg
IExhIGNsw6kgcHJpdsOpZSByZXN0ZSB1bmUgQ3J5cHRvS2V5IG5vbiBleHBvcnRhYmxlIGRhbnMgSW5kZXhlZERCIDsKICAgIGF1Y3VuIEpXSyBwcml2w6kg
bidlc3QgZXhwb3PDqS4KICAqLwogIHdpbmRvdy5QZW9wbGVFMkVFRGV2aWNlID0gT2JqZWN0LmZyZWV6ZSh7CiAgICBhc3luYyBlbnN1cmVEZXZpY2UoKSB7
CiAgICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgcGVvcGxlRG1FMmVlRW5zdXJlRGV2aWNlKCk7CiAgICAgIHJldHVybiB7CiAgICAgICAgYWNjb3VudElkOiBT
dHJpbmcoc3RhdGUuYWNjb3VudElkIHx8IG1lPy5pZCB8fCAiIiksCiAgICAgICAgZGV2aWNlSWQ6IFN0cmluZyhzdGF0ZS5kZXZpY2VJZCB8fCAiIiksCiAg
ICAgICAgcHJpdmF0ZUtleTogc3RhdGUucHJpdmF0ZUtleSwKICAgICAgICBwdWJsaWNKd2s6IHN0YXRlLnB1YmxpY0p3awogICAgICB9OwogICAgfSwKICAg
IGltcG9ydFB1YmxpY0tleTogcGVvcGxlRG1FMmVlSW1wb3J0UHVibGljS2V5LAogICAgYnl0ZXNUb0Jhc2U2NFVybDogcGVvcGxlRG1FMmVlQnl0ZXNUb0Jh
c2U2NFVybCwKICAgIGJhc2U2NFVybFRvQnl0ZXM6IHBlb3BsZURtRTJlZUJhc2U2NFVybFRvQnl0ZXMKICB9KTsKICAvLyA9PT0gUEVPUExFX0UyRUVfREVW
SUNFX0JSSURHRV9WMV9FTkQgPT09CgogIC8vID09PSBQRU9QTEVfRE1fRTJFRV9DTElFTlRfVjFfRU5EID09PQogIC8vID09PSBQRU9QTEVfRE1fU0lERUJB
Ul9QUkVWSUVXX0NMRUFOX1YxID09PQoKCiAgZnVuY3Rpb24gc2V0TW9kZShtb2RlKSB7CiAgICBjb25zdCBob21lID0gbW9kZSA9PT0gImhvbWUiOwoKICAg
IHNoZWxsPy5jbGFzc0xpc3QudG9nZ2xlKCJwZW9wbGUtaG9tZS1tb2RlIiwgaG9tZSk7CiAgICBzaGVsbD8uY2xhc3NMaXN0LnRvZ2dsZSgicGVvcGxlLXNl
cnZlci1tb2RlIiwgIWhvbWUpOwoKICAgIGhvbWVTaWRlYmFyPy5jbGFzc0xpc3QudG9nZ2xlKCJoaWRkZW4iLCAhaG9tZSk7CiAgICBwZW9wbGVTaWRlYmFy
Py5jbGFzc0xpc3QudG9nZ2xlKCJoaWRkZW4iLCBob21lKTsKICAgIGhvbWVNYWluPy5jbGFzc0xpc3QudG9nZ2xlKCJoaWRkZW4iLCAhaG9tZSk7CiAgICBw
ZW9wbGVNYWluPy5jbGFzc0xpc3QudG9nZ2xlKCJoaWRkZW4iLCBob21lKTsKCiAgICBob21lUmFpbEJ1dHRvbj8uY2xhc3NMaXN0LnRvZ2dsZSgiYWN0aXZl
IiwgaG9tZSk7CiAgICBwZW9wbGVSYWlsQnV0dG9uPy5jbGFzc0xpc3QudG9nZ2xlKCJhY3RpdmUiLCAhaG9tZSk7CgogICAgY29uc3Qgb25saW5lUGFuZWwg
PSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgib25saW5lUGFuZWwiKTsKICAgIGlmIChob21lICYmIG9ubGluZVBhbmVsKSB7CiAgICAgIHNoZWxsPy5jbGFz
c0xpc3QucmVtb3ZlKCJwZW9wbGUtb25saW5lLW9wZW4iKTsKICAgIH0KCiAgICB0cnkgewogICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbSgKICAgICAgICAi
cGVvcGxlLW1haW4tbW9kZSIsCiAgICAgICAgaG9tZSA/ICJob21lIiA6ICJzZXJ2ZXIiCiAgICAgICk7CiAgICB9IGNhdGNoIHt9CiAgfQoKICAvLyA9PT0g
UEVPUExFX0JST1dTRVJfSElTVE9SWV9TT0NJQUxfVjEgPT09CiAgZnVuY3Rpb24gcGVvcGxlUmVjb3JkQnJvd3Nlck5hdmlnYXRpb24oCiAgICBlbnRyeSwK
ICAgIG9wdGlvbnMgPSBudWxsCiAgKSB7CiAgICBpZiAoCiAgICAgIG9wdGlvbnM/Lmhpc3RvcnkgPT09CiAgICAgICAgZmFsc2UKICAgICkgewogICAgICBy
ZXR1cm47CiAgICB9CgogICAgd2luZG93CiAgICAgIC5QZW9wbGVOYXZpZ2F0aW9uSGlzdG9yeQogICAgICA/LnB1c2g/LigKICAgICAgICBlbnRyeQogICAg
ICApOwogIH0KCiAgZnVuY3Rpb24gc2hvd0ZyaWVuZHMob3B0aW9ucyA9IG51bGwpIHsKICAgIHNldE1vZGUoImhvbWUiKTsKICAgIGhvbWVNYWluPy5jbGFz
c0xpc3QucmVtb3ZlKCJkbS1vcGVuIik7CiAgICBhY3RpdmVEbVVzZXIgPSBudWxsOwoKICAgIGZyaWVuZHNWaWV3Py5jbGFzc0xpc3QucmVtb3ZlKCJoaWRk
ZW4iKTsKICAgIGRtVmlldz8uY2xhc3NMaXN0LmFkZCgiaGlkZGVuIik7CgogICAgaWYgKGhvbWVNYWluVGl0bGUpIGhvbWVNYWluVGl0bGUudGV4dENvbnRl
bnQgPSAiQW1pcyI7CiAgICBpZiAoaG9tZU1haW5TdWJ0aXRsZSkgewogICAgICBob21lTWFpblN1YnRpdGxlLnRleHRDb250ZW50ID0gIlRlcyBjb250YWN0
cyBQZW9wbGUiOwogICAgfQoKICAgIGRvY3VtZW50CiAgICAgIC5xdWVyeVNlbGVjdG9yQWxsKCIuZG0tY29udmVyc2F0aW9uLXJvdy5hY3RpdmUiKQogICAg
ICAuZm9yRWFjaCgocm93KSA9PiByb3cuY2xhc3NMaXN0LnJlbW92ZSgiYWN0aXZlIikpOwoKICAgIHBlb3BsZVJlY29yZEJyb3dzZXJOYXZpZ2F0aW9uKAog
ICAgICB7CiAgICAgICAgdmlldzoKICAgICAgICAgICJmcmllbmRzIgogICAgICB9LAogICAgICBvcHRpb25zCiAgICApOwoKICAgIGlmIChvcHRpb25zPy5y
ZWZyZXNoID09PSBmYWxzZSkgewogICAgICByZXR1cm47CiAgICB9CgogICAgdm9pZCByZWZyZXNoRnJpZW5kUmVxdWVzdHMoKTsKICAgIHZvaWQgcmVmcmVz
aEZyaWVuZHMoKTsKICAgIHZvaWQgcmVmcmVzaERpcmVjdG9yeSgKICAgICAgcGVvcGxlU2VhcmNoSW5wdXQ/LnZhbHVlIHx8ICIiCiAgICApOwogIH0KCiAg
d2luZG93LlBlb3BsZVNvY2lhbE5hdmlnYXRpb24gPSB7CiAgICBzZXRNb2RlLAogICAgc2hvd0ZyaWVuZHMsCiAgICBvcGVuRG0KICB9OwoKICAvLyA9PT0g
UEVPUExFX1BST0ZJTEVfU09DSUFMX0VWRVJZV0hFUkVfVjNfU1RBUlQgPT09CiAgZnVuY3Rpb24gcGVvcGxlU29jaWFsUHJvZmlsZVVzZXJuYW1lKAogICAg
dmFsdWUKICApIHsKICAgIGNvbnN0IHVzZXJuYW1lID0KICAgICAgU3RyaW5nKAogICAgICAgIHZhbHVlIHx8CiAgICAgICAgIiIKICAgICAgKS50cmltKCk7
CgogICAgaWYgKAogICAgICAhdXNlcm5hbWUgfHwKICAgICAgdXNlcm5hbWUudG9Mb2NhbGVMb3dlckNhc2UoCiAgICAgICAgImZyLUZSIgogICAgICApID09
PQogICAgICAgICJzeXN0w6htZSIgfHwKICAgICAgdXNlcm5hbWUudG9Mb2NhbGVMb3dlckNhc2UoCiAgICAgICAgImZyLUZSIgogICAgICApID09PQogICAg
ICAgICJzeXN0ZW1lIgogICAgKSB7CiAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICByZXR1cm4gdXNlcm5hbWU7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVC
aW5kU29jaWFsUHJvZmlsZVVpKAogICAgZWxlbWVudCwKICAgIHVzZXJuYW1lLAogICAga2luZCA9CiAgICAgICJuYW1lIgogICkgewogICAgY29uc3QgY2xl
YW4gPQogICAgICBwZW9wbGVTb2NpYWxQcm9maWxlVXNlcm5hbWUoCiAgICAgICAgdXNlcm5hbWUKICAgICAgKTsKCiAgICBpZiAoCiAgICAgICFlbGVtZW50
IHx8CiAgICAgICFjbGVhbgogICAgKSB7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBlbGVtZW50LmRhdGFzZXQucGVvcGxlUHJvZmlsZVVzZXJuYW1lID0K
ICAgICAgY2xlYW47CgogICAgZWxlbWVudC5jbGFzc0xpc3QuYWRkKAogICAgICAicGVvcGxlLXByb2ZpbGUtdHJpZ2dlciIKICAgICk7CgogICAgZWxlbWVu
dC5jbGFzc0xpc3QudG9nZ2xlKAogICAgICAicGVvcGxlLXByb2ZpbGUtbmFtZS10cmlnZ2VyIiwKICAgICAga2luZCA9PT0KICAgICAgICAibmFtZSIKICAg
ICk7CgogICAgZWxlbWVudC5jbGFzc0xpc3QudG9nZ2xlKAogICAgICAicGVvcGxlLXByb2ZpbGUtYXZhdGFyLXRyaWdnZXIiLAogICAgICBraW5kID09PQog
ICAgICAgICJhdmF0YXIiCiAgICApOwoKICAgIGlmICgKICAgICAgZWxlbWVudC5kYXRhc2V0LnBlb3BsZVByb2ZpbGVDbGlja0JvdW5kID09PQogICAgICAg
ICIxIgogICAgKSB7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBlbGVtZW50LmRhdGFzZXQucGVvcGxlUHJvZmlsZUNsaWNrQm91bmQgPQogICAgICAiMSI7
CgogICAgaWYgKAogICAgICBlbGVtZW50LnRhZ05hbWUgIT09CiAgICAgICAgIkJVVFRPTiIKICAgICkgewogICAgICBlbGVtZW50LnNldEF0dHJpYnV0ZSgK
ICAgICAgICAicm9sZSIsCiAgICAgICAgImJ1dHRvbiIKICAgICAgKTsKCiAgICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKAogICAgICAgICJ0YWJpbmRleCIs
CiAgICAgICAgIjAiCiAgICAgICk7CiAgICB9CgogICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKAogICAgICAiY2xpY2siLAogICAgICAoZXZlbnQpID0+
IHsKICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTsKCiAgICAgICAgdm9pZCBvcGVuUHJvZmlsZSgKICAgICAgICAgIGVsZW1lbnQuZGF0YXNldC5w
ZW9wbGVQcm9maWxlVXNlcm5hbWUKICAgICAgICApOwogICAgICB9CiAgICApOwoKICAgIGlmICgKICAgICAgZWxlbWVudC50YWdOYW1lICE9PQogICAgICAg
ICJCVVRUT04iCiAgICApIHsKICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKAogICAgICAgICJrZXlkb3duIiwKICAgICAgICAoZXZlbnQpID0+IHsK
ICAgICAgICAgIGlmICgKICAgICAgICAgICAgZXZlbnQua2V5ICE9PQogICAgICAgICAgICAgICJFbnRlciIgJiYKICAgICAgICAgICAgZXZlbnQua2V5ICE9
PQogICAgICAgICAgICAgICIgIgogICAgICAgICAgKSB7CiAgICAgICAgICAgIHJldHVybjsKICAgICAgICAgIH0KCiAgICAgICAgICBldmVudC5wcmV2ZW50
RGVmYXVsdCgpOwogICAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7CgogICAgICAgICAgdm9pZCBvcGVuUHJvZmlsZSgKICAgICAgICAgICAgZWxl
bWVudC5kYXRhc2V0LnBlb3BsZVByb2ZpbGVVc2VybmFtZQogICAgICAgICAgKTsKICAgICAgICB9CiAgICAgICk7CiAgICB9CiAgfQoKICB3aW5kb3cuYWRk
RXZlbnRMaXN0ZW5lcigKICAgICJwZW9wbGUtb3Blbi1wcm9maWxlIiwKICAgIChldmVudCkgPT4gewogICAgICBjb25zdCB1c2VybmFtZSA9CiAgICAgICAg
cGVvcGxlU29jaWFsUHJvZmlsZVVzZXJuYW1lKAogICAgICAgICAgZXZlbnQ/LmRldGFpbD8udXNlcm5hbWUKICAgICAgICApOwoKICAgICAgaWYgKHVzZXJu
YW1lKSB7CiAgICAgICAgdm9pZCBvcGVuUHJvZmlsZSgKICAgICAgICAgIHVzZXJuYW1lCiAgICAgICAgKTsKICAgICAgfQogICAgfQogICk7CiAgLy8gPT09
IFBFT1BMRV9QUk9GSUxFX1NPQ0lBTF9FVkVSWVdIRVJFX1YzX0VORCA9PT0KCiAgZnVuY3Rpb24gdXBkYXRlVW5yZWFkQmFkZ2UodG90YWwpIHsKICAgIGNv
bnN0IGNvdW50ID0gTWF0aC5tYXgoMCwgTnVtYmVyKHRvdGFsIHx8IDApKTsKCiAgICBpZiAoIWhvbWVVbnJlYWRCYWRnZSkgcmV0dXJuOwoKICAgIGhvbWVV
bnJlYWRCYWRnZS50ZXh0Q29udGVudCA9CiAgICAgIGNvdW50ID4gOTkgPyAiOTkrIiA6IFN0cmluZyhjb3VudCk7CgogICAgaG9tZVVucmVhZEJhZGdlLmNs
YXNzTGlzdC5yZW1vdmUoImhpZGRlbiIpOwogICAgaG9tZVVucmVhZEJhZGdlLmNsYXNzTGlzdC50b2dnbGUoCiAgICAgICJoYXMtdW5yZWFkIiwKICAgICAg
Y291bnQgPiAwCiAgICApOwogIH0KCiAgZnVuY3Rpb24gbWFrZVBlcnNvbkNhcmQocGVyc29uLCBpbkZyaWVuZHMgPSBmYWxzZSkgewogICAgY29uc3Qgcm93
ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICByb3cuY2xhc3NOYW1lID0gInBlb3BsZS1jYXJkIjsKICAgIHJvdy5kYXRhc2V0LnVzZXJu
YW1lID0gcGVyc29uLnVzZXJuYW1lOwoKICAgIGNvbnN0IGF2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYnV0dG9uIik7CiAgICBhdi50eXBlID0gImJ1
dHRvbiI7CiAgICBhdi5jbGFzc05hbWUgPSAicGVvcGxlLWNhcmQtYXZhdGFyIjsKICAgIGF2LmRhdGFzZXQucGVvcGxlU29jaWFsQWN0aW9uID0gInByb2Zp
bGUiOwogICAgd2luZG93LlBlb3BsZUF2YXRhcnM/LmFwcGx5KAogICAgICBhdiwKICAgICAgcGVyc29uLnVzZXJuYW1lCiAgICApOwogICAgYXYudGl0bGUg
PSAiT3V2cmlyIGxlIHByb2ZpbCI7CgogICAgY29uc3QgY29weSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImJ1dHRvbiIpOwogICAgY29weS50eXBlID0g
ImJ1dHRvbiI7CiAgICBjb3B5LmNsYXNzTmFtZSA9ICJwZW9wbGUtY2FyZC1jb3B5IjsKICAgIGNvcHkuZGF0YXNldC5wZW9wbGVTb2NpYWxBY3Rpb24gPSAi
cHJvZmlsZSI7CgogICAgY29uc3QgbmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoInN0cm9uZyIpOwogICAgbmFtZS50ZXh0Q29udGVudCA9IHBlcnNv
bi51c2VybmFtZTsKCiAgICAvLyA9PT0gUEVPUExFX0NBUkRfUFJPRklMRV9WMyA9PT0KICAgIHBlb3BsZUJpbmRTb2NpYWxQcm9maWxlVWkoCiAgICAgIGF2
LAogICAgICBwZXJzb24udXNlcm5hbWUsCiAgICAgICJhdmF0YXIiCiAgICApOwoKICAgIHBlb3BsZUJpbmRTb2NpYWxQcm9maWxlVWkoCiAgICAgIG5hbWUs
CiAgICAgIHBlcnNvbi51c2VybmFtZSwKICAgICAgIm5hbWUiCiAgICApOwoKICAgIGNvbnN0IHN0YXR1cyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoInNw
YW4iKTsKICAgIHN0YXR1cy50ZXh0Q29udGVudCA9CiAgICAgIHBlcnNvbi5vbmxpbmUKICAgICAgICA/ICLil48gRW4gbGlnbmUiCiAgICAgICAgOiAiSG9y
cyBsaWduZSI7CgogICAgY29weS5hcHBlbmQobmFtZSwgc3RhdHVzKTsKCiAgICBjb25zdCBkbSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImJ1dHRvbiIp
OwogICAgZG0udHlwZSA9ICJidXR0b24iOwogICAgZG0uY2xhc3NOYW1lID0gInBlb3BsZS1jYXJkLWFjdGlvbiI7CiAgICBkbS50ZXh0Q29udGVudCA9ICJN
UCI7CiAgICBkbS5kYXRhc2V0LnBlb3BsZVNvY2lhbEFjdGlvbiA9ICJkbSI7CgogICAgY29uc3QgZnJpZW5kID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgi
YnV0dG9uIik7CiAgICBmcmllbmQudHlwZSA9ICJidXR0b24iOwogICAgZnJpZW5kLmNsYXNzTmFtZSA9CiAgICAgICJwZW9wbGUtY2FyZC1hY3Rpb24gc2Vj
b25kYXJ5IjsKCiAgICBjb25zdCBpc0ZyaWVuZCA9CiAgICAgIEJvb2xlYW4ocGVyc29uLmlzRnJpZW5kIHx8IGluRnJpZW5kcyk7CgogICAgaWYgKGlzRnJp
ZW5kKSB7CiAgICAgIGZyaWVuZC50ZXh0Q29udGVudCA9ICJSZXRpcmVyIjsKICAgICAgZnJpZW5kLmRhdGFzZXQucGVvcGxlU29jaWFsQWN0aW9uID0KICAg
ICAgICAicmVtb3ZlLWZyaWVuZCI7CiAgICB9IGVsc2UgaWYgKAogICAgICBwZXJzb24uZnJpZW5kUmVxdWVzdCA9PT0gImluY29taW5nIgogICAgKSB7CiAg
ICAgIGZyaWVuZC50ZXh0Q29udGVudCA9ICJBY2NlcHRlciI7CiAgICAgIGZyaWVuZC5kYXRhc2V0LnBlb3BsZVNvY2lhbEFjdGlvbiA9CiAgICAgICAgImFj
Y2VwdC1mcmllbmQiOwogICAgICBmcmllbmQuZGF0YXNldC5yZXF1ZXN0SWQgPQogICAgICAgIFN0cmluZyhwZXJzb24uZnJpZW5kUmVxdWVzdElkIHx8ICIi
KTsKICAgIH0gZWxzZSBpZiAoCiAgICAgIHBlcnNvbi5mcmllbmRSZXF1ZXN0ID09PSAib3V0Z29pbmciCiAgICApIHsKICAgICAgZnJpZW5kLnRleHRDb250
ZW50ID0gIkVuIGF0dGVudGUiOwogICAgICBmcmllbmQuZGlzYWJsZWQgPSB0cnVlOwogICAgfSBlbHNlIHsKICAgICAgZnJpZW5kLnRleHRDb250ZW50ID0g
IkFqb3V0ZXIiOwogICAgICBmcmllbmQuZGF0YXNldC5wZW9wbGVTb2NpYWxBY3Rpb24gPQogICAgICAgICJhZGQtZnJpZW5kIjsKICAgIH0KCiAgICByb3cu
YXBwZW5kKGF2LCBjb3B5LCBkbSwgZnJpZW5kKTsKICAgIHJldHVybiByb3c7CiAgfQoKICBmdW5jdGlvbiBtYWtlRnJpZW5kUmVxdWVzdFJvdygKICAgIHJl
cXVlc3QsCiAgICBkaXJlY3Rpb24KICApIHsKICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgcm93LmNsYXNzTmFt
ZSA9ICJmcmllbmQtcmVxdWVzdC1yb3ciOwogICAgcm93LmRhdGFzZXQudXNlcm5hbWUgPQogICAgICByZXF1ZXN0LnVzZXIudXNlcm5hbWU7CiAgICByb3cu
ZGF0YXNldC5yZXF1ZXN0SWQgPQogICAgICBTdHJpbmcocmVxdWVzdC5pZCB8fCAiIik7CgogICAgY29uc3QgYXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50
KCJidXR0b24iKTsKICAgIGF2LnR5cGUgPSAiYnV0dG9uIjsKICAgIGF2LmNsYXNzTmFtZSA9ICJmcmllbmQtcmVxdWVzdC1hdmF0YXIiOwogICAgYXYuZGF0
YXNldC5mcmllbmRSZXF1ZXN0QWN0aW9uID0gInByb2ZpbGUiOwogICAgd2luZG93LlBlb3BsZUF2YXRhcnM/LmFwcGx5KAogICAgICBhdiwKICAgICAgcmVx
dWVzdC51c2VyLnVzZXJuYW1lCiAgICApOwoKICAgIGNvbnN0IGNvcHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJidXR0b24iKTsKICAgIGNvcHkudHlw
ZSA9ICJidXR0b24iOwogICAgY29weS5jbGFzc05hbWUgPSAiZnJpZW5kLXJlcXVlc3QtY29weSI7CiAgICBjb3B5LmRhdGFzZXQuZnJpZW5kUmVxdWVzdEFj
dGlvbiA9ICJwcm9maWxlIjsKCiAgICBjb25zdCBuYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic3Ryb25nIik7CiAgICBuYW1lLnRleHRDb250ZW50
ID0gcmVxdWVzdC51c2VyLnVzZXJuYW1lOwoKICAgIC8vID09PSBQRU9QTEVfRlJJRU5EX1JFUVVFU1RfUFJPRklMRV9WMyA9PT0KICAgIHBlb3BsZUJpbmRT
b2NpYWxQcm9maWxlVWkoCiAgICAgIGF2LAogICAgICByZXF1ZXN0LnVzZXIudXNlcm5hbWUsCiAgICAgICJhdmF0YXIiCiAgICApOwoKICAgIHBlb3BsZUJp
bmRTb2NpYWxQcm9maWxlVWkoCiAgICAgIG5hbWUsCiAgICAgIHJlcXVlc3QudXNlci51c2VybmFtZSwKICAgICAgIm5hbWUiCiAgICApOwoKICAgIGNvbnN0
IHN0YXR1cyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoInNwYW4iKTsKICAgIHN0YXR1cy50ZXh0Q29udGVudCA9CiAgICAgIGRpcmVjdGlvbiA9PT0gImlu
Y29taW5nIgogICAgICAgID8gIlZldXQgZGV2ZW5pciB0b24gYW1pIgogICAgICAgIDogIkVuIGF0dGVudGUgZGUgc2EgcsOpcG9uc2UiOwoKICAgIGNvcHku
YXBwZW5kKG5hbWUsIHN0YXR1cyk7CgogICAgY29uc3QgYWN0aW9ucyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgYWN0aW9ucy5jbGFz
c05hbWUgPSAiZnJpZW5kLXJlcXVlc3QtYWN0aW9ucyI7CgogICAgaWYgKGRpcmVjdGlvbiA9PT0gImluY29taW5nIikgewogICAgICBjb25zdCBhY2NlcHQg
PSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJidXR0b24iKTsKICAgICAgYWNjZXB0LnR5cGUgPSAiYnV0dG9uIjsKICAgICAgYWNjZXB0LmNsYXNzTmFtZSA9
ICJmcmllbmQtcmVxdWVzdC1hY2NlcHQiOwogICAgICBhY2NlcHQudGV4dENvbnRlbnQgPSAiQWNjZXB0ZXIiOwogICAgICBhY2NlcHQuZGF0YXNldC5mcmll
bmRSZXF1ZXN0QWN0aW9uID0gImFjY2VwdCI7CgogICAgICBjb25zdCByZWZ1c2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJidXR0b24iKTsKICAgICAg
cmVmdXNlLnR5cGUgPSAiYnV0dG9uIjsKICAgICAgcmVmdXNlLmNsYXNzTmFtZSA9ICJmcmllbmQtcmVxdWVzdC1yZWZ1c2UiOwogICAgICByZWZ1c2UudGV4
dENvbnRlbnQgPSAiUmVmdXNlciI7CiAgICAgIHJlZnVzZS5kYXRhc2V0LmZyaWVuZFJlcXVlc3RBY3Rpb24gPSAiZGVsZXRlIjsKCiAgICAgIGFjdGlvbnMu
YXBwZW5kKGFjY2VwdCwgcmVmdXNlKTsKICAgIH0gZWxzZSB7CiAgICAgIGNvbnN0IGNhbmNlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImJ1dHRvbiIp
OwogICAgICBjYW5jZWwudHlwZSA9ICJidXR0b24iOwogICAgICBjYW5jZWwuY2xhc3NOYW1lID0gImZyaWVuZC1yZXF1ZXN0LXJlZnVzZSI7CiAgICAgIGNh
bmNlbC50ZXh0Q29udGVudCA9ICJBbm51bGVyIjsKICAgICAgY2FuY2VsLmRhdGFzZXQuZnJpZW5kUmVxdWVzdEFjdGlvbiA9ICJkZWxldGUiOwoKICAgICAg
YWN0aW9ucy5hcHBlbmRDaGlsZChjYW5jZWwpOwogICAgfQoKICAgIHJvdy5hcHBlbmQoYXYsIGNvcHksIGFjdGlvbnMpOwogICAgcmV0dXJuIHJvdzsKICB9
CgoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVQZXJzb25DYXJkQ2xpY2soZXZlbnQpIHsKICAgIGNvbnN0IGFjdGlvbkJ1dHRvbiA9CiAgICAgIGV2ZW50LnRh
cmdldD8uY2xvc2VzdD8uKAogICAgICAgICJbZGF0YS1wZW9wbGUtc29jaWFsLWFjdGlvbl0iCiAgICAgICk7CgogICAgaWYgKCFhY3Rpb25CdXR0b24pIHJl
dHVybjsKCiAgICBjb25zdCByb3cgPQogICAgICBhY3Rpb25CdXR0b24uY2xvc2VzdCgKICAgICAgICAiLnBlb3BsZS1jYXJkIgogICAgICApOwoKICAgIGNv
bnN0IHVzZXJuYW1lID0KICAgICAgU3RyaW5nKAogICAgICAgIHJvdz8uZGF0YXNldD8udXNlcm5hbWUgfHwKICAgICAgICAiIgogICAgICApLnRyaW0oKTsK
CiAgICBpZiAoIXVzZXJuYW1lKSByZXR1cm47CgogICAgY29uc3QgYWN0aW9uID0KICAgICAgYWN0aW9uQnV0dG9uLmRhdGFzZXQKICAgICAgICAucGVvcGxl
U29jaWFsQWN0aW9uOwoKICAgIGlmIChhY3Rpb24gPT09ICJwcm9maWxlIikgewogICAgICB2b2lkIG9wZW5Qcm9maWxlKHVzZXJuYW1lKTsKICAgICAgcmV0
dXJuOwogICAgfQoKICAgIGlmIChhY3Rpb24gPT09ICJkbSIpIHsKICAgICAgdm9pZCBvcGVuRG0odXNlcm5hbWUpOwogICAgICByZXR1cm47CiAgICB9Cgog
ICAgaWYgKGFjdGlvbkJ1dHRvbi5kaXNhYmxlZCkgewogICAgICByZXR1cm47CiAgICB9CgogICAgYWN0aW9uQnV0dG9uLmRpc2FibGVkID0gdHJ1ZTsKCiAg
ICB0cnkgewogICAgICBpZiAoYWN0aW9uID09PSAicmVtb3ZlLWZyaWVuZCIpIHsKICAgICAgICBhd2FpdCBhcGkoCiAgICAgICAgICAiL2FwaS9zb2NpYWwv
ZnJpZW5kcy8iICsKICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KHVzZXJuYW1lKSwKICAgICAgICAgIHsgbWV0aG9kOiAiREVMRVRFIiB9CiAgICAg
ICAgKTsKICAgICAgfSBlbHNlIGlmIChhY3Rpb24gPT09ICJhY2NlcHQtZnJpZW5kIikgewogICAgICAgIGNvbnN0IHJlcXVlc3RJZCA9CiAgICAgICAgICBh
Y3Rpb25CdXR0b24uZGF0YXNldC5yZXF1ZXN0SWQ7CgogICAgICAgIGlmICghcmVxdWVzdElkKSByZXR1cm47CgogICAgICAgIGF3YWl0IGFwaSgKICAgICAg
ICAgICIvYXBpL3NvY2lhbC9mcmllbmQtcmVxdWVzdHMvIiArCiAgICAgICAgICAgIGVuY29kZVVSSUNvbXBvbmVudChyZXF1ZXN0SWQpICsKICAgICAgICAg
ICAgIi9hY2NlcHQiLAogICAgICAgICAgeyBtZXRob2Q6ICJQT1NUIiB9CiAgICAgICAgKTsKICAgICAgfSBlbHNlIGlmIChhY3Rpb24gPT09ICJhZGQtZnJp
ZW5kIikgewogICAgICAgIGF3YWl0IGFwaSgKICAgICAgICAgICIvYXBpL3NvY2lhbC9mcmllbmRzLyIgKwogICAgICAgICAgICBlbmNvZGVVUklDb21wb25l
bnQodXNlcm5hbWUpLAogICAgICAgICAgeyBtZXRob2Q6ICJQT1NUIiB9CiAgICAgICAgKTsKICAgICAgfSBlbHNlIHsKICAgICAgICByZXR1cm47CiAgICAg
IH0KCiAgICAgIGF3YWl0IHJlZnJlc2hGcmllbmRTdXJmYWNlcygpOwoKICAgICAgaWYgKAogICAgICAgIGN1cnJlbnRQcm9maWxlICYmCiAgICAgICAgY3Vy
cmVudFByb2ZpbGUudXNlcm5hbWUgPT09CiAgICAgICAgICB1c2VybmFtZQogICAgICApIHsKICAgICAgICBhd2FpdCBvcGVuUHJvZmlsZSh1c2VybmFtZSk7
CiAgICAgIH0KICAgIH0gY2F0Y2ggKGVycikgewogICAgICBhbGVydChlcnIubWVzc2FnZSk7CiAgICAgIGF3YWl0IHJlZnJlc2hGcmllbmRTdXJmYWNlcygp
OwogICAgfSBmaW5hbGx5IHsKICAgICAgaWYgKGFjdGlvbkJ1dHRvbi5pc0Nvbm5lY3RlZCkgewogICAgICAgIGFjdGlvbkJ1dHRvbi5kaXNhYmxlZCA9IGZh
bHNlOwogICAgICB9CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoYW5kbGVGcmllbmRSZXF1ZXN0Q2xpY2soCiAgICBldmVudAogICkgewogICAgY29u
c3QgYWN0aW9uQnV0dG9uID0KICAgICAgZXZlbnQudGFyZ2V0Py5jbG9zZXN0Py4oCiAgICAgICAgIltkYXRhLWZyaWVuZC1yZXF1ZXN0LWFjdGlvbl0iCiAg
ICAgICk7CgogICAgaWYgKCFhY3Rpb25CdXR0b24pIHJldHVybjsKCiAgICBjb25zdCByb3cgPQogICAgICBhY3Rpb25CdXR0b24uY2xvc2VzdCgKICAgICAg
ICAiLmZyaWVuZC1yZXF1ZXN0LXJvdyIKICAgICAgKTsKCiAgICBjb25zdCB1c2VybmFtZSA9CiAgICAgIFN0cmluZygKICAgICAgICByb3c/LmRhdGFzZXQ/
LnVzZXJuYW1lIHx8CiAgICAgICAgIiIKICAgICAgKS50cmltKCk7CgogICAgY29uc3QgcmVxdWVzdElkID0KICAgICAgU3RyaW5nKAogICAgICAgIHJvdz8u
ZGF0YXNldD8ucmVxdWVzdElkIHx8CiAgICAgICAgIiIKICAgICAgKS50cmltKCk7CgogICAgY29uc3QgYWN0aW9uID0KICAgICAgYWN0aW9uQnV0dG9uLmRh
dGFzZXQKICAgICAgICAuZnJpZW5kUmVxdWVzdEFjdGlvbjsKCiAgICBpZiAoCiAgICAgIGFjdGlvbiA9PT0gInByb2ZpbGUiCiAgICApIHsKICAgICAgaWYg
KHVzZXJuYW1lKSB7CiAgICAgICAgdm9pZCBvcGVuUHJvZmlsZSh1c2VybmFtZSk7CiAgICAgIH0KICAgICAgcmV0dXJuOwogICAgfQoKICAgIGlmICgKICAg
ICAgIXJlcXVlc3RJZCB8fAogICAgICBhY3Rpb25CdXR0b24uZGlzYWJsZWQKICAgICkgewogICAgICByZXR1cm47CiAgICB9CgogICAgYWN0aW9uQnV0dG9u
LmRpc2FibGVkID0gdHJ1ZTsKCiAgICB0cnkgewogICAgICBpZiAoYWN0aW9uID09PSAiYWNjZXB0IikgewogICAgICAgIGF3YWl0IGFwaSgKICAgICAgICAg
ICIvYXBpL3NvY2lhbC9mcmllbmQtcmVxdWVzdHMvIiArCiAgICAgICAgICAgIGVuY29kZVVSSUNvbXBvbmVudChyZXF1ZXN0SWQpICsKICAgICAgICAgICAg
Ii9hY2NlcHQiLAogICAgICAgICAgeyBtZXRob2Q6ICJQT1NUIiB9CiAgICAgICAgKTsKICAgICAgfSBlbHNlIGlmIChhY3Rpb24gPT09ICJkZWxldGUiKSB7
CiAgICAgICAgYXdhaXQgYXBpKAogICAgICAgICAgIi9hcGkvc29jaWFsL2ZyaWVuZC1yZXF1ZXN0cy8iICsKICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9u
ZW50KHJlcXVlc3RJZCksCiAgICAgICAgICB7IG1ldGhvZDogIkRFTEVURSIgfQogICAgICAgICk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgcmV0dXJuOwog
ICAgICB9CgogICAgICBhd2FpdCByZWZyZXNoRnJpZW5kU3VyZmFjZXMoKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBhbGVydChlcnIubWVzc2FnZSk7
CiAgICB9IGZpbmFsbHkgewogICAgICBpZiAoYWN0aW9uQnV0dG9uLmlzQ29ubmVjdGVkKSB7CiAgICAgICAgYWN0aW9uQnV0dG9uLmRpc2FibGVkID0gZmFs
c2U7CiAgICAgIH0KICAgIH0KICB9CgogIGZyaWVuZHNMaXN0Py5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgIGhhbmRsZVBlcnNvbkNhcmRD
bGljawogICk7CgogIHBlb3BsZURpcmVjdG9yeT8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJjbGljayIsCiAgICBoYW5kbGVQZXJzb25DYXJkQ2xpY2sKICAp
OwoKICBpbmNvbWluZ0ZyaWVuZFJlcXVlc3RzPy5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgIGhhbmRsZUZyaWVuZFJlcXVlc3RDbGljawog
ICk7CgogIG91dGdvaW5nRnJpZW5kUmVxdWVzdHM/LmFkZEV2ZW50TGlzdGVuZXIoCiAgICAiY2xpY2siLAogICAgaGFuZGxlRnJpZW5kUmVxdWVzdENsaWNr
CiAgKTsKCiAgLy8gPT09IFBFT1BMRV9BVkFUQVJfUFJFTE9BRF9TT0NJQUxfVjEgPT09CiAgZnVuY3Rpb24gcGVvcGxlUHJlbG9hZFNvY2lhbEF2YXRhcnMo
CiAgICB1c2VybmFtZXMKICApIHsKICAgIHZvaWQgd2luZG93LlBlb3BsZUF2YXRhcnMKICAgICAgPy5wcmVsb2FkTWFueSgKICAgICAgICB1c2VybmFtZXMK
ICAgICAgKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hGcmllbmRSZXF1ZXN0cygpIHsKICAgIGlmICgKICAgICAgIXNvY2lhbFJlYWR5IHx8CiAg
ICAgICFpbmNvbWluZ0ZyaWVuZFJlcXVlc3RzIHx8CiAgICAgICFvdXRnb2luZ0ZyaWVuZFJlcXVlc3RzCiAgICApIHsKICAgICAgcmV0dXJuOwogICAgfQoK
ICAgIHRyeSB7CiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhcGkoCiAgICAgICAgIi9hcGkvc29jaWFsL2ZyaWVuZC1yZXF1ZXN0cyIKICAgICAgKTsKCiAg
ICAgIGNvbnN0IGluY29taW5nID0KICAgICAgICBBcnJheS5pc0FycmF5KGRhdGEuaW5jb21pbmcpCiAgICAgICAgICA/IGRhdGEuaW5jb21pbmcKICAgICAg
ICAgIDogW107CgogICAgICBjb25zdCBvdXRnb2luZyA9CiAgICAgICAgQXJyYXkuaXNBcnJheShkYXRhLm91dGdvaW5nKQogICAgICAgICAgPyBkYXRhLm91
dGdvaW5nCiAgICAgICAgICA6IFtdOwoKICAgICAgcGVvcGxlUHJlbG9hZFNvY2lhbEF2YXRhcnMoCiAgICAgICAgWwogICAgICAgICAgLi4uaW5jb21pbmcs
CiAgICAgICAgICAuLi5vdXRnb2luZwogICAgICAgIF0ubWFwKAogICAgICAgICAgKHJlcXVlc3QpID0+CiAgICAgICAgICAgIHJlcXVlc3Q/LnVzZXI/LnVz
ZXJuYW1lCiAgICAgICAgKQogICAgICApOwoKICAgICAgaWYgKGZyaWVuZFJlcXVlc3RzQ291bnQpIHsKICAgICAgICBmcmllbmRSZXF1ZXN0c0NvdW50LnRl
eHRDb250ZW50ID0KICAgICAgICAgIFN0cmluZyhpbmNvbWluZy5sZW5ndGgpOwogICAgICB9CgogICAgICBjb25zdCBpbmNvbWluZ0ZyYWdtZW50ID0KICAg
ICAgICBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7CiAgICAgIGNvbnN0IG91dGdvaW5nRnJhZ21lbnQgPQogICAgICAgIGRvY3VtZW50LmNy
ZWF0ZURvY3VtZW50RnJhZ21lbnQoKTsKCiAgICAgIGlmICghaW5jb21pbmcubGVuZ3RoKSB7CiAgICAgICAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5jcmVh
dGVFbGVtZW50KCJkaXYiKTsKICAgICAgICBlbXB0eS5jbGFzc05hbWUgPSAiaG9tZS1lbXB0eSI7CiAgICAgICAgZW1wdHkudGV4dENvbnRlbnQgPQogICAg
ICAgICAgIkF1Y3VuZSBkZW1hbmRlIHJlw6d1ZS4iOwogICAgICAgIGluY29taW5nRnJhZ21lbnQuYXBwZW5kQ2hpbGQoZW1wdHkpOwogICAgICB9IGVsc2Ug
ewogICAgICAgIGZvciAoY29uc3QgcmVxdWVzdCBvZiBpbmNvbWluZykgewogICAgICAgICAgaW5jb21pbmdGcmFnbWVudC5hcHBlbmRDaGlsZCgKICAgICAg
ICAgICAgbWFrZUZyaWVuZFJlcXVlc3RSb3coCiAgICAgICAgICAgICAgcmVxdWVzdCwKICAgICAgICAgICAgICAiaW5jb21pbmciCiAgICAgICAgICAgICkK
ICAgICAgICAgICk7CiAgICAgICAgfQogICAgICB9CgogICAgICBpZiAoIW91dGdvaW5nLmxlbmd0aCkgewogICAgICAgIGNvbnN0IGVtcHR5ID0gZG9jdW1l
bnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICAgICAgZW1wdHkuY2xhc3NOYW1lID0gImhvbWUtZW1wdHkiOwogICAgICAgIGVtcHR5LnRleHRDb250ZW50
ID0KICAgICAgICAgICJBdWN1bmUgZGVtYW5kZSBlbiBhdHRlbnRlLiI7CiAgICAgICAgb3V0Z29pbmdGcmFnbWVudC5hcHBlbmRDaGlsZChlbXB0eSk7CiAg
ICAgIH0gZWxzZSB7CiAgICAgICAgZm9yIChjb25zdCByZXF1ZXN0IG9mIG91dGdvaW5nKSB7CiAgICAgICAgICBvdXRnb2luZ0ZyYWdtZW50LmFwcGVuZENo
aWxkKAogICAgICAgICAgICBtYWtlRnJpZW5kUmVxdWVzdFJvdygKICAgICAgICAgICAgICByZXF1ZXN0LAogICAgICAgICAgICAgICJvdXRnb2luZyIKICAg
ICAgICAgICAgKQogICAgICAgICAgKTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIGluY29taW5nRnJpZW5kUmVxdWVzdHMucmVwbGFjZUNoaWxkcmVuKAog
ICAgICAgIGluY29taW5nRnJhZ21lbnQKICAgICAgKTsKICAgICAgb3V0Z29pbmdGcmllbmRSZXF1ZXN0cy5yZXBsYWNlQ2hpbGRyZW4oCiAgICAgICAgb3V0
Z29pbmdGcmFnbWVudAogICAgICApOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2
Iik7CiAgICAgIGVtcHR5LmNsYXNzTmFtZSA9ICJob21lLWVtcHR5IjsKICAgICAgZW1wdHkudGV4dENvbnRlbnQgPSBlcnIubWVzc2FnZTsKCiAgICAgIGlu
Y29taW5nRnJpZW5kUmVxdWVzdHMucmVwbGFjZUNoaWxkcmVuKAogICAgICAgIGVtcHR5CiAgICAgICk7CiAgICAgIG91dGdvaW5nRnJpZW5kUmVxdWVzdHMu
cmVwbGFjZUNoaWxkcmVuKCk7CiAgICB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiByZWZyZXNoRnJpZW5kU3VyZmFjZXMoKSB7CiAgICBpZiAoZnJpZW5kU3Vy
ZmFjZXNSZWZyZXNoUHJvbWlzZSkgewogICAgICBmcmllbmRTdXJmYWNlc1JlZnJlc2hRdWV1ZWQgPSB0cnVlOwogICAgICByZXR1cm4gZnJpZW5kU3VyZmFj
ZXNSZWZyZXNoUHJvbWlzZTsKICAgIH0KCiAgICBmcmllbmRTdXJmYWNlc1JlZnJlc2hQcm9taXNlID0KICAgICAgKGFzeW5jICgpID0+IHsKICAgICAgICBk
byB7CiAgICAgICAgICBmcmllbmRTdXJmYWNlc1JlZnJlc2hRdWV1ZWQgPSBmYWxzZTsKCiAgICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChbCiAgICAgICAg
ICAgIHJlZnJlc2hGcmllbmRSZXF1ZXN0cygpLAogICAgICAgICAgICByZWZyZXNoRnJpZW5kcygpLAogICAgICAgICAgICByZWZyZXNoRGlyZWN0b3J5KAog
ICAgICAgICAgICAgIHBlb3BsZVNlYXJjaElucHV0Py52YWx1ZSB8fCAiIgogICAgICAgICAgICApCiAgICAgICAgICBdKTsKICAgICAgICB9IHdoaWxlICgK
ICAgICAgICAgIGZyaWVuZFN1cmZhY2VzUmVmcmVzaFF1ZXVlZCAmJgogICAgICAgICAgc29jaWFsUmVhZHkKICAgICAgICApOwogICAgICB9KSgpOwoKICAg
IHRyeSB7CiAgICAgIGF3YWl0IGZyaWVuZFN1cmZhY2VzUmVmcmVzaFByb21pc2U7CiAgICB9IGZpbmFsbHkgewogICAgICBmcmllbmRTdXJmYWNlc1JlZnJl
c2hQcm9taXNlID0gbnVsbDsKICAgIH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hGcmllbmRzKCkgewogICAgaWYgKCFzb2NpYWxSZWFkeSB8fCAh
ZnJpZW5kc0xpc3QpIHJldHVybjsKCiAgICB0cnkgewogICAgICBjb25zdCBkYXRhID0gYXdhaXQgYXBpKCIvYXBpL3NvY2lhbC9mcmllbmRzIik7CiAgICAg
IGNvbnN0IGxpc3QgPSBBcnJheS5pc0FycmF5KGRhdGEuZnJpZW5kcykKICAgICAgICA/IGRhdGEuZnJpZW5kcwogICAgICAgIDogW107CgogICAgICBwZW9w
bGVQcmVsb2FkU29jaWFsQXZhdGFycygKICAgICAgICBsaXN0Lm1hcCgKICAgICAgICAgIChwZXJzb24pID0+CiAgICAgICAgICAgIHBlcnNvbj8udXNlcm5h
bWUKICAgICAgICApCiAgICAgICk7CgogICAgICBpZiAoZnJpZW5kc0NvdW50KSB7CiAgICAgICAgZnJpZW5kc0NvdW50LnRleHRDb250ZW50ID0gU3RyaW5n
KGxpc3QubGVuZ3RoKTsKICAgICAgfQoKICAgICAgY29uc3QgZnJhZ21lbnQgPQogICAgICAgIGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTsK
CiAgICAgIGlmICghbGlzdC5sZW5ndGgpIHsKICAgICAgICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgICAgIGVt
cHR5LmNsYXNzTmFtZSA9ICJob21lLWVtcHR5IjsKICAgICAgICBlbXB0eS50ZXh0Q29udGVudCA9CiAgICAgICAgICAiQXVjdW4gYW1pIHBvdXIgbCdpbnN0
YW50LiBDaGVyY2hlIHF1ZWxxdSd1biBqdXN0ZSBhdS1kZXNzdXMuIjsKICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChlbXB0eSk7CiAgICAgIH0gZWxz
ZSB7CiAgICAgICAgZm9yIChjb25zdCBwZXJzb24gb2YgbGlzdCkgewogICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoCiAgICAgICAgICAgIG1ha2VQ
ZXJzb25DYXJkKHBlcnNvbiwgdHJ1ZSkKICAgICAgICAgICk7CiAgICAgICAgfQogICAgICB9CgogICAgICBmcmllbmRzTGlzdC5yZXBsYWNlQ2hpbGRyZW4o
ZnJhZ21lbnQpOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIGNvbnN0IGVtcHR5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICAgIGVt
cHR5LmNsYXNzTmFtZSA9ICJob21lLWVtcHR5IjsKICAgICAgZW1wdHkudGV4dENvbnRlbnQgPSBlcnIubWVzc2FnZTsKICAgICAgZnJpZW5kc0xpc3QucmVw
bGFjZUNoaWxkcmVuKGVtcHR5KTsKICAgIH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hEaXJlY3RvcnkocXVlcnkgPSAiIikgewogICAgaWYgKCFz
b2NpYWxSZWFkeSB8fCAhcGVvcGxlRGlyZWN0b3J5KSByZXR1cm47CgogICAgY29uc3QgY2xlYW5RdWVyeSA9CiAgICAgIFN0cmluZyhxdWVyeSB8fCAiIikK
ICAgICAgICAudHJpbSgpCiAgICAgICAgLnNsaWNlKDAsIDUwKTsKCiAgICBjb25zdCByZXF1ZXN0VmVyc2lvbiA9CiAgICAgICsrZGlyZWN0b3J5UmVxdWVz
dFZlcnNpb247CgogICAgdHJ5IHsKICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFwaSgKICAgICAgICAiL2FwaS9zb2NpYWwvcGVvcGxlP3E9IiArCiAgICAg
ICAgICBlbmNvZGVVUklDb21wb25lbnQoCiAgICAgICAgICAgIGNsZWFuUXVlcnkKICAgICAgICAgICkKICAgICAgKTsKCiAgICAgIGlmICgKICAgICAgICBy
ZXF1ZXN0VmVyc2lvbiAhPT0KICAgICAgICBkaXJlY3RvcnlSZXF1ZXN0VmVyc2lvbgogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAg
IGNvbnN0IGxpc3QgPQogICAgICAgIEFycmF5LmlzQXJyYXkoZGF0YS5wZW9wbGUpCiAgICAgICAgICA/IGRhdGEucGVvcGxlCiAgICAgICAgICA6IFtdOwoK
ICAgICAgcGVvcGxlUHJlbG9hZFNvY2lhbEF2YXRhcnMoCiAgICAgICAgbGlzdC5tYXAoCiAgICAgICAgICAocGVyc29uKSA9PgogICAgICAgICAgICBwZXJz
b24/LnVzZXJuYW1lCiAgICAgICAgKQogICAgICApOwoKICAgICAgaWYgKCFsaXN0Lmxlbmd0aCkgewogICAgICAgIGlmICghY2xlYW5RdWVyeSkgewogICAg
ICAgICAgaWYgKHBlb3BsZURpcmVjdG9yeVNlY3Rpb24pIHsKICAgICAgICAgICAgcGVvcGxlRGlyZWN0b3J5U2VjdGlvbgogICAgICAgICAgICAgIC5zdHls
ZS5kaXNwbGF5ID0gIm5vbmUiOwogICAgICAgICAgfQoKICAgICAgICAgIHBlb3BsZURpcmVjdG9yeS5yZXBsYWNlQ2hpbGRyZW4oKTsKICAgICAgICAgIHJl
dHVybjsKICAgICAgICB9CgogICAgICAgIGlmIChwZW9wbGVEaXJlY3RvcnlTZWN0aW9uKSB7CiAgICAgICAgICBwZW9wbGVEaXJlY3RvcnlTZWN0aW9uCiAg
ICAgICAgICAgIC5zdHlsZS5kaXNwbGF5ID0gIiI7CiAgICAgICAgfQoKICAgICAgICBjb25zdCBlbXB0eSA9CiAgICAgICAgICBkb2N1bWVudC5jcmVhdGVF
bGVtZW50KAogICAgICAgICAgICAiZGl2IgogICAgICAgICAgKTsKCiAgICAgICAgZW1wdHkuY2xhc3NOYW1lID0KICAgICAgICAgICJob21lLWVtcHR5IjsK
CiAgICAgICAgZW1wdHkudGV4dENvbnRlbnQgPQogICAgICAgICAgIkF1Y3VuIGNvbXB0ZSB0cm91dsOpLiI7CgogICAgICAgIHBlb3BsZURpcmVjdG9yeS5y
ZXBsYWNlQ2hpbGRyZW4oCiAgICAgICAgICBlbXB0eQogICAgICAgICk7CgogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgaWYgKHBlb3BsZURpcmVj
dG9yeVNlY3Rpb24pIHsKICAgICAgICBwZW9wbGVEaXJlY3RvcnlTZWN0aW9uCiAgICAgICAgICAuc3R5bGUuZGlzcGxheSA9ICIiOwogICAgICB9CgogICAg
ICBjb25zdCBmcmFnbWVudCA9CiAgICAgICAgZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpOwoKICAgICAgZm9yIChjb25zdCBwZXJzb24gb2Yg
bGlzdCkgewogICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKAogICAgICAgICAgbWFrZVBlcnNvbkNhcmQoCiAgICAgICAgICAgIHBlcnNvbgogICAgICAg
ICAgKQogICAgICAgICk7CiAgICAgIH0KCiAgICAgIHBlb3BsZURpcmVjdG9yeS5yZXBsYWNlQ2hpbGRyZW4oCiAgICAgICAgZnJhZ21lbnQKICAgICAgKTsK
ICAgIH0gY2F0Y2ggKGVycikgewogICAgICBpZiAoCiAgICAgICAgcmVxdWVzdFZlcnNpb24gIT09CiAgICAgICAgZGlyZWN0b3J5UmVxdWVzdFZlcnNpb24K
ICAgICAgKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpZiAocGVvcGxlRGlyZWN0b3J5U2VjdGlvbikgewogICAgICAgIHBlb3BsZURpcmVj
dG9yeVNlY3Rpb24KICAgICAgICAgIC5zdHlsZS5kaXNwbGF5ID0KICAgICAgICAgIGNsZWFuUXVlcnkKICAgICAgICAgICAgPyAiIgogICAgICAgICAgICA6
ICJub25lIjsKICAgICAgfQoKICAgICAgaWYgKCFjbGVhblF1ZXJ5KSB7CiAgICAgICAgcGVvcGxlRGlyZWN0b3J5LnJlcGxhY2VDaGlsZHJlbigpOwogICAg
ICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc3QgZW1wdHkgPQogICAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoCiAgICAgICAgICAiZGl2Igog
ICAgICAgICk7CgogICAgICBlbXB0eS5jbGFzc05hbWUgPQogICAgICAgICJob21lLWVtcHR5IjsKCiAgICAgIGVtcHR5LnRleHRDb250ZW50ID0KICAgICAg
ICBlcnIubWVzc2FnZTsKCiAgICAgIHBlb3BsZURpcmVjdG9yeS5yZXBsYWNlQ2hpbGRyZW4oCiAgICAgICAgZW1wdHkKICAgICAgKTsKICAgIH0KICB9Cgog
IC8vID09PSBQRU9QTEVfRE1fQ0xPU0VfQ0xJRU5UX1YxX1NUQVJUID09PQogIGxldCBwZW9wbGVEbUNvbnRleHRNZW51ID0KICAgIG51bGw7CgogIGZ1bmN0
aW9uIGNsb3NlRG1Db250ZXh0TWVudSgpIHsKICAgIHBlb3BsZURtQ29udGV4dE1lbnUKICAgICAgPy5yZW1vdmUoKTsKCiAgICBwZW9wbGVEbUNvbnRleHRN
ZW51ID0KICAgICAgbnVsbDsKICB9CgogIGZ1bmN0aW9uIHBvc2l0aW9uRG1Db250ZXh0TWVudSgKICAgIG1lbnUsCiAgICB4LAogICAgeQogICkgewogICAg
Y29uc3QgbWFyZ2luID0KICAgICAgODsKCiAgICBjb25zdCByZWN0ID0KICAgICAgbWVudS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsKCiAgICBjb25zdCBs
ZWZ0ID0KICAgICAgTWF0aC5tYXgoCiAgICAgICAgbWFyZ2luLAogICAgICAgIE1hdGgubWluKAogICAgICAgICAgd2luZG93LmlubmVyV2lkdGggLQogICAg
ICAgICAgICByZWN0LndpZHRoIC0KICAgICAgICAgICAgbWFyZ2luLAogICAgICAgICAgeAogICAgICAgICkKICAgICAgKTsKCiAgICBjb25zdCB0b3AgPQog
ICAgICBNYXRoLm1heCgKICAgICAgICBtYXJnaW4sCiAgICAgICAgTWF0aC5taW4oCiAgICAgICAgICB3aW5kb3cuaW5uZXJIZWlnaHQgLQogICAgICAgICAg
ICByZWN0LmhlaWdodCAtCiAgICAgICAgICAgIG1hcmdpbiwKICAgICAgICAgIHkKICAgICAgICApCiAgICAgICk7CgogICAgbWVudS5zdHlsZS5sZWZ0ID0K
ICAgICAgbGVmdCArICJweCI7CgogICAgbWVudS5zdHlsZS50b3AgPQogICAgICB0b3AgKyAicHgiOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gY2xvc2VEbUZv
ck1lKAogICAgdXNlcm5hbWUKICApIHsKICAgIGNvbnN0IHdhbnRlZCA9CiAgICAgIFN0cmluZygKICAgICAgICB1c2VybmFtZSB8fAogICAgICAgICIiCiAg
ICAgICkudHJpbSgpOwoKICAgIGlmICghd2FudGVkKSB7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBhd2FpdCBhcGkoCiAgICAgICIvYXBpL2RtLyIgKwog
ICAgICAgIGVuY29kZVVSSUNvbXBvbmVudCgKICAgICAgICAgIHdhbnRlZAogICAgICAgICkgKwogICAgICAgICIvY2xvc2UiLAogICAgICB7CiAgICAgICAg
bWV0aG9kOgogICAgICAgICAgIlBPU1QiCiAgICAgIH0KICAgICk7CgogICAgaWYgKAogICAgICBhY3RpdmVEbVVzZXIgJiYKICAgICAgYWN0aXZlRG1Vc2Vy
LnVzZXJuYW1lID09PQogICAgICAgIHdhbnRlZAogICAgKSB7CiAgICAgIHNob3dGcmllbmRzKCk7CiAgICB9CgogICAgYXdhaXQgcmVmcmVzaENvbnZlcnNh
dGlvbnMoKTsKICB9CgogIGZ1bmN0aW9uIHNob3dEbUNvbnRleHRNZW51KAogICAgY29udmVyc2F0aW9uLAogICAgeCwKICAgIHkKICApIHsKICAgIGNsb3Nl
RG1Db250ZXh0TWVudSgpOwoKICAgIGNvbnN0IG1lbnUgPQogICAgICBkb2N1bWVudC5jcmVhdGVFbGVtZW50KAogICAgICAgICJkaXYiCiAgICAgICk7Cgog
ICAgbWVudS5jbGFzc05hbWUgPQogICAgICAicGVvcGxlLWRtLWNvbnRleHQtbWVudSI7CgogICAgY29uc3QgY2xvc2VCdXR0b24gPQogICAgICBkb2N1bWVu
dC5jcmVhdGVFbGVtZW50KAogICAgICAgICJidXR0b24iCiAgICAgICk7CgogICAgY2xvc2VCdXR0b24udHlwZSA9CiAgICAgICJidXR0b24iOwoKICAgIGNs
b3NlQnV0dG9uLmNsYXNzTmFtZSA9CiAgICAgICJwZW9wbGUtZG0tY29udGV4dC1pdGVtIGRhbmdlciI7CgogICAgY2xvc2VCdXR0b24udGV4dENvbnRlbnQg
PQogICAgICAiRmVybWVyIGxlIE1QIjsKCiAgICBjbG9zZUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKAogICAgICAiY2xpY2siLAogICAgICBhc3luYyAoKSA9
PiB7CiAgICAgICAgY2xvc2VEbUNvbnRleHRNZW51KCk7CgogICAgICAgIHRyeSB7CiAgICAgICAgICBhd2FpdCBjbG9zZURtRm9yTWUoCiAgICAgICAgICAg
IGNvbnZlcnNhdGlvbi51c2VyLnVzZXJuYW1lCiAgICAgICAgICApOwogICAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgICAgYWxlcnQoCiAgICAgICAg
ICAgIGVycj8ubWVzc2FnZSB8fAogICAgICAgICAgICAiSW1wb3NzaWJsZSBkZSBmZXJtZXIgY2UgTVAuIgogICAgICAgICAgKTsKICAgICAgICB9CiAgICAg
IH0KICAgICk7CgogICAgbWVudS5hcHBlbmRDaGlsZCgKICAgICAgY2xvc2VCdXR0b24KICAgICk7CgogICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZCgK
ICAgICAgbWVudQogICAgKTsKCiAgICBwZW9wbGVEbUNvbnRleHRNZW51ID0KICAgICAgbWVudTsKCiAgICBwb3NpdGlvbkRtQ29udGV4dE1lbnUoCiAgICAg
IG1lbnUsCiAgICAgIHgsCiAgICAgIHkKICAgICk7CiAgfQoKICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKAogICAgInBvaW50ZXJkb3duIiwKICAgIChl
dmVudCkgPT4gewogICAgICBpZiAoCiAgICAgICAgcGVvcGxlRG1Db250ZXh0TWVudSAmJgogICAgICAgICFwZW9wbGVEbUNvbnRleHRNZW51CiAgICAgICAg
ICAuY29udGFpbnMoCiAgICAgICAgICAgIGV2ZW50LnRhcmdldAogICAgICAgICAgKQogICAgICApIHsKICAgICAgICBjbG9zZURtQ29udGV4dE1lbnUoKTsK
ICAgICAgfQogICAgfSwKICAgIHRydWUKICApOwoKICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKAogICAgImtleWRvd24iLAogICAgKGV2ZW50KSA9PiB7
CiAgICAgIGlmICgKICAgICAgICBldmVudC5rZXkgPT09CiAgICAgICAgIkVzY2FwZSIKICAgICAgKSB7CiAgICAgICAgY2xvc2VEbUNvbnRleHRNZW51KCk7
CiAgICAgIH0KICAgIH0KICApOwogIC8vID09PSBQRU9QTEVfRE1fQ0xPU0VfQ0xJRU5UX1YxX0VORCA9PT0KCiAgZnVuY3Rpb24gcmVuZGVyQ29udmVyc2F0
aW9uTGlzdCgpIHsKICAgIGlmICghZG1Db252ZXJzYXRpb25MaXN0KSByZXR1cm47CgogICAgY29uc3QgZnJhZ21lbnQgPQogICAgICBkb2N1bWVudC5jcmVh
dGVEb2N1bWVudEZyYWdtZW50KCk7CgogICAgaWYgKCFjb252ZXJzYXRpb25zLmxlbmd0aCkgewogICAgICBjb25zdCBlbXB0eSA9IGRvY3VtZW50LmNyZWF0
ZUVsZW1lbnQoImRpdiIpOwogICAgICBlbXB0eS5jbGFzc05hbWUgPSAiZG0tc2lkZWJhci1lbXB0eSI7CiAgICAgIGVtcHR5LnRleHRDb250ZW50ID0gIkF1
Y3VuIE1QIHBvdXIgbCdpbnN0YW50IjsKICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZW1wdHkpOwogICAgICBkbUNvbnZlcnNhdGlvbkxpc3QucmVwbGFj
ZUNoaWxkcmVuKGZyYWdtZW50KTsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIGZvciAoY29uc3QgY29udmVyc2F0aW9uIG9mIGNvbnZlcnNhdGlvbnMpIHsK
ICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYnV0dG9uIik7CiAgICAgIHJvdy50eXBlID0gImJ1dHRvbiI7CiAgICAgIHJvdy5j
bGFzc05hbWUgPSAiZG0tY29udmVyc2F0aW9uLXJvdyI7CiAgICAgIHJvdy5kYXRhc2V0LnVzZXJuYW1lID0KICAgICAgICBjb252ZXJzYXRpb24udXNlci51
c2VybmFtZTsKCiAgICAgIGlmICgKICAgICAgICBhY3RpdmVEbVVzZXIgJiYKICAgICAgICBhY3RpdmVEbVVzZXIudXNlcm5hbWUgPT09CiAgICAgICAgICBj
b252ZXJzYXRpb24udXNlci51c2VybmFtZQogICAgICApIHsKICAgICAgICByb3cuY2xhc3NMaXN0LmFkZCgiYWN0aXZlIik7CiAgICAgIH0KCiAgICAgIGNv
bnN0IGF2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic3BhbiIpOwogICAgICBhdi5jbGFzc05hbWUgPSAiZG0tc2lkZWJhci1hdmF0YXIiOwogICAgICB3
aW5kb3cuUGVvcGxlQXZhdGFycz8uYXBwbHkoCiAgICAgICAgYXYsCiAgICAgICAgY29udmVyc2F0aW9uLnVzZXIudXNlcm5hbWUKICAgICAgKTsKCiAgICAg
IGNvbnN0IGNvcHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJzcGFuIik7CiAgICAgIGNvcHkuY2xhc3NOYW1lID0gImRtLXNpZGViYXItY29weSI7Cgog
ICAgICBjb25zdCBuYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic3Ryb25nIik7CiAgICAgIG5hbWUudGV4dENvbnRlbnQgPSBjb252ZXJzYXRpb24u
dXNlci51c2VybmFtZTsKCiAgICAgIGNvbnN0IHByZXZpZXcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJzbWFsbCIpOwogICAgICBwcmV2aWV3LnRleHRD
b250ZW50ID0KICAgICAgICBjb252ZXJzYXRpb24ubGFzdE1lc3NhZ2UgfHwgIk1lc3NhZ2UgcHJpdsOpIjsKCiAgICAgIC8vID09PSBQRU9QTEVfRE1fU0lE
RUJBUl9NUF9QUklPUklUWV9WMSA9PT0KICAgICAgLyoKICAgICAgICBEYW5zIGxhIGxpc3RlIGRlcyBNUCwgUFAgKyBwc2V1ZG8gZm9udCBwYXJ0aWUgZGUg
bGEgbGlnbmUKICAgICAgICBkZSBjb252ZXJzYXRpb24gOiB0b3V0IGNsaWMgb3V2cmUgbGUgTVAuCiAgICAgICAgTGVzIHByb2ZpbHMgcmVzdGVudCBjbGlx
dWFibGVzIGFpbGxldXJzIGRhbnMgUGVvcGxlLgogICAgICAqLwogICAgICBjb3B5LmFwcGVuZChuYW1lLCBwcmV2aWV3KTsKCiAgICAgIHJvdy5hcHBlbmQo
YXYsIGNvcHkpOwoKICAgICAgaWYgKGNvbnZlcnNhdGlvbi51bnJlYWRDb3VudCA+IDApIHsKICAgICAgICBjb25zdCBiYWRnZSA9IGRvY3VtZW50LmNyZWF0
ZUVsZW1lbnQoInNwYW4iKTsKICAgICAgICBiYWRnZS5jbGFzc05hbWUgPSAiZG0tdW5yZWFkLWJhZGdlIjsKICAgICAgICBiYWRnZS50ZXh0Q29udGVudCA9
CiAgICAgICAgICBjb252ZXJzYXRpb24udW5yZWFkQ291bnQgPiA5OQogICAgICAgICAgICA/ICI5OSsiCiAgICAgICAgICAgIDogU3RyaW5nKGNvbnZlcnNh
dGlvbi51bnJlYWRDb3VudCk7CiAgICAgICAgcm93LmFwcGVuZENoaWxkKGJhZGdlKTsKICAgICAgfQoKICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQocm93
KTsKICAgIH0KCiAgICBkbUNvbnZlcnNhdGlvbkxpc3QucmVwbGFjZUNoaWxkcmVuKAogICAgICBmcmFnbWVudAogICAgKTsKICB9CgoKICAvLyBQcsOpY2hh
cmdlbWVudCBsw6lnZXIgYXUgc3Vydm9sL2ZvY3VzIDogc3VyIGRlc2t0b3AsIGxlIHLDqXNlYXUgZXQgbGUKICAvLyBkw6ljaGlmZnJlbWVudCBwZXV2ZW50
IGNvbW1lbmNlciBhdmFudCBsZSBjbGljIHLDqWVsLiBBdWN1biBNUCBuJ2VzdAogIC8vIG1hcnF1w6kgbHUgcGFyIGNlIHByw6ljaGFyZ2VtZW50LgogIGRt
Q29udmVyc2F0aW9uTGlzdD8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJwb2ludGVyb3ZlciIsCiAgICAoZXZlbnQpID0+IHsKICAgICAgY29uc3Qgcm93ID0g
ZXZlbnQudGFyZ2V0Py5jbG9zZXN0Py4oIi5kbS1jb252ZXJzYXRpb24tcm93Iik7CiAgICAgIGNvbnN0IHVzZXJuYW1lID0gU3RyaW5nKHJvdz8uZGF0YXNl
dD8udXNlcm5hbWUgfHwgIiIpLnRyaW0oKTsKICAgICAgaWYgKCF1c2VybmFtZSkgcmV0dXJuOwoKICAgICAgaWYgKAogICAgICAgIGV2ZW50LnJlbGF0ZWRU
YXJnZXQgaW5zdGFuY2VvZiBOb2RlICYmCiAgICAgICAgcm93Py5jb250YWlucyhldmVudC5yZWxhdGVkVGFyZ2V0KQogICAgICApIHsKICAgICAgICByZXR1
cm47CiAgICAgIH0KCiAgICAgIGNsZWFyVGltZW91dChwZW9wbGVEbVByZWZldGNoVGltZXIpOwogICAgICBwZW9wbGVEbVByZWZldGNoVGltZXIgPSBzZXRU
aW1lb3V0KAogICAgICAgICgpID0+IHZvaWQgcGVvcGxlRG1QcmVmZXRjaCh1c2VybmFtZSksCiAgICAgICAgNzAKICAgICAgKTsKICAgIH0sCiAgICB7IHBh
c3NpdmU6IHRydWUgfQogICk7CgogIGRtQ29udmVyc2F0aW9uTGlzdD8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJmb2N1c2luIiwKICAgIChldmVudCkgPT4g
ewogICAgICBjb25zdCByb3cgPSBldmVudC50YXJnZXQ/LmNsb3Nlc3Q/LigiLmRtLWNvbnZlcnNhdGlvbi1yb3ciKTsKICAgICAgY29uc3QgdXNlcm5hbWUg
PSBTdHJpbmcocm93Py5kYXRhc2V0Py51c2VybmFtZSB8fCAiIikudHJpbSgpOwogICAgICBpZiAodXNlcm5hbWUpIHZvaWQgcGVvcGxlRG1QcmVmZXRjaCh1
c2VybmFtZSk7CiAgICB9CiAgKTsKCiAgZG1Db252ZXJzYXRpb25MaXN0Py5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgIChldmVudCkgPT4g
ewogICAgICBjb25zdCByb3cgPQogICAgICAgIGV2ZW50LnRhcmdldD8uY2xvc2VzdD8uKAogICAgICAgICAgIi5kbS1jb252ZXJzYXRpb24tcm93IgogICAg
ICAgICk7CgogICAgICBjb25zdCB1c2VybmFtZSA9CiAgICAgICAgU3RyaW5nKAogICAgICAgICAgcm93Py5kYXRhc2V0Py51c2VybmFtZSB8fAogICAgICAg
ICAgIiIKICAgICAgICApLnRyaW0oKTsKCiAgICAgIGlmICh1c2VybmFtZSkgewogICAgICAgIHZvaWQgb3BlbkRtKHVzZXJuYW1lKTsKICAgICAgfQogICAg
fQogICk7CgogIGRtQ29udmVyc2F0aW9uTGlzdD8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJjb250ZXh0bWVudSIsCiAgICAoZXZlbnQpID0+IHsKICAgICAg
Y29uc3Qgcm93ID0KICAgICAgICBldmVudC50YXJnZXQ/LmNsb3Nlc3Q/LigKICAgICAgICAgICIuZG0tY29udmVyc2F0aW9uLXJvdyIKICAgICAgICApOwoK
ICAgICAgY29uc3QgdXNlcm5hbWUgPQogICAgICAgIFN0cmluZygKICAgICAgICAgIHJvdz8uZGF0YXNldD8udXNlcm5hbWUgfHwKICAgICAgICAgICIiCiAg
ICAgICAgKS50cmltKCk7CgogICAgICBpZiAoIXVzZXJuYW1lKSByZXR1cm47CgogICAgICBjb25zdCBjb252ZXJzYXRpb24gPQogICAgICAgIGNvbnZlcnNh
dGlvbnNCeVVzZXJuYW1lLmdldCgKICAgICAgICAgIHVzZXJuYW1lCiAgICAgICAgKTsKCiAgICAgIGlmICghY29udmVyc2F0aW9uKSByZXR1cm47CgogICAg
ICBldmVudC5wcmV2ZW50RGVmYXVsdCgpOwogICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTsKCiAgICAgIHNob3dEbUNvbnRleHRNZW51KAogICAgICAg
IGNvbnZlcnNhdGlvbiwKICAgICAgICBldmVudC5jbGllbnRYLAogICAgICAgIGV2ZW50LmNsaWVudFkKICAgICAgKTsKICAgIH0KICApOwoKICBhc3luYyBm
dW5jdGlvbiByZWZyZXNoQ29udmVyc2F0aW9ucygpIHsKICAgIGlmICghc29jaWFsUmVhZHkpIHJldHVybjsKCiAgICBpZiAoY29udmVyc2F0aW9uc1JlZnJl
c2hQcm9taXNlKSB7CiAgICAgIGNvbnZlcnNhdGlvbnNSZWZyZXNoUXVldWVkID0gdHJ1ZTsKICAgICAgcmV0dXJuIGNvbnZlcnNhdGlvbnNSZWZyZXNoUHJv
bWlzZTsKICAgIH0KCiAgICBjb252ZXJzYXRpb25zUmVmcmVzaFByb21pc2UgPQogICAgICAoYXN5bmMgKCkgPT4gewogICAgICAgIGRvIHsKICAgICAgICAg
IGNvbnZlcnNhdGlvbnNSZWZyZXNoUXVldWVkID0gZmFsc2U7CgogICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFwaSgK
ICAgICAgICAgICAgICAiL2FwaS9kbS9jb252ZXJzYXRpb25zIgogICAgICAgICAgICApOwoKICAgICAgICAgICAgY29uc3QgcmF3Q29udmVyc2F0aW9ucyA9
CiAgICAgICAgICAgICAgQXJyYXkuaXNBcnJheSgKICAgICAgICAgICAgICAgIGRhdGEuY29udmVyc2F0aW9ucwogICAgICAgICAgICAgICkKICAgICAgICAg
ICAgICAgID8gZGF0YS5jb252ZXJzYXRpb25zCiAgICAgICAgICAgICAgICA6IFtdOwoKICAgICAgICAgICAgY29udmVyc2F0aW9ucyA9CiAgICAgICAgICAg
ICAgYXdhaXQgUHJvbWlzZS5hbGwoCiAgICAgICAgICAgICAgICByYXdDb252ZXJzYXRpb25zLm1hcCgKICAgICAgICAgICAgICAgICAgYXN5bmMgKAogICAg
ICAgICAgICAgICAgICAgIGNvbnZlcnNhdGlvbgogICAgICAgICAgICAgICAgICApID0+IHsKICAgICAgICAgICAgICAgICAgICBjb25zdCBlbmNyeXB0ZWRQ
cmV2aWV3ID0KICAgICAgICAgICAgICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgICAgICAgICAgICAgY29udmVyc2F0aW9uPy5sYXN0TWVzc2FnZUUy
ZWUgfHwKICAgICAgICAgICAgICAgICAgICAgICAgIiIKICAgICAgICAgICAgICAgICAgICAgICk7CgogICAgICAgICAgICAgICAgICAgIGlmICgKICAgICAg
ICAgICAgICAgICAgICAgICFlbmNyeXB0ZWRQcmV2aWV3LnN0YXJ0c1dpdGgoCiAgICAgICAgICAgICAgICAgICAgICAgIFBFT1BMRV9ETV9FMkVFX1BSRUZJ
WAogICAgICAgICAgICAgICAgICAgICAgKQogICAgICAgICAgICAgICAgICAgICkgewogICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNvbnZlcnNhdGlv
bjsKICAgICAgICAgICAgICAgICAgICB9CgogICAgICAgICAgICAgICAgICAgIGNvbnN0IGRlY3J5cHRlZFByZXZpZXcgPQogICAgICAgICAgICAgICAgICAg
ICAgYXdhaXQgcGVvcGxlRG1FMmVlRGVjcnlwdFRleHQoCiAgICAgICAgICAgICAgICAgICAgICAgIGVuY3J5cHRlZFByZXZpZXcKICAgICAgICAgICAgICAg
ICAgICAgICk7CgogICAgICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFuUHJldmlldyA9CiAgICAgICAgICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAg
ICAgICAgICAgICAgICAgIGRlY3J5cHRlZFByZXZpZXcgfHwKICAgICAgICAgICAgICAgICAgICAgICAgIiIKICAgICAgICAgICAgICAgICAgICAgICkudHJp
bSgpOwoKICAgICAgICAgICAgICAgICAgICByZXR1cm4gewogICAgICAgICAgICAgICAgICAgICAgLi4uY29udmVyc2F0aW9uLAogICAgICAgICAgICAgICAg
ICAgICAgbGFzdE1lc3NhZ2U6CiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFuUHJldmlldyAmJgogICAgICAgICAgICAgICAgICAgICAgICBjbGVhblBy
ZXZpZXcgIT09CiAgICAgICAgICAgICAgICAgICAgICAgICAgIk1lc3NhZ2UgaW5kaXNwb25pYmxlIHN1ciBjZXQgYXBwYXJlaWwiICYmCiAgICAgICAgICAg
ICAgICAgICAgICAgICFjbGVhblByZXZpZXcuc3RhcnRzV2l0aCgKICAgICAgICAgICAgICAgICAgICAgICAgICAi4pqg77iPIgogICAgICAgICAgICAgICAg
ICAgICAgICApCiAgICAgICAgICAgICAgICAgICAgICAgICAgPyBjbGVhblByZXZpZXcKICAgICAgICAgICAgICAgICAgICAgICAgICA6ICJNZXNzYWdlIHBy
aXbDqSIKICAgICAgICAgICAgICAgICAgICB9OwogICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICApCiAgICAgICAgICAgICAgKTsKCiAgICAg
ICAgICAgIGNvbnZlcnNhdGlvbnNCeVVzZXJuYW1lID0KICAgICAgICAgICAgICBuZXcgTWFwKAogICAgICAgICAgICAgICAgY29udmVyc2F0aW9ucy5tYXAo
CiAgICAgICAgICAgICAgICAgIChjb252ZXJzYXRpb24pID0+IFsKICAgICAgICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICAgICAgICBj
b252ZXJzYXRpb24/LnVzZXI/LnVzZXJuYW1lIHx8CiAgICAgICAgICAgICAgICAgICAgICAiIgogICAgICAgICAgICAgICAgICAgICksCiAgICAgICAgICAg
ICAgICAgICAgY29udmVyc2F0aW9uCiAgICAgICAgICAgICAgICAgIF0KICAgICAgICAgICAgICAgICkKICAgICAgICAgICAgICApOwoKICAgICAgICAgICAg
cGVvcGxlUHJlbG9hZFNvY2lhbEF2YXRhcnMoCiAgICAgICAgICAgICAgY29udmVyc2F0aW9ucy5tYXAoCiAgICAgICAgICAgICAgICAoY29udmVyc2F0aW9u
KSA9PgogICAgICAgICAgICAgICAgICBjb252ZXJzYXRpb24/LnVzZXI/LnVzZXJuYW1lCiAgICAgICAgICAgICAgKQogICAgICAgICAgICApOwoKICAgICAg
ICAgICAgdXBkYXRlVW5yZWFkQmFkZ2UoCiAgICAgICAgICAgICAgZGF0YS51bnJlYWRUb3RhbCB8fCAwCiAgICAgICAgICAgICk7CiAgICAgICAgICAgIHJl
bmRlckNvbnZlcnNhdGlvbkxpc3QoKTsKICAgICAgICAgICAgdm9pZCB3aW5kb3cuUGVvcGxlT2ZmbGluZT8uY2FjaGVDb252ZXJzYXRpb25zPy4oCiAgICAg
ICAgICAgICAgY29udmVyc2F0aW9ucywKICAgICAgICAgICAgICBkYXRhLnVucmVhZFRvdGFsIHx8IDAKICAgICAgICAgICAgKTsKICAgICAgICAgIH0gY2F0
Y2ggewogICAgICAgICAgICBpZiAobmF2aWdhdG9yLm9uTGluZSA9PT0gZmFsc2UpIHsKICAgICAgICAgICAgICBjb25zdCBjYWNoZWREYXRhID0gYXdhaXQg
d2luZG93LlBlb3BsZU9mZmxpbmU/LmdldENvbnZlcnNhdGlvbnM/LigpLmNhdGNoKCgpID0+IG51bGwpOwogICAgICAgICAgICAgIGlmIChjYWNoZWREYXRh
KSB7CiAgICAgICAgICAgICAgICBjb252ZXJzYXRpb25zID0gQXJyYXkuaXNBcnJheShjYWNoZWREYXRhLmNvbnZlcnNhdGlvbnMpCiAgICAgICAgICAgICAg
ICAgID8gY2FjaGVkRGF0YS5jb252ZXJzYXRpb25zCiAgICAgICAgICAgICAgICAgIDogW107CiAgICAgICAgICAgICAgICBjb252ZXJzYXRpb25zQnlVc2Vy
bmFtZSA9IG5ldyBNYXAoCiAgICAgICAgICAgICAgICAgIGNvbnZlcnNhdGlvbnMubWFwKChjb252ZXJzYXRpb24pID0+IFsKICAgICAgICAgICAgICAgICAg
ICBTdHJpbmcoY29udmVyc2F0aW9uPy51c2VyPy51c2VybmFtZSB8fCAiIiksCiAgICAgICAgICAgICAgICAgICAgY29udmVyc2F0aW9uCiAgICAgICAgICAg
ICAgICAgIF0pCiAgICAgICAgICAgICAgICApOwogICAgICAgICAgICAgICAgdXBkYXRlVW5yZWFkQmFkZ2UoY2FjaGVkRGF0YS51bnJlYWRUb3RhbCB8fCAw
KTsKICAgICAgICAgICAgICAgIHJlbmRlckNvbnZlcnNhdGlvbkxpc3QoKTsKICAgICAgICAgICAgICB9CiAgICAgICAgICAgIH0KICAgICAgICAgIH0KICAg
ICAgICB9IHdoaWxlICgKICAgICAgICAgIGNvbnZlcnNhdGlvbnNSZWZyZXNoUXVldWVkICYmCiAgICAgICAgICBzb2NpYWxSZWFkeQogICAgICAgICk7CiAg
ICAgIH0pKCk7CgogICAgdHJ5IHsKICAgICAgYXdhaXQgY29udmVyc2F0aW9uc1JlZnJlc2hQcm9taXNlOwogICAgfSBmaW5hbGx5IHsKICAgICAgY29udmVy
c2F0aW9uc1JlZnJlc2hQcm9taXNlID0gbnVsbDsKICAgIH0KICB9CgovLyA9PT0gUEVPUExFX0RNX05PX0ZMSUNLRVJfVjFfU1RBUlQgPT09Ci8vIExhIHBy
ZXZpZXcgb3B0aW1pc3RlIHJlc3RlIHZpc2libGUganVzcXUnYXUgcmVuZHUgc2VydmV1ciBmcmFpcy4KLy8gPT09IFBFT1BMRV9ETV9OT19GTElDS0VSX1Yx
X0VORCA9PT0KLy8gPT09IFBFT1BMRV9ETV9JTlNUQU5UX1NFTkRfVjIgPT09Ci8vID09PSBQRU9QTEVfRE1fR1JPVVBJTkdfVjFfU1RBUlQgPT09CiAgY29u
c3QgUEVPUExFX0RNX0dST1VQX01BWF9NRVNTQUdFUyA9IDEwOwogIGNvbnN0IFBFT1BMRV9ETV9HUk9VUF9NQVhfR0FQX01TID0KICAgIDEwICogNjAgKiAx
MDAwOwoKICBmdW5jdGlvbiBkbU1lc3NhZ2VUaW1lc3RhbXAobWVzc2FnZSkgewogICAgY29uc3QgdGltZSA9CiAgICAgIG5ldyBEYXRlKAogICAgICAgIG1l
c3NhZ2U/LmNyZWF0ZWRBdCB8fAogICAgICAgIERhdGUubm93KCkKICAgICAgKS5nZXRUaW1lKCk7CgogICAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZSh0aW1l
KQogICAgICA/IHRpbWUKICAgICAgOiBEYXRlLm5vdygpOwogIH0KCmZ1bmN0aW9uIGRtVGV4dExpbmUoCiAgICBtZXNzYWdlLAogICAgZ3JvdXBlZCA9IGZh
bHNlCiAgKSB7CiAgICBjb25zdCB1bml0ID0KICAgICAgZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CgogICAgdW5pdC5jbGFzc05hbWUgPQogICAg
ICAicGVvcGxlLW1lc3NhZ2UtdW5pdCI7CgogICAgY29uc3QgbWVzc2FnZUlkID0KICAgICAgU3RyaW5nKAogICAgICAgIG1lc3NhZ2U/LmlkIHx8ICIiCiAg
ICAgICk7CgogICAgaWYgKG1lc3NhZ2VJZCkgewogICAgICB1bml0LmRhdGFzZXQubWVzc2FnZUlkID0KICAgICAgICBtZXNzYWdlSWQ7CiAgICB9CgogICAg
dW5pdC5kYXRhc2V0LnBlb3BsZVBsYWluVGV4dCA9CiAgICAgIFN0cmluZyhtZXNzYWdlPy5ib2R5IHx8ICIiKTsKCiAgICBpZiAobWVzc2FnZT8uaW1hZ2VJ
ZCkgewogICAgICB1bml0LmRhdGFzZXQucGVvcGxlSW1hZ2VJZCA9CiAgICAgICAgU3RyaW5nKG1lc3NhZ2UuaW1hZ2VJZCk7CiAgICB9CgogICAgY29uc3Qg
cmVwbHlQcmV2aWV3ID0KICAgICAgd2luZG93LlBlb3BsZU1lc3NhZ2VBY3Rpb25zCiAgICAgICAgPy5jcmVhdGVSZXBseVByZXZpZXcoCiAgICAgICAgICBt
ZXNzYWdlPy5yZXBseVRvCiAgICAgICAgKTsKCiAgICBpZiAocmVwbHlQcmV2aWV3KSB7CiAgICAgIHVuaXQuYXBwZW5kQ2hpbGQoCiAgICAgICAgcmVwbHlQ
cmV2aWV3CiAgICAgICk7CiAgICB9CgogICAgY29uc3QgdGV4dCA9CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwoKICAgIHRleHQuY2xh
c3NOYW1lID0KICAgICAgZ3JvdXBlZAogICAgICAgID8gIm1lc3NhZ2UtdGV4dCBwZW9wbGUtZ3JvdXBlZC1tZXNzYWdlLWxpbmUiCiAgICAgICAgOiAibWVz
c2FnZS10ZXh0IjsKCiAgICBpZiAod2luZG93LlBlb3BsZVJpY2hDb250ZW50KSB7CiAgICAgIHdpbmRvdy5QZW9wbGVSaWNoQ29udGVudC5yZW5kZXIoCiAg
ICAgICAgdGV4dCwKICAgICAgICB7CiAgICAgICAgICB0ZXh0OgogICAgICAgICAgICBtZXNzYWdlLmJvZHksCiAgICAgICAgICBpbWFnZUlkOgogICAgICAg
ICAgICBtZXNzYWdlLmltYWdlSWQsCiAgICAgICAgICBpbWFnZUxvYWRlcjoKICAgICAgICAgICAgcGVvcGxlRG1FMmVlTG9hZEltYWdlCiAgICAgICAgfQog
ICAgICApOwogICAgfSBlbHNlIHsKICAgICAgdGV4dC50ZXh0Q29udGVudCA9CiAgICAgICAgU3RyaW5nKG1lc3NhZ2UuYm9keSB8fCAiIik7CiAgICB9Cgog
ICAgaWYgKGdyb3VwZWQpIHsKICAgICAgdGV4dC50aXRsZSA9CiAgICAgICAgZm9ybWF0RGF0ZSgKICAgICAgICAgIG1lc3NhZ2UuY3JlYXRlZEF0LAogICAg
ICAgICAgdHJ1ZQogICAgICAgICk7CiAgICB9CgogICAgdW5pdC5hcHBlbmRDaGlsZCh0ZXh0KTsKCiAgICB3aW5kb3cuUGVvcGxlTWVzc2FnZUFjdGlvbnMK
ICAgICAgPy5zZXRFZGl0ZWRMYWJlbCgKICAgICAgICB1bml0LAogICAgICAgIG1lc3NhZ2U/LmVkaXRlZEF0IHx8IG51bGwKICAgICAgKTsKCiAgICBjb25z
dCBtaW5lID0KICAgICAgbWUgJiYKICAgICAgU3RyaW5nKG1lc3NhZ2Uuc2VuZGVySWQpID09PQogICAgICAgIFN0cmluZyhtZS5pZCk7CgogICAgY29uc3Qg
YXV0aG9yID0KICAgICAgbWluZQogICAgICAgID8gbWUKICAgICAgICA6IGFjdGl2ZURtVXNlcjsKCiAgICBpZiAobWVzc2FnZUlkKSB7CiAgICAgIHdpbmRv
dy5QZW9wbGVNZXNzYWdlQWN0aW9ucwogICAgICAgID8uYmluZENvbnRleHQoCiAgICAgICAgICB1bml0LAogICAgICAgICAgewogICAgICAgICAgICBtZXNz
YWdlOiB7CiAgICAgICAgICAgICAgaWQ6CiAgICAgICAgICAgICAgICBtZXNzYWdlSWQsCiAgICAgICAgICAgICAgdXNlcm5hbWU6CiAgICAgICAgICAgICAg
ICBhdXRob3I/LnVzZXJuYW1lIHx8CiAgICAgICAgICAgICAgICAiVXRpbGlzYXRldXIiLAogICAgICAgICAgICAgIGJvZHk6CiAgICAgICAgICAgICAgICBt
ZXNzYWdlLmJvZHksCiAgICAgICAgICAgICAgaW1hZ2VJZDoKICAgICAgICAgICAgICAgIG1lc3NhZ2UuaW1hZ2VJZAogICAgICAgICAgICB9LAogICAgICAg
ICAgICBjYW5FZGl0OgogICAgICAgICAgICAgIEJvb2xlYW4obWluZSksCiAgICAgICAgICAgIGNhbkRlbGV0ZToKICAgICAgICAgICAgICBCb29sZWFuKG1p
bmUpLAogICAgICAgICAgICBvblJlcGx5OgogICAgICAgICAgICAgICgpID0+CiAgICAgICAgICAgICAgICBwZW9wbGVEbVJlcGx5Q29udHJvbGxlcgogICAg
ICAgICAgICAgICAgICA/LnNldCh7CiAgICAgICAgICAgICAgICAgICAgaWQ6CiAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlSWQsCiAgICAgICAgICAg
ICAgICAgICAgdXNlcm5hbWU6CiAgICAgICAgICAgICAgICAgICAgICBhdXRob3I/LnVzZXJuYW1lIHx8CiAgICAgICAgICAgICAgICAgICAgICAiVXRpbGlz
YXRldXIiLAogICAgICAgICAgICAgICAgICAgIGJvZHk6CiAgICAgICAgICAgICAgICAgICAgICB1bml0LmRhdGFzZXQucGVvcGxlUGxhaW5UZXh0IHx8ICIi
LAogICAgICAgICAgICAgICAgICAgIGltYWdlSWQ6CiAgICAgICAgICAgICAgICAgICAgICB1bml0LmRhdGFzZXQucGVvcGxlSW1hZ2VJZCB8fCBudWxsCiAg
ICAgICAgICAgICAgICAgIH0pLAogICAgICAgICAgICBvbkVkaXQ6CiAgICAgICAgICAgICAgKCkgPT4KICAgICAgICAgICAgICAgIHBlb3BsZVN0YXJ0RG1N
ZXNzYWdlRWRpdCgKICAgICAgICAgICAgICAgICAgdW5pdCwKICAgICAgICAgICAgICAgICAgbWVzc2FnZUlkCiAgICAgICAgICAgICAgICApLAogICAgICAg
ICAgICBvbkRlbGV0ZToKICAgICAgICAgICAgICAoKSA9PgogICAgICAgICAgICAgICAgcGVvcGxlRGVsZXRlRG1NZXNzYWdlKAogICAgICAgICAgICAgICAg
ICBtZXNzYWdlSWQKICAgICAgICAgICAgICAgICkKICAgICAgICAgIH0KICAgICAgICApOwogICAgfQoKICAgIHJldHVybiB1bml0OwogIH0KCiAgZnVuY3Rp
b24gZG1NZXNzYWdlRWxlbWVudChtZXNzYWdlKSB7CiAgICBjb25zdCBtaW5lID0KICAgICAgbWUgJiYKICAgICAgU3RyaW5nKG1lc3NhZ2Uuc2VuZGVySWQp
ID09PQogICAgICAgIFN0cmluZyhtZS5pZCk7CgogICAgY29uc3Qgcm93ID0KICAgICAgZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CgogICAgcm93
LmNsYXNzTmFtZSA9CiAgICAgICJkbS1tZXNzYWdlIjsKCiAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZSgKICAgICAgIm1pbmUiLAogICAgICBCb29sZWFuKG1p
bmUpCiAgICApOwoKICAgIGlmIChtZXNzYWdlPy5fcGVvcGxlT2ZmbGluZVF1ZXVlSWQpIHsKICAgICAgcm93LmRhdGFzZXQucGVvcGxlRG1QZW5kaW5nSWQg
PSBTdHJpbmcobWVzc2FnZS5fcGVvcGxlT2ZmbGluZVF1ZXVlSWQpOwogICAgICByb3cuZGF0YXNldC5wZW9wbGVPZmZsaW5lUGVuZGluZyA9ICIxIjsKICAg
ICAgcm93LmNsYXNzTGlzdC5hZGQoInBlb3BsZS1kbS1wZW5kaW5nIik7CiAgICB9CgogICAgY29uc3QgYXYgPQogICAgICBkb2N1bWVudC5jcmVhdGVFbGVt
ZW50KCJidXR0b24iKTsKCiAgICBhdi50eXBlID0gImJ1dHRvbiI7CiAgICBhdi5jbGFzc05hbWUgPQogICAgICAiYXZhdGFyIGRtLW1lc3NhZ2UtYXZhdGFy
IjsKCiAgICBjb25zdCBhdXRob3IgPQogICAgICBtaW5lCiAgICAgICAgPyBtZQogICAgICAgIDogYWN0aXZlRG1Vc2VyOwoKICAgIHdpbmRvdy5QZW9wbGVB
dmF0YXJzPy5hcHBseSgKICAgICAgYXYsCiAgICAgIGF1dGhvcj8udXNlcm5hbWUgfHwgIj8iCiAgICApOwoKICAgIGlmIChhdXRob3I/LnVzZXJuYW1lKSB7
CiAgICAgIGF2LmRhdGFzZXQucGVvcGxlUHJvZmlsZVVzZXJuYW1lID0KICAgICAgICBhdXRob3IudXNlcm5hbWU7CiAgICB9CgogICAgY29uc3QgYm9keSA9
CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwoKICAgIGJvZHkuY2xhc3NOYW1lID0KICAgICAgInBlb3BsZS1tZXNzYWdlLWdyb3VwLWJv
ZHkiOwoKICAgIGNvbnN0IGhlYWQgPQogICAgICBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKCiAgICBoZWFkLmNsYXNzTmFtZSA9CiAgICAgICJt
ZXNzYWdlLWhlYWQiOwoKICAgIGNvbnN0IHN0cm9uZyA9CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoInN0cm9uZyIpOwoKICAgIHN0cm9uZy50ZXh0
Q29udGVudCA9CiAgICAgIGF1dGhvcj8udXNlcm5hbWUgfHwKICAgICAgIlV0aWxpc2F0ZXVyIjsKCiAgICAvLyA9PT0gUEVPUExFX0RNX01FU1NBR0VfUFJP
RklMRV9WMyA9PT0KICAgIGlmICgKICAgICAgYXV0aG9yPy51c2VybmFtZQogICAgKSB7CiAgICAgIHBlb3BsZUJpbmRTb2NpYWxQcm9maWxlVWkoCiAgICAg
ICAgYXYsCiAgICAgICAgYXV0aG9yLnVzZXJuYW1lLAogICAgICAgICJhdmF0YXIiCiAgICAgICk7CgogICAgICBwZW9wbGVCaW5kU29jaWFsUHJvZmlsZVVp
KAogICAgICAgIHN0cm9uZywKICAgICAgICBhdXRob3IudXNlcm5hbWUsCiAgICAgICAgIm5hbWUiCiAgICAgICk7CiAgICB9CgogICAgY29uc3QgdGltZSA9
CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoInRpbWUiKTsKCiAgICB0aW1lLnRleHRDb250ZW50ID0KICAgICAgZm9ybWF0RGF0ZSgKICAgICAgICBt
ZXNzYWdlLmNyZWF0ZWRBdCwKICAgICAgICB0cnVlCiAgICAgICk7CgogICAgaGVhZC5hcHBlbmQoCiAgICAgIHN0cm9uZywKICAgICAgdGltZQogICAgKTsK
CiAgICBib2R5LmFwcGVuZCgKICAgICAgaGVhZCwKICAgICAgZG1UZXh0TGluZSgKICAgICAgICBtZXNzYWdlLAogICAgICAgIGZhbHNlCiAgICAgICkKICAg
ICk7CgogICAgcm93LmFwcGVuZCgKICAgICAgYXYsCiAgICAgIGJvZHkKICAgICk7CgogICAgcmV0dXJuIHsKICAgICAgcm93LAogICAgICBib2R5CiAgICB9
OwogIH0KCgoKICBkbU1lc3NhZ2VzPy5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgIChldmVudCkgPT4gewogICAgICBjb25zdCBhdmF0YXIg
PQogICAgICAgIGV2ZW50LnRhcmdldD8uY2xvc2VzdD8uKAogICAgICAgICAgIi5kbS1tZXNzYWdlLWF2YXRhcltkYXRhLXBlb3BsZS1wcm9maWxlLXVzZXJu
YW1lXSIKICAgICAgICApOwoKICAgICAgY29uc3QgdXNlcm5hbWUgPQogICAgICAgIFN0cmluZygKICAgICAgICAgIGF2YXRhcj8uZGF0YXNldAogICAgICAg
ICAgICA/LnBlb3BsZVByb2ZpbGVVc2VybmFtZSB8fAogICAgICAgICAgIiIKICAgICAgICApLnRyaW0oKTsKCiAgICAgIGlmICh1c2VybmFtZSkgewogICAg
ICAgIHZvaWQgb3BlblByb2ZpbGUodXNlcm5hbWUpOwogICAgICB9CiAgICB9CiAgKTsKCiAgLy8gPT09IFBFT1BMRV9ETV9DQUxMX0hJU1RPUllfVjJfU1RB
UlQgPT09CiAgZnVuY3Rpb24gcGVvcGxlUGFyc2VEbUNhbGxFdmVudCgKICAgIGJvZHkKICApIHsKICAgIGNvbnN0IG1hdGNoID0KICAgICAgU3RyaW5nKAog
ICAgICAgIGJvZHkgfHwKICAgICAgICAiIgogICAgICApLm1hdGNoKAogICAgICAgIC9eXFtcW1BFT1BMRV9DQUxMX1YxXHwoc3RhcnRlZHxlbmRlZClcfChb
YS16QS1aMC05LV0rKVx8KFthLXpBLVowLTktXSopXHwoXGQrKVxdXF0kLwogICAgICApOwoKICAgIGlmICghbWF0Y2gpIHsKICAgICAgcmV0dXJuIG51bGw7
CiAgICB9CgogICAgcmV0dXJuIHsKICAgICAgdHlwZToKICAgICAgICBtYXRjaFsxXSwKICAgICAgY2FsbElkOgogICAgICAgIG1hdGNoWzJdLAogICAgICBy
ZWFzb246CiAgICAgICAgbWF0Y2hbM10gfHwgIiIsCiAgICAgIGR1cmF0aW9uU2Vjb25kczoKICAgICAgICBNYXRoLm1heCgKICAgICAgICAgIDAsCiAgICAg
ICAgICBOdW1iZXIoCiAgICAgICAgICAgIG1hdGNoWzRdCiAgICAgICAgICApIHx8IDAKICAgICAgICApCiAgICB9OwogIH0KCiAgZnVuY3Rpb24gcGVvcGxl
Rm9ybWF0Q2FsbER1cmF0aW9uKAogICAgc2Vjb25kcwogICkgewogICAgY29uc3QgdG90YWwgPQogICAgICBNYXRoLm1heCgKICAgICAgICAwLAogICAgICAg
IE1hdGgucm91bmQoCiAgICAgICAgICBOdW1iZXIoCiAgICAgICAgICAgIHNlY29uZHMKICAgICAgICAgICkgfHwgMAogICAgICAgICkKICAgICAgKTsKCiAg
ICBpZiAoIXRvdGFsKSB7CiAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBjb25zdCBtaW51dGVzID0KICAgICAgTWF0aC5mbG9vcigKICAgICAgICB0b3Rh
bCAvIDYwCiAgICAgICk7CgogICAgY29uc3QgcmVzdCA9CiAgICAgIHRvdGFsICUgNjA7CgogICAgaWYgKCFtaW51dGVzKSB7CiAgICAgIHJldHVybiAoCiAg
ICAgICAgcmVzdCArCiAgICAgICAgIiBzIgogICAgICApOwogICAgfQoKICAgIHJldHVybiAoCiAgICAgIG1pbnV0ZXMgKwogICAgICAiIG1pbiAiICsKICAg
ICAgU3RyaW5nKAogICAgICAgIHJlc3QKICAgICAgKS5wYWRTdGFydCgKICAgICAgICAyLAogICAgICAgICIwIgogICAgICApICsKICAgICAgIiBzIgogICAg
KTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtQ2FsbEhpc3RvcnlUZXh0KAogICAgbWVzc2FnZSwKICAgIGV2ZW50CiAgKSB7CiAgICBjb25zdCBjYWxsZXJO
YW1lID0KICAgICAgbWUgJiYKICAgICAgU3RyaW5nKAogICAgICAgIG1lc3NhZ2Uuc2VuZGVySWQKICAgICAgKSA9PT0KICAgICAgU3RyaW5nKAogICAgICAg
IG1lLmlkCiAgICAgICkKICAgICAgICA/ICgKICAgICAgICAgICAgbWUudXNlcm5hbWUgfHwKICAgICAgICAgICAgIlR1IgogICAgICAgICAgKQogICAgICAg
IDogKAogICAgICAgICAgICBhY3RpdmVEbVVzZXI/LnVzZXJuYW1lIHx8CiAgICAgICAgICAgICJVdGlsaXNhdGV1ciIKICAgICAgICAgICk7CgogICAgaWYg
KAogICAgICBldmVudC50eXBlID09PQogICAgICAic3RhcnRlZCIKICAgICkgewogICAgICByZXR1cm4gKAogICAgICAgIGNhbGxlck5hbWUgKwogICAgICAg
ICIgYSBsYW5jw6kgdW4gYXBwZWwiCiAgICAgICk7CiAgICB9CgogICAgY29uc3QgbGFiZWxzID0gewogICAgICBkZWNsaW5lZDoKICAgICAgICAiQXBwZWwg
cmVmdXPDqSIsCiAgICAgIGNhbmNlbGxlZDoKICAgICAgICAiQXBwZWwgYW5udWzDqSIsCiAgICAgIHRpbWVvdXQ6CiAgICAgICAgIkFwcGVsIG1hbnF1w6kg
4oCUIHBhcyBkZSByw6lwb25zZSIsCiAgICAgICJhbG9uZS10aW1lb3V0IjoKICAgICAgICAiQXBwZWwgdGVybWluw6kiLAogICAgICBlbXB0eToKICAgICAg
ICAiQXBwZWwgdGVybWluw6kiLAogICAgICBkaXNjb25uZWN0ZWQ6CiAgICAgICAgIkFwcGVsIGludGVycm9tcHUiLAogICAgICBoYW5ndXA6CiAgICAgICAg
IkFwcGVsIHRlcm1pbsOpIgogICAgfTsKCiAgICBsZXQgdGV4dCA9CiAgICAgIGxhYmVsc1sKICAgICAgICBldmVudC5yZWFzb24KICAgICAgXSB8fAogICAg
ICAiQXBwZWwgdGVybWluw6kiOwoKICAgIGNvbnN0IGR1cmF0aW9uID0KICAgICAgcGVvcGxlRm9ybWF0Q2FsbER1cmF0aW9uKAogICAgICAgIGV2ZW50LmR1
cmF0aW9uU2Vjb25kcwogICAgICApOwoKICAgIGlmICgKICAgICAgZHVyYXRpb24gJiYKICAgICAgKAogICAgICAgIGV2ZW50LnJlYXNvbiA9PT0KICAgICAg
ICAgICJoYW5ndXAiIHx8CiAgICAgICAgZXZlbnQucmVhc29uID09PQogICAgICAgICAgImRpc2Nvbm5lY3RlZCIgfHwKICAgICAgICBldmVudC5yZWFzb24g
PT09CiAgICAgICAgICAiYWxvbmUtdGltZW91dCIgfHwKICAgICAgICBldmVudC5yZWFzb24gPT09CiAgICAgICAgICAiZW1wdHkiCiAgICAgICkKICAgICkg
ewogICAgICB0ZXh0ICs9CiAgICAgICAgIiDigKIgIiArCiAgICAgICAgZHVyYXRpb247CiAgICB9CgogICAgcmV0dXJuIHRleHQ7CiAgfQoKICBmdW5jdGlv
biBwZW9wbGVEbUNhbGxIaXN0b3J5RWxlbWVudCgKICAgIG1lc3NhZ2UsCiAgICBldmVudAogICkgewogICAgY29uc3Qgcm93ID0KICAgICAgZG9jdW1lbnQu
Y3JlYXRlRWxlbWVudCgKICAgICAgICAiZGl2IgogICAgICApOwoKICAgIHJvdy5jbGFzc05hbWUgPQogICAgICAicGVvcGxlLWRtLWNhbGwtaGlzdG9yeSI7
CgogICAgY29uc3QgY29udGVudCA9CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoCiAgICAgICAgImRpdiIKICAgICAgKTsKCiAgICBjb250ZW50LmNs
YXNzTmFtZSA9CiAgICAgICJwZW9wbGUtZG0tY2FsbC1oaXN0b3J5LWNvbnRlbnQiOwoKICAgIGNvbnN0IGljb24gPQogICAgICBkb2N1bWVudC5jcmVhdGVF
bGVtZW50KAogICAgICAgICJzcGFuIgogICAgICApOwoKICAgIGljb24udGV4dENvbnRlbnQgPQogICAgICBldmVudC50eXBlID09PQogICAgICAgICJzdGFy
dGVkIgogICAgICAgID8gIvCfk54iCiAgICAgICAgOiAi4piO77iPIjsKCiAgICBjb25zdCBsYWJlbCA9CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQo
CiAgICAgICAgInN0cm9uZyIKICAgICAgKTsKCiAgICBsYWJlbC50ZXh0Q29udGVudCA9CiAgICAgIHBlb3BsZURtQ2FsbEhpc3RvcnlUZXh0KAogICAgICAg
IG1lc3NhZ2UsCiAgICAgICAgZXZlbnQKICAgICAgKTsKCiAgICBjb25zdCB0aW1lID0KICAgICAgZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgKICAgICAgICAi
dGltZSIKICAgICAgKTsKCiAgICB0aW1lLnRleHRDb250ZW50ID0KICAgICAgZm9ybWF0RGF0ZSgKICAgICAgICBtZXNzYWdlLmNyZWF0ZWRBdCwKICAgICAg
ICB0cnVlCiAgICAgICk7CgogICAgY29udGVudC5hcHBlbmQoCiAgICAgIGljb24sCiAgICAgIGxhYmVsLAogICAgICB0aW1lCiAgICApOwoKICAgIHJvdy5h
cHBlbmRDaGlsZCgKICAgICAgY29udGVudAogICAgKTsKCiAgICByZXR1cm4gcm93OwogIH0KICAvLyA9PT0gUEVPUExFX0RNX0NBTExfSElTVE9SWV9WMl9F
TkQgPT09CgogIGZ1bmN0aW9uIHJlbmRlckRtTWVzc2FnZUdyb3VwcygKICAgIGxpc3QsCiAgICB0YXJnZXQgPSBkbU1lc3NhZ2VzCiAgKSB7CiAgICBjb25z
dCBtZXNzYWdlc0xpc3QgPQogICAgICBBcnJheS5pc0FycmF5KGxpc3QpCiAgICAgICAgPyBsaXN0CiAgICAgICAgOiBbXTsKCiAgICBpZiAoIXRhcmdldCkg
cmV0dXJuOwoKICAgIGxldCBncm91cCA9IG51bGw7CgogICAgZm9yIChjb25zdCBtZXNzYWdlIG9mIG1lc3NhZ2VzTGlzdCkgewogICAgICBjb25zdCBjYWxs
RXZlbnQgPQogICAgICAgIHBlb3BsZVBhcnNlRG1DYWxsRXZlbnQoCiAgICAgICAgICBtZXNzYWdlLmJvZHkKICAgICAgICApOwoKICAgICAgaWYgKGNhbGxF
dmVudCkgewogICAgICAgIHRhcmdldC5hcHBlbmRDaGlsZCgKICAgICAgICAgIHBlb3BsZURtQ2FsbEhpc3RvcnlFbGVtZW50KAogICAgICAgICAgICBtZXNz
YWdlLAogICAgICAgICAgICBjYWxsRXZlbnQKICAgICAgICAgICkKICAgICAgICApOwoKICAgICAgICBncm91cCA9IG51bGw7CiAgICAgICAgY29udGludWU7
CiAgICAgIH0KCiAgICAgIGNvbnN0IHNlbmRlcklkID0KICAgICAgICBTdHJpbmcobWVzc2FnZS5zZW5kZXJJZCB8fCAiIik7CgogICAgICBjb25zdCB0aW1l
ID0KICAgICAgICBkbU1lc3NhZ2VUaW1lc3RhbXAobWVzc2FnZSk7CgogICAgICBjb25zdCBzYW1lR3JvdXAgPQogICAgICAgIGdyb3VwICYmCiAgICAgICAg
Z3JvdXAuc2VuZGVySWQgPT09IHNlbmRlcklkICYmCiAgICAgICAgZ3JvdXAuY291bnQgPAogICAgICAgICAgUEVPUExFX0RNX0dST1VQX01BWF9NRVNTQUdF
UyAmJgogICAgICAgIHRpbWUgLSBncm91cC5sYXN0VGltZSA8CiAgICAgICAgICBQRU9QTEVfRE1fR1JPVVBfTUFYX0dBUF9NUzsKCiAgICAgIGlmIChzYW1l
R3JvdXApIHsKICAgICAgICBncm91cC5ib2R5LmFwcGVuZENoaWxkKAogICAgICAgICAgZG1UZXh0TGluZSgKICAgICAgICAgICAgbWVzc2FnZSwKICAgICAg
ICAgICAgdHJ1ZQogICAgICAgICAgKQogICAgICAgICk7CgogICAgICAgIGdyb3VwLmxhc3RUaW1lID0gdGltZTsKICAgICAgICBncm91cC5jb3VudCArPSAx
OwogICAgICAgIGNvbnRpbnVlOwogICAgICB9CgogICAgICBjb25zdCBidWlsdCA9CiAgICAgICAgZG1NZXNzYWdlRWxlbWVudChtZXNzYWdlKTsKCiAgICAg
IHRhcmdldC5hcHBlbmRDaGlsZCgKICAgICAgICBidWlsdC5yb3cKICAgICAgKTsKCiAgICAgIGdyb3VwID0gewogICAgICAgIHNlbmRlcklkLAogICAgICAg
IGxhc3RUaW1lOiB0aW1lLAogICAgICAgIGNvdW50OiAxLAogICAgICAgIGJvZHk6IGJ1aWx0LmJvZHkKICAgICAgfTsKICAgIH0KICB9CiAgLy8gPT09IFBF
T1BMRV9ETV9HUk9VUElOR19WMV9FTkQgPT09CgogIC8vID09PSBQRU9QTEVfRE1fSU5TVEFOVF9PUEVOX1YzX1JFTkRFUl9TVEFSVCA9PT0KICBmdW5jdGlv
biBwZW9wbGVEbVJlbmRlckNvbnZlcnNhdGlvbigKICAgIHVzZXJuYW1lLAogICAgdXNlciwKICAgIGRlY3J5cHRlZE1lc3NhZ2VzLAogICAgcmVuZGVyT3B0
aW9ucyA9IG51bGwKICApIHsKICAgIGlmICghZG1NZXNzYWdlcykgcmV0dXJuIGZhbHNlOwoKICAgIGNvbnN0IHdhbnRlZCA9IHBlb3BsZURtVXNlcm5hbWVL
ZXkodXNlcm5hbWUpOwogICAgaWYgKAogICAgICAhd2FudGVkIHx8CiAgICAgIHBlb3BsZURtVXNlcm5hbWVLZXkoYWN0aXZlRG1Vc2VyPy51c2VybmFtZSkg
IT09IHdhbnRlZAogICAgKSB7CiAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KCiAgICBjb25zdCBjYWNoZWRNZXRhID0KICAgICAgcGVvcGxlRG1WaWV3Q2Fj
aGUuZ2V0KHdhbnRlZCkgfHwKICAgICAgbnVsbDsKCiAgICBjb25zdCBoYXNPbGRlciA9CiAgICAgIHJlbmRlck9wdGlvbnM/Lmhhc09sZGVyID09PSB1bmRl
ZmluZWQKICAgICAgICA/IEJvb2xlYW4oY2FjaGVkTWV0YT8uaGFzT2xkZXIpCiAgICAgICAgOiBCb29sZWFuKHJlbmRlck9wdGlvbnMuaGFzT2xkZXIpOwoK
ICAgIGFjdGl2ZURtVXNlciA9IHsKICAgICAgLi4uKGFjdGl2ZURtVXNlciB8fCB7fSksCiAgICAgIC4uLih1c2VyIHx8IHt9KSwKICAgICAgdXNlcm5hbWU6
IFN0cmluZyh1c2VyPy51c2VybmFtZSB8fCB1c2VybmFtZSB8fCAiIikKICAgIH07CgogICAgcGVvcGxlUHJlbG9hZFNvY2lhbEF2YXRhcnMoWwogICAgICBh
Y3RpdmVEbVVzZXI/LnVzZXJuYW1lLAogICAgICBtZT8udXNlcm5hbWUKICAgIF0pOwoKICAgIGlmIChkbUhlYWRlck5hbWUpIHsKICAgICAgZG1IZWFkZXJO
YW1lLnRleHRDb250ZW50ID0gYWN0aXZlRG1Vc2VyLnVzZXJuYW1lOwogICAgfQoKICAgIGlmIChkbUhlYWRlckF2YXRhcikgewogICAgICB3aW5kb3cuUGVv
cGxlQXZhdGFycz8uYXBwbHkoCiAgICAgICAgZG1IZWFkZXJBdmF0YXIsCiAgICAgICAgYWN0aXZlRG1Vc2VyLnVzZXJuYW1lCiAgICAgICk7CiAgICB9Cgog
ICAgLy8gPT09IFBFT1BMRV9ETV9IRUFERVJfUFJPRklMRV9WMyA9PT0KICAgIHBlb3BsZUJpbmRTb2NpYWxQcm9maWxlVWkoCiAgICAgIGRtSGVhZGVyQXZh
dGFyLAogICAgICBhY3RpdmVEbVVzZXIudXNlcm5hbWUsCiAgICAgICJhdmF0YXIiCiAgICApOwoKICAgIHBlb3BsZUJpbmRTb2NpYWxQcm9maWxlVWkoCiAg
ICAgIGRtSGVhZGVyTmFtZSwKICAgICAgYWN0aXZlRG1Vc2VyLnVzZXJuYW1lLAogICAgICAibmFtZSIKICAgICk7CgogICAgaWYgKGRtSGVhZGVyU3RhdHVz
KSB7CiAgICAgIGRtSGVhZGVyU3RhdHVzLnRleHRDb250ZW50ID0KICAgICAgICBhY3RpdmVEbVVzZXIub25saW5lID09PSB0cnVlCiAgICAgICAgICA/ICJF
biBsaWduZSIKICAgICAgICAgIDogYWN0aXZlRG1Vc2VyLm9ubGluZSA9PT0gZmFsc2UKICAgICAgICAgICAgPyAiSG9ycyBsaWduZSIKICAgICAgICAgICAg
OiAiIjsKICAgIH0KCiAgICBpZiAoZG1XZWxjb21lVGl0bGUpIHsKICAgICAgZG1XZWxjb21lVGl0bGUudGV4dENvbnRlbnQgPSBhY3RpdmVEbVVzZXIudXNl
cm5hbWU7CiAgICB9CgogICAgY29uc3QgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7CgogICAgLyoKICAgICAgTGEgY2Fy
dGUgIkTDqWJ1dCBkZSBjb252ZXJzYXRpb24iIG4nZXN0IGFmZmljaMOpZSBxdWUgbG9yc3F1J29uIGEKICAgICAgcsOpZWxsZW1lbnQgYXR0ZWludCBsZSB0
b3V0IHByZW1pZXIgbWVzc2FnZS4gQXZlYyBsYSBwYWdpbmF0aW9uLAogICAgICBhZmZpY2hlciBjZXR0ZSBjYXJ0ZSBzdXIgbGEgZGVybmnDqHJlIHBhZ2Ug
c2VyYWl0IHRyb21wZXVyLgogICAgKi8KICAgIGlmICghaGFzT2xkZXIpIHsKICAgICAgY29uc3Qgd2VsY29tZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQo
ImRpdiIpOwogICAgICB3ZWxjb21lLmNsYXNzTmFtZSA9ICJkbS13ZWxjb21lIjsKCiAgICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVu
dCgiaDIiKTsKICAgICAgdGl0bGUudGV4dENvbnRlbnQgPQogICAgICAgICJEw6lidXQgZGUgdGEgY29udmVyc2F0aW9uIGF2ZWMgIiArIGFjdGl2ZURtVXNl
ci51c2VybmFtZTsKCiAgICAgIGNvbnN0IHN1YnRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgicCIpOwogICAgICBzdWJ0aXRsZS50ZXh0Q29udGVu
dCA9CiAgICAgICAgIkxlcyBub3V2ZWF1eCBNUCB0ZXh0ZSBzb250IGNoaWZmcsOpcyBkZSBib3V0IGVuIGJvdXQuIjsKCiAgICAgIHdlbGNvbWUuYXBwZW5k
KHRpdGxlLCBzdWJ0aXRsZSk7CiAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHdlbGNvbWUpOwogICAgfQoKICAgIHJlbmRlckRtTWVzc2FnZUdyb3VwcygK
ICAgICAgQXJyYXkuaXNBcnJheShkZWNyeXB0ZWRNZXNzYWdlcykgPyBkZWNyeXB0ZWRNZXNzYWdlcyA6IFtdLAogICAgICBmcmFnbWVudAogICAgKTsKCiAg
ICBwZW9wbGVEbUFwcGVuZFBlbmRpbmcoYWN0aXZlRG1Vc2VyLnVzZXJuYW1lLCBmcmFnbWVudCk7CiAgICBkbU1lc3NhZ2VzLnJlcGxhY2VDaGlsZHJlbihm
cmFnbWVudCk7CgogICAgaWYgKAogICAgICByZW5kZXJPcHRpb25zPy5zY3JvbGxUb0JvdHRvbSAhPT0gZmFsc2UKICAgICkgewogICAgICBwZW9wbGVEbVNj
cm9sbFRvQm90dG9tKCk7CiAgICB9CgogICAgcmV0dXJuIHRydWU7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBwZW9wbGVEbUZldGNoQW5kRGVjcnlwdCgKICAg
IHVzZXJuYW1lLAogICAgb3B0aW9ucyA9IG51bGwKICApIHsKICAgIGNvbnN0IGJlZm9yZSA9CiAgICAgIFN0cmluZygKICAgICAgICBvcHRpb25zPy5iZWZv
cmUgfHwKICAgICAgICAiIgogICAgICApLnRyaW0oKTsKCiAgICBjb25zdCBhZnRlciA9CiAgICAgIGJlZm9yZQogICAgICAgID8gIiIKICAgICAgICA6IFN0
cmluZygKICAgICAgICAgICAgb3B0aW9ucz8uYWZ0ZXIgfHwKICAgICAgICAgICAgIiIKICAgICAgICAgICkudHJpbSgpOwoKICAgIGNvbnN0IHF1ZXJ5ID0K
ICAgICAgbmV3IFVSTFNlYXJjaFBhcmFtcygpOwoKICAgIGlmIChiZWZvcmUpIHsKICAgICAgcXVlcnkuc2V0KAogICAgICAgICJiZWZvcmUiLAogICAgICAg
IGJlZm9yZQogICAgICApOwogICAgfSBlbHNlIGlmIChhZnRlcikgewogICAgICBxdWVyeS5zZXQoCiAgICAgICAgImFmdGVyIiwKICAgICAgICBhZnRlcgog
ICAgICApOwogICAgfQoKICAgIGNvbnN0IHN1ZmZpeCA9CiAgICAgIHF1ZXJ5LnRvU3RyaW5nKCkKICAgICAgICA/ICI/IiArIHF1ZXJ5LnRvU3RyaW5nKCkK
ICAgICAgICA6ICIiOwoKICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhcGkoCiAgICAgICIvYXBpL2RtLyIgKwogICAgICAgIGVuY29kZVVSSUNvbXBvbmVudCh1
c2VybmFtZSkgKwogICAgICAgIHN1ZmZpeAogICAgKTsKCiAgICBjb25zdCBkZWNyeXB0ZWRNZXNzYWdlcyA9CiAgICAgIGF3YWl0IHBlb3BsZURtRTJlZURl
Y3J5cHRNZXNzYWdlc0NhY2hlZChkYXRhLm1lc3NhZ2VzIHx8IFtdKTsKCiAgICBjb25zdCByZXN1bHQgPSB7CiAgICAgIHVzZXI6CiAgICAgICAgZGF0YS51
c2VyLAogICAgICBtZXNzYWdlczoKICAgICAgICBkZWNyeXB0ZWRNZXNzYWdlcywKICAgICAgaGFzTW9yZToKICAgICAgICBCb29sZWFuKGRhdGEuaGFzTW9y
ZSksCiAgICAgIGRpcmVjdGlvbjoKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBkYXRhLmRpcmVjdGlvbiB8fAogICAgICAgICAgKAogICAgICAgICAgICBi
ZWZvcmUKICAgICAgICAgICAgICA/ICJvbGRlciIKICAgICAgICAgICAgICA6IGFmdGVyCiAgICAgICAgICAgICAgICA/ICJuZXdlciIKICAgICAgICAgICAg
ICAgIDogImxhdGVzdCIKICAgICAgICAgICkKICAgICAgICApCiAgICB9OwoKICAgIGlmICgKICAgICAgIWJlZm9yZSAmJgogICAgICAhYWZ0ZXIgJiYKICAg
ICAgb3B0aW9ucz8ucmVtZW1iZXIgIT09IGZhbHNlCiAgICApIHsKICAgICAgcGVvcGxlRG1SZW1lbWJlclZpZXcoCiAgICAgICAgdXNlcm5hbWUsCiAgICAg
ICAgZGF0YS51c2VyLAogICAgICAgIGRlY3J5cHRlZE1lc3NhZ2VzLAogICAgICAgIHsKICAgICAgICAgIGhhc09sZGVyOgogICAgICAgICAgICByZXN1bHQu
aGFzTW9yZSwKICAgICAgICAgIGhhc05ld2VyOgogICAgICAgICAgICBmYWxzZQogICAgICAgIH0KICAgICAgKTsKICAgIH0KCiAgICByZXR1cm4gcmVzdWx0
OwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1QcmVmZXRjaCh1c2VybmFtZSkgewogICAgY29uc3QgY2xlYW4gPSBTdHJpbmcodXNlcm5hbWUgfHwg
IiIpLnRyaW0oKTsKICAgIGNvbnN0IGtleSA9IHBlb3BsZURtVXNlcm5hbWVLZXkoY2xlYW4pOwogICAgaWYgKCFrZXkgfHwgIXNvY2lhbFJlYWR5KSByZXR1
cm47CgogICAgY29uc3QgY2FjaGVkID0gcGVvcGxlRG1WaWV3Q2FjaGUuZ2V0KGtleSk7CiAgICBpZiAoCiAgICAgIGNhY2hlZCAmJgogICAgICBEYXRlLm5v
dygpIC0gTnVtYmVyKGNhY2hlZC51cGRhdGVkQXQgfHwgMCkgPAogICAgICAgIFBFT1BMRV9ETV9QUkVGRVRDSF9NQVhfQUdFX01TCiAgICApIHsKICAgICAg
cmV0dXJuIGNhY2hlZDsKICAgIH0KCiAgICBpZiAocGVvcGxlRG1QcmVmZXRjaFByb21pc2VzLmhhcyhrZXkpKSB7CiAgICAgIHJldHVybiBwZW9wbGVEbVBy
ZWZldGNoUHJvbWlzZXMuZ2V0KGtleSk7CiAgICB9CgogICAgY29uc3QgcHJvbWlzZSA9IHBlb3BsZURtRmV0Y2hBbmREZWNyeXB0KGNsZWFuKQogICAgICAu
Y2F0Y2goKCkgPT4gbnVsbCkKICAgICAgLmZpbmFsbHkoKCkgPT4gewogICAgICAgIHBlb3BsZURtUHJlZmV0Y2hQcm9taXNlcy5kZWxldGUoa2V5KTsKICAg
ICAgfSk7CgogICAgcGVvcGxlRG1QcmVmZXRjaFByb21pc2VzLnNldChrZXksIHByb21pc2UpOwogICAgcmV0dXJuIHByb21pc2U7CiAgfQoKICBhc3luYyBm
dW5jdGlvbiBsb2FkQWN0aXZlRG0ob3B0aW9ucyA9IG51bGwpIHsKICAgIGlmICghYWN0aXZlRG1Vc2VyIHx8ICFkbU1lc3NhZ2VzKSByZXR1cm47CgogICAg
Y29uc3QgdXNlcm5hbWUgPSBTdHJpbmcoYWN0aXZlRG1Vc2VyLnVzZXJuYW1lIHx8ICIiKS50cmltKCk7CiAgICBpZiAoIXVzZXJuYW1lKSByZXR1cm47Cgog
ICAgY29uc3Qgd2FudGVkID0gcGVvcGxlRG1Vc2VybmFtZUtleSh1c2VybmFtZSk7CiAgICBjb25zdCByZXF1ZXN0VmVyc2lvbiA9ICsrcGVvcGxlRG1Mb2Fk
UmVxdWVzdFZlcnNpb247CiAgICBsZXQgY2FjaGVkID0gcGVvcGxlRG1DYWNoZWRWaWV3KHVzZXJuYW1lKTsKCiAgICBpZiAoIWNhY2hlZCkgewogICAgICBj
b25zdCBwZXJzaXN0ZWQgPSBhd2FpdCB3aW5kb3cuUGVvcGxlT2ZmbGluZT8uZ2V0RG1WaWV3Py4odXNlcm5hbWUpLmNhdGNoKCgpID0+IG51bGwpOwogICAg
ICBpZiAocGVyc2lzdGVkKSB7CiAgICAgICAgcGVvcGxlRG1WaWV3Q2FjaGUuc2V0KHdhbnRlZCwgcGVyc2lzdGVkKTsKICAgICAgICBwZW9wbGVEbVRyaW1N
YXAocGVvcGxlRG1WaWV3Q2FjaGUsIFBFT1BMRV9ETV9WSUVXX0NBQ0hFX01BWCk7CiAgICAgICAgY2FjaGVkID0gcGVyc2lzdGVkOwogICAgICB9CiAgICB9
CgogICAgaWYgKGNhY2hlZCAmJiBvcHRpb25zPy5za2lwQ2FjaGUgIT09IHRydWUpIHsKICAgICAgcGVvcGxlRG1SZW5kZXJDb252ZXJzYXRpb24oCiAgICAg
ICAgdXNlcm5hbWUsCiAgICAgICAgY2FjaGVkLnVzZXIsCiAgICAgICAgY2FjaGVkLm1lc3NhZ2VzLAogICAgICAgIHsKICAgICAgICAgIGhhc09sZGVyOgog
ICAgICAgICAgICBjYWNoZWQuaGFzT2xkZXIsCiAgICAgICAgICBoYXNOZXdlcjoKICAgICAgICAgICAgY2FjaGVkLmhhc05ld2VyCiAgICAgICAgfQogICAg
ICApOwogICAgfQoKICAgIGlmIChuYXZpZ2F0b3Iub25MaW5lID09PSBmYWxzZSkgewogICAgICBpZiAoY2FjaGVkKSB7CiAgICAgICAgcGVvcGxlRG1SZW5k
ZXJDb252ZXJzYXRpb24oCiAgICAgICAgICB1c2VybmFtZSwKICAgICAgICAgIGNhY2hlZC51c2VyIHx8IGFjdGl2ZURtVXNlciwKICAgICAgICAgIGNhY2hl
ZC5tZXNzYWdlcyB8fCBbXSwKICAgICAgICAgIHsKICAgICAgICAgICAgaGFzT2xkZXI6IEJvb2xlYW4oY2FjaGVkLmhhc09sZGVyKSwKICAgICAgICAgICAg
aGFzTmV3ZXI6IEJvb2xlYW4oY2FjaGVkLmhhc05ld2VyKQogICAgICAgICAgfQogICAgICAgICk7CiAgICAgIH0gZWxzZSBpZiAocmVxdWVzdFZlcnNpb24g
PT09IHBlb3BsZURtTG9hZFJlcXVlc3RWZXJzaW9uKSB7CiAgICAgICAgY29uc3QgZW1wdHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAg
ICAgICBlbXB0eS5jbGFzc05hbWUgPSAiaG9tZS1lbXB0eSI7CiAgICAgICAgZW1wdHkudGV4dENvbnRlbnQgPSAiQ2V0dGUgY29udmVyc2F0aW9uIG4nYSBw
YXMgZW5jb3JlIMOpdMOpIHN5bmNocm9uaXPDqWUgc3VyIGNldCBhcHBhcmVpbC4iOwogICAgICAgIGRtTWVzc2FnZXMucmVwbGFjZUNoaWxkcmVuKGVtcHR5
KTsKICAgICAgfQogICAgICByZXR1cm47CiAgICB9CgogICAgdHJ5IHsKICAgICAgY29uc3QgcHJlZmV0Y2hlZCA9IHBlb3BsZURtUHJlZmV0Y2hQcm9taXNl
cy5nZXQod2FudGVkKTsKICAgICAgbGV0IGZyZXNoID0gcHJlZmV0Y2hlZAogICAgICAgID8gYXdhaXQgcHJlZmV0Y2hlZAogICAgICAgIDogbnVsbDsKCiAg
ICAgIC8vIFVuIHByw6ljaGFyZ2VtZW50IHBldXQgYXZvaXIgw6ljaG91w6kgc2lsZW5jaWV1c2VtZW50LiBBdSBjbGljLCBvbgogICAgICAvLyByZXRlbnRl
IGFsb3JzIG5vcm1hbGVtZW50IGF1IGxpZXUgZGUgbGFpc3NlciB1bmUgdnVlIHZpZGUuCiAgICAgIGlmICghZnJlc2gpIHsKICAgICAgICBmcmVzaCA9IGF3
YWl0IHBlb3BsZURtRmV0Y2hBbmREZWNyeXB0KHVzZXJuYW1lKTsKICAgICAgfQoKICAgICAgaWYgKAogICAgICAgIHJlcXVlc3RWZXJzaW9uID09PSBwZW9w
bGVEbUxvYWRSZXF1ZXN0VmVyc2lvbiAmJgogICAgICAgIHBlb3BsZURtVXNlcm5hbWVLZXkoYWN0aXZlRG1Vc2VyPy51c2VybmFtZSkgPT09IHdhbnRlZAog
ICAgICApIHsKICAgICAgICAvKgogICAgICAgICAgUEVPUExFX0RNX05PX0ZMSUNLRVJfVjEKICAgICAgICAgIFNpIHVuIGVudm9pIG9wdGltaXN0ZSB2aWVu
dCBkJ8OqdHJlIGNvbmZpcm3DqSBwYXIgbGUgUE9TVCwKICAgICAgICAgIG9uIGdhcmRlIHNhIGJ1bGxlIGFmZmljaMOpZSBwZW5kYW50IFRPVVQgbGUgcmVm
cmVzaCByw6lzZWF1LgogICAgICAgICovCiAgICAgICAgaWYgKG9wdGlvbnM/LnNldHRsZVBlbmRpbmdJZCkgewogICAgICAgICAgcGVvcGxlRG1SZW1vdmVQ
ZW5kaW5nKAogICAgICAgICAgICBvcHRpb25zLnNldHRsZVBlbmRpbmdJZAogICAgICAgICAgKTsKICAgICAgICB9CgogICAgICAgIHBlb3BsZURtUmVtZW1i
ZXJWaWV3KAogICAgICAgICAgdXNlcm5hbWUsCiAgICAgICAgICBmcmVzaC51c2VyLAogICAgICAgICAgZnJlc2gubWVzc2FnZXMsCiAgICAgICAgICB7CiAg
ICAgICAgICAgIGhhc09sZGVyOgogICAgICAgICAgICAgIGZyZXNoLmhhc01vcmUsCiAgICAgICAgICAgIGhhc05ld2VyOgogICAgICAgICAgICAgIGZhbHNl
CiAgICAgICAgICB9CiAgICAgICAgKTsKCiAgICAgICAgcGVvcGxlRG1SZW5kZXJDb252ZXJzYXRpb24oCiAgICAgICAgICB1c2VybmFtZSwKICAgICAgICAg
IGZyZXNoLnVzZXIsCiAgICAgICAgICBmcmVzaC5tZXNzYWdlcywKICAgICAgICAgIHsKICAgICAgICAgICAgaGFzT2xkZXI6CiAgICAgICAgICAgICAgZnJl
c2guaGFzTW9yZSwKICAgICAgICAgICAgaGFzTmV3ZXI6CiAgICAgICAgICAgICAgZmFsc2UKICAgICAgICAgIH0KICAgICAgICApOwogICAgICB9CgogICAg
ICAvLyBNYXJxdWFnZSBsdSArIHNpZGViYXIgbmUgYmxvcXVlbnQgcGx1cyBsJ291dmVydHVyZSBkdSBNUC4KICAgICAgdm9pZCBhcGkoCiAgICAgICAgIi9h
cGkvZG0vIiArIGVuY29kZVVSSUNvbXBvbmVudCh1c2VybmFtZSkgKyAiL3JlYWQiLAogICAgICAgIHsgbWV0aG9kOiAiUE9TVCIgfQogICAgICApCiAgICAg
ICAgLnRoZW4oKCkgPT4gcmVmcmVzaENvbnZlcnNhdGlvbnMoKSkKICAgICAgICAuY2F0Y2goKCkgPT4ge30pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAg
IGlmICgKICAgICAgICAhY2FjaGVkICYmCiAgICAgICAgcmVxdWVzdFZlcnNpb24gPT09IHBlb3BsZURtTG9hZFJlcXVlc3RWZXJzaW9uICYmCiAgICAgICAg
cGVvcGxlRG1Vc2VybmFtZUtleShhY3RpdmVEbVVzZXI/LnVzZXJuYW1lKSA9PT0gd2FudGVkCiAgICAgICkgewogICAgICAgIGNvbnN0IGVtcHR5ID0gZG9j
dW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICAgICAgZW1wdHkuY2xhc3NOYW1lID0gImhvbWUtZW1wdHkiOwogICAgICAgIGVtcHR5LnRleHRDb250
ZW50ID0gZXJyLm1lc3NhZ2U7CiAgICAgICAgZG1NZXNzYWdlcy5yZXBsYWNlQ2hpbGRyZW4oZW1wdHkpOwogICAgICB9CiAgICB9CiAgfQoKICAvLyA9PT0g
UEVPUExFX0RNX1BBR0lOQVRJT05fVjFfU1RBUlQgPT09CiAgZnVuY3Rpb24gcGVvcGxlRG1NZXJnZUhpc3RvcnkoLi4ubGlzdHMpIHsKICAgIGNvbnN0IGJ5
SWQgPQogICAgICBuZXcgTWFwKCk7CgogICAgZm9yIChjb25zdCBsaXN0IG9mIGxpc3RzKSB7CiAgICAgIGZvciAoCiAgICAgICAgY29uc3QgbWVzc2FnZSBv
ZgogICAgICAgIEFycmF5LmlzQXJyYXkobGlzdCkKICAgICAgICAgID8gbGlzdAogICAgICAgICAgOiBbXQogICAgICApIHsKICAgICAgICBjb25zdCBpZCA9
CiAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgIG1lc3NhZ2U/LmlkIHx8CiAgICAgICAgICAgICIiCiAgICAgICAgICApOwoKICAgICAgICBjb25zdCBm
YWxsYmFjayA9CiAgICAgICAgICBbCiAgICAgICAgICAgIFN0cmluZyhtZXNzYWdlPy5jcmVhdGVkQXQgfHwgIiIpLAogICAgICAgICAgICBTdHJpbmcobWVz
c2FnZT8uc2VuZGVySWQgfHwgIiIpLAogICAgICAgICAgICBTdHJpbmcobWVzc2FnZT8uYm9keSB8fCAiIiksCiAgICAgICAgICAgIFN0cmluZyhtZXNzYWdl
Py5pbWFnZUlkIHx8ICIiKQogICAgICAgICAgXS5qb2luKCJcdTAwMWYiKTsKCiAgICAgICAgYnlJZC5zZXQoCiAgICAgICAgICBpZCB8fCBmYWxsYmFjaywK
ICAgICAgICAgIG1lc3NhZ2UKICAgICAgICApOwogICAgICB9CiAgICB9CgogICAgcmV0dXJuIFsKICAgICAgLi4uYnlJZC52YWx1ZXMoKQogICAgXS5zb3J0
KAogICAgICAobGVmdCwgcmlnaHQpID0+IHsKICAgICAgICBjb25zdCB0aW1lID0KICAgICAgICAgIGRtTWVzc2FnZVRpbWVzdGFtcChsZWZ0KSAtCiAgICAg
ICAgICBkbU1lc3NhZ2VUaW1lc3RhbXAocmlnaHQpOwoKICAgICAgICBpZiAodGltZSAhPT0gMCkgewogICAgICAgICAgcmV0dXJuIHRpbWU7CiAgICAgICAg
fQoKICAgICAgICByZXR1cm4gU3RyaW5nKGxlZnQ/LmlkIHx8ICIiKQogICAgICAgICAgLmxvY2FsZUNvbXBhcmUoCiAgICAgICAgICAgIFN0cmluZyhyaWdo
dD8uaWQgfHwgIiIpCiAgICAgICAgICApOwogICAgICB9CiAgICApOwogIH0KCiAgZnVuY3Rpb24gcGVvcGxlRG1IaXN0b3J5Q3Vyc29yKAogICAgbWVzc2Fn
ZXMsCiAgICBzaWRlCiAgKSB7CiAgICBjb25zdCBsaXN0ID0KICAgICAgQXJyYXkuaXNBcnJheShtZXNzYWdlcykKICAgICAgICA/IG1lc3NhZ2VzCiAgICAg
ICAgOiBbXTsKCiAgICBpZiAoIWxpc3QubGVuZ3RoKSB7CiAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBjb25zdCBtZXNzYWdlID0KICAgICAgc2lkZSA9
PT0gIm5ld2VyIgogICAgICAgID8gbGlzdFtsaXN0Lmxlbmd0aCAtIDFdCiAgICAgICAgOiBsaXN0WzBdOwoKICAgIHJldHVybiBTdHJpbmcoCiAgICAgIG1l
c3NhZ2U/LmNyZWF0ZWRBdCB8fAogICAgICAiIgogICAgKTsKICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtQ2FwdHVyZVNjcm9sbEFuY2hvcigpIHsKICAgIGlm
ICghZG1NZXNzYWdlcykgewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KCiAgICBjb25zdCBjb250YWluZXJSZWN0ID0KICAgICAgZG1NZXNzYWdlcy5nZXRC
b3VuZGluZ0NsaWVudFJlY3QoKTsKCiAgICBjb25zdCBub2RlcyA9CiAgICAgIGRtTWVzc2FnZXMucXVlcnlTZWxlY3RvckFsbCgKICAgICAgICAiW2RhdGEt
bWVzc2FnZS1pZF0iCiAgICAgICk7CgogICAgZm9yIChjb25zdCBub2RlIG9mIG5vZGVzKSB7CiAgICAgIGNvbnN0IHJlY3QgPQogICAgICAgIG5vZGUuZ2V0
Qm91bmRpbmdDbGllbnRSZWN0KCk7CgogICAgICBpZiAoCiAgICAgICAgcmVjdC5ib3R0b20gPj0KICAgICAgICBjb250YWluZXJSZWN0LnRvcCArIDIKICAg
ICAgKSB7CiAgICAgICAgcmV0dXJuIHsKICAgICAgICAgIGlkOgogICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgbm9kZS5kYXRhc2V0Lm1lc3Nh
Z2VJZCB8fAogICAgICAgICAgICAgICIiCiAgICAgICAgICAgICksCiAgICAgICAgICBvZmZzZXQ6CiAgICAgICAgICAgIHJlY3QudG9wIC0KICAgICAgICAg
ICAgY29udGFpbmVyUmVjdC50b3AKICAgICAgICB9OwogICAgICB9CiAgICB9CgogICAgcmV0dXJuIG51bGw7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbVJl
c3RvcmVTY3JvbGxBbmNob3IoYW5jaG9yKSB7CiAgICBpZiAoCiAgICAgICFkbU1lc3NhZ2VzIHx8CiAgICAgICFhbmNob3I/LmlkCiAgICApIHsKICAgICAg
cmV0dXJuOwogICAgfQoKICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgKICAgICAgKCkgPT4gewogICAgICAgIGNvbnN0IGNvbnRhaW5lclJlY3QgPQogICAg
ICAgICAgZG1NZXNzYWdlcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsKCiAgICAgICAgY29uc3Qgbm9kZSA9CiAgICAgICAgICBbCiAgICAgICAgICAgIC4u
LmRtTWVzc2FnZXMucXVlcnlTZWxlY3RvckFsbCgKICAgICAgICAgICAgICAiW2RhdGEtbWVzc2FnZS1pZF0iCiAgICAgICAgICAgICkKICAgICAgICAgIF0u
ZmluZCgKICAgICAgICAgICAgKGNhbmRpZGF0ZSkgPT4KICAgICAgICAgICAgICBTdHJpbmcoCiAgICAgICAgICAgICAgICBjYW5kaWRhdGUuZGF0YXNldC5t
ZXNzYWdlSWQgfHwKICAgICAgICAgICAgICAgICIiCiAgICAgICAgICAgICAgKSA9PT0gYW5jaG9yLmlkCiAgICAgICAgICApOwoKICAgICAgICBpZiAoIW5v
ZGUpIHsKICAgICAgICAgIHJldHVybjsKICAgICAgICB9CgogICAgICAgIGNvbnN0IHJlY3QgPQogICAgICAgICAgbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJl
Y3QoKTsKCiAgICAgICAgZG1NZXNzYWdlcy5zY3JvbGxUb3AgKz0KICAgICAgICAgIHJlY3QudG9wIC0KICAgICAgICAgIGNvbnRhaW5lclJlY3QudG9wIC0K
ICAgICAgICAgIGFuY2hvci5vZmZzZXQ7CiAgICAgIH0KICAgICk7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbUlzTmVhckJvdHRvbSgpIHsKICAgIGlmICgh
ZG1NZXNzYWdlcykgewogICAgICByZXR1cm4gdHJ1ZTsKICAgIH0KCiAgICByZXR1cm4gKAogICAgICBkbU1lc3NhZ2VzLnNjcm9sbEhlaWdodCAtCiAgICAg
IGRtTWVzc2FnZXMuc2Nyb2xsVG9wIC0KICAgICAgZG1NZXNzYWdlcy5jbGllbnRIZWlnaHQKICAgICkgPCAxODA7CiAgfQoKICBsZXQgcGVvcGxlRG1Mb2Fk
aW5nT2xkZXIgPSBmYWxzZTsKICBsZXQgcGVvcGxlRG1Mb2FkaW5nTmV3ZXIgPSBmYWxzZTsKCiAgYXN5bmMgZnVuY3Rpb24gcGVvcGxlRG1Mb2FkT2xkZXIo
KSB7CiAgICBpZiAoCiAgICAgIHBlb3BsZURtTG9hZGluZ09sZGVyIHx8CiAgICAgICFhY3RpdmVEbVVzZXIgfHwKICAgICAgIWRtTWVzc2FnZXMKICAgICkg
ewogICAgICByZXR1cm47CiAgICB9CgogICAgY29uc3QgdXNlcm5hbWUgPQogICAgICBTdHJpbmcoCiAgICAgICAgYWN0aXZlRG1Vc2VyLnVzZXJuYW1lIHx8
CiAgICAgICAgIiIKICAgICAgKS50cmltKCk7CgogICAgY29uc3Qgd2FudGVkID0KICAgICAgcGVvcGxlRG1Vc2VybmFtZUtleSh1c2VybmFtZSk7CgogICAg
Y29uc3QgY2FjaGVkID0KICAgICAgcGVvcGxlRG1DYWNoZWRWaWV3KHVzZXJuYW1lKTsKCiAgICBpZiAoCiAgICAgICFjYWNoZWQ/Lmhhc09sZGVyIHx8CiAg
ICAgICFjYWNoZWQubWVzc2FnZXM/Lmxlbmd0aAogICAgKSB7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBjb25zdCBjdXJzb3IgPQogICAgICBwZW9wbGVE
bUhpc3RvcnlDdXJzb3IoCiAgICAgICAgY2FjaGVkLm1lc3NhZ2VzLAogICAgICAgICJvbGRlciIKICAgICAgKTsKCiAgICBpZiAoIWN1cnNvcikgewogICAg
ICByZXR1cm47CiAgICB9CgogICAgcGVvcGxlRG1Mb2FkaW5nT2xkZXIgPSB0cnVlOwogICAgY29uc3QgYW5jaG9yID0KICAgICAgcGVvcGxlRG1DYXB0dXJl
U2Nyb2xsQW5jaG9yKCk7CgogICAgdHJ5IHsKICAgICAgY29uc3QgcGFnZSA9CiAgICAgICAgYXdhaXQgcGVvcGxlRG1GZXRjaEFuZERlY3J5cHQoCiAgICAg
ICAgICB1c2VybmFtZSwKICAgICAgICAgIHsKICAgICAgICAgICAgYmVmb3JlOgogICAgICAgICAgICAgIGN1cnNvciwKICAgICAgICAgICAgcmVtZW1iZXI6
CiAgICAgICAgICAgICAgZmFsc2UKICAgICAgICAgIH0KICAgICAgICApOwoKICAgICAgaWYgKAogICAgICAgIHBlb3BsZURtVXNlcm5hbWVLZXkoYWN0aXZl
RG1Vc2VyPy51c2VybmFtZSkgIT09IHdhbnRlZAogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGxldCBtZXJnZWQgPQogICAgICAg
IHBlb3BsZURtTWVyZ2VIaXN0b3J5KAogICAgICAgICAgcGFnZS5tZXNzYWdlcywKICAgICAgICAgIGNhY2hlZC5tZXNzYWdlcwogICAgICAgICk7CgogICAg
ICBsZXQgaGFzTmV3ZXIgPQogICAgICAgIEJvb2xlYW4oCiAgICAgICAgICBjYWNoZWQuaGFzTmV3ZXIKICAgICAgICApOwoKICAgICAgaWYgKAogICAgICAg
IG1lcmdlZC5sZW5ndGggPgogICAgICAgIFBFT1BMRV9ETV9ISVNUT1JZX1dJTkRPV19NQVgKICAgICAgKSB7CiAgICAgICAgLyoKICAgICAgICAgIE9uIGVz
dCBlbiB0cmFpbiBkZSByZW1vbnRlciA6IG9uIGdhcmRlIGxlIGPDtHTDqSBhbmNpZW4gZXQgb24KICAgICAgICAgIGxpYsOocmUgbGVzIG1lc3NhZ2VzIGxl
cyBwbHVzIHLDqWNlbnRzLiBJbHMgcG91cnJvbnQgw6p0cmUKICAgICAgICAgIHJlY2hhcmfDqXMgYXZlYyBgYWZ0ZXJgIGVuIHJlZGVzY2VuZGFudC4KICAg
ICAgICAqLwogICAgICAgIG1lcmdlZCA9CiAgICAgICAgICBtZXJnZWQuc2xpY2UoCiAgICAgICAgICAgIDAsCiAgICAgICAgICAgIFBFT1BMRV9ETV9ISVNU
T1JZX1dJTkRPV19NQVgKICAgICAgICAgICk7CgogICAgICAgIGhhc05ld2VyID0gdHJ1ZTsKICAgICAgfQoKICAgICAgcGVvcGxlRG1SZW1lbWJlclZpZXco
CiAgICAgICAgdXNlcm5hbWUsCiAgICAgICAgcGFnZS51c2VyIHx8IGNhY2hlZC51c2VyLAogICAgICAgIG1lcmdlZCwKICAgICAgICB7CiAgICAgICAgICBo
YXNPbGRlcjoKICAgICAgICAgICAgcGFnZS5oYXNNb3JlLAogICAgICAgICAgaGFzTmV3ZXIKICAgICAgICB9CiAgICAgICk7CgogICAgICBwZW9wbGVEbVJl
bmRlckNvbnZlcnNhdGlvbigKICAgICAgICB1c2VybmFtZSwKICAgICAgICBwYWdlLnVzZXIgfHwgY2FjaGVkLnVzZXIsCiAgICAgICAgbWVyZ2VkLAogICAg
ICAgIHsKICAgICAgICAgIGhhc09sZGVyOgogICAgICAgICAgICBwYWdlLmhhc01vcmUsCiAgICAgICAgICBoYXNOZXdlciwKICAgICAgICAgIHNjcm9sbFRv
Qm90dG9tOgogICAgICAgICAgICBmYWxzZQogICAgICAgIH0KICAgICAgKTsKCiAgICAgIHBlb3BsZURtUmVzdG9yZVNjcm9sbEFuY2hvcigKICAgICAgICBh
bmNob3IKICAgICAgKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBjb25zb2xlLndhcm4oCiAgICAgICAgIltQZW9wbGUgRE0gcGFnaW5hdGlvbi9vbGRl
cl0iLAogICAgICAgIGVycgogICAgICApOwogICAgfSBmaW5hbGx5IHsKICAgICAgcGVvcGxlRG1Mb2FkaW5nT2xkZXIgPSBmYWxzZTsKICAgIH0KICB9Cgog
IGFzeW5jIGZ1bmN0aW9uIHBlb3BsZURtTG9hZE5ld2VyKCkgewogICAgaWYgKAogICAgICBwZW9wbGVEbUxvYWRpbmdOZXdlciB8fAogICAgICAhYWN0aXZl
RG1Vc2VyIHx8CiAgICAgICFkbU1lc3NhZ2VzCiAgICApIHsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIGNvbnN0IHVzZXJuYW1lID0KICAgICAgU3RyaW5n
KAogICAgICAgIGFjdGl2ZURtVXNlci51c2VybmFtZSB8fAogICAgICAgICIiCiAgICAgICkudHJpbSgpOwoKICAgIGNvbnN0IHdhbnRlZCA9CiAgICAgIHBl
b3BsZURtVXNlcm5hbWVLZXkodXNlcm5hbWUpOwoKICAgIGNvbnN0IGNhY2hlZCA9CiAgICAgIHBlb3BsZURtQ2FjaGVkVmlldyh1c2VybmFtZSk7CgogICAg
aWYgKAogICAgICAhY2FjaGVkPy5oYXNOZXdlciB8fAogICAgICAhY2FjaGVkLm1lc3NhZ2VzPy5sZW5ndGgKICAgICkgewogICAgICByZXR1cm47CiAgICB9
CgogICAgY29uc3QgY3Vyc29yID0KICAgICAgcGVvcGxlRG1IaXN0b3J5Q3Vyc29yKAogICAgICAgIGNhY2hlZC5tZXNzYWdlcywKICAgICAgICAibmV3ZXIi
CiAgICAgICk7CgogICAgaWYgKCFjdXJzb3IpIHsKICAgICAgcmV0dXJuOwogICAgfQoKICAgIHBlb3BsZURtTG9hZGluZ05ld2VyID0gdHJ1ZTsKICAgIGNv
bnN0IGFuY2hvciA9CiAgICAgIHBlb3BsZURtQ2FwdHVyZVNjcm9sbEFuY2hvcigpOwoKICAgIHRyeSB7CiAgICAgIGNvbnN0IHBhZ2UgPQogICAgICAgIGF3
YWl0IHBlb3BsZURtRmV0Y2hBbmREZWNyeXB0KAogICAgICAgICAgdXNlcm5hbWUsCiAgICAgICAgICB7CiAgICAgICAgICAgIGFmdGVyOgogICAgICAgICAg
ICAgIGN1cnNvciwKICAgICAgICAgICAgcmVtZW1iZXI6CiAgICAgICAgICAgICAgZmFsc2UKICAgICAgICAgIH0KICAgICAgICApOwoKICAgICAgaWYgKAog
ICAgICAgIHBlb3BsZURtVXNlcm5hbWVLZXkoYWN0aXZlRG1Vc2VyPy51c2VybmFtZSkgIT09IHdhbnRlZAogICAgICApIHsKICAgICAgICByZXR1cm47CiAg
ICAgIH0KCiAgICAgIGxldCBtZXJnZWQgPQogICAgICAgIHBlb3BsZURtTWVyZ2VIaXN0b3J5KAogICAgICAgICAgY2FjaGVkLm1lc3NhZ2VzLAogICAgICAg
ICAgcGFnZS5tZXNzYWdlcwogICAgICAgICk7CgogICAgICBsZXQgaGFzT2xkZXIgPQogICAgICAgIEJvb2xlYW4oCiAgICAgICAgICBjYWNoZWQuaGFzT2xk
ZXIKICAgICAgICApOwoKICAgICAgaWYgKAogICAgICAgIG1lcmdlZC5sZW5ndGggPgogICAgICAgIFBFT1BMRV9ETV9ISVNUT1JZX1dJTkRPV19NQVgKICAg
ICAgKSB7CiAgICAgICAgLyoKICAgICAgICAgIE9uIHJlZGVzY2VuZCA6IG9uIGxpYsOocmUgY2V0dGUgZm9pcyBsZXMgbWVzc2FnZXMgbGVzIHBsdXMgYW5j
aWVucy4KICAgICAgICAgIElscyByZXN0ZW50IGRpc3BvbmlibGVzIGV0IHNlcm9udCByZWNoYXJnw6lzIHNpIG9uIHJlbW9udGUuCiAgICAgICAgKi8KICAg
ICAgICBtZXJnZWQgPQogICAgICAgICAgbWVyZ2VkLnNsaWNlKAogICAgICAgICAgICAtUEVPUExFX0RNX0hJU1RPUllfV0lORE9XX01BWAogICAgICAgICAg
KTsKCiAgICAgICAgaGFzT2xkZXIgPSB0cnVlOwogICAgICB9CgogICAgICBwZW9wbGVEbVJlbWVtYmVyVmlldygKICAgICAgICB1c2VybmFtZSwKICAgICAg
ICBwYWdlLnVzZXIgfHwgY2FjaGVkLnVzZXIsCiAgICAgICAgbWVyZ2VkLAogICAgICAgIHsKICAgICAgICAgIGhhc09sZGVyLAogICAgICAgICAgaGFzTmV3
ZXI6CiAgICAgICAgICAgIHBhZ2UuaGFzTW9yZQogICAgICAgIH0KICAgICAgKTsKCiAgICAgIHBlb3BsZURtUmVuZGVyQ29udmVyc2F0aW9uKAogICAgICAg
IHVzZXJuYW1lLAogICAgICAgIHBhZ2UudXNlciB8fCBjYWNoZWQudXNlciwKICAgICAgICBtZXJnZWQsCiAgICAgICAgewogICAgICAgICAgaGFzT2xkZXIs
CiAgICAgICAgICBoYXNOZXdlcjoKICAgICAgICAgICAgcGFnZS5oYXNNb3JlLAogICAgICAgICAgc2Nyb2xsVG9Cb3R0b206CiAgICAgICAgICAgIGZhbHNl
CiAgICAgICAgfQogICAgICApOwoKICAgICAgcGVvcGxlRG1SZXN0b3JlU2Nyb2xsQW5jaG9yKAogICAgICAgIGFuY2hvcgogICAgICApOwogICAgfSBjYXRj
aCAoZXJyKSB7CiAgICAgIGNvbnNvbGUud2FybigKICAgICAgICAiW1Blb3BsZSBETSBwYWdpbmF0aW9uL25ld2VyXSIsCiAgICAgICAgZXJyCiAgICAgICk7
CiAgICB9IGZpbmFsbHkgewogICAgICBwZW9wbGVEbUxvYWRpbmdOZXdlciA9IGZhbHNlOwogICAgfQogIH0KCiAgZG1NZXNzYWdlcz8uYWRkRXZlbnRMaXN0
ZW5lcigKICAgICJzY3JvbGwiLAogICAgKCkgPT4gewogICAgICBpZiAoCiAgICAgICAgIWFjdGl2ZURtVXNlciB8fAogICAgICAgIGRtVmlldz8uY2xhc3NM
aXN0LmNvbnRhaW5zKAogICAgICAgICAgImhpZGRlbiIKICAgICAgICApCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgaWYgKAog
ICAgICAgIGRtTWVzc2FnZXMuc2Nyb2xsVG9wIDw9CiAgICAgICAgUEVPUExFX0RNX0hJU1RPUllfRURHRV9QWAogICAgICApIHsKICAgICAgICB2b2lkIHBl
b3BsZURtTG9hZE9sZGVyKCk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBpZiAoCiAgICAgICAgZG1NZXNzYWdlcy5zY3JvbGxIZWlnaHQgLQog
ICAgICAgIGRtTWVzc2FnZXMuc2Nyb2xsVG9wIC0KICAgICAgICBkbU1lc3NhZ2VzLmNsaWVudEhlaWdodCA8PQogICAgICAgIFBFT1BMRV9ETV9ISVNUT1JZ
X0VER0VfUFgKICAgICAgKSB7CiAgICAgICAgdm9pZCBwZW9wbGVEbUxvYWROZXdlcigpOwogICAgICB9CiAgICB9LAogICAgeyBwYXNzaXZlOiB0cnVlIH0K
ICApOwogIC8vID09PSBQRU9QTEVfRE1fUEFHSU5BVElPTl9WMV9FTkQgPT09CgogIGFzeW5jIGZ1bmN0aW9uIG9wZW5EbSgKICAgIHVzZXJuYW1lLAogICAg
b3B0aW9ucyA9IG51bGwKICApIHsKICAgIGNvbnN0IGNsZWFuVXNlcm5hbWUgPSBTdHJpbmcodXNlcm5hbWUgfHwgIiIpLnRyaW0oKTsKICAgIGlmICghY2xl
YW5Vc2VybmFtZSkgcmV0dXJuOwoKICAgIC8vIEwnaW50ZXJmYWNlIGJhc2N1bGUgQVZBTlQgdG91dCBhbGxlci1yZXRvdXIgcsOpc2VhdS4KICAgIHNldE1v
ZGUoImhvbWUiKTsKICAgIGhvbWVNYWluPy5jbGFzc0xpc3QuYWRkKCJkbS1vcGVuIik7CiAgICBmcmllbmRzVmlldz8uY2xhc3NMaXN0LmFkZCgiaGlkZGVu
Iik7CiAgICBkbVZpZXc/LmNsYXNzTGlzdC5yZW1vdmUoImhpZGRlbiIpOwoKICAgIGNvbnN0IGNhY2hlZCA9IHBlb3BsZURtQ2FjaGVkVmlldyhjbGVhblVz
ZXJuYW1lKTsKICAgIGNvbnN0IHNlZWRVc2VyID0KICAgICAgY2FjaGVkPy51c2VyIHx8CiAgICAgIHBlb3BsZURtQ29udmVyc2F0aW9uVXNlcihjbGVhblVz
ZXJuYW1lKSB8fAogICAgICB7IHVzZXJuYW1lOiBjbGVhblVzZXJuYW1lIH07CgogICAgYWN0aXZlRG1Vc2VyID0gewogICAgICAuLi5zZWVkVXNlciwKICAg
ICAgdXNlcm5hbWU6IFN0cmluZyhzZWVkVXNlcj8udXNlcm5hbWUgfHwgY2xlYW5Vc2VybmFtZSkKICAgIH07CgogICAgaWYgKGhvbWVNYWluVGl0bGUpIHsK
ICAgICAgaG9tZU1haW5UaXRsZS50ZXh0Q29udGVudCA9ICJNZXNzYWdlIHByaXbDqSI7CiAgICB9CgogICAgaWYgKGhvbWVNYWluU3VidGl0bGUpIHsKICAg
ICAgaG9tZU1haW5TdWJ0aXRsZS50ZXh0Q29udGVudCA9CiAgICAgICAgIkNvbnZlcnNhdGlvbiBhdmVjICIgKyBhY3RpdmVEbVVzZXIudXNlcm5hbWU7CiAg
ICB9CgogICAgaWYgKGNhY2hlZCkgewogICAgICBwZW9wbGVEbVJlbmRlckNvbnZlcnNhdGlvbigKICAgICAgICBjbGVhblVzZXJuYW1lLAogICAgICAgIGNh
Y2hlZC51c2VyLAogICAgICAgIGNhY2hlZC5tZXNzYWdlcwogICAgICApOwogICAgfSBlbHNlIHsKICAgICAgLy8gTcOqbWUgc2FucyBjYWNoZSwgbGUgaGVh
ZGVyIGFwcGFyYcOudCBpbW3DqWRpYXRlbWVudCBldCBvbiDDqXZpdGUKICAgICAgLy8gZGUgbGFpc3NlciBsZXMgbWVzc2FnZXMgZHUgTVAgcHLDqWPDqWRl
bnQgw6AgbCfDqWNyYW4uCiAgICAgIHBlb3BsZURtUmVuZGVyQ29udmVyc2F0aW9uKAogICAgICAgIGNsZWFuVXNlcm5hbWUsCiAgICAgICAgYWN0aXZlRG1V
c2VyLAogICAgICAgIFtdCiAgICAgICk7CiAgICB9CgogICAgcmVuZGVyQ29udmVyc2F0aW9uTGlzdCgpOwogICAgZG1JbnB1dD8uZm9jdXMoKTsKCiAgICBw
ZW9wbGVSZWNvcmRCcm93c2VyTmF2aWdhdGlvbigKICAgICAgewogICAgICAgIHZpZXc6ICJkbSIsCiAgICAgICAgdXNlcm5hbWU6IGNsZWFuVXNlcm5hbWUK
ICAgICAgfSwKICAgICAgb3B0aW9ucwogICAgKTsKCiAgICAvLyBSw6lvdXZyaXIgY8O0dMOpIHNlcnZldXIgZXN0IHVuZSBvcMOpcmF0aW9uIHNlY29uZGFp
cmUgOiBlbGxlIG5lIGJsb3F1ZQogICAgLy8gcGx1cyBsJ2FmZmljaGFnZS4KICAgIHZvaWQgYXBpKAogICAgICAiL2FwaS9kbS8iICsgZW5jb2RlVVJJQ29t
cG9uZW50KGNsZWFuVXNlcm5hbWUpICsgIi9vcGVuIiwKICAgICAgeyBtZXRob2Q6ICJQT1NUIiB9CiAgICApLmNhdGNoKCgpID0+IHt9KTsKCiAgICBhd2Fp
dCBsb2FkQWN0aXZlRG0oeyBza2lwQ2FjaGU6IHRydWUgfSk7CiAgfQogIC8vID09PSBQRU9QTEVfRE1fSU5TVEFOVF9PUEVOX1YzX1JFTkRFUl9FTkQgPT09
CgogIGZ1bmN0aW9uIGNsb3NlUHJvZmlsZSgpIHsKICAgIHByb2ZpbGVNb2RhbD8uY2xhc3NMaXN0LmFkZCgiaGlkZGVuIik7CiAgICBjdXJyZW50UHJvZmls
ZSA9IG51bGw7CiAgfQoKICBmdW5jdGlvbiBwcm9maWxlRGF0ZSh2YWx1ZSkgewogICAgcmV0dXJuIHZhbHVlCiAgICAgID8gZm9ybWF0RGF0ZSh2YWx1ZSwg
ZmFsc2UpCiAgICAgIDogIkRhdGUgaW5jb25udWUiOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gb3BlblByb2ZpbGUodXNlcm5hbWUpIHsKICAgIGlmICghdXNl
cm5hbWUpIHJldHVybjsKCiAgICB0cnkgewogICAgICBjb25zdCBkYXRhID0gYXdhaXQgYXBpKAogICAgICAgICIvYXBpL3Byb2ZpbGUvIiArCiAgICAgICAg
ICBlbmNvZGVVUklDb21wb25lbnQodXNlcm5hbWUpCiAgICAgICk7CgogICAgICBjdXJyZW50UHJvZmlsZSA9IGRhdGEucHJvZmlsZTsKCiAgICAgIHdpbmRv
dy5QZW9wbGVBdmF0YXJzPy5hcHBseSgKICAgICAgICBwcm9maWxlTW9kYWxBdmF0YXIsCiAgICAgICAgY3VycmVudFByb2ZpbGUudXNlcm5hbWUKICAgICAg
KTsKCiAgICAgIHByb2ZpbGVNb2RhbE5hbWUudGV4dENvbnRlbnQgPQogICAgICAgIGN1cnJlbnRQcm9maWxlLnVzZXJuYW1lOwoKICAgICAgcHJvZmlsZU1v
ZGFsT25saW5lLnRleHRDb250ZW50ID0KICAgICAgICBjdXJyZW50UHJvZmlsZS5vbmxpbmUKICAgICAgICAgID8gIuKXjyBFbiBsaWduZSIKICAgICAgICAg
IDogIkhvcnMgbGlnbmUiOwoKICAgICAgcHJvZmlsZUNyZWF0ZWRBdC50ZXh0Q29udGVudCA9CiAgICAgICAgcHJvZmlsZURhdGUoY3VycmVudFByb2ZpbGUu
Y3JlYXRlZEF0KTsKCiAgICAgIGNvbnN0IGRlc2NyaXB0aW9uID0KICAgICAgICBTdHJpbmcoY3VycmVudFByb2ZpbGUuZGVzY3JpcHRpb24gfHwgIiIpOwoK
ICAgICAgcHJvZmlsZURlc2NyaXB0aW9uVGV4dC50ZXh0Q29udGVudCA9CiAgICAgICAgZGVzY3JpcHRpb24gfHwgIkF1Y3VuZSBkZXNjcmlwdGlvbi4iOwoK
ICAgICAgcHJvZmlsZUVkaXRXcmFwLmNsYXNzTGlzdC50b2dnbGUoCiAgICAgICAgImhpZGRlbiIsCiAgICAgICAgIWN1cnJlbnRQcm9maWxlLmlzU2VsZgog
ICAgICApOwoKICAgICAgcHJvZmlsZUF2YXRhckVkaXRXcmFwPy5jbGFzc0xpc3QudG9nZ2xlKAogICAgICAgICJoaWRkZW4iLAogICAgICAgICFjdXJyZW50
UHJvZmlsZS5pc1NlbGYKICAgICAgKTsKCiAgICAgIHByb2ZpbGVBY3Rpb25zLmNsYXNzTGlzdC50b2dnbGUoCiAgICAgICAgImhpZGRlbiIsCiAgICAgICAg
Y3VycmVudFByb2ZpbGUuaXNTZWxmCiAgICAgICk7CgogICAgICBpZiAoY3VycmVudFByb2ZpbGUuaXNTZWxmKSB7CiAgICAgICAgcHJvZmlsZURlc2NyaXB0
aW9uSW5wdXQudmFsdWUgPSBkZXNjcmlwdGlvbjsKICAgICAgICBwcm9maWxlRGVzY3JpcHRpb25Db3VudC50ZXh0Q29udGVudCA9CiAgICAgICAgICBTdHJp
bmcoZGVzY3JpcHRpb24ubGVuZ3RoKTsKfSBlbHNlIHsKICAgICAgICBwcm9maWxlRnJpZW5kQnV0dG9uLmRpc2FibGVkID0gZmFsc2U7CgogICAgICAgIGlm
IChjdXJyZW50UHJvZmlsZS5pc0ZyaWVuZCkgewogICAgICAgICAgcHJvZmlsZUZyaWVuZEJ1dHRvbi50ZXh0Q29udGVudCA9CiAgICAgICAgICAgICJSZXRp
cmVyIGRlcyBhbWlzIjsKICAgICAgICB9IGVsc2UgaWYgKAogICAgICAgICAgY3VycmVudFByb2ZpbGUuZnJpZW5kUmVxdWVzdCA9PT0KICAgICAgICAgICAg
ImluY29taW5nIgogICAgICAgICkgewogICAgICAgICAgcHJvZmlsZUZyaWVuZEJ1dHRvbi50ZXh0Q29udGVudCA9CiAgICAgICAgICAgICJBY2NlcHRlciBs
YSBkZW1hbmRlIjsKICAgICAgICB9IGVsc2UgaWYgKAogICAgICAgICAgY3VycmVudFByb2ZpbGUuZnJpZW5kUmVxdWVzdCA9PT0KICAgICAgICAgICAgIm91
dGdvaW5nIgogICAgICAgICkgewogICAgICAgICAgcHJvZmlsZUZyaWVuZEJ1dHRvbi50ZXh0Q29udGVudCA9CiAgICAgICAgICAgICJEZW1hbmRlIGVudm95
w6llIjsKICAgICAgICAgIHByb2ZpbGVGcmllbmRCdXR0b24uZGlzYWJsZWQgPSB0cnVlOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICBwcm9maWxlRnJp
ZW5kQnV0dG9uLnRleHRDb250ZW50ID0KICAgICAgICAgICAgIkFqb3V0ZXIgZW4gYW1pIjsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIHByb2ZpbGVNb2Rh
bC5jbGFzc0xpc3QucmVtb3ZlKCJoaWRkZW4iKTsKICAgIH0gY2F0Y2ggKGVycikgewogICAgICBhbGVydChlcnIubWVzc2FnZSk7CiAgICB9CiAgfQoKICBh
c3luYyBmdW5jdGlvbiBib290c3RyYXBTb2NpYWwodXNlck92ZXJyaWRlID0gbnVsbCkgewogICAgdHJ5IHsKICAgICAgaWYgKHVzZXJPdmVycmlkZT8uaWQp
IHsKICAgICAgICBtZSA9IHsKICAgICAgICAgIGlkOiBTdHJpbmcodXNlck92ZXJyaWRlLmlkKSwKICAgICAgICAgIHVzZXJuYW1lOiB1c2VyT3ZlcnJpZGUu
dXNlcm5hbWUKICAgICAgICB9OwogICAgICB9IGVsc2UgewogICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBhcGkoIi9hcGkvYXV0aC9tZSIpOwogICAgICAg
IG1lID0gewogICAgICAgICAgaWQ6IFN0cmluZyhkYXRhLnVzZXIuaWQpLAogICAgICAgICAgdXNlcm5hbWU6IGRhdGEudXNlci51c2VybmFtZQogICAgICAg
IH07CiAgICAgIH0KCiAgICAgIHRyeSB7CiAgICAgICAgYXdhaXQgcGVvcGxlRG1FMmVlRW5zdXJlRGV2aWNlKCk7CiAgICAgIH0gY2F0Y2ggKGVycikgewog
ICAgICAgIGNvbnNvbGUud2FybigKICAgICAgICAgICJbUGVvcGxlIEUyRUUvYm9vdHN0cmFwXSIsCiAgICAgICAgICBlcnIKICAgICAgICApOwogICAgICB9
CgogICAgICBzb2NpYWxSZWFkeSA9IHRydWU7CgogICAgICBpZiAobmF2aWdhdG9yLm9uTGluZSA9PT0gZmFsc2UpIHsKICAgICAgICBhd2FpdCByZWZyZXNo
Q29udmVyc2F0aW9ucygpOwogICAgICAgIHNob3dGcmllbmRzKHsgcmVmcmVzaDogZmFsc2UgfSk7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBh
d2FpdCBQcm9taXNlLmFsbChbCiAgICAgICAgcmVmcmVzaENvbnZlcnNhdGlvbnMoKSwKICAgICAgICByZWZyZXNoRnJpZW5kUmVxdWVzdHMoKSwKICAgICAg
ICByZWZyZXNoRnJpZW5kcygpLAogICAgICAgIHJlZnJlc2hEaXJlY3RvcnkoIiIpCiAgICAgIF0pOwoKICAgICAgc2hvd0ZyaWVuZHMoeyByZWZyZXNoOiBm
YWxzZSB9KTsKICAgIH0gY2F0Y2ggewogICAgICBzb2NpYWxSZWFkeSA9IGZhbHNlOwogICAgfQogIH0KCiAgaG9tZVJhaWxCdXR0b24/LmFkZEV2ZW50TGlz
dGVuZXIoCiAgICAiY2xpY2siLAogICAgc2hvd0ZyaWVuZHMKICApOwoKICBmcmllbmRzTmF2QnV0dG9uPy5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNr
IiwKICAgIHNob3dGcmllbmRzCiAgKTsKCiAgZG1CYWNrQnV0dG9uPy5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgIHNob3dGcmllbmRzCiAg
KTsKCiAgZG1Qcm9maWxlQnV0dG9uPy5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgICgpID0+IHsKICAgICAgaWYgKGFjdGl2ZURtVXNlcj8u
dXNlcm5hbWUpIHsKICAgICAgICBvcGVuUHJvZmlsZShhY3RpdmVEbVVzZXIudXNlcm5hbWUpOwogICAgICB9CiAgICB9CiAgKTsKCiAgZG1Gb3JtPy5hZGRF
dmVudExpc3RlbmVyKAogICAgInN1Ym1pdCIsCiAgICBhc3luYyAoZXZlbnQpID0+IHsKICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTsKCiAgICAgIGlm
ICgKICAgICAgICAhYWN0aXZlRG1Vc2VyPy51c2VybmFtZQogICAgICApIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGNvbnN0IHRhcmdldFVz
ZXJuYW1lID0KICAgICAgICBTdHJpbmcoCiAgICAgICAgICBhY3RpdmVEbVVzZXIudXNlcm5hbWUKICAgICAgICApOwoKICAgICAgY29uc3QgYm9keSA9CiAg
ICAgICAgU3RyaW5nKAogICAgICAgICAgZG1JbnB1dD8udmFsdWUgfHwgIiIKICAgICAgICApLnRyaW0oKTsKCiAgICAgIGNvbnN0IGZpbGVzID0KICAgICAg
ICBwZW9wbGVEbUltYWdlUGlja2VyCiAgICAgICAgICA/LmdldEZpbGVzPy4oKSB8fAogICAgICAgICgKICAgICAgICAgIHBlb3BsZURtSW1hZ2VQaWNrZXIK
ICAgICAgICAgICAgPy5nZXRGaWxlPy4oKQogICAgICAgICAgICA/IFtwZW9wbGVEbUltYWdlUGlja2VyLmdldEZpbGUoKV0KICAgICAgICAgICAgOiBbXQog
ICAgICAgICk7CgogICAgICBpZiAoCiAgICAgICAgIWJvZHkgJiYKICAgICAgICAhZmlsZXMubGVuZ3RoCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAg
ICAgfQoKICAgICAgY29uc3QgcmVwbHlTbmFwc2hvdCA9CiAgICAgICAgcGVvcGxlRG1SZXBseUNvbnRyb2xsZXIKICAgICAgICAgID8uZ2V0Py4oKSB8fAog
ICAgICAgIG51bGw7CgogICAgICBjb25zdCByZXBseVRvSWQgPQogICAgICAgIHJlcGx5U25hcHNob3Q/LmlkIHx8CiAgICAgICAgbnVsbDsKCiAgICAgIGlm
IChuYXZpZ2F0b3Iub25MaW5lID09PSBmYWxzZSkgewogICAgICAgIGlmIChmaWxlcy5sZW5ndGgpIHsKICAgICAgICAgIGFsZXJ0KCJMZXMgcGnDqGNlcyBq
b2ludGVzIGRlbWFuZGVudCB1bmUgY29ubmV4aW9uLiBUb24gdGV4dGUgcmVzdGUgZGFucyBsZSBjaGFtcC4iKTsKICAgICAgICAgIHJldHVybjsKICAgICAg
ICB9CgogICAgICAgIGNvbnN0IHBlbmRpbmcgPSBwZW9wbGVEbUFkZFBlbmRpbmcoCiAgICAgICAgICB0YXJnZXRVc2VybmFtZSwKICAgICAgICAgIGJvZHkK
ICAgICAgICApOwoKICAgICAgICBpZiAocmVwbHlTbmFwc2hvdD8uaWQpIHsKICAgICAgICAgIHBlbmRpbmcubWVzc2FnZS5yZXBseVRvID0gewogICAgICAg
ICAgICBpZDogU3RyaW5nKHJlcGx5U25hcHNob3QuaWQgfHwgIiIpLAogICAgICAgICAgICB1c2VybmFtZTogcmVwbHlTbmFwc2hvdC51c2VybmFtZSwKICAg
ICAgICAgICAgdGV4dDogcmVwbHlTbmFwc2hvdC50ZXh0LAogICAgICAgICAgICBpbWFnZUlkOiByZXBseVNuYXBzaG90LmltYWdlSWQgfHwgbnVsbCwKICAg
ICAgICAgICAgZGVsZXRlZDogZmFsc2UKICAgICAgICAgIH07CiAgICAgICAgfQoKICAgICAgICBhd2FpdCB3aW5kb3cuUGVvcGxlT2ZmbGluZT8ucXVldWVE
bT8uKHsKICAgICAgICAgIHVzZXJuYW1lOiB0YXJnZXRVc2VybmFtZSwKICAgICAgICAgIHNlbmRlcklkOiBTdHJpbmcobWU/LmlkIHx8ICIiKSwKICAgICAg
ICAgIHJlY2lwaWVudElkOiBTdHJpbmcoYWN0aXZlRG1Vc2VyPy5pZCB8fCAiIiksCiAgICAgICAgICBib2R5LAogICAgICAgICAgcmVwbHlUb0lkLAogICAg
ICAgICAgcmVwbHlTbmFwc2hvdDogcGVuZGluZy5tZXNzYWdlLnJlcGx5VG8gfHwgbnVsbCwKICAgICAgICAgIGNsaWVudElkOiBwZW5kaW5nLmlkLAogICAg
ICAgICAgY3JlYXRlZEF0OiBEYXRlLm5vdygpCiAgICAgICAgfSk7CgogICAgICAgIGlmIChkbU1lc3NhZ2VzKSB7CiAgICAgICAgICBjb25zdCBidWlsdCA9
IGRtTWVzc2FnZUVsZW1lbnQocGVuZGluZy5tZXNzYWdlKTsKICAgICAgICAgIGJ1aWx0LnJvdy5kYXRhc2V0LnBlb3BsZURtUGVuZGluZ0lkID0gcGVuZGlu
Zy5pZDsKICAgICAgICAgIGJ1aWx0LnJvdy5jbGFzc0xpc3QuYWRkKCJwZW9wbGUtZG0tcGVuZGluZyIpOwogICAgICAgICAgZG1NZXNzYWdlcy5hcHBlbmRD
aGlsZChidWlsdC5yb3cpOwogICAgICAgICAgcGVvcGxlRG1TY3JvbGxUb0JvdHRvbSgpOwogICAgICAgIH0KCiAgICAgICAgZG1JbnB1dC52YWx1ZSA9ICIi
OwogICAgICAgIHBlb3BsZURtUmVwbHlDb250cm9sbGVyPy5jbGVhcigpOwogICAgICAgIGRtSW5wdXQuZm9jdXMoKTsKICAgICAgICByZXR1cm47CiAgICAg
IH0KCiAgICAgIC8qCiAgICAgICAgTGUgdGV4dGUgc2V1bCBlc3Qgb3B0aW1pc3RlIDoKICAgICAgICBvbiBsJ2FmZmljaGUgQVZBTlQgbGUgY2hpZmZyZW1l
bnQgRTJFRSBldCBBVkFOVCBsZSBQT1NULgogICAgICAgIExlcyBwacOoY2VzIGpvaW50ZXMgc29udCByZWdyb3Vww6llcyBzaSBuw6ljZXNzYWlyZSBwdWlz
IGNoaWZmcsOpZXMgRTJFRQogICAgICAgIGPDtHTDqSBuYXZpZ2F0ZXVyIEFWQU5UIGwndXBsb2FkIDsgbGUgc2VydmV1ciBuZSByZcOnb2l0IGphbWFpcyBs
ZXVyIGNvbnRlbnUgZW4gY2xhaXIuCiAgICAgICovCiAgICAgIGNvbnN0IG9wdGltaXN0aWMgPQogICAgICAgIEJvb2xlYW4oCiAgICAgICAgICBib2R5ICYm
CiAgICAgICAgICAhZmlsZXMubGVuZ3RoCiAgICAgICAgKTsKCiAgICAgIGNvbnN0IHBlbmRpbmcgPQogICAgICAgIG9wdGltaXN0aWMKICAgICAgICAgID8g
cGVvcGxlRG1BZGRQZW5kaW5nKAogICAgICAgICAgICAgIHRhcmdldFVzZXJuYW1lLAogICAgICAgICAgICAgIGJvZHkKICAgICAgICAgICAgKQogICAgICAg
ICAgOiBudWxsOwoKICAgICAgaWYgKAogICAgICAgIG9wdGltaXN0aWMgJiYKICAgICAgICBkbU1lc3NhZ2VzCiAgICAgICkgewogICAgICAgIGNvbnN0IGJ1
aWx0ID0KICAgICAgICAgIGRtTWVzc2FnZUVsZW1lbnQoCiAgICAgICAgICAgIHBlbmRpbmcubWVzc2FnZQogICAgICAgICAgKTsKCiAgICAgICAgYnVpbHQu
cm93LmRhdGFzZXQKICAgICAgICAgIC5wZW9wbGVEbVBlbmRpbmdJZCA9CiAgICAgICAgICBwZW5kaW5nLmlkOwoKICAgICAgICBidWlsdC5yb3cuY2xhc3NM
aXN0LmFkZCgKICAgICAgICAgICJwZW9wbGUtZG0tcGVuZGluZyIKICAgICAgICApOwoKICAgICAgICBkbU1lc3NhZ2VzLmFwcGVuZENoaWxkKAogICAgICAg
ICAgYnVpbHQucm93CiAgICAgICAgKTsKCiAgICAgICAgZG1JbnB1dC52YWx1ZSA9CiAgICAgICAgICAiIjsKCiAgICAgICAgcGVvcGxlRG1SZXBseUNvbnRy
b2xsZXIKICAgICAgICAgID8uY2xlYXIoKTsKCiAgICAgICAgcGVvcGxlRG1TY3JvbGxUb0JvdHRvbSgpOwogICAgICB9CgogICAgICBjb25zdCBzdWJtaXRC
dXR0b24gPQogICAgICAgIGRtRm9ybS5xdWVyeVNlbGVjdG9yKAogICAgICAgICAgJ2J1dHRvblt0eXBlPSJzdWJtaXQiXScKICAgICAgICApOwoKICAgICAg
LyoKICAgICAgICBQb3VyIGxlIHRleHRlIHNpbXBsZSBvbiBuZSBibG9xdWUgcGx1cyBsZSBjb21wb3NpdGV1ciA6CiAgICAgICAgbCd1dGlsaXNhdGV1ciBw
ZXV0IGTDqWrDoCB0YXBlciBsZSBtZXNzYWdlIHN1aXZhbnQuCiAgICAgICAgTCd1cGxvYWQgZGUgcGnDqGNlIGpvaW50ZSBjb25zZXJ2ZSBsZSB2ZXJyb3Vp
bGxhZ2UgYWN0dWVsLgogICAgICAqLwogICAgICBjb25zdCBsb2NrQ29tcG9zZXIgPQogICAgICAgIEJvb2xlYW4oZmlsZXMubGVuZ3RoKTsKCiAgICAgIGlm
IChsb2NrQ29tcG9zZXIpIHsKICAgICAgICBkbUlucHV0LmRpc2FibGVkID0KICAgICAgICAgIHRydWU7CgogICAgICAgIGlmIChzdWJtaXRCdXR0b24pIHsK
ICAgICAgICAgIHN1Ym1pdEJ1dHRvbi5kaXNhYmxlZCA9CiAgICAgICAgICAgIHRydWU7CiAgICAgICAgfQoKICAgICAgICBwZW9wbGVEbUltYWdlUGlja2Vy
CiAgICAgICAgICA/LnNldEJ1c3kodHJ1ZSk7CiAgICAgIH0KCiAgICAgIHRyeSB7CiAgICAgICAgbGV0IGltYWdlSWQgPQogICAgICAgICAgbnVsbDsKCiAg
ICAgICAgaWYgKGZpbGVzLmxlbmd0aCkgewogICAgICAgICAgY29uc3QgYXR0YWNobWVudFBheWxvYWQgPQogICAgICAgICAgICBhd2FpdCB3aW5kb3cKICAg
ICAgICAgICAgICAuUGVvcGxlUmljaENvbnRlbnQKICAgICAgICAgICAgICAucGFja0ZpbGVzKAogICAgICAgICAgICAgICAgZmlsZXMKICAgICAgICAgICAg
ICApOwoKICAgICAgICAgIGNvbnN0IGVuY3J5cHRlZEltYWdlID0KICAgICAgICAgICAgYXdhaXQgcGVvcGxlRG1FMmVlRW5jcnlwdEltYWdlKAogICAgICAg
ICAgICAgIGF0dGFjaG1lbnRQYXlsb2FkLAogICAgICAgICAgICAgIHRhcmdldFVzZXJuYW1lCiAgICAgICAgICAgICk7CgogICAgICAgICAgaW1hZ2VJZCA9
CiAgICAgICAgICAgIGF3YWl0IHdpbmRvdwogICAgICAgICAgICAgIC5QZW9wbGVSaWNoQ29udGVudAogICAgICAgICAgICAgIC51cGxvYWRJbWFnZVBheWxv
YWQoCiAgICAgICAgICAgICAgICBlbmNyeXB0ZWRJbWFnZSwKICAgICAgICAgICAgICAgIFBFT1BMRV9ETV9FMkVFX0lNQUdFX01JTUUKICAgICAgICAgICAg
ICApOwogICAgICAgIH0KCiAgICAgICAgY29uc3QgZW5jcnlwdGVkQm9keSA9CiAgICAgICAgICBib2R5CiAgICAgICAgICAgID8gYXdhaXQgcGVvcGxlRG1F
MmVlRW5jcnlwdFRleHQoCiAgICAgICAgICAgICAgICBib2R5LAogICAgICAgICAgICAgICAgdGFyZ2V0VXNlcm5hbWUKICAgICAgICAgICAgICApCiAgICAg
ICAgICAgIDogIiI7CgogICAgICAgIGF3YWl0IGFwaSgKICAgICAgICAgICIvYXBpL2RtLyIgKwogICAgICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoCiAg
ICAgICAgICAgICAgdGFyZ2V0VXNlcm5hbWUKICAgICAgICAgICAgKSwKICAgICAgICAgIHsKICAgICAgICAgICAgbWV0aG9kOgogICAgICAgICAgICAgICJQ
T1NUIiwKICAgICAgICAgICAgYm9keToKICAgICAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7CiAgICAgICAgICAgICAgICBib2R5OgogICAgICAgICAgICAg
ICAgICBlbmNyeXB0ZWRCb2R5LAogICAgICAgICAgICAgICAgaW1hZ2VJZCwKICAgICAgICAgICAgICAgIHJlcGx5VG9JZAogICAgICAgICAgICAgIH0pCiAg
ICAgICAgICB9CiAgICAgICAgKTsKCiAgICAgICAgaWYgKCFwZW5kaW5nKSB7CiAgICAgICAgICBkbUlucHV0LnZhbHVlID0KICAgICAgICAgICAgIiI7Cgog
ICAgICAgICAgcGVvcGxlRG1JbWFnZVBpY2tlcgogICAgICAgICAgICA/LmNsZWFyKCk7CgogICAgICAgICAgcGVvcGxlRG1SZXBseUNvbnRyb2xsZXIKICAg
ICAgICAgICAgPy5jbGVhcigpOwogICAgICAgIH0KCiAgICAgICAgaWYgKAogICAgICAgICAgYWN0aXZlRG1Vc2VyPy51c2VybmFtZSA9PT0KICAgICAgICAg
IHRhcmdldFVzZXJuYW1lCiAgICAgICAgKSB7CiAgICAgICAgICBhd2FpdCBsb2FkQWN0aXZlRG0oCiAgICAgICAgICAgIHBlbmRpbmcKICAgICAgICAgICAg
ICA/IHsKICAgICAgICAgICAgICAgICAgc2tpcENhY2hlOiB0cnVlLAogICAgICAgICAgICAgICAgICBzZXR0bGVQZW5kaW5nSWQ6CiAgICAgICAgICAgICAg
ICAgICAgcGVuZGluZy5pZAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgIDogbnVsbAogICAgICAgICAgKTsKICAgICAgICB9IGVsc2UgewogICAg
ICAgICAgLyoKICAgICAgICAgICAgU2kgbCd1dGlsaXNhdGV1ciBhIGNoYW5nw6kgZGUgTVAgZW50cmUtdGVtcHMsIGlsIG4neSBhIHBsdXMKICAgICAgICAg
ICAgZGUgRE9NIMOgIHByw6lzZXJ2ZXIgcG91ciBjZXR0ZSBjb252ZXJzYXRpb24uIExlIFBPU1Qgw6l0YW50CiAgICAgICAgICAgIGNvbmZpcm3DqSwgb24g
cGV1dCByZXRpcmVyIGwnZW50csOpZSBwZW5kaW5nIG5vcm1hbGVtZW50LgogICAgICAgICAgKi8KICAgICAgICAgIGlmIChwZW5kaW5nKSB7CiAgICAgICAg
ICAgIHBlb3BsZURtUmVtb3ZlUGVuZGluZygKICAgICAgICAgICAgICBwZW5kaW5nLmlkCiAgICAgICAgICAgICk7CiAgICAgICAgICB9CgogICAgICAgICAg
dm9pZCByZWZyZXNoQ29udmVyc2F0aW9ucygpOwogICAgICAgIH0KICAgICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgICAgaWYgKHBlbmRpbmcpIHsKICAgICAg
ICAgIHBlb3BsZURtUmVtb3ZlUGVuZGluZygKICAgICAgICAgICAgcGVuZGluZy5pZAogICAgICAgICAgKTsKCiAgICAgICAgICBwZW9wbGVEbVJlbW92ZVBl
bmRpbmdFbGVtZW50KAogICAgICAgICAgICBwZW5kaW5nLmlkCiAgICAgICAgICApOwoKICAgICAgICAgIC8qCiAgICAgICAgICAgIE5lIGphbWFpcyDDqWNy
YXNlciB1biBub3V2ZWF1IGJyb3VpbGxvbiBxdWUgbCd1dGlsaXNhdGV1cgogICAgICAgICAgICBhdXJhaXQgY29tbWVuY8OpIHBlbmRhbnQgbCdlbnZvaS4K
ICAgICAgICAgICovCiAgICAgICAgICBpZiAoCiAgICAgICAgICAgIGFjdGl2ZURtVXNlcj8udXNlcm5hbWUgPT09CiAgICAgICAgICAgICAgdGFyZ2V0VXNl
cm5hbWUgJiYKICAgICAgICAgICAgZG1JbnB1dCAmJgogICAgICAgICAgICAhU3RyaW5nKAogICAgICAgICAgICAgIGRtSW5wdXQudmFsdWUgfHwgIiIKICAg
ICAgICAgICAgKQogICAgICAgICAgKSB7CiAgICAgICAgICAgIGRtSW5wdXQudmFsdWUgPQogICAgICAgICAgICAgIGJvZHk7CgogICAgICAgICAgICBpZiAo
CiAgICAgICAgICAgICAgcmVwbHlTbmFwc2hvdD8uaWQKICAgICAgICAgICAgKSB7CiAgICAgICAgICAgICAgcGVvcGxlRG1SZXBseUNvbnRyb2xsZXIKICAg
ICAgICAgICAgICAgID8uc2V0Py4oCiAgICAgICAgICAgICAgICAgIHJlcGx5U25hcHNob3QKICAgICAgICAgICAgICAgICk7CiAgICAgICAgICAgIH0KICAg
ICAgICAgIH0KICAgICAgICB9CgogICAgICAgIGFsZXJ0KAogICAgICAgICAgZXJyLm1lc3NhZ2UKICAgICAgICApOwogICAgICB9IGZpbmFsbHkgewogICAg
ICAgIGlmIChsb2NrQ29tcG9zZXIpIHsKICAgICAgICAgIGRtSW5wdXQuZGlzYWJsZWQgPQogICAgICAgICAgICBmYWxzZTsKCiAgICAgICAgICBpZiAoc3Vi
bWl0QnV0dG9uKSB7CiAgICAgICAgICAgIHN1Ym1pdEJ1dHRvbi5kaXNhYmxlZCA9CiAgICAgICAgICAgICAgZmFsc2U7CiAgICAgICAgICB9CgogICAgICAg
ICAgcGVvcGxlRG1JbWFnZVBpY2tlcgogICAgICAgICAgICA/LnNldEJ1c3koZmFsc2UpOwogICAgICAgIH0KCiAgICAgICAgaWYgKAogICAgICAgICAgYWN0
aXZlRG1Vc2VyPy51c2VybmFtZSA9PT0KICAgICAgICAgIHRhcmdldFVzZXJuYW1lCiAgICAgICAgKSB7CiAgICAgICAgICBkbUlucHV0LmZvY3VzKCk7CiAg
ICAgICAgfQogICAgICB9CiAgICB9CiAgKTsKCiAgcGVvcGxlU2VhcmNoSW5wdXQ/LmFkZEV2ZW50TGlzdGVuZXIoCiAgICAiaW5wdXQiLAogICAgKCkgPT4g
ewogICAgICBjbGVhclRpbWVvdXQoZGlyZWN0b3J5VGltZXIpOwoKICAgICAgZGlyZWN0b3J5VGltZXIgPSBzZXRUaW1lb3V0KAogICAgICAgICgpID0+CiAg
ICAgICAgICByZWZyZXNoRGlyZWN0b3J5KAogICAgICAgICAgICBwZW9wbGVTZWFyY2hJbnB1dC52YWx1ZQogICAgICAgICAgKSwKICAgICAgICAxODAKICAg
ICAgKTsKICAgIH0KICApOwoKICBwcm9maWxlTW9kYWxDbG9zZT8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJjbGljayIsCiAgICBjbG9zZVByb2ZpbGUKICAp
OwoKICBwcm9maWxlTW9kYWw/LmFkZEV2ZW50TGlzdGVuZXIoCiAgICAiY2xpY2siLAogICAgKGV2ZW50KSA9PiB7CiAgICAgIGlmICgKICAgICAgICBldmVu
dC50YXJnZXQ/LmRhdGFzZXQ/LnByb2ZpbGVDbG9zZSA9PT0gIjEiCiAgICAgICkgewogICAgICAgIGNsb3NlUHJvZmlsZSgpOwogICAgICB9CiAgICB9CiAg
KTsKCiAgcHJvZmlsZUF2YXRhclVwbG9hZEJ1dHRvbj8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJjbGljayIsCiAgICAoKSA9PiB7CiAgICAgIGlmIChjdXJy
ZW50UHJvZmlsZT8uaXNTZWxmKSB7CiAgICAgICAgcHJvZmlsZUF2YXRhcklucHV0Py5jbGljaygpOwogICAgICB9CiAgICB9CiAgKTsKCiAgcHJvZmlsZUF2
YXRhcklucHV0Py5hZGRFdmVudExpc3RlbmVyKAogICAgImNoYW5nZSIsCiAgICBhc3luYyAoKSA9PiB7CiAgICAgIGNvbnN0IGZpbGUgPQogICAgICAgIHBy
b2ZpbGVBdmF0YXJJbnB1dC5maWxlcz8uWzBdOwoKICAgICAgaWYgKCFmaWxlKSByZXR1cm47CgogICAgICAgIGNvbnN0IGFjY2VwdGVkID0KICAgICAgICAg
IFBFT1BMRV9BVkFUQVJfQUNDRVBURURfVFlQRVM7CgogICAgICBpZiAoIWFjY2VwdGVkLmhhcyhmaWxlLnR5cGUpKSB7CiAgICAgICAgYWxlcnQoCiAgICAg
ICAgICAiRm9ybWF0IG5vbiBhY2NlcHTDqS4gSlBFRywgUE5HLCBXZWJQIG91IEdJRiB1bmlxdWVtZW50LiIKICAgICAgICApOwoKICAgICAgICBwcm9maWxl
QXZhdGFySW5wdXQudmFsdWUgPSAiIjsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGlmICgKICAgICAgICBmaWxlLnNpemUgPD0gMCB8fAogICAg
ICAgIGZpbGUuc2l6ZSA+CiAgICAgICAgICAyNSAqIDEwMjQgKiAxMDI0CiAgICAgICkgewogICAgICAgIGFsZXJ0KAogICAgICAgICAgIkwnaW1hZ2Ugc291
cmNlIGRvaXQgZmFpcmUgbW9pbnMgZGUgMjUgTW8uIgogICAgICAgICk7CgogICAgICAgIHByb2ZpbGVBdmF0YXJJbnB1dC52YWx1ZSA9ICIiOwogICAgICAg
IHJldHVybjsKICAgICAgfQoKICAgICAgdHJ5IHsKICAgICAgICBwcm9maWxlQXZhdGFyVXBsb2FkQnV0dG9uLmRpc2FibGVkID0gdHJ1ZTsKICAgICAgICBw
cm9maWxlQXZhdGFyVXBsb2FkQnV0dG9uLnRleHRDb250ZW50ID0KICAgICAgICAgICJSZWNhZHJhZ2UuLi4iOwoKICAgICAgICBjb25zdCBjcm9wcGVkID0K
ICAgICAgICAgIGF3YWl0IHdpbmRvdwogICAgICAgICAgICAuUGVvcGxlQXZhdGFyQ3JvcHBlcgogICAgICAgICAgICA/Lm9wZW4oZmlsZSk7CgogICAgICAg
IGlmICghY3JvcHBlZCkgewogICAgICAgICAgcHJvZmlsZUF2YXRhclVwbG9hZEJ1dHRvbi50ZXh0Q29udGVudCA9CiAgICAgICAgICAgICJDaGFuZ2VyIGxh
IHBob3RvIjsKCiAgICAgICAgICByZXR1cm47CiAgICAgICAgfQoKICAgICAgICBwcm9maWxlQXZhdGFyVXBsb2FkQnV0dG9uLnRleHRDb250ZW50ID0KICAg
ICAgICAgICJDb21wcmVzc2lvbiBmb3J0ZS4uLiI7CgogICAgICAgIGNvbnN0IHByZXBhcmVkID0KICAgICAgICAgIGF3YWl0IHdpbmRvdwogICAgICAgICAg
ICAuUGVvcGxlQXZhdGFyVWx0cmEKICAgICAgICAgICAgPy5wcmVwYXJlKAogICAgICAgICAgICAgIGNyb3BwZWQKICAgICAgICAgICAgKTsKCiAgICAgICAg
aWYgKAogICAgICAgICAgIXByZXBhcmVkPy5iYXNlNjQgfHwKICAgICAgICAgICFwcmVwYXJlZD8uYmxvYgogICAgICAgICkgewogICAgICAgICAgdGhyb3cg
bmV3IEVycm9yKAogICAgICAgICAgICAiTGEgY29tcHJlc3Npb24gZGUgbGEgUFAgYSDDqWNob3XDqS4iCiAgICAgICAgICApOwogICAgICAgIH0KCiAgICAg
ICAgY29uc3Qga2IgPQogICAgICAgICAgTWF0aC5tYXgoCiAgICAgICAgICAgIDEsCiAgICAgICAgICAgIE1hdGgucm91bmQoCiAgICAgICAgICAgICAgcHJl
cGFyZWQuYmxvYi5zaXplIC8KICAgICAgICAgICAgICAxMDI0CiAgICAgICAgICAgICkKICAgICAgICAgICk7CgogICAgICAgIHByb2ZpbGVBdmF0YXJVcGxv
YWRCdXR0b24udGV4dENvbnRlbnQgPQogICAgICAgICAgIkVudm9pIOKAoiAiICsKICAgICAgICAgIGtiICsKICAgICAgICAgICIgS28uLi4iOwoKICAgICAg
ICBjb25zdCByZXNwb25zZSA9CiAgICAgICAgICBhd2FpdCBmZXRjaCgKICAgICAgICAgICAgIi9hcGkvcHJvZmlsZS9hdmF0YXItdWx0cmEiLAogICAgICAg
ICAgICB7CiAgICAgICAgICAgICAgbWV0aG9kOiAiUFVUIiwKICAgICAgICAgICAgICBjcmVkZW50aWFsczoKICAgICAgICAgICAgICAgICJzYW1lLW9yaWdp
biIsCiAgICAgICAgICAgICAgaGVhZGVyczogewogICAgICAgICAgICAgICAgIkNvbnRlbnQtVHlwZSI6CiAgICAgICAgICAgICAgICAgICJhcHBsaWNhdGlv
bi9qc29uIgogICAgICAgICAgICAgIH0sCiAgICAgICAgICAgICAgYm9keToKICAgICAgICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHsKICAgICAgICAgICAg
ICAgICAgZGF0YToKICAgICAgICAgICAgICAgICAgICBwcmVwYXJlZC5iYXNlNjQKICAgICAgICAgICAgICAgIH0pCiAgICAgICAgICAgIH0KICAgICAgICAg
ICk7CgogICAgICAgIGxldCBkYXRhID0gbnVsbDsKCiAgICAgICAgdHJ5IHsKICAgICAgICAgIGRhdGEgPQogICAgICAgICAgICBhd2FpdCByZXNwb25zZS5q
c29uKCk7CiAgICAgICAgfSBjYXRjaCB7fQoKICAgICAgICBpZiAoCiAgICAgICAgICAhcmVzcG9uc2Uub2sgfHwKICAgICAgICAgIGRhdGE/Lm9rID09PSBm
YWxzZQogICAgICAgICkgewogICAgICAgICAgdGhyb3cgbmV3IEVycm9yKAogICAgICAgICAgICBkYXRhPy5lcnJvciB8fAogICAgICAgICAgICAiSW1wb3Nz
aWJsZSBkZSBjaGFuZ2VyIGxhIHBob3RvLiIKICAgICAgICAgICk7CiAgICAgICAgfQoKICAgICAgICBpZiAoCiAgICAgICAgICBkYXRhPy5hdmF0YXJEYXRh
VXJsCiAgICAgICAgKSB7CiAgICAgICAgICB3aW5kb3cuUGVvcGxlQXZhdGFycwogICAgICAgICAgICA/LmFwcGx5RGF0YVVybEV2ZXJ5d2hlcmUoCiAgICAg
ICAgICAgICAgY3VycmVudFByb2ZpbGUudXNlcm5hbWUsCiAgICAgICAgICAgICAgZGF0YS5hdmF0YXJEYXRhVXJsCiAgICAgICAgICAgICk7CgogICAgICAg
ICAgd2luZG93LlBlb3BsZUF2YXRhcnMKICAgICAgICAgICAgPy5hcHBseURhdGFVcmxUb0VsZW1lbnQoCiAgICAgICAgICAgICAgcHJvZmlsZU1vZGFsQXZh
dGFyLAogICAgICAgICAgICAgIGN1cnJlbnRQcm9maWxlLnVzZXJuYW1lLAogICAgICAgICAgICAgIGRhdGEuYXZhdGFyRGF0YVVybAogICAgICAgICAgICAp
OwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICB3aW5kb3cuUGVvcGxlQXZhdGFyVWx0cmEKICAgICAgICAgICAgPy5hcHBseVByZXZpZXcoCiAgICAgICAg
ICAgICAgY3VycmVudFByb2ZpbGUudXNlcm5hbWUsCiAgICAgICAgICAgICAgcHJlcGFyZWQuYmxvYgogICAgICAgICAgICApOwogICAgICAgIH0KCiAgICAg
ICAgcHJvZmlsZUF2YXRhclVwbG9hZEJ1dHRvbi50ZXh0Q29udGVudCA9CiAgICAgICAgICAiUGhvdG8gZW5yZWdpc3Ryw6llIOKAoiAiICsKICAgICAgICAg
IGtiICsKICAgICAgICAgICIgS28g4pyTIjsKCiAgICAgICAgc2V0VGltZW91dCgKICAgICAgICAgICgpID0+IHsKICAgICAgICAgICAgcHJvZmlsZUF2YXRh
clVwbG9hZEJ1dHRvbi50ZXh0Q29udGVudCA9CiAgICAgICAgICAgICAgIkNoYW5nZXIgbGEgcGhvdG8iOwogICAgICAgICAgfSwKICAgICAgICAgIDE2MDAK
ICAgICAgICApOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBjb25zb2xlLmVycm9yKAogICAgICAgICAgIltQZW9wbGUgUFAgdWx0cmFdIiwKICAg
ICAgICAgIGVycgogICAgICAgICk7CgogICAgICAgIGFsZXJ0KAogICAgICAgICAgZXJyPy5tZXNzYWdlIHx8CiAgICAgICAgICAiSW1wb3NzaWJsZSBkJ2Vu
dm95ZXIgbGEgcGhvdG8uIgogICAgICAgICk7CgogICAgICAgIHByb2ZpbGVBdmF0YXJVcGxvYWRCdXR0b24udGV4dENvbnRlbnQgPQogICAgICAgICAgIkNo
YW5nZXIgbGEgcGhvdG8iOwogICAgICB9IGZpbmFsbHkgewogICAgICAgIHByb2ZpbGVBdmF0YXJVcGxvYWRCdXR0b24uZGlzYWJsZWQgPSBmYWxzZTsKICAg
ICAgICBwcm9maWxlQXZhdGFySW5wdXQudmFsdWUgPSAiIjsKICAgICAgfQogICAgfQogICk7CgogIHByb2ZpbGVEZXNjcmlwdGlvbklucHV0Py5hZGRFdmVu
dExpc3RlbmVyKAogICAgImlucHV0IiwKICAgICgpID0+IHsKICAgICAgcHJvZmlsZURlc2NyaXB0aW9uQ291bnQudGV4dENvbnRlbnQgPQogICAgICAgIFN0
cmluZyhwcm9maWxlRGVzY3JpcHRpb25JbnB1dC52YWx1ZS5sZW5ndGgpOwogICAgfQogICk7CgogIHByb2ZpbGVTYXZlQnV0dG9uPy5hZGRFdmVudExpc3Rl
bmVyKAogICAgImNsaWNrIiwKICAgIGFzeW5jICgpID0+IHsKICAgICAgdHJ5IHsKICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgYXBpKAogICAgICAgICAg
Ii9hcGkvcHJvZmlsZS9tZSIsCiAgICAgICAgICB7CiAgICAgICAgICAgIG1ldGhvZDogIlBVVCIsCiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5
KHsKICAgICAgICAgICAgICBkZXNjcmlwdGlvbjoKICAgICAgICAgICAgICAgIHByb2ZpbGVEZXNjcmlwdGlvbklucHV0LnZhbHVlCiAgICAgICAgICAgIH0p
CiAgICAgICAgICB9CiAgICAgICAgKTsKCiAgICAgICAgY3VycmVudFByb2ZpbGUgPSBkYXRhLnByb2ZpbGU7CgogICAgICAgIHByb2ZpbGVEZXNjcmlwdGlv
blRleHQudGV4dENvbnRlbnQgPQogICAgICAgICAgY3VycmVudFByb2ZpbGUuZGVzY3JpcHRpb24gfHwKICAgICAgICAgICJBdWN1bmUgZGVzY3JpcHRpb24u
IjsKCiAgICAgICAgcHJvZmlsZURlc2NyaXB0aW9uQ291bnQudGV4dENvbnRlbnQgPQogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBjdXJyZW50UHJv
ZmlsZS5kZXNjcmlwdGlvbi5sZW5ndGgKICAgICAgICAgICk7CgogICAgICAgIHByb2ZpbGVTYXZlQnV0dG9uLnRleHRDb250ZW50ID0KICAgICAgICAgICJF
bnJlZ2lzdHLDqSDinJMiOwoKICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHsKICAgICAgICAgIHByb2ZpbGVTYXZlQnV0dG9uLnRleHRDb250ZW50ID0KICAg
ICAgICAgICAgIkVucmVnaXN0cmVyIjsKICAgICAgICB9LCAxMjAwKTsKCiAgICAgICAgcmVmcmVzaERpcmVjdG9yeSgKICAgICAgICAgIHBlb3BsZVNlYXJj
aElucHV0Py52YWx1ZSB8fCAiIgogICAgICAgICk7CiAgICAgIH0gY2F0Y2ggKGVycikgewogICAgICAgIGFsZXJ0KGVyci5tZXNzYWdlKTsKICAgICAgfQog
ICAgfQogICk7CgogIHByb2ZpbGVEbUJ1dHRvbj8uYWRkRXZlbnRMaXN0ZW5lcigKICAgICJjbGljayIsCiAgICAoKSA9PiB7CiAgICAgIGNvbnN0IHVzZXJu
YW1lID0KICAgICAgICBjdXJyZW50UHJvZmlsZT8udXNlcm5hbWU7CgogICAgICBjbG9zZVByb2ZpbGUoKTsKCiAgICAgIGlmICh1c2VybmFtZSkgewogICAg
ICAgIG9wZW5EbSh1c2VybmFtZSk7CiAgICAgIH0KICAgIH0KICApOwoKICBwcm9maWxlRnJpZW5kQnV0dG9uPy5hZGRFdmVudExpc3RlbmVyKAogICAgImNs
aWNrIiwKICAgIGFzeW5jICgpID0+IHsKICAgICAgaWYgKAogICAgICAgICFjdXJyZW50UHJvZmlsZT8udXNlcm5hbWUgfHwKICAgICAgICBwcm9maWxlRnJp
ZW5kQnV0dG9uLmRpc2FibGVkCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgdHJ5IHsKICAgICAgICBpZiAoY3VycmVudFByb2Zp
bGUuaXNGcmllbmQpIHsKICAgICAgICAgIGF3YWl0IGFwaSgKICAgICAgICAgICAgIi9hcGkvc29jaWFsL2ZyaWVuZHMvIiArCiAgICAgICAgICAgICAgZW5j
b2RlVVJJQ29tcG9uZW50KAogICAgICAgICAgICAgICAgY3VycmVudFByb2ZpbGUudXNlcm5hbWUKICAgICAgICAgICAgICApLAogICAgICAgICAgICB7IG1l
dGhvZDogIkRFTEVURSIgfQogICAgICAgICAgKTsKICAgICAgICB9IGVsc2UgaWYgKAogICAgICAgICAgY3VycmVudFByb2ZpbGUuZnJpZW5kUmVxdWVzdCA9
PT0KICAgICAgICAgICAgImluY29taW5nIiAmJgogICAgICAgICAgY3VycmVudFByb2ZpbGUuZnJpZW5kUmVxdWVzdElkCiAgICAgICAgKSB7CiAgICAgICAg
ICBhd2FpdCBhcGkoCiAgICAgICAgICAgICIvYXBpL3NvY2lhbC9mcmllbmQtcmVxdWVzdHMvIiArCiAgICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50
KAogICAgICAgICAgICAgICAgY3VycmVudFByb2ZpbGUuZnJpZW5kUmVxdWVzdElkCiAgICAgICAgICAgICAgKSArCiAgICAgICAgICAgICAgIi9hY2NlcHQi
LAogICAgICAgICAgICB7IG1ldGhvZDogIlBPU1QiIH0KICAgICAgICAgICk7CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIGF3YWl0IGFwaSgKICAgICAg
ICAgICAgIi9hcGkvc29jaWFsL2ZyaWVuZHMvIiArCiAgICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KAogICAgICAgICAgICAgICAgY3VycmVudFBy
b2ZpbGUudXNlcm5hbWUKICAgICAgICAgICAgICApLAogICAgICAgICAgICB7IG1ldGhvZDogIlBPU1QiIH0KICAgICAgICAgICk7CiAgICAgICAgfQoKICAg
ICAgICBjb25zdCB1c2VybmFtZSA9CiAgICAgICAgICBjdXJyZW50UHJvZmlsZS51c2VybmFtZTsKCiAgICAgICAgYXdhaXQgcmVmcmVzaEZyaWVuZFN1cmZh
Y2VzKCk7CiAgICAgICAgYXdhaXQgb3BlblByb2ZpbGUodXNlcm5hbWUpOwogICAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBhbGVydChlcnIubWVzc2Fn
ZSk7CiAgICAgICAgYXdhaXQgcmVmcmVzaEZyaWVuZFN1cmZhY2VzKCk7CiAgICAgIH0KICAgIH0KICApOwoKICBhdmF0YXJCdXR0b24/LmFkZEV2ZW50TGlz
dGVuZXIoCiAgICAiY2xpY2siLAogICAgKCkgPT4gewogICAgICBjb25zdCB1c2VybmFtZSA9CiAgICAgICAgbWU/LnVzZXJuYW1lIHx8CiAgICAgICAgZG9j
dW1lbnQuZ2V0RWxlbWVudEJ5SWQoInByb2ZpbGVOYW1lIikKICAgICAgICAgID8udGV4dENvbnRlbnQ7CgogICAgICBpZiAodXNlcm5hbWUgJiYgdXNlcm5h
bWUgIT09ICJJbnZpdMOpIikgewogICAgICAgIG9wZW5Qcm9maWxlKHVzZXJuYW1lKTsKICAgICAgfQogICAgfQogICk7CgogIHByb2ZpbGVJbmZvQnV0dG9u
Py5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgICgpID0+IHsKICAgICAgY29uc3QgdXNlcm5hbWUgPQogICAgICAgIG1lPy51c2VybmFtZSB8
fAogICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwcm9maWxlTmFtZSIpCiAgICAgICAgICA/LnRleHRDb250ZW50OwoKICAgICAgaWYgKHVzZXJu
YW1lICYmIHVzZXJuYW1lICE9PSAiSW52aXTDqSIpIHsKICAgICAgICBvcGVuUHJvZmlsZSh1c2VybmFtZSk7CiAgICAgIH0KICAgIH0KICApOwoKICBkb2N1
bWVudC5hZGRFdmVudExpc3RlbmVyKCJjbGljayIsIChldmVudCkgPT4gewogICAgY29uc3Qgcm93ID0gZXZlbnQudGFyZ2V0LmNsb3Nlc3QoCiAgICAgICIu
b25saW5lLXVzZXItcm93IgogICAgKTsKCiAgICBpZiAoCiAgICAgIHJvdz8uZGF0YXNldD8udXNlcm5hbWUgJiYKICAgICAgcm93LmRhdGFzZXQudXNlcm5h
bWUgIT09IG1lPy51c2VybmFtZQogICAgKSB7CiAgICAgIG9wZW5Qcm9maWxlKHJvdy5kYXRhc2V0LnVzZXJuYW1lKTsKICAgIH0KICB9KTsKCiAgd2luZG93
LmFkZEV2ZW50TGlzdGVuZXIoCiAgICAicGVvcGxlLWF1dGhlbnRpY2F0ZWQiLAogICAgKGV2ZW50KSA9PiB7CiAgICAgIGJvb3RzdHJhcFNvY2lhbChldmVu
dC5kZXRhaWwgfHwgbnVsbCk7CiAgICB9CiAgKTsKCiAgLy8gPT09IFBFT1BMRV9PRkZMSU5FX0RNX1NFTkRFUl9WMV9TVEFSVCA9PT0KICB3aW5kb3cuUGVv
cGxlT2ZmbGluZT8ucmVnaXN0ZXJEbVNlbmRlcj8uKAogICAgYXN5bmMgKHBheWxvYWQpID0+IHsKICAgICAgY29uc3QgdGFyZ2V0VXNlcm5hbWUgPSBTdHJp
bmcocGF5bG9hZD8udXNlcm5hbWUgfHwgIiIpLnRyaW0oKTsKICAgICAgaWYgKCF0YXJnZXRVc2VybmFtZSkgewogICAgICAgIHRocm93IG5ldyBFcnJvcigi
Q29udmVyc2F0aW9uIHByaXbDqWUgaW50cm91dmFibGUuIik7CiAgICAgIH0KCiAgICAgIGNvbnN0IGVuY3J5cHRlZEJvZHkgPSBwYXlsb2FkPy5ib2R5CiAg
ICAgICAgPyBhd2FpdCBwZW9wbGVEbUUyZWVFbmNyeXB0VGV4dChwYXlsb2FkLmJvZHksIHRhcmdldFVzZXJuYW1lKQogICAgICAgIDogIiI7CgogICAgICBy
ZXR1cm4gYXBpKAogICAgICAgICIvYXBpL2RtLyIgKyBlbmNvZGVVUklDb21wb25lbnQodGFyZ2V0VXNlcm5hbWUpLAogICAgICAgIHsKICAgICAgICAgIG1l
dGhvZDogIlBPU1QiLAogICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoewogICAgICAgICAgICBib2R5OiBlbmNyeXB0ZWRCb2R5LAogICAgICAgICAg
ICBpbWFnZUlkOiBudWxsLAogICAgICAgICAgICByZXBseVRvSWQ6IHBheWxvYWQ/LnJlcGx5VG9JZCB8fCBudWxsCiAgICAgICAgICB9KQogICAgICAgIH0K
ICAgICAgKTsKICAgIH0KICApOwoKICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcigKICAgICJwZW9wbGUtb2ZmbGluZS1tZXNzYWdlLXNlbnQiLAogICAgKGV2
ZW50KSA9PiB7CiAgICAgIGlmIChldmVudC5kZXRhaWw/LnR5cGUgIT09ICJkbSIpIHJldHVybjsKICAgICAgY29uc3QgdGFyZ2V0ID0gU3RyaW5nKGV2ZW50
LmRldGFpbD8ucGF5bG9hZD8udXNlcm5hbWUgfHwgIiIpOwogICAgICBjb25zdCBwZW5kaW5nSWQgPSBTdHJpbmcoZXZlbnQuZGV0YWlsPy5wYXlsb2FkPy5j
bGllbnRJZCB8fCBldmVudC5kZXRhaWw/LmlkIHx8ICIiKTsKICAgICAgcGVvcGxlRG1SZW1vdmVQZW5kaW5nKHBlbmRpbmdJZCk7CiAgICAgIHBlb3BsZURt
UmVtb3ZlUGVuZGluZ0VsZW1lbnQocGVuZGluZ0lkKTsKICAgICAgaWYgKAogICAgICAgIGFjdGl2ZURtVXNlcj8udXNlcm5hbWUgJiYKICAgICAgICBwZW9w
bGVEbVVzZXJuYW1lS2V5KGFjdGl2ZURtVXNlci51c2VybmFtZSkgPT09IHBlb3BsZURtVXNlcm5hbWVLZXkodGFyZ2V0KQogICAgICApIHsKICAgICAgICB2
b2lkIGxvYWRBY3RpdmVEbSh7IHNraXBDYWNoZTogdHJ1ZSB9KTsKICAgICAgfSBlbHNlIHsKICAgICAgICB2b2lkIHJlZnJlc2hDb252ZXJzYXRpb25zKCk7
CiAgICAgIH0KICAgIH0KICApOwogIC8vID09PSBQRU9QTEVfT0ZGTElORV9ETV9TRU5ERVJfVjFfRU5EID09PQoKICAvLyA9PT0gUEVPUExFX0RNX01FTlRJ
T05fUElOR19WMl9TVEFSVCA9PT0KICBsZXQgcGVvcGxlRG1QaW5nQXVkaW9Db250ZXh0ID0gbnVsbDsKCiAgZnVuY3Rpb24gcGVvcGxlRG1Fc2NhcGVSZWdl
eCh2YWx1ZSkgewogICAgcmV0dXJuIFN0cmluZyh2YWx1ZSkucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xdXFxdL2csICJcXCQmIik7CiAgfQoKICBmdW5jdGlv
biBwZW9wbGVEbU1lbnRpb25zTWUodGV4dCkgewogICAgY29uc3QgdXNlcm5hbWUgPSBTdHJpbmcobWU/LnVzZXJuYW1lIHx8ICIiKS50cmltKCk7CiAgICBp
ZiAoIXVzZXJuYW1lIHx8ICF0ZXh0KSByZXR1cm4gZmFsc2U7CgogICAgY29uc3QgZXNjYXBlZCA9IHBlb3BsZURtRXNjYXBlUmVnZXgodXNlcm5hbWUpOwog
ICAgY29uc3QgbWVudGlvbiA9IG5ldyBSZWdFeHAoCiAgICAgICIoXnxcXHMpQCIgKyBlc2NhcGVkICsgIig/PSR8XFxzfFsuLCE/OzpdKSIsCiAgICAgICJp
IgogICAgKTsKCiAgICByZXR1cm4gbWVudGlvbi50ZXN0KFN0cmluZyh0ZXh0KSk7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbVVubG9ja1BpbmdBdWRpbygp
IHsKICAgIHRyeSB7CiAgICAgIGlmICghcGVvcGxlRG1QaW5nQXVkaW9Db250ZXh0KSB7CiAgICAgICAgY29uc3QgQXVkaW9DdHggPQogICAgICAgICAgd2lu
ZG93LkF1ZGlvQ29udGV4dCB8fAogICAgICAgICAgd2luZG93LndlYmtpdEF1ZGlvQ29udGV4dDsKCiAgICAgICAgaWYgKEF1ZGlvQ3R4KSB7CiAgICAgICAg
ICBwZW9wbGVEbVBpbmdBdWRpb0NvbnRleHQgPSBuZXcgQXVkaW9DdHgoKTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIGlmIChwZW9wbGVEbVBpbmdBdWRp
b0NvbnRleHQ/LnN0YXRlID09PSAic3VzcGVuZGVkIikgewogICAgICAgIHBlb3BsZURtUGluZ0F1ZGlvQ29udGV4dC5yZXN1bWUoKS5jYXRjaCgoKSA9PiB7
fSk7CiAgICAgIH0KICAgIH0gY2F0Y2gge30KICB9CgogIGZ1bmN0aW9uIHBlb3BsZURtUGxheVBpbmcoZm9yY2VkU291bmQgPSAiIikgewogICAgLy8gPT09
IFBFT1BMRV9OT1RJRklDQVRJT05fUFJFRlNfVjFfU09VTkRfU1RBUlQgPT09CiAgICBpZiAoZm9yY2VkU291bmQgPT09ICJzaWxlbnQiKSB7CiAgICAgIHJl
dHVybjsKICAgIH0KCiAgICBpZiAoCiAgICAgIHdpbmRvdy5QZW9wbGVTb3VuZHMKICAgICAgICA/LnBsYXlOb3RpZmljYXRpb24/LigKICAgICAgICAgIGZv
cmNlZFNvdW5kID09PSAiaW5oZXJpdCIKICAgICAgICAgICAgPyAiIgogICAgICAgICAgICA6IGZvcmNlZFNvdW5kCiAgICAgICAgKQogICAgKSB7CiAgICAg
IHJldHVybjsKICAgIH0KICAgIC8vID09PSBQRU9QTEVfTk9USUZJQ0FUSU9OX1BSRUZTX1YxX1NPVU5EX0VORCA9PT0KCiAgICB0cnkgewogICAgICBwZW9w
bGVEbVVubG9ja1BpbmdBdWRpbygpOwogICAgICBpZiAoIXBlb3BsZURtUGluZ0F1ZGlvQ29udGV4dCkgcmV0dXJuOwoKICAgICAgY29uc3Qgbm93ID0gcGVv
cGxlRG1QaW5nQXVkaW9Db250ZXh0LmN1cnJlbnRUaW1lOwoKICAgICAgY29uc3QgYmVlcCA9IChzdGFydCwgZnJlcXVlbmN5KSA9PiB7CiAgICAgICAgY29u
c3Qgb3NjID0KICAgICAgICAgIHBlb3BsZURtUGluZ0F1ZGlvQ29udGV4dC5jcmVhdGVPc2NpbGxhdG9yKCk7CiAgICAgICAgY29uc3QgZ2FpbiA9CiAgICAg
ICAgICBwZW9wbGVEbVBpbmdBdWRpb0NvbnRleHQuY3JlYXRlR2FpbigpOwoKICAgICAgICBvc2MudHlwZSA9ICJzaW5lIjsKICAgICAgICBvc2MuZnJlcXVl
bmN5LnNldFZhbHVlQXRUaW1lKGZyZXF1ZW5jeSwgc3RhcnQpOwoKICAgICAgICBnYWluLmdhaW4uc2V0VmFsdWVBdFRpbWUoMC4wMDAxLCBzdGFydCk7CiAg
ICAgICAgZ2Fpbi5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoCiAgICAgICAgICAwLjE2LAogICAgICAgICAgc3RhcnQgKyAwLjAxNQogICAg
ICAgICk7CiAgICAgICAgZ2Fpbi5nYWluLmV4cG9uZW50aWFsUmFtcFRvVmFsdWVBdFRpbWUoCiAgICAgICAgICAwLjAwMDEsCiAgICAgICAgICBzdGFydCAr
IDAuMTYKICAgICAgICApOwoKICAgICAgICBvc2MuY29ubmVjdChnYWluKTsKICAgICAgICBnYWluLmNvbm5lY3QoCiAgICAgICAgICBwZW9wbGVEbVBpbmdB
dWRpb0NvbnRleHQuZGVzdGluYXRpb24KICAgICAgICApOwoKICAgICAgICBvc2Muc3RhcnQoc3RhcnQpOwogICAgICAgIG9zYy5zdG9wKHN0YXJ0ICsgMC4x
OCk7CiAgICAgIH07CgogICAgICBiZWVwKG5vdywgODgwKTsKICAgICAgYmVlcChub3cgKyAwLjEyLCAxMTc1KTsKICAgIH0gY2F0Y2gge30KICB9CgogIGZ1
bmN0aW9uIHBlb3BsZURtU2hvd1BpbmdUb2FzdChzZW5kZXIsIGJvZHkpIHsKICAgIGxldCBob3N0ID0KICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQo
InBlb3BsZVBpbmdUb2FzdHMiKTsKCiAgICBpZiAoIWhvc3QpIHsKICAgICAgaG9zdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgICBo
b3N0LmlkID0gInBlb3BsZVBpbmdUb2FzdHMiOwogICAgICBob3N0LmNsYXNzTmFtZSA9ICJwZW9wbGUtcGluZy10b2FzdHMiOwogICAgICBkb2N1bWVudC5i
b2R5LmFwcGVuZENoaWxkKGhvc3QpOwogICAgfQoKICAgIGNvbnN0IHRvYXN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiZGl2Iik7CiAgICB0b2FzdC5j
bGFzc05hbWUgPSAicGVvcGxlLXBpbmctdG9hc3QiOwoKICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic3Ryb25nIik7CiAgICB0
aXRsZS50ZXh0Q29udGVudCA9ICJAIFBpbmcgTVAgZGUgIiArIHNlbmRlcjsKCiAgICBjb25zdCB0ZXh0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgic3Bh
biIpOwogICAgdGV4dC50ZXh0Q29udGVudCA9CiAgICAgIFN0cmluZyhib2R5IHx8ICIiKS5zbGljZSgwLCAxODApOwoKICAgIHRvYXN0LmFwcGVuZCh0aXRs
ZSwgdGV4dCk7CiAgICBob3N0LmFwcGVuZENoaWxkKHRvYXN0KTsKCiAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoCiAgICAgICgpID0+IHRvYXN0LmNsYXNz
TGlzdC5hZGQoInNob3ciKQogICAgKTsKCiAgICBzZXRUaW1lb3V0KCgpID0+IHsKICAgICAgdG9hc3QuY2xhc3NMaXN0LnJlbW92ZSgic2hvdyIpOwogICAg
ICBzZXRUaW1lb3V0KCgpID0+IHRvYXN0LnJlbW92ZSgpLCAyNTApOwogICAgfSwgNTAwMCk7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbUhhbmRsZU1lbnRp
b24ocGF5bG9hZCkgewogICAgaWYgKCFwZW9wbGVEbU1lbnRpb25zTWUocGF5bG9hZD8uYm9keSkpIHsKICAgICAgcmV0dXJuIGZhbHNlOwogICAgfQoKICAg
IGNvbnN0IHNlbmRlciA9CiAgICAgIHBheWxvYWQ/LnNlbmRlcj8udXNlcm5hbWUgfHwKICAgICAgIlF1ZWxxdSd1biI7CgogICAgcGVvcGxlRG1QbGF5UGlu
ZygpOwogICAgcGVvcGxlRG1TaG93UGluZ1RvYXN0KAogICAgICBzZW5kZXIsCiAgICAgIHBheWxvYWQuYm9keQogICAgKTsKCiAgICByZXR1cm4gdHJ1ZTsK
ICB9CgogIC8vID09PSBQRU9QTEVfRE1fTk9USUZJQ0FUSU9OX1YxX1NUQVJUID09PQogIGZ1bmN0aW9uIHBlb3BsZURtU2hvd01lc3NhZ2VUb2FzdCgKICAg
IHNlbmRlciwKICAgIGJvZHksCiAgICBoYXNJbWFnZQogICkgewogICAgbGV0IGhvc3QgPQogICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgKICAgICAg
ICAicGVvcGxlUGluZ1RvYXN0cyIKICAgICAgKTsKCiAgICBpZiAoIWhvc3QpIHsKICAgICAgaG9zdCA9CiAgICAgICAgZG9jdW1lbnQuY3JlYXRlRWxlbWVu
dCgKICAgICAgICAgICJkaXYiCiAgICAgICAgKTsKCiAgICAgIGhvc3QuaWQgPQogICAgICAgICJwZW9wbGVQaW5nVG9hc3RzIjsKCiAgICAgIGhvc3QuY2xh
c3NOYW1lID0KICAgICAgICAicGVvcGxlLXBpbmctdG9hc3RzIjsKCiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoCiAgICAgICAgaG9zdAogICAg
ICApOwogICAgfQoKICAgIGNvbnN0IHRvYXN0ID0KICAgICAgZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgKICAgICAgICAiZGl2IgogICAgICApOwoKICAgIHRv
YXN0LmNsYXNzTmFtZSA9CiAgICAgICJwZW9wbGUtcGluZy10b2FzdCBwZW9wbGUtZG0tbm90aWZpY2F0aW9uLXRvYXN0IjsKCiAgICBjb25zdCB0aXRsZSA9
CiAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoCiAgICAgICAgInN0cm9uZyIKICAgICAgKTsKCiAgICB0aXRsZS50ZXh0Q29udGVudCA9CiAgICAgICJN
UCBkZSAiICsKICAgICAgc2VuZGVyOwoKICAgIGNvbnN0IHRleHQgPQogICAgICBkb2N1bWVudC5jcmVhdGVFbGVtZW50KAogICAgICAgICJzcGFuIgogICAg
ICApOwoKICAgIHRleHQudGV4dENvbnRlbnQgPQogICAgICBTdHJpbmcoCiAgICAgICAgYm9keSB8fAogICAgICAgICgKICAgICAgICAgIGhhc0ltYWdlCiAg
ICAgICAgICAgID8gIvCflrzvuI8gSW1hZ2UiCiAgICAgICAgICAgIDogIk5vdXZlYXUgbWVzc2FnZSIKICAgICAgICApCiAgICAgICkuc2xpY2UoMCwgMTgw
KTsKCiAgICB0b2FzdC5hcHBlbmQoCiAgICAgIHRpdGxlLAogICAgICB0ZXh0CiAgICApOwoKICAgIGhvc3QuYXBwZW5kQ2hpbGQoCiAgICAgIHRvYXN0CiAg
ICApOwoKICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgKICAgICAgKCkgPT4KICAgICAgICB0b2FzdC5jbGFzc0xpc3QuYWRkKAogICAgICAgICAgInNob3ci
CiAgICAgICAgKQogICAgKTsKCiAgICBzZXRUaW1lb3V0KAogICAgICAoKSA9PiB7CiAgICAgICAgdG9hc3QuY2xhc3NMaXN0LnJlbW92ZSgKICAgICAgICAg
ICJzaG93IgogICAgICAgICk7CgogICAgICAgIHNldFRpbWVvdXQoCiAgICAgICAgICAoKSA9PiB0b2FzdC5yZW1vdmUoKSwKICAgICAgICAgIDI1MAogICAg
ICAgICk7CiAgICAgIH0sCiAgICAgIDUwMDAKICAgICk7CiAgfQoKICBmdW5jdGlvbiBwZW9wbGVEbUhhbmRsZUluY29taW5nTm90aWZpY2F0aW9uKHBheWxv
YWQpIHsKICAgIGNvbnN0IG1lbnRpb25lZCA9CiAgICAgIHBlb3BsZURtTWVudGlvbnNNZSgKICAgICAgICBwYXlsb2FkPy5ib2R5CiAgICAgICk7CgogICAg
Y29uc3Qgc2VuZGVyID0KICAgICAgcGF5bG9hZD8uc2VuZGVyPy51c2VybmFtZSB8fAogICAgICAiUXVlbHF1J3VuIjsKCiAgICBjb25zdCBkZWNpc2lvbiA9
CiAgICAgIHdpbmRvdy5QZW9wbGVOb3RpZmljYXRpb25QcmVmcwogICAgICAgID8uZGVjaWRlPy4oewogICAgICAgICAga2luZDogImRtIiwKICAgICAgICAg
IHVzZXJuYW1lOiBzZW5kZXIsCiAgICAgICAgICBtZW50aW9uZWQKICAgICAgICB9KSB8fCB7CiAgICAgICAgICBhbGxvd2VkOiB0cnVlLAogICAgICAgICAg
c291bmQ6ICJpbmhlcml0IgogICAgICAgIH07CgogICAgaWYgKCFkZWNpc2lvbi5hbGxvd2VkKSB7CiAgICAgIHJldHVybiB7CiAgICAgICAgYWxsb3dlZDog
ZmFsc2UsCiAgICAgICAgbWVudGlvbmVkCiAgICAgIH07CiAgICB9CgogICAgcGVvcGxlRG1QbGF5UGluZygKICAgICAgZGVjaXNpb24uc291bmQKICAgICk7
CgogICAgaWYgKG1lbnRpb25lZCkgewogICAgICBwZW9wbGVEbVNob3dQaW5nVG9hc3QoCiAgICAgICAgc2VuZGVyLAogICAgICAgIHBheWxvYWQ/LmJvZHkK
ICAgICAgKTsKICAgIH0gZWxzZSB7CiAgICAgIHBlb3BsZURtU2hvd01lc3NhZ2VUb2FzdCgKICAgICAgICBzZW5kZXIsCiAgICAgICAgcGF5bG9hZD8uYm9k
eSwKICAgICAgICBCb29sZWFuKAogICAgICAgICAgcGF5bG9hZD8uaW1hZ2VJZAogICAgICAgICkKICAgICAgKTsKICAgIH0KCiAgICByZXR1cm4gewogICAg
ICBhbGxvd2VkOiB0cnVlLAogICAgICBtZW50aW9uZWQsCiAgICAgIHNvdW5kOiBkZWNpc2lvbi5zb3VuZAogICAgfTsKICB9CiAgLy8gPT09IFBFT1BMRV9E
TV9OT1RJRklDQVRJT05fVjFfRU5EID09PQoKICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKAogICAgImNsaWNrIiwKICAgIHBlb3BsZURtVW5sb2NrUGlu
Z0F1ZGlvLAogICAgeyBwYXNzaXZlOiB0cnVlIH0KICApOwogIC8vID09PSBQRU9QTEVfRE1fTUVOVElPTl9QSU5HX1YyX0VORCA9PT0KCi8vID09PSBQRU9Q
TEVfRE1fRURJVF9DTElFTlRfVjZfU1RBUlQgPT09CiAgc29ja2V0Lm9uKAogICAgImRtLW1lc3NhZ2UtZWRpdGVkIiwKICAgIGFzeW5jIChwYXlsb2FkKSA9
PiB7CiAgICAgIGlmICghc29jaWFsUmVhZHkgfHwgIW1lKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAgICBjb25zdCBpZHMgPSBbCiAgICAgICAg
U3RyaW5nKHBheWxvYWQ/LnNlbmRlcklkIHx8ICIiKSwKICAgICAgICBTdHJpbmcocGF5bG9hZD8ucmVjaXBpZW50SWQgfHwgIiIpCiAgICAgIF07CgogICAg
ICBpZiAoCiAgICAgICAgYWN0aXZlRG1Vc2VyICYmCiAgICAgICAgaWRzLmluY2x1ZGVzKFN0cmluZyhtZS5pZCkpICYmCiAgICAgICAgaWRzLmluY2x1ZGVz
KFN0cmluZyhhY3RpdmVEbVVzZXIuaWQpKQogICAgICApIHsKICAgICAgICBhd2FpdCBsb2FkQWN0aXZlRG0oKTsKICAgICAgfQoKICAgICAgYXdhaXQgcmVm
cmVzaENvbnZlcnNhdGlvbnMoKTsKICAgIH0KICApOwogIC8vID09PSBQRU9QTEVfRE1fRURJVF9DTElFTlRfVjZfRU5EID09PQoKLy8gPT09IFBFT1BMRV9E
TV9ERUxFVEVfQ0xJRU5UX1YxX1NUQVJUID09PQogIHNvY2tldC5vbigKICAgICJkbS1tZXNzYWdlLWRlbGV0ZWQiLAogICAgYXN5bmMgKHBheWxvYWQpID0+
IHsKICAgICAgaWYgKCFzb2NpYWxSZWFkeSB8fCAhbWUpIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIHBlb3BsZURtUmVwbHlDb250cm9sbGVy
CiAgICAgICAgPy5jbGVhcklmSWQoCiAgICAgICAgICBwYXlsb2FkPy5pZAogICAgICAgICk7CgogICAgICB3aW5kb3cuUGVvcGxlTWVzc2FnZUFjdGlvbnMK
ICAgICAgICA/Lm1hcmtEZWxldGVkKAogICAgICAgICAgcGF5bG9hZD8uaWQKICAgICAgICApOwoKICAgICAgY29uc3QgaWRzID0gWwogICAgICAgIFN0cmlu
ZygKICAgICAgICAgIHBheWxvYWQ/LnNlbmRlcklkIHx8ICIiCiAgICAgICAgKSwKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBwYXlsb2FkPy5yZWNpcGll
bnRJZCB8fCAiIgogICAgICAgICkKICAgICAgXTsKCiAgICAgIGlmICgKICAgICAgICBhY3RpdmVEbVVzZXIgJiYKICAgICAgICBpZHMuaW5jbHVkZXMoCiAg
ICAgICAgICBTdHJpbmcobWUuaWQpCiAgICAgICAgKSAmJgogICAgICAgIGlkcy5pbmNsdWRlcygKICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgYWN0
aXZlRG1Vc2VyLmlkCiAgICAgICAgICApCiAgICAgICAgKQogICAgICApIHsKICAgICAgICBhd2FpdCBsb2FkQWN0aXZlRG0oKTsKICAgICAgfQoKICAgICAg
YXdhaXQgcmVmcmVzaENvbnZlcnNhdGlvbnMoKTsKICAgIH0KICApOwogIC8vID09PSBQRU9QTEVfRE1fREVMRVRFX0NMSUVOVF9WMV9FTkQgPT09CgogIHNv
Y2tldC5vbigiZG0tbWVzc2FnZSIsIGFzeW5jIChwYXlsb2FkKSA9PiB7CiAgICBjb25zdCBzZW5kZXJOYW1lID0KICAgICAgcGF5bG9hZD8uc2VuZGVyPy51
c2VybmFtZTsKCiAgICBpZiAoIXNlbmRlck5hbWUpIHJldHVybjsKCiAgICBjb25zdCBub3RpZmljYXRpb25QYXlsb2FkID0KICAgICAgYXdhaXQgcGVvcGxl
RG1FMmVlTm90aWZpY2F0aW9uUGF5bG9hZCgKICAgICAgICBwYXlsb2FkCiAgICAgICk7CgogICAgY29uc3QgcGVvcGxlRG1Ob3RpZmljYXRpb25EZWNpc2lv
biA9CiAgICAgIHBlb3BsZURtSGFuZGxlSW5jb21pbmdOb3RpZmljYXRpb24oCiAgICAgICAgbm90aWZpY2F0aW9uUGF5bG9hZAogICAgICApOwoKICAgIGlm
ICgKICAgICAgYWN0aXZlRG1Vc2VyICYmCiAgICAgIGFjdGl2ZURtVXNlci51c2VybmFtZSA9PT0gc2VuZGVyTmFtZSAmJgogICAgICAhZG1WaWV3LmNsYXNz
TGlzdC5jb250YWlucygiaGlkZGVuIikKICAgICkgewogICAgICBhd2FpdCBsb2FkQWN0aXZlRG0oKTsKICAgIH0gZWxzZSB7CiAgICAgIGF3YWl0IHJlZnJl
c2hDb252ZXJzYXRpb25zKCk7CiAgICB9CgogICAgdHJ5IHsKICAgICAgaWYgKAogICAgICAgIHBlb3BsZURtTm90aWZpY2F0aW9uRGVjaXNpb24/LmFsbG93
ZWQgIT09IGZhbHNlICYmCiAgICAgICAgIk5vdGlmaWNhdGlvbiIgaW4gd2luZG93ICYmCiAgICAgICAgTm90aWZpY2F0aW9uLnBlcm1pc3Npb24gPT09ICJn
cmFudGVkIgogICAgICApIHsKICAgICAgICBuZXcgTm90aWZpY2F0aW9uKAogICAgICAgICAgIlBlb3BsZSDigJQgTVAgZGUgIiArIHNlbmRlck5hbWUsCiAg
ICAgICAgICB7CiAgICAgICAgICAgIGJvZHk6CiAgICAgICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICAgICAgbm90aWZpY2F0aW9uUGF5bG9hZD8uYm9k
eSB8fAogICAgICAgICAgICAgICAgKAogICAgICAgICAgICAgICAgICBwYXlsb2FkLmltYWdlSWQKICAgICAgICAgICAgICAgICAgICA/ICLwn5a877iPIElt
YWdlIgogICAgICAgICAgICAgICAgICAgIDogIk5vdXZlYXUgbWVzc2FnZSIKICAgICAgICAgICAgICAgICkKICAgICAgICAgICAgICApLnNsaWNlKAogICAg
ICAgICAgICAgICAgMCwKICAgICAgICAgICAgICAgIDE4MAogICAgICAgICAgICAgICksCiAgICAgICAgICAgIHRhZzoKICAgICAgICAgICAgICAicGVvcGxl
LWRtLSIgKwogICAgICAgICAgICAgIHNlbmRlck5hbWUsCiAgICAgICAgICAgIHNpbGVudDogdHJ1ZQogICAgICAgICAgfQogICAgICAgICk7CiAgICAgIH0K
ICAgIH0gY2F0Y2gge30KICB9KTsKCiAgc29ja2V0Lm9uKAogICAgImRtLW1lc3NhZ2Utc2VudCIsCiAgICAoKSA9PiByZWZyZXNoQ29udmVyc2F0aW9ucygp
CiAgKTsKCiAgc29ja2V0Lm9uKAogICAgImRtLWNhbGwtaGlzdG9yeSIsCiAgICBhc3luYyAocGF5bG9hZCkgPT4gewogICAgICBpZiAoCiAgICAgICAgIXNv
Y2lhbFJlYWR5IHx8CiAgICAgICAgIW1lCiAgICAgICkgewogICAgICAgIHJldHVybjsKICAgICAgfQoKICAgICAgY29uc3QgaWRzID0gWwogICAgICAgIFN0
cmluZygKICAgICAgICAgIHBheWxvYWQ/LmNhbGxlcklkIHx8CiAgICAgICAgICAiIgogICAgICAgICksCiAgICAgICAgU3RyaW5nKAogICAgICAgICAgcGF5
bG9hZD8uY2FsbGVlSWQgfHwKICAgICAgICAgICIiCiAgICAgICAgKQogICAgICBdOwoKICAgICAgaWYgKAogICAgICAgIGFjdGl2ZURtVXNlciAmJgogICAg
ICAgIGlkcy5pbmNsdWRlcygKICAgICAgICAgIFN0cmluZygKICAgICAgICAgICAgbWUuaWQKICAgICAgICAgICkKICAgICAgICApICYmCiAgICAgICAgaWRz
LmluY2x1ZGVzKAogICAgICAgICAgU3RyaW5nKAogICAgICAgICAgICBhY3RpdmVEbVVzZXIuaWQKICAgICAgICAgICkKICAgICAgICApICYmCiAgICAgICAg
IWRtVmlldy5jbGFzc0xpc3QKICAgICAgICAgIC5jb250YWlucygKICAgICAgICAgICAgImhpZGRlbiIKICAgICAgICAgICkKICAgICAgKSB7CiAgICAgICAg
YXdhaXQgbG9hZEFjdGl2ZURtKCk7CiAgICAgIH0gZWxzZSB7CiAgICAgICAgYXdhaXQgcmVmcmVzaENvbnZlcnNhdGlvbnMoKTsKICAgICAgfQogICAgfQog
ICk7CgogIHNvY2tldC5vbigiZnJpZW5kLXN0YXRlLWNoYW5nZWQiLCAoKSA9PiB7CiAgICBpZiAoc29jaWFsUmVhZHkpIHsKICAgICAgcmVmcmVzaEZyaWVu
ZFN1cmZhY2VzKCk7CiAgICB9CiAgfSk7CgogIGZ1bmN0aW9uIHNjaGVkdWxlT25saW5lVXNlcnNSZWZyZXNoKCkgewogICAgaWYgKG9ubGluZVVzZXJzUmVm
cmVzaFRpbWVyKSB7CiAgICAgIHJldHVybjsKICAgIH0KCiAgICBvbmxpbmVVc2Vyc1JlZnJlc2hUaW1lciA9CiAgICAgIHNldFRpbWVvdXQoCiAgICAgICAg
KCkgPT4gewogICAgICAgICAgb25saW5lVXNlcnNSZWZyZXNoVGltZXIgPSBudWxsOwoKICAgICAgICAgIHZvaWQgUHJvbWlzZS5hbGwoWwogICAgICAgICAg
ICByZWZyZXNoRnJpZW5kcygpLAogICAgICAgICAgICByZWZyZXNoRGlyZWN0b3J5KAogICAgICAgICAgICAgIHBlb3BsZVNlYXJjaElucHV0Py52YWx1ZSB8
fCAiIgogICAgICAgICAgICApCiAgICAgICAgICBdKTsKICAgICAgICB9LAogICAgICAgIDEyMAogICAgICApOwogIH0KCiAgLy8gPT09IFBFT1BMRV9ETV9M
SVZFX1BSRVNFTkNFX1YxX1NUQVJUID09PQogIHNvY2tldC5vbigKICAgICJwZW9wbGUtcHJlc2VuY2UtY2hhbmdlZCIsCiAgICAocGF5bG9hZCA9IHt9KSA9
PiB7CiAgICAgIGlmICgKICAgICAgICAhc29jaWFsUmVhZHkgfHwKICAgICAgICAhbWUKICAgICAgKSB7CiAgICAgICAgcmV0dXJuOwogICAgICB9CgogICAg
ICBjb25zdCBhY2NvdW50SWQgPQogICAgICAgIFN0cmluZygKICAgICAgICAgIHBheWxvYWQ/LmFjY291bnRJZCB8fAogICAgICAgICAgIiIKICAgICAgICAp
OwoKICAgICAgaWYgKCFhY2NvdW50SWQpIHsKICAgICAgICByZXR1cm47CiAgICAgIH0KCiAgICAgIGNvbnN0IG9ubGluZSA9CiAgICAgICAgcGF5bG9hZD8u
b25saW5lID09PQogICAgICAgIHRydWU7CgogICAgICAvKgogICAgICAgIE1QIGFjdHVlbGxlbWVudCBhZmZpY2jDqSA6CiAgICAgICAgcGFzIGRlIHJlcXXD
qnRlIEhUVFAgc3VwcGzDqW1lbnRhaXJlLAogICAgICAgIG9uIGNoYW5nZSBkaXJlY3RlbWVudCBsZSBzdGF0dXQgZMOpasOgIGNoYXJnw6kuCiAgICAgICov
CiAgICAgIGlmICgKICAgICAgICBhY3RpdmVEbVVzZXIgJiYKICAgICAgICBTdHJpbmcoCiAgICAgICAgICBhY3RpdmVEbVVzZXIuaWQgfHwKICAgICAgICAg
ICIiCiAgICAgICAgKSA9PT0gYWNjb3VudElkCiAgICAgICkgewogICAgICAgIGFjdGl2ZURtVXNlci5vbmxpbmUgPQogICAgICAgICAgb25saW5lOwoKICAg
ICAgICBpZiAoZG1IZWFkZXJTdGF0dXMpIHsKICAgICAgICAgIGRtSGVhZGVyU3RhdHVzLnRleHRDb250ZW50ID0KICAgICAgICAgICAgb25saW5lCiAgICAg
ICAgICAgICAgPyAiRW4gbGlnbmUiCiAgICAgICAgICAgICAgOiAiSG9ycyBsaWduZSI7CiAgICAgICAgfQogICAgICB9CgogICAgICAvKgogICAgICAgIFNp
IGxlIHByb2ZpbCBkZSBjZXR0ZSBtw6ptZSBwZXJzb25uZSBlc3Qgb3V2ZXJ0LAogICAgICAgIHNvbiBpbmRpY2F0ZXVyIHN1aXQgbHVpIGF1c3NpIGxhIHBy
w6lzZW5jZSBlbiBkaXJlY3QuCiAgICAgICovCiAgICAgIGlmICgKICAgICAgICBjdXJyZW50UHJvZmlsZSAmJgogICAgICAgIFN0cmluZygKICAgICAgICAg
IGN1cnJlbnRQcm9maWxlLmlkIHx8CiAgICAgICAgICAiIgogICAgICAgICkgPT09IGFjY291bnRJZAogICAgICApIHsKICAgICAgICBjdXJyZW50UHJvZmls
ZS5vbmxpbmUgPQogICAgICAgICAgb25saW5lOwoKICAgICAgICBpZiAocHJvZmlsZU1vZGFsT25saW5lKSB7CiAgICAgICAgICBwcm9maWxlTW9kYWxPbmxp
bmUudGV4dENvbnRlbnQgPQogICAgICAgICAgICBvbmxpbmUKICAgICAgICAgICAgICA/ICLil48gRW4gbGlnbmUiCiAgICAgICAgICAgICAgOiAiSG9ycyBs
aWduZSI7CiAgICAgICAgfQogICAgICB9CiAgICB9CiAgKTsKICAvLyA9PT0gUEVPUExFX0RNX0xJVkVfUFJFU0VOQ0VfVjFfRU5EID09PQoKICBzb2NrZXQu
b24oCiAgICAib25saW5lLXVzZXJzIiwKICAgICgpID0+IHsKICAgICAgaWYgKHNvY2lhbFJlYWR5KSB7CiAgICAgICAgc2NoZWR1bGVPbmxpbmVVc2Vyc1Jl
ZnJlc2goKTsKICAgICAgfQogICAgfQogICk7CgogIGJvb3RzdHJhcFNvY2lhbCgpOwp9KSgpOwo=
#</FILE_SOCIAL>

#<FILE_INDEX>
PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImZyIj4KPGhlYWQ+CiAgICA8YmFzZSBocmVmPSIvIj4KICAgIDwhLS0gUEVPUExFX0ZBVklDT05fVEFCX1Yx
X1NUQVJUIC0tPgogICAgPGxpbmsgcmVsPSJpY29uIiB0eXBlPSJpbWFnZS94LWljb24iIGhyZWY9InBlb3BsZS1mYXZpY29uLmljbyI+CiAgICA8bGluayBy
ZWw9Imljb24iIHR5cGU9ImltYWdlL3BuZyIgc2l6ZXM9IjUxMng1MTIiIGhyZWY9InBlb3BsZS1mYXZpY29uLnBuZyI+CiAgICA8bGluayByZWw9InNob3J0
Y3V0IGljb24iIGhyZWY9InBlb3BsZS1mYXZpY29uLmljbyI+CiAgICA8IS0tIFBFT1BMRV9GQVZJQ09OX1RBQl9WMV9FTkQgLS0+CiAgPG1ldGEgY2hhcnNl
dD0idXRmLTgiIC8+CiAgPG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEsdmlld3BvcnQt
Zml0PWNvdmVyIiAvPgogIDx0aXRsZT5QZW9wbGU8L3RpdGxlPgogIDxzY3JpcHQgc3JjPSJwZW9wbGUtYXBwZWFyYW5jZS5qcz92PXBlb3BsZS1hcHBlYXJh
bmNlLXY0Ij48L3NjcmlwdD4KICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9InN0eWxlLmNzcyIgLz4KICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhy
ZWY9InBlb3BsZS1zZXR0aW5ncy5jc3M/dj1wZW9wbGUtY2FtZXJhLWRldmljZS12MS0yMDI2MDkxMWEiIC8+CiAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBo
cmVmPSJwZW9wbGUtbm90aWZpY2F0aW9uLXByZWZzLmNzcz92PXBlb3BsZS1ub3RpZmljYXRpb24tcHJlZnMtdjEtMjAyNjA5MTYiIC8+CiAgPGxpbmsgcmVs
PSJzdHlsZXNoZWV0IiBocmVmPSJwZW9wbGUtZG0tY2FsbHMuY3NzIiAvPgogIDxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0icGVvcGxlLW1vYmlsZS5j
c3MiIC8+CiAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJwZW9wbGUtYXBwZWFyYW5jZS5jc3M/dj1wZW9wbGUtYXBwZWFyYW5jZS12NCIgLz4KICA8
bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9InBlb3BsZS10aGVtZS1zdHVkaW8uY3NzP3Y9cGVvcGxlLXRoZW1lLXN0dWRpby12MSIgLz4KICA8bGluayBy
ZWw9InN0eWxlc2hlZXQiIGhyZWY9InBlb3BsZS1jYW1lcmEtZWZmZWN0cy5jc3M/dj1wZW9wbGUtZmFjZWZ4LXYxLTItMjAyNjA5MTFhIj4KICA8bGluayBy
ZWw9InN0eWxlc2hlZXQiIGhyZWY9InBlb3BsZS1tZWRpYS1mdWxsc2NyZWVuLmNzcz92PXBlb3BsZS1tZWRpYS1mdWxsc2NyZWVuLXYxLTIwMjYwOTExYSI+
CiAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJwZW9wbGUtaW1hZ2Utdmlld2VyLmNzcz92PXBlb3BsZS1pbWFnZS12aWV3ZXItdjEtMjAyNjA5MTFh
IiAvPgogIDxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0icGVvcGxlLXNlcnZlci12b2ljZS11aS5jc3M/dj1wZW9wbGUtc2VydmVyLXZvaWNlLXVpLXYx
LTIwMjYwOTExYSI+CiAgPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJwZW9wbGUtc2VydmVyLWNoYW5uZWxzLmNzcz92PXBlb3BsZS1zZXJ2ZXItY2hh
bm5lbHMtdjIiPgogIDxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0icGVvcGxlLXNlcnZlci1zZXR0aW5ncy5jc3M/dj1wZW9wbGUtcm9sZXMtdjEtMjAy
NjA5MTYiPgogICAgICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9InBlb3BsZS1hcHBlYXJhbmNlLXNldHRpbmdzLXYyLmNzcz92PXBlb3BsZS1hcHBl
YXJhbmNlLXNldHRpbmdzLXYyLTMtMjAyNjA5MTFhIiAvPgogIDxsaW5rIHJlbD0ic3R5bGVzaGVldCIgaHJlZj0icGVvcGxlLWNvbXBvc2VyLWxvd2VyLmNz
cz92PXBlb3BsZS1jb21wb3Nlci1sb3dlci12MSIgLz4KICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9InBlb3BsZS11bnJlYWQuY3NzP3Y9cGVvcGxl
LXVucmVhZC12MS0yMDI2MDkxNiIgLz4KICA8bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9InBlb3BsZS1vZmZsaW5lLmNzcz92PXBlb3BsZS1vZmZsaW5l
LXYxLTIwMjYwOTE2IiAvPgo8L2hlYWQ+Cjxib2R5Pgo8ZGl2IGlkPSJqb2luU2NyZWVuIiBjbGFzcz0ib3ZlcmxheSI+CiAgICA8ZGl2IGNsYXNzPSJqb2lu
LWNhcmQgYXV0aC1jYXJkIj4KICAgICAgPGRpdiBjbGFzcz0ibG9nbyI+UDwvZGl2PgogICAgICA8aDE+UGVvcGxlPC9oMT4KICAgICAgPHAgaWQ9ImF1dGhT
dWJ0aXRsZSI+Q29ubmVjdGUtdG9pIGF2ZWMgdG9uIHBzZXVkby48L3A+CgogICAgICA8ZGl2IGNsYXNzPSJhdXRoLXRhYnMiPgogICAgICAgIDxidXR0b24g
aWQ9ImxvZ2luVGFiIiBjbGFzcz0iYXV0aC10YWIgYWN0aXZlIiB0eXBlPSJidXR0b24iPgogICAgICAgICAgQ29ubmV4aW9uCiAgICAgICAgPC9idXR0b24+
CiAgICAgICAgPGJ1dHRvbiBpZD0icmVnaXN0ZXJUYWIiIGNsYXNzPSJhdXRoLXRhYiIgdHlwZT0iYnV0dG9uIj4KICAgICAgICAgIENyZWVyIHVuIGNvbXB0
ZQogICAgICAgIDwvYnV0dG9uPgogICAgICA8L2Rpdj4KCiAgICAgIDxmb3JtIGlkPSJqb2luRm9ybSI+CiAgICAgICAgPGlucHV0CiAgICAgICAgICBpZD0i
dXNlcm5hbWVJbnB1dCIKICAgICAgICAgIG1heGxlbmd0aD0iMjQiCiAgICAgICAgICBwbGFjZWhvbGRlcj0iUHNldWRvIgogICAgICAgICAgYXV0b2NvbXBs
ZXRlPSJ1c2VybmFtZSIKICAgICAgICAgIHJlcXVpcmVkCiAgICAgICAgLz4KICAgICAgICA8aW5wdXQKICAgICAgICAgIGlkPSJwYXNzd29yZElucHV0Igog
ICAgICAgICAgdHlwZT0icGFzc3dvcmQiCiAgICAgICAgICBtYXhsZW5ndGg9IjEyOCIKICAgICAgICAgIHBsYWNlaG9sZGVyPSJNb3QgZGUgcGFzc2UiCiAg
ICAgICAgICBhdXRvY29tcGxldGU9ImN1cnJlbnQtcGFzc3dvcmQiCiAgICAgICAgICByZXF1aXJlZAogICAgICAgIC8+CiAgICAgICAgPGRpdiBpZD0iYXV0
aEVycm9yIiBjbGFzcz0iYXV0aC1lcnJvciIgcm9sZT0ic3RhdHVzIj48L2Rpdj4KICAgICAgICA8YnV0dG9uIGlkPSJhdXRoU3VibWl0IiB0eXBlPSJzdWJt
aXQiPgogICAgICAgICAgU2UgY29ubmVjdGVyCiAgICAgICAgPC9idXR0b24+CiAgICAgIDwvZm9ybT4KCiAgICAgIDxwIGNsYXNzPSJhdXRoLW5vdGUiPgog
ICAgICAgIFBhcyBkJ2UtbWFpbCBwb3VyIGwnaW5zdGFudC4gR2FyZGUgYmllbiB0b24gbW90IGRlIHBhc3NlLgogICAgICA8L3A+CiAgICA8L2Rpdj4KICA8
L2Rpdj4KCiAgPGRpdiBpZD0icGVvcGxlQXBwU2hlbGwiIGNsYXNzPSJhcHAgcGVvcGxlLXNlcnZlci1tb2RlIj4KICAgIDxuYXYgY2xhc3M9InNlcnZlci1y
YWlsIiBhcmlhLWxhYmVsPSJOYXZpZ2F0aW9uIHByaW5jaXBhbGUiPgogICAgICA8YnV0dG9uCiAgICAgICAgaWQ9ImhvbWVSYWlsQnV0dG9uIgogICAgICAg
IGNsYXNzPSJyYWlsLWJ1dHRvbiByYWlsLWhvbWUiCiAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICAgIHRpdGxlPSJBY2N1ZWlsIGV0IG1lc3NhZ2VzIHBy
aXbDqXMiCiAgICAgICAgYXJpYS1sYWJlbD0iQWNjdWVpbCBldCBtZXNzYWdlcyBwcml2w6lzIgogICAgICA+CiAgICAgICAg8J+PoAogICAgICAgIDxzcGFu
IGlkPSJob21lVW5yZWFkQmFkZ2UiIGNsYXNzPSJyYWlsLWJhZGdlIGhpZGRlbiI+MDwvc3Bhbj4KICAgICAgPC9idXR0b24+CgogICAgICA8ZGl2IGNsYXNz
PSJyYWlsLXNlcGFyYXRvciI+PC9kaXY+CgogICAgICA8ZGl2CiAgICAgICAgaWQ9InNlcnZlclJhaWxMaXN0IgogICAgICAgIGNsYXNzPSJzZXJ2ZXItcmFp
bC1saXN0IgogICAgICAgIGFyaWEtbGFiZWw9IlRlcyBzZXJ2ZXVycyIKICAgICAgPjwvZGl2PgoKICAgICAgPGJ1dHRvbgogICAgICAgIGlkPSJjcmVhdGVT
ZXJ2ZXJSYWlsQnV0dG9uIgogICAgICAgIGNsYXNzPSJyYWlsLWJ1dHRvbiBzZXJ2ZXItY3JlYXRlLWJ1dHRvbiIKICAgICAgICB0eXBlPSJidXR0b24iCiAg
ICAgICAgdGl0bGU9IkNyw6llciB1biBzZXJ2ZXVyIgogICAgICAgIGFyaWEtbGFiZWw9IkNyw6llciB1biBzZXJ2ZXVyIgogICAgICA+CiAgICAgICAgKwog
ICAgICA8L2J1dHRvbj4KICAgIDwvbmF2PgoKICAgIDxhc2lkZSBjbGFzcz0ic2lkZWJhciI+CiAgICAgIDxzZWN0aW9uIGlkPSJob21lU2lkZWJhciIgY2xh
c3M9InNpZGViYXItbW9kZSBoaWRkZW4iPgogICAgICAgIDxkaXYgY2xhc3M9InNlcnZlci10aXRsZSBob21lLXRpdGxlIj4KICAgICAgICAgIDxkaXYgY2xh
c3M9InNlcnZlci1pY29uIj7wn4+gPC9kaXY+CiAgICAgICAgICA8ZGl2PgogICAgICAgICAgICA8c3Ryb25nPkFjY3VlaWw8L3N0cm9uZz4KICAgICAgICAg
ICAgPHNwYW4+QW1pcyBldCBtZXNzYWdlcyBwcml2w6lzPC9zcGFuPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CgogICAgICAgIDxkaXYgY2xh
c3M9ImNoYW5uZWwtZ3JvdXAiPgogICAgICAgICAgPGJ1dHRvbiBpZD0iZnJpZW5kc05hdkJ1dHRvbiIgY2xhc3M9ImNoYW5uZWwgYWN0aXZlIj4KICAgICAg
ICAgICAg8J+RpSBBbWlzCiAgICAgICAgICA8L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KCiAgICAgICAgPGRpdiBjbGFzcz0iY2hhbm5lbC1ncm91cCBkbS1z
aWRlYmFyLWdyb3VwIj4KICAgICAgICAgIDxkaXYgY2xhc3M9Imdyb3VwLWxhYmVsIj5NRVNTQUdFUyBQUklWw4lTPC9kaXY+CiAgICAgICAgICA8ZGl2IGlk
PSJkbUNvbnZlcnNhdGlvbkxpc3QiIGNsYXNzPSJkbS1jb252ZXJzYXRpb24tbGlzdCI+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImRtLXNpZGViYXItZW1w
dHkiPkF1Y3VuIE1QIHBvdXIgbCdpbnN0YW50PC9kaXY+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9zZWN0aW9uPgoKICAgICAg
PHNlY3Rpb24gaWQ9InBlb3BsZVNpZGViYXIiIGNsYXNzPSJzaWRlYmFyLW1vZGUiPgogICAgICAgIDxkaXYgY2xhc3M9InNlcnZlci10aXRsZSI+CiAgICAg
ICAgICA8ZGl2CiAgICAgICAgICAgIGlkPSJhY3RpdmVTZXJ2ZXJJY29uIgogICAgICAgICAgICBjbGFzcz0ic2VydmVyLWljb24iCiAgICAgICAgICA+Pzwv
ZGl2PgoKICAgICAgICAgIDxkaXY+CiAgICAgICAgICAgIDxzdHJvbmcgaWQ9ImFjdGl2ZVNlcnZlck5hbWUiPgogICAgICAgICAgICAgIFNlcnZldXIKICAg
ICAgICAgICAgPC9zdHJvbmc+CiAgICAgICAgICAgIDxzcGFuPgogICAgICAgICAgICAgIDxiIGlkPSJ1c2VyQ291bnQiPjA8L2I+IGVuIGxpZ25lCiAgICAg
ICAgICAgIDwvc3Bhbj4KICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgIDxkaXYgY2xhc3M9InNlcnZlci10aXRsZS1hY3Rpb25zIj4KICAgICAgICAgICAg
PGJ1dHRvbgogICAgICAgICAgICAgIGlkPSJzZXJ2ZXJDaGFubmVsQ3JlYXRlQnV0dG9uIgogICAgICAgICAgICAgIGNsYXNzPSJzZXJ2ZXItaW52aXRlLWJ1
dHRvbiIKICAgICAgICAgICAgICB0eXBlPSJidXR0b24iCiAgICAgICAgICAgICAgdGl0bGU9IkNyw6llciB1bmUgY2F0w6lnb3JpZSBvdSB1biBzYWxvbiIK
ICAgICAgICAgICAgICBhcmlhLWxhYmVsPSJDcsOpZXIgdW5lIGNhdMOpZ29yaWUgb3UgdW4gc2Fsb24iCiAgICAgICAgICAgID4KICAgICAgICAgICAgICDv
vIsKICAgICAgICAgICAgPC9idXR0b24+CiAgICAgICAgICAgIDxidXR0b24KICAgICAgICAgICAgICBpZD0ic2VydmVySW52aXRlQnV0dG9uIgogICAgICAg
ICAgICAgIGNsYXNzPSJzZXJ2ZXItaW52aXRlLWJ1dHRvbiIKICAgICAgICAgICAgICB0eXBlPSJidXR0b24iCiAgICAgICAgICAgICAgdGl0bGU9IkNvcGll
ciBsZSBsaWVuIGQnaW52aXRhdGlvbiIKICAgICAgICAgICAgICBhcmlhLWxhYmVsPSJDb3BpZXIgbGUgbGllbiBkJ2ludml0YXRpb24iCiAgICAgICAgICAg
ID4KICAgICAgICAgICAgICDwn5SXCiAgICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CgogICAgICAgIDxkaXYg
aWQ9InBlb3BsZVNlcnZlckNoYW5uZWxUcmVlIiBjbGFzcz0icGVvcGxlLXNlcnZlci1jaGFubmVsLXRyZWUiPjwvZGl2PgoKICAgICAgICA8ZGl2IGNsYXNz
PSJwZW9wbGUtc2VydmVyLXZvaWNlLWJyaWRnZSIgYXJpYS1oaWRkZW49InRydWUiPgogICAgICAgICAgPGJ1dHRvbiBpZD0idm9pY2VCdXR0b24iIGNsYXNz
PSJjaGFubmVsIiB0eXBlPSJidXR0b24iPgogICAgICAgICAgICDwn5SKIHZvY2FsIDxzcGFuIGlkPSJ2b2ljZUNvdW50Ij48L3NwYW4+CiAgICAgICAgICA8
L2J1dHRvbj4KICAgICAgICAgIDxkaXYgaWQ9InZvaWNlU3RhdHVzIiBjbGFzcz0idm9pY2Utc3RhdHVzIj5QYXMgY29ubmVjdMOpPC9kaXY+CiAgICAgICAg
ICA8ZGl2IGlkPSJ2b2ljZVVzZXJzIiBjbGFzcz0idm9pY2UtdXNlcnMiPgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJ2b2ljZS1lbXB0eSI+UGVyc29ubmUg
ZGFucyBsZSB2b2NhbDwvZGl2PgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvc2VjdGlvbj4KCiAgICAgIDxkaXYgY2xhc3M9InBy
b2ZpbGUiPgogICAgICAgIDxidXR0b24KICAgICAgICAgIGNsYXNzPSJhdmF0YXIgcHJvZmlsZS1hdmF0YXItYnV0dG9uIgogICAgICAgICAgaWQ9ImF2YXRh
ciIKICAgICAgICAgIHR5cGU9ImJ1dHRvbiIKICAgICAgICAgIHRpdGxlPSJPdXZyaXIgbW9uIHByb2ZpbCIKICAgICAgICAgIGFyaWEtbGFiZWw9Ik91dnJp
ciBtb24gcHJvZmlsIgogICAgICAgID4/PC9idXR0b24+CgogICAgICAgIDxidXR0b24KICAgICAgICAgIGlkPSJwcm9maWxlSW5mb0J1dHRvbiIKICAgICAg
ICAgIGNsYXNzPSJwcm9maWxlLWNvcHkgcHJvZmlsZS1jb3B5LWJ1dHRvbiIKICAgICAgICAgIHR5cGU9ImJ1dHRvbiIKICAgICAgICAgIHRpdGxlPSJPdXZy
aXIgbW9uIHByb2ZpbCIKICAgICAgICA+CiAgICAgICAgICA8c3Ryb25nIGlkPSJwcm9maWxlTmFtZSI+SW52aXTDqTwvc3Ryb25nPgogICAgICAgICAgPHNw
YW4gaWQ9Im1pY1N0YXRlIj48L3NwYW4+CiAgICAgICAgPC9idXR0b24+CgogICAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtYWN0aW9ucyI+CiAgICAgICAg
ICA8YnV0dG9uCiAgICAgICAgICAgIGlkPSJtdXRlQnV0dG9uIgogICAgICAgICAgICBjbGFzcz0iaWNvbi1idG4iCiAgICAgICAgICAgIHRpdGxlPSJBY3Rp
dmVyL2NvdXBlciBsZSBtaWNybyIKICAgICAgICAgID7wn46Z77iPPC9idXR0b24+CiAgICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgIGlkPSJjYW1lcmFC
dXR0b24iCiAgICAgICAgICAgIGNsYXNzPSJpY29uLWJ0biIKICAgICAgICAgICAgdGl0bGU9IkFjdGl2ZXIvY291cGVyIGxhIGNhbcOpcmEiCiAgICAgICAg
ICA+8J+TtzwvYnV0dG9uPgogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBpZD0ic2NyZWVuQnV0dG9uIgogICAgICAgICAgICBjbGFzcz0iaWNvbi1i
dG4iCiAgICAgICAgICAgIHRpdGxlPSJQYXJ0YWdlciBsJ8OpY3JhbiIKICAgICAgICAgICAgYXJpYS1sYWJlbD0iUGFydGFnZXIgbCfDqWNyYW4iCiAgICAg
ICAgICA+8J+Wpe+4jzwvYnV0dG9uPgogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBpZD0ibGVhdmVWb2ljZVF1aWNrQnV0dG9uIgogICAgICAgICAg
ICBjbGFzcz0iaWNvbi1idG4iCiAgICAgICAgICAgIHRpdGxlPSJRdWl0dGVyIGxlIHZvY2FsIgogICAgICAgICAgICBhcmlhLWxhYmVsPSJRdWl0dGVyIGxl
IHZvY2FsIgogICAgICAgICAgICBkaXNhYmxlZAogICAgICAgICAgPvCfk548L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICA8L2Fz
aWRlPgoKICAgIDxtYWluIGlkPSJwZW9wbGVNYWluIiBjbGFzcz0ibWFpbiI+CiAgICAgIDxoZWFkZXIgY2xhc3M9InRvcGJhciI+CiAgICAgICAgPGRpdj4K
ICAgICAgICAgIDxzdHJvbmcgaWQ9ImFjdGl2ZVRleHRDaGFubmVsTmFtZSI+IyBnw6luw6lyYWw8L3N0cm9uZz4KICAgICAgICAgIDxzcGFuIGlkPSJhY3Rp
dmVUZXh0Q2hhbm5lbFN1YnRpdGxlIj5TYWxvbiBnw6luw6lyYWw8L3NwYW4+CiAgICAgICAgPC9kaXY+CgogICAgICAgIDxidXR0b24KICAgICAgICAgIGlk
PSJvbmxpbmVQYW5lbFRvZ2dsZSIKICAgICAgICAgIGNsYXNzPSJvbmxpbmUtcGFuZWwtdG9nZ2xlIgogICAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICAg
ICAgdGl0bGU9IkFmZmljaGVyIGxlcyBwZXJzb25uZXMgZW4gbGlnbmUiCiAgICAgICAgICBhcmlhLWxhYmVsPSJBZmZpY2hlciBsZXMgcGVyc29ubmVzIGVu
IGxpZ25lIgogICAgICAgID4KICAgICAgICAgIPCfkaUgPHNwYW4gaWQ9Im9ubGluZVBhbmVsVG9nZ2xlQ291bnQiPjA8L3NwYW4+CiAgICAgICAgPC9idXR0
b24+CiAgICAgIDwvaGVhZGVyPgoKICAgICAgPHNlY3Rpb24KICAgICAgICBpZD0idmlkZW9TdGFnZSIKICAgICAgICBjbGFzcz0idmlkZW8tc3RhZ2UgaGlk
ZGVuIgogICAgICAgIGFyaWEtbGFiZWw9IkNhbcOpcmFzIGR1IHZvY2FsIgogICAgICA+CiAgICAgICAgPGRpdiBpZD0idmlkZW9HcmlkIiBjbGFzcz0idmlk
ZW8tZ3JpZCI+PC9kaXY+CiAgICAgIDwvc2VjdGlvbj4KCiAgICAgIDxzZWN0aW9uIGlkPSJtZXNzYWdlcyIgY2xhc3M9Im1lc3NhZ2VzIj4KICAgICAgICA8
ZGl2IGNsYXNzPSJ3ZWxjb21lIj4KICAgICAgICAgIDxkaXYgY2xhc3M9Imhhc2giPiM8L2Rpdj4KICAgICAgICAgIDxoMj5CaWVudmVudWUgZGFucyAjIGfD
qW7DqXJhbDwvaDI+CiAgICAgICAgICA8cCBpZD0ic2VydmVyV2VsY29tZVRleHQiPkxlIHNhbG9uIHRleHRlIGfDqW7DqXJhbC48L3A+CiAgICAgICAgPC9k
aXY+CiAgICAgIDwvc2VjdGlvbj4KCiAgICAgIDxmb3JtIGlkPSJtZXNzYWdlRm9ybSIgY2xhc3M9ImNvbXBvc2VyIj4KICAgICAgICA8YnV0dG9uCiAgICAg
ICAgICBpZD0ibWVzc2FnZUltYWdlQnV0dG9uIgogICAgICAgICAgY2xhc3M9ImNvbXBvc2VyLWltYWdlLWJ1dHRvbiIKICAgICAgICAgIHR5cGU9ImJ1dHRv
biIKICAgICAgICAgIHRpdGxlPSJFbnZveWVyIHVuZSBwacOoY2Ugam9pbnRlICgyNSBNbyBtYXgpIgogICAgICAgICAgYXJpYS1sYWJlbD0iRW52b3llciB1
bmUgcGnDqGNlIGpvaW50ZSIKICAgICAgICA+8J+TjjwvYnV0dG9uPgogICAgICAgIDxpbnB1dAogICAgICAgICAgaWQ9Im1lc3NhZ2VJbWFnZUlucHV0Igog
ICAgICAgICAgdHlwZT0iZmlsZSIKICAgICAgICAgIG11bHRpcGxlCiAgICAgICAgICBoaWRkZW4KICAgICAgICAvPgogICAgICAgIDxkaXYKICAgICAgICAg
IGlkPSJtZXNzYWdlSW1hZ2VQcmV2aWV3IgogICAgICAgICAgY2xhc3M9ImNvbXBvc2VyLWltYWdlLXByZXZpZXcgaGlkZGVuIgogICAgICAgID48L2Rpdj4K
ICAgICAgICA8aW5wdXQKICAgICAgICAgIGlkPSJtZXNzYWdlSW5wdXQiCiAgICAgICAgICBtYXhsZW5ndGg9IjEwMDAiCiAgICAgICAgICBwbGFjZWhvbGRl
cj0iTWVzc2FnZSBkYW5zICNnw6luw6lyYWwiCiAgICAgICAgICBhdXRvY29tcGxldGU9Im9mZiIKICAgICAgICAvPgogICAgICAgIDxidXR0b24gdHlwZT0i
c3VibWl0Ij5FbnZveWVyPC9idXR0b24+CiAgICAgIDwvZm9ybT4KICAgIDwvbWFpbj4KCiAgICA8bWFpbiBpZD0iaG9tZU1haW4iIGNsYXNzPSJob21lLW1h
aW4gaGlkZGVuIj4KICAgICAgPGhlYWRlciBjbGFzcz0iaG9tZS10b3BiYXIiPgogICAgICAgIDxkaXY+CiAgICAgICAgICA8c3Ryb25nIGlkPSJob21lTWFp
blRpdGxlIj5BbWlzPC9zdHJvbmc+CiAgICAgICAgICA8c3BhbiBpZD0iaG9tZU1haW5TdWJ0aXRsZSI+VGVzIGNvbnRhY3RzIFBlb3BsZTwvc3Bhbj4KICAg
ICAgICA8L2Rpdj4KICAgICAgPC9oZWFkZXI+CgogICAgICA8c2VjdGlvbiBpZD0iZnJpZW5kc1ZpZXciIGNsYXNzPSJmcmllbmRzLXZpZXciPgogICAgICAg
IDxkaXYgY2xhc3M9ImZyaWVuZHMtc2VhcmNoLWNhcmQiPgogICAgICAgICAgPGgyPlJldHJvdXZlciBxdWVscXUndW48L2gyPgogICAgICAgICAgPHA+CiAg
ICAgICAgICAgIENoZXJjaGUgdW4gY29tcHRlIFBlb3BsZSwgb3V2cmUgc29uIHByb2ZpbCwKICAgICAgICAgICAgYWpvdXRlLWxlIMOgIHRlcyBhbWlzIG91
IGVudm9pZS1sdWkgdW4gTVAuCiAgICAgICAgICA8L3A+CiAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgaWQ9InBlb3BsZVNlYXJjaElucHV0IgogICAg
ICAgICAgICBtYXhsZW5ndGg9IjUwIgogICAgICAgICAgICBwbGFjZWhvbGRlcj0iQ2hlcmNoZXIgdW4gcHNldWRvLi4uIgogICAgICAgICAgICBhdXRvY29t
cGxldGU9Im9mZiIKICAgICAgICAgIC8+CiAgICAgICAgPC9kaXY+CgogICAgICAgIDwhLS0gPT09IFBFT1BMRV9GUklFTkRfUkVRVUVTVFNfVUlfVjJfU1RB
UlQgPT09IC0tPgogICAgICAgIDxkaXYgY2xhc3M9ImhvbWUtc2VjdGlvbiBmcmllbmQtcmVxdWVzdHMtc2VjdGlvbiI+CiAgICAgICAgICA8ZGl2IGNsYXNz
PSJob21lLXNlY3Rpb24tdGl0bGUiPgogICAgICAgICAgICA8c3Ryb25nPkRlbWFuZGVzIGQnYW1pPC9zdHJvbmc+CiAgICAgICAgICAgIDxzcGFuIGlkPSJm
cmllbmRSZXF1ZXN0c0NvdW50Ij4wPC9zcGFuPgogICAgICAgICAgPC9kaXY+CgogICAgICAgICAgPGRpdiBjbGFzcz0iZnJpZW5kLXJlcXVlc3QtY29sdW1u
cyI+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZyaWVuZC1yZXF1ZXN0LWNvbHVtbiI+CiAgICAgICAgICAgICAgPGRpdiBjbGFzcz0iZnJpZW5kLXJlcXVl
c3QtbGFiZWwiPgogICAgICAgICAgICAgICAgw4AgYWNjZXB0ZXIKICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8ZGl2CiAgICAgICAgICAg
ICAgICBpZD0iaW5jb21pbmdGcmllbmRSZXF1ZXN0cyIKICAgICAgICAgICAgICAgIGNsYXNzPSJmcmllbmQtcmVxdWVzdC1saXN0IgogICAgICAgICAgICAg
ID4KICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9ImhvbWUtZW1wdHkiPgogICAgICAgICAgICAgICAgICBBdWN1bmUgZGVtYW5kZSByZcOndWUuCiAgICAg
ICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPC9kaXY+CgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJmcmllbmQt
cmVxdWVzdC1jb2x1bW4iPgogICAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZyaWVuZC1yZXF1ZXN0LWxhYmVsIj4KICAgICAgICAgICAgICAgIEVudm95w6ll
cwogICAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgICAgIDxkaXYKICAgICAgICAgICAgICAgIGlkPSJvdXRnb2luZ0ZyaWVuZFJlcXVlc3RzIgogICAg
ICAgICAgICAgICAgY2xhc3M9ImZyaWVuZC1yZXF1ZXN0LWxpc3QiCiAgICAgICAgICAgICAgPgogICAgICAgICAgICAgICAgPGRpdiBjbGFzcz0iaG9tZS1l
bXB0eSI+CiAgICAgICAgICAgICAgICAgIEF1Y3VuZSBkZW1hbmRlIGVuIGF0dGVudGUuCiAgICAgICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgICA8
L2Rpdj4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICA8L2Rpdj4KICAgICAgICA8IS0tID09PSBQRU9QTEVfRlJJRU5EX1JF
UVVFU1RTX1VJX1YyX0VORCA9PT0gLS0+CgogICAgICAgIDxkaXYgY2xhc3M9ImhvbWUtc2VjdGlvbiI+CiAgICAgICAgICA8ZGl2IGNsYXNzPSJob21lLXNl
Y3Rpb24tdGl0bGUiPgogICAgICAgICAgICA8c3Ryb25nPk1lcyBhbWlzPC9zdHJvbmc+CiAgICAgICAgICAgIDxzcGFuIGlkPSJmcmllbmRzQ291bnQiPjA8
L3NwYW4+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICAgIDxkaXYgaWQ9ImZyaWVuZHNMaXN0IiBjbGFzcz0icGVvcGxlLWNhcmQtbGlzdCI+CiAgICAgICAg
ICAgIDxkaXYgY2xhc3M9ImhvbWUtZW1wdHkiPkF1Y3VuIGFtaSBwb3VyIGwnaW5zdGFudC48L2Rpdj4KICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvZGl2
PgoKICAgICAgICA8ZGl2CiAgICAgICAgICBpZD0icGVvcGxlRGlyZWN0b3J5U2VjdGlvbiIKICAgICAgICAgIGNsYXNzPSJob21lLXNlY3Rpb24iCiAgICAg
ICAgICBzdHlsZT0iZGlzcGxheTpub25lIgogICAgICAgID4KICAgICAgICAgIDxkaXYKICAgICAgICAgICAgaWQ9InBlb3BsZURpcmVjdG9yeSIKICAgICAg
ICAgICAgY2xhc3M9InBlb3BsZS1jYXJkLWxpc3QiCiAgICAgICAgICA+PC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvc2VjdGlvbj4KCiAgICAgIDxz
ZWN0aW9uIGlkPSJkbVZpZXciIGNsYXNzPSJkbS12aWV3IGhpZGRlbiI+CiAgICAgICAgPGhlYWRlciBjbGFzcz0iZG0taGVhZGVyIj4KICAgICAgICAgIDxi
dXR0b24KICAgICAgICAgICAgaWQ9ImRtQmFja0J1dHRvbiIKICAgICAgICAgICAgY2xhc3M9ImRtLWJhY2stYnV0dG9uIgogICAgICAgICAgICB0eXBlPSJi
dXR0b24iCiAgICAgICAgICAgIHRpdGxlPSJSZXRvdXIgYXV4IGFtaXMiCiAgICAgICAgICA+4oaQPC9idXR0b24+CgogICAgICAgICAgPGJ1dHRvbgogICAg
ICAgICAgICBpZD0iZG1Qcm9maWxlQnV0dG9uIgogICAgICAgICAgICBjbGFzcz0iZG0tcHJvZmlsZS1idXR0b24iCiAgICAgICAgICAgIHR5cGU9ImJ1dHRv
biIKICAgICAgICAgID4KICAgICAgICAgICAgPHNwYW4gaWQ9ImRtSGVhZGVyQXZhdGFyIiBjbGFzcz0iZG0taGVhZGVyLWF2YXRhciI+Pzwvc3Bhbj4KICAg
ICAgICAgICAgPHNwYW4+CiAgICAgICAgICAgICAgPHN0cm9uZyBpZD0iZG1IZWFkZXJOYW1lIj5NZXNzYWdlIHByaXbDqTwvc3Ryb25nPgogICAgICAgICAg
ICAgIDxzbWFsbCBpZD0iZG1IZWFkZXJTdGF0dXMiPjwvc21hbGw+CiAgICAgICAgICAgIDwvc3Bhbj4KICAgICAgICAgIDwvYnV0dG9uPgogICAgICAgIDwv
aGVhZGVyPgoKICAgICAgICA8ZGl2IGlkPSJkbU1lc3NhZ2VzIiBjbGFzcz0iZG0tbWVzc2FnZXMiPgogICAgICAgICAgPGRpdiBjbGFzcz0iZG0td2VsY29t
ZSI+CiAgICAgICAgICAgIDxoMiBpZD0iZG1XZWxjb21lVGl0bGUiPk1lc3NhZ2UgcHJpdsOpPC9oMj4KICAgICAgICAgICAgPHA+RMOpYnV0IGRlIHZvdHJl
IGNvbnZlcnNhdGlvbiBzdXIgUGVvcGxlLjwvcD4KICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvZGl2PgoKICAgICAgICA8Zm9ybSBpZD0iZG1Gb3JtIiBj
bGFzcz0iY29tcG9zZXIgZG0tY29tcG9zZXIiPgogICAgICAgICAgPGJ1dHRvbgogICAgICAgICAgICBpZD0iZG1JbWFnZUJ1dHRvbiIKICAgICAgICAgICAg
Y2xhc3M9ImNvbXBvc2VyLWltYWdlLWJ1dHRvbiIKICAgICAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICAgICAgICB0aXRsZT0iRW52b3llciB1bmUgcGnD
qGNlIGpvaW50ZSAoMjUgTW8gbWF4KSIKICAgICAgICAgICAgYXJpYS1sYWJlbD0iRW52b3llciB1bmUgcGnDqGNlIGpvaW50ZSIKICAgICAgICAgID7wn5OO
PC9idXR0b24+CiAgICAgICAgICA8aW5wdXQKICAgICAgICAgICAgaWQ9ImRtSW1hZ2VJbnB1dCIKICAgICAgICAgICAgdHlwZT0iZmlsZSIKICAgICAgICAg
ICAgbXVsdGlwbGUKICAgICAgICAgICAgaGlkZGVuCiAgICAgICAgICAvPgogICAgICAgICAgPGRpdgogICAgICAgICAgICBpZD0iZG1JbWFnZVByZXZpZXci
CiAgICAgICAgICAgIGNsYXNzPSJjb21wb3Nlci1pbWFnZS1wcmV2aWV3IGhpZGRlbiIKICAgICAgICAgID48L2Rpdj4KICAgICAgICAgIDxpbnB1dAogICAg
ICAgICAgICBpZD0iZG1JbnB1dCIKICAgICAgICAgICAgbWF4bGVuZ3RoPSIyMDAwIgogICAgICAgICAgICBwbGFjZWhvbGRlcj0iTWVzc2FnZSBwcml2w6ku
Li4iCiAgICAgICAgICAgIGF1dG9jb21wbGV0ZT0ib2ZmIgogICAgICAgICAgLz4KICAgICAgICAgIDxidXR0b24gdHlwZT0ic3VibWl0Ij5FbnZveWVyPC9i
dXR0b24+CiAgICAgICAgPC9mb3JtPgogICAgICA8L3NlY3Rpb24+CiAgICA8L21haW4+CgogICAgPGFzaWRlCiAgICAgIGlkPSJvbmxpbmVQYW5lbCIKICAg
ICAgY2xhc3M9Im9ubGluZS1wYW5lbCIKICAgICAgYXJpYS1sYWJlbD0iTWVtYnJlcyBkdSBzZXJ2ZXVyIgogICAgPgogICAgICA8ZGl2IGNsYXNzPSJvbmxp
bmUtcGFuZWwtaGVhZGVyIj4KICAgICAgICA8ZGl2PgogICAgICAgICAgPHN0cm9uZz5NZW1icmVzPC9zdHJvbmc+CiAgICAgICAgICA8c3BhbiBpZD0ib25s
aW5lUGFuZWxDb3VudCI+MCBwZXJzb25uZTwvc3Bhbj4KICAgICAgICA8L2Rpdj4KICAgICAgICA8YnV0dG9uCiAgICAgICAgICBpZD0ib25saW5lUGFuZWxD
bG9zZSIKICAgICAgICAgIGNsYXNzPSJvbmxpbmUtcGFuZWwtY2xvc2UiCiAgICAgICAgICB0eXBlPSJidXR0b24iCiAgICAgICAgICBhcmlhLWxhYmVsPSJG
ZXJtZXIgbGEgbGlzdGUgZGVzIG1lbWJyZXMiCiAgICAgICAgICB0aXRsZT0iRmVybWVyIgogICAgICAgID7inJU8L2J1dHRvbj4KICAgICAgPC9kaXY+Cgog
ICAgICA8ZGl2IGlkPSJvbmxpbmVVc2Vyc0xpc3QiIGNsYXNzPSJvbmxpbmUtdXNlcnMtbGlzdCI+CiAgICAgICAgPGRpdiBjbGFzcz0ib25saW5lLXVzZXJz
LWVtcHR5Ij5DaGFyZ2VtZW50IGRlcyBtZW1icmVzLi4uPC9kaXY+CiAgICAgIDwvZGl2PgogICAgPC9hc2lkZT4KICA8L2Rpdj4KCiAgICA8YnV0dG9uCiAg
ICBpZD0ibG9nb3V0QnV0dG9uIgogICAgY2xhc3M9InBlb3BsZS1maXhlZC1sb2dvdXQiCiAgICB0eXBlPSJidXR0b24iCiAgICB0aXRsZT0iU2UgZGVjb25u
ZWN0ZXIiCiAgICBhcmlhLWxhYmVsPSJTZSBkZWNvbm5lY3RlciIKICA+8J+aqjwvYnV0dG9uPgoKPGRpdiBpZD0icHJvZmlsZU1vZGFsIiBjbGFzcz0icHJv
ZmlsZS1tb2RhbCBoaWRkZW4iPgogICAgPGRpdiBjbGFzcz0icHJvZmlsZS1tb2RhbC1iYWNrZHJvcCIgZGF0YS1wcm9maWxlLWNsb3NlPSIxIj48L2Rpdj4K
ICAgIDxzZWN0aW9uIGNsYXNzPSJwcm9maWxlLWNhcmQtbW9kYWwiIHJvbGU9ImRpYWxvZyIgYXJpYS1tb2RhbD0idHJ1ZSI+CiAgICAgIDxidXR0b24KICAg
ICAgICBpZD0icHJvZmlsZU1vZGFsQ2xvc2UiCiAgICAgICAgY2xhc3M9InByb2ZpbGUtbW9kYWwtY2xvc2UiCiAgICAgICAgdHlwZT0iYnV0dG9uIgogICAg
ICAgIGFyaWEtbGFiZWw9IkZlcm1lciIKICAgICAgPuKclTwvYnV0dG9uPgoKICAgICAgPGRpdiBjbGFzcz0icHJvZmlsZS1jYXJkLWhlYWQiPgogICAgICAg
IDxkaXYgY2xhc3M9InByb2ZpbGUtYXZhdGFyLXN0YWNrIj4KICAgICAgICAgIDxkaXYKICAgICAgICAgICAgaWQ9InByb2ZpbGVNb2RhbEF2YXRhciIKICAg
ICAgICAgICAgY2xhc3M9InByb2ZpbGUtbGFyZ2UtYXZhdGFyIgogICAgICAgICAgPj88L2Rpdj4KCiAgICAgICAgICA8ZGl2CiAgICAgICAgICAgIGlkPSJw
cm9maWxlQXZhdGFyRWRpdFdyYXAiCiAgICAgICAgICAgIGNsYXNzPSJwcm9maWxlLWF2YXRhci1lZGl0LXdyYXAgaGlkZGVuIgogICAgICAgICAgPgogICAg
ICAgICAgICA8YnV0dG9uCiAgICAgICAgICAgICAgaWQ9InByb2ZpbGVBdmF0YXJVcGxvYWRCdXR0b24iCiAgICAgICAgICAgICAgY2xhc3M9InByb2ZpbGUt
YXZhdGFyLXVwbG9hZC1idXR0b24iCiAgICAgICAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICAgICAgICA+CiAgICAgICAgICAgICAgQ2hhbmdlciBsYSBw
aG90bwogICAgICAgICAgICA8L2J1dHRvbj4KCiAgICAgICAgICAgIDxpbnB1dAogICAgICAgICAgICAgIGlkPSJwcm9maWxlQXZhdGFySW5wdXQiCiAgICAg
ICAgICAgICAgdHlwZT0iZmlsZSIKICAgICAgICAgICAgICBhY2NlcHQ9ImltYWdlL2pwZWcsaW1hZ2UvcG5nLGltYWdlL3dlYnAsaW1hZ2UvZ2lmIgogICAg
ICAgICAgICAgIGhpZGRlbgogICAgICAgICAgICAvPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdj4KICAgICAgICAgIDxo
MiBpZD0icHJvZmlsZU1vZGFsTmFtZSI+UHJvZmlsPC9oMj4KICAgICAgICAgIDxzcGFuIGlkPSJwcm9maWxlTW9kYWxPbmxpbmUiIGNsYXNzPSJwcm9maWxl
LW9ubGluZS1zdGF0ZSI+PC9zcGFuPgogICAgICAgIDwvZGl2PgogICAgICA8L2Rpdj4KCiAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtY2FyZC1zZWN0aW9u
Ij4KICAgICAgICA8c3Ryb25nPkRlc2NyaXB0aW9uPC9zdHJvbmc+CiAgICAgICAgPHAgaWQ9InByb2ZpbGVEZXNjcmlwdGlvblRleHQiPjwvcD4KCiAgICAg
ICAgPGRpdiBpZD0icHJvZmlsZUVkaXRXcmFwIiBjbGFzcz0icHJvZmlsZS1lZGl0LXdyYXAgaGlkZGVuIj4KICAgICAgICAgIDx0ZXh0YXJlYQogICAgICAg
ICAgICBpZD0icHJvZmlsZURlc2NyaXB0aW9uSW5wdXQiCiAgICAgICAgICAgIG1heGxlbmd0aD0iMjgwIgogICAgICAgICAgICBwbGFjZWhvbGRlcj0iw4lj
cmlzIHVuZSBwZXRpdGUgZGVzY3JpcHRpb24uLi4iCiAgICAgICAgICA+PC90ZXh0YXJlYT4KICAgICAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtZGVzY3Jp
cHRpb24tY291bnRlciI+CiAgICAgICAgICAgIDxzcGFuIGlkPSJwcm9maWxlRGVzY3JpcHRpb25Db3VudCI+MDwvc3Bhbj4vMjgwCiAgICAgICAgICA8L2Rp
dj4KICAgICAgICAgIDxidXR0b24gaWQ9InByb2ZpbGVTYXZlQnV0dG9uIiB0eXBlPSJidXR0b24iPgogICAgICAgICAgICBFbnJlZ2lzdHJlcgogICAgICAg
ICAgPC9idXR0b24+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvZGl2PgoKICAgICAgPGRpdiBjbGFzcz0icHJvZmlsZS1jYXJkLXNlY3Rpb24iPgogICAgICAg
IDxzdHJvbmc+TWVtYnJlIGRlcHVpczwvc3Ryb25nPgogICAgICAgIDxwIGlkPSJwcm9maWxlQ3JlYXRlZEF0Ij7igJQ8L3A+CiAgICAgIDwvZGl2PgoKICAg
ICAgPGRpdiBpZD0icHJvZmlsZUFjdGlvbnMiIGNsYXNzPSJwcm9maWxlLW1vZGFsLWFjdGlvbnMiPgogICAgICAgIDxidXR0b24gaWQ9InByb2ZpbGVEbUJ1
dHRvbiIgdHlwZT0iYnV0dG9uIj4KICAgICAgICAgIEVudm95ZXIgdW4gTVAKICAgICAgICA8L2J1dHRvbj4KICAgICAgICA8YnV0dG9uIGlkPSJwcm9maWxl
RnJpZW5kQnV0dG9uIiB0eXBlPSJidXR0b24iPgogICAgICAgICAgQWpvdXRlciBlbiBhbWkKICAgICAgICA8L2J1dHRvbj4KICAgICAgPC9kaXY+CiAgICA8
L3NlY3Rpb24+CiAgPC9kaXY+CgoKICA8ZGl2CiAgICBpZD0iY3JlYXRlU2VydmVyTW9kYWwiCiAgICBjbGFzcz0icGVvcGxlLXNlcnZlci1tb2RhbCBoaWRk
ZW4iCiAgPgogICAgPHNlY3Rpb24KICAgICAgY2xhc3M9InBlb3BsZS1zZXJ2ZXItbW9kYWwtY2FyZCIKICAgICAgcm9sZT0iZGlhbG9nIgogICAgICBhcmlh
LW1vZGFsPSJ0cnVlIgogICAgICBhcmlhLWxhYmVsbGVkYnk9ImNyZWF0ZVNlcnZlclRpdGxlIgogICAgPgogICAgICA8YnV0dG9uCiAgICAgICAgaWQ9ImNy
ZWF0ZVNlcnZlck1vZGFsQ2xvc2UiCiAgICAgICAgY2xhc3M9InBlb3BsZS1zZXJ2ZXItbW9kYWwtY2xvc2UiCiAgICAgICAgdHlwZT0iYnV0dG9uIgogICAg
ICAgIGFyaWEtbGFiZWw9IkZlcm1lciIKICAgICAgPuKclTwvYnV0dG9uPgoKICAgICAgPGgyIGlkPSJjcmVhdGVTZXJ2ZXJUaXRsZSI+CiAgICAgICAgQ3LD
qWVyIHRvbiBzZXJ2ZXVyCiAgICAgIDwvaDI+CgogICAgICA8cD4KICAgICAgICBQb3VyIGNldHRlIFYxLCBpbCBhdXJhIGF1dG9tYXRpcXVlbWVudCB1bgog
ICAgICAgICMgZ8OpbsOpcmFsIGV0IHVuIPCflIogdm9jYWwuIFBhcyBkJ2F1dHJlcyBzYWxvbnMgcG91ciBsJ2luc3RhbnQuCiAgICAgIDwvcD4KCiAgICAg
IDxmb3JtCiAgICAgICAgaWQ9ImNyZWF0ZVNlcnZlckZvcm0iCiAgICAgICAgY2xhc3M9InBlb3BsZS1zZXJ2ZXItZm9ybSIKICAgICAgPgogICAgICAgIDxs
YWJlbCBmb3I9ImNyZWF0ZVNlcnZlck5hbWVJbnB1dCI+CiAgICAgICAgICBOT00gRFUgU0VSVkVVUgogICAgICAgIDwvbGFiZWw+CgogICAgICAgIDxpbnB1
dAogICAgICAgICAgaWQ9ImNyZWF0ZVNlcnZlck5hbWVJbnB1dCIKICAgICAgICAgIG1heGxlbmd0aD0iNDAiCiAgICAgICAgICBtaW5sZW5ndGg9IjIiCiAg
ICAgICAgICBwbGFjZWhvbGRlcj0iTW9uIHNlcnZldXIiCiAgICAgICAgICBhdXRvY29tcGxldGU9Im9mZiIKICAgICAgICAgIHJlcXVpcmVkCiAgICAgICAg
Lz4KCiAgICAgICAgPGRpdgogICAgICAgICAgaWQ9ImNyZWF0ZVNlcnZlckVycm9yIgogICAgICAgICAgY2xhc3M9InBlb3BsZS1zZXJ2ZXItZXJyb3IiCiAg
ICAgICAgPjwvZGl2PgoKICAgICAgICA8YnV0dG9uCiAgICAgICAgICBjbGFzcz0icGVvcGxlLXNlcnZlci1wcmltYXJ5IgogICAgICAgICAgdHlwZT0ic3Vi
bWl0IgogICAgICAgID4KICAgICAgICAgIENyw6llcgogICAgICAgIDwvYnV0dG9uPgogICAgICA8L2Zvcm0+CiAgICA8L3NlY3Rpb24+CiAgPC9kaXY+Cgog
IDxkaXYKICAgIGlkPSJzZXJ2ZXJJbnZpdGVNb2RhbCIKICAgIGNsYXNzPSJwZW9wbGUtc2VydmVyLW1vZGFsIGhpZGRlbiIKICA+CiAgICA8c2VjdGlvbgog
ICAgICBjbGFzcz0icGVvcGxlLXNlcnZlci1tb2RhbC1jYXJkIHBlb3BsZS1pbnZpdGUtY2FyZCIKICAgICAgcm9sZT0iZGlhbG9nIgogICAgICBhcmlhLW1v
ZGFsPSJ0cnVlIgogICAgPgogICAgICA8YnV0dG9uCiAgICAgICAgaWQ9InNlcnZlckludml0ZU1vZGFsQ2xvc2UiCiAgICAgICAgY2xhc3M9InBlb3BsZS1z
ZXJ2ZXItbW9kYWwtY2xvc2UiCiAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICAgIGFyaWEtbGFiZWw9IkZlcm1lciIKICAgICAgPuKclTwvYnV0dG9uPgoK
ICAgICAgPGRpdgogICAgICAgIGlkPSJpbnZpdGVTZXJ2ZXJJY29uIgogICAgICAgIGNsYXNzPSJwZW9wbGUtaW52aXRlLWljb24iCiAgICAgID4/PC9kaXY+
CgogICAgICA8IS0tIFBFT1BMRV9JTlZJVEVfVU5BVkFJTEFCTEVfVUlfVjEgLS0+CiAgICAgIDxwIGlkPSJpbnZpdGVJbnRyb1RleHQiPlR1IGFzIHJlw6d1
IHVuZSBpbnZpdGF0aW9uIHBvdXIgcmVqb2luZHJlPC9wPgoKICAgICAgPGgyIGlkPSJpbnZpdGVTZXJ2ZXJOYW1lIj4KICAgICAgICBTZXJ2ZXVyCiAgICAg
IDwvaDI+CgogICAgICA8cCBpZD0iaW52aXRlU2VydmVyTWVtYmVycyI+CiAgICAgICAgMCBtZW1icmUKICAgICAgPC9wPgoKICAgICAgPGRpdgogICAgICAg
IGlkPSJpbnZpdGVFcnJvciIKICAgICAgICBjbGFzcz0icGVvcGxlLXNlcnZlci1lcnJvciIKICAgICAgPjwvZGl2PgoKICAgICAgPGJ1dHRvbgogICAgICAg
IGlkPSJpbnZpdGVKb2luQnV0dG9uIgogICAgICAgIGNsYXNzPSJwZW9wbGUtc2VydmVyLXByaW1hcnkiCiAgICAgICAgdHlwZT0iYnV0dG9uIgogICAgICA+
CiAgICAgICAgUmVqb2luZHJlIGxlIHNlcnZldXIKICAgICAgPC9idXR0b24+CiAgICA8L3NlY3Rpb24+CiAgPC9kaXY+CgoKICA8ZGl2IGlkPSJhdWRpb0Nv
bnRhaW5lciI+PC9kaXY+CgogIDxzY3JpcHQgc3JjPSIvc29ja2V0LmlvL3NvY2tldC5pby5qcyI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1v
ZmZsaW5lLmpzP3Y9cGVvcGxlLW9mZmxpbmUtdjEtMjAyNjA5MTYiPjwvc2NyaXB0PgogIDxzY3JpcHQgc3JjPSJwZW9wbGUtYXZhdGFycy5qcyI+PC9zY3Jp
cHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1yaWNoLWNvbnRlbnQuanM/dj1wZW9wbGUtYXR0YWNobWVudHMtdjMtcHJldmlldy1zaXplLTIwMjYwOTE2Ij48
L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLW1lc3NhZ2UtYWN0aW9ucy5qcz92PXBlb3BsZS1hdHRhY2htZW50cy12MS0yMDI2MDkxNiI+PC9zY3Jp
cHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1jYW1lcmEtZWZmZWN0cy5qcz92PXBlb3BsZS1jYXQtZml4LXY4LTItMjAyNjA5MTFhIj48L3NjcmlwdD4KICA8
c2NyaXB0IHNyYz0iYXBwLmpzP3Y9cGVvcGxlLXJvbGVzLXYxLTIwMjYwOTE2Ij48L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLWF2YXRhci1jcm9w
cGVyLmpzIj48L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLWF2YXRhci11bHRyYS5qcyI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1z
ZXR0aW5ncy5qcz92PXBlb3BsZS1jYW1lcmEtZGV2aWNlLXYxLTIwMjYwOTExYSI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1ub3RpZmljYXRp
b24tcHJlZnMuanM/dj1wZW9wbGUtbm90aWZpY2F0aW9uLXByZWZzLXYxLTIwMjYwOTE2Ij48L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLXNvY2lh
bC5qcz92PXBlb3BsZS1hdHRhY2htZW50cy12MS0yMDI2MDkxNiI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1zZXJ2ZXItZTJlZS5qcz92PXBl
b3BsZS1zZXJ2ZXItZTJlZS12MTFhLTIwMjYwOTE2Ij48L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLW1lc3NhZ2UtcmVhY3Rpb25zLmpzP3Y9cGVv
cGxlLXJlYWN0aW9ucy12MS0yMDI2MDkxNiI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1zZXJ2ZXJzLmpzIj48L3NjcmlwdD4KICA8c2NyaXB0
IHNyYz0icGVvcGxlLXNlcnZlci1jaGFubmVscy5qcz92PXBlb3BsZS1yb2xlcy12MS0yMDI2MDkxNiI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3Bs
ZS1zZXJ2ZXItc2V0dGluZ3MuanM/dj1wZW9wbGUtcm9sZXMtdjEtMjAyNjA5MTYiPjwvc2NyaXB0PgogIDxzY3JpcHQgc3JjPSJwZW9wbGUtbG9jYWwtY29u
dHJvbHMuanM/dj1wZW9wbGUtc2VydmVyLXZvaWNlLXVpLXYxLTIwMjYwOTExYSI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1wYWdlLXRpdGxl
LmpzIj48L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLW1vYmlsZS5qcyI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1kbS1jYWxscy5q
cz92PXBlb3BsZS1yZWR1Y3Rpb24tdjItMi0yMDI2MDkxMWEiPjwvc2NyaXB0PgogIDxzY3JpcHQgc3JjPSJwZW9wbGUtbWVkaWEtZnVsbHNjcmVlbi5qcz92
PXBlb3BsZS1tZWRpYS1mdWxsc2NyZWVuLXYxLTIwMjYwOTExYSI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1pbWFnZS12aWV3ZXIuanM/dj1w
ZW9wbGUtaW1hZ2Utdmlld2VyLXYxLTIwMjYwOTExYSI+PC9zY3JpcHQ+CiAgPHNjcmlwdCBzcmM9InBlb3BsZS1zZXJ2ZXItdm9pY2UtdWkuanM/dj1wZW9w
bGUtc2VydmVyLXZvaWNlLXVpLXYxLTIwMjYwOTExYSI+PC9zY3JpcHQ+CiAgICAgIDxzY3JpcHQgc3JjPSJwZW9wbGUtYXBwZWFyYW5jZS1zZXR0aW5ncy12
Mi5qcz92PXBlb3BsZS1hcHBlYXJhbmNlLXNldHRpbmdzLXYyLTMtMjAyNjA5MTFhIj48L3NjcmlwdD4KICAgICAgPHNjcmlwdCBzcmM9InBlb3BsZS10aGVt
ZS1zdHVkaW8uanM/dj1wZW9wbGUtdGhlbWUtc3R1ZGlvLXYxIj48L3NjcmlwdD4KICA8c2NyaXB0IHNyYz0icGVvcGxlLXVucmVhZC5qcz92PXBlb3BsZS11
bnJlYWQtdjEtMjAyNjA5MTYiPjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K
#</FILE_INDEX>

#<FILE_SW>
InVzZSBzdHJpY3QiOwoKY29uc3QgUEVPUExFX05PVElGSUNBVElPTlNfU1dfVkVSU0lPTiA9ICIyMDI2MDkxNi1zZXJ2ZXItZTJlZS12MTFhIjsKY29uc3Qg
UEVPUExFX1NIRUxMX0NBQ0hFID0gInBlb3BsZS1zaGVsbC0yMDI2MDkxNi1zZXJ2ZXItZTJlZS12MTFhIjsKY29uc3QgUEVPUExFX1NIRUxMX0FTU0VUUyA9
IFsKICAiLyIsCiAgIi9pbmRleC5odG1sIiwKICAiL3NvY2tldC5pby9zb2NrZXQuaW8uanMiLAogICIvc3R5bGUuY3NzIiwKICAiL3Blb3BsZS1vZmZsaW5l
LmNzcyIsCiAgIi9wZW9wbGUtb2ZmbGluZS5qcyIsCiAgIi9wZW9wbGUtYXZhdGFycy5qcyIsCiAgIi9wZW9wbGUtcmljaC1jb250ZW50LmpzIiwKICAiL3Bl
b3BsZS1tZXNzYWdlLWFjdGlvbnMuanMiLAogICIvcGVvcGxlLWNhbWVyYS1lZmZlY3RzLmpzIiwKICAiL2FwcC5qcyIsCiAgIi9wZW9wbGUtYXZhdGFyLWNy
b3BwZXIuanMiLAogICIvcGVvcGxlLWF2YXRhci11bHRyYS5qcyIsCiAgIi9wZW9wbGUtc2V0dGluZ3MuanMiLAogICIvcGVvcGxlLW5vdGlmaWNhdGlvbi1w
cmVmcy5qcyIsCiAgIi9wZW9wbGUtc29jaWFsLmpzIiwKICAiL3Blb3BsZS1zZXJ2ZXItZTJlZS5qcyIsCiAgIi9wZW9wbGUtbWVzc2FnZS1yZWFjdGlvbnMu
anMiLAogICIvcGVvcGxlLXNlcnZlcnMuanMiLAogICIvcGVvcGxlLXNlcnZlci1jaGFubmVscy5qcyIsCiAgIi9wZW9wbGUtc2VydmVyLXNldHRpbmdzLmpz
IiwKICAiL3Blb3BsZS1sb2NhbC1jb250cm9scy5qcyIsCiAgIi9wZW9wbGUtcGFnZS10aXRsZS5qcyIsCiAgIi9wZW9wbGUtbW9iaWxlLmpzIiwKICAiL3Bl
b3BsZS1kbS1jYWxscy5qcyIsCiAgIi9wZW9wbGUtbWVkaWEtZnVsbHNjcmVlbi5qcyIsCiAgIi9wZW9wbGUtaW1hZ2Utdmlld2VyLmpzIiwKICAiL3Blb3Bs
ZS1zZXJ2ZXItdm9pY2UtdWkuanMiLAogICIvcGVvcGxlLWFwcGVhcmFuY2Utc2V0dGluZ3MtdjIuanMiLAogICIvcGVvcGxlLXRoZW1lLXN0dWRpby5qcyIs
CiAgIi9wZW9wbGUtdW5yZWFkLmpzIiwKICAiL3Blb3BsZS1hcHBlYXJhbmNlLmNzcyIsCiAgIi9wZW9wbGUtc2V0dGluZ3MuY3NzIiwKICAiL3Blb3BsZS1u
b3RpZmljYXRpb24tcHJlZnMuY3NzIiwKICAiL3Blb3BsZS1zZXJ2ZXItY2hhbm5lbHMuY3NzIiwKICAiL3Blb3BsZS1zZXJ2ZXItc2V0dGluZ3MuY3NzIiwK
ICAiL3Blb3BsZS1kbS1jYWxscy5jc3MiLAogICIvcGVvcGxlLW1vYmlsZS5jc3MiLAogICIvcGVvcGxlLW1lZGlhLWZ1bGxzY3JlZW4uY3NzIiwKICAiL3Bl
b3BsZS1pbWFnZS12aWV3ZXIuY3NzIiwKICAiL3Blb3BsZS1zZXJ2ZXItdm9pY2UtdWkuY3NzIiwKICAiL3Blb3BsZS1hcHBlYXJhbmNlLXNldHRpbmdzLXYy
LmNzcyIsCiAgIi9wZW9wbGUtdGhlbWUtc3R1ZGlvLmNzcyIsCiAgIi9wZW9wbGUtdW5yZWFkLmNzcyIsCiAgIi9wZW9wbGUtY29tcG9zZXItbG93ZXIuY3Nz
IgpdOwoKc2VsZi5hZGRFdmVudExpc3RlbmVyKCJpbnN0YWxsIiwgKGV2ZW50KSA9PiB7CiAgZXZlbnQud2FpdFVudGlsKAogICAgKGFzeW5jICgpID0+IHsK
ICAgICAgY29uc3QgY2FjaGUgPSBhd2FpdCBjYWNoZXMub3BlbihQRU9QTEVfU0hFTExfQ0FDSEUpOwogICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQo
CiAgICAgICAgUEVPUExFX1NIRUxMX0FTU0VUUy5tYXAoYXN5bmMgKHVybCkgPT4gewogICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1
cmwsIHsgY2FjaGU6ICJyZWxvYWQiIH0pOwogICAgICAgICAgaWYgKHJlc3BvbnNlLm9rKSBhd2FpdCBjYWNoZS5wdXQodXJsLCByZXNwb25zZS5jbG9uZSgp
KTsKICAgICAgICB9KQogICAgICApOwogICAgICBhd2FpdCBzZWxmLnNraXBXYWl0aW5nKCk7CiAgICB9KSgpCiAgKTsKfSk7CgpzZWxmLmFkZEV2ZW50TGlz
dGVuZXIoImFjdGl2YXRlIiwgKGV2ZW50KSA9PiB7CiAgZXZlbnQud2FpdFVudGlsKAogICAgKGFzeW5jICgpID0+IHsKICAgICAgY29uc3Qga2V5cyA9IGF3
YWl0IGNhY2hlcy5rZXlzKCk7CiAgICAgIGF3YWl0IFByb21pc2UuYWxsKAogICAgICAgIGtleXMKICAgICAgICAgIC5maWx0ZXIoKGtleSkgPT4ga2V5LnN0
YXJ0c1dpdGgoInBlb3BsZS1zaGVsbC0iKSAmJiBrZXkgIT09IFBFT1BMRV9TSEVMTF9DQUNIRSkKICAgICAgICAgIC5tYXAoKGtleSkgPT4gY2FjaGVzLmRl
bGV0ZShrZXkpKQogICAgICApOwogICAgICBhd2FpdCBzZWxmLmNsaWVudHMuY2xhaW0oKTsKICAgIH0pKCkKICApOwp9KTsKCnNlbGYuYWRkRXZlbnRMaXN0
ZW5lcigiZmV0Y2giLCAoZXZlbnQpID0+IHsKICBjb25zdCByZXF1ZXN0ID0gZXZlbnQucmVxdWVzdDsKICBpZiAocmVxdWVzdC5tZXRob2QgIT09ICJHRVQi
KSByZXR1cm47CgogIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwpOwogIGlmICh1cmwub3JpZ2luICE9PSBzZWxmLmxvY2F0aW9uLm9yaWdpbikg
cmV0dXJuOwogIGlmICh1cmwucGF0aG5hbWUuc3RhcnRzV2l0aCgiL2FwaS8iKSkgcmV0dXJuOwogIGlmICh1cmwucGF0aG5hbWUuc3RhcnRzV2l0aCgiL3Nv
Y2tldC5pby8iKSAmJiB1cmwucGF0aG5hbWUgIT09ICIvc29ja2V0LmlvL3NvY2tldC5pby5qcyIpIHJldHVybjsKCiAgaWYgKHJlcXVlc3QubW9kZSA9PT0g
Im5hdmlnYXRlIikgewogICAgZXZlbnQucmVzcG9uZFdpdGgoCiAgICAgIChhc3luYyAoKSA9PiB7CiAgICAgICAgdHJ5IHsKICAgICAgICAgIGNvbnN0IGZy
ZXNoID0gYXdhaXQgZmV0Y2gocmVxdWVzdCk7CiAgICAgICAgICBpZiAoZnJlc2gub2spIHsKICAgICAgICAgICAgY29uc3QgY2FjaGUgPSBhd2FpdCBjYWNo
ZXMub3BlbihQRU9QTEVfU0hFTExfQ0FDSEUpOwogICAgICAgICAgICBhd2FpdCBjYWNoZS5wdXQoIi8iLCBmcmVzaC5jbG9uZSgpKTsKICAgICAgICAgIH0K
ICAgICAgICAgIHJldHVybiBmcmVzaDsKICAgICAgICB9IGNhdGNoIHsKICAgICAgICAgIHJldHVybiAoYXdhaXQgY2FjaGVzLm1hdGNoKHJlcXVlc3QpKSB8
fCAoYXdhaXQgY2FjaGVzLm1hdGNoKCIvIikpIHx8IFJlc3BvbnNlLmVycm9yKCk7CiAgICAgICAgfQogICAgICB9KSgpCiAgICApOwogICAgcmV0dXJuOwog
IH0KCiAgY29uc3QgaXNTdGF0aWMgPSAvXC4oPzpqc3xjc3N8cG5nfGpwZ3xqcGVnfHdlYnB8Z2lmfGljb3xzdmd8d29mZjI/KSQvaS50ZXN0KHVybC5wYXRo
bmFtZSk7CiAgaWYgKCFpc1N0YXRpYykgcmV0dXJuOwoKICBldmVudC5yZXNwb25kV2l0aCgKICAgIChhc3luYyAoKSA9PiB7CiAgICAgIGNvbnN0IGNhY2hl
ZCA9IGF3YWl0IGNhY2hlcy5tYXRjaChyZXF1ZXN0LCB7IGlnbm9yZVNlYXJjaDogdHJ1ZSB9KTsKICAgICAgY29uc3QgcmVmcmVzaCA9IGZldGNoKHJlcXVl
c3QpCiAgICAgICAgLnRoZW4oYXN5bmMgKHJlc3BvbnNlKSA9PiB7CiAgICAgICAgICBpZiAocmVzcG9uc2Uub2spIHsKICAgICAgICAgICAgY29uc3QgY2Fj
aGUgPSBhd2FpdCBjYWNoZXMub3BlbihQRU9QTEVfU0hFTExfQ0FDSEUpOwogICAgICAgICAgICBhd2FpdCBjYWNoZS5wdXQocmVxdWVzdCwgcmVzcG9uc2Uu
Y2xvbmUoKSk7CiAgICAgICAgICB9CiAgICAgICAgICByZXR1cm4gcmVzcG9uc2U7CiAgICAgICAgfSkKICAgICAgICAuY2F0Y2goKCkgPT4gbnVsbCk7Cgog
ICAgICBpZiAoY2FjaGVkKSB7CiAgICAgICAgZXZlbnQud2FpdFVudGlsKHJlZnJlc2gpOwogICAgICAgIHJldHVybiBjYWNoZWQ7CiAgICAgIH0KCiAgICAg
IHJldHVybiAoYXdhaXQgcmVmcmVzaCkgfHwgUmVzcG9uc2UuZXJyb3IoKTsKICAgIH0pKCkKICApOwp9KTsKCnNlbGYuYWRkRXZlbnRMaXN0ZW5lcigibWVz
c2FnZSIsIChldmVudCkgPT4gewogIGlmIChldmVudC5kYXRhPy50eXBlICE9PSAiUEVPUExFX1NIT1dfTk9USUZJQ0FUSU9OIikgcmV0dXJuOwoKICBjb25z
dCByZXBseVBvcnQgPSBldmVudC5wb3J0cz8uWzBdIHx8IG51bGw7CgogIGV2ZW50LndhaXRVbnRpbCgKICAgIChhc3luYyAoKSA9PiB7CiAgICAgIHRyeSB7
CiAgICAgICAgY29uc3QgdGl0bGUgPSBTdHJpbmcoZXZlbnQuZGF0YT8udGl0bGUgfHwgIlBlb3BsZSIpOwogICAgICAgIGNvbnN0IG9wdGlvbnMgPSBldmVu
dC5kYXRhPy5vcHRpb25zIHx8IHt9OwoKICAgICAgICBhd2FpdCBzZWxmLnJlZ2lzdHJhdGlvbi5zaG93Tm90aWZpY2F0aW9uKHRpdGxlLCBvcHRpb25zKTsK
CiAgICAgICAgbGV0IGNvdW50ID0gbnVsbDsKICAgICAgICB0cnkgewogICAgICAgICAgY29uc3QgY3VycmVudCA9IGF3YWl0IHNlbGYucmVnaXN0cmF0aW9u
LmdldE5vdGlmaWNhdGlvbnMoCiAgICAgICAgICAgIG9wdGlvbnM/LnRhZyA/IHsgdGFnOiBvcHRpb25zLnRhZyB9IDogdW5kZWZpbmVkCiAgICAgICAgICAp
OwogICAgICAgICAgY291bnQgPSBjdXJyZW50Lmxlbmd0aDsKICAgICAgICB9IGNhdGNoIHt9CgogICAgICAgIHJlcGx5UG9ydD8ucG9zdE1lc3NhZ2Uoewog
ICAgICAgICAgb2s6IHRydWUsCiAgICAgICAgICBjb3VudCwKICAgICAgICAgIHZlcnNpb246IFBFT1BMRV9OT1RJRklDQVRJT05TX1NXX1ZFUlNJT04KICAg
ICAgICB9KTsKICAgICAgfSBjYXRjaCAoZXJyb3IpIHsKICAgICAgICByZXBseVBvcnQ/LnBvc3RNZXNzYWdlKHsKICAgICAgICAgIG9rOiBmYWxzZSwKICAg
ICAgICAgIGVycm9yOiBlcnJvcj8ubWVzc2FnZSB8fCBTdHJpbmcoZXJyb3IpLAogICAgICAgICAgdmVyc2lvbjogUEVPUExFX05PVElGSUNBVElPTlNfU1df
VkVSU0lPTgogICAgICAgIH0pOwogICAgICB9CiAgICB9KSgpCiAgKTsKfSk7CgpzZWxmLmFkZEV2ZW50TGlzdGVuZXIoIm5vdGlmaWNhdGlvbmNsaWNrIiwg
KGV2ZW50KSA9PiB7CiAgZXZlbnQubm90aWZpY2F0aW9uLmNsb3NlKCk7CgogIGNvbnN0IHRhcmdldFVybCA9IGV2ZW50Lm5vdGlmaWNhdGlvbj8uZGF0YT8u
dXJsIHx8ICIvIjsKCiAgZXZlbnQud2FpdFVudGlsKAogICAgc2VsZi5jbGllbnRzCiAgICAgIC5tYXRjaEFsbCh7IHR5cGU6ICJ3aW5kb3ciLCBpbmNsdWRl
VW5jb250cm9sbGVkOiB0cnVlIH0pCiAgICAgIC50aGVuKGFzeW5jIChjbGllbnRMaXN0KSA9PiB7CiAgICAgICAgZm9yIChjb25zdCBjbGllbnQgb2YgY2xp
ZW50TGlzdCkgewogICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgY29uc3QgY2xpZW50VXJsID0gbmV3IFVSTChjbGllbnQudXJsKTsKICAgICAgICAgICAg
Y29uc3QgdGFyZ2V0ID0gbmV3IFVSTCh0YXJnZXRVcmwsIHNlbGYubG9jYXRpb24ub3JpZ2luKTsKCiAgICAgICAgICAgIGlmIChjbGllbnRVcmwub3JpZ2lu
ID09PSB0YXJnZXQub3JpZ2luICYmICJmb2N1cyIgaW4gY2xpZW50KSB7CiAgICAgICAgICAgICAgYXdhaXQgY2xpZW50LmZvY3VzKCk7CgogICAgICAgICAg
ICAgIGlmICgibmF2aWdhdGUiIGluIGNsaWVudCAmJiBjbGllbnQudXJsICE9PSB0YXJnZXQuaHJlZikgewogICAgICAgICAgICAgICAgdHJ5IHsKICAgICAg
ICAgICAgICAgICAgYXdhaXQgY2xpZW50Lm5hdmlnYXRlKHRhcmdldC5ocmVmKTsKICAgICAgICAgICAgICAgIH0gY2F0Y2gge30KICAgICAgICAgICAgICB9
CiAgICAgICAgICAgICAgcmV0dXJuOwogICAgICAgICAgICB9CiAgICAgICAgICB9IGNhdGNoIHt9CiAgICAgICAgfQoKICAgICAgICBpZiAoc2VsZi5jbGll
bnRzLm9wZW5XaW5kb3cpIHsKICAgICAgICAgIHJldHVybiBzZWxmLmNsaWVudHMub3BlbldpbmRvdyh0YXJnZXRVcmwpOwogICAgICAgIH0KICAgICAgfSkK
ICApOwp9KTsK
#</FILE_SW>

#<FILE_SERVER_E2EE>
KCgpID0+IHsKICAidXNlIHN0cmljdCI7CgogIC8vIFYxMUEgcHLDqXBhcmUgdW5pcXVlbWVudCBsYSBkaXN0cmlidXRpb24gZGVzIGNsw6lzIGRlIHNhbG9u
LgogIC8vIExlIHRleHRlIGRlcyBzYWxvbnMgcmVzdGUgaW5jaGFuZ8OpIGp1c3F1J8OgIFYxMUIuCiAgY29uc3QgUFJPVE9DT0wgPSAicGVvcGxlLXNlcnZl
ci1zZW5kZXIta2V5LXYxIjsKICBjb25zdCBTVUlURSA9ICJQMjU2LUhLREYtU0hBMjU2LUFFUzI1NkdDTSI7CiAgY29uc3QgREJfTkFNRSA9ICJwZW9wbGUt
c2VydmVyLWUyZWUtdjEiOwogIGNvbnN0IERCX1ZFUlNJT04gPSAxOwogIGNvbnN0IEtFWV9TVE9SRSA9ICJjaGFubmVsS2V5cyI7CiAgY29uc3QgU1RBVEVf
U1RPUkUgPSAiY2hhbm5lbFN0YXRlIjsKICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKCk7CgogIGxldCBkYlByb21pc2UgPSBudWxsOwogIGNv
bnN0IHJ1bm5pbmcgPSBuZXcgTWFwKCk7CiAgY29uc3QgbWVtb3J5UmF3ID0gbmV3IE1hcCgpOwogIGNvbnN0IHN0YXRlQ2FjaGUgPSBuZXcgTWFwKCk7Cgog
IGZ1bmN0aW9uIGJyaWRnZSgpIHsKICAgIGNvbnN0IHZhbHVlID0gd2luZG93LlBlb3BsZUUyRUVEZXZpY2U7CiAgICBpZiAoIXZhbHVlPy5lbnN1cmVEZXZp
Y2UgfHwgIXdpbmRvdy5jcnlwdG8/LnN1YnRsZSB8fCAhd2luZG93LmluZGV4ZWREQikgewogICAgICB0aHJvdyBuZXcgRXJyb3IoIkUyRUUgUGVvcGxlIGlu
ZGlzcG9uaWJsZSBzdXIgY2V0IGFwcGFyZWlsLiIpOwogICAgfQogICAgcmV0dXJuIHZhbHVlOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gYXBpKHVybCwgb3B0
aW9ucyA9IHt9KSB7CiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwgewogICAgICBjcmVkZW50aWFsczogInNhbWUtb3JpZ2luIiwKICAg
ICAgLi4ub3B0aW9ucywKICAgICAgaGVhZGVyczogewogICAgICAgIC4uLihvcHRpb25zLmJvZHkgPyB7ICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24v
anNvbiIgfSA6IHt9KSwKICAgICAgICAuLi4ob3B0aW9ucy5oZWFkZXJzIHx8IHt9KQogICAgICB9CiAgICB9KTsKICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBy
ZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7CiAgICBpZiAoIXJlc3BvbnNlLm9rIHx8IGRhdGE/Lm9rID09PSBmYWxzZSkgewogICAgICBjb25z
dCBlcnJvciA9IG5ldyBFcnJvcihkYXRhPy5lcnJvciB8fCAiRXJyZXVyIEUyRUUgc2VydmV1ci4iKTsKICAgICAgZXJyb3IuY29kZSA9IGRhdGE/LmNvZGUg
fHwgIkUyRUVfU0VSVkVSX0VSUk9SIjsKICAgICAgZXJyb3Iuc3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzOwogICAgICBlcnJvci5kYXRhID0gZGF0YTsKICAg
ICAgdGhyb3cgZXJyb3I7CiAgICB9CiAgICByZXR1cm4gZGF0YTsKICB9CgogIGZ1bmN0aW9uIG9wZW5EYigpIHsKICAgIGlmIChkYlByb21pc2UpIHJldHVy
biBkYlByb21pc2U7CiAgICBkYlByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgIGNvbnN0IHJlcXVlc3QgPSBpbmRl
eGVkREIub3BlbihEQl9OQU1FLCBEQl9WRVJTSU9OKTsKICAgICAgcmVxdWVzdC5vbnVwZ3JhZGVuZWVkZWQgPSAoKSA9PiB7CiAgICAgICAgY29uc3QgZGIg
PSByZXF1ZXN0LnJlc3VsdDsKICAgICAgICBpZiAoIWRiLm9iamVjdFN0b3JlTmFtZXMuY29udGFpbnMoS0VZX1NUT1JFKSkgewogICAgICAgICAgZGIuY3Jl
YXRlT2JqZWN0U3RvcmUoS0VZX1NUT1JFLCB7IGtleVBhdGg6ICJpZCIgfSk7CiAgICAgICAgfQogICAgICAgIGlmICghZGIub2JqZWN0U3RvcmVOYW1lcy5j
b250YWlucyhTVEFURV9TVE9SRSkpIHsKICAgICAgICAgIGRiLmNyZWF0ZU9iamVjdFN0b3JlKFNUQVRFX1NUT1JFLCB7IGtleVBhdGg6ICJpZCIgfSk7CiAg
ICAgICAgfQogICAgICB9OwogICAgICByZXF1ZXN0Lm9uc3VjY2VzcyA9ICgpID0+IHJlc29sdmUocmVxdWVzdC5yZXN1bHQpOwogICAgICByZXF1ZXN0Lm9u
ZXJyb3IgPSAoKSA9PiByZWplY3QocmVxdWVzdC5lcnJvciB8fCBuZXcgRXJyb3IoIkluZGV4ZWREQiBFMkVFIHNlcnZldXIgaW5kaXNwb25pYmxlLiIpKTsK
ICAgIH0pOwogICAgcmV0dXJuIGRiUHJvbWlzZTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGRiR2V0KHN0b3JlTmFtZSwgaWQpIHsKICAgIGNvbnN0IGRiID0g
YXdhaXQgb3BlbkRiKCk7CiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgICBjb25zdCB0eCA9IGRiLnRyYW5zYWN0
aW9uKHN0b3JlTmFtZSwgInJlYWRvbmx5Iik7CiAgICAgIGNvbnN0IHJlcXVlc3QgPSB0eC5vYmplY3RTdG9yZShzdG9yZU5hbWUpLmdldChpZCk7CiAgICAg
IHJlcXVlc3Qub25zdWNjZXNzID0gKCkgPT4gcmVzb2x2ZShyZXF1ZXN0LnJlc3VsdCB8fCBudWxsKTsKICAgICAgcmVxdWVzdC5vbmVycm9yID0gKCkgPT4g
cmVqZWN0KHJlcXVlc3QuZXJyb3IpOwogICAgfSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBkYlB1dChzdG9yZU5hbWUsIHJlY29yZCkgewogICAgY29uc3Qg
ZGIgPSBhd2FpdCBvcGVuRGIoKTsKICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7CiAgICAgIGNvbnN0IHR4ID0gZGIudHJh
bnNhY3Rpb24oc3RvcmVOYW1lLCAicmVhZHdyaXRlIik7CiAgICAgIHR4Lm9iamVjdFN0b3JlKHN0b3JlTmFtZSkucHV0KHJlY29yZCk7CiAgICAgIHR4Lm9u
Y29tcGxldGUgPSAoKSA9PiByZXNvbHZlKCk7CiAgICAgIHR4Lm9uZXJyb3IgPSAoKSA9PiByZWplY3QodHguZXJyb3IpOwogICAgICB0eC5vbmFib3J0ID0g
KCkgPT4gcmVqZWN0KHR4LmVycm9yKTsKICAgIH0pOwogIH0KCiAgZnVuY3Rpb24gc3RhdGVJZChhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQpIHsK
ICAgIHJldHVybiBbU3RyaW5nKGFjY291bnRJZCksIFN0cmluZyhzZXJ2ZXJJZCksIFN0cmluZyhjaGFubmVsSWQpXS5qb2luKCJ8Iik7CiAgfQoKICBmdW5j
dGlvbiBrZXlJZChhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQsIGVwb2NoKSB7CiAgICByZXR1cm4gW1N0cmluZyhhY2NvdW50SWQpLCBTdHJpbmco
c2VydmVySWQpLCBTdHJpbmcoY2hhbm5lbElkKSwgU3RyaW5nKGVwb2NoKV0uam9pbigifCIpOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gc2F2ZVN0YXRlKGFj
Y291bnRJZCwgc2VydmVySWQsIGNoYW5uZWxJZCwgc3RhdGUpIHsKICAgIGNvbnN0IGlkID0gc3RhdGVJZChhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVs
SWQpOwogICAgY29uc3QgcmVjb3JkID0gewogICAgICBpZCwKICAgICAgYWNjb3VudElkOiBTdHJpbmcoYWNjb3VudElkKSwKICAgICAgc2VydmVySWQ6IFN0
cmluZyhzZXJ2ZXJJZCksCiAgICAgIGNoYW5uZWxJZDogU3RyaW5nKGNoYW5uZWxJZCksCiAgICAgIGVwb2NoOiBOdW1iZXIoc3RhdGU/LmVwb2NoIHx8IDAp
LAogICAgICBzdGF0dXM6IFN0cmluZyhzdGF0ZT8uc3RhdHVzIHx8ICJwZW5kaW5nIiksCiAgICAgIHByb3RvY29sOiBTdHJpbmcoc3RhdGU/LnByb3RvY29s
IHx8IFBST1RPQ09MKSwKICAgICAgc3VpdGU6IFN0cmluZyhzdGF0ZT8uc3VpdGUgfHwgU1VJVEUpLAogICAgICB1cGRhdGVkQXQ6IERhdGUubm93KCkKICAg
IH07CiAgICBzdGF0ZUNhY2hlLnNldChpZCwgcmVjb3JkKTsKICAgIGF3YWl0IGRiUHV0KFNUQVRFX1NUT1JFLCByZWNvcmQpOwogICAgZGlzcGF0Y2hTdGF0
dXMocmVjb3JkKTsKICAgIHJldHVybiByZWNvcmQ7CiAgfQoKICBhc3luYyBmdW5jdGlvbiByZWFkU3RhdGUoYWNjb3VudElkLCBzZXJ2ZXJJZCwgY2hhbm5l
bElkKSB7CiAgICBjb25zdCBpZCA9IHN0YXRlSWQoYWNjb3VudElkLCBzZXJ2ZXJJZCwgY2hhbm5lbElkKTsKICAgIGlmIChzdGF0ZUNhY2hlLmhhcyhpZCkp
IHJldHVybiBzdGF0ZUNhY2hlLmdldChpZCk7CiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBkYkdldChTVEFURV9TVE9SRSwgaWQpOwogICAgaWYgKHJlY29y
ZCkgc3RhdGVDYWNoZS5zZXQoaWQsIHJlY29yZCk7CiAgICByZXR1cm4gcmVjb3JkOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gc2F2ZUtleShhY2NvdW50SWQs
IHNlcnZlcklkLCBjaGFubmVsSWQsIGVwb2NoLCBrZXkpIHsKICAgIGF3YWl0IGRiUHV0KEtFWV9TVE9SRSwgewogICAgICBpZDoga2V5SWQoYWNjb3VudElk
LCBzZXJ2ZXJJZCwgY2hhbm5lbElkLCBlcG9jaCksCiAgICAgIGFjY291bnRJZDogU3RyaW5nKGFjY291bnRJZCksCiAgICAgIHNlcnZlcklkOiBTdHJpbmco
c2VydmVySWQpLAogICAgICBjaGFubmVsSWQ6IFN0cmluZyhjaGFubmVsSWQpLAogICAgICBlcG9jaDogTnVtYmVyKGVwb2NoKSwKICAgICAga2V5LAogICAg
ICBjcmVhdGVkQXQ6IERhdGUubm93KCkKICAgIH0pOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gcmVhZEtleShhY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVs
SWQsIGVwb2NoKSB7CiAgICBjb25zdCByZWNvcmQgPSBhd2FpdCBkYkdldChLRVlfU1RPUkUsIGtleUlkKGFjY291bnRJZCwgc2VydmVySWQsIGNoYW5uZWxJ
ZCwgZXBvY2gpKTsKICAgIHJldHVybiByZWNvcmQ/LmtleSB8fCBudWxsOwogIH0KCiAgZnVuY3Rpb24gZGlzcGF0Y2hTdGF0dXMoZGV0YWlsKSB7CiAgICB3
aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoInBlb3BsZS1zZXJ2ZXItZTJlZS1zdGF0dXMiLCB7IGRldGFpbCB9KSk7CiAgfQoKICBmdW5j
dGlvbiBieXRlc1RvQmFzZTY0VXJsKGJ5dGVzKSB7CiAgICByZXR1cm4gYnJpZGdlKCkuYnl0ZXNUb0Jhc2U2NFVybChieXRlcyk7CiAgfQoKICBmdW5jdGlv
biBiYXNlNjRVcmxUb0J5dGVzKHZhbHVlKSB7CiAgICByZXR1cm4gYnJpZGdlKCkuYmFzZTY0VXJsVG9CeXRlcyh2YWx1ZSk7CiAgfQoKICBmdW5jdGlvbiBz
ZXJ2ZXJTYWx0KHNlcnZlcklkLCBjaGFubmVsSWQsIGVwb2NoKSB7CiAgICByZXR1cm4gZW5jb2Rlci5lbmNvZGUoCiAgICAgIGBQZW9wbGUgRTJFRSBTZXJ2
ZXIgc2FsdCB2MXwke3NlcnZlcklkfXwke2NoYW5uZWxJZH18JHtlcG9jaH1gCiAgICApOwogIH0KCiAgZnVuY3Rpb24gc2VydmVySW5mbyhzZXJ2ZXJJZCwg
Y2hhbm5lbElkLCBlcG9jaCwgc2VuZGVyRGV2aWNlSWQsIHRhcmdldFVzZXJJZCwgdGFyZ2V0RGV2aWNlSWQpIHsKICAgIHJldHVybiBlbmNvZGVyLmVuY29k
ZSgKICAgICAgYFBlb3BsZSBFMkVFIFNlcnZlciB3cmFwIHYxfCR7c2VydmVySWR9fCR7Y2hhbm5lbElkfXwke2Vwb2NofXwke3NlbmRlckRldmljZUlkfXwk
e3RhcmdldFVzZXJJZH18JHt0YXJnZXREZXZpY2VJZH1gCiAgICApOwogIH0KCiAgZnVuY3Rpb24gc2VydmVyQWFkKHNlcnZlcklkLCBjaGFubmVsSWQsIGVw
b2NoLCBzZW5kZXJVc2VySWQsIHNlbmRlckRldmljZUlkLCB0YXJnZXRVc2VySWQsIHRhcmdldERldmljZUlkKSB7CiAgICByZXR1cm4gZW5jb2Rlci5lbmNv
ZGUoCiAgICAgIGBQZW9wbGUgRTJFRSBTZXJ2ZXIga2V5IHYxfCR7c2VydmVySWR9fCR7Y2hhbm5lbElkfXwke2Vwb2NofXwke3NlbmRlclVzZXJJZH18JHtz
ZW5kZXJEZXZpY2VJZH18JHt0YXJnZXRVc2VySWR9fCR7dGFyZ2V0RGV2aWNlSWR9YAogICAgKTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGRlcml2ZVdyYXBL
ZXkoZGV2aWNlLCBwZWVyUHVibGljSndrLCBjb250ZXh0KSB7CiAgICBjb25zdCBwZWVyUHVibGljID0gYXdhaXQgYnJpZGdlKCkuaW1wb3J0UHVibGljS2V5
KHBlZXJQdWJsaWNKd2spOwogICAgY29uc3Qgc2hhcmVkQml0cyA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGVyaXZlQml0cygKICAgICAgeyBuYW1lOiAiRUNE
SCIsIHB1YmxpYzogcGVlclB1YmxpYyB9LAogICAgICBkZXZpY2UucHJpdmF0ZUtleSwKICAgICAgMjU2CiAgICApOwogICAgY29uc3QgaGtkZktleSA9IGF3
YWl0IGNyeXB0by5zdWJ0bGUuaW1wb3J0S2V5KAogICAgICAicmF3IiwKICAgICAgc2hhcmVkQml0cywKICAgICAgIkhLREYiLAogICAgICBmYWxzZSwKICAg
ICAgWyJkZXJpdmVLZXkiXQogICAgKTsKICAgIHJldHVybiBjcnlwdG8uc3VidGxlLmRlcml2ZUtleSgKICAgICAgewogICAgICAgIG5hbWU6ICJIS0RGIiwK
ICAgICAgICBoYXNoOiAiU0hBLTI1NiIsCiAgICAgICAgc2FsdDogc2VydmVyU2FsdChjb250ZXh0LnNlcnZlcklkLCBjb250ZXh0LmNoYW5uZWxJZCwgY29u
dGV4dC5lcG9jaCksCiAgICAgICAgaW5mbzogc2VydmVySW5mbygKICAgICAgICAgIGNvbnRleHQuc2VydmVySWQsCiAgICAgICAgICBjb250ZXh0LmNoYW5u
ZWxJZCwKICAgICAgICAgIGNvbnRleHQuZXBvY2gsCiAgICAgICAgICBjb250ZXh0LnNlbmRlckRldmljZUlkLAogICAgICAgICAgY29udGV4dC50YXJnZXRV
c2VySWQsCiAgICAgICAgICBjb250ZXh0LnRhcmdldERldmljZUlkCiAgICAgICAgKQogICAgICB9LAogICAgICBoa2RmS2V5LAogICAgICB7IG5hbWU6ICJB
RVMtR0NNIiwgbGVuZ3RoOiAyNTYgfSwKICAgICAgZmFsc2UsCiAgICAgIFsiZW5jcnlwdCIsICJkZWNyeXB0Il0KICAgICk7CiAgfQoKICBhc3luYyBmdW5j
dGlvbiBrZXlDb21taXRtZW50KHJhd0tleSkgewogICAgY29uc3QgZGlnZXN0ID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoIlNIQS0yNTYiLCByYXdL
ZXkpOwogICAgcmV0dXJuIGJ5dGVzVG9CYXNlNjRVcmwobmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBpbXBvcnRDaGFu
bmVsS2V5KHJhd0tleSkgewogICAgcmV0dXJuIGNyeXB0by5zdWJ0bGUuaW1wb3J0S2V5KAogICAgICAicmF3IiwKICAgICAgcmF3S2V5LAogICAgICB7IG5h
bWU6ICJBRVMtR0NNIiwgbGVuZ3RoOiAyNTYgfSwKICAgICAgZmFsc2UsCiAgICAgIFsiZW5jcnlwdCIsICJkZWNyeXB0Il0KICAgICk7CiAgfQoKICBhc3lu
YyBmdW5jdGlvbiB3cmFwQ2hhbm5lbEtleShyYXdLZXksIGRldmljZSwgcmVjaXBpZW50LCBjb250ZXh0KSB7CiAgICBjb25zdCB3cmFwS2V5ID0gYXdhaXQg
ZGVyaXZlV3JhcEtleShkZXZpY2UsIHJlY2lwaWVudC5wdWJsaWNKd2ssIHsKICAgICAgLi4uY29udGV4dCwKICAgICAgdGFyZ2V0VXNlcklkOiByZWNpcGll
bnQudXNlcklkLAogICAgICB0YXJnZXREZXZpY2VJZDogcmVjaXBpZW50LmRldmljZUlkCiAgICB9KTsKICAgIGNvbnN0IGl2ID0gY3J5cHRvLmdldFJhbmRv
bVZhbHVlcyhuZXcgVWludDhBcnJheSgxMikpOwogICAgY29uc3QgZW5jcnlwdGVkID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5lbmNyeXB0KAogICAgICB7CiAg
ICAgICAgbmFtZTogIkFFUy1HQ00iLAogICAgICAgIGl2LAogICAgICAgIGFkZGl0aW9uYWxEYXRhOiBzZXJ2ZXJBYWQoCiAgICAgICAgICBjb250ZXh0LnNl
cnZlcklkLAogICAgICAgICAgY29udGV4dC5jaGFubmVsSWQsCiAgICAgICAgICBjb250ZXh0LmVwb2NoLAogICAgICAgICAgZGV2aWNlLmFjY291bnRJZCwK
ICAgICAgICAgIGRldmljZS5kZXZpY2VJZCwKICAgICAgICAgIHJlY2lwaWVudC51c2VySWQsCiAgICAgICAgICByZWNpcGllbnQuZGV2aWNlSWQKICAgICAg
ICApCiAgICAgIH0sCiAgICAgIHdyYXBLZXksCiAgICAgIHJhd0tleQogICAgKTsKICAgIHJldHVybiB7CiAgICAgIHVzZXJJZDogU3RyaW5nKHJlY2lwaWVu
dC51c2VySWQpLAogICAgICBkZXZpY2VJZDogU3RyaW5nKHJlY2lwaWVudC5kZXZpY2VJZCksCiAgICAgIGl2OiBieXRlc1RvQmFzZTY0VXJsKGl2KSwKICAg
ICAgY3Q6IGJ5dGVzVG9CYXNlNjRVcmwobmV3IFVpbnQ4QXJyYXkoZW5jcnlwdGVkKSkKICAgIH07CiAgfQoKICBhc3luYyBmdW5jdGlvbiB1bndyYXBDaGFu
bmVsS2V5KHBheWxvYWQsIGRldmljZSwgc3RhdGUsIHNlcnZlcklkLCBjaGFubmVsSWQpIHsKICAgIGlmICghcGF5bG9hZD8uaXYgfHwgIXBheWxvYWQ/LmN0
IHx8ICFzdGF0ZT8uc2VuZGVyPy5wdWJsaWNKd2spIHsKICAgICAgdGhyb3cgbmV3IEVycm9yKCJFbnZlbG9wcGUgRTJFRSBkdSBzYWxvbiBpbmNvbXBsw6h0
ZS4iKTsKICAgIH0KICAgIGNvbnN0IHdyYXBLZXkgPSBhd2FpdCBkZXJpdmVXcmFwS2V5KGRldmljZSwgc3RhdGUuc2VuZGVyLnB1YmxpY0p3aywgewogICAg
ICBzZXJ2ZXJJZCwKICAgICAgY2hhbm5lbElkLAogICAgICBlcG9jaDogc3RhdGUuZXBvY2gsCiAgICAgIHNlbmRlckRldmljZUlkOiBzdGF0ZS5zZW5kZXIu
ZGV2aWNlSWQsCiAgICAgIHRhcmdldFVzZXJJZDogZGV2aWNlLmFjY291bnRJZCwKICAgICAgdGFyZ2V0RGV2aWNlSWQ6IGRldmljZS5kZXZpY2VJZAogICAg
fSk7CiAgICBjb25zdCByYXcgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmRlY3J5cHQoCiAgICAgIHsKICAgICAgICBuYW1lOiAiQUVTLUdDTSIsCiAgICAgICAg
aXY6IGJhc2U2NFVybFRvQnl0ZXMocGF5bG9hZC5pdiksCiAgICAgICAgYWRkaXRpb25hbERhdGE6IHNlcnZlckFhZCgKICAgICAgICAgIHNlcnZlcklkLAog
ICAgICAgICAgY2hhbm5lbElkLAogICAgICAgICAgc3RhdGUuZXBvY2gsCiAgICAgICAgICBzdGF0ZS5zZW5kZXIudXNlcklkLAogICAgICAgICAgc3RhdGUu
c2VuZGVyLmRldmljZUlkLAogICAgICAgICAgZGV2aWNlLmFjY291bnRJZCwKICAgICAgICAgIGRldmljZS5kZXZpY2VJZAogICAgICAgICkKICAgICAgfSwK
ICAgICAgd3JhcEtleSwKICAgICAgYmFzZTY0VXJsVG9CeXRlcyhwYXlsb2FkLmN0KQogICAgKTsKICAgIGNvbnN0IGNvbW1pdG1lbnQgPSBhd2FpdCBrZXlD
b21taXRtZW50KHJhdyk7CiAgICBpZiAoIXN0YXRlLmNvbW1pdG1lbnQgfHwgY29tbWl0bWVudCAhPT0gU3RyaW5nKHN0YXRlLmNvbW1pdG1lbnQpKSB7CiAg
ICAgIHRocm93IG5ldyBFcnJvcigiTGEgY2zDqSBFMkVFIGR1IHNhbG9uIG5lIGNvcnJlc3BvbmQgcGFzIMOgIHNvbiBlbmdhZ2VtZW50IGNyeXB0b2dyYXBo
aXF1ZS4iKTsKICAgIH0KICAgIHJldHVybiBpbXBvcnRDaGFubmVsS2V5KHJhdyk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBsb2FkUmVjaXBpZW50cyhzZXJ2
ZXJJZCwgY2hhbm5lbElkLCBlcG9jaCwgZGV2aWNlSWQpIHsKICAgIGNvbnN0IG91dHB1dCA9IFtdOwogICAgbGV0IGN1cnNvciA9ICIwIjsKICAgIGZvciAo
bGV0IHBhZ2UgPSAwOyBwYWdlIDwgMTAwMDAwOyBwYWdlICs9IDEpIHsKICAgICAgY29uc3QgZGF0YSA9IGF3YWl0IGFwaSgKICAgICAgICBgL2FwaS9zZXJ2
ZXJzLyR7ZW5jb2RlVVJJQ29tcG9uZW50KHNlcnZlcklkKX0vZTJlZS9jaGFubmVscy8ke2VuY29kZVVSSUNvbXBvbmVudChjaGFubmVsSWQpfS9yZWNpcGll
bnRzP2AgKwogICAgICAgIG5ldyBVUkxTZWFyY2hQYXJhbXMoewogICAgICAgICAgZXBvY2g6IFN0cmluZyhlcG9jaCksCiAgICAgICAgICBkZXZpY2VJZDog
U3RyaW5nKGRldmljZUlkKSwKICAgICAgICAgIGN1cnNvciwKICAgICAgICAgIGxpbWl0OiAiMTAwIgogICAgICAgIH0pLnRvU3RyaW5nKCkKICAgICAgKTsK
ICAgICAgb3V0cHV0LnB1c2goLi4uKEFycmF5LmlzQXJyYXkoZGF0YS5yZWNpcGllbnRzKSA/IGRhdGEucmVjaXBpZW50cyA6IFtdKSk7CiAgICAgIGlmICgh
ZGF0YS5uZXh0Q3Vyc29yKSByZXR1cm4gb3V0cHV0OwogICAgICBjdXJzb3IgPSBTdHJpbmcoZGF0YS5uZXh0Q3Vyc29yKTsKICAgIH0KICAgIHRocm93IG5l
dyBFcnJvcigiUGFnaW5hdGlvbiBFMkVFIGFub3JtYWxlbWVudCBsb25ndWUuIik7CiAgfQoKICBhc3luYyBmdW5jdGlvbiB1cGxvYWRQYWNrYWdlcyhzZXJ2
ZXJJZCwgY2hhbm5lbElkLCBlcG9jaCwgZGV2aWNlLCByYXdLZXkpIHsKICAgIGNvbnN0IHJlY2lwaWVudHMgPSBhd2FpdCBsb2FkUmVjaXBpZW50cyhzZXJ2
ZXJJZCwgY2hhbm5lbElkLCBlcG9jaCwgZGV2aWNlLmRldmljZUlkKTsKICAgIGlmICghcmVjaXBpZW50cy5sZW5ndGgpIHRocm93IG5ldyBFcnJvcigiQXVj
dW4gYXBwYXJlaWwgRTJFRSBhdXRvcmlzw6kgZGFucyBjZSBzYWxvbi4iKTsKCiAgICBmb3IgKGxldCBvZmZzZXQgPSAwOyBvZmZzZXQgPCByZWNpcGllbnRz
Lmxlbmd0aDsgb2Zmc2V0ICs9IDI1KSB7CiAgICAgIGNvbnN0IHBhZ2UgPSByZWNpcGllbnRzLnNsaWNlKG9mZnNldCwgb2Zmc2V0ICsgMjUpOwogICAgICBj
b25zdCBwYWNrYWdlcyA9IFtdOwogICAgICBmb3IgKGNvbnN0IHJlY2lwaWVudCBvZiBwYWdlKSB7CiAgICAgICAgcGFja2FnZXMucHVzaChhd2FpdCB3cmFw
Q2hhbm5lbEtleShyYXdLZXksIGRldmljZSwgcmVjaXBpZW50LCB7CiAgICAgICAgICBzZXJ2ZXJJZCwKICAgICAgICAgIGNoYW5uZWxJZCwKICAgICAgICAg
IGVwb2NoLAogICAgICAgICAgc2VuZGVyRGV2aWNlSWQ6IGRldmljZS5kZXZpY2VJZAogICAgICAgIH0pKTsKICAgICAgfQogICAgICBhd2FpdCBhcGkoCiAg
ICAgICAgYC9hcGkvc2VydmVycy8ke2VuY29kZVVSSUNvbXBvbmVudChzZXJ2ZXJJZCl9L2UyZWUvY2hhbm5lbHMvJHtlbmNvZGVVUklDb21wb25lbnQoY2hh
bm5lbElkKX0vcGFja2FnZXNgLAogICAgICAgIHsKICAgICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoewog
ICAgICAgICAgICBlcG9jaCwKICAgICAgICAgICAgc2VuZGVyRGV2aWNlSWQ6IGRldmljZS5kZXZpY2VJZCwKICAgICAgICAgICAgcGFja2FnZXMKICAgICAg
ICAgIH0pCiAgICAgICAgfQogICAgICApOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gY2xhaW1BbmRCdWlsZChzZXJ2ZXJJZCwgY2hhbm5lbElkLCBk
ZXZpY2UsIGN1cnJlbnRTdGF0ZSkgewogICAgY29uc3QgcGVuZGluZ0lkID0ga2V5SWQoZGV2aWNlLmFjY291bnRJZCwgc2VydmVySWQsIGNoYW5uZWxJZCwg
Y3VycmVudFN0YXRlLmVwb2NoKTsKICAgIGNvbnN0IGhhZE1lbW9yeUtleSA9IG1lbW9yeVJhdy5oYXMocGVuZGluZ0lkKTsKICAgIGNvbnN0IHNhbWVTZW5k
ZXIgPSBjdXJyZW50U3RhdGU/LnNlbmRlcj8udXNlcklkID09PSBkZXZpY2UuYWNjb3VudElkICYmCiAgICAgIGN1cnJlbnRTdGF0ZT8uc2VuZGVyPy5kZXZp
Y2VJZCA9PT0gZGV2aWNlLmRldmljZUlkOwoKICAgIGxldCByYXdLZXkgPSBtZW1vcnlSYXcuZ2V0KHBlbmRpbmdJZCk7CiAgICBpZiAoIXJhd0tleSkgewog
ICAgICByYXdLZXkgPSBjcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKG5ldyBVaW50OEFycmF5KDMyKSk7CiAgICAgIG1lbW9yeVJhdy5zZXQocGVuZGluZ0lkLCBy
YXdLZXkpOwogICAgfQogICAgY29uc3QgY29tbWl0bWVudCA9IGF3YWl0IGtleUNvbW1pdG1lbnQocmF3S2V5KTsKCiAgICBsZXQgY2xhaW1lZDsKICAgIHRy
eSB7CiAgICAgIGNsYWltZWQgPSBhd2FpdCBhcGkoCiAgICAgICAgYC9hcGkvc2VydmVycy8ke2VuY29kZVVSSUNvbXBvbmVudChzZXJ2ZXJJZCl9L2UyZWUv
Y2hhbm5lbHMvJHtlbmNvZGVVUklDb21wb25lbnQoY2hhbm5lbElkKX0vY2xhaW1gLAogICAgICAgIHsKICAgICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAg
ICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoewogICAgICAgICAgICBkZXZpY2VJZDogZGV2aWNlLmRldmljZUlkLAogICAgICAgICAgICBjb21taXRtZW50
LAogICAgICAgICAgICAvLyBBcHLDqHMgdW4gcmVsb2FkLCB1bmUgYW5jaWVubmUgY2xhaW0gZHUgbcOqbWUgYXBwYXJlaWwgbidhIHBsdXMKICAgICAgICAg
ICAgLy8gbGEgY2zDqSBicnV0ZSBuw6ljZXNzYWlyZSBwb3VyIGVudmVsb3BwZXIgbGVzIGRlc3RpbmF0YWlyZXMuCiAgICAgICAgICAgIHJlc3RhcnQ6IEJv
b2xlYW4oc2FtZVNlbmRlciAmJiAhaGFkTWVtb3J5S2V5KQogICAgICAgICAgfSkKICAgICAgICB9CiAgICAgICk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAg
ICAgaWYgKGVycj8uY29kZSA9PT0gIkNMQUlNRUQiIHx8IGVycj8uY29kZSA9PT0gIk5PVF9QRU5ESU5HIikgewogICAgICAgIG1lbW9yeVJhdy5kZWxldGUo
cGVuZGluZ0lkKTsKICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgfQogICAgICBtZW1vcnlSYXcuZGVsZXRlKHBlbmRpbmdJZCk7CiAgICAgIHRocm93IGVy
cjsKICAgIH0KCiAgICBjb25zdCBlcG9jaCA9IE51bWJlcihjbGFpbWVkLmVwb2NoIHx8IGN1cnJlbnRTdGF0ZS5lcG9jaCk7CiAgICBjb25zdCByYXdJZCA9
IGtleUlkKGRldmljZS5hY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQsIGVwb2NoKTsKICAgIGlmIChyYXdJZCAhPT0gcGVuZGluZ0lkKSB7CiAgICAg
IG1lbW9yeVJhdy5kZWxldGUocGVuZGluZ0lkKTsKICAgICAgcmF3S2V5ID0gY3J5cHRvLmdldFJhbmRvbVZhbHVlcyhuZXcgVWludDhBcnJheSgzMikpOwog
ICAgICBtZW1vcnlSYXcuc2V0KHJhd0lkLCByYXdLZXkpOwogICAgICB0aHJvdyBuZXcgRXJyb3IoIkwnZXBvY2ggRTJFRSBhIGNoYW5nw6kgcGVuZGFudCBs
YSByw6lzZXJ2YXRpb24gZGUgY2zDqS4iKTsKICAgIH0KICAgIGNvbnN0IGtleSA9IGF3YWl0IGltcG9ydENoYW5uZWxLZXkocmF3S2V5KTsKICAgIGF3YWl0
IHNhdmVLZXkoZGV2aWNlLmFjY291bnRJZCwgc2VydmVySWQsIGNoYW5uZWxJZCwgZXBvY2gsIGtleSk7CgogICAgdHJ5IHsKICAgICAgYXdhaXQgdXBsb2Fk
UGFja2FnZXMoc2VydmVySWQsIGNoYW5uZWxJZCwgZXBvY2gsIGRldmljZSwgcmF3S2V5KTsKICAgICAgY29uc3QgcmVhZHkgPSBhd2FpdCBhcGkoCiAgICAg
ICAgYC9hcGkvc2VydmVycy8ke2VuY29kZVVSSUNvbXBvbmVudChzZXJ2ZXJJZCl9L2UyZWUvY2hhbm5lbHMvJHtlbmNvZGVVUklDb21wb25lbnQoY2hhbm5l
bElkKX0vZmluYWxpemVgLAogICAgICAgIHsKICAgICAgICAgIG1ldGhvZDogIlBPU1QiLAogICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcG9j
aCwgc2VuZGVyRGV2aWNlSWQ6IGRldmljZS5kZXZpY2VJZCB9KQogICAgICAgIH0KICAgICAgKTsKICAgICAgYXdhaXQgc2F2ZVN0YXRlKGRldmljZS5hY2Nv
dW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQsIHJlYWR5KTsKICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlYWR5LCBrZXk6IGF3YWl0IHJlYWRLZXkoZGV2aWNl
LmFjY291bnRJZCwgc2VydmVySWQsIGNoYW5uZWxJZCwgZXBvY2gpIH07CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgaWYgKGVycj8uY29kZSA9PT0gIlJF
Q0lQSUVOVF9TRVRfQ0hBTkdFRCIgfHwgZXJyPy5jb2RlID09PSAiQ0xBSU1fTE9TVCIpIHsKICAgICAgICBzY2hlZHVsZUVuc3VyZShzZXJ2ZXJJZCwgY2hh
bm5lbElkLCAxMjApOwogICAgICAgIHJldHVybiBudWxsOwogICAgICB9CiAgICAgIHRocm93IGVycjsKICAgIH0gZmluYWxseSB7CiAgICAgIG1lbW9yeVJh
dy5kZWxldGUocmF3SWQpOwogICAgfQogIH0KCiAgYXN5bmMgZnVuY3Rpb24gZW5zdXJlQ2hhbm5lbElubmVyKHNlcnZlcklkLCBjaGFubmVsSWQpIHsKICAg
IGNvbnN0IHNpZCA9IFN0cmluZyhzZXJ2ZXJJZCB8fCAiIik7CiAgICBjb25zdCBjaWQgPSBTdHJpbmcoY2hhbm5lbElkIHx8ICIiKTsKICAgIGlmICghc2lk
IHx8ICFjaWQpIHJldHVybiBudWxsOwoKICAgIGNvbnN0IGRldmljZSA9IGF3YWl0IGJyaWRnZSgpLmVuc3VyZURldmljZSgpOwogICAgaWYgKCFkZXZpY2Uu
YWNjb3VudElkIHx8ICFkZXZpY2UuZGV2aWNlSWQgfHwgIWRldmljZS5wcml2YXRlS2V5KSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigiQXBwYXJlaWwgRTJF
RSBpbnZhbGlkZS4iKTsKICAgIH0KCiAgICBpZiAobmF2aWdhdG9yLm9uTGluZSA9PT0gZmFsc2UpIHsKICAgICAgY29uc3QgbG9jYWxTdGF0ZSA9IGF3YWl0
IHJlYWRTdGF0ZShkZXZpY2UuYWNjb3VudElkLCBzaWQsIGNpZCk7CiAgICAgIGlmICghbG9jYWxTdGF0ZT8uZXBvY2gpIHJldHVybiBudWxsOwogICAgICBj
b25zdCBsb2NhbEtleSA9IGF3YWl0IHJlYWRLZXkoZGV2aWNlLmFjY291bnRJZCwgc2lkLCBjaWQsIGxvY2FsU3RhdGUuZXBvY2gpOwogICAgICByZXR1cm4g
bG9jYWxLZXkgPyB7IHN0YXRlOiBsb2NhbFN0YXRlLCBrZXk6IGxvY2FsS2V5LCBvZmZsaW5lOiB0cnVlIH0gOiBudWxsOwogICAgfQoKICAgIGxldCByZW1v
dGUgPSBhd2FpdCBhcGkoCiAgICAgIGAvYXBpL3NlcnZlcnMvJHtlbmNvZGVVUklDb21wb25lbnQoc2lkKX0vZTJlZS9jaGFubmVscy8ke2VuY29kZVVSSUNv
bXBvbmVudChjaWQpfS9zdGF0ZT9gICsKICAgICAgbmV3IFVSTFNlYXJjaFBhcmFtcyh7IGRldmljZUlkOiBkZXZpY2UuZGV2aWNlSWQgfSkudG9TdHJpbmco
KQogICAgKTsKICAgIGF3YWl0IHNhdmVTdGF0ZShkZXZpY2UuYWNjb3VudElkLCBzaWQsIGNpZCwgcmVtb3RlKTsKCiAgICBpZiAocmVtb3RlLnByb3RvY29s
ICE9PSBQUk9UT0NPTCB8fCByZW1vdGUuc3VpdGUgIT09IFNVSVRFKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcigiVmVyc2lvbiBFMkVFIGRlIHNhbG9uIG5v
biBwcmlzZSBlbiBjaGFyZ2UuIik7CiAgICB9CgogICAgaWYgKHJlbW90ZS5zdGF0dXMgPT09ICJyZWFkeSIpIHsKICAgICAgbGV0IGtleSA9IGF3YWl0IHJl
YWRLZXkoZGV2aWNlLmFjY291bnRJZCwgc2lkLCBjaWQsIHJlbW90ZS5lcG9jaCk7CiAgICAgIGlmIChrZXkpIHJldHVybiB7IHN0YXRlOiByZW1vdGUsIGtl
eSB9OwoKICAgICAgaWYgKHJlbW90ZS5wYWNrYWdlKSB7CiAgICAgICAga2V5ID0gYXdhaXQgdW53cmFwQ2hhbm5lbEtleShyZW1vdGUucGFja2FnZSwgZGV2
aWNlLCByZW1vdGUsIHNpZCwgY2lkKTsKICAgICAgICBhd2FpdCBzYXZlS2V5KGRldmljZS5hY2NvdW50SWQsIHNpZCwgY2lkLCByZW1vdGUuZXBvY2gsIGtl
eSk7CiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IHJlbW90ZSwga2V5IH07CiAgICAgIH0KCiAgICAgIC8vIE5vdXZlbCBhcHBhcmVpbCA6IGlsIG5lIHJlw6dv
aXQgcGFzIHNpbGVuY2lldXNlbWVudCB1bmUgYW5jaWVubmUgY2zDqS4KICAgICAgLy8gT24gZGVtYW5kZSB1biBub3V2ZWwgZXBvY2ggZGlzdHJpYnXDqSDD
oCBsJ2Vuc2VtYmxlIGRlcyBhcHBhcmVpbHMKICAgICAgLy8gYWN0dWVsbGVtZW50IGF1dG9yaXPDqXMuCiAgICAgIHJlbW90ZSA9IGF3YWl0IGFwaSgKICAg
ICAgICBgL2FwaS9zZXJ2ZXJzLyR7ZW5jb2RlVVJJQ29tcG9uZW50KHNpZCl9L2UyZWUvY2hhbm5lbHMvJHtlbmNvZGVVUklDb21wb25lbnQoY2lkKX0vcmVx
dWVzdC1zeW5jYCwKICAgICAgICB7CiAgICAgICAgICBtZXRob2Q6ICJQT1NUIiwKICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZGV2aWNlSWQ6
IGRldmljZS5kZXZpY2VJZCB9KQogICAgICAgIH0KICAgICAgKTsKICAgICAgYXdhaXQgc2F2ZVN0YXRlKGRldmljZS5hY2NvdW50SWQsIHNpZCwgY2lkLCBy
ZW1vdGUpOwogICAgfQoKICAgIGlmIChyZW1vdGUuc3RhdHVzID09PSAicGVuZGluZyIpIHsKICAgICAgY29uc3QgYnVpbHQgPSBhd2FpdCBjbGFpbUFuZEJ1
aWxkKHNpZCwgY2lkLCBkZXZpY2UsIHJlbW90ZSk7CiAgICAgIGlmIChidWlsdCkgcmV0dXJuIGJ1aWx0OwoKICAgICAgLy8gVW4gYXV0cmUgYXBwYXJlaWwg
YSBnYWduw6kgbGEgY291cnNlLiBPbiBjb25zZXJ2ZSBsJ8OpdGF0IHBlbmRpbmcgZXQKICAgICAgLy8gbCfDqXbDqW5lbWVudCBzb2NrZXQgInNlcnZlci1l
MmVlLWtleS1yZWFkeSIgcmVsYW5jZXJhIGVuc3VyZUNoYW5uZWwuCiAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAgIHJldHVybiBudWxsOwogIH0KCiAg
ZnVuY3Rpb24gZW5zdXJlQ2hhbm5lbChzZXJ2ZXJJZCwgY2hhbm5lbElkKSB7CiAgICBjb25zdCBpZCA9IGAke3NlcnZlcklkfXwke2NoYW5uZWxJZH1gOwog
ICAgaWYgKHJ1bm5pbmcuaGFzKGlkKSkgcmV0dXJuIHJ1bm5pbmcuZ2V0KGlkKTsKICAgIGNvbnN0IHByb21pc2UgPSBlbnN1cmVDaGFubmVsSW5uZXIoc2Vy
dmVySWQsIGNoYW5uZWxJZCkKICAgICAgLmNhdGNoKChlcnIpID0+IHsKICAgICAgICBjb25zb2xlLndhcm4oIltQZW9wbGUgc2VydmVyIEUyRUVdIiwgZXJy
KTsKICAgICAgICBkaXNwYXRjaFN0YXR1cyh7CiAgICAgICAgICBzZXJ2ZXJJZDogU3RyaW5nKHNlcnZlcklkIHx8ICIiKSwKICAgICAgICAgIGNoYW5uZWxJ
ZDogU3RyaW5nKGNoYW5uZWxJZCB8fCAiIiksCiAgICAgICAgICBzdGF0dXM6ICJlcnJvciIsCiAgICAgICAgICBlcnJvcjogZXJyPy5tZXNzYWdlIHx8ICJF
cnJldXIgRTJFRSIKICAgICAgICB9KTsKICAgICAgICByZXR1cm4gbnVsbDsKICAgICAgfSkKICAgICAgLmZpbmFsbHkoKCkgPT4gewogICAgICAgIGlmIChy
dW5uaW5nLmdldChpZCkgPT09IHByb21pc2UpIHJ1bm5pbmcuZGVsZXRlKGlkKTsKICAgICAgfSk7CiAgICBydW5uaW5nLnNldChpZCwgcHJvbWlzZSk7CiAg
ICByZXR1cm4gcHJvbWlzZTsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGdldENoYW5uZWxLZXkoc2VydmVySWQsIGNoYW5uZWxJZCkgewogICAgY29uc3QgcmVz
dWx0ID0gYXdhaXQgZW5zdXJlQ2hhbm5lbChzZXJ2ZXJJZCwgY2hhbm5lbElkKTsKICAgIGlmIChyZXN1bHQ/LmtleSAmJiByZXN1bHQ/LnN0YXRlPy5lcG9j
aCkgewogICAgICByZXR1cm4gewogICAgICAgIGtleTogcmVzdWx0LmtleSwKICAgICAgICBlcG9jaDogTnVtYmVyKHJlc3VsdC5zdGF0ZS5lcG9jaCksCiAg
ICAgICAgcHJvdG9jb2w6IHJlc3VsdC5zdGF0ZS5wcm90b2NvbCB8fCBQUk9UT0NPTCwKICAgICAgICBzdWl0ZTogcmVzdWx0LnN0YXRlLnN1aXRlIHx8IFNV
SVRFCiAgICAgIH07CiAgICB9CiAgICByZXR1cm4gbnVsbDsKICB9CgogIGFzeW5jIGZ1bmN0aW9uIGdldENhY2hlZENoYW5uZWxLZXkoc2VydmVySWQsIGNo
YW5uZWxJZCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgYnJpZGdlKCkuZW5zdXJlRGV2aWNlKCk7CiAgICAgIGNvbnN0IHN0YXRl
ID0gYXdhaXQgcmVhZFN0YXRlKGRldmljZS5hY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQpOwogICAgICBpZiAoIXN0YXRlPy5lcG9jaCkgcmV0dXJu
IG51bGw7CiAgICAgIGNvbnN0IGtleSA9IGF3YWl0IHJlYWRLZXkoZGV2aWNlLmFjY291bnRJZCwgc2VydmVySWQsIGNoYW5uZWxJZCwgc3RhdGUuZXBvY2gp
OwogICAgICByZXR1cm4ga2V5ID8geyBrZXksIGVwb2NoOiBOdW1iZXIoc3RhdGUuZXBvY2gpLCBwcm90b2NvbDogc3RhdGUucHJvdG9jb2wsIHN1aXRlOiBz
dGF0ZS5zdWl0ZSB9IDogbnVsbDsKICAgIH0gY2F0Y2ggewogICAgICByZXR1cm4gbnVsbDsKICAgIH0KICB9CgogIGZ1bmN0aW9uIHNjaGVkdWxlRW5zdXJl
KHNlcnZlcklkLCBjaGFubmVsSWQsIGRlbGF5ID0gMCkgewogICAgaWYgKCFzZXJ2ZXJJZCB8fCAhY2hhbm5lbElkKSByZXR1cm47CiAgICBzZXRUaW1lb3V0
KCgpID0+IHZvaWQgZW5zdXJlQ2hhbm5lbChzZXJ2ZXJJZCwgY2hhbm5lbElkKSwgTWF0aC5tYXgoMCwgZGVsYXkpKTsKICB9CgogIHdpbmRvdy5hZGRFdmVu
dExpc3RlbmVyKCJwZW9wbGUtc2VydmVyLWNoYW5uZWwtc3RhdGUiLCAoZXZlbnQpID0+IHsKICAgIGNvbnN0IGRldGFpbCA9IGV2ZW50LmRldGFpbCB8fCB7
fTsKICAgIGNvbnN0IHNlcnZlcklkID0gU3RyaW5nKGRldGFpbC5zZXJ2ZXJJZCB8fCAiIik7CiAgICBjb25zdCBjaGFubmVsSWQgPSBTdHJpbmcoZGV0YWls
LmFjdGl2ZVRleHRDaGFubmVsSWQgfHwgIiIpOwogICAgaWYgKHNlcnZlcklkICYmIGNoYW5uZWxJZCkgc2NoZWR1bGVFbnN1cmUoc2VydmVySWQsIGNoYW5u
ZWxJZCwgMCk7CiAgfSk7CgogIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCJvbmxpbmUiLCAoKSA9PiB7CiAgICBjb25zdCBzdGF0ZSA9IHdpbmRvdy5QZW9w
bGVTZXJ2ZXJDaGFubmVscz8uZ2V0U3RhdGU/LigpOwogICAgaWYgKHN0YXRlPy5zZXJ2ZXJJZCAmJiBzdGF0ZT8uYWN0aXZlVGV4dENoYW5uZWxJZCkgewog
ICAgICBzY2hlZHVsZUVuc3VyZShzdGF0ZS5zZXJ2ZXJJZCwgc3RhdGUuYWN0aXZlVGV4dENoYW5uZWxJZCwgNTApOwogICAgfQogIH0pOwoKICBjb25zdCBz
b2NrZXQgPSB3aW5kb3cucGVvcGxlU29ja2V0OwogIHNvY2tldD8ub24/Ligic2VydmVyLWUyZWUtcm90YXRpb24tbmVlZGVkIiwgKHBheWxvYWQpID0+IHsK
ICAgIHNjaGVkdWxlRW5zdXJlKHBheWxvYWQ/LnNlcnZlcklkLCBwYXlsb2FkPy5jaGFubmVsSWQsIDIwKTsKICB9KTsKICBzb2NrZXQ/Lm9uPy4oInNlcnZl
ci1lMmVlLWtleS1yZWFkeSIsIChwYXlsb2FkKSA9PiB7CiAgICBzY2hlZHVsZUVuc3VyZShwYXlsb2FkPy5zZXJ2ZXJJZCwgcGF5bG9hZD8uY2hhbm5lbElk
LCAyMCk7CiAgfSk7CgogIHdpbmRvdy5QZW9wbGVTZXJ2ZXJFMkVFID0gT2JqZWN0LmZyZWV6ZSh7CiAgICBwcm90b2NvbDogUFJPVE9DT0wsCiAgICBzdWl0
ZTogU1VJVEUsCiAgICBlbnN1cmVDaGFubmVsLAogICAgZ2V0Q2hhbm5lbEtleSwKICAgIGdldENhY2hlZENoYW5uZWxLZXksCiAgICBhc3luYyBnZXRTdGF0
ZShzZXJ2ZXJJZCwgY2hhbm5lbElkKSB7CiAgICAgIGNvbnN0IGRldmljZSA9IGF3YWl0IGJyaWRnZSgpLmVuc3VyZURldmljZSgpOwogICAgICByZXR1cm4g
cmVhZFN0YXRlKGRldmljZS5hY2NvdW50SWQsIHNlcnZlcklkLCBjaGFubmVsSWQpOwogICAgfQogIH0pOwp9KSgpOwo=
#</FILE_SERVER_E2EE>
