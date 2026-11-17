#pragma once

#include "../streaming-core.h"
#include <cstdint>
#include <string>
#include <functional>

namespace ojowacam {

// Single shared port used by the OBS plugin, the device manager, and the
// mobile app. The phone hosts the signaling WebSocket on kOjowacamPort; the
// plugin hosts its own WebSocket on the same port so the phone can also dial
// in. Both ends broadcast UDP beacons on the same port (UDP and TCP share the
// port number safely) so either side can learn the other's current IP address
// on any shared network.
inline constexpr uint16_t kOjowacamPort = 8765;
inline constexpr uint16_t kPhoneWsPort = kOjowacamPort;
inline constexpr uint16_t kPluginWsPort = kOjowacamPort;
inline constexpr uint16_t kDiscoveryUdpPort = kOjowacamPort;
// Shared UDP beacon payload prefix; the trailing fields are
// "|role=<phone|obs>|ws=<port>[|id=<device>]".
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
    
    virtual bool isConnected() const = 0;
};

} // namespace ojowacam
