<#
.SYNOPSIS
  Bump version, build, tag, push and create GitHub release for Cereal.

.DESCRIPTION
  Lightweight release script inspired by SOUP's `release.ps1`.
  - supports bumping semantic versions or setting explicit version
  - commits package.json change, creates annotated tag and pushes
  - builds via `npm run build` and uploads artifacts from `dist/`
  - creates GitHub Release via `gh` if available, otherwise uses REST API and `GITHUB_TOKEN`

.EXAMPLES
  .\scripts\release.ps1 -Patch -Notes "Fix crash when launching" -DryRun
  .\scripts\release.ps1 -Version 1.2.3 -Notes "Release notes" 
#>

param(
  [switch]$Patch,
  [switch]$Minor,
  [switch]$Major,
  [string]$Version,
  [string]$Bump,
  [switch]$DryRun,
  [switch]$SkipGit,
  [switch]$SkipBuild,
  [string]$Notes,
  [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..')).Path

function Infer-RepoFromGit { param($root) try { $u = git -C $root remote get-url origin 2>$null; if (-not $u) { $u = git -C $root remote get-url upstream 2>$null } if ($u) { $s = $u.Trim(); if ($s -match 'github.com[:/](.+?)(?:\.git)?$') { return $Matches[1] } } } catch {}; return $null }

function Infer-RepoFromPackage { param($root) $pkg = Join-Path $root 'package.json'; if (-not (Test-Path $pkg)) { return $null }; try { $pj = Get-Content $pkg -Raw | ConvertFrom-Json; if (-not $pj.repository) { return $null }; $repoField = $pj.repository; if ($repoField -is [string]) { $s = $repoField } else { $s = $repoField.url }; if (-not $s) { return $null }; $s = $s.Trim(); if ($s -match 'github.com[:/](.+?)(?:\.git)?$') { return $Matches[1] }; if ($s -match '^([^/]+)\/([^/]+)$') { return $s } } catch {}; return $null }

if (-not $Repo) { $Repo = Infer-RepoFromGit $RepoRoot; if (-not $Repo) { $Repo = Infer-RepoFromPackage $RepoRoot } }
if (-not $Repo) { if ($env:GITHUB_REPOSITORY) { $Repo = $env:GITHUB_REPOSITORY } }
if (-not $Repo) { Write-Host 'Could not infer repository. Use -Repo owner/repo or set GITHUB_REPOSITORY.' -ForegroundColor Red; exit 1 }

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
else { Write-Host 'No bump specified; use -Patch/-Minor/-Major/-Version or -Bump' -ForegroundColor Red; exit 1 }

Write-Host "New version: v$newVersion" -ForegroundColor Green
$tagName = "v$newVersion"

if ($DryRun) {
  Write-Host 'DRY RUN - no changes will be made' -ForegroundColor Yellow
  Write-Host "Would update package.json version $currentVersion -> $newVersion" -ForegroundColor Gray
  Write-Host "Would create tag: $tagName and push to origin" -ForegroundColor Gray
  Write-Host "Would run build unless -SkipBuild was passed" -ForegroundColor Gray
  exit 0
}

# Update package.json
$backup = Get-Content $pkgFile -Raw
try {
  $pj.version = $newVersion
  $pj | ConvertTo-Json -Depth 10 | Set-Content $pkgFile -NoNewline -Encoding UTF8
  Write-Host 'package.json updated' -ForegroundColor Green
} catch { Write-Host "Failed to update package.json: $_" -ForegroundColor Red; exit 1 }

function Resolve-NpmExe {
  try { $npmCmdInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue; if ($npmCmdInfo -and $npmCmdInfo.Path) { return $npmCmdInfo.Path } } catch {}
  try { $npmInfo = Get-Command npm -ErrorAction SilentlyContinue; if ($npmInfo -and $npmInfo.Path) { return $npmInfo.Path } } catch {}
  return 'npm'
}

function Run-Npm { param([string[]]$Args) if (-not $Args -or $Args.Count -eq 0) { Write-Host 'Run-Npm: no args' -ForegroundColor Yellow; return 1 } $npm = Resolve-NpmExe; & $npm @Args; return $LASTEXITCODE }

# Build
if (-not $SkipBuild) {
  Write-Host 'Running setup:chiaki (best-effort)...' -ForegroundColor White
  $rc = Run-Npm 'run','setup:chiaki'
  if ($rc -ne 0) { Write-Host 'setup:chiaki failed (continuing)' -ForegroundColor Yellow }

  Write-Host 'Running npm run build...' -ForegroundColor White
  $rc = Run-Npm 'run','build'
  if ($rc -ne 0) { Write-Host 'npm run build failed' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit $rc }
} else { Write-Host 'Skipping build as requested' -ForegroundColor Yellow }

# Collect artifacts
$dist = Join-Path $RepoRoot 'dist'
if (-not (Test-Path $dist)) { Write-Host 'dist/ not found' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
$files = Get-ChildItem -Path $dist -Recurse -File | Where-Object { $_.Length -gt 0 } | Sort-Object FullName
if ($files.Count -eq 0) { Write-Host 'No artifacts found in dist/' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
$artifactPaths = $files | ForEach-Object { $_.FullName }

# Git commit/tag/push
if (-not $SkipGit) {
  git -C $RepoRoot add package.json
  git -C $RepoRoot commit -m "chore(release): v$newVersion" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host 'Nothing to commit or commit failed' -ForegroundColor Yellow }

  $existing = git -C $RepoRoot tag -l $tagName
  if ($existing) { Write-Host "Tag $tagName already exists; aborting" -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }

  git -C $RepoRoot tag -a $tagName -m "Release $tagName"
  if ($LASTEXITCODE -ne 0) { Write-Host 'Tag creation failed' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
  git -C $RepoRoot push origin --follow-tags
  if ($LASTEXITCODE -ne 0) { Write-Host 'Git push failed' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
} else { Write-Host 'Skipping git actions as requested' -ForegroundColor Yellow }

# Create GitHub release (prefer gh)
function Use-Gh { return $null -ne (Get-Command gh -ErrorAction SilentlyContinue) }
if (Use-Gh) {
  Write-Host "Creating release $tagName with gh..." -ForegroundColor Cyan
  $args = @('release','create',$tagName) + $artifactPaths + @('--repo',$Repo,'--title',$tagName)
  if ($Notes) { $args += '--notes'; $args += $Notes }
  & gh @args
  if ($LASTEXITCODE -ne 0) { Write-Host 'gh release failed' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
} else {
  if (-not $Token) { Write-Host 'GITHUB_TOKEN required for REST release' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
  Write-Host "Creating release $tagName via REST API..." -ForegroundColor Cyan
  $createUrl = 'https://api.github.com/repos/{0}/releases' -f $Repo
  $hdr = @{ Authorization = ('token {0}' -f $Token); 'User-Agent' = 'cereal-launcher' }
  $bodyObj = @{ tag_name = $tagName; name = $tagName; body = $Notes; draft = $false; prerelease = $false }
  $resp = Invoke-RestMethod -Method Post -Uri $createUrl -Headers $hdr -Body ($bodyObj | ConvertTo-Json -Depth 4) -ContentType 'application/json'
  if (-not $resp.upload_url) { Write-Host 'Failed to create release' -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
  $uploadUrlTemplate = $resp.upload_url
  foreach ($p in $artifactPaths) {
    $fileName = [IO.Path]::GetFileName($p)
    $uploadUrl = $uploadUrlTemplate -replace '\{\?name,label\}', ('?name={0}' -f $fileName)
    $ctype = 'application/octet-stream'
    if ($fileName -match '\.zip$') { $ctype = 'application/zip' }
    Write-Host "Uploading $fileName..." -ForegroundColor White
    $uploadHdr = @{ Authorization = ('token {0}' -f $Token); 'Content-Type' = $ctype; 'User-Agent' = 'cereal-launcher' }
    try { Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHdr -InFile $p -ErrorAction Stop } catch { Write-Host "Upload failed for $($fileName): $($_)" -ForegroundColor Red; Set-Content $pkgFile $backup -NoNewline -Encoding UTF8; exit 1 }
  }
}

Write-Host "Release $tagName created successfully." -ForegroundColor Green
exit 0
