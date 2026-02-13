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

if (-not (Test-Path $VcpkgDir)) {
    Write-Host 'Cloning vcpkg into vendor/vcpkg...' -ForegroundColor White
    git clone https://github.com/microsoft/vcpkg.git $VcpkgDir
}

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

    Write-Host "Installing packages for triplet: $Triplet" -ForegroundColor White
    $packages = @( 'qt6-base', 'ffmpeg', 'openssl', 'sdl2', 'libopus' )
    foreach ($p in $packages) {
        $pkgArg = "$($p):$Triplet"
        Write-Host "  vcpkg install $pkgArg" -ForegroundColor Gray
        & $vcpkgExe install $pkgArg
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
