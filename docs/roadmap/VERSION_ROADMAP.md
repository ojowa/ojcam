# Ojowacam Version Feature Roadmap

## Version History

| Version | Date | Status | Key Features |
|---------|------|--------|-------------|
| 1.0.0 | 2026-11-06 | Released | Android+iOS, Windows+macOS, Wi-Fi+USB, OBS integration, 4K video, QR pairing |
| 1.1.0 | Q1 2027 | Planned | Bug fixes, performance improvements, built-in recording, UI improvements |
| 1.2.0 | Q2 2027 | Planned | Multiple phone support, remote streaming (internet), enhanced OBS controls |
| 2.0.0 | Q4 2027 | Planned | Cloud accounts, AI background removal, subscription model, mobile-to-mobile streaming |

## Version 1.1.0 — Stability & Core Enhancements

**Target Release:** Q1 2027  
**Focus:** Stability, performance, and essential missing features

### New Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Built-in Video Recording | Record phone camera stream directly to phone storage (MP4) | High |
| Recording to Desktop | Save streamed video to computer hard drive | High |
| Session History | View past streaming sessions with duration and quality stats | Medium |
| Improved UI Themes | Dark mode, customizable accent colors | Medium |
| Keyboard Shortcuts | Desktop app hotkeys for common actions (switch camera, torch, disconnect) | Medium |
| Connection Profiles | Save and quickly reconnect to previously paired devices | Medium |

### Performance Improvements
- Reduce Wi-Fi latency by 15-20% through WebRTC congestion control tuning
- Optimize H264 encoder presets for lower CPU usage on mid-range phones
- Reduce memory footprint by 10-15% on desktop receiver
- Faster device discovery (mDNS optimization)

### Bug Fixes
- Fix occasional frame drops during network congestion
- Fix audio/video desync after long streaming sessions (>1 hour)
- Fix USB connection dropping when phone screen turns off
- Fix OBS plugin crash on macOS when disconnecting abruptly

### Platform Support
- Android: Add support for Android 15 (API 35)
- iOS: Add support for iOS 18
- Windows: Add support for Windows 11 24H2
- macOS: Add support for macOS 15 (Sequoia)
## Version 1.2.0 — Multi-Device & Remote Access

**Target Release:** Q2 2027  
**Focus:** Multiple phone support and internet streaming

### New Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Multiple Phone Support | Connect and switch between up to 3 phones simultaneously | High |
| Phone Mixing | Mix video from multiple phones in OBS (picture-in-picture) | High |
| Remote Streaming | Stream over the internet (not just local network) | High |
| Cloud Pairing | Optional cloud-based device pairing for remote access | Medium |
| Mobile-to-Mobile | Stream from one phone to another phone (no computer needed) | Medium |
| OBS Scene Integration | Auto-create OBS scenes with phone sources | Medium |

### Remote Streaming Architecture

```
Phone → Encrypted Tunnel → Relay Server → Desktop/OBS
                                   ↑
                              Authentication Layer
```

### Security Enhancements
- End-to-end encryption for remote streaming
- Optional two-factor authentication for cloud pairing
- IP allowlisting for desktop connections
- Audit log for all connection attempts

### Platform Support
- Android: Add foldable phone support (flex mode)
- iOS: Add iPad support (split view streaming)
- Windows: Add Windows on ARM support
- macOS: Add Apple Silicon Mac optimization

## Version 2.0.0 — Cloud Platform & AI Features

**Target Release:** Q4 2027  
**Focus:** Cloud infrastructure, AI features, and monetization

### New Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Cloud Accounts | User registration, login, and cross-device sync | High |
| AI Background Removal | Real-time background removal/replacement (virtual green screen) | High |
| AI Noise Cancellation | Microphone noise suppression using ML | High |
| Auto-Framing | AI-powered subject tracking and auto-zoom | Medium |
| Cloud Recording | Save recordings to cloud storage (Google Drive, Dropbox, S3) | Medium |
| Subscription Tiers | Free, Pro, and Enterprise plans | High |
| Team Management | Share phone cameras with team members | Medium |
| API Access | REST API for programmatic control | Medium |

### Monetization

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | Local Wi-Fi streaming, 1080p, 1 phone, ads |
| Pro | $4.99/month | 4K streaming, USB, remote streaming, no ads, cloud recording (5GB) |
| Enterprise | $14.99/month | Multiple phones, team management, API access, priority support, SLA |

### AI/ML Features
- **Background Removal:** Real-time segmentation using TensorFlow Lite/Core ML
- **Noise Cancellation:** Spectral subtraction + RNNoise
- **Auto-Framing:** Face detection + subject tracking
- **Low-Light Enhancement:** AI-powered image enhancement for dark environments

### Infrastructure
- Cloud relay servers (WebRTC TURN/STUN)
- User authentication service (OAuth 2.0)
- Cloud storage integration API
- Analytics dashboard
- Billing and subscription management

## Long-Term Vision (2028+)

### Version 3.0.0 — AR/VR & Spatial Computing
- Spatial video capture for Apple Vision Pro / Meta Quest
- 3D camera depth streaming
- AR overlay support in OBS
- Gesture control for camera operations

### Version 4.0.0 — Professional Broadcast
- SDI/HDMI output support (via capture cards)
- Multi-camera switching hardware integration
- Broadcast-quality codecs (ProRes, DNxHR)
- Color grading and LUT support
- SMPTE timecode support

## Deprecation Schedule

| Feature | Version | Replacement |
|---------|---------|-------------|
| ADB-only USB (Android) | 2.0.0 | Native USB accessory protocol |
| H264-only encoding | 2.0.0 | HEVC/AV1 support |
| Local-only pairing | 2.0.0 | Cloud pairing (optional) |
| Free 4K streaming | 2.0.0 | Pro subscription required |

## Feature Request Backlog

### Community Requests (Most Voted)
1. **Built-in video recording** — 842 votes
2. **Multiple phone support** — 731 votes
3. **Remote streaming over internet** — 689 votes
4. **Dark mode** — 543 votes
5. **Cloud recording** — 498 votes
6. **AI background removal** — 445 votes
7. **iPad support** — 392 votes
8. **Windows on ARM** — 287 votes
9. **Linux desktop support** — 234 votes
10. **API/webhook integrations** — 189 votes

### Platform-Specific Requests
- Android: Scrcpy integration, USB-C DisplayPort alt mode
- iOS: Continuity Camera compatibility, AirPlay receiver mode
- Windows: DirectShow virtual camera (for non-OBS apps)
- macOS: Screen Recording permission automation, Camera continuity

## Release Cadence

| Release Type | Frequency | Example |
|--------------|-----------|---------|
| Major (x.0.0) | Every 12-18 months | 2.0.0 |
| Minor (x.x.0) | Every 3-4 months | 1.1.0, 1.2.0 |
| Patch (x.x.x) | Every 2-4 weeks | 1.1.1, 1.1.2 |

## Contributing to Roadmap

Feature requests and voting: https://github.com/ojowa/ojcam/discussions  
Bug reports: https://github.com/ojowa/ojcam/issues  
Roadmap discussions: https://github.com/ojowa/ojcam/discussions/categories/roadmap

**Last Updated:** November 6, 2026

