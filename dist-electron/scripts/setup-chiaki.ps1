#Requires -Version 5.1
param(
    [switch]$Force,
    [string]$InstallDir = '',
    [string]$Channel = 'stable',
    [string]$AssetPattern = '',
    [string]$LocalZip = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference   = 'SilentlyContinue'  # prevents extreme slowdown in Invoke-WebRequest

# GitHub requires TLS 1.2; Windows PowerShell defaults to TLS 1.0 on older systems
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'streetpea/chiaki-ng'

# InstallDir is passed by the app (userData/chiaki-ng). Fall back to a local path for manual use.
if (-not $InstallDir) {
    $InstallDir = [System.IO.Path]::GetFullPath("$PSScriptRoot\..\resources\chiaki-ng")
}
$installDir  = $InstallDir
$versionFile = Join-Path $installDir '.version'

# Already installed?
$alreadyInstalled = (Test-Path $versionFile) -or (Test-Path (Join-Path $installDir 'chiaki.exe')) -or (Test-Path (Join-Path $installDir 'chiaki-ng.exe'))
if (-not $Force -and $alreadyInstalled) {
    $v = if (Test-Path $versionFile) { Get-Content $versionFile -Raw } else { 'unknown' }
    Write-Output "chiaki-ng already installed ($($v.Trim()))"
    exit 0
}

Write-Output "Fetching release info (channel: $Channel)..."

$headers = @{ 'User-Agent' = 'cereal-launcher' }
$releasesUrl = "https://api.github.com/repos/$repo/releases"

try {
    if ($LocalZip -and (Test-Path $LocalZip)) {
        Write-Output "Using local zip: $LocalZip"
        $tmpZip = $LocalZip
        $release = @{ tag_name = ('local:' + (Split-Path $LocalZip -Leaf)); assets = @() }
        $useLocal = $true
    }

    if (-not $useLocal) {
        if ($Channel -eq 'latest') {
            $response = Invoke-WebRequest -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers $headers -UseBasicParsing
            $release = $response.Content | ConvertFrom-Json
        } else {
            $response = Invoke-WebRequest -Uri $releasesUrl -Headers $headers -UseBasicParsing
            if ($response.StatusCode -eq 403 -or $response.StatusCode -eq 429) {
                Write-Host "ERROR: GitHub API rate limit exceeded. Try again in a few minutes."
                exit 1
            }
            $allReleases = $response.Content | ConvertFrom-Json
            if ($Channel -like 'tag:*') {
                $tag = $Channel.Substring(4)
                $release = $allReleases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
            } elseif ($Channel -eq 'prerelease') {
                $release = $allReleases | Where-Object { $_.prerelease } | Select-Object -First 1
            } else {
                # Prefer the most recent non-prerelease; fallback to the first entry if none found
                $release = $allReleases | Where-Object { -not $_.prerelease } | Select-Object -First 1
                if (-not $release) { $release = $allReleases | Select-Object -First 1 }
            }
        }
    }
} catch {
    $msg = if ($_.Exception -and $_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 403) {
        'GitHub API rate limit exceeded. Try again in a few minutes.'
    } else {
        "Failed to fetch release info: $_"
    }
    Write-Host "ERROR: $msg"
    exit 1
}

$useLocal = $useLocal -eq $true
$excludePattern = 'test|preview|alpha|beta|rc'

if (-not $useLocal) {
    if ($AssetPattern -and $AssetPattern.Trim() -ne '') {
        $asset = $release.assets | Where-Object { $_.name -match $AssetPattern } | Select-Object -First 1
    }
    if (-not $asset) {
        $asset = $release.assets |
            Where-Object { $_.name -match 'win' -and $_.name -match 'x64' -and $_.name -match 'portable' -and $_.name -match '\.zip$' -and $_.name -notmatch $excludePattern } |
            Select-Object -First 1
    }
    if (-not $asset) {
        # Fallback: any Windows x64 zip that isn't an installer wrapper and not obviously a prerelease/test build
        $asset = $release.assets |
            Where-Object { $_.name -match 'win' -and $_.name -match 'x64' -and $_.name -match '\.zip$' -and $_.name -notmatch 'installer' -and $_.name -notmatch $excludePattern } |
            Select-Object -First 1
    }

    if (-not $asset) {
        Write-Host 'ERROR: No suitable Windows x64 portable zip found in the selected chiaki-ng release.'
        exit 1
    }

    $totalMB = [math]::Round($asset.size / 1MB, 1)
    Write-Output "Downloading $($asset.name) ($totalMB MB)..."

    # Use explicit system temp path
    $systemTemp = [System.IO.Path]::GetTempPath()
    $tmpZip = Join-Path $systemTemp "chiaki-ng-setup-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).zip"
    Write-Output "Download target: $tmpZip"
    Write-Output "System temp: $systemTemp"

    $dlUrl = $asset.browser_download_url
    Write-Output "Download URL: $dlUrl"

    # Try BITS transfer first (more reliable for large files), fall back to Invoke-WebRequest
    try {
        Write-Output 'Starting download with BITS...'
        Start-BitsTransfer -Source $dlUrl -Destination $tmpZip -DisplayName 'chiaki-ng' -Description "Downloading $totalMB MB..." -ErrorAction Stop
        Write-Output 'BITS download completed.'
    } catch {
        Write-Output "BITS failed ($_), trying Invoke-WebRequest..."
        try {
            Invoke-WebRequest -Uri $dlUrl -OutFile $tmpZip -UseBasicParsing -ProgressAction SilentlyContinue
            Write-Output 'IWR download completed.'
        } catch {
            Write-Host "ERROR: Download failed: $_"
            exit 1
        }
    }
}

Write-Output "Download completed. Checking for file at: $tmpZip"
Write-Output "File exists: $(Test-Path $tmpZip)"
if (Test-Path $tmpZip) {
    Write-Output "File size: $((Get-Item $tmpZip).Length) bytes"
}
if (-not (Test-Path $tmpZip) -or (Get-Item $tmpZip).Length -lt 1MB) {
    Write-Host 'ERROR: Downloaded file is missing or too small.'
    exit 1
}

Write-Output 'Extracting...'
Write-Output "Zip file: $tmpZip (exists: $(Test-Path $tmpZip), size: $((Get-Item $tmpZip).Length) bytes)"
Write-Output "Install dir: $installDir"

if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Write-Output "Install dir created: $(Test-Path $installDir)"

$extractedOk = $false
$extractionError = $null
try {
    # Use .NET for faster extraction with per-file progress
    Write-Output 'Using .NET extraction...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $zip = [System.IO.Compression.ZipFile]::OpenRead($tmpZip)
    Write-Output "Zip opened. Entry count: $($zip.Entries.Count)"
    Write-Output "All entries:"
    $zip.Entries | ForEach-Object { Write-Output "  - $($_.FullName) (compressed: $($_.CompressedLength), raw: $($_.Length))" }
    $entries = $zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') }
    $total = $entries.Count
    Write-Output "Found $total file entries (non-directory)..."
    $current = 0
    foreach ($entry in $entries) {
        $current++
        $dest = Join-Path $installDir $entry.FullName
        $dir = Split-Path -Parent $dest
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
        if ($current % 10 -eq 0 -or $current -eq $total) {
            Write-Output "Extracting file $current / $total..."
        }
    }
    $zip.Dispose()
    $extractedOk = $true
    Write-Output ".NET extraction completed."
} catch {
    $extractionError = $_
    Write-Output ".NET extraction failed: $extractionError"
}

if (-not $extractedOk) {
    try {
        Write-Output 'Extracting with Expand-Archive...'
        Expand-Archive -Path $tmpZip -DestinationPath $installDir -Force
        $extractedOk = $true
        Write-Output 'Expand-Archive completed.'
    } catch {
        Write-Host "ERROR: Failed to extract archive: $_"
        Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
        exit 1
    }
}

if (-not $extractedOk) {
    Write-Host "ERROR: Both extraction methods failed. Last error: $extractionError"
    Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
    exit 1
}
if (-not $useLocal) { Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue }

# Count what we actually extracted
$fileCount = (Get-ChildItem -Path $installDir -Recurse -File).Count
$dirCount = (Get-ChildItem -Path $installDir -Recurse -Directory).Count
Write-Output "Extraction complete: $fileCount files, $dirCount directories"

# Debug: List what we actually have
Write-Output "Install dir contents after extraction:"
Get-ChildItem -Path $installDir -Recurse | ForEach-Object { Write-Output "  $($_.FullName)" }

# Find chiaki.exe anywhere in the extraction and surface all files to top level
Write-Output 'Surfacing files to top level...'
# Prefer exact known names for speed
$exeFile = Get-ChildItem -Path $installDir -Recurse -Filter 'chiaki.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exeFile) {
    $exeFile = Get-ChildItem -Path $installDir -Recurse -Filter 'chiaki-ng.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
}
# Fallback: any executable with "chiaki" in the filename (covers renamed or nested builds)
if (-not $exeFile) {
    $exeFile = Get-ChildItem -Path $installDir -Recurse -File | Where-Object { $_.Name -like '*chiaki*.exe' } | Select-Object -First 1
}

