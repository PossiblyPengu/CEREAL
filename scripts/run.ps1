# Run Cereal Launcher in development mode -- fully portable
# All tools are resolved locally from the D: drive, nothing is installed to the system.
#
# Usage:
#   .\scripts\run.ps1              # auto-build chiaki if missing, then launch
#   .\scripts\run.ps1 -SkipChiaki  # skip chiaki build even if missing
#   .\scripts\run.ps1 -RebuildChiaki # force re-download chiaki-ng
#   .\scripts\run.ps1 -Verbose      # show extra output

param(
    [switch]$SkipChiaki,
    [switch]$RebuildChiaki,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

function Log($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }
function LogStep($msg) { Write-Host "" ; Write-Host "> $msg" -ForegroundColor Cyan }

Log ""
Log "==========================================" -color Cyan
Log "  Cereal Launcher -- Dev Runner (portable)" -color Cyan
Log "==========================================" -color Cyan

# --- 1. Find portable Node.js on this drive ----------------------------------
# Search common locations on the same drive as the project
$Drive = (Split-Path -Qualifier $ProjectRoot)
$NodeExe = $null
$NodeDir = $null

# Check PATH first
$pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($pathNode) {
    $NodeExe = $pathNode.Source
    $NodeDir = Split-Path $NodeExe
}

# Search the drive for a portable node if not in PATH
if (-not $NodeExe) {
    $searchPaths = @(
        "$Drive\CODE\important files\node-*\node.exe",
        "$Drive\CODE\node-*\node.exe",
        "$Drive\tools\node-*\node.exe",
        "$Drive\node-*\node.exe",
        "$Drive\portable\node-*\node.exe"
    )
    foreach ($pattern in $searchPaths) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $NodeExe = $found.FullName
            $NodeDir = Split-Path $NodeExe
            break
        }
    }
}

if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
    Log "ERROR: Could not find a portable Node.js installation on $Drive" Red
    Log "  Place Node.js somewhere on $Drive, for example:" Red
    Log "    $Drive\CODE\node-v22-win-x64\node.exe" Gray
    exit 1
}

# Build full paths to npm and npx (use .cmd variants to avoid PS execution policy issues)
$NpmCmd  = Join-Path $NodeDir "npm.cmd"
$NpxCmd  = Join-Path $NodeDir "npx.cmd"

if (-not (Test-Path $NpmCmd)) {
    Log "ERROR: npm.cmd not found at $NodeDir" Red
    exit 1
}

Log "  Node: $NodeExe" Green
if ($Verbose) {
    $nodeVer = & cmd /c "`"$NodeExe`" -v" 2>&1
    $npmVer  = & cmd /c "`"$NpmCmd`" -v" 2>&1
    Log "  Node $nodeVer  npm $npmVer" Gray
}

# --- 2. Install node_modules if needed ----------------------------------------
if (-not (Test-Path "node_modules")) {
    LogStep "Installing npm dependencies..."
    & cmd /c "`"$NpmCmd`" install"
    if ($LASTEXITCODE -ne 0) { Log "npm install failed" Red; exit 1 }
    Log "  [OK] Dependencies installed" Green
} elseif ($Verbose) {
    Log "  [OK] node_modules present" Green
}

# --- 3. chiaki-ng integration removed -----------------------------------------
LogStep "chiaki-ng integration removed"
Log "  chiaki-ng scripts and bundled binaries have been removed from the workspace." Yellow
Log "  PlayStation Remote Play integration is disabled. You can re-add chiaki later." Yellow
$ChiakiReady = $false

# --- 4. Launch Electron -------------------------------------------------------
LogStep "Starting Cereal Launcher..."
Log ""

$env:ELECTRON_DISABLE_SECURITY_WARNINGS = "true"

if ($Verbose) {
    $env:ELECTRON_ENABLE_LOGGING = "true"
}

# Use the local electron directly from node_modules (no npx needed)
$ElectronCmd = Join-Path $ProjectRoot "node_modules\.bin\electron.cmd"
if (-not (Test-Path $ElectronCmd)) {
    Log "  ERROR: electron not found in node_modules" Red
    Log "    Run this script again to install dependencies, or run:" Gray
    Log "    cmd /c `"$NpmCmd`" install" Gray
    exit 1
}

& cmd /c "`"$ElectronCmd`" ."

if ($LASTEXITCODE -ne 0) {
    Log ""
    Log "  App exited with code $LASTEXITCODE" Yellow
}
