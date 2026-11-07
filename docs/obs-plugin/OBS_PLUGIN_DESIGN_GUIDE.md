# Ojowacam OBS Plugin — Design Guide

This document is a design and implementation reference for the ojowacam OBS Studio plugin. It synthesizes best practices from two sources:

1. **The ojowacam OBS plugin documentation** (`docs/obs-plugin/OBS_PLUGIN_TESTING.md`) — the existing project baseline, including source layout, installation paths, and the runtime verification checklist.
2. **DroidCam** (Dev47Apps) — a mature "phone as webcam" solution with a dedicated OBS plugin, providing proven patterns for device discovery, connection, resolution presets, audio handling, and cross-platform installation.

Use this guide when implementing or extending the ojowacam OBS plugin on Windows and macOS.

---

## 1. Architecture Overview

The ojowacam OBS plugin is an OBS Studio module (`.dll` on Windows, `.bundle` on macOS) that registers two OBS source types:

| Source ID | OBS Source Type | Output Flags | Display Name |
|-----------|----------------|--------------|--------------|
| `ojowacam_video_source` | `OBS_SOURCE_TYPE_INPUT` | `OBS_SOURCE_VIDEO` | "Ojowacam Video" |
| `ojowacam_audio_source` | `OBS_SOURCE_TYPE_INPUT` | `OBS_SOURCE_AUDIO` | "Ojowacam Microphone" |

Each source has properties for **Device ID** and **Signaling URL** (WebRTC signaling endpoint). The plugin connects to an Ojowacam mobile app over Wi-Fi or USB using WebRTC, decodes H.264 video and Opus audio, and pushes frames/samples into OBS.

### Plugin binary layout (installed by CI/MSI)

