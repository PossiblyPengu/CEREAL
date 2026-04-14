# ─── Setup chiaki-ng for Cereal Launcher ─────────────────────────────────────
# Downloads and installs the latest chiaki-ng Windows release from GitHub
# Usage: setup-chiaki.ps1 [-Force] [-InstallDir <path>]

param(
    [switch]$Force,
    [string]$InstallDir = (Join-Path $env:USERPROFILE "AppData\Roaming\cereal-launcher\chiaki-ng")
)

$ErrorActionPreference = "Stop"
$repo = "streetpea/chiaki-ng"

function Write-Status($msg) {
    Write-Host "[chiaki-setup] $msg" -ForegroundColor Cyan
}

function Write-Error($msg) {
    Write-Host "[chiaki-setup] ERROR: $msg" -ForegroundColor Red
}

# Check if already installed
$exePath = Join-Path $InstallDir "chiaki.exe"
if ((Test-Path $exePath) -and -not $Force) {
    Write-Status "chiaki-ng already installed at: $exePath"
    Write-Status "Use -Force to reinstall"
    exit 0
}

# Create install directory
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Status "Created install directory: $InstallDir"
}

# Get latest release info
Write-Status "Fetching latest release from GitHub..."
try {
    $apiUrl = "https://api.github.com/repos/$repo/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "Cereal-Launcher" } -TimeoutSec 30
    $version = $release.tag_name
    Write-Status "Latest version: $version"
} catch {
    Write-Error "Failed to fetch release info: $_"
    exit 1
}

# Find Windows x64 portable zip asset (e.g., chiaki-ng-win_x64-MSYS2-Release-portable.zip)
$asset = $release.assets | Where-Object { $_.name -match "win_x64.*portable\.zip$" } | Select-Object -First 1
if (!$asset) {
    Write-Error "Could not find Windows zip asset in release"
    exit 1
}

$downloadUrl = $asset.browser_download_url
$zipFile = Join-Path $env:TEMP $asset.name

# Download
Write-Status "Downloading from: $downloadUrl"
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipFile -Headers @{ "User-Agent" = "Cereal-Launcher" } -TimeoutSec 300
    Write-Status "Downloaded: $zipFile ($([math]::Round($asset.size / 1MB, 1)) MB)"
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

# Extract outer zip to temp location first (it contains a nested zip)
$tempExtractDir = Join-Path $env:TEMP "chiaki-ng-extract"
Write-Status "Extracting outer archive..."
try {
    if (Test-Path $tempExtractDir) {
        Remove-Item -Path $tempExtractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempExtractDir -Force | Out-Null
    Expand-Archive -Path $zipFile -DestinationPath $tempExtractDir -Force
    
    # Find the inner zip file
    $innerZip = Get-ChildItem -Path $tempExtractDir -Filter "chiaki-ng*.zip" | Select-Object -First 1
    if (!$innerZip) {
        Write-Error "Inner zip file not found in archive"
        exit 1
    }
    Write-Status "Found inner archive: $($innerZip.Name)"
    
    # Remove old installation and extract inner zip to final location
    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $innerZip.FullName -DestinationPath $InstallDir -Force
    Write-Status "Extracted successfully to: $InstallDir"
} catch {
    Write-Error "Extraction failed: $_"
    exit 1
}

# Find the actual exe (might be in a subdirectory)
$exe = Get-ChildItem -Path $InstallDir -Recurse -Filter "chiaki.exe" | Select-Object -First 1
if (!$exe) {
    # Also try chiaki-ng.exe
    $exe = Get-ChildItem -Path $InstallDir -Recurse -Filter "chiaki-ng.exe" | Select-Object -First 1
}
if (!$exe) {
    Write-Error "chiaki executable not found after extraction. Contents: $((Get-ChildItem $InstallDir -Recurse | Select-Object -ExpandProperty Name) -join ', ')"
    exit 1
}

Write-Status "Found executable: $($exe.FullName)"

# Cleanup temp file
Remove-Item -Path $zipFile -Force -ErrorAction SilentlyContinue

Write-Status "chiaki-ng $version installed successfully!"
exit 0
