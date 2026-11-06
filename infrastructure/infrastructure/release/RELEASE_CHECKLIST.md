# Release Checklist - Ojowacam v1.0.0

## Pre-Release Checklist

### Code Quality
- [ ] All code compiled without warnings
- [ ] No TODO markers in production code
- [ ] All public APIs documented
- [ ] Error handling implemented for all failure paths
- [ ] Resource cleanup (memory, handles, sockets) verified
- [ ] No hardcoded credentials or API keys

### Android Build
- [ ] Release APK built with proper signing keystore
- [ ] ProGuard/R8 minification enabled
- [ ] ABI splits configured (armeabi-v7a, arm64-v8a, x86, x86_64)
- [ ] All required permissions declared in AndroidManifest.xml
- <foregroundServiceType="camera|microphone" configured
- [ ] Target SDK version set to 34 (Android 14)
- [ ] App tested on: Samsung, Pixel, Xiaomi devices

### iOS Build
- [ ] Release IPA built with proper signing certificate
- [ ] App Store Connect metadata prepared
- [ ] Camera/microphone usage descriptions in Info.plist
- [ ] Background modes configured (audio, VoIP)
- [ ] App tested on: iPhone 13, 14, 15 series
- [ ] Deployment target: iOS 13.0+

### Windows Build
- [ ] Release build in .NET 8
- [ ] MSI installer created with WiX
- [ ] App tested on Windows 10 and Windows 11
- [ ] ADB detected and reverse port forwarding works
- [ ] OBS Studio integration verified (27.0+)

### macOS Build
- [ ] Release build with Swift
- [ ] DMG installer created and notarized
- [ ] App sandbox entitlements configured
- [ ] App tested on macOS Sonoma and Ventura
- [ ] CoreMediaIO virtual camera plugin built
- [ ] App notarized with Apple (if distributing outside App Store)

### OBS Plugin
- [ ] Windows plugin built with Media Foundation
- [ ] macOS plugin built with CoreMediaIO
- [ ] Plugin tested with OBS Studio 27.0+
- [ ] Video source appears in OBS source list
- [ ] Audio source appears in OBS audio sources
- [ ] Source properties dialog works

### Security
- [ ] All media transport encrypted (DTLS-SRTP)
- [ ] Signaling uses WSS (TLS 1.2+)
- [ ] Pairing uses short-lived tokens
- [ ] Rate limiting on pairing attempts
- [ ] No hardcoded credentials
- [ ] Security audit completed (see SECURITY_AUDIT.md)

### Performance
- [ ] 1080p 30 FPS stable for 2+ hours
- [ ] Latency < 150 ms on Wi-Fi 5 GHz
- [ ] 4K 30 FPS on supported devices
- [ ] Adaptive bitrate on network degradation
- [ ] USB connection with < 100 ms latency
- [ ] Frame drops < 2% per minute

### Documentation
- [ ] README.md updated with installation instructions
- [ ] ARCHITECTURE.md reflects final design
- [ ] API documentation for all public interfaces
- [ ] User guide for mobile app
- [ ] User guide for desktop app
- [ ] OBS plugin setup guide
- [ ] Troubleshooting guide
- [ ] Security best practices document

### CI/CD
- [ ] GitHub Actions workflow configured
- [ ] Android build job passes
- [ ] Windows build job passes
- [ ] macOS build job passes
- [ ] C++ streaming core build job passes
- [ ] Security scan passes
- [ ] Release tags trigger automatic release creation

### Installers
- [ ] Windows MSI installer tested
- [ ] macOS DMG installer tested
- [ ] Android APK/AAB tested on multiple devices
- [ ] Uninstall works cleanly
- [ ] Upgrade from previous version works

### Post-Release
- [ ] Monitor crash reports
- [ ] Monitor user feedback
- [ ] Plan version 1.1 features
- [ ] Security monitoring enabled

## Release Artifacts

| Artifact | Platform | Location |
|----------|----------|----------|
| Ojowacam.apk | Android | infrastructure/release/ |
| Ojowacam.aab | Android | infrastructure/release/ |
| Ojowacam.Desktop.msi | Windows | infrastructure/release/ |
| Ojowacam.Desktop.dmg | macOS | infrastructure/release/ |
| Ojowacam.OBS.plugin.zip | Windows/macOS | infrastructure/release/ |
| Ojowacam.Source.zip | Source code | GitHub release |

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-11-06 | Initial release: Android+iOS, Windows+macOS, Wi-Fi+USB, OBS integration |
