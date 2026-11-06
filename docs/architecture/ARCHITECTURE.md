# Ojowacam Architecture

Ojowacam is designed as a modular, cross-platform system that transforms smartphones into high-quality webams for computers.

## High-Level System Layers

The system is divided into five major layers to ensure modularity and scalability:

### 1. Mobile Layer (Android/iOS)
- **Responsibility:** Captures high-definition video and audio from the device.
- **Key Components:** Native camera access (Camera2/AVFoundation), hardware encoding (H264/HEVC), and UI controls.

### 2. Connectivity Layer
- **Responsibility:** Manages the connection between the mobile device and the computer.
- **Key Components:** Device discovery (mDNS), secure pairing (QR codes), and session negotiation (WebSockets).

### 3. Desktop Receiver (Windows/macOS)
- **Responsibility:** Receives and decodes the incoming stream from the phone.
- **Key Components:** WebRTC receiver, video/audio decoders, and device management.

### 4. Virtual Device Layer
- **Responsibility:** Exposes the decoded stream to the operating system as a standard device.
- **Key Components:** Virtual webcam driver (Media Foundation/CoreMediaIO) and virtual microphone.

### 5. OBS Integration
- **Responsibility:** Provides a seamless experience for OBS Studio.
- **Key Components:** Native OBS plugin (libobs) for low-latency video and audio.

## Design Philosophy
- **Native Performance:** Critical media paths (encoding, decoding, transport) are handled in native code.
- **Local-First:** The system works entirely over the local network without requiring cloud servers.
- **Modular:** Shared C++ media logic is reused across desktop platforms to ensure consistency.
