# Schreibt latest.json fuer den Installer der aktuellen Version (package.json) und legt ihn bei Bedarf in einen Update-Ordner.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-update.ps1                          (latest.json neben dem Installer in dist)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-update.ps1 -Out D:\www\jellycloud    (Installer und latest.json dorthin kopieren)
#   ... -Notes "Neu: ..."  oder  -NotesFile notes.txt (UTF-8)   Text, den die App unter "Neu in dieser Version" zeigt
#
# latest.json: { version, file, size, sha512, date, notes }. Die App prueft Dateiname, Version, Groesse und SHA-512, bevor sie den Installer startet.
# Der Ordner (oder die https-Adresse davor) ist die "Update-Quelle" in Einstellungen > Allgemein. dist selbst ist nach dem Lauf schon eine gueltige Quelle.
# Im Zielordner bleibt nur der aktuelle Installer; latest.json wird zuletzt geschrieben, damit nie eine Beschreibung ohne Datei dasteht.
# Hinweis: nur ASCII im Skript, Windows PowerShell 5.1 liest Skripte ohne BOM als ANSI.
param(
  [string]$Out = '',
  [string]$Notes = '',
  [string]$NotesFile = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$name = "Jellycloud-Player-Setup-$version.exe"
$installer = Join-Path $root "dist\$name"
if (-not (Test-Path -LiteralPath $installer)) { Write-Error "Installer fehlt: $installer (zuerst bauen: npm run dist)"; exit 2 }

if ($NotesFile) { $Notes = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $NotesFile).Path, $utf8) }
$Notes = $Notes.Trim()
if ($Notes.Length -gt 2000) { Write-Error 'Die Beschreibung ist laenger als 2000 Zeichen.'; exit 2 }

$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA512).Hash.ToLower()
$size = (Get-Item -LiteralPath $installer).Length

$target = if ($Out) { $Out } else { Join-Path $root 'dist' }
New-Item -ItemType Directory -Force -Path $target | Out-Null
$target = (Resolve-Path -LiteralPath $target).Path

if ($target -ne (Resolve-Path -LiteralPath (Join-Path $root 'dist')).Path) {
  Get-ChildItem -LiteralPath $target -Filter 'Jellycloud-Player-Setup-*' -File | Where-Object { $_.Name -ne $name } | Remove-Item -Force
  Copy-Item -LiteralPath $installer -Destination (Join-Path $target $name) -Force
  # Der Installer liegt jetzt vollstaendig am Ziel; erst danach darf latest.json auf ihn zeigen
}

$manifest = [ordered]@{
  version = $version
  file    = $name
  size    = [int64]$size
  sha512  = $hash
  date    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
if ($Notes) { $manifest['notes'] = $Notes }

$json = $manifest | ConvertTo-Json
$tmp = Join-Path $target 'latest.json.tmp'
[IO.File]::WriteAllText($tmp, $json, $utf8) # ohne BOM
Move-Item -LiteralPath $tmp -Destination (Join-Path $target 'latest.json') -Force

Write-Output "latest.json fuer Version $version in $target geschrieben ($([math]::Round($size / 1MB, 1)) MB, SHA-512 $($hash.Substring(0, 16))...)."
