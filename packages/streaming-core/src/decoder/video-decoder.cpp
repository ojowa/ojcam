#include "decoder/video-decoder.h"

namespace ojowacam {

bool H264VideoDecoder::initialize(int width, int height, const std::string& codec)
{
    (void)width;
    (void)height;
    (void)codec;
    return false;
}

bool H264VideoDecoder::decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us)
{
    (void)encoded_data;
    (void)timestamp_us;
    return false;
}

void H264VideoDecoder::release()
{
}

bool H264VideoDecoder::isInitialized() const
{
    return false;
}

} // namespace ojowacam