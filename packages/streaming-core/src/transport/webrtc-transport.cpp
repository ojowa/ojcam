#include "transport/webrtc-transport.h"
#include <iostream>
#include <sstream>
#include <cstring>
#include <thread>
#include <chrono>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <vector>
#include <algorithm>

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    typedef int socklen_t;
    #define CLOSE_SOCKET(s) closesocket(s)
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #include <netdb.h>
    #define CLOSE_SOCKET(s) close(s)
    #define SOCKET int
    #define INVALID_SOCKET -1
    #define SOCKET_ERROR -1
#endif

namespace ojowacam {

// ---------------------------------------------------------------------------
// WebSocket framing helpers (RFC 6455)
// ---------------------------------------------------------------------------

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

static bool ws_send(SOCKET sock, const std::string& message) {
    auto frame = ws_frame_text(message);
    ssize_t sent = send(sock, reinterpret_cast<const char*>(frame.data()),
                        static_cast<int>(frame.size()), 0);
    return sent == static_cast<ssize_t>(frame.size());
}

static std::string ws_recv_frame(SOCKET sock, bool& fin, uint8_t& opcode) {
    uint8_t header[2];
    if (recv(sock, reinterpret_cast<char*>(header), 2, 0) != 2) return "";
    fin = (header[0] & 0x80) != 0;
    opcode = header[0] & 0x0F;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t len = header[1] & 0x7F;
    size_t offset = 2;
    if (len == 126) {
        uint8_t ext[2];
        if (recv(sock, reinterpret_cast<char*>(ext), 2, 0) != 2) return "";
        len = (static_cast<uint64_t>(ext[0]) << 8) | ext[1];
        offset = 4;
    } else if (len == 127) {
        uint8_t ext[8];
        if (recv(sock, reinterpret_cast<char*>(ext), 8, 0) != 8) return "";
        len = 0;
        for (int i = 0; i < 8; ++i)
            len = (len << 8) | ext[i];
        offset = 10;
    }
    std::vector<uint8_t> mask;
    if (masked) {
        mask.resize(4);
        if (recv(sock, reinterpret_cast<char*>(mask.data()), 4, 0) != 4) return "";
    }
    std::vector<uint8_t> data(len);
    size_t received = 0;
    while (received < len) {
        ssize_t n = recv(sock, reinterpret_cast<char*>(data.data() + received),
                         static_cast<int>(len - received), 0);
        if (n <= 0) return "";
        received += static_cast<size_t>(n);

// ---------------------------------------------------------------------------
// WebSocket signaling client
// ---------------------------------------------------------------------------

class SignalingClient {
public:
    SignalingClient() : sock_(INVALID_SOCKET), running_(false) {}
    ~SignalingClient() { stop(); }

    bool connect(const std::string& url) {
        std::string scheme, host, path;
        int port = 80;
        size_t pos = url.find("://");
        if (pos == std::string::npos) return false;
        scheme = url.substr(0, pos);
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
// ---------------------------------------------------------------------------
// WebRTCTransport implementation
// ---------------------------------------------------------------------------

struct WebRTCTransport::Impl {
    std::string url;
    std::unique_ptr<SignalingClient> signaling;
    bool connected = false;
    bool offer_created = false;
    std::string local_sdp;
    std::string remote_sdp;
    std::mutex sdp_mutex;

    static std::string extractSessionId(const std::string& sdp) {
        size_t pos = sdp.find("o=- ");
        if (pos == std::string::npos) return "0";
        size_t end = sdp.find(' ', pos + 4);
        if (end == std::string::npos) end = sdp.find('\r', pos);
        if (end == std::string::npos) end = sdp.size();
        return sdp.substr(pos + 4, end - pos - 4);
    }

    static std::string buildOfferSdp() {
        std::ostringstream sdp;
        sdp << "v=0\r\n";
        sdp << "o=- 0 0 IN IP4 0.0.0.0\r\n";
        sdp << "s=Ojowacam\r\n";
        sdp << "t=0 0\r\n";
        sdp << "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
        sdp << "c=IN IP4 0.0.0.0\r\n";
        sdp << "a=rtpmap:96 H264/90000\r\n";
        sdp << "a=fmtp:96 packetization-mode=1;profile-level-id=42e01f;level-asymmetry-allowed=1\r\n";
        sdp << "a=recvonly\r\n";
        sdp << "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
        sdp << "c=IN IP4 0.0.0.0\r\n";
        sdp << "a=rtpmap:111 opus/48000/2\r\n";
        sdp << "a=fmtp:111 minptime=10;useinbandfec=1\r\n";
        sdp << "a=recvonly\r\n";
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
    std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
    impl_->local_sdp = Impl::buildOfferSdp();
    impl_->offer_created = true;

    std::ostringstream msg;
    msg << "{\"type\":\"offer\",\"sdp\":\"" << escapeJson(impl_->local_sdp) << "\"}";
    if (impl_->signaling) impl_->signaling->sendMessage(msg.str());
    blog(LOG_INFO, "[Ojowacam] WebRTC offer sent");
}

void WebRTCTransport::setRemoteDescription(const std::string& type, const std::string& sdp) {
    std::lock_guard<std::mutex> lock(impl_->sdp_mutex);
    impl_->remote_sdp = sdp;
    impl_->connected = true;
    connected_ = true;
    blog(LOG_INFO, "[Ojowacam] Remote description set (%s)", type.c_str());
    if (onConnectionStateChanged) onConnectionStateChanged(true);
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
}

void WebRTCTransport::addIceCandidate(const std::string& candidate) {
    (void)candidate;
    blog(LOG_DEBUG, "[Ojowacam] ICE candidate received");
}
    impl_->local_sdp.clear();
    impl_->remote_sdp.clear();
    if (impl_->signaling) impl_->signaling->stop();
    impl_->signaling.reset();
    if (onConnectionStateChanged) onConnectionStateChanged(false);
}
        return sdp.str();
    }
};
            }
            if (onMessage) onMessage(msg);
        }
        running_ = false;
        if (onStateChanged) onStateChanged(false);
        CLOSE_SOCKET(sock_);
        sock_ = INVALID_SOCKET;
    }

    SOCKET sock_;
    std::atomic<bool> running_;
    std::thread recv_thread_;
    std::mutex send_mutex_;
};
    }
    if (masked) {
        for (size_t i = 0; i < len; ++i)
            data[i] ^= mask[i % 4];
    }
    return std::string(data.begin(), data.end());
}