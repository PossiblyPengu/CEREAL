param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..')
$VendorDir = Join-Path $RepoRoot 'vendor\chiaki-ng'
$BuildDir = Join-Path $VendorDir 'build-windows'
$ResourcesDir = Join-Path $RepoRoot 'resources\chiaki-ng'

Write-Host ""; Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  Cereal - build chiaki-ng (Windows)' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

if (-not (Test-Path $VendorDir)) {
    Write-Host "ERROR: vendor/chiaki-ng not found. Initialize submodules first." -ForegroundColor Red
    Write-Host "  git submodule update --init --recursive" -ForegroundColor Gray
    exit 1
}

if ($Clean -and (Test-Path $BuildDir)) {
    Write-Host 'Cleaning previous build...' -ForegroundColor White
    Remove-Item $BuildDir -Recurse -Force
}

New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null

# Detect CMake
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
if (-not $cmake) {
    Write-Host 'ERROR: CMake not found in PATH. Install CMake and try again.' -ForegroundColor Red
    exit 1
}

# Prefer Ninja if available
$ninja = Get-Command ninja -ErrorAction SilentlyContinue
if ($ninja) { $gen = 'Ninja' } else { $gen = $null }

Write-Host "Configuring chiaki-ng (generator: $($gen -or 'default'))..." -ForegroundColor White

$cmakeArgs = @(
    '-S', "${VendorDir}",
    '-B', "${BuildDir}",
    '-DCMAKE_BUILD_TYPE=Release'
)
if ($gen) { $cmakeArgs += '-G'; $cmakeArgs += $gen }

# Bootstrap vcpkg and install dependencies
Write-Host 'Bootstrapping dependencies via vcpkg...' -ForegroundColor White
& "$ScriptDir\bootstrap-chiaki-deps.ps1"

# Add vcpkg toolchain if available
$vcpkgToolchain = Join-Path $RepoRoot 'vendor\vcpkg\scripts\buildsystems\vcpkg.cmake'
if (Test-Path $vcpkgToolchain) {
    Write-Host "Using vcpkg toolchain: $vcpkgToolchain" -ForegroundColor White
    $cmakeArgs += '-DCMAKE_TOOLCHAIN_FILE=' + $vcpkgToolchain
}

& cmake @cmakeArgs

Write-Host 'Building chiaki-ng...' -ForegroundColor White
try {
    & cmake --build $BuildDir --config Release --parallel
} catch {
    Write-Host "Build failed: $_" -ForegroundColor Red
    exit 1
}

# Locate built chiaki executable
$exe = Get-ChildItem -Path $BuildDir -Filter 'chiaki.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
    Write-Host 'ERROR: chiaki.exe not found in build output.' -ForegroundColor Red
    exit 1
}

$exeDir = $exe.DirectoryName

Write-Host "Found chiaki.exe in: $exeDir" -ForegroundColor Green

Write-Host "Copying runtime files to resources/chiaki-ng/..." -ForegroundColor White
if (Test-Path $ResourcesDir) { Remove-Item $ResourcesDir -Recurse -Force }
New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null

Get-ChildItem -Path $exeDir -Recurse | ForEach-Object {
    $rel = Resolve-Path -Path $_.FullName
}

Copy-Item -Path (Join-Path $exeDir '*') -Destination $ResourcesDir -Recurse -Force

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  chiaki-ng built and copied to resources/chiaki-ng/' -ForegroundColor Green
Write-Host "  Source: $VendorDir" -ForegroundColor Gray
Write-Host "  Build dir: $BuildDir" -ForegroundColor Gray
Write-Host '============================================================' -ForegroundColor Green
Write-Host ''

exit 0
