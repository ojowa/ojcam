#pragma once

#include "../streaming-core.h"
#include <string>
#include <functional>

namespace ojowacam {

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
