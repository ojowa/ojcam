#include "transport/webrtc-transport.h"
#include <obs-module.h>
#include <sstream>
#include <cstring>
#include <thread>
#include <chrono>
#include <mutex>
#include <atomic>
#include <vector>
#include <algorithm>
#include <memory>
#include <cstdlib>
#include <functional>
#include <map>

#ifdef OJO_WEBRTC_ENABLED
    #if defined(__APPLE__)
        #import <WebRTC/WebRTC.h>
    #elif defined(_WIN32)
        #include <webrtc/api/peer_connection_interface.h>
        #include <webrtc/api/create_peerconnection_factory.h>
        #include <webrtc/modules/audio_device/include/audio_device.h>
    #endif
#endif

#ifdef OJO_LIBDATACHANNEL
    #include <rtc/rtc.hpp>
    #include "transport/rtp-depay.h"
    #ifdef OJO_OPUS_ENABLED
        extern "C" {
        #if defined(__has_include) && __has_include(<opus/opus.h>)
            #include <opus/opus.h>
        #else
            #include <opus.h>
        #endif
        }
    #endif
#endif

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    typedef int socklen_t;
    #define CLOSE_SOCKET(s) closesocket(s)
    using ojo_socket_t = SOCKET;
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #include <netdb.h>
    #define CLOSE_SOCKET(s) close(s)
    using ojo_socket_t = int;
    #define INVALID_SOCKET (-1)
    #define SOCKET_ERROR (-1)
#endif

namespace ojowacam {

// ===========================================================================
// WebSocket framing helpers (RFC 6455)
// ===========================================================================

static std::vector<uint8_t> ws_mask_key() {
    std::vector<uint8_t> key(4);
    for (auto& b : key) b = static_cast<uint8_t>(rand() & 0xFF);
    return key;
}

static std::vector<uint8_t> ws_frame_text(const std::string& payload, uint8_t opcode = 0x1) {
    std::vector<uint8_t> frame;
    frame.push_back(static_cast<uint8_t>(0x80 | (opcode & 0x0F))); // FIN + opcode
    uint64_t len = payload.size();
    if (len <= 125) {
        frame.push_back(static_cast<uint8_t>(0x80 | len));
    } else if (len <= 65535) {
        frame.push_back(0x80 | 0x7E);
        frame.push_back(static_cast<uint8_t>((len >> 8) & 0xFF));
        frame.push_back(static_cast<uint8_t>(len & 0xFF));
    } else {
        frame.push_back(0x80 | 0x7F);
        for (int i = 7; i >= 0; --i)
            frame.push_back(static_cast<uint8_t>((len >> (i * 8)) & 0xFF));
    }
    auto mask = ws_mask_key();
    frame.insert(frame.end(), mask.begin(), mask.end());
    for (size_t i = 0; i < payload.size(); ++i) {
        frame.push_back(static_cast<uint8_t>(payload[i] ^ mask[i % 4]));
    }
    return frame;
}

static bool ws_send(ojo_socket_t sock, const std::string& message) {
    auto frame = ws_frame_text(message);
    int sent = send(sock, reinterpret_cast<const char*>(frame.data()),
                    static_cast<int>(frame.size()), 0);
    return sent == static_cast<int>(frame.size());
}

// Returns false on socket error. An empty payload with a valid frame is a
// success with an empty out string (close/ping frames can carry no payload).
static bool ws_recv_frame(ojo_socket_t sock, std::string& out, bool& fin, uint8_t& opcode) {
    uint8_t header[2];
    if (recv(sock, reinterpret_cast<char*>(header), 2, 0) != 2) return false;
    fin = (header[0] & 0x80) != 0;
    opcode = header[0] & 0x0F;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t len = header[1] & 0x7F;
    if (len == 126) {
        uint8_t ext[2];
        if (recv(sock, reinterpret_cast<char*>(ext), 2, 0) != 2) return false;
        len = (static_cast<uint64_t>(ext[0]) << 8) | ext[1];
    } else if (len == 127) {
        uint8_t ext[8];
        if (recv(sock, reinterpret_cast<char*>(ext), 8, 0) != 8) return false;
        len = 0;
        for (int i = 0; i < 8; ++i)
            len = (len << 8) | ext[i];
    }
    std::vector<uint8_t> mask;
    if (masked) {
        mask.resize(4);
        if (recv(sock, reinterpret_cast<char*>(mask.data()), 4, 0) != 4) return false;
    }
    std::vector<uint8_t> data(len);
    size_t received = 0;
    while (received < len) {
        int n = recv(sock, reinterpret_cast<char*>(data.data() + received),
                     static_cast<int>(len - received), 0);
        if (n <= 0) return false;
        received += static_cast<size_t>(n);
    }
    if (masked) {
        for (size_t i = 0; i < len; ++i)
            data[i] ^= mask[i % 4];
    }
    out.assign(data.begin(), data.end());
    return true;
}

// ===========================================================================
// WebSocket signaling client
// ===========================================================================

class SignalingClient {
public:
    SignalingClient() : sock_(INVALID_SOCKET), running_(false) {}
    ~SignalingClient() { stop(); }

