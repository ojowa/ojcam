# Performance Testing & 4K Validation

## Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Wi-Fi latency | < 150 ms | WebRTC getStats() |
| USB latency | < 100 ms | WebRTC getStats() |
| Frame drops | < 2% per minute | Decoded vs captured frames |
| Audio sync | < 50 ms drift | A/V timestamp comparison |
| CPU usage (desktop) | < 30% at 1080p30 | Process monitor |
| CPU usage (phone) | < 50% at 1080p30 | Android Studio Profiler |
| Memory (desktop) | < 500 MB | Task Manager |
| Memory (phone) | < 200 MB | Android Studio Profiler |
| Battery drain | < 15% per hour | Battery historian |
| Streaming duration | 2+ hours continuous | Endurance test |

## 4K Test Configuration

### 4K 30 FPS Test Matrix

| Device | Resolution | FPS | Bitrate | Codec | Expected Result |
|--------|-----------|-----|---------|-------|-----------------|
| Samsung Galaxy S24 Ultra | 3840x2160 | 30 | 20 Mbps | H264 | Pass |
| Google Pixel 8 Pro | 3840x2160 | 30 | 15 Mbps | H264 | Pass |
| iPhone 15 Pro | 3840x2160 | 30 | 18 Mbps | H264 | Pass |
| Xiaomi 13 Ultra | 3840x2160 | 30 | 18 Mbps | H264 | Pass |

### 4K 60 FPS Test (Optional - hardware dependent)

| Device | Resolution | FPS | Bitrate | Codec | Expected Result |
|--------|-----------|-----|---------|-------|-----------------|
| Samsung Galaxy S24 Ultra | 3840x2160 | 60 | 35 Mbps | H264 | Conditional |
| iPhone 15 Pro | 3840x2160 | 60 | 30 Mbps | H264 | Conditional |

## Test Scenarios

### Scenario 1: Wi-Fi 5 GHz (Primary)
- Router: Wi-Fi 6 (802.11ax), 5 GHz band
- Distance: 5 meters from router
- Interference: Minimal (no other devices)
- Expected: Stable 4K 30 FPS, < 150 ms latency

### Scenario 2: Wi-Fi 2.4 GHz (Congested)
- Router: Wi-Fi 5 (802.11ac), 2.4 GHz band
- Distance: 10 meters from router
- Interference: High (multiple networks, microwave)
- Expected: Adaptive bitrate reduces to 1080p, < 300 ms latency

### Scenario 3: USB Connection
- Cable: USB 3.0 Type-C to Type-C
- Connection: ADB reverse + USB tethering
- Expected: < 100 ms latency, stable 4K 30 FPS

### Scenario 4: Adaptive Bitrate
- Start: Wi-Fi 5 GHz, 4K 30 FPS
- Middle: Degrade network (throttle to 5 Mbps)
- End: Restore network to full speed
- Expected: Bitrate auto-reduces, then auto-increases

## Test Devices

### Android
- Samsung Galaxy S24 Ultra (4K 30/60 FPS)
- Google Pixel 8 Pro (4K 30 FPS)
- Xiaomi 13 Ultra (4K 30 FPS)
- OnePlus 11 (4K 30 FPS)

### iOS
- iPhone 15 Pro Max (4K 30/60 FPS)
- iPhone 14 Pro (4K 30 FPS)
- iPhone 13 Pro (4K 30 FPS)

### Desktop
- Windows 11 Pro, Intel i7-12700K, 32 GB RAM, RTX 3070
- macOS Sonoma, MacBook Pro M2 Pro, 16 GB RAM

## Pass/Fail Criteria

### Critical (Must Pass)
- [ ] 1080p 30 FPS stable for 2+ hours
- [ ] Latency < 150 ms on Wi-Fi 5 GHz
- [ ] Audio/video sync within 50 ms
- [ ] Automatic reconnection after network interruption
- [ ] No crashes during 2-hour endurance test

### Important (Should Pass)
- [ ] 4K 30 FPS on supported devices
- [ ] Adaptive bitrate on network degradation
- [ ] USB connection with < 100 ms latency
- [ ] OBS Studio integration stable
- < 2% frame drops per minute

### Nice to Have (Optional)
- [ ] 4K 60 FPS on flagship devices
- [ ] HEVC codec support
- [ ] Multiple phone support (future)
