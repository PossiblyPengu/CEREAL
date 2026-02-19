<#
.SYNOPSIS
  Bump version, tag, and push to trigger a GitHub Actions release build.

.DESCRIPTION
  Local release helper for Cereal Launcher.
  - Bumps the semantic version in package.json (interactive or via flags)
  - Commits the version change, creates an annotated tag, and pushes
  - GitHub Actions handles the actual build + GitHub Release (build-and-release.yml)

.EXAMPLES
  .\scripts\release.ps1                                       # interactive bump
  .\scripts\release.ps1 -Patch                                # patch bump
  .\scripts\release.ps1 -Patch -Notes "Fix crash on launch"   # with release notes
  .\scripts\release.ps1 -Version 2.0.0 -DryRun               # dry run
#>

param(
  [switch]$Patch,
  [switch]$Minor,
  [switch]$Major,
  [string]$Version,
  [string]$Bump,
  [switch]$DryRun,
  [string]$Notes
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path

# UTF-8 without BOM — PowerShell 5.1's -Encoding UTF8 adds a BOM which breaks JSON parsers
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Utf8($filePath, $text) { [IO.File]::WriteAllText($filePath, $text, $utf8NoBom) }

# Read current version from package.json
$pkgFile = Join-Path $RepoRoot 'package.json'
if (-not (Test-Path $pkgFile)) { Write-Host 'package.json not found' -ForegroundColor Red; exit 1 }
$pj = Get-Content $pkgFile -Raw | ConvertFrom-Json
$currentVersion = $pj.version
if (-not $currentVersion) { Write-Host 'No version in package.json' -ForegroundColor Red; exit 1 }
Write-Host "Current version: v$currentVersion" -ForegroundColor Cyan

# Determine new version
if ($Version) { if ($Version -notmatch '^\d+\.\d+\.\d+(-[A-Za-z0-9\.-]+)?$') { Write-Host 'Invalid version format' -ForegroundColor Red; exit 1 } ; $newVersion = $Version }
elseif ($Bump) { switch ($Bump.ToLower()) { 'major' { $parts = $currentVersion -split '\.'; $newVersion = "$([int]$parts[0] + 1).0.0" } 'minor' { $parts = $currentVersion -split '\.'; $newVersion = "$($parts[0]).$([int]$parts[1] + 1).0" } 'patch' { $parts = $currentVersion -split '\.'; $newVersion = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)" } default { if ($Bump -match '^\d+\.\d+\.\d+(-[A-Za-z0-9\.-]+)?$') { $newVersion = $Bump } else { Write-Host 'Invalid bump value' -ForegroundColor Red; exit 1 } } } }
elseif ($Major) { $parts = $currentVersion -split '\.'; $newVersion = "$([int]$parts[0] + 1).0.0" }
elseif ($Minor) { $parts = $currentVersion -split '\.'; $newVersion = "$($parts[0]).$([int]$parts[1] + 1).0" }
elseif ($Patch) { $parts = $currentVersion -split '\.'; $newVersion = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)" }
else {
  # Interactive mode: ask user which bump to perform
  if ([Environment]::UserInteractive -and !$env:CI) {
    Write-Host ""; Write-Host 'Select version bump:' -ForegroundColor Yellow
    $parts = $currentVersion -split '\.'
    $majorNum = [int]$parts[0]; $minorNum = [int]$parts[1]; $patchNum = [int]$parts[2]
    Write-Host "  [1] Patch  ($majorNum.$minorNum.$($patchNum + 1))"
    Write-Host "  [2] Minor  ($majorNum.$($minorNum + 1).0)"
    Write-Host "  [3] Major  ($($majorNum + 1).0.0)"
    Write-Host "  [4] Custom (enter full version like 5.0.0 or 5.0.0-beta.1)"
    Write-Host "  [Q] Quit"
    Write-Host ""
    $choice = Read-Host 'Choice'
    switch ($choice) {
      '1' { $newVersion = "$majorNum.$minorNum.$($patchNum + 1)" }
      '2' { $newVersion = "$majorNum.$($minorNum + 1).0" }
      '3' { $newVersion = "$($majorNum + 1).0.0" }
      '4' {
        $inputVer = Read-Host 'Enter version (X.Y.Z or X.Y.Z-prerelease)'
        if ($inputVer -match '^\d+\.\d+\.\d+(-[A-Za-z0-9\.-]+)?$') { $newVersion = $inputVer } else { Write-Host 'Invalid version format' -ForegroundColor Red; exit 1 }
      }
      'q' { exit 0 }
      'Q' { exit 0 }
      default { Write-Host 'Invalid choice' -ForegroundColor Red; exit 1 }
    }
  } else {
    Write-Host 'No bump specified; use -Patch/-Minor/-Major/-Version or -Bump' -ForegroundColor Red
    exit 1
  }
}

Write-Host "New version: v$newVersion" -ForegroundColor Green
$tagName = "v$newVersion"

# Collect release notes: prefer -Notes param, otherwise prompt interactively
$releaseNotes = @()
if ($Notes) { $releaseNotes = @($Notes) } else {
  if ([Environment]::UserInteractive -and !$env:CI) {
    Write-Host ""; Write-Host '[Release Notes] Enter changes (empty line to finish, or leave empty for auto-generated notes):' -ForegroundColor Yellow
    while ($true) {
      $line = Read-Host '  >'
      if ([string]::IsNullOrWhiteSpace($line)) { break }
      $releaseNotes += $line
    }
  }
}
if ($releaseNotes.Count -gt 0) { $Notes = ($releaseNotes -join "`n") }

# Dry run
if ($DryRun) {
  Write-Host 'DRY RUN - no changes will be made' -ForegroundColor Yellow
  Write-Host "Would update package.json version $currentVersion -> $newVersion" -ForegroundColor Gray
  Write-Host "Would create tag: $tagName and push to origin" -ForegroundColor Gray
  Write-Host "GitHub Actions would then build and create the release" -ForegroundColor Gray
  if ($releaseNotes.Count -gt 0) {
    Write-Host 'Release notes:' -ForegroundColor Gray
    $releaseNotes | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
  }
  exit 0
}

# Update package.json
$backup = Get-Content $pkgFile -Raw
try {
  $pj.version = $newVersion
  Write-Utf8 $pkgFile ($pj | ConvertTo-Json -Depth 10)
  Write-Host 'package.json updated' -ForegroundColor Green
} catch { Write-Host "Failed to update package.json: $_" -ForegroundColor Red; exit 1 }

# Write release notes to a temp file so the workflow can pick them up via tag annotation
$commitMsg = "chore(release): v$newVersion"
$tagMsg = "Release $tagName"
if ($Notes) { $tagMsg = "$tagMsg`n`n$Notes" }

# Git commit, tag, push
git -C $RepoRoot add package.json
git -C $RepoRoot commit -m $commitMsg 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host 'Nothing to commit or commit failed' -ForegroundColor Yellow }

$existing = git -C $RepoRoot tag -l $tagName
if ($existing) { Write-Host "Tag $tagName already exists; aborting" -ForegroundColor Red; Write-Utf8 $pkgFile $backup; exit 1 }

git -C $RepoRoot tag -a $tagName -m $tagMsg
if ($LASTEXITCODE -ne 0) { Write-Host 'Tag creation failed' -ForegroundColor Red; Write-Utf8 $pkgFile $backup; exit 1 }

Write-Host 'Pushing to origin...' -ForegroundColor White
git -C $RepoRoot push origin --follow-tags
if ($LASTEXITCODE -ne 0) { Write-Host 'Git push failed' -ForegroundColor Red; Write-Utf8 $pkgFile $backup; exit 1 }

Write-Host ""
Write-Host "Tag $tagName pushed. GitHub Actions will build and create the release." -ForegroundColor Green
Write-Host "Watch progress: https://github.com/$(git -C $RepoRoot remote get-url origin | Select-String -Pattern 'github.com[:/](.+?)(?:\.git)?$' | ForEach-Object { $_.Matches[0].Groups[1].Value })/actions" -ForegroundColor Cyan
exit 0
