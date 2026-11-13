# Builds the Ojowacam Desktop MSI installer + portable single-file EXE.
# Usage (from repo root): .\build-desktop-msi.ps1
# Prerequisites: .NET 8 SDK, .deps\wix (portable WiX 3.14).
# Outputs (all collected in publish\):
#   publish\Ojowacam.Desktop.msi   (installer)
#   publish\Ojowacam.Desktop.exe   (portable single-file)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Assert-Exit([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

$wix = Join-Path $PSScriptRoot '.deps\wix'
if (-not (Test-Path (Join-Path $wix 'candle.exe'))) { throw "WiX not found at $wix (expected .deps\wix\candle.exe)" }
$csproj = 'apps\desktop-windows\Ojowacam.Desktop.csproj'
$instDir = 'apps\obs-plugin-windows\installers'
$buildDir = 'apps\desktop-windows\build'
$pub = Join-Path $PSScriptRoot "$buildDir\publish"
$pubSingle = Join-Path $PSScriptRoot "$buildDir\publish-single"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

# 1. Publish app (multi-file, harvested into the MSI)
dotnet publish $csproj -c Release -o $pub -r win-x64 --self-contained
Assert-Exit 'dotnet publish'

# 2. Publish portable single-file exe
dotnet publish $csproj -c Release -o $pubSingle -r win-x64 --self-contained -p:PublishSingleFile=true
Assert-Exit 'dotnet publish single-file'

# 3. Harvest publish dir into a WiX fragment
& "$wix\heat.exe" dir $pub -cg DesktopPublishFiles -dr INSTALLFOLDER -srd -scom -sreg -ag `
    -t "$instDir\desktop-publish-x64.xsl" -var var.PublishDir -out "$buildDir\desktop-publish-files.wxs"
Assert-Exit 'heat'

# 4. Compile WiX sources
& "$wix\candle.exe" "-dPublishDir=$pub" -ext WixUIExtension -out "$buildDir\ojowacam-desktop.wixobj" "$instDir\ojowacam-desktop.wxs"
Assert-Exit 'candle (main)'
& "$wix\candle.exe" "-dPublishDir=$pub" -out "$buildDir\desktop-publish-files.wixobj" "$buildDir\desktop-publish-files.wxs"
Assert-Exit 'candle (files)'

# 5. Link MSI
& "$wix\light.exe" -ext WixUIExtension -out "$buildDir\Ojowacam.Desktop.msi" `
    "$buildDir\ojowacam-desktop.wixobj" "$buildDir\desktop-publish-files.wixobj"
Assert-Exit 'light'

# 6. Collect portable exe
$exe = Join-Path $pubSingle 'Ojowacam.Desktop.exe'
if (-not (Test-Path $exe)) { throw "Single-file exe not found: $exe" }
Copy-Item $exe "$buildDir\Ojowacam.Desktop.exe" -Force

# 7. Collect all artifacts into publish\
$publish = Join-Path $PSScriptRoot 'publish'
New-Item -ItemType Directory -Force -Path $publish | Out-Null
Copy-Item "$buildDir\Ojowacam.Desktop.msi" $publish -Force
Copy-Item "$buildDir\Ojowacam.Desktop.exe" $publish -Force

Write-Host "MSI: $(Join-Path $publish 'Ojowacam.Desktop.msi')"
Write-Host "EXE: $(Join-Path $publish 'Ojowacam.Desktop.exe')"
