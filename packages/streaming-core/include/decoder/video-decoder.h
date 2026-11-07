#pragma once

#include "../streaming-core.h"
#include <functional>
#include <vector>
#include <string>
#include <cstdint>
#include <memory>

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
// Hardware-accelerated video decoder abstract base
// Platform backends: FFmpeg (cross-platform), VideoToolbox (macOS), D3D11 (Windows)
// ---------------------------------------------------------------------------
class HardwareVideoDecoder : public VideoDecoder {
public:
    virtual ~HardwareVideoDecoder() = default;

    // Create the best available hardware decoder for the current platform
    static std::unique_ptr<HardwareVideoDecoder> Create(const std::string& codec);

    // Query if hardware decoding is available on this platform
    static bool IsHardwareDecodingAvailable();

protected:
    HardwareVideoDecoder() = default;
};

// ---------------------------------------------------------------------------
// FFmpeg-based H264 hardware/software decoder (cross-platform)
// ---------------------------------------------------------------------------
class FFmpegH264Decoder final : public HardwareVideoDecoder {
public:
    FFmpegH264Decoder();
    ~FFmpegH264Decoder() override;

    bool initialize(int width, int height, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

// ---------------------------------------------------------------------------
// VideoToolbox H264 hardware decoder (macOS)
// ---------------------------------------------------------------------------
#if defined(__APPLE__)
class VideoToolboxH264Decoder final : public HardwareVideoDecoder {
public:
    VideoToolboxH264Decoder();
    ~VideoToolboxH264Decoder() override;

    bool initialize(int width, int height, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
#endif

// ---------------------------------------------------------------------------
// D3D11 H264 hardware decoder (Windows)
// ---------------------------------------------------------------------------
#if defined(_WIN32)
class D3D11H264Decoder final : public HardwareVideoDecoder {
public:
    D3D11H264Decoder();
    ~D3D11H264Decoder() override;

    bool initialize(int width, int height, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
#endif

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

// ---------------------------------------------------------------------------
// Software H264 decoder (NAL parsing + passthrough, already implemented)
// ---------------------------------------------------------------------------
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