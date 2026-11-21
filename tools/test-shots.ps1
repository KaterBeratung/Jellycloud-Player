# Oberflaechen-Szenarien nacheinander (Port 8097 ist gemeinsam). Je Szenario eigenes Benutzerverzeichnis, Zeitlimit, Protokoll in $LogDir.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\test-shots.ps1 -Names settings-live,seerr     bestimmte
#   ... -All                       alle ausser -Exclude (Standard: clicktest, braucht echte Mausklicks)
#   ... -Root <Ordner>             ein anderer Stand (etwa eine Kopie mit Verbindungen zu node_modules und vendor)
# Ergebnis je Szenario: ok / FEHLER (Exit-Code, FAIL-Zeilen oder "Szenario fehlgeschlagen") / ZEITLIMIT; Protokolle in -LogDir.
param(
  [string[]]$Names,
  [switch]$All,
  [string[]]$Exclude = @('clicktest'),
  [int]$TimeoutSec = 420,
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$LogDir = (Join-Path $env:TEMP 'jc-shot-logs'),
  [switch]$RealMpv
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
# Mit -File kommen Listen als ein Text mit Kommas an
$Exclude = @($Exclude | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if ($All) { $Names = Get-ChildItem -LiteralPath (Join-Path $Root 'tools\shots') -Filter '*.js' | ForEach-Object { $_.BaseName } | Where-Object { $Exclude -notcontains $_ } }
$names = @($Names | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$exe = Join-Path $Root 'node_modules\electron\dist\electron.exe'
$summary = @()
foreach ($n in $names) {
  $real = $RealMpv -or @('real', 'play-curtain') -contains $n
  $ud = Join-Path $env:TEMP "jc-shot-$n"
  if (Test-Path $ud) { Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue }
  $env:JC_DEV = '1'
  if ($real) { Remove-Item Env:JC_FAKE_MPV -ErrorAction SilentlyContinue } else { $env:JC_FAKE_MPV = '1' }
  $env:SHOT_DIR = Join-Path $LogDir "shots-$n"
  New-Item -ItemType Directory -Force -Path $env:SHOT_DIR | Out-Null # manche Szenarien legen ihren Aufnahmeordner nicht selbst an
  $log = Join-Path $LogDir "$n.out.txt"; $err = Join-Path $LogDir "$n.err.txt"
  $t0 = Get-Date
  $p = Start-Process -FilePath $exe -ArgumentList @('.', "--user-data-dir=`"$ud`"", "--shots=tools/shots/$n.js") -WorkingDirectory $Root -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Hidden
  $null = $p.Handle # sonst liefert ExitCode nach dem Ende nichts
  $done = $p.WaitForExit($TimeoutSec * 1000)
  if (-not $done) { try { Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {}; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
  $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds)
  $o = @(Get-Content -LiteralPath $log -ErrorAction SilentlyContinue)
  $e = @(Get-Content -LiteralPath $err -ErrorAction SilentlyContinue)
  $pass = @($o | Where-Object { $_ -match '^\s*PASS\b' }).Count
  $fail = @($o | Where-Object { $_ -match '^\s*FAIL\b' })
  $crash = @($e | Where-Object { $_ -match 'Szenario fehlgeschlagen' })
  $code = if ($done) { $p.ExitCode } else { 'Zeitlimit' }
  $state = if (-not $done) { 'ZEITLIMIT' } elseif ($code -ne 0 -or $fail.Count -or $crash.Count) { 'FEHLER' } else { 'ok' }
  $line = '{0,-22} {1,-9} pass {2,3}  fail {3,3}  exit {4,-9} {5,4}s' -f $n, $state, $pass, $fail.Count, $code, $secs
  Write-Output $line
  $summary += $line
  foreach ($f in ($fail | Select-Object -First 12)) { Write-Output "    $f" }
  foreach ($c in ($crash | Select-Object -First 3)) { Write-Output "    $c" }
  if ($state -ne 'ok' -and -not $fail.Count -and -not $crash.Count) { $e | Where-Object { $_ -notmatch 'Electron Security Warning|DevTools|^\s*$' } | Select-Object -Last 6 | ForEach-Object { Write-Output "    err: $_" } }
  Remove-Item -Recurse -Force $ud -ErrorAction SilentlyContinue
}
Remove-Item Env:JC_DEV, Env:JC_FAKE_MPV, Env:SHOT_DIR -ErrorAction SilentlyContinue
'=== Zusammenfassung'
$summary
