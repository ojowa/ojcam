# Ojowacam Architecture

Ojowacam turns a smartphone into a wireless webcam/microphone for OBS Studio. This
document describes how the system fits together end to end. The wire format itself is
documented separately in [PROTOCOL.md](../protocols/PROTOCOL.md); build and run
instructions live in [BUILD_AND_RUN.md](../development/BUILD_AND_RUN.md).

## System topology

```
┌────────────────────────────┐            ┌─────────────────────────────┐
│  Phone (apps/mobile)       │            │  OBS Studio + plugin        │
│                            │   Wi-Fi    │  (apps/obs-plugin-windows)  │
│  SignalingServer           │◄──────────►│  SignalingClient (outbound) │
│  ws://0.0.0.0:8765         │  WebSocket │  dials ws://<phone-ip>:8765 │
│                            │            │                             │
│  WebRTC (offerer)          │◄──────────►│  WebRTC (answerer)          │
│  camera → encoder ─────────┼── H264 ───►├── decoder → OBS source      │
└────────────────────────────┘  Opus/AV   └─────────────────────────────┘
```

- **The phone hosts the signaling server** (`ws://0.0.0.0:8765`, port configurable via
  SecureStore key `ojowacam.signaling.port`). There is no cloud component — everything
  is local-network only.
- **The OBS plugin dials out** to the phone using its outbound `SignalingClient`.
  One OBS connection at a time; a new peer replaces the previous one.
- **Discovery is manual IP entry.** The phone UI shows its own LAN IP (via
  `expo-network`); the OBS source properties take the full `ws://<ip>:8765` URL.
  (mDNS code exists but is not wired in.)
- **The phone is the only offerer.** It creates the WebRTC offer; OBS creates its peer
  connection lazily on the first `OFFER` and replies with an `ANSWER`.

## Components

### Mobile app — `apps/mobile`

React Native (bare dev client, not Expo Go). Service layer under `src/services/`:

| Service | Role |
|---|---|
| `signaling/SignalingServer.ts` | RFC 6455 WebSocket **server** on port 8765: handshake, frame parse/build, single-peer replacement, app-level heartbeat (PING every 15 s, drops peer after 15+5 s without PONG) |
| `signaling/SignalingService.ts` | Message orchestration: pairing retry every 5 s, `ERROR`/`PAIRING_RESPONSE` routing, authenticated sends |
| `security/AuthService.ts` | Session state; stamps outgoing session-bound messages with `sessionToken` + `timestamp`; validates inbound ones (±5 min) |
| `security/PairingService.ts` | Pairing code generation and `PAIRING_RESPONSE` handling (no signatures — token only) |
| `security/DeviceIdentity.ts` | Stable device id |
| `config/ConnectionConfig.ts` | Port config (`getSignalingUrl()` → `ws://0.0.0.0:<port>`) |
| `StreamingService.ts` | Orchestrates camera/encoder/WebRTC + start/stop streaming; phone creates the offer |
| `protocol/` | Optional Protobuf encoding (only `DEVICE_ANNOUNCEMENT` payload uses it) |

UI: `ConnectionScreen` starts/stops the server and shows the IP + pairing code;
`SettingsScreen` edits the port.

### OBS plugin — `apps/obs-plugin-windows` (canonical copy)

| Component | Role |
|---|---|
| `src/video-source.cpp`, `src/audio-source.cpp` | OBS sources ("Ojowacam Video"/"Ojowacam Microphone"): properties (pairing code, signaling URL), connect button, receiver lifecycle |
| `shared/src/stream-receiver.cpp` | Pipeline owner: connects the transport, wires transport→decoder→OBS, auto-reconnect (single-flight worker, attempt budget reset only on success, `cancelReconnectAndWait()` on disconnect), `setPairingCode` passthrough |
| `streaming-core/src/transport/webrtc-transport.cpp` | WebSocket signaling client (RFC 6455 framing, masking, ping/pong/close opcodes) + message dispatch + pairing/session auth + answer/ICE wiring (native WebRTC behind `OJO_WEBRTC_ENABLED`, signaling-only fallback otherwise) |
| `streaming-core/src/decoder/video-decoder.cpp` | `FFmpegH264Decoder` (preferred when built with `OJO_FFMPEG_ENABLED`, planar I420 copy) → fallback `H264VideoDecoder` (parses SPS/PPS but **drops** frames — it cannot decode pixels) |
| `shared/src/frame-converter.cpp` | YUV420/NV12/RGBA → RGBA (`convertToRgba` used by the OBS push path) |
| `streaming-core/src/audio/audio-decoder.cpp` | Opus → PCM; transport delivers decoded PCM directly |