    bool connect(const std::string& url) {
        std::string host, path;
        int port = 80;
        size_t pos = url.find("://");
        if (pos == std::string::npos) return false;
        std::string rest = url.substr(pos + 3);
        size_t slash = rest.find('/');
        if (slash != std::string::npos) {
            host = rest.substr(0, slash);
            path = rest.substr(slash);
        } else {
            host = rest;
            path = "/";
        }
        size_t colon = host.find(':');
        if (colon != std::string::npos) {
            port = std::stoi(host.substr(colon + 1));
            host = host.substr(0, colon);
        }

#ifdef _WIN32
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

        sock_ = socket(AF_INET, SOCK_STREAM, 0);
        if (sock_ == INVALID_SOCKET) return false;

        struct sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<unsigned short>(port));
        struct hostent* he = gethostbyname(host.c_str());
        if (!he) { CLOSE_SOCKET(sock_); sock_ = INVALID_SOCKET; return false; }
        memcpy(&addr.sin_addr, he->h_addr_list[0], he->h_length);

        if (::connect(sock_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
            CLOSE_SOCKET(sock_); sock_ = INVALID_SOCKET; return false;
        }

        // WebSocket handshake
        std::string key;
        for (int i = 0; i < 16; ++i) key += static_cast<char>(rand() & 0xFF);
        static const char* b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string b64key;
        for (size_t i = 0; i < key.size(); i += 3) {
            uint32_t v = (static_cast<uint8_t>(key[i]) << 16) |
                         (i + 1 < key.size() ? static_cast<uint8_t>(key[i+1]) << 8 : 0) |
                         (i + 2 < key.size() ? static_cast<uint8_t>(key[i+2]) : 0);
            b64key += b64[(v >> 18) & 0x3F];
            b64key += b64[(v >> 12) & 0x3F];
            b64key += (i + 1 < key.size()) ? b64[(v >> 6) & 0x3F] : '=';
            b64key += (i + 2 < key.size()) ? b64[v & 0x3F] : '=';
        }
        std::string handshake =
            "GET " + path + " HTTP/1.1\r\n"
            "Host: " + host + "\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: " + b64key + "\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n";
        if (send(sock_, handshake.c_str(), static_cast<int>(handshake.size()), 0) == SOCKET_ERROR) {
            CLOSE_SOCKET(sock_); sock_ = INVALID_SOCKET; return false;
        }
        char buf[1024];
        recv(sock_, buf, sizeof(buf), 0);

        running_ = true;
        recv_thread_ = std::thread(&SignalingClient::recvLoop, this);
        return true;
    }

    void stop() {
        running_ = false;
        if (sock_ != INVALID_SOCKET) {
            CLOSE_SOCKET(sock_);
            sock_ = INVALID_SOCKET;
        }
        if (recv_thread_.joinable()) recv_thread_.join();
    }

    bool sendMessage(const std::string& message) {
        std::lock_guard<std::mutex> lock(send_mutex_);
        if (sock_ == INVALID_SOCKET) return false;
        return ws_send(sock_, message);
    }

    std::function<void(const std::string&)> onMessage;
    std::function<void(const std::string&)> onBinary;
    std::function<void(bool)> onStateChanged;

private:
    void recvLoop() {
        while (running_ && sock_ != INVALID_SOCKET) {
            bool fin; uint8_t opcode;
            std::string msg;
            if (!ws_recv_frame(sock_, msg, fin, opcode)) break;
            switch (opcode) {
                case 0x8: // close
                    running_ = false;
                    break;
                case 0x9: { // ping → pong (echo payload)
                    std::vector<uint8_t> pong = ws_frame_text(msg, 0xA);
                    send(sock_, reinterpret_cast<const char*>(pong.data()),
                         static_cast<int>(pong.size()), 0);
                    break;
                }
                case 0xA: // pong (protocol level; liveness uses app-level PONG)
                    break;
                case 0x1: // text
                    if (onMessage) onMessage(msg);
                    break;
                case 0x2: // binary: raw PCM from the phone's Wireless Mic broadcast
                    if (onBinary) onBinary(msg);
                    break;
                default: // continuation/unknown
                    break;
            }
        }
        running_ = false;
        if (onStateChanged) onStateChanged(false);
        CLOSE_SOCKET(sock_);
        sock_ = INVALID_SOCKET;
    }

    ojo_socket_t sock_;
    std::atomic<bool> running_;
    std::thread recv_thread_;
    std::mutex send_mutex_;
};

// ===========================================================================
// WebRTCTransport implementation
// ===========================================================================

#if defined(OJO_WEBRTC_ENABLED) && defined(__APPLE__)
struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;

