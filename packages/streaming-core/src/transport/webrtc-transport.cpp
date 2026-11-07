#include "transport/webrtc-transport.h"
#include <iostream>

namespace ojowacam {

struct WebRTCTransport::Impl {
    std::string url;
    bool connected = false;
    bool offer_created = false;
};

WebRTCTransport::WebRTCTransport() : impl_(new Impl()) {}
WebRTCTransport::~WebRTCTransport() { disconnect(); delete impl_; }

bool WebRTCTransport::connect(const std::string& url) {
    impl_->url = url;
#ifdef OJO_WEBRTC_ENABLED
    impl_->connected = true;
    connected_ = true;
    if (onConnectionStateChanged) onConnectionStateChanged(true);
#else
    impl_->connected = true;
    connected_ = true;
    if (onConnectionStateChanged) onConnectionStateChanged(true);
#endif
    return impl_->connected;
}

void WebRTCTransport::disconnect() {
    impl_->connected = false;
    impl_->offer_created = false;
    connected_ = false;
    if (onConnectionStateChanged) onConnectionStateChanged(false);
}

bool WebRTCTransport::sendVideoFrame(const VideoFrame& frame) {
    (void)frame;
    return impl_->connected;
}

bool WebRTCTransport::sendAudioFrame(const AudioFrame& frame) {
    (void)frame;
    return impl_->connected;
}

bool WebRTCTransport::isConnected() const {
    return connected_;
}

void WebRTCTransport::createOffer() {
#ifdef OJO_WEBRTC_ENABLED
    impl_->offer_created = true;
#else
    impl_->offer_created = true;
#endif
}

void WebRTCTransport::setRemoteDescription(const std::string& type, const std::string& sdp) {
    (void)type;
    (void)sdp;
#ifdef OJO_WEBRTC_ENABLED
#else
    impl_->connected = true;
    connected_ = true;
    if (onConnectionStateChanged) onConnectionStateChanged(true);
#endif
}

void WebRTCTransport::addIceCandidate(const std::string& candidate) {
    (void)candidate;
#ifdef OJO_WEBRTC_ENABLED
#endif
}

} // namespace ojowacam
