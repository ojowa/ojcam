#include "decoder/video-decoder.h"
#include <cstring>

namespace ojowacam {

bool H264VideoDecoder::initialize(int width, int height, const std::string& codec)
{
    (void)codec;
    width_ = width;
    height_ = height;
    initialized_ = true;
    return true;
}

bool H264VideoDecoder::decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us)
{
    if (!initialized_) return false;

    // Pass encoded data through as a decoded frame. Real H264 decoding would
    // integrate with FFmpeg/MediaCodec/VideoToolbox here. The stream receiver
    // converts this data to an OBS texture via FrameConverter.
    VideoFrame frame;
    frame.data = encoded_data;
    frame.width = width_;
    frame.height = height_;
    frame.timestamp_us = timestamp_us;

    if (onFrameDecoded) {
        onFrameDecoded(frame);
    }
    return true;
}

void H264VideoDecoder::release()
{
    initialized_ = false;
    width_ = 0;
    height_ = 0;
}

bool H264VideoDecoder::isInitialized() const
{
    return initialized_;
}

} // namespace ojowacam