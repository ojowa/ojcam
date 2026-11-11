#pragma once

#include <transport/transport.h>
#include <decoder/video-decoder.h>
#include <decoder/audio-decoder.h>
#include <synchronization/stream-synchronizer.h>
#include <frame-converter.h>
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

    // Pairing code the phone's PAIRING_REQUEST must match (before connect).
    void setPairingCode(const std::string& pairing_code);

    void setVideoSource(obs_source_t* source);
    void setAudioSource(obs_source_t* source);

    bool isConnected() const;

private:
    void scheduleReconnect();
    void reconnectWorker(std::string device_id, std::string signaling_url);
    void finishReconnectWorker();
    void cancelReconnectAndWait();
    void pushVideoFrameToOBS(const VideoFrame& frame);
    void pushAudioFrameToOBS(const AudioFrame& frame);

    struct Impl;
    Impl* impl_;
};

} // namespace ojowacam
