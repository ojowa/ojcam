#pragma once

#include "../../streaming-core.h"
#include <string>
#include <functional>

namespace ojowacam {

class USBTransport {
public:
    virtual ~USBTransport() = default;

    // Start USB transport (ADB reverse/tethering)
    virtual bool start(const std::string& deviceId, int localPort, int remotePort) = 0;

    // Stop USB transport
    virtual void stop() = 0;

    // Check if USB transport is active
    virtual bool isActive() const = 0;

    // Get the local port that USB traffic is forwarded to
    virtual int getLocalPort() const = 0;

    // Send video frame over USB (via TCP tunnel)
    virtual bool sendVideoFrame(const VideoFrame& frame) = 0;

    // Send audio frame over USB (via TCP tunnel)
    virtual bool sendAudioFrame(const AudioFrame& frame) = 0;

    // Callbacks
    std::function<void(const VideoFrame&)> onVideoFrame;
    std::function<void(const AudioFrame&)> onAudioFrame;
    std::function<void(bool)> onConnectionStateChanged;

    // Connection info
    std::string deviceId;
    int localPort = 0;
};

} // namespace ojowacam
