# build-chiaki.ps1 — Windows bootstrap: launches chiaki-ng build inside MSYS2 MinGW64
#
# Usage:
#   .\scripts\build-chiaki.ps1 [-Msys2Root C:\msys64]

param(
    [string]$Msys2Root = "C:\msys64"
)

$ErrorActionPreference = "Stop"

# ── Locate MSYS2 ─────────────────────────────────────────────────────────────
$bash    = "$Msys2Root\usr\bin\bash.exe"
$cygpath = "$Msys2Root\usr\bin\cygpath.exe"

if (-not (Test-Path $bash)) {
    Write-Host "ERROR: MSYS2 not found at $Msys2Root" -ForegroundColor Red
    Write-Host "  Install from https://www.msys2.org/ then re-run." -ForegroundColor Red
    exit 1
}

# ── Locate project root ───────────────────────────────────────────────────────
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# ── Convert to MSYS2 path via cygpath (most reliable method) ─────────────────
$msysRoot = & $cygpath --unix $projectRoot
if ([string]::IsNullOrWhiteSpace($msysRoot)) {
    Write-Host "ERROR: cygpath could not convert: $projectRoot" -ForegroundColor Red
    exit 1
}

# ── Launch build ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Cereal - chiaki-ng source build (Windows)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  MSYS2 : $Msys2Root" -ForegroundColor Gray
Write-Host "  Root  : $msysRoot" -ForegroundColor Gray
Write-Host ""

$env:MSYSTEM        = "MINGW64"
$env:CHERE_INVOKING = "1"

& $bash -lc "cd '$msysRoot' && bash scripts/build-chiaki.sh"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  Build failed (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  chiaki-ng build complete!" -ForegroundColor Green
Write-Host "  Run: npm start" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
