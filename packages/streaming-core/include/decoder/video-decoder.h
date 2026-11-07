#pragma once

#include "../streaming-core.h"
#include <functional>
#include <vector>
#include <string>
#include <cstdint>

namespace ojowacam {

class VideoDecoder {
public:
    virtual ~VideoDecoder() = default;

    virtual bool initialize(int width, int height, const std::string& codec) = 0;
    virtual bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) = 0;
    virtual void release() = 0;

    std::function<void(const VideoFrame&)> onFrameDecoded;

    virtual bool isInitialized() const = 0;
};

// ---------------------------------------------------------------------------
// H264 NAL unit types
// ---------------------------------------------------------------------------
enum H264NalType {
    H264_NAL_UNSPEC = 0,
    H264_NAL_SLICE = 1,
    H264_NAL_SLICE_DPA = 2,
    H264_NAL_SLICE_DPB = 3,
    H264_NAL_SLICE_DPC = 4,
    H264_NAL_IDR = 5,
    H264_NAL_SEI = 6,
    H264_NAL_SPS = 7,
    H264_NAL_PPS = 8,
    H264_NAL_AUD = 9,
    H264_NAL_END_SEQUENCE = 10,
    H264_NAL_END_STREAM = 11,
    H264_NAL_FILLER = 12,
};

class H264VideoDecoder final : public VideoDecoder {
public:
    bool initialize(int width, int height, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;

    const std::vector<uint8_t>& sps() const { return sps_; }
    const std::vector<uint8_t>& pps() const { return pps_; }

private:
    std::vector<std::vector<uint8_t>> splitNalUnits(const std::vector<uint8_t>& data);
    bool parseNalHeader(const uint8_t* data, size_t size, int& nal_type, int& nal_ref_idc) const;
    bool parseSps(const std::vector<uint8_t>& sps, int& width, int& height);
    void emitFrame();

    struct BitReader {
        const uint8_t* data;
        size_t bit_pos;
        size_t size_bytes;
        unsigned int readBits(int count);
        unsigned int readUe();
        unsigned int readSe();
    };

    int width_ = 0;
    int height_ = 0;
    bool initialized_ = false;
    std::vector<uint8_t> sps_;
    std::vector<uint8_t> pps_;
    std::vector<uint8_t> frame_buffer_;
    int64_t frame_timestamp_ = 0;
    bool waiting_for_idr_ = true;
};

} // namespace ojowacam