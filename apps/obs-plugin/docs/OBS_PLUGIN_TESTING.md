# Ojowacam OBS Plugin - Runtime Testing Guide

This document describes how to test the Ojowacam OBS plugin with a real OBS Studio installation on Windows 10/11 and macOS.

## Prerequisites

- OBS Studio 30.1.2 or later installed
- Ojowacam mobile app installed on Android or iOS
- Ojowacam desktop companion running (optional - plugin can work standalone)
- Built plugin artifacts from CI/CD pipeline

---

## Installation

### Windows 10 / Windows 11

The Windows MSI installs the plugin in OBS's recommended system-wide plugin directory:

```
C:\ProgramData\obs-studio\plugins\ojowacam-obs\
  ├── bin\64bit\ojowacam-obs.dll
  └── data\module.json
```

**Manual installation:**
1. Close OBS Studio if running
2. Navigate to `C:\ProgramData\obs-studio\plugins\`
3. Create `ojowacam-obs\bin\64bit\` and `ojowacam-obs\data\`
4. Copy `ojowacam-obs.dll` into `bin\64bit\` and `module.json` into `data\`
5. Launch OBS Studio

**Via MSI installer:**
- Run `Ojowacam.ObsPlugin.msi` as an administrator
- The plugin is installed for all Windows users in the OBS plugin directory

### macOS

The plugin installs to:

```
~/Library/Application Support/obs-studio/plugins/ojowacam-obs/
  ├── ojowacam-obs.bundle/
  └── module.json
```

**Manual installation:**
1. Close OBS Studio if running
2. Navigate to `~/Library/Application Support/obs-studio/plugins/`
3. Create folder `ojowacam-obs\`
4. Copy `ojowacam-obs.bundle` and `module.json` into it
5. Launch OBS Studio

---

## Verification Checklist

### 1. Plugin Loads in OBS

| Step | Expected Result |
|------|----------------|
| Launch OBS Studio | OBS starts without errors |
| Go to Settings → Modules | "Ojowacam OBS Plugin" appears in loaded modules |
| Check Console (Help → Log Files) | No crash reports related to Ojowacam |

### 2. Add Ojowacam Sources

| Step | Expected Result |
|------|----------------|
| Click `+` in Sources panel | "Ojowacam Video" and "Ojowacam Microphone" appear in list |
| Add "Ojowacam Video" source | Properties dialog opens with Device ID and Signaling URL fields |
| Add "Ojowacam Microphone" source | Audio source appears in Audio Mixer |

### 3. Connect Mobile Device

| Step | Expected Result |
|------|----------------|
| Open Ojowacam mobile app | Camera screen shows live preview |
| Select Wi-Fi or USB connection | Connection status shows "Connected" |
| Enter pairing code in OBS source properties | Devices authenticate |
| Start streaming from mobile | Video frames appear in OBS preview |

### 4. Video Playback

| Step | Expected Result |
|------|----------------|
| Video source added to scene | Phone camera feed visible in OBS preview |
| Switch camera (front/rear) | Video updates to selected camera |
| Toggle torch/flashlight | Phone torch turns on/off |
| Adjust zoom | Video zooms digitally |
| Change resolution in mobile app | OBS source updates to new resolution |

### 5. Audio Playback

| Step | Expected Result |
|------|----------------|
| Audio source added | Audio meter moves when speaking near phone mic |
| Mute/unmute in OBS | Audio meter stops/starts accordingly |
| Desktop audio monitoring | Phone audio audible through OBS monitoring |

### 6. Connection Recovery

| Step | Expected Result |
|------|----------------|
| Disconnect Wi-Fi on phone | OBS shows disconnected state, source freezes |
| Reconnect Wi-Fi | OBS automatically reconnects, video resumes |
| Close mobile app | OBS shows disconnected state |
| Reopen mobile app | OBS reconnects automatically |

### 7. Disconnect Cleanly

| Step | Expected Result |
|------|----------------|
| Stop streaming from mobile | Video freezes on last frame, audio stops |
| Remove source from OBS scene | No crash or error |
| Close OBS Studio | Plugin unloads cleanly |

---

## Troubleshooting

### Plugin Not Appearing in OBS

| Cause | Solution |
|-------|----------|
| Wrong folder | Verify the DLL is in `C:\ProgramData\obs-studio\plugins\ojowacam-obs\bin\64bit\` (Windows) or `~/Library/Application Support/obs-studio/plugins/ojowacam-obs\` (macOS) |
| Wrong OBS version | Ensure OBS Studio 30.1.2+ is installed |
| Missing dependencies | Install a compatible 64-bit OBS Studio release; the plugin is linked to OBS and includes the streaming-core code |
| module.json missing | Ensure `data\module.json` is present in the plugin folder |

### No Video in OBS

| Cause | Solution |
|-------|----------|
| Phone not streaming | Start streaming from Ojowacam mobile app first |
| Wrong signaling URL | Verify the URL in source properties matches the desktop receiver |
| Firewall blocking | Allow Ojowacam through Windows Defender Firewall |
| WebRTC connection failed | Check both devices are on same Wi-Fi network |

### Audio Not Working

| Cause | Solution |
|-------|----------|
| Microphone permission denied | Grant microphone permission to Ojowacam mobile app |
| Audio source not added | Add "Ojowacam Microphone" as a separate audio source in OBS |
| Sample rate mismatch | Ensure 48 kHz is configured on both ends |

### Code Signing Warnings (Windows)

| Cause | Solution |
|-------|----------|
| Unsigned DLL | Windows SmartScreen may show a warning. Click "More info" → "Run anyway" |
| Invalid certificate | Obtain a valid code signing certificate from a trusted CA |

---

## CI/CD Artifact Locations

After a successful CI run, download artifacts from the GitHub Actions release page:

| Artifact | Platform | File |
|----------|----------|------|
| `ojowacam-obs-windows` | Windows | `ojowacam-obs.dll`, `module.json` |
| `ojowacam-obs-macos` | macOS | `ojowacam-obs.bundle`, `module.json` |

---

## Windows 10 / 11 Compatibility

The Ojowacam OBS plugin is built for 64-bit OBS Studio on Windows 10 and Windows 11.

The CI pipeline builds against the OBS 30.1.2 API using the Windows 2022 toolchain. The runner OS is only the build environment; it does not change the plugin's install location or OBS's supported Windows versions.

## Current functionality

The Windows module registers the Ojowacam video and microphone source entries. Live streaming is not complete yet: the mobile signaling sender, WebRTC transport, encoded-media decoders, and OBS frame/audio output paths still contain unimplemented placeholders. A successful build or installation does not mean that live video or audio reception is available.
