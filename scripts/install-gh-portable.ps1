param(
  [string]$InstallDir = 'D:\tools\gh'
)

$ErrorActionPreference = 'Stop'
Write-Host "Installing gh to: $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

$api = 'https://api.github.com/repos/cli/cli/releases/latest'
Write-Host "Querying $api for latest release..."
$rel = Invoke-RestMethod -UseBasicParsing -Uri $api
$asset = $rel.assets | Where-Object { $_.name -match 'windows_amd64.zip$' } | Select-Object -First 1
if (-not $asset) { Write-Error 'No windows_amd64 asset found in release assets'; exit 2 }

$downloadUrl = $asset.browser_download_url
$zipPath = Join-Path $InstallDir $asset.name
Write-Host "Downloading $($asset.name) to $zipPath"
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

Write-Host 'Extracting archive...'
Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
Remove-Item $zipPath -Force

$exe = Get-ChildItem -Path $InstallDir -Filter 'gh.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
  $exeDir = $exe.DirectoryName
  Write-Host "Installed gh.exe in: $exeDir"
  & $exe.FullName --version
  Write-Host "To use gh persistently, add $exeDir to your PATH (User environment variables)."
  exit 0
} else {
  Write-Error 'gh.exe not found after extraction'
  exit 3
}