# If we still don't have an exe, check for nested zip(s) (zip-in-zip releases) and extract them
if (-not $exeFile) {
    $zipEntries = @(Get-ChildItem -Path $installDir -Recurse -File -Filter '*.zip' -ErrorAction SilentlyContinue)
    if ($zipEntries.Count -gt 0) {
        $nestedNames = $zipEntries | ForEach-Object { $_.Name }
        Write-Output ("Found nested archive(s): " + ($nestedNames -join ', '))
        foreach ($nested in $zipEntries) {
            Write-Output "Extracting nested archive: $($nested.FullName)"
            try {
                Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
                $z2 = [System.IO.Compression.ZipFile]::OpenRead($nested.FullName)
                $entries2 = $z2.Entries | Where-Object { -not $_.FullName.EndsWith('/') }
                $tcount = $entries2.Count
                $tc = 0
                foreach ($entry2 in $entries2) {
                    $tc++
                    $dest2 = Join-Path $installDir $entry2.FullName
                    $dir2 = Split-Path -Parent $dest2
                    if (-not (Test-Path $dir2)) { New-Item -ItemType Directory -Path $dir2 -Force | Out-Null }
                    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry2, $dest2, $true)
                    if ($tc % 10 -eq 0 -or $tc -eq $tcount) { Write-Output "Extracted nested file $tc / $tcount..." }
                }
                $z2.Dispose()
                Remove-Item $nested.FullName -Force -ErrorAction SilentlyContinue
            } catch {
                Write-Output "Nested extraction failed for $($nested.FullName): $_"
            }
        }

        # Recompute exeFile after nested extraction
        $exeFile = Get-ChildItem -Path $installDir -Recurse -Filter 'chiaki.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $exeFile) { $exeFile = Get-ChildItem -Path $installDir -Recurse -Filter 'chiaki-ng.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1 }
        if (-not $exeFile) { $exeFile = Get-ChildItem -Path $installDir -Recurse -File | Where-Object { $_.Name -like '*chiaki*.exe' } | Select-Object -First 1 }
    }
}

