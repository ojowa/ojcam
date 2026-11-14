#pragma once

#include "../streaming-core.h"
#include <cstdint>
#include <string>
#include <functional>

namespace ojowacam {

// Same-network ports shared by the OBS plugin, the device manager, and the
// mobile app. The phone hosts the signaling WebSocket on kPhoneWsPort; the
// plugin hosts its own WebSocket on kPluginWsPort so the phone can also dial
// in. Both ends broadcast UDP beacons on kDiscoveryUdpPort so either side can
// learn the other's current IP address on any shared network.
inline constexpr uint16_t kPhoneWsPort = 8765;
inline constexpr uint16_t kPluginWsPort = 8766;
inline constexpr uint16_t kDiscoveryUdpPort = 8767;
inline constexpr const char* kBeaconMagic = "OJOWACAM|1";

class Transport {
public:
    virtual ~Transport() = default;
    
    virtual bool connect(const std::string& url) = 0;
    virtual void disconnect() = 0;
    virtual bool sendVideoFrame(const VideoFrame& frame) = 0;
    virtual bool sendAudioFrame(const AudioFrame& frame) = 0;
    
    std::function<void(const VideoFrame&)> onVideoFrame;
    std::function<void(const AudioFrame&)> onAudioFrame;
    std::function<void(bool)> onConnectionStateChanged;
    // Fires once the remote offer's video codec is known (e.g. "VP8"), so the
    // receiver can pick a matching decoder before the first frame arrives.
    std::function<void(const std::string&)> onVideoCodecNegotiated;
    
    virtual bool isConnected() const = 0;
};

} // namespace ojowacam
