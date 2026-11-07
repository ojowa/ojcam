#pragma once

#include "../streaming-core.h"
#include <functional>
#include <cstring>

namespace ojowacam {

class AudioDecoder {
public:
    virtual ~AudioDecoder() = default;

    virtual bool initialize(int sample_rate, int channels, const std::string& codec) = 0;
    virtual bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) = 0;
    virtual void release() = 0;

    std::function<void(const AudioFrame&)> onFrameDecoded;

    virtual bool isInitialized() const = 0;

protected:
    int sample_rate_ = 0;
    int channels_ = 0;
    bool initialized_ = false;
};

// ---------------------------------------------------------------------------
// Opus audio decoder with libopus integration
// ---------------------------------------------------------------------------
class OpusAudioDecoder final : public AudioDecoder {
public:
    OpusAudioDecoder();
    ~OpusAudioDecoder() override;

    bool initialize(int sample_rate, int channels, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;

    // Get decoded frame size info for debugging
    int lastFrameSize() const { return last_frame_size_; }

private:
#ifdef OJO_OPUS_ENABLED
    void* opus_decoder_;  // OpusDecoder* (opaque to avoid header dependency here)
#endif
    int last_frame_size_ = 0;
};

} // namespace ojowacam