#include "stream-receiver.h"

namespace ojowacam {

struct StreamReceiver::Impl {
    obs_source_t* video_source = nullptr;
    obs_source_t* audio_source = nullptr;
    
    std::unique_ptr<Transport> transport;
    std::unique_ptr<VideoDecoder> video_decoder;
    std::unique_ptr<AudioDecoder> audio_decoder;
    std::unique_ptr<StreamSynchronizer> synchronizer;
    
    std::string device_id;
    std::string signaling_url;
    bool connected = false;
};

StreamReceiver::StreamReceiver(obs_source_t* video_source, obs_source_t* audio_source)
    : impl_(new Impl()) {
    impl_->video_source = video_source;
    impl_->audio_source = audio_source;
    
    impl_->transport = std::make_unique<WebRTCTransport>();
    impl_->video_decoder = std::make_unique<H264VideoDecoder>();
    impl_->audio_decoder = std::make_unique<OpusAudioDecoder>();
    impl_->synchronizer = std::make_unique<StreamSynchronizer>();
    
    // Set up transport callbacks
    impl_->transport->onVideoFrame = [this](const VideoFrame& frame) {
        impl_->synchronizer->pushVideoFrame(frame);
    };
    
    impl_->transport->onAudioFrame = [this](const AudioFrame& frame) {
        impl_->synchronizer->pushAudioFrame(frame);
    };
    
    impl_->transport->onConnectionStateChanged = [this](bool connected) {
        impl_->connected = connected;
    };
    
    // Set up decoder callbacks
    impl_->video_decoder->onFrameDecoded = [this](const VideoFrame& frame) {
        // TODO: Push frame to OBS video source
    };
    
    impl_->audio_decoder->onFrameDecoded = [this](const AudioFrame& frame) {
        // TODO: Push audio to OBS audio source
    };
}

StreamReceiver::~StreamReceiver() {
    disconnect();
    delete impl_;
}

bool StreamReceiver::connect(const std::string& device_id, const std::string& signaling_url) {
    impl_->device_id = device_id;
    impl_->signaling_url = signaling_url;
    
    if (!impl_->transport->connect(signaling_url)) {
        return false;
    }
    
    impl_->transport->createOffer();
    impl_->connected = true;
    return true;
}

void StreamReceiver::disconnect() {
    impl_->transport->disconnect();
    impl_->connected = false;
}

void StreamReceiver::setVideoSource(obs_source_t* source) {
    impl_->video_source = source;
}

void StreamReceiver::setAudioSource(obs_source_t* source) {
    impl_->audio_source = source;
}

bool StreamReceiver::isConnected() const {
    return impl_->connected;
}

} // namespace ojowacam