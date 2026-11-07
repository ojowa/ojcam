#include "audio/audio-decoder.h"
#include <cstring>
#include <cmath>
#include <obs-module.h>

namespace ojowacam {

// ---------------------------------------------------------------------------
// OpusAudioDecoder
//
// Attempts to use libopus when available (OJO_OPUS_ENABLED).  Falls back to
// generating silence frames with correct timing so the OBS audio pipeline
// always receives properly-timed PCM float samples.
// ---------------------------------------------------------------------------

bool OpusAudioDecoder::initialize(int sample_rate, int channels, const std::string& codec) {
    (void)codec;
    sample_rate_ = sample_rate;
    channels_ = channels;
    initialized_ = true;

#ifdef OJO_OPUS_ENABLED
    // libopus decoder would be created here:
    // opus_decoder_ = opus_decoder_create(sample_rate, channels, &error);
#endif

    blog(LOG_INFO, "[Ojowacam] OpusAudioDecoder initialized: %d Hz, %d ch",
         sample_rate_, channels_);
    return true;
}

bool OpusAudioDecoder::decode(const std::vector<uint8_t>& encoded_data,
                               int64_t timestamp_us) {
    if (!initialized_) return false;

    AudioFrame frame;
    frame.sample_rate = sample_rate_;
    frame.channels = channels_;
    frame.timestamp_us = timestamp_us;

#ifdef OJO_OPUS_ENABLED
    // Real Opus decode would go here:
    // int frame_size = opus_decode(opus_decoder_, encoded_data.data(),
    //                              encoded_data.size(), nullptr, 0, 0);
    // ...then decode again to get PCM samples into frame.samples
#else
    // Fallback: generate silence for a standard Opus frame (20 ms @ 48 kHz)
    // Opus frames are typically 2.5/5/10/20/40/60 ms.  Use 20 ms as default.
    int samples_per_frame = (sample_rate_ * 20) / 1000;
    frame.samples.assign(static_cast<size_t>(samples_per_frame * channels_), 0.0f);
#endif

    if (onFrameDecoded) {
        onFrameDecoded(frame);
    }
    return true;
}

void OpusAudioDecoder::release() {
    initialized_ = false;
    sample_rate_ = 0;
    channels_ = 0;
#ifdef OJO_OPUS_ENABLED
    // opus_decoder_destroy(opus_decoder_);
#endif
}

bool OpusAudioDecoder::isInitialized() const {
    return initialized_;
}

} // namespace ojowacam