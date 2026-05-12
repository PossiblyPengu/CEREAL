$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$csproj = "$projectDir\electron\native\MediaInfoTool\MediaInfoTool.csproj"
$publishOut = "$projectDir\electron\native\MediaInfoTool\publish"

# Resolve a working `dotnet` in priority order:
#   1. `dotnet` on PATH if it actually has an SDK installed
#   2. $env:DOTNET_ROOT\dotnet.exe (standard env var set by .NET installers)
#   3. A repo-local copy at <repo>\.tools\dotnet\dotnet.exe (gitignored;
#      drop a portable .NET 8 SDK here for offline / pinned-version builds)
function Test-Dotnet($exePath) {
    if (-not $exePath -or -not (Test-Path $exePath)) { return $false }
    try { $sdks = & $exePath --list-sdks 2>$null } catch { return $false }
    return [bool]$sdks
}

$dotnet = $null

$sysCmd = Get-Command dotnet -ErrorAction SilentlyContinue
if ($sysCmd -and (Test-Dotnet $sysCmd.Source)) { $dotnet = $sysCmd.Source }

if (-not $dotnet -and $env:DOTNET_ROOT) {
    $candidate = Join-Path $env:DOTNET_ROOT 'dotnet.exe'
    if (Test-Dotnet $candidate) { $dotnet = $candidate }
}

if (-not $dotnet) {
    $repoLocal = Join-Path $projectDir '.tools\dotnet\dotnet.exe'
    if (Test-Dotnet $repoLocal) { $dotnet = $repoLocal }
}

if (-not $dotnet) {
    Write-Warning "No .NET SDK found - skipping MediaInfoTool build (media controls will be disabled)."
    Write-Warning "To enable: install the .NET 8 SDK from https://dotnet.microsoft.com/download/dotnet/8.0"
    Write-Warning "         OR set DOTNET_ROOT to your install"
    Write-Warning "         OR drop a portable SDK at $projectDir\.tools\dotnet\"
} else {
    Write-Host "Building MediaInfoTool (self-contained) using $dotnet..."
    & $dotnet publish $csproj -c Release --nologo -v quiet -o $publishOut
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "MediaInfoTool build failed - media player will not work"
    }
}

Set-Location $projectDir
& npm.cmd run dev
