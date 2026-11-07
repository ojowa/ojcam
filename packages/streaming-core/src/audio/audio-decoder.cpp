#include "audio/audio-decoder.h"

namespace ojowacam {

bool OpusAudioDecoder::initialize(int sample_rate, int channels, const std::string& codec)
{
    (void)sample_rate;
    (void)channels;
    (void)codec;
    return false;
}

bool OpusAudioDecoder::decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us)
{
    (void)encoded_data;
    (void)timestamp_us;
    return false;
}

void OpusAudioDecoder::release()
{
}

bool OpusAudioDecoder::isInitialized() const
{
    return false;
}

} // namespace ojowacam