# Build Cereal Launcher distribution package
# This creates a complete installer with bundled chiaki-ng

param(
    [switch]$AppOnly,
    [switch]$Verbose
)

if ($Verbose) {
    Write-Host "Building Cereal Launcher..." -ForegroundColor Cyan
}

# Verify npm is installed
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

try {
    if ($AppOnly) {
        if ($Verbose) {
            Write-Host "Building Electron app only (no chiaki-ng rebuild)..." -ForegroundColor Yellow
        }
        cmd /c npm run build:app
    } else {
        if ($Verbose) {
            Write-Host "Building complete package (chiaki-ng + Electron app)..." -ForegroundColor Yellow
        }
        cmd /c npm run build
    }

    if ($?) {
        Write-Host "Build completed successfully!" -ForegroundColor Green
        Write-Host "Output: dist/" -ForegroundColor Green
    }
}
catch {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    exit 1
}
