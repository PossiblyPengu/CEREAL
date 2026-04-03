$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csproj = "$projectDir\electron\native\MediaInfoTool\MediaInfoTool.csproj"
$publishOut = "$projectDir\electron\native\MediaInfoTool\publish"

# Use the bundled SDK if the system dotnet has no SDK installed
$bundledDotnet = "D:\CODE\important files\dotnet-sdk-8.0.404-win-x64\dotnet.exe"
$sysCmd = Get-Command dotnet -ErrorAction SilentlyContinue
$sysDotnet = if ($sysCmd) { $sysCmd.Source } else { $null }
$sdkList = if ($sysDotnet) { & $sysDotnet --list-sdks } else { $null }
$dotnet = if ($sysDotnet -and $sdkList) { $sysDotnet } else { $bundledDotnet }

Write-Host "Building MediaInfoTool (self-contained)..."
& $dotnet publish $csproj -c Release --nologo -v quiet -o $publishOut
if ($LASTEXITCODE -ne 0) {
    Write-Warning "MediaInfoTool build failed - media player will not work"
}

& npm.cmd run dev
