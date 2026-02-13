$ErrorActionPreference = 'Stop'
$npmCmdInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCmdInfo -and $npmCmdInfo.Path) { $npmExe = $npmCmdInfo.Path } else { $npmInfo = Get-Command npm -ErrorAction SilentlyContinue; $npmExe = $npmInfo.Path }
Write-Host "Resolved npm executable: $npmExe"
if (-not $npmExe) { Write-Host 'Could not resolve npm executable' -ForegroundColor Red; exit 2 }
& $npmExe run setup:chiaki
Write-Host "EXIT: $LASTEXITCODE"
