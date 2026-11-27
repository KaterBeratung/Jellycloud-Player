# Teil von tools\publish-github.ps1 (-PublishDraft): veroeffentlicht den Entwurf, den der Workflow .github/workflows/windows-release.yml angelegt hat.
# Vorher wird geprueft, was oeffentlich wird: Entwurf mit Installer, fester Kopie und latest.json; latest.json passt zu Version, Name, Groesse und
# SHA-512 des Installers; der Installer traegt eine gueltige Authenticode-Signatur (Herausgeber SignPath Foundation). Danach die Gegenprobe ueber die
# oeffentliche Adresse wie beim lokalen Veroeffentlichen. Hinweis: nur ASCII im Skript (Windows PowerShell 5.1).
function Publish-Draft {
  param([string]$Gh, [string]$Repo, [string]$Version, [switch]$DryRun)
  $tag = "v$Version"
  $name = "Jellycloud-Player-Setup-$Version.exe"
  $stableName = 'Jellycloud-Player-Setup.exe'
  $call = {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $o = & $Gh @args 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $prev }
    $script:code = $LASTEXITCODE
    $o
  }
  $info = (& $call release view $tag --repo $Repo --json 'isDraft,assets,name') -join "`n"
  if ($script:code -ne 0) { Write-Error "Release $tag gibt es in $Repo nicht (erst den Workflow laufen lassen)."; return 2 }
  $rel = $info | ConvertFrom-Json
  if (-not $rel.isDraft) { Write-Error "Release $tag ist schon veroeffentlicht."; return 2 }
  $assets = @{}
  foreach ($a in $rel.assets) { $assets[$a.name] = [int64]$a.size }
  foreach ($n in @($name, $stableName, 'latest.json')) { if (-not $assets.ContainsKey($n)) { Write-Error "Im Entwurf fehlt $n."; return 2 } }

  $work = Join-Path ([IO.Path]::GetTempPath()) ('jc-draft-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    & $call release download $tag --repo $Repo --pattern 'latest.json' --pattern $name --dir $work | Out-Null
    if ($script:code -ne 0) { Write-Error 'Herunterladen des Entwurfs fehlgeschlagen.'; return 1 }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $m = [IO.File]::ReadAllText((Join-Path $work 'latest.json'), $utf8).TrimStart([char]0xFEFF) | ConvertFrom-Json
    $file = Join-Path $work $name
    $size = (Get-Item -LiteralPath $file).Length
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA512).Hash.ToLower()
    if ($m.version -ne $Version -or $m.file -ne $name -or [int64]$m.size -ne $size -or $m.sha512 -ne $hash) { Write-Error 'latest.json passt nicht zum Installer im Entwurf.'; return 1 }
    if ($assets[$stableName] -ne $size) { Write-Error 'Die feste Kopie ist nicht dieselbe Datei wie der Installer.'; return 1 }
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
    Write-Host "Entwurf:   $tag, Installer $size Byte, Signatur $($sig.Status) ($signer)"
    if ($sig.Status -ne 'Valid' -or $signer -notmatch 'SignPath Foundation') { Write-Error 'Der Installer im Entwurf ist nicht gueltig von SignPath Foundation signiert.'; return 1 }
    if ($DryRun) { Write-Host 'Probelauf: nichts wurde veroeffentlicht.'; return 0 }
    & $call release edit $tag --repo $Repo --draft=false --latest | ForEach-Object { Write-Host $_ }
    if ($script:code -ne 0) { Write-Error 'Veroeffentlichen fehlgeschlagen (der Entwurf liegt noch im Repo).'; return 1 }

    # Gegenprobe ohne Anmeldung, so wie die App es sieht (und der feste Link fuer Menschen)
    $base = "https://github.com/$Repo/releases/latest/download"
    $remote = (& curl.exe -sL "$base/latest.json") | Out-String | ConvertFrom-Json
    $len = (& curl.exe -sIL "$base/$name" | Select-String -Pattern '^content-length:\s*(\d+)' | ForEach-Object { [int64]$_.Matches[0].Groups[1].Value } | Select-Object -Last 1)
    $len2 = (& curl.exe -sIL "$base/$stableName" | Select-String -Pattern '^content-length:\s*(\d+)' | ForEach-Object { [int64]$_.Matches[0].Groups[1].Value } | Select-Object -Last 1)
    Write-Host "Gegenprobe: latest.json meldet Version $($remote.version), Installer $len Byte, fester Link $len2 Byte (erwartet $size)."
    if ($remote.version -ne $Version -or $len -ne $size -or $len2 -ne $size) { Write-Error 'Gegenprobe fehlgeschlagen: die oeffentliche Adresse liefert nicht das erwartete Release.'; return 1 }
    Write-Host "Fertig: https://github.com/$Repo/releases/tag/$tag"
    return 0
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
