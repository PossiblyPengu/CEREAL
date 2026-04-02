$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csproj = "$projectDir\electron\native\MediaInfoTool\MediaInfoTool.csproj"

Write-Host "Building MediaInfoTool..."
dotnet build $csproj -c Release --nologo -v quiet
if ($LASTEXITCODE -ne 0) {
    Write-Warning "MediaInfoTool build failed - media player will not work"
}

& npm.cmd run dev