**Windows** (`%PROGRAMDATA%\obs-studio\plugins\ojowacam-obs\`):
```
ojowacam-obs\
  bin\64bit\ojowacam-obs.dll
  data\module.json
```

**macOS** (`~/Library/Application Support/obs-studio/plugins/ojowacam-obs\`):
```
ojowacam-obs\
  ojowacam-obs.bundle/
  module.json
```

> DroidCam precedent: On Windows DroidCam appears as a system webcam ("DroidCam" / "DroidCam Source 2") that any app can select. On Linux it uses a v4l2loopback device (`/dev/video*`) so OBS lists it natively. The ojowacam plugin takes the dedicated-OBS-source approach instead, which gives finer control over WebRTC signaling and device pairing but requires OBS Studio specifically.

---

## 2. Source Registration Pattern (from existing source)

**Windows** (`apps/obs-plugin/windows/src/obs-registration.cpp`):
```cpp
OBS_DECLARE_MODULE()

const char *obs_module_name(void) { return "Ojowacam OBS Plugin"; }

bool obs_module_load(void) {
    obs_register_source(&ojowacam_video_source_info);
    obs_register_source(&ojowacam_audio_source_info);
    DeviceManager::GetInstance()->Initialize();
    return true;
}

void obs_module_unload(void) {
    DeviceManager::GetInstance()->Shutdown();
}
```

**macOS** (`apps/obs-plugin/macos/src/plugin.mm`):
```objc
BOOL obs_module_load(void) {
    obs_register_source(&ojowacam_camera_source_info);
    obs_register_source(&ojowacam_audio_source_info);
    [OjowacamDeviceManager sharedManager];
    return TRUE;
}
```

Both platforms follow the standard OBS module contract: `obs_module_load`, `obs_module_unload`, `obs_module_name`.

---

## 3. Device Discovery & Pairing (DroidCam-inspired improvement)

### Current state
The `DeviceManager` (shared C++ on Windows, Objective-C on macOS) has stub `Initialize()` / `Shutdown()` methods with TODO comments for mDNS discovery and WebRTC signaling. Source properties require the user to manually type a **Device ID** and **Signaling URL**.

### Recommended pattern (from DroidCam)
DroidCam's PC client discovers the phone automatically:
- **Wi-Fi**: The phone advertises its IP/port; the client can connect via `http://WIFI-IP:PORT/video/SIZE`.
- **USB**: Uses `adb` (Android) or `usbmuxd` (iOS) to tunnel the connection.

### Suggested enhancement for ojowacam
1. Implement mDNS/DNS-SD discovery in `DeviceManager::Initialize()` to find Ojowacam mobile devices on the local network.
2. Populate `DiscoveredDevice` entries (`device_id`, `device_name`, `ip_address`, `port`, `supports_video`, `supports_audio`).
3. Replace the manual Device ID text field with a **dropdown list** of discovered devices in source properties.
4. Keep the Signaling URL field as an advanced/manual override.
5. Add a **"Refresh Devices"** button that re-triggers discovery.

---

## 4. Source Properties Design (from DroidCam + existing source)

### Current properties (Windows `video-source.cpp`)
- `device_id` (text)
- `signaling_url` (text)
- `connect` (button)
- `resolution_width` (int, 1–7680)
- `resolution_height` (int, 1–4320)
- `fps` (int, 1–60)

### Current properties (macOS `camera-source.mm`)
- `device_id` (text)
- `signaling_url` (text)
- `connect` (button)

### Recommended properties (synthesized)

| Property | Type | Range/Default | Rationale |
|----------|------|---------------|-----------|
| `device_id` | dropdown/text | discovered devices | DroidCam shows the phone as a selectable device |
| `signaling_url` | text | `ws://<phone-ip>:<port>` | Manual override for advanced users |
| `connection` | button | "Connect" / "Disconnect" | Toggle connection state |
| `resolution` | dropdown | 1280×720, 1920×1080, 3840×2160 | DroidCam offers preset sizes (480p, 720p, 1080p, 4K) |
| `fps` | int | 1–60, default 30 | Matches existing |
| `audio_enabled` | bool | true | Whether to also create/pair an audio source |
| `connection_status` | readonly text | "Disconnected"/"Connected" | Visual feedback like DroidCam's client UI |

---

## 5. Connection & Streaming Lifecycle

### Sequence (from existing `StreamReceiver`)
```
1. obs_source_create() → StreamReceiver constructed
2. StreamReceiver::connect(device_id, signaling_url)
   ├── WebRTCTransport::connect(signaling_url)
   ├── WebRTCTransport::createOffer()
   ├── onVideoFrame → StreamSynchronizer::pushVideoFrame
   └── onAudioFrame → StreamSynchronizer::pushAudioFrame
3. VideoDecoder::onFrameDecoded → (TODO) push to OBS video source
4. AudioDecoder::onFrameDecoded → (TODO) push to OBS audio source
5. disconnect() → transport.disconnect()
```

### DroidCam precedent
DroidCam offers **two connection modes**:
- **Wi-Fi**: Phone and PC on same network; client connects to phone's IP:port.
- **USB**: adb tunnel (Android) or usbmuxd (iOS); no Wi-Fi required.

### Recommended enhancements
1. **Auto-reconnect**: If the WebRTC transport disconnects (e.g., Wi-Fi dropped), attempt reconnection with exponential backoff. Display "Disconnected" / "Reconnecting..." status.
2. **Connection state UI**: Show a status indicator in source properties (connected/disconnected/error).
3. **USB fallback**: Document that USB connections require adb (Android) or usbmuxd (iOS), mirroring DroidCam's Linux USB setup instructions.
4. **Pairing code**: The mobile app displays a pairing/QR code; the OBS source properties should accept a pairing code that resolves to device_id + signaling_url automatically (as described in `docs/development/WORKFLOW.md`).

---

## 6. Video Frame Delivery to OBS

### Current state (placeholders)
- `FrameConverter::convertToTexture()` returns `nullptr` (stub).
- `StreamReceiver::Impl::video_decoder->onFrameDecoded` has a TODO to push to OBS video source.
- macOS `camera-source.mm` `ojowacam_camera_render()` has a TODO to convert `CVPixelBuffer` to OBS texture.

### Implementation pattern
1. Decoded `VideoFrame` → `StreamSynchronizer` → `FrameConverter::convertToTexture()` → `gs_texture_t*`
2. In `ojowacam_video_render()`, bind the texture via `gs_effect_set_texture(image, texture)` and `gs_draw_sprite()`.
3. On macOS, convert `CVPixelBufferRef` → `CIImage` → `CGImage` → `NSImage` → OBS texture (partial implementation exists in `stream-receiver.mm`).

### DroidCam precedent
DroidCam on Linux uses v4l2loopback so OBS reads frames as a standard V4L2 device — no custom frame pushing needed. On Windows/macOS the dedicated plugin pushes frames directly into OBS source textures, which is the approach ojowacam already follows.

---

## 7. Audio Delivery to OBS

### Current state
- `ojowacam_audio_source_info` registers `Ojowacam Microphone` with `OBS_SOURCE_AUDIO`.
- `StreamReceiver` has an `AudioDecoder` (Opus) with a TODO callback.
- macOS `audio-source.mm` has `ojowacam_audio_tick()` (unused placeholder).

### Recommended implementation
1. Decoded Opus audio → PCM float samples → push via `obs_source_output_audio()` or `obs_source_enum_monitored_audio()` depending on OBS version.
2. Expose sample rate and channel count properties (already present: 8000–192000 Hz, 1–8 channels).
3. Add mute/unmute support that stops/starts audio meter movement (tested in verification checklist item 5).

---

## 8. Cross-Platform Build & Installation

### CMake structure (from existing source)
```
apps/obs-plugin/
  CMakeLists.txt           # Top-level: finds OBS, includes streaming-core, dispatches by platform
  windows/CMakeLists.txt   # Windows: add_library(ojowacam-obs MODULE ...), .dll output
  windows/data/module.json # OBS module manifest
  macos/CMakeLists.txt     # macOS: add_library(... MODULE ...), .bundle output, CoreMediaIO/CoreVideo
  macos/data/module.json
  macos/data/Info.plist
  shared/include/*.h       # Cross-platform: device-manager, stream-receiver, frame-converter
  shared/src/*.cpp         # Cross-platform implementations
```

### module.json pattern
**Windows** (`apps/obs-plugin/windows/data/module.json`):
```json
name=Ojowacam OBS Plugin
description=Turn your smartphone into a webcam and microphone for OBS Studio
author=Ojowacam Team
url=https://github.com/ojowa/ojcam
```

**macOS** (`apps/obs-plugin/macos/data/module.json`):
```json
{
  "id": "ojowacam-obs-macos",
  "name": "Ojowacam OBS Plugin (macOS)",
  "description": "Turn your iPhone into a webcam and microphone for OBS Studio on macOS",
  "author": "Ojowacam Team",
  "url": "https://github.com/ojowa/ojcam",
  "platform": "macOS",
  "sources": ["ojowacam_camera_source", "ojowacam_audio_source"],
  "min_obs_version": "27.0.0"
}
```

> DroidCam precedent: DroidCam provides separate plugin builds per OBS major version (OBS 28, 29, 30, 32, 33) and per platform (Windows/macOS/Linux Flatpak). Ojowacam should similarly version its plugin builds against the OBS SDK it targets (currently OBS 30.1.2 per CI/CD).

---

## 9. Testing Checklist (from `docs/obs-plugin/OBS_PLUGIN_TESTING.md`)

| # | Test | Expected Result |
|---|------|----------------|
| 1 | Launch OBS Studio | OBS starts without errors |
| 2 | Settings → Modules | "Ojowacam OBS Plugin" appears in loaded modules |
| 3 | Check obs.log | No Ojowacam-related crash reports |
| 4 | `+` in Sources panel | "Ojowacam Video" and "Ojowacam Microphone" appear |
| 5 | Add "Ojowacam Video" | Properties dialog opens with Device ID + Signaling URL |
| 6 | Add "Ojowacam Microphone" | Audio source appears in Audio Mixer |
| 7 | Open mobile app | Camera screen shows live preview |
| 8 | Select Wi-Fi or USB | Connection status shows "Connected" |
| 9 | Enter pairing code | Devices authenticate |
| 10 | Start streaming | Video frames appear in OBS preview |
| 11 | Switch camera (front/rear) | Video updates to selected camera |
| 12 | Toggle torch/flashlight | Phone torch turns on/off |
| 13 | Adjust zoom | Video zooms digitally |
| 14 | Change resolution | OBS source updates to new resolution |
| 15 | Audio meter | Moves when speaking near phone mic |
| 16 | Mute/unmute in OBS | Audio meter stops/starts accordingly |
| 17 | Disconnect Wi-Fi | OBS shows disconnected state, source freezes |
| 18 | Reconnect Wi-Fi | OBS auto-reconnects, video resumes |
| 19 | Remove source | No crash or error |
| 20 | Close OBS | Plugin unloads cleanly |

### Automated test scripts
- **Windows**: `tests/obs-plugin/test-obs-plugin.ps1` (PowerShell)
- **macOS**: `tests/obs-plugin/test-obs-plugin.sh` (Bash)

Both scripts: verify plugin files exist → install to OBS plugins folder → launch OBS → check `obs.log` for Ojowacam messages → verify source registration → clean uninstall → export results to CSV.

---

## 10. Troubleshooting Guide

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| Plugin not appearing in OBS | Wrong folder or missing `module.json` | Verify DLL/bundle is next to `module.json` in the correct `ojowacam-obs\` subfolder |
| OBS crashes on startup | Plugin built against wrong OBS version | Rebuild against the OBS SDK matching the installed OBS Studio (CI targets OBS 30.1.2) |
| No video in OBS | Phone not streaming or WebRTC not connected | Start streaming from Ojowacam mobile app first; verify both devices on same network |
| No audio | Microphone permission or audio source not added | Grant mic permission on phone; add "Ojowacam Microphone" as separate audio source |
| SmartScreen / Gatekeeper warning | Unsigned plugin binary | Windows: click "More info" → "Run anyway". macOS: right-click → Open |
| Connection drops | Wi-Fi interruption | Implement auto-reconnect with backoff (see section 5) |

---

## 11. CI/CD Artifact Locations

From `docs/obs-plugin/OBS_PLUGIN_TESTING.md`:

| Artifact | Platform | Files |
|----------|----------|-------|
| `ojowacam-obs-windows` | Windows | `ojowacam-obs.dll`, `module.json` |
| `ojowacam-obs-macos` | macOS | `ojowacam-obs.bundle`, `module.json` |

The CI pipeline builds against OBS 30.1.2 on `windows-latest` and `macos-latest`, signs the Windows DLL, and packages an MSI installer (`Ojowacam.ObsPlugin.msi`) that installs the plugin to `C:\ProgramData\obs-studio\plugins\ojowacam-obs\`.

---

## 12. Recommended Implementation Roadmap

| Phase | Task | Based On |
|-------|------|----------|
| 1 | Fix placeholder `FrameConverter::convertToTexture()` to produce a valid `gs_texture_t*` | Existing source TODO + OBS graphics API |
| 2 | Implement `StreamReceiver` video/audio decode callbacks to push frames into OBS sources | Existing source TODO + OBS source output API |
| 3 | Implement mDNS device discovery in `DeviceManager` | DroidCam device discovery pattern |
| 4 | Replace manual Device ID text field with discovered-device dropdown | DroidCam selectable device pattern |
| 5 | Add resolution preset dropdown (480p/720p/1080p/4K) | DroidCam resolution presets |
| 6 | Add auto-reconnect with backoff on transport disconnect | DroidCam connection recovery |
| 7 | Add pairing-code resolution (QR/manual code → device_id + URL) | `docs/development/WORKFLOW.md` pairing flow |
| 8 | Add connection status indicator in source properties | DroidCam client UI feedback |
| 9 | Document USB connection setup (adb/usbmuxd) | DroidCam Linux USB instructions |
| 10 | Add Windows code-signing and MSI distribution (already in CI) | Existing CI/CD pipeline |

---

## 13. References

- **Ojowacam OBS Plugin Testing Guide**: `docs/obs-plugin/OBS_PLUGIN_TESTING.md` and `apps/obs-plugin/docs/OBS_PLUGIN_TESTING.md`
- **Ojowacam OBS Test Scripts**: `tests/obs-plugin/test-obs-plugin.ps1` (Windows), `tests/obs-plugin/test-obs-plugin.sh` (macOS)
- **Ojowacam Mobile Workflow**: `docs/development/WORKFLOW.md` (discovery → pairing → streaming → decoding)
- **Ojowacam Android Release Setup**: `apps/mobile/android/RELEASE_SETUP.md`
- **DroidCam (Dev47Apps)**: `https://dev47apps.com/` — phone-as-webcam with Wi-Fi/USB, dedicated OBS plugin, resolution presets, v4l2loopback on Linux
- **DroidCam OBS Plugin**: `https://dev47apps.com/droidcam/obs/` — OBS source integration, per-OBS-version builds, connection URL format `http://IP:PORT/video/SIZE`