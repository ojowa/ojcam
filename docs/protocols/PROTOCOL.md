# Communication Protocol

Ojowacam connects a **mobile phone** (camera) and the **OBS plugin** (receiver) over
WebSocket carrying **JSON messages**. (An optional Protobuf encoding exists only for
`DEVICE_ANNOUNCEMENT` payloads; everything else is JSON.)

## Topology

- The **phone hosts the WebSocket server** on `ws://0.0.0.0:8765` (port configurable,
  SecureStore key `ojowacam.signaling.port`).
- The **OBS plugin dials out** to `ws://<phone-ip>:8765` using its outbound
  `SignalingClient`.
- Discovery is **manual IP entry** (the phone UI shows its own LAN IP; no mDNS).
- One OBS connection at a time: a new peer replaces the previous one (replacement
  resets the connection state and heartbeat).

## Roles

- The **phone is the only offerer**: it creates the WebRTC offer and sends `OFFER`.
- **OBS answers**: it creates its peer connection lazily on the first `OFFER`, applies
  the remote description, produces an answer, and replies with `ANSWER`.
- The phone speaks first after connect (`DEVICE_ANNOUNCEMENT`, then
  `PAIRING_REQUEST` / `OFFER` / `PING`); OBS never sends `join` and never initiates
  pings.

## Message vocabulary

| Type | Direction | Purpose |
|---|---|---|
| `PAIRING_REQUEST` | phone → OBS | `{ deviceId, pairingCode }`, retried every 5 s until a response arrives or the peer disconnects |
| `PAIRING_RESPONSE` | OBS → phone | `{ success, deviceId, pairingCode, sessionToken \| errorMessage }` |
| `OFFER` | phone → OBS | `{ sdp, sdpType, sessionId?, sessionToken, timestamp }` |
| `ANSWER` | OBS → phone | `{ sdp, sdpType:"answer", sessionId, sessionToken, timestamp }` |
| `ICE_CANDIDATE` | both | `{ candidate, sessionToken, timestamp }` (session-bound) |
| `START_SESSION` | phone → OBS | session start with `sessionId`, `payload`, session-bound fields |
| `START_SESSION` (ack) | OBS → phone | same type echoed with `sessionId`, `sessionToken`, `timestamp` |
| `PING` | phone → OBS | app-level heartbeat |
| `PONG` | OBS → phone | heartbeat reply |
| `DEVICE_ANNOUNCEMENT` | phone → OBS | device id/capabilities on connect (not session-bound) |
| `ERROR` | both | `{ errorMessage }` |

Removed/renamed from earlier revisions: `join`, `joined`, `answer` (→ `ANSWER`),
`ice-candidate` (→ `ICE_CANDIDATE`), `PAIRING_ERROR` (use `PAIRING_RESPONSE` with
`success:false` + `errorMessage`, or `ERROR`).

## Pairing and session auth

1. Phone generates a pairing code and sends `PAIRING_REQUEST`.
2. OBS **strictly matches** the request's `pairingCode` against the pairing code
   configured on the source (`setPairingCode`). Empty or mismatched code →
   `PAIRING_RESPONSE{success:false, errorMessage:"Pairing code mismatch"}`.
   On match OBS mints a random 64-hex `sessionToken` and returns it.
   *Difference: the desktop Windows app auto-mints a session without checking the
   code (`StreamReceiverService.cs`); the OBS plugin always requires a match.*
3. Phone establishes a session with the token; all subsequent session-bound messages
   carry `sessionToken` and a `timestamp` (epoch ms).
4. OBS accepts a session-bound message only if the token matches **and** the
   timestamp is within **±5 minutes** of its clock; otherwise it replies
   `ERROR{errorMessage:"Session required: pair with the phone first"}`.
5. Session-bound types: `OFFER`, `ANSWER`, `ICE_CANDIDATE`, `START_SESSION`.
   No signatures/ECDSA are used.

## Heartbeat

- Phone sends app-level `{"type":"PING"}` every **15 s** and expects a `PONG`.
- If no `PONG` has been seen within **15 s + 5 s**, the phone closes the peer.
- OBS replies `{"type":"PONG"}` to every `PING` and ignores `PONG`s it receives.
- WebSocket control frames are also honored: opcode `0x9` (ping) → `0xA` (pong with
  echoed payload), `0x8` (close) tears down the loop. OBS never initiates either.

## Media

- Phone encodes H264/Opus and sends them over the WebRTC peer connection created
  from the phone's offer; OBS decodes (FFmpeg-backed decoder when built with
  `OJO_FFMPEG_ENABLED`) and pushes frames into OBS (`obs_source_output_video`).
- Builds without FFmpeg have no H264 decoder: raw NALs are **not** emitted as pixel
  data (frames are dropped with a warning).
