# Veroeffentlicht den Installer der aktuellen Version als GitHub-Release (oeffentliches Repo), damit die App ihn als Update findet.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-github.ps1            (veroeffentlichen)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-github.ps1 -DryRun    (nur anzeigen, nichts hochladen)
#   ... -Repo NAME/REPO   anderes Repo (Standard: KaterBeratung/jellycloud-releases, siehe DEFAULT_UPDATE_SOURCE in src\main\config.js)
#
# Voraussetzungen: tools\publish-update.ps1 lief fuer diese Version (dist\latest.json passt zum Installer) und die GitHub CLI ist angemeldet
# (gh auth login). gh wird im PATH oder unter %LOCALAPPDATA%\gh-cli\bin gesucht.
# Ablauf: Release als ENTWURF anlegen und beide Dateien (Installer, latest.json) hochladen, erst dann veroeffentlichen: so zeigt "latest" nie auf ein
# Release, dem Dateien fehlen. Danach Gegenprobe ohne Anmeldung: latest.json und Groesse des Installers ueber die oeffentliche Adresse.
# Hinweis: nur ASCII im Skript, Windows PowerShell 5.1 liest Skripte ohne BOM als ANSI.
# Zusaetzlich zum Installer mit Versionsnummer laedt das Skript eine Kopie mit FESTEM Namen hoch (Jellycloud-Player-Setup.exe): nur so gibt es einen Download-Link, der immer die neueste
# Version liefert (https://github.com/<Repo>/releases/latest/download/Jellycloud-Player-Setup.exe). Die App selbst nutzt weiter den Namen mit Versionsnummer (latest.json).
#   ... -StableOnly   nur diese Kopie zu einem schon veroeffentlichten Release dieser Version nachladen
param(
  [string]$Repo = 'KaterBeratung/jellycloud-releases',
  [switch]$DryRun,
  [switch]$StableOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $cand = Join-Path $env:LOCALAPPDATA 'gh-cli\bin\gh.exe'; if (Test-Path $cand) { $gh = $cand } }
if (-not $gh) { Write-Error 'gh (GitHub CLI) nicht gefunden.'; exit 2 }
$env:GH_NO_UPDATE_NOTIFIER = '1'

$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$name = "Jellycloud-Player-Setup-$version.exe"
$installer = Join-Path $root "dist\$name"
$manifestFile = Join-Path $root 'dist\latest.json'
if (-not (Test-Path -LiteralPath $installer)) { Write-Error "Installer fehlt: $installer"; exit 2 }
if (-not (Test-Path -LiteralPath $manifestFile)) { Write-Error 'dist\latest.json fehlt: zuerst tools\publish-update.ps1 ausfuehren.'; exit 2 }
$m = [IO.File]::ReadAllText($manifestFile, $utf8).TrimStart([char]0xFEFF) | ConvertFrom-Json
if ($m.version -ne $version -or $m.file -ne $name) { Write-Error "latest.json gehoert zu Version $($m.version), gebaut ist ${version}. Bitte tools\publish-update.ps1 neu ausfuehren."; exit 2 }
$size = (Get-Item -LiteralPath $installer).Length
if ($m.size -ne $size) { Write-Error 'Groesse in latest.json passt nicht zum Installer: tools\publish-update.ps1 neu ausfuehren.'; exit 2 }