if (-not $exeFile) {
    Write-Host 'ERROR: chiaki.exe not found anywhere in extraction. Contents:'
    Get-ChildItem -Path $installDir -Recurse | ForEach-Object { Write-Host "  $($_.FullName)" }
    exit 1
}

# Move all files from the directory containing chiaki.exe to the top level
$sourceDir = $exeFile.DirectoryName
if ($sourceDir -ne $installDir) {
    Write-Output "Moving files from $sourceDir to top level..."
    Get-ChildItem -Path $sourceDir -Recurse | ForEach-Object {
        if (-not $_.PSIsContainer) {
            $relative = $_.FullName.Substring($sourceDir.Length + 1)
            $dest = Join-Path $installDir $relative
            $destDir = Split-Path -Parent $dest
            if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            if ($_.FullName -ne $dest) { Move-Item -Path $_.FullName -Destination $dest -Force }
        }
    }
    # Remove now-empty subdirectories
    Get-ChildItem -Path $installDir -Directory | ForEach-Object {
        if ($_.FullName -ne $sourceDir -and $_.FullName -ne $installDir) {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    if ($sourceDir -ne $installDir) {
        Remove-Item $sourceDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Verify at top level
$exeFound = if (Test-Path (Join-Path $installDir 'chiaki.exe')) { 'chiaki.exe' } elseif (Test-Path (Join-Path $installDir 'chiaki-ng.exe')) { 'chiaki-ng.exe' } else { $null }
if (-not $exeFound) {
    Write-Host 'ERROR: chiaki.exe still not at top level after surfacing. Contents:'
    Get-ChildItem -Path $installDir -Recurse | ForEach-Object { Write-Host "  $($_.FullName)" }
    exit 1
}
Write-Output "Found executable: $exeFound"

# Write version marker
try {
    $tagVal = $release.tag_name
} catch {
    $tagVal = 'unknown'
}
Set-Content -Path $versionFile -Value $tagVal -Encoding UTF8

Write-Output "chiaki-ng $($tagVal) installed to $installDir"
exit 0