    // Signaling session state (guarded by session_mutex)
    mutable std::mutex session_mutex;
    std::string session_token;
    std::string pending_session_id;

    PeerConnectionFactory* factory = nullptr;
    RTCPeerConnection* peer_connection = nullptr;
    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};

#elif defined(OJO_WEBRTC_ENABLED) && defined(_WIN32)
struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;

    // Signaling session state (guarded by session_mutex)
    mutable std::mutex session_mutex;
    std::string session_token;
    std::string pending_session_id;

    rtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    rtc::scoped_refptr<webrtc::PeerConnectionInterface> peer_connection;
    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};

#elif defined(OJO_LIBDATACHANNEL)
struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;

    // Signaling session state (guarded by session_mutex)
    mutable std::mutex session_mutex;
    std::string session_token;
    std::string pending_session_id;

    std::shared_ptr<rtc::PeerConnection> peer_connection;
    std::mutex pc_mutex;

    // Remote offer payload type -> codec map for RTP dispatch. Written on the
    // signaling thread before tracks exist, read from the track thread.
    std::map<int, std::string> video_codec_by_pt;
    std::string negotiated_video_codec;

    // Opus audio decoding (guarded by audio_mutex)
    std::mutex audio_mutex;
#ifdef OJO_OPUS_ENABLED
    OpusDecoder* opus_decoder = nullptr;
    int opus_channels = 0;
#endif

    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};

#else  // no WebRTC backend compiled

struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;

    // Signaling session state (guarded by session_mutex)
    mutable std::mutex session_mutex;
    std::string session_token;
    std::string pending_session_id;

    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};

#endif

WebRTCTransport::WebRTCTransport() : impl_(new Impl()) {}
WebRTCTransport::~WebRTCTransport() { disconnect(); delete impl_; }

bool WebRTCTransport::connect(const std::string& url) {
    impl_->url = url;

#if defined(OJO_LIBDATACHANNEL)
    // A previous session's media state must not survive its signaling link:
    // close any stale peer connection and opus decoder before reconnecting.
    {
        std::lock_guard<std::mutex> lock(impl_->pc_mutex);
        if (impl_->peer_connection) {
            impl_->peer_connection->close();
            impl_->peer_connection = nullptr;
        }
    }
    impl_->video_codec_by_pt.clear();
    {
        std::lock_guard<std::mutex> lock(impl_->audio_mutex);
#ifdef OJO_OPUS_ENABLED
        if (impl_->opus_decoder) {
            opus_decoder_destroy(impl_->opus_decoder);
            impl_->opus_decoder = nullptr;
            impl_->opus_channels = 0;
        }
#endif
    }
#endif

    impl_->signaling = std::make_unique<SignalingClient>();
    impl_->signaling->onMessage = [this](const std::string& message) {
        handleSignalingMessage(message);
    };
    impl_->signaling->onBinary = [this](const std::string& payload) {
        handleBinaryAudio(payload);
    };
    impl_->signaling->onStateChanged = [this](bool connected) {
        impl_->connected = connected;
        connected_ = connected;
        if (onConnectionStateChanged) onConnectionStateChanged(connected);
    };

    if (!impl_->signaling->connect(url)) {
        blog(LOG_WARNING, "[Ojowacam] WebSocket signaling connect failed: %s", url.c_str());
        impl_->connected = false;
        connected_ = false;
        if (onConnectionStateChanged) onConnectionStateChanged(false);
        return false;
    }

    impl_->connected = true;
    connected_ = true;
    blog(LOG_INFO, "[Ojowacam] WebRTC signaling connected: %s", url.c_str());

    // The phone hosts the server and speaks first (PAIRING_REQUEST/OFFER/PING);
    // OBS only answers. No join message is sent.

    if (onConnectionStateChanged) onConnectionStateChanged(true);
    return true;
}

