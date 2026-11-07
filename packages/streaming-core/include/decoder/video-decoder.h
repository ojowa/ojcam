#pragma once

#include "../streaming-core.h"
#include <functional>

namespace ojowacam {

class VideoDecoder {
public:
    virtual ~VideoDecoder() = default;
    
    virtual bool initialize(int width, int height, const std::string& codec) = 0;
    virtual bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) = 0;
    virtual void release() = 0;
    
    std::function<void(const VideoFrame&)> onFrameDecoded;
    
    virtual bool isInitialized() const = 0;
};

class H264VideoDecoder final : public VideoDecoder {
public:
    bool initialize(int width, int height, const std::string& codec) override;
    bool decode(const std::vector<uint8_t>& encoded_data, int64_t timestamp_us) override;
    void release() override;
    bool isInitialized() const override;
};

} // namespace ojowacam
