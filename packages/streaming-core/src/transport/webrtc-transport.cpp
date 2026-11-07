#include "transport/webrtc-transport.h"

namespace ojowacam {

struct WebRTCTransport::Impl {
    std::string url;
    bool connected = false;
};

WebRTCTransport::WebRTCTransport() : impl_(new Impl()) {}
WebRTCTransport::~WebRTCTransport() { delete impl_; }

bool WebRTCTransport::connect(const std::string& url) {
    (void)url;
    return false;
}

void WebRTCTransport::disconnect() {
    impl_->connected = false;
    connected_ = false;
    if (onConnectionStateChanged) onConnectionStateChanged(false);
}

bool WebRTCTransport::sendVideoFrame(const VideoFrame& frame) {
    (void)frame;
    return false;
}

bool WebRTCTransport::sendAudioFrame(const AudioFrame& frame) {
    (void)frame;
    return false;
}

bool WebRTCTransport::isConnected() const {
    return connected_;
}

void WebRTCTransport::createOffer() {
}

void WebRTCTransport::setRemoteDescription(const std::string& type, const std::string& sdp) {
    (void)type;
    (void)sdp;
}

void WebRTCTransport::addIceCandidate(const std::string& candidate) {
    (void)candidate;
}

} // namespace ojowacam
