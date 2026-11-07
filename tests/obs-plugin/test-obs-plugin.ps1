# Ojowacam OBS Plugin - Runtime Test Script (Windows PowerShell)
# Run this on a machine with OBS Studio 30.1.2+ installed
#
# Usage:
#   .\test-obs-plugin.ps1 -PluginPath "C:\path\to\built\plugin"

param(
    [string]$PluginPath = "$PWD\apps\obs-plugin\build\data\obs-plugins\ojowacam-obs",
    [string]$ObsExe = "C:\Program Files\obs-studio\bin\64bit\obs64.exe"
)

$ErrorActionPreference = "Stop"
$TestResults = @()
$Passed = 0
$Failed = 0

function Write-TestResult {
    param([string]$Test, [bool]$Passed, [string]$Message = "")
    $status = if ($Passed) { "PASS" } else { "FAIL" }
    Write-Host "[$status] $Test" -ForegroundColor (if ($Passed) { "Green" } else { "Red" })
    if ($Message) { Write-Host "      $Message" -ForegroundColor "Gray" }
    $TestResults += [PSCustomObject]@{ Test = $Test; Passed = $Passed; Message = $Message; Time = Get-Date }
    if ($Passed) { $script:Passed++ } else { $script:Failed++ }
}

# -------------------------------------------------------
# TEST 2: OBS Studio is installed
# -------------------------------------------------------
Write-Host "Test 2: OBS Studio installation" -ForegroundColor Yellow

$obsPaths = @(
    "C:\Program Files\obs-studio\bin\64bit\obs64.exe",
    "C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe",
    "$env:LOCALAPPDATA\obs-studio\bin\64bit\obs64.exe"
)

$obsFound = $false
foreach ($p in $obsPaths) {
    if (Test-Path $p) {
        $obsFound = $true
        $ObsExe = $p
        Write-TestResult "OBS Studio executable found" $true "Path: $p"
        break
    }
}

if (-not $obsFound) {
    Write-TestResult "OBS Studio executable found" $false "Checked: $($obsPaths -join ', ')"

# -------------------------------------------------------
# TEST 3: Install plugin to OBS plugins folder
# -------------------------------------------------------
Write-Host ""
Write-Host "Test 3: Install plugin to OBS plugins folder" -ForegroundColor Yellow

$obsPluginsDir = Join-Path $env:APPDATA "obs-studio\plugins\ojowacam-obs"

if ($obsFound) {
    if (-not (Test-Path $obsPluginsDir)) {
        New-Item -ItemType Directory -Path $obsPluginsDir -Force | Out-Null
    }
    
    Get-ChildItem -Path $PluginPath -File | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $obsPluginsDir -Force
    }
    
    $installedDll = Join-Path $obsPluginsDir "ojowacam-obs.dll"
    $installedJson = Join-Path $obsPluginsDir "module.json"
    
    if (Test-Path $installedDll -And Test-Path $installedJson) {
        Write-TestResult "Plugin installed to OBS plugins folder" $true "Path: $obsPluginsDir"

# -------------------------------------------------------
# TEST 4: Launch OBS and verify plugin loads
# -------------------------------------------------------
Write-Host ""
Write-Host "Test 4: Launch OBS and verify plugin loads" -ForegroundColor Yellow

if ($obsFound -And (Test-Path $obsPluginsDir)) {
    $obsProcess = Start-Process -FilePath $ObsExe -ArgumentList "--startvirtualcam" -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 10
    
    if ($obsProcess.HasExited) {
        Write-TestResult "OBS Studio launches successfully" $false "OBS exited with code: $($obsProcess.ExitCode)"
    } else {
        Write-TestResult "OBS Studio launches successfully" $true "PID: $($obsProcess.Id)"
        
        $obsLogPath = Join-Path $env:APPDATA "obs-studio\logs\obs.log"
        if (Test-Path $obsLogPath) {
            $logContent = Get-Content $obsLogPath -Raw
            $pluginLoaded = $logContent -match "Ojowacam"
            $pluginError = $logContent -match "error.*ojowacam|ojowacam.*error|fail.*ojowacam|ojowacam.*fail"
            
            if ($pluginLoaded -And -not $pluginError) {
                Write-TestResult "Ojowacam plugin loads in OBS" $true "No errors in obs.log"
            } elseif ($pluginLoaded -And $pluginError) {
                Write-TestResult "Ojowacam plugin loads in OBS" $false "Errors found in obs.log related to Ojowacam"
            } else {
                Write-TestResult "Ojowacam plugin loads in OBS" $false "No Ojowacam messages found in obs.log"
            }
        } else {
            Write-TestResult "OBS log file exists" $false "Log path: $obsLogPath"
        }

# -------------------------------------------------------
# TEST 5: Verify plugin source registration
# -------------------------------------------------------
Write-Host ""
Write-Host "Test 5: Verify Ojowacam sources registered" -ForegroundColor Yellow

if (Test-Path $obsLogPath) {
    $logContent = Get-Content $obsLogPath -Raw
    
    $videoSource = $logContent -match "ojowacam_video_source|Ojowacam Video"
    $audioSource = $logContent -match "ojowacam_audio_source|Ojowacam Microphone"
    
    if ($videoSource -And $audioSource) {
        Write-TestResult "Ojowacam Video and Microphone sources registered" $true
    } elseif ($videoSource) {
        Write-TestResult "Ojowacam Video source registered" $true "Audio source not found in log"
        Write-TestResult "Ojowacam Microphone source registered" $false
    } elseif ($audioSource) {
        Write-TestResult "Ojowacam Video source registered" $false
        Write-TestResult "Ojowacam Microphone source registered" $true
    } else {
        Write-TestResult "Ojowacam sources registered" $false "Neither video nor audio source found in log"
    }
} else {
    Write-TestResult "Ojowacam sources registered" $false "OBS log not available"
}

# -------------------------------------------------------
# TEST 6: Clean uninstall
# -------------------------------------------------------
Write-Host ""
Write-Host "Test 6: Clean uninstall" -ForegroundColor Yellow

if (Test-Path $obsPluginsDir) {
    try {
        Remove-Item -Path $obsPluginsDir -Recurse -Force -ErrorAction Stop
        Write-TestResult "Plugin folder removed cleanly" $true
    } catch {
        Write-TestResult "Plugin folder removed cleanly" $false "Error: $_"
    }
} else {
    Write-TestResult "Plugin folder removed cleanly" $false "Folder does not exist"
}

# -------------------------------------------------------
# Summary
# -------------------------------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Passed: $Passed" -ForegroundColor Green
Write-Host "Failed: $Failed" -ForegroundColor (if ($Failed -gt 0) { "Red" } else { "Green" })
Write-Host "Total:  $($Passed + $Failed)" -ForegroundColor Cyan
Write-Host ""

$resultsPath = Join-Path $PWD "obs-plugin-test-results.csv"
$TestResults | Export-Csv -Path $resultsPath -NoTypeInformation
Write-Host "Results exported to: $resultsPath"

if ($Failed -gt 0) {
    exit 1
}
        
        Stop-Process -Id $obsProcess.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
    }
} else {
    Write-TestResult "OBS Studio launches with plugin" $false "Prerequisites not met"
}
    } else {
        Write-TestResult "Plugin installed to OBS plugins folder" $false "Copy failed"
    }
} else {
    Write-TestResult "Plugin installed to OBS plugins folder" $false "OBS Studio not found, skipping"
}
}