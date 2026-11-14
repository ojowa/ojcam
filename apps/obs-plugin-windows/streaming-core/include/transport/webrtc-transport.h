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

    // Options applied before connect():
    //  - auto_discover: dial the phone when a same-network beacon (or an
    //    inbound connection from the phone) provides its address, instead of
    //    failing on a stale/missing manual URL.
    // The plugin's own WebSocket server (kPluginWsPort) always starts with
    // connect() so the phone can dial in regardless of these options.
    void setConnectionOptions(bool auto_discover);

    bool connect(const std::string& url) override;
    void disconnect() override;
    bool sendVideoFrame(const VideoFrame& frame) override;
    bool sendAudioFrame(const AudioFrame& frame) override;
    bool isConnected() const override;

    void setRemoteDescription(const std::string& type, const std::string& sdp);
    void addIceCandidate(const std::string& candidate);

private:
    // Accepts one inbound WebSocket connection from the phone onto the
    // signaling client (the plugin prefers its own outbound connection; an
    // active session rejects additional peers). The socket arrives as
    // uintptr_t because SOCKET is pointer-sized on 64-bit Windows.
    void onInboundSignaling(uintptr_t socket_handle);
    // Marks the signaling session live and notifies observers.
    void markSessionActive(const char* how);
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
    // Handles a WebSocket binary frame carrying the Wireless Mic's raw PCM
    // (s16le stereo @ 48 kHz), converting it to an AudioFrame for OBS.
    void handleBinaryAudio(const std::string& payload);
    static std::string extractJsonField(const std::string& json, const std::string& field);
    static std::string escapeJson(const std::string& input);
    static std::string unescapeJson(const std::string& input);
    static std::string generateSessionToken();

    struct Impl;
    Impl* impl_;
    // Infrastructure that must outlive individual sessions: the plugin's
    // WebSocket server and its connection-mode options.
    struct Host;
    std::unique_ptr<Host> host_;
    bool connected_ = false;
};

} // namespace ojowacam
