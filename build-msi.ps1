# Builds the Ojowacam OBS plugin MSI installer + standalone DLL.
# Usage (from repo root): .\build-msi.ps1
# Prerequisites: VS Build Tools 2022, CMake, .deps\obs-studio headers,
# .deps\obs-lib\obs.lib, .deps\wix (portable WiX 3.14).
# Outputs (all collected in publish\):
#   publish\Ojowacam.ObsPlugin.msi  (MSI installer)
#   publish\Ojowacam.ObsPlugin.exe  (single-EXE installer)
#   publish\ojowacam-obs\           (manual drop-in folder)
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

# 4. Package single-EXE installer (WiX Burn bootstrapper wrapping the MSI)
$msi = Join-Path $PSScriptRoot 'apps\obs-plugin-windows\build\Ojowacam.ObsPlugin.msi'
& .deps\wix\candle.exe "-dPluginMsi=$msi" -ext WixBalExtension -out apps\obs-plugin-windows\build\ojowacam-obs-plugin-bundle.wixobj apps\obs-plugin-windows\installers\ojowacam-obs-plugin-bundle.wxs
Assert-Exit 'candle (bundle)'
& .deps\wix\light.exe -ext WixBalExtension -out apps\obs-plugin-windows\build\Ojowacam.ObsPlugin.exe apps\obs-plugin-windows\build\ojowacam-obs-plugin-bundle.wixobj
Assert-Exit 'light (bundle)'

# 5. Collect standalone drop-in files (manual install without MSI):
#    copy the folder below into %ProgramData%\obs-studio\plugins\
$dist = 'apps\obs-plugin-windows\build\dist\ojowacam-obs'
New-Item -ItemType Directory -Force -Path "$dist\bin\64bit", "$dist\data" | Out-Null
Copy-Item $dll "$dist\bin\64bit\ojowacam-obs.dll" -Force
Copy-Item $json "$dist\data\module.json" -Force

# 6. Collect all artifacts into publish\
$publish = Join-Path $PSScriptRoot 'publish'
New-Item -ItemType Directory -Force -Path $publish | Out-Null
Copy-Item 'apps\obs-plugin-windows\build\Ojowacam.ObsPlugin.msi' $publish -Force
Copy-Item 'apps\obs-plugin-windows\build\Ojowacam.ObsPlugin.exe' $publish -Force
Copy-Item 'apps\obs-plugin-windows\build\dist\ojowacam-obs' $publish -Recurse -Force

Write-Host "MSI:  $(Join-Path $publish 'Ojowacam.ObsPlugin.msi')"
Write-Host "EXE:  $(Join-Path $publish 'Ojowacam.ObsPlugin.exe')"
Write-Host "DLL:  $(Join-Path $publish 'ojowacam-obs\bin\64bit\ojowacam-obs.dll')"
Write-Host "      (manual install: copy 'publish\ojowacam-obs' into %ProgramData%\obs-studio\plugins\)"
