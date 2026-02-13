function Run-Npm {
  param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Args
  )
  $npmExe = 'npm'
  try { if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { $npmExe = 'npm.cmd' } } catch { }
  if (-not $Args -or $Args.Count -eq 0) { Write-Host 'Run-Npm: no arguments provided' -ForegroundColor Yellow; return 1 }
  if ($Args.Count -eq 1 -and $Args[0] -match '\s') {
    $argArray = $Args[0] -split '\s+'
  } else {
    $argArray = $Args
  }
  Write-Host "Invoking: $npmExe $($argArray -join ' ')"
  try {
    & $npmExe @argArray
    Write-Host 'Exit:' $LASTEXITCODE
    return $LASTEXITCODE
  } catch {
    Write-Host "npm invocation failed: $_" -ForegroundColor Yellow
    return 1
  }
}

# Test calls
Write-Host 'Test single-string call'
Run-Npm 'run setup:chiaki'
Write-Host 'Test split args call'
Run-Npm run setup:chiaki
