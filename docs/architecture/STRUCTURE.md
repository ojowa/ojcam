# Project Monorepo Structure

The project is organized as a monorepo to manage shared code across multiple platforms.

## Directory Layout

```ojcam/
+-- apps/
¦   +-- mobile/ (React Native)
¦   +-- desktop-windows/ (C# / .NET)
¦   +-- desktop-macos/ (Swift)
¦   +-- obs-plugin/ (C++)
+-- packages/
¦   +-- streaming-core/ (C++)
¦   +-- android-camera/ (Kotlin/Java)
¦   +-- ios-camera/ (Swift)
¦   +-- protocol/ (Protobuf)
¦   +-- network/ (Discovery/Connection)
¦   +-- shared-types/
+-- infrastructure/
+-- tests/
+-- docs/
```
