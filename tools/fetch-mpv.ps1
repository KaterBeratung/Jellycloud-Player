# Holt den mitgelieferten mpv-Build nach vendor\mpv (fuer den Bau auf GitHub Actions; lokal liegt er schon dort, siehe vendor\mpv\README.txt).
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\fetch-mpv.ps1
# Quelle und Pruefsummen sind fest: das Archiv von shinchiro/mpv-winbuild-cmake (Release 20261101) gegen seine SHA-256, danach jede uebernommene
# Datei gegen die SHA-256 der Dateien, mit denen die Installer bis 1.2.33 gebaut wurden. Weicht etwas ab, bricht der Bau ab (kein Installer mit
# fremdem mpv). Uebernommen werden nur die Dateien, die der Installer enthaelt; alles andere aus dem Archiv (Dokumentation, Updater) bleibt draussen.
# Braucht 7z (auf den Windows-Rechnern von GitHub vorhanden). Hinweis: nur ASCII im Skript (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261101/mpv-x86_64-20261101-git-48fca90e8c.7z'
$archiveSha = '7a887a10b74c1a4a7e8c29ead8300cfc610c466c4686bf9dcb92ca2f224ba110'
$files = [ordered]@{
  'mpv.exe'            = 'ea94e743e49a1b88ee34b4a40b1e5f0f6e4d1225e10e69f03da0a3c5452c1488'
  'mpv.com'            = '8efe401260f6f93f903dfeaf93421d5b7b5376aa97580087d9f6d2f75051ed29'
  'd3dcompiler_43.dll' = '4b074a3976399dc735484f5d43d04b519b7bdee8ac719d9ab8ed6bd4e6be0345'
  'mpv\fonts.conf'     = 'ccb1a61f4b42a150ca9935c164697bd32174a848205f6bc261c22bc56abe47a1'
}
$sha = { param($p) (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
$dest = Join-Path $root 'vendor\mpv'

# Schon da und unveraendert (lokaler Bau): nichts zu tun
$present = $files.Keys | Where-Object { $p = Join-Path $dest $_; (Test-Path -LiteralPath $p) -and ((& $sha $p) -eq $files[$_]) }
if (@($present).Count -eq $files.Count) { Write-Output 'mpv liegt schon geprueft in vendor\mpv.'; exit 0 }

$work = Join-Path ([IO.Path]::GetTempPath()) ('jc-mpv-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $archive = Join-Path $work 'mpv.7z'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
  $got = & $sha $archive
  if ($got -ne $archiveSha) { throw "Pruefsumme des mpv-Archivs stimmt nicht: $got" }
  $seven = (Get-Command 7z -ErrorAction SilentlyContinue).Source
  if (-not $seven) { $seven = Join-Path $env:ProgramFiles '7-Zip\7z.exe' }
  if (-not (Test-Path -LiteralPath $seven)) { throw '7z nicht gefunden.' }
  $out = Join-Path $work 'x'
  & $seven x $archive "-o$out" -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7z meldet Fehler $LASTEXITCODE." }
  foreach ($rel in $files.Keys) {
    $src = Join-Path $out $rel
    if (-not (Test-Path -LiteralPath $src)) { throw "Im Archiv fehlt $rel." }
    $h = & $sha $src
    if ($h -ne $files[$rel]) { throw "$rel weicht ab: $h" }
    $to = Join-Path $dest $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $src -Destination $to -Force
  }
  Write-Output "mpv nach vendor\mpv uebernommen und geprueft ($($files.Count) Dateien)."
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
