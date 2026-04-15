param(
    [ValidateSet('patch','minor','major')]
    [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
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
# -- Commit, tag, push --------------------------------------------------------
git add -A
git commit -m "chore: release v$newVersion"
$branch = git branch --show-current
$commitSha = git rev-parse HEAD
git tag "v$newVersion"
git push origin HEAD
git push origin "v$newVersion"

Write-Host ""
Write-Host "Pushed v$newVersion - monitoring GitHub Actions..." -ForegroundColor Cyan
Write-Host "https://github.com/PossiblyPengu/CEREAL/actions"

# -- Wait for workflow and roll back on failure --------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "GitHub CLI (gh) not installed - cannot monitor workflow. Check manually." -ForegroundColor Yellow
    exit 0
}

# Wait up to 60s for the run triggered by this commit to appear
$runId = $null
$waited = 0
Write-Host "Waiting for workflow run to appear..."
while (-not $runId -and $waited -lt 60) {
    Start-Sleep 5
    $waited += 5
    $runId = (gh run list --workflow release.yml --commit $commitSha --json databaseId --jq '.[0].databaseId' 2>$null | Out-String).Trim()
    if ($runId -eq 'null' -or $runId -eq '') { $runId = $null }
}

if (-not $runId) {
    Write-Warning "No workflow run found for this commit after 60s. Check manually."
    exit 0
}

Write-Host "Watching run $runId ..."
gh run watch $runId --exit-status

if ($LASTEXITCODE -ne 0) {
    Write-Warning "GitHub Actions FAILED - rolling back..."
    git push origin --delete "v$newVersion" 2>$null
    git tag -d "v$newVersion"
    git reset --hard HEAD~1
    git push origin "$branch" --force
    Write-Warning "Rolled back: tag v$newVersion deleted and version bump commit reverted."
    Write-Warning "Fix the build issue and run publish.ps1 again."
    exit 1
}

Write-Host ""
Write-Host "Release v$newVersion published successfully!" -ForegroundColor Green