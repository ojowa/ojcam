# Security Testing & Audit

## Overview

This document outlines the security testing procedures and audit checklist for Ojowacam version 1.0.0.

## Security Requirements

### 1. Authentication & Pairing
- [ ] QR code pairing uses short-lived tokens (10-minute expiry)
- [ ] Pairing tokens are cryptographically random (6-digit code)
- [ ] Desktop only accepts connections from paired devices
- [ ] Rate limiting on pairing attempts (max 5 attempts per minute)
- [ ] Session revocation on disconnect
- [ ] Device removal from paired list

### 2. Transport Security
- [ ] WebRTC media transport uses DTLS-SRTP encryption
- [ ] Signaling channel uses WSS (WebSocket Secure) with TLS 1.2+
- [ ] No unencrypted camera streaming
- [ ] Certificate validation for WebSocket connections
- [ ] Perfect forward secrecy for key exchange

### 3. Local Network Security
- [ ] No default public internet access
- [ ] mDNS discovery limited to local subnet
- [ ] No cloud storage of camera footage
- [ ] Local-only communication (no external servers)
- [ ] USB tunneling uses ADB reverse (localhost only)

### 4. Permissions & Privacy
- [ ] Camera permission requested at runtime (Android/iOS)
- [ ] Microphone permission requested at runtime (Android/iOS)
- [ ] Local network permission (iOS 14+, Android 12+)
- [ ] Foreground service notification when camera active
- [ ] OS-level camera/microphone indicator visible
- [ ] No background recording without user consent

### 5. Data Handling
- [ ] No video/audio stored on disk (streaming only)
- [ ] No user accounts or registration
- [ ] No cloud accounts or subscription management
- [ ] Session tokens not persisted across app restarts
- [ ] Pairing codes not stored in plaintext

## Security Testing Procedures

### Test 1: Pairing Security
1. Generate QR code on desktop
2. Attempt to pair with incorrect code (should fail)
3. Attempt to pair after token expiry (10 minutes)
4. Attempt rapid pairing attempts (should be rate-limited)
5. Verify device is removed from paired list after disconnect

### Test 2: Transport Encryption
1. Capture network traffic during streaming
2. Verify WebRTC uses DTLS-SRTP (encrypted)
3. Verify WebSocket signaling uses WSS
4. Verify no unencrypted video/audio packets
5. Verify certificate validation rejects self-signed certs

### Test 3: Local Network Isolation
1. Verify mDNS discovery only works on same subnet
2. Verify no outbound connections to external servers
3. Verify no cloud storage endpoints contacted
4. Verify USB tunneling uses localhost (127.0.0.1)
5. Verify firewall blocks external access to streaming ports

### Test 4: Permission Handling
1. Deny camera permission (app should show error, not crash)
2. Deny microphone permission (video-only mode should work)
3. Revoke camera permission mid-stream (stream should stop)
4. Verify foreground service notification appears during streaming
5. Verify OS camera/microphone indicator is active during streaming

### Test 5: Session Management
1. Start stream, then disconnect phone (desktop should show disconnected)
2. Start stream, then close desktop app (phone should stop streaming)
3. Attempt to connect without pairing (should be rejected)
4. Verify reconnection after network interruption
5. Verify session tokens are invalidated on app restart

## Penetration Testing Checklist

### Network Layer
- [ ] Port scan for open ports on desktop (only streaming + signaling ports)
- [ ] Man-in-the-middle attempt on signaling channel (should fail due to WSS)
- [ ] Replay attack on pairing codes (should fail due to expiry)
- [ ] Unauthorized device discovery (should not respond to unknown subnets)

### Application Layer
- [ ] Intent redirection attack (Android)
- [ ] URL scheme hijacking (iOS)
- [ ] Certificate pinning bypass attempt
- [ ] Debug mode enabled in release builds (should be disabled)

### Data Layer
- [ ] Local storage inspection (no video/audio files)
- [ ] Clipboard access (no sensitive data copied)
- [ ] Screen recording detection (should show OS indicator)

## Incident Response

If a security vulnerability is discovered:
1. Immediately revoke all pairing tokens
2. Release security patch within 72 hours
3. Notify users via app update
4. Document the vulnerability and fix in security advisories

## Compliance

- GDPR: No personal data stored or transmitted externally
- CCPA: No sale of personal data
- COPPA: Not directed at children under 13
