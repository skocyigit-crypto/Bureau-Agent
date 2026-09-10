<#
    diagnostic-poste.ps1 — etat de sante d'un poste Windows, pour Ajant Bureau.

    CE QUE CE SCRIPT FAIT, ET CE QU'IL NE FAIT PAS

    Il LIT. Il ne modifie rien, n'installe rien, ne supprime rien. Il n'ouvre
    aucune connexion reseau: il ecrit un fichier sur votre Bureau, et c'est
    tout. Vous pouvez ouvrir ce fichier, le lire entierement, et decider
    ensuite de l'envoyer ou non.

    Il ne lit AUCUN contenu: pas vos documents, pas vos courriels, pas votre
    historique de navigation, pas vos mots de passe. Uniquement l'etat
    technique du poste — version du systeme, mises a jour, antivirus,
    pare-feu, chiffrement, sauvegarde, espace disque, memoire, et la liste des
    logiciels installes avec leur version.

    POURQUOI C'EST VOUS QUI LE LANCEZ

    Un logiciel installe en permanence, qui recevrait des ordres a distance,
    serait plus commode. Ce serait aussi la piece la plus dangereuse de tout
    le systeme: en 2021, la compromission d'un seul serveur de ce type a
    chiffre plus de 1 500 entreprises en quelques heures, par le canal de
    confiance lui-meme.

    La CNIL demande par ailleurs un accord prealable AVANT CHAQUE intervention
    a distance, et que la personne devant la machine puisse identifier ce qui
    a ete fait. Un script que vous lancez, dont vous lisez le resultat avant
    de l'envoyer, respecte les deux — et ne laisse aucune porte ouverte
    derriere lui.

    UTILISATION

        Clic droit sur le fichier > « Executer avec PowerShell »

    ou, dans une fenetre PowerShell:

        powershell -ExecutionPolicy Bypass -File .\diagnostic-poste.ps1

    Certaines mesures (chiffrement du disque) demandent les droits
    administrateur. Sans eux, le script fonctionne quand meme: la mesure est
    simplement marquee comme non disponible, ce qui est honnete — l'absence
    de mesure n'est pas une bonne nouvelle.
#>

$ErrorActionPreference = "SilentlyContinue"

function Get-ValeurOuNull {
    param([scriptblock]$Bloc)
    try { & $Bloc } catch { $null }
}

Write-Host ""
Write-Host "Diagnostic du poste — lecture seule, aucune modification." -ForegroundColor Cyan
Write-Host ""

# --- Systeme -----------------------------------------------------------------
$os = Get-ValeurOuNull { Get-CimInstance Win32_OperatingSystem }
$versionAffichee = Get-ValeurOuNull {
    (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").DisplayVersion
}

# --- Derniere mise a jour ----------------------------------------------------
# On prend la plus recente des mises a jour installees. `Get-HotFix` ne voit
# pas tout (les mises a jour de fonctionnalites n'y figurent pas), mais c'est
# la mesure disponible sans droits particuliers.
$derniereMaj = Get-ValeurOuNull {
    (Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn
}

# --- Disques -----------------------------------------------------------------
$disques = @()
Get-ValeurOuNull { Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" } | ForEach-Object {
    $disques += [pscustomobject]@{
        lettre  = $_.DeviceID
        totalGo = [math]::Round($_.Size / 1GB, 1)
        libreGo = [math]::Round($_.FreeSpace / 1GB, 1)
    }
}

# --- Antivirus ---------------------------------------------------------------
# `SecurityCenter2` liste tous les antivirus declares, y compris ceux d'autres
# editeurs. `productState` encode l'etat: on ne le decode pas a la main ici, on
# prefere l'etat de Defender quand il est disponible, plus fiable.
$defender = Get-ValeurOuNull { Get-MpComputerStatus }
$avTiers = Get-ValeurOuNull {
    Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct |
        Select-Object -First 1
}
$antivirus = if ($defender) {
    [pscustomobject]@{
        nom              = "Microsoft Defender"
        actif            = [bool]$defender.RealTimeProtectionEnabled
        signaturesAJour  = ($defender.AntivirusSignatureAge -ne $null -and $defender.AntivirusSignatureAge -le 7)
    }
} elseif ($avTiers) {
    [pscustomobject]@{ nom = $avTiers.displayName; actif = $null; signaturesAJour = $null }
} else { $null }

# --- Pare-feu ----------------------------------------------------------------
$parefeuActif = Get-ValeurOuNull {
    $profils = Get-NetFirewallProfile
    if ($profils) { [bool]($profils | Where-Object { $_.Enabled -eq $true }) } else { $null }
}

# --- Chiffrement du disque systeme ------------------------------------------
# Demande les droits administrateur. Sans eux: non mesure, et on le dit.
$chiffre = Get-ValeurOuNull {
    $sys = $env:SystemDrive
    $vol = Get-BitLockerVolume -MountPoint $sys
    if ($vol) { $vol.ProtectionStatus -eq "On" } else { $null }
}

# --- Sauvegarde --------------------------------------------------------------
# On regarde l'historique des fichiers de Windows. Une sauvegarde faite par un
# autre outil (NAS, service en ligne) ne sera pas vue: le rapport dira alors
# « non mesuree », jamais « absente ».
$sauvegardeConfiguree = Get-ValeurOuNull {
    $fh = Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\FileHistory" -ErrorAction Stop
    $null -ne $fh
}

# --- Logiciels installes -----------------------------------------------------
$logiciels = @()
$clesDesinstallation = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
Get-ValeurOuNull { Get-ItemProperty $clesDesinstallation } |
    Where-Object { $_.DisplayName } |
    Sort-Object DisplayName -Unique |
    ForEach-Object {
        $logiciels += [pscustomobject]@{ nom = $_.DisplayName; version = $_.DisplayVersion }
    }

# --- Rapport -----------------------------------------------------------------
$rapport = [pscustomobject]@{
    collecteLe        = (Get-Date).ToString("o")
    os                = [pscustomobject]@{
        nom     = if ($os) { $os.Caption } else { $null }
        version = $versionAffichee
        build   = if ($os) { $os.BuildNumber } else { $null }
    }
    dernierDemarrage  = if ($os -and $os.LastBootUpTime) { $os.LastBootUpTime.ToString("o") } else { $null }
    derniereMaj       = if ($derniereMaj) { $derniereMaj.ToString("o") } else { $null }
    disques           = $disques
    memoireGo         = if ($os) { [math]::Round($os.TotalVisibleMemorySize / 1MB, 1) } else { $null }
    antivirus         = $antivirus
    parefeu           = if ($null -ne $parefeuActif) { [pscustomobject]@{ actif = $parefeuActif } } else { $null }
    chiffrementDisque = if ($null -ne $chiffre) { [pscustomobject]@{ actif = $chiffre } } else { $null }
    sauvegarde        = if ($null -ne $sauvegardeConfiguree) { [pscustomobject]@{ configuree = $sauvegardeConfiguree; derniereLe = $null } } else { $null }
    logiciels         = $logiciels
}

$destination = Join-Path ([Environment]::GetFolderPath("Desktop")) "diagnostic-poste.json"
$rapport | ConvertTo-Json -Depth 6 | Out-File -FilePath $destination -Encoding utf8

Write-Host "Rapport ecrit ici :" -ForegroundColor Green
Write-Host "  $destination"
Write-Host ""
Write-Host "Ouvrez-le si vous voulez voir ce qu'il contient avant de l'envoyer." -ForegroundColor Yellow
Write-Host "Rien n'a ete envoye, rien n'a ete modifie sur ce poste."
Write-Host ""
