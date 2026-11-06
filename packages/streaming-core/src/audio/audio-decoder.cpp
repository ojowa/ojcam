#include "audio/audio-decoder.h"

namespace ojowacam {

class OpusAudioDecoder : public AudioDecoder {
public:
    OpusAudioDecoder() = default;
    ~OpusAudioDecoder() override = default;
    
    bool initialize(int sample_rate, int channels, const std::string& codec) override {
        sample_rate_ = sample_rate;
        channels_ = channels;
        codec_ = codec;
        initialized_ = true;
        return true;
    }
    
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override {
        if (!initialized_) return false;
        
        // TODO: Actual Opus decode
        AudioFrame frame;
        frame.sample_rate = sample_rate_;
        frame.channels = channels_;
        frame.timestamp_us = timestamp_us;
        
        if (onFrameDecoded) onFrameDecoded(frame);
        return true;
    }
    
    void release() override { initialized_ = false; }
    bool isInitialized() const override { return initialized_; }
    
private:
    int sample_rate_ = 48000;
    int channels_ = 2;
    std::string codec_;
    bool initialized_ = false;
};

} // namespace ojowacam