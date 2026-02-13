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

# ── Fetch latest release metadata ─────────────────────────────────────────────
Write-Host "  Fetching latest chiaki-ng release info..." -ForegroundColor White

try {
    $headers = @{ "User-Agent" = "cereal-launcher" }
    $release = Invoke-RestMethod `
        -Uri "https://api.github.com/repos/streetpea/chiaki-ng/releases/latest" `
        -Headers $headers
} catch {
    Write-Host "ERROR: Could not reach GitHub API: $_" -ForegroundColor Red
    exit 1
}

Write-Host "  Latest release: $($release.tag_name)" -ForegroundColor Gray

# ── Find Windows x64 portable asset ──────────────────────────────────────────
# Prefer: chiaki-ng-win_x64-MSYS2-portable-*.zip  (portable, not installer)
$asset = $release.assets | Where-Object {
    $_.name -match 'win_x64' -and $_.name -match 'portable' -and $_.name -match '\.zip$'
} | Select-Object -First 1

# Fallback: any win_x64 zip
if (-not $asset) {
    $asset = $release.assets | Where-Object {
        $_.name -match 'win_x64' -and $_.name -match '\.zip$'
    } | Select-Object -First 1
}

if (-not $asset) {
    Write-Host "ERROR: No Windows x64 .zip asset found in release $($release.tag_name)" -ForegroundColor Red
    Write-Host "  Available assets:" -ForegroundColor Gray
    $release.assets | ForEach-Object { Write-Host "    $($_.name)" -ForegroundColor Gray }
    exit 1
}

Write-Host "  Asset: $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)" -ForegroundColor Gray

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