$tag = "v$version"
# Windows PowerShell 5.1 macht aus Meldungen eines Programms auf stderr bei $ErrorActionPreference = 'Stop' Fehler: fuer gh-Aufrufe weicher
function Invoke-Gh {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $gh @args 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
  $script:ghCode = $LASTEXITCODE
  return $out
}
Invoke-Gh auth status | Out-Null
if ($ghCode -ne 0) { Write-Error 'gh ist nicht angemeldet (gh auth login).'; exit 2 }
$stableName = 'Jellycloud-Player-Setup.exe'
$stable = Join-Path $env:TEMP $stableName
$base = "https://github.com/$Repo/releases/latest/download"
Invoke-Gh release view $tag --repo $Repo --json tagName | Out-Null
$exists = ($ghCode -eq 0)
if ($StableOnly) {
  if (-not $exists) { Write-Error "Release $tag gibt es in $Repo noch nicht (ohne -StableOnly veroeffentlichen)."; exit 2 }
  Write-Output "Repo:      $Repo (oeffentlich)"
  Write-Output "Nachladen: $stableName zu $tag ($([math]::Round($size / 1MB, 1)) MB, dieselbe Datei wie $name)"
  if ($DryRun) { Write-Output 'Probelauf: nichts wurde hochgeladen.'; exit 0 }
  Copy-Item -LiteralPath $installer -Destination $stable -Force
  try { Invoke-Gh release upload $tag $stable --repo $Repo --clobber | ForEach-Object { Write-Output $_ } } finally { Remove-Item -LiteralPath $stable -Force -ErrorAction SilentlyContinue }
  if ($ghCode -ne 0) { Write-Error 'Hochladen der Kopie fehlgeschlagen.'; exit 1 }
  $headers = & curl.exe -sIL "$base/$stableName"
  $len = ($headers | Select-String -Pattern '^content-length:\s*(\d+)' | ForEach-Object { [int64]$_.Matches[0].Groups[1].Value } | Select-Object -Last 1)
  Write-Output "Gegenprobe: $base/$stableName liefert $len Byte (erwartet $size)."
  if ($len -ne $size) { Write-Error 'Gegenprobe fehlgeschlagen (ist dies noch das neueste Release?).'; exit 1 }
  Write-Output 'Fertig.'
  exit 0
}
if ($exists) { Write-Error "Release $tag gibt es in $Repo schon."; exit 2 }

$notes = if ($m.notes) { [string]$m.notes } else { "Jellycloud Player $version" }
$notesFile = Join-Path $env:TEMP "jc-release-notes-$version.txt"
[IO.File]::WriteAllText($notesFile, $notes, $utf8)

Write-Output "Repo:      $Repo (oeffentlich)"
Write-Output "Release:   $tag  ($([math]::Round($size / 1MB, 1)) MB Installer + Kopie $stableName + latest.json)"
Write-Output "Notizen:   $($notes -replace "`r?`n", ' / ')"
if ($DryRun) { Write-Output 'Probelauf: nichts wurde hochgeladen.'; exit 0 }

Copy-Item -LiteralPath $installer -Destination $stable -Force
try { Invoke-Gh release create $tag $installer $stable $manifestFile --repo $Repo --title "Jellycloud Player $version" --notes-file $notesFile --draft | ForEach-Object { Write-Output $_ } } finally { Remove-Item -LiteralPath $stable -Force -ErrorAction SilentlyContinue }
if ($ghCode -ne 0) { Write-Error 'Anlegen des Entwurfs fehlgeschlagen.'; exit 1 }
Invoke-Gh release edit $tag --repo $Repo --draft=false --latest | ForEach-Object { Write-Output $_ }
if ($ghCode -ne 0) { Write-Error 'Veroeffentlichen fehlgeschlagen (der Entwurf liegt noch im Repo).'; exit 1 }
Remove-Item -LiteralPath $notesFile -Force -ErrorAction SilentlyContinue

# Gegenprobe ohne Anmeldung, so wie die App es sieht (und der feste Link fuer Menschen)
$remote = (& curl.exe -sL "$base/latest.json") | Out-String | ConvertFrom-Json
$headers = & curl.exe -sIL "$base/$name"
$len = ($headers | Select-String -Pattern '^content-length:\s*(\d+)' | ForEach-Object { [int64]$_.Matches[0].Groups[1].Value } | Select-Object -Last 1)
$headers2 = & curl.exe -sIL "$base/$stableName"
$len2 = ($headers2 | Select-String -Pattern '^content-length:\s*(\d+)' | ForEach-Object { [int64]$_.Matches[0].Groups[1].Value } | Select-Object -Last 1)
Write-Output "Gegenprobe: latest.json meldet Version $($remote.version), Installer $len Byte, fester Link $len2 Byte (erwartet $size)."
if ($remote.version -ne $version -or $len -ne $size -or $len2 -ne $size) { Write-Error 'Gegenprobe fehlgeschlagen: die oeffentliche Adresse liefert nicht das erwartete Release.'; exit 1 }
Write-Output "Fester Link (immer die neueste Version): $base/$stableName"
Write-Output "Fertig: https://github.com/$Repo/releases/tag/$tag"
