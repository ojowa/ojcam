#pragma once

#include "transport.h"
#include "rtp-depay.h"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

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

    void setRemoteDescription(const std::string& type, const std::string& sdp);
    void addIceCandidate(const std::string& candidate);

private:
    void handleSignalingMessage(const std::string& message);
    void handlePairingRequest(const std::string& message);
    bool sessionAuthorized(const std::string& message);
    void sendSignalingError(const std::string& error_message);
    void sendAnswer();
    void sendStartSessionAck(const std::string& session_id);
    void sendPong();
    // Dispatches one incoming RTP packet: video payloads go through the
    // per-track depacketizer, everything else is decoded as Opus audio.
    // Only defined for the libdatachannel backend (OJO_LIBDATACHANNEL).
    void handleIncomingRtp(const uint8_t* data, size_t size,
                           const std::shared_ptr<std::unique_ptr<RtpDepacketizer>>& depay);
    static std::string extractJsonField(const std::string& json, const std::string& field);
    static std::string escapeJson(const std::string& input);
    static std::string unescapeJson(const std::string& input);
    static std::string generateSessionToken();

    struct Impl;
    Impl* impl_;
    bool connected_ = false;
};

} // namespace ojowacam
