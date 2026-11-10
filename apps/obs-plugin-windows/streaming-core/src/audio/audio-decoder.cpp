#include "decoder/audio-decoder.h"
#include <cstring>
#include <cmath>
#include <obs-module.h>

#ifdef OJO_OPUS_ENABLED
    extern "C" {
    #include <opus/opus.h>
    }
#endif

namespace ojowacam {

// ---------------------------------------------------------------------------
// OpusAudioDecoder
//
// Proper libopus integration with fallback to silence frames when libopus
// is not available. Handles variable frame sizes, packet loss concealment,
// and correct sample rate / channel configuration.
// ---------------------------------------------------------------------------

OpusAudioDecoder::OpusAudioDecoder() {
#ifdef OJO_OPUS_ENABLED
    opus_decoder_ = nullptr;
#endif
    last_frame_size_ = 0;
}

OpusAudioDecoder::~OpusAudioDecoder() {
    release();
}

bool OpusAudioDecoder::initialize(int sample_rate, int channels, const std::string& codec) {
    (void)codec;
    sample_rate_ = sample_rate;
    channels_ = channels;
    last_frame_size_ = 0;

#ifdef OJO_OPUS_ENABLED
    int error = 0;
    opus_decoder_ = opus_decoder_create(sample_rate, channels, &error);
    if (error != OPUS_OK || !opus_decoder_) {
        blog(LOG_ERROR, "[Ojowacam] Opus: decoder creation failed: %s",
             opus_strerror(error));
        opus_decoder_ = nullptr;
        initialized_ = false;
        return false;
    }

    // Set decoder to expect inband FEC (forward error correction)
    opus_decoder_ctl(opus_decoder_, OPUS_SET_INBAND_FEC(1));

    // Set expected packet loss percentage (helps with concealment)
    opus_decoder_ctl(opus_decoder_, OPUS_SET_PACKET_LOSS_PCT(5));
#endif

    initialized_ = true;

    blog(LOG_INFO, "[Ojowacam] OpusAudioDecoder initialized: %d Hz, %d ch (libopus=%s)",
         sample_rate_, channels_,
#ifdef OJO_OPUS_ENABLED
         "enabled"
#else
         "disabled (silence fallback)"
#endif
    );
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
    if (opus_decoder_ && !encoded_data.empty()) {
        // First pass: decode with null PCM to get the frame size
        int max_frame_size = sample_rate_ * 60 / 1000;  // max 60ms frame
        int frame_size = opus_decode(opus_decoder_,
                                     encoded_data.data(),
                                     static_cast<opus_int32>(encoded_data.size()),
                                     nullptr,
                                     max_frame_size,
                                     0);  // 0 = no PLC, let Opus handle lost packets

        if (frame_size < 0) {
            // Packet loss or corrupt data – use PLC by passing null data
            blog(LOG_WARNING, "[Ojowacam] Opus: decode error: %s",
                 opus_strerror(frame_size));
            frame_size = opus_decode(opus_decoder_,
                                     nullptr,
                                     0,
                                     nullptr,
                                     max_frame_size,
                                     1);  // 1 = conceal lost packets
        }

        if (frame_size > 0) {
            // Second pass: decode into actual PCM buffer
            std::vector<float> pcm(max_frame_size * channels_);
            int decoded = opus_decode(opus_decoder_,
                                      encoded_data.empty() ? nullptr : encoded_data.data(),
                                      encoded_data.empty() ? 0 : static_cast<opus_int32>(encoded_data.size()),
                                      pcm.data(),
                                      max_frame_size,
                                      0);

            if (decoded > 0) {
                pcm.resize(static_cast<size_t>(decoded * channels_));
                frame.samples = std::move(pcm);
                last_frame_size_ = decoded;
            } else {
                // Generate silence as fallback
                int silence_samples = (sample_rate_ * 20) / 1000;
                frame.samples.assign(static_cast<size_t>(silence_samples * channels_), 0.0f);
                last_frame_size_ = silence_samples;
            }
        } else {
            // Severe error – generate silence
            int silence_samples = (sample_rate_ * 20) / 1000;
            frame.samples.assign(static_cast<size_t>(silence_samples * channels_), 0.0f);
            last_frame_size_ = silence_samples;
        }
    } else {
        // No libopus – generate silence for a standard 20ms Opus frame
        int samples_per_frame = (sample_rate_ * 20) / 1000;
        frame.samples.assign(static_cast<size_t>(samples_per_frame * channels_), 0.0f);
        last_frame_size_ = samples_per_frame;
    }
#else
    // No libopus – generate silence for a standard 20ms Opus frame
    int samples_per_frame = (sample_rate_ * 20) / 1000;
    frame.samples.assign(static_cast<size_t>(samples_per_frame * channels_), 0.0f);
    last_frame_size_ = samples_per_frame;
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
    last_frame_size_ = 0;

#ifdef OJO_OPUS_ENABLED
    if (opus_decoder_) {
        opus_decoder_destroy(opus_decoder_);
        opus_decoder_ = nullptr;
    }
#endif
}

bool OpusAudioDecoder::isInitialized() const {
    return initialized_;
}

} // namespace ojowacam