#include "stream-receiver.h"
#include <transport/webrtc-transport.h>
#include <obs-module.h>
#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <algorithm>

namespace ojowacam {

struct StreamReceiver::Impl {
    obs_source_t* video_source = nullptr;
    obs_source_t* audio_source = nullptr;

    std::unique_ptr<WebRTCTransport> transport;
    std::unique_ptr<VideoDecoder> video_decoder;
    std::unique_ptr<AudioDecoder> audio_decoder;
    std::unique_ptr<StreamSynchronizer> synchronizer;
    std::unique_ptr<FrameConverter> frame_converter;

    std::string device_id;
    std::string signaling_url;
    std::atomic<bool> connected{false};

    // Auto-reconnect state (single-flight worker)
    std::mutex reconnect_mutex_;
    std::thread reconnect_thread_;
    std::atomic<bool> stop_reconnect_{false};
    // Guarded by reconnect_mutex_: true while a worker owns the reconnect slot
    bool reconnect_running_ = false;
    std::atomic<int> reconnect_attempts_{0};
    static constexpr int kMaxReconnectAttempts = 10;

    // Frame converter format (set from SPS or default)
    VideoPixelFormat video_format_ = VideoPixelFormat::Unknown;

    // Last video size pushed to OBS (for onVideoSizeChanged)
    int last_width_ = 0;
    int last_height_ = 0;

