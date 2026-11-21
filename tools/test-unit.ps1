# Unit-Tests mit dem Node von Electron (ohne node/npm im PATH). Ausgabe: Zusammenfassung und fehlgeschlagene Faelle.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\test-unit.ps1                       (alle test\*.test.js)
#   ... -Files 'test/seerr.test.js,test/media-tags.test.js'                                     (einzelne)
#   ... -Root <Ordner>                                                                           (ein anderer Stand, etwa eine Kopie)
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [string[]]$Files)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $Root
$env:ELECTRON_RUN_AS_NODE = '1'
$Files = @($Files | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if (-not $Files) { $Files = Get-ChildItem -LiteralPath (Join-Path $Root 'test') -Filter '*.test.js' | ForEach-Object { "test/$($_.Name)" } }
$out = & (Join-Path $Root 'node_modules\electron\dist\electron.exe') --test --test-reporter=tap @Files 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
Remove-Item Env:ELECTRON_RUN_AS_NODE
$out | Where-Object { $_ -match '^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)' }
$fails = @()
for ($i = 0; $i -lt $out.Count; $i++) { if ($out[$i] -match '^\s*not ok ') { $fails += $out[$i]; $j = $i + 1; while ($j -lt $out.Count -and $j -lt $i + 30 -and $out[$j] -notmatch '^\s*(not )?ok ') { $fails += $out[$j]; $j++ } } }
if ($fails.Count) { '--- Fehlgeschlagen:'; $fails | Select-Object -First 200 }
"Exit: $code"
