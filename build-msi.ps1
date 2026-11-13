# Builds the Ojowacam OBS plugin MSI locally.
# Usage (from repo root): .\build-msi.ps1
# Prerequisites: VS Build Tools 2022, CMake, .deps\obs-studio headers,
# .deps\obs-lib\obs.lib, .deps\wix (portable WiX 3.14).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Assert-Exit([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) { $cmake = 'C:\Program Files\CMake\bin\cmake.exe' }
if (-not (Test-Path $cmake)) { throw "cmake not found (looked on PATH and C:\Program Files\CMake)" }

# 1. Configure + build DLL
& $cmake -S apps/obs-plugin-windows -B apps/obs-plugin-windows/build -G "Visual Studio 17 2022" -A x64
Assert-Exit 'cmake configure'
& $cmake --build apps/obs-plugin-windows/build --config Release --target ojowacam-obs -j 4
Assert-Exit 'cmake build'

# 2. Stage package files
$dll = 'apps\obs-plugin-windows\build\package\bin\64bit\ojowacam-obs.dll'
$json = 'apps\obs-plugin-windows\build\package\data\module.json'
if (-not (Test-Path $dll)) { throw "DLL not found: $dll" }
if (-not (Test-Path $json)) { throw "module.json not found: $json" }
$stage = Join-Path $env:TEMP 'ojowacam-obs-plugin-msi'
New-Item -ItemType Directory -Force -Path "$stage\bin\64bit", "$stage\data" | Out-Null
Copy-Item $dll "$stage\bin\64bit\" -Force
Copy-Item $json "$stage\data\" -Force

# 3. Package MSI
& .deps\wix\candle.exe "-dPluginDir=$stage" -out apps\obs-plugin-windows\build\ojowacam-obs-plugin.wixobj apps\obs-plugin-windows\installers\ojowacam-obs-plugin.wxs
Assert-Exit 'candle'
& .deps\wix\light.exe -out apps\obs-plugin-windows\build\Ojowacam.ObsPlugin.msi apps\obs-plugin-windows\build\ojowacam-obs-plugin.wixobj
Assert-Exit 'light'

Write-Host "MSI: $(Join-Path $PSScriptRoot 'apps\obs-plugin-windows\build\Ojowacam.ObsPlugin.msi')"
