# Ojowacam

Your Phone. Your Camera. Your Studio.

Professional-grade application that turns your smartphone into a high-quality wireless or USB webcam and microphone.

## Features
- **Wi-Fi connection:** Connect over the same network.
- **USB connection:** Connect directly via ADB or tethering.
- **HD video:** 720p, 1080p, 4K.
- **Audio transmission.**
- **OBS Studio integration.**
- **Remote camera controls** (zoom, focus, torch).

## Getting Started
- Follow the `ROADMAP.md` for the development plan.
- See `architecture/ARCHITECTURE.md` for the system design.
- See `development/BUILD_AND_RUN.md` to build the mobile app and OBS plugin and run them together.
- See `protocols/PROTOCOL.md` for the wire protocol (pairing, session auth, heartbeat).
## Features

### Core Features
- **Wi-Fi connection** - Connect phone and PC over the same local network
- **USB connection** - Connect directly via ADB reverse port forwarding or USB tethering
- **HD video** - 720p, 1080p, and 4K (3840x2160) at 30/60 FPS
- **Audio transmission** - Use phone microphone as PC microphone (Opus codec)
- **Front/rear camera** - Switch between cameras remotely
- **Camera controls** - Zoom, flashlight (torch), autofocus, exposure
- **Portrait/landscape** - Support both orientations
- **Low latency** - Target under 150 ms over Wi-Fi, under 100 ms over USB
- **Adaptive bitrate** - Automatically reduces quality when connection deteriorates

### OBS Studio Integration
- **Native OBS plugin** - Video and audio sources appear directly in OBS Studio
- **No virtual camera driver needed** - Direct integration via libobs
- **Camera controls from OBS** - Switch camera, toggle torch, adjust zoom
- **Stream statistics** - Connection quality, latency, bitrate, frame rate

### Supported Platforms
| Platform | Role | Technology |
|----------|------|------------|
| Android | Mobile app | React Native + Kotlin + Camera2 + MediaCodec |
| iOS | Mobile app | React Native + Swift + AVFoundation + VideoToolbox |
| Windows | Desktop client | C# .NET 8 + WPF + Media Foundation |
| macOS | Desktop client | Swift + SwiftUI + CoreMediaIO |
| OBS Plugin | OBS integration | C++ + libobs (Windows + macOS) |

### Connection Modes
- **Wi-Fi** - mDNS discovery + QR code pairing + WebRTC streaming
- **USB** - ADB reverse port forwarding (Android) or USB tethering (iOS)

## Quick Start

### Mobile App
1. Install Ojowacam on your Android or iPhone
2. Connect phone and computer to the same Wi-Fi network
3. Open Ojowacam on your phone
4. Open Ojowacam Desktop on your computer
5. Scan the QR code or enter the pairing code
6. Select your phone from the device list
7. Click "Connect" and start streaming!

### OBS Studio
1. Install the Ojowacam OBS plugin
2. Restart OBS Studio
3. Add "Ojowacam Video" as a source
4. Add "Ojowacam Microphone" as an audio source
5. Configure device ID and signaling URL in source properties
6. Click "Connect" in the source properties