    Impl() = default;
    ~Impl() {
        stop_reconnect_.store(true, std::memory_order_release);
        if (reconnect_thread_.joinable() &&
            reconnect_thread_.get_id() != std::this_thread::get_id()) {
            reconnect_thread_.join();
        }
    }
};

StreamReceiver::StreamReceiver(obs_source_t* video_source, obs_source_t* audio_source)
    : impl_(new Impl()) {
    impl_->video_source = video_source;
    impl_->audio_source = audio_source;

    impl_->transport = std::make_unique<WebRTCTransport>();
    // Prefer the FFmpeg-backed decoder (OJO_FFMPEG_ENABLED); fall back to the
    // NAL-parsing stub, which cannot produce pixels and drops frames.
    impl_->video_decoder = HardwareVideoDecoder::Create("H264");
    if (!impl_->video_decoder) {
        impl_->video_decoder = std::make_unique<H264VideoDecoder>();
    }
    impl_->audio_decoder = std::make_unique<OpusAudioDecoder>();
    impl_->synchronizer = std::make_unique<StreamSynchronizer>();
    impl_->frame_converter = std::make_unique<FrameConverter>();

    // Transport → decoder pipeline
    impl_->transport->onVideoFrame = [this](const VideoFrame& frame) {
        impl_->video_decoder->decode(frame.data, frame.timestamp_us);
    };

    // Transport delivers decoded PCM audio in AudioFrame::samples
    impl_->transport->onAudioFrame = [this](const AudioFrame& frame) {
        pushAudioFrameToOBS(frame);
    };

    impl_->transport->onConnectionStateChanged = [this](bool connected) {
        impl_->connected.store(connected, std::memory_order_release);
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

StreamReceiver::~StreamReceiver() {
    // Stop auto-reconnect before tearing down transport so a late
    // onConnectionStateChanged(false) cannot respawn a worker.
    impl_->stop_reconnect_.store(true, std::memory_order_release);
    cancelReconnectAndWait();
    disconnect();
    delete impl_;
}

void StreamReceiver::scheduleReconnect() {
    if (impl_->stop_reconnect_.load(std::memory_order_acquire)) return;

    std::lock_guard<std::mutex> lock(impl_->reconnect_mutex_);

    // Re-check under the lock: disconnect/dtor may have stopped us.
    if (impl_->stop_reconnect_.load(std::memory_order_relaxed)) return;

    // Single-flight: one worker owns retries; never assign over a joinable thread.
    if (impl_->reconnect_running_) return;

    const int attempt =
        impl_->reconnect_attempts_.fetch_add(1, std::memory_order_relaxed) + 1;
    if (attempt > Impl::kMaxReconnectAttempts) {
        blog(LOG_WARNING, "[Ojowacam] Max reconnect attempts reached for device %s",
             impl_->device_id.c_str());
        return;
    }

    // Join a finished previous worker before respawn (never join self).
    if (impl_->reconnect_thread_.joinable()) {
        if (impl_->reconnect_thread_.get_id() == std::this_thread::get_id()) {
            return;
        }
        impl_->reconnect_thread_.join();
    }

    const std::string device_id = impl_->device_id;
    const std::string signaling_url = impl_->signaling_url;

    impl_->reconnect_running_ = true;
    impl_->reconnect_thread_ =
        std::thread(&StreamReceiver::reconnectWorker, this, device_id, signaling_url);
}

void StreamReceiver::reconnectWorker(std::string device_id, std::string signaling_url) {
    while (!impl_->stop_reconnect_.load(std::memory_order_acquire)) {
        const int attempt = impl_->reconnect_attempts_.load(std::memory_order_relaxed);
        if (attempt > Impl::kMaxReconnectAttempts) {
            blog(LOG_WARNING, "[Ojowacam] Max reconnect attempts reached for device %s",
                 device_id.c_str());
            break;
        }

        int delay_ms = 1000 * attempt;
        if (delay_ms > 30000) delay_ms = 30000;

        // Sleep in slices so cancel/dtor is responsive.
        for (int slept = 0; slept < delay_ms; slept += 100) {
            if (impl_->stop_reconnect_.load(std::memory_order_acquire)) {
                finishReconnectWorker();
                return;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        if (impl_->stop_reconnect_.load(std::memory_order_acquire)) {
            finishReconnectWorker();
            return;
        }

        blog(LOG_INFO, "[Ojowacam] Reconnecting device %s (attempt %d/%d)",
             device_id.c_str(), attempt, Impl::kMaxReconnectAttempts);

        // connect() does not reset attempts on entry (that caused an infinite
        // loop when the worker called it). Failure paths only schedule when
        // no worker is running — here reconnect_running_ is true, so those
        // scheduleReconnect() calls are no-ops and we advance below.
        const bool ok = connect(device_id, signaling_url);

        if (ok && impl_->connected.load(std::memory_order_acquire)) {
            // connect() already restored the attempt budget on success.
            finishReconnectWorker();
            return;
        }

        const int next =
            impl_->reconnect_attempts_.fetch_add(1, std::memory_order_relaxed) + 1;
        if (next > Impl::kMaxReconnectAttempts) {
            blog(LOG_WARNING, "[Ojowacam] Max reconnect attempts reached for device %s",
                 device_id.c_str());
            break;
        }
    }

    finishReconnectWorker();
}

void StreamReceiver::finishReconnectWorker() {
    std::lock_guard<std::mutex> lock(impl_->reconnect_mutex_);
    impl_->reconnect_running_ = false;
}

void StreamReceiver::cancelReconnectAndWait() {
    impl_->stop_reconnect_.store(true, std::memory_order_release);

    // Barrier: wait until any in-flight scheduleReconnect() finishes spawning.
    {
        std::lock_guard<std::mutex> lock(impl_->reconnect_mutex_);
    }

    // Join outside the mutex so the worker can take it in finishReconnectWorker().
    if (impl_->reconnect_thread_.joinable() &&
        impl_->reconnect_thread_.get_id() != std::this_thread::get_id()) {
        impl_->reconnect_thread_.join();
    }
}

bool StreamReceiver::connect(const std::string& device_id,
                              const std::string& signaling_url) {
    {
        // Re-enable auto-reconnect only for external/manual connects.
        // The reconnect worker must not clear stop_reconnect_ — disconnect()
        // sets it to cancel the worker, and clearing it here would resurrect
        // retries mid-teardown. Attempt budget is not reset on entry (only on
        // success below); an entry reset made kMaxReconnectAttempts unreachable.
        std::lock_guard<std::mutex> lock(impl_->reconnect_mutex_);
        if (!impl_->reconnect_running_) {
            impl_->stop_reconnect_.store(false, std::memory_order_release);
        }
    }
    impl_->device_id = device_id;
    impl_->signaling_url = signaling_url;

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

    // The phone is the offerer; OBS answers when its OFFER arrives.
    impl_->connected.store(true, std::memory_order_release);
    // Reset only on success — never on entry. Entry reset is what made
    // kMaxReconnectAttempts unreachable (worker calls connect() each retry).
    impl_->reconnect_attempts_.store(0, std::memory_order_relaxed);

    blog(LOG_INFO, "[Ojowacam] Connected to device %s", device_id.c_str());
    return true;
}

void StreamReceiver::pushVideoFrameToOBS(const VideoFrame& frame) {
    if (!impl_->video_source) return;
    if (frame.data.empty() || frame.width <= 0 || frame.height <= 0) return;

    if (frame.width != impl_->last_width_ || frame.height != impl_->last_height_) {
        impl_->last_width_ = frame.width;
        impl_->last_height_ = frame.height;
        if (onVideoSizeChanged) onVideoSizeChanged(frame.width, frame.height);
    }

    if (frame.format != VideoPixelFormat::Unknown) {
        impl_->frame_converter->setFormat(frame.format);
    }

    // Convert to RGBA (YUV420/NV12/RGBA) for the OBS async video path.
    std::vector<uint8_t> rgba;
    if (!impl_->frame_converter->convertToRgba(frame.data, frame.width, frame.height, rgba)) {
        return;
    }

    obs_source_frame obs_frame{};
    obs_frame.format = VIDEO_FORMAT_RGBA;
    obs_frame.width = frame.width;
    obs_frame.height = frame.height;
    obs_frame.timestamp = frame.timestamp_us * 1000; // us -> ns
    obs_frame.data[0] = rgba.data();
    obs_frame.linesize[0] = frame.width * 4;

    obs_source_output_video(impl_->video_source, &obs_frame);
}

void StreamReceiver::pushAudioFrameToOBS(const AudioFrame& frame) {
    if (!impl_->audio_source) return;
    if (frame.samples.empty() || frame.channels <= 0) return;

    struct obs_source_audio audio{};
    audio.data[0] = reinterpret_cast<const uint8_t*>(frame.samples.data());
    audio.frames = static_cast<uint32_t>(frame.samples.size() / static_cast<size_t>(frame.channels));
    audio.speakers = (frame.channels == 1) ? SPEAKERS_MONO : SPEAKERS_STEREO;
    audio.format = AUDIO_FORMAT_FLOAT;
    audio.samples_per_sec = static_cast<uint32_t>(frame.sample_rate);
    audio.timestamp = static_cast<uint64_t>(frame.timestamp_us) * 1000; // us -> ns

    obs_source_output_audio(impl_->audio_source, &audio);
}

void StreamReceiver::setVideoSource(obs_source_t* source) {
    impl_->video_source = source;
}

void StreamReceiver::setAudioSource(obs_source_t* source) {
    impl_->audio_source = source;
}

bool StreamReceiver::isConnected() const {
    return impl_->connected.load(std::memory_order_acquire);
}

void StreamReceiver::disconnect() {
    // Intentional teardown: cancel auto-reconnect before dropping the
    // transport (its disconnect callback would otherwise schedule a retry).
    cancelReconnectAndWait();

    impl_->transport->disconnect();
    impl_->connected.store(false, std::memory_order_release);
    impl_->synchronizer->reset();
}

} // namespace ojowacam
