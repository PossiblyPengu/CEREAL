<#
.SYNOPSIS
  Build and publish a release for the app (builds + GitHub release + upload).

.DESCRIPTION
  Adapted from the SOUP release script. Supports optional version/taging,
  build steps, git commit/tag/push and uploading artifacts to GitHub Releases
  using `gh` or the REST API with `GITHUB_TOKEN`.

.EXAMPLES
  # Publish using explicit tag and skip building
  .\scripts\publish-release.ps1 -Tag v0.1.0 -Repo youruser/cereal-launcher -SkipBuild

  # Build and publish (CI): tag triggers the workflow and this script uploads artifacts
  .\scripts\publish-release.ps1 -Tag v0.1.0 -Repo youruser/cereal-launcher
#>

param(
  [string]$Tag,
  [string]$Repo = '',
  [string]$Name = '',
  [string]$Body = '',
  [switch]$Prerelease,
  [string]$Token = $env:GITHUB_TOKEN,
  [switch]$SkipBuild,
  [switch]$SkipGit,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..')

function Infer-RepoFromGit {
  param($root)
  try {
    $u = git -C $root remote get-url origin 2>$null
    if (-not $u) { $u = git -C $root remote get-url upstream 2>$null }
    if ($u) {
      $s = $u.Trim()
      if ($s -match 'github.com[:/](.+?)(?:\.git)?$') { return $Matches[1] }
    }
  } catch { }
  return $null
}

function Infer-RepoFromPackage {
  param($root)
  $pkg = Join-Path $root 'package.json'
  if (-not (Test-Path $pkg)) { return $null }
  try {
    $pj = Get-Content $pkg -Raw | ConvertFrom-Json
    if (-not $pj.repository) { return $null }
    $repoField = $pj.repository
    if ($repoField -is [string]) { $s = $repoField } else { $s = $repoField.url }
    if (-not $s) { return $null }
    $s = $s.Trim()
    if ($s -match 'github.com[:/](.+?)(?:\.git)?$') { return $Matches[1] }
    if ($s -match '^([^/]+)\/([^/]+)$') { return $s }
  } catch { }
  return $null
}

if (-not $Repo) {
  $Repo = Infer-RepoFromGit $RepoRoot
  if (-not $Repo) { $Repo = Infer-RepoFromPackage $RepoRoot }
}

if (-not $Repo) {
  # Environment variable fallbacks commonly set in CI
  if ($env:GITHUB_REPOSITORY) { $Repo = $env:GITHUB_REPOSITORY }
  if (-not $Repo -and $env:REPO) { $Repo = $env:REPO }
  if (-not $Repo -and $env:GH_REPO) { $Repo = $env:GH_REPO }

  if (-not $Repo) {
    if ($Host -and $Host.UI -and $Host.UI.SupportsUserInteraction) {
      $inputRepo = Read-Host 'Repository not specified. Enter owner/repo (or press Enter to abort)'
      if ($inputRepo) { $Repo = $inputRepo } else { Write-Host 'Aborted: no repository specified.' -ForegroundColor Red; exit 1 }
    } else {
      Write-Host 'Repository not specified and could not be inferred. Pass -Repo owner/repo or set GITHUB_REPOSITORY.' -ForegroundColor Red
      exit 1
    }
  }
}

if (-not $Tag) {
  # Try to read package.json version if present
  $pkg = Join-Path $RepoRoot 'package.json'
  if (Test-Path $pkg) {
    try { $pj = Get-Content $pkg -Raw | ConvertFrom-Json; $ver = $pj.version } catch { $ver = $null }
    if ($ver) { $Tag = 'v' + $ver }
  }
}

if (-not $Name) { $Name = $Tag }

function Use-Gh { return $null -ne (Get-Command gh -ErrorAction SilentlyContinue) }

Push-Location $RepoRoot
try {
  if (-not $SkipBuild) {
    Write-Host 'Running setup:chiaki (best-effort)...' -ForegroundColor White
    npm run setup:chiaki 2>$null | Write-Host

    Write-Host 'Running npm run build...' -ForegroundColor White
    npm run build
  } else {
    Write-Host 'Skipping build as requested.' -ForegroundColor Yellow
  }

  $dist = Join-Path $RepoRoot 'dist'
  if (-not (Test-Path $dist)) { Write-Host 'dist/ not found - ensure build produced artifacts or use -SkipBuild' -ForegroundColor Red; exit 1 }

  $files = Get-ChildItem -Path $dist -Recurse -File | Where-Object { $_.Length -gt 0 } | Sort-Object FullName
  if ($files.Count -eq 0) { Write-Host 'No build artifacts found in dist/'; exit 1 }

  $artifactPaths = $files | ForEach-Object { $_.FullName }
  $artifactPaths = $files | ForEach-Object { $_.FullName }

  if ($DryRun) {
    Write-Host 'Dry run: discovered artifacts:' -ForegroundColor Cyan
    foreach ($p in $artifactPaths) { Write-Host $p }
    Pop-Location
    exit 0
  }
  # If not SkipGit, create tag and push
  if (-not $SkipGit) {
    if (-not $Tag) { Write-Host 'No tag provided and package.json version missing; pass -Tag or set version.' -ForegroundColor Red; exit 1 }
    Write-Host ('Preparing git tag {0}' -f $Tag) -ForegroundColor Cyan

    # Commit placeholder if there are changes (usually not required)
    $status = git -C $RepoRoot status --porcelain
    if ($status) {
      Write-Host 'Uncommitted changes detected; staging and committing them for release.' -ForegroundColor Yellow
      git -C $RepoRoot add -A
      git -C $RepoRoot commit -m "chore(release): {0}" -f $Tag 2>$null | Out-Null
    }

    # Create annotated tag
    $tagMsg = $Body
    if (-not $tagMsg) { $tagMsg = "Release $Tag" }
    git -C $RepoRoot tag -a $Tag -m $tagMsg
    git -C $RepoRoot push origin $Tag
  }

  # Create Release and upload
  if (Use-Gh) {
    Write-Host ('Creating GitHub release {0} with gh for {1}' -f $Tag, $Repo) -ForegroundColor Cyan
    $args = @('release','create',$Tag) + $artifactPaths + @('--repo', $Repo, '--title', $Name)
    if ($Body) { $args += '--notes'; $args += $Body }
    if ($Prerelease) { $args += '--prerelease' }
    & gh @args
    if ($LASTEXITCODE -ne 0) { Write-Host 'gh release failed' -ForegroundColor Red; exit 1 }
  } else {
    if (-not $Token) { Write-Host 'GITHUB_TOKEN required when gh is not available.' -ForegroundColor Red; exit 1 }
    Write-Host ('Creating release via REST API for {0} - {1}' -f $Repo, $Tag) -ForegroundColor Cyan
    $createUrl = 'https://api.github.com/repos/{0}/releases' -f $Repo
    $hdr = @{ Authorization = ('token {0}' -f $Token); 'User-Agent' = 'cereal-launcher' }
    $bodyObj = @{ tag_name = $Tag; name = $Name; body = $Body; draft = $false; prerelease = [bool]$Prerelease }
    $resp = Invoke-RestMethod -Method Post -Uri $createUrl -Headers $hdr -Body ($bodyObj | ConvertTo-Json -Depth 4) -ContentType 'application/json'
    if (-not $resp.upload_url) { Write-Host 'Failed to create release: no upload_url' -ForegroundColor Red; exit 1 }

    $uploadUrlTemplate = $resp.upload_url
    foreach ($p in $artifactPaths) {
      $fileName = [IO.Path]::GetFileName($p)
      $uploadUrl = $uploadUrlTemplate -replace '\{\?name,label\}', ('?name={0}' -f $fileName)
      $ctype = 'application/octet-stream'
      switch ([IO.Path]::GetExtension($fileName).ToLower()) {
        '.zip' { $ctype = 'application/zip' }
        '.exe' { $ctype = 'application/vnd.microsoft.portable-executable' }
        '.msi' { $ctype = 'application/x-msi' }
        '.nupkg' { $ctype = 'application/octet-stream' }
        '.tar' { $ctype = 'application/x-tar' }
        '.gz'  { $ctype = 'application/gzip' }
      }
      Write-Host ('Uploading {0}' -f $fileName) -ForegroundColor White
      $uploadHdr = @{ Authorization = ('token {0}' -f $Token); 'Content-Type' = $ctype; 'User-Agent' = 'cereal-launcher' }
      Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHdr -InFile $p
    }
  }

  Write-Host 'Release upload complete.' -ForegroundColor Green
} finally {
  Pop-Location
}

exit 0
