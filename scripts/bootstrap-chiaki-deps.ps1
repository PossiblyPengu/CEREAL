param(
    [string]$Triplet = 'x64-windows'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..')
$VcpkgDir = Join-Path $RepoRoot 'vendor\vcpkg'

Write-Host ""; Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Cereal - bootstrap vcpkg and install chiaki deps (Windows)' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

if (Test-Path $VcpkgDir) {
    Write-Host 'Removing existing vendor/vcpkg to ensure a clean full clone...' -ForegroundColor Yellow
    Remove-Item -Recurse -Force -LiteralPath $VcpkgDir
}

Write-Host 'Cloning fresh vcpkg into vendor/vcpkg (full clone)...' -ForegroundColor White
git clone https://github.com/microsoft/vcpkg.git $VcpkgDir
Push-Location $VcpkgDir
try {
    if (-not (Test-Path "bootstrap-vcpkg.bat")) {
        Write-Host 'ERROR: vcpkg repo missing bootstrap script.' -ForegroundColor Red
        exit 1
    }

    Write-Host 'Bootstrapping vcpkg (may compile tools)...' -ForegroundColor White
    & .\bootstrap-vcpkg.bat

    $vcpkgExe = Join-Path $VcpkgDir 'vcpkg.exe'
    if (-not (Test-Path $vcpkgExe)) {
        Write-Host 'ERROR: vcpkg.exe not found after bootstrap.' -ForegroundColor Red
        exit 1
    }

    # Ensure qt6 ports are present; if not, re-clone vcpkg without shallow options
    $qtPort = Join-Path $VcpkgDir 'ports\qt6-base'
    if (-not (Test-Path $qtPort)) {
        Write-Host 'qt6-base port not found in vcpkg ports; re-cloning vcpkg to ensure ports are available...' -ForegroundColor Yellow
        Pop-Location
        Remove-Item -Recurse -Force -LiteralPath $VcpkgDir
        git clone https://github.com/microsoft/vcpkg.git $VcpkgDir
        Push-Location $VcpkgDir
        & .\bootstrap-vcpkg.bat
        $vcpkgExe = Join-Path $VcpkgDir 'vcpkg.exe'
        if (-not (Test-Path $vcpkgExe)) {
            Write-Host 'ERROR: vcpkg.exe not found after re-clone bootstrap.' -ForegroundColor Red
            exit 1
        }
    }

    Write-Host "vcpkg repository info:" -ForegroundColor Cyan
    git --no-pager log -n 1 --pretty=oneline
    Write-Host "Listing ports (first 50) in $VcpkgDir/ports:" -ForegroundColor Cyan
    Get-ChildItem -Path (Join-Path $VcpkgDir 'ports') -Directory -ErrorAction SilentlyContinue | Select-Object -First 50 | ForEach-Object { Write-Host "  $_.Name" }

    Write-Host "Installing packages for triplet: $Triplet" -ForegroundColor White
    # Provide candidate names for known ports to handle port name differences across vcpkg commits
    $packageCandidates = @{
        'qt6-base' = @('qt6-base','qt6','qtbase')
        'ffmpeg'   = @('ffmpeg')
        'openssl'  = @('openssl')
        'sdl2'     = @('sdl2')
        'libopus'  = @('libopus','opus')
    }

    foreach ($key in $packageCandidates.Keys) {
        $installed = $false
        foreach ($cand in $packageCandidates[$key]) {
            $pkgArg = "${cand}:$Triplet"
            Write-Host "Attempting vcpkg install $pkgArg" -ForegroundColor Gray
            $rc = & $vcpkgExe install $pkgArg 2>&1 | Tee-Object -Variable out
            if ($LASTEXITCODE -eq 0) { Write-Host "Installed $pkgArg" -ForegroundColor Green; $installed = $true; break }
            else { Write-Host "vcpkg install $pkgArg failed (exit $LASTEXITCODE)." -ForegroundColor Yellow }
        }
        if (-not $installed) {
            Write-Host "ERROR: Could not install any candidate for $key. Last output:" -ForegroundColor Red
            $out | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
            exit 1
        }
    }

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host '  vcpkg ready with chiaki dependencies' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ''
} finally {
    Pop-Location
}

exit 0
