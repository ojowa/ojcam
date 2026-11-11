# Build & Run Guide

How to build both sides of Ojowacam and run them together. System design is in
[ARCHITECTURE.md](../architecture/ARCHITECTURE.md); the wire protocol is in
[PROTOCOL.md](../protocols/PROTOCOL.md).

## Prerequisites

| Tool | Used for | Notes |
|---|---|---|
| Node.js + npm | mobile app | `apps/mobile` |
| Java 25 | Android build | Gradle wrapper is upgraded for Java 25 |
| Android SDK | Android build | `local.properties` → `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk` |
| Visual Studio Build Tools 2022 (18) | OBS plugin (Windows) | MSVC + NMake; `VC\Auxiliary\Build\vcvars64.bat` |
| CMake ≥ 3.10 | OBS plugin | Not on PATH by default — use the copy under `.deps/cmake-extract/` (see below) |
| OBS Studio deps | OBS plugin | `.deps/obs-studio` + `.deps/obs-lib` (fallback paths read by `apps/obs-plugin-windows/CMakeLists.txt:35-47`) |

## Mobile app (`apps/mobile`)

### Install and verify

```powershell
cd apps/mobile
npm install
npx tsc --noEmit     # typecheck (the check used in this repo)
npx jest             # 7 suites / 65 tests; needs apps/mobile/babel.config.js
```

> `npm run lint` is currently broken in this repo: eslint is not installed and no
> eslint config exists anywhere. Use `npx tsc --noEmit` as the lint step.

### Build the Android APK

```powershell
cd apps/mobile/android
.\gradlew.bat assembleDebug --console=plain
```

Output: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

### Dev client (recommended for running on a device)

The app is a **bare React Native/Expo dev client, not Expo Go**. After adding or
upgrading native dependencies (`react-native-tcp-socket`, `expo-network`, …) you must
rebuild the native project:

```powershell
cd apps/mobile
npx expo run:android
```

### iOS

`apps/mobile/ios` exists but must be built on macOS (see `.github/workflows/ios-build.yml`).

## OBS plugin — Windows (`apps/obs-plugin-windows`)

CMake is not on PATH; the configured build tree already points at the bundled copy
(`C:\Project\ojcam\.deps\cmake-extract\cmake-3.31.6-windows-x86_64\bin\cmake.exe`).

### Configure (once)

```powershell
& "C:\Project\ojcam\.deps\cmake-extract\cmake-3.31.6-windows-x86_64\bin\cmake.exe" `
    -S apps/obs-plugin-windows -B apps/obs-plugin-windows/build
```

The generator is **NMake Makefiles**, so the build must run inside a VS developer
shell. Save this as e.g. `build-ojowacam.bat`:

```bat
@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
set CMAKE=C:\Project\ojcam\.deps\cmake-extract\cmake-3.31.6-windows-x86_64\bin\cmake.exe
"%CMAKE%" --build C:\Project\ojcam\apps\obs-plugin-windows\build
exit /b %ERRORLEVEL%
```

Then:

```powershell
cmd /c build-ojowacam.bat
```

Output: `apps/obs-plugin-windows/build/package/bin/64bit/ojowacam-obs.dll`.

### Install into OBS

1. Close OBS Studio.
2. Copy to `%APPDATA%\obs-studio\plugins\ojowacam-obs\`:
   - `ojowacam-obs.dll`
   - `module.json` (from `apps/obs-plugin-windows/data/`)
3. Start OBS → Settings → Modules → "Ojowacam OBS Plugin" is loaded.

Full runtime checklist: [OBS_PLUGIN_TESTING.md](../obs-plugin/OBS_PLUGIN_TESTING.md).

## Other platforms

| Target | How it builds |
|---|---|
| OBS plugin macOS | `.github/workflows/obs-plugin-macos.yml` (CMake, `.bundle`) — sources mirror the Windows copy plus `src/*.mm` |
| OBS plugin Linux | `.github/workflows/obs-plugin-linux.yml` |
| `packages/streaming-core` | Consumed by the plugin builds; same transport/decoder files |
| Desktop apps | `windows-build.yml` / `macos-build.yml` |

These copies are synced from `apps/obs-plugin-windows`; they are not verified by a
local Windows build.

## Run them together (end to end)

1. Put the phone and the PC on the **same Wi-Fi network**.
2. **Phone**: open the app → Connection → **Start Server**. Note the displayed
   IP (e.g. `192.168.1.23`) and the pairing code. The server listens on
   `ws://0.0.0.0:8765`.
3. **OBS**: Sources → **+** → *Ojowacam Video* → set:
   - *Pairing Code (from phone)* — the code from step 2
   - *Signaling URL* — `ws://<phone-ip>:8765`
   → **Connect to Device**.
4. Watch the OBS log (Help → Log Files) for the expected sequence:

   | Log line | Meaning |
   |---|---|
   | `WebSocket signaling connected: ws://…` | TCP + handshake OK |
   | `Pairing request accepted (device …)` | code matched, token minted |
   | `Remote description set (…): offer` | phone's offer applied |
   | `WebRTC answer sent` | OBS answered |
   | `Session acknowledged: …` | START_SESSION round trip |

   Phone side: `DEVICE_ANNOUNCEMENT` is sent on accept; `PAIRING_RESPONSE` stops the
   5 s pairing retry.
5. **Phone**: start streaming. Video should appear in the OBS preview; the phone
   sends `PING` every 15 s and OBS replies `PONG`.
6. Stop: close the OBS source (or hit Disconnect), then Stop Server on the phone.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Pairing code mismatch` in OBS log | Pairing code field empty or different from the phone's; retype it. OBS never auto-mints a session. |
| `ERROR Session required: pair with the phone first` | `OFFER`/`ICE_CANDIDATE`/`START_SESSION` arrived without a valid token — pair first. |
| Messages rejected after ~10 min | Phone session TTL (10 min) or the ±5 min timestamp window — check clock skew between phone and PC; re-pair. |
| Phone closes connection ~20 s after connect | Heartbeat: no `PONG` within 15 s + 5 s. OBS must answer `PING` (it does — check firewall/old plugin DLL). |
| New OBS connection kicks the old one | By design: one peer at a time, the latest replaces the previous. |
| No video in OBS, log shows `H264 decode unavailable` | Plugin built without FFmpeg → frames are dropped by design (raw NALs are never shown as pixels). Install FFmpeg so CMake sets `OJO_FFMPEG_ENABLED`. |
| Connection refused on `ws://…:8765` | Server not started, wrong IP, or Windows Firewall blocking port 8765 on the phone app. |
| `npx jest` fails with preset/module errors | Ensure `apps/mobile/babel.config.js` exists (standard `babel-preset-expo`). |
| Gradle build killed / out of memory | Run `.\gradlew.bat assembleDebug` in a normal terminal; first build downloads dependencies. |
