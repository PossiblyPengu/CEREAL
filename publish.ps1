param(
    [ValidateSet('patch','minor','major')]
    [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

# -- Read current version ------------------------------------------------------
$pkgPath = "$projectDir\package.json"
$pkg = Get-Content $pkgPath | ConvertFrom-Json
$current = [version]$pkg.version

$major = $current.Major
$minor = $current.Minor
$patch = $current.Build

switch ($Bump) {
    'major' { $major++; $minor = 0; $patch = 0 }
    'minor' { $minor++; $patch = 0 }
    'patch' { $patch++ }
}

$newVersion = "$major.$minor.$patch"
Write-Host "Bumping version: $($pkg.version) -> $newVersion"

# -- Update package.json -------------------------------------------------------
$pkgRaw = Get-Content $pkgPath -Raw
$pkgRaw = $pkgRaw -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
Set-Content $pkgPath $pkgRaw -NoNewline
Write-Host "Updated package.json"

# -- Commit, tag, push � CI does the rest -------------------------------------
# Stage all tracked changes first, then add the version bump
$staged = git status --porcelain 2>$null
if ($staged) {
    Write-Host "Staging pending changes..."
    git add -A
    git commit -m "chore: pre-release changes"
}
git add package.json
git commit -m "chore: release v$newVersion"
git tag "v$newVersion"
git push origin HEAD
git push origin "v$newVersion"

Write-Host ""
Write-Host "Tagged v$newVersion and pushed � GitHub Actions will build and publish the release." -ForegroundColor Green
Write-Host "https://github.com/PossiblyPengu/CEREAL/actions"