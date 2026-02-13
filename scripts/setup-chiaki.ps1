# setup-chiaki.ps1 — Download the latest chiaki-ng Windows release from GitHub
#
# Usage:
#   .\scripts\setup-chiaki.ps1           # download if not already present
#   .\scripts\setup-chiaki.ps1 -Force    # re-download even if already present

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ResourcesDir = Join-Path $ProjectRoot "resources\chiaki-ng"
$ChiakiExe    = Join-Path $ResourcesDir "chiaki.exe"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Cereal - chiaki-ng setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ── Skip if already present ───────────────────────────────────────────────────
if ((Test-Path $ChiakiExe) -and -not $Force) {
    Write-Host "  chiaki-ng already present at resources/chiaki-ng/" -ForegroundColor Green
    Write-Host "  Use -Force to re-download." -ForegroundColor Gray
    Write-Host ""
    exit 0
}

# ── Fetch latest release metadata and select platform-specific asset ────────
Write-Host "  Fetching latest chiaki-ng release info..." -ForegroundColor White

try {
    $headers = @{ "User-Agent" = "cereal-launcher" }
    $repo = $env:CHIAKI_RELEASE_REPO
    if (-not $repo) { $repo = 'streetpea/chiaki-ng' }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers
} catch {
    Write-Host "ERROR: Could not reach GitHub API: $_" -ForegroundColor Red
    exit 1
}

Write-Host "  Latest release: $($release.tag_name)" -ForegroundColor Gray

# Determine platform candidates
Add-Type -AssemblyName System.Runtime
$isWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
$isLinux = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Linux)
$isMac = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)

$candidates = @()
if ($isWindows) {
    $candidates += 'win_x64','win-x64','win64','windows_x64'
} elseif ($isLinux) {
    $candidates += 'linux','linux_x64','linux-x64','x86_64-linux'
} elseif ($isMac) {
    $candidates += 'macos','macos_x64','darwin','osx'
} else {
    $candidates += 'win_x64'
}

# Allow env var override for direct URL (skip GitHub API)
if ($env:CHIAKI_PREBUILT_URL) {
    $directUrl = $env:CHIAKI_PREBUILT_URL
    Write-Host "  Using direct prebuilt URL from CHIAKI_PREBUILT_URL" -ForegroundColor Gray
    $asset = @{ browser_download_url = $directUrl; name = [System.IO.Path]::GetFileName($directUrl); size = 0 }
} else {
    # Allow override of asset regex
    $assetRegexOverride = $env:CHIAKI_ASSET_REGEX
    if ($assetRegexOverride) { Write-Host "  Using asset regex override: $assetRegexOverride" -ForegroundColor Gray }

    $asset = $null
    foreach ($cand in $candidates) {
        if ($assetRegexOverride) {
            $asset = $release.assets | Where-Object { $_.name -match $assetRegexOverride } | Select-Object -First 1
        } else {
            $asset = $release.assets | Where-Object { $_.name -match $cand -and $_.name -match '\.zip$' } | Select-Object -First 1
        }
        if ($asset) { break }
    }

    # Fallback: any zip asset
    if (-not $asset) {
        $asset = $release.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
    }

    if (-not $asset) {
        Write-Host "ERROR: No suitable .zip asset found in release $($release.tag_name) for platform candidates: $($candidates -join ', ')" -ForegroundColor Red
        Write-Host "  Available assets:" -ForegroundColor Gray
        $release.assets | ForEach-Object { Write-Host "    $($_.name)" -ForegroundColor Gray }
        exit 1
    }

    Write-Host "  Asset: $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)" -ForegroundColor Gray
}

# ── Download ──────────────────────────────────────────────────────────────────
$TempZip = Join-Path $env:TEMP "chiaki-ng-download.zip"

Write-Host "  Downloading..." -ForegroundColor White
try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $TempZip -UseBasicParsing
} catch {
    Write-Host "ERROR: Download failed: $_" -ForegroundColor Red
    exit 1
}

# ── Extract ───────────────────────────────────────────────────────────────────
Write-Host "  Extracting to resources/chiaki-ng/..." -ForegroundColor White

if (Test-Path $ResourcesDir) {
    Remove-Item $ResourcesDir -Recurse -Force
}
New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null

# Extract to a temp folder first to handle potential subdirectory in zip
$TempExtract = Join-Path $env:TEMP "chiaki-ng-extract"
if (Test-Path $TempExtract) { Remove-Item $TempExtract -Recurse -Force }

Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force

# If the zip contains a single subdirectory, move its contents up
$extracted = Get-ChildItem $TempExtract
if ($extracted.Count -eq 1 -and $extracted[0].PSIsContainer) {
    Get-ChildItem $extracted[0].FullName | Move-Item -Destination $ResourcesDir
} else {
    Get-ChildItem $TempExtract | Move-Item -Destination $ResourcesDir
}

# ── Cleanup ───────────────────────────────────────────────────────────────────
Remove-Item $TempZip   -Force -ErrorAction SilentlyContinue
Remove-Item $TempExtract -Recurse -Force -ErrorAction SilentlyContinue

# ── Verify ────────────────────────────────────────────────────────────────────
if (-not (Test-Path $ChiakiExe)) {
    Write-Host "ERROR: chiaki.exe not found after extraction." -ForegroundColor Red
    Write-Host "  Contents of resources/chiaki-ng/:" -ForegroundColor Gray
    Get-ChildItem $ResourcesDir | ForEach-Object { Write-Host "    $($_.Name)" -ForegroundColor Gray }
    exit 1
}

$fileCount = (Get-ChildItem $ResourcesDir -Recurse -File).Count
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  chiaki-ng $($release.tag_name) ready" -ForegroundColor Green
Write-Host "  $fileCount files in resources/chiaki-ng/" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
