<#
.SYNOPSIS
  Publish a chiaki build artifact to GitHub Releases.

.DESCRIPTION
  Uses `gh` (GitHub CLI) if available. Otherwise uses the GitHub REST API
  with an authorization token provided in the `GITHUB_TOKEN` environment
  variable or `-Token` parameter.

USAGE
  .\scripts\publish-chiaki-release.ps1 -Tag v1.2.3 -ArtifactPath chiaki-windows.tar.gz -Repo owner/repo

PARAMETERS
  -Tag         : Release tag name (required)
  -ArtifactPath: Path to artifact to upload (required)
  -Repo        : GitHub repo in owner/repo form. Defaults to `git remote origin`.
  -Name        : Release title (defaults to tag)
  -Body        : Release notes text
  -Prerelease  : Switch for prerelease
  -Token       : GitHub token (falls back to $env:GITHUB_TOKEN)
#>

param(
  [Parameter(Mandatory=$true)][string]$Tag,
  [Parameter(Mandatory=$true)][string]$ArtifactPath,
  [string]$Repo = '',
  [string]$Name = '',
  [string]$Body = '',
  [switch]$Prerelease,
  [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir '..')

if (-not (Test-Path $ArtifactPath)) {
  Write-Error "Artifact not found: $ArtifactPath"
  exit 1
}

if (-not $Repo) {
  try {
    $origin = git -C $RepoRoot remote get-url origin 2>$null
    if ($origin) {
      # origin may be SSH or HTTPS
      $s = $origin.Trim()
      if ($s -match 'github.com[:/](.+?)(\.git)?$') { $Repo = $Matches[1] }
    }
  } catch { }
}

if (-not $Repo) {
  Write-Error 'Repository not specified and could not be inferred. Provide -Repo owner/repo.'
  exit 1
}

if (-not $Name) { $Name = $Tag }

function Use-Gh {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  return $null -ne $gh
}

if (Use-Gh) {
  Write-Host "Creating release with gh for $Repo - $Tag" -ForegroundColor Cyan
  $args = @('release','create', $Tag, $ArtifactPath, '--repo', $Repo, '--title', $Name)
  if ($Body) { $args += '--notes'; $args += $Body }
  if ($Prerelease) { $args += '--prerelease' }
  & gh @args
  exit $LASTEXITCODE
}

if (-not $Token) {
  Write-Error 'GITHUB_TOKEN is required when gh is not available. Set env var or pass -Token.'
  exit 1
}

Write-Host "Creating release via REST API for $Repo - $Tag" -ForegroundColor Cyan

$createUrl = "https://api.github.com/repos/$Repo/releases"
$bodyObj = @{ tag_name = $Tag; name = $Name; body = $Body; draft = $false; prerelease = [bool]$Prerelease }
$hdr = @{ Authorization = "token $Token"; 'User-Agent' = 'cereal-launcher' }

$resp = Invoke-RestMethod -Method Post -Uri $createUrl -Headers $hdr -Body ($bodyObj | ConvertTo-Json -Depth 4) -ContentType 'application/json'
if (-not $resp.upload_url) { Write-Error 'Failed to create release: no upload_url'; exit 1 }

$uploadUrlTemplate = $resp.upload_url
# upload_url is templated like: https://uploads.github.com/repos/:owner/:repo/releases/:id/assets{?name,label}

$fileName = [IO.Path]::GetFileName($ArtifactPath)
$uploadUrl = $uploadUrlTemplate -replace '\{\?name,label\}', "?name=$fileName"

$ctype = 'application/octet-stream'
switch ([IO.Path]::GetExtension($fileName).ToLower()) {
  '.zip' { $ctype = 'application/zip' }
  '.gz'  { $ctype = 'application/gzip' }
  '.tar' { $ctype = 'application/x-tar' }
  '.7z'  { $ctype = 'application/x-7z-compressed' }
}

Write-Host "Uploading $fileName to $uploadUrl" -ForegroundColor White

Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers @{ Authorization = "token $Token"; 'Content-Type' = $ctype; 'User-Agent' = 'cereal-launcher' } -InFile $ArtifactPath -Verbose

Write-Host 'Upload complete.' -ForegroundColor Green
exit 0
