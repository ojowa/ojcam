# Development Roadmap

Development is divided into eight milestones. The order is important: prove the media pipeline works before spending time on sophisticated UI.

## Milestone 1 – Foundation
**First priority**
- Create monorepo.
- Configure React Native.
- Configure CMake and C++.
- Create Windows and macOS desktop shells.
- Establish protocol definitions.
**Estimated:** 1–2 weeks

## Milestone 2 – Android camera streaming
- Native Camera2 integration.
- Microphone capture.
- Hardware H264 encoding.
- WebRTC streaming.
- 1080p and 4K capability detection.
**Estimated:** 2–3 weeks

## Milestone 3 – Windows receiver
- Device discovery.
- QR pairing.
- WebRTC receiver.
- Video decoding.
- Audio decoding.
- Live preview.
**Estimated:** 2–3 weeks

## Milestone 4 – OBS integration
- Native OBS source.
- Native audio source.
- Camera controls.
- Resolution selection.
- Audio/video synchronization.
**Estimated:** 2–3 weeks

## Milestone 5 – iOS implementation
- AVFoundation.
- VideoToolbox.
- iOS microphone.
- WebRTC integration.
- iOS pairing and streaming.
**Estimated:** 2–4 weeks

## Milestone 6 – macOS implementation
- macOS companion.
- Native streaming receiver.
- macOS plugin.
- Audio integration.
**Estimated:** 2–3 weeks

## Milestone 7 – USB support
- Android ADB integration.
- Android USB.
- iOS USB evaluation.
- Automatic switching.
- Reconnection management.
**Estimated:** 2–4 weeks

## Milestone 8 – Production release
- Performance optimization.
- 4K testing.
- Security testing.
- Installers.
**Estimated:** 2–3 weeks