void WebRTCTransport::disconnect() {
    impl_->connected = false;
    connected_ = false;

#ifdef OJO_WEBRTC_ENABLED
    if (impl_->peer_connection) {
#if defined(__APPLE__)
        [impl_->peer_connection close];
        impl_->peer_connection = nullptr;
#elif defined(_WIN32)
        impl_->peer_connection->Close();
        impl_->peer_connection = nullptr;
#endif
    }
#endif  // OJO_WEBRTC_ENABLED

#ifdef OJO_LIBDATACHANNEL
    {
        std::lock_guard<std::mutex> lock(impl_->pc_mutex);
        if (impl_->peer_connection) {
            impl_->peer_connection->close();
            impl_->peer_connection = nullptr;
        }
    }
    impl_->video_codec_by_pt.clear();
    {
        std::lock_guard<std::mutex> lock(impl_->audio_mutex);
#ifdef OJO_OPUS_ENABLED
        if (impl_->opus_decoder) {
            opus_decoder_destroy(impl_->opus_decoder);
            impl_->opus_decoder = nullptr;
            impl_->opus_channels = 0;
        }
#endif
    }
#endif  // OJO_LIBDATACHANNEL

    impl_->local_sdp.clear();
    impl_->remote_sdp.clear();
    {
        std::lock_guard<std::mutex> lock(impl_->session_mutex);
        impl_->session_token.clear();
        impl_->pending_session_id.clear();
    }
    if (impl_->signaling) impl_->signaling->stop();
    impl_->signaling.reset();
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

std::string WebRTCTransport::generateSessionToken() {
    static const char* hex = "0123456789abcdef";
    std::string token;
    token.reserve(64);
    for (int i = 0; i < 64; ++i) token += hex[rand() & 0xF];
    return token;
}

bool WebRTCTransport::sessionAuthorized(const std::string& message) {
    std::lock_guard<std::mutex> lock(impl_->session_mutex);
    if (impl_->session_token.empty()) return false;
    if (extractJsonField(message, "sessionToken") != impl_->session_token) return false;
    const std::string ts = extractJsonField(message, "timestamp");
    if (ts.empty()) return false;
    char* end = nullptr;
    const long long timestamp_ms = std::strtoll(ts.c_str(), &end, 10);
    if (end == ts.c_str() || timestamp_ms <= 0) return false;
    const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
    return std::llabs(now_ms - timestamp_ms) <= 5 * 60 * 1000LL;
}

void WebRTCTransport::sendSignalingError(const std::string& error_message) {
    if (!impl_->signaling) return;
    std::ostringstream msg;
    msg << "{\"type\":\"ERROR\",\"errorMessage\":\"" << escapeJson(error_message) << "\"}";
    impl_->signaling->sendMessage(msg.str());
}

void WebRTCTransport::sendPong() {
    if (impl_->signaling) impl_->signaling->sendMessage("{\"type\":\"PONG\"}");
}

void WebRTCTransport::sendAnswer() {
    std::string sdp;
    {
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        sdp = impl_->local_sdp;
    }
    if (sdp.empty() || !impl_->signaling) return;
    std::string session_id;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(impl_->session_mutex);
        session_id = impl_->pending_session_id;
        token = impl_->session_token;
    }
    const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
    std::ostringstream msg;
    msg << "{\"type\":\"ANSWER\",\"sdp\":\"" << escapeJson(sdp)
        << "\",\"sdpType\":\"answer\""
        << ",\"sessionId\":\"" << escapeJson(session_id) << "\""
        << ",\"sessionToken\":\"" << escapeJson(token) << "\""
        << ",\"timestamp\":" << now_ms << "}";
    impl_->signaling->sendMessage(msg.str());
    blog(LOG_INFO, "[Ojowacam] WebRTC answer sent");
}

void WebRTCTransport::sendStartSessionAck(const std::string& session_id) {
    if (!impl_->signaling) return;
    std::string token;
    {
        std::lock_guard<std::mutex> lock(impl_->session_mutex);
        token = impl_->session_token;
    }
    const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
    std::ostringstream msg;
    msg << "{\"type\":\"START_SESSION\",\"sessionId\":\"" << escapeJson(session_id)
        << "\",\"sessionToken\":\"" << escapeJson(token)
        << "\",\"timestamp\":" << now_ms << "}";
    impl_->signaling->sendMessage(msg.str());
    blog(LOG_INFO, "[Ojowacam] Session acknowledged: %s", session_id.c_str());
}

void WebRTCTransport::handlePairingRequest(const std::string& message) {
    const std::string device_id = extractJsonField(message, "deviceId");

    // Seamless session: any peer that reaches the signaling server is trusted.
    // Mint a session token and accept immediately — no pairing code.
    const std::string token = generateSessionToken();
    {
        std::lock_guard<std::mutex> lock(impl_->session_mutex);
        impl_->session_token = token;
        impl_->pending_session_id.clear();
    }

    std::ostringstream msg;
    msg << "{\"type\":\"PAIRING_RESPONSE\",\"success\":true"
        << ",\"deviceId\":\"" << escapeJson(device_id) << "\""
        << ",\"sessionToken\":\"" << escapeJson(token) << "\"}";
    if (impl_->signaling) impl_->signaling->sendMessage(msg.str());
    blog(LOG_INFO, "[Ojowacam] Session established with device %s", device_id.c_str());
}

