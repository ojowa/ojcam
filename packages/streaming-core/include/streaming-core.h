#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <functional>

namespace ojowacam {

struct VideoFrame {
    std::vector<uint8_t> data;
    int width = 0;
    int height = 0;
    int64_t timestamp_us = 0;
    int64_t ntp_time_ms = 0;
};

struct AudioFrame {
    std::vector<float> samples;
    int sample_rate = 48000;
    int channels = 2;
    int64_t timestamp_us = 0;
    int64_t ntp_time_ms = 0;
};

struct StreamConfig {
    std::string resolution = "1920x1080";
    int fps = 30;
    int bitrate = 8000000;
    std::string video_codec = "H264";
    std::string audio_codec = "OPUS";
    int sample_rate = 48000;
    int channels = 2;
};

using VideoFrameCallback = std::function<void(const VideoFrame&)>;
using AudioFrameCallback = std::function<void(const AudioFrame&)>;

} // namespace ojowacam
