# Communication Protocol

Ojowacam uses **Protocol Buffers (Protobuf)** for efficient communication.

## Core Messages

### DEVICE_ANNOUNCEMENT
```json
{
  "type": "DEVICE_ANNOUNCEMENT",
  "deviceId": "mobilecam-device-001",
  "deviceName": "Android Phone",
  "capabilities": {
    "video": true,
    "audio": true,
    "resolutions": [
      "1280x720",
      "1920x1080",
      "3840x2160"
    ],
    "frameRates": [30, 60]
  }
}
```

### START_SESSION
```json
{
  "type": "START_SESSION",
  "sessionId": "session001",
  "video": {
    "resolution": "3840x2160",
    "fps": 30,
    "codec": "H264",
    "bitrate": 20000000
  },
  "audio": {
    "codec": "OPUS",
    "sampleRate": 48000,
    "channels": 2
  }
}
```
