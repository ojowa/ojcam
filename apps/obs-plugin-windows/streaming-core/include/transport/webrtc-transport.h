#pragma once

#include "transport.h"

namespace ojowacam {

class WebRTCTransport : public Transport {
public:
    WebRTCTransport();
    ~WebRTCTransport() override;
    
    bool connect(const std::string& url) override;
    void disconnect() override;
    bool sendVideoFrame(const VideoFrame& frame) override;
    bool sendAudioFrame(const AudioFrame& frame) override;
    bool isConnected() const override;
    
    void createOffer();
    void setRemoteDescription(const std::string& type, const std::string& sdp);
    void addIceCandidate(const std::string& candidate);
    
private:
    struct Impl;
    Impl* impl_;
    bool connected_ = false;
};

} // namespace ojowacam
