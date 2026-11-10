# iOS USB Networking Evaluation

## Overview

iOS USB connectivity is significantly more restricted than Android. This document outlines the available options and limitations.

## Available Options

### 1. USB Tethering (Personal Hotspot over USB)

**Supported:** Yes, with limitations

**How it works:**
- User enables Personal Hotspot on iPhone
- Connects iPhone to computer via USB cable
- iOS creates a network interface (typically `enX` on macOS, `Remote NDIS` on Windows)
- Computer gets an IP address via DHCP from the iPhone
- Devices can communicate over the USB network interface

**Limitations:**
- Requires user to manually enable Personal Hotspot
- Requires cellular data plan with tethering enabled
- May incur carrier charges
- No programmatic control from the app (iOS sandbox restrictions)
- Cannot detect tethering state programmatically

### 2. Apple Accessory Protocol (MFi)

**Supported:** Yes, but requires MFi certification

**How it works:**
- Join Apple's MFi (Made for iPhone/iPad/iPod) program
- Use ExternalAccessory framework to communicate over Lightning/USB
- Requires custom hardware or MFi-approved cable

**Limitations:**
- Requires MFi membership (annual fee)
- Requires MFi-approved accessories/cables
- Complex certification process
- Not suitable for general consumer app distribution

### 3. USB Restricted Mode

**Supported:** No (security feature)

iOS has USB Restricted Mode that blocks USB data access when the device has been locked for over an hour. This prevents any USB communication until the user unlocks the device.

## Recommendation for Phase 7

**Use USB Tethering as the primary iOS USB method:**

1. Document that users must enable Personal Hotspot on iPhone
2. Detect USB network interfaces on the computer (similar to Windows implementation)
3. Use standard TCP/IP over the USB network interface for streaming
4. Fall back to Wi-Fi if USB tethering is not available

## Detection Strategy

### macOS
- Use `SCNetworkInterface` to list network interfaces
- Look for interfaces with USB in the name or BSD name `enX` with USB hardware
- Check `kSCPropNetInterfaceInterfaceType` for USB Ethernet

### Windows
- Use `NetworkInterface.GetAllNetworkInterfaces()`
- Filter for Ethernet interfaces with USB/RNDIS in the name
- Check operational status for connection state

## Connection Priority

When both Wi-Fi and USB are available:
1. USB is preferred (lower latency, more stable)
2. Wi-Fi is used as fallback
3. Automatic switching when USB disconnects

## Implementation Notes

- No entitlements required for USB tethering detection
- No MFi certification required
- Works on non-jailbroken devices
- Requires user action (enable Personal Hotspot)
- May not work in all carrier configurations
