$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csproj = "$projectDir\electron\native\MediaInfoTool\MediaInfoTool.csproj"
$publishOut = "$projectDir\electron\native\MediaInfoTool\publish"
$dotnet = if (Get-Command dotnet -ErrorAction SilentlyContinue) { "dotnet" } else { "D:\CODE\important files\dotnet-sdk-8.0.404-win-x64\dotnet.exe" }

Write-Host "Building MediaInfoTool (self-contained)..."
& $dotnet publish $csproj -c Release --nologo -v quiet -o $publishOut
if ($LASTEXITCODE -ne 0) {
    Write-Warning "MediaInfoTool build failed - media player will not work"
}

& npm.cmd run dev
