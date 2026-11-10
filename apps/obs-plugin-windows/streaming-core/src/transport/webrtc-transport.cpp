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

#ifdef OJO_WEBRTC_ENABLED
    #if defined(__APPLE__)
        #import <WebRTC/WebRTC.h>
    #elif defined(_WIN32)
        #include <webrtc/api/peer_connection_interface.h>
        #include <webrtc/api/create_peerconnection_factory.h>
        #include <webrtc/modules/audio_device/include/audio_device.h>
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

static std::vector<uint8_t> ws_frame_text(const std::string& payload) {
    std::vector<uint8_t> frame;
    frame.push_back(0x81); // FIN + text opcode
    uint64_t len = payload.size();
    if (len <= 125) {
        frame.push_back(static_cast<uint8_t>(len));
    } else if (len <= 65535) {
        frame.push_back(0x7E);
        frame.push_back(static_cast<uint8_t>((len >> 8) & 0xFF));
        frame.push_back(static_cast<uint8_t>(len & 0xFF));
    } else {
        frame.push_back(0x7F);
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

static std::string ws_recv_frame(ojo_socket_t sock, bool& fin, uint8_t& opcode) {
    uint8_t header[2];
    if (recv(sock, reinterpret_cast<char*>(header), 2, 0) != 2) return "";
    fin = (header[0] & 0x80) != 0;
    opcode = header[0] & 0x0F;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t len = header[1] & 0x7F;
    if (len == 126) {
        uint8_t ext[2];
        if (recv(sock, reinterpret_cast<char*>(ext), 2, 0) != 2) return "";
        len = (static_cast<uint64_t>(ext[0]) << 8) | ext[1];
    } else if (len == 127) {
        uint8_t ext[8];
        if (recv(sock, reinterpret_cast<char*>(ext), 8, 0) != 8) return "";
        len = 0;
        for (int i = 0; i < 8; ++i)
            len = (len << 8) | ext[i];
    }
    std::vector<uint8_t> mask;
    if (masked) {
        mask.resize(4);
        if (recv(sock, reinterpret_cast<char*>(mask.data()), 4, 0) != 4) return "";
    }
    std::vector<uint8_t> data(len);
    size_t received = 0;
    while (received < len) {
        int n = recv(sock, reinterpret_cast<char*>(data.data() + received),
                     static_cast<int>(len - received), 0);
        if (n <= 0) return "";
        received += static_cast<size_t>(n);
    }
    if (masked) {
        for (size_t i = 0; i < len; ++i)
            data[i] ^= mask[i % 4];
    }
    return std::string(data.begin(), data.end());
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
    std::function<void(bool)> onStateChanged;

private:
    void recvLoop() {
        while (running_ && sock_ != INVALID_SOCKET) {
            bool fin; uint8_t opcode;
            std::string msg = ws_recv_frame(sock_, fin, opcode);
            if (msg.empty()) break;
            if (opcode == 0x8) {
                running_ = false;
                break;
            }
            if (onMessage) onMessage(msg);
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

#ifdef OJO_WEBRTC_ENABLED

#if defined(__APPLE__)
struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;
    bool offer_created = false;

    PeerConnectionFactory* factory = nullptr;
    RTCPeerConnection* peer_connection = nullptr;
    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};

#elif defined(_WIN32)
struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;
    bool offer_created = false;

    rtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory;
    rtc::scoped_refptr<webrtc::PeerConnectionInterface> peer_connection;
    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};
#endif

#else  // !OJO_WEBRTC_ENABLED

struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;
    bool offer_created = false;
    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    Impl() = default;
    ~Impl() = default;
};

#endif  // OJO_WEBRTC_ENABLED

WebRTCTransport::WebRTCTransport() : impl_(new Impl()) {}
WebRTCTransport::~WebRTCTransport() { disconnect(); delete impl_; }

bool WebRTCTransport::connect(const std::string& url) {
    impl_->url = url;
    impl_->signaling = std::make_unique<SignalingClient>();
    impl_->signaling->onMessage = [this](const std::string& message) {
        handleSignalingMessage(message);
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

    std::ostringstream join;
    join << "{\"type\":\"join\",\"role\":\"receiver\",\"device\":\"obs-desktop\"}";
    impl_->signaling->sendMessage(join.str());

    if (onConnectionStateChanged) onConnectionStateChanged(true);
    return true;
}

void WebRTCTransport::disconnect() {
    impl_->connected = false;
    impl_->offer_created = false;
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

    impl_->local_sdp.clear();
    impl_->remote_sdp.clear();
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

void WebRTCTransport::createOffer() {
#ifdef OJO_WEBRTC_ENABLED
#if defined(__APPLE__)
    if (!impl_->factory) {
        [PeerConnectionFactory initializeEncoderFactory:[[DefaultVideoEncoderFactory alloc] init]
                                            decoderFactory:[[DefaultVideoDecoderFactory alloc] init]];
        impl_->factory = [[PeerConnectionFactory alloc] initWithOptions:[[PeerConnectionFactory.Options alloc] init]];
    }

    RTCConfiguration *config = [[RTCConfiguration alloc] init];
    config.iceServers = @[[[RTCIceServer alloc] initWithURLStrings:@[@"stun:stun.l.google.com:19302"]]];

    RTCMediaConstraints *constraints = [[RTCMediaConstraints alloc] initWithMandatoryConstraints:@{
        @"OfferToReceiveAudio": @"true",
        @"OfferToReceiveVideo": @"true"
    } optionalConstraints:nil];

    impl_->peer_connection = [impl_->factory peerConnectionWithConfiguration:config
                                                  constraints:constraints
                                                    delegate:nil];

    [impl_->peer_connection offerForConstraints:constraints completionHandler:^(RTCSessionDescription *sdp, NSError *error) {
        if (error) {
            NSLog(@"Ojowacam: Offer error: %@", error.localizedDescription);
            return;
        }
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        impl_->local_sdp = [sdp.sdp UTF8String];
        impl_->offer_created = true;

        std::ostringstream msg;
        msg << "{\"type\":\"offer\",\"sdp\":\"" << escapeJson(impl_->local_sdp) << "\"}";
        if (impl_->signaling) impl_->signaling->sendMessage(msg.str());
        blog(LOG_INFO, "[Ojowacam] WebRTC offer sent (macOS native)");
    }];
#elif defined(_WIN32)
    if (!impl_->factory) {
        impl_->factory = webrtc::CreatePeerConnectionFactory();
    }

    webrtc::PeerConnectionInterface::RTCConfiguration config;
    config.servers.push_back({"stun:stun.l.google.com:19302"});

    webrtc::PeerConnectionInterface::RTCOfferAnswerOptions options;
    impl_->factory->CreatePeerConnection(
        config, nullptr, nullptr,
        [this](rtc::scoped_refptr<webrtc::PeerConnectionInterface> pc) {
            impl_->peer_connection = pc;
        },
        [](webrtc::PeerConnectionInterface::IceConnectionState) {},
        [](webrtc::PeerConnectionInterface::IceGatheringState) {});

    if (impl_->peer_connection) {
        impl_->peer_connection->CreateOffer(
            [this](webrtc::CreateSessionDescriptionObserver::Result result) {
                if (!result.ok()) return;
                std::string sdp;
                result.MoveValue()->ToString(&sdp);
                std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
                impl_->local_sdp = sdp;
                impl_->offer_created = true;

                std::ostringstream msg;
                msg << "{\"type\":\"offer\",\"sdp\":\"" << escapeJson(sdp) << "\"}";
                if (impl_->signaling) impl_->signaling->sendMessage(msg.str());
                blog(LOG_INFO, "[Ojowacam] WebRTC offer sent (Windows native)");
            },
            options);
    }
#endif
#else
    // Fallback: WebSocket signaling only (no native WebRTC)
    {
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        impl_->local_sdp = "v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=Ojowacam\r\nt=0 0\r\n";
        impl_->offer_created = true;
    }

    std::ostringstream msg;
    msg << "{\"type\":\"offer\",\"sdp\":\"" << escapeJson(impl_->local_sdp) << "\"}";
    if (impl_->signaling) impl_->signaling->sendMessage(msg.str());
    blog(LOG_INFO, "[Ojowacam] WebRTC offer sent (signaling-only fallback)");
#endif
}

void WebRTCTransport::setRemoteDescription(const std::string& type, const std::string& sdp) {
#ifdef OJO_WEBRTC_ENABLED
#if defined(__APPLE__)
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
            std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
            impl_->remote_sdp = sdp;
            connected_ = true;
            impl_->connected = true;
            if (onConnectionStateChanged) onConnectionStateChanged(true);
            blog(LOG_INFO, "[Ojowacam] Remote description set (macOS native): %s", type.c_str());
        }];
    }
#elif defined(_WIN32)
    if (impl_->peer_connection) {
        // Simplified: store remote SDP; full observer wiring depends on libwebrtc version
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        impl_->remote_sdp = sdp;
        connected_ = true;
        impl_->connected = true;
        if (onConnectionStateChanged) onConnectionStateChanged(true);
        blog(LOG_INFO, "[Ojowacam] Remote description set (Windows native): %s", type.c_str());
    }
#endif
#else
    {
        std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
        impl_->remote_sdp = sdp;
        impl_->connected = true;
        connected_ = true;
        blog(LOG_INFO, "[Ojowacam] Remote description set (fallback): %s", type.c_str());
    }
    if (onConnectionStateChanged) onConnectionStateChanged(true);
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
#else
    (void)candidate;
    blog(LOG_DEBUG, "[Ojowacam] ICE candidate received");
#endif
}

void WebRTCTransport::handleSignalingMessage(const std::string& message) {
    blog(LOG_DEBUG, "[Ojowacam] Signaling message: %s", message.c_str());
    std::string msgType = extractJsonField(message, "type");

    if (msgType == "answer") {
        std::string sdp = extractJsonField(message, "sdp");
        setRemoteDescription("answer", sdp);
    } else if (msgType == "ice-candidate") {
        std::string candidate = extractJsonField(message, "candidate");
        addIceCandidate(candidate);
    } else if (msgType == "joined") {
        blog(LOG_INFO, "[Ojowacam] Signaling server acknowledged join");
        if (!impl_->offer_created) createOffer();
    } else if (msgType == "error") {
        std::string err = extractJsonField(message, "message");
        blog(LOG_ERROR, "[Ojowacam] Signaling error: %s", err.c_str());
    }
}

std::string WebRTCTransport::extractJsonField(const std::string& json, const std::string& field) {
    std::string key = "\"" + field + "\"";
    size_t pos = json.find(key);
    if (pos == std::string::npos) return "";
    size_t colon = json.find(':', pos + key.size());
    if (colon == std::string::npos) return "";
    size_t valStart = json.find('"', colon + 1);
    if (valStart == std::string::npos) return "";
    size_t valEnd = json.find('"', valStart + 1);
    if (valEnd == std::string::npos) return "";
    return json.substr(valStart + 1, valEnd - valStart - 1);
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
