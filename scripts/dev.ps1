# Development workflow helper
# Checks dependencies and runs the app

param(
    [switch]$CheckDeps,
    [switch]$Install,
    [switch]$Verbose
)

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if ($Verbose) {
    Write-Host "Cereal Launcher - Development" -ForegroundColor Cyan
    Write-Host "Project root: $projectRoot" -ForegroundColor Gray
}

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is not installed" -ForegroundColor Red
    exit 1
}

if ($Verbose) {
    $nodeVersion = node --version
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
}

# Check npm dependencies
$packageLockPath = Join-Path $projectRoot "package-lock.json"
$nodeModulesPath = Join-Path $projectRoot "node_modules"

if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "Dependencies not installed. Installing..." -ForegroundColor Yellow
    Push-Location $projectRoot
    cmd /c npm install
    Pop-Location
}

if ($CheckDeps) {
    Write-Host "✓ All dependencies ready" -ForegroundColor Green
    exit 0
}

# Run the app
if ($Verbose) {
    Write-Host "Starting Electron app..." -ForegroundColor Cyan
}

Push-Location $projectRoot
cmd /c npm start
Pop-Location
