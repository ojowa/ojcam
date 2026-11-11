# Project Monorepo Structure

The project is organized as a monorepo to manage shared code across multiple platforms.

## Directory Layout

```
ojcam/
├── apps/
│   ├── mobile/                # React Native app (camera side; hosts the WS server)
│   ├── obs-plugin-windows/    # OBS plugin — canonical C++ streaming stack
│   ├── obs-plugin-macos/      # OBS plugin (mirrored stack + Objective-C++ sources)
│   ├── obs-plugin-linux/      # OBS plugin (mirrored stack)
│   ├── desktop-windows/       # C# / .NET desktop companion
│   └── desktop-macos/         # Swift desktop companion
├── packages/
│   ├── streaming-core/        # Standalone C++ transport + decoder (mirrored copy)
│   ├── android-camera/        # Kotlin/Java camera module
│   ├── ios-camera/            # Swift camera module
│   ├── network/               # Discovery/connection helpers (mobile side)
│   ├── protocol/              # Protobuf definitions (optional DEVICE_ANNOUNCEMENT)
│   └── shared-types/          # Shared TypeScript types
├── docs/
│   ├── architecture/          # ARCHITECTURE.md (system design), STRUCTURE.md (this file)
│   ├── protocols/             # PROTOCOL.md (wire format)
│   ├── development/           # BUILD_AND_RUN.md, WORKFLOW.md, TECH_STACK.md, CI_ARTIFACTS.md
│   ├── obs-plugin/            # Plugin design guide + runtime testing guide
│   ├── mobile/                # Mobile audit, USB/iOS evaluation
│   ├── testing/               # Performance test plan
│   ├── release/               # Release checklist, security audit
│   └── roadmap/               # Roadmaps
├── .github/workflows/         # CI: android, ios, obs-plugin (win/mac/linux), release, …
└── .deps/                     # Local build dependencies (OBS, CMake) — not committed
```

## Notes

- The C++ streaming stack (transport, receiver, decoders, frame converter) exists in
  four copies: `apps/obs-plugin-windows` (canonical), `apps/obs-plugin-macos`,
  `apps/obs-plugin-linux`, and `packages/streaming-core`. Keep them in sync by
  copying the Windows files — see ARCHITECTURE.md.
- Mobile native modules live in `apps/mobile` (auto-linked) with sources under
  `packages/android-camera` and `packages/ios-camera`.