void WebRTCTransport::setRemoteDescription(const std::string& type, const std::string& sdp) {
#ifdef OJO_WEBRTC_ENABLED
#if defined(__APPLE__)
    if (!impl_->factory) {
        [PeerConnectionFactory initializeEncoderFactory:[[DefaultVideoEncoderFactory alloc] init]
                                            decoderFactory:[[DefaultVideoDecoderFactory alloc] init]];
        impl_->factory = [[PeerConnectionFactory alloc] initWithOptions:[[PeerConnectionFactory.Options alloc] init]];
    }
    if (!impl_->peer_connection) {
        RTCConfiguration *pcConfig = [[RTCConfiguration alloc] init];
        pcConfig.iceServers = @[[[RTCIceServer alloc] initWithURLStrings:@[@"stun:stun.l.google.com:19302"]]];
        RTCMediaConstraints *pcConstraints = [[RTCMediaConstraints alloc] initWithMandatoryConstraints:@{
            @"OfferToReceiveAudio": @"true",
            @"OfferToReceiveVideo": @"true"
        } optionalConstraints:nil];
        impl_->peer_connection = [impl_->factory peerConnectionWithConfiguration:pcConfig
                                                             constraints:pcConstraints
                                                               delegate:nil];
    }
    if (impl_->peer_connection) {
        RTCSessionDescription* desc = [[RTCSessionDescription alloc]
            initWithType:(type == "answer" ? RTCSdpTypeAnswer : RTCSdpTypeOffer)
                     sdp:[NSString stringWithUTF8String:sdp.c_str()]];
        [impl_->peer_connection setRemoteDescription:desc
                                        completionHandler:^(NSError *error) {
            if (error) {
                NSLog(@"Ojowacam: Set remote description error: %@", error.localizedDescription);
                return;
            }
            {
                std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
                impl_->remote_sdp = sdp;
            }
            connected_ = true;
            impl_->connected = true;
            if (onConnectionStateChanged) onConnectionStateChanged(true);
            blog(LOG_INFO, "[Ojowacam] Remote description set (macOS native): %s", type.c_str());

            if (type == "offer") {
                RTCMediaConstraints *constraints = [[RTCMediaConstraints alloc]
                    initWithMandatoryConstraints:@{
                        @"OfferToReceiveAudio": @"true",
                        @"OfferToReceiveVideo": @"true"
                    } optionalConstraints:nil];
                [impl_->peer_connection answerForConstraints:constraints
                                           completionHandler:^(RTCSessionDescription *answerSdp, NSError *answerError) {
                    if (answerError) {
                        NSLog(@"Ojowacam: Answer error: %@", answerError.localizedDescription);
                        return;
                    }
                    [impl_->peer_connection setLocalDescription:answerSdp
                                              completionHandler:^(NSError *localError) {
                        if (localError) {
                            NSLog(@"Ojowacam: Set local description error: %@", localError.localizedDescription);
                            return;
                        }
                        {
                            std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
                            impl_->local_sdp = [answerSdp.sdp UTF8String];
                        }
                        sendAnswer();
                    }];
                }];
            }
        }];
    }
#elif defined(_WIN32)
    if (!impl_->factory) {
        impl_->factory = webrtc::CreatePeerConnectionFactory();
    }
    if (!impl_->peer_connection) {
        webrtc::PeerConnectionInterface::RTCConfiguration config;
        config.servers.push_back({"stun:stun.l.google.com:19302"});
        impl_->factory->CreatePeerConnection(
            config, nullptr, nullptr,
            [this](rtc::scoped_refptr<webrtc::PeerConnectionInterface> pc) {
                impl_->peer_connection = pc;
            },
            [](webrtc::PeerConnectionInterface::IceConnectionState) {},
            [](webrtc::PeerConnectionInterface::IceGatheringState) {});
    }
    if (impl_->peer_connection) {
        {
            std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
            impl_->remote_sdp = sdp;
        }
        connected_ = true;
        impl_->connected = true;
        if (onConnectionStateChanged) onConnectionStateChanged(true);
        blog(LOG_INFO, "[Ojowacam] Remote description set (Windows native): %s", type.c_str());

        // Answer wiring mirrors CreateOffer's observer style above; exact
        // observer types depend on the linked libwebrtc version.
        if (type == "offer") {
            webrtc::SdpParseError parse_error;
            std::unique_ptr<webrtc::SessionDescriptionInterface> remote_desc =
                webrtc::CreateSessionDescription(webrtc::SdpType::kOffer, sdp, &parse_error);
            if (!remote_desc) {
                blog(LOG_ERROR, "[Ojowacam] Failed to parse remote offer");
                return;
            }
            impl_->peer_connection->SetRemoteDescription(
                std::move(remote_desc),
                [this](bool ok) {
                    if (!ok) {
                        blog(LOG_ERROR, "[Ojowacam] SetRemoteDescription failed");
                        return;
                    }
                    webrtc::PeerConnectionInterface::RTCOfferAnswerOptions options;
                    impl_->peer_connection->CreateAnswer(
                        [this](webrtc::CreateSessionDescriptionObserver::Result result) {
                            if (!result.ok()) return;
                            std::string answer;
                            result.MoveValue()->ToString(&answer);
                            {
                                std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
                                impl_->local_sdp = answer;
                            }
                            sendAnswer();
                        },
                        options);
                });
        }
    }
#endif
#elif defined(OJO_LIBDATACHANNEL)
    if (type != "offer") {
        // The phone is always the offerer; store and ignore anything else.
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        impl_->remote_sdp = sdp;
        return;
    }

    // Learn payload type -> codec from the offer so incoming RTP is dispatched
    // to the right depacketizer, and tell the receiver which decoder to prepare
    // before the first frame arrives.
    {
        std::map<int, std::string> pt_map;
        const std::string codec = parseSdpVideoCodecs(sdp, pt_map);
        if (!pt_map.empty()) impl_->video_codec_by_pt = std::move(pt_map);
        if (!codec.empty()) {
            impl_->negotiated_video_codec = codec;
            if (onVideoCodecNegotiated) onVideoCodecNegotiated(codec);
            blog(LOG_INFO, "[Ojowacam] Remote video codec from offer: %s", codec.c_str());
        }
    }

    std::shared_ptr<rtc::PeerConnection> pc;
    {
        std::lock_guard<std::mutex> lock(impl_->pc_mutex);
        if (!impl_->peer_connection) {
            rtc::Configuration config;
            config.iceServers.emplace_back("stun:stun.l.google.com:19302");

            auto new_pc = std::make_shared<rtc::PeerConnection>(config);

            // Non-trickle answer: deliver the local description once ICE
            // gathering completes, with candidates embedded in the SDP.
            new_pc->onGatheringStateChange([this](rtc::PeerConnection::GatheringState state) {
                if (state != rtc::PeerConnection::GatheringState::Complete) return;
                std::shared_ptr<rtc::PeerConnection> current;
                {
                    std::lock_guard<std::mutex> lock(impl_->pc_mutex);
                    current = impl_->peer_connection;
                }
                if (!current) return;
                auto desc = current->localDescription();
                if (!desc) return;
                {
                    std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
                    impl_->local_sdp = std::string(*desc);
                }
                sendAnswer();
            });

            new_pc->onTrack([this](std::shared_ptr<rtc::Track> track) {
                track->setMediaHandler(std::make_shared<rtc::RtcpReceivingSession>());
                // Per-track depacketizer state: confined to this track's message
                // thread, so no cross-thread synchronization is needed for it.
                auto depay = std::make_shared<std::unique_ptr<RtpDepacketizer>>();
                track->onMessage(
                    [this, depay](rtc::binary message) {
                        handleIncomingRtp(reinterpret_cast<const uint8_t*>(message.data()),
                                          message.size(), depay);
                    },
                    nullptr);
            });

            impl_->peer_connection = new_pc;
        }
        pc = impl_->peer_connection;
    }

    {
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        impl_->remote_sdp = sdp;
        impl_->local_sdp.clear();
    }

    try {
        // Internally generates the local answer and starts ICE gathering;
        // onGatheringStateChange delivers it via sendAnswer().
        pc->setRemoteDescription(rtc::Description(sdp, "offer"));
    } catch (const std::exception& e) {
        blog(LOG_ERROR, "[Ojowacam] setRemoteDescription failed: %s", e.what());
        return;
    }

    impl_->connected = true;
    connected_ = true;
    if (onConnectionStateChanged) onConnectionStateChanged(true);
    blog(LOG_INFO, "[Ojowacam] Remote description set (libdatachannel): offer");
#else
    // No WebRTC backend compiled in: fail honestly — never fabricate an
    // answer that would fake a working media session.
    (void)type;
    (void)sdp;
    blog(LOG_ERROR,
         "[Ojowacam] No WebRTC backend compiled (libdatachannel/WebRTC missing); cannot handle offer");
#endif
}

