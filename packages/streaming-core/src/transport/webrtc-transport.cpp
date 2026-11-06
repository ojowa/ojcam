#include "transport/webrtc-transport.h"

namespace ojowacam {

struct WebRTCTransport::Impl {
    std::string url;
    bool connected = false;
};

WebRTCTransport::WebRTCTransport() : impl_(new Impl()) {}
WebRTCTransport::~WebRTCTransport() { delete impl_; }

bool WebRTCTransport::connect(const std::string& url) {
    impl_->url = url;
    // TODO: Initialize WebRTC peer connection
    impl_->connected = true;
    connected_ = true;
    if (onConnectionStateChanged) onConnectionStateChanged(true);
    return true;
}

void WebRTCTransport::disconnect() {
    impl_->connected = false;
    connected_ = false;
    if (onConnectionStateChanged) onConnectionStateChanged(false);
}

bool WebRTCTransport::sendVideoFrame(const VideoFrame& frame) {
    if (!impl_->connected) return false;
    // TODO: Send via WebRTC video track
    return true;
}

bool WebRTCTransport::sendAudioFrame(const AudioFrame& frame) {
    if (!impl_->connected) return false;
    // TODO: Send via WebRTC audio track
    return true;
}

bool WebRTCTransport::isConnected() const {
    return connected_;
}

void WebRTCTransport::createOffer() {
    // TODO: Create WebRTC offer
}

void WebRTCTransport::setRemoteDescription(const std::string& type, const std::string& sdp) {
    // TODO: Set remote SDP
}

void WebRTCTransport::addIceCandidate(const std::string& candidate) {
    // TODO: Add ICE candidate
}

} // namespace ojowacam
