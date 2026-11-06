# Security Architecture

Even though the application is intended for local connections, security is vital.

## Security Measures

- **QR-based pairing:** Short-lived pairing tokens.
- **Cryptographic device identity.**
- **Encrypted WebRTC media transport:** DTLS-SRTP.
- **No public internet access.**
- **Authentication:** The desktop application only accepts connections from paired devices.
- **Rate limiting:** On pairing attempts.