void WebRTCTransport::addIceCandidate(const std::string& candidate) {
#ifdef OJO_WEBRTC_ENABLED
#if defined(__APPLE__)
    if (impl_->peer_connection) {
        RTCIceCandidate* ice = [[RTCIceCandidate alloc]
            initWithSdp:candidate.c_str()
            sdpMLineIndex:0
            sdpMid:nil];
        [impl_->peer_connection addIceCandidate:ice];
    }
#elif defined(_WIN32)
    // ICE candidate wiring depends on libwebrtc version; log for now
    blog(LOG_DEBUG, "[Ojowacam] ICE candidate received (Windows)");
    (void)candidate;
#endif
#elif defined(OJO_LIBDATACHANNEL)
    std::shared_ptr<rtc::PeerConnection> pc;
    {
        std::lock_guard<std::mutex> lock(impl_->pc_mutex);
        pc = impl_->peer_connection;
    }
    if (pc && !candidate.empty()) {
        try {
            pc->addRemoteCandidate(rtc::Candidate(candidate));
        } catch (const std::exception& e) {
            blog(LOG_WARNING, "[Ojowacam] addRemoteCandidate failed: %s", e.what());
        }
    }
#else
    (void)candidate;
    blog(LOG_DEBUG, "[Ojowacam] ICE candidate received");
#endif
}

