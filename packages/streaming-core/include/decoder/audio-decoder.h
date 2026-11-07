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

class OpusAudioDecoder final : public AudioDecoder {
public:
    bool initialize(int sample_rate, int channels, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;
};

} // namespace ojowacam