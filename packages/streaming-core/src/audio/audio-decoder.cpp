#include "audio/audio-decoder.h"
#include <cstring>

namespace ojowacam {

bool OpusAudioDecoder::initialize(int sample_rate, int channels, const std::string& codec)
{
    (void)codec;
    sample_rate_ = sample_rate;
    channels_ = channels;
    initialized_ = true;
    return true;
}

bool OpusAudioDecoder::decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us)
{
    if (!initialized_) return false;

    // Pass encoded Opus data through as an audio frame. Real Opus decoding
    // would integrate with libopus here. The stream receiver pushes PCM
    // samples to OBS audio output.
    AudioFrame frame;
    frame.samples.resize(encoded_data.size() / sizeof(float));
    std::memcpy(frame.samples.data(), encoded_data.data(), encoded_data.size());
    frame.sample_rate = sample_rate_;
    frame.channels = channels_;
    frame.timestamp_us = timestamp_us;

    if (onFrameDecoded) {
        onFrameDecoded(frame);
    }
    return true;
}

void OpusAudioDecoder::release()
{
    initialized_ = false;
    sample_rate_ = 0;
    channels_ = 0;
}

bool OpusAudioDecoder::isInitialized() const
{
    return initialized_;
}

} // namespace ojowacam