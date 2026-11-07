# Ojowacam OBS Plugin - Runtime Testing Guide

This document describes how to test the Ojowacam OBS plugin against a real OBS Studio installation.

## Prerequisites

- OBS Studio 30.1.2 or later installed
- Built plugin artifacts from CI/CD pipeline
- Windows 10/11 or macOS with admin access

## Test Scripts

| Platform | Script | Description |
|----------|--------|-------------|
| Windows | `tests/obs-plugin/test-obs-plugin.ps1` | PowerShell test suite |
| macOS | `tests/obs-plugin/test-obs-plugin.sh` | Bash test suite |

## Manual Test Procedure

### Installation

**Windows:**
1. Close OBS Studio if running
2. Navigate to `%APPDATA%\obs-studio\plugins\`
3. Create folder `ojowacam-obs\`
4. Copy `ojowacam-obs.dll` and `module.json` from CI artifacts into it
5. Launch OBS Studio

**macOS:**
1. Close OBS Studio if running
2. Navigate to `~/Library/Application Support/obs-studio/plugins/`
3. Create folder `ojowacam-obs\`
4. Copy `ojowacam-obs.bundle` and `module.json` from CI artifacts into it
5. Launch OBS Studio

### Verification Checklist

| # | Test | Expected Result |
|---|------|----------------|
| 1 | Launch OBS Studio | OBS starts without crashes |
| 2 | Check Console (Help → Log Files) | No Ojowacam-related errors |
| 3 | Click `+` in Sources panel | "Ojowacam Video" and "Ojowacam Microphone" appear |
| 4 | Add "Ojowacam Video" source | Properties dialog opens with Device ID and Signaling URL fields |
| 5 | Add "Ojowacam Microphone" source | Audio source appears in Audio Mixer |
| 6 | Start streaming from Ojowacam mobile app | Video frames appear in OBS preview |
| 7 | Switch camera (front/rear) | Video updates to selected camera |
| 8 | Toggle torch/flashlight | Phone torch turns on/off |
| 9 | Change resolution in mobile app | OBS source updates to new resolution |
| 10 | Audio meter in OBS | Moves when speaking near phone mic |
| 11 | Disconnect Wi-Fi on phone | OBS shows disconnected state |
| 12 | Reconnect Wi-Fi | OBS automatically reconnects |
| 13 | Remove source from scene | No crash or error |
| 14 | Close OBS Studio | Plugin unloads cleanly |

### Automated Test Execution

**Windows (PowerShell):**
```powershell
# From the repository root
.\tests\obs-plugin\test-obs-plugin.ps1 -PluginPath "apps/obs-plugin/build/data/obs-plugins/ojowacam-obs"
```

**macOS (Bash):**
```bash
# From the repository root
chmod +x tests/obs-plugin/test-obs-plugin.sh
./tests/obs-plugin/test-obs-plugin.sh apps/obs-plugin/build/data/obs-plugins/ojowacam-obs
```

### Test Results

Test results are exported to `obs-plugin-test-results.csv` in the current directory.

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Plugin not appearing in OBS | Verify plugin is in the correct `ojowacam-obs\` subfolder under OBS plugins directory |
| OBS crashes on startup | Check `obs.log` for Ojowacam-related errors; ensure plugin is built against correct OBS version |
| No video in OBS | Start streaming from Ojowacam mobile app first; verify both devices on same network |
| No audio | Add "Ojowacam Microphone" as a separate audio source; grant microphone permission on phone |
| SmartScreen/Gatekeeper warning | Plugin is unsigned; click "More info" → "Run anyway" (Windows) or right-click → Open (macOS) |

## CI Integration

The runtime test is designed to be run manually on a machine with OBS Studio installed. It is not currently part of the GitHub Actions CI pipeline because OBS Studio requires a GUI environment.

To add it to CI in the future, you would need:
- A self-hosted runner with OBS Studio installed
- Xvfb/Xvnc for headless OBS testing (Linux)
- The test script invoked as a post-build step
