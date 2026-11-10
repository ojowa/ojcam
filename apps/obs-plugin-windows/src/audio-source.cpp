#include "audio-source.h"
#include "stream-receiver.h"
#include <string>

struct OjowacamAudioData {
    obs_source_t *source;
    float sample_rate;
    ojowacam::StreamReceiver* stream_receiver = nullptr;
};

obs_source_info ojowacam_audio_source_info = [] {
    obs_source_info info{};
    info.id = "ojowacam_audio_source";
    info.type = OBS_SOURCE_TYPE_INPUT;
    info.output_flags = OBS_SOURCE_AUDIO;
    info.get_name = [](void *) -> const char * { return "Ojowacam Microphone"; };
    info.create = ojowacam_audio_create;
    info.destroy = [](void *data) {
        auto *d = static_cast<OjowacamAudioData *>(data);
        if (d->stream_receiver) {
            d->stream_receiver->disconnect();
            delete d->stream_receiver;
        }
        delete d;
    };
    info.get_properties = ojowacam_audio_properties;
    return info;
}();

void *ojowacam_audio_create(obs_data_t *settings, obs_source_t *source)
{
    auto data = new OjowacamAudioData();
    data->source = source;
    data->sample_rate = 48000.0f;

    const char* device_id = obs_data_get_string(settings, "device_id");
    const char* signaling_url = obs_data_get_string(settings, "signaling_url");
    const char* pairing_code = obs_data_get_string(settings, "pairing_code");

    std::string resolved_device_id = device_id ? device_id : "";
    std::string resolved_signaling_url = signaling_url ? signaling_url : "";
    if (pairing_code && *pairing_code) {
        resolved_device_id = pairing_code;
        if (resolved_signaling_url.empty()) {
            resolved_signaling_url = "ws://localhost:8765";
        }
    }

    if (!resolved_device_id.empty() && !resolved_signaling_url.empty()) {
        data->stream_receiver = new ojowacam::StreamReceiver(nullptr, source);
        data->stream_receiver->connect(resolved_device_id, resolved_signaling_url);
    }

    return data;
}

obs_properties_t *ojowacam_audio_properties(void *data)
{
    auto *props = obs_properties_create();
    UNUSED_PARAMETER(data);

    obs_properties_add_text(props, "pairing_code", "Pairing Code (QR/manual)", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "device_id", "Device ID", OBS_TEXT_DEFAULT);
    obs_properties_add_text(props, "signaling_url", "Signaling URL (ws://)", OBS_TEXT_DEFAULT);
    obs_properties_add_button(props, "connect", "Connect to Device", [](obs_properties_t*, obs_property_t*, void* data) {
        auto *d = static_cast<OjowacamAudioData*>(data);
        if (d->stream_receiver) {
            d->stream_receiver->disconnect();
        }

        obs_data_t *settings = obs_source_get_settings(d->source);
        const char *device_id = obs_data_get_string(settings, "device_id");
        const char *signaling_url = obs_data_get_string(settings, "signaling_url");
        const char *pairing_code = obs_data_get_string(settings, "pairing_code");

        std::string resolved_device_id = device_id ? device_id : "";
        std::string resolved_signaling_url = signaling_url ? signaling_url : "";
        if (pairing_code && *pairing_code) {
            resolved_device_id = pairing_code;
            if (resolved_signaling_url.empty()) {
                resolved_signaling_url = "ws://localhost:8765";
            }
        }

        if (!resolved_device_id.empty() && !resolved_signaling_url.empty()) {
            if (!d->stream_receiver) {
                d->stream_receiver = new ojowacam::StreamReceiver(nullptr, d->source);
            }
            d->stream_receiver->connect(resolved_device_id, resolved_signaling_url);
        }
        obs_data_release(settings);
        return true;
    });
    obs_properties_add_int(props, "sample_rate", "Sample Rate", 8000, 192000, 1);
    obs_properties_add_int(props, "channels", "Channels", 1, 8, 1);

    return props;
}