#ifdef OJO_LIBDATACHANNEL
void WebRTCTransport::handleIncomingRtp(
    const uint8_t* data, size_t size,
    const std::shared_ptr<std::unique_ptr<RtpDepacketizer>>& depay) {
    RtpPacketView view;
    if (!parseRtpPacket(data, size, view)) return;

    auto it = impl_->video_codec_by_pt.find(view.payload_type);
    if (it != impl_->video_codec_by_pt.end()) {
        // Video payload: depacketize into complete access units and hand the
        // codec bitstream to the receiver's decoder pipeline.
        auto& slot = *depay;
        if (!slot || slot->codec() != it->second) {
            slot = std::make_unique<RtpDepacketizer>(it->second);
        }
        slot->push(view, [this](const std::vector<uint8_t>& frame_data, uint32_t rtp_ts) {
            if (!onVideoFrame) return;
            VideoFrame frame;
            frame.data = frame_data;
            frame.timestamp_us = static_cast<int64_t>(rtp_ts) * 1000000LL / 90000LL;
            frame.format = VideoPixelFormat::Unknown;
            onVideoFrame(frame);
        });
        return;
    }

    // Not a video payload type: treat as Opus audio from the phone.
#ifdef OJO_OPUS_ENABLED
    if (!view.payload || view.payload_size == 0) return;
    std::lock_guard<std::mutex> lock(impl_->audio_mutex);
    const int channels = opus_packet_get_nb_channels(view.payload);
    if (channels <= 0 || channels > 2) return;
    if (!impl_->opus_decoder || impl_->opus_channels != channels) {
        if (impl_->opus_decoder) opus_decoder_destroy(impl_->opus_decoder);
        int err = OPUS_OK;
        impl_->opus_decoder = opus_decoder_create(48000, channels, &err);
        if (err != OPUS_OK || !impl_->opus_decoder) {
            impl_->opus_decoder = nullptr;
            impl_->opus_channels = 0;
            return;
        }
        impl_->opus_channels = channels;
    }

    constexpr int kMaxFrameSamples = 5760; // 120 ms @ 48 kHz
    std::vector<float> pcm(static_cast<size_t>(kMaxFrameSamples) *
                           static_cast<size_t>(channels));
    int decoded = opus_decode_float(impl_->opus_decoder,
                                    view.payload,
                                    static_cast<opus_int32>(view.payload_size),
                                    pcm.data(),
                                    kMaxFrameSamples,
                                    0);
    if (decoded < 0) {
        // Standard Opus packet-loss concealment for a corrupt packet.
        decoded = opus_decode_float(impl_->opus_decoder, nullptr, 0,
                                    pcm.data(), kMaxFrameSamples, 0);
    }
    if (decoded <= 0) return; // honest drop: never fabricate audio

    pcm.resize(static_cast<size_t>(decoded) * static_cast<size_t>(channels));
    if (onAudioFrame) {
        AudioFrame frame;
        frame.samples = std::move(pcm);
        frame.sample_rate = 48000;
        frame.channels = channels;
        frame.timestamp_us =
            std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count();
        onAudioFrame(frame);
    }
#else
    static std::atomic<bool> warned_no_opus{false};
    if (!warned_no_opus.exchange(true)) {
        blog(LOG_ERROR, "[Ojowacam] Audio RTP dropped: Opus support not built");
    }
#endif
}
#endif  // OJO_LIBDATACHANNEL

void WebRTCTransport::handleBinaryAudio(const std::string& payload) {
    // Raw microphone PCM from the phone's Wireless Mic broadcast:
    // little-endian signed 16-bit interleaved stereo at 48 kHz. The phone only
    // sends these while its broadcast is running; each frame is converted to
    // float and handed to the receiver's OBS audio path.
    {
        std::lock_guard<std::mutex> lock(impl_->session_mutex);
        if (impl_->session_token.empty()) {
            static std::atomic<bool> warned_no_session{false};
            if (!warned_no_session.exchange(true)) {
                blog(LOG_WARNING,
                     "[Ojowacam] Wireless mic PCM dropped: no session (pair with the phone first)");
            }
            return;
        }
    }

    // Whole stereo s16 frames only (4 bytes per left+right sample pair).
    if (payload.size() < 4 || payload.size() % 4 != 0) return;

    constexpr int kChannels = 2;
    const size_t sample_count = payload.size() / sizeof(int16_t);
    const auto* in = reinterpret_cast<const int16_t*>(payload.data());

    AudioFrame frame;
    frame.sample_rate = 48000;
    frame.channels = kChannels;
    frame.timestamp_us =
        std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch())
            .count();
    frame.samples.resize(sample_count);
    for (size_t i = 0; i < sample_count; ++i) {
        frame.samples[i] = static_cast<float>(in[i]) / 32768.0f;
    }
    if (onAudioFrame) onAudioFrame(frame);
}

void WebRTCTransport::handleSignalingMessage(const std::string& message) {
    blog(LOG_DEBUG, "[Ojowacam] Signaling message: %s", message.c_str());
    const std::string msgType = extractJsonField(message, "type");

    if (msgType == "PING") {
        sendPong();
        return;
    }
    if (msgType == "PONG") {
        return; // phone confirmed liveness; nothing to do
    }
    if (msgType == "PAIRING_REQUEST") {
        handlePairingRequest(message);
        return;
    }
    if (msgType == "OFFER") {
        if (!sessionAuthorized(message)) {
            sendSignalingError("Session required: pair with the phone first");
            return;
        }
        {
            std::lock_guard<std::mutex> lock(impl_->session_mutex);
            impl_->pending_session_id = extractJsonField(message, "sessionId");
        }
        setRemoteDescription("offer", extractJsonField(message, "sdp"));
        return;
    }
    if (msgType == "ANSWER") {
        if (!sessionAuthorized(message)) {
            sendSignalingError("Session required: pair with the phone first");
            return;
        }
        setRemoteDescription("answer", extractJsonField(message, "sdp"));
        return;
    }
    if (msgType == "ICE_CANDIDATE") {
        if (!sessionAuthorized(message)) {
            sendSignalingError("Session required: pair with the phone first");
            return;
        }
        addIceCandidate(extractJsonField(message, "candidate"));
        return;
    }
    if (msgType == "START_SESSION") {
        if (!sessionAuthorized(message)) {
            sendSignalingError("Session required: pair with the phone first");
            return;
        }
        sendStartSessionAck(extractJsonField(message, "sessionId"));
        return;
    }
    if (msgType == "DEVICE_ANNOUNCEMENT") {
        blog(LOG_INFO, "[Ojowacam] Device announcement: %s",
             extractJsonField(message, "deviceId").c_str());
        return;
    }
    if (msgType == "ERROR") {
        std::string err = extractJsonField(message, "errorMessage");
        if (err.empty()) err = extractJsonField(message, "message");
        blog(LOG_ERROR, "[Ojowacam] Signaling error: %s", err.c_str());
        return;
    }
    blog(LOG_DEBUG, "[Ojowacam] Ignoring unknown signaling message type: %s", msgType.c_str());
}

std::string WebRTCTransport::extractJsonField(const std::string& json, const std::string& field) {
    const std::string key = "\"" + field + "\"";
    size_t pos = json.find(key);
    if (pos == std::string::npos) return "";
    size_t colon = json.find(':', pos + key.size());
    if (colon == std::string::npos) return "";
    size_t i = colon + 1;
    while (i < json.size() && (json[i] == ' ' || json[i] == '\t' || json[i] == '\n' || json[i] == '\r')) ++i;
    if (i >= json.size()) return "";

    if (json[i] == '"') {
        // String value: scan for the closing quote, honoring escapes.
        std::string raw;
        bool escaped = false;
        for (size_t j = i + 1; j < json.size(); ++j) {
            char c = json[j];
            if (escaped) {
                raw += '\\';
                raw += c;
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                return unescapeJson(raw);
            } else {
                raw += c;
            }
        }
        return ""; // unterminated
    }

    // Bare token: number, true/false, null (until delimiter or whitespace).
    size_t start = i;
    while (i < json.size() && json[i] != ',' && json[i] != '}' && json[i] != ']' &&
           json[i] != ' ' && json[i] != '\t' && json[i] != '\n' && json[i] != '\r') {
        ++i;
    }
    return json.substr(start, i - start);
}

std::string WebRTCTransport::unescapeJson(const std::string& input) {
    std::string out;
    out.reserve(input.size());
    for (size_t i = 0; i < input.size(); ++i) {
        if (input[i] != '\\' || i + 1 >= input.size()) {
            out += input[i];
            continue;
        }
        char c = input[++i];
        switch (c) {
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            case '/': out += '/'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'u': {
                if (i + 4 >= input.size()) break;
                unsigned int code = 0;
                for (int k = 1; k <= 4; ++k) {
                    char h = input[i + k];
                    code <<= 4;
                    if (h >= '0' && h <= '9') code |= static_cast<unsigned int>(h - '0');
                    else if (h >= 'a' && h <= 'f') code |= static_cast<unsigned int>(h - 'a' + 10);
                    else if (h >= 'A' && h <= 'F') code |= static_cast<unsigned int>(h - 'A' + 10);
                }
                i += 4;
                if (code <= 0x7F) {
                    out += static_cast<char>(code);
                } else if (code <= 0x7FF) {
                    out += static_cast<char>(0xC0 | (code >> 6));
                    out += static_cast<char>(0x80 | (code & 0x3F));
                } else {
                    out += static_cast<char>(0xE0 | (code >> 12));
                    out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
                    out += static_cast<char>(0x80 | (code & 0x3F));
                }
                break;
            }
            default: out += c; break;
        }
    }
    return out;
}

std::string WebRTCTransport::escapeJson(const std::string& input) {
    std::string out;
    out.reserve(input.size());
    for (char c : input) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c;
        }
    }
    return out;
}

} // namespace ojowacam
