#include "synchronization/stream-synchronizer.h"
#include <algorithm>

namespace ojowacam {

StreamSynchronizer::StreamSynchronizer() = default;

void StreamSynchronizer::pushVideoFrame(const VideoFrame& frame) {
    std::lock_guard<std::mutex> lock(mutex_);
    video_queue_.push_back(frame);
    
    // Keep queue bounded
    if (video_queue_.size() > 10) {
        video_queue_.erase(video_queue_.begin());
    }
}

void StreamSynchronizer::pushAudioFrame(const AudioFrame& frame) {
    std::lock_guard<std::mutex> lock(mutex_);
    audio_queue_.push_back(frame);
    
    if (audio_queue_.size() > 20) {
        audio_queue_.erase(audio_queue_.begin());
    }
}

std::optional<VideoFrame> StreamSynchronizer::getNextVideoFrame(int64_t ntp_time_ms) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (!initialized_) {
        if (!video_queue_.empty()) {
            base_ntp_ms_ = ntp_time_ms;
            initialized_ = true;
        } else {
            return std::nullopt;
        }
    }
    
    int64_t target_offset = ntp_time_ms - base_ntp_ms_;
    
    // Find closest video frame
    auto it = std::lower_bound(video_queue_.begin(), video_queue_.end(), target_offset,
        [](const VideoFrame& f, int64_t offset) {
            return f.ntp_time_ms < offset;
        });
    
    if (it != video_queue_.end()) {
        VideoFrame frame = *it;
        video_queue_.erase(it);
        return frame;
    }
    
    return std::nullopt;
}

std::optional<AudioFrame> StreamSynchronizer::getNextAudioFrame(int64_t ntp_time_ms) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    if (!initialized_) {
        if (!audio_queue_.empty()) {
            base_ntp_ms_ = ntp_time_ms;
            initialized_ = true;
        } else {
            return std::nullopt;
        }
    }
    
    int64_t target_offset = ntp_time_ms - base_ntp_ms_;
    
    auto it = std::lower_bound(audio_queue_.begin(), audio_queue_.end(), target_offset,
        [](const AudioFrame& f, int64_t offset) {
            return f.ntp_time_ms < offset;
        });
    
    if (it != audio_queue_.end()) {
        AudioFrame frame = *it;
        audio_queue_.erase(it);
        return frame;
    }
    
    return std::nullopt;
}

void StreamSynchronizer::reset() {
    std::lock_guard<std::mutex> lock(mutex_);
    video_queue_.clear();
    audio_queue_.clear();
    initialized_ = false;
    base_ntp_ms_ = 0;
}

} // namespace ojowacam