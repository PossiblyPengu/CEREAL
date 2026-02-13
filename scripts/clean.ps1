# Clean build artifacts and generated files
# Removes dist/, chiaki-dist/, and node_modules (optional)

param(
    [switch]$Full,  # Also removes node_modules
    [switch]$Verbose
)

if ($Verbose) {
    Write-Host "Cleaning build artifacts..." -ForegroundColor Cyan
}

$itemsToRemove = @(
    "dist",
    "chiaki-dist"
)

if ($Full) {
    $itemsToRemove += "node_modules"
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

foreach ($item in $itemsToRemove) {
    $path = Join-Path $projectRoot $item
    if (Test-Path $path) {
        if ($Verbose) {
            Write-Host "Removing $item..." -ForegroundColor Yellow
        }
        Remove-Item -Recurse -Force $path
    }
}

Write-Host "✓ Cleanup completed!" -ForegroundColor Green
if ($Full) {
    Write-Host "  Run 'npm install' to restore dependencies" -ForegroundColor Gray
}
