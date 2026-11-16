#include "decoder/audio-decoder.h"
#include <atomic>
#include <cstring>
#include <cmath>
#include <obs-module.h>

#ifdef OJO_OPUS_ENABLED
    extern "C" {
    #if defined(__has_include) && __has_include(<opus/opus.h>)
        #include <opus/opus.h>
    #else
        #include <opus.h>
    #endif
    }
#endif

namespace ojowacam {

// ---------------------------------------------------------------------------
// OpusAudioDecoder
//
// libopus decoding with Opus packet-loss concealment for lost/corrupt
// packets. If a frame cannot be produced, decode() fails honestly (drops)
// instead of fabricating silence that would fake audio activity in OBS.
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
    opus_decoder_ctl(static_cast<OpusDecoder*>(opus_decoder_),
                     OPUS_SET_INBAND_FEC(1));

    // Set expected packet loss percentage (helps with concealment)
    opus_decoder_ctl(static_cast<OpusDecoder*>(opus_decoder_),
                     OPUS_SET_PACKET_LOSS_PERC(5));
    initialized_ = true;
    blog(LOG_INFO, "[Ojowacam] OpusAudioDecoder initialized: %d Hz, %d ch (libopus=enabled)",
         sample_rate_, channels_);
    return true;
#else
    initialized_ = false;
    blog(LOG_ERROR,
         "[Ojowacam] Opus decoder unavailable in this build; audio frames will be dropped");
    return false;
#endif
}

bool OpusAudioDecoder::decode(const std::vector<uint8_t>& encoded_data,
                               int64_t timestamp_us) {
    if (!initialized_) return false;

#ifdef OJO_OPUS_ENABLED
    if (!opus_decoder_) return false;

    // Single real decode pass; 60 ms buffer covers any Opus packet duration.
    const int max_frame_size = sample_rate_ * 60 / 1000;
    std::vector<float> pcm(static_cast<size_t>(max_frame_size) *
                           static_cast<size_t>(channels_));

    int decoded = -1;
    if (!encoded_data.empty()) {
        decoded = opus_decode_float(static_cast<OpusDecoder*>(opus_decoder_),
                                    encoded_data.data(),
                                    static_cast<opus_int32>(encoded_data.size()),
                                    pcm.data(),
                                    max_frame_size,
                                    0);
    }
    if (decoded < 0) {
        // Standard Opus packet-loss concealment (null packet data, real PCM
        // output) — the same concealment every VoIP stack applies on loss.
        static std::atomic<bool> warned_decode{false};
        if (!warned_decode.exchange(true)) {
            blog(LOG_WARNING, "[Ojowacam] Opus: decode failed (%s); concealing packet",
                 opus_strerror(decoded));
        }
        decoded = opus_decode_float(static_cast<OpusDecoder*>(opus_decoder_),
                                    nullptr, 0, pcm.data(), max_frame_size, 0);
    }
    if (decoded <= 0) {
        // Honest failure: drop the frame rather than fabricate audio.
        return false;
    }

    AudioFrame frame;
    frame.sample_rate = sample_rate_;
    frame.channels = channels_;
    frame.timestamp_us = timestamp_us;
    pcm.resize(static_cast<size_t>(decoded) * static_cast<size_t>(channels_));
    frame.samples = std::move(pcm);
    last_frame_size_ = decoded;

    if (onFrameDecoded) {
        onFrameDecoded(frame);
    }
    return true;
#else
    static std::atomic<bool> warned_no_opus{false};
    if (!warned_no_opus.exchange(true)) {
        blog(LOG_ERROR, "[Ojowacam] Opus decoder unavailable in this build; dropping audio");
    }
    return false;
#endif
}

void OpusAudioDecoder::release() {
    initialized_ = false;
    sample_rate_ = 0;
    channels_ = 0;
    last_frame_size_ = 0;

#ifdef OJO_OPUS_ENABLED
    if (opus_decoder_) {
        opus_decoder_destroy(static_cast<OpusDecoder*>(opus_decoder_));
        opus_decoder_ = nullptr;
    }
#endif
}

bool OpusAudioDecoder::isInitialized() const {
    return initialized_;
}

} // namespace ojowacam