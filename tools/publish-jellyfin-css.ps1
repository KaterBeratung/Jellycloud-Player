# Aktualisiert das Jellyfin-CSS (jellyfin-css\jellycloud.css und README.md) im oeffentlichen GitHub-Repo, damit der Link in Jellyfin die neue Fassung liefert.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-jellyfin-css.ps1            (hochladen, wenn sich etwas geaendert hat)
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\publish-jellyfin-css.ps1 -DryRun    (nur anzeigen, was sich aendern wuerde)
#   ... -Repo NAME/REPO   anderes Repo (Standard: KaterBeratung/Jellycloud-Player, Ordner jellyfin-css/ auf dem Zweig main)
#
# Link fuer Jellyfin (Dashboard > Allgemein > Benutzerdefinierter CSS-Code):
#   @import url("https://cdn.jsdelivr.net/gh/KaterBeratung/Jellycloud-Player@main/jellyfin-css/jellycloud.css");
# Warum jsDelivr und nicht raw.githubusercontent.com: GitHub liefert Dateien dort als text/plain mit nosniff, Browser lehnen so ein Stylesheet fuer @import ab.
# jsDelivr haelt den Zweig bis zu 12 Stunden im Zwischenspeicher: das Skript stoesst deshalb danach die Aktualisierung an und prueft den Abruf.
# Das Hochladen ist oeffentlich: nur nach Freigabe des Nutzers. Voraussetzung: gh ist angemeldet (gh auth login), im PATH oder unter %LOCALAPPDATA%\gh-cli\bin.
# Hinweis: nur ASCII im Skript, Windows PowerShell 5.1 liest Skripte ohne BOM als ANSI.
param(
  [string]$Repo = 'KaterBeratung/Jellycloud-Player',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'jellyfin-css'
$files = @('jellycloud.css', 'README.md')

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $cand = Join-Path $env:LOCALAPPDATA 'gh-cli\bin\gh.exe'; if (Test-Path $cand) { $gh = $cand } }
if (-not $gh) { Write-Error 'gh (GitHub CLI) nicht gefunden.'; exit 2 }
$env:GH_NO_UPDATE_NOTIFIER = '1'

# Windows PowerShell 5.1 macht aus Meldungen eines Programms auf stderr bei $ErrorActionPreference = 'Stop' Fehler: fuer gh-Aufrufe weicher
function Invoke-Gh {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $gh @args 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
  $script:ghCode = $LASTEXITCODE
  return ($out -join "`n")
}

Invoke-Gh auth status | Out-Null
if ($ghCode -ne 0) { Write-Error 'gh ist nicht angemeldet (gh auth login).'; exit 2 }

$css = Join-Path $src 'jellycloud.css'
if (-not (Test-Path -LiteralPath $css)) { Write-Error "Fehlt: $css"; exit 2 }
if ([IO.File]::ReadAllText($css) -notmatch '^[\x00-\x7f]*$') { Write-Error 'jellycloud.css enthaelt Nicht-ASCII-Zeichen.'; exit 2 }

$tmp = Join-Path $env:TEMP 'jc-css-publish'
New-Item -ItemType Directory -Force $tmp | Out-Null
$changed = @()
foreach ($name in $files) {
  $path = Join-Path $src $name
  $bytes = [IO.File]::ReadAllBytes($path)
  $b64 = [Convert]::ToBase64String($bytes)
  # vorhandene Fassung (Pruefsumme "sha" des Blobs, noetig zum Ueberschreiben) lesen
  $cur = Invoke-Gh api "repos/$Repo/contents/jellyfin-css/${name}?ref=main"
  $sha = $null
  if ($ghCode -eq 0) {
    $o = $cur | ConvertFrom-Json
    $sha = $o.sha
    if (($o.content -replace '\s', '') -eq $b64) { Write-Output "${name}: unveraendert"; continue }
  }
  $changed += $name
  Write-Output ("{0}: {1} ({2} Byte)" -f $name, $(if ($sha) { 'wird aktualisiert' } else { 'wird neu angelegt' }), $bytes.Length)
  if ($DryRun) { continue }
  $body = @{ message = "Jellyfin-CSS: $name aktualisiert`n`nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"; content = $b64; branch = 'main' }
  if ($sha) { $body.sha = $sha }
  $bodyFile = Join-Path $tmp "body-$name.json"
  [IO.File]::WriteAllText($bodyFile, ($body | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  $res = Invoke-Gh api -X PUT "repos/$Repo/contents/jellyfin-css/$name" --input $bodyFile
  if ($ghCode -ne 0) { Write-Error "Hochladen von $name fehlgeschlagen: $res"; exit 1 }
}
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

if ($DryRun) { Write-Output 'Probelauf: nichts wurde hochgeladen.'; exit 0 }

$cdn = "https://cdn.jsdelivr.net/gh/$Repo@main/jellyfin-css/jellycloud.css"
if ($changed.Count -gt 0) {
  try { Invoke-WebRequest -Uri ($cdn -replace '^https://cdn\.', 'https://purge.') -UseBasicParsing -TimeoutSec 30 | Out-Null; Write-Output 'jsDelivr: Zwischenspeicher geleert' } catch { Write-Output "jsDelivr: Aktualisierung nicht bestaetigt ($($_.Exception.Message)), spaetestens nach 12 Stunden gilt die neue Fassung" }
  Start-Sleep -Seconds 3
}
# Gegenprobe: Typ und Groesse ueber den Link, den Jellyfin bekommt
try {
  $r = Invoke-WebRequest -Uri $cdn -UseBasicParsing -TimeoutSec 30
  $want = (Get-Item -LiteralPath $css).Length
  Write-Output ("Gegenprobe: {0}, Typ {1}, {2} Byte (lokal {3}){4}" -f $r.StatusCode, $r.Headers['Content-Type'], $r.RawContentLength, $want, $(if ($r.RawContentLength -ne $want) { '  <- noch die alte Fassung im Zwischenspeicher?' } else { '' }))
} catch { Write-Output "Gegenprobe fehlgeschlagen: $($_.Exception.Message)" }
Write-Output ''
Write-Output 'Zeile fuer Jellyfin (Dashboard > Allgemein > Benutzerdefinierter CSS-Code):'
Write-Output "@import url(""$cdn"");"
