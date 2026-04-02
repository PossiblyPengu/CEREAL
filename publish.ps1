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
# -- Generate changelog -------------------------------------------------------
$prevTag = git describe --tags --abbrev=0 2>$null
if ($LASTEXITCODE -eq 0 -and $prevTag) {
    $rawLines = @(git log "$prevTag..HEAD" --oneline --no-merges)
} else {
    $rawLines = @(git log --oneline --no-merges --max-count=40)
}
$rawLines = $rawLines | Where-Object { $_ -match '\S' }

$feats = [System.Collections.Generic.List[string]]::new()
$fixes = [System.Collections.Generic.List[string]]::new()
$other = [System.Collections.Generic.List[string]]::new()
foreach ($line in $rawLines) {
    $msg = ($line -replace '^[0-9a-f]+\s+', '').Trim()
    if ($msg -match '^chore(\([^)]+\))?!?:') { continue }
    if ($msg -match '^feat(\([^)]+\))?!?:\s*(.+)')    { $feats.Add($Matches[2]) }
    elseif ($msg -match '^fix(\([^)]+\))?!?:\s*(.+)') { $fixes.Add($Matches[2]) }
    else { $other.Add($msg) }
}

$sections = [System.Collections.Generic.List[string]]::new()
if ($feats.Count) { $sections.Add("### New`n" + (($feats | ForEach-Object { "- $_" }) -join "`n")) }
if ($fixes.Count) { $sections.Add("### Fixes`n" + (($fixes | ForEach-Object { "- $_" }) -join "`n")) }
if ($other.Count) { $sections.Add("### Changes`n" + (($other | ForEach-Object { "- $_" }) -join "`n")) }
if ($sections.Count -eq 0) { $sections.Add('- Maintenance release') }

$releaseDate  = Get-Date -Format 'yyyy-MM-dd'
$releaseBody  = $sections -join "`n`n"
$releaseEntry = "## v$newVersion - $releaseDate`n`n$releaseBody"

# build/release-notes.md  -> electron-builder uses this as the GitHub release body
$null = New-Item -ItemType Directory -Force -Path "$projectDir\build"
[System.IO.File]::WriteAllText("$projectDir\build\release-notes.md", $releaseBody, [System.Text.Encoding]::UTF8)

# CHANGELOG.md -> prepend new section
$changelogPath = "$projectDir\CHANGELOG.md"
$existing = if (Test-Path $changelogPath) { [System.IO.File]::ReadAllText($changelogPath).TrimStart() } else { '' }
$newChangelog  = if ($existing) { "$releaseEntry`n`n$existing" } else { $releaseEntry }
[System.IO.File]::WriteAllText($changelogPath, $newChangelog, [System.Text.Encoding]::UTF8)
Write-Host "Changelog written"
# -- Commit, tag, push � CI does the rest -------------------------------------
git add -A
git commit -m "chore: release v$newVersion"
git tag "v$newVersion"
git push origin HEAD
git push origin "v$newVersion"

Write-Host ""
Write-Host "Tagged v$newVersion and pushed - GitHub Actions will build and publish the release." -ForegroundColor Green
Write-Host "https://github.com/PossiblyPengu/CEREAL/actions"