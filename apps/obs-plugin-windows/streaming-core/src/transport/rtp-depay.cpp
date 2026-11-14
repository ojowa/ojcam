#include "transport/rtp-depay.h"

#include <cctype>
#include <cstring>

namespace ojowacam {

bool parseRtpPacket(const uint8_t* data, size_t size, RtpPacketView& out) {
    if (!data || size < 12) return false;
    if ((data[0] >> 6) != 2) return false; // RTP version 2

    const bool has_padding = (data[0] & 0x20) != 0;
    const bool has_extension = (data[0] & 0x10) != 0;
    const uint8_t csrc_count = data[0] & 0x0F;

    out.marker = (data[1] & 0x80) != 0;
    out.payload_type = data[1] & 0x7F;
    out.sequence = static_cast<uint16_t>((data[2] << 8) | data[3]);
    out.timestamp = (static_cast<uint32_t>(data[4]) << 24) |
                    (static_cast<uint32_t>(data[5]) << 16) |
                    (static_cast<uint32_t>(data[6]) << 8) |
                    static_cast<uint32_t>(data[7]);
    out.ssrc = (static_cast<uint32_t>(data[8]) << 24) |
               (static_cast<uint32_t>(data[9]) << 16) |
               (static_cast<uint32_t>(data[10]) << 8) |
               static_cast<uint32_t>(data[11]);

    size_t offset = 12 + static_cast<size_t>(csrc_count) * 4;
    if (size < offset) return false;

    if (has_extension) {
        if (size < offset + 4) return false;
        const size_t ext_words = (static_cast<size_t>(data[offset + 2]) << 8) |
                                 static_cast<size_t>(data[offset + 3]);
        offset += 4 + ext_words * 4;
        if (size < offset) return false;
    }

    size_t end = size;
    if (has_padding) {
        if (size == offset) return false;
        const uint8_t padding = data[size - 1];
        if (padding == 0 || size < offset + padding) return false;
        end = size - padding;
    }

    if (end < offset) return false;
    out.payload = data + offset;
    out.payload_size = end - offset;
    return true;
}

static void toUpper(std::string& s) {
    for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
}

std::string parseSdpVideoCodecs(const std::string& sdp,
                                std::map<int, std::string>& pt_to_codec) {
    std::string first_video_codec;
    bool in_video = false;
    std::vector<int> video_pts;

    size_t pos = 0;
    while (pos < sdp.size()) {
        size_t eol = sdp.find('\n', pos);
        if (eol == std::string::npos) eol = sdp.size();
        std::string line = sdp.substr(pos, eol - pos);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        pos = eol + 1;

        if (line.rfind("m=", 0) == 0) {
            // m=<media> <port> <proto> <fmt> ...
            in_video = line.rfind("m=video", 0) == 0;
            video_pts.clear();
            if (in_video) {
                size_t p = line.find(' ');
                for (int i = 0; i < 3 && p != std::string::npos; ++i) {
                    p = line.find(' ', p + 1);
                }
                while (p != std::string::npos) {
                    size_t next = line.find(' ', p + 1);
                    std::string tok = line.substr(
                        p + 1, next == std::string::npos ? std::string::npos : next - p - 1);
                    if (!tok.empty()) video_pts.push_back(std::atoi(tok.c_str()));
                    p = next;
                }
            }
        } else if (in_video && line.rfind("a=rtpmap:", 0) == 0) {
            // a=rtpmap:<pt> <codec>/<clock>[/<channels>]
            size_t colon = 9;
            size_t space = line.find(' ', colon);
            if (space == std::string::npos) continue;
            const int pt = std::atoi(line.substr(colon, space - colon).c_str());
            std::string codec = line.substr(space + 1);
            size_t slash = codec.find('/');
            if (slash != std::string::npos) codec = codec.substr(0, slash);
            toUpper(codec);
            if (!codec.empty()) {
                pt_to_codec[pt] = codec;
                if (first_video_codec.empty()) {
                    for (int vpt : video_pts) {
                        if (vpt == pt) {
                            first_video_codec = codec;
                            break;
                        }
                    }
                    if (first_video_codec.empty()) first_video_codec = codec;
                }
            }
        }
    }
    return first_video_codec;
}

RtpDepacketizer::RtpDepacketizer(std::string codec) : codec_(std::move(codec)) {}

void RtpDepacketizer::appendH264(const uint8_t* payload, size_t size) {
    static const std::vector<uint8_t> kStartCode = {0x00, 0x00, 0x00, 0x01};
    size_t i = 0;
    while (i < size) {
        const uint8_t nal_type = payload[i] & 0x1F;
        if (nal_type >= 1 && nal_type <= 23) {
            // Single NAL unit packet: the NAL occupies the whole payload.
            buffer_.insert(buffer_.end(), kStartCode.begin(), kStartCode.end());
            buffer_.insert(buffer_.end(), payload + i, payload + size);
            return;
        }
        if (nal_type == 24) { // STAP-A: size16-prefixed NALs
            ++i;
            while (i + 2 <= size) {
                const size_t nal_size =
                    (static_cast<size_t>(payload[i]) << 8) | payload[i + 1];
                i += 2;
                if (nal_size == 0 || i + nal_size > size) return;
                buffer_.insert(buffer_.end(), kStartCode.begin(), kStartCode.end());
                buffer_.insert(buffer_.end(), payload + i, payload + i + nal_size);
                i += nal_size;
            }
            return;
        }
        if (nal_type == 28) { // FU-A
            if (i + 2 > size) return;
            const uint8_t indicator = payload[i];
            const uint8_t header = payload[i + 1];
            const bool start = (header & 0x80) != 0;
            const bool end = (header & 0x40) != 0;
            const uint8_t fu_type = header & 0x1F;
            if (start) {
                if (fu_active_) buffer_.clear();
                buffer_.insert(buffer_.end(), kStartCode.begin(), kStartCode.end());
                buffer_.push_back(static_cast<uint8_t>((indicator & 0xE0) | fu_type));
                fu_active_ = true;
            }
            if (fu_active_) {
                buffer_.insert(buffer_.end(), payload + i + 2, payload + size);
            }
            if (end) fu_active_ = false;
            return;
        }
        return; // STAP-B/MAPB/FU-B require interleaved mode: drop.
    }
}

void RtpDepacketizer::appendVp8(const uint8_t* payload, size_t size) {
    if (size < 1) return;
    size_t offset = 1;
    const bool x = (payload[0] & 0x80) != 0;
    if (x) {
        if (size < offset + 1) return;
        const uint8_t ext = payload[offset];
        ++offset;
        const bool picture_id = (ext & 0x80) != 0;
        const bool tl0 = (ext & 0x40) != 0;
        if (picture_id) {
            if (size < offset + 1) return;
            const bool m = (payload[offset] & 0x80) != 0;
            offset += m ? 6 : 2;
        }
        if (tl0) offset += 2;
    }
    if (offset > size) return;
    buffer_.insert(buffer_.end(), payload + offset, payload + size);
}

void RtpDepacketizer::emitIfPending(const EmitFn& emit) {
    if (buffer_.empty()) return;
    if (emit) emit(buffer_, current_ts_);
    buffer_.clear();
    fu_active_ = false;
    have_ts_ = false;
}

void RtpDepacketizer::push(const RtpPacketView& packet, const EmitFn& emit) {
    if (!packet.payload || packet.payload_size == 0) return;

    if (have_ts_ && packet.timestamp != current_ts_) {
        emitIfPending(emit); // timestamp advanced without a marker bit
    }
    current_ts_ = packet.timestamp;
    have_ts_ = true;

    if (codec_ == "H264" || codec_ == "HEVC") {
        appendH264(packet.payload, packet.payload_size);
    } else if (codec_ == "VP8") {
        appendVp8(packet.payload, packet.payload_size);
    } else {
        // Unknown codec (VP9/AV1/...): pass payloads through raw; the decoder
        // will reject them unless it supports the codec.
        buffer_.insert(buffer_.end(), packet.payload, packet.payload + packet.payload_size);
    }

    if (packet.marker) emitIfPending(emit);
}

void RtpDepacketizer::flush(const EmitFn& emit) {
    emitIfPending(emit);
}

} // namespace ojowacam
