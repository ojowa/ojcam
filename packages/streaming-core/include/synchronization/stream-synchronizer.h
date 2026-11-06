#pragma once

#include "../streaming-core.h"
#include <chrono>

namespace ojowacam {

class StreamSynchronizer {
public:
    StreamSynchronizer();
    
    // Push video frame with NTP timestamp
    void pushVideoFrame(const VideoFrame& frame);
    
    // Push audio frame with NTP timestamp  
    void pushAudioFrame(const AudioFrame& frame);
    
    // Get next video frame that should be displayed at given time
    std::optional<VideoFrame> getNextVideoFrame(int64_t ntp_time_ms);
    
    // Get next audio samples that should be played at given time
    std::optional<AudioFrame> getNextAudioFrame(int64_t ntp_time_ms);
    
    void reset();
    
private:
    std::vector<VideoFrame> video_queue_;
    std::vector<AudioFrame> audio_queue_;
    int64_t base_ntp_ms_ = 0;
    bool initialized_ = false;
};

} // namespace ojowacam