### Platform copies

The streaming stack exists in four copies, which are kept in sync by copying the
canonical Windows files:

```
apps/obs-plugin-windows/…     ← canonical (built and verified locally)
apps/obs-plugin-macos/…       ← same files; native macOS answers use VideoToolbox
apps/obs-plugin-linux/…       ← same files
packages/streaming-core/…     ← standalone package (transport + decoder only)
```

Platform-specific source files that are **not** mirrored: macOS uses Objective-C++
(`src/*.mm`, including an independent `OjowacamStreamReceiver` used by its sources),
and `desktop-windows`/`desktop-macos` are separate C#/Swift companion apps.

### Other packages

`packages/android-camera`, `packages/ios-camera` — native camera/WebRTC modules for
the phone; `packages/network`, `packages/protocol`, `packages/shared-types` — shared
mobile-side helpers.

## Connection lifecycle

```
1.  Phone: Start Server (ConnectionScreen) → SignalingServer listens on :8765
2.  OBS:   source properties → pairing code + ws://<phone-ip>:8765 → Connect
3.  OBS:   SignalingClient TCP + WebSocket handshake (OBS is the client, masks frames)
4.  Phone: DEVICE_ANNOUNCEMENT on accept
5.  Phone: PAIRING_REQUEST (retried every 5 s)
6.  OBS:   strict pairing-code match → PAIRING_RESPONSE { sessionToken }
           (mismatch → success:false + "Pairing code mismatch")
7.  Phone: session established with the token
8.  Phone: OFFER (sessionToken + timestamp) → OBS validates, creates peer
           connection, answers → ANSWER
9.  ICE_CANDIDATE both ways (session-bound) → media flows
10. Phone: START_SESSION → OBS acks with same type + sessionId
11. Steady state: phone PING every 15 s → OBS PONG; media over WebRTC
12. Teardown: WS close / missed PONG (20 s) / disconnect() → OBS single-flight
    reconnect with attempt budget
```

Session-bound types (`OFFER`, `ANSWER`, `ICE_CANDIDATE`, `START_SESSION`) require a
matching `sessionToken` and a `timestamp` within ±5 minutes, checked in both
directions. Pairing code mismatch on the OBS side never mints a token.

> Note: the desktop Windows companion (`StreamReceiverService.cs`) auto-mints a
> session without checking the pairing code. The OBS plugin always requires a match.

## Media pipeline

```
Phone:  camera → encoder (H264) ─┐
        mic → Opus encoder ──────┼─► WebRTC peer connection (phone's offer)
                                 │
OBS:    transport onVideoFrame ──┘→ video decoder (FFmpeg if built, else drop)
                 → frame converter (YUV420/NV12/RGBA → RGBA)
                 → obs_source_output_video (async source)
        transport onAudioFrame ───→ decoded PCM → obs_source_output_audio
```

Video frames carry their pixel format; the receiver sets the converter format before
converting. The FFmpeg decoder copies planar I420 honoring per-plane linesizes —
never as RGBA rows.

## Known limitations

- **CI/local toolchains lack FFmpeg and WebRTC**, so `OJO_FFMPEG_ENABLED` and
  `OJO_WEBRTC_ENABLED` are off in typical builds: video frames are dropped (with a
  warning) and signaling uses the minimal fallback answer. The native answer paths
  (macOS `answerForConstraints`, Windows libwebrtc lambdas) follow the file's
  pre-existing observer style and are version-dependent.
- macOS/Linux plugin copies are synced from Windows but are only built in CI
  (`.github/workflows/obs-plugin-macos.yml`, `obs-plugin-linux.yml`), not verified
  locally on Windows.
- USB transport (`packages/streaming-core/src/transport/usb/`) is separate from this
  WebSocket path.

## Related documents

- [PROTOCOL.md](../protocols/PROTOCOL.md) — message vocabulary, auth, heartbeat
- [BUILD_AND_RUN.md](../development/BUILD_AND_RUN.md) — build both sides, run them together
- [STRUCTURE.md](STRUCTURE.md) — monorepo layout
- [OBS_PLUGIN_TESTING.md](../obs-plugin/OBS_PLUGIN_TESTING.md) — runtime test checklist
