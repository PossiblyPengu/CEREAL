@echo off
REM Run Cereal Launcher in dev mode via cmd (avoids PowerShell execution policy issues)
REM Usage: run-dev.cmd [--SkipChiaki] [--RebuildChiaki] [--Verbose]
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\run.ps1" %*
endlocal
