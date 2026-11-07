#include "stream-receiver.h"
#include <transport/webrtc-transport.h>
#include <obs-module.h>
#include <chrono>
#include <thread>
#include <algorithm>

namespace ojowacam {

struct StreamReceiver::Impl {
    obs_source_t* video_source = nullptr;
    obs_source_t* audio_source = nullptr;

    std::unique_ptr<Transport> transport;
    std::unique_ptr<VideoDecoder> video_decoder;
    std::unique_ptr<AudioDecoder> audio_decoder;
    std::unique_ptr<StreamSynchronizer> synchronizer;
    std::unique_ptr<FrameConverter> frame_converter;

    std::string device_id;
    std::string signaling_url;
    bool connected = false;

    // Auto-reconnect state
    std::thread reconnect_thread_;
    bool stop_reconnect_ = false;
    int reconnect_attempts_ = 0;
    static constexpr int kMaxReconnectAttempts = 10;

    // Frame converter format (set from SPS or default)
    VideoPixelFormat video_format_ = VideoPixelFormat::Unknown;

    Impl() = default;
    ~Impl() {
        stop_reconnect_ = true;
        if (reconnect_thread_.joinable()) {
            reconnect_thread_.join();
        }
    }
};

StreamReceiver::StreamReceiver(obs_source_t* video_source, obs_source_t* audio_source)
    : impl_(new Impl()) {
    impl_->video_source = video_source;
    impl_->audio_source = audio_source;

    impl_->transport = std::make_unique<WebRTCTransport>();
    impl_->video_decoder = std::make_unique<H264VideoDecoder>();
    impl_->audio_decoder = std::make_unique<OpusAudioDecoder>();
    impl_->synchronizer = std::make_unique<StreamSynchronizer>();
    impl_->frame_converter = std::make_unique<FrameConverter>();

    // Transport → decoder pipeline
    impl_->transport->onVideoFrame = [this](const VideoFrame& frame) {
        // Feed raw transport data into video decoder
        impl_->video_decoder->decode(frame.data, frame.timestamp_us);
    };

    impl_->transport->onAudioFrame = [this](const AudioFrame& frame) {
        impl_->audio_decoder->decode(frame.data, frame.timestamp_us);
    };

    impl_->transport->onConnectionStateChanged = [this](bool connected) {
        impl_->connected = connected;
StreamReceiver::~StreamReceiver() {
    disconnect();
    delete impl_;
}

void StreamReceiver::scheduleReconnect() {
    if (impl_->stop_reconnect_) return;
    impl_->reconnect_attempts_++;
    if (impl_->reconnect_attempts_ > impl_->kMaxReconnectAttempts) {
        blog(LOG_WARNING, "[Ojowacam] Max reconnect attempts reached for device %s",
             impl_->device_id.c_str());
        return;
    }

    impl_->reconnect_thread_ = std::thread([this]() {
        int delay_ms = 1000 * impl_->reconnect_attempts_;
        if (delay_ms > 30000) delay_ms = 30000;
        std::this_thread::sleep_for(std::chrono::milliseconds(delay_ms));
        if (impl_->stop_reconnect_) return;

        blog(LOG_INFO, "[Ojowacam] Reconnecting device %s (attempt %d/%d)",
             impl_->device_id.c_str(), impl_->reconnect_attempts_,
             impl_->kMaxReconnectAttempts);
        connect(impl_->device_id, impl_->signaling_url);
    });
}

bool StreamReceiver::connect(const std::string& device_id,
                              const std::string& signaling_url) {
    impl_->device_id = device_id;
    impl_->signaling_url = signaling_url;
    impl_->reconnect_attempts_ = 0;

    // Initialize decoders based on expected stream config
    if (!impl_->video_decoder->isInitialized()) {
        impl_->video_decoder->initialize(1920, 1080, "H264");
    }
    if (!impl_->audio_decoder->isInitialized()) {
        impl_->audio_decoder->initialize(48000, 2, "OPUS");
    }

    if (!impl_->transport->connect(signaling_url)) {
        blog(LOG_ERROR, "[Ojowacam] WebRTC transport connect failed for device %s",
             device_id.c_str());
        scheduleReconnect();
        return false;
    }

    impl_->transport->createOffer();
    impl_->connected = true;

void StreamReceiver::pushVideoFrameToOBS(const VideoFrame& frame) {
    if (!impl_->video_source) return;

    // Convert to RGBA texture via FrameConverter
    gs_texture_t* texture = impl_->frame_converter->convertToTexture(
        frame.data, frame.width, frame.height, nullptr);

    if (!texture) return;

    // Push to OBS video source using the converted texture data
    // obs_source_output_video expects raw pixel data; we upload to texture
    // first, then the source's render callback will sample from it.
    // For async video sources, we push a frame with the texture data pointer.
    obs_source_frame obs_frame{};
    obs_frame.format = VIDEO_FORMAT_RGBA;
    obs_frame.width = frame.width;
    obs_frame.height = frame.height;
    obs_frame.timestamp = frame.timestamp_us * 1000; // us -> ns
    obs_frame.data[0] = frame.data.data();
    obs_frame.linesize[0] = frame.width * 4 * sizeof(uint8_t);

    obs_source_output_video(impl_->video_source, &obs_frame);
}

void StreamReceiver::pushAudioFrameToOBS(const AudioFrame& frame) {
    if (!impl_->audio_source) return;

    obs_source_output_audio(impl_->audio_source,
                            frame.samples.data(),
                            frame.samples.size(),
                            SAMPLE_FORMAT_FLOAT,
                            frame.sample_rate,
                            frame.channels,
                            frame.timestamp_us * 1000); // us -> ns
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
    blog(LOG_INFO, "[Ojowacam] Connected to device %s", device_id.c_str());
    return true;
}

void StreamReceiver::disconnect() {
    impl_->transport->disconnect();
    impl_->connected = false;
    impl_->synchronizer->reset();
}
        if (!connected) {
            scheduleReconnect();
        }
    };

    // Decoder → OBS output pipeline
    impl_->video_decoder->onFrameDecoded = [this](const VideoFrame& frame) {
        pushVideoFrameToOBS(frame);
    };

    impl_->audio_decoder->onFrameDecoded = [this](const AudioFrame& frame) {
        pushAudioFrameToOBS(frame);
    };
}