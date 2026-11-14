#pragma once

#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <vector>

namespace ojowacam {

// Parsed view over a raw RTP packet (RFC 3550): header fields plus a pointer
// to the payload with CSRC entries, header extensions and padding removed.
struct RtpPacketView {
    uint8_t payload_type = 0;
    uint16_t sequence = 0;
    uint32_t timestamp = 0;
    uint32_t ssrc = 0;
    bool marker = false;
    const uint8_t* payload = nullptr;
    size_t payload_size = 0;
};

bool parseRtpPacket(const uint8_t* data, size_t size, RtpPacketView& out);

// Parses an SDP offer/answer into payload-type -> codec-name (uppercase) for
// video m-lines ("H264", "VP8", "VP9", ...) and returns the first video codec.
std::string parseSdpVideoCodecs(const std::string& sdp,
                                std::map<int, std::string>& pt_to_codec);

// Accumulates codec payloads from an RTP stream into complete access units:
//  - H264: RFC 6184 depacketization (single NAL, STAP-A, FU-A) to Annex B
//  - VP8:  RFC 7741 payload descriptor stripping, concatenated payloads
// Frames are emitted on the RTP marker bit or on a timestamp change.
class RtpDepacketizer {
public:
    using EmitFn = std::function<void(const std::vector<uint8_t>& data, uint32_t rtp_ts)>;

    explicit RtpDepacketizer(std::string codec);

    const std::string& codec() const { return codec_; }

    void push(const RtpPacketView& packet, const EmitFn& emit);
    void flush(const EmitFn& emit);

private:
    void appendH264(const uint8_t* payload, size_t size);
    void appendVp8(const uint8_t* payload, size_t size);
    void emitIfPending(const EmitFn& emit);

    std::string codec_;
    std::vector<uint8_t> buffer_;
    uint32_t current_ts_ = 0;
    bool have_ts_ = false;
    bool fu_active_ = false;
};

} // namespace ojowacam
