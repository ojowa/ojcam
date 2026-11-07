#pragma once

#include <transport/transport.h>
#include <decoder/video-decoder.h>
#include <audio/audio-decoder.h>
#include <synchronization/stream-synchronizer.h>
#include <obs-module.h>
#include <string>
#include <memory>

namespace ojowacam {

class StreamReceiver {
public:
    StreamReceiver(obs_source_t* video_source, obs_source_t* audio_source);
    ~StreamReceiver();
    
    bool connect(const std::string& device_id, const std::string& signaling_url);
    void disconnect();
    
    void setVideoSource(obs_source_t* source);
    void setAudioSource(obs_source_t* source);
    
    bool isConnected() const;
    
private:
    struct Impl;
    Impl* impl_;
};

} // namespace ojowacam
