#Requires -Version 5.1
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repo        = 'streetpea/chiaki-ng'
$installDir  = [System.IO.Path]::GetFullPath("$PSScriptRoot\..\resources\chiaki-ng")
$versionFile = Join-Path $installDir '.version'

# Already installed?
$alreadyInstalled = (Test-Path $versionFile) -or (Test-Path (Join-Path $installDir 'chiaki.exe')) -or (Test-Path (Join-Path $installDir 'chiaki-ng.exe'))
if (-not $Force -and $alreadyInstalled) {
    $v = if (Test-Path $versionFile) { Get-Content $versionFile -Raw } else { 'unknown' }
    Write-Output "chiaki-ng already installed ($($v.Trim()))"
    exit 0
}

Write-Output 'Fetching latest chiaki-ng release...'

$headers = @{ 'User-Agent' = 'cereal-launcher' }
$releaseUrl = "https://api.github.com/repos/$repo/releases/latest"

try {
    $release = Invoke-RestMethod -Uri $releaseUrl -Headers $headers
} catch {
    Write-Error "Failed to fetch release info: $_"
    exit 1
}

# Look for a Windows x64 zip asset
$asset = $release.assets |
    Where-Object { $_.name -match 'win' -and $_.name -match 'x64' -and $_.name -match '\.zip$' } |
    Select-Object -First 1

if (-not $asset) {
    # Fallback: any zip asset
    $asset = $release.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
}

if (-not $asset) {
    Write-Error 'No suitable Windows zip asset found in the latest chiaki-ng release.'
    exit 1
}

Write-Output "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."

$tmpZip = Join-Path $env:TEMP 'chiaki-ng-setup.zip'
try {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmpZip -Headers $headers
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

Write-Output 'Extracting...'

if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Expand-Archive -Path $tmpZip -DestinationPath $installDir -Force
Remove-Item $tmpZip -Force

# Flatten one level if everything extracted into a single subdirectory
$entries = Get-ChildItem -Path $installDir
if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $sub = $entries[0].FullName
    Get-ChildItem -Path $sub | Move-Item -Destination $installDir
    Remove-Item $sub -Recurse -Force
}

# Write version marker
Set-Content -Path $versionFile -Value $release.tag_name -Encoding UTF8

Write-Output "chiaki-ng $($release.tag_name) installed to $installDir"
exit 0
