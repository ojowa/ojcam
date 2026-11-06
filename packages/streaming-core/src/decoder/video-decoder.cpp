#include "decoder/video-decoder.h"

namespace ojowacam {

class H264VideoDecoder : public VideoDecoder {
public:
    H264VideoDecoder() = default;
    ~H264VideoDecoder() override = default;
    
    bool initialize(int width, int height, const std::string& codec) override {
        width_ = width;
        height_ = height;
        codec_ = codec;
        initialized_ = true;
        return true;
    }
    
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override {
        if (!initialized_) return false;
        
        // TODO: Actual H264 decode via Media Foundation or FFmpeg
        // For now, pass through as a placeholder frame
        VideoFrame frame;
        frame.data = encoded_data;
        frame.width = width_;
        frame.height = height_;
        frame.timestamp_us = timestamp_us;
        
        if (onFrameDecoded) onFrameDecoded(frame);
        return true;
    }
    
    void release() override {
        initialized_ = false;
    }
    
    bool isInitialized() const override { return initialized_; }
    
private:
    int width_ = 0;
    int height_ = 0;
    std::string codec_;
    bool initialized_ = false;
};

} // namespace ojowacam